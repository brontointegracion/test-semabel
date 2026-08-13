import { db } from '../db'

// ---------------------------------------------------------------------------
// El sitio se restringe al país de quien mira. Se detecta por IP; si eso falla
// (sin red, bloqueador, service worker sin conexión) se cae a la zona horaria
// del dispositivo, que acierta casi siempre y no depende de nadie.
//
// La detección se guarda una vez. No se vuelve a preguntar en cada carga.
// ---------------------------------------------------------------------------

export const PAISES = {
  PA: 'Panamá', CO: 'Colombia', MX: 'México', PE: 'Perú', CL: 'Chile',
  AR: 'Argentina', BR: 'Brasil', CR: 'Costa Rica', GT: 'Guatemala',
  DO: 'República Dominicana', VE: 'Venezuela', EC: 'Ecuador', BO: 'Bolivia',
  PY: 'Paraguay', UY: 'Uruguay', HN: 'Honduras', NI: 'Nicaragua',
  SV: 'El Salvador', CU: 'Cuba', PR: 'Puerto Rico', ES: 'España', US: 'Estados Unidos',
}

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

export async function cambiarPais(pais) {
  const actual = (await db.meta.get('region')) || { id: 'region' }
  await db.meta.put({ ...actual, id: 'region', pais, provincia: 'todas', detectadoPor: 'manual' })
}

export async function cambiarProvincia(provincia) {
  const actual = (await db.meta.get('region')) || { id: 'region', pais: 'PA' }
  await db.meta.put({ ...actual, id: 'region', provincia })
}
