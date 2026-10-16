// ---------------------------------------------------------------------------
// Registros de ACTIVACIÓN del teléfono (modo compartido). Un registro por (liga, partido) en localStorage, con la
// identidad del teléfono (token + su hash) y el estado de la activación. NO es la cola de puntuación: esa vivirá en su
// propio almacén. Nada aquí toca la base del prototipo (Dexie) ni las claves del panel del organizador.
//
// LÍMITES DE LA APLICACIÓN (no una garantía de cuota del navegador, que puede ser menor o desalojar datos):
//   - un registro serializado: como máximo MAX_REGISTRO_BYTES bytes UTF-8;
//   - todas las claves y valores con este prefijo juntos: como máximo MAX_TOTAL_BYTES bytes UTF-8.
//   Se cuentan BYTES UTF-8 (clave + valor), nunca caracteres. No hay un tope fijo de partidos.
//
// Nada se borra ni se desaloja solo: ni por antigüedad, ni por cantidad, ni por un 401. Al llegar al tope se rechaza el
// registro NUEVO (y no se envía nada). Un registro nuevo reserva hasta MAX_REGISTRO_BYTES para poder terminar su activación;
// una actualización posterior que no cupiera se rechaza y deja el estado anterior.
// El token es un secreto del teléfono: no se muestra, no se registra y no se incluye en diagnósticos. localStorage no es un
// almacén protegido (quien inspeccione el dispositivo, o un script de este origen, puede leerlo) y se pierde si el
// navegador borra o desaloja los datos del sitio.
// ---------------------------------------------------------------------------

export const PREFIJO = 'sebel.ctl.act.v1:'
export const MAX_REGISTRO_BYTES = 2 * 1024
export const MAX_TOTAL_BYTES = 512 * 1024
export const ESTADOS = Object.freeze(['activando', 'incierta', 'activada', 'denegada'])

const ID = /^[A-Za-z0-9_-]{1,64}$/
const HEX64 = /^[0-9a-f]{64}$/
const RE_CLAVE = /^sebel\.ctl\.act\.v1:([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{1,64})$/
const CLAVES = ['v', 'ligaId', 'partidoId', 'token', 'tokenHash', 'estado', 'conIncierto', 'intentos', 'creadoEn', 'actualizadoEn', 'deviceId', 'servidor']
const CLAVES_SERVIDOR = ['ahoraMs', 'expiraEn', 'retornoHasta', 'leidoEn']

export const idValido = (v) => typeof v === 'string' && ID.test(v)
export const bytes = (texto) => new TextEncoder().encode(texto).length
export const clave = (ligaId, partidoId) => `${PREFIJO}${ligaId}:${partidoId}`

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const entero = (v) => Number.isSafeInteger(v) && v >= 0
const enteroONulo = (v) => v === null || entero(v)

function almacen() {
  try {
    const a = globalThis.localStorage
    return a && typeof a.getItem === 'function' ? a : null
  } catch {
    return null
  }
}

/** Valida la FORMA de un registro leído (texto). → registro | null. No lanza. */
export function validarRegistro(texto, ligaId, partidoId) {
  try {
    if (typeof texto !== 'string' || bytes(texto) > MAX_REGISTRO_BYTES) return null
    const r = JSON.parse(texto)
    if (!esObjeto(r)) return null
    const claves = Object.keys(r)
    if (claves.length !== CLAVES.length || !CLAVES.every((k) => claves.includes(k))) return null
    if (r.v !== 1 || r.ligaId !== ligaId || r.partidoId !== partidoId || !idValido(r.ligaId) || !idValido(r.partidoId)) return null
    if (!HEX64.test(r.token) || !HEX64.test(r.tokenHash)) return null
    if (!ESTADOS.includes(r.estado) || typeof r.conIncierto !== 'boolean') return null
    // Invariantes: lo resuelto no arrastra incertidumbre y lo incierto siempre la lleva.
    if ((r.estado === 'activada' || r.estado === 'denegada') && r.conIncierto !== false) return null
    if (r.estado === 'incierta' && r.conIncierto !== true) return null
    if (!Number.isSafeInteger(r.intentos) || r.intentos < 1 || !entero(r.creadoEn) || !entero(r.actualizadoEn)) return null
    if (!(r.deviceId === null || (typeof r.deviceId === 'string' && r.deviceId.length >= 1 && r.deviceId.length <= 200))) return null
    if (r.servidor !== null) {
      if (!esObjeto(r.servidor)) return null
      const ks = Object.keys(r.servidor)
      if (ks.length !== CLAVES_SERVIDOR.length || !CLAVES_SERVIDOR.every((k) => ks.includes(k))) return null
      if (!entero(r.servidor.ahoraMs) || !entero(r.servidor.leidoEn) || !enteroONulo(r.servidor.expiraEn) || !enteroONulo(r.servidor.retornoHasta)) return null
    }
    return r
  } catch {
    return null
  }
}

/** → { tipo: 'no-disponible' } | { tipo: 'ninguno' } | { tipo: 'corrupto' } | { tipo: 'valido', registro } */
export function leerRegistro(ligaId, partidoId) {
  const a = almacen()
  if (!a) return { tipo: 'no-disponible' }
  try {
    a.getItem(`${PREFIJO}__sonda`) // un almacenamiento vacío no basta para saber si se puede leer
    const texto = a.getItem(clave(ligaId, partidoId))
    if (texto === null) return { tipo: 'ninguno' }
    const registro = validarRegistro(texto, ligaId, partidoId)
    return registro ? { tipo: 'valido', registro } : { tipo: 'corrupto' }
  } catch {
    return { tipo: 'no-disponible' }
  }
}

/**
 * Todos los registros con este prefijo y su tamaño total en BYTES UTF-8 (claves + valores, también los ilegibles).
 * → { disponible, n, bytes, registros: [{ ligaId, partidoId, valido, registro? }] }
 */
export function listarRegistros() {
  const a = almacen()
  if (!a) return { disponible: false, n: 0, bytes: 0, registros: [] }
  const registros = []
  let n = 0
  let total = 0
  try {
    a.getItem(`${PREFIJO}__sonda`)
    for (let i = 0; i < a.length; i += 1) {
      const k = a.key(i)
      if (typeof k !== 'string' || !k.startsWith(PREFIJO)) continue
      const texto = a.getItem(k)
      n += 1
      total += bytes(k) + (typeof texto === 'string' ? bytes(texto) : 0)
      const m = RE_CLAVE.exec(k)
      if (!m) continue
      const registro = validarRegistro(texto, m[1], m[2])
      registros.push({ ligaId: m[1], partidoId: m[2], valido: registro !== null, ...(registro ? { registro } : {}) })
    }
  } catch {
    return { disponible: false, n: 0, bytes: 0, registros: [] }
  }
  return { disponible: true, n, bytes: total, registros }
}

/** Bytes UTF-8 de todas las claves y valores con este prefijo (sin interpretarlos). Lanza si el almacenamiento falla. */
function bytesTotales(a) {
  let total = 0
  for (let i = 0; i < a.length; i += 1) {
    const k = a.key(i)
    if (typeof k !== 'string' || !k.startsWith(PREFIJO)) continue
    const texto = a.getItem(k)
    total += bytes(k) + (typeof texto === 'string' ? bytes(texto) : 0)
  }
  return total
}

/**
 * Guarda y LEE DE VUELTA. → { ok: true } | { ok: false, motivo }
 *   crear = true   solo si la clave no existe ('existente' / 'corrupto' si ya hay algo)
 *   crear = false  solo si ya existe ('ausente' si no)
 * motivos: 'almacenamiento' | 'registro-demasiado-grande' | 'invalido' | 'capacidad' | 'existente' | 'corrupto' | 'ausente' | 'verificacion'
 * Si una creación no se puede verificar se retira SOLO esa escritura propia (nunca se envió nada con ella); si una
 * actualización no se puede verificar se restaura lo anterior.
 */
export function guardar(ligaId, partidoId, registro, { crear = false } = {}) {
  const a = almacen()
  if (!a) return { ok: false, motivo: 'almacenamiento' }
  const k = clave(ligaId, partidoId)
  let texto
  try { texto = JSON.stringify(registro) } catch { return { ok: false, motivo: 'almacenamiento' } }
  if (bytes(texto) > MAX_REGISTRO_BYTES) return { ok: false, motivo: 'registro-demasiado-grande' }
  if (validarRegistro(texto, ligaId, partidoId) === null) return { ok: false, motivo: 'invalido' }
  let anterior = null
  try {
    anterior = a.getItem(k)
    if (crear && anterior !== null) return { ok: false, motivo: validarRegistro(anterior, ligaId, partidoId) ? 'existente' : 'corrupto' }
    if (!crear && anterior === null) return { ok: false, motivo: 'ausente' }
    // Un registro NUEVO reserva su tamaño máximo (MAX_REGISTRO_BYTES): así la activación que acaba de empezar siempre puede
    // terminar de guardarse (activando → activada, con dispositivo y fechas) sin pasar del tope. Una actualización cuenta solo lo que crece.
    const necesario = anterior === null ? bytes(k) + MAX_REGISTRO_BYTES : bytes(texto) - bytes(anterior)
    if (bytesTotales(a) + necesario > MAX_TOTAL_BYTES) return { ok: false, motivo: 'capacidad' }
    a.setItem(k, texto)
    const leido = a.getItem(k)
    if (leido === texto && validarRegistro(leido, ligaId, partidoId) !== null) return { ok: true }
    try { if (anterior === null) a.removeItem(k); else a.setItem(k, anterior) } catch { /* se conserva lo que haya */ }
    return { ok: false, motivo: 'verificacion' }
  } catch {
    return { ok: false, motivo: 'almacenamiento' }
  }
}
