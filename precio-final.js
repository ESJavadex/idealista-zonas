// =========================================================================
// precio-final.js — en páginas de inmueble (obra nueva o segunda mano)
// añade junto a cada precio un badge "🧮 final ≈ X €" que despliega un
// panel con:
//   · el precio de verdad: impuestos (IVA/AJD o ITP) + gastos
//   · el LÍQUIDO necesario hasta la escritura (la "regla del 30%")
//   · cronograma: reserva → arras → resto entrada → escritura
//   · simulación de hipoteca (entrada, plazo, interés → cuota, total…)
//   · escenarios rápidos y coste mensual real (IBI + comunidad)
//
// Se ejecuta en el "mundo MAIN" igual que hook.js. Sin permisos.
// =========================================================================
(function () {
  "use strict";

  var VERSION = "1.8.2"; // se canta en consola: así sabemos qué build corre de verdad

  // ------------------------------------------------------------- ajustes
  var LS_CFG = "iz_pf_cfg";   // valores guardados
  var LS_ON = "iz_pf_on";     // encendido/apagado

  // ITP general por CCAA (tipo base; editable desde el panel ⚙)
  var ITP_CCAA = [
    ["Comunitat Valenciana", 10], ["Andalucía", 7], ["Aragón", 8],
    ["Asturias", 8], ["Baleares", 8], ["Canarias", 6.5], ["Cantabria", 10],
    ["Castilla-La Mancha", 9], ["Castilla y León", 8], ["Cataluña", 10],
    ["Extremadura", 6], ["Galicia", 10], ["La Rioja", 7], ["Madrid", 6],
    ["Murcia", 8], ["Navarra", 6.5], ["País Vasco", 6],
    ["Ceuta", 6], ["Melilla", 6]
  ];

  // provincia (slug de URL) -> CCAA, para autodetectar el ITP
  var PROV_CCAA = {
    valencia: "Comunitat Valenciana", alicante: "Comunitat Valenciana",
    alicante_alacant: "Comunitat Valenciana", castellon: "Comunitat Valenciana",
    castello: "Comunitat Valenciana", madrid: "Madrid", barcelona: "Cataluña",
    girona: "Cataluña", lleida: "Cataluña", tarragona: "Cataluña",
    sevilla: "Andalucía", malaga: "Andalucía", cadiz: "Andalucía",
    cordoba: "Andalucía", granada: "Andalucía", almeria: "Andalucía",
    jaen: "Andalucía", huelva: "Andalucía", zaragoza: "Aragón",
    huesca: "Aragón", teruel: "Aragón", oviedo: "Asturias",
    palma: "Baleares", "santa-cruz-de-tenerife": "Canarias",
    "las-palmas": "Canarias", santander: "Cantabria",
    albacete: "Castilla-La Mancha", cuenca: "Castilla-La Mancha",
    guadalajara: "Castilla-La Mancha", toledo: "Castilla-La Mancha",
    avila: "Castilla y León", burgos: "Castilla y León", leon: "Castilla y León",
    palencia: "Castilla y León", salamanca: "Castilla y León",
    segovia: "Castilla y León", soria: "Castilla y León",
    valladolid: "Castilla y León", zamora: "Castilla y León",
    "a-coruna": "Galicia", lugo: "Galicia", ourense: "Galicia",
    pontevedra: "Galicia", logrono: "La Rioja", murcia: "Murcia",
    pamplona: "Navarra", bilbao: "País Vasco", vitoria: "País Vasco",
    "san-sebastian": "País Vasco", badajoz: "Extremadura",
    caceres: "Extremadura", melilla: "Melilla", ceuta: "Ceuta"
  };

  var CFG_DEF = {
    ccaa: "Comunitat Valenciana",
    itp: 10,        // % ITP (segunda mano)
    iva: 10,        // % IVA vivienda obra nueva
    ajd: 1.5,       // % AJD obra nueva (CV 1,5%)
    notaria: 700,   // estimación €
    registro: 400,  // estimación €
    gestoria: 350,  // € (opcional, típica con hipoteca)
    tasacion: 400,  // € (opcional, solo si hay hipoteca)
    gestoriaOn: false,
    tasacionOn: false,
    reserva: 3000,  // € de la reserva (obra nueva, a cuenta)
    arras: 10,      // % de arras al firmar contrato (a cuenta)
    ibi: 500,       // €/año aproximados (para el coste mensual real)
    comunidad: 40,  // €/mes aproximados de comunidad
    regla: 35,      // % máx. de la cuota sobre el neto mensual del hogar
    neto: 2500,     // €/mes netos del hogar (para el % de endeudamiento)
    entrada: 20,    // % de entrada en la simulación
    plazo: 30,      // años
    interes: 3.0    // % TIN anual
  };

  function cfg() {
    var c = {};
    for (var k in CFG_DEF) c[k] = CFG_DEF[k];
    try {
      var g = JSON.parse(window.localStorage.getItem(LS_CFG) || "{}");
      for (var k2 in g) c[k2] = g[k2];
    } catch (e) {}
    return c;
  }
  function guardarCfg(c) {
    try { window.localStorage.setItem(LS_CFG, JSON.stringify(c)); } catch (e) {}
  }
  function encendido() {
    var v = null;
    try { v = window.localStorage.getItem(LS_ON); } catch (e) {}
    return v !== "0"; // por defecto ENCENDIDO
  }

  // ¿estamos en una ficha? También detecta iframes del propio idealista que
  // incrustan la tabla "pisos disponibles en venta" (con all_frames:true el
  // script corre dentro de ellos), y documentos de idealista sin la URL típica
  function esDetalle() {
    if (!/idealista\./.test(location.href)) return false; // solo idealista
    if (/idealista\.[a-z.]+\/(obra-nueva|inmueble)\//.test(location.href)) return true;
    try {
      var cuerpo = document.body && document.body.textContent || "";
      if (/pisos disponibles en venta/i.test(cuerpo)) return true;
      if (/obra nueva|edificio de nueva planta/i.test(cuerpo) && esPrecio(cuerpo)) return true;
    } catch (e) {}
    return false;
  }
  function esObraNueva() {
    if (/\/obra-nueva\//.test(location.href)) return true;
    try { // mismo origen: miramos si el padre es una ficha de obra nueva
      if (window.parent && window.parent !== window) {
        if (/\/obra-nueva\//.test(window.parent.location.href)) return true;
      }
    } catch (e) {}
    try { // último recurso: texto del documento
      return /obra nueva|edificio de nueva planta|entrega en/i.test(
        (document.body && document.body.textContent) || "");
    } catch (e) { return false; }
  }

  // autodetecta CCAA por la URL o por enlaces de la página (provincia)
  function detectarCCAA() {
    var textos = [location.href];
    try {
      document.querySelectorAll('a[href]').forEach(function (a) {
        var h = a.getAttribute("href") || "";
        if (/\/(venta|alquiler|obra-nueva)/.test(h)) textos.push(h);
      });
    } catch (e) {}
    for (var i = 0; i < textos.length; i++) {
      var m = textos[i].match(/\/([a-z_]+)(?:-provincia)?\/(?:[a-z_]|$)/);
      if (m && PROV_CCAA[m[1]]) return PROV_CCAA[m[1]];
    }
    return null;
  }

  // ---------------------------------------------------------------- utils
  function fmt(n) {
    try { return Math.round(n).toLocaleString("es-ES") + " €"; }
    catch (e) { return Math.round(n) + " €"; }
  }
  function pct(n) { return String(n).replace(".", ",") + " %"; }
  // "Desde 242.000 €", "1.234.567 €", "242000 €"… (el prefijo "Desde" de las
  // promociones NO debe romper la extracción)
  function num(txt) {
    var t = (txt || "").replace(/\./g, "").replace(",", ".")
      .replace(/[^\d.]/g, "");
    var n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  }
  // texto que ES exactamente un precio (con o sin "Desde")
  function esPrecio(txt) {
    return /^(?:desde\s+)?\d{1,3}(?:\.\d{3})*\s?€$/i.test((txt || "").trim());
  }

  // cálculo completo a partir del precio y la config
  function calcular(precio, c, obraNueva) {
    var imp = obraNueva
      ? precio * c.iva / 100 + precio * c.ajd / 100
      : precio * c.itp / 100;
    var gastos = c.notaria + c.registro +
      (c.gestoriaOn ? c.gestoria : 0) + (c.tasacionOn ? c.tasacion : 0);

    // cronograma de pagos
    var entrada = precio * c.entrada / 100;
    var reserva = Math.min(obraNueva ? c.reserva : 0, entrada);
    var arras = Math.min(precio * c.arras / 100, entrada - reserva);
    var restoEntrada = Math.max(entrada - reserva - arras, 0);

    var prestamo = precio - entrada;
    var meses = c.plazo * 12;
    var i = c.interes / 100 / 12;
    var cuota = i > 0
      ? prestamo * i / (1 - Math.pow(1 + i, -meses))
      : prestamo / Math.max(meses, 1);

    var costeMensualReal = cuota + c.comunidad + c.ibi / 12;

    return {
      impuestos: imp, gastos: gastos, final: precio + imp + gastos,
      entrada: entrada, reserva: reserva, arras: arras, restoEntrada: restoEntrada,
      prestamo: prestamo, cuota: cuota, meses: meses,
      intereses: cuota * meses - prestamo,
      liquido: entrada + imp + gastos,                 // TODA la pasta hasta escritura
      escritura: restoEntrada + imp + gastos,          // pasta solo en el día de firma
      totalConHipoteca: entrada + imp + gastos + cuota * meses,
      costeMensualReal: costeMensualReal,
      // % de endeudamiento: coste real mensual sobre el neto del hogar
      endeudamiento: c.neto > 0 ? costeMensualReal / c.neto * 100 : null,
      ingresoMinMes: costeMensualReal / (c.regla / 100),
      ingresoMinAno: costeMensualReal / (c.regla / 100) * 12
    };
  }

  // ------------------------------------------------------------ estilos
  // CSS blindado con !important: el de idealista pisa todo lo que no se proteja
  var CSS =
    // badge junto al precio
    // línea "final ≈ X €" bajo el precio — SIEMPRE visible, texto natural de
    // la página, ocupa el ancho del bloque y deja partir la línea si hace falta
    ".izpf-badge{display:block !important;margin:2px 0 0 0 !important;padding:0 !important;" +
    "background:none !important;border:none !important;border-radius:0 !important;" +
    "font:400 12.5px/1.45 system-ui,sans-serif !important;" +
    "color:#64748b !important;cursor:pointer !important;user-select:none !important;" +
    "width:auto !important;max-width:100% !important;height:auto !important;" +
    "text-transform:none !important;letter-spacing:normal !important;box-shadow:none !important;" +
    "text-align:left !important;white-space:normal !important;}" +
    ".izpf-badge b{color:#b45309 !important;font-weight:600 !important;}" +
    ".izpf-badge:hover{color:#334155 !important;background:none !important;}" +
    // panel contenedor
    ".izpf-panel{background:#fff !important;border:1px solid #e2e8f0 !important;border-radius:10px !important;" +
    "box-shadow:0 4px 16px rgba(0,0,0,.18) !important;padding:10px 14px !important;margin:6px 0 0 0 !important;" +
    "z-index:99999 !important;font:13px/1.45 system-ui,sans-serif !important;color:#0f172a !important;" +
    "width:640px !important;max-width:calc(100vw - 32px) !important;text-align:left !important;" +
    "overflow-x:auto !important;" + // sin tope de alto: TODO el desglose se ve
    "box-sizing:border-box !important;clear:both !important;position:relative !important;}" +
    ".izpf-panel *{box-sizing:border-box !important;font-family:system-ui,sans-serif !important;}" +
    // textos y tablas del panel
    ".izpf-panel h4{margin:0 0 6px !important;font-size:13px !important;color:#334155 !important;" +
    "font-weight:700 !important;text-transform:none !important;letter-spacing:normal !important;padding:0 !important;}" +
    ".izpf-panel table{width:100% !important;border-collapse:collapse !important;margin:0 !important;" +
    "background:none !important;border:none !important;}" +
    ".izpf-panel td{padding:2px 0 !important;vertical-align:top !important;border:none !important;" +
    "background:none !important;color:inherit !important;font-size:13px !important;font-weight:400 !important;}" +
    ".izpf-panel td.d{color:#475569 !important;}" +
    ".izpf-panel td.e{text-align:right !important;font-variant-numeric:tabular-nums !important;" +
    "font-weight:600 !important;white-space:nowrap !important;color:#0f172a !important;}" +
    ".izpf-panel tr.tot td{border-top:1px solid #cbd5e1 !important;padding-top:5px !important;font-weight:700 !important;}" +
    ".izpf-panel tr.tot td.e{color:#b45309 !important;}" +
    ".izpf-panel .izpf-nota{margin-top:6px !important;font-size:11px !important;color:#64748b !important;}" +
    // destacado amarillo del líquido necesario
    ".izpf-panel .izpf-destacado{margin:8px 0 0 0 !important;background:#fefce8 !important;" +
    "border:1px solid #fde047 !important;border-radius:8px !important;padding:6px 10px !important;}" +
    ".izpf-panel .izpf-destacado b.big{font-size:17px !important;color:#854d0e !important;}" +
    ".izpf-panel .izpf-destacado .sub{font-size:11px !important;color:#a16207 !important;font-weight:400 !important;}" +
    // secciones
    ".izpf-panel .izpf-secc{margin:8px 0 0 0 !important;border-top:1px dashed #cbd5e1 !important;padding-top:6px !important;}" +
    ".izpf-panel .izpf-secc>b{font-size:12px !important;color:#334155 !important;" +
    "font-weight:700 !important;text-transform:none !important;letter-spacing:normal !important;}" +
    // inputs y labels — el CSS de idealista los pinta enormes sin esto
    ".izpf-panel input[type=number],.izpf-panel input[type=text]{width:56px !important;max-width:56px !important;" +
    "height:auto !important;padding:2px 4px !important;margin:0 !important;border:1px solid #cbd5e1 !important;" +
    "border-radius:5px !important;font:12px system-ui,sans-serif !important;background:#fff !important;" +
    "color:#0f172a !important;box-shadow:none !important;box-sizing:border-box !important;" +
    "display:inline-block !important;line-height:1.3 !important;float:none !important;}" +
    ".izpf-panel input[type=checkbox]{width:auto !important;height:auto !important;margin:0 3px 0 0 !important;" +
    "accent-color:#b45309 !important;cursor:pointer !important;display:inline-block !important;float:none !important;" +
    "position:static !important;opacity:1 !important;appearance:auto !important;}" +
    ".izpf-panel select{width:auto !important;max-width:200px !important;height:auto !important;padding:2px 4px !important;" +
    "font:12px system-ui,sans-serif !important;border:1px solid #cbd5e1 !important;border-radius:5px !important;" +
    "background:#fff !important;color:#0f172a !important;display:inline-block !important;float:none !important;}" +
    ".izpf-panel label{font-size:12px !important;color:#475569 !important;font-weight:400 !important;" +
    "text-transform:none !important;letter-spacing:normal !important;display:inline !important;" +
    "margin:0 !important;padding:0 !important;background:none !important;border:none !important;" +
    "cursor:default !important;float:none !important;line-height:1.4 !important;}" +
    ".izpf-panel .izpf-fila{display:flex !important;align-items:center !important;gap:6px !important;" +
    "margin:3px 0 !important;flex-wrap:wrap !important;}" +
    // chips de escenarios
    ".izpf-panel .izpf-chips{display:flex !important;flex-wrap:wrap !important;gap:4px !important;margin-top:4px !important;}" +
    ".izpf-panel .izpf-chip{background:#f1f5f9 !important;border:1px solid #cbd5e1 !important;" +
    "border-radius:12px !important;padding:2px 8px !important;font:600 11px system-ui,sans-serif !important;" +
    "color:#334155 !important;cursor:pointer !important;text-transform:none !important;letter-spacing:normal !important;" +
    "height:auto !important;width:auto !important;box-shadow:none !important;}" +
    ".izpf-panel .izpf-chip:hover{background:#e0f2fe !important;border-color:#7dd3fc !important;}" +
    ".izpf-panel .izpf-chip.sel{background:#dbeafe !important;border-color:#3b82f6 !important;color:#1d4ed8 !important;}" +
    // botones internos
    ".izpf-panel .izpf-btn{margin:8px 0 0 0 !important;font:600 12px system-ui,sans-serif !important;" +
    "color:#1d4ed8 !important;background:none !important;border:none !important;cursor:pointer !important;" +
    "padding:0 !important;text-transform:none !important;letter-spacing:normal !important;}" +
    ".izpf-panel .izpf-ajustes{display:none !important;margin-top:6px !important;}" +
    ".izpf-panel .izpf-ajustes.open{display:block !important;}" +
    ".izpf-panel .izpf-x{float:right !important;background:none !important;border:none !important;" +
    "cursor:pointer !important;color:#94a3b8 !important;font:14px system-ui,sans-serif !important;" +
    "padding:0 !important;margin:0 !important;width:auto !important;height:auto !important;" +
    "text-transform:none !important;}" +
    ".izpf-panel .izpf-x:hover{color:#334155 !important;}";

  var raicesEstiladas = new Set();
  function ponerCSS() {
    // el CSS en <head> solo estiliza el light DOM; si el precio está en un
    // shadow root hay que colgarle su propia copia del CSS (árbol de estilos aparte)
    raicesDOM().forEach(function (raiz) {
      if (raiz === document) {
        if (raicesEstiladas.has(document)) return;
        var st = document.createElement("style");
        st.textContent = CSS;
        document.head.appendChild(st);
        raicesEstiladas.add(document);
      } else {
        if (raicesEstiladas.has(raiz)) return;
        var st2 = document.createElement("style");
        st2.textContent = CSS;
        raiz.appendChild(st2);
        raicesEstiladas.add(raiz);
      }
    });
  }
  // documento + todos los shadowRoots abiertos, recursivo
  function raicesDOM() {
    var raices = [document];
    function buscar(r) {
      try {
        var todos = r.querySelectorAll("*");
        for (var i = 0; i < todos.length; i++) {
          if (todos[i].shadowRoot) {
            raices.push(todos[i].shadowRoot);
            buscar(todos[i].shadowRoot);
          }
        }
      } catch (e) {}
    }
    buscar(document);
    return raices;
  }

  // -------------------------------------------------------------- panel
  function crearPanel(precio, obraNueva, c) {
    var panel = document.createElement("div");
    panel.className = "izpf-panel";
    var r = calcular(precio, c, obraNueva);

    function fila(d, e) { return "<tr><td class='d'>" + d + "</td><td class='e'>" + e + "</td></tr>"; }

    // ---- desglose del precio
    var html = "<h4>💶 Precio final (" + (obraNueva ? "obra nueva" : "segunda mano") +
      " · " + c.ccaa + ")" +
      "<button class='izpf-x' title='cerrar'>✕</button></h4><table>";
    html += fila("Precio de venta", fmt(precio));
    if (obraNueva) {
      html += fila("IVA vivienda (" + pct(c.iva) + ")", fmt(precio * c.iva / 100));
      html += fila("AJD (" + pct(c.ajd) + ")", fmt(precio * c.ajd / 100));
    } else {
      html += fila("ITP (" + pct(c.itp) + ")", fmt(precio * c.itp / 100));
    }
    html += fila("Notaría (est.)", fmt(c.notaria));
    html += fila("Registro (est.)", fmt(c.registro));
    if (c.gestoriaOn) html += fila("Gestoría", fmt(c.gestoria));
    if (c.tasacionOn) html += fila("Tasación", fmt(c.tasacion));
    html += "<tr class='tot'><td>PRECIO FINAL</td><td class='e'>" + fmt(r.final) + "</td></tr>";
    html += "<tr><td class='d'>Equivale a un</td><td class='e'>+" +
      (100 * (r.final / precio - 1)).toFixed(1).replace(".", ",") + "%</td></tr>";
    html += "</table>";

    // ---- líquido necesario (lo que de verdad hay que tener ahorrado)
    html += "<div class='izpf-destacado'>💰 Necesitas <b class='big'>" + fmt(r.liquido) +
      " líquidos</b> hasta la escritura" +
      "<div class='sub'>entrada " + pct(c.entrada) + " (" + fmt(r.entrada) + ") + impuestos " +
      fmt(r.impuestos) + " + gastos " + fmt(r.gastos) + "</div>" +
      "<div class='sub'>En el día de firma solo hacen falta " + fmt(r.escritura) +
      " (la reserva y las arras se van pagando antes).</div></div>";

    // ---- cronograma: cuándo pagas cada cosa
    html += "<div class='izpf-secc'><b>📅 Cuándo pagas cada cosa</b><table>";
    if (r.reserva > 0) html += fila("Reserva (hoy, para bloquearlo)", fmt(r.reserva));
    if (r.arras > 0) html += fila((obraNueva ? "Arras (firma contrato, 1–3 meses)" : "Arras de señas (al pactar)") +
      " (" + pct(c.arras) + ")", fmt(r.arras));
    if (r.restoEntrada > 0) html += fila("Resto de entrada (en la escritura)", fmt(r.restoEntrada));
    html += fila(obraNueva ? "IVA + AJD (escritura)" : "ITP (escritura)", fmt(r.impuestos));
    html += fila("Notaría + registro + gastos (escritura)", fmt(r.gastos));
    html += "<tr class='tot'><td>LÍQUIDO TOTAL</td><td class='e'>" + fmt(r.liquido) + "</td></tr>";
    html += "</table>";
    if (obraNueva) {
      html += "<div class='izpf-nota'>📌 La reserva y las arras son <b>a cuenta del precio</b> " +
        "(no suman coste). Si al final no compras, las arras se pierden si te echas atrás tú.</div>";
    }
    html += "</div>";

    // ---- simulación de hipoteca
    html += "<div class='izpf-secc izpf-sim'><b>🏦 Simulación hipoteca</b>" +
      "<div class='izpf-fila'><label>Entrada:</label>" +
      "<input class='izpf-in' data-k='entrada' type='number' min='0' max='100' step='5' value='" + c.entrada + "'>%" +
      "<span class='izpf-ent' style='color:#64748b'>(" + fmt(r.entrada) + ")</span></div>" +
      "<div class='izpf-fila'><label>Hipoteca (80%):</label><span class='izpf-hip'><b>" + fmt(r.prestamo) + "</b></span></div>" +
      "<div class='izpf-fila'><label>Plazo:</label>" +
      "<input class='izpf-in' data-k='plazo' type='number' min='1' max='50' value='" + c.plazo + "'>años" +
      "<label style='margin-left:10px'>Interés:</label>" +
      "<input class='izpf-in' data-k='interes' type='number' min='0' max='25' step='0.1' value='" + c.interes + "'>%</div>" +
      "<table style='margin-top:4px'>" +
      fila("Cuota mensual", "<b>" + fmt(r.cuota) + "</b>") +
      fila("Intereses totales (" + r.meses + " cuotas)", fmt(r.intereses)) +
      fila("Coste mensual real (+comunidad " + fmt(c.comunidad) + " + IBI " + fmt(c.ibi) + ")", "<b>" + fmt(r.costeMensualReal) + "</b>") +
      "<tr><td class='d'>Neto del hogar:</td><td class='e'><input class='izpf-in' data-k='neto' type='number' step='100' value='" + c.neto + "' style='width:70px !important;'> €/mes</td></tr>" +
      "<tr><td class='d'>% de endeudamiento:</td><td class='e izpf-endeud'>" +
      (r.endeudamiento != null
        ? "<b style='color:" + (r.endeudamiento <= 30 ? "#16a34a" : r.endeudamiento <= 35 ? "#b45309" : "#dc2626") +
          " !important'>" + r.endeudamiento.toFixed(1).replace(".", ",") + " %</b> " +
          (r.endeudamiento <= 30 ? "✔ bien" : r.endeudamiento <= 35 ? "⚠ justo" : "✖ demasiado")
        : "—") + "</td></tr>" +
      "<tr class='tot'><td>TODO pagado al final</td><td class='e'>" + fmt(r.totalConHipoteca) + "</td></tr>" +
      fila("Neto hogar necesario (cuota ≤ " + pct(c.regla) + ")", "<b>" + fmt(r.ingresoMinMes) + "/mes</b>") +
      "</table>";

    // ---- escenarios rápidos (entrada x plazo)
    html += "<b>⚡ Escenarios (interés actual " + pct(c.interes) + ")</b><div class='izpf-chips'>";
    var combos = [[20, 25], [20, 30], [25, 25], [25, 30], [30, 25], [30, 30]];
    combos.forEach(function (cb) {
      var c2 = {};
      for (var k in c) c2[k] = c[k];
      c2.entrada = cb[0]; c2.plazo = cb[1];
      var q = calcular(precio, c2, obraNueva);
      var sel = (c.entrada === cb[0] && c.plazo === cb[1]) ? " izpf-chip sel" : "";
      html += "<span class='izpf-chip" + sel + "' data-e='" + cb[0] + "' data-p='" + cb[1] +
        "'>" + cb[0] + "% · " + cb[1] + "a → " + fmt(q.cuota) + "/mes</span>";
    });
    html += "</div></div>";

    // ---- ajustes editables
    html += "<div class='izpf-ajustes'><table>" +
      (!obraNueva ?
        "<div class='izpf-fila'><label>CCAA:</label><select class='izpf-sel'></select></div>" +
        "<div class='izpf-fila'><label>ITP %:</label>" +
        "<input class='izpf-in' data-k='itp' type='number' step='0.5' value='" + c.itp + "'></div>" : "") +
      "<div class='izpf-fila'><label>IVA % (obra nueva):</label>" +
      "<input class='izpf-in' data-k='iva' type='number' step='0.5' value='" + c.iva + "'></div>" +
      "<div class='izpf-fila'><label>AJD % (obra nueva):</label>" +
      "<input class='izpf-in' data-k='ajd' type='number' step='0.1' value='" + c.ajd + "'></div>" +
      "<div class='izpf-fila'><label>Notaría €:</label>" +
      "<input class='izpf-in' data-k='notaria' type='number' step='50' value='" + c.notaria + "'></div>" +
      "<div class='izpf-fila'><label>Registro €:</label>" +
      "<input class='izpf-in' data-k='registro' type='number' step='50' value='" + c.registro + "'></div>" +
      "<div class='izpf-fila'><label><input type='checkbox' class='izpf-chk' data-k='gestoriaOn'" +
      (c.gestoriaOn ? " checked" : "") + "> Gestoría €:</label>" +
      "<input class='izpf-in' data-k='gestoria' type='number' step='50' value='" + c.gestoria + "'></div>" +
      "<div class='izpf-fila'><label><input type='checkbox' class='izpf-chk' data-k='tasacionOn'" +
      (c.tasacionOn ? " checked" : "") + "> Tasación €:</label>" +
      "<input class='izpf-in' data-k='tasacion' type='number' step='50' value='" + c.tasacion + "'></div>" +
      "<div class='izpf-fila'><label>Reserva € (a cuenta):</label>" +
      "<input class='izpf-in' data-k='reserva' type='number' step='500' value='" + c.reserva + "'></div>" +
      "<div class='izpf-fila'><label>Arras % (a cuenta):</label>" +
      "<input class='izpf-in' data-k='arras' type='number' step='1' value='" + c.arras + "'></div>" +
      "<div class='izpf-fila'><label>IBI €/año:</label>" +
      "<input class='izpf-in' data-k='ibi' type='number' step='50' value='" + c.ibi + "'></div>" +
      "<div class='izpf-fila'><label>Comunidad €/mes:</label>" +
      "<input class='izpf-in' data-k='comunidad' type='number' step='5' value='" + c.comunidad + "'></div>" +
      "<div class='izpf-fila'><label>Esfuerzo máx. (cuota sobre neto):</label>" +
      "<select class='izpf-selregla'><option value='30'" + (c.regla === 30 ? " selected" : "") + ">30 % (cómodo)</option>" +
      "<option value='35'" + (c.regla === 35 ? " selected" : "") + ">35 % (límite bancario)</option></select></div>" +
      "<div class='izpf-nota'>Tipos por defecto (editable). Los impuestos se calculan sobre el " +
      "precio de escritura; si el valor de referencia catastral es mayor, Hacienda usa el mayor. " +
      "El ITP de cada CCAA cambia: ajústalo si lo necesitas.</div>" +
      "</table></div>" +
      "<button class='izpf-btn izpf-btn-aj'>⚙ ajustar impuestos, gastos y supuestos</button>";

    panel.innerHTML = html;

    // ---- anti-navegación: cortamos el evento en CAPTURA para que no llegue
    // ni a la <a> de la fila ni a delegados de idealista; los handlers internos
    // (inputs, chips, botones) están por debajo y siguen ejecutándose
    panel.addEventListener("click", function (ev) { ev.stopPropagation(); }, true);

    // ---- comportamiento
    panel.querySelector(".izpf-x").addEventListener("click", function () {
      panel.style.display = "none"; // solo oculta: "precio final" lo re-muestra
    });

    function refrescar() {
      // recalcular en sitio re-creando el panel (sencillo y sin fugas)
      var oculto = panel.style.display === "none";
      var nuevo = crearPanel(precio, obraNueva, cfg());
      if (oculto) nuevo.style.display = "none";
      panel.replaceWith(nuevo);
    }

    panel.querySelectorAll(".izpf-in").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var c2 = cfg();
        var k = inp.getAttribute("data-k");
        var v = parseFloat(inp.value);
        if (!isNaN(v)) c2[k] = v;
        guardarCfg(c2);
        refrescar();
      });
    });
    panel.querySelectorAll(".izpf-chk").forEach(function (chk) {
      chk.addEventListener("change", function () {
        var c2 = cfg();
        c2[chk.getAttribute("data-k")] = chk.checked;
        guardarCfg(c2);
        refrescar();
      });
    });
    panel.querySelectorAll(".izpf-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var c2 = cfg();
        c2.entrada = parseFloat(chip.getAttribute("data-e"));
        c2.plazo = parseFloat(chip.getAttribute("data-p"));
        guardarCfg(c2);
        refrescar();
      });
    });
    var selRegla = panel.querySelector(".izpf-selregla");
    if (selRegla) {
      selRegla.addEventListener("change", function () {
        var c2 = cfg();
        c2.regla = parseFloat(selRegla.value);
        guardarCfg(c2);
        refrescar();
      });
    }
    var sel = panel.querySelector(".izpf-sel");
    if (sel) {
      ITP_CCAA.forEach(function (par) {
        var op = document.createElement("option");
        op.textContent = par[0] + " (" + String(par[1]).replace(".", ",") + "%)";
        sel.appendChild(op);
      });
      sel.value = c.ccaa;
      sel.addEventListener("change", function () {
        var c2 = cfg();
        c2.ccaa = sel.value;
        var hallada = ITP_CCAA.find(function (p) { return p[0] === sel.value; });
        if (hallada) c2.itp = hallada[1];
        guardarCfg(c2);
        refrescar();
      });
    }
    panel.querySelector(".izpf-btn-aj").addEventListener("click", function () {
      panel.querySelector(".izpf-ajustes").classList.toggle("open");
    });

    return panel;
  }

  // -------------------------------------------------------------- badge
  function inyectarEn(el) {
    if (el.__izpf) return;
    // nunca inyectar dentro de nuestros propios paneles/badges
    if (el.closest && el.closest(".izpf-panel")) return;
    if (el.closest && el.closest(".izpf-badge")) return;
    // solo donde se ve de verdad (idealista tiene copias ocultas del precio)
    if (!visible(el)) return;
    el.__izpf = true;
    var padre = el.parentElement;
    if (!padre) return;
    var precio = num(el.textContent);
    // rango de vivienda (evita referencias, m², fechas… que casen por accidente)
    if (precio < 10000 || precio > 5000000) return;
    // Dónde colgar badge y panel: dentro del propio bloque del precio si es
    // suficientemente "sólido" (block, flex, table-cell — como las celdas de
    // la tabla de unidades), o en su padre si es un inline suelto.
    // NOTA: aunque el bloque esté dentro de un <a> (fila enlazable de idealista),
    // cancelamos la navegación con preventDefault/stopPropagation en badge y panel.
    var disp = "";
    try { disp = window.getComputedStyle(el).display; } catch (e) {}
    var contenedor = (disp === "inline" || disp === "inline-block" || disp === "inline-flex") ? padre : el;

    var obraNueva = esObraNueva();
    var c = cfg();
    var r = calcular(precio, c, obraNueva);

    var badge = document.createElement("div");
    badge.className = "izpf-badge";
    // SIEMPRE visible sin click: en el precio principal, con líquido y cuota;
    // en las filas de unidades, la línea corta. Sin emojis ni estilo de botón
    var esMain = el.closest("#priceContainer, .info-data.price");
    badge.innerHTML = esMain
      ? "precio final <b>" + fmt(r.final) + "</b> · líquido " + fmt(r.liquido) +
        " · cuota " + fmt(r.cuota) + "/mes"
      : "precio final <b>" + fmt(r.final) + "</b>";
    badge.title = "Precio real con impuestos y gastos (IVA/AJD/ITP + notaría, registro…) — click para mostrar/ocultar el desglose";

    // SIEMPRE VISIBLE: el panel se monta de entrada, sin pulsar nada.
    // El click en "precio final" (o en el ✕) solo lo oculta / vuelve a mostrar.
    contenedor.appendChild(badge);
    contenedor.appendChild(crearPanel(precio, obraNueva, cfg()));
  }

  // alterna el panel de un badge (ocultado con el ✕)
  function alternarPanel(badge) {
    var cont = badge.parentElement;
    if (!cont) return;
    var panel = cont.querySelector(":scope > .izpf-panel");
    if (panel) panel.style.display = (panel.style.display === "none") ? "" : "none";
  }

  // UN solo listener global en CAPTURA, registrado al cargar (document_start):
  // corre ANTES que cualquier handler de idealista. Decide todo:
  //  · click en "precio final" → que la fila (<a>) NO navegue y alternar panel
  //  · click en el panel → anula el <a> en los clics inertes; checkboxes,
  //    selects y botones conservan su comportamiento nativo
  // ¿el click cayó dentro del bloque que alberga un precio final? (celda de la
  // tabla de unidades o precio principal) — para que pulsar el precio de la fila
  // abra/oculte el panel en lugar de navegar al anuncio
  function bloqueDelPrecio(t) {
    var a = t;
    while (a && a !== document.body) {
      if (a.querySelector && a.querySelector(":scope > .izpf-badge")) return a;
      a = a.parentElement;
    }
    return null;
  }

  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var badge = t.closest(".izpf-badge");
    if (badge) {
      ev.preventDefault();
      ev.stopPropagation();
      alternarPanel(badge);
      return;
    }
    var panel = t.closest(".izpf-panel");
    if (panel) {
      var tg = t.tagName;
      if (tg !== "INPUT" && tg !== "SELECT" && tg !== "OPTION" && tg !== "LABEL" && tg !== "BUTTON") {
        ev.preventDefault(); // clics inertes: anula el <a> de la fila
      }
      return;
    }
    // el propio bloque del precio (celda / precio principal): no navegar
    var bloque = bloqueDelPrecio(t);
    if (bloque) {
      ev.preventDefault();
      ev.stopPropagation();
      alternarPanel(bloque.querySelector(":scope > .izpf-badge"));
    }
  }, true);

  // ------------------------------------------------------------- barrido

  // ¿el elemento o alguno de sus ancestros YA FUE PROCESADO? (evita duplicados)
  // OJO: solo miramos la marca __izpf de los ancestros. No podemos usar
  // querySelector(".izpf-badge") aquí: cualquier ancestro alto (body) contiene
  // TODOS los badges de la página y bloquearía el resto de precios en cadena.
  function familiaConBadge(el) {
    var a = el;
    while (a) {
      if (a.__izpf) return true;
      a = a.parentElement;
    }
    return false;
  }

  function log(m) {
    try { console.log("[idealista-zonas/precio-final] " + m); } catch (e) {}
  }
  // ¿se ve de verdad? (display:none o fuera de pantalla => rect vacío)
  function visible(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // escanea una raíz (document o shadow root) y devuelve nº de badges nuevos
  function escanearRaiz(raiz) {
    var candidatos = 0, nuevos = 0;
    var walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var t = node.nodeValue || "";
      // rama A: precio con € en el propio nodo ("Desde 242.000 €")
      // rama B: idealista parte el precio y la divisa en nodos distintos
      //         ("242.000" + " €") — exigimos separadores de miles para no
      //         pillar referencias ni estadísticas ("49254", "107807646")
      var m = t.match(/(?:desde\s+)?\d{1,3}(?:\.\d{3})*\s?€/i) ||
              t.match(/(?:desde\s+)?\d{1,3}(?:\.\d{3})+/);
      if (!m) continue;
      var host = node.parentElement;
      if (!host || !visible(host)) continue;
      if (host.closest(".izpf-panel") || host.closest(".izpf-badge")) continue;

      // subir como mucho 4 niveles hasta que el bloque sea ~el precio solo
      var objetivo = host, subidas = 0;
      while (objetivo.parentElement && subidas < 4) {
        var pt = (objetivo.parentElement.textContent || "").trim();
        if (pt.length <= m[0].trim().length + 12 && visible(objetivo.parentElement)) {
          objetivo = objetivo.parentElement; subidas++;
        } else break;
      }
      // si aun así el bloque trae más cosas (fila entera), lo saltamos
      if ((objetivo.textContent || "").trim().length > m[0].trim().length + 12) continue;
      if (objetivo.__izpf || familiaConBadge(objetivo)) continue;

      candidatos++;
      inyectarEn(objetivo);
      nuevos++;
      if (candidatos >= 40) break;
    }
    // diagnóstico: si el último badge quedó en un sitio que no se pinta, lo decimos
    var badges = document.querySelectorAll(".izpf-badge");
    var ultimo = badges.length ? badges[badges.length - 1] : null;
    if (nuevos && ultimo && !visible(ultimo)) {
      log("ojo: badge inyectado pero NO visible (contenedor <" +
        (ultimo.parentElement ? ultimo.parentElement.tagName : "?") +
        " class=\"" + ((ultimo.parentElement || {}).className || "") + "\">");
    }
    return nuevos;
  }

  function buscarPrecios() {
    if (!encendido() || !esDetalle()) return;
    try {
      ponerCSS();

      // Escaneo por NODOS DE TEXTO en el documento Y en cada shadow root:
      // la tabla "pisos disponibles en venta" es un web component y no se ve
      // desde el documento principal sin esto.
      var nuevos = 0;
      raicesDOM().forEach(function (raiz) {
        nuevos += escanearRaiz(raiz);
      });

      var total = document.querySelectorAll(".izpf-badge").length;
      if (total > 0) log(total + " precio(s) final(es) visibles (nuevos: " + nuevos + ")");
      else log("detalle sin inyectar — nuevos:" + nuevos);
    } catch (e) {
      log("ERROR en buscarPrecios: " + e.message + "\n" + (e.stack || ""));
    }
  }

  // arrancar cuando haya DOM
  function iniciar() {
    try {
      // ajusta CCAA la primera vez por la provincia de la página
      var c = cfg();
      var ccaa = detectarCCAA();
      if (ccaa && !window.localStorage.getItem(LS_CFG)) {
        var hallada = ITP_CCAA.find(function (p) { return p[0] === ccaa; });
        c.ccaa = ccaa;
        if (hallada) c.itp = hallada[1];
        guardarCfg(c);
      }
      log("v" + VERSION + " arrancando en " + location.href);

      // idealista inyecta la tabla de unidades dinámicamente y navega en SPA:
      var t = null;
      new MutationObserver(function () {
        clearTimeout(t);
        t = setTimeout(buscarPrecios, 400);
      }).observe(document.body, { childList: true, subtree: true });

      window.addEventListener("iz_urlchange", buscarPrecios); // lo dispara hook.js

      // reintentos por si el contenido llega tarde (o el observer no dispara)
      [500, 1000, 2000, 4000, 8000, 15000].forEach(function (ms) {
        setTimeout(buscarPrecios, ms);
      });
      buscarPrecios();
    } catch (e) {
      log("ERROR en iniciar: " + e.message + "\n" + (e.stack || ""));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
