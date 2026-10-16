// ---------------------------------------------------------------------------
// Modo compartido: la compilación que se publica en el dominio, con el servidor como autoridad.
//
//   VITE_MODO_COMPARTIDO=1  → modo compartido.
//   (sin definir)           → el prototipo local de siempre, sin ningún cambio.
//
// En modo compartido NADA local concede permisos (ni el botón "Soy organizador", ni un rol guardado en IndexedDB),
// no se siembran datos de demostración y las pantallas del prototipo no se montan: lo público dirá "en preparación"
// hasta que las lecturas públicas vengan del servidor. Se lee en cada llamada para que las pruebas puedan fijarlo.
// ---------------------------------------------------------------------------

export const modoCompartido = () => import.meta.env.VITE_MODO_COMPARTIDO === '1'
