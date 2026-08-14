import { useEffect } from 'react'

// ---------------------------------------------------------------------------
// Título, descripción y tarjeta para cuando alguien comparte un link.
//
// Cuidado con lo que esto sí hace y lo que no:
//
//   Sí  — el título de la pestaña, y lo que ve Google después de ejecutar el
//         JavaScript de la página.
//   No  — la tarjeta que arma WhatsApp, Facebook o X. Esos no ejecutan nada:
//         piden el HTML, leen las etiquetas que vienen del servidor y se van.
//
// Como la distribución de este producto es "comparte el link", esa segunda
// parte hay que resolverla en el servidor. Ver REQUISITOS.md.
// ---------------------------------------------------------------------------

const etiqueta = (clave, valor, contenido) => {
  if (!contenido) return
  let el = document.head.querySelector(`meta[${clave}="${valor}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(clave, valor)
    document.head.appendChild(el)
  }
  el.setAttribute('content', contenido)
}

const canonica = (href) => {
  let el = document.head.querySelector('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

export function useMeta({ titulo, descripcion, tipo = 'website' } = {}) {
  useEffect(() => {
    if (!titulo) return
    document.title = `${titulo} · Sebel`
    etiqueta('name', 'description', descripcion)
    etiqueta('property', 'og:title', titulo)
    etiqueta('property', 'og:description', descripcion)
    etiqueta('property', 'og:type', tipo)
    etiqueta('property', 'og:site_name', 'Sebel')
    etiqueta('property', 'og:url', location.href)
    etiqueta('name', 'twitter:card', 'summary')
    canonica(location.href)
  }, [titulo, descripcion, tipo])
}

/**
 * Datos estructurados (schema.org). Es lo que permite que un buscador muestre
 * el resultado de un partido en la propia página de resultados, con el
 * marcador, en vez de un enlace azul más.
 */
export function useDatosEstructurados(objeto) {
  useEffect(() => {
    if (!objeto) return
    const el = document.createElement('script')
    el.type = 'application/ld+json'
    el.textContent = JSON.stringify(objeto)
    document.head.appendChild(el)
    return () => el.remove()
  }, [JSON.stringify(objeto)])
}

export function partidoComoEvento({ partido, liga, cancha, local, visita, golesLocal, golesVisita }) {
  if (!partido || !liga) return null
  const deporte = liga.deporte === 'baloncesto' ? 'Baloncesto' : 'Fútbol sala'

  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${local?.nombre} vs ${visita?.nombre}`,
    description: `${deporte} · ${liga.nombre}`,
    startDate: partido.inicio,
    eventStatus:
      partido.estado === 'final'
        ? 'https://schema.org/EventScheduled'
        : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url: location.href,
    location: cancha && {
      '@type': 'Place',
      name: cancha.nombre,
      address: {
        '@type': 'PostalAddress',
        addressLocality: cancha.barrio,
        addressRegion: cancha.provincia,
        addressCountry: cancha.pais,
      },
      geo: { '@type': 'GeoCoordinates', latitude: cancha.lat, longitude: cancha.lng },
    },
    competitor: [local, visita].filter(Boolean).map((eq) => ({
      '@type': 'SportsTeam',
      name: eq.nombre,
    })),
    ...(partido.estado === 'final' && {
      homeTeam: { '@type': 'SportsTeam', name: local?.nombre },
      awayTeam: { '@type': 'SportsTeam', name: visita?.nombre },
      result: {
        '@type': 'Thing',
        name: `${golesLocal}-${golesVisita}`,
      },
    }),
  }
}
