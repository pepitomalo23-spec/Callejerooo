// Configuración del proyecto.
//
// Usamos OpenFreeMap (https://openfreemap.org) como proveedor de teselas:
// es gratuito, no requiere API key y no tiene límite de peticiones para
// este tipo de uso. Antes usábamos una API key de MapTiler embebida aquí,
// pero las claves gratuitas de MapTiler tienen cuota/dominios limitados y
// eso es lo que estaba haciendo que el mapa no cargara en producción.
//
// Si en algún momento quieres volver a MapTiler (o a otro proveedor),
// solo hay que cambiar MAP_STYLE_URL por la URL de su style.json.
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
