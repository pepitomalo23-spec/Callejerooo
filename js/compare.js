(function () {
  "use strict";

  // Compara las calles que el mapa ha detectado en las teselas vectoriales
  // (window.CallejeroQuiz, ver streets.js) contra el listado oficial del
  // Callejero Fiscal (window.OFFICIAL_STREETS, ver official-streets.js).
  //
  // Es una comparación aproximada: los nombres de OpenStreetMap y los del
  // callejero fiscal no siempre coinciden carácter a carácter (acentos,
  // "Avda." vs "Avenida", orden "Abades, de" vs "de Abades"...), así que el
  // resultado hay que revisarlo a mano, no tratarlo como definitivo.

  const TYPE_WORDS = [
    "CALLEJON", "CALLEJÓN", "TRAVESIA", "TRAVESÍA", "CARRETERA", "GLORIETA",
    "PASAJE", "JARDINES", "JARDIN", "JARDÍN", "BARRIADA", "BULEVAR",
    "AVENIDA", "AVDA", "PLAZUELA", "PLAZA", "PLZA", "CALLE", "PASEO",
    "CAMINO", "RONDA", "PARQUE", "CUESTA"
  ];
  const TYPE_WORDS_RE = new RegExp("^(" + TYPE_WORDS.join("|") + ")\\.?\\s+", "i");

  const LEADING_ARTICLE_RE = /^,\s*(DE LA|DE LOS|DE LAS|DEL|DE|LA|LAS|LOS|EL|AL)$/i;
  const TRAILING_ARTICLE_RE = /^(.*),\s*(DE LA|DE LOS|DE LAS|DEL|DE|LA|LAS|LOS|EL|AL)$/i;

  function stripAccents(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function normalizeCore(str) {
    return stripAccents(str)
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // A partir de "ABADES, DE" genera también "DE ABADES", que es como
  // aparecería normalmente escrito ("Plaza de Abades").
  function officialVariants(nombre) {
    const variants = new Set();
    variants.add(normalizeCore(nombre));
    const m = TRAILING_ARTICLE_RE.exec(nombre.trim());
    if (m) {
      const natural = m[2] + " " + m[1];
      variants.add(normalizeCore(natural));
    }
    return Array.from(variants);
  }

  function mapNameVariants(name) {
    const variants = new Set();
    const core = normalizeCore(name);
    variants.add(core);
    const withoutType = name.replace(TYPE_WORDS_RE, "");
    if (withoutType !== name) {
      variants.add(normalizeCore(withoutType));
    }
    return Array.from(variants);
  }

  // Construye un índice normalizado -> [entradas oficiales] para poder
  // buscar coincidencias en O(1) en vez de comparar todo contra todo.
  function buildOfficialIndex(officialList) {
    const index = new Map();
    officialList.forEach(function (entry) {
      officialVariants(entry.nombre).forEach(function (variant) {
        if (!variant) return;
        if (!index.has(variant)) index.set(variant, []);
        index.get(variant).push(entry);
      });
    });
    return index;
  }

  function compare(mapNames, officialList) {
    const officialIndex = buildOfficialIndex(officialList);
    const matchedOfficialKeys = new Set();
    const onlyMap = [];

    mapNames.forEach(function (name) {
      const variants = mapNameVariants(name);
      let matched = false;
      variants.forEach(function (variant) {
        if (officialIndex.has(variant)) {
          matched = true;
          officialIndex.get(variant).forEach(function (entry) {
            matchedOfficialKeys.add(entry.tipo + "|" + entry.nombre);
          });
        }
      });
      if (!matched) onlyMap.push(name);
    });

    const onlyOfficial = officialList.filter(function (entry) {
      return !matchedOfficialKeys.has(entry.tipo + "|" + entry.nombre);
    });

    return {
      totalMap: mapNames.length,
      totalOfficial: officialList.length,
      matchedCount: matchedOfficialKeys.size,
      onlyMap: onlyMap.sort(function (a, b) { return a.localeCompare(b, "es"); }),
      onlyOfficial: onlyOfficial.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); })
    };
  }

  window.CallejeroCompare = {
    compare: compare,
    normalizeCore: normalizeCore
  };
})();
