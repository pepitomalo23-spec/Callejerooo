(function () {
  "use strict";

  // Coordenadas del centro histórico de Córdoba, España
  const CORDOBA_CENTER = [-4.7794, 37.8882]; // [lng, lat]
  const CORDOBA_ZOOM = 14;

  const loadingEl = document.getElementById("loading");
  const errorBanner = document.getElementById("error-banner");
  const errorDetail = document.getElementById("error-detail");

  function showError(message) {
    errorDetail.textContent = message;
    errorBanner.hidden = false;
    loadingEl.classList.add("hidden");
    console.error("[Mapa Córdoba]", message);
  }

  function hideLoading() {
    loadingEl.classList.add("hidden");
  }

  // Comprobación básica: si no hay URL de estilo configurada, avisamos claramente
  if (!MAP_STYLE_URL || MAP_STYLE_URL.trim() === "") {
    showError("Falta MAP_STYLE_URL en js/config.js.");
    return;
  }

  let map;
  try {
    map = new maplibregl.Map({
      container: "map",
      style: MAP_STYLE_URL,
      center: CORDOBA_CENTER,
      zoom: CORDOBA_ZOOM,
      // Todas estas opciones de interacción vienen activadas por defecto en MapLibre,
      // se listan explícitamente para dejar claro qué gestos están soportados:
      dragPan: true,           // arrastrar con ratón / dedo
      scrollZoom: true,        // zoom con rueda del ratón
      touchZoomRotate: true,   // pellizcar para zoom / rotar con dos dedos
      doubleClickZoom: true,   // doble clic / doble toque para zoom
      boxZoom: true,
      keyboard: true,
      dragRotate: true,
      attributionControl: true
    });
  } catch (err) {
    showError("No se pudo inicializar MapLibre GL JS: " + err.message);
    return;
  }

  // Controles de navegación (zoom +/- y brújula), visibles en escritorio y móvil
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

  // Control de geolocalización (opcional pero útil, no añade funcionalidades de "juego")
  map.addControl(
    new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
      showUserLocation: true
    }),
    "top-right"
  );

  // Asegura que el gesto táctil de dos dedos active el zoom/rotación sin
  // requerir Ctrl en ratón de escritorio (comportamiento por defecto de MapLibre)
  map.touchZoomRotate.enableRotation();

  map.on("load", function () {
    hideLoading();
  });

  // Si las teselas o el estilo fallan (clave inválida, sin conexión, etc.)
  map.on("error", function (e) {
    const err = e && e.error;
    let msg = "Error desconocido al cargar el mapa.";

    if (err && err.message) {
      msg = err.message;

      if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
        msg = "El servidor de mapas ha rechazado la petición (401 - no autorizado).";
      } else if (msg.includes("403")) {
        msg = "Acceso denegado por el servidor de mapas (403).";
      } else if (msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("networkerror")) {
        msg = "No se pudo conectar con el servidor de teselas del mapa. Revisa tu conexión a internet.";
      }
    }

    showError(msg);
  });

  // Reajusta el mapa si cambia el tamaño de la ventana (rotación de móvil, resize de escritorio)
  window.addEventListener("resize", function () {
    map.resize();
  });

  // Exponer el mapa en window para depuración manual desde la consola si hiciera falta
  window._map = map;
})();
