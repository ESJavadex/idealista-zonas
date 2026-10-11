#!/usr/bin/env python3
"""
generar_criminalidad.py — criminalidad OFICIAL por municipio para la extensión.

Fuente: Balance de Criminalidad del Ministerio del Interior (Portal Estadístico
de Criminalidad), tablas PC-Axis "Municipios mayores de 20.000 habitantes e
islas". Se usa el balance del 4º trimestre de cada año, que trae el acumulado
ENERO-DICIEMBRE de ese año y del anterior: así cada cifra es un año completo y
es comparable año a año.

Población: INE, "Cifras oficiales del padrón por municipio" (tabla 29005), para
calcular tasas por 1.000 habitantes. Provincias y España: suma de sus municipios.

Uso (solo librería estándar de Python):

    python3 herramientas/generar_criminalidad.py            # 2016..último año
    python3 herramientas/generar_criminalidad.py --desde 2019

Escribe ../criminalidad/municipios.json y cachea las descargas en ../data-src/.
"""
import argparse
import csv
import http.cookiejar
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(AQUI, "..", "data-src", "criminalidad")
SALIDA = os.path.join(AQUI, "..", "criminalidad")
BASE = "https://estadisticasdecriminalidad.ses.mir.es"
UA = {"User-Agent": "Mozilla/5.0 (idealista-zonas; generar_criminalidad.py)"}

# tipos que guardamos (clave corta → patrón sobre la "Tipología penal")
# (los balances antiguos numeran "1.-Homicidios…", los nuevos "1. Homicidios…")
N = r"\.\s*-?\s*"
TIPOS = [
    ("total", r"TOTAL INFRACCIONES PENALES"),
    ("convencional", r"^I\.\s*CRIMINALIDAD CONVENCIONAL"),
    ("ciber", r"CIBERCRIMINALIDAD"),
    ("homicidios", r"^1" + N + r"Homicidios dolosos y asesinatos consumados"),
    ("lesiones", r"^3" + N + r"Delitos graves y menos graves de lesiones"),
    ("sexual", r"^5" + N + r"Delitos contra la libertad"),
    ("robo_violencia", r"^6" + N + r"Robos con violencia"),
    ("robo_fuerza", r"^7" + N + r"Robos con fuerza en domicilios, establecimientos"),
    ("robo_domicilio", r"^7\.1" + N + r"Robos con fuerza en domicilios\s*$"),
    ("hurtos", r"^8" + N + r"Hurtos"),
    ("vehiculos", r"^9" + N + r"Sustracciones de veh"),
    ("drogas", r"^10" + N + r"Tr[aá]fico de drogas"),
]


def norm(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9/ ]+", " ", s)).strip()


def numero(t):
    t = (t or "").strip().replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def abridor():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def descargar_balance(anio):
    """CSV del balance del 4º trimestre de `anio` (municipios). Cacheado."""
    os.makedirs(CACHE, exist_ok=True)
    ruta = os.path.join(CACHE, "balance_%d_T4_municipios.csv" % anio)
    if os.path.exists(ruta) and os.path.getsize(ruta) > 1000:
        return open(ruta, encoding="utf-8-sig").read()
    op = abridor()
    # 1) el índice del trimestre fija la sesión (las rutas de JAXI son relativas a ella)
    idx = op.open(urllib.request.Request(
        BASE + "/sec/dynPx/inebase/index.htm?type=pcaxis&path=/DatosBalanceAnt/%d4/&file=pcaxis" % anio,
        headers=UA), timeout=60).read().decode("utf-8", "replace")
    # 2) la tabla de municipios de ese trimestre
    tabla = None
    for m in re.finditer(r'file=(\d+\.px)[^>]*>\s*([^<]+)</a>', idx):
        if re.search(r"municipios", m.group(2), re.I):
            tabla = m.group(1)
            break
    if not tabla:
        raise RuntimeError("no hay tabla de municipios en el balance %d T4" % anio)
    op.open(urllib.request.Request(BASE + "/sec/jaxiPx/dlgExport.htm?path=/DatosBalanceAnt//&file=%s&nocab=1&L=0" % tabla,
                                   headers=UA), timeout=60).read()
    url = BASE + "/sec/jaxiPx/files/_px/es/csv_bdsc/DatosBalanceAnt/l0/%s?nocab=1" % tabla.replace(".px", ".csv_bdsc")
    txt = op.open(urllib.request.Request(url, headers=UA), timeout=120).read().decode("utf-8-sig", "replace")
    if "Geograf" not in txt[:200]:
        raise RuntimeError("respuesta inesperada al bajar %s (%d)" % (tabla, anio))
    open(ruta, "w", encoding="utf-8").write(txt)
    time.sleep(1)
    return txt


def descargar_padron():
    """Población por municipio y año (INE tabla 29005), cacheada."""
    os.makedirs(CACHE, exist_ok=True)
    ruta = os.path.join(CACHE, "padron_29005.json")
    if not (os.path.exists(ruta) and time.time() - os.path.getmtime(ruta) < 60 * 86400):
        url = "https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/29005?nult=12&tip=M"
        print("· descargando padrón (INE 29005)…")
        open(ruta, "wb").write(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read())
    pob = {}  # código INE (5) → {año: habitantes}
    nombres = {}  # provincia (2) → [(conjunto de nombres normalizados, código)]
    for s in json.load(open(ruta)):
        meta = s.get("MetaData") or []
        cod = next((m.get("Codigo") for m in meta if m.get("FK_Variable") == 19), None)
        sexo = next((m.get("Nombre") for m in meta if m.get("FK_Variable") == 18), "")
        if not cod or len(cod) != 5 or sexo != "Total":
            continue
        nom = next((m.get("Nombre") for m in meta if m.get("FK_Variable") == 19), "")
        nombres.setdefault(cod[:2], []).append((variantes(nom), cod))
        pob[cod] = {int(d["Anyo"]): int(d["Valor"]) for d in s["Data"] if d.get("Valor") is not None}
    return pob, nombres


def variantes(nombre):
    """'Sagunt/Sagunto' → {'sagunt','sagunto'}; 'Coruña, A' → {'coruna a','a coruna'}"""
    out = set()
    for parte in nombre.split("/"):
        n = norm(parte)
        out.add(n)
        m = re.match(r"^(.*?)\s+(el|la|los|las|l|els|les|a|o|as|os)$", n)  # "Puig de Santa Maria, el"
        if m:
            out.add(m.group(2) + " " + m.group(1))
    return out


def clave_geo(g):
    """'46220 Sagunto/Sagunt' → ('m','46220','Sagunto/Sagunt'); provincias, CCAA, España."""
    g = g.strip()
    m = re.match(r"^(\d{5})\s+(.+)$", g)
    if m:
        return "m", m.group(1), m.group(2)
    m = re.match(r"^-\s*Municipio de\s+(.+)$", g, re.I)   # balances antiguos: sin código
    if m:
        return "m", None, m.group(1)
    m = re.match(r"^Provincia de (.+)$", g, re.I)
    if m:
        return "p", None, m.group(1)
    if g.upper() in ("NACIONAL", "TOTAL NACIONAL"):
        return "es", "ES", "España"
    # comunidades de una sola provincia: el balance no repite la provincia
    uni = UNIPROVINCIALES.get(norm(g))
    if uni:
        return "p", None, uni
    return None, None, g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", type=int, default=2016)
    args = ap.parse_args()

    pob, nombres_padron = descargar_padron()
    PROV = json.loads(PROVINCIAS_JSON)

    def codigo_por_nombre(nombre, prov):
        v = variantes(nombre)
        for vs, cod in nombres_padron.get(prov, []):
            if v & vs:
                return cod
        return None
    # nombre de provincia (como en el balance) → código de 2 dígitos
    prov_cod = {}
    datos = {}  # clave → {"nombre","tipo","s": {año: {tipo: n}}}
    ultimo = time.localtime().tm_year
    anios_ok = []
    for anio in range(ultimo, args.desde, -1):
        try:
            txt = descargar_balance(anio)
        except Exception as e:
            print("  · balance %d T4: %s" % (anio, e))
            continue
        anios_ok.append(anio)
        print("· balance %d T4 (%d KB)" % (anio, len(txt) // 1024))
        prov_actual = None
        for fila in csv.reader(io.StringIO(txt), delimiter=";"):
            if len(fila) < 4 or fila[0].startswith("Geograf"):
                continue
            tipo_g, cod, nombre = clave_geo(fila[0])
            if not tipo_g:
                continue
            if tipo_g == "p":
                prov_actual = PROV.get(norm(nombre).split("/")[0].strip())
            if tipo_g == "m" and not cod:
                cod = codigo_por_nombre(nombre, prov_actual)
                if not cod:
                    continue
            per = re.match(r"enero-diciembre (\d{4})", fila[2].strip(), re.I)
            if not per:
                continue
            y = int(per.group(1))
            clave_t = next((k for k, pat in TIPOS if re.search(pat, fila[1].strip(), re.I)), None)
            if not clave_t:
                continue
            v = numero(fila[3])
            if v is None:
                continue
            k = cod if tipo_g in ("m", "es") else "P:" + norm(nombre)
            e = datos.setdefault(k, {"nombre": nombre, "tipo": tipo_g, "s": {}})
            # los años se pisan con el balance más reciente (cifras revisadas)
            e["s"].setdefault(y, {}).setdefault(clave_t, v)

    # población de provincias y España = suma de sus municipios (padrón)
    pob_prov, pob_es = {}, {}
    for cod, serie in pob.items():
        for y, n in serie.items():
            pob_prov.setdefault(cod[:2], {}).setdefault(y, 0)
            pob_prov[cod[:2]][y] += n
            pob_es[y] = pob_es.get(y, 0) + n
    # el balance da las provincias por nombre ("Provincia de VALENCIA/VALÈNCIA")
    for k, e in datos.items():
        if e["tipo"] == "p":
            c = PROV.get(norm(e["nombre"]).split("/")[0].strip())
            if c:
                prov_cod[k] = c

    def tasas(serie_abs, serie_pob):
        out = {}
        for y, tipos in sorted(serie_abs.items()):
            p = serie_pob.get(y) or serie_pob.get(y - 1) or serie_pob.get(y + 1)
            if not p:
                continue
            out[str(y)] = {"pob": p, "n": {t: int(v) for t, v in tipos.items()},
                           "tasa": {t: round(1000.0 * v / p, 2) for t, v in tipos.items()}}
        return out

    municipios, provincias = {}, {}
    for k, e in datos.items():
        if e["tipo"] == "m":
            s = tasas(e["s"], pob.get(k, {}))
            if s:
                municipios[k] = {"nombre": e["nombre"], "prov": k[:2], "norm": norm(e["nombre"]), "anual": s}
        elif e["tipo"] == "p" and k in prov_cod:
            c = prov_cod[k]
            s = tasas(e["s"], pob_prov.get(c, {}))
            if s:
                provincias[c] = {"nombre": e["nombre"], "anual": s}
    espana = tasas(datos.get("ES", {}).get("s", {}), pob_es)

    salida = {
        "v": 1,
        "fecha": time.strftime("%Y-%m-%d"),
        "fuente": "Ministerio del Interior, Balance de Criminalidad (4º trimestre de cada año, acumulado enero-diciembre), "
                  "municipios > 20.000 hab. · Población: INE, padrón (tabla 29005)",
        "url": BASE + "/publico/portalestadistico/balances.html",
        "nota": "n = infracciones penales conocidas en el año (enero-diciembre); tasa = por 1.000 habitantes del padrón. "
                "total = III. TOTAL INFRACCIONES PENALES (convencional + cibercriminalidad). "
                "Provincias y España: población = suma de sus municipios.",
        "tipos": {k: p for k, p in TIPOS},
        "anios": sorted(set(int(y) for m in municipios.values() for y in m["anual"])),
        "municipios": municipios,
        "provincias": provincias,
        "espana": espana,
    }
    os.makedirs(SALIDA, exist_ok=True)
    dest = os.path.join(SALIDA, "municipios.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, separators=(",", ":"))
    print("Hecho: %d municipios, %d provincias, años %s → %s (%.2f MB)" % (
        len(municipios), len(provincias), salida["anios"], dest, os.path.getsize(dest) / 1e6))


# comunidades uniprovinciales tal como salen en el balance → nombre de provincia
UNIPROVINCIALES = {
    "comunidad de madrid": "madrid", "madrid comunidad de": "madrid", "principado de asturias": "asturias",
    "asturias principado de": "asturias", "cantabria": "cantabria", "comunidad foral de navarra": "navarra",
    "navarra comunidad foral de": "navarra", "region de murcia": "murcia", "murcia region de": "murcia",
    "la rioja": "la rioja", "rioja la": "la rioja", "illes balears": "balears", "balears illes": "balears",
    "ciudad autonoma de ceuta": "ceuta", "ceuta": "ceuta", "ciudad autonoma de melilla": "melilla", "melilla": "melilla",
}

# nombre normalizado de provincia (como sale en el balance) → código INE
PROVINCIAS_JSON = json.dumps({
    "araba": "01", "alava": "01", "albacete": "02", "alicante": "03", "almeria": "04", "avila": "05",
    "badajoz": "06", "illes balears": "07", "balears illes": "07", "balears": "07", "barcelona": "08", "burgos": "09",
    "caceres": "10", "cadiz": "11", "castellon": "12", "ciudad real": "13", "cordoba": "14",
    "coruna a": "15", "a coruna": "15", "coruna": "15", "cuenca": "16", "girona": "17", "granada": "18",
    "guadalajara": "19", "gipuzkoa": "20", "huelva": "21", "huesca": "22", "jaen": "23", "leon": "24",
    "lleida": "25", "rioja la": "26", "la rioja": "26", "lugo": "27", "madrid": "28", "malaga": "29",
    "murcia": "30", "navarra": "31", "ourense": "32", "asturias": "33", "palencia": "34",
    "palmas las": "35", "las palmas": "35", "pontevedra": "36", "salamanca": "37",
    "santa cruz de tenerife": "38", "cantabria": "39", "segovia": "40", "sevilla": "41", "soria": "42",
    "tarragona": "43", "teruel": "44", "toledo": "45", "valencia": "46", "valladolid": "47",
    "bizkaia": "48", "vizcaya": "48", "zamora": "49", "zaragoza": "50", "ceuta": "51", "melilla": "52",
})

if __name__ == "__main__":
    main()
