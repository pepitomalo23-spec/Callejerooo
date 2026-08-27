#!/usr/bin/env node
// Descarga de Overpass (OpenStreetMap) la geometría COMPLETA de todas las
// vías con nombre dentro del término municipal de Córdoba, y la guarda en
// data/streets-geometry.json agrupada por nombre.
//
// POR QUÉ EXISTE:
// La app (js/streets.js) construía el callejero "al vuelo", leyendo solo las
// teselas del mapa que el usuario ya había visto en su sesión
// (map.querySourceFeatures). Eso provoca dos síntomas:
//   1. Calles que no aparecen hasta que se pasa el mapa por esa zona.
//   2. Calles que se resaltan solo "a tramos" (los que se han visto), no
//      completas, porque el registro se va rellenando poco a poco.
// La solución correcta es pedir la calle ENTERA de una vez, pero eso exige
// una consulta a Overpass, y hacerla en vivo desde el navegador del usuario
// ya se probó y falló (ver commit "Sustituir Overpass por lectura directa
// de las teselas del mapa": la petición se colgaba hasta timeout desde la
// red de un usuario concreto). Solución: hacer esa consulta UNA VEZ desde
// aquí (este script, pensado para ejecutarse en una GitHub Action con red
// fiable, ver .github/workflows/update-street-geometry.yml) y dejar el
// resultado como fichero estático que la app carga igual que cualquier
// otro asset, sin depender de la red del usuario en el momento de jugar.
//
// QUÉ HACE:
//   1. Consulta el área administrativa de Córdoba (municipio, admin_level=8
//      dentro de España) en Overpass.
//   2. Pide todas las "ways" con etiqueta highway + name dentro de esa área,
//      con geometría completa (out geom).
//   3. Agrupa los tramos devueltos por nombre exacto (igual que hace
//      streets.js con las teselas), sin fusionar tramos que se llamen
//      distinto.
//   4. Escribe data/streets-geometry.json con esa geometría completa.
//
// USO:
//   node scripts/fetch-overpass-streets.mjs
//   node scripts/fetch-overpass-streets.mjs --out=./data/streets-geometry.json
//
// Sin dependencias externas (solo fetch nativo de Node 18+).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v === undefined ? true : v];
  })
);

const OUT_PATH = args.out
  ? path.resolve(process.cwd(), args.out)
  : path.join(__dirname, "..", "data", "streets-geometry.json");

// Varios espejos de Overpass, por si uno está saturado o caído. Orden por
// fiabilidad actual (ver https://wiki.openstreetmap.org/wiki/Overpass_API,
// tabla "Public Overpass API instances"): overpass-api.de, la instancia
// principal, está marcada ahí mismo como sobrecargada y con fiabilidad no
// garantizada actualmente ("nowadays this server is overloaded... do not
// expect high reliability. Use alternatives if possible"), así que se deja
// como última opción. El antiguo espejo overpass.kumi.systems ya no existe
// (pasó a llamarse private.coffee).
const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

// Tipos de "highway" que cuentan como calle real para el callejero. Se
// excluyen senderos/escaleras/carriles bici/vías de servicio. A propósito
// NO se excluye "pedestrian": en el casco histórico de Córdoba muchas
// calles peatonales con nombre real (p. ej. Calle Cruz Conde) usan esa
// etiqueta, y excluirla (como hacía streets.js) las dejaba fuera del quiz.
const INCLUDED_HIGHWAY_TYPES = [
  "motorway", "trunk", "primary", "secondary", "tertiary",
  "unclassified", "residential", "living_street", "pedestrian",
  "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
];

const OVERPASS_QUERY = `
[out:json][timeout:180];
area["ISO3166-1"="ES"]["admin_level"="2"]->.spain;
area["name"="Córdoba"]["admin_level"="8"]["boundary"="administrative"](area.spain)->.searchArea;
(
  way["highway"~"^(${INCLUDED_HIGHWAY_TYPES.join("|")})$"]["name"](area.searchArea);
);
out geom;
`.trim();

async function fetchFromOverpass() {
  const body = "data=" + encodeURIComponent(OVERPASS_QUERY);
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    console.log(`[fetch-overpass-streets] Probando ${endpoint} ...`);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(200000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText}${text ? " — " + text.slice(0, 300) : ""}`);
      }
      const json = await res.json();
      if (!json.elements) {
        throw new Error("Respuesta sin 'elements'");
      }
      console.log(`[fetch-overpass-streets] OK: ${json.elements.length} vías recibidas de ${endpoint}`);
      return json;
    } catch (err) {
      console.warn(`[fetch-overpass-streets] Falló ${endpoint}: ${err.message}`);
      lastError = err;
    }
  }
  throw new Error(`Todos los espejos de Overpass fallaron. Último error: ${lastError && lastError.message}`);
}

function groupByName(overpassJson) {
  const byName = new Map();
  let skippedNoGeometry = 0;

  for (const el of overpassJson.elements) {
    if (el.type !== "way") continue;
    const name = el.tags && el.tags.name && el.tags.name.trim();
    if (!name) continue;
    if (!el.geometry || el.geometry.length < 2) {
      skippedNoGeometry++;
      continue;
    }
    const coords = el.geometry.map((pt) => [pt.lon, pt.lat]);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(coords);
  }

  if (skippedNoGeometry > 0) {
    console.warn(`[fetch-overpass-streets] ${skippedNoGeometry} vías sin geometría descartadas.`);
  }

  return byName;
}

async function main() {
  const overpassJson = await fetchFromOverpass();
  const byName = groupByName(overpassJson);

  if (byName.size === 0) {
    throw new Error("No se agrupó ninguna calle: revisa la consulta Overpass antes de sobrescribir el fichero existente.");
  }

  const streets = {};
  // Orden alfabético para que los diffs de git sean legibles.
  Array.from(byName.keys()).sort((a, b) => a.localeCompare(b, "es")).forEach((name) => {
    streets[name] = byName.get(name);
  });

  const output = {
    generatedAt: new Date().toISOString(),
    source: "overpass",
    query: OVERPASS_QUERY,
    totalStreets: Object.keys(streets).length,
    totalSegments: Object.values(streets).reduce((sum, segs) => sum + segs.length, 0),
    streets,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log(`[fetch-overpass-streets] Escrito ${OUT_PATH}`);
  console.log(`[fetch-overpass-streets] ${output.totalStreets} calles, ${output.totalSegments} tramos en total.`);
}

main().catch((err) => {
  console.error("[fetch-overpass-streets] ERROR:", err.message);
  process.exitCode = 1;
});
