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
  const unlocatedHintEl = document.getElementById("unlocated-hint");
  const mapsFallbackLinkEl = document.getElementById("maps-fallback-link");

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

  // Mismo criterio de normalización que street-registry.js (duplicado a
  // propósito: este fichero no depende de que street-registry.js ya se
  // haya cargado, ya que streets.js se carga antes en index.html).
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

  // Calles del Callejero Fiscal (window.OFFICIAL_STREETS, ver
  // official-streets.js) que todavía no tienen ningún tramo en
  // streetsByName. Se recalcula cada vez que se llama, así que siempre
  // refleja el estado actual: si una calle "sin localizar" aparece más
  // tarde en OSM (escaneo en vivo o próxima ejecución mensual de la
  // Action), deja de aparecer aquí sola, sin tocar código.
  function getOfficialOnlyStreetNames() {
    if (!window.OFFICIAL_STREETS) return [];
    const knownNormalized = new Set();
    streetsByName.forEach(function (_segments, name) {
      knownNormalized.add(normalizeName(name));
    });
    const seen = new Set();
    const result = [];
    window.OFFICIAL_STREETS.forEach(function (o) {
      const norm = normalizeName(o.nombre);
      if (knownNormalized.has(norm) || seen.has(norm)) return;
      seen.add(norm);
      result.push(o.nombre);
    });
    return result;
  }

  // Busca los tramos de una calle por nombre exacto y, si no hay, por
  // nombre normalizado (para que una calle preguntada con el nombre
  // oficial ("Avenida de Cádiz") encuentre sus tramos aunque OSM los
  // tenga con una grafía ligeramente distinta ("Avda. de Cádiz")).
  function findSegmentsByAnyName(name) {
    if (streetsByName.has(name)) return streetsByName.get(name);
    const norm = normalizeName(name);
    let found = null;
    streetsByName.forEach(function (segments, key) {
      if (!found && normalizeName(key) === norm) found = segments;
    });
    return found;
  }

  function buildGoogleMapsSearchUrl(name) {
    const query = name + ", Córdoba, España";
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
  }

  function showUnlocatedFallback(name) {
    if (!unlocatedHintEl || !mapsFallbackLinkEl) return;
    mapsFallbackLinkEl.href = buildGoogleMapsSearchUrl(name);
    unlocatedHintEl.hidden = false;
  }

  function hideUnlocatedFallback() {
    if (!unlocatedHintEl) return;
    unlocatedHintEl.hidden = true;
  }

  // Espera a que exista el mapa Y a que su estilo/teselas iniciales hayan
  // terminado de cargar. Antes solo se comprobaba que window._map existiera,
  // pero esa variable se crea justo al instanciar el mapa (antes de que el
  // estilo termine de cargar); intentar añadir capas en ese momento hace que
  // MapLibre lance un error ("Style is not done loading") que dejaba este
  // script parado para siempre en "Cargando calles…".
  function waitForMap(callback) {
    if (window._map) {
      const map = window._map;
      if (map.loaded()) {
        callback(map);
      } else {
        map.once("load", function () {
          callback(map);
        });
      }
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
    let trimmed = name.trim();
    if (!trimmed) return;
    if (window.applyStreetCorrections) {
      trimmed = window.applyStreetCorrections(trimmed, coords);
    }
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
    const segments = findSegmentsByAnyName(name);

    // Calle oficial sin geometría todavía: no hay nada que resaltar en
    // nuestro mapa. En vez de fallar o dejarlo en blanco, se ofrece un
    // enlace a Google Maps para poder localizarla igualmente.
    if (!segments || segments.length === 0) {
      clearHighlight(map);
      showUnlocatedFallback(name);
      return;
    }

    hideUnlocatedFallback();

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
    const knownNames = Array.from(streetsByName.keys());
    const officialOnly = getOfficialOnlyStreetNames();
    quizOrder = shuffle(knownNames.concat(officialOnly));
  }

  function goToStreet(map, index) {
    currentIndex = index;
    currentName = quizOrder[currentIndex];
    streetNameEl.textContent = currentName;
    progressEl.textContent = (currentIndex + 1) + " / " + quizOrder.length;
    clearHighlight(map);
    hideUnlocatedFallback();
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

  // Fusiona "found" (nombre -> tramos) dentro del estado del quiz, venga de
  // donde venga: del escaneo en vivo de teselas (refresh) o de la geometría
  // completa precalculada (loadStaticGeometry). Antes esta lógica estaba
  // duplicada entre el arranque y las actualizaciones; unificarla es lo que
  // permite que cualquiera de las dos fuentes pueda ser la primera en
  // arrancar el quiz, sin pisarse entre ellas.
  function incorporateStreets(map, found) {
    if (!found || found.size === 0) return false;

    if (!quizStarted) {
      mergeStreets(streetsByName, found);
      startQuizIfNeeded(map);
      document.dispatchEvent(new CustomEvent("callejero:streets-updated"));
      return true;
    }

    const addedNew = mergeStreets(streetsByName, found);
    if (addedNew) {
      // Comparamos por nombre NORMALIZADO, no literal: una calle ya podía
      // estar en la ronda con su nombre oficial ("Avenida de Cádiz", sin
      // geometría todavía) y ahora llegar desde OSM con una grafía algo
      // distinta ("Avda. de Cádiz"). Si comparásemos el texto tal cual,
      // se colaría un duplicado; con el nombre normalizado, esa calle
      // sencillamente pasa a tener geometría (se "autocorrige" sola la
      // próxima vez que se resuelva) en vez de aparecer dos veces.
      const knownNormalized = new Set(quizOrder.map(normalizeName));
      const newNames = Array.from(streetsByName.keys()).filter(function (n) {
        return !knownNormalized.has(normalizeName(n));
      });
      // Las calles nuevas se añaden barajadas al final de la ronda actual,
      // así aparecerán sin interrumpir la calle que se esté preguntando.
      quizOrder = quizOrder.concat(shuffle(newNames));
      if (currentIndex >= 0) {
        progressEl.textContent = (currentIndex + 1) + " / " + quizOrder.length;
      }
      document.dispatchEvent(new CustomEvent("callejero:streets-updated"));
    }
    return addedNew;
  }

  // Se llama cada vez que el mapa termina de cargar teselas (al inicio y
  // tras mover/hacer zoom): añade cualquier calle nueva que aparezca en la
  // vista actual al conjunto de preguntas, sin reiniciar el progreso. Esto
  // ahora es solo una red de seguridad (calles que OSM tenga pero que la
  // geometría precalculada aún no incluya); la fuente principal es
  // loadStaticGeometry, ver init().
  function refresh(map) {
    const found = scanLoadedStreets(map);
    if (window.applyStreetOverrides) window.applyStreetOverrides(found);

    const changed = incorporateStreets(map, found);

    if (!quizStarted && !changed && streetsByName.size === 0) {
      setStatus("No se encontraron calles con nombre en la vista actual del mapa. Mueve o aleja el mapa e inténtalo de nuevo.", true);
    }
  }

  // Carga (una vez) la geometría completa precalculada por
  // scripts/fetch-overpass-streets.mjs y la incorpora al quiz. Es
  // independiente del escaneo de teselas: puede llegar antes o después de
  // que el mapa esté listo, en cualquier orden.
  function loadStaticGeometry(map) {
    if (!window.CallejeroStaticGeometry) return;
    window.CallejeroStaticGeometry.load().then(function (staticStreets) {
      incorporateStreets(map, staticStreets);
    });
  }

  // API mínima para que otros scripts (comparador con el Callejero Fiscal)
  // puedan leer qué calles ha detectado ya el mapa, sin duplicar el escaneo
  // de teselas vectoriales que hace este archivo.
  window.CallejeroQuiz = {
    getStreetNames: function () {
      return Array.from(streetsByName.keys());
    },
    getAllStreets: function () {
      return streetsByName;
    },
    getMap: function () {
      return window._map || null;
    }
  };

  function init() {
    waitForMap(function (map) {
      try {
        ensureHighlightLayers(map);
        setStatus("Cargando calles…", false);

        // Fuente principal: geometría completa precalculada (no depende de
        // por dónde haya movido el usuario el mapa). Va en paralelo al
        // escaneo de teselas de abajo; la primera que responda arranca el
        // quiz, la otra solo añade lo que le falte.
        loadStaticGeometry(map);

        const onIdle = function () {
          try {
            detectRoadLayers(map);
            refresh(map);
          } catch (err) {
            console.error("[Callejero] Error buscando calles:", err);
            setStatus("Error buscando calles: " + err.message, true);
          }
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
      } catch (err) {
        console.error("[Callejero] Error inicializando el quiz:", err);
        setStatus("Error inicializando el quiz: " + err.message, true);
      }
    });
  }

  init();
})();
