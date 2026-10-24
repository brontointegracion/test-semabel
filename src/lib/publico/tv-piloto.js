// ---------------------------------------------------------------------------
// Entrada corta /tv del PILOTO (REPORT_186). TEMPORAL: un selector público de partidos para abrir el marcador existente en un
// televisor durante las pruebas de punta a punta. NO es el módulo continuo de televisión del organizador.
//
// El destino del piloto vive SOLO aquí. Para retirarla o reemplazarla (ver backend/README.md, «Temporary /tv entrance»):
//   1. borrar este archivo, pantallas/publico/TvPiloto.jsx (y su prueba) y la ruta «/tv» de AppCompartida.jsx;
//   2. quitar «/tv» de SIN_TABS_COMPARTIDO (lib/publico/navegacion.js) y de PERMITIDAS (lib/volver.js);
//   3. quitar la liga de VITE_LIGAS_PUBLICAS y de LIGAS_ADMITIDAS si ya no se usa.
// (REPORT_221: con la liga FUERA de VITE_LIGAS_PUBLICAS pero todavía admitida en el servidor, /tv responde «no disponible»; el botón de /tv/cancha sale entonces a la portada.)
// O, para apuntar a otra liga de prueba, cambiar `ligaId` (debe estar también en VITE_LIGAS_PUBLICAS y en LIGAS_ADMITIDAS).
//
// Nada aquí concede permisos, selecciona partidos por la hora ni lee nada privado: solo dice QUÉ liga lista /tv.
// ---------------------------------------------------------------------------

export const RUTA_TV = '/tv'

// La transmisión continua de UNA cancha (REPORT_199) vive en tv-secuencia.js: su dirección estable es /tv/cancha y su configuración
// explícita, VITE_TV_SECUENCIA. Para retirarla: borrar tv-secuencia.js, pantallas/publico/TvCancha.jsx y la ruta de AppCompartida.jsx.
export const TV_PILOTO = Object.freeze({
  ligaId: 'SIMULACRO-PILOTO',
})

/**
 * ¿Existe la entrada /tv en ESTA compilación? Solo si la liga a la que está atada (TV_PILOTO.ligaId, la liga ficticia de pruebas) está en VITE_LIGAS_PUBLICAS; si no, /tv responde
 * «no disponible». (REPORT_221: el alcance del evento real publica solo las ligas reales, así que /tv no existe y nada del evento debe llevar hasta ella.)
 */
export const entradaTvDisponible = (idsLigas) => Array.isArray(idsLigas) && idsLigas.includes(TV_PILOTO.ligaId)

/** A dónde sale el botón de la transmisión /tv/cancha: a la lista /tv si existe en esta compilación; si no, a la portada (que lista los partidos reales y sus páginas públicas). */
export const salidaDeTvCancha = (idsLigas) => (entradaTvDisponible(idsLigas)
  ? { to: RUTA_TV, etiqueta: '‹ Partidos en TV' }
  : { to: '/', etiqueta: '‹ Inicio' })
