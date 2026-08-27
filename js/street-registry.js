// Registro central de calles: separa la IDENTIDAD de una vía (que existe
// según el Ayuntamiento) de su GEOMETRÍA (dónde está dibujada en el mapa).
//
// Por qué existe este fichero:
// Antes, el quiz solo conocía las calles que OpenStreetMap tenía dibujadas
// en la vista actual del mapa (ver streets.js). Si una calle oficial no
// estaba en OSM, o el usuario no había movido el mapa hasta esa zona,
// esa calle simplemente no existía para la aplicación.
//
// Este registro construye una vista unificada:
//   - window.OFFICIAL_STREETS (official-streets.js) dice QUÉ calles existen
//     oficialmente, con su nombre tal cual lo escribe el Ayuntamiento.
//   - streets.js sigue leyendo la GEOMETRÍA de las teselas de OSM.
//   - Este registro cruza ambas cosas por nombre normalizado y calcula,
//     para cada calle oficial, un estado de verificación.
//
// IMPORTANTE (limitación actual, ver README / informe de esta fase):
// El listado OFFICIAL_STREETS embebido (2.324 vías, "Callejero Fiscal
// 2026") todavía NO incluye el CODIGO_CALLE oficial del Ayuntamiento
// (identificador numérico estable del CSV publicado en datosabiertos.
// cordoba.es, recurso "Callejero de Córdoba", resource_id
// 2b4fafbf-4b12-4c60-b0fd-5f62cad9fbf1, actualizado 15-01-2024). Para
// añadirlo hace falta cruzar por nombre contra el CSV completo del
// Ayuntamiento, y ese CSV no se ha podido descargar entero todavía
// (ver scripts/sync-official-streets.mjs). Hasta entonces, "codigoCalle"
// vale null en todas las entradas: es un hueco conocido, no un dato
// inventado.

(function () {
  "use strict";

  // Estados de verificación (sección 10 del encargo). Por ahora es solo
  // arquitectura interna: no se muestra todavía en la interfaz de usuario.
  const VerificationStatus = {
    VERIFICADA: "VERIFICADA",                                 // coincide en Ayuntamiento y OSM
    REVISAR: "REVISAR",                                       // hay alguna discrepancia
    OFICIAL_SIN_REPRESENTACION_OSM: "OFICIAL_SIN_REPRESENTACION_OSM", // existe oficialmente, OSM no la tiene
    OSM_SIN_CONFIRMACION_OFICIAL: "OSM_SIN_CONFIRMACION_OFICIAL",     // está en OSM, no aparece en la fuente oficial
    ERROR_DATOS: "ERROR_DATOS"
  };

  // Metadatos de las fuentes usadas, para poder mostrar/depurar más
  // adelante "de dónde viene cada dato" y detectar cuándo hay que
  // volver a sincronizar.
  const SOURCES = {
    ayuntamiento: {
      nombre: "Callejero Fiscal 2026 (Ayuntamiento de Córdoba)",
      // Distinto del recurso CKAN "Callejero de Córdoba" (ese es de enero
      // 2024 y no tiene CODIGO_CALLE todavía cruzado, ver arriba).
      fechaActualizacionFuente: null, // desconocida: el PDF original no trae fecha de publicación embebida
      fechaUltimaSincronizacion: null,
      version: null
    },
    ayuntamientoCkan: {
      nombre: "Callejero de Córdoba (CKAN, datosabiertos.cordoba.es)",
      resourceId: "2b4fafbf-4b12-4c60-b0fd-5f62cad9fbf1",
      datasetUrl: "https://datosabiertos.cordoba.es/ckan/dataset/callejero-de-cordoba",
      fechaActualizacionFuente: "2024-01-15",
      fechaUltimaSincronizacion: null, // se rellenará cuando se ejecute el script de sync
      campos: ["CODIGO_SIGLA", "CODIGO_CALLE", "CODIGO_INE", "DESCRIPCION_CALLE", "DESCRIPCION_CALLE_ED"],
      tieneGeometria: false
    },
    cdau: {
      nombre: "Callejero Digital de Andalucía Unificado (CDAU)",
      wfsEndpoint: "http://www.callejerodeandalucia.es/servicios/cdau/wfs",
      fechaUltimaSincronizacion: null,
      tieneGeometria: true,
      pendiente: true // aún no integrado en esta fase, ver informe
    },
    osm: {
      nombre: "OpenStreetMap (vía teselas de OpenFreeMap)",
      tieneGeometria: true
    }
  };

  function stripAccents(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  // Misma normalización que usa compare.js, reutilizada aquí para que el
  // registro y el comparador usen siempre el mismo criterio de comparación.
  function normalizeName(str) {
    return stripAccents(str)
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Construye el registro unificado a partir de:
  //   officialList: window.OFFICIAL_STREETS  -> [{tipo, nombre}, ...]
  //   mapStreetsByName: Map de streets.js     -> nombre (tal cual en OSM) -> segmentos
  function buildRegistry(officialList, mapStreetsByName) {
    officialList = officialList || [];
    mapStreetsByName = mapStreetsByName || new Map();

    // Índice de nombres de OSM ya normalizados, para poder cruzar en O(1).
    const osmIndex = new Map(); // nombreNormalizado -> nombre original de OSM
    mapStreetsByName.forEach(function (_segments, name) {
      osmIndex.set(normalizeName(name), name);
    });

    const matchedOsmKeys = new Set();
    const entries = officialList.map(function (o) {
      const nombreNormalizado = normalizeName(o.nombre);
      const osmMatch = osmIndex.get(nombreNormalizado) || null;
      if (osmMatch) matchedOsmKeys.add(nombreNormalizado);

      return {
        // --- Identidad (sección 4A) ---
        codigoCalle: o.codigoCalle || null, // pendiente de cruzar con el CKAN completo
        tipo: o.tipo,
        nombreOficial: o.nombre,
        nombreNormalizado: nombreNormalizado,
        aliases: osmMatch && osmMatch !== o.nombre ? [osmMatch] : [],

        // --- Geometría (sección 4B) ---
        geometriaDisponible: !!osmMatch,
        geometriaFuente: osmMatch ? "osm" : null,
        nombreEnOsm: osmMatch,

        // --- Estado y trazabilidad ---
        estado: osmMatch ? VerificationStatus.VERIFICADA : VerificationStatus.OFICIAL_SIN_REPRESENTACION_OSM,
        fuente: "ayuntamiento",
        fechaFuente: SOURCES.ayuntamiento.fechaActualizacionFuente
      };
    });

    // Calles que están en OSM pero no en el listado oficial: no asumimos
    // que sea un error de ninguna de las dos fuentes (sección 5, caso 4).
    const onlyOsm = [];
    mapStreetsByName.forEach(function (_segments, name) {
      const norm = normalizeName(name);
      if (!matchedOsmKeys.has(norm)) {
        onlyOsm.push({
          codigoCalle: null,
          tipo: null,
          nombreOficial: null,
          nombreNormalizado: norm,
          aliases: [],
          geometriaDisponible: true,
          geometriaFuente: "osm",
          nombreEnOsm: name,
          estado: VerificationStatus.OSM_SIN_CONFIRMACION_OFICIAL,
          fuente: "osm",
          fechaFuente: null
        });
      }
    });

    return {
      entries: entries,
      onlyOsm: onlyOsm,
      summary: {
        totalOficial: entries.length,
        verificadas: entries.filter(function (e) { return e.estado === VerificationStatus.VERIFICADA; }).length,
        sinRepresentacionOsm: entries.filter(function (e) { return e.estado === VerificationStatus.OFICIAL_SIN_REPRESENTACION_OSM; }).length,
        soloEnOsm: onlyOsm.length
      }
    };
  }

  let lastResult = null;

  // Se reconstruye cada vez que streets.js detecta calles nuevas en el
  // mapa (evento "callejero:streets-updated"), así el registro siempre
  // refleja lo último que se ha escaneado sin necesidad de recargar.
  document.addEventListener("callejero:streets-updated", function () {
    if (!window.OFFICIAL_STREETS || !window.CallejeroQuiz) return;
    lastResult = buildRegistry(window.OFFICIAL_STREETS, window.CallejeroQuiz.getAllStreets());
    // Log discreto para depuración (sección 10: la arquitectura interna
    // debe estar preparada, aunque todavía no se muestre en la UI).
    console.info(
      "[CallejeroRegistry] %d oficiales · %d verificadas · %d oficiales sin representación en OSM · %d solo en OSM",
      lastResult.summary.totalOficial,
      lastResult.summary.verificadas,
      lastResult.summary.sinRepresentacionOsm,
      lastResult.summary.soloEnOsm
    );
  });

  window.CallejeroRegistry = {
    VerificationStatus: VerificationStatus,
    SOURCES: SOURCES,
    normalizeName: normalizeName,
    build: buildRegistry,
    getLast: function () { return lastResult; }
  };
})();
