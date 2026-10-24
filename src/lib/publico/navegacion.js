// ---------------------------------------------------------------------------
// Navegación ÚNICA de la aplicación (pestañas y rutas): la define este módulo y la usan el prototipo (App.jsx, ui.jsx) y el modo
// compartido (AppCompartida.jsx). Es una lista de datos, sin base local ni sesión, para que no haya dos que se desincronicen.
// ---------------------------------------------------------------------------

export const TABS = [
  { id: 'inicio', to: '/', label: 'Inicio' },
  { id: 'ligas', to: '/ligas', label: 'Mis ligas', organizador: true },
  { id: 'siguiendo', to: '/siguiendo', label: 'Siguiendo' },
  { id: 'saldo', to: '/saldo', label: 'Saldo', organizador: true },
]

export const iconosTab = {
  inicio: 'M4 11.5L12 4l8 7.5M6 10v10h12V10',
  ligas: 'M4 5h16M4 12h16M4 19h10',
  siguiendo: 'M12 20.5s-7-4.6-7-9.6a4 4 0 017-2.6 4 4 0 017 2.6c0 5-7 9.6-7 9.6z',
  saldo: 'M3 8h18v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm0 0l2.4-4h13.2L21 8M7 14h4',
}

/** En modo compartido no llevan barra de pestañas: el partido (pantalla de marcador), el control del teléfono, el panel del organizador y la entrada /tv del piloto (REPORT_186). */
export const SIN_TABS_COMPARTIDO = [/^\/liga\/[^/]+\/partido\//, /^\/control\//, /^\/anthony(\/|$)/, /^\/organizador(\/|$)/, /^\/tv(\/cancha)?\/?$/, /^\/ayuda\/arbitro\/?$/]

/**
 * Rutas ORIGINALES del prototipo que todavía no tienen servidor detrás. En modo compartido NO se montan sus pantallas (usan la base
 * local) y cada una responde con un aviso explícito, nunca con un flujo local. `nombre` es lo que ve quien llega.
 */
export const RUTAS_NO_DISPONIBLES = Object.freeze([
  { ruta: '/siguiendo', nombre: 'Siguiendo' },
  { ruta: '/saldo', nombre: 'Saldo' },
  { ruta: '/nueva', nombre: 'Crear una liga' },
  { ruta: '/canchas', nombre: 'Canchas' },
  { ruta: '/figuras', nombre: 'Figuras del barrio' },
  { ruta: '/noticias', nombre: 'Noticias' },
  { ruta: '/n/:slug', nombre: 'Noticias' },
  { ruta: '/cat/:deporte/:categoria', nombre: 'Categorías en otros países' },
  { ruta: '/r/:slug', nombre: 'Retos' },
  { ruta: '/l/:slug', nombre: 'Esta liga' },
  { ruta: '/l/:slug/retar', nombre: 'Retar a otro equipo' },
  { ruta: '/p/:slug', nombre: 'Este partido' },
  { ruta: '/p/:slug/consola', nombre: 'La consola de puntuación local' },
  { ruta: '/e/:slug', nombre: 'Este equipo' },
  { ruta: '/j/:slug', nombre: 'Jugadores' },
  { ruta: '/c/:slug', nombre: 'Canchas' },
  { ruta: '/b/:codigo', nombre: 'El código corto de partido' },
])
