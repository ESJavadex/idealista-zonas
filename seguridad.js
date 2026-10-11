// =========================================================================
// seguridad.js — criminalidad OFICIAL por municipio (Ministerio del Interior,
// Balance de Criminalidad; municipios > 20.000 hab.) y su evolución.
//
// Lee criminalidad/municipios.json (herramientas/generar_criminalidad.py) con
// la URL de la extensión que deja puente.js en <html data-izext>. Expone:
//
//   window.__izSeguridad.consultar(codINEoNombre, provincia) → Promise<res|null>
//   window.__izSeguridad.notaCriminalidad(res)               → 0..10 | null
//   window.__izSeguridad.sparklineSVG(serie, opciones)        → "<svg…>"
//
// Mundo MAIN, sin permisos. Se carga antes de barrio.js.
// =========================================================================
(function () {
  "use strict";

  var datos = null;   // promesa del JSON (se pide una vez por página)

  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  // "Sagunt/Sagunto", "Puig de Santa Maria, el" → variantes comparables
  function variantes(nombre) {
    var out = [];
    String(nombre || "").split("/").forEach(function (p) {
      var n = norm(p);
      if (!n) return;
      out.push(n);
      var m = n.match(/^(.*?) (el|la|los|las|l|els|les|a|o|as|os)$/);
      if (m) out.push(m[2] + " " + m[1]);
    });
    return out;
  }

  function cargar() {
    if (datos) return datos;
    var base = document.documentElement.getAttribute("data-izext") || window.__IZ_TEST_EXT;
    if (!base) return Promise.resolve(null);
    datos = fetch(base + "criminalidad/municipios.json")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .catch(function () { datos = null; return null; });
    return datos;
  }

  // provincia por nombre ("València", "Valladolid", "Pontevedra") → código
  function codProvincia(d, provincia) {
    if (!provincia) return null;
    var v = variantes(provincia);
    for (var c in d.provincias) {
      var pv = variantes(d.provincias[c].nombre);
      if (v.some(function (x) { return pv.indexOf(x) !== -1 || pv.some(function (y) { return y.indexOf(x) === 0; }); })) return c;
    }
    return null;
  }

  function buscarMunicipio(d, clave, provincia) {
    if (/^\d{5}$/.test(String(clave))) return d.municipios[clave] ? String(clave) : null;
    var v = variantes(clave), prov = codProvincia(d, provincia);
    var hits = [];
    for (var c in d.municipios) {
      var m = d.municipios[c];
      if (prov && m.prov !== prov) continue;
      var mv = variantes(m.nombre);
      if (v.some(function (x) { return mv.indexOf(x) !== -1; })) hits.push(c);
    }
    return hits.length === 1 || (hits.length && prov) ? hits[0] : null;
  }

  function redondeo(n, d) { var f = Math.pow(10, d || 1); return Math.round(n * f) / f; }

  function consultar(clave, provincia) {
    return cargar().then(function (d) {
      if (!d) return { sinDato: true, motivo: "no está el fichero de criminalidad (genera criminalidad/municipios.json)" };
      var cod = buscarMunicipio(d, clave, provincia);
      if (!cod) return { sinDato: true, motivo: "el Ministerio solo publica municipios de más de 20.000 habitantes" };
      var m = d.municipios[cod], P = d.provincias[m.prov] || null, E = d.espana || {};
      var anios = Object.keys(m.anual).sort();
      var ult = anios[anios.length - 1], ant = anios[anios.length - 2];
      var a = m.anual[ult];
      var serie = anios.map(function (y) {
        return {
          periodo: y, tasa: m.anual[y].tasa.total, total: m.anual[y].n.total,
          tasaProv: P && P.anual[y] ? P.anual[y].tasa.total : null,
          tasaEsp: E[y] ? E[y].tasa.total : null
        };
      });
      var tipos = {};
      Object.keys(a.tasa).forEach(function (t) {
        tipos[t] = {
          n: a.n[t], tasa: a.tasa[t],
          tasaProv: P && P.anual[ult] ? P.anual[ult].tasa[t] : null,
          tasaEsp: E[ult] ? E[ult].tasa[t] : null,
          variacion: ant && m.anual[ant].n[t] ? redondeo(100 * (a.n[t] / m.anual[ant].n[t] - 1)) : null
        };
      });
      // comparación a ~5 años; 2020 y 2021 (pandemia) tienen la criminalidad
      // anormalmente baja, así que si caen como base se usa 2019
      var base = String(+ult - 5);
      if (base === "2020" || base === "2021") base = "2019";
      var desde = serie.filter(function (x) { return x.periodo === base; })[0] || serie[0];
      return {
        codigo: cod, municipio: m.nombre, provincia: P ? P.nombre : "", poblacion: a.pob,
        periodo: "enero-diciembre " + ult,
        tasa: a.tasa.total, total: a.n.total,
        tasaProv: P && P.anual[ult] ? P.anual[ult].tasa.total : null,
        tasaEsp: E[ult] ? E[ult].tasa.total : null,
        variacionAnual: ant ? redondeo(100 * (a.n.total / m.anual[ant].n.total - 1)) : null,
        variacion5: desde && desde !== serie[serie.length - 1] ? redondeo(100 * (a.tasa.total / desde.tasa - 1)) : null,
        desde5: desde ? desde.periodo : null,   // año base de variacion5
        serie: serie, tipos: tipos,
        fuente: d.fuente, url: d.url,
        nota: "Infracciones penales conocidas por cada 1.000 habitantes en el año. Mide denuncias e intervenciones, " +
              "no el riesgo de un barrio concreto: en las grandes ciudades se concentran por turismo, ocio y comercio."
      };
    });
  }

  // nota 0–10: tasa del municipio frente a su provincia y a España
  // (más peso a la provincia: es la comparación con las alternativas reales)
  function notaCriminalidad(r) {
    if (!r || r.sinDato || r.tasa == null) return null;
    var refs = [];
    if (r.tasaProv) refs.push([r.tasa / r.tasaProv, 2]);
    if (r.tasaEsp) refs.push([r.tasa / r.tasaEsp, 1]);
    if (!refs.length) return null;
    var x = refs.reduce(function (s, p) { return s + p[0] * p[1]; }, 0) / refs.reduce(function (s, p) { return s + p[1]; }, 0);
    // x = cuántas veces la media: 0,6 → 10 · 1,0 → 6 · 1,5 → 2
    var n = x <= 0.6 ? 10 : x <= 1 ? 10 - (x - 0.6) * 10 : x <= 1.5 ? 6 - (x - 1) * 8 : 2 - Math.min(2, (x - 1.5) * 4);
    n = Math.round(n);
    // tendencia: subida fuerte en 5 años resta un punto, bajada fuerte suma
    if (r.variacion5 != null) n += r.variacion5 >= 25 ? -1 : r.variacion5 <= -20 ? 1 : 0;
    return Math.max(0, Math.min(10, n));
  }

  // mini gráfico de la tasa del municipio (línea) frente a provincia y España
  function sparklineSVG(serie, o) {
    o = o || {};
    if (!serie || serie.length < 2) return "";
    var W = o.ancho || 320, H = o.alto || 80, p = 6;
    var vals = [];
    serie.forEach(function (s) { [s.tasa, s.tasaProv, s.tasaEsp].forEach(function (v) { if (v != null) vals.push(v); }); });
    var mn = Math.min.apply(null, vals) * 0.9, mx = Math.max.apply(null, vals) * 1.05;
    function x(i) { return (p + i * (W - 2 * p) / (serie.length - 1)).toFixed(1); }
    function y(v) { return (H - p - (v - mn) * (H - 2 * p) / (mx - mn || 1)).toFixed(1); }
    function linea(campo, color, ancho, raya) {
      var pts = serie.map(function (s, i) { return s[campo] == null ? null : x(i) + "," + y(s[campo]); }).filter(Boolean);
      return pts.length < 2 ? "" : "<polyline points='" + pts.join(" ") + "' fill='none' stroke='" + color +
        "' stroke-width='" + ancho + "'" + (raya ? " stroke-dasharray='4 3'" : "") + "/>";
    }
    var u = serie[serie.length - 1];
    return "<svg width='100%' height='" + H + "' viewBox='0 0 " + W + " " + H + "' preserveAspectRatio='none' style='display:block'>" +
      linea("tasaEsp", "#9ca3af", 1.5, true) + linea("tasaProv", "#f59e0b", 1.5, true) + linea("tasa", "#dc2626", 2.5) +
      "<circle cx='" + x(serie.length - 1) + "' cy='" + y(u.tasa) + "' r='3.5' fill='#dc2626'/></svg>";
  }

  window.__izSeguridad = { consultar: consultar, notaCriminalidad: notaCriminalidad, sparklineSVG: sparklineSVG };
})();
