(function () {
  "use strict";

  // Herramienta de depuración: al activarla, un clic en el mapa busca el
  // tramo de calle más cercano (entre los ya cargados por streets.js),
  // muestra su nombre actual y genera una plantilla de "regla de corrección"
  // lista para copiar y pegar en js/street-corrections.js.

  const DEBUG_SOURCE_ID = "street-debug-source";
  const DEBUG_LAYER_ID = "street-debug-layer";
  const MAX_DISTANCE_DEG = 0.01; // ~1 km, umbral para descartar clics lejos de cualquier tramo

  let active = false;
  let clickHandler = null;

  const toggleBtn = document.getElementById("debug-toggle-btn");
  const resultEl = document.getElementById("debug-result");
  const copyBtn = document.getElementById("debug-copy-btn");

  let lastFound = null;

  function distSqPointToSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (dx === 0 && dy === 0) {
      const ddx = p[0] - a[0], ddy = p[1] - a[1];
      return ddx * ddx + ddy * ddy;
    }
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    const cx = a[0] + t * dx, cy = a[1] + t * dy;
    const ddx = p[0] - cx, ddy = p[1] - cy;
    return ddx * ddx + ddy * ddy;
  }

  function findNearestStreet(lngLat) {
    if (!window.CallejeroQuiz) return null;
    const all = window.CallejeroQuiz.getAllStreets();
    if (!all) return null;

    let best = null;
    let bestDistSq = Infinity;

    all.forEach(function (segments, name) {
      segments.forEach(function (coords) {
        for (let i = 0; i < coords.length - 1; i++) {
          const d = distSqPointToSegment([lngLat.lng, lngLat.lat], coords[i], coords[i + 1]);
          if (d < bestDistSq) {
            bestDistSq = d;
            best = { name: name, coords: coords };
          }
        }
      });
    });

    if (!best || bestDistSq > MAX_DISTANCE_DEG * MAX_DISTANCE_DEG) return null;
    return best;
  }

  function bboxOf(coords) {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    coords.forEach(function (pt) {
      minLng = Math.min(minLng, pt[0]);
      maxLng = Math.max(maxLng, pt[0]);
      minLat = Math.min(minLat, pt[1]);
      maxLat = Math.max(maxLat, pt[1]);
    });
    // Un pequeño margen para no perder el tramo por redondeos.
    const margin = 0.0003;
    return [
      Number((minLng - margin).toFixed(6)),
      Number((minLat - margin).toFixed(6)),
      Number((maxLng + margin).toFixed(6)),
      Number((maxLat + margin).toFixed(6))
    ];
  }

  function ensureDebugLayer(map) {
    if (map.getSource(DEBUG_SOURCE_ID)) return;
    map.addSource(DEBUG_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: DEBUG_LAYER_ID,
      type: "line",
      source: DEBUG_SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#2ecc71", "line-width": 7, "line-opacity": 0.95 }
    });
  }

  function showFoundSegment(map, found) {
    const source = map.getSource(DEBUG_SOURCE_ID);
    source.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: found.coords } }]
    });
  }

  function clearFoundSegment(map) {
    const source = map.getSource(DEBUG_SOURCE_ID);
    if (source) source.setData({ type: "FeatureCollection", features: [] });
  }

  function onMapClick(e) {
    const map = window.CallejeroQuiz.getMap();
    const found = findNearestStreet(e.lngLat);

    if (!found) {
      lastFound = null;
      resultEl.textContent = "No se ha detectado ningún tramo cerca de ese punto. Prueba a hacer zoom o clicar justo sobre la línea de la calle.";
      copyBtn.hidden = true;
      clearFoundSegment(map);
      return;
    }

    lastFound = found;
    showFoundSegment(map, found);
    resultEl.innerHTML =
      "Nombre actual en el mapa: <strong>" + found.name + "</strong><br>" +
      "Tramo resaltado en verde. Si es el tramo correcto, pulsa \"Copiar regla de corrección\" " +
      "y pégala en <code>js/street-corrections.js</code>, cambiando <code>newName</code> por el nombre correcto.";
    copyBtn.hidden = false;
  }

  function buildRuleText(found) {
    const bbox = bboxOf(found.coords);
    return "{\n" +
      "  matchName: \"" + found.name.replace(/"/g, '\\"') + "\",\n" +
      "  bbox: [" + bbox.join(", ") + "],\n" +
      "  newName: \"NOMBRE CORRECTO AQUÍ\"\n" +
      "}";
  }

  function copyRule() {
    if (!lastFound) return;
    const text = buildRuleText(lastFound);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        resultEl.innerHTML += "<br><em>Regla copiada al portapapeles.</em>";
      }, function () {
        resultEl.innerHTML += "<br><em>No se pudo copiar automáticamente, aquí tienes el texto:</em><pre>" +
          text.replace(/</g, "&lt;") + "</pre>";
      });
    } else {
      resultEl.innerHTML += "<br><pre>" + text.replace(/</g, "&lt;") + "</pre>";
    }
  }

  function setActive(map, value) {
    active = value;
    toggleBtn.setAttribute("aria-pressed", String(active));
    toggleBtn.textContent = active
      ? "Desactivar identificación (clic en el mapa)"
      : "Identificar calle (clic en el mapa)";
    map.getCanvas().style.cursor = active ? "crosshair" : "";
    resultEl.hidden = !active;
    copyBtn.hidden = true;
    if (!active) clearFoundSegment(map);
  }

  function init() {
    if (!toggleBtn) return;
    if (!window.CallejeroQuiz) return;

    const map = window.CallejeroQuiz.getMap();
    if (!map) {
      // El mapa puede tardar un poco en existir; reintenta.
      setTimeout(init, 200);
      return;
    }

    if (map.loaded()) {
      ensureDebugLayer(map);
    } else {
      map.once("load", function () { ensureDebugLayer(map); });
    }

    clickHandler = function (e) { onMapClick(e); };

    toggleBtn.addEventListener("click", function () {
      setActive(map, !active);
      if (active) {
        map.on("click", clickHandler);
      } else {
        map.off("click", clickHandler);
      }
    });

    copyBtn.addEventListener("click", copyRule);
  }

  init();
})();
