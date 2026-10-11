// =========================================================================
// capas.js — panel "Capas" sobre los mapas de Google de idealista.
//
//   · Mis zonas (verde/rojo de zonas.js + demografía) — lo pinta hook.js;
//     aquí solo se integra su interruptor (window.__izZonas)
//   · DANA 2024 · zona inundada        (WMS Institut Cartogràfic Valencià)
//   · Riesgo de inundación PATRICOVA    (ArcGIS REST, GVA)
//   · Renta por sección censal          (INE, ADRH 2023) — zoom ≥ 11
//   · Pisos turísticos por sección      (INE, mayo 2026) — zoom ≥ 11
//   · Peligrosidad: criminalidad oficial por municipio (Interior; criminalidad/
//     municipios.json) con selector de tipo (hurtos, robos…) — zoom ≥ 9
//   · Población extranjera: continente predominante por municipio (padrón;
//     extranjeros/municipios.json) o % por sección (INE, censo 2025)
//   · Supermercados y estaciones        (OpenStreetMap: copia local o Overpass) — zoom ≥ 14
//
// Se ejecuta en el mundo MAIN, después de hook.js (usa window.__izMapas, que
// rellena hook.js con cada google.maps.Map que crea idealista). Sin permisos:
// todos los servicios responden con CORS abierto.
// =========================================================================
(function () {
  "use strict";
  if (window.__izCapas) return;
  window.__izCapas = true; // hook.js oculta su botón: este panel lo sustituye

  var LS_ON = "iz_capas_on";       // { idCapa: true/false }
  var LS_PLEGADO = "iz_capas_plegado";

  function leerOn() {
    try { return JSON.parse(localStorage.getItem(LS_ON) || "{}") || {}; } catch (e) { return {}; }
  }
  function capaOn(id) { return !!leerOn()[id]; }
  function guardarOn(id, v) {
    var o = leerOn(); o[id] = v;
    try { localStorage.setItem(LS_ON, JSON.stringify(o)); } catch (e) {}
  }
  function plegado() {
    try { return localStorage.getItem(LS_PLEGADO) === "1"; } catch (e) { return false; }
  }
  function log(m) { try { console.log("[idealista-zonas/capas] " + m); } catch (e) {} }
  function fmtEur(n) {
    try { return Math.round(n).toLocaleString("es-ES") + " €"; } catch (e) { return Math.round(n) + " €"; }
  }
  function fmtPct(n) { return (Math.round(n * 10) / 10).toString().replace(".", ",") + " %"; }
  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ------------------------------------------------------- servicios
  var DANA_WMS = "https://terramapas.icv.gva.es/00_DANA2024";
  var DANA_CAPA = "DANA2024.ZonasInundadas.HuellaInundacion";
  var PATRI = "https://carto.icv.gva.es/arcgis/rest/services/tm_infraestructuras/ordenacion_territorial/MapServer";
  var PATRI_CAPAS = [4, 5, 6, 7, 8, 9, 10];
  var INE = "https://www.ine.es/servergis/rest/services/Hosted/";
  var INE_RENTA = INE + "ADRH_2023_Renta_media_por_persona/FeatureServer/3/query";
  var INE_TUR = INE + encodeURIComponent("Porcentaje_de_viviendas_turísticas_sobre_el_total_de_viviendas_2026M05") +
    "/FeatureServer/3/query";
  // Overpass se satura a menudo (504): probamos varios servidores en orden
  var OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
  ];
  function overpass(q) {
    var i = 0;
    function intento() {
      var url = OVERPASS[i];
      return fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q),
        headers: { "Content-Type": "application/x-www-form-urlencoded" } })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .catch(function (e) {
          if (++i < OVERPASS.length) return intento();
          throw e;
        });
    }
    return intento();
  }

  // tramos (paleta secuencial viridis: oscuro = renta baja, amarillo = alta)
  var TRAMOS_RENTA = [
    [10000, "#440154", "< 10.000 €"],
    [12500, "#414487", "10.000–12.500 €"],
    [15000, "#2a788e", "12.500–15.000 €"],
    [18000, "#22a884", "15.000–18.000 €"],
    [22000, "#7ad151", "18.000–22.000 €"],
    [1 / 0, "#fde725", "> 22.000 €"]
  ];
  var TRAMOS_TUR = [
    [1, "#fdd0a2", "< 1 %"],
    [3, "#fdae6b", "1–3 %"],
    [6, "#fd8d3c", "3–6 %"],
    [10, "#e6550d", "6–10 %"],
    [1 / 0, "#a63603", "> 10 %"]
  ];
  function colorTramo(tramos, v) {
    for (var i = 0; i < tramos.length; i++) if (v < tramos[i][0]) return tramos[i][1];
    return tramos[tramos.length - 1][1];
  }

  // --------------------------------------------- utilidades mercator
  var R = 6378137, ORIGEN = Math.PI * R;
  function bboxTesela(coord, zoom) {
    var n = Math.pow(2, zoom), tam = 2 * ORIGEN / n;
    var minx = -ORIGEN + coord.x * tam, maxy = ORIGEN - coord.y * tam;
    return [minx, maxy - tam, minx + tam, maxy];
  }
  function normalizarX(coord, zoom) {
    var n = Math.pow(2, zoom);
    return { x: ((coord.x % n) + n) % n, y: coord.y };
  }

  // ------------------------------------------------- capas de teselas
  function capaTeselas(urlDe, opacidad) {
    return new google.maps.ImageMapType({
      tileSize: new google.maps.Size(256, 256),
      opacity: opacidad,
      getTileUrl: function (coord, zoom) {
        var n = Math.pow(2, zoom);
        if (coord.y < 0 || coord.y >= n || zoom < 7) return null;
        return urlDe(bboxTesela(normalizarX(coord, zoom), zoom));
      }
    });
  }
  // Teselas recoloreadas en canvas: el WMS de la DANA pinta un azul pálido
  // con alfa 0,33 que casi no se ve. Repintamos cada píxel con color propio
  function capaTeselasCanvas(urlDe, recolor) {
    function MT() {}
    MT.prototype.tileSize = new google.maps.Size(256, 256);
    MT.prototype.maxZoom = 22;
    MT.prototype.getTile = function (coord, zoom, doc) {
      var cv = doc.createElement("canvas");
      cv.width = 256; cv.height = 256;
      cv.style.width = "256px"; cv.style.height = "256px";
      var n = Math.pow(2, zoom);
      if (coord.y < 0 || coord.y >= n || zoom < 7) return cv;
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        try {
          var cx = cv.getContext("2d");
          cx.drawImage(img, 0, 0, 256, 256);
          var d = cx.getImageData(0, 0, 256, 256), a = d.data;
          for (var i = 0; i < a.length; i += 4) {
            if (a[i + 3]) recolor(a, i);
          }
          cx.putImageData(d, 0, 0);
        } catch (e) { /* sin CORS: se queda la imagen tal cual */ }
      };
      img.src = urlDe(bboxTesela(normalizarX(coord, zoom), zoom));
      return cv;
    };
    MT.prototype.releaseTile = function () {};
    return new MT();
  }
  function recolorDana(a, i) {
    if (a[i + 3] > 200) { a[i] = 30; a[i + 1] = 64; a[i + 2] = 175; a[i + 3] = 230; } // contorno
    else { a[i] = 37; a[i + 1] = 99; a[i + 2] = 235; a[i + 3] = 120; }               // relleno
  }

  function urlDana(b) {
    return DANA_WMS + "?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=" + DANA_CAPA +
      "&STYLES=&SRS=EPSG:3857&BBOX=" + b.join(",") +
      "&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true";
  }
  function urlPatri(b) {
    return PATRI + "/export?bbox=" + b.join(",") + "&bboxSR=3857&imageSR=3857&size=256,256" +
      "&layers=show:" + PATRI_CAPAS.join(",") + "&transparent=true&format=png32&f=image";
  }

  // leyenda oficial de PATRICOVA (imágenes del propio servicio)
  var leyendaPatri = null;
  function cargarLeyendaPatri(cb) {
    if (leyendaPatri) return cb(leyendaPatri);
    fetch(PATRI + "/legend?f=json").then(function (r) { return r.json(); }).then(function (d) {
      leyendaPatri = [];
      (d.layers || []).forEach(function (l) {
        if (PATRI_CAPAS.indexOf(l.layerId) === -1 || !l.legend || !l.legend[0]) return;
        leyendaPatri.push({
          img: "data:" + (l.legend[0].contentType || "image/png") + ";base64," + l.legend[0].imageData,
          nombre: l.layerName.split("|")[0].trim()
        });
      });
      cb(leyendaPatri);
    }).catch(function () { cb([]); });
  }
  var TXT_PATRI = {
    "Peligrosidad 1": "1 · frecuente (25 años), calado > 0,8 m",
    "Peligrosidad 2": "2 · media (100 años), calado > 0,8 m",
    "Peligrosidad 3": "3 · frecuente (25 años), calado < 0,8 m",
    "Peligrosidad 4": "4 · media (100 años), calado < 0,8 m",
    "Peligrosidad 5": "5 · baja (500 años), calado > 0,8 m",
    "Peligrosidad 6": "6 · baja (500 años), calado < 0,8 m",
    "Peligrosidad Geomorfológica": "Geomorfológica (llanura de inundación)"
  };

  // ---------------------------------------------- capas vectoriales INE
  // Se piden por celdas fijas de 0,05° (cada celda una vez) y solo con zoom
  // suficiente: así mover el mapa no repite consultas. OJO: la vista normal de
  // una ciudad en idealista es zoom 12 (~0,4° de ancho): tiene que caber ahí
  var CELDA = 0.05;
  function celdasVisibles(map, celda) {
    var b = map.getBounds(), C = celda || CELDA;
    if (!b) return [];
    var sw = b.getSouthWest(), ne = b.getNorthEast(), out = [];
    var x0 = Math.floor(sw.lng() / C), x1 = Math.floor(ne.lng() / C);
    var y0 = Math.floor(sw.lat() / C), y1 = Math.floor(ne.lat() / C);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 80) return null; // demasiado alejado
    for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) out.push([x, y]);
    return out;
  }

  function CapaINE(def) {
    this.def = def;
    this.datos = new Map();   // map -> google.maps.Data
    this.celdas = new Map();  // map -> Set("x,y")
    this.vistos = new Map();  // map -> Set(cusec)
    this.cargando = 0;
  }
  CapaINE.prototype.dataDe = function (map) {
    var d = this.datos.get(map), self = this;
    if (d) return d;
    d = new google.maps.Data();
    d.setStyle(function (f) { return self.estiloDe(f); });
    this.datos.set(map, d);
    return this.engancharEventos(map, d);
  };
  CapaINE.prototype.estiloDe = function (f) {
    if (this.def.estilo) return this.def.estilo(f);
    var v = f.getProperty(this.def.campo);
    var sin = v == null;
    return {
      fillColor: sin ? "#9ca3af" : colorTramo(this.def.tramos, v),
      fillOpacity: sin ? 0.12 : 0.5,
      strokeColor: "#ffffff", strokeOpacity: 0.7, strokeWeight: 0.6,
      zIndex: 5
    };
  };
  CapaINE.prototype.engancharEventos = function (map, d) {
    var self = this;
    d.addListener("mouseover", function (e) {
      d.overrideStyle(e.feature, { strokeColor: "#111", strokeWeight: 2, strokeOpacity: 1 });
      panelLectura(self.def.texto(e.feature));
    });
    d.addListener("mouseout", function (e) {
      d.revertStyle(e.feature);
      panelLectura("");
    });
    var info = new google.maps.InfoWindow();
    this.info = info;
    d.addListener("click", function (e) {
      info.setContent("<div style='font:13px/1.4 inherit;max-width:" + (self.def.anchoInfo || 240) + "px'>" + self.def.texto(e.feature, true) + "</div>");
      info.setPosition(e.latLng);
      info.open({ map: map });
    });
    this.mapas = this.mapas || [];
    this.mapas.push(map);
    this.celdas.set(map, new Set());
    this.vistos.set(map, new Set());
    return d;
  };
  // repinta con el estilo actual (al cambiar un selector o llegar datos locales)
  CapaINE.prototype.restilar = function () {
    var self = this;
    (this.mapas || []).forEach(function (m) {
      var d = self.datos.get(m);
      if (d) d.setStyle(function (f) { return self.estiloDe(f); }); // función nueva = repintar
    });
  };
  CapaINE.prototype.mostrar = function (map, on) {
    var d = this.dataDe(map);
    if (on && this.def.alEncender) this.def.alEncender(this);
    d.setMap(on ? map : null);
    if (!on) { try { this.info.close(); } catch (e) {} panelLectura(""); }
    if (on) this.refrescar(map);
  };
  CapaINE.prototype.on = function () { return this.def.activa ? this.def.activa() : capaOn(this.def.id); };
  CapaINE.prototype.refrescar = function (map) {
    if (!this.on()) return;
    var z = map.getZoom() || 0;
    if (z < this.def.zoomMin) { estadoCapa(this.def.id, "acerca el mapa (zoom ≥ " + this.def.zoomMin + ")"); return; }
    var C = this.def.celda || CELDA, clave = this.def.clave || "cusec";
    var celdas = celdasVisibles(map, C);
    if (!celdas) { estadoCapa(this.def.id, "acerca un poco el mapa para verla"); return; }
    var hechas = this.celdas.get(map), self = this;
    var nuevas = celdas.filter(function (c) { return !hechas.has(c.join(",")); });
    if (!nuevas.length) { estadoCapa(this.def.id, ""); return; }
    nuevas.forEach(function (c) {
      hechas.add(c.join(","));
      var env = [c[0] * C, c[1] * C, (c[0] + 1) * C, (c[1] + 1) * C].map(function (n) {
        return n.toFixed(5);
      }).join(",");
      var url = self.def.url + "?geometry=" + env + "&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326" +
        "&spatialRel=esriSpatialRelIntersects&outFields=" + encodeURIComponent(self.def.campos) +
        "&returnGeometry=true&maxAllowableOffset=" + (z >= 14 ? 0.00008 : z >= 12 ? 0.0002 : z >= 10 ? 0.0004 : 0.001) +
        "&geometryPrecision=5&f=geojson";
      self.cargando++;
      estadoCapa(self.def.id, "cargando…", true);
      fetch(url).then(function (r) { return r.json(); }).then(function (gj) {
        var vistos = self.vistos.get(map);
        var feats = (gj.features || []).filter(function (f) {
          var k = f.properties && f.properties[clave];
          if (!k || vistos.has(k)) return false;
          vistos.add(k); return true;
        });
        if (feats.length) self.dataDe(map).addGeoJson({ type: "FeatureCollection", features: feats });
      }).catch(function (e) {
        hechas.delete(c.join(",")); // reintentar en el próximo movimiento
        log(self.def.id + ": " + e.message);
      }).then(function () {
        self.cargando--;
        if (!self.cargando) estadoCapa(self.def.id, "");
      });
    });
  };

  var capaRenta = new CapaINE({
    id: "renta", url: INE_RENTA, campos: "cusec,nmun,dato1", campo: "dato1",
    tramos: TRAMOS_RENTA, zoomMin: 11,
    texto: function (f) {
      var v = f.getProperty("dato1");
      return "<b>" + (v == null ? "sin dato (secreto estadístico)" : fmtEur(v) + "/persona·año") + "</b><br>" +
        "<span style='color:#64748b'>Renta neta media · " + esc(f.getProperty("nmun")) +
        " · sección " + esc(f.getProperty("cusec")) + " (INE 2023)</span>";
    }
  });
  var capaTur = new CapaINE({
    id: "turisticos", url: INE_TUR, campos: "cusec,nmun,porcentaje_vivienda_turistica,vivienda_turistica",
    campo: "porcentaje_vivienda_turistica", tramos: TRAMOS_TUR, zoomMin: 11,
    texto: function (f) {
      var v = f.getProperty("porcentaje_vivienda_turistica"), n = f.getProperty("vivienda_turistica");
      return "<b>" + (v == null ? "sin pisos turísticos" : fmtPct(v) + " de las viviendas") + "</b>" +
        (n ? " (" + n + ")" : "") + "<br><span style='color:#64748b'>Pisos turísticos · " +
        esc(f.getProperty("nmun")) + " · sección " + esc(f.getProperty("cusec")) + " (INE, may-2026)</span>";
    }
  });

  // ------------------------------------------- datos locales de la extensión
  // (puente.js deja la URL de la extensión en <html data-izext>)
  var locales = {};
  function jsonLocal(ruta) {
    var base = document.documentElement.getAttribute("data-izext") || window.__IZ_TEST_EXT;
    if (!base) return Promise.resolve(null);
    if (!locales[ruta]) {
      locales[ruta] = { d: null, p: null };
      locales[ruta].p = fetch(base + ruta).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (d) { locales[ruta].d = d; return d; })
        .catch(function (e) { log(ruta + ": " + e.message); delete locales[ruta]; return null; });
    }
    return locales[ruta].p;
  }
  function yaLocal(ruta) { return locales[ruta] ? locales[ruta].d : null; }
  function fmtN(n) { try { return Math.round(n).toLocaleString("es-ES"); } catch (e) { return String(Math.round(n)); } }
  function fmtDec(n) { return (Math.round(n * 10) / 10).toString().replace(".", ","); }

  // --------------------------------------------- población extranjera
  // % por sección censal (INE, Censo anual 2025) y reparto por continente del
  // municipio (padrón 2022, extranjeros/municipios.json — generar_extranjeros.py)
  var INE_CENSO = INE + "Censo_2025___Porcentaje_de_extranjeros/FeatureServer/";
  var R_EXT = "extranjeros/municipios.json";
  var TRAMOS_EXT = [
    [5, "#e0ecf4", "< 5 %"],
    [10, "#9ebcda", "5–10 %"],
    [15, "#8c96c6", "10–15 %"],
    [25, "#8856a7", "15–25 %"],
    [1 / 0, "#810f7c", "> 25 %"]
  ];
  // continentes de origen (claves de extranjeros/municipios.json → "c")
  var ORIGENES_EXT = [
    ["eu", "Europa", "#2563eb"],
    ["af", "África", "#f97316"],
    ["am", "Latinoamérica", "#16a34a"],
    ["as", "Asia", "#e11d48"],
    ["oc", "Oceanía y otros", "#9ca3af"]
  ];
  var COLOR_ORIGEN = {};
  ORIGENES_EXT.forEach(function (o) { COLOR_ORIGEN[o[0]] = o[2]; });
  // reparto por continente de un municipio: [[clave, n], …] de mayor a menor
  function origenesDe(m) {
    var c = m.c || {};
    return ORIGENES_EXT.map(function (o) { return [o[0], c[o[0]] || 0]; })
      .filter(function (x) { return x[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; });
  }
  function nombreOrigen(k) { return (ORIGENES_EXT.filter(function (o) { return o[0] === k; })[0] || ["", k])[1]; }
  // bloque "extranjeros por continente" de un municipio
  function htmlTop5(cumun) {
    var d = yaLocal(R_EXT), m = d && d.municipios[cumun];
    if (!m) return d ? "" : "<div style='color:#64748b;font-size:11px'>cargando…</div>";
    if (!m.e) return "<div style='color:#64748b;font-size:11px'>Sin extranjeros empadronados en " + d.anio + ".</div>";
    var org = origenesDe(m), c = m.c || {};
    var h = "<div style='margin-top:6px;font-size:11px;color:#475569'>" + esc(m.n) + ": " + fmtN(m.e) +
      " extranjeros (" + fmtPct(100 * m.e / m.t) + " de la población) · por continente</div>" +
      "<div style='display:flex;height:10px;border-radius:5px;overflow:hidden;margin:3px 0 4px'>" +
      org.map(function (o) {
        return "<span title='" + nombreOrigen(o[0]) + "' style='width:" + (100 * o[1] / m.e).toFixed(1) + "%;background:" + COLOR_ORIGEN[o[0]] + "'></span>";
      }).join("") + "</div>";
    var max = org.length ? org[0][1] : 1;
    org.forEach(function (o, i) {
      var p = 100 * o[1] / m.e;
      var det = o[0] === "eu" && c.ue != null ? " <span style='color:#94a3b8;font-size:10px'>(UE " + Math.round(100 * c.ue / o[1]) + "%)</span>" : "";
      h += "<div style='display:flex;align-items:center;gap:6px;font-size:12px;margin-top:2px'>" +
        "<span style='width:12px;text-align:right;color:#94a3b8'>" + (i + 1) + "</span>" +
        "<span style='width:8px;height:8px;border-radius:2px;flex:none;background:" + COLOR_ORIGEN[o[0]] + "'></span>" +
        "<span style='width:112px;white-space:nowrap'>" + nombreOrigen(o[0]) + det + "</span>" +
        "<span style='flex:1;height:7px;background:#f1f5f9;border-radius:4px;overflow:hidden'>" +
        "<span style='display:block;height:100%;width:" + Math.max(4, 100 * o[1] / max).toFixed(0) + "%;background:" + COLOR_ORIGEN[o[0]] + "'></span></span>" +
        "<span style='width:76px;text-align:right;color:#334155;white-space:nowrap'>" + fmtN(o[1]) + " · <b>" + Math.round(p) + "%</b></span></div>";
    });
    return h + "<div style='margin-top:4px;font-size:10px;color:#94a3b8'>% sobre el total de extranjeros · padrón " + d.anio + " (INE)</div>";
  }

  // modo: "origen" (municipio, color = continente predominante) | "c:af"… (municipio,
  // % de la población de ese continente, en su color) | "pct" (sección, % extranjeros)
  var LS_EXT = "iz_capas_ext_modo";
  function modoExt() {
    var v = null;
    try { v = localStorage.getItem(LS_EXT); } catch (e) {}
    return v === "pct" || /^c:(eu|af|am|as)$/.test(v || "") ? v : "origen";
  }
  function modoMunicipal() { return modoExt() !== "pct"; }
  // tramos del % de población de un continente: [hasta, opacidad, texto]
  var TRAMOS_CONT = [[1, 0.1, "< 1 %"], [3, 0.28, "1–3 %"], [6, 0.45, "3–6 %"], [10, 0.62, "6–10 %"], [1 / 0, 0.82, "> 10 %"]];
  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function legendaExt(mo) {
    if (mo === "pct") {
      return TRAMOS_EXT.map(function (t) {
        return "<div class='it'><span class='c' style='background:" + t[1] + "'></span>" + t[2] + "</div>";
      }).join("") + "<div class='nota'>% de extranjeros por sección censal (censo 2025). Zoom ≥ 11. Pulsa una para ver el reparto del municipio.</div>";
    }
    if (mo.indexOf("c:") === 0) {
      var k = mo.slice(2), col = COLOR_ORIGEN[k];
      return "<div class='nota' style='margin:2px 0 3px'>% de la población con nacionalidad de " + nombreOrigen(k) + ":</div>" +
        TRAMOS_CONT.map(function (t) {
          return "<div class='it'><span class='c' style='background:" + rgba(col, t[1]) + "'></span>" + t[2] + "</div>";
        }).join("") + "<div class='nota'>Por municipio (padrón). Pulsa uno para ver el reparto por continente.</div>";
    }
    return ORIGENES_EXT.slice(0, 4).map(function (o) {
      return "<div class='it'><span class='c' style='background:" + o[2] + "'></span>" + o[1] + "</div>";
    }).join("") + "<div class='nota'>Color = continente de origen más numeroso del municipio; más intenso = más % de extranjeros. Pulsa uno para ver el reparto.</div>";
  }
  var capaExt = new CapaINE({
    id: "extranjeros", url: INE_CENSO + "2/query", campos: "cusec,cumun,nmun,porc_ext,porc_nac_ext,n_personas",
    campo: "porc_ext", tramos: TRAMOS_EXT, zoomMin: 11, anchoInfo: 300,
    activa: function () { return capaOn("extranjeros") && modoExt() === "pct"; },
    alEncender: function (capa) { jsonLocal(R_EXT).then(function () { capa.restilar(); }); },
    texto: function (f) {
      var v = f.getProperty("porc_ext"), nac = f.getProperty("porc_nac_ext"), n = f.getProperty("n_personas");
      return "<b>" + (v == null ? "sin dato" : fmtPct(v) + " extranjeros") + "</b>" +
        (nac != null ? " · " + fmtPct(nac) + " nacidos fuera" : "") +
        "<br><span style='color:#64748b'>" + esc(f.getProperty("nmun")) + " · sección " + esc(f.getProperty("cusec")) +
        (n ? " · " + fmtN(n) + " hab." : "") + " (INE, censo 2025)</span>" +
        htmlTop5(f.getProperty("cumun"));
    }
  });
  var capaExtOrigen = new CapaINE({
    id: "extranjeros", url: INE_CENSO + "1/query", campos: "cumun,nmun,porc_ext", clave: "cumun",
    celda: 0.5, zoomMin: 9, anchoInfo: 300,
    activa: function () { return capaOn("extranjeros") && modoMunicipal(); },
    alEncender: function (capa) { jsonLocal(R_EXT).then(function () { capa.restilar(); }); },
    estilo: function (f) {
      var d = yaLocal(R_EXT), m = d && d.municipios[f.getProperty("cumun")];
      var org = m && m.e ? origenesDe(m) : [], mo = modoExt();
      if (mo.indexOf("c:") === 0 && m && m.t) {
        var k = mo.slice(2), pc = 100 * ((m.c || {})[k] || 0) / m.t;
        for (var i = 0; i < TRAMOS_CONT.length && pc >= TRAMOS_CONT[i][0]; i++) {}
        return { fillColor: COLOR_ORIGEN[k], fillOpacity: TRAMOS_CONT[Math.min(i, TRAMOS_CONT.length - 1)][1],
          strokeColor: "#ffffff", strokeOpacity: 0.9, strokeWeight: 1, zIndex: 4 };
      }
      if (!org.length) return { fillColor: "#9ca3af", fillOpacity: 0.06, strokeColor: "#6b7280", strokeOpacity: 0.4, strokeWeight: 0.6, zIndex: 4 };
      // intensidad = % de extranjeros (censo 2025 si está; si no, padrón)
      var pct = f.getProperty("porc_ext");
      if (pct == null) pct = 100 * m.e / m.t;
      return { fillColor: COLOR_ORIGEN[org[0][0]], fillOpacity: Math.min(0.8, 0.12 + pct / 40),
        strokeColor: "#ffffff", strokeOpacity: 0.9, strokeWeight: 1, zIndex: 4 };
    },
    texto: function (f, completo) {
      var d = yaLocal(R_EXT), m = d && d.municipios[f.getProperty("cumun")], pct = f.getProperty("porc_ext");
      var org = m && m.e ? origenesDe(m) : [];
      var h = "<b>" + esc(f.getProperty("nmun")) + "</b>" + (pct != null ? " · " + fmtPct(pct) + " extranjeros (censo 2025)" : "");
      var mo = modoExt();
      if (mo.indexOf("c:") === 0 && m && m.t) {
        var k = mo.slice(2), nk = (m.c || {})[k] || 0;
        h += "<br><b style='font-size:15px;color:" + COLOR_ORIGEN[k] + "'>" + fmtPct(100 * nk / m.t) + "</b> de la población es de " +
          nombreOrigen(k) + " (" + fmtN(nk) + " personas)";
      } else if (org.length) h += "<br>Predomina <b style='color:" + COLOR_ORIGEN[org[0][0]] + "'>" + nombreOrigen(org[0][0]) + "</b> (" +
        Math.round(100 * org[0][1] / m.e) + "% de los extranjeros)";
      return h + htmlTop5(f.getProperty("cumun")) +
        (completo ? "" : "<div style='font-size:11px;color:#64748b'>Acerca y cambia a «% por sección» para ver barrio a barrio</div>");
    }
  });

  // ------------------------------------------------- criminalidad oficial
  // Por MUNICIPIO (Interior solo publica los de más de 20.000 habitantes):
  // color = tasa del tipo elegido frente a la media de España
  var R_CRIM = "criminalidad/municipios.json";
  var LS_CRIM = "iz_capas_crim_tipo";
  var TIPOS_CRIM = [
    ["total", "Toda la criminalidad"], ["hurtos", "Hurtos"], ["robo_fuerza", "Robos con fuerza"],
    ["robo_domicilio", "Robos en viviendas"], ["robo_violencia", "Robos con violencia"],
    ["vehiculos", "Robo de vehículos"], ["lesiones", "Lesiones"], ["sexual", "Delitos sexuales"],
    ["drogas", "Tráfico de drogas"], ["ciber", "Cibercriminalidad"]
  ];
  var TRAMOS_CRIM = [
    [0.6, "#1a9850", "mucho menos (< 0,6×)"],
    [0.85, "#91cf60", "menos (0,6–0,85×)"],
    [1.15, "#fee08b", "como la media (±15 %)"],
    [1.5, "#fc8d59", "más (1,15–1,5×)"],
    [1 / 0, "#d73027", "mucho más (> 1,5×)"]
  ];
  function tipoCrim() {
    var t = null;
    try { t = localStorage.getItem(LS_CRIM); } catch (e) {}
    return TIPOS_CRIM.some(function (x) { return x[0] === t; }) ? t : "total";
  }
  function nombreTipo(t) { return (TIPOS_CRIM.filter(function (x) { return x[0] === t; })[0] || ["", t])[1]; }
  // { tasa, esp, prov, n, anio, ratio, serie[] } del municipio para el tipo
  function datoCrim(cumun, tipo) {
    var d = yaLocal(R_CRIM), m = d && d.municipios[cumun];
    if (!m) return null;
    var anios = Object.keys(m.anual).sort(), ult = anios[anios.length - 1], a = m.anual[ult];
    if (!a || a.tasa[tipo] == null) return null;
    var E = d.espana || {}, P = (d.provincias || {})[m.prov];
    var esp = E[ult] && E[ult].tasa[tipo], prov = P && P.anual[ult] && P.anual[ult].tasa[tipo];
    var ant = anios[anios.length - 2], var1 = ant && m.anual[ant].n[tipo] ? 100 * (a.n[tipo] / m.anual[ant].n[tipo] - 1) : null;
    return {
      nombre: m.nombre, anio: ult, tasa: a.tasa[tipo], n: a.n[tipo], pob: a.pob, esp: esp, prov: prov,
      provNombre: P ? (P.nombre === P.nombre.toUpperCase() ? P.nombre.toLowerCase().replace(/(^|[\s\/-])\S/g, function (c) { return c.toUpperCase(); }) : P.nombre) : "", ratio: esp ? a.tasa[tipo] / esp : null, var1: var1,
      serie: anios.map(function (y) {
        return { periodo: y, tasa: m.anual[y].tasa[tipo],
          tasaProv: P && P.anual[y] ? P.anual[y].tasa[tipo] : null, tasaEsp: E[y] ? E[y].tasa[tipo] : null };
      })
    };
  }
  var capaCrim = new CapaINE({
    id: "criminalidad", url: INE_CENSO + "1/query", campos: "cumun,nmun", clave: "cumun",
    celda: 0.5, zoomMin: 9, anchoInfo: 290,
    alEncender: function (capa) { jsonLocal(R_CRIM).then(function () { capa.restilar(); }); },
    estilo: function (f) {
      var x = datoCrim(f.getProperty("cumun"), tipoCrim());
      if (!x || x.ratio == null) {
        return { fillColor: "#9ca3af", fillOpacity: 0.06, strokeColor: "#6b7280", strokeOpacity: 0.5, strokeWeight: 0.6, zIndex: 4 };
      }
      return { fillColor: colorTramo(TRAMOS_CRIM, x.ratio), fillOpacity: 0.5,
        strokeColor: "#ffffff", strokeOpacity: 0.9, strokeWeight: 1, zIndex: 4 };
    },
    texto: function (f, completo) {
      var tipo = tipoCrim(), x = datoCrim(f.getProperty("cumun"), tipo);
      var nom = esc(f.getProperty("nmun"));
      if (!yaLocal(R_CRIM)) return "<b>" + nom + "</b><br><span style='color:#64748b'>cargando criminalidad…</span>";
      if (!x) return "<b>" + nom + "</b><br><span style='color:#64748b'>Sin dato oficial: Interior solo publica municipios de más de 20.000 habitantes.</span>";
      var h = "<b>" + esc(x.nombre) + " · " + esc(nombreTipo(tipo)) + "</b><br>" +
        "<span style='font-size:15px;font-weight:700'>" + fmtDec(x.tasa) + " ‰</span> " +
        "<span style='color:#64748b'>(" + fmtN(x.n) + " en " + x.anio + ")</span>" +
        (x.ratio != null ? "<br><b style='color:" + (x.ratio >= 1.15 ? "#b91c1c" : x.ratio < 0.85 ? "#15803d" : "#a16207") + "'>" +
          fmtDec(x.ratio) + "× la media de España</b> (" + fmtDec(x.esp) + " ‰)" : "") +
        (x.prov ? "<br><span style='color:#64748b'>Provincia de " + esc(x.provNombre) + ": " + fmtDec(x.prov) + " ‰</span>" : "") +
        (x.var1 != null ? "<br><span style='color:" + (x.var1 > 0 ? "#b91c1c" : "#15803d") + "'>" +
          (x.var1 > 0 ? "▲ +" : "▼ ") + fmtDec(x.var1) + " % frente a " + (x.anio - 1) + "</span>" : "");
      if (completo) {
        h += "<div style='margin-top:6px'>" + (window.__izSeguridad ? window.__izSeguridad.sparklineSVG(x.serie, { alto: 54 }) : "") +
          "</div><div style='font-size:10px;color:#64748b'><span style='color:#dc2626'>━</span> municipio " +
          "<span style='color:#f59e0b'>┅</span> provincia <span style='color:#9ca3af'>┅</span> España · " +
          x.serie[0].periodo + "–" + x.anio + "</div>";
        // los demás tipos, de peor a mejor frente a España
        var otros = TIPOS_CRIM.filter(function (t) { return t[0] !== tipo && t[0] !== "total"; }).map(function (t) {
          var y = datoCrim(f.getProperty("cumun"), t[0]);
          return y && y.ratio != null ? [t[1], y] : null;
        }).filter(Boolean).sort(function (a, b) { return b[1].ratio - a[1].ratio; });
        if (otros.length) {
          h += "<div style='margin-top:6px;font-size:11px;color:#475569'>Por tipo (× media de España, " + x.anio + ")</div>";
          otros.forEach(function (o) {
            var r = o[1].ratio;
            h += "<div style='display:flex;gap:6px;font-size:12px;margin-top:1px'><span style='flex:1'>" + esc(o[0]) + "</span>" +
              "<span style='color:#64748b'>" + fmtDec(o[1].tasa) + " ‰</span>" +
              "<b style='width:44px;text-align:right;padding-right:4px;color:" + colorTexto(r) + "'>" + fmtDec(r) + "×</b></div>";
          });
        }
        h += "<div style='margin-top:5px;font-size:10px;color:#94a3b8'>Ministerio del Interior, Balance de Criminalidad. " +
          "Mide denuncias por 1.000 hab.; en ciudades grandes pesan turismo y comercio.</div>";
      } else {
        h += "<br><span style='font-size:11px;color:#64748b'>Pulsa para ver la evolución y los demás tipos</span>";
      }
      return h;
    }
  });
  function colorTexto(r) { return r >= 1.5 ? "#b91c1c" : r >= 1.15 ? "#c2410c" : r < 0.85 ? "#15803d" : "#a16207"; }

  // ------------------------------------------------ capa OSM
  // Primero la copia LOCAL (servicios/*.json, herramientas/generar_servicios.py;
  // puente.js deja la URL de la extensión en <html data-izext>): instantánea y
  // sin depender de Overpass, que se satura. Fuera de esas regiones, Overpass.
  var CELDA_OSM = 0.01;
  var osmIndice = null, osmRegiones = {};
  function osmLocal(s, w, n, e) {
    var base = document.documentElement.getAttribute("data-izext");
    if (!base) return Promise.resolve(null);
    osmIndice = osmIndice || fetch(base + "servicios/indice.json").then(function (r) { return r.json(); })
      .catch(function () { return []; });
    var la = (s + n) / 2, lo = (w + e) / 2;
    return osmIndice.then(function (idx) {
      var reg = (idx || []).filter(function (x) {
        return la >= x.bbox[0] && la <= x.bbox[2] && lo >= x.bbox[1] && lo <= x.bbox[3];
      })[0];
      if (!reg) return null;
      osmRegiones[reg.region] = osmRegiones[reg.region] ||
        fetch(base + "servicios/" + reg.region + ".json").then(function (r) { return r.json(); });
      return osmRegiones[reg.region].then(function (d) {
        var out = [];
        function meter(lista, tags, pref) {
          (lista || []).forEach(function (f, i) {
            if (f[0] < s || f[0] > n || f[1] < w || f[1] > e) return;
            var t = {}; for (var k in tags) t[k] = tags[k];
            if (f[2]) t.name = f[2];
            out.push({ type: pref, id: f[0] + "," + f[1], lat: f[0], lon: f[1], tags: t });
          });
        }
        meter(d.cats.super, { shop: "supermarket" }, "s");
        meter(d.cats.tren, { railway: "station" }, "t");
        return { elements: out };
      });
    });
  }
  function osmDatos(q, s, w, n, e) {
    return osmLocal(s, w, n, e).then(function (d) { return d || overpass(q); });
  }
  var capaOSM = {
    marcadores: new Map(), celdas: new Map(), vistos: new Set(), cargando: 0,
    mostrar: function (map, on) {
      (this.marcadores.get(map) || []).forEach(function (m) { m.setMap(on ? map : null); });
      if (on) this.refrescar(map);
    },
    refrescar: function (map) {
      if (!capaOn("osm")) return;
      if ((map.getZoom() || 0) < 14) { estadoCapa("osm", "acerca el mapa (zoom ≥ 14)"); return; }
      var b = map.getBounds(); if (!b) return;
      var sw = b.getSouthWest(), ne = b.getNorthEast();
      var hechas = this.celdas.get(map) || new Set(); this.celdas.set(map, hechas);
      var lista = this.marcadores.get(map) || []; this.marcadores.set(map, lista);
      var x0 = Math.floor(sw.lng() / CELDA_OSM), x1 = Math.floor(ne.lng() / CELDA_OSM);
      var y0 = Math.floor(sw.lat() / CELDA_OSM), y1 = Math.floor(ne.lat() / CELDA_OSM);
      var nuevas = [];
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) {
        if (!hechas.has(x + "," + y)) nuevas.push([x, y]);
      }
      if (!nuevas.length || nuevas.length > 160) {
        estadoCapa("osm", nuevas.length > 160 ? "acerca el mapa" : ""); return;
      }
      // una sola consulta con la caja que cubre todas las celdas nuevas
      var s = Math.min.apply(null, nuevas.map(function (c) { return c[1]; })) * CELDA_OSM;
      var n = (Math.max.apply(null, nuevas.map(function (c) { return c[1]; })) + 1) * CELDA_OSM;
      var w = Math.min.apply(null, nuevas.map(function (c) { return c[0]; })) * CELDA_OSM;
      var e = (Math.max.apply(null, nuevas.map(function (c) { return c[0]; })) + 1) * CELDA_OSM;
      nuevas.forEach(function (c) { hechas.add(c.join(",")); });
      var bb = [s, w, n, e].map(function (v) { return v.toFixed(4); }).join(",");
      var q = "[out:json][timeout:25];(" +
        "nwr[\"shop\"=\"supermarket\"](" + bb + ");" +
        "nwr[\"railway\"~\"^(station|halt|tram_stop)$\"](" + bb + ");" +
        "nwr[\"station\"=\"subway\"](" + bb + ");" +
        ");out center 400;";
      var self = this;
      this.cargando++;
      estadoCapa("osm", "cargando…", true);
      var fallo = false;
      osmDatos(q, s, w, n, e)
        .then(function (d) {
          (d.elements || []).forEach(function (el) {
            var k = el.type + el.id;
            if (self.vistos.has(k)) return;
            self.vistos.add(k);
            var lat = el.lat != null ? el.lat : el.center && el.center.lat;
            var lng = el.lon != null ? el.lon : el.center && el.center.lon;
            if (lat == null) return;
            var t = el.tags || {};
            var esSuper = t.shop === "supermarket";
            var nombre = t.name || t.brand || (esSuper ? "Supermercado" : "Estación");
            var mk = new google.maps.Marker({
              position: { lat: lat, lng: lng },
              title: (esSuper ? "🛒 " : "🚆 ") + nombre,
              zIndex: 2000,
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: esSuper ? 5 : 6,
                fillColor: esSuper ? "#16a34a" : "#1d4ed8",
                fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2
              },
              map: capaOn("osm") ? map : null
            });
            lista.push(mk);
          });
        })
        .catch(function (err) {
          nuevas.forEach(function (c) { hechas.delete(c.join(",")); });
          log("osm: " + err.message);
          fallo = true;
        })
        .then(function () {
          self.cargando--;
          if (!self.cargando) estadoCapa("osm", fallo ? "OpenStreetMap no responde; se reintenta al mover el mapa" : "");
        });
    }
  };

  // ---------------------------------------------------- definición capas
  var CAPAS = [
    { id: "zonas", nombre: "Mis zonas", sub: "tu clasificación (zonas.js)", color: "#16a34a" },
    { id: "dana", nombre: "DANA 2024 · zona inundada", sub: "huella oficial · GVA/ICV", color: "#2563eb" },
    { id: "patricova", nombre: "Riesgo de inundación", sub: "PATRICOVA · peligrosidad", color: "#0ea5e9" },
    { id: "renta", nombre: "Renta por sección", sub: "INE 2023 · €/persona·año", color: "#2a788e" },
    { id: "turisticos", nombre: "Pisos turísticos", sub: "INE may-2026 · % viviendas", color: "#fd8d3c" },
    { id: "criminalidad", nombre: "Peligrosidad · criminalidad", sub: "Interior · hurtos, robos… vs media España", color: "#d73027" },
    { id: "extranjeros", nombre: "Población extranjera", sub: "INE · por continente de origen", color: "#8856a7" },
    { id: "osm", nombre: "Súper y estaciones", sub: "OpenStreetMap", color: "#1d4ed8" }
  ];

  var teselas = { dana: new Map(), patricova: new Map() }; // id -> map -> ImageMapType

  function aplicarCapa(map, id, on) {
    try {
      if (id === "zonas") {
        if (window.__izZonas) window.__izZonas.setOn(on);
      } else if (id === "dana" || id === "patricova") {
        var t = teselas[id].get(map);
        if (!t) {
          t = id === "dana" ? capaTeselasCanvas(urlDana, recolorDana) : capaTeselas(urlPatri, 0.7);
          teselas[id].set(map, t);
        }
        var ov = map.overlayMapTypes, idx = -1;
        for (var i = 0; i < ov.getLength(); i++) if (ov.getAt(i) === t) idx = i;
        if (on && idx === -1) ov.push(t);
        if (!on && idx !== -1) ov.removeAt(idx);
      } else if (id === "renta") {
        capaRenta.mostrar(map, on);
      } else if (id === "turisticos") {
        capaTur.mostrar(map, on);
      } else if (id === "criminalidad") {
        capaCrim.mostrar(map, on);
      } else if (id === "extranjeros") {
        capaExt.mostrar(map, on && !modoMunicipal());
        capaExtOrigen.mostrar(map, on && modoMunicipal());
      } else if (id === "osm") {
        capaOSM.mostrar(map, on);
      }
    } catch (e) { log("aplicar " + id + ": " + e.message); }
  }

  function zonasOn() {
    return window.__izZonas ? window.__izZonas.encendido() : false;
  }
  function estaOn(id) { return id === "zonas" ? zonasOn() : capaOn(id); }

  // ------------------------------------------------------------- estilos
  var CSS =
    ".izc{position:absolute;left:10px;bottom:28px;z-index:1000;" +
    "background:#fff;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.22);" +
    "font-family:inherit;color:#141414;width:252px;overflow:hidden;" +
    "font-size:13px;line-height:1.35;user-select:none;}" +
    ".izc *{box-sizing:border-box;}" +
    ".izc-cab{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;" +
    "background:#6f6f6d;color:#fff;font-weight:700;font-size:14px;}" +
    ".izc-cab .n{margin-left:auto;font-weight:400;font-size:12px;opacity:.9;}" +
    ".izc-cab .chev{font-size:11px;transition:transform .15s;}" +
    ".izc.plegado .izc-cab .chev{transform:rotate(-90deg);}" +
    ".izc.plegado .izc-cuerpo{display:none;}" +
    ".izc-cuerpo{max-height:420px;overflow-y:auto;padding:4px 0;}" +
    ".izc-fila{padding:6px 12px;border-bottom:1px solid #f0f0ee;}" +
    ".izc-fila:last-child{border-bottom:none;}" +
    ".izc-lin{display:flex;align-items:center;gap:8px;cursor:pointer;}" +
    ".izc-sw{width:12px;height:12px;border-radius:3px;flex:none;opacity:.35;transition:opacity .15s;}" +
    ".izc-fila.on .izc-sw{opacity:1;}" +
    ".izc-tx{flex:1;min-width:0;}" +
    ".izc-tx b{display:block;font-weight:600;font-size:13px;}" +
    ".izc-tx small{display:block;color:#6b7280;font-size:11px;}" +
    // interruptor
    ".izc-sw2{flex:none;width:30px;height:17px;border-radius:9px;background:#d1d5db;position:relative;transition:background .15s;}" +
    ".izc-sw2:after{content:'';position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;" +
    "background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:left .15s;}" +
    ".izc-fila.on .izc-sw2{background:#145bc7;}" +
    ".izc-fila.on .izc-sw2:after{left:15px;}" +
    ".izc-est{font-size:11px;color:#b45309;margin:3px 0 0 20px;display:none;}" +
    ".izc-est.vis{display:block;}" +
    ".izc-est.carga:before{content:'';display:inline-block;width:8px;height:8px;margin-right:5px;" +
    "border:2px solid #cbd5e1;border-top-color:#145bc7;border-radius:50%;animation:izcgiro .8s linear infinite;vertical-align:-1px;}" +
    "@keyframes izcgiro{to{transform:rotate(360deg)}}" +
    ".izc-ley{display:none;margin:6px 0 2px 20px;font-size:11px;color:#374151;}" +
    ".izc-fila.on .izc-ley{display:block;}" +
    ".izc-ley .it{display:flex;align-items:center;gap:6px;margin:2px 0;}" +
    ".izc-ley .c{width:14px;height:10px;border-radius:2px;flex:none;border:1px solid rgba(0,0,0,.08);}" +
    ".izc-ley img{width:14px;height:10px;flex:none;object-fit:cover;border-radius:2px;}" +
    ".izc-ley .nota{color:#6b7280;margin-top:3px;}" +
    ".izc-ley select{font:inherit;font-size:11px;border:1px solid #cbd5e1;border-radius:5px;padding:1px 3px;background:#fff;}" +
    ".izc-ley label{display:flex;align-items:center;gap:5px;cursor:pointer;margin:3px 0;}" +
    ".izc-lect{padding:7px 12px;border-top:1px solid #e5e6e1;background:#f8f8f6;font-size:12px;display:none;}" +
    ".izc-lect.vis{display:block;}";

  function ponerCSS() {
    if (document.getElementById("izc-css")) return;
    var st = document.createElement("style");
    st.id = "izc-css";
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  // ----------------------------------------------------------- panel
  var paneles = []; // un panel por mapa

  function leyendaDe(id) {
    if (id === "zonas") {
      var col = (window.__izZonas && window.__izZonas.colores) || {};
      var items = [["bien", "Bien"], ["regular", "Regular"], ["mal", "Mal"], ["muy_mal", "Muy mal"], ["duda", "Sin datos"]];
      var h = items.map(function (it) {
        var c = col[it[0]] ? col[it[0]].relleno : "#999";
        return "<div class='it'><span class='c' style='background:" + c + "'></span>" + it[1] + "</div>";
      }).join("");
      if (window.__izZonas && window.__izZonas.hayDemo()) {
        h += "<label><input type='checkbox' class='izc-demo'" + (window.__izZonas.demoActivo() ? " checked" : "") +
          "> Demografía <select class='izc-orig'>" + window.__izZonas.ORIGENES.map(function (o) {
            return "<option value='" + o[0] + "'" + (window.__izZonas.origen() === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
          }).join("") + "</select></label>";
      }
      h += "<div class='nota izc-res'></div>";
      return h;
    }
    if (id === "dana") {
      return "<div class='it'><span class='c' style='background:rgba(37,99,235,.47);border-color:#1e40af'></span>" +
        "Superficie inundada el 29-oct-2024</div>" +
        "<div class='nota'>Delimitación oficial (Generalitat). Mira también el riesgo PATRICOVA.</div>";
    }
    if (id === "patricova") {
      return "<div class='izc-patri'>cargando leyenda…</div>" +
        "<div class='nota'>Solo Comunitat Valenciana. 1 = el peor nivel.</div>";
    }
    if (id === "renta" || id === "turisticos") {
      var tr = id === "renta" ? TRAMOS_RENTA : TRAMOS_TUR;
      return tr.map(function (t) {
        return "<div class='it'><span class='c' style='background:" + t[1] + "'></span>" + t[2] + "</div>";
      }).join("") + "<div class='nota'>Pasa el ratón o pulsa una sección para ver el dato.</div>";
    }
    if (id === "criminalidad") {
      return "<label>Tipo <select class='izc-crim'>" + TIPOS_CRIM.map(function (t) {
          return "<option value='" + t[0] + "'" + (tipoCrim() === t[0] ? " selected" : "") + ">" + t[1] + "</option>";
        }).join("") + "</select></label>" +
        "<div class='nota' style='margin:2px 0 3px'>Tasa por 1.000 hab. frente a la media de España:</div>" +
        TRAMOS_CRIM.map(function (t) {
          return "<div class='it'><span class='c' style='background:" + t[1] + "'></span>" + t[2] + "</div>";
        }).join("") +
        "<div class='it'><span class='c' style='background:rgba(156,163,175,.15);border-color:#6b7280'></span>sin dato (&lt; 20.000 hab.)</div>" +
        "<div class='nota'>Por municipio entero (no hay dato oficial por barrio). Pulsa uno para ver su evolución y el resto de tipos.</div>";
    }
    if (id === "extranjeros") {
      var mo = modoExt();
      return "<label>Ver <select class='izc-ext'>" +
        "<option value='origen'" + (mo === "origen" ? " selected" : "") + ">Continente predominante</option>" +
        ORIGENES_EXT.slice(0, 4).map(function (o) {
          return "<option value='c:" + o[0] + "'" + (mo === "c:" + o[0] ? " selected" : "") + ">% " + o[1] + "</option>";
        }).join("") +
        "<option value='pct'" + (mo === "pct" ? " selected" : "") + ">% extranjeros por sección</option></select></label>" +
        "<div class='izc-ext-ley'>" + legendaExt(mo) + "</div>";
    }
    if (id === "osm") {
      return "<div class='it'><span class='c' style='background:#16a34a;border-radius:50%;width:10px'></span>Supermercado</div>" +
        "<div class='it'><span class='c' style='background:#1d4ed8;border-radius:50%;width:10px'></span>Tren / metro / tranvía</div>";
    }
    return "";
  }

  function crearPanel(map) {
    ponerCSS();
    var caja = document.createElement("div");
    caja.className = "izc" + (plegado() ? " plegado" : "");
    var h = "<div class='izc-cab'><span class='chev'>▼</span>Capas<span class='n'></span></div><div class='izc-cuerpo'>";
    CAPAS.forEach(function (c) {
      h += "<div class='izc-fila' data-id='" + c.id + "'>" +
        "<div class='izc-lin'><span class='izc-sw' style='background:" + c.color + "'></span>" +
        "<span class='izc-tx'><b>" + c.nombre + "</b><small>" + c.sub + "</small></span>" +
        "<span class='izc-sw2' role='switch'></span></div>" +
        "<div class='izc-est'></div><div class='izc-ley'>" + leyendaDe(c.id) + "</div></div>";
    });
    h += "</div><div class='izc-lect'></div>";
    caja.innerHTML = h;

    // que los clics/rueda no lleguen al mapa (no arrastrar ni hacer zoom)
    ["click", "dblclick", "mousedown", "wheel", "touchstart", "pointerdown"].forEach(function (ev) {
      caja.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true });
    });

    caja.querySelector(".izc-cab").addEventListener("click", function () {
      var p = !caja.classList.contains("plegado");
      paneles.forEach(function (pp) { pp.caja.classList.toggle("plegado", p); });
      try { localStorage.setItem(LS_PLEGADO, p ? "1" : "0"); } catch (e) {}
    });
    caja.querySelectorAll(".izc-fila").forEach(function (fila) {
      var id = fila.getAttribute("data-id");
      fila.querySelector(".izc-lin").addEventListener("click", function () {
        var nuevo = !estaOn(id);
        if (id !== "zonas") guardarOn(id, nuevo);
        window.__izMapas.forEach(function (m) {
          if (m.__izCapas) aplicarCapa(m, id, nuevo);
        });
        sincronizar();
      });
    });
    var demo = caja.querySelector(".izc-demo");
    if (demo) demo.addEventListener("change", function () { window.__izZonas.setDemo(demo.checked); sincronizar(); });
    var crim = caja.querySelector(".izc-crim");
    if (crim) crim.addEventListener("change", function () {
      try { localStorage.setItem(LS_CRIM, crim.value); } catch (e) {}
      paneles.forEach(function (p) { var s2 = p.caja.querySelector(".izc-crim"); if (s2) s2.value = crim.value; });
      try { capaCrim.info.close(); } catch (e) {}
      capaCrim.restilar();
    });
    var ext = caja.querySelector(".izc-ext");
    if (ext) ext.addEventListener("change", function () {
      try { localStorage.setItem(LS_EXT, ext.value); } catch (e) {}
      paneles.forEach(function (p) {
        var s2 = p.caja.querySelector(".izc-ext"); if (s2) s2.value = ext.value;
        p.caja.querySelector(".izc-ext-ley").innerHTML = legendaExt(modoExt());
      });
      estadoCapa("extranjeros", "");
      try { capaExtOrigen.info.close(); capaExt.info.close(); } catch (e) {}
      capaExtOrigen.restilar();
      window.__izMapas.forEach(function (m) { if (m.__izCapas) aplicarCapa(m, "extranjeros", capaOn("extranjeros")); });
    });
    var orig = caja.querySelector(".izc-orig");
    if (orig) orig.addEventListener("change", function () { window.__izZonas.setOrigen(orig.value); sincronizar(); });

    cargarLeyendaPatri(function (ley) {
      var el = caja.querySelector(".izc-patri");
      if (!el) return;
      el.innerHTML = ley.length ? ley.map(function (l) {
        return "<div class='it'><img src='" + l.img + "' alt=''>" + esc(TXT_PATRI[l.nombre] || l.nombre) + "</div>";
      }).join("") : "";
    });

    // Directo en el div del mapa: map.controls se pinta tarde (o nunca hasta
    // tocar el mapa) en el mapa de idealista
    (map.getDiv() || document.body).appendChild(caja);
    paneles.push({ map: map, caja: caja });
    return caja;
  }

  function sincronizar() {
    // con capas de datos encima, las zonas propias pasan a casi solo contorno
    if (window.__izZonas && window.__izZonas.setRelleno) {
      var encima = ["dana", "patricova", "renta", "turisticos", "criminalidad", "extranjeros"].some(capaOn);
      window.__izZonas.setRelleno(encima ? 0.25 : 1);
    }
    var activas = 0;
    CAPAS.forEach(function (c) { if (estaOn(c.id)) activas++; });
    paneles.forEach(function (p) {
      // que el panel quepa en el alto del mapa (cabecera + márgenes ≈ 110 px)
      try {
        var alto = p.map.getDiv().offsetHeight;
        if (alto) p.caja.querySelector(".izc-cuerpo").style.maxHeight = Math.max(160, alto - 110) + "px";
      } catch (e) {}
      p.caja.querySelectorAll(".izc-fila").forEach(function (f) {
        f.classList.toggle("on", estaOn(f.getAttribute("data-id")));
      });
      p.caja.querySelector(".izc-cab .n").textContent = activas ? activas + " activa" + (activas > 1 ? "s" : "") : "ninguna";
      var res = p.caja.querySelector(".izc-res");
      if (res && window.__izZonas) {
        res.textContent = window.IDEALISTA_ZONAS ? window.__izZonas.resumen() : "⚠ sin zonas.js (ver README)";
      }
    });
  }

  function estadoCapa(id, txt, carga) {
    paneles.forEach(function (p) {
      var el = p.caja.querySelector(".izc-fila[data-id='" + id + "'] .izc-est");
      if (!el) return;
      el.textContent = txt || "";
      el.classList.toggle("vis", !!txt);
      el.classList.toggle("carga", !!carga);
    });
  }

  function panelLectura(html) {
    paneles.forEach(function (p) {
      var el = p.caja.querySelector(".izc-lect");
      el.innerHTML = html || "";
      el.classList.toggle("vis", !!html);
    });
  }

  // ------------------------------------------------ enganche a los mapas
  function engancharMapa(map) {
    if (map.__izCapas) return;
    if (!window.google || !google.maps || !google.maps.ControlPosition) return;
    try {
      map.__izCapas = true;
      crearPanel(map);
      CAPAS.forEach(function (c) { if (c.id !== "zonas" && capaOn(c.id)) aplicarCapa(map, c.id, true); });
      var t = null;
      map.addListener("idle", function () {
        clearTimeout(t);
        t = setTimeout(function () {
          capaRenta.refrescar(map);
          capaTur.refrescar(map);
          capaCrim.refrescar(map);
          capaExt.refrescar(map);
          capaExtOrigen.refrescar(map);
          capaOSM.refrescar(map);
          sincronizar();
        }, 350);
      });
      sincronizar();
      log("panel de capas en un mapa");
    } catch (e) { log("enganche: " + e.message); }
  }

  // Respaldo: hay páginas donde idealista crea el mapa con una referencia a
  // google.maps.Map anterior al parche de hook.js. Las instancias comparten
  // prototipo, así que envolvemos métodos que idealista llama sí o sí
  // (getBounds/getZoom/getCenter…) para descubrir el mapa en la primera llamada
  function nuevoMapa(m) {
    window.__izMapas = window.__izMapas || [];
    if (window.__izCapturar) window.__izCapturar(m);
    else if (window.__izMapas.indexOf(m) === -1) window.__izMapas.push(m);
  }
  function parchearPrototipo() {
    try {
      var P = window.google && google.maps && google.maps.Map && google.maps.Map.prototype;
      if (!P || P.__izCapasProto) return !!P;
      ["getBounds", "getZoom", "getCenter", "setCenter", "setZoom", "fitBounds", "panTo", "setOptions"].forEach(function (k) {
        var orig = P[k];
        if (typeof orig !== "function") return;
        P[k] = function () {
          try { if (!this.__izVisto) { this.__izVisto = true; nuevoMapa(this); } } catch (e) {}
          return orig.apply(this, arguments);
        };
      });
      P.__izCapasProto = true;
      return true;
    } catch (e) { return false; }
  }
  var tProto = setInterval(function () { if (parchearPrototipo()) clearInterval(tProto); }, 50);
  setTimeout(function () { clearInterval(tProto); }, 60000);

  // hook.js va metiendo en window.__izMapas cada mapa que crea idealista
  setInterval(function () {
    (window.__izMapas || []).forEach(function (m) {
      try { if (m && !m.__izCapas && m.getDiv && m.getDiv()) engancharMapa(m); } catch (e) {}
    });
  }, 700);
})();
