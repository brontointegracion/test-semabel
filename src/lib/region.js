import { db } from '../db'

// ---------------------------------------------------------------------------
// El sitio se restringe al país de quien mira. Se detecta por IP; si eso falla
// (sin red, bloqueador, service worker sin conexión) se cae a la zona horaria
// del dispositivo, que acierta casi siempre y no depende de nadie.
//
// El país no se muestra ni se puede cambiar: nadie —invitado, organizador o
// dueño de cancha— elige qué país ve. La detección se guarda una vez y no se
// vuelve a preguntar.
// ---------------------------------------------------------------------------

const POR_ZONA = {
  'America/Panama': 'PA',
  'America/Bogota': 'CO',
  'America/Mexico_City': 'MX', 'America/Monterrey': 'MX', 'America/Tijuana': 'MX',
  'America/Lima': 'PE',
  'America/Santiago': 'CL',
  'America/Sao_Paulo': 'BR', 'America/Bahia': 'BR', 'America/Fortaleza': 'BR',
  'America/Costa_Rica': 'CR',
  'America/Guatemala': 'GT',
  'America/Santo_Domingo': 'DO',
  'America/Caracas': 'VE',
  'America/Guayaquil': 'EC',
  'America/La_Paz': 'BO',
  'America/Asuncion': 'PY',
  'America/Montevideo': 'UY',
  'America/Tegucigalpa': 'HN',
  'America/Managua': 'NI',
  'America/El_Salvador': 'SV',
  'America/Havana': 'CU',
  'America/Puerto_Rico': 'PR',
  'Europe/Madrid': 'ES',
}

function porZonaHoraria() {
  try {
    const zona = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (POR_ZONA[zona]) return POR_ZONA[zona]
    if (zona?.startsWith('America/Argentina')) return 'AR'
    if (zona?.startsWith('America/')) return 'US'
  } catch { /* sin Intl */ }
  return null
}

async function porIP(msLimite = 2500) {
  const corta = new AbortController()
  const t = setTimeout(() => corta.abort(), msLimite)
  try {
    const r = await fetch('https://ipwho.is/?fields=country_code', { signal: corta.signal })
    const j = await r.json()
    return j?.country_code || null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/** País de quien mira. Se resuelve una sola vez y queda guardado. */
export async function resolverRegion() {
  const guardada = await db.meta.get('region')
  if (guardada?.pais) return guardada

  let pais = await porIP()
  let detectadoPor = 'ip'

  if (!pais) { pais = porZonaHoraria(); detectadoPor = 'zona horaria' }
  if (!pais) { pais = 'PA'; detectadoPor = 'predeterminado' }

  const region = {
    id: 'region',
    pais,
    provincia: 'todas',
    detectadoPor,
    resueltoEn: new Date().toISOString(),
  }
  await db.meta.put(region)
  return region
}

export async function cambiarProvincia(provincia) {
  const actual = (await db.meta.get('region')) || { id: 'region', pais: 'PA' }
  await db.meta.put({ ...actual, id: 'region', provincia })
}

/** La categoría —40+, 45+— también se recuerda: es quién eres, no un filtro pasajero. */
export async function cambiarCategoria(categoria) {
  const actual = (await db.meta.get('region')) || { id: 'region', pais: 'PA' }
  await db.meta.put({ ...actual, id: 'region', categoria })
}

/**
 * El deporte se recuerda igual que la provincia. Quien viene por el baloncesto
 * vuelve al baloncesto: no tiene que volver a elegirlo cada vez que abre.
 */
export async function cambiarDeporte(deporte) {
  const actual = (await db.meta.get('region')) || { id: 'region', pais: 'PA' }
  await db.meta.put({ ...actual, id: 'region', deporte })
}
