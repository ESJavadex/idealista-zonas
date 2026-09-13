---
name: clasificar-zonas-idealista
description: Clasifica las zonas de la extensión idealista-zonas (~/idealista-zonas) en verde (bien), rojo (mal) o gris (duda) investigando datos reales: renta, criminalidad, población, prensa local y lo que se encuentre en internet. Usar cuando el usuario quiera rellenar, revisar o actualizar los colores de zonas, pregunte "qué barrios son buenos o malos", o pida clasificar una provincia nueva. Ante la duda, gris.
---

# Clasificar zonas de idealista-zonas (verde / rojo / gris)

## Contexto

La extensión `~/idealista-zonas` pinta sobre el mapa de idealista las zonas
verdes (bien), rojas (mal) y grises (duda). Los colores viven en
`herramientas/config.local.json` (git-ignorado, es la opinión personal del
usuario) y `zonas.js` se regenera con `herramientas/generar_zonas.py`.

Este skill define CÓMO decidir el color de cada zona con evidencia, y cómo
aplicarlo. El criterio por defecto es **peligrosidad** (criminalidad, hurtos por
habitante, renta, contexto socioeconómico). Otros criterios (ideal para
familias, colegios, zonas verdes, cerca del mar, mercadona cerca…) se añadirán
en el futuro como filtros separados: no mezclarlos con este.

## Reglas de decisión (escala de 5 niveles)

| Color | Veredicto | Cuándo |
|---|---|---|
| 🟢 verde | `bien` | Varias señales POSITIVAS convergentes: renta ≥ mediana del municipio, delincuencia baja o claramente por debajo de la media, buena demanda/precio m², buena reputación documentada. |
| 🟠 naranja | `regular` | Zona normal / en transición: sin señales fuertes ni positivas ni negativas; rentas medias; algún incidente aislado pero sin patrón. |
| 🔴 rojo | `mal` | Varias señales NEGATIVAS fuertes y convergentes: delitos por habitante claramente por encima de la media de la ciudad, titulares recurrentes de inseguridad/venta de droga, renta muy baja unida a degradación urbana documentada. |
| 🟤 granate | `muy_mal` | El peor nivel: evidencia negativa sólida, recurrente (años) y específica de esa zona. Usar con mucha moderación. |
| ⚪ gris | `duda` | **El default.** Evidencia insuficiente, contradictoria o solo anecdótica. Si no puedes acotar el dato a ese barrio concreto (p. ej. las estadísticas son de toda la comisaría), gris. |

Reglas duras:

1. **NUNCA** decidir rojo por el porcentaje de población extranjera, etnia o
   estereotipos. Esos datos demográficos son solo contexto explicativo.
2. Un titular aislado no es evidencia. Se necesitan 2+ fuentes o un patrón
   (recurrencia en prensa a lo largo de años).
3. Ante la duda, gris. No "consultar la intuición".
4. Si la fuente da datos solo por distrito o comisaría y no por barrio, o
   todos los barrios de esa unidad reciben el mismo color, o se deja en gris
   lo que no se pueda acotar. Di siempre la unidad real del dato.
5. Los datos siempre son "por habitante" cuando se pueda (hurtos/1000 hab.,
   no hurtos absolutos: un barrio grande siempre "tiene más").

## Fuentes (buscar en internet, en este orden)

1. **Criminalidad**
   - Balances de Seguridad Ciudadana / CISA del Ministerio del Interior
     (datos por provincia y comisaría; a veces por distrito en grandes ciudades).
   - Estadísticas penitenciarias o policiales municipales si el ayuntamiento las publica.
   - Prensa local: recurrencia de titulares por barrio ("robo en <barrio>",
     "macrofiesta", "punto de venta de droga", "tiranía"). Buscar
     `<barrio> + robos/hurtos/inseguridad` y `<ciudad> barrios más peligrosos`.
   - Rankings tipo "barrios más peligrosos de <ciudad>" (usar como pista, verificar).
2. **Renta y socioeconomía**
   - INE: Atlas de distribución de renta de los hogares (renta media por
     persona por secciones censales y municipios).
   - Publicaciones autonómicas o municipales con renta por distrito/barrio.
3. **Demografía (contexto, nunca criterio directo)**
   - INE / padrón municipal: población y % extranjero por barrio o municipio.
4. **Vivienda (señal de demanda)**
   - Idealista/data: precio m² por zona; zonas caras suelen ser verde, pero
     contrastar (zona cara con mala prensa sigue siendo duda).
5. **Otros riesgos objetivos**
   - Inundabilidad (SNCZI/CNIG, zonas afectadas por DANA), contaminación
     industrial, etc. — motivo legítimo de rojo si está documentado.

## Procedimiento

1. **Lista de zonas**: leer `zonas.js` (o pedir regenerar si falta la
   provincia). Para cada provincia trabajar con su clave (`claves[0]`).
2. **Investigar por ciudad** (no por barrio individual: primero datos de
   ciudad/distrito, después afinar con prensa local). Ejecutar búsquedas:
   - `<ciudad> barrios más peligrosos / inseguridad`
   - `<ciudad> delitos hurtos por barrio estadística <año>`
   - `<provincia> renta media por municipio INE`
   - `<barrio> robos` para los candidatos a rojo (verificar recurrencia).
3. **Asignar color** aplicando la tabla de reglas. Registrar en una tabla
   interna: zona → color → evidencia (2-3 fuentes con fecha).
4. **Escribir los resultados** en `herramientas/config.local.json`:

   ```json
   {
     "verdes":    { "valladolid-provincia": ["Covaresa", "Parquesol"] },
     "regulares": { "valladolid-provincia": ["La Victoria", "San Martín"] },
     "rojos":     { "valladolid-provincia": ["Belén - Pilarica", "Barrio España"] },
     "muy_mal":   { "valladolid-provincia": [] }
   }
   ```

   Las zonas que no se incluyen en ninguna lista quedan GRIS automáticamente.
   **Solo añadir o corregir nombres; no borrar listas existentes** salvo que el
   usuario lo pida (cada zona solo puede estar en una lista; si la mueves,
   retírala de la anterior).
5. **Regenerar y verificar**:

   ```bash
   cd ~/idealista-zonas/herramientas && python3 generar_zonas.py
   ```

   Atender los warnings de "no coincide con ninguna zona" (typo de nombre:
   comparar con el nombre exacto que aparece en zonas.js).
6. **Informe**: guardar un resumen con las fuentes (URL + fecha + dato) en
   `data-src/informes/<provincia>-<fecha>.md` para poder auditar decisiones.
7. **Recordar al usuario**: recargar la extensión (`chrome://extensions` ↻)
   y F5 en idealista.

## Notas de formato

- La comparación de nombres ignora mayúsculas, acentos y guiones
  ("Delicias - Canterac" = "delicias canterac").
- El script avisa de nombres que no casan: nunca ignorar esos warnings.
- Si el usuario pide un criterio nuevo (colegios, mercadona, familias…),
  proponer un campo separado por zona (p. ej. `"familias": "bien"`) y ampliar
  la extensión con filtros activables — no sobrescribir el veredicto de
  peligrosidad.
