// Sustituciones/adiciones de geometría de calles, para tramos cuya forma o
// extensión real en el mapa está desactualizada respecto a lo que traen las
// teselas de OpenStreetMap (calles nuevas, tramos alargados/acortados,
// trazados mal dibujados, etc.).
//
// A diferencia de street-corrections.js (que solo renombra un tramo ya
// existente), esto sustituye o añade la GEOMETRÍA completa: se dibuja con el
// editor "Editar geometría de una calle" de la barra lateral y se pega aquí
// el bloque que genera el botón "Copiar código para el repositorio".
//
// mode: "replace" (por defecto) borra todos los tramos que hubiera para ese
// nombre y los sustituye por "coords". "add" conserva lo que ya hubiera y
// añade "coords" como un tramo más (útil si el mapa ya tiene bien una parte
// de la calle y solo falta un trozo).

window.STREET_OVERRIDES = [
  // Ejemplo:
  // {
  //   name: "Avenida Llanos del Pretorio",
  //   mode: "replace",
  //   coords: [[-4.7852, 37.9051], [-4.7845, 37.9058], [-4.7838, 37.9066]]
  // }
];

(function () {
  "use strict";

  function applyStreetOverrides(byName) {
    const overrides = window.STREET_OVERRIDES || [];
    overrides.forEach(function (o) {
      if (!o || !o.name || !Array.isArray(o.coords) || o.coords.length < 2) return;
      if (o.mode === "add") {
        if (!byName.has(o.name)) byName.set(o.name, []);
        byName.get(o.name).push(o.coords);
      } else {
        byName.set(o.name, [o.coords]);
      }
    });
  }

  window.applyStreetOverrides = applyStreetOverrides;
})();
