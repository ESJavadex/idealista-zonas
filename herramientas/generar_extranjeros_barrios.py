#!/usr/bin/env python3
"""
generar_extranjeros_barrios.py — población extranjera por BARRIO y continente
en la ciudad de València (capa "Población extranjera" del mapa, zoom ≥ 12).

El INE no desglosa por continente por debajo del municipio; el Ayuntamiento sí:

  · Padrón municipal a 1 de enero (Oficina d'Estadística, "Padró Municipal
    d'Habitants", PDF): tablas 5.1 (población por barrio) y 5.13 (población
    extranjera por continente y barrio).
  · Polígonos de los 88 barrios: geoportal de València (datos abiertos, CC BY).

Uso (necesita `pdftotext`, de poppler: `brew install poppler`):

    python3 herramientas/generar_extranjeros_barrios.py          # último año
    python3 herramientas/generar_extranjeros_barrios.py 2025

Escribe ../extranjeros/barrios-valencia.json y cachea en ../data-src/.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(AQUI, "..", "data-src", "extranjeros")
SALIDA = os.path.join(AQUI, "..", "extranjeros", "barrios-valencia.json")
PDF = "https://www.valencia.es/estadistica/Padron/{0}/Padron{0}Val.pdf"
BARRIS = ("https://geoportal.valencia.es/server/rest/services/OPENDATA/UrbanismoEInfraestructuras/"
          "MapServer/224/query?where=1%3D1&outFields=codbarrio,coddistrit,nombre&outSR=4326"
          "&geometryPrecision=5&maxAllowableOffset=0.00004&f=geojson")
FILA = re.compile(r"(\d{1,2})\.(\d{1,2})\.\s+(.+?)\s{2,}([\d.\s]+)$")


def bajar(url, ruta):
    if not os.path.exists(ruta):
        print("· descargando", url)
        urllib.request.urlretrieve(url, ruta)
    return ruta


def num(t):
    return int(t.replace(".", ""))


def tabla(lineas, titulo, ncols):
    """Filas "d.b. barrio  n1 n2 …" de la primera tabla tras `titulo` (en el cuerpo, no el índice)."""
    out, dentro = {}, False
    for ln in lineas:
        if titulo in ln and "Página" not in ln:
            dentro = True
            continue
        if not dentro:
            continue
        m = FILA.search(ln)
        if m:
            nums = m.group(4).split()
            if len(nums) >= ncols:
                cod = "%s.%s" % (m.group(1), m.group(2))
                if cod in out:  # la tabla se repite (hombres, mujeres…): solo la primera
                    return out
                out[cod] = {"nombre": m.group(3).strip(), "v": [num(x) for x in nums[:ncols]]}
        elif out and re.match(r"^\s*\d+\.\d+\.\s", ln) and "Població" in ln:
            break
    return out


def main():
    anio = int(sys.argv[1]) if len(sys.argv) > 1 else time.localtime().tm_year
    os.makedirs(CACHE, exist_ok=True)
    # el último padrón publicado (1 de enero) puede ser de este año o del anterior
    for a in (anio, anio - 1):
        try:
            pdf = bajar(PDF.format(a), os.path.join(CACHE, "Padron%dVal.pdf" % a))
            anio = a
            break
        except Exception as e:
            print("  sin padrón", a, e)
    else:
        sys.exit("No encuentro el padrón de València")
    txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    lineas = txt.splitlines()
    # 5.1: Total · <16 · 16-64 · ≥65 ; 5.13: Total · UE · Europa no UE · África · Am. Norte · Am. Central · Am. Sur · Asia · Oceanía y otros
    pob = tabla(lineas, "5.1. Población según edad en tres grupos", 4) or tabla(lineas, "5.1. Població segons edat en tres grups", 4)
    ext = tabla(lineas, "5.13. Població estrangera segons nacionalitat, per continents. Total", 9)
    print("· barrios: población %d, extranjeros %d" % (len(pob), len(ext)))
    geo = json.load(urllib.request.urlopen(BARRIS, timeout=120))
    barrios = []
    for f in geo["features"]:
        p = f["properties"]
        cod = "%s.%s" % (int(p["coddistrit"]), int(p["codbarrio"]))
        if cod not in ext or cod not in pob:
            print("  ! sin datos para", cod, p["nombre"])
            continue
        e = ext[cod]["v"]
        barrios.append({
            "cod": cod, "n": ext[cod]["nombre"], "t": pob[cod]["v"][0], "e": e[0],
            "c": {"eu": e[1] + e[2], "ue": e[1], "eur": e[2], "af": e[3], "am": e[4] + e[5] + e[6],
                  "amn": e[4], "as": e[7], "oc": e[8]},
            "geom": f["geometry"],
        })
    res = {"v": 1, "anio": anio, "municipio": "46250", "fecha": time.strftime("%Y-%m-%d"),
           "fuente": "Ajuntament de València, Oficina d'Estadística: Padró Municipal d'Habitants a 1-1-%d "
                     "(taules 5.1 i 5.13); barris: geoportal de València (CC BY)" % anio,
           "barrios": barrios}
    with open(SALIDA, "w", encoding="utf-8") as fh:
        json.dump(res, fh, ensure_ascii=False, separators=(",", ":"))
    print("Hecho: %d barrios → %s (%.0f kB)" % (len(barrios), SALIDA, os.path.getsize(SALIDA) / 1e3))


if __name__ == "__main__":
    main()
