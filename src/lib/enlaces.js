// ---------------------------------------------------------------------------
// Direcciones.
//
// El id interno (9w57etyp) no le dice nada a nadie y no se puede leer en voz
// alta. Un link se comparte por WhatsApp, se lee antes de tocarlo y a veces se
// dicta. Así que cada dirección lleva nombre y termina en un código corto:
//
//   /p/halcones-vs-titanes-2026-08-14-7531
//   /l/liga-barrial-san-miguelito-4821
//   /j/luis-carrasco-3092
//   /b/7531                        ← para escribir con el control del televisor
//
// El código es la identidad; el nombre es solo para quien lee. Si el nombre no
// coincide —porque un equipo se renombró— el código sigue encontrando la cosa,
// y la app corrige la dirección sola. Los links viejos nunca se rompen.
// ---------------------------------------------------------------------------

export function slug(texto = '') {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // fuera acentos
    .replace(/ñ/gi, 'n')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
}

/** El código es lo que va al final: "halcones-vs-titanes-7531" → "7531". */
export function codigoDe(parametro = '') {
  const m = String(parametro).match(/(\d{3,})$/)
  return m ? m[1] : String(parametro)
}

// Sin fecha no se inventa nada: mejor una dirección más corta que una con
// "undefined" dentro.
const fechaDe = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : '')

const arma = (prefijo, nombre, codigo) => `/${prefijo}/${slug(nombre)}-${codigo}`

export const urlLiga = (liga) =>
  liga ? arma('l', liga.nombre, liga.codigo) : '/'

// Con la fecha, porque los mismos dos equipos se cruzan varias veces por
// temporada: sin ella, dos partidos distintos tendrían el mismo nombre en la
// dirección y quien busca no sabría cuál está abriendo.
export const urlPartido = (partido, local, visita) =>
  partido
    ? arma(
        'p',
        `${local?.nombre || ''} vs ${visita?.nombre || ''} ${fechaDe(partido.inicio)}`,
        partido.codigo,
      )
    : '/'

export const urlJugador = (jugador) =>
  jugador ? arma('j', jugador.nombre, jugador.codigo) : '/'

export const urlCancha = (cancha) =>
  cancha ? arma('c', cancha.nombre, cancha.codigo) : '/'

export const urlNoticia = (noticia) =>
  noticia ? arma('n', noticia.titulo, noticia.codigo) : '/'

/** La que se escribe en un televisor: corta y solo números. */
export const urlTele = (partido) => `/b/${partido?.codigo}`
