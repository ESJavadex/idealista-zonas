// =========================================================================
// catastro.js — datos del EDIFICIO desde el Catastro para una vivienda:
// año de construcción, uso, superficie construida, plantas, nº de viviendas
// y la lista de inmuebles (planta, puerta, m²) para contrastar los m² del
// anuncio.
//
//   window.__izCatastro.edificio(lat, lng) → Promise<{
//     refCatastral, distancia, direccion, anoConstruccion, uso, estado,
//     superficieConstruida, plantas, sotanos, inmuebles, viviendas,
//     unidades: [{ planta, puerta, uso, m2, ano }], divisionHorizontal,
//     fuente, enlaceSede }>
//   window.__izCatastro.compararM2(info, m2Anuncio) → { ... } | null
//
// Servicios de la Dirección General del Catastro (todos con CORS "*", así que
// basta el mundo MAIN de la página, sin permisos):
//   · Consulta_RCCOOR_Distancia (coordenadas → parcela más cercana)
//   · INSPIRE wfsBU (edificio: año, uso, viviendas, superficie, plantas)
//   · Consulta_DNPRC (inmuebles de la parcela: planta, puerta, uso, m², año)
// Plan B para la parcela: reverseGeocode de CartoCiudad (IGN), que trae la RC.
// Caché en localStorage como barrio.js ("izb_c:cat:…", 365 días).
// =========================================================================
(function () {
  "use strict";

  if (window.__izCatastro) return;

  var OVC = "https://ovc.catastro.meh.es/";
  var URL_COOR = OVC + "OVCServWeb/OVCWcfCallejero/COVCCoordenadas.svc/json/Consulta_RCCOOR_Distancia";
  var URL_DNPRC = OVC + "OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC";
  var URL_WFS = OVC + "INSPIRE/wfsBU.aspx";
  var TTL = 365 * 864e5;

  function log(m) { try { console.log("[idealista-zonas/catastro] " + m); } catch (e) {} }

  // ---- caché (mismo formato que barrio.js: {t, ttl, v})
  function cacheGet(k) {
    try {
      var o = JSON.parse(localStorage.getItem("izb_c:cat:" + k) || "null");
      if (!o || !o.t || Date.now() - o.t > o.ttl) return null;
      return o.v;
    } catch (e) { return null; }
  }
  function cacheSet(k, v) {
    try { localStorage.setItem("izb_c:cat:" + k, JSON.stringify({ t: Date.now(), ttl: TTL, v: v })); } catch (e) {}
  }

  function conTimeout(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error("el Catastro no responde")); }, ms);
    })]);
  }
  function getJSON(u) {
    return conTimeout(fetch(u).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }), 25000);
  }
  function getText(u) {
    return conTimeout(fetch(u).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); }), 25000);
  }
  function num(t) {
    var n = parseFloat(String(t == null ? "" : t).replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? null : n;
  }

  function distM(a, b, c, d) {
    var r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
    return 2 * 6371000 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
  }

  // ---- 1) coordenadas → referencia catastral de la PARCELA (14 caracteres)
  function parcela(lat, lng) {
    return getJSON(URL_COOR + "?CoorX=" + lng + "&CoorY=" + lat + "&SRS=EPSG:4326").then(function (d) {
      var r = d && d.Consulta_RCCOOR_DistanciaResult;
      var l = r && r.coordenadas_distancias && r.coordenadas_distancias.coordd &&
              r.coordenadas_distancias.coordd[0] && r.coordenadas_distancias.coordd[0].lpcd;
      var p = l && l[0];
      if (!p || !p.pc) throw new Error("sin parcela");
      // devuelve la parcela catastrada MÁS CERCANA aunque esté lejos (obra nueva
      // sin catastrar → el edificio de al lado): más de 60 m no es esta vivienda
      if (num(p.dis) > 60) throw new Error("parcela más cercana a " + p.dis + " m");
      return { rc: p.pc.pc1 + p.pc.pc2, distancia: num(p.dis), direccion: (p.ldt || "").replace(/\s+/g, " ").trim() };
    }).catch(function () {
      // plan B: CartoCiudad (IGN) devuelve la RC del portal más cercano
      return getJSON("https://www.cartociudad.es/geocoder/api/geocoder/reverseGeocode?lon=" + lng + "&lat=" + lat)
        .then(function (c) {
          if (!c || !c.refCatastral) throw new Error("el Catastro no tiene parcela en ese punto");
          var dc = c.lat != null ? Math.round(distM(lat, lng, +c.lat, +c.lng)) : null;
          if (dc != null && dc > 60) throw new Error("sin parcela catastrada en ese punto (¿obra nueva?)");
          return { rc: c.refCatastral.slice(0, 14), distancia: dc,
                   direccion: [c.tip_via, c.address, c.portalNumber, c.muni].filter(Boolean).join(" ") };
        });
    });
  }

  // ---- 2) edificio INSPIRE (año, uso, estado, viviendas, superficie) y
  //         sus partes (plantas sobre y bajo rasante)
  function valor(xml, etiqueta) {
    var m = xml.match(new RegExp("<[\\w-]+:" + etiqueta + "(?:\\s[^>]*)?>([^<]*)<"));
    return m ? m[1].trim() : null;
  }
  var USOS = {
    "1_residential": "residencial", "2_agriculture": "agrario", "3_industrial": "industrial",
    "4_1_office": "oficinas", "4_2_retail": "comercial", "4_3_publicServices": "servicios públicos"
  };
  var ESTADOS = { functional: "en uso", ruin: "en ruina", declined: "deteriorado", underConstruction: "en construcción" };
  function edificioWFS(rc) {
    var base = URL_WFS + "?service=wfs&version=2&request=getfeature&srsname=EPSG::4326&refcat=" + rc + "&STOREDQUERIE_ID=";
    return Promise.all([
      getText(base + "GetBuildingByParcel"),
      getText(base + "GetBuildingPartByParcel").catch(function () { return ""; })
    ]).then(function (r) {
      var x = r[0] || "";
      if (!/<bu-core2d:reference>/.test(x) && !/<bu-ext2d:currentUse>/.test(x)) return null;
      var anyo = (valor(x, "beginning") || "").slice(0, 4);
      var sobre = (r[1].match(/numberOfFloorsAboveGround>(\d+)/g) || []).map(function (s) { return +s.split(">")[1]; });
      var bajo = (r[1].match(/numberOfFloorsBelowGround>(\d+)/g) || []).map(function (s) { return +s.split(">")[1]; });
      var uso = valor(x, "currentUse");
      var est = valor(x, "conditionOfConstruction");
      return {
        anoConstruccion: /^\d{4}$/.test(anyo) ? +anyo : null,
        uso: uso ? (USOS[uso] || uso) : null,
        estado: est ? (ESTADOS[est] || est) : null,
        inmuebles: num(valor(x, "numberOfBuildingUnits")),
        viviendas: num(valor(x, "numberOfDwellings")),
        superficieConstruida: num(valor(x, "value")),
        plantas: sobre.length ? Math.max.apply(null, sobre) : null,
        sotanos: bajo.length ? Math.max.apply(null, bajo) : null
      };
    });
  }

  // ---- 3) inmuebles de la parcela (división horizontal: un registro por piso)
  function inmuebles(rc) {
    return getJSON(URL_DNPRC + "?RefCat=" + rc).then(function (d) {
      var r = d && d.consulta_dnprcResult;
      if (!r) return null;
      var lista = r.lrcdnp && r.lrcdnp.rcdnp ? r.lrcdnp.rcdnp : r.bico ? [r.bico.bi] : [];
      var unidades = lista.map(function (b) {
        var loc = b.dt && b.dt.locs && b.dt.locs.lous && b.dt.locs.lous.lourb;
        var li = (loc && loc.loint) || {};
        var de = b.debi || {};
        return { planta: li.pt || null, puerta: li.pu || null, escalera: li.es || null,
                 uso: de.luso || null, m2: num(de.sfc), ano: num(de.ant) };
      });
      var finca = r.bico && r.bico.finca;
      return {
        unidades: unidades,
        divisionHorizontal: !!r.lrcdnp || !/sin divisi/i.test((finca && finca.ltp) || ""),
        direccion: lista[0] && lista[0].ldt ? lista[0].ldt : finca && finca.ldt
      };
    }).catch(function () { return null; });
  }

  function enlaceSede(rc) {
    return "https://www1.sedecatastro.gob.es/Cartografia/mapa.aspx?refcat=" + rc;
  }

  function edificio(lat, lng) {
    lat = +lat; lng = +lng;
    var k = lat.toFixed(5) + "," + lng.toFixed(5);
    var c = cacheGet(k);
    if (c) return Promise.resolve(c);
    return parcela(lat, lng).then(function (p) {
      return Promise.all([edificioWFS(p.rc).catch(function () { return null; }), inmuebles(p.rc)]).then(function (r) {
        var e = r[0] || {}, u = r[1] || {};
        if (!r[0] && !r[1]) throw new Error("el Catastro no tiene datos de esa parcela (¿obra nueva aún sin catastrar?)");
        var unidades = u.unidades || [];
        // año: el del edificio; si no, el más repetido entre sus inmuebles
        var ano = e.anoConstruccion;
        if (!ano && unidades.length) {
          var cnt = {};
          unidades.forEach(function (x) { if (x.ano) cnt[x.ano] = (cnt[x.ano] || 0) + 1; });
          ano = +Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0] || null;
        }
        var res = {
          refCatastral: p.rc, distancia: p.distancia,
          direccion: u.direccion || p.direccion || "",
          anoConstruccion: ano || null,
          uso: e.uso || null, estado: e.estado || null,
          superficieConstruida: e.superficieConstruida || null,
          plantas: e.plantas || null, sotanos: e.sotanos || null,
          inmuebles: e.inmuebles || (unidades.length || null),
          viviendas: e.viviendas || unidades.filter(function (x) { return /residencial|vivienda/i.test(x.uso || ""); }).length || null,
          unidades: unidades, divisionHorizontal: !!u.divisionHorizontal,
          fuente: "Dirección General del Catastro",
          enlaceSede: enlaceSede(p.rc)
        };
        cacheSet(k, res);
        return res;
      });
    });
  }

  // m² del anuncio frente a los inmuebles residenciales del edificio. OJO: el
  // Catastro da superficie CONSTRUIDA con su parte de zonas comunes, así que
  // suele ser algo mayor que la útil; se marca si el anuncio supera al mayor
  // piso del edificio, o se aleja mucho del más parecido
  function compararM2(info, m2) {
    if (!info || !m2) return null;
    var res = (info.unidades || []).filter(function (x) { return /residencial|vivienda/i.test(x.uso || "") && x.m2; });
    if (!res.length) return null;
    var m2s = res.map(function (x) { return x.m2; }).sort(function (a, b) { return a - b; });
    var parecido = res.slice().sort(function (a, b) { return Math.abs(a.m2 - m2) - Math.abs(b.m2 - m2); })[0];
    var dif = 100 * (m2 / parecido.m2 - 1);
    return {
      min: m2s[0], max: m2s[m2s.length - 1], n: res.length,
      parecido: parecido, difPct: Math.round(dif),
      sospechoso: m2 > m2s[m2s.length - 1] * 1.05 || Math.abs(dif) > 15
    };
  }

  window.__izCatastro = { edificio: edificio, parcela: parcela, compararM2: compararM2, enlaceSede: enlaceSede };
})();
