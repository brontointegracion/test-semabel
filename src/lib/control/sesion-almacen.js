import {
  LIMITES, compararInstantanea, evaluarRecibo, huellaDeRecibo, medirEntrada, medirSesion, prepararEncolado, prepararEnvio,
  actualizarVisualizacionDeSesion, prepararParadaDeTransporte, reanudarTrasNoAutorizado, reanudarTrasRechazo, refrescarAntesDelInicio, validarSesionYEntradas, vistaDe,
} from './sesion-motor'

// ---------------------------------------------------------------------------
// ALMACÉN DURABLE de la sesión de puntuación (IndexedDB «sebel-control-sesion»). Es una base SEPARADA: no toca la base del
// prototipo (Dexie «sebel»), ni el registro de activación (localStorage), ni lo del panel del organizador.
//
// Almacenes:
//   sesiones  una fila por partido (clave `ligaId:partidoId`): identidad, base derivada del servidor, cursores, contadores.
//   entradas  una fila por orden (clave [id, clientSeq]); el sobre INMUTABLE vive como TEXTO exacto (`cuerpoJson`) y es lo
//             único que se envía; el resto de la fila (estado, intentos, recibo recortado) es lo que cambia. Índice único
//             [id, cmdId]: ni siquiera un error de lógica puede guardar dos veces el mismo cmdId.
//   meta      la fila `totales` (bytes usados y reservados de TODAS las sesiones).
// El estado PROVISIONAL no se guarda: se deriva (sesion-motor.js → vistaDe).
//
// ATOMICIDAD. Cada operación es UNA transacción de lectura-escritura que lee lo necesario, llama a una función PURA
// síncrona del motor y emite las escrituras (`put`) de inmediato, sin esperar nada que no sea IndexedDB. Lo lento (hash,
// red, relojes) ocurre ANTES. Lo que la operación devuelve (el texto a enviar, la vista nueva, el número asignado) se
// entrega SOLO cuando la transacción terminó con éxito (`oncomplete`). Si se aborta —cuota, error, base cerrada, un gancho de
// prueba— no queda nada escrito, no se consumió ningún número y la persona no ve ni envía nada de esa acción.
//
// CONTABILIDAD (bytes UTF-8 del texto de las filas + una sobrecarga fija por fila; NO es la cuota real del navegador):
//   uso.bytes      lo que ocupa la sesión (fila + entradas);  uso.reservado  lo comprometido para registrar el resultado de
//   lo ya aceptado (recibo recortado, crecimiento de la base, marcar dependientes). Se actualizan en la MISMA transacción
//   que cada escritura, junto con `meta/totales`.
//   Admisión de una acción NUEVA (encolar), en TODAS las sesiones y no solo al crear:
//     bytes + reservado ≤ 4 MiB por partido; ≤ 1.200 comandos por partido; total (usado + reservado) ≤ 128 MiB.
//   Registrar un resultado (T3, T4, verificación, reanudar) NUNCA se rechaza por un límite de la aplicación. Si el
//   crecimiento real superara lo reservado se conserva el resultado, se marca `uso.sobreReserva` y se bloquean las acciones
//   nuevas: es una excepción visible, no una garantía de que el total jamás se supere. Una falla REAL de cuota del
//   navegador (QuotaExceededError) aborta la transacción: lo irresuelto se conserva y se informa.
//   Los límites son PROVISIONALES y no demuestran que toda partida quepa en el límite de lectura del servidor
//   (4.000 eventos / 1 MiB). Nada se borra ni se desaloja: ni historial confirmado, ni rechazadas, ni no-aplicadas.
//
// PRIVACIDAD. Solo ids, etiquetas ya públicas del partido y órdenes. El token NO se copia aquí (vive en el registro de
// activación). Ningún dato de contacto, fecha de nacimiento ni código.
// ---------------------------------------------------------------------------

export const NOMBRE_BD = 'sebel-control-sesion'
export const VERSION_BD = 1
export { LIMITES }

const aError = (e) => ({ nombre: e?.name ?? 'Error', mensaje: String(e?.message ?? e) })
const falloDeAlmacen = (op, e, escribio) => ({
  ok: false,
  motivo: 'almacenamiento',
  op,
  cuota: e?.name === 'QuotaExceededError',
  error: aError(e),
  // Si la transacción se abortó, NADA de ella quedó escrito (aunque `escribio` indique que se habían emitido escrituras).
  escrituraEmitida: Boolean(escribio),
})

/**
 * Abre (y crea si hace falta) la base. `gancho`, solo para pruebas, se llama en cada escritura y justo antes de confirmar:
 * puede lanzar para simular una falla (cuota, aborto). `indexedDB` es inyectable. `limites` solo se cambia en pruebas.
 */
export function abrirAlmacen({ indexedDB: fabrica = globalThis.indexedDB, nombre = NOMBRE_BD, gancho = null, limites = LIMITES } = {}) {
  return new Promise((resolver, rechazar) => {
    if (!fabrica) { rechazar(new Error('IndexedDB no disponible')); return }
    const peticion = fabrica.open(nombre, VERSION_BD)
    peticion.onupgradeneeded = () => {
      const db = peticion.result
      db.createObjectStore('sesiones', { keyPath: 'id' })
      const entradas = db.createObjectStore('entradas', { keyPath: ['id', 'clientSeq'] })
      entradas.createIndex('porId', 'id')
      entradas.createIndex('porCmd', ['id', 'cmdId'], { unique: true })
      db.createObjectStore('meta', { keyPath: 'clave' })
    }
    peticion.onerror = () => rechazar(peticion.error)
    peticion.onblocked = () => rechazar(new Error('apertura bloqueada'))
    peticion.onsuccess = () => {
      const db = peticion.result
      db.onversionchange = () => db.close()
      resolver({ db, gancho, limites, cerrar: () => db.close() })
    }
  })
}

// ---------------------------------------------------------------------------
// Una transacción, con callbacks (no hay `await` dentro: IndexedDB termina la transacción si el bucle de eventos queda libre).
// ---------------------------------------------------------------------------

function abrirTx(db, almacenes, modo) {
  try { return db.transaction(almacenes, modo, { durability: 'strict' }) } catch (e) {
    if (e?.name === 'TypeError' || e?.name === 'NotSupportedError') return db.transaction(almacenes, modo)
    throw e
  }
}

function transaccion(almacen, op, almacenes, modo, cuerpo) {
  return new Promise((resolver) => {
    let tx
    try { tx = abrirTx(almacen.db, almacenes, modo) } catch (e) { resolver(falloDeAlmacen(op, e, false)); return }
    let resultado = null
    let error = null
    let abortada = false
    let escrituras = 0
    const fallar = (e) => {
      if (error === null) error = e
      if (!abortada) { abortada = true; try { tx.abort() } catch { /* ya terminada */ } }
    }
    const t = {
      obtener(almacenNombre, clave, cb) {
        if (abortada) return
        try {
          const r = tx.objectStore(almacenNombre).get(clave)
          r.onsuccess = () => { if (!abortada) { try { cb(r.result) } catch (e) { fallar(e) } } }
        } catch (e) { fallar(e) }
      },
      todos(almacenNombre, indice, clave, cb) {
        if (abortada) return
        try {
          const r = tx.objectStore(almacenNombre).index(indice).getAll(clave)
          r.onsuccess = () => { if (!abortada) { try { cb(r.result) } catch (e) { fallar(e) } } }
        } catch (e) { fallar(e) }
      },
      poner(almacenNombre, valor) {
        if (abortada) return
        try {
          escrituras += 1
          almacen.gancho?.({ op, fase: 'escribir', almacen: almacenNombre, n: escrituras, valor })
          tx.objectStore(almacenNombre).put(valor)
        } catch (e) { fallar(e) }
      },
      /** Tras la ÚLTIMA escritura: lo que se devuelve cuando (y solo si) la transacción se confirma. */
      listo(res) {
        if (abortada) return
        try { almacen.gancho?.({ op, fase: 'antes-de-confirmar', n: escrituras }) } catch (e) { fallar(e); return }
        resultado = res
      },
      /** Sin escrituras: un rechazo de dominio o una lectura. */
      sinCambios(res) { resultado = res },
      escrituras: () => escrituras,
    }
    tx.oncomplete = () => resolver(abortada ? falloDeAlmacen(op, error, escrituras > 0) : (resultado ?? { ok: false, motivo: 'sin-resultado' }))
    tx.onabort = () => resolver(falloDeAlmacen(op, error ?? tx.error ?? new Error('transacción abortada'), escrituras > 0))
    tx.onerror = () => { if (error === null) error = tx.error }
    try { cuerpo(t) } catch (e) { fallar(e) }
  })
}

const ceroTotales = () => ({ clave: 'totales', bytes: 0, reservado: 0, sesiones: 0 })

/** Cuenta y límites para una acción NUEVA. `uso` es el actual; `nuevo` lo que quedaría. Puro. */
export function evaluarAdmision(uso, totales, nuevo, limites = LIMITES) {
  if (uso.sobreReserva) return { ok: false, motivo: 'sobre-reserva' }
  if (nuevo.comandos > limites.maxComandosPartido) return { ok: false, motivo: 'limite-comandos' }
  return evaluarCapacidad(uso, totales, nuevo, limites)
}

/**
 * Solo los dos topes de BYTES, contando lo usado MÁS lo reservado (las reservas de resultados pendientes ya comprometidos entran
 * en la cuenta): por partido y entre todas las sesiones. `uso`/`totales` son lo actual; `nuevo` lo que quedaría. Pura.
 * Los topes se alcanzan con igualdad exacta (un byte más se rechaza).
 */
export function evaluarCapacidad(uso, totales, nuevo, limites = LIMITES) {
  if (nuevo.bytes + nuevo.reservado > limites.maxBytesPartido) return { ok: false, motivo: 'limite-bytes-partido' }
  const total = totales.bytes + totales.reservado + (nuevo.bytes - uso.bytes) + (nuevo.reservado - uso.reservado)
  if (total > limites.maxBytesTotal) return { ok: false, motivo: 'limite-bytes-total' }
  return { ok: true }
}

const sumar = (filas, campo) => filas.reduce((s, f) => s + f[campo], 0)

// ---------------------------------------------------------------------------
// T1 — crear la sesión.
// ---------------------------------------------------------------------------

/** `sesion` = la fila que devuelve construirSesion. Se crea solo si no existe; reserva su espacio en los totales. */
export function crearSesion(almacen, sesion) {
  return transaccion(almacen, 'crear', ['sesiones', 'meta'], 'readwrite', (t) => {
    t.obtener('sesiones', sesion.id, (existente) => {
      if (existente) { t.sinCambios({ ok: false, motivo: 'ya-existe' }); return }
      t.obtener('meta', 'totales', (tot) => {
        const totales = tot ?? ceroTotales()
        const fila = { ...sesion, uso: { bytes: 0, comandos: 0, reservado: 0, sobreReserva: false } }
        fila.uso.bytes = medirSesion(fila)
        const adm = evaluarAdmision({ bytes: 0, reservado: 0, comandos: 0, sobreReserva: false }, totales, fila.uso, almacen.limites)
        if (!adm.ok) { t.sinCambios({ ok: false, motivo: adm.motivo }); return }
        const nuevosTotales = { ...totales, bytes: totales.bytes + fila.uso.bytes, sesiones: totales.sesiones + 1 }
        t.poner('sesiones', fila)
        t.poner('meta', nuevosTotales)
        t.listo({ ok: true, sesion: fila, vista: vistaDe(fila, []) })
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Operación genérica sobre una sesión existente (T2, T3, T4, verificación, reanudar).
// ---------------------------------------------------------------------------

/**
 * `calcular(sesion, entradas) → { tipo: 'ok', sesion, entradas: [filas cambiadas o nuevas], resultado }` o cualquier otro
 * `tipo` (nada se escribe y se devuelve `traducir(salida)`; una `divergencia` sí escribe la parada).
 * `modo`: 'admision' (acción nueva: se aplican los límites), 'resolucion' (registra un resultado: nunca se rechaza por
 * límites de la aplicación y vigila la reserva) o 'neutral'.
 */
function operar(almacen, { op, id, revision, modo, ctx, calcular, traducir }) {
  return transaccion(almacen, op, ['sesiones', 'entradas', 'meta'], 'readwrite', (t) => {
    t.obtener('sesiones', id, (fila) => {
      if (!fila) { t.sinCambios({ ok: false, motivo: 'sesion-inexistente' }); return }
      t.todos('entradas', 'porId', id, (filas) => {
        t.obtener('meta', 'totales', (tot) => {
          const valida = validarSesionYEntradas(fila, filas)
          if (!valida.ok) { t.sinCambios({ ok: false, motivo: 'registro-corrupto', detalle: valida.motivo }); return }
          if (revision !== undefined && fila.revision !== revision) {
            t.sinCambios({ ok: false, motivo: 'revision-desactualizada', actual: fila.revision, esperada: revision })
            return
          }
          const c = calcular(fila, filas)
          const esDivergencia = c.tipo === 'divergencia' && !c.yaRegistrada
          if (c.tipo !== 'ok' && c.tipo !== 'aplicar' && c.tipo !== 'verificada' && !esDivergencia) {
            t.sinCambios(traducir(c, fila, filas))
            return
          }

          // Contabilidad: se recalcula desde las filas finales (nada de deltas que se puedan desviar).
          const porSeq = new Map(filas.map((f) => [f.clientSeq, f]))
          for (const cambiada of c.entradas) porSeq.set(cambiada.clientSeq, cambiada)
          const finales = [...porSeq.values()].sort((a, b) => a.clientSeq - b.clientSeq)
          const cambiadas = c.entradas.map((f) => ({ ...f, bytes: medirEntrada(f) }))
          const finalesConBytes = finales.map((f) => cambiadas.find((x) => x.clientSeq === f.clientSeq) ?? f)
          const armar = (sesionBase) => {
            const n = { ...sesionBase, revision: fila.revision + 1 }
            return { nueva: n, nuevoUso: { bytes: medirSesion(n) + sumar(finalesConBytes, 'bytes'), comandos: finalesConBytes.length, reservado: sumar(finalesConBytes, 'reserva'), sobreReserva: fila.uso.sobreReserva } }
          }
          let { nueva, nuevoUso } = armar(c.sesion)
          const totales = tot ?? ceroTotales()
          let extraResultado = {}

          // Datos para mostrar que acompañan a una verificación: son información NUEVA que ocupa espacio. Si no caben (por partido o
          // entre sesiones, con las reservas incluidas) la verificación se registra IGUAL, sin ellos, y se dice que no se adoptaron.
          if (c.visualizacionNueva && !c.atribucionRefrescada && !c.comprobarCapacidad && modo !== 'admision') {
            const cap = evaluarCapacidad(fila.uso, totales, nuevoUso, almacen.limites)
            if (!cap.ok) {
              ;({ nueva, nuevoUso } = armar(c.sesionSinVisualizacion))
              extraResultado = { visualizacion: { estado: 'ok', adoptada: false, motivo: 'visualizacion-no-aplicada', causa: 'limite-de-almacenamiento', limite: cap.motivo } }
            } else extraResultado = { visualizacion: { estado: 'ok', adoptada: true } }
          } else if (c.visualizacion) {
            // Atribución + datos para mostrar viajan juntos: si se confirma la transacción, se adoptaron los dos.
            extraResultado = { visualizacion: { ...c.visualizacion, adoptada: c.visualizacionNueva === true } }
          }

          if (modo === 'admision') {
            const adm = evaluarAdmision(fila.uso, totales, nuevoUso, almacen.limites)
            if (!adm.ok) { t.sinCambios({ ok: false, motivo: adm.motivo }); return }
          } else if (modo === 'resolucion' && c.tipo === 'aplicar') {
            const crecimiento = nuevoUso.bytes - fila.uso.bytes
            const liberado = fila.uso.reservado - nuevoUso.reservado
            if (crecimiento > liberado) nuevoUso.sobreReserva = true
          } else if (c.atribucionRefrescada || c.comprobarCapacidad) {
            // El refresco de la atribución (y el de los datos para mostrar) es información NUEVA que ocupa espacio, no el resultado
            // de una orden ya aceptada: se comprueba contra los topes de bytes (con las reservas incluidas), en esta misma
            // transacción. Si no cabe, NO se escribe nada: ni sesión, ni entradas, ni totales. No es una divergencia del juego ni se
            // cuenta como adoptado.
            const cap = evaluarCapacidad(fila.uso, totales, nuevoUso, almacen.limites)
            if (!cap.ok) {
              const limite = almacen.limites ?? LIMITES
              t.sinCambios({
                ok: false,
                motivo: c.refresco === 'visualizacion' ? 'visualizacion-no-aplicada' : 'atribucion-no-aplicada',
                causa: 'limite-de-almacenamiento',
                limite: cap.motivo,
                adoptada: false,
                verificada: false,
                bytes: {
                  actualesSesion: fila.uso.bytes,
                  propuestosSesion: nuevoUso.bytes,
                  reservadosSesion: nuevoUso.reservado,
                  maximoPartido: limite.maxBytesPartido,
                  actualesTotal: totales.bytes + totales.reservado,
                  propuestosTotal: totales.bytes + totales.reservado + (nuevoUso.bytes - fila.uso.bytes) + (nuevoUso.reservado - fila.uso.reservado),
                  maximoTotal: limite.maxBytesTotal,
                },
              })
              return
            }
          }
          nueva.uso = nuevoUso
          const nuevosTotales = {
            ...totales,
            bytes: totales.bytes + (nuevoUso.bytes - fila.uso.bytes),
            reservado: totales.reservado + (nuevoUso.reservado - fila.uso.reservado),
          }

          t.poner('sesiones', nueva)
          for (const f of cambiadas) t.poner('entradas', f)
          t.poner('meta', nuevosTotales)
          const vista = vistaDe(nueva, finalesConBytes, ctx)
          t.listo(esDivergencia
            ? { ok: false, motivo: 'divergencia', causa: c.causa, vista }
            : { ok: true, ...c.resultado, ...extraResultado, sobreReserva: nuevoUso.sobreReserva, vista })
        })
      })
    })
  })
}

const rechazoDe = (c) => ({ ok: false, motivo: c.motivo ?? c.tipo, ...(c.detalle !== undefined ? { detalle: c.detalle } : {}), ...(c.rechazo ? { rechazo: c.rechazo } : {}), ...(c.divergencia ? { divergencia: c.divergencia } : {}) })

/**
 * T2 — encola una orden: asigna el número, guarda el sobre inmutable y reserva el espacio para su resultado, todo en UNA
 * transacción. `orden` lleva el cmdId y el tiempo ya calculados; `ctx = { ahoraEstimado, actorId?, enLinea? }`.
 * El sobre, el número y el estado provisional se entregan solo si la transacción se confirmó.
 */
export function encolar(almacen, { id, revision, orden, ctx }) {
  return operar(almacen, {
    op: 'encolar',
    id,
    revision,
    modo: 'admision',
    ctx,
    calcular: (sesion, entradas) => prepararEncolado(sesion, entradas, orden, ctx),
    traducir: (c) => (c.tipo === 'duplicada' ? { ok: true, duplicada: true, sobre: c.sobre } : rechazoDe(c)),
  })
}

/** T3 — marca la entrada como «enviando». Devuelve el texto EXACTO a enviar solo tras confirmar. */
export function marcarEnviando(almacen, { id, revision, cmdId, confirmadoPorOperador = false, ctx }) {
  return operar(almacen, {
    op: 'enviar',
    id,
    revision,
    modo: 'neutral',
    ctx,
    calcular: (sesion, entradas) => prepararEnvio(sesion, entradas, cmdId, { confirmadoPorOperador }),
    traducir: rechazoDe,
  })
}

/**
 * C1 — registra una parada DE TRANSPORTE contra la revisión actual de la sesión (ver el contrato en sesion-motor.js).
 * `parada = { clase, subtipo?, http?, cmdId? }` (listas cerradas). Una sola transacción: la fila de sesión crece unos cientos de
 * bytes y los totales se recalculan; las filas de entrada NO se escriben. Registrar una parada NUNCA se rechaza por los topes de
 * la aplicación (es una medida de seguridad, como registrar un resultado): el exceso, acotado, queda reflejado en los totales.
 * Si la escritura falla (cuota, aborto) no queda nada y el resultado es `{ ok:false, motivo:'almacenamiento' }`: QUIEN LLAMA debe
 * detenerse EN MEMORIA y no afirmar que una recarga está protegida. Ya detenida: `{ ok:true, yaDetenida:true }` sin escribir.
 */
export function registrarParadaDeTransporte(almacen, { id, revision, parada, ctx }) {
  return operar(almacen, {
    op: 'parada',
    id,
    revision,
    modo: 'neutral',
    ctx,
    calcular: (sesion, entradas) => prepararParadaDeTransporte(sesion, entradas, parada, ctx),
    traducir: (c) => (c.tipo === 'ya-detenida' ? { ok: true, yaDetenida: true, detenida: c.detenida } : rechazoDe(c)),
  })
}

/**
 * REPORT_127 — adopta los datos para mostrar (nombres, números) de una instantánea autorizada. No compara el juego, no toca órdenes,
 * recibos ni base. Comprobado contra los topes de bytes en la misma transacción; si no cabe, nada se escribe y se dice que no se
 * adoptó (`visualizacion-no-aplicada`). Sin cambios → `{ ok:true, sinCambios:true }` sin escribir.
 */
export function actualizarVisualizacion(almacen, { id, revision, cuerpoEstado, ctx }) {
  return operar(almacen, {
    op: 'visualizacion',
    id,
    revision,
    modo: 'neutral',
    ctx,
    calcular: (sesion, entradas) => actualizarVisualizacionDeSesion(sesion, entradas, { cuerpoEstado }),
    traducir: (c) => (c.tipo === 'sin-cambio' ? { ok: true, sinCambios: true, adoptada: false } : rechazoDe(c)),
  })
}

/**
 * C3 — refresca la base de una sesión que AÚN no ha iniciado (ver refrescarAntesDelInicio). No crea, encola ni acepta un inicio.
 * El espacio nuevo se comprueba contra los topes de bytes en la misma transacción (como el refresco de la atribución).
 */
export function refrescarAntesDelInicioDeSesion(almacen, { id, revision, cuerpoEstado, preparacion, ctx }) {
  return operar(almacen, {
    op: 'refrescar-previo',
    id,
    revision,
    modo: 'neutral',
    ctx,
    calcular: (sesion, entradas) => {
      const c = refrescarAntesDelInicio(sesion, entradas, { cuerpoEstado, preparacion })
      return c.tipo === 'verificada' ? { ...c, tipo: 'ok', comprobarCapacidad: true, resultado: { verificada: true, previaAlInicio: true, atribucionRefrescada: c.atribucionRefrescada } } : c
    },
    traducir: rechazoDe,
  })
}

/**
 * T4 — aplica un recibo (una sola vez). El hash del recibo completo se calcula ANTES de abrir la transacción.
 * Un recibo idéntico a uno ya aplicado es un no-op; uno incoherente deja la parada y no toca la base.
 */
export async function aplicarRecibo(almacen, { id, revision, recibo, ctx }) {
  let huella
  try { huella = await huellaDeRecibo(recibo) } catch { return { ok: false, motivo: 'recibo-malformado' } }
  return operar(almacen, {
    op: 'recibo',
    id,
    revision,
    modo: 'resolucion',
    ctx,
    calcular: (sesion, entradas) => evaluarRecibo(sesion, entradas, recibo, huella, ctx),
    traducir: (c, sesion, entradas) => {
      if (c.tipo === 'noop') return { ok: true, noop: true, vista: vistaDe(sesion, entradas, ctx) }
      if (c.tipo === 'malformado') return { ok: false, motivo: 'recibo-malformado' }
      if (c.tipo === 'bloqueada') return { ok: false, motivo: c.motivo }
      if (c.tipo === 'divergencia') return { ok: false, motivo: 'divergencia', causa: c.causa, yaRegistrada: true }
      return rechazoDe(c)
    },
  })
}

/** Compara una instantánea con la base derivada y registra «verificada» o la parada por divergencia. */
export function verificarInstantanea(almacen, { id, revision, cuerpoEstado, ctx }) {
  return operar(almacen, {
    op: 'verificar',
    id,
    revision,
    modo: 'neutral',
    ctx,
    calcular: (sesion, entradas) => {
      const c = compararInstantanea(sesion, entradas, cuerpoEstado, ctx)
      return c.tipo === 'verificada' ? { ...c, tipo: 'ok', refresco: c.atribucionRefrescada ? 'atribucion' : undefined, resultado: { verificada: true, atribucionRefrescada: c.atribucionRefrescada ?? null } } : c
    },
    traducir: (c) => {
      if (c.tipo === 'no-aplicable') return { ok: false, motivo: 'no-aplicable', detalle: c.motivo }
      if (c.tipo === 'invalida') return { ok: false, motivo: 'instantanea-invalida', detalle: c.motivo }
      if (c.tipo === 'divergencia') return { ok: false, motivo: 'divergencia', causa: c.causa, yaRegistrada: true }
      return rechazoDe(c)
    },
  })
}

/** Reanuda tras un rechazo definitivo (confirmación del operador + insumos frescos). Ver reanudarTrasRechazo. */
export function reanudarSesion(almacen, { id, revision, cuerpoEstado, preparacion, confirmadoPorOperador, ctx }) {
  return operar(almacen, {
    op: 'reanudar',
    id,
    revision,
    modo: 'neutral',
    ctx,
    calcular: (sesion, entradas) => reanudarTrasRechazo(sesion, entradas, { cuerpoEstado, preparacion, confirmadoPorOperador }),
    traducir: rechazoDe,
  })
}

/**
 * REPORT_130 — borra SOLO la parada «no-autorizado» (401), en UNA transacción con la verificación de la instantánea fresca. La
 * revisión esperada es la de la lectura en la que se basa la evidencia: si cambió, nada se escribe. Ver reanudarTrasNoAutorizado.
 */
export function reanudarTrasNoAutorizadoSesion(almacen, { id, revision, cuerpoEstado, evidencia, confirmadoPorOperador, ctx }) {
  return operar(almacen, {
    op: 'reanudar-no-autorizado',
    id,
    revision,
    modo: 'neutral',
    ctx,
    calcular: (sesion, entradas) => reanudarTrasNoAutorizado(sesion, entradas, { cuerpoEstado, evidencia, confirmadoPorOperador, ctx }),
    traducir: (c) => {
      if (c.tipo === 'no-aplicable') return { ok: false, motivo: 'no-aplicable', detalle: c.motivo }
      if (c.tipo === 'invalida') return { ok: false, motivo: 'instantanea-invalida', detalle: c.motivo }
      if (c.tipo === 'divergencia') return { ok: false, motivo: 'divergencia', causa: c.causa, yaRegistrada: true }
      return rechazoDe(c)
    },
  })
}

// ---------------------------------------------------------------------------
// Lecturas.
// ---------------------------------------------------------------------------

/** Lee sesión + entradas, validadas. Un registro corrupto bloquea ESE partido y se conserva tal cual. */
export function leerSesion(almacen, id, ctx) {
  return transaccion(almacen, 'leer', ['sesiones', 'entradas'], 'readonly', (t) => {
    t.obtener('sesiones', id, (fila) => {
      if (!fila) { t.sinCambios({ ok: false, motivo: 'sesion-inexistente' }); return }
      t.todos('entradas', 'porId', id, (filas) => {
        const v = validarSesionYEntradas(fila, filas)
        if (!v.ok) { t.sinCambios({ ok: false, motivo: 'registro-corrupto', detalle: v.motivo }); return }
        t.sinCambios({ ok: true, sesion: fila, entradas: filas, vista: vistaDe(fila, filas, ctx) })
      })
    })
  })
}

export function leerTotales(almacen) {
  return transaccion(almacen, 'totales', ['meta'], 'readonly', (t) => {
    t.obtener('meta', 'totales', (tot) => t.sinCambios({ ok: true, totales: tot ?? ceroTotales() }))
  })
}
