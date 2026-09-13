#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera ../zonas.js — los datos que pinta la extensión.

DESCARGA LOS DATOS SOLA (barrios oficiales + municipios de OpenStreetMap),
tú solo tienes que decidir qué zonas van en VERDE.

== USO ==

  1. Edita PROVINCIAS (abajo) para definir las provincias que quieres.
  2. Define tus zonas verdes en el fichero LOCAL (no está en el repo):

       herramientas/config.local.json
       {
         "verdes": {
           "valladolid-provincia": ["Covaresa", "Parquesol", "Tordesillas"],
           "pontevedra-provincia": ["Bouzas", "Sanxenxo"]
         }
       }

     La comparación ignora mayúsculas, acentos y guiones ("Delicias - Canterac"
     = "delicias canterac"). Todo lo que no esté ahí saldrá en ROJO.
     (También puedes rellenar ZONAS_VERDES aquí abajo si lo prefieres.)
  3. Ejecuta:

       python3 generar_zonas.py            # escribe ../zonas.js
       python3 generar_zonas.py --salida /tmp/test.js   # o a otro sitio

  4. Recarga la extensión en chrome://extensions y F5 en idealista.

Los datos descargados se cachean en ../data-src/ (ignorado por git).
Requisitos: Python 3.8+ (solo librería estándar) e internet.
"""
import argparse
import json
import math
import os
import re
import time
import unicodedata
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(AQUI, "..", "data-src")
SALIDA_DEFAULT = os.path.join(AQUI, "..", "zonas.js")
CONFIG_LOCAL = os.path.join(AQUI, "config.local.json")

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# =========================================================================
# 1) PROVINCIAS — añade aquí tantas como quieras
#
#    area_id = id de la relación de la provincia en OpenStreetMap + 3600000000
#    (lo ves en nominatim.openstreetmap.org buscando la provincia,
#     p. ej. "Provincia de Valencia" → relation 349000 → area 3600349000)
#
#    ciudad (OPCIONAL) — cómo pintar la capital:
#      - "barrios_geojson": URL GeoJSON con polígonos oficiales de barrios
#        (si existe, tiene prioridad). Campo del nombre: "nombre"
#        (si es otro, "campo_nombre": "...").
#      - si no hay GeoJSON: "area_id" de la ciudad en OSM y se pintan sus
#        barrios como círculos (suburbios siempre + neighbourhoods dentro de
#        radio_centro_km del centro). centro = [lat, lng] aproximado.
# =========================================================================

PROVINCIAS = [
    {
        "nombre": "Valladolid",
        "claves": ["valladolid-provincia", "valladolid"],
        "area_id": 3600349001,
        "excluir_munis": ["Valladolid"],           # la capital sale por barrios
        "incluir_munis": ["Simancas"],              # fuerza municipios aunque su pop sea baja
        "pueblos_min_pop": 3500,                    # incluye pueblos grandes (village)
        "ciudad": {
            "nombre": "Valladolid",
            "area_id": 3600348849,
            # Barrios de la capital como POLÍGONOS (relaciones OSM admin_level=9)
            "poligonos_osm": True,
            "puntos_osm": False,
        },
    },
    {
        "nombre": "Pontevedra",
        "claves": ["pontevedra-provincia", "pontevedra", "vigo"],
        "area_id": 3600348986,
        "excluir_munis": ["Vigo"],                  # la ciudad sale por parroquias
        "pueblos_min_pop": 4000,
        "ciudad": {
            "nombre": "Vigo",
            "area_id": 3600341381,
            # Parroquias de Vigo como POLÍGONOS (relaciones OSM admin_level=9)
            "poligonos_osm": True,
            "puntos_osm": False,
        },
    },
    {
        # Ejemplo con polígonos oficiales de barrios (fuente CC BY 4.0)
        "nombre": "Valencia",
        "claves": ["valencia-provincia", "valencia"],
        "area_id": 3600349000,
        "excluir_munis": ["València"],
        "ciudad": {
            "nombre": "València",
            "barrios_geojson": ("https://geoportal.valencia.es/server/rest/services/"
                                "OPENDATA/UrbanismoEInfraestructuras/MapServer/224/"
                                "query?where=1%3D1&outFields=*&f=geojson"),
        },
    },
    {
        "nombre": "Castellón",
        "claves": ["castellon-provincia", "castellon"],
        "area_id": 3600349020,
        "excluir_munis": ["Castelló de la Plana"],
        "ciudad": {
            "nombre": "Castelló de la Plana",
            "area_id": 3600344858,
            "centro": [39.986, -0.0377],
            "radio_centro_km": 10,   # todo el municipio (La Devesa, Tossal de Vera…)
        },
    },
    # {
    #     "nombre": "Alicante",
    #     "claves": ["alicante-provincia", "alicante"],
    #     "area_id": 3600348998,
    # },
]

# =========================================================================
# 2) ZONAS_VERDES — las zonas que quieres en VERDE (bien).
#    Lo normal es dejar esto vacío y usar herramientas/config.local.json
#    (fichero LOCAL, no se sube al repo) con esta forma:
#
#    { "verdes": { "<claves[0]>": ["Nombre 1", "Nombre 2", ...] } }
#
#    TODO lo que no esté aquí saldrá en ROJO.
# =========================================================================

ZONAS_VERDES = {}
ZONAS_ROJOS = {}

# =========================================================================
# 3) ZONAS_EXTRA (opcional) — puntos manuales por provincia, para zonas que no
#    salen de las fuentes automáticas. Ejemplo:
#
#    ZONAS_EXTRA = {
#        "valladolid-provincia": [
#            {"nombre": "Mi urbanización", "veredicto": "bien",
#             "lat": 41.61, "lng": -4.75, "radio_km": 0.8},
#        ],
#    }
#    (también puedes definirlas en config.local.json con la clave "extras")
# =========================================================================

ZONAS_EXTRA = {}

# ============================================================ fin config ==

# Radio de los círculos según el tipo de barrio (km)
RADIOS_CIUDAD = {"suburb": 0.9, "quarter": 0.8, "neighbourhood": 0.6}
PRIORIDAD_CIUDAD = {"suburb": 0, "quarter": 1, "neighbourhood": 2}

VERDES_MATCH = set()  # nombres verdes ya encontrados (para avisar de typos)
ROJOS_MATCH = set()


# ---------------------------------------------------------------- utilidades

def normaliza(s):
    """minúsculas, sin acentos, sin apóstrofes, guiones y barras -> espacios"""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower().replace("'", "").replace("’", "").replace("-", " ").replace("/", " ")
    return re.sub(r"\s+", " ", s).strip()

def es_veredicto(clave_prov, nombre):
    """bien (verde) / mal (rojo) / duda (gris, el default ante la duda)."""
    n = normaliza(nombre)
    if n in {normaliza(x) for x in ZONAS_VERDES.get(clave_prov, [])}:
        VERDES_MATCH.add((clave_prov, n))
        return "bien"
    if n in {normaliza(x) for x in ZONAS_ROJOS.get(clave_prov, [])}:
        ROJOS_MATCH.add((clave_prov, n))
        return "mal"
    return "duda"

def avisar_sin_coincidencia():
    for clave, nombres in ZONAS_VERDES.items():
        faltan = {normaliza(n) for n in nombres} - {n for (c, n) in VERDES_MATCH if c == clave}
        if faltan:
            print(f"⚠ {clave}: estas zonas VERDES no coinciden con ninguna zona "
                  f"generada (¿typo?): {sorted(faltan)}")
    for clave, nombres in ZONAS_ROJOS.items():
        faltan = {normaliza(n) for n in nombres} - {n for (c, n) in ROJOS_MATCH if c == clave}
        if faltan:
            print(f"⚠ {clave}: estas zonas ROJAS no coinciden con ninguna zona "
                  f"generada (¿typo?): {sorted(faltan)}")

def cargar_config_local():
    """Fichero local (gitignored) con {"verdes": ..., "rojos": ..., "extras": ...}."""
    if not os.path.exists(CONFIG_LOCAL):
        return
    with open(CONFIG_LOCAL) as f:
        cfg = json.load(f)
    for clave, nombres in cfg.get("verdes", {}).items():
        ZONAS_VERDES.setdefault(clave, []).extend(nombres)
    for clave, nombres in cfg.get("rojos", {}).items():
        ZONAS_ROJOS.setdefault(clave, []).extend(nombres)
    extras = cfg.get("extras", {})
    for clave, zs in extras.items():
        ZONAS_EXTRA.setdefault(clave, []).extend(zs)

def titulo(s):
    """LA SEU -> La Seu (para leerlo bien en el tooltip)"""
    s = (s or "").strip()
    if s.upper() == s and len(s) > 4:
        s = re.sub(r"([A-Za-zÁÉÍÓÚÀÈÌÒÙÜÑÇ]+)", lambda m: m.group(1).capitalize(), s)
    return s[0].upper() + s[1:] if s else s

def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))

def descargar(url, destino, intentos=4, datos=None):
    """Descarga con reintentos y cachea en destino."""
    if os.path.exists(destino) and os.path.getsize(destino) > 100:
        return destino
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    ultima_exc = None
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, data=datos, headers={
                "User-Agent": "idealista-zonas/1.0 (generador de datos)",
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=120) as r:
                cuerpo = r.read()
            json.loads(cuerpo)  # validar que es JSON
            with open(destino, "wb") as f:
                f.write(cuerpo)
            return destino
        except Exception as e:
            ultima_exc = e
            print(f"    reintento {i + 1}/{intentos} ({e})", flush=True)
            time.sleep(10)
    raise RuntimeError(f"No se pudo descargar {url}: {ultima_exc}")

def overpass(query, destino):
    """Consulta Overpass con rotación de servidor y reintentos."""
    if os.path.exists(destino) and os.path.getsize(destino) > 100:
        return destino
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    cuerpo = urllib.parse.urlencode({"data": query}).encode()
    ultima_exc = None
    for base in OVERPASS_URLS * 2:
        try:
            print(f"    overpass: {base}", flush=True)
            req = urllib.request.Request(base, data=cuerpo, headers={
                "User-Agent": "idealista-zonas/1.0 (generador de datos)",
            })
            with urllib.request.urlopen(req, timeout=180) as r:
                data = r.read()
            json.loads(data)
            with open(destino, "wb") as f:
                f.write(data)
            time.sleep(3)  # ser amables con el servidor público
            return destino
        except Exception as e:
            ultima_exc = e
            print(f"    fallo ({e}); probando otro servidor…", flush=True)
            time.sleep(8)
    raise RuntimeError(f"Overpass falló: {ultima_exc}")

# ---------------------------------------------------------------- geometría

def distancia2(a, b):
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2

def simplificar(puntos, eps, max_pts=40):
    """Douglas-Peucker sobre lista de (lat,lng); sube tolerancia hasta max_pts."""
    def dp(seg, tol):
        if len(seg) <= 2:
            return list(seg)
        ini, fin = seg[0], seg[-1]
        dx, dy = fin[0] - ini[0], fin[1] - ini[1]
        norm = dx * dx + dy * dy
        dmax, imax = -1.0, -1
        for i in range(1, len(seg) - 1):
            p = seg[i]
            if norm == 0:
                d = distancia2(p, ini)
            else:
                t = ((p[0] - ini[0]) * dx + (p[1] - ini[1]) * dy) / norm
                t = max(0.0, min(1.0, t))
                d = distancia2(p, (ini[0] + t * dx, ini[1] + t * dy))
            if d > dmax:
                dmax, imax = d, i
        if dmax > tol * tol and imax > 0:
            izq = dp(seg[:imax + 1], tol)
            der = dp(seg[imax:], tol)
            return izq[:-1] + der
        return [ini, fin]

    pts = list(puntos)
    if pts[0] == pts[-1]:
        pts = pts[:-1]  # anillo abierto para el DP
    resultado = dp(pts, eps)
    e = eps * 2
    while len(pts) > 3 and len(resultado) > max_pts and e < eps * 64:
        resultado = dp(pts, e)
        e *= 2
    while len(resultado) > max_pts:
        paso = max(2, len(resultado) // max_pts)
        resultado = resultado[::paso]
    return resultado

def anillos_exteriores(geom):
    if geom is None:
        return []
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    if geom["type"] == "MultiPolygon":
        return [poly[0] for poly in geom["coordinates"]]
    return []

# ---------------------------------------------------------------- fuentes

def _poligono_principal_de_relacion(rel, eps=0.0006, max_pts=40):
    """De una relación OSM (con geometry en sus members, out geom) extrae el
    anillo exterior principal simplificado, como lista de (lat,lng)."""
    ways = [[(p["lat"], p["lon"]) for p in m["geometry"]]
            for m in rel.get("members", [])
            if m.get("type") == "way" and m.get("role") in ("outer", "")
            and m.get("geometry")]
    if not ways:
        return None
    anillos = [a for a in _anillos_desde_ways(ways) if len(a) >= 4]
    if not anillos:
        return None
    anillo = max(anillos, key=_area_anillo)  # contorno principal (ignora huecos)
    if anillo[0] == anillo[-1]:
        anillo = anillo[:-1]
    pts = simplificar(anillo, eps, max_pts)
    return pts if len(pts) >= 3 else None

def _indice_munis_osm(prov):
    """Límites municipales (admin_level=8) de la provincia, indexados por
    nombre normalizado. Una sola query cacheada por provincia."""
    destino = os.path.join(DATA_DIR, f"munis_osm_{normaliza(prov['nombre'])}.json")
    query = (f"[out:json][timeout:180];area({prov['area_id']})->.prov;"
             f'relation(area.prov)[boundary="administrative"][admin_level=8];'
             f"out geom;")
    overpass(query, destino)
    with open(destino) as f:
        data = json.load(f)
    indice = {}
    for rel in data.get("elements", []):
        tags = rel.get("tags", {})
        pts = _poligono_principal_de_relacion(rel, 0.0015, 40)
        if not pts:
            continue
        nombres = [tags.get("name", "")]
        for campo in ("alt_name", "name:es", "official_name", "short_name"):
            if tags.get(campo):
                nombres += str(tags[campo]).split("/")
        for n in nombres:
            n = n.strip()
            if n:
                indice.setdefault(normaliza(n), pts)
    return indice

def municipios(prov):
    """Municipios de la provincia como POLÍGONOS (límites OSM admin_level=8);
    círculo de reserva si algún municipio no tiene polígono mapeado."""
    indice_pol = _indice_munis_osm(prov)
    destino = os.path.join(DATA_DIR, f"municipios_{normaliza(prov['nombre'])}.json")
    query = (f"[out:json][timeout:120];area({prov['area_id']})->.prov;"
             f'node(area.prov)[place~"^(city|town|village)$"];out body;')
    overpass(query, destino)
    with open(destino) as f:
        data = json.load(f)
    excluir = {normaliza(x) for x in prov.get("excluir_munis", [])}
    incluir = {normaliza(x) for x in prov.get("incluir_munis", [])}
    min_pop = prov.get("pueblos_min_pop", 0)
    zonas = []
    n_poly = 0
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        nombre = (tags.get("name") or "").strip()
        if not nombre or normaliza(nombre) in excluir:
            continue
        try:
            pop = int(tags.get("population", "0"))
        except ValueError:
            pop = 0
        if tags.get("place") == "village" and pop < min_pop \
                and normaliza(nombre) not in incluir:
            continue  # pueblo pequeño: fuera
        veredicto = es_veredicto(prov["claves"][0], nombre)
        pts = indice_pol.get(normaliza(nombre))
        if pts:
            n_poly += 1
            zonas.append({
                "nombre": titulo(nombre),
                "veredicto": veredicto,
                "tipo": "poligono",
                "puntos": [[round(a, 5), round(b, 5)] for a, b in pts],
            })
        else:
            # sin contorno en OSM: círculo como reserva
            radio = 2.6 if pop > 50000 else 2.0 if pop > 20000 else 1.7 if pop > 10000 else 1.2
            zonas.append({
                "nombre": titulo(nombre),
                "veredicto": veredicto,
                "tipo": "punto",
                "lat": round(el["lat"], 4),
                "lng": round(el["lon"], 4),
                "radio_km": radio,
            })
    print(f"  ({n_poly}/{len(zonas)} municipios con polígono)")
    return zonas

def barrios_poligonos(prov, ciudad):
    """Polígonos de barrios de la capital desde un GeoJSON oficial (si hay URL)."""
    url = ciudad.get("barrios_geojson")
    if not url:
        return []
    destino = os.path.join(DATA_DIR, f"barrios_{normaliza(ciudad['nombre'])}.geojson")
    descargar(url, destino)
    with open(destino) as f:
        data = json.load(f)
    campo_nombre = ciudad.get("campo_nombre", "nombre")
    zonas = []
    for feat in data.get("features", []):
        nombre = (feat.get("properties", {}).get(campo_nombre) or "").strip()
        anillos = anillos_exteriores(feat.get("geometry"))
        if not nombre or not anillos:
            continue
        anillo = max(anillos, key=len)  # contorno principal
        pts = [(c[1], c[0]) for c in anillo]  # GeoJSON [lon,lat] -> (lat,lon)
        pts = simplificar(pts, 0.00045, 40)
        if len(pts) < 3:
            continue
        zonas.append({
            "nombre": titulo(nombre),
            "veredicto": es_veredicto(prov["claves"][0], nombre),
            "tipo": "poligono",
            "puntos": [[round(a, 5), round(b, 5)] for a, b in pts],
        })
    return zonas

def barrios_puntos(prov, ciudad):
    """Círculos con los barrios de la capital desde OpenStreetMap.
    Se quedan todos los suburb/quarter + los neighbourhood a menos de
    radio_centro_km del centro (para no ahogar el mapa en aldeas)."""
    area = ciudad.get("area_id")
    if not area:
        return []
    destino = os.path.join(DATA_DIR, f"barrios_{normaliza(ciudad['nombre'])}.json")
    query = (f"[out:json][timeout:120];area({area})->.c;"
             f'node(area.c)[place~"^(suburb|quarter|neighbourhood)$"];out body;')
    overpass(query, destino)
    with open(destino) as f:
        data = json.load(f)

    centro = ciudad.get("centro")
    radio_centro = ciudad.get("radio_centro_km", 3)
    incluir = {normaliza(x) for x in ciudad.get("incluir", [])}
    candidatos = []
    for el in data.get("elements", []):
        if "lat" not in el:
            continue
        tags = el.get("tags", {})
        nombre = (tags.get("name") or "").strip()
        lugar = tags.get("place", "neighbourhood")
        if not nombre or lugar not in RADIOS_CIUDAD:
            continue
        d_centro = haversine_km(el["lat"], el["lon"], centro[0], centro[1]) if centro else 0
        if lugar != "suburb" and d_centro > radio_centro and normaliza(nombre) not in incluir:
            continue
        candidatos.append((PRIORIDAD_CIUDAD[lugar], nombre, el["lat"], el["lon"], lugar))

    # ordenar por prioridad y quitar nombres duplicados (hay muchas "A Igrexa")
    candidatos.sort()
    vistos = set()
    zonas = []
    for _, nombre, lat, lon, lugar in candidatos:
        clave = normaliza(nombre)
        if clave in vistos:
            continue
        vistos.add(clave)
        zonas.append({
            "nombre": titulo(nombre),
            "veredicto": es_veredicto(prov["claves"][0], nombre),
            "tipo": "punto",
            "lat": round(lat, 4),
            "lng": round(lon, 4),
            "radio_km": RADIOS_CIUDAD[lugar],
        })
    return zonas

def _anillos_desde_ways(ways, eps=1e-7):
    """Encadena ways (listas de puntos) que comparten extremos hasta formar anillos."""
    eps2 = eps * eps
    pendientes = [[tuple(p) for p in w] for w in ways]
    anillos = []
    while pendientes:
        anillo = pendientes.pop(0)
        while True:
            ultimo = anillo[-1]
            for i, w in enumerate(pendientes):
                if distancia2(w[0], ultimo) <= eps2:
                    anillo += w[1:]
                    pendientes.pop(i)
                    break
                if distancia2(w[-1], ultimo) <= eps2:
                    anillo += list(reversed(w))[1:]
                    pendientes.pop(i)
                    break
            else:
                break
        anillos.append(anillo)
    return anillos

def _area_anillo(anillo):
    s = 0.0
    for i in range(len(anillo) - 1):
        (x1, y1), (x2, y2) = anillo[i], anillo[i + 1]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2

def barrios_poligonos_osm(prov, ciudad):
    """Polígonos de barrios/parroquias de la capital desde relaciones OSM
    (boundary=administrative, admin_level 9/10). Config: ciudad.poligonos_osm."""
    area = ciudad.get("area_id")
    if not ciudad.get("poligonos_osm") or not area:
        return []
    destino = os.path.join(DATA_DIR, f"barrios_osm_{normaliza(ciudad['nombre'])}.json")
    query = (f"[out:json][timeout:120];area({area})->.c;"
             f'relation(area.c)[boundary="administrative"][admin_level~"^(9|10)$"];'
             f"out geom;")
    overpass(query, destino)
    with open(destino) as f:
        data = json.load(f)
    zonas = []
    for rel in data.get("elements", []):
        nombre = (rel.get("tags", {}).get("name") or "").strip()
        if not nombre:
            continue
        ways = [[(p["lat"], p["lon"]) for p in m["geometry"]]
                for m in rel.get("members", [])
                if m.get("type") == "way" and m.get("role") in ("outer", "")
                and m.get("geometry")]
        if not ways:
            continue
        anillos = [a for a in _anillos_desde_ways(ways) if len(a) >= 4]
        if not anillos:
            continue
        anillo = max(anillos, key=_area_anillo)  # contorno principal (ignora huecos)
        if anillo[0] == anillo[-1]:
            anillo = anillo[:-1]
        pts = simplificar(anillo, 0.0006, 40)
        if len(pts) < 3:
            continue
        zonas.append({
            "nombre": titulo(nombre),
            "veredicto": es_veredicto(prov["claves"][0], nombre),
            "tipo": "poligono",
            "puntos": [[round(a, 5), round(b, 5)] for a, b in pts],
        })
    return zonas

def zonas_extra(prov):
    extras = ZONAS_EXTRA.get(prov["claves"][0], [])
    return [dict(e, tipo="punto") for e in extras]

# ---------------------------------------------------------------- salida

def js_zona(z, indent="    "):
    n = json.dumps(z["nombre"], ensure_ascii=False)
    if z["tipo"] == "poligono":
        pts = json.dumps(z["puntos"], ensure_ascii=False, separators=(",", ":"))
        return f'{indent}{{ nombre: {n}, veredicto: "{z["veredicto"]}", tipo: "poligono", puntos: {pts} }}'
    return (f'{indent}{{ nombre: {n}, veredicto: "{z["veredicto"]}", tipo: "punto", '
            f'lat: {z["lat"]}, lng: {z["lng"]}, radio_km: {z["radio_km"]} }}')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", default=SALIDA_DEFAULT, help="fichero de salida (default: ../zonas.js)")
    args = ap.parse_args()

    cargar_config_local()

    grupos = []
    total = 0
    for prov in PROVINCIAS:
        print(f"▶ {prov['nombre']}…", flush=True)
        ciudad = prov.get("ciudad") or {}
        zonas = (barrios_poligonos(prov, ciudad)
                 + barrios_poligonos_osm(prov, ciudad)
                 + (barrios_puntos(prov, ciudad) if ciudad.get("puntos_osm", True) else [])
                 + municipios(prov)
                 + zonas_extra(prov))
        verdes = sum(1 for z in zonas if z["veredicto"] == "bien")
        print(f"  {len(zonas)} zonas ({verdes} verdes)", flush=True)
        if not zonas:
            print("  ¡ojo! 0 zonas — revisa el area_id", flush=True)
        var = "ZONAS_" + (re.sub(r"[^A-Z]", "", prov["nombre"].upper()) or "X")
        bloques = ",\n".join(js_zona(z, "      ") for z in zonas)
        grupos.append(
            f"  {{\n"
            f"    claves: {json.dumps(prov['claves'])},\n"
            f"    zonas: [\n{bloques}\n    ]\n"
            f"  }}"
        )
        total += len(zonas)

    avisar_sin_coincidencia()

    salida = f"""// =========================================================================
// zonas.js — DATOS de la extensión Idealista Zonas
//
//   veredicto: "bien" -> verde   |   "mal" -> rojo
//   tipo "poligono": puntos = [[lat, lng], ...]
//   tipo "punto":    lat, lng + radio_km (círculo)
//
// Generado con herramientas/generar_zonas.py — para cambiar las zonas verdes,
// edita config.local.json (o ZONAS_VERDES en el script) y vuelve a ejecutar.
// También puedes editar este fichero a mano y recargar la extensión.
//
// {total} zonas generadas el {time.strftime('%Y-%m-%d %H:%M')}.
// =========================================================================

(function () {{
  "use strict";

  window.IDEALISTA_ZONAS_COLORES = {{
    bien: {{ relleno: "#16a34a", borde: "#166534" }},
    mal:  {{ relleno: "#dc2626", borde: "#991b1b" }},
    duda: {{ relleno: "#9ca3af", borde: "#6b7280" }}
  }};

  // claves = trozos de URL de idealista en los que se pintan estas zonas
  window.IDEALISTA_ZONAS = [
{",\n".join(grupos)}
  ];
}})();
"""
    with open(args.salida, "w") as f:
        f.write(salida)
    print(f"\nOK -> {os.path.abspath(args.salida)} ({total} zonas)")
    print("Recarga la extensión en chrome://extensions y pulsa F5 en idealista.")

if __name__ == "__main__":
    main()