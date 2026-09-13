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
    mal:  { relleno: "#dc2626", borde: "#991b1b" }
  };
  var LS_CLAVE = "idealista_zonas_on";
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
    var nBien = 0, nMal = 0, on = encendido();

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
            if (zona.veredicto === "bien") nBien++; else nMal++;
          }
        } catch (e) { /* zona concreta rota: seguimos */ }
      });
    });

    mapaOverlays.set(map, overlays);
    actualizarBoton(map, on, nBien, nMal);
  }

  // ---------------------------------------------------------------- botón

  function actualizarBoton(map, on, nBien, nMal) {
    var btn = mapaBotones.get(map);
    if (!btn) {
      btn = document.createElement("div");
      btn.style.cssText =
        "position:absolute;bottom:36px;left:10px;z-index:2147483646;" +
        "background:#fff;border-radius:18px;box-shadow:0 1px 4px rgba(0,0,0,.35);" +
        "padding:6px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;" +
        "user-select:none;white-space:nowrap;color:#111;";
      btn.addEventListener("click", function () {
        var nuevo = !encendido();
        guardar(nuevo);
        var overlays = mapaOverlays.get(map) || [];
        overlays.forEach(function (o) {
          o.__izVisible = nuevo;
          o.setMap(nuevo ? map : null);
        });
        // recalcular contadores para el texto
        var bien = 0, mal = 0;
        gruposParaDibujar(location.href).forEach(function (g) {
          (g.zonas || []).forEach(function (z) {
            if (z.veredicto === "bien") bien++; else mal++;
          });
        });
        actualizarBoton(map, nuevo, bien, mal);
      });
      mapaBotones.set(map, btn);
      try {
        (map.getDiv() || document.body).appendChild(btn);
      } catch (e) { document.body && document.body.appendChild(btn); }
    }
    btn.textContent = on
      ? "✔ Zonas ON · " + nBien + " verdes · " + nMal + " rojas"
      : "✖ Zonas OFF";
    btn.style.color = on ? "#111" : "#888";
    if (!window.IDEALISTA_ZONAS) {
      btn.textContent = "⚠ Sin datos: copia zonas.js.ejemplo a zonas.js (ver README)";
      btn.style.color = "#b45309";
    }
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