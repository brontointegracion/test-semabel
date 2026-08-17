// ---------------------------------------------------------------------------
// La cabecera HTML que el servidor tiene que devolver.
//
// WhatsApp, Facebook y X no ejecutan JavaScript: piden el HTML, leen estas
// etiquetas y se van. Como este producto se reparte compartiendo links, la
// tarjeta que arman ES el marketing — y hoy, con la app entera en el navegador,
// todos los partidos compartidos se ven iguales y no dicen nada.
//
// Este archivo es la mitad que sí se puede escribir ahora y que no cambia
// cuando exista el servidor: dado un partido, devuelve exactamente las
// etiquetas a emitir. El servidor solo tendrá que llamarlo y pegar el
// resultado en el <head>.
//
// No depende de la base ni del navegador, así que se prueba en Node.
// ---------------------------------------------------------------------------

const escapar = (t = '') =>
  String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const meta = (clave, valor, contenido) =>
  contenido ? `<meta ${clave}="${valor}" content="${escapar(contenido)}">` : null

const FECHA = { day: 'numeric', month: 'long', year: 'numeric' }

/**
 * Título y descripción de un partido, con el marcador si ya terminó.
 * Es lo que se lee en la tarjeta de WhatsApp antes de tocar el link.
 */
export function textosDePartido({ partido, liga, cancha, local, visita, golesLocal, golesVisita }) {
  const fecha = new Date(partido.inicio).toLocaleDateString('es-PA', FECHA)
  const hora = new Date(partido.inicio).toLocaleTimeString('es-PA', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })

  if (partido.estado === 'final') {
    return {
      titulo: `${local?.nombre} ${golesLocal}-${golesVisita} ${visita?.nombre}`,
      descripcion:
        `Resultado del ${fecha} en ${cancha?.nombre}. ${liga?.nombre}` +
        (liga?.categoria && liga.categoria !== 'Libre' ? `, categoría ${liga.categoria}` : '') + '.',
    }
  }

  if (partido.estado === 'vivo') {
    return {
      titulo: `EN VIVO: ${local?.nombre} ${golesLocal}-${golesVisita} ${visita?.nombre}`,
      descripcion: `Se está jugando ahora en ${cancha?.nombre}. ${liga?.nombre}.`,
    }
  }

  return {
    titulo: `${local?.nombre} vs ${visita?.nombre}`,
    descripcion:
      `Juegan el ${fecha} a las ${hora} en ${cancha?.nombre}. ${liga?.nombre}` +
      (liga?.categoria && liga.categoria !== 'Libre' ? `, categoría ${liga.categoria}` : '') + '.',
  }
}

/**
 * Las etiquetas completas, listas para el <head>.
 *
 * `imagen` es la tarjeta con el marcador dibujado: es lo que convierte un
 * reenvío en asistencia a la cancha, y es lo único de aquí que necesita algo
 * más que texto.
 */
export function cabeceraDePartido({ url, imagen, ...datos }) {
  const { titulo, descripcion } = textosDePartido(datos)

  return [
    `<title>${escapar(titulo)} · Sebel</title>`,
    meta('name', 'description', descripcion),
    meta('property', 'og:type', 'article'),
    meta('property', 'og:site_name', 'Sebel'),
    meta('property', 'og:title', titulo),
    meta('property', 'og:description', descripcion),
    meta('property', 'og:url', url),
    meta('property', 'og:locale', 'es_PA'),
    imagen && meta('property', 'og:image', imagen),
    imagen && meta('property', 'og:image:width', '1200'),
    imagen && meta('property', 'og:image:height', '630'),
    meta('name', 'twitter:card', imagen ? 'summary_large_image' : 'summary'),
    `<link rel="canonical" href="${escapar(url)}">`,
  ].filter(Boolean).join('\n')
}
