(function () {
  "use strict";

  // Consulta Overpass: todas las vías con nombre dentro del término municipal
  // de Córdoba, limitada a tipos de calle relevantes (se excluyen caminos
  // peatonales/senderos poco útiles para el callejero de la oposición).
  const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
  const OVERPASS_QUERY =
    '[out:json][timeout:30];\n' +
    'area["name"="Córdoba"]["boundary"="administrative"]["admin_level"="8"]->.a;\n' +
    '(\n' +
    '  way["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street|primary_link|secondary_link|tertiary_link)$"]["name"](area.a);\n' +
    ');\n' +
    'out geom;';

  const HIGHLIGHT_SOURCE_ID = "street-highlight-source";
  const HIGHLIGHT_CASING_LAYER_ID = "street-highlight-casing";
  const HIGHLIGHT_LAYER_ID = "street-highlight-layer";

  const statusEl = document.getElementById("sidebar-status");
  const quizEl = document.getElementById("sidebar-quiz");
  const progressEl = document.getElementById("progress");
  const streetNameEl = document.getElementById("street-name");
  const resolveBtn = document.getElementById("resolve-btn");
  const nextBtn = document.getElementById("next-btn");
  const restartBtn = document.getElementById("restart-btn");

  let streetsByName = new Map(); // nombre de calle -> array de tramos [[lng,lat], ...]
  let quizOrder = [];
  let currentIndex = -1;
  let currentName = null;

  function setStatus(message) {
    statusEl.textContent = message;
    statusEl.hidden = false;
    quizEl.hidden = true;
  }

  function showQuiz() {
    statusEl.hidden = true;
    quizEl.hidden = false;
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
    return array;
  }

  function waitForMap(callback) {
    if (window._map) {
      if (window._map.loaded()) {
        callback(window._map);
      } else {
        window._map.on("load", function () {
          callback(window._map);
        });
      }
    } else {
      setTimeout(function () {
        waitForMap(callback);
      }, 150);
    }
  }

  async function fetchStreets() {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(OVERPASS_QUERY)
    });

    if (!response.ok) {
      throw new Error("Overpass respondió con estado " + response.status);
    }

    const data = await response.json();
    const byName = new Map();

    (data.elements || []).forEach(function (el) {
      if (el.type !== "way" || !el.geometry || !el.tags || !el.tags.name) return;
      const coords = el.geometry
        .filter(function (pt) { return pt && typeof pt.lon === "number" && typeof pt.lat === "number"; })
        .map(function (pt) { return [pt.lon, pt.lat]; });
      if (coords.length < 2) return;

      const name = el.tags.name.trim();
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(coords);
    });

    return byName;
  }

  function ensureHighlightLayers(map) {
    if (map.getSource(HIGHLIGHT_SOURCE_ID)) return;

    map.addSource(HIGHLIGHT_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    });

    // Contorno blanco para que la calle resalte sobre el estilo del mapa
    map.addLayer({
      id: HIGHLIGHT_CASING_LAYER_ID,
      type: "line",
      source: HIGHLIGHT_SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": 9,
        "line-opacity": 0.9
      }
    });

    map.addLayer({
      id: HIGHLIGHT_LAYER_ID,
      type: "line",
      source: HIGHLIGHT_SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#d9581f",
        "line-width": 5,
        "line-opacity": 1
      }
    });
  }

  function clearHighlight(map) {
    const source = map.getSource(HIGHLIGHT_SOURCE_ID);
    if (source) source.setData({ type: "FeatureCollection", features: [] });
  }

  function highlightStreet(map, name) {
    const segments = streetsByName.get(name) || [];
    const features = segments.map(function (coords) {
      return {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords }
      };
    });

    const source = map.getSource(HIGHLIGHT_SOURCE_ID);
    source.setData({ type: "FeatureCollection", features: features });

    let bounds = null;
    segments.forEach(function (coords) {
      coords.forEach(function (pair) {
        if (!bounds) {
          bounds = new maplibregl.LngLatBounds(pair, pair);
        } else {
          bounds.extend(pair);
        }
      });
    });

    if (bounds) {
      // El padding izquierdo deja hueco para el panel lateral en escritorio
      const isNarrow = window.innerWidth <= 640;
      map.fitBounds(bounds, {
        padding: isNarrow
          ? { top: 40, bottom: 40, left: 40, right: 40 }
          : { top: 60, bottom: 60, left: 360, right: 60 },
        duration: 1200,
        maxZoom: 17
      });
    }
  }

  function buildQuizOrder() {
    quizOrder = shuffle(Array.from(streetsByName.keys()));
  }

  function goToStreet(map, index) {
    currentIndex = index;
    currentName = quizOrder[currentIndex];
    streetNameEl.textContent = currentName;
    progressEl.textContent = (currentIndex + 1) + " / " + quizOrder.length;
    clearHighlight(map);
    resolveBtn.hidden = false;
    nextBtn.hidden = true;
  }

  function nextStreet(map) {
    let index = currentIndex + 1;
    if (index >= quizOrder.length) {
      buildQuizOrder();
      index = 0;
    }
    goToStreet(map, index);
  }

  function init() {
    waitForMap(async function (map) {
      ensureHighlightLayers(map);

      try {
        streetsByName = await fetchStreets();
      } catch (err) {
        setStatus("No se pudieron cargar las calles: " + err.message);
        return;
      }

      if (streetsByName.size === 0) {
        setStatus("No se encontraron calles con nombre en Córdoba.");
        return;
      }

      buildQuizOrder();
      showQuiz();
      goToStreet(map, 0);

      resolveBtn.addEventListener("click", function () {
        highlightStreet(map, currentName);
        resolveBtn.hidden = true;
        nextBtn.hidden = false;
      });

      nextBtn.addEventListener("click", function () {
        nextStreet(map);
      });

      restartBtn.addEventListener("click", function () {
        buildQuizOrder();
        goToStreet(map, 0);
      });
    });
  }

  init();
})();
