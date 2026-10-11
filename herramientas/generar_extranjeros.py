#!/usr/bin/env python3
"""
generar_extranjeros.py — población extranjera por municipio y sus nacionalidades
principales, para la capa "Población extranjera" del mapa (top 5 al pulsar).

Fuente: INE, Estadística del Padrón Continuo, tablas por provincia "Población
por sexo, municipios y nacionalidad (principales nacionalidades)" (último año
publicado: 1-ene-2022). El INE solo desglosa unas 30 nacionalidades; el resto
sale como "otras".

Uso (solo librería estándar):

    python3 herramientas/generar_extranjeros.py

Escribe ../extranjeros/municipios.json y cachea las descargas en ../data-src/.
"""
import json
import os
import time
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(AQUI, "..", "data-src", "extranjeros")
SALIDA = os.path.join(AQUI, "..", "extranjeros")
API = "https://servicios.ine.es/wstempus/js/ES/"
# una tabla por provincia (la nacional y la de islas no: pasan del límite de volumen)
TABLAS = [33578, 33588, 33658, 33688, 33694, 33700, 33706, 33712, 33718, 33724, 33730,
          33736, 33742, 33748, 33754, 33760, 33766, 33772, 33778, 33784, 33790, 33796,
          33802, 33808, 33814, 33820, 33826, 33832, 33838, 33844, 33850, 33856, 33862,
          33868, 33874, 33880, 33886, 33892, 33898, 33904, 33910, 33916, 33922, 33928,
          33934, 33940, 33946, 33952, 33958, 33964, 33970, 33976]
SEXO_TOTAL = "18:451"
# agregados (continentes, UE…): no son una nacionalidad concreta
AGREGADOS = {"Total", "Española", "Extranjera", "Europa (sin España)", "País de la UE28 sin España",
             "País de la UE27_2020 sin España", "País de Europa menos UE28",
             "País de Europa menos UE27_2020", "De Africa", "De América", "De Asia",
             "Oceanía y Apátridas"}
# orígenes agregados: eu = toda Europa sin España; ue / eur = UE-27 y resto de Europa
CONTINENTES = {"Europa (sin España)": "eu", "País de la UE27_2020 sin España": "ue",
               "País de Europa menos UE27_2020": "eur", "De Africa": "af", "De América": "am",
               "De Asia": "as", "Oceanía y Apátridas": "oc"}


def get(url, cache=None):
    if cache and os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    for intento in range(4):
        try:
            d = json.load(urllib.request.urlopen(url, timeout=120))
            break
        except Exception:
            if intento == 3:
                raise
            time.sleep(3 * (intento + 1))
    if cache:
        json.dump(d, open(cache, "w", encoding="utf-8"), ensure_ascii=False)
    return d


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(SALIDA, exist_ok=True)
    out, anio = {}, None
    for t in TABLAS:
        grupos = get(API + "GRUPOS_TABLA/%d" % t, os.path.join(CACHE, "g%d.json" % t))
        gm = [g for g in grupos if "unicip" in g["Nombre"]][0]["Id"]
        munis = get(API + "VALORES_GRUPOSTABLA/%d/%d" % (t, gm), os.path.join(CACHE, "m%d.json" % t))
        codigo = {m["Nombre"]: m.get("Codigo") for m in munis}
        datos = get(API + "DATOS_TABLA/%d?nult=1&tv=%s" % (t, SEXO_TOTAL), os.path.join(CACHE, "d%d.json" % t))
        por_muni = {}
        for s in datos:
            if not s.get("Data"):
                continue
            # "Total. <municipio>. <nacionalidad>. Dato base." (el orden cambia según la tabla)
            partes = [x for x in s["Nombre"].strip().rstrip(".").split(". ") if x != "Dato base"]
            partes = partes[1:]  # el primero es el sexo (Total)
            nac = partes.pop() if partes[-1] not in codigo else partes.pop(0)
            muni = ". ".join(partes)
            v = s["Data"][0].get("Valor")
            anio = anio or s["Data"][0].get("Anyo")
            if v is None:
                continue
            por_muni.setdefault(muni, {})[nac] = int(v)
        for muni, d in por_muni.items():
            cod = codigo.get(muni)
            if not cod or len(cod) != 5 or "Total" not in d:
                continue  # la fila de la provincia entera
            ext = d.get("Extranjera", 0)
            paises = sorted(((n, v) for n, v in d.items() if n not in AGREGADOS and v > 0),
                            key=lambda x: -x[1])
            fila = {"n": muni, "t": d["Total"], "e": ext, "top": [[n, v] for n, v in paises[:5]]}
            cont = {k: d[n] for n, k in CONTINENTES.items() if d.get(n)}
            if cont:
                fila["c"] = cont
            out[cod] = fila
        print("· tabla %d: %d municipios" % (t, len(por_muni)))
    res = {"v": 1, "anio": anio, "fecha": time.strftime("%Y-%m-%d"),
           "fuente": "INE, Estadística del Padrón Continuo (1 de enero de %s), principales nacionalidades" % anio,
           "municipios": out}
    dest = os.path.join(SALIDA, "municipios.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    print("Hecho: %d municipios → %s (%.1f MB)" % (len(out), dest, os.path.getsize(dest) / 1e6))


if __name__ == "__main__":
    main()
