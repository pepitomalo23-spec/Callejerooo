#!/usr/bin/env node
// Sincroniza js/official-streets.js con el recurso oficial del Ayuntamiento
// de Córdoba ("Callejero de Córdoba", CKAN, resource_id
// 2b4fafbf-4b12-4c60-b0fd-5f62cad9fbf1).
//
// QUÉ HACE:
//   1. Descarga el CSV completo del recurso (o lo lee de un fichero local
//      si se pasa --file=ruta, por si la red del entorno donde se ejecuta
//      esto no tiene salida a datosabiertos.cordoba.es).
//   2. Lo parsea (separador ';', campos entre comillas, ancho fijo con
//      espacios de relleno que hay que recortar).
//   3. Cruza cada fila por nombre normalizado con el listado ya existente
//      en js/official-streets.js (2.324 vías, "Callejero Fiscal 2026") y
//      le añade el CODIGO_CALLE oficial cuando encuentra coincidencia.
//   4. Reporta cuántas filas del CSV no tienen correspondencia en el
//      listado actual (calles nuevas o con nombre distinto) SIN
//      modificarlas automáticamente: eso hay que revisarlo a mano, tal y
//      como pide el encargo (no fusionar nombres de fuentes distintas sin
//      verificar primero).
//   5. Escribe js/official-streets.js de nuevo, con codigoCalle añadido y
//      un comentario de cabecera con la fecha de sincronización.
//
// POR QUÉ EXISTE COMO SCRIPT APARTE (y no se hizo ya automáticamente):
// El entorno donde se generó esta primera fase no tiene salida de red al
// dominio datosabiertos.cordoba.es, así que no se pudo descargar el CSV
// completo (solo una muestra parcial, vía la herramienta de búsqueda web).
// Este script deja el proceso listo y documentado para ejecutarlo:
//   a) en tu propio ordenador (con Node 18+, sin dependencias externas), o
//   b) en una GitHub Action con salida a internet normal, o
//   c) pasándole el CSV ya descargado con --file=callejero_cordoba.csv
//
// USO:
//   node scripts/sync-official-streets.mjs
//   node scripts/sync-official-streets.mjs --file=./callejero_cordoba.csv
//
// El CSV se descarga manualmente en dos clics desde:
//   https://datosabiertos.cordoba.es/ckan/dataset/callejero-de-cordoba

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OFFICIAL_STREETS_PATH = path.join(REPO_ROOT, "js", "official-streets.js");

const CSV_DOWNLOAD_URL =
  "https://datosabiertos.cordoba.es/ckan/dataset/caf534cf-c626-425b-8434-44301510deaa/resource/2b4fafbf-4b12-4c60-b0fd-5f62cad9fbf1/download/callejero_cordoba.csv";

const RESOURCE_ID = "2b4fafbf-4b12-4c60-b0fd-5f62cad9fbf1";

function stripAccents(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeName(str) {
  return stripAccents(str)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getCsvText(fileArg) {
  if (fileArg) {
    console.log(`Leyendo CSV local: ${fileArg}`);
    return fs.readFileSync(fileArg, "utf-8");
  }
  console.log(`Descargando CSV desde ${CSV_DOWNLOAD_URL} ...`);
  const res = await fetch(CSV_DOWNLOAD_URL);
  if (!res.ok) {
    throw new Error(
      `No se pudo descargar el CSV (HTTP ${res.status}). ` +
        `Prueba a descargarlo a mano y pasar --file=ruta.csv`
    );
  }
  return await res.text();
}

// El CSV usa ';' como separador, campos entrecomillados, y los valores de
// texto/número vienen con espacios de relleno hasta un ancho fijo (herencia
// de un sistema mainframe/COBOL, típico de padrones municipales antiguos).
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
  const header = lines[0];
  if (!/CODIGO_SIGLA/i.test(header)) {
    throw new Error("Cabecera inesperada, ¿es realmente el CSV del Callejero de Córdoba?");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Separador ';' fuera de comillas.
    const parts = line.split(";").map(function (p) {
      return p.trim().replace(/^"|"$/g, "").trim();
    });
    if (parts.length < 5) continue;
    const [sigla, codigoCalle, codigoIne, descripcion, descripcionEd] = parts;
    rows.push({
      sigla: sigla.trim(),
      codigoCalle: codigoCalle.trim(),
      codigoIne: codigoIne.trim(),
      descripcion: descripcion.trim(),
      descripcionEd: descripcionEd.trim()
    });
  }
  return rows;
}

function loadExistingOfficialStreets() {
  const content = fs.readFileSync(OFFICIAL_STREETS_PATH, "utf-8");
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]") + 1;
  const list = JSON.parse(content.slice(start, end));
  return list;
}

function writeOfficialStreets(list, syncDate, csvStats) {
  const header =
    `// Listado oficial de vías de Córdoba capital, generado a partir de\n` +
    `// "Callejero Fiscal_2026" (Ayuntamiento de Córdoba). Cada entrada tiene\n` +
    `// "tipo" (abreviatura del tipo de vía: CL, AV, PZ...), "nombre" (tal y\n` +
    `// como aparece en el callejero, sin el tipo) y "codigoCalle" (CODIGO_CALLE\n` +
    `// oficial del recurso CKAN "Callejero de Córdoba", cuando se ha podido\n` +
    `// cruzar por nombre; null si no se encontró coincidencia).\n` +
    `//\n` +
    `// codigoCalle sincronizado el ${syncDate} contra el recurso CKAN\n` +
    `// resource_id=${RESOURCE_ID} (datosabiertos.cordoba.es), última\n` +
    `// actualización de datos del recurso: 2024-01-15.\n` +
    `// Cobertura de esta sincronización: ${csvStats.matched}/${csvStats.total} vías` +
    ` con codigoCalle asignado (${csvStats.unmatchedList.length} sin coincidencia exacta,` +
    ` revisar manualmente).\n`;

  const body = `window.OFFICIAL_STREETS = ${JSON.stringify(list)};\n`;
  fs.writeFileSync(OFFICIAL_STREETS_PATH, header + body, "utf-8");
}

async function main() {
  const fileArg = process.argv
    .find(function (a) { return a.startsWith("--file="); });
  const filePath = fileArg ? fileArg.split("=")[1] : null;

  const csvText = await getCsvText(filePath);
  const csvRows = parseCsv(csvText);
  console.log(`CSV parseado: ${csvRows.length} filas.`);

  // Índice del CSV oficial por nombre normalizado. Puede haber varias
  // filas con el mismo nombre normalizado (viales duplicados/legacy); en
  // ese caso guardamos todos los códigos candidatos y avisamos.
  const csvIndex = new Map();
  csvRows.forEach(function (row) {
    const norm = normalizeName(row.descripcionEd || row.descripcion);
    if (!csvIndex.has(norm)) csvIndex.set(norm, []);
    csvIndex.get(norm).push(row);
  });

  const existing = loadExistingOfficialStreets();
  let matched = 0;
  const ambiguous = [];
  const unmatchedList = [];

  const enriched = existing.map(function (entry) {
    const norm = normalizeName(entry.nombre);
    const candidates = csvIndex.get(norm);
    if (!candidates || candidates.length === 0) {
      unmatchedList.push(entry.nombre);
      return Object.assign({}, entry, { codigoCalle: null });
    }
    if (candidates.length > 1) {
      ambiguous.push({ nombre: entry.nombre, candidatos: candidates.map(function (c) { return c.codigoCalle; }) });
    }
    matched++;
    return Object.assign({}, entry, { codigoCalle: candidates[0].codigoCalle });
  });

  const syncDate = new Date().toISOString().slice(0, 10);
  writeOfficialStreets(enriched, syncDate, {
    total: existing.length,
    matched: matched,
    unmatchedList: unmatchedList
  });

  console.log(`\nHecho. ${matched}/${existing.length} vías cruzadas con CODIGO_CALLE.`);
  if (unmatchedList.length > 0) {
    console.log(`\n${unmatchedList.length} vías SIN coincidencia en el CSV oficial (revisar a mano):`);
    unmatchedList.slice(0, 30).forEach(function (n) { console.log("  - " + n); });
    if (unmatchedList.length > 30) console.log(`  ... y ${unmatchedList.length - 30} más.`);
  }
  if (ambiguous.length > 0) {
    console.log(`\n${ambiguous.length} vías con MÁS DE UN código candidato (se usó el primero, revisar):`);
    ambiguous.slice(0, 20).forEach(function (a) {
      console.log(`  - ${a.nombre}: ${a.candidatos.join(", ")}`);
    });
  }
}

main().catch(function (err) {
  console.error("Error:", err.message);
  process.exit(1);
});
