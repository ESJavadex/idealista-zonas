// =========================================================================
// barrio.js — en fichas de idealista (obra nueva y segunda mano) añade una
// sección "¿Comprar aquí?" que reúne lo que no se ve en el anuncio:
//
//   · Puntuación 0–10 con resumen (puntos fuertes / a vigilar)
//   · Tu clasificación de la zona (zonas.js)
//   · Inundación: huella REAL de la DANA 2024 + PATRICOVA (Generalitat)
//   · Renta y perfil del barrio por sección censal (INE, ADRH 2023)
//   · Servicios a pie (OpenStreetMap)
//   · Tiempos en coche a tus destinos (OSRM, sin tráfico)
//   · Precio €/m² de la zona y su evolución (informes de idealista)
//   · Alquilar vs comprar
//   · Checklist antes de reservar / visitar
//
// Y un COMPARADOR (botón flotante en todo idealista) con exportación CSV/JSON.
//
// Todo en el "mundo MAIN" de la página y sin permisos: las APIs usadas tienen
// CORS abierto. Las respuestas se cachean en localStorage.
// =========================================================================
(function () {
  "use strict";

  if (window.top !== window) return; // solo el documento principal
  if (!/idealista\./.test(location.hostname) && !window.__IZ_TEST) return; // __IZ_TEST: página de pruebas local

  var VERSION = "1.0.0";
  var RE_DETALLE = /\/(obra-nueva|inmueble)\/(\d+)/;

  // ----------------------------------------------------------------- utils
  function log(m) { try { console.log("[idealista-zonas/barrio] " + m); } catch (e) {} }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/^(distrito|barrio|zona|urbanizacion)\s+/, "").replace(/[^a-z0-9/ -]/g, "").trim();
  }
  // "Sagunto/Sagunt" == "Sagunt/Sagunto" == "Sagunto"
  function mismoNombre(a, b) {
    var A = norm(a).split("/").map(function (x) { return x.trim(); }).filter(Boolean);
    var B = norm(b).split("/").map(function (x) { return x.trim(); }).filter(Boolean);
    if (!A.length || !B.length) return false;
    return A.some(function (x) { return B.indexOf(x) !== -1; });
  }
  function fmtN(n, d) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toLocaleString("es-ES", { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0, useGrouping: "always" });
  }
  function fmtE(n) { return n == null || isNaN(n) ? "—" : fmtN(Math.round(n)) + " €"; }
  function fmtP(n, d) { return n == null || isNaN(n) ? "—" : fmtN(n, d == null ? 1 : d) + " %"; }
  function signo(n, d) { return (n > 0 ? "+" : "") + fmtN(n, d == null ? 0 : d); }
  function metros(m) { return m < 1000 ? fmtN(Math.round(m / 10) * 10) + " m" : fmtN(m / 1000, 1) + " km"; }
  // distancia en metros (haversine)
  function dist(a, b, c, d) {
    var R = 6371000, r = Math.PI / 180;
    var x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2);
    var h = x * x + Math.cos(a * r) * Math.cos(c * r) * y * y;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // minutos andando: línea recta × 1,3 (las calles no son rectas) a 80 m/min
  function minAndando(m) { return Math.max(1, Math.round(m * 1.3 / 80)); }

  function lsGet(k, def) {
    try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // caché con caducidad (días)
  function cacheGet(k) {
    var o = lsGet("izb_c:" + k, null);
    if (!o || !o.t || Date.now() - o.t > o.ttl) return null;
    return o.v;
  }
  function cacheSet(k, v, dias) { lsSet("izb_c:" + k, { t: Date.now(), ttl: dias * 864e5, v: v }); }

  function conTimeout(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error("tiempo agotado")); }, ms);
    })]);
  }
  function getJSON(url, opts) {
    return conTimeout(fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }), 30000);
  }
  function getText(url, opts) {
    return conTimeout(fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }), 30000);
  }
  function qs(o) {
    return Object.keys(o).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(o[k]); }).join("&");
  }

  // ------------------------------------------------- datos de la ficha
  function coordenadas() {
    var html = document.documentElement.innerHTML;
    var m = html.match(/center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/) ||
            html.match(/latitude["']?\s*[:=]\s*["']?(-?\d+\.\d+)["']?\s*,\s*["']?longitude["']?\s*[:=]\s*["']?(-?\d+\.\d+)/);
    if (!m) return null;
    var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90) return null;
    return { lat: lat, lng: lng };
  }

  // ["Calle …", "Distrito …", "Sagunto/Sagunt", "Camp de Morvedre, València"]
  function ubicacion() {
    var items = [].slice.call(document.querySelectorAll("#headerMap li"))
      .map(function (li) { return li.textContent.replace(/\s+/g, " ").trim(); })
      .filter(Boolean);
    var ultimo = items.length ? items[items.length - 1] : "";
    var provincia = ultimo.split(",").pop().trim();
    return { items: items, provincia: provincia };
  }

  function numero(t) {
    var n = parseFloat(String(t || "").replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  }

  // precio, m² y unidades (tabla "pisos disponibles en venta" en obra nueva)
  function datosAnuncio() {
    var id = (location.pathname.match(RE_DETALLE) || [])[2];
    var obra = /\/obra-nueva\//.test(location.pathname);
    var titulo = (document.querySelector(".main-info__title-main, h1") || {}).textContent || document.title;
    titulo = titulo.replace(/\s+/g, " ").trim();
    var img = (document.querySelector('meta[property="og:image"]') || {}).content || "";

    var unidades = [];
    document.querySelectorAll(".table__row:not(.izpf-head)").forEach(function (fila) {
      var prop = fila.querySelector(".table__go-to-property");
      if (!prop) return;
      var precio = numero((prop.querySelector("strong") || {}).textContent);
      var txt = fila.textContent.replace(/\s+/g, " ");
      var m2 = numero((txt.match(/(\d+(?:[.,]\d+)?)\s*m²/) || [])[1]);
      var dorm = (txt.match(/(\d+)\s*dorm/) || [])[1];
      var nombre = (prop.textContent.replace(/\s+/g, " ").trim().match(/^[^\d]+/) || [""])[0].trim();
      if (precio) unidades.push({
        nombre: (nombre || "Vivienda") + (dorm ? " · " + dorm + " dorm" : "") + (m2 ? " · " + m2 + " m²" : ""),
        precio: precio, m2: m2, dorm: dorm ? +dorm : null
      });
    });

    var precio = null, m2 = null;
    if (unidades.length) {
      // la más barata representa la promoción
      var min = unidades.slice().sort(function (a, b) { return a.precio - b.precio; })[0];
      precio = min.precio; m2 = min.m2;
    } else {
      precio = numero((document.querySelector(".info-data-price, .info-data .txt-bold") || {}).textContent);
      var feats = (document.querySelector(".info-features") || {}).textContent || "";
      m2 = numero((feats.match(/(\d+(?:[.,]\d+)?)\s*m²/) || [])[1]);
    }
    return { id: id, obra: obra, titulo: titulo, img: img, url: location.origin + location.pathname,
             unidades: unidades, precio: precio, m2: m2 };
  }

  // ===================================================================
  // FUENTES DE DATOS (cada una devuelve una promesa con su resultado)
  // ===================================================================

  // ---- 1) tu clasificación de zonas (zonas.js) ----------------------
  function dentroPoligono(lat, lng, pts) {
    var dentro = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var yi = pts[i][0], xi = pts[i][1], yj = pts[j][0], xj = pts[j][1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) dentro = !dentro;
    }
    return dentro;
  }
  function areaPoligono(pts) {
    var a = 0;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][1] + pts[i][1]) * (pts[j][0] - pts[i][0]);
    return Math.abs(a / 2);
  }
  function zonaPropia(lat, lng) {
    var hits = [];
    (window.IDEALISTA_ZONAS || []).forEach(function (g) {
      (g.zonas || []).forEach(function (z) {
        if (z.tipo === "poligono" && z.puntos && z.puntos.length > 2) {
          if (dentroPoligono(lat, lng, z.puntos)) hits.push({ z: z, area: areaPoligono(z.puntos) });
        } else if (z.tipo === "punto" && z.lat != null) {
          var d = dist(lat, lng, z.lat, z.lng);
          if (d <= (z.radio_km || 1) * 1000) hits.push({ z: z, area: Math.pow((z.radio_km || 1) / 111, 2) * 3.14 });
        }
      });
    });
    hits.sort(function (a, b) { return a.area - b.area; }); // la más pequeña = la más concreta
    return { zonas: hits.map(function (h) { return h.z; }) };
  }

  // ---- 2) inundación: DANA 2024 (huella real) + PATRICOVA ------------
  var WMS_DANA = "https://terramapas.icv.gva.es/00_DANA2024";
  var L_HUELLA = "DANA2024.ZonasInundadas.HuellaInundacion";
  var L_DECRETO = "DANA2024.AVSRE.MunicipiosAfectadosDecreto163";
  var L_RIESGO = "DANA2024.AVSRE.NivelRiesgoMunicipal";
  var PATRI = "https://carto.icv.gva.es/arcgis/rest/services/tm_infraestructuras/ordenacion_territorial/MapServer/identify";

  function gmlCapas(xml) {
    var out = {};
    var re = /<([\w.]+)_layer>([\s\S]*?)<\/\1_layer>/g, m;
    while ((m = re.exec(xml))) {
      var feats = [];
      var rf = /<[\w.]+_feature>([\s\S]*?)<\/[\w.]+_feature>/g, f;
      while ((f = rf.exec(m[2]))) {
        var o = {}, rc = /<(\w+)>([^<]*)<\/\1>/g, c;
        while ((c = rc.exec(f[1]))) o[c[1]] = c[2].replace(/&#39;/g, "'").replace(/&amp;/g, "&");
        feats.push(o);
      }
      out[m[1]] = feats;
    }
    return out;
  }
  function wmsInfo(lat, lng, capas, radioGrados) {
    var d = radioGrados;
    return getText(WMS_DANA + "?" + qs({
      SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetFeatureInfo", LAYERS: capas, QUERY_LAYERS: capas,
      SRS: "EPSG:4326", BBOX: [lng - d, lat - d, lng + d, lat + d].join(","), WIDTH: 101, HEIGHT: 101,
      X: 50, Y: 50, INFO_FORMAT: "application/vnd.ogc.gml", FEATURE_COUNT: 5, STYLES: "", FORMAT: "image/png"
    })).then(gmlCapas);
  }
  // identify de ArcGIS con 1 px ≈ 1 m: tolerance = metros alrededor del punto
  function patricova(lat, lng, toleranciaM) {
    var dLng = 500 / (111320 * Math.cos(lat * Math.PI / 180)), dLat = 500 / 110540;
    return getJSON(PATRI + "?" + qs({
      geometry: lng + "," + lat, geometryType: "esriGeometryPoint", sr: 4326,
      layers: "all:4,5,6,7,8,9,10", tolerance: toleranciaM, returnGeometry: false, f: "json",
      mapExtent: [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(","), imageDisplay: "1000,1000,96"
    })).then(function (d) {
      return (d.results || []).map(function (r) {
        var a = r.attributes || {};
        return {
          nivel: r.layerId === 10 ? 7 : r.layerId - 3,  // 4→1 … 9→6, 10 = geomorfológica
          desc: a.d_pelig || a.D_PELIG || r.layerName, zona: a.zona || a.ZONA || "",
          corriente: a.corriente || a.CORRIENTE || ""
        };
      }).sort(function (a, b) { return a.nivel - b.nivel; });
    });
  }
  function inundacion(lat, lng) {
    var k = "inund:" + lat.toFixed(5) + "," + lng.toFixed(5);
    var c = cacheGet(k);
    if (c) return Promise.resolve(c);
    var capas = [L_HUELLA, L_DECRETO, L_RIESGO].join(",");
    return Promise.all([
      wmsInfo(lat, lng, capas, 0.0005).catch(function () { return null; }),
      wmsInfo(lat, lng, L_HUELLA, 0.03).catch(function () { return null; }),   // ~200 m alrededor
      patricova(lat, lng, 0).catch(function () { return null; }),
      patricova(lat, lng, 250).catch(function () { return null; })
    ]).then(function (r) {
      var exacto = r[0] || {}, cerca = r[1] || {};
      if (!r[0] && !r[2]) throw new Error("sin respuesta de la Generalitat");
      var res = {
        danaDentro: !!(exacto[L_HUELLA] && exacto[L_HUELLA].length),
        danaDesc: exacto[L_HUELLA] && exacto[L_HUELLA][0] ? exacto[L_HUELLA][0].descripcion : "",
        danaCerca: !!(cerca[L_HUELLA] && cerca[L_HUELLA].length),
        decreto: !!(exacto[L_DECRETO] && exacto[L_DECRETO].length),
        riesgoMun: exacto[L_RIESGO] && exacto[L_RIESGO][0] ? exacto[L_RIESGO][0] : null,
        patri: r[2] || [], patriCerca: r[3] || [],
        okDana: !!r[0], okPatri: !!r[2]
      };
      cacheSet(k, res, 30);
      return res;
    });
  }

  // ---- 3) renta y perfil (INE, Atlas de Distribución de Renta 2023) --
  var INE = "https://www.ine.es/servergis/rest/services/Hosted/";
  var INE_RENTA = INE + "ADRH_2023_Renta_media_por_persona/FeatureServer/";
  var INE_TUR = INE + encodeURIComponent("Porcentaje_de_viviendas_turísticas_sobre_el_total_de_viviendas_2026M05") + "/FeatureServer/3/query";
  function ineContar(where) {
    return getJSON(INE_RENTA + "3/query?" + qs({ where: where, returnCountOnly: true, f: "json" }))
      .then(function (d) { return d.count; });
  }
  function renta(lat, lng) {
    var k = "renta:" + lat.toFixed(4) + "," + lng.toFixed(4);
    var c = cacheGet(k);
    if (c) return Promise.resolve(c);
    var punto = { geometry: lng + "," + lat, geometryType: "esriGeometryPoint", inSR: 4326,
                  spatialRel: "esriSpatialRelIntersects", returnGeometry: false, f: "json" };
    var p = {}; for (var x in punto) p[x] = punto[x];
    p.outFields = "cusec,nmun,cumun,cpro,npro,dato1,dato2,dato4,dato5,dato7,dato8,dato9";
    return getJSON(INE_RENTA + "3/query?" + qs(p)).then(function (d) {
      var s = d.features && d.features[0] && d.features[0].attributes;
      if (!s) throw new Error("sin sección censal en ese punto");
      var t = {}; for (var y in punto) t[y] = punto[y];
      t.outFields = "porcentaje_vivienda_turistica,vivienda_turistica";
      var r1 = s.dato1 || 0;
      return Promise.all([
        getJSON(INE_RENTA + "1/query?" + qs({ where: "cumun='" + s.cumun + "'", outFields: "dato1,dato2,dato4,dato7,dato8,dato9", returnGeometry: false, f: "json" }))
          .then(function (m) { return m.features && m.features[0] ? m.features[0].attributes : null; }).catch(function () { return null; }),
        r1 ? ineContar("cpro='" + s.cpro + "' AND dato1 > 0") : null,
        r1 ? ineContar("cpro='" + s.cpro + "' AND dato1 < " + r1) : null,
        r1 ? ineContar("cumun='" + s.cumun + "' AND dato1 > 0") : null,
        r1 ? ineContar("cumun='" + s.cumun + "' AND dato1 < " + r1) : null,
        getJSON(INE_TUR + "?" + qs(t)).then(function (q) {
          return q.features && q.features[0] ? q.features[0].attributes : null;
        }).catch(function () { return null; })
      ]).then(function (r) {
        var res = {
          cusec: s.cusec, municipio: s.nmun, provincia: s.npro,
          rentaPersona: s.dato1, rentaHogar: s.dato2, bajaRenta: s.dato4, altaRenta: s.dato5,
          menores: s.dato7, mayores: s.dato8, gini: s.dato9,
          mun: r[0],
          pctProv: r[1] ? Math.round(100 * r[2] / r[1]) : null,
          pctMun: r[3] ? Math.round(100 * r[4] / r[3]) : null,
          nSecMun: r[3],
          turisticas: r[5] ? r[5].porcentaje_vivienda_turistica : null,
          nTuristicas: r[5] ? r[5].vivienda_turistica : null
        };
        cacheSet(k, res, 60);
        return res;
      });
    });
  }

  // ---- 4) precio €/m² de la zona (informes de idealista) -------------
  var INF = "/sala-de-prensa/informes-precio-vivienda/";
  function eurM2(t) {
    var m = String(t || "").match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*€/);
    return m ? parseFloat(m[1].replace(/\./g, "").replace(",", ".")) : null;
  }
  function parsearInforme(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var tablas = doc.querySelectorAll("table");
    var filas = [], historia = [];
    if (tablas[0]) {
      tablas[0].querySelectorAll("tbody tr, tr").forEach(function (tr) {
        var td = tr.querySelectorAll("td");
        if (td.length < 4) return;
        var a = td[0].querySelector("a");
        filas.push({
          nombre: td[0].textContent.replace(/\s+/g, " ").trim(),
          url: a ? a.getAttribute("href").replace(/^https?:\/\/[^/]+/, "") : null,
          m2: eurM2(td[1].textContent),
          varAnual: parseFloat((td[4] ? td[4].textContent : "").replace(/\s/g, "").replace(",", ".")) || null
        });
      });
    }
    if (tablas[1]) {
      tablas[1].querySelectorAll("tr").forEach(function (tr) {
        var td = tr.querySelectorAll("td");
        if (td.length < 2) return;
        var v = eurM2(td[1].textContent);
        if (v) historia.push({ mes: td[0].textContent.trim(), m2: v });
      });
    }
    var titulo = (doc.querySelector("h1") || {}).textContent || "";
    return { filas: filas, historia: historia.reverse(), titulo: titulo.trim() };
  }
  // provincia → comunidad (slug de los informes de idealista). Así solo se
  // pide UNA página de comunidad, en vez de rastrearlas todas (el antibots de
  // idealista se activa si se hacen muchas peticiones seguidas)
  var CCAA_PROV = {
    "andalucia": ["almeria", "cadiz", "cordoba", "granada", "huelva", "jaen", "malaga", "sevilla"],
    "aragon": ["huesca", "teruel", "zaragoza"], "asturias": ["asturias"], "baleares": ["baleares", "illes balears", "balears"],
    "canarias": ["las palmas", "santa cruz de tenerife", "tenerife"], "cantabria": ["cantabria"],
    "castilla-y-leon": ["avila", "burgos", "leon", "palencia", "salamanca", "segovia", "soria", "valladolid", "zamora"],
    "castilla-la-mancha": ["albacete", "ciudad real", "cuenca", "guadalajara", "toledo"],
    "cataluna": ["barcelona", "girona", "lleida", "tarragona"],
    "comunitat-valenciana": ["alicante", "alacant", "castellon", "castello", "valencia"],
    "euskadi": ["alava", "araba", "gipuzkoa", "guipuzcoa", "bizkaia", "vizcaya"],
    "extremadura": ["badajoz", "caceres"], "galicia": ["a coruna", "coruna", "lugo", "ourense", "pontevedra"],
    "la-rioja": ["la rioja", "rioja"], "madrid-comunidad": ["madrid"], "murcia-region": ["murcia"],
    "navarra": ["navarra"], "ceuta": ["ceuta"], "melilla": ["melilla"]
  };
  function urlProvincia(provincia) {
    var ccaa = null;
    for (var k in CCAA_PROV) {
      if (CCAA_PROV[k].some(function (p) { return mismoNombre(p, provincia); })) { ccaa = k; break; }
    }
    if (!ccaa) return Promise.reject(new Error("provincia no reconocida (" + provincia + ")"));
    var base = INF + "venta/" + ccaa + "/";
    if (CCAA_PROV[ccaa].length === 1 || ccaa === "asturias" || ccaa === "cantabria") return Promise.resolve(base);
    var ck = "prov:" + ccaa + ":" + norm(provincia);
    var c = cacheGet(ck);
    if (c) return Promise.resolve(c);
    return getText(base).then(function (h) {
      var d = new DOMParser().parseFromString(h, "text/html");
      var url = null;
      d.querySelectorAll("a").forEach(function (a) {
        var href = (a.getAttribute("href") || "").replace(/^https?:\/\/[^/]+/, "");
        if (!url && href.indexOf(base) === 0 && /-provincia\/$/.test(href) && mismoNombre(a.textContent, provincia)) url = href;
      });
      if (!url) throw new Error("provincia no encontrada en los informes (" + provincia + ")");
      cacheSet(ck, url, 180);
      return url;
    });
  }
  function buscarEnFilas(filas, items, excluir) {
    for (var i = 0; i < items.length; i++) {
      for (var j = 0; j < filas.length; j++) {
        var f = filas[j];
        if (!f.url || f.url === excluir) continue;
        if (mismoNombre(f.nombre, items[i])) return f;
      }
    }
    return null;
  }
  function precioZona(ub) {
    var k = "precio:" + norm(ub.items.slice(1).join("|"));
    var c = cacheGet(k);
    if (c) return Promise.resolve(c);
    return urlProvincia(ub.provincia).then(function (provUrl) {
      // de lo general a lo concreto: provincia → municipio → distrito → barrio
      var items = ub.items.slice(0, -1).reverse(); // municipio primero
      var niveles = [];
      function bajar(url, profundidad) {
        return getText(url).then(function (h) {
          var inf = parsearInforme(h);
          if (profundidad > 0 && inf.filas[0]) {
            niveles.push({ nombre: inf.filas[0].nombre, m2: inf.filas[0].m2, varAnual: inf.filas[0].varAnual,
                           url: url, historia: inf.historia });
          }
          if (profundidad >= 3) return;
          var sig = buscarEnFilas(inf.filas.slice(profundidad > 0 ? 1 : 0), items, url);
          if (sig) return bajar(sig.url, profundidad + 1);
        });
      }
      return bajar(provUrl, 0).then(function () {
        if (!niveles.length) throw new Error("municipio no encontrado en los informes de idealista");
        var mas = niveles[niveles.length - 1];
        // alquiler en el mismo nivel (o el municipio si no hay)
        function alquiler(i) {
          if (i < 0) return Promise.resolve(null);
          return getText(niveles[i].url.replace("/venta/", "/alquiler/")).then(function (h) {
            var inf = parsearInforme(h);
            return inf.filas[0] && inf.filas[0].m2 ? { nombre: inf.filas[0].nombre, m2: inf.filas[0].m2 } : alquiler(i - 1);
          }).catch(function () { return alquiler(i - 1); });
        }
        return alquiler(niveles.length - 1).then(function (alq) {
          var res = { niveles: niveles, zona: mas, alquiler: alq };
          cacheSet(k, res, 7);
          return res;
        });
      });
    });
  }

  // ---- 5) servicios a pie (OpenStreetMap / Overpass) -----------------
  // los Overpass públicos se saturan a ratos: se prueban en orden
  var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
                  "https://overpass.private.coffee/api/interpreter"];
  var CATS = [
    { k: "super", t: "Supermercado", ico: "🛒", esencial: true, ok: 6, med: 12 },
    { k: "mercadona", t: "Mercadona", ico: "🟢", ok: 8, med: 15 },
    { k: "farmacia", t: "Farmacia", ico: "💊", esencial: true, ok: 6, med: 12 },
    { k: "salud", t: "Centro de salud", ico: "🩺", esencial: true, ok: 10, med: 20 },
    { k: "colegio", t: "Colegio / instituto", ico: "🏫", esencial: true, ok: 10, med: 18 },
    { k: "guarderia", t: "Guardería", ico: "🧸", ok: 10, med: 18 },
    { k: "parque", t: "Parque / zona infantil", ico: "🌳", esencial: true, ok: 5, med: 10 },
    { k: "bus", t: "Parada de bus", ico: "🚌", ok: 5, med: 10 },
    { k: "tren", t: "Metro / tren / tranvía", ico: "🚆", ok: 10, med: 20 },
    { k: "playa", t: "Playa", ico: "🏖️", ok: 15, med: 30 },
    { k: "hospital", t: "Hospital", ico: "🏥", coche: true }
  ];
  function categoria(tg) {
    var c = [];
    if (tg.shop === "supermarket") {
      c.push("super");
      if (/mercadona/i.test((tg.brand || "") + " " + (tg.name || ""))) c.push("mercadona");
    }
    if (tg.amenity === "pharmacy") c.push("farmacia");
    if (/^(clinic|doctors)$/.test(tg.amenity || "") || /^(centre|clinic|doctor)$/.test(tg.healthcare || "")) c.push("salud");
    if (tg.amenity === "hospital") c.push("hospital");
    if (tg.amenity === "school") c.push("colegio");
    if (/^(kindergarten|childcare)$/.test(tg.amenity || "")) c.push("guarderia");
    if (/^(park|playground|garden)$/.test(tg.leisure || "")) c.push("parque");
    if (tg.highway === "bus_stop") c.push("bus");
    if (/^(station|halt|tram_stop)$/.test(tg.railway || "")) c.push("tren");
    if (tg.natural === "beach") c.push("playa");
    return c;
  }
  function nombreTren(tg) {
    var tipo = tg.railway === "tram_stop" ? "Tranvía" :
      /subway|light_rail/.test(tg.station || "") || /metrovalencia|metro/i.test((tg.network || "") + (tg.operator || "")) ? "Metro" :
      /renfe|cercan|adif/i.test((tg.network || "") + (tg.operator || "")) ? "Cercanías" : "Tren";
    return tipo + (tg.name ? " · " + tg.name : "");
  }
  // dataset LOCAL (herramientas/generar_servicios.py → servicios/*.json):
  // instantáneo y sin depender de Overpass. puente.js nos deja la URL base.
  var indiceLocal = null;
  function serviciosLocal(lat, lng) {
    var base = document.documentElement.getAttribute("data-izext") || window.__IZ_TEST_EXT;
    if (!base) return Promise.reject(new Error("sin dataset local"));
    indiceLocal = indiceLocal || getJSON(base + "servicios/indice.json");
    return indiceLocal.then(function (idx) {
      var reg = idx.filter(function (x) {
        return lat >= x.bbox[0] && lat <= x.bbox[2] && lng >= x.bbox[1] && lng <= x.bbox[3];
      })[0];
      if (!reg) throw new Error("fuera de las regiones descargadas");
      return getJSON(base + "servicios/" + reg.region + ".json");
    }).then(function (d) {
      var mejor = {}, cuenta = {}, ocio = 0, ocio1k = 0;
      function ver(cat, f) {
        if (Math.abs(f[0] - lat) > 0.25 || Math.abs(f[1] - lng) > 0.3) return; // descarte rápido (~25 km)
        var m = dist(lat, lng, f[0], f[1]);
        if (cat === "ocio") { if (m <= 500) ocio++; if (m <= 1000) ocio1k++; return; }
        if (m <= 800) cuenta[cat] = (cuenta[cat] || 0) + 1;
        if (!mejor[cat] || m < mejor[cat].m) mejor[cat] = { m: m, lat: f[0], lng: f[1], nombre: f[2] || "" };
      }
      Object.keys(d.cats).forEach(function (cat) {
        d.cats[cat].forEach(function (f) {
          ver(cat, f);
          if (cat === "super" && /mercadona/i.test(f[2] || "")) ver("mercadona", f);
        });
      });
      return { mejor: mejor, cuenta: cuenta, ocio: ocio, ocio1k: ocio1k, fuente: "OpenStreetMap (copia local " + d.fecha + ")" };
    });
  }
  function servicios(lat, lng) {
    return serviciosLocal(lat, lng).catch(function (e) {
      log("servicios locales: " + e.message + " → Overpass");
      return serviciosOverpass(lat, lng);
    });
  }
  function serviciosOverpass(lat, lng) {
    var k = "osm:" + lat.toFixed(4) + "," + lng.toFixed(4);
    var c = cacheGet(k);
    if (c) return Promise.resolve(c);
    var P = lat + "," + lng;
    var q = "[out:json][timeout:30];(" +
      "nwr(around:1500," + P + ")[shop=supermarket];" +
      "nwr(around:5000," + P + ")[shop=supermarket][~\"^(brand|name)$\"~\"mercadona\",i];" +
      "nwr(around:1500," + P + ")[amenity=pharmacy];" +
      "nwr(around:3000," + P + ")[amenity~\"^(clinic|doctors)$\"];" +
      "nwr(around:3000," + P + ")[healthcare~\"^(centre|clinic|doctor)$\"];" +
      "nwr(around:15000," + P + ")[amenity=hospital];" +
      "nwr(around:2000," + P + ")[amenity=school];" +
      "nwr(around:2000," + P + ")[amenity~\"^(kindergarten|childcare)$\"];" +
      "nwr(around:1200," + P + ")[leisure~\"^(park|playground|garden)$\"];" +
      "node(around:800," + P + ")[highway=bus_stop];" +
      "nwr(around:5000," + P + ")[railway~\"^(station|halt|tram_stop)$\"];" +
      "nwr(around:10000," + P + ")[natural=beach];" +
      ");out center tags 600;" +
      "nwr(around:500," + P + ")[amenity~\"^(restaurant|cafe|bar|pub|fast_food)$\"];out count;";
    function intento(i) {
      // POST form-urlencoded: petición "simple" (sin preflight CORS)
      return getJSON(OVERPASS[i], { method: "POST", body: "data=" + encodeURIComponent(q),
        headers: { "Content-Type": "application/x-www-form-urlencoded" } })
        .catch(function (e) { if (i + 1 < OVERPASS.length) return intento(i + 1); throw e; });
    }
    return intento(0).catch(function () {
      // segundo intento pasado un rato (suelen ser picos de carga)
      return new Promise(function (ok) { setTimeout(ok, 12000); }).then(function () { return intento(0); });
    }).then(function (d) {
      var mejor = {}, cuenta = {}, ocio = null;
      (d.elements || []).forEach(function (el) {
        if (el.type === "count") { ocio = +(el.tags && el.tags.total) || 0; return; }
        var la = el.lat != null ? el.lat : el.center && el.center.lat;
        var lo = el.lon != null ? el.lon : el.center && el.center.lon;
        if (la == null) return;
        var tg = el.tags || {};
        var m = dist(lat, lng, la, lo);
        categoria(tg).forEach(function (cat) {
          if (m <= 800) cuenta[cat] = (cuenta[cat] || 0) + 1;
          if (!mejor[cat] || m < mejor[cat].m) {
            mejor[cat] = { m: m, lat: la, lng: lo,
              nombre: cat === "tren" ? nombreTren(tg) : (tg.name || tg.brand || "") };
          }
        });
      });
      var res = { mejor: mejor, cuenta: cuenta, ocio: ocio };
      cacheSet(k, res, 30);
      return res;
    });
  }

  // ---- 6) en coche (OSRM, sin tráfico) -------------------------------
  var LS_DEST = "izb_destinos";
  var DEST_DEF = [
    { n: "València centro (Ayuntamiento)", lat: 39.4697, lng: -0.3774, principal: true },
    { n: "Aeropuerto de València", lat: 39.4893, lng: -0.4816 },
    { n: "Estación AVE Joaquín Sorolla", lat: 39.4594, lng: -0.3829 }
  ];
  function destinos() { return lsGet(LS_DEST, null) || DEST_DEF.slice(); }
  function coche(lat, lng, extra) {
    var ds = destinos().concat(extra || []);
    var cerca = ds.filter(function (d) { return dist(lat, lng, d.lat, d.lng) < 250000; });
    if (!cerca.length) return Promise.resolve({ rutas: [] });
    var k = "osrm:" + lat.toFixed(4) + "," + lng.toFixed(4) + ":" +
      cerca.map(function (d) { return d.lat.toFixed(4) + "," + d.lng.toFixed(4); }).join(";");
    var c = cacheGet(k);
    var prom = c ? Promise.resolve(c) : getJSON("https://router.project-osrm.org/table/v1/driving/" +
      [lng + "," + lat].concat(cerca.map(function (d) { return d.lng + "," + d.lat; })).join(";") +
      "?sources=0&annotations=duration,distance").then(function (r) {
        if (r.code !== "Ok") throw new Error("OSRM: " + r.code);
        var v = { dur: r.durations[0].slice(1), km: r.distances[0].slice(1) };
        cacheSet(k, v, 60);
        return v;
      });
    return prom.then(function (v) {
      return { rutas: cerca.map(function (d, i) {
        return { n: d.n, principal: !!d.principal, auto: !!d.auto, propio: !!d.propio,
                 min: v.dur[i] != null ? Math.round(v.dur[i] / 60) : null,
                 km: v.km[i] != null ? v.km[i] / 1000 : null };
      }) };
    });
  }
  function geocodificar(txt) {
    return getJSON("https://nominatim.openstreetmap.org/search?" +
      qs({ q: txt, format: "json", limit: 1, countrycodes: "es" }))
      .then(function (r) {
        if (!r || !r[0]) throw new Error("no encuentro esa dirección");
        return { lat: +r[0].lat, lng: +r[0].lon, nombre: r[0].display_name };
      });
  }

  // ===================================================================
  // PUNTUACIÓN
  // ===================================================================
  var PESOS = { zona: 2, inund: 2, renta: 1, servicios: 1.5, coche: 1.5, precio: 1, esfuerzo: 1 };
  var NOMBRES = { zona: "Tu zona", inund: "Inundación", renta: "Renta del barrio", servicios: "Servicios a pie",
                  coche: "Conexión", precio: "Precio vs zona", esfuerzo: "Esfuerzo financiero" };

  function notaZona(z) {
    if (!z || !z.zonas.length) return null;
    return { bien: 9, regular: 6, duda: 5, mal: 2, muy_mal: 0 }[z.zonas[0].veredicto];
  }
  function notaInund(r) {
    if (!r) return null;
    if (r.danaDentro) return 1;
    var p = r.patri[0] && r.patri[0].nivel;
    if (p && p <= 2) return 1;
    if (p && p <= 4) return 3;
    if (p) return 5;
    if (r.danaCerca || r.patriCerca.length) return 6;
    if (r.decreto) return 8;
    return 10;
  }
  function notaRenta(r) {
    if (!r || r.pctProv == null) return null;
    return Math.max(1, Math.min(10, Math.round(r.pctProv / 10)));
  }
  function esencialesCerca(s) {
    if (!s) return null;
    var n = 0, tot = 0;
    CATS.forEach(function (c) {
      if (!c.esencial) return;
      tot++;
      var b = s.mejor[c.k];
      if (b && minAndando(b.m) <= 10) n++;
    });
    // transporte público: bus a ≤ 6 min o tren/metro a ≤ 15 min
    tot++;
    var bus = s.mejor.bus, tren = s.mejor.tren;
    if ((bus && minAndando(bus.m) <= 6) || (tren && minAndando(tren.m) <= 15)) n++;
    return { n: n, tot: tot };
  }
  function notaServicios(s) {
    var e = esencialesCerca(s);
    return e ? Math.round(10 * e.n / e.tot) : null;
  }
  function rutaPrincipal(c) {
    if (!c || !c.rutas.length) return null;
    return c.rutas.filter(function (r) { return r.principal; })[0] || c.rutas[0];
  }
  function notaCoche(c) {
    var r = rutaPrincipal(c);
    if (!r || r.min == null) return null;
    return r.min <= 15 ? 10 : r.min <= 25 ? 8 : r.min <= 35 ? 6 : r.min <= 50 ? 4 : 2;
  }
  // €/m² del anuncio frente a la zona; en obra nueva se descuenta un 10 %
  // de prima "normal" (los informes mezclan obra nueva y segunda mano)
  function difPrecio(an, pz) {
    if (!an || !an.precio || !an.m2 || !pz || !pz.zona || !pz.zona.m2) return null;
    var m2 = an.precio / an.m2;
    return { m2: m2, dif: 100 * (m2 / pz.zona.m2 - 1) };
  }
  function notaPrecio(an, pz) {
    var d = difPrecio(an, pz);
    if (!d) return null;
    var x = d.dif - (an.obra ? 10 : 0);
    return x <= -10 ? 10 : x <= 0 ? 8 : x <= 10 ? 6 : x <= 20 ? 4 : 2;
  }
  function finanzas(an) {
    var pf = window.__izpf;
    if (!pf || !an || !an.precio) return null;
    return pf.calcular(an.precio, pf.cfg(), an.obra);
  }
  function notaEsfuerzo(an) {
    var f = finanzas(an);
    if (!f || f.endeudamiento == null) return null;
    var e = f.endeudamiento;
    return e <= 25 ? 10 : e <= 30 ? 8 : e <= 35 ? 5 : e <= 40 ? 3 : 1;
  }

  function puntuar(S) {
    var notas = {
      zona: notaZona(S.zona), inund: notaInund(S.inund), renta: notaRenta(S.renta),
      servicios: notaServicios(S.servicios), coche: notaCoche(S.coche),
      precio: notaPrecio(S.anuncio, S.precio), esfuerzo: notaEsfuerzo(S.anuncio)
    };
    var suma = 0, peso = 0, n = 0;
    for (var k in notas) {
      if (notas[k] == null) continue;
      suma += notas[k] * PESOS[k]; peso += PESOS[k]; n++;
    }
    var total = peso ? suma / peso : null;
    // la DANA es eliminatoria: el resto no compensa que se haya inundado
    if (S.inund && S.inund.danaDentro && total != null) total = Math.min(total, 3.5);
    return { notas: notas, total: total, n: n };
  }
  function etiquetaTotal(t, S) {
    if (t == null) return ["Calculando…", "neutro"];
    if (S.inund && S.inund.danaDentro) return ["Se inundó en la DANA 2024", "mal"];
    if (t >= 8) return ["Muy buena candidata", "bien"];
    if (t >= 6.5) return ["Buena candidata", "bien"];
    if (t >= 5) return ["Con pegas: mírala con calma", "aviso"];
    return ["Mejor descartar", "mal"];
  }
  function claseNota(n) { return n == null ? "neutro" : n >= 7 ? "bien" : n >= 5 ? "aviso" : "mal"; }

  // frases del resumen (a favor / a vigilar)
  function resumen(S, P) {
    var pro = [], contra = [];
    var z = S.zona && S.zona.zonas[0];
    if (z) {
      if (z.veredicto === "bien") pro.push("Está en una zona que marcaste en verde (" + z.nombre + ")");
      else if (z.veredicto === "mal" || z.veredicto === "muy_mal") contra.push("Está en una zona que marcaste en rojo (" + z.nombre + ")");
      else if (z.veredicto === "regular") contra.push("Zona normal / en transición según tu clasificación (" + z.nombre + ")");
    }
    var I = S.inund;
    if (I) {
      if (I.danaDentro) contra.push("La calle se inundó en la DANA del 29-oct-2024");
      else if (I.danaCerca) contra.push("Hubo inundación de la DANA 2024 a menos de ~200 m");
      if (I.patri[0]) contra.push("Zona inundable PATRICOVA nivel " + (I.patri[0].nivel === 7 ? "geomorfológico" : I.patri[0].nivel));
      else if (I.patriCerca[0] && !I.danaDentro) contra.push("Zona inundable PATRICOVA a menos de 250 m");
      if (!I.danaDentro && !I.danaCerca && !I.patri.length && !I.patriCerca.length) pro.push("Fuera de zonas inundables y de la huella de la DANA 2024");
    }
    var R = S.renta;
    if (R && R.pctProv != null) {
      if (R.pctProv >= 65) pro.push("Barrio de renta alta para la provincia (más que el " + R.pctProv + " % de las secciones)");
      else if (R.pctProv <= 30) contra.push("Barrio de renta baja para la provincia (percentil " + R.pctProv + ")");
    }
    var e = esencialesCerca(S.servicios);
    if (e) {
      if (e.n >= e.tot - 1) pro.push("Casi todo a ≤ 10 min andando (" + e.n + "/" + e.tot + " esenciales)");
      else if (e.n <= Math.floor(e.tot / 2)) contra.push("Pocos servicios a pie (" + e.n + "/" + e.tot + " esenciales a ≤ 10 min): coche para casi todo");
    }
    var rp = rutaPrincipal(S.coche);
    if (rp && rp.min != null) {
      if (rp.min <= 20) pro.push(rp.min + " min en coche a " + rp.n + " (sin tráfico)");
      else if (rp.min > 35) contra.push(rp.min + " min en coche a " + rp.n + " (sin tráfico; en hora punta, más)");
    }
    var d = difPrecio(S.anuncio, S.precio);
    if (d) {
      var x = d.dif - (S.anuncio.obra ? 10 : 0);
      if (x <= -5) pro.push(S.anuncio.obra && d.dif > -5
        ? "€/m² en línea con la zona para ser obra nueva (" + signo(d.dif) + " % sobre la media)"
        : "Precio por m² por debajo de la media de la zona (" + signo(d.dif) + " %)");
      else if (x >= 15) contra.push("Caro para la zona: " + fmtN(d.m2) + " €/m² (" + signo(d.dif) + " % sobre la media)");
    }
    if (S.precio && S.precio.zona && S.precio.zona.varAnual != null && S.precio.zona.varAnual >= 15) {
      contra.push("Precios subiendo rápido en la zona (" + signo(S.precio.zona.varAnual, 1) + " % en un año)");
    }
    var f = finanzas(S.anuncio);
    if (f && f.endeudamiento != null) {
      if (f.endeudamiento <= 30) pro.push("Cuota asumible: " + fmtP(f.endeudamiento) + " de vuestro neto");
      else if (f.endeudamiento > 35) contra.push("Esfuerzo alto: la cuota se come el " + fmtP(f.endeudamiento) + " del neto");
    }
    if (R && R.turisticas >= 5) contra.push("Muchos pisos turísticos en la sección (" + fmtP(R.turisticas) + ")");
    return { pro: pro, contra: contra };
  }

  // ===================================================================
  // ESTILOS
  // ===================================================================
  var CSS = [
    ".izb{margin:16px 0 !important;font-family:inherit !important;color:#141414 !important;text-align:left !important;}",
    ".izb *{box-sizing:border-box !important;font-family:inherit !important;}",
    ".izb .izb-bar{display:flex !important;align-items:center !important;gap:10px !important;background:#6f6f6d !important;color:#fff !important;padding:6px 16px !important;font-weight:700 !important;font-size:16px !important;}",
    ".izb .izb-bar .t{flex:1 !important;}",
    ".izb .izb-bar small{font-weight:400 !important;opacity:.8 !important;font-size:12px !important;}",
    ".izb button.izb-b{all:unset;cursor:pointer !important;font-size:13px !important;font-weight:600 !important;padding:4px 10px !important;border-radius:4px !important;background:rgba(255,255,255,.14) !important;color:#fff !important;white-space:nowrap !important;}",
    ".izb button.izb-b:hover{background:rgba(255,255,255,.26) !important;}",
    ".izb button.izb-b.on{background:#fde047 !important;color:#422006 !important;}",
    // cabecera: nota + resumen
    ".izb .izb-top{display:grid !important;grid-template-columns:170px 1fr !important;gap:20px !important;padding:18px 16px 8px !important;align-items:start !important;}",
    ".izb .izb-nota{text-align:center !important;}",
    ".izb .izb-nota svg{display:block !important;margin:0 auto !important;}",
    ".izb .izb-nota .lab{margin-top:6px !important;font-weight:700 !important;font-size:14px !important;line-height:1.25 !important;}",
    ".izb .izb-nota .sub{font-size:12px !important;color:#6b7280 !important;margin-top:2px !important;}",
    ".izb .izb-res h3{margin:0 0 6px !important;padding:0 !important;font-size:15px !important;font-weight:700 !important;color:#141414 !important;}",
    ".izb .izb-res .dir{font-size:13px !important;color:#6b7280 !important;margin:0 0 10px !important;}",
    ".izb .izb-res ul{list-style:none !important;margin:0 0 8px !important;padding:0 !important;}",
    ".izb .izb-res li{position:relative !important;padding:2px 0 2px 22px !important;font-size:14px !important;line-height:1.4 !important;margin:0 !important;list-style:none !important;}",
    ".izb .izb-res li::before{position:absolute !important;left:0 !important;top:2px !important;font-weight:700 !important;}",
    ".izb .izb-res li.p::before{content:'✓' !important;color:#15803d !important;}",
    ".izb .izb-res li.c::before{content:'!' !important;color:#fff !important;background:#d97706 !important;border-radius:50% !important;width:15px !important;height:15px !important;font-size:11px !important;text-align:center !important;line-height:15px !important;top:4px !important;}",
    ".izb .izb-res li.c.grave::before{background:#dc2626 !important;}",
    // tiles
    ".izb .izb-tiles{display:grid !important;grid-template-columns:repeat(4,1fr) !important;gap:8px !important;padding:8px 16px 0 !important;}",
    "@media (max-width:760px){.izb .izb-tiles{grid-template-columns:repeat(2,1fr) !important;}.izb .izb-top{grid-template-columns:1fr !important;}}",
    ".izb .izb-tile{all:unset;display:block !important;cursor:pointer !important;border:1px solid #e5e6e1 !important;border-left:4px solid #9ca3af !important;border-radius:4px !important;padding:8px 10px !important;background:#fff !important;min-height:74px !important;transition:background .12s,box-shadow .12s !important;}",
    ".izb .izb-tile:hover{background:#f9fafb !important;box-shadow:0 1px 4px rgba(0,0,0,.08) !important;}",
    ".izb .izb-tile.sel{background:#f3f4f6 !important;box-shadow:inset 0 0 0 1px #9ca3af !important;}",
    ".izb .izb-tile .l{display:flex !important;justify-content:space-between !important;gap:4px !important;font-size:11px !important;white-space:nowrap !important;color:#6b7280 !important;font-weight:600 !important;text-transform:uppercase !important;letter-spacing:.02em !important;}",
    ".izb .izb-tile .n{font-size:11px !important;font-weight:700 !important;padding:0 5px !important;border-radius:8px !important;background:#f3f4f6 !important;color:#374151 !important;text-transform:none !important;}",
    ".izb .izb-tile .v{display:block !important;font-size:16px !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;font-weight:700 !important;margin-top:3px !important;line-height:1.2 !important;color:#141414 !important;}",
    ".izb .izb-tile .s{display:block !important;font-size:12px !important;color:#6b7280 !important;margin-top:2px !important;line-height:1.3 !important;}",
    ".izb .bien{border-left-color:#16a34a !important;}.izb .aviso{border-left-color:#d97706 !important;}.izb .mal{border-left-color:#dc2626 !important;}",
    ".izb .izb-tile.bien .n{background:#dcfce7 !important;color:#166534 !important;}",
    ".izb .izb-tile.aviso .n{background:#fef3c7 !important;color:#92400e !important;}",
    ".izb .izb-tile.mal .n{background:#fee2e2 !important;color:#991b1b !important;}",
    ".izb .cargando .v{color:transparent !important;background:linear-gradient(90deg,#f3f4f6,#e5e7eb,#f3f4f6) !important;background-size:200% 100% !important;animation:izbsh 1.2s infinite !important;border-radius:4px !important;width:70% !important;}",
    "@keyframes izbsh{0%{background-position:200% 0}100%{background-position:-200% 0}}",
    // panel de detalle
    ".izb .izb-pane{margin:8px 16px 0 !important;border:1px solid #e5e6e1 !important;border-radius:4px !important;padding:14px 16px !important;background:#fcfcfb !important;font-size:14px !important;line-height:1.45 !important;}",
    ".izb .izb-pane[hidden]{display:none !important;}",
    ".izb .izb-pane h4{margin:0 0 10px !important;padding:0 !important;font-size:15px !important;font-weight:700 !important;color:#141414 !important;}",
    ".izb .izb-pane p{margin:6px 0 !important;font-size:14px !important;}",
    ".izb .izb-pane .muted, .izb .muted{color:#6b7280 !important;font-size:12.5px !important;}",
    ".izb .izb-pane a{color:#145bc7 !important;text-decoration:none !important;}",
    ".izb .izb-pane a:hover{text-decoration:underline !important;}",
    ".izb .izb-rows{display:grid !important;gap:6px !important;}",
    ".izb .izb-row{display:grid !important;grid-template-columns:26px 1fr auto !important;gap:8px !important;align-items:center !important;padding:6px 8px !important;background:#fff !important;border:1px solid #eeefeb !important;border-radius:4px !important;}",
    ".izb .izb-row .i{font-size:17px !important;text-align:center !important;}",
    ".izb .izb-row .d{min-width:0 !important;}",
    ".izb .izb-row .d b{display:block !important;font-size:14px !important;font-weight:600 !important;}",
    ".izb .izb-row .d span{display:block !important;font-size:12.5px !important;color:#6b7280 !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;}",
    ".izb .izb-row .r{text-align:right !important;font-weight:700 !important;font-size:14px !important;white-space:nowrap !important;}",
    ".izb .izb-row .r small{display:block !important;font-weight:400 !important;color:#6b7280 !important;font-size:12px !important;}",
    ".izb .pill{display:inline-block !important;font-size:12px !important;font-weight:700 !important;padding:1px 8px !important;border-radius:10px !important;}",
    ".izb .pill.bien{background:#dcfce7 !important;color:#166534 !important;}",
    ".izb .pill.aviso{background:#fef3c7 !important;color:#92400e !important;}",
    ".izb .pill.mal{background:#fee2e2 !important;color:#991b1b !important;}",
    ".izb .pill.neutro{background:#f3f4f6 !important;color:#374151 !important;}",
    ".izb .izb-kpis{display:grid !important;grid-template-columns:repeat(auto-fit,minmax(150px,1fr)) !important;gap:8px !important;margin:8px 0 !important;}",
    ".izb .izb-kpi{background:#fff !important;border:1px solid #eeefeb !important;border-radius:4px !important;padding:8px 10px !important;}",
    ".izb .izb-kpi .k{font-size:12px !important;color:#6b7280 !important;}",
    ".izb .izb-kpi .v{font-size:18px !important;font-weight:700 !important;}",
    ".izb .izb-kpi .s{font-size:12px !important;color:#6b7280 !important;}",
    // barra de percentil
    ".izb .izb-pbar{position:relative !important;height:10px !important;border-radius:5px !important;background:linear-gradient(90deg,#fecaca,#fde68a,#bbf7d0) !important;margin:22px 0 18px !important;}",
    ".izb .izb-pbar i{position:absolute !important;top:-5px !important;width:4px !important;height:20px !important;background:#141414 !important;border-radius:2px !important;margin-left:-2px !important;}",
    ".izb .izb-pbar i b{position:absolute !important;bottom:22px !important;left:50% !important;transform:translateX(-50%) !important;font-size:12px !important;white-space:nowrap !important;font-style:normal !important;}",
    ".izb .izb-pbar .e{position:absolute !important;top:14px !important;font-size:11px !important;color:#6b7280 !important;}",
    // formulario / checklist
    ".izb input[type=text]{all:unset;box-sizing:border-box !important;border:1px solid #d1d5db !important;border-radius:4px !important;padding:5px 8px !important;font-size:13px !important;background:#fff !important;width:260px !important;max-width:100% !important;}",
    ".izb .izb-act{all:unset;cursor:pointer !important;font-size:13px !important;font-weight:600 !important;color:#145bc7 !important;padding:5px 8px !important;}",
    ".izb .izb-act:hover{text-decoration:underline !important;}",
    ".izb .izb-x{all:unset;cursor:pointer !important;color:#9ca3af !important;padding:0 4px !important;font-size:14px !important;}",
    ".izb .izb-x:hover{color:#dc2626 !important;}",
    ".izb label.izb-chk{display:flex !important;gap:8px !important;align-items:flex-start !important;padding:6px 8px !important;background:#fff !important;border:1px solid #eeefeb !important;border-radius:4px !important;cursor:pointer !important;font-size:14px !important;margin:0 0 6px !important;font-weight:400 !important;}",
    ".izb label.izb-chk input{margin-top:3px !important;accent-color:#16a34a !important;}",
    ".izb label.izb-chk.ok span{color:#6b7280 !important;text-decoration:line-through !important;}",
    ".izb .izb-foot{display:flex !important;flex-wrap:wrap !important;gap:4px 14px !important;padding:12px 16px 14px !important;font-size:12.5px !important;color:#6b7280 !important;}",
    ".izb .izb-foot a{color:#145bc7 !important;text-decoration:none !important;}",
    ".izb .izb-err{color:#991b1b !important;font-size:13px !important;}",
    ".izb table.izb-t{width:100% !important;border-collapse:collapse !important;font-size:13.5px !important;margin:6px 0 !important;}",
    ".izb table.izb-t th{text-align:left !important;font-size:12px !important;color:#6b7280 !important;font-weight:600 !important;padding:4px 6px !important;border-bottom:1px solid #e5e6e1 !important;}",
    ".izb table.izb-t td{padding:5px 6px !important;border-bottom:1px solid #f1f1ee !important;}",
    ".izb table.izb-t td.n{text-align:right !important;font-variant-numeric:tabular-nums !important;white-space:nowrap !important;}",
    // comparador
    ".izk-fab{position:fixed !important;right:18px !important;bottom:18px !important;z-index:2147483000 !important;background:#141414 !important;color:#fff !important;border:none !important;border-radius:22px !important;padding:10px 16px !important;font:600 14px/1 bernino-regular,Verdana,Arial,sans-serif !important;cursor:pointer !important;box-shadow:0 4px 14px rgba(0,0,0,.25) !important;}",
    ".izk-fab:hover{background:#333 !important;}",
    ".izk-fab b{background:#fde047 !important;color:#422006 !important;border-radius:9px !important;padding:1px 7px !important;margin-left:6px !important;}",
    ".izk-ov{position:fixed !important;inset:0 !important;z-index:2147483001 !important;background:rgba(20,20,20,.55) !important;display:flex !important;align-items:flex-start !important;justify-content:center !important;padding:40px 16px !important;overflow:auto !important;font-family:bernino-regular,Verdana,Arial,sans-serif !important;}",
    ".izk-box{background:#fff !important;border-radius:6px !important;max-width:1200px !important;width:100% !important;box-shadow:0 10px 40px rgba(0,0,0,.3) !important;color:#141414 !important;}",
    ".izk-box *{box-sizing:border-box !important;font-family:inherit !important;}",
    ".izk-head{display:flex !important;align-items:center !important;gap:10px !important;background:#6f6f6d !important;color:#fff !important;padding:10px 16px !important;border-radius:6px 6px 0 0 !important;}",
    ".izk-head .t{flex:1 !important;font-weight:700 !important;font-size:16px !important;}",
    ".izk-head button{all:unset;cursor:pointer !important;font-size:13px !important;font-weight:600 !important;padding:5px 10px !important;border-radius:4px !important;background:rgba(255,255,255,.14) !important;color:#fff !important;}",
    ".izk-head button:hover{background:rgba(255,255,255,.28) !important;}",
    ".izk-body{padding:12px 16px 16px !important;overflow-x:auto !important;}",
    ".izk-t{border-collapse:collapse !important;font-size:13.5px !important;min-width:100% !important;}",
    ".izk-t th,.izk-t td{padding:7px 10px !important;border-bottom:1px solid #eeefeb !important;vertical-align:top !important;text-align:left !important;}",
    ".izk-t th{width:170px !important;font-size:12px !important;color:#6b7280 !important;font-weight:600 !important;white-space:nowrap !important;background:#fafaf9 !important;position:sticky !important;left:0 !important;}",
    ".izk-t td{min-width:180px !important;max-width:240px !important;}",
    ".izk-t td.best{background:#f0fdf4 !important;font-weight:700 !important;}",
    ".izk-t img{width:100% !important;height:110px !important;object-fit:cover !important;border-radius:4px !important;display:block !important;margin-bottom:6px !important;}",
    ".izk-t a{color:#145bc7 !important;text-decoration:none !important;font-weight:600 !important;}",
    ".izk-t textarea{width:100% !important;min-height:54px !important;border:1px solid #d1d5db !important;border-radius:4px !important;padding:4px 6px !important;font-size:12.5px !important;resize:vertical !important;}",
    ".izk-t .nota{font-size:20px !important;font-weight:800 !important;}",
    ".izk-t .rm{all:unset;cursor:pointer !important;color:#9ca3af !important;font-size:12px !important;}",
    ".izk-t .rm:hover{color:#dc2626 !important;}",
    ".izk-vacio{padding:30px !important;text-align:center !important;color:#6b7280 !important;}"
  ].join("\n");
  function ponerCSS() {
    if (document.getElementById("izb-css")) return;
    var st = document.createElement("style");
    st.id = "izb-css";
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  // anillo SVG con la nota
  function anillo(nota, clase) {
    var col = { bien: "#16a34a", aviso: "#d97706", mal: "#dc2626", neutro: "#9ca3af" }[clase];
    var r = 48, C = 2 * Math.PI * r, frac = nota == null ? 0 : nota / 10;
    return "<svg width='120' height='120' viewBox='0 0 120 120'>" +
      "<circle cx='60' cy='60' r='" + r + "' fill='none' stroke='#eeefeb' stroke-width='11'/>" +
      "<circle cx='60' cy='60' r='" + r + "' fill='none' stroke='" + col + "' stroke-width='11' stroke-linecap='round'" +
      " stroke-dasharray='" + (C * frac).toFixed(1) + " " + C.toFixed(1) + "' transform='rotate(-90 60 60)'/>" +
      "<text x='60' y='58' text-anchor='middle' font-size='32' font-weight='800' fill='#141414'>" +
      (nota == null ? "…" : fmtN(nota, 1)) + "</text>" +
      "<text x='60' y='80' text-anchor='middle' font-size='13' fill='#6b7280'>sobre 10</text></svg>";
  }
  // mini gráfico de la evolución del €/m²
  function sparkline(h) {
    if (!h || h.length < 2) return "";
    var W = 320, H = 70, p = 4;
    var vals = h.map(function (x) { return x.m2; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (mx === mn) mx = mn + 1;
    var pts = vals.map(function (v, i) {
      return [(p + i * (W - 2 * p) / (vals.length - 1)).toFixed(1), (H - p - (v - mn) * (H - 2 * p) / (mx - mn)).toFixed(1)];
    });
    var line = pts.map(function (q) { return q.join(","); }).join(" ");
    var area = "M" + pts[0][0] + "," + (H - p) + " L" + line.replace(/ /g, " L") + " L" + pts[pts.length - 1][0] + "," + (H - p) + " Z";
    return "<svg width='100%' height='" + H + "' viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='none' style='display:block'>" +
      "<path d='" + area + "' fill='#145bc7' fill-opacity='.08'/>" +
      "<polyline points='" + line + "' fill='none' stroke='#145bc7' stroke-width='2'/>" +
      "<circle cx='" + pts[pts.length - 1][0] + "' cy='" + pts[pts.length - 1][1] + "' r='3.5' fill='#145bc7'/></svg>" +
      "<div class='muted' style='display:flex;justify-content:space-between'><span>" + esc(h[0].mes) + " · " + fmtN(h[0].m2) +
      " €/m²</span><span>" + esc(h[h.length - 1].mes) + " · " + fmtN(h[h.length - 1].m2) + " €/m²</span></div>";
  }

  // ===================================================================
  // RENDER DE LA SECCIÓN
  // ===================================================================
  var S = null;      // estado de la ficha actual
  var tabAbierta = null;

  var VERED = {
    bien: ["Verde · bien", "bien"], regular: ["Naranja · regular", "aviso"], duda: ["Gris · sin datos", "neutro"],
    mal: ["Rojo · mal", "mal"], muy_mal: ["Granate · muy mal", "mal"]
  };

  function tiles() {
    var P = puntuar(S);
    var T = [];
    function t(k, label, val, sub, nota, cargando, error) {
      T.push({ k: k, label: label, val: val, sub: sub, nota: nota, cargando: cargando, error: error });
    }
    // zona
    var z = S.zona && S.zona.zonas[0];
    t("zona", "Tu zona", z ? VERED[z.veredicto] ? VERED[z.veredicto][0] : z.veredicto : "Sin clasificar",
      z ? z.nombre : "no está en tus zonas", P.notas.zona);
    // inundación
    var I = S.inund;
    t("inund", "Inundación", I ? (I.danaDentro ? "Se inundó (DANA 2024)" : I.patri[0] ? "Zona inundable" :
      (I.danaCerca || I.patriCerca.length) ? "Riesgo cerca" : "Sin riesgo") : "",
      I ? (I.danaDentro ? "huella oficial de la Generalitat" : I.patri[0] ? "PATRICOVA nivel " + (I.patri[0].nivel === 7 ? "geomorf." : I.patri[0].nivel) :
        I.danaCerca ? "DANA a < ~200 m" : I.patriCerca.length ? "PATRICOVA a < 250 m" : "DANA 2024 + PATRICOVA") : "",
      P.notas.inund, !I && !S.err.inund, S.err.inund);
    // renta
    var R = S.renta;
    t("renta", "Renta del barrio", R ? fmtE(R.rentaPersona) + "/persona" : "",
      R ? (R.pctProv != null ? "más que el " + R.pctProv + " % de la provincia" : "INE 2023") : "",
      P.notas.renta, !R && !S.err.renta, S.err.renta);
    // servicios
    var e = esencialesCerca(S.servicios);
    t("servicios", "Servicios a pie", e ? e.n + " de " + e.tot + " a ≤ 10 min" : "",
      S.servicios && S.servicios.mejor.super ? "súper a " + minAndando(S.servicios.mejor.super.m) + " min" : "OpenStreetMap",
      P.notas.servicios, !S.servicios && !S.err.servicios, S.err.servicios);
    // coche
    var rp = rutaPrincipal(S.coche);
    t("coche", "En coche", rp && rp.min != null ? rp.min + " min" : S.coche ? "—" : "",
      rp ? "a " + rp.n.replace(/\s*\(.*\)/, "") : "sin tráfico", P.notas.coche, !S.coche && !S.err.coche, S.err.coche);
    // precio
    var d = difPrecio(S.anuncio, S.precio);
    var pz = S.precio && S.precio.zona;
    t("precio", "Precio zona", pz ? fmtN(pz.m2) + " €/m²" : "",
      d ? "este: " + fmtN(d.m2) + " €/m² (" + signo(d.dif) + " %)" : pz && pz.varAnual != null ? signo(pz.varAnual, 1) + " % en un año" : "",
      P.notas.precio, !S.precio && !S.err.precio, S.err.precio);
    // alquilar vs comprar
    var av = alquilarVsComprar();
    t("alquiler", "Alquilar vs comprar", av ? (av.dif >= 0 ? "Comprar: +" : "Comprar: −") + fmtE(Math.abs(av.dif)) + "/mes" : "",
      av ? "alquiler similar ≈ " + fmtE(av.alquiler) + "/mes" : "", av ? (av.dif <= 0 ? 8 : av.dif < 200 ? 6 : 4) : null,
      !av && !S.err.precio && !S.precio, S.err.precio || (S.precio && !S.precio.alquiler) ? "sin datos de alquiler en la zona" : null);
    // checklist
    var ch = checklist(), hechos = ch.filter(function (c) { return c.ok; }).length;
    t("check", S.anuncio.obra ? "Antes de reservar" : "Antes de ofertar", hechos + " de " + ch.length + " revisado",
      "checklist de esta vivienda", hechos === ch.length ? 10 : null);
    return { T: T, P: P };
  }

  function alquilarVsComprar() {
    var A = S.anuncio, pz = S.precio;
    if (!pz || !pz.alquiler || !A.m2 || !A.precio) return null;
    var f = finanzas(A);
    if (!f) return null;
    var alquiler = pz.alquiler.m2 * A.m2;
    return { alquiler: alquiler, propietario: f.costeMensualReal, dif: f.costeMensualReal - alquiler, f: f,
             rentab: 100 * alquiler * 12 / A.precio };
  }

  function pintar() {
    var box = document.getElementById("izb");
    if (!box || !S) return;
    var r = tiles(), P = r.P;
    var et = etiquetaTotal(P.total, S);
    var res = resumen(S, P);
    var pend = ["inund", "renta", "servicios", "coche", "precio"].filter(function (k) {
      return S[k === "inund" ? "inund" : k] == null && !S.err[k];
    }).length;
    var html = "";
    html += "<div class='izb-bar'><span class='t'>¿comprar aquí? <small>· análisis de la zona</small></span>" +
      "<button class='izb-b izb-guardar" + (enComparador(S.anuncio.url) ? " on" : "") + "'>" +
      (enComparador(S.anuncio.url) ? "★ En el comparador" : "☆ Guardar para comparar") + "</button>" +
      "<button class='izb-b izb-abrircmp'>⚖ Comparador</button></div>";
    html += "<div class='izb-top'><div class='izb-nota'>" + anillo(P.total, et[1]) +
      "<div class='lab' style='color:" + ({ bien: "#166534", aviso: "#92400e", mal: "#991b1b", neutro: "#374151" })[et[1]] + "'>" + esc(et[0]) + "</div>" +
      "<div class='sub'>" + P.n + " de 7 criterios" + (pend ? " · cargando " + pend + "…" : "") + "</div></div>";
    html += "<div class='izb-res'><h3>Resumen</h3><div class='dir'>" + esc(S.ub.items.slice(0, 3).join(" · ")) + "</div>";
    if (res.pro.length) html += "<ul>" + res.pro.map(function (x) { return "<li class='p'>" + esc(x) + "</li>"; }).join("") + "</ul>";
    if (res.contra.length) html += "<ul>" + res.contra.map(function (x) {
      return "<li class='c" + (/inund|DANA|rojo|descartar/i.test(x) ? " grave" : "") + "'>" + esc(x) + "</li>";
    }).join("") + "</ul>";
    if (!res.pro.length && !res.contra.length) html += "<p class='muted'>Reuniendo datos…</p>";
    html += "</div></div>";

    html += "<div class='izb-tiles'>";
    r.T.forEach(function (t) {
      var cl = t.cargando ? "cargando" : claseNota(t.nota);
      html += "<button class='izb-tile " + cl + (tabAbierta === t.k ? " sel" : "") + "' data-k='" + t.k + "'>" +
        "<span class='l'><span>" + esc(t.label) + "</span>" + (t.nota != null ? "<span class='n'>" + t.nota + "/10</span>" : "") + "</span>" +
        "<span class='v'>" + (t.error ? "—" : esc(t.val) || "&nbsp;") + "</span>" +
        "<span class='s'>" + (t.error ? "<span class='izb-err'>" + esc(t.error) + "</span>" : esc(t.sub)) + "</span></button>";
    });
    html += "</div>";
    html += "<div class='izb-pane'" + (tabAbierta ? "" : " hidden") + ">" + (tabAbierta ? panel(tabAbierta, P) : "") + "</div>";

    var c = S.coords;
    html += "<div class='izb-foot'><span>Pulsa cada bloque para ver el detalle.</span>" +
      "<a target='_blank' rel='noopener' href='https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=" + c.lat + "," + c.lng + "'>Street View</a>" +
      "<a target='_blank' rel='noopener' href='https://www.google.com/maps/search/?api=1&query=" + c.lat + "," + c.lng + "'>Google Maps</a>" +
      "<a target='_blank' rel='noopener' href='https://visor.gva.es/visor/?capasids=Imagen&nodoDesplegado=00_DANA2024&idioma=es'>Visor DANA / PATRICOVA</a>" +
      "<a href='#' class='izb-export'>Exportar ficha (JSON)</a>" +
      "<span>Fuentes: INE, Generalitat (ICV), OpenStreetMap, OSRM, idealista · v" + VERSION + "</span></div>";
    box.innerHTML = html;
    actualizarFab();
  }

  // ------------------------------------------------------------ paneles
  function filaHTML(ico, titulo, sub, der, derSub) {
    return "<div class='izb-row'><span class='i'>" + ico + "</span><span class='d'><b>" + titulo + "</b>" +
      (sub ? "<span>" + sub + "</span>" : "") + "</span><span class='r'>" + (der || "") +
      (derSub ? "<small>" + derSub + "</small>" : "") + "</span></div>";
  }
  function pctBar(p, etiqueta) {
    if (p == null) return "";
    return "<div class='izb-pbar'><i style='left:" + Math.max(1, Math.min(99, p)) + "%'><b>" + esc(etiqueta) + "</b></i>" +
      "<span class='e' style='left:0'>renta más baja</span><span class='e' style='right:0'>más alta</span></div>";
  }

  function panel(k, P) {
    var h = "";
    if (k === "zona") {
      var zs = S.zona ? S.zona.zonas : [];
      h += "<h4>Tu clasificación de zonas</h4>";
      if (!zs.length) return h + "<p>Esta vivienda no cae en ninguna de tus zonas de <code>zonas.js</code>. Clasifícala con el skill de zonas si te interesa la zona.</p>";
      h += "<div class='izb-rows'>";
      zs.forEach(function (z) {
        var v = VERED[z.veredicto] || [z.veredicto, "neutro"];
        h += filaHTML("📍", esc(z.nombre), z.demo && z.demo.t ? fmtN(z.demo.t) + " habitantes" : "",
          "<span class='pill " + v[1] + "'>" + esc(v[0]) + "</span>");
      });
      h += "</div><p class='muted'>Es tu propia clasificación (criterio: seguridad y contexto socioeconómico). La zona más concreta manda en la nota.</p>";
      return h;
    }
    if (k === "inund") {
      var I = S.inund;
      h += "<h4>Riesgo de inundación</h4>";
      if (S.err.inund) return h + "<p class='izb-err'>No se pudo consultar: " + esc(S.err.inund) + "</p>";
      if (!I) return h + "<p class='muted'>Consultando a la Generalitat…</p>";
      h += "<div class='izb-rows'>";
      h += filaHTML("🌊", "DANA del 29 de octubre de 2024",
        I.danaDentro ? esc(I.danaDesc || "Dentro de la huella oficial de la inundación") :
          I.danaCerca ? "Hubo zona inundada a menos de ~200 m" : "Fuera de la huella oficial de la inundación",
        "<span class='pill " + (I.danaDentro ? "mal" : I.danaCerca ? "aviso" : "bien") + "'>" +
        (I.danaDentro ? "Se inundó" : I.danaCerca ? "Cerca" : "No") + "</span>");
      h += filaHTML("🏛️", "Municipio afectado (Decreto 163/2024)",
        I.riesgoMun ? "Riesgo municipal: " + esc(I.riesgoMun.riesgoperi || "—") + (I.riesgoMun.cauce ? " · cauce " + esc(I.riesgoMun.cauce) : "") : "",
        "<span class='pill " + (I.decreto ? "aviso" : "bien") + "'>" + (I.decreto ? "Sí" : "No") + "</span>");
      var p = I.patri[0];
      h += filaHTML("🗺️", "PATRICOVA (zonas inundables oficiales)",
        p ? esc(p.desc) + (p.zona ? " · " + esc(p.zona) : "") :
          I.patriCerca[0] ? "A menos de 250 m: " + esc(I.patriCerca[0].desc) : "No es zona inundable",
        "<span class='pill " + (p ? (p.nivel <= 4 ? "mal" : "aviso") : I.patriCerca[0] ? "aviso" : "bien") + "'>" +
        (p ? "Nivel " + (p.nivel === 7 ? "geom." : p.nivel) : I.patriCerca[0] ? "Cerca" : "No") + "</span>");
      h += "</div><p class='muted'>Huella real de la DANA y PATRICOVA: Institut Cartogràfic Valencià (solo Comunitat Valenciana). " +
        "Nivel 1 = inundación frecuente (25 años) con más de 0,8 m de agua; 6 = poco frecuente y poca altura. " +
        "Pregunta igualmente a vecinos y mira si el garaje o los bajos tuvieron daños en 2024.</p>";
      return h;
    }
    if (k === "renta") {
      var R = S.renta;
      h += "<h4>Renta y perfil del barrio <span class='muted'>· sección censal " + (R ? esc(R.cusec) : "") + ", INE 2023</span></h4>";
      if (S.err.renta) return h + "<p class='izb-err'>" + esc(S.err.renta) + "</p>";
      if (!R) return h + "<p class='muted'>Consultando al INE…</p>";
      h += pctBar(R.pctProv, "este barrio: percentil " + R.pctProv + " de la provincia");
      h += "<div class='izb-kpis'>";
      function kpi(k2, v, s) { h += "<div class='izb-kpi'><div class='k'>" + k2 + "</div><div class='v'>" + v + "</div>" + (s ? "<div class='s'>" + s + "</div>" : "") + "</div>"; }
      var M = R.mun || {};
      kpi("Renta neta por persona", fmtE(R.rentaPersona), M.dato1 ? "municipio: " + fmtE(M.dato1) + (R.pctMun != null ? " · percentil " + R.pctMun + " del municipio" : "") : "");
      kpi("Renta neta por hogar", fmtE(R.rentaHogar), M.dato2 ? "municipio: " + fmtE(M.dato2) : "");
      kpi("Menores de 18 años", fmtP(R.menores), M.dato7 ? "municipio: " + fmtP(M.dato7) + (R.menores > M.dato7 + 2 ? " · zona de familias" : "") : "");
      kpi("Mayores de 65 años", fmtP(R.mayores), M.dato8 ? "municipio: " + fmtP(M.dato8) : "");
      kpi("Población con renta baja", fmtP(R.bajaRenta), "por debajo del 60 % de la mediana" + (M.dato4 ? " · mun.: " + fmtP(M.dato4) : ""));
      kpi("Desigualdad (Gini)", fmtN(R.gini, 1), M.dato9 ? "municipio: " + fmtN(M.dato9, 1) : "");
      kpi("Pisos turísticos", R.turisticas != null ? fmtP(R.turisticas, 2) : "0 %", R.nTuristicas != null ? R.nTuristicas + " viviendas (mayo 2026)" : "");
      h += "</div><p class='muted'>Atlas de Distribución de Renta de los Hogares (INE), datos de 2023 por sección censal (unas 1.000–2.500 personas).</p>";
      return h;
    }
    if (k === "servicios") {
      var s = S.servicios;
      h += "<h4>Servicios a pie <span class='muted'>· distancia en línea recta y minutos andando estimados</span></h4>";
      if (S.err.servicios) return h + "<p class='izb-err'>OpenStreetMap no responde ahora mismo (" + esc(S.err.servicios) +
        "). Sus servidores públicos se saturan a ratos.</p><button class='izb-act izb-reosm'>↻ Reintentar</button>";
      if (!s) return h + "<p class='muted'>Consultando OpenStreetMap…</p>";
      h += "<div class='izb-rows'>";
      CATS.forEach(function (c) {
        var b = s.mejor[c.k];
        if (c.coche) {
          var rh = S.coche && S.coche.rutas.filter(function (r) { return r.auto && r.n.indexOf("Hospital") === 0; })[0];
          h += filaHTML(c.ico, c.t, b ? esc(b.nombre || "") : "ninguno en 25 km",
            b ? metros(b.m) : "—", rh && rh.min != null ? rh.min + " min en coche" : "");
          return;
        }
        var min = b ? minAndando(b.m) : null;
        var cl = min == null ? "mal" : min <= c.ok ? "bien" : min <= c.med ? "aviso" : "mal";
        h += filaHTML(c.ico, c.t + (s.cuenta[c.k] > 1 ? " <span class='muted'>(" + s.cuenta[c.k] + " a < 800 m)</span>" : ""),
          b ? esc(b.nombre || "sin nombre") : "no hay cerca",
          b ? "<span class='pill " + cl + "'>" + min + " min</span>" : "<span class='pill mal'>—</span>", b ? metros(b.m) : "");
      });
      h += "</div>";
      if (s.ocio != null) h += "<p>🍽️ <b>" + s.ocio + "</b> bares, cafeterías y restaurantes a menos de 500 m" +
        (s.ocio1k != null ? " · " + s.ocio1k + " a menos de 1 km " : " ") +
        "<span class='muted'>(" + (s.ocio > 40 ? "mucha vida de calle: ojo al ruido" : s.ocio > 12 ? "barrio con vida" : "zona tranquila") + ")</span></p>";
      h += "<p class='muted'>Datos de " + esc(s.fuente || "OpenStreetMap (en directo)") + ": pueden faltar sitios. Los minutos son una estimación (recta × 1,3 a paso normal).</p>";
      return h;
    }
    if (k === "coche") {
      var C = S.coche;
      h += "<h4>En coche <span class='muted'>· sin tráfico (OSRM); en hora punta cuenta bastante más</span></h4>";
      if (S.err.coche) h += "<p class='izb-err'>" + esc(S.err.coche) + "</p>";
      h += "<div class='izb-rows'>";
      destinos().forEach(function (d, i) {
        var r = C && C.rutas.filter(function (x) { return x.n === d.n && !x.auto; })[0];
        h += "<div class='izb-row'><span class='i'>" + (d.principal ? "★" : "🚗") + "</span><span class='d'><b>" + esc(d.n) + "</b>" +
          "<span>" + (d.principal ? "destino principal (cuenta para la nota)" : "<a href='#' class='izb-principal' data-i='" + i + "'>marcar como principal</a>") +
          "</span></span><span class='r'>" + (r && r.min != null ? r.min + " min<small>" + fmtN(r.km, 1) + " km</small>" :
            C ? "<small>muy lejos</small>" : "…") +
          " <button class='izb-x izb-borrar' data-i='" + i + "' title='quitar destino'>✕</button></span></div>";
      });
      h += "</div><p style='display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px'>" +
        "<input type='text' class='izb-nuevo' placeholder='Añadir destino: trabajo, colegio, familia…'>" +
        "<button class='izb-act izb-anadir'>+ Añadir</button>" +
        (lsGet(LS_DEST, null) ? "<button class='izb-act izb-reset'>restaurar por defecto</button>" : "") + "</p>" +
        "<p class='muted'>Los destinos se guardan para todas las viviendas. La dirección se busca en OpenStreetMap (Nominatim).</p>";
      return h;
    }
    if (k === "precio") {
      var pz = S.precio;
      h += "<h4>Precio de la zona <span class='muted'>· informes de idealista</span></h4>";
      if (S.err.precio) return h + "<p class='izb-err'>" + esc(S.err.precio) + "</p>";
      if (!pz) return h + "<p class='muted'>Leyendo los informes de precios…</p>";
      h += "<table class='izb-t'><tr><th>Zona</th><th style='text-align:right'>€/m² venta</th><th style='text-align:right'>Último año</th></tr>";
      pz.niveles.forEach(function (n) {
        h += "<tr><td><a target='_blank' href='" + esc(n.url) + "'>" + esc(n.nombre) + "</a></td><td class='n'>" + fmtN(n.m2) +
          " €</td><td class='n'>" + (n.varAnual != null ? signo(n.varAnual, 1) + " %" : "—") + "</td></tr>";
      });
      h += "</table>";
      h += "<p><b>Evolución en " + esc(pz.zona.nombre) + "</b></p>" + sparkline(pz.zona.historia);
      var A = S.anuncio;
      if (A.unidades.length) {
        h += "<table class='izb-t' style='margin-top:12px'><tr><th>Vivienda</th><th style='text-align:right'>Precio</th><th style='text-align:right'>€/m²</th><th style='text-align:right'>vs zona</th></tr>";
        A.unidades.forEach(function (u) {
          if (!u.m2) return;
          var m2 = u.precio / u.m2, dif = 100 * (m2 / pz.zona.m2 - 1);
          h += "<tr><td>" + esc(u.nombre) + "</td><td class='n'>" + fmtE(u.precio) + "</td><td class='n'>" + fmtN(m2) +
            "</td><td class='n'><span class='pill " + (dif - (A.obra ? 10 : 0) <= 0 ? "bien" : dif - (A.obra ? 10 : 0) <= 15 ? "aviso" : "mal") + "'>" + signo(dif) + " %</span></td></tr>";
        });
        h += "</table>";
      }
      if (pz.alquiler) h += "<p>Alquiler en " + esc(pz.alquiler.nombre) + ": <b>" + fmtN(pz.alquiler.m2, 2) + " €/m² al mes</b>" +
        " → rentabilidad bruta de la zona ≈ " + fmtP(100 * pz.alquiler.m2 * 12 / pz.zona.m2) + "</p>";
      h += "<p class='muted'>" + (A.obra ? "Obra nueva: lo normal es pagar algo más (≈ +10 %) que la media, que mezcla pisos nuevos y usados. " : "") +
        "Los informes de idealista usan precios de oferta, no de compraventa.</p>";
      return h;
    }
    if (k === "alquiler") {
      var av = alquilarVsComprar();
      h += "<h4>¿Y si alquilarais algo igual?</h4>";
      if (!av) return h + "<p class='muted'>" + (S.err.precio ? "No hay datos de alquiler de la zona." : "Esperando datos de alquiler de la zona…") + "</p>";
      var f = av.f;
      h += "<div class='izb-kpis'>" +
        "<div class='izb-kpi'><div class='k'>Alquiler similar (" + fmtN(S.anuncio.m2) + " m²)</div><div class='v'>" + fmtE(av.alquiler) + "/mes</div><div class='s'>" + fmtN(S.precio.alquiler.m2, 2) + " €/m² · " + esc(S.precio.alquiler.nombre) + "</div></div>" +
        "<div class='izb-kpi'><div class='k'>Comprar: coste mensual</div><div class='v'>" + fmtE(av.propietario) + "/mes</div><div class='s'>cuota " + fmtE(f.cuota) + " + comunidad + IBI</div></div>" +
        "<div class='izb-kpi'><div class='k'>Diferencia</div><div class='v' style='color:" + (av.dif > 0 ? "#b45309" : "#15803d") + "'>" + (av.dif > 0 ? "+" : "−") + fmtE(Math.abs(av.dif)) + "/mes</div><div class='s'>" + (av.dif > 0 ? "comprar cuesta más al mes" : "comprar sale más barato al mes") + "</div></div>" +
        "<div class='izb-kpi'><div class='k'>Cash que inmovilizáis</div><div class='v'>" + fmtE(f.liquido) + "</div><div class='s'>entrada + impuestos + gastos</div></div>" +
        "</div>";
      var amort = f.cuota - f.prestamo * (window.__izpf ? window.__izpf.cfg().interes : 3) / 100 / 12;
      h += "<p>De la cuota, unos <b>" + fmtE(amort) + "/mes</b> el primer año son capital que es vuestro (ahorro forzoso); el resto son intereses. " +
        "Alquilando, ese cash seguiría disponible.</p><p class='muted'>Cálculo con " + esc(S.anuncio.unidades.length ? "la vivienda más barata de la promoción" : "esta vivienda") +
        " y tu simulación de hipoteca (entrada, plazo e interés del panel de precio final).</p>";
      return h;
    }
    if (k === "check") {
      var ch = checklist();
      h += "<h4>" + (S.anuncio.obra ? "Antes de dar la reserva" : "Antes de hacer una oferta") + " <span class='muted'>· se guarda para esta vivienda</span></h4>";
      ch.forEach(function (c, i) {
        h += "<label class='izb-chk" + (c.ok ? " ok" : "") + "'><input type='checkbox' class='izb-ck' data-i='" + i + "'" + (c.ok ? " checked" : "") +
          "><span>" + esc(c.t) + (c.d ? "<br><span class='muted'>" + esc(c.d) + "</span>" : "") + "</span></label>";
      });
      return h;
    }
    return h;
  }

  var CHECK_OBRA = [
    ["Aval o seguro de las cantidades entregadas a cuenta", "La reserva y las arras deben estar garantizadas (Ley de Ordenación de la Edificación). Pide el certificado con tu nombre y la cuenta especial."],
    ["Licencia de obras concedida", "Sin licencia, la fecha de entrega es papel mojado."],
    ["Fecha de entrega por escrito y penalización por retraso", ""],
    ["Memoria de calidades firmada (anexo al contrato)", ""],
    ["Plaza de garaje y trastero: ¿incluidos o aparte? Precio", ""],
    ["Hipoteca del promotor: condiciones de subrogación o libertad para elegir banco", ""],
    ["Gastos de enganches y suministros (agua, luz) a cargo de quién", ""],
    ["Comunidad prevista e IBI estimado", ""],
    ["Visitar la zona de noche y en hora punta (ruido, aparcamiento, trayecto)", ""],
    ["Preguntar por la DANA 2024 en el barrio (garajes, bajos, accesos)", ""]
  ];
  var CHECK_USADA = [
    ["Nota simple del Registro: titular, cargas e hipotecas", ""],
    ["Certificado de la comunidad: al corriente de pagos y derramas aprobadas", ""],
    ["ITE / IEE del edificio y estado de fachada, cubierta y bajantes", ""],
    ["Certificado energético y estado de instalaciones (luz, agua, gas)", ""],
    ["Referencia catastral y valor de referencia (ITP sobre el mayor)", ""],
    ["Cédula de habitabilidad / licencia de primera ocupación", ""],
    ["Orientación, ruido y humedades (visitar con lluvia si se puede)", ""],
    ["Visitar la zona de noche y en hora punta", ""],
    ["Preguntar por la DANA 2024 en el edificio (garaje, trasteros, bajos)", ""]
  ];
  function checklist() {
    var base = S.anuncio.obra ? CHECK_OBRA : CHECK_USADA;
    var guard = lsGet("izb_check:" + S.anuncio.id, {});
    return base.map(function (c, i) { return { t: c[0], d: c[1], ok: !!guard[i] }; });
  }

  // ------------------------------------------------------------ eventos
  function onClick(ev) {
    var t = ev.target;
    var box = document.getElementById("izb");
    if (!box || !box.contains(t)) return;
    var tile = t.closest(".izb-tile");
    if (tile) {
      var k = tile.getAttribute("data-k");
      tabAbierta = tabAbierta === k ? null : k;
      pintar();
      return;
    }
    if (t.closest(".izb-guardar")) { alternarComparador(); return; }
    if (t.closest(".izb-abrircmp")) { abrirComparador(); return; }
    if (t.closest(".izb-export")) { ev.preventDefault(); descargar("ficha-" + (S.anuncio.id || "idealista") + ".json", JSON.stringify(snapshot(), null, 2), "application/json"); return; }
    if (t.closest(".izb-anadir")) {
      var inp = box.querySelector(".izb-nuevo");
      var txt = inp && inp.value.trim();
      if (!txt) return;
      t.textContent = "buscando…";
      geocodificar(txt).then(function (g) {
        var ds = destinos();
        ds.push({ n: txt, lat: g.lat, lng: g.lng, propio: true });
        lsSet(LS_DEST, ds);
        recargarCoche();
      }).catch(function (e) { S.err.coche = e.message; pintar(); });
      return;
    }
    if (t.closest(".izb-borrar")) {
      var ds = destinos(); ds.splice(+t.closest(".izb-borrar").getAttribute("data-i"), 1);
      if (ds.length && !ds.some(function (d) { return d.principal; })) ds[0].principal = true;
      lsSet(LS_DEST, ds); recargarCoche(); return;
    }
    if (t.closest(".izb-principal")) {
      ev.preventDefault();
      var i = +t.closest(".izb-principal").getAttribute("data-i");
      var ds2 = destinos().map(function (d, j) { d.principal = j === i; return d; });
      lsSet(LS_DEST, ds2); recargarCoche(); return;
    }
    if (t.closest(".izb-reosm")) {
      S.err.servicios = null; pintar();
      servicios(S.coords.lat, S.coords.lng).then(function (s) { S.servicios = s; fin(); recargarCoche(); })
        .catch(function (e) { S.err.servicios = e.message; fin(); });
      return;
    }
    if (t.closest(".izb-reset")) { localStorage.removeItem(LS_DEST); recargarCoche(); return; }
  }
  function onChange(ev) {
    var t = ev.target;
    if (!t.classList || !t.classList.contains("izb-ck")) return;
    var g = lsGet("izb_check:" + S.anuncio.id, {});
    g[t.getAttribute("data-i")] = t.checked;
    lsSet("izb_check:" + S.anuncio.id, g);
    pintar();
  }
  function onKey(ev) {
    if (ev.key === "Enter" && ev.target.classList && ev.target.classList.contains("izb-nuevo")) {
      var b = document.querySelector("#izb .izb-anadir");
      if (b) b.click();
    }
  }

  function recargarCoche() {
    S.coche = null; S.err.coche = null; pintar();
    var extra = [];
    var h = S.servicios && S.servicios.mejor.hospital;
    if (h) extra.push({ n: "Hospital" + (h.nombre ? " · " + h.nombre : ""), lat: h.lat, lng: h.lng, auto: true });
    coche(S.coords.lat, S.coords.lng, extra).then(function (c) { S.coche = c; fin(); })
      .catch(function (e) { S.err.coche = e.message; S.coche = { rutas: [] }; fin(); });
  }

  // =================================================================
  // COMPARADOR
  // =================================================================
  var LS_CMP = "izb_comparador";
  function comparador() { return lsGet(LS_CMP, []); }
  function enComparador(url) { return comparador().some(function (x) { return x.url === url; }); }

  function snapshot(unidad) {
    var A = S.anuncio, P = puntuar(S);
    var u = unidad || (A.precio ? { nombre: A.unidades.length ? "desde: " + (A.unidades.slice().sort(function (a, b) { return a.precio - b.precio; })[0].nombre) : "", precio: A.precio, m2: A.m2 } : null);
    var f = u && window.__izpf ? window.__izpf.calcular(u.precio, window.__izpf.cfg(), A.obra) : null;
    var d = u && u.m2 && S.precio ? 100 * (u.precio / u.m2 / S.precio.zona.m2 - 1) : null;
    var rp = rutaPrincipal(S.coche), e = esencialesCerca(S.servicios), z = S.zona && S.zona.zonas[0];
    return {
      url: A.url + (unidad ? "#" + encodeURIComponent(unidad.nombre) : ""), id: A.id, fecha: new Date().toISOString().slice(0, 10),
      titulo: A.titulo, img: A.img, ubicacion: S.ub.items.slice(1, 3).join(", "), obraNueva: A.obra, coords: S.coords,
      unidad: u ? u.nombre : "", precio: u ? u.precio : null, m2: u ? u.m2 : null,
      eurM2: u && u.m2 ? Math.round(u.precio / u.m2) : null, vsZona: d != null ? Math.round(d) : null,
      precioFinal: f ? Math.round(f.final) : null, cash: f ? Math.round(f.liquido) : null,
      cuota: f ? Math.round(f.cuota) : null, esfuerzo: f && f.endeudamiento != null ? Math.round(f.endeudamiento * 10) / 10 : null,
      nota: P.total != null ? Math.round(P.total * 10) / 10 : null, notas: P.notas,
      zona: z ? (VERED[z.veredicto] || [z.veredicto])[0] + " · " + z.nombre : "",
      dana: S.inund ? (S.inund.danaDentro ? "Se inundó" : S.inund.danaCerca ? "Cerca" : "No") : "",
      patricova: S.inund ? (S.inund.patri[0] ? "Nivel " + S.inund.patri[0].nivel : S.inund.patriCerca[0] ? "Cerca" : "No") : "",
      rentaPersona: S.renta ? S.renta.rentaPersona : null, percentilRenta: S.renta ? S.renta.pctProv : null,
      servicios: e ? e.n + "/" + e.tot : "", supermercadoMin: S.servicios && S.servicios.mejor.super ? minAndando(S.servicios.mejor.super.m) : null,
      cocheMin: rp ? rp.min : null, cocheA: rp ? rp.n : "",
      precioZonaM2: S.precio ? S.precio.zona.m2 : null, varAnualZona: S.precio ? S.precio.zona.varAnual : null,
      alquilerZonaM2: S.precio && S.precio.alquiler ? S.precio.alquiler.m2 : null,
      apunte: ""
    };
  }
  function guardarItem(item) {
    var l = comparador();
    var i = -1;
    l.forEach(function (x, j) { if (x.url === item.url) i = j; });
    if (i >= 0) { item.apunte = l[i].apunte || ""; l[i] = item; } else l.push(item);
    lsSet(LS_CMP, l);
  }
  function alternarComparador() {
    var url = S.anuncio.url;
    if (enComparador(url)) lsSet(LS_CMP, comparador().filter(function (x) { return x.url !== url; }));
    else guardarItem(snapshot());
    pintar();
  }
  // lo usa precio-final.js para guardar UNA vivienda concreta de la tabla
  window.__izCmp = {
    guardarUnidad: function (u) {
      if (!S) return false;
      guardarItem(snapshot(u));
      actualizarFab();
      return true;
    },
    abrir: function () { abrirComparador(); }
  };

  function actualizarFab() {
    var n = comparador().length;
    var fab = document.getElementById("izk-fab");
    if (!n) { if (fab) fab.remove(); return; }
    if (!fab) {
      fab = document.createElement("button");
      fab.id = "izk-fab";
      fab.className = "izk-fab";
      fab.addEventListener("click", abrirComparador);
      document.body.appendChild(fab);
    }
    fab.innerHTML = "⚖ Comparador<b>" + n + "</b>";
  }

  // filas del comparador: [etiqueta, campo, formato, mejor ("max"|"min")]
  var FILAS_CMP = [
    ["Nota", "nota", function (v) { return v == null ? "—" : "<span class='nota'>" + fmtN(v, 1) + "</span>"; }, "max"],
    ["Tu zona", "zona"], ["DANA 2024", "dana"], ["PATRICOVA", "patricova"],
    ["Precio", "precio", fmtE, "min"], ["m²", "m2", function (v) { return v ? fmtN(v) + " m²" : "—"; }, "max"],
    ["€/m²", "eurM2", function (v) { return v ? fmtN(v) + " €" : "—"; }, "min"],
    ["vs media zona", "vsZona", function (v) { return v == null ? "—" : signo(v) + " %"; }, "min"],
    ["Precio final", "precioFinal", fmtE, "min"], ["Cash necesario", "cash", fmtE, "min"],
    ["Cuota/mes", "cuota", fmtE, "min"], ["Esfuerzo", "esfuerzo", function (v) { return fmtP(v); }, "min"],
    ["Renta/persona barrio", "rentaPersona", fmtE, "max"],
    ["Percentil renta prov.", "percentilRenta", function (v) { return v == null ? "—" : "P" + v; }, "max"],
    ["Servicios ≤ 10 min", "servicios"], ["Súper andando", "supermercadoMin", function (v) { return v == null ? "—" : v + " min"; }, "min"],
    ["En coche", "cocheMin", function (v, it) { return v == null ? "—" : v + " min" + (it.cocheA ? " <span style='color:#6b7280'>a " + esc(it.cocheA.replace(/\s*\(.*\)/, "")) + "</span>" : ""); }, "min"],
    ["€/m² zona", "precioZonaM2", function (v) { return v ? fmtN(v) + " €" : "—"; }],
    ["Subida anual zona", "varAnualZona", function (v) { return v == null ? "—" : signo(v, 1) + " %"; }, "min"],
    ["Guardado", "fecha"]
  ];

  function abrirComparador() {
    cerrarComparador();
    var l = comparador();
    var ov = document.createElement("div");
    ov.className = "izk-ov";
    ov.id = "izk-ov";
    var h = "<div class='izk-box'><div class='izk-head'><span class='t'>⚖ Comparador · " + l.length + " vivienda" + (l.length === 1 ? "" : "s") + "</span>" +
      "<button class='izk-csv'>Exportar CSV</button><button class='izk-json'>Exportar JSON</button><button class='izk-txt'>Copiar resumen</button>" +
      "<button class='izk-cerrar'>Cerrar ✕</button></div><div class='izk-body'>";
    if (!l.length) {
      h += "<div class='izk-vacio'>Aún no has guardado nada. En cada ficha, pulsa <b>☆ Guardar para comparar</b>.</div>";
    } else {
      h += "<table class='izk-t'><tr><th></th>" + l.map(function (it, i) {
        return "<td>" + (it.img ? "<img src='" + esc(it.img) + "' alt=''>" : "") +
          "<a href='" + esc(it.url) + "' target='_blank'>" + esc(it.titulo) + "</a><div style='color:#6b7280;font-size:12px'>" +
          esc(it.ubicacion) + (it.unidad ? " · " + esc(it.unidad) : "") + "</div>" +
          "<button class='rm' data-i='" + i + "'>quitar</button></td>";
      }).join("") + "</tr>";
      FILAS_CMP.forEach(function (f) {
        var vals = l.map(function (it) { return it[f[1]]; });
        var nums = vals.filter(function (v) { return typeof v === "number"; });
        var best = f[3] && nums.length > 1 ? (f[3] === "max" ? Math.max.apply(null, nums) : Math.min.apply(null, nums)) : null;
        h += "<tr><th>" + esc(f[0]) + "</th>" + l.map(function (it) {
          var v = it[f[1]];
          return "<td" + (best != null && v === best ? " class='best'" : "") + ">" + (f[2] ? f[2](v, it) : esc(v || "—")) + "</td>";
        }).join("") + "</tr>";
      });
      h += "<tr><th>Notas</th>" + l.map(function (it, i) {
        return "<td><textarea data-i='" + i + "' placeholder='vuestras impresiones…'>" + esc(it.apunte || "") + "</textarea></td>";
      }).join("") + "</tr></table>" +
        "<p style='font-size:12px;color:#6b7280;margin-top:8px'>En verde, lo mejor de cada fila. La nota pondera: tu zona ×2, inundación ×2, servicios ×1,5, conexión ×1,5, renta, precio y esfuerzo ×1.</p>";
    }
    h += "</div></div>";
    ov.innerHTML = h;
    ov.addEventListener("click", function (ev) {
      var t = ev.target;
      if (t === ov || t.closest(".izk-cerrar")) { cerrarComparador(); return; }
      if (t.closest(".rm")) {
        var l2 = comparador(); l2.splice(+t.getAttribute("data-i"), 1); lsSet(LS_CMP, l2);
        abrirComparador(); if (S) pintar(); else actualizarFab(); return;
      }
      if (t.closest(".izk-csv")) { descargar("comparador-idealista.csv", aCSV(comparador()), "text/csv"); return; }
      if (t.closest(".izk-json")) { descargar("comparador-idealista.json", JSON.stringify(comparador(), null, 2), "application/json"); return; }
      if (t.closest(".izk-txt")) {
        var txt = aTexto(comparador());
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () {
          t.textContent = "¡Copiado!";
        }).catch(function () { descargar("comparador-idealista.txt", txt, "text/plain"); });
      }
    });
    ov.addEventListener("input", function (ev) {
      var ta = ev.target;
      if (ta.tagName !== "TEXTAREA") return;
      var l3 = comparador(); l3[+ta.getAttribute("data-i")].apunte = ta.value; lsSet(LS_CMP, l3);
    });
    document.addEventListener("keydown", escCerrar);
    document.body.appendChild(ov);
  }
  function escCerrar(ev) { if (ev.key === "Escape") cerrarComparador(); }
  function cerrarComparador() {
    var ov = document.getElementById("izk-ov");
    if (ov) ov.remove();
    document.removeEventListener("keydown", escCerrar);
  }
  function aCSV(l) {
    var cols = ["titulo", "ubicacion", "unidad", "url", "nota", "zona", "dana", "patricova", "precio", "m2", "eurM2", "vsZona",
      "precioFinal", "cash", "cuota", "esfuerzo", "rentaPersona", "percentilRenta", "servicios", "supermercadoMin",
      "cocheMin", "cocheA", "precioZonaM2", "varAnualZona", "alquilerZonaM2", "apunte", "fecha"];
    function c(v) { v = v == null ? "" : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    // separador ";" y BOM: Excel en español lo abre bien a la primera
    return "﻿" + cols.join(";") + "\n" + l.map(function (it) {
      return cols.map(function (k) { return c(typeof it[k] === "number" ? String(it[k]).replace(".", ",") : it[k]); }).join(";");
    }).join("\n");
  }
  function aTexto(l) {
    return l.map(function (it, i) {
      return (i + 1) + ". " + it.titulo + (it.unidad ? " (" + it.unidad + ")" : "") + " — nota " + (it.nota != null ? fmtN(it.nota, 1) : "—") + "/10\n" +
        "   " + it.ubicacion + " · " + fmtE(it.precio) + " · " + (it.eurM2 ? fmtN(it.eurM2) + " €/m²" : "") +
        (it.vsZona != null ? " (" + signo(it.vsZona) + " % vs zona)" : "") + "\n" +
        "   Cash " + fmtE(it.cash) + " · cuota " + fmtE(it.cuota) + "/mes · DANA: " + (it.dana || "—") + " · PATRICOVA: " + (it.patricova || "—") + "\n" +
        "   Renta barrio " + fmtE(it.rentaPersona) + " (P" + (it.percentilRenta == null ? "—" : it.percentilRenta) + ") · servicios " + (it.servicios || "—") +
        " · coche " + (it.cocheMin != null ? it.cocheMin + " min" : "—") + "\n" +
        (it.apunte ? "   Notas: " + it.apunte + "\n" : "") + "   " + it.url;
    }).join("\n\n");
  }
  function descargar(nombre, contenido, tipo) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([contenido], { type: tipo + ";charset=utf-8" }));
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // =================================================================
  // ARRANQUE
  // =================================================================
  // dónde va la sección: tras la tabla de unidades (obra nueva) o tras el
  // bloque de características (segunda mano)
  function anclaje() {
    var cont = document.querySelector(".detail-container") || document.querySelector("main");
    if (!cont) return null;
    function hijoDirecto(el) {
      while (el && el.parentElement !== cont) el = el.parentElement;
      return el;
    }
    var cands = [".table.ide-box-detail", ".details-property", ".comment", ".info-features", ".promo-info"];
    for (var i = 0; i < cands.length; i++) {
      var el = cont.querySelector(cands[i]);
      var h = el && hijoDirecto(el);
      if (h) return { padre: cont, despues: h };
    }
    var aside = cont.querySelector(":scope > aside");
    return { padre: cont, antes: aside };
  }

  function fin() {
    pintar();
    // guarda el resultado actualizado si la vivienda ya estaba en el comparador
    if (S && enComparador(S.anuncio.url)) guardarItem(snapshot());
    window.__izZona = S && S.precio ? { m2: S.precio.zona.m2, nombre: S.precio.zona.nombre, alquilerM2: S.precio.alquiler && S.precio.alquiler.m2, obra: S.anuncio.obra } : null;
    try { window.dispatchEvent(new CustomEvent("iz_zona")); } catch (e) {}
  }

  var arrancadaPara = null;
  function arrancar() {
    actualizarFab();
    var m = location.pathname.match(RE_DETALLE);
    if (!m) return;
    if (arrancadaPara === location.pathname && document.getElementById("izb")) return;
    var coords = coordenadas();
    var an = anclaje();
    if (!coords || !an) return; // aún no ha cargado: los reintentos lo volverán a intentar
    arrancadaPara = location.pathname;
    ponerCSS();
    var box = document.getElementById("izb");
    if (!box) {
      box = document.createElement("section");
      box.id = "izb";
      box.className = "izb ide-box-detail overlay-box";
      if (an.despues) an.despues.insertAdjacentElement("afterend", box);
      else an.padre.insertBefore(box, an.antes || null);
      box.addEventListener("click", onClick);
      box.addEventListener("change", onChange);
      box.addEventListener("keydown", onKey);
    }
    var ub = ubicacion();
    S = { coords: coords, ub: ub, anuncio: datosAnuncio(), err: {},
          zona: zonaPropia(coords.lat, coords.lng), inund: null, renta: null, servicios: null, coche: null, precio: null };
    log("v" + VERSION + " en " + coords.lat + "," + coords.lng + " · " + ub.items.join(" | "));
    pintar();

    function lanzar(k, p) {
      p.then(function (v) { S[k] = v; fin(); })
       .catch(function (e) { S.err[k] = e.message || String(e); log(k + ": " + S.err[k]); fin(); });
    }
    lanzar("inund", inundacion(coords.lat, coords.lng));
    lanzar("renta", renta(coords.lat, coords.lng));
    lanzar("precio", precioZona(ub));
    // los servicios dan el hospital más cercano, que luego va a la ruta en coche
    recargarCoche();
    servicios(coords.lat, coords.lng).then(function (s) { S.servicios = s; fin(); if (s.mejor.hospital) recargarCoche(); })
      .catch(function (e) { S.err.servicios = e.message; fin(); });
    // la tabla de unidades llega tarde: refrescar precio/m² cuando aparezca
    setTimeout(function () { if (S) { S.anuncio = datosAnuncio(); fin(); } }, 2500);
  }

  // cambios de la simulación (entrada, plazo…) en precio-final.js
  window.addEventListener("iz_cfg", function () { if (S) pintar(); });
  window.addEventListener("iz_urlchange", arrancar);

  function iniciar() {
    arrancar();
    [800, 2000, 4000, 8000].forEach(function (ms) { setTimeout(arrancar, ms); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
