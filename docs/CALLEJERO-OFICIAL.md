# Integración con el callejero oficial — estado y arquitectura

Este documento recoge lo verificado (no asumido) sobre las fuentes oficiales
y el estado real de la integración, para no repetir la investigación cada
vez que se retome este trabajo.

## Actualización (27-01-2026 sesión): por qué las calles salían "a tramos"

Causa raíz identificada: `streets.js` construía el callejero leyendo solo
las teselas del mapa que el usuario ya había visto en su sesión
(`map.querySourceFeatures`). Una calle larga solo aparecía completa cuando
se había paseado el mapa por todos sus tramos, y las calles fuera de la
vista actual simplemente no existían para la app todavía. El motivo de que
estuviera hecho así (commit `05f398a`) es que la consulta a Overpass en vivo
desde el navegador del usuario se colgaba hasta timeout por la red de ese
usuario concreto, no por falta de clave ni configuración.

**Solución aplicada**: la consulta a Overpass ya no se hace desde el
navegador del usuario. Se hace UNA VEZ desde una GitHub Action con red
fiable (`scripts/fetch-overpass-streets.mjs`, workflow
`.github/workflows/update-street-geometry.yml`), y el resultado se guarda
como fichero estático (`data/streets-geometry.json`) que la app carga como
cualquier otro asset (`js/street-geometry.js`). Esto es ahora la fuente
PRINCIPAL de geometría; el escaneo en vivo de teselas se mantiene como red
de seguridad para calles que OSM tenga pero que aún no se hayan
resincronizado.

De paso se corrigió que `EXCLUDED_CLASSES`/el filtro de tipos de vía excluía
`pedestrian`, lo que dejaba fuera calles peatonales reales con nombre del
casco histórico (p. ej. tipo Calle Cruz Conde).

**Sigue pendiente** (no resuelto en esta sesión, ver checklist más abajo):
normalizar nombres de forma más agresiva antes de agrupar tramos (acentos,
"Avda." vs "Avenida", mayúsculas) para los pocos casos en que el mismo
nombre real llega escrito de dos formas distintas desde OSM.

## Fuentes verificadas

### 1. Ayuntamiento de Córdoba — CKAN "Callejero de Córdoba"

- Dataset: https://datosabiertos.cordoba.es/ckan/dataset/callejero-de-cordoba
- Recurso CSV: `resource_id = 2b4fafbf-4b12-4c60-b0fd-5f62cad9fbf1`
- Descarga directa: https://datosabiertos.cordoba.es/ckan/dataset/caf534cf-c626-425b-8434-44301510deaa/resource/2b4fafbf-4b12-4c60-b0fd-5f62cad9fbf1/download/callejero_cordoba.csv
- **Última actualización de los datos: 15 de enero de 2024.** No está actualizado a 2026.
- Campos reales (comprobados contra datos, no contra la ficha): `CODIGO_SIGLA`,
  `CODIGO_CALLE`, `CODIGO_INE`, `DESCRIPCION_CALLE`, `DESCRIPCION_CALLE_ED`.
- **No tiene coordenadas ni geometría.** Es un nomenclátor alfanumérico puro.
- Incluye entradas que no son calles reales para el juego (`SD` = dependencias/
  edificios sueltos, `EX` = cortijos/fincas/parcelas rurales, vías duplicadas
  o de uso interno catastral).
- `Datastore active: true`, pero la API `datastore_search` no ha respondido
  desde este entorno (ver "Limitaciones" abajo).

### 2. Ayuntamiento de Córdoba — "Callejero Fiscal 2026" (ya integrado)

- Ya estaba en el repo antes de esta fase: `js/official-streets.js`, 2.324
  entradas, solo con `tipo` y `nombre` (sin `codigoCalle` todavía).
- Es, con toda probabilidad, una versión más reciente y ya filtrada
  (sin `SD`/`EX` no-calles) del mismo padrón municipal que el CSV del CKAN.
- No trae fecha de publicación embebida en el propio fichero.

### 3. CDAU — Callejero Digital de Andalucía Unificado

- Portal: https://www.callejerodeandalucia.es/
- Es el único de los tres con **geometría real** (vías, tramos, portales,
  estructura topológica), mantenido por el Instituto de Estadística y
  Cartografía de Andalucía.
- Servicio WFS (estándar OGC, descarga en GeoJSON):
  `http://www.callejerodeandalucia.es/servicios/cdau/wfs`
- Campo `nom_normalizado` por tramo — pensado para cruzar por nombre.
- Aviso oficial: el WFS no permite descarga completa masiva, hay que filtrar
  por zona/municipio con un cliente SIG (QGIS, etc.) o construyendo una
  consulta `GetFeature` con filtro por atributo (p. ej. código de municipio).
- **Pendiente de integrar** en esta fase (ver Limitaciones).

## Arquitectura implementada en esta fase

- `js/street-registry.js` (`window.CallejeroRegistry`): construye, en tiempo
  de ejecución, un registro unificado que separa identidad (`OFFICIAL_STREETS`)
  de geometría (lo que `streets.js` ha escaneado de OSM), y calcula un estado
  por calle: `VERIFICADA`, `REVISAR`, `OFICIAL_SIN_REPRESENTACION_OSM`,
  `OSM_SIN_CONFIRMACION_OFICIAL`, `ERROR_DATOS`.
- No cambia el comportamiento del quiz todavía (instrucción explícita: nada
  de funciones secundarias hasta tener el callejero fiable). Se reconstruye
  solo en cada escaneo y deja un resumen en la consola del navegador
  (`window.CallejeroRegistry.getLast()`), para poder inspeccionarlo ya.
- `scripts/sync-official-streets.mjs`: script Node.js (sin dependencias)
  que cruza el CSV oficial completo con `official-streets.js` y le añade
  `codigoCalle`. Documentado con `USO` en la cabecera del propio fichero.

## Limitaciones conocidas (sin ocultar ni improvisar)

1. **No se ha podido descargar el CSV completo del CKAN desde este entorno.**
   La herramienta de recuperación web de que dispone el asistente trunca el
   fichero a ~300 filas pase lo que pase, y la API `datastore_search` del
   CKAN devuelve 404 en las rutas alcanzables. El entorno de ejecución de
   comandos tampoco tiene salida de red a `datosabiertos.cordoba.es`.
   → **Solución más fiable**: descargar el CSV a mano (dos clics, sin
   restricciones desde un navegador normal) y ejecutar
   `node scripts/sync-official-streets.mjs --file=callejero_cordoba.csv`,
   o correr el script en un entorno con salida a internet normal (p. ej.
   una GitHub Action).
2. **`official-streets.js` todavía no tiene `codigoCalle`.** Es un hueco
   conocido, no un dato inventado; el script de sync lo rellena en cuanto
   haya CSV completo disponible.
3. **CDAU no está integrado.** Se ha verificado que existe, que tiene
   geometría real y cómo se accede (WFS), pero descargarlo y filtrarlo por
   Córdoba es un trabajo aparte (llamadas WFS con filtros por atributo/
   bounding box) que no se ha hecho todavía en esta fase.
4. **El registro (`street-registry.js`) no cambia todavía qué calles
   pregunta el quiz.** Solo dcalles nuevas: `OFICIAL_SIN_REPRESENTACION_OSM`
   se puede consultar por consola, pero el quiz sigue basándose en lo que
   `streets.js` encuentra en OSM. El siguiente paso natural (cuando se
   confirme el enfoque) es que el quiz también pueda preguntar por calles
   oficiales sin geometría todavía, mostrando un aviso en vez de resaltarlas
   en el mapa, o priorizando geometría CDAU cuando exista.

## Qué falta para cumplir el objetivo completo de la fase

- [x] Dejar de depender del escaneo de teselas en vivo como única fuente de
      geometría → resuelto con `fetch-overpass-streets.mjs` +
      `update-street-geometry.yml` + `street-geometry.js` (ver arriba).
- [ ] Ejecutar `scripts/sync-official-streets.mjs` con el CSV completo →
      añade `codigoCalle` a las 2.324 vías.
- [ ] Revisar manualmente los nombres del CSV oficial sin coincidencia en
      `official-streets.js` (el script los lista) — pueden ser calles
      nuevas que faltan en el listado actual.
- [ ] Decidir e implementar la descarga filtrada del WFS de CDAU para
      Córdoba (probablemente vía un script aparte, similar al de
      `fetch-overpass-streets.mjs`), como fuente de geometría alternativa/
      complementaria a Overpass — es la única con topología oficial real
      por calle, no solo por tramo OSM.
- [ ] Conectar `CallejeroRegistry` con el quiz para que las calles
      `OFICIAL_SIN_REPRESENTACION_OSM` puedan aparecer como pregunta (con
      su estado visible), en vez de ser invisibles como hasta ahora.
- [ ] Normalizar nombres antes de agrupar tramos por calle (ver nota de
      arriba) para los casos en que OSM tenga la misma calle escrita de dos
      formas.
