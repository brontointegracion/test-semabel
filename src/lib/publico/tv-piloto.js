// ---------------------------------------------------------------------------
// Entrada corta /tv del PILOTO (REPORT_186). TEMPORAL: un selector público de partidos para abrir el marcador existente en un
// televisor durante las pruebas de punta a punta. NO es el módulo continuo de televisión del organizador.
//
// El destino del piloto vive SOLO aquí. Para retirarla o reemplazarla (ver backend/README.md, «Temporary /tv entrance»):
//   1. borrar este archivo, pantallas/publico/TvPiloto.jsx (y su prueba) y la ruta «/tv» de AppCompartida.jsx;
//   2. quitar «/tv» de SIN_TABS_COMPARTIDO (lib/publico/navegacion.js) y de PERMITIDAS (lib/volver.js);
//   3. quitar la liga de VITE_LIGAS_PUBLICAS y de LIGAS_ADMITIDAS si ya no se usa.
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
