// ---------------------------------------------------------------------------
// Cómo llegar a la cancha.
//
// La dirección escrita no basta: muchas canchas de barrio no tienen número ni
// aparecen con su nombre en un buscador. Por eso se navega por coordenadas,
// que es lo único que siempre funciona.
//
// Waze primero, que es lo que se usa para manejar en Panamá; Google Maps
// también, que es lo que se usa para mirar dónde queda.
// ---------------------------------------------------------------------------

export const tieneUbicacion = (cancha) =>
  typeof cancha?.lat === 'number' && typeof cancha?.lng === 'number'

export const urlWaze = (cancha) =>
  `https://waze.com/ul?ll=${cancha.lat}%2C${cancha.lng}&navigate=yes`

export const urlGoogleMaps = (cancha) =>
  `https://www.google.com/maps/dir/?api=1&destination=${cancha.lat}%2C${cancha.lng}`

/** Para mirar el sitio sin arrancar una navegación. */
export const urlMapa = (cancha) =>
  `https://www.google.com/maps/search/?api=1&query=${cancha.lat}%2C${cancha.lng}`
