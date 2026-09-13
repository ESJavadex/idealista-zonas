# Idealista Zonas (verde/rojo) 🟢🔴

Extensión de navegador (Chrome / Edge / Brave) que pinta **encima del mapa de
idealista** las zonas **buenas en verde** y las **malas en rojo**, según TU
propia clasificación. Buscas piso en vista mapa y descartas zonas de un vistazo.

- 🟢 Barrios de las capitales y municipios de provincia como polígonos o círculos
- 🔌 Sin permisos: todo ocurre dentro de la página
- ✏️ 100% editable: cada zona es una línea; generador de datos incluido
- 🗺️ Funciona en cualquier provincia de España (y en URLs libres `/point/…`,
  donde pinta todas las zonas para estar siempre activa)

> **Nota:** este repositorio es genérico y **no incluye zonas precargadas**
> (los veredictos son personales). Genera las tuyas en 2 minutos con el script
> incluido, o escribe las tuyas a mano.

---

## 📖 Instrucciones de uso

### 1. Instalar (1 minuto)

1. Clona o descarga este repositorio.
2. `cp zonas.js.ejemplo zonas.js` (o genera datos reales, ver paso 3).
3. Abre `chrome://extensions` (también vale `edge://extensions` / `brave://extensions`).
4. Activa el **Modo de desarrollador** (interruptor arriba a la derecha).
5. Pulsa **Cargar descomprimida** y selecciona la carpeta del repositorio.
6. Abre idealista en vista mapa, por ejemplo:

   ```
   https://www.idealista.com/venta-viviendas/madrid-provincia/mapa-google
   ```

7. Verás el mapa coloreado y un botón flotante **abajo a la izquierda**:
   **`✔ Zonas ON · N verdes · N rojas`**. Haz clic para apagar/encender las
   zonas (se recuerda entre sesiones).

### 2. Usarlo en el día a día

- Aplica tus filtros en idealista (precio, habitaciones, exterior…) y navega el
  mapa: las zonas válidas saldrán en verde y las descartadas en rojo.
- Pasa el ratón por una zona para ver su nombre (los polígonos llevan tooltip).
- Si cambias de filtros o de búsqueda, las zonas se repintan solas.
- En URLs libres de mapa (`/point/lat/lng/zoom/…`, cuando te mueves sin elegir
  zona) se pintan **todas** las zonas: la extensión está siempre activa.

### 3. Generar tus datos (recomendado, 2 minutos)

El script `herramientas/generar_zonas.py` **descarga solo** los datos oficiales
(barrios de la capital y municipios de OpenStreetMap) y escribe `zonas.js`.
Tú solo decides qué va en verde.

1. Edita `herramientas/generar_zonas.py` y deja en `PROVINCIAS` las provincias
   que quieras (hay ejemplos; cada una lleva el `area_id` de OSM de la
   provincia, que encuentras en [nominatim.openstreetmap.org](https://nominatim.openstreetmap.org)
   buscando la provincia: id de la relación + 3600000000).
2. Crea tu fichero LOCAL de veredictos (no se sube al repo):

   ```bash
   cat > herramientas/config.local.json <<'EOF'
   {
     "verdes": {
       "madrid-provincia": ["Salamanca", "Chamberí", "Boadilla del Monte"]
     }
   }
   EOF
   ```

   La comparación ignora mayúsculas, acentos y guiones. Todo lo que no esté
   aquí saldrá en ROJO. Al ejecutar, el script te avisa si algún nombre no
   coincide con ninguna zona generada (typo).
3. Ejecuta:

   ```bash
   cd herramientas
   python3 generar_zonas.py        # escribe ../zonas.js
   ```

   Solo hace falta Python 3.8+ (sin librerías externas) e internet.
   Los datos descargados se cachean en `data-src/`.
4. Recarga la extensión en `chrome://extensions` y pulsa F5 en idealista.

**Tipos de zona que genera:**

- **Polígonos** de los barrios de la capital, si tu provincia tiene GeoJSON
  oficial (así está configurada Valencia, fuente del Ayuntamiento, CC BY 4.0).
- **Círculos** para el resto de municipios (radio según población) y para los
  barrios de la capital sacados de OpenStreetMap (`suburb`/`quarter`/
  `neighbourhood`; configurable el radio de centro urbano y listas de
  inclusión/exclusión — ver los comentarios de `PROVINCIAS` en el script).

### 4. Editar a mano (lo más rápido para ajustar)

`zonas.js` es JavaScript plano; cada zona es una línea:

```js
// Círculo (lo más fácil): lat/lng = clic derecho en Google Maps → copiar coords
{ nombre: "Covaresa", veredicto: "bien", tipo: "punto", lat: 41.612, lng: -4.7529, radio_km: 1.2 },

// Polígono (contorno exacto):
{ nombre: "Ruzafa", veredicto: "bien", tipo: "poligono", puntos: [[39.46,-0.37], ...] },
```

- `veredicto: "bien"` → verde · `"mal"` → rojo · `"duda"` → gris
- `radio_km` → tamaño del círculo
- Tras editar: guarda y pulsa el botón **recargar ↻** de la extensión en
  `chrome://extensions` + F5 en idealista.

### 5. Añadir otra provincia

En el script del paso 3, copia un bloque de `PROVINCIAS` y ajusta:

```python
{
    "nombre": "Alicante",
    "claves": ["alicante-provincia", "alicante"],   # trozos de URL de idealista
    "area_id": 3600348998,
},
```

y añade sus zonas verdes a `config.local.json`. En las URLs que no casen con
ninguna provincia (las `/point/…`), la extensión pinta todas las zonas.

---

## 🧠 Cómo funciona por dentro

Los mapas de idealista son Google Maps embebidos. En cuanto la página define
`window.google`, la extensión envuelve el constructor `google.maps.Map` (y
`google.maps.importLibrary`) para capturar cada mapa que idealista crea, y pinta
encima `google.maps.Polygon` / `google.maps.Circle`. Al navegar dentro de
idealista (SPA) se redibuja automáticamente; con el botón flotante se
enciende/apaga sin recargar.

| Fichero | Qué es |
|---|---|
| `zonas.js` | **Los datos** (generado; git-ignorado para que cada uno tenga el suyo) |
| `zonas.js.ejemplo` | Plantilla mínima para empezar a mano |
| `hook.js` | Motor: captura del mapa, dibujo, botón flotante |
| `manifest.json` | Manifiesto MV3 (content scripts, mundo MAIN, sin permisos) |
| `herramientas/generar_zonas.py` | Genera `zonas.js` desde fuentes oficiales |
| `herramientas/config.local.json` | TUS veredictos (git-ignorado) |
| `data-src/` | Caché de los GeoJSON descargados (git-ignorado) |
| `docs/skill-clasificar-zonas.md` | Metodología para clasificar zonas con evidencia (renta, criminalidad, prensa…) |

## 🎨 Verde, rojo y gris (duda)

Las zonas pueden tener cinco veredictos (escala de severidad):

- 🟢 **verde** (`bien`) — buena zona, con evidencia
- 🟠 **naranja** (`regular`) — zona normal/transición, sin señales fuertes
- 🔴 **rojo** (`mal`) — mala zona, con evidencia (p. ej. criminalidad muy superior a la media)
- 🟤 **granate** (`muy_mal`) — la peor, con evidencia sólida y convergente
- ⚪ **gris** (`duda`) — duda: evidencia insuficiente o contradictoria. **Es el
  color por defecto** de cualquier zona que no esté en las listas.

En `config.local.json` las listas correspondientes son `verdes`, `regulares`,
`rojos` y `muy_mal`.

Rellena `verdes` y `rojos` en `config.local.json` solo con datos
(renta media del INE, delitos por habitante, prensa local recurrente…).
La metodología completa está en
[`docs/skill-clasificar-zonas.md`](docs/skill-clasificar-zonas.md).

## ⚠️ Aviso

Los veredictos "bien/mal" son **opiniones subjetivas**, no datos objetivos:
cada uno define los suyos. Este proyecto no está afiliado a Idealista.

## 📄 Licencia

[MIT](LICENSE) — úsalo, modifícalo y compártelo libremente.

---

# English summary

A browser extension that paints **green (good) / red (bad) zones on top of the
Idealista.com property map**, so you can filter neighbourhoods at a glance while
house-hunting.

**Install**: clone this repo → `cp zonas.js.ejemplo zonas.js` (or generate real
data) → `chrome://extensions` → enable *Developer mode* → *Load unpacked* →
open any Idealista map page (`/mapa-google`). A floating button (bottom-left)
toggles the overlays.

**Generate data**: `herramientas/generar_zonas.py` downloads official
neighbourhood/municipality boundaries (OpenStreetMap / city open-data portals)
and writes `zonas.js`. You only provide your own green-zone list in
`herramientas/config.local.json` (git-ignored, subjective by design). See the
Spanish guide above; code comments are in plain Spanish.

**Manual mode**: edit `zonas.js` directly — each zone is one line, either a
`"punto"` (lat/lng + radius in km, easiest) or a `"poligono"` (`[[lat,lng], …]`).
`veredicto: "bien"` → green, `"mal"` → red. On URLs that match no province
(free-panning `/point/…` views) all zones are drawn, so it is always active.

No permissions required.
