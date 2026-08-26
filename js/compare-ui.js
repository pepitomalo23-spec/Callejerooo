(function () {
  "use strict";

  // Puntos de la ciudad a los que el botón "Escanear más zonas" desplaza el
  // mapa, uno tras otro, esperando a que las teselas de cada zona terminen
  // de cargar antes de seguir. Así el comparador puede acumular calles de
  // toda la ciudad y no solo de la vista inicial (centro histórico).
  // Cobertura aproximada del núcleo urbano de Córdoba capital.
  const SCAN_POINTS = [
    { lng: -4.7794, lat: 37.8882, zoom: 14 }, // Centro / Judería
    { lng: -4.7580, lat: 37.8960, zoom: 14 }, // Levante / Zona Este
    { lng: -4.8050, lat: 37.8960, zoom: 14 }, // Ciudad Jardín / Noroeste
    { lng: -4.7794, lat: 37.9080, zoom: 14 }, // Norte / Fátima / Sector Sur inverso
    { lng: -4.7794, lat: 37.8720, zoom: 14 }, // Sur / Sector Sur
    { lng: -4.7350, lat: 37.8850, zoom: 13.5 }, // Poniente Este / Aeropuerto
    { lng: -4.8250, lat: 37.8850, zoom: 13.5 }, // Poniente / El Naranjo
    { lng: -4.7500, lat: 37.9150, zoom: 13.5 }, // Fuensanta / Levante Norte
    { lng: -4.7794, lat: 37.9250, zoom: 13.5 }, // Arruzafa / Norte extremo
    { lng: -4.8500, lat: 37.8950, zoom: 13 },   // Extremo Oeste
    { lng: -4.7100, lat: 37.8950, zoom: 13 },   // Extremo Este
    { lng: -4.7794, lat: 37.8600, zoom: 13 }    // Extremo Sur
  ];

  let scanning = false;

  const panelEl = document.getElementById("compare-panel");
  const toggleBtn = document.getElementById("compare-toggle-btn");
  const runBtn = document.getElementById("compare-run-btn");
  const scanBtn = document.getElementById("compare-scan-btn");
  const scanStatusEl = document.getElementById("compare-scan-status");
  const summaryEl = document.getElementById("compare-summary");
  const onlyOfficialEl = document.getElementById("compare-only-official");
  const onlyMapEl = document.getElementById("compare-only-map");
  const downloadBtn = document.getElementById("compare-download-btn");

  let lastResult = null;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderList(container, items, emptyMessage) {
    if (items.length === 0) {
      container.innerHTML = "<li class=\"compare-empty\">" + emptyMessage + "</li>";
      return;
    }
    const max = 400; // evita colgar el navegador si hay miles de discrepancias
    const shown = items.slice(0, max);
    container.innerHTML = shown.map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("");
    if (items.length > max) {
      const li = document.createElement("li");
      li.className = "compare-empty";
      li.textContent = "… y " + (items.length - max) + " más (descarga el CSV para verlas todas).";
      container.appendChild(li);
    }
  }

  function runComparison() {
    if (!window.CallejeroQuiz || !window.CallejeroCompare || !window.OFFICIAL_STREETS) {
      summaryEl.textContent = "El comparador todavía no está listo. Espera a que el mapa termine de cargar.";
      return;
    }

    const mapNames = window.CallejeroQuiz.getStreetNames();
    if (mapNames.length === 0) {
      summaryEl.textContent = "El mapa aún no ha detectado ninguna calle. Espera a que cargue o mueve el mapa.";
      return;
    }

    const result = window.CallejeroCompare.compare(mapNames, window.OFFICIAL_STREETS);
    lastResult = result;

    summaryEl.innerHTML =
      "Calles detectadas en el mapa (zona visitada): <strong>" + result.totalMap + "</strong><br>" +
      "Vías en el Callejero Fiscal 2026: <strong>" + result.totalOfficial + "</strong><br>" +
      "Coincidencias encontradas: <strong>" + result.matchedCount + "</strong><br>" +
      "Del callejero fiscal, sin encontrar en el mapa: <strong>" + result.onlyOfficial.length + "</strong><br>" +
      "En el mapa, sin encontrar en el callejero fiscal: <strong>" + result.onlyMap.length + "</strong>";

    renderList(
      onlyOfficialEl,
      result.onlyOfficial.map(function (e) { return e.tipo + " " + e.nombre; }),
      "Ninguna — todas las vías del callejero fiscal aparecen en la zona del mapa ya escaneada."
    );
    renderList(
      onlyMapEl,
      result.onlyMap,
      "Ninguna — todas las calles del mapa están en el callejero fiscal."
    );

    downloadBtn.hidden = false;
  }

  function flyToAndWaitIdle(map, point) {
    return new Promise(function (resolve) {
      const onIdle = function () {
        map.off("idle", onIdle);
        resolve();
      };
      map.on("idle", onIdle);
      map.jumpTo({ center: [point.lng, point.lat], zoom: point.zoom });
      // jumpTo es instantáneo; si el mapa ya estaba "idle" en ese punto
      // (teselas cacheadas), forzamos igualmente un margen de seguridad.
      setTimeout(function () {
        map.off("idle", onIdle);
        resolve();
      }, 4000);
    });
  }

  async function scanCity() {
    if (scanning) return;
    if (!window.CallejeroQuiz) return;
    const map = window.CallejeroQuiz.getMap();
    if (!map) return;

    scanning = true;
    scanBtn.disabled = true;
    const originalCenter = map.getCenter();
    const originalZoom = map.getZoom();

    for (let i = 0; i < SCAN_POINTS.length; i++) {
      scanStatusEl.textContent = "Escaneando zona " + (i + 1) + " / " + SCAN_POINTS.length + "…";
      // eslint-disable-next-line no-await-in-loop
      await flyToAndWaitIdle(map, SCAN_POINTS[i]);
    }

    map.jumpTo({ center: originalCenter, zoom: originalZoom });
    scanStatusEl.textContent = "Zonas escaneadas. Puedes comparar de nuevo para ver la cobertura ampliada.";
    scanBtn.disabled = false;
    scanning = false;
    runComparison();
  }

  function toCsv(result) {
    const rows = [["lista", "tipo", "nombre"]];
    result.onlyOfficial.forEach(function (e) {
      rows.push(["solo_callejero_fiscal", e.tipo, e.nombre]);
    });
    result.onlyMap.forEach(function (name) {
      rows.push(["solo_mapa", "", name]);
    });
    return rows.map(function (r) {
      return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\n");
  }

  function downloadCsv() {
    if (!lastResult) return;
    const csv = toCsv(lastResult);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "discrepancias-callejero.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function init() {
    if (!panelEl) return;

    toggleBtn.addEventListener("click", function () {
      const isHidden = panelEl.hasAttribute("hidden");
      if (isHidden) {
        panelEl.removeAttribute("hidden");
        toggleBtn.setAttribute("aria-expanded", "true");
      } else {
        panelEl.setAttribute("hidden", "");
        toggleBtn.setAttribute("aria-expanded", "false");
      }
    });

    runBtn.addEventListener("click", runComparison);
    scanBtn.addEventListener("click", scanCity);
    downloadBtn.addEventListener("click", downloadCsv);

    // Si el usuario ya tiene el panel abierto, refresca el resumen cada vez
    // que el mapa detecte calles nuevas mientras navega.
    document.addEventListener("callejero:streets-updated", function () {
      if (!panelEl.hasAttribute("hidden") && lastResult) {
        runComparison();
      }
    });
  }

  init();
})();
