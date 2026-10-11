// =========================================================================
// puente.js — mundo ISOLATED. Los demás scripts corren en el mundo MAIN de la
// página y no pueden llamar a chrome.runtime; este deja en el <html> la URL
// base de la extensión para que barrio.js pueda leer servicios/*.json
// (web_accessible_resources). Nada más.
// =========================================================================
document.documentElement.setAttribute("data-izext", chrome.runtime.getURL(""));
