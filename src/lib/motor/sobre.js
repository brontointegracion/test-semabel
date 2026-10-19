import { OBSERVADO_REQUERIDO, REQUIERE_RESTANTE_VISTO, TIPOS } from './tipos'

// ---------------------------------------------------------------------------
// El sobre: la forma exacta en que una orden viaja del teléfono al servidor.
// Se genera UNA vez, se guarda tal cual y se reenvía idéntico en cada reintento.
// Aquí solo se valida su forma y se obtiene su contenido canónico; ni la
// autorización ni el almacenamiento viven en este archivo.
//
//   cmdId          Identidad única de una intención de la persona. Dos toques
//                  intencionales tienen dos cmdId; un reintento reutiliza el suyo.
//   gameId         Partido.
//   deviceId       Credencial que el adaptador ya autorizó para ese partido.
//   clientSeq      1, 2, 3… consecutivo por partido y dispositivo.
//   tipo, datos    Qué se pide.
//   accionTs       Hora de acción (ya ajustada) estimada por el teléfono.
//   accionTsCrudo  La hora antes del ajuste; ajusteTsMs = accionTs − accionTsCrudo.
//   discontinuidad null o { saltoMs, causa? } si el teléfono detectó un salto
//                  entre su reloj de pared y su reloj monótono.
//   observado      Lo que el teléfono veía (ver OBSERVADO_REQUERIDO).
//   restanteVistoMs Tiempo restante que el teléfono calculó a accionTs.
//   atribucionVersion Versión del contexto de atribución con que el teléfono validó un
//                  punto o una falta (null en las demás órdenes).
//   preparacionVersion Versión del contexto de preparación (preparacion.js) que el teléfono
//                  tenía al pedir el inicio del partido. SOLO 'iniciar-partido' puede llevarla y
//                  es OPCIONAL: un sobre sin ella sigue siendo válido (así un reintento de una
//                  orden ya aceptada antes de existir este campo devuelve su recibo original). Cuando
//                  falta, la clave se OMITE del sobre normalizado —no se escribe null—, porque el
//                  contenido canónico de un sobre antiguo no debe cambiar. Que un inicio NUEVO la
//                  traiga lo exige procesador.js, no la validación.
//   reglasConfirmadas  Firma (reglas-categoria.js, firmaDeReglas) de las reglas de categoría que la persona veía al confirmar
//                  el inicio: 'ninguna' o la firma de unas reglas válidas. SOLO 'iniciar-partido', OPCIONAL por la misma
//                  razón que preparacionVersion (un sobre antiguo no cambia). Un inicio NUEVO cuyo partido tiene reglas la
//                  necesita y debe coincidir con las que el servidor fija (procesador.js).
//
// El sobre NO lleva ninguna credencial: quién es el dispositivo y de qué partido lo
// decide el adaptador con la credencial del transporte, no un campo que el cliente escribe.
// ---------------------------------------------------------------------------

const MAX_FECHA_MS = 8.64e15
const CAMPOS = [
  'cmdId', 'gameId', 'deviceId', 'clientSeq', 'tipo', 'datos', 'accionTs',
  'accionTsCrudo', 'ajusteTsMs', 'discontinuidad', 'observado', 'restanteVistoMs', 'atribucionVersion',
  'preparacionVersion', 'reglasConfirmadas',
]

const esEntero = (n) => Number.isSafeInteger(n)
const esTexto = (s) => typeof s === 'string' && s.length > 0 && s.length <= 200
const esFecha = (n) => esEntero(n) && Math.abs(n) <= MAX_FECHA_MS
const esPrimitivo = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)

/** JSON con claves ordenadas, para comparar contenidos sin depender del orden. */
export function canonico(valor) {
  if (valor === null) return 'null'
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`
  switch (typeof valor) {
    case 'number':
      if (!Number.isFinite(valor)) throw new Error('número no finito')
      return String(valor)
    case 'string':
    case 'boolean':
      return JSON.stringify(valor)
    case 'object':
      return `{${Object.keys(valor)
        .filter((k) => valor[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`)
        .join(',')}}`
    default:
      throw new Error(`valor no serializable: ${typeof valor}`)
  }
}

function validarDatos(tipo, datos, errores) {
  const d = datos ?? {}
  if (typeof d !== 'object' || Array.isArray(d)) { errores.push('datos'); return {} }
  const solo = (claves) => {
    for (const k of Object.keys(d)) if (!claves.includes(k)) errores.push(`datos.${k}`)
  }
  switch (tipo) {
    case 'anotar':
      solo(['equipoId', 'jugadorId', 'puntos'])
      if (!esTexto(d.equipoId)) errores.push('datos.equipoId')
      if (!(d.jugadorId === null || esTexto(d.jugadorId))) errores.push('datos.jugadorId')
      if (!esEntero(d.puntos) || d.puntos <= 0) errores.push('datos.puntos')
      return { equipoId: d.equipoId, jugadorId: d.jugadorId ?? null, puntos: d.puntos }
    case 'falta':
      solo(['equipoId', 'jugadorId'])
      if (!esTexto(d.equipoId)) errores.push('datos.equipoId')
      if (!(d.jugadorId === null || esTexto(d.jugadorId))) errores.push('datos.jugadorId')
      return { equipoId: d.equipoId, jugadorId: d.jugadorId ?? null }
    case 'anular-evento':
      solo(['eventoId'])
      if (!esTexto(d.eventoId)) errores.push('datos.eventoId')
      return { eventoId: d.eventoId }
    case 'corregir-reloj':
      solo(['restanteMs'])
      if (!esEntero(d.restanteMs) || d.restanteMs < 0) errores.push('datos.restanteMs')
      return { restanteMs: d.restanteMs }
    case 'parada-automatica':
      solo(['corridaSeq'])
      if (!(esEntero(d.corridaSeq) || esTexto(d.corridaSeq))) errores.push('datos.corridaSeq')
      return { corridaSeq: d.corridaSeq }
    default:
      solo([])
      return {}
  }
}

/** Valida y normaliza. Rechaza campos desconocidos: nada se descarta en silencio. */
export function validarSobre(crudo) {
  const errores = []
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) {
    return { ok: false, errores: ['sobre'] }
  }
  for (const k of Object.keys(crudo)) if (!CAMPOS.includes(k)) errores.push(`campo-desconocido:${k}`)

  if (!esTexto(crudo.cmdId)) errores.push('cmdId')
  if (!esTexto(crudo.gameId)) errores.push('gameId')
  if (!esTexto(crudo.deviceId)) errores.push('deviceId')
  if (!esEntero(crudo.clientSeq) || crudo.clientSeq < 1) errores.push('clientSeq')
  if (!Object.prototype.hasOwnProperty.call(TIPOS, crudo.tipo)) errores.push('tipo')
  if (!esFecha(crudo.accionTs)) errores.push('accionTs')

  const accionTsCrudo = crudo.accionTsCrudo ?? crudo.accionTs
  if (!esFecha(accionTsCrudo)) errores.push('accionTsCrudo')
  const ajusteEsperado = esEntero(crudo.accionTs) && esEntero(accionTsCrudo) ? crudo.accionTs - accionTsCrudo : null
  const ajusteTsMs = crudo.ajusteTsMs ?? ajusteEsperado
  if (ajusteEsperado === null || ajusteTsMs !== ajusteEsperado) errores.push('ajusteTsMs')

  const disc = crudo.discontinuidad ?? null
  if (disc !== null) {
    const bien = typeof disc === 'object' && !Array.isArray(disc)
      && Number.isFinite(disc.saltoMs)
      && (disc.causa === undefined || typeof disc.causa === 'string')
      && Object.keys(disc).every((k) => k === 'saltoMs' || k === 'causa')
    if (!bien) errores.push('discontinuidad')
  }

  const tipoValido = Object.prototype.hasOwnProperty.call(TIPOS, crudo.tipo)
  const datos = tipoValido ? validarDatos(crudo.tipo, crudo.datos, errores) : {}

  const observado = crudo.observado
  if (!observado || typeof observado !== 'object' || Array.isArray(observado)) {
    errores.push('observado')
  } else if (tipoValido) {
    for (const k of Object.keys(observado)) if (!esPrimitivo(observado[k])) errores.push(`observado.${k}`)
    for (const k of OBSERVADO_REQUERIDO[crudo.tipo]) {
      if (!(k in observado) || observado[k] === undefined) errores.push(`observado.${k}`)
    }
  }

  const atribucionVersion = crudo.atribucionVersion ?? null
  if (['anotar', 'falta'].includes(crudo.tipo)) {
    if (!(atribucionVersion === null || esTexto(atribucionVersion))) errores.push('atribucionVersion')
  } else if (atribucionVersion !== null) {
    errores.push('atribucionVersion')
  }

  // Opcional y solo en el inicio del partido. Ausente = undefined (la clave se omite al normalizar);
  // un null explícito no es "ausente": es un valor inválido.
  const { preparacionVersion } = crudo
  if (preparacionVersion !== undefined && (crudo.tipo !== 'iniciar-partido' || !esTexto(preparacionVersion))) {
    errores.push('preparacionVersion')
  }

  const { reglasConfirmadas } = crudo
  if (reglasConfirmadas !== undefined && (crudo.tipo !== 'iniciar-partido' || !esTexto(reglasConfirmadas))) {
    errores.push('reglasConfirmadas')
  }

  let restanteVistoMs = crudo.restanteVistoMs ?? null
  if (tipoValido && REQUIERE_RESTANTE_VISTO.has(crudo.tipo)) {
    if (!esEntero(restanteVistoMs) || restanteVistoMs < 0) errores.push('restanteVistoMs')
  } else if (restanteVistoMs !== null && (!esEntero(restanteVistoMs) || restanteVistoMs < 0)) {
    errores.push('restanteVistoMs')
  }

  // La parada automática tiene una identidad fija: la de la corrida que detiene.
  if (crudo.tipo === 'parada-automatica' && esTexto(crudo.gameId) && datos.corridaSeq !== undefined
    && crudo.cmdId !== `auto:${crudo.gameId}:${datos.corridaSeq}`) {
    errores.push('cmdId-de-parada-automatica')
  }

  if (errores.length) return { ok: false, errores }
  return {
    ok: true,
    sobre: {
      cmdId: crudo.cmdId,
      gameId: crudo.gameId,
      deviceId: crudo.deviceId,
      clientSeq: crudo.clientSeq,
      tipo: crudo.tipo,
      datos,
      accionTs: crudo.accionTs,
      accionTsCrudo,
      ajusteTsMs,
      discontinuidad: disc,
      observado: { ...observado },
      restanteVistoMs,
      atribucionVersion,
      ...(preparacionVersion === undefined ? {} : { preparacionVersion }),
      ...(reglasConfirmadas === undefined ? {} : { reglasConfirmadas }),
    },
  }
}

/** Contenido canónico de un sobre ya validado: lo que se compara en un reintento. */
export const contenidoCanonico = (sobre) => canonico(sobre)
