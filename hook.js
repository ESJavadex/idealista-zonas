// =========================================================================
// hook.js — captura los mapas de Google que crea idealista y pinta encima
// las zonas definidas en zonas.js (verde = bien, rojo = mal).
//
// Se ejecuta en el "mundo MAIN" de la página (ver manifest.json), por eso
// puede tocar `google.maps` directamente. No necesita permisos.
// =========================================================================
(function () {
  "use strict";

  var COLORES = (window.IDEALISTA_ZONAS_COLORES) || {
    bien: { relleno: "#16a34a", borde: "#166534" },
    duda: { relleno: "#9ca3af", borde: "#6b7280" },
    regular: { relleno: "#f59e0b", borde: "#b45309" },
    mal: { relleno: "#dc2626", borde: "#991b1b" },
    muy_mal: { relleno: "#7f1d1d", borde: "#450a0a" }
  };
  var LS_CLAVE = "idealista_zonas_on";
  var LS_DEMO = "idealista_zonas_demo";   // capa demografía (por defecto OFF)
  var LS_ORIGEN = "idealista_zonas_origen"; // origen seleccionado (default: ext)
  var ORIGENES = [["ext", "Extranjeros"], ["eu", "Europa"], ["af", "África"],
                  ["am", "América"], ["as", "Asia"], ["oc", "Oceanía"]];
  // paleta secuencial neutra (azules) por % del colectivo sobre población total
  var TRAMOS_DEMO = [
    [5,   "#dbeafe", "#93c5fd"],
    [15,  "#93c5fd", "#3b82f6"],
    [30,  "#3b82f6", "#1d4ed8"],
    [1/0, "#1e40af", "#172554"]
  ];
  var mapaOverlays = new Map();   // google.maps.Map -> [overlays]
  var mapaBotones = new Map();    // google.maps.Map -> botón
  var mapaUrlDibujada = new Map(); // google.maps.Map -> última URL dibujada
  var mapasCapturados = new Set(); // Map instances ya enganchados al 'idle'

  function encendido() {
    var v = null;
    try { v = window.localStorage.getItem(LS_CLAVE); } catch (e) {}
    return v !== "0"; // por defecto ENCENDIDO
  }
  function guardar(on) {
    try { window.localStorage.setItem(LS_CLAVE, on ? "1" : "0"); } catch (e) {}
  }

  function demoActivo() {
    var v = null;
    try { v = window.localStorage.getItem(LS_DEMO); } catch (e) {}
    return v === "1";
  }
  function guardarDemo(on) {
    try { window.localStorage.setItem(LS_DEMO, on ? "1" : "0"); } catch (e) {}
  }
  function origenSel() {
    var v = null;
    try { v = window.localStorage.getItem(LS_ORIGEN); } catch (e) {}
    return v || "ext";
  }
  function guardarOrigen(o) {
    try { window.localStorage.setItem(LS_ORIGEN, o); } catch (e) {}
  }
  function hayDemo() {
    return (window.IDEALISTA_ZONAS || []).some(function (g) {
      return (g.zonas || []).some(function (z) { return !!z.demo; });
    });
  }
  // dato demográfico del origen para la zona: [pct, relleno, borde]
  function datosDemo(zona) {
    var d = zona.demo;
    if (!d || !d.t) return null;
    var o = origenSel();
    var n = d[o === "ext" ? "e" : o] || 0;
    var pct = 100 * n / d.t;
    for (var i = 0; i < TRAMOS_DEMO.length; i++) {
      if (pct < TRAMOS_DEMO[i][0]) return [pct, TRAMOS_DEMO[i][1], TRAMOS_DEMO[i][2]];
    }
    return [pct, TRAMOS_DEMO[3][1], TRAMOS_DEMO[3][2]];
  }

  // ---------------------------------------------------------------- dibujar

  function gruposQueAplican(url) {
    var grupos = window.IDEALISTA_ZONAS;
    if (!grupos || !grupos.length) return [];
    return grupos.filter(function (g) {
      return (g.claves || []).some(function (k) { return url.indexOf(k) !== -1; });
    });
  }

  // En URLs sin provincia/ciudad (p. ej. /point/lat/lng/zoom/… cuando te mueves
  // libremente por el mapa) no hay claves que casen: pintamos TODAS las zonas,
  // para que la extensión esté siempre activa en cualquier vista de mapa.
  function gruposParaDibujar(url) {
    var g = gruposQueAplican(url);
    if (g.length) return g;
    return (window.IDEALISTA_ZONAS || []).slice();
  }

  // firma de "qué grupos tocan ahora": si no cambia, no redibujamos
  // (importante en /point/, donde idealista cambia la URL en cada pan)
  function firmaDe(url) {
    var g = gruposQueAplican(url);
    if (g.length) {
      return g.map(function (gr) { return (gr.claves || [""]).join("|"); }).sort().join("::");
    }
    return "*todas*";
  }

  function colorDe(zona, tipo) {
    if (demoActivo()) {
      var d = datosDemo(zona);
      if (!d) return tipo === "borde" ? "#cbd5e1" : "#f1f5f9"; // sin dato municipal
      return tipo === "borde" ? d[2] : d[1];
    }
    var c = COLORES[zona.veredicto] || COLORES.mal;
    return tipo === "borde" ? c.borde : c.relleno;
  }

  function borrarOverlays(map) {
    var lista = mapaOverlays.get(map) || [];
    lista.forEach(function (o) { try { o.setMap(null); } catch (e) {} });
    mapaOverlays.set(map, []);
  }

  function pintarEn(map) {
    var url = location.href;
    var firma = firmaDe(url);
    if (mapaUrlDibujada.get(map) === firma && mapaOverlays.get(map)) return;

    borrarOverlays(map);
    mapaUrlDibujada.set(map, firma);
    var overlays = [];
    var grupos = gruposParaDibujar(url);
    var on = encendido();

    grupos.forEach(function (grupo) {
      (grupo.zonas || []).forEach(function (zona) {
        try {
          var color = colorDe(zona, "relleno");
          var borde = colorDe(zona, "borde");
          var overlay = null;

          if (zona.tipo === "poligono" && zona.puntos && zona.puntos.length > 2) {
            overlay = new google.maps.Polygon({
              paths: zona.puntos.map(function (p) { return { lat: p[0], lng: p[1] }; }),
              strokeColor: borde,
              strokeOpacity: 1,
              strokeWeight: 2,
              fillColor: color,
              fillOpacity: 0.42,
              clickable: false,
              zIndex: 999
            });
          } else if (zona.tipo === "punto" && typeof zona.lat === "number") {
            overlay = new google.maps.Circle({
              center: { lat: zona.lat, lng: zona.lng },
              radius: (zona.radio_km || 1.5) * 1000,
              strokeColor: borde,
              strokeOpacity: 1,
              strokeWeight: 2,
              fillColor: color,
              fillOpacity: 0.38,
              clickable: false,
              zIndex: 998
            });
          }
          if (overlay) {
            overlay.setMap(on ? map : null);
            overlay.__izVisible = on;
            overlays.push(overlay);
          }
        } catch (e) { /* zona concreta rota: seguimos */ }
      });
    });

    mapaOverlays.set(map, overlays);
    actualizarBoton(map, on);
  }

  // ---------------------------------------------------------------- botón

  // resumen tipo "38 verdes · 12 mal · 55 regular · 80 grises" (solo no-cero)
  function resumen() {
    var partes = [];
    var c = { bien: [0, "verdes"], muy_mal: [0, "muy mal"], mal: [0, "mal"],
              regular: [0, "regular"], duda: [0, "grises"] };
    gruposParaDibujar(location.href).forEach(function (g) {
      (g.zonas || []).forEach(function (z) {
        if (c[z.veredicto]) c[z.veredicto][0]++;
      });
    });
    Object.keys(c).forEach(function (k) {
      if (c[k][0]) partes.push(c[k][0] + " " + c[k][1]);
    });
    return partes.length ? partes.join(" · ") : "sin datos";
  }

  function actualizarBoton(map, on) {
    var btn = mapaBotones.get(map);
    if (!btn) {
      var caja = document.createElement("div");
      caja.style.cssText = "position:absolute;bottom:36px;left:10px;z-index:2147483646;";
      // fila 1: botón principal on/off
      btn.style.cssText =
        "background:#fff;border-radius:18px;box-shadow:0 1px 4px rgba(0,0,0,.35);" +
        "padding:6px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;" +
        "user-select:none;white-space:nowrap;color:#111;display:inline-block;";
      btn.addEventListener("click", function () {
        var nuevo = !encendido();
        guardar(nuevo);
        var overlays = mapaOverlays.get(map) || [];
        overlays.forEach(function (o) {
          o.__izVisible = nuevo;
          o.setMap(nuevo ? map : null);
        });
        actualizarBoton(map, nuevo);
      });
      caja.appendChild(btn);
      // fila 2: capa demografía (solo si zonas.js lleva datos)
      if (hayDemo()) {
        var fila = document.createElement("div");
        fila.style.cssText = "margin-top:6px;background:#fff;border-radius:14px;" +
          "box-shadow:0 1px 4px rgba(0,0,0,.25);padding:4px 10px;font:12px system-ui,sans-serif;" +
          "white-space:nowrap;color:#334155;display:flex;align-items:center;gap:6px;";
        var chk = document.createElement("input");
        chk.type = "checkbox"; chk.id = "iz-demo"; chk.checked = demoActivo();
        chk.style.cursor = "pointer";
        chk.addEventListener("change", function () {
          guardarDemo(chk.checked); repintarTodo();
        });
        var lbl = document.createElement("label");
        lbl.htmlFor = "iz-demo"; lbl.style.cursor = "pointer";
        lbl.textContent = "Demografía";
        lbl.title = "% del colectivo sobre la población del municipio (INE, padrón 2025). " +
          "Tramos: <5%, 5–15%, 15–30%, 30%+. Gris claro = sin dato. No afecta a los colores de seguridad.";
        var sel = document.createElement("select");
        sel.style.cssText = "font:12px system-ui,sans-serif;border:1px solid #cbd5e1;border-radius:6px;padding:1px;";
        ORIGENES.forEach(function (o) {
          var op = document.createElement("option");
          op.value = o[0]; op.textContent = o[1];
          sel.appendChild(op);
        });
        sel.value = origenSel();
        sel.addEventListener("change", function () {
          guardarOrigen(sel.value); repintarTodo();
        });
        fila.appendChild(chk); fila.appendChild(lbl); fila.appendChild(sel);
        caja.appendChild(fila);
        btn.__izFilaDemo = fila;
      }
      mapaBotones.set(map, btn);
      try {
        (map.getDiv() || document.body).appendChild(caja);
      } catch (e) { document.body && document.body.appendChild(caja); }
      btn.__izCaja = caja;
    }
    var demo = demoActivo();
    var origen = (ORIGENES.find(function (o) { return o[0] === origenSel(); }) || ["ext", "Extranjeros"])[1];
    btn.textContent = !on ? "✖ Zonas OFF"
      : (demo ? ("📊 Demografía: " + origen) : ("✔ Zonas ON · " + resumen()));
    btn.style.color = on ? "#111" : "#888";
    if (btn.__izFilaDemo) btn.__izFilaDemo.style.display = on ? "" : "none";
    if (!window.IDEALISTA_ZONAS) {
      btn.textContent = "⚠ Sin datos: copia zonas.js.ejemplo a zonas.js (ver README)";
      btn.style.color = "#b45309";
    }
  }

  function repintarTodo() {
    window.__izMapas.forEach(function (m) {
      try { mapaUrlDibujada.set(m, null); pintarEn(m); } catch (e) {}
    });
  }

  // ---------------------------------------------------------------- captura

  function engancharMapa(map) {
    if (mapaOverlays.has(map)) return;
    mapaOverlays.set(map, []);
    mapaUrlDibujada.set(map, null);
    try {
      // pintar cuando el mapa esté listo y tras cada movimiento relevante
      google.maps.event.addListener(map, "idle", function () {
        if (mapaUrlDibujada.get(map) !== firmaDe(location.href)) pintarEn(map);
      });
      // primer intento inmediato
      setTimeout(function () { pintarEn(map); }, 300);
      setTimeout(function () { pintarEn(map); }, 1500);
    } catch (e) {}
  }

  function capturar(instancia) {
    try {
      if (!instancia || typeof instancia.getCenter !== "function") return;
      mapasCapturados.add(instancia);
      engancharMapa(instancia);
    } catch (e) {}
  }

  // ---- trampa 1: google.maps.Map clásico
  // Reemplazamos el constructor en cuanto exista, para quedarnos con cada
  // instancia que cree idealista (también tras cambiar de filtros, etc.)
  function parchearMaps(g) {
    if (!g || !g.maps) return false;
    var M = g.maps.Map;
    if (M && !M.__izHook) {
      var Original = M;
      function MapConHook() {
        var m = new (Function.prototype.bind.apply(Original, [null].concat(Array.prototype.slice.call(arguments))));
        window.__izMapas.push(m);
        capturar(m);
        return m;
      }
      MapConHook.prototype = Original.prototype;
      MapConHook.__izHook = true;
      g.maps.Map = MapConHook;
      return true;
    }
    return false;
  }

  // ---- trampa 2: google.maps.importLibrary("maps") (loader moderno)
  function parchearImportLibrary(g) {
    if (!g || !g.maps || !g.maps.importLibrary || g.maps.importLibrary.__izHook) return;
    var original = g.maps.importLibrary;
    g.maps.importLibrary = function (nombre) {
      var p = original.apply(this, arguments);
      if (nombre === "maps") {
        p.then(function (lib) {
          if (lib && lib.Map && !lib.Map.__izHook) {
            var Original = lib.Map;
            function M() {
              var m = new (Function.prototype.bind.apply(Original, [null].concat(Array.prototype.slice.call(arguments))));
              window.__izMapas.push(m);
              capturar(m);
              return m;
            }
            M.prototype = Original.prototype;
            M.__izHook = true;
            lib.Map = M;
          }
        }).catch(function () {});
      }
      return p;
    };
    g.maps.importLibrary.__izHook = true;
  }

  window.__izMapas = window.__izMapas || [];

  // Capturamos el momento en que la página define window.google (ocurre ANTES
  // de que idealista cree el mapa, así que la trampa siempre gana la carrera)
  try {
    if (!window.__izGoogleTrampa) {
      var _g = window.google;
      Object.defineProperty(window, "google", {
        configurable: true,
        get: function () { return _g; },
        set: function (v) {
          _g = v;
          // cuando aparezca google.maps.Map (asíncrono), parchearlo
          var t = setInterval(function () {
            var parcheado = parchearMaps(_g);
            parchearImportLibrary(_g);
            if (parcheado) clearInterval(t);
          }, 5);
          setTimeout(function () { clearInterval(t); }, 30000);
        }
      });
    }
  } catch (e) { /* si defineProperty falla, queda el barrido de fallback */ }

  // ---- fallback: barrido periódico por si algo se nos escapó
  var intentos = 0;
  var barrido = setInterval(function () {
    intentos++;
    try {
      var g = window.google;
      parchearMaps(g);
      parchearImportLibrary(g);
    } catch (e) {}
    if (intentos > 600) clearInterval(barrido); // ~1 minuto y paramos
  }, 100);

  // ---- redibujar al navegar dentro de idealista (SPA)
  try {
    var push = history.pushState, replace = history.replaceState;
    history.pushState = function () { push.apply(this, arguments); window.dispatchEvent(new Event("iz_urlchange")); };
    history.replaceState = function () { replace.apply(this, arguments); window.dispatchEvent(new Event("iz_urlchange")); };
    window.addEventListener("popstate", function () { window.dispatchEvent(new Event("iz_urlchange")); });
    window.addEventListener("iz_urlchange", function () {
      window.__izMapas.forEach(function (m) {
        try {
          var f = firmaDe(location.href);
          if (mapaUrlDibujada.get(m) !== f) { mapaUrlDibujada.set(m, null); pintarEn(m); }
        } catch (e) {}
      });
    });
  } catch (e) {}
})();