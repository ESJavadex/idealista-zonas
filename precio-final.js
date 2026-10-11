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

  var VERSION = "2.0.0"; // se canta en consola: así sabemos qué build corre de verdad

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
    if (!/idealista\./.test(location.href) && !window.__IZ_TEST) return false; // solo idealista (o pruebas)
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
    try { return Math.round(n).toLocaleString("es-ES", { useGrouping: "always" }) + " €"; }
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
    // línea "precio final X €" bajo el precio: texto natural de la página
    ".izpf-badge{display:block !important;margin:2px 0 0 0 !important;padding:0 !important;" +
    "background:none !important;border:none !important;border-radius:0 !important;" +
    "font:400 13px/1.45 inherit !important;font-family:inherit !important;" +
    "color:#6b7280 !important;cursor:pointer !important;user-select:none !important;" +
    "width:auto !important;max-width:100% !important;height:auto !important;" +
    "text-transform:none !important;letter-spacing:normal !important;box-shadow:none !important;" +
    "text-align:left !important;white-space:normal !important;}" +
    ".izpf-badge b{color:#b45309 !important;font-weight:700 !important;}" +
    ".izpf-badge:hover{color:#141414 !important;background:none !important;}" +
    // panel
    ".izpf-panel{background:#fff !important;border:1px solid #e5e6e1 !important;border-radius:6px !important;" +
    "box-shadow:0 2px 10px rgba(0,0,0,.08) !important;padding:0 !important;margin:8px 0 0 0 !important;" +
    "font-size:14px !important;line-height:1.45 !important;color:#141414 !important;" +
    "width:680px !important;max-width:calc(100vw - 32px) !important;text-align:left !important;" +
    "box-sizing:border-box !important;clear:both !important;position:relative !important;overflow:hidden !important;}" +
    ".izpf-panel *{box-sizing:border-box !important;font-family:inherit !important;}" +
    ".izpf-panel .izpf-hd{display:flex !important;align-items:center !important;gap:8px !important;" +
    "background:#6f6f6d !important;color:#fff !important;padding:6px 12px 6px 16px !important;}" +
    ".izpf-panel .izpf-hd .t{flex:1 !important;font-weight:700 !important;font-size:15px !important;}" +
    ".izpf-panel .izpf-hd .t small{font-weight:400 !important;opacity:.85 !important;font-size:12px !important;margin-left:6px !important;}" +
    ".izpf-panel .izpf-hb{all:unset;cursor:pointer !important;font-size:12.5px !important;font-weight:600 !important;" +
    "padding:3px 9px !important;border-radius:4px !important;background:rgba(255,255,255,.15) !important;color:#fff !important;white-space:nowrap !important;}" +
    ".izpf-panel .izpf-hb:hover{background:rgba(255,255,255,.3) !important;}" +
    ".izpf-panel .izpf-hb.on{background:#fde047 !important;color:#422006 !important;}" +
    // cifras clave
    ".izpf-panel .izpf-kpis{display:grid !important;grid-template-columns:repeat(4,1fr) !important;gap:8px !important;padding:12px 16px 4px !important;}" +
    ".izpf-panel .izpf-kpi{border:1px solid #eeefeb !important;border-left:4px solid #b45309 !important;border-radius:4px !important;padding:7px 10px !important;background:#fff !important;}" +
    ".izpf-panel .izpf-kpi .k{font-size:11.5px !important;color:#6b7280 !important;font-weight:600 !important;text-transform:uppercase !important;letter-spacing:.02em !important;}" +
    ".izpf-panel .izpf-kpi .v{font-size:19px !important;font-weight:800 !important;line-height:1.2 !important;margin-top:2px !important;white-space:nowrap !important;}" +
    ".izpf-panel .izpf-kpi .s{font-size:12px !important;color:#6b7280 !important;line-height:1.3 !important;}" +
    "@media (max-width:720px){.izpf-panel .izpf-kpis{grid-template-columns:repeat(2,1fr) !important;}}" +
    // cuerpo a 2 columnas
    ".izpf-panel .izpf-grid{display:grid !important;grid-template-columns:1fr 1fr !important;column-gap:22px !important;padding:6px 16px 4px !important;}" +
    ".izpf-panel .izpf-col{min-width:0 !important;}" +
    "@media (max-width:720px){.izpf-panel .izpf-grid{grid-template-columns:1fr !important;}}" +
    ".izpf-panel h5{margin:12px 0 6px !important;padding:0 0 4px !important;font-size:12px !important;font-weight:700 !important;" +
    "color:#6b7280 !important;text-transform:uppercase !important;letter-spacing:.03em !important;border-bottom:1px solid #eeefeb !important;}" +
    ".izpf-panel table{width:100% !important;border-collapse:collapse !important;margin:0 !important;background:none !important;border:none !important;}" +
    ".izpf-panel td{padding:3px 0 !important;vertical-align:top !important;border:none !important;background:none !important;" +
    "color:inherit !important;font-size:14px !important;font-weight:400 !important;}" +
    ".izpf-panel td.d{color:#4b5563 !important;}" +
    ".izpf-panel td.e{text-align:right !important;font-variant-numeric:tabular-nums !important;font-weight:600 !important;white-space:nowrap !important;color:#141414 !important;padding-left:8px !important;}" +
    ".izpf-panel tr.tot td{border-top:1px solid #d1d5db !important;padding-top:6px !important;font-weight:700 !important;}" +
    ".izpf-panel tr.tot td.e{color:#b45309 !important;}" +
    ".izpf-panel .izpf-nota{margin-top:6px !important;font-size:12px !important;color:#6b7280 !important;}" +
    // calendario de pagos
    ".izpf-panel .izpf-tl{list-style:none !important;margin:0 !important;padding:0 0 0 14px !important;border-left:2px solid #e5e7eb !important;}" +
    ".izpf-panel .izpf-tl li{position:relative !important;margin:0 0 8px !important;padding:0 !important;list-style:none !important;font-size:14px !important;}" +
    ".izpf-panel .izpf-tl li::before{content:'' !important;position:absolute !important;left:-20px !important;top:5px !important;width:10px !important;height:10px !important;border-radius:50% !important;background:#b45309 !important;box-shadow:0 0 0 2px #fff !important;}" +
    ".izpf-panel .izpf-tl .cu{display:flex !important;justify-content:space-between !important;gap:8px !important;}" +
    ".izpf-panel .izpf-tl .cu b{white-space:nowrap !important;}" +
    ".izpf-panel .izpf-tl small{display:block !important;color:#6b7280 !important;font-size:12px !important;}" +
    // formulario hipoteca
    ".izpf-panel .izpf-form{display:grid !important;grid-template-columns:1fr 1fr !important;gap:6px 10px !important;margin:2px 0 8px !important;}" +
    ".izpf-panel .izpf-form label{display:block !important;font-size:12px !important;color:#6b7280 !important;font-weight:600 !important;margin:0 !important;padding:0 !important;" +
    "text-transform:none !important;letter-spacing:normal !important;background:none !important;border:none !important;float:none !important;line-height:1.4 !important;cursor:default !important;}" +
    ".izpf-panel .izpf-campo{display:flex !important;align-items:center !important;border:1px solid #d1d5db !important;border-radius:4px !important;background:#fff !important;overflow:hidden !important;}" +
    ".izpf-panel .izpf-campo:focus-within{border-color:#145bc7 !important;box-shadow:0 0 0 2px rgba(20,91,199,.15) !important;}" +
    ".izpf-panel .izpf-campo input{all:unset;flex:1 !important;min-width:0 !important;width:100% !important;padding:5px 8px !important;font-size:14px !important;font-weight:600 !important;color:#141414 !important;}" +
    ".izpf-panel .izpf-campo span{padding:0 8px !important;font-size:12px !important;color:#6b7280 !important;background:#f9fafb !important;align-self:stretch !important;display:flex !important;align-items:center !important;border-left:1px solid #e5e7eb !important;}" +
    // ajustes
    ".izpf-panel input[type=number],.izpf-panel input[type=text]{height:auto !important;margin:0 !important;box-shadow:none !important;float:none !important;}" +
    ".izpf-panel .izpf-ajustes input[type=number]{width:80px !important;padding:3px 6px !important;border:1px solid #d1d5db !important;border-radius:4px !important;font-size:13px !important;background:#fff !important;color:#141414 !important;display:inline-block !important;}" +
    ".izpf-panel input[type=checkbox]{width:auto !important;height:auto !important;margin:0 4px 0 0 !important;accent-color:#b45309 !important;cursor:pointer !important;" +
    "display:inline-block !important;float:none !important;position:static !important;opacity:1 !important;appearance:auto !important;}" +
    ".izpf-panel select{width:auto !important;max-width:240px !important;height:auto !important;padding:3px 6px !important;font-size:13px !important;" +
    "border:1px solid #d1d5db !important;border-radius:4px !important;background:#fff !important;color:#141414 !important;display:inline-block !important;float:none !important;}" +
    ".izpf-panel .izpf-ajustes{display:none !important;padding:4px 16px 10px !important;}" +
    ".izpf-panel .izpf-ajustes.open{display:grid !important;grid-template-columns:repeat(auto-fill,minmax(200px,1fr)) !important;gap:6px 14px !important;}" +
    ".izpf-panel .izpf-ajustes .izpf-fila{display:flex !important;align-items:center !important;justify-content:space-between !important;gap:6px !important;font-size:13px !important;color:#4b5563 !important;}" +
    ".izpf-panel .izpf-ajustes .izpf-nota{grid-column:1/-1 !important;}" +
    // escenarios
    ".izpf-panel .izpf-chips{display:flex !important;flex-wrap:wrap !important;gap:5px !important;margin:2px 0 4px !important;}" +
    ".izpf-panel .izpf-chip{background:#f3f4f6 !important;border:1px solid #e5e7eb !important;border-radius:14px !important;padding:3px 10px !important;" +
    "font-size:12.5px !important;font-weight:600 !important;color:#374151 !important;cursor:pointer !important;text-transform:none !important;white-space:nowrap !important;}" +
    ".izpf-panel .izpf-chip:hover{background:#eff6ff !important;border-color:#93c5fd !important;}" +
    ".izpf-panel .izpf-chip.sel{background:#145bc7 !important;border-color:#145bc7 !important;color:#fff !important;}" +
    ".izpf-panel .izpf-alq{margin:8px 0 0 !important;padding:8px 10px !important;background:#f0f9ff !important;border:1px solid #bae6fd !important;border-radius:4px !important;font-size:13px !important;}" +
    ".izpf-panel .izpf-pie{display:flex !important;justify-content:space-between !important;align-items:center !important;padding:8px 16px 12px !important;border-top:1px solid #f1f1ee !important;margin-top:8px !important;}" +
    ".izpf-panel .izpf-btn{all:unset;cursor:pointer !important;font-size:13px !important;font-weight:600 !important;color:#145bc7 !important;}" +
    ".izpf-panel .izpf-btn:hover{text-decoration:underline !important;}" +
    ".izpf-panel .izpf-x{all:unset;cursor:pointer !important;color:#fff !important;font-size:15px !important;padding:0 4px !important;opacity:.8 !important;}" +
    ".izpf-panel .izpf-x:hover{opacity:1 !important;}" +
    // tabla de unidades: columnas extra a la derecha con scroll horizontal
    ".izpf-scroll{overflow-x:auto !important;}" +
    ".izpf-scroll>.table{width:auto !important;min-width:100% !important;}" +
    // sin partir líneas: la tabla crece hacia la derecha y se hace scroll
    ".izpf-scroll>.table>.table__row>.table__cell{white-space:nowrap !important;}" +
    // la barra gris "pisos disponibles en venta" no se va con el scroll
    ".izpf-scroll>.table__tittle{position:sticky !important;left:0 !important;z-index:3 !important;}" +
    // las celdas originales largas ("Plaza de garaje incluida…") pueden partir línea
    ".izpf-scroll>.table>.table__row>.table__cell:not(:first-child):not(.izpf-cell){white-space:normal !important;min-width:64px !important;max-width:150px !important;}" +
    // la vivienda (1.ª columna) se queda fija al deslizar hacia la derecha
    ".izpf-scroll>.table>.table__row>.table__cell:first-child{position:sticky !important;left:0 !important;z-index:2 !important;" +
    "background:#fff !important;box-shadow:6px 0 8px -6px rgba(0,0,0,.18) !important;}" +
    ".izpf-scroll>.table>.table__row.izpf-sel>.table__cell:first-child{background:#fefce8 !important;}" +
    ".izpf-scroll .izpf-badge{white-space:nowrap !important;}" +
    ".izpf-cell{white-space:nowrap !important;cursor:pointer !important;color:#141414 !important;}" +
    ".izpf-cell .v{font-weight:600 !important;color:#b45309 !important;}" +
    ".izpf-cell .l{display:block !important;font-size:12.5px !important;font-weight:400 !important;line-height:1.45 !important;color:#6b7280 !important;}" +
    ".izpf-cell:hover .l{color:#334155 !important;}" +
    ".table__row.izpf-head>.table__cell{font:600 12px/1.3 system-ui,sans-serif !important;color:#64748b !important;" +
    "white-space:nowrap !important;padding-top:10px !important;padding-bottom:6px !important;" +
    "border-bottom:1px solid #e2e8f0 !important;vertical-align:bottom !important;background:#fff !important;}" +
    ".table__row.izpf-sel{background:#fefce8 !important;}" +
    // panel de detalle bajo la tabla: a todo el ancho, no dentro de una celda
    ".izpf-panel.izpf-full{width:auto !important;max-width:none !important;margin:8px 16px 12px !important;" +
    "box-shadow:none !important;}";

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
  function crearPanel(precio, obraNueva, c, titulo, m2) {
    var panel = document.createElement("div");
    panel.className = "izpf-panel";
    var r = calcular(precio, c, obraNueva);
    panel.__izpfArgs = { precio: precio, obra: obraNueva, titulo: titulo, m2: m2 };

    function fila(d, e) { return "<tr><td class='d'>" + d + "</td><td class='e'>" + e + "</td></tr>"; }
    function kpi(k, v, s, color) {
      return "<div class='izpf-kpi' style='border-left-color:" + (color || "#b45309") + " !important'><div class='k'>" + k +
        "</div><div class='v'" + (color ? " style='color:" + color + " !important'" : "") + ">" + v + "</div><div class='s'>" + s + "</div></div>";
    }
    function campo(k, val, suf, extra) {
      return "<div><label>" + extra + "</label><div class='izpf-campo'><input class='izpf-in' data-k='" + k +
        "' type='number' value='" + val + "'" + (k === "interes" ? " step='0.1'" : k === "neto" ? " step='100'" : "") +
        "><span>" + suf + "</span></div></div>";
    }
    var e = r.endeudamiento;
    var colE = e == null ? "#6b7280" : e <= 30 ? "#15803d" : e <= 35 ? "#b45309" : "#dc2626";
    var guardada = window.__izCmp && titulo;

    // ---- cabecera
    var html = "<div class='izpf-hd'><span class='t'>" + (titulo ? titulo : "Precio final") +
      "<small>" + (obraNueva ? "obra nueva" : "segunda mano") + " · " + c.ccaa + "</small></span>" +
      (guardada ? "<button class='izpf-hb izpf-cmp'>☆ Comparar esta</button>" : "") +
      "<button class='izpf-x' title='ocultar'>✕</button></div>";

    // ---- cifras clave
    html += "<div class='izpf-kpis'>" +
      kpi("Precio final", fmt(r.final), "+" + (100 * (r.final / precio - 1)).toFixed(1).replace(".", ",") + " % sobre " + fmt(precio)) +
      kpi("Cash necesario", fmt(r.liquido), "el día de la firma: " + fmt(r.escritura)) +
      kpi("Cuota", fmt(r.cuota) + "/mes", "coste real " + fmt(r.costeMensualReal) + "/mes", "#145bc7") +
      kpi("Esfuerzo", e != null ? e.toFixed(1).replace(".", ",") + " %" : "—",
        (e == null ? "" : e <= 30 ? "✔ cómodo" : e <= 35 ? "⚠ justo" : "✖ demasiado") + " · neto " + fmt(c.neto), colE) +
      "</div>";

    html += "<div class='izpf-grid'><div class='izpf-col'>";
    // ---- desglose
    html += "<h5>Desglose del precio</h5><table>";
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
    html += "<tr class='tot'><td>Precio final</td><td class='e'>" + fmt(r.final) + "</td></tr></table>";

    // ---- calendario de pagos
    html += "<h5>Cuándo pagas cada cosa</h5><ul class='izpf-tl'>";
    if (r.reserva > 0) html += "<li><div class='cu'><span>Reserva</span><b>" + fmt(r.reserva) + "</b></div><small>hoy, para bloquearla</small></li>";
    if (r.arras > 0) html += "<li><div class='cu'><span>Arras (" + pct(c.arras) + ")</span><b>" + fmt(r.arras) + "</b></div><small>" +
      (obraNueva ? "al firmar el contrato privado (1–3 meses)" : "al pactar la compra") + "</small></li>";
    html += "<li><div class='cu'><span>Escritura</span><b>" + fmt(r.escritura) + "</b></div><small>resto de entrada " + fmt(r.restoEntrada) +
      " + " + (obraNueva ? "IVA y AJD " : "ITP ") + fmt(r.impuestos) + " + gastos " + fmt(r.gastos) + "</small></li>";
    html += "</ul>";
    if (obraNueva) html += "<div class='izpf-nota'>La reserva y las arras van a cuenta del precio. Exige que estén avaladas.</div>";
    html += "</div><div class='izpf-col'>";

    // ---- hipoteca
    html += "<h5>Hipoteca</h5><div class='izpf-form'>" +
      campo("entrada", c.entrada, "%", "Entrada (" + fmt(r.entrada) + ")") +
      campo("plazo", c.plazo, "años", "Plazo") +
      campo("interes", c.interes, "% TIN", "Interés") +
      campo("neto", c.neto, "€/mes", "Neto del hogar") + "</div><table>" +
      fila("Préstamo (" + (100 - c.entrada) + " %)", fmt(r.prestamo)) +
      fila("Cuota mensual", "<b>" + fmt(r.cuota) + "</b>") +
      fila("Intereses totales (" + r.meses + " cuotas)", fmt(r.intereses)) +
      fila("+ comunidad " + fmt(c.comunidad) + " e IBI " + fmt(c.ibi) + "/año", fmt(r.costeMensualReal) + "/mes") +
      fila("Neto necesario (cuota ≤ " + pct(c.regla) + ")", fmt(r.ingresoMinMes) + "/mes") +
      "<tr class='tot'><td>Todo pagado al final</td><td class='e'>" + fmt(r.totalConHipoteca) + "</td></tr></table>";

    // ---- escenarios
    html += "<h5>Escenarios (interés " + pct(c.interes) + ")</h5><div class='izpf-chips'>";
    [[20, 25], [20, 30], [25, 25], [25, 30], [30, 25], [30, 30]].forEach(function (cb) {
      var c2 = {};
      for (var k in c) c2[k] = c[k];
      c2.entrada = cb[0]; c2.plazo = cb[1];
      var q = calcular(precio, c2, obraNueva);
      var sel = (c.entrada === cb[0] && c.plazo === cb[1]) ? " sel" : "";
      html += "<span class='izpf-chip" + sel + "' data-e='" + cb[0] + "' data-p='" + cb[1] + "'>" +
        cb[0] + "% · " + cb[1] + "a → " + fmt(q.cuota) + "</span>";
    });
    html += "</div>";

    // ---- alquilar algo igual (con el €/m² de alquiler de la zona, de barrio.js)
    var Z = window.__izZona;
    if (Z && Z.alquilerM2 && m2) {
      var alq = Z.alquilerM2 * m2;
      html += "<div class='izpf-alq'>Alquilar algo igual en " + Z.nombre + " ≈ <b>" + fmt(alq) + "/mes</b> · comprar te cuesta " +
        "<b>" + (r.costeMensualReal >= alq ? "+" : "−") + fmt(Math.abs(r.costeMensualReal - alq)) + "/mes</b>" +
        (Z.m2 ? "<br><span style='color:#6b7280'>" + Math.round(precio / m2).toLocaleString("es-ES") + " €/m² frente a " +
          Math.round(Z.m2).toLocaleString("es-ES") + " €/m² de media en la zona</span>" : "") + "</div>";
    }
    html += "</div></div>"; // cierra col B y la rejilla

    // ---- ajustes editables
    html += "<div class='izpf-ajustes'>" +
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
      "<div class='izpf-fila'><label>Esfuerzo máx.:</label>" +
      "<select class='izpf-selregla'><option value='30'" + (c.regla === 30 ? " selected" : "") + ">30 % (cómodo)</option>" +
      "<option value='35'" + (c.regla === 35 ? " selected" : "") + ">35 % (límite bancario)</option></select></div>" +
      "<div class='izpf-nota'>Tipos por defecto (editables). Los impuestos se calculan sobre el precio de escritura; " +
      "si el valor de referencia catastral es mayor, Hacienda usa el mayor. El ITP cambia según la CCAA.</div>" +
      "</div>" +
      "<div class='izpf-pie'><button class='izpf-btn izpf-btn-aj'>⚙ Impuestos, gastos y supuestos</button>" +
      "<span class='izpf-nota' style='margin:0'>Cambios guardados para todas las viviendas</span></div>";

    panel.innerHTML = html;

    // ---- anti-navegación: cortamos el evento en CAPTURA para que no llegue
    // ni a la <a> de la fila ni a delegados de idealista; los handlers internos
    // (inputs, chips, botones) están por debajo y siguen ejecutándose
    // OJO: en fase de BURBUJA. En captura, stopPropagation en el panel impedía
    // que el clic llegase a sus propios botones (escenarios, ✕, comparar…);
    // la navegación de la fila ya la anula el preventDefault del listener global
    panel.addEventListener("click", function (ev) { ev.stopPropagation(); });

    // ---- comportamiento
    panel.querySelector(".izpf-x").addEventListener("click", function () {
      panel.style.display = "none"; // solo oculta: "precio final" lo re-muestra
      if (panel.__izpfFila) panel.__izpfFila.classList.remove("izpf-sel");
    });

    function refrescar() {
      // recalcular en sitio re-creando el panel (sencillo y sin fugas)
      var oculto = panel.style.display === "none";
      var nuevo = crearPanel(precio, obraNueva, cfg(), titulo, m2);
      if (panel.querySelector(".izpf-ajustes.open")) nuevo.querySelector(".izpf-ajustes").classList.add("open");
      nuevo.className = panel.className;
      nuevo.__izpfFila = panel.__izpfFila;
      if (oculto) nuevo.style.display = "none";
      panel.replaceWith(nuevo);
      repintar(); // la tabla y las líneas de precio final siguen a la config
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
        op.value = par[0];
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
    var cmp = panel.querySelector(".izpf-cmp");
    if (cmp) {
      cmp.addEventListener("click", function () {
        var ok = window.__izCmp && window.__izCmp.guardarUnidad({ nombre: titulo, precio: precio, m2: m2 });
        cmp.textContent = ok ? "★ Guardada" : "aún cargando…";
        if (ok) cmp.classList.add("on");
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
    if (el.closest && el.closest(".izpf-badge, .izpf-cell")) return;
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
    var badge = document.createElement("div");
    badge.className = "izpf-badge";
    badge.__izpfDatos = { precio: precio, obra: obraNueva };
    badge.__izpfMain = !el.closest(".table__row");
    badge.title = "Precio real con impuestos y gastos (IVA/AJD/ITP + notaría, registro…) — click para ver el desglose";
    pintarBadge(badge);
    contenedor.appendChild(badge);

    // fila de la tabla de unidades: columnas extra (cash, cuota, esfuerzo)
    var fila = el.closest(".table__row");
    if (fila) ponerCeldas(fila, precio, obraNueva);
  }

  // texto de la línea "precio final": en el precio principal, con líquido y
  // cuota; en las filas de la tabla, solo el precio (el resto va en columnas)
  function pintarBadge(badge) {
    var d = badge.__izpfDatos;
    var r = calcular(d.precio, cfg(), d.obra);
    badge.innerHTML = badge.__izpfMain
      ? "precio final <b>" + fmt(r.final) + "</b> · líquido " + fmt(r.liquido) +
        " · cuota " + fmt(r.cuota) + "/mes"
      : "precio final <b>" + fmt(r.final) + "</b>";
  }

  function ponerCeldas(fila, precio, obraNueva) {
    if (fila.__izpfCeldas) return;
    var m2 = parseFloat(((fila.textContent || "").match(/(\d+(?:[.,]\d+)?)\s*m²/) || [])[1]);
    fila.__izpfCeldas = { precio: precio, obra: obraNueva, m2: isNaN(m2) ? null : m2 };
    ["m2", "liquido", "entrada", "reserva", "cuota", "esfuerzo"].forEach(function (k) {
      var td = document.createElement("span");
      td.className = "table__cell izpf-cell";
      td.setAttribute("data-k", k);
      td.title = "Click para ver el desglose completo";
      fila.appendChild(td);
    });
    pintarCeldas(fila);
    var tabla = fila.parentElement;
    if (tabla && tabla.parentElement) tabla.parentElement.classList.add("izpf-scroll");
  }

  function pintarCeldas(fila) {
    var d = fila.__izpfCeldas, c = cfg();
    var r = calcular(d.precio, c, d.obra);
    var e = r.endeudamiento;
    var col = e == null ? "#64748b" : e <= 30 ? "#16a34a" : e <= 35 ? "#b45309" : "#dc2626";
    fila.querySelectorAll(":scope > .izpf-cell").forEach(function (td) {
      var k = td.getAttribute("data-k");
      if (k === "liquido") td.innerHTML = "<span class='v'>" + fmt(r.liquido) + "</span><span class='l'>final " + fmt(r.final) + "</span>";
      if (k === "m2") {
        var Z = window.__izZona;
        var em = d.m2 ? d.precio / d.m2 : null;
        var dif = em && Z && Z.m2 ? 100 * (em / Z.m2 - 1) : null;
        // obra nueva: ~+10 % sobre la media de la zona es lo normal
        var colM = dif == null ? "#6b7280" : dif - (d.obra ? 10 : 0) <= 0 ? "#15803d" : dif - (d.obra ? 10 : 0) <= 15 ? "#b45309" : "#dc2626";
        td.innerHTML = em ? "<span class='v' style='color:#141414 !important'>" + Math.round(em).toLocaleString("es-ES", { useGrouping: "always" }) + " €</span><span class='l'>" +
          (dif != null ? "<b style='color:" + colM + " !important;font-weight:700'>" + (dif > 0 ? "+" : "") + Math.round(dif) + " %</b> vs zona" : "por m²") + "</span>" : "—";
      }
      if (k === "entrada") td.innerHTML = "<span class='v'>" + fmt(r.entrada) + "</span><span class='l'>" + pct(c.entrada) + " del precio</span>";
      if (k === "reserva") td.innerHTML = "<span class='v'>" + fmt(r.reserva + r.arras) + "</span><span class='l'>" +
        (r.reserva > 0 ? fmt(r.reserva) + " + " + fmt(r.arras) : "arras " + pct(c.arras)) + "</span>";
      if (k === "cuota") td.innerHTML = "<span class='v'>" + fmt(r.cuota) + "/mes</span><span class='l'>" +
        c.plazo + " años · " + pct(c.interes) + "</span>";
      if (k === "esfuerzo") td.innerHTML = e == null ? "—" :
        "<span class='v' style='color:" + col + " !important'>" + e.toFixed(1).replace(".", ",") +
        " %</span><span class='l'>sobre " + fmt(c.neto) + "/mes</span>";
    });
  }

  // las filas no tienen todas las mismas celdas (p. ej. "Plaza de garaje"):
  // rellenamos con celdas vacías para que nuestras columnas queden alineadas
  function alinearTablas() {
    document.querySelectorAll(".izpf-scroll > .table").forEach(function (tabla) {
      var filas = tabla.querySelectorAll(":scope > .table__row");
      var max = 0;
      filas.forEach(function (f) {
        var n = f.querySelectorAll(":scope > .table__cell:not(.izpf-cell)").length;
        if (n > max) max = n;
      });
      filas.forEach(function (f) {
        var primera = f.querySelector(":scope > .izpf-cell");
        if (!primera) return;
        var n = f.querySelectorAll(":scope > .table__cell:not(.izpf-cell)").length;
        for (; n < max; n++) {
          var pad = document.createElement("span");
          pad.className = "table__cell izpf-pad";
          f.insertBefore(pad, primera);
        }
      });
      // cabecera: una sola, arriba, con los nombres de nuestras columnas
      if (!tabla.querySelector(":scope > .izpf-head")) {
        var cab = document.createElement("div");
        cab.className = "table__row izpf-head";
        var h = "<span class='table__cell'>Vivienda <span style='font-weight:400'>· desliza →</span></span>";
        for (var i = 1; i < max; i++) h += "<span class='table__cell'></span>";
        ["€/m²", "Cash necesario", "Entrada", "Reserva + arras", "Cuota", "Esfuerzo"].forEach(function (t) {
          h += "<span class='table__cell'>" + t + "</span>";
        });
        cab.innerHTML = h;
        tabla.insertBefore(cab, tabla.firstChild);
      }
    });
  }

  // recalcula todo lo pintado (tras cambiar entrada, plazo, interés, neto…)
  function repintar() {
    try { window.dispatchEvent(new CustomEvent("iz_cfg")); } catch (e) {}
    raicesDOM().forEach(function (raiz) {
      raiz.querySelectorAll(".izpf-badge").forEach(pintarBadge);
      raiz.querySelectorAll(".table__row").forEach(function (f) {
        if (f.__izpfCeldas) pintarCeldas(f);
      });
    });
  }

  // detalle de una fila: UN panel bajo la tabla, a todo el ancho; pulsar la
  // misma fila lo cierra, pulsar otra lo cambia
  function alternarDetalleFila(fila) {
    var tabla = fila.parentElement, caja = tabla && tabla.parentElement;
    if (!caja) return;
    var prev = caja.parentElement.querySelector(":scope > .izpf-panel.izpf-full");
    var eraEsta = prev && prev.__izpfFila === fila && prev.style.display !== "none";
    if (prev) prev.remove();
    tabla.querySelectorAll(".izpf-sel").forEach(function (f) { f.classList.remove("izpf-sel"); });
    if (eraEsta) return;
    var d = fila.__izpfCeldas;
    var nombre = ((fila.querySelector(".table__go-to-property") || {}).textContent || "")
      .replace(/\s+/g, " ").trim();
    var panel = crearPanel(d.precio, d.obra, cfg(), nombre, d.m2);
    panel.classList.add("izpf-full");
    panel.__izpfFila = fila;
    caja.insertAdjacentElement("afterend", panel);
    fila.classList.add("izpf-sel");
  }

  // alterna el panel de un badge: si no está montado (unidades), lo crea;
  // si está oculto (✕), lo vuelve a mostrar
  function alternarPanel(badge) {
    var cont = badge.parentElement;
    if (!cont) return;
    var panel = cont.querySelector(":scope > .izpf-panel");
    if (!panel) {
      var d = badge.__izpfDatos || { precio: 0, obra: esObraNueva() };
      cont.appendChild(crearPanel(d.precio, d.obra, cfg()));
      return;
    }
    panel.style.display = (panel.style.display === "none") ? "" : "none";
  }

  // UN solo listener global en CAPTURA, registrado al cargar (document_start):
  // corre ANTES que cualquier handler de idealista.
  //  · "precio final" o nuestras columnas en una fila → no navegar y abrir el
  //    detalle bajo la tabla (el resto de la fila sigue llevando al anuncio)
  //  · "precio final" del precio principal → mostrar/ocultar su panel
  //  · clics inertes dentro del panel → anulan el <a>; inputs, selects y
  //    botones conservan su comportamiento nativo
  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var panel = t.closest(".izpf-panel");
    if (panel) {
      var tg = t.tagName;
      if (tg !== "INPUT" && tg !== "SELECT" && tg !== "OPTION" && tg !== "LABEL" && tg !== "BUTTON") {
        ev.preventDefault();
      }
      return;
    }
    var nuestro = t.closest(".izpf-badge, .izpf-cell");
    if (!nuestro) return;
    ev.preventDefault();
    ev.stopPropagation();
    var fila = nuestro.closest(".table__row");
    if (fila && fila.__izpfCeldas) alternarDetalleFila(fila);
    else if (nuestro.classList.contains("izpf-badge")) alternarPanel(nuestro);
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
      // ni nuestros paneles ni la sección de barrio.js / comparador
      if (host.closest(".izpf-panel, .izpf-badge, .izpf-cell, #izb, .izk-ov, .izk-fab")) continue;
      // barra fija superior: ahí no cabe nada (y un panel ahí tapa la página)
      if (host.closest("#fixed-toolbar")) continue;

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
      if (nuevos) alinearTablas();

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

  // para barrio.js (puntuación, comparador): mismo cálculo y misma config
  window.__izpf = { calcular: calcular, cfg: cfg, esObraNueva: esObraNueva };
  // barrio.js publica el €/m² de la zona → columna €/m² y panel
  window.addEventListener("iz_zona", function () {
    document.querySelectorAll(".table__row").forEach(function (f) { if (f.__izpfCeldas) pintarCeldas(f); });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
