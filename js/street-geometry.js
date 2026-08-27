// Carga la geometría COMPLETA de las calles, precalculada por
// scripts/fetch-overpass-streets.mjs y guardada en data/streets-geometry.json
// (una GitHub Action la regenera periódicamente, ver
// .github/workflows/update-street-geometry.yml).
//
// Esta es ahora la fuente PRINCIPAL de geometría: como viene completa desde
// el primer instante, una calle larga se resalta entera nada más entrar,
// sin depender de que el usuario haya paseado el mapa por todos sus tramos.
// El escaneo en vivo de teselas (streets.js) se mantiene como red de
// seguridad, para calles nuevas que OSM tenga pero que aún no se hayan
// vuelto a sincronizar en este fichero.

(function () {
  "use strict";

  const DATA_URL = "data/streets-geometry.json";
  let cachedPromise = null;

  function load() {
    if (cachedPromise) return cachedPromise;

    cachedPromise = fetch(DATA_URL, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        const byName = new Map();
        const streets = (json && json.streets) || {};

        Object.keys(streets).forEach(function (name) {
          const segments = streets[name];
          if (Array.isArray(segments) && segments.length > 0) {
            byName.set(name, segments);
          }
        });

        if (byName.size > 0) {
          console.info(
            "[Callejero] Geometría precalculada cargada: %d calles (generada %s, fuente %s)",
            byName.size,
            (json && json.generatedAt) || "?",
            (json && json.source) || "?"
          );
        } else {
          console.info(
            "[Callejero] data/streets-geometry.json todavía no tiene calles (placeholder). " +
            "Usando solo el escaneo en vivo del mapa mientras tanto."
          );
        }

        return byName;
      })
      .catch(function (err) {
        console.warn("[Callejero] No se pudo cargar la geometría precalculada, se usará solo el escaneo en vivo del mapa:", err.message);
        return new Map();
      });

    return cachedPromise;
  }

  window.CallejeroStaticGeometry = { load: load };
})();
