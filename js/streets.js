(function () {
  "use strict";

  // En vez de pedir las calles a un servicio externo (Overpass), las leemos
  // directamente de las teselas vectoriales que MapTiler ya está sirviendo
  // para dibujar el mapa. Así no añadimos ninguna dependencia de red nueva:
  // si el mapa se ve, este panel funciona.

  // Clases de vía a excluir (senderos, escaleras, etc. poco útiles para el
  // callejero). Si una vía no tiene 'class', se incluye por defecto.
  const EXCLUDED_CLASSES = ["path", "track", "steps", "cycleway", "pedestrian", "service"];

  const HIGHLIGHT_SOURCE_ID = "street-highlight-source";
  const HIGHLIGHT_CASING_LAYER_ID = "street-highlight-casing";
  const HIGHLIGHT_LAYER_ID = "street-highlight-layer";

  const statusEl = document.getElementById("sidebar-status");
  const statusTextEl = document.getElementById("status-text");
  const retryBtn = document.getElementById("retry-btn");
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
  let quizStarted = false;
  let vectorSourceId = null;
  let candidateLayers = [];

  function setStatus(message, showRetry) {
    statusTextEl.textContent = message;
    retryBtn.hidden = !showRetry;
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
      callback(window._map);
    } else {
      setTimeout(function () {
        waitForMap(callback);
      }, 150);
    }
  }

  // Encuentra la fuente vectorial del mapa y las capas de esa fuente que
  // parecen contener nombres de vías, mirando el propio estilo cargado
  // (así funciona con cualquier estilo de MapTiler, no solo streets-v2).
  function detectRoadLayers(map) {
    const style = map.getStyle();
    if (!style) return;

    const vectorSourceIds = Object.keys(style.sources || {}).filter(function (id) {
      return style.sources[id].type === "vector";
    });
    if (vectorSourceIds.length === 0) return;

    vectorSourceId = vectorSourceIds[0];

    const layerNames = new Set();
    (style.layers || []).forEach(function (layer) {
      if (layer.source === vectorSourceId && layer["source-layer"]) {
        layerNames.add(layer["source-layer"]);
      }
    });

    const names = Array.from(layerNames);
    // Preferimos la capa "..._name" (líneas ya unidas por nombre, pensada
    // para etiquetar), y si no existe, cualquier capa de transporte/vías.
    const namedFirst = names.filter(function (n) { return /transportation.*name|road.*name|street.*name/i.test(n); });
    const others = names.filter(function (n) { return /transportation|road|street|highway/i.test(n) && namedFirst.indexOf(n) === -1; });
    candidateLayers = namedFirst.concat(others);
  }

  function isExcludedClass(props) {
    if (!props || !props.class) return false;
    return EXCLUDED_CLASSES.indexOf(props.class) !== -1;
  }

  function addSegment(byName, name, coords) {
    if (!name || coords.length < 2) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!byName.has(trimmed)) byName.set(trimmed, []);
    // Evita añadir el mismo tramo dos veces (los mosaicos vecinos se
    // solapan un poco y pueden repetir features).
    const segments = byName.get(trimmed);
    const key = JSON.stringify(coords);
    if (segments._seen && segments._seen.has(key)) return;
    if (!segments._seen) Object.defineProperty(segments, "_seen", { value: new Set(), enumerable: false });
    segments._seen.add(key);
    segments.push(coords);
  }

  // Lee las calles con nombre presentes en las teselas ya cargadas por el
  // mapa para la vista actual.
  function scanLoadedStreets(map) {
    if (!vectorSourceId || candidateLayers.length === 0) return new Map();

    const byName = new Map();

    candidateLayers.forEach(function (layerName) {
      let features;
      try {
        features = map.querySourceFeatures(vectorSourceId, { sourceLayer: layerName });
      } catch (err) {
        features = [];
      }

      features.forEach(function (feature) {
        const props = feature.properties || {};
        if (!props.name) return;
        if (isExcludedClass(props)) return;
        if (!feature.geometry) return;

        if (feature.geometry.type === "LineString") {
          addSegment(byName, props.name, feature.geometry.coordinates);
        } else if (feature.geometry.type === "MultiLineString") {
          feature.geometry.coordinates.forEach(function (coords) {
            addSegment(byName, props.name, coords);
          });
        }
      });
    });

    return byName;
  }

  function mergeStreets(into, additions) {
    let addedNew = false;
    additions.forEach(function (segments, name) {
      if (!into.has(name)) {
        into.set(name, []);
        addedNew = true;
      }
      const target = into.get(name);
      segments.forEach(function (coords) {
        target.push(coords);
      });
    });
    return addedNew;
  }

  function ensureHighlightLayers(map) {
    if (map.getSource(HIGHLIGHT_SOURCE_ID)) return;

    map.addSource(HIGHLIGHT_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    });

    map.addLayer({
      id: HIGHLIGHT_CASING_LAYER_ID,
      type: "line",
      source: HIGHLIGHT_SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 }
    });

    map.addLayer({
      id: HIGHLIGHT_LAYER_ID,
      type: "line",
      source: HIGHLIGHT_SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#d9581f", "line-width": 5, "line-opacity": 1 }
    });
  }

  function clearHighlight(map) {
    const source = map.getSource(HIGHLIGHT_SOURCE_ID);
    if (source) source.setData({ type: "FeatureCollection", features: [] });
  }

  function highlightStreet(map, name) {
    const segments = streetsByName.get(name) || [];
    const features = segments.map(function (coords) {
      return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
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

  function startQuizIfNeeded(map) {
    if (quizStarted || streetsByName.size === 0) return;
    quizStarted = true;
    buildQuizOrder();
    showQuiz();
    goToStreet(map, 0);
  }

  // Se llama cada vez que el mapa termina de cargar teselas (al inicio y
  // tras mover/hacer zoom): añade cualquier calle nueva que aparezca en la
  // vista actual al conjunto de preguntas, sin reiniciar el progreso.
  function refresh(map) {
    const found = scanLoadedStreets(map);

    if (!quizStarted) {
      if (found.size === 0) {
        setStatus("No se encontraron calles con nombre en la vista actual del mapa. Mueve o aleja el mapa e inténtalo de nuevo.", true);
        return;
      }
      streetsByName = found;
      startQuizIfNeeded(map);
      return;
    }

    const addedNew = mergeStreets(streetsByName, found);
    if (addedNew) {
      const known = new Set(quizOrder);
      const newNames = Array.from(streetsByName.keys()).filter(function (n) { return !known.has(n); });
      // Las calles nuevas se añaden barajadas al final de la ronda actual,
      // así aparecerán sin interrumpir la calle que se esté preguntando.
      quizOrder = quizOrder.concat(shuffle(newNames));
      if (currentIndex >= 0) {
        progressEl.textContent = (currentIndex + 1) + " / " + quizOrder.length;
      }
    }
  }

  function init() {
    waitForMap(function (map) {
      ensureHighlightLayers(map);
      setStatus("Cargando calles…", false);

      const onIdle = function () {
        detectRoadLayers(map);
        refresh(map);
      };

      if (map.loaded()) {
        onIdle();
      }
      map.on("idle", onIdle);

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

      retryBtn.addEventListener("click", function () {
        setStatus("Buscando calles en la vista actual…", false);
        onIdle();
      });
    });
  }

  init();
})();
