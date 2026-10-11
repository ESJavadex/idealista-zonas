# Idealista Zonas 🟢🔴 · ¿comprar aquí?

Extensión de navegador (Chrome / Edge / Brave) para buscar casa en idealista
**en una ciudad que no conoces**. Junta en la propia web de idealista lo que el
anuncio no cuenta:

- 🟢 **Tus zonas en el mapa**: barrios y municipios en verde, naranja o rojo
  según TU clasificación (seguridad, contexto…), más **capas** de inundación
  (DANA 2024 y PATRICOVA), renta por sección censal y pisos turísticos.
- 💶 **Precio real** en cada ficha: impuestos, gastos, cash necesario, cuota,
  esfuerzo y calendario de pagos, también por cada vivienda de una promoción.
- 🧭 **Nota de 0 a 10** de cada vivienda con resumen a favor / a vigilar:
  inundación, renta del barrio, servicios a pie, tiempo en coche, €/m² frente
  a la zona, pisos turísticos, alquilar vs comprar y checklist.
- 📋 **En los listados**: nota en cada tarjeta, **filtros** (zonas rojas,
  inundables, pisos turísticos, renta…) y **orden por nota** ↑↓.
- ⚖️ **Comparador** de las viviendas que guardes, exportable a CSV/JSON.

Sin permisos de navegador. Todos los datos salen de fuentes públicas (INE,
Generalitat, IGN, OpenStreetMap, OSRM y los informes de precios de idealista)
y se guardan en caché en tu navegador.

> **Nota:** el repositorio **no incluye tus zonas** (los veredictos son
> personales) ni los datos de servicios (se generan con un script). Ver
> [Instalar](#1-instalar-1-minuto).

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

7. Verás el mapa coloreado y el panel **Capas** abajo a la izquierda para
   encender/apagar tus zonas y el resto de capas (se recuerda entre sesiones).
8. (Recomendado) Genera la copia local de servicios de las regiones donde
   buscas, para que «servicios a pie» no dependa de Overpass (ver
   [más abajo](#-servicios-sin-depender-de-overpass)):

   ```bash
   pip install osmium
   python3 herramientas/generar_servicios.py valencia castilla-y-leon galicia
   ```

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

## 💶 Precio real y simulación

En las fichas (`/obra-nueva/…` y `/inmueble/…`), bajo cada precio aparece
**«precio final X €»** (anuncio + impuestos + gastos). En las promociones de obra
nueva, la tabla **«pisos disponibles en venta»** gana columnas a la derecha
(con scroll; la vivienda queda fija): **€/m²** (y % frente a la zona), **cash
necesario**, **entrada**, **reserva + arras**, **cuota** y **esfuerzo**.

Al pulsar una vivienda (o el precio principal) se abre el panel:

- **Cifras clave**: precio final, cash necesario (y lo que hace falta el día de
  la firma), cuota y coste mensual real, % de esfuerzo sobre vuestro neto.
- **Desglose**: IVA + AJD (obra nueva) o ITP (segunda mano), notaría, registro,
  gestoría y tasación (opcionales).
- **Cuándo pagas cada cosa**: reserva → arras → escritura.
- **Hipoteca**: entrada, plazo, interés y neto del hogar editables; préstamo,
  intereses totales, neto necesario y «todo pagado al final».
- **Escenarios** de entrada 20/25/30 % × 25/30 años con un clic.
- **Alquilar algo igual** en la zona frente a tu coste mensual.
- **⚙ Impuestos, gastos y supuestos**: todo editable (CCAA/ITP, reserva, arras,
  IBI, comunidad…). Se guarda para todas las viviendas.

Notas:

- Los tipos por defecto son los generales de la Comunitat Valenciana
  (ITP 10 %, IVA 10 %, AJD 1,5 %). Son editables y se guardan en `localStorage`
  (clave `iz_pf_cfg`).
- En obra nueva, la **reserva** (~3.000 €) y las **arras** (10 %) se pagan durante
  la construcción pero van **a cuenta del precio**: no suman coste (se avisa en el panel).
- Los impuestos se calculan sobre el precio de escritura; si el valor catastral
  o el valor de referencia superan el precio, Hacienda usa el mayor.
- Notaría y registro son estimaciones (varían con el precio y el número de páginas).

## 🧭 ¿Comprar aquí? (nota de cada vivienda)

En cada ficha (obra nueva y segunda mano) aparece una sección nueva bajo la
tabla de viviendas con una **nota de 0 a 10**, un resumen (a favor / a vigilar)
y 8 bloques que se despliegan al pulsarlos:

| Bloque | Fuente |
|---|---|
| Tu zona | tu `zonas.js` (verde/naranja/rojo) |
| Inundación | huella real de la **DANA del 29-oct-2024**, municipios del Decreto 163/2024 y **PATRICOVA** (Institut Cartogràfic Valencià; solo Comunitat Valenciana) |
| Renta del barrio | INE, Atlas de Distribución de Renta 2023 por **sección censal**: renta por persona y hogar, percentil en la provincia y el municipio, % menores de 18 / mayores de 65, Gini, pisos turísticos |
| Servicios a pie | OpenStreetMap: súper (y Mercadona), farmacia, centro de salud, colegio, guardería, parque, bus, metro/tren, playa, hospital, bares |
| En coche | OSRM (sin tráfico) a tus destinos; añade los tuyos (trabajo, familia…) y marca el principal |
| Precio zona | informes de precios de idealista: €/m² del municipio/distrito, evolución de 12 meses y €/m² de cada vivienda frente a la zona |
| Alquilar vs comprar | €/m² de alquiler de la zona frente a tu coste mensual (cuota + comunidad + IBI) |
| Antes de reservar | checklist (aval de las cantidades a cuenta, licencia, nota simple…) que se guarda por vivienda |

La nota pondera tu zona ×2, inundación ×2, servicios ×1,5, conexión ×1,5 y
renta, precio, esfuerzo y pisos turísticos ×1. **Si la vivienda está dentro de
la huella de la DANA, la nota se queda en 3,5 como mucho; si está en una zona
que marcaste en rojo, en 4,9.**

**En los listados de búsqueda** (obra nueva y segunda mano) cada tarjeta lleva
su nota rápida, con el desglose al pulsarla. La dirección del anuncio se
geocodifica con CartoCiudad (IGN), sin pedir las fichas a idealista. Arriba
hay una barra con **filtros** (nota mínima, ocultar zonas rojas / solo verdes,
ocultar inundables, máximo de pisos turísticos, renta mínima del barrio) que se
recuerdan (las viviendas filtradas quedan **plegadas en una línea con el
motivo**, no desaparecen), y en el selector de orden de idealista aparece
**«Nota 🧭»**: un clic ordena de mejor a peor (↓), otro de peor a mejor (↑).
El orden es de la página que estás viendo (idealista ordena en su servidor).
Si la tarjeta no da la calle se marca «ubicación aprox.»; si no se puede
situar, se leen las coordenadas de su ficha (como mucho 6 por página). Cada
ficha que abres guarda sus coordenadas exactas para el listado.

**Comparador**: botón *☆ Guardar para comparar* en la sección (o *☆ Comparar
esta* en el panel de cada vivienda de la tabla). El botón flotante *⚖
Comparador* abre una tabla con todas, marca en verde lo mejor de cada fila,
permite notas y exporta a **CSV** (Excel en español), **JSON** o texto.

### 🛒 Servicios sin depender de Overpass

Los servidores públicos de Overpass se saturan a menudo. Genera una copia local de tu región (≈1 MB, 1 minuto):

```bash
pip install osmium
python3 herramientas/generar_servicios.py            # Comunitat Valenciana
python3 herramientas/generar_servicios.py castilla-y-leon galicia   # Valladolid, Vigo…
```

Regiones = nombres de Geofabrik (`valencia` es la Comunitat Valenciana).
Fuera de las regiones descargadas se usa Overpass en directo.

### ⚡ Caché y uso de idealista

- Todo lo que se consulta (inundación, renta, precios de zona, coordenadas,
  tiempos en coche…) se guarda en `localStorage` con caducidad (de 7 a 365
  días según el dato) y se limpia solo. Al volver a una ficha o listado, la
  nota sale casi al instante, y se va pintando según llega cada dato.
- Las peticiones a idealista (solo informes de precios y, como último recurso,
  alguna ficha) van **en fila, una cada 0,8 s**: su antibots salta con ráfagas.
  Si te sale un captcha, pásalo y sigue.

### 🌍 Cobertura

- **Toda España**: renta y pisos turísticos (INE), precio de zona (idealista),
  coche (OSRM), tus zonas.
- **Solo Comunitat Valenciana**: inundación (DANA 2024 y PATRICOVA).
- **Servicios a pie**: las regiones que generes (si no, Overpass en directo).
- Destinos en coche por defecto: València, Valladolid y Vigo (centro, estación
  de AVE y aeropuerto); puedes añadir los tuyos.

### 🔒 Privacidad

Para calcular, la extensión envía **coordenadas o direcciones de los anuncios**
(nunca datos tuyos) a: INE, Institut Cartogràfic Valencià, CartoCiudad (IGN),
OSRM, OpenStreetMap/Overpass y Nominatim (solo al añadir un destino). Tus
zonas, comparador, notas y simulación no salen de tu navegador.

## 🗺️ Capas del mapa

En la vista mapa, el panel **Capas** (abajo a la izquierda) activa: tus zonas,
la zona inundada por la DANA 2024, el riesgo PATRICOVA, la renta por sección
censal y los pisos turísticos (INE, zoom ≥ 11; pasa el ratón o pulsa una
sección para ver el dato) y súper/estaciones (OSM, zoom ≥ 14; usa la copia
local de servicios si la hay). El panel se pliega pulsando su cabecera.

---

## 🧠 Cómo funciona por dentro

Todo corre como content scripts en el mundo MAIN de la página (sin permisos).
Los mapas de idealista son Google Maps embebidos. En cuanto la página define
`window.google`, la extensión envuelve el constructor `google.maps.Map` (y
`google.maps.importLibrary`) para capturar cada mapa que idealista crea, y pinta
encima `google.maps.Polygon` / `google.maps.Circle`. Al navegar dentro de
idealista (SPA) se redibuja automáticamente; con el botón flotante se
enciende/apaga sin recargar.

| Fichero | Qué es |
|---|---|
| `zonas.js` | **Tus zonas** (generado; git-ignorado para que cada uno tenga el suyo) |
| `zonas.js.ejemplo` | Plantilla mínima para empezar a mano |
| `hook.js` | Captura los mapas de Google de idealista y pinta tus zonas |
| `capas.js` | Panel **Capas** del mapa: DANA, PATRICOVA, renta, pisos turísticos, súper/estaciones |
| `precio-final.js` | Precio real, columnas de la tabla de viviendas y panel de hipoteca |
| `barrio.js` | Sección «¿Comprar aquí?» (nota, resumen, bloques), nota en listados, filtros y comparador |
| `puente.js` | Mundo ISOLATED: pasa a la página la URL de la extensión (para leer `servicios/`) |
| `manifest.json` | Manifiesto MV3 (content scripts en el mundo MAIN, sin permisos) |
| `herramientas/generar_zonas.py` | Genera `zonas.js` desde fuentes oficiales |
| `herramientas/generar_servicios.py` | Genera `servicios/<región>.json` desde OpenStreetMap (Geofabrik) |
| `herramientas/config.local.json` | TUS veredictos (git-ignorado) |
| `servicios/` | Copia local de servicios por región (generada, git-ignorada) |
| `data-src/` | Caché de descargas (GeoJSON, `.osm.pbf`; git-ignorado) |
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

## 📄 Licencia y fuentes

Código: [MIT](LICENSE) — úsalo, modifícalo y compártelo libremente.

Datos de terceros, consultados en directo o generados por los scripts: ©
colaboradores de OpenStreetMap (ODbL), INE (Atlas de Distribución de Renta de
los Hogares; viviendas turísticas), Institut Cartogràfic Valencià /
Generalitat Valenciana (DANA 2024, PATRICOVA; CC BY 4.0), IGN – CartoCiudad
(CC BY 4.0), OSRM (servidor de demostración) e informes de precios de
idealista. Este proyecto no está afiliado a ninguno de ellos.

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

It also adds, on listing pages, the **real price** (taxes, fees, cash needed,
monthly payment), a **0–10 score** per property (flood risk from the 2024 DANA
and PATRICOVA, census-tract income, walkable services, driving time, €/m² vs
area, holiday rentals) with filters and sort-by-score on search results, map
layers and an exportable comparison table. Data come from public sources
(INE, Generalitat Valenciana, IGN, OpenStreetMap, OSRM).

No browser permissions required.
