// Correcciones manuales para tramos de vía mal etiquetados en OpenStreetMap
// (el nombre real difiere del que traen las teselas). Cada regla renombra un
// tramo concreto SOLO si su geometría cae dentro del rectángulo indicado, así
// no afecta a otros tramos que compartan el mismo nombre "de origen".
//
// Cómo rellenar una regla:
// 1. Activa "Identificar calle (clic en el mapa)" en la barra lateral.
// 2. Haz clic sobre el tramo mal etiquetado (el que se resalta debe ser
//    justo ese tramo, no toda la avenida).
// 3. Copia el bloque que te ofrece el botón "Copiar regla de corrección" y
//    pégalo aquí abajo, dentro del array, ajustando "newName" al nombre
//    correcto.
//
// matchName: nombre EXACTO tal y como lo muestra hoy el mapa (el "malo").
// bbox: [minLng, minLat, maxLng, maxLat] — rectángulo que envuelve el tramo.
// newName: nombre correcto que debe mostrarse en su lugar.

window.STREET_CORRECTIONS = [
  // Ejemplo (desactivado hasta confirmar las coordenadas reales):
  // {
  //   matchName: "Avenida del Brillante",
  //   bbox: [-4.7850, 37.9040, -4.7800, 37.9070],
  //   newName: "Avenida Llanos del Pretorio"
  // }
];

(function () {
  "use strict";

  function segmentInBbox(coords, bbox) {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    return coords.every(function (pt) {
      const lng = pt[0], lat = pt[1];
      return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
    });
  }

  // Aplica las reglas de window.STREET_CORRECTIONS a un tramo. Devuelve el
  // nombre corregido, o el original si ninguna regla aplica.
  function applyStreetCorrections(name, coords) {
    const rules = window.STREET_CORRECTIONS || [];
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule.matchName === name && segmentInBbox(coords, rule.bbox)) {
        return rule.newName;
      }
    }
    return name;
  }

  window.applyStreetCorrections = applyStreetCorrections;
})();
