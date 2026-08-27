(function () {
  "use strict";

  // Editor de geometría: permite dibujar o corregir el trazado exacto de una
  // calle a base de puntos que se pueden añadir con un clic y arrastrar con
  // precisión, en vez de depender solo de renombrar el tramo que detecta el
  // mapa. El resultado se puede previsualizar al instante (solo en esta
  // sesión) y copiar como código para guardarlo de forma permanente en
  // js/street-overrides.js.

  const DRAFT_SOURCE_ID = "street-editor-draft-source";
  const DRAFT_LAYER_ID = "street-editor-draft-layer";

  const toggleBtn = document.getElementById("editor-toggle-btn");
  const panelEl = document.getElementById("editor-panel");
  const selectEl = document.getElementById("editor-street-select");
  const nameRowEl = document.getElementById("editor-name-row");
  const nameInputEl = document.getElementById("editor-name-input");
  const undoBtn = document.getElementById("editor-undo-btn");
  const clearBtn = document.getElementById("editor-clear-btn");
  const modeAddCheckbox = document.getElementById("editor-mode-add");
  const applyBtn = document.getElementById("editor-apply-btn");
  const copyBtn = document.getElementById("editor-copy-btn");
  const statusEl = document.getElementById("editor-status");

  let active = false;
  let map = null;
  let draftCoords = [];
  let markers = [];
  let clickHandler = null;

  function currentName() {
    if (selectEl.value === "__new__") return nameInputEl.value.trim();
    return selectEl.value;
  }

  function ensureDraftLayer() {
    if (map.getSource(DRAFT_SOURCE_ID)) return;
    map.addSource(DRAFT_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: DRAFT_LAYER_ID,
      type: "line",
      source: DRAFT_SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#f1c40f", "line-width": 5, "line-dasharray": [2, 1], "line-opacity": 0.95 }
    });
  }

  function redrawLine() {
    const source = map.getSource(DRAFT_SOURCE_ID);
    if (!source) return;
    const features = draftCoords.length >= 2
      ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: draftCoords } }]
      : [];
    source.setData({ type: "FeatureCollection", features: features });
  }

  function clearMarkers() {
    markers.forEach(function (m) { m.remove(); });
    markers = [];
  }

  function rebuildMarkers() {
    clearMarkers();
    draftCoords.forEach(function (coord, index) {
      const el = document.createElement("div");
      el.className = "editor-vertex";
      el.title = "Punto " + (index + 1) + " — arrástralo para ajustarlo";

      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat(coord)
        .addTo(map);

      marker.on("drag", function () {
        const ll = marker.getLngLat();
        draftCoords[index] = [ll.lng, ll.lat];
        redrawLine();
      });

      markers.push(marker);
    });
  }

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function refreshStreetOptions() {
    const currentValue = selectEl.value;
    const names = window.CallejeroQuiz ? window.CallejeroQuiz.getStreetNames().slice().sort(function (a, b) {
      return a.localeCompare(b, "es");
    }) : [];

    selectEl.innerHTML = "";
    const newOpt = document.createElement("option");
    newOpt.value = "__new__";
    newOpt.textContent = "+ Calle nueva (escribir nombre)";
    selectEl.appendChild(newOpt);

    names.forEach(function (name) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      selectEl.appendChild(opt);
    });

    if (names.indexOf(currentValue) !== -1 || currentValue === "__new__") {
      selectEl.value = currentValue;
    } else {
      selectEl.value = "__new__";
    }
    nameRowEl.hidden = selectEl.value !== "__new__";
  }

  function loadExistingStreet(name) {
    if (!window.CallejeroQuiz) return;
    const all = window.CallejeroQuiz.getAllStreets();
    const segments = all.get(name) || [];
    if (segments.length === 0) {
      draftCoords = [];
      setStatus("Esa calle no tiene ningún tramo cargado todavía en el mapa.");
    } else {
      // Si hay varios tramos (calle partida en varios fragmentos por OSM),
      // se carga el más largo como punto de partida para poder unificarlos
      // en un único trazado limpio.
      let longest = segments[0];
      segments.forEach(function (s) { if (s.length > longest.length) longest = s; });
      draftCoords = longest.map(function (c) { return [c[0], c[1]]; });
      if (segments.length > 1) {
        setStatus("Esta calle tiene " + segments.length + " tramos en el mapa; se ha cargado el más largo (" +
          longest.length + " puntos) para que lo ajustes. Al guardar en modo \"sustituir\" quedará como un único tramo.");
      } else {
        setStatus("Tramo cargado (" + longest.length + " puntos). Arrastra los puntos o añade nuevos con clic.");
      }
    }
    rebuildMarkers();
    redrawLine();
  }

  function onMapClick(e) {
    draftCoords.push([e.lngLat.lng, e.lngLat.lat]);
    rebuildMarkers();
    redrawLine();
  }

  function onSelectChange() {
    nameRowEl.hidden = selectEl.value !== "__new__";
    draftCoords = [];
    if (selectEl.value !== "__new__") {
      loadExistingStreet(selectEl.value);
    } else {
      clearMarkers();
      redrawLine();
      setStatus("Escribe el nombre de la calle y haz clic en el mapa para trazarla, punto a punto.");
    }
  }

  function undoLast() {
    draftCoords.pop();
    rebuildMarkers();
    redrawLine();
  }

  function clearDraft() {
    draftCoords = [];
    clearMarkers();
    redrawLine();
    setStatus("Trazado vaciado.");
  }

  function currentOverride() {
    const name = currentName();
    if (!name) {
      setStatus("Falta el nombre de la calle.");
      return null;
    }
    if (draftCoords.length < 2) {
      setStatus("Necesitas al menos 2 puntos para formar un tramo.");
      return null;
    }
    return {
      name: name,
      mode: modeAddCheckbox.checked ? "add" : "replace",
      coords: draftCoords.map(function (c) { return [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))]; })
    };
  }

  function applyPreview() {
    const override = currentOverride();
    if (!override) return;
    window.STREET_OVERRIDES = (window.STREET_OVERRIDES || []).concat([override]);
    document.dispatchEvent(new CustomEvent("callejero:streets-updated"));
    // Fuerza un refresco inmediato del escaneo para que se note el cambio ya.
    map.fire("idle");
    setStatus("Aplicado en esta sesión: \"" + override.name + "\" (" + override.mode + ", " +
      override.coords.length + " puntos). Recuerda copiar el código para que el cambio sea permanente.");
    refreshStreetOptions();
  }

  function buildCodeSnippet(override) {
    return "{\n" +
      "  name: \"" + override.name.replace(/"/g, '\\"') + "\",\n" +
      "  mode: \"" + override.mode + "\",\n" +
      "  coords: " + JSON.stringify(override.coords) + "\n" +
      "}";
  }

  function copyCode() {
    const override = currentOverride();
    if (!override) return;
    const text = buildCodeSnippet(override);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        setStatus("Código copiado al portapapeles. Pégalo dentro del array de js/street-overrides.js.");
      }, function () {
        setStatus("No se pudo copiar automáticamente:");
        showCodeFallback(text);
      });
    } else {
      setStatus("Copia este bloque a mano:");
      showCodeFallback(text);
    }
  }

  function showCodeFallback(text) {
    const pre = document.createElement("pre");
    pre.textContent = text;
    statusEl.appendChild(document.createElement("br"));
    statusEl.appendChild(pre);
  }

  function setActive(value) {
    active = value;
    toggleBtn.setAttribute("aria-pressed", String(active));
    toggleBtn.textContent = active ? "Cerrar editor de geometría" : "Editar geometría de una calle";
    panelEl.hidden = !active;
    map.getCanvas().style.cursor = active ? "copy" : "";

    if (active) {
      refreshStreetOptions();
      onSelectChange();
      map.on("click", clickHandler);
    } else {
      map.off("click", clickHandler);
      draftCoords = [];
      clearMarkers();
      redrawLine();
    }
  }

  function init() {
    if (!toggleBtn) return;
    if (!window.CallejeroQuiz) {
      setTimeout(init, 200);
      return;
    }
    map = window.CallejeroQuiz.getMap();
    if (!map) {
      setTimeout(init, 200);
      return;
    }

    if (map.loaded()) {
      ensureDraftLayer();
    } else {
      map.once("load", ensureDraftLayer);
    }

    clickHandler = onMapClick;

    toggleBtn.addEventListener("click", function () { setActive(!active); });
    selectEl.addEventListener("change", onSelectChange);
    undoBtn.addEventListener("click", undoLast);
    clearBtn.addEventListener("click", clearDraft);
    applyBtn.addEventListener("click", applyPreview);
    copyBtn.addEventListener("click", copyCode);
  }

  init();
})();
