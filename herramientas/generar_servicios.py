#!/usr/bin/env python3
"""
generar_servicios.py — dataset LOCAL de servicios (OpenStreetMap) para la
sección "¿Comprar aquí?" de la extensión.

Los servidores públicos de Overpass se saturan a menudo, así que para las
regiones donde buscáis piso es mejor llevar los datos dentro de la extensión:
supermercados, farmacias, centros de salud, hospitales, colegios, guarderías,
parques, paradas de bus, estaciones, playas y bares/restaurantes.

Uso (necesita pyosmium: `pip install osmium`):

    cd herramientas
    python3 generar_servicios.py                 # Comunitat Valenciana
    python3 generar_servicios.py valencia galicia castilla-y-leon

Descarga el extracto de Geofabrik (se cachea en ../data-src/) y escribe
../servicios/<region>.json. Después, recarga la extensión.
Los datos de OpenStreetMap son © colaboradores de OpenStreetMap (ODbL).
"""
import json
import os
import sys
import time
import urllib.request

try:
    import osmium
except ImportError:
    sys.exit("Falta pyosmium: pip install osmium")

AQUI = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(AQUI, "..", "data-src")
SALIDA = os.path.join(AQUI, "..", "servicios")
GEOFABRIK = "https://download.geofabrik.de/europe/spain/{}-latest.osm.pbf"


def categorias(t):
    """Devuelve las categorías de un objeto OSM según sus etiquetas."""
    c = []
    shop, amenity, healthcare = t.get("shop"), t.get("amenity"), t.get("healthcare")
    if shop == "supermarket":
        c.append("super")
    if amenity == "pharmacy":
        c.append("farmacia")
    if amenity in ("clinic", "doctors") or healthcare in ("centre", "clinic", "doctor"):
        c.append("salud")
    if amenity == "hospital" or healthcare == "hospital":
        c.append("hospital")
    if amenity == "school":
        c.append("colegio")
    if amenity in ("kindergarten", "childcare"):
        c.append("guarderia")
    if t.get("leisure") in ("park", "playground"):  # "garden" suelen ser privados
        c.append("parque")
    if t.get("highway") == "bus_stop":
        c.append("bus")
    if t.get("railway") in ("station", "halt", "tram_stop"):
        c.append("tren")
    if t.get("natural") == "beach":
        c.append("playa")
    if amenity in ("restaurant", "cafe", "bar", "pub", "fast_food"):
        c.append("ocio")
    return c


def nombre(cat, t):
    n = t.get("name") or t.get("brand") or ""
    if cat == "tren":
        red = (t.get("network", "") + " " + t.get("operator", "")).lower()
        if t.get("railway") == "tram_stop":
            tipo = "Tranvía"
        elif t.get("station") in ("subway", "light_rail") or "metro" in red:
            tipo = "Metro"
        elif any(x in red for x in ("renfe", "cercan", "adif")):
            tipo = "Cercanías"
        else:
            tipo = "Tren"
        n = tipo + (" · " + n if n else "")
    if cat == "super" and "mercadona" in (n + " " + t.get("brand", "")).lower():
        n = n or "Mercadona"
    return n[:48]


class Lector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.datos = {}
        self.n = 0

    def _add(self, cats, lat, lng, t):
        for c in cats:
            fila = [round(lat, 5), round(lng, 5)]
            if c not in ("bus", "ocio", "parque"):  # sin nombre: ahorra espacio
                fila.append(nombre(c, t))
            self.datos.setdefault(c, []).append(fila)
        self.n += 1

    def node(self, n):
        if not n.tags:
            return
        t = {k: v for k, v in n.tags}
        cats = categorias(t)
        if cats and n.location.valid():
            self._add(cats, n.location.lat, n.location.lon, t)

    def way(self, w):
        if not w.tags:
            return
        t = {k: v for k, v in w.tags}
        cats = categorias(t)
        if not cats:
            return
        pts = [(nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
        if not pts:
            return
        lat = sum(p[0] for p in pts) / len(pts)
        lng = sum(p[1] for p in pts) / len(pts)
        self._add(cats, lat, lng, t)


def descargar(region):
    os.makedirs(CACHE, exist_ok=True)
    ruta = os.path.join(CACHE, region + "-latest.osm.pbf")
    if os.path.exists(ruta) and time.time() - os.path.getmtime(ruta) < 30 * 86400:
        print("· usando", ruta, "(caché)")
        return ruta
    url = GEOFABRIK.format(region)
    print("· descargando", url)
    urllib.request.urlretrieve(url, ruta)
    return ruta


def main():
    regiones = sys.argv[1:] or ["valencia"]
    os.makedirs(SALIDA, exist_ok=True)
    ruta_idx = os.path.join(SALIDA, "indice.json")
    try:
        indice = [x for x in json.load(open(ruta_idx)) if x["region"] not in regiones]
    except (OSError, ValueError):
        indice = []
    for region in regiones:
        pbf = descargar(region)
        print("· leyendo", region, "…")
        h = Lector()
        h.apply_file(pbf, locations=True, idx="flex_mem")
        lat = [f[0] for v in h.datos.values() for f in v]
        lng = [f[1] for v in h.datos.values() for f in v]
        out = {
            "v": 1, "region": region, "fecha": time.strftime("%Y-%m-%d"),
            "bbox": [min(lat), min(lng), max(lat), max(lng)],
            "fuente": "© colaboradores de OpenStreetMap (ODbL), vía Geofabrik",
            "cats": h.datos,
        }
        dest = os.path.join(SALIDA, region + ".json")
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        print("  {}: {} objetos → {} ({:.1f} MB)".format(
            region, h.n, dest, os.path.getsize(dest) / 1e6))
        print("  " + ", ".join("{} {}".format(k, len(v)) for k, v in sorted(h.datos.items())))
        indice.append({"region": region, "bbox": out["bbox"], "fecha": out["fecha"]})
    with open(ruta_idx, "w", encoding="utf-8") as f:
        json.dump(indice, f, ensure_ascii=False)
    print("Hecho. Recarga la extensión en chrome://extensions.")


if __name__ == "__main__":
    main()
