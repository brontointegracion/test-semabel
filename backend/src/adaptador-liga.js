import { crearAtribucion } from '../../src/lib/motor/atribucion.js'
import { crearEstado } from '../../src/lib/motor/estado.js'
import { contenidoCanonico } from '../../src/lib/motor/sobre.js'
import { crearPreparacion } from '../../src/lib/motor/preparacion.js'
import { firmaDeReglas, reglasEfectivas } from '../../src/lib/reglas-categoria.js'
import { sha256Hex } from './credenciales.js'
import { escribirResumen, resumirPartido } from './resumen-publico.js'

// ---------------------------------------------------------------------------
// Adaptador del motor sobre el SQLite de una liga (un Durable Object).
// Implementa src/lib/motor/contrato-adaptador.js SIN cambiar el orquestador:
//
//   autorizar, leerVista   Lecturas consultivas (pueden quedar desactualizadas).
//   procesar               Decisión pura del motor.
//   confirmar              Cuerpo SINCRÓNICO dentro de una sola transactionSync:
//                          compara lo leído con lo vigente y, solo si todo coincide,
//                          escribe recibo, cursor, estado, eventos, auditoría y
//                          bandeja. Si algo cambió devuelve { conflicto: true } sin
//                          escribir. Si algo lanza, la transacción se deshace.
//
// Nunca se pasa una función async a transactionSync.
//
// PUNTO DE DECISIÓN DE AUTORIZACIÓN
//   `autorizar` es CONSULTIVA: puede quedar desactualizada en cuanto devuelve (hay un await
//   antes de la consulta y otro al regresar). La decisión que vale es la que se vuelve a tomar
//   DENTRO de `leerVista`, en el mismo tramo SINCRÓNICO (sin ningún await) que lee recibos,
//   estado, bloqueo y plantilla: se relee la fila de la credencial y se exige que siga vigente,
//   asignada a ESTE partido y a ESTE dispositivo. Solo si eso se cumple se lee algo más. Un
//   recibo existente o un conflicto de contenido solo se pueden devolver a partir de esa lectura,
//   así que ninguna credencial revocada o reasignada antes de ese punto recibe información.
//   Si la credencial ya no vale, `leerVista` lanza AutorizacionPerdida ANTES de leer nada y
//   `ejecutarComando` responde el 401 genérico. No se escribe nada.
//   Para las órdenes nuevas, `confirmar` vuelve a comparar la versión de autorización.
//   Un cambio de versión con la credencial todavía vigente NO es un rechazo por sí solo: la
//   lectura es válida en su punto de decisión y `confirmar` obliga a releer antes de escribir.
//
// La preparación y la atribución NO se guardan: se DERIVAN de las filas vigentes con
// las mismas funciones del motor (crearPreparacion, crearAtribucion), tanto al leer
// como al confirmar. Así una edición de plantilla confirmada entre la lectura y la
// confirmación cambia la huella, y la confirmación lo detecta.
// ---------------------------------------------------------------------------

const jsonONulo = (t) => (t === null || t === undefined ? null : JSON.parse(t))

/** La credencial dejó de valer (o cambió de partido/dispositivo) entre `autorizar` y la lectura protegida. */
export class AutorizacionPerdida extends Error {
  constructor() {
    super('autorizacion-perdida')
    this.name = 'AutorizacionPerdida'
  }
}

/**
 * Este intento NO dejó ninguna escritura, y hay evidencia: o el fallo ocurrió antes de la primera
 * escritura de la transacción, o la transacción se deshizo y el estado observado justo después coincide
 * con el de antes de empezar. NO dice nada de intentos anteriores con el mismo cmdId.
 */
export class FalloSinEscritura extends Error {
  constructor(motivo, causa) {
    super(`fallo-sin-escritura:${motivo}`)
    this.name = 'FalloSinEscritura'
    this.motivo = motivo
    this.cause = causa
  }
}

/** No se puede probar si la confirmación se completó (p. ej. falló el cierre de la transacción). */
export class ResultadoIncierto extends Error {
  constructor(causa) {
    super('resultado-incierto')
    this.name = 'ResultadoIncierto'
    this.cause = causa
  }
}

// Comparación EXACTA del contenido capturado antes de escribir. Una celda es { existe, valor }: una fila ausente
// ({ existe: false, valor: null }) NO es lo mismo que una fila presente con valor nulo ({ existe: true, valor: null }).
const celdasIguales = (a, b) => a.existe === b.existe && a.valor === b.valor

/** `{ estado, eventos: Map(id → celda), resumen? }` contra otro igual. Exportada para pruebas unitarias. */
export function contenidosIguales(a, b) {
  if (!celdasIguales(a.estado, b.estado) || a.eventos.size !== b.eventos.size) return false
  // La fila EXACTA del resumen público (si la captura la trae): ausente ≠ presente, y presente se compara columna a columna.
  if (a.resumen !== undefined || b.resumen !== undefined) {
    if (a.resumen === undefined || b.resumen === undefined || !celdasIguales(a.resumen, b.resumen)) return false
  }
  for (const [id, c] of a.eventos) {
    const otra = b.eventos.get(id)
    if (otra === undefined || !celdasIguales(c, otra)) return false
  }
  return true
}

/**
 * Estado de una credencial de partido según su expiración (sin expiración = sembrada/heredada: activa).
 *   activa        antes de expira_en: procesa comandos con las reglas de siempre;
 *   recuperacion  hasta retorno_hasta: SOLO reintentos exactos de comandos que ya tienen recibo guardado;
 *   vencida       después, o revocada: nada.
 * Ni el uso, ni el final del partido, ni la hora programada la prolongan.
 */
export function estadoDeCredencial({ expira_en: expiraEn, retorno_hasta: retornoHasta }, ahora) {
  if (expiraEn === null || expiraEn === undefined) return 'activa'
  if (ahora < expiraEn) return 'activa'
  if (retornoHasta !== null && retornoHasta !== undefined && ahora < retornoHasta) return 'recuperacion'
  return 'vencida'
}

export function crearAdaptadorLiga({ storage, pausaTrasLeer = null, pausaTrasAutorizar = null, trasConfirmar = null, ahora = Date.now }) {
  const sql = storage.sql

  const fila = (consulta, ...args) => sql.exec(consulta, ...args).toArray()[0] ?? null
  const filas = (consulta, ...args) => sql.exec(consulta, ...args).toArray()

  const partidoDe = (gameId) => fila('SELECT * FROM partidos WHERE id = ?', gameId)

  const idsDeEquipos = (p) => [...new Set([p.local_id, p.visita_id].filter((id) => typeof id === 'string' && id !== ''))]

  function jugadoresDe(ids) {
    return ids.flatMap((id) => filas('SELECT id, equipo_id, dorsal, activo FROM jugadores WHERE equipo_id = ?', id))
      .map((j) => ({ id: j.id, equipoId: j.equipo_id, dorsal: j.dorsal, activo: j.activo === 1 }))
  }

  /** Contexto de preparación derivado de las filas vigentes, o null si no se puede armar. */
  function preparacionDe(p) {
    try {
      const ids = idsDeEquipos(p)
      const liga = fila('SELECT id FROM ligas WHERE id = ?', p.liga_id)
      const equipos = ids.flatMap((id) => filas('SELECT id, liga_id FROM equipos WHERE id = ?', id))
        .map((e) => ({ id: e.id, ligaId: e.liga_id }))
      return crearPreparacion({
        gameId: p.id,
        partido: { ligaId: p.liga_id, localId: p.local_id, visitaId: p.visita_id },
        liga: liga ? { id: liga.id } : null,
        equipos,
        jugadores: jugadoresDe(ids),
        consultaEquipos: ids,
      })
    } catch {
      return null
    }
  }

  /** Contexto de atribución derivado de las filas vigentes, o null si no se puede armar. */
  function atribucionDe(p) {
    try {
      const ids = idsDeEquipos(p)
      return crearAtribucion({ equipos: ids, jugadores: jugadoresDe(ids) })
    } catch {
      return null
    }
  }

  /**
   * Config del partido con las reglas de su categoría. Las reglas YA fijadas en el partido mandan siempre. Un partido todavía
   * 'programado' sin reglas las toma de la categoría vigente de su liga; como el estado que decide la orden de inicio las
   * lleva, quedan guardadas (fijadas) en la MISMA confirmación del inicio. Un partido iniciado sin reglas (anterior a esta
   * función) o con una categoría sin regla explícita no cambia: no se añade nada.
   */
  function configConReglas(p, base) {
    const config = base.config
    if (config?.reglas !== undefined) return config
    const liga = fila('SELECT deporte, categoria FROM ligas WHERE id = ?', p.liga_id)
    const reglas = reglasEfectivas({ config, estadoPartido: base.partido?.estado, deporte: liga?.deporte, categoria: liga?.categoria })
    return reglas ? { ...config, reglas } : config
  }

  function estadoDe(p) {
    const base = JSON.parse(p.estado_json)
    const eventos = filas('SELECT json FROM eventos WHERE partido_id = ? ORDER BY seq', p.id).map((r) => JSON.parse(r.json))
    return crearEstado({
      gameId: p.id,
      config: configConReglas(p, base),
      partido: base.partido,
      eventos,
      auditSeq: base.auditSeq,
      corridaSeq: base.corridaSeq,
      cursorReloj: base.cursorReloj,
      rev: p.rev,
      atribucion: atribucionDe(p),
    })
  }

  const reciboPorCmdId = (gameId, cmdId) => jsonONulo(fila('SELECT json FROM recibos WHERE partido_id = ? AND cmd_id = ?', gameId, cmdId)?.json)
  const reciboPorSeq = (gameId, seq) => jsonONulo(fila('SELECT json FROM recibos WHERE partido_id = ? AND client_seq = ?', gameId, seq)?.json)

  /** ¿Sigue igual todo lo que se leyó? Cuerpo sincrónico: se llama solo dentro de transactionSync. */
  function coincideConLoVigente(p, esperado) {
    if (esperado.rev !== p.rev) return false
    if (esperado.ultimoClientSeq !== p.ultimo_client_seq) return false
    if (esperado.versionBloqueo !== p.version_bloqueo) return false
    if (esperado.versionAutorizacion !== p.version_autorizacion) return false
    // Solo el inicio del partido trae esta clave: se compara con la huella RECALCULADA ahora.
    if ('versionPreparacion' in esperado) {
      const vigente = preparacionDe(p)
      if (esperado.versionPreparacion !== (typeof vigente?.version === 'string' ? vigente.version : null)) return false
    }
    // Las reglas de categoría que decidió el inicio deben seguir siendo las vigentes (misma transacción que la escritura):
    // si la categoría o las reglas cambiaron entre la lectura y la confirmación, nada se escribe y se vuelve a decidir.
    if ('firmaReglas' in esperado) {
      if (esperado.firmaReglas !== firmaDeReglas(configConReglas(p, JSON.parse(p.estado_json)))) return false
    }
    return true
  }

  function escribirRecibo(gameId, recibo) {
    sql.exec(
      'INSERT INTO recibos (partido_id, cmd_id, client_seq, json) VALUES (?, ?, ?, ?)',
      gameId, recibo.cmdId, recibo.clientSeq, JSON.stringify(recibo),
    )
    sql.exec('UPDATE partidos SET ultimo_client_seq = ? WHERE id = ?', recibo.clientSeq, gameId)
  }

  const contar = (tabla, gameId) => sql.exec(`SELECT COUNT(*) AS n FROM ${tabla} WHERE partido_id = ?`, gameId).one().n

  /** Lo observable del partido que una confirmación podría cambiar. Lectura sincrónica. */
  function instantanea(gameId) {
    const p = partidoDe(gameId)
    return {
      rev: p?.rev ?? null,
      seq: p?.ultimo_client_seq ?? null,
      recibos: contar('recibos', gameId),
      eventos: contar('eventos', gameId),
      auditoria: contar('auditoria_reloj', gameId),
      bandeja: contar('bandeja', gameId),
      cuarentena: contar('cuarentena', gameId),
    }
  }
  const iguales = (a, b) => Object.keys(a).every((k) => a[k] === b[k])

  // Contenido EXACTO de las únicas filas ya existentes que una confirmación puede modificar: el estado_json del
  // partido y el JSON de los eventos que va a actualizar (deshacer, rehacer, anular). Nada más: no se recorre la
  // base de la liga. Una fila ausente ({ existe: false }) se distingue de un valor nulo ({ existe: true, valor: null }).
  const celda = (filasLeidas) => (filasLeidas.length ? { existe: true, valor: filasLeidas[0].valor } : { existe: false, valor: null })

  function contenidoDeFilas(gameId, eventosId) {
    const estado = celda(sql.exec('SELECT estado_json AS valor FROM partidos WHERE id = ?', gameId).toArray())
    const eventos = new Map()
    for (const id of eventosId) {
      eventos.set(id, celda(sql.exec('SELECT json AS valor FROM eventos WHERE partido_id = ? AND id = ?', gameId, id).toArray()))
    }
    // La fila del resumen público, columna a columna (json_array conserva NULL y el tipo de cada valor).
    const resumen = celda(sql.exec(
      `SELECT json_array(local_id, visita_id, local_puntos, visita_puntos, local_faltas, visita_faltas, periodo, rev_fuente,
          version_proyeccion) AS valor FROM resumen_partido WHERE partido_id = ?`,
      gameId,
    ).toArray())
    return { estado, eventos, resumen }
  }

  /**
   * Ejecuta `cuerpo` (SINCRÓNICO) en una transactionSync y clasifica un fallo.
   *
   * GARANTÍA DE LA PLATAFORMA (no es algo que este código compruebe): si el callback de transactionSync lanza,
   * la transacción se deshace. Eso es lo que sostiene la clasificación.
   *
   * COMPROBACIONES OBSERVADAS (corroboran, no demuestran toda la base ni la durabilidad en producción). Se hacen
   * sin ningún await, justo después del fallo, y se comparan con lo capturado DENTRO de la misma transacción
   * antes de la primera escritura: rev, cursor y recuentos del partido, el estado_json exacto y el JSON exacto de
   * cada evento que la orden puede actualizar.
   *
   *   - lanzó DENTRO del callback antes de la primera escritura (incluida una captura fallida) → FalloSinEscritura('no-escribio');
   *   - lanzó dentro después de empezar a escribir y TODAS las comprobaciones coinciden → FalloSinEscritura('reversion-verificada');
   *   - cualquier otra cosa (el cierre falló, alguna comprobación difiere o no pudo hacerse) → ResultadoIncierto.
   */
  function transaccionClasificada(traza, gameId, cuerpo) {
    traza.fase = 'escribiendo'
    let lanzoDentro = false
    let escrituraEmpezada = false
    let antes = null
    let contenidoAntes = null
    let eventosVigilados = []
    try {
      return storage.transactionSync(() => {
        try {
          return cuerpo({
            // Se llama inmediatamente antes de la primera mutación. Si la captura falla, la bandera sigue en false:
            // todavía no se escribió nada y el fallo es un fallo conocido sin escritura.
            iniciarEscritura({ eventosId = [] } = {}) {
              const instantaneaAntes = instantanea(gameId)
              const contenido = contenidoDeFilas(gameId, eventosId)
              antes = instantaneaAntes
              contenidoAntes = contenido
              eventosVigilados = [...eventosId]
              escrituraEmpezada = true
            },
          })
        } catch (error) {
          lanzoDentro = true
          throw error
        }
      })
    } catch (error) {
      if (lanzoDentro) {
        if (!escrituraEmpezada) throw new FalloSinEscritura('no-escribio', error)
        let coincide = false
        try {
          coincide = iguales(antes, instantanea(gameId))
            && contenidosIguales(contenidoAntes, contenidoDeFilas(gameId, eventosVigilados))
        } catch {
          coincide = false // no se pudo comprobar, y ya se había empezado a escribir: no se afirma nada
        }
        if (coincide) throw new FalloSinEscritura('reversion-verificada', error)
      }
      throw new ResultadoIncierto(error)
    }
  }

  const adaptador = {
    /** Un adaptador por EJECUCIÓN de un comando: lleva la traza de lo que esa ejecución llegó a confirmar. */
    paraEjecucion() {
      const traza = { fase: 'lectura', confirmado: null }
      return { traza, transaccion: (gameId, fn) => fn(crearTx(traza)), publicarPendientes: adaptador.publicarPendientes }
    },

    // Lecturas sincrónicas para quien necesite el estado vigente (proyección pública, pruebas).
    estadoVigente(gameId) {
      const p = partidoDe(gameId)
      return p ? estadoDe(p) : null
    },
    preparacionVigente(gameId) {
      const p = partidoDe(gameId)
      return p ? preparacionDe(p) : null
    },

    // La frontera protegida la da confirmar: aquí no se abre ninguna transacción.
    // Cada intento recibe su PROPIO tx: guarda lo que `autorizar` aprobó para volver a comprobarlo
    // en la lectura protegida (ver el punto de decisión arriba).
    transaccion(gameId, fn) {
      return fn(crearTx({ fase: 'lectura', confirmado: null }))
    },

    async publicarPendientes() {
      // No hay destino de entrega en esta etapa: las filas de la bandeja quedan pendientes y
      // el orquestador informa publicacion = 'pendiente'. No se afirma ninguna entrega.
      throw new Error('publicacion-no-configurada')
    },
  }

  const crearTx = (traza) => {
    // Lo que aprobó `autorizar` en este intento: hash de la credencial, partido y dispositivo.
    let aprobada = null

    /** Comprueba, de forma SINCRÓNICA, que la credencial aprobada siga vigente para este partido y dispositivo. */
    function reconfirmarAutorizacion(gameId) {
      if (aprobada === null || aprobada.gameId !== gameId) throw new AutorizacionPerdida()
      const c = fila(
        'SELECT partido_id, device_id, revocada, expira_en, retorno_hasta FROM credenciales WHERE token_hash = ?',
        aprobada.hash,
      )
      if (!c || c.revocada === 1 || c.partido_id !== gameId || c.device_id !== aprobada.deviceId) {
        throw new AutorizacionPerdida()
      }
      // El estado por tiempo también se decide AQUÍ, con el reloj de este instante.
      const modo = estadoDeCredencial(c, ahora())
      if (modo === 'vencida') throw new AutorizacionPerdida()
      aprobada.modo = modo
    }

    return {
    async autorizar({ gameId, credencial }) {
      const hash = await sha256Hex(typeof credencial === 'string' ? credencial : '')
      const c = fila(
        `SELECT c.partido_id, c.device_id, c.actor_id, c.revocada, c.expira_en, c.retorno_hasta, p.version_autorizacion AS version
           FROM credenciales c LEFT JOIN partidos p ON p.id = c.partido_id
          WHERE c.token_hash = ?`,
        hash,
      )
      if (!c) return { autorizado: false, motivo: 'credencial-invalida', version: 0 }
      if (c.revocada === 1) return { autorizado: false, motivo: 'credencial-revocada', version: c.version ?? 0 }
      if (c.partido_id !== gameId) return { autorizado: false, motivo: 'juego-distinto', version: c.version ?? 0 }
      const modo = estadoDeCredencial(c, ahora())
      if (modo === 'vencida') return { autorizado: false, motivo: 'credencial-vencida', version: c.version ?? 0 }
      const resultado = { autorizado: true, gameId: c.partido_id, deviceId: c.device_id, actorId: c.actor_id, version: c.version }
      aprobada = { hash, gameId: c.partido_id, deviceId: c.device_id, modo }
      // Punto de extensión para pruebas: aquí otra petición puede revocar o reasignar la credencial.
      if (pausaTrasAutorizar) await pausaTrasAutorizar({ gameId })
      return resultado
    },

    async leerVista(sobre) {
      // PUNTO DE DECISIÓN: se vuelve a comprobar la credencial en el mismo tramo sincrónico que las
      // lecturas de abajo. Si falla, no se lee ni se devuelve nada.
      reconfirmarAutorizacion(sobre.gameId)
      const p = partidoDe(sobre.gameId)
      if (!p) throw new Error('partido-desconocido')
      // Credencial en recuperación: solo se contesta un reintento EXACTO de un comando con recibo guardado.
      // Un sobre desconocido o distinto es el mismo 401 genérico: no se revela ningún recibo ni conflicto.
      if (aprobada.modo === 'recuperacion') {
        const guardado = reciboPorCmdId(p.id, sobre.cmdId)
        if (!guardado || guardado.contenido !== contenidoCanonico(sobre)) throw new AutorizacionPerdida()
      }
      const vista = {
        estado: estadoDe(p),
        ultimoClientSeq: p.ultimo_client_seq,
        reciboPorCmdId: reciboPorCmdId(p.id, sobre.cmdId),
        reciboPorSeq: reciboPorSeq(p.id, sobre.clientSeq),
        bloqueo: jsonONulo(p.bloqueo_json),
        versionBloqueo: p.version_bloqueo,
        preparacion: preparacionDe(p),
      }
      if (pausaTrasLeer) await pausaTrasLeer(sobre)
      return vista
    },

    async confirmar({ esperado, recibo, efectos, estadoDespues, mensaje }) {
      const resultado = transaccionClasificada(traza, recibo.gameId, ({ iniciarEscritura }) => {
        const p = partidoDe(recibo.gameId)
        if (!p) throw new Error('partido-desconocido')
        if (!coincideConLoVigente(p, esperado)) return { conflicto: true }

        if (efectos) {
          // La orden se validó contra una atribución concreta: si la plantilla cambió desde entonces,
          // se relee y se vuelve a decidir. (esperado no trae esta versión; se compara aquí.)
          const vigente = atribucionDe(p)
          if ((estadoDespues.atribucion?.version ?? null) !== (vigente?.version ?? null)) return { conflicto: true }
        }

        // Desde aquí se escribe: se capturan antes el estado_json y los eventos que esta orden actualizará.
        iniciarEscritura({ eventosId: efectos ? efectos.eventosActualizados.map((u) => u.id) : [] })
        escribirRecibo(p.id, recibo)
        if (!efectos) return { ok: true }

        const { eventos: eventosDespues, atribucion: _atribucion, rev, ...resto } = estadoDespues
        sql.exec(
          'UPDATE partidos SET rev = ?, estado_json = ? WHERE id = ?',
          rev,
          JSON.stringify({ auditSeq: resto.auditSeq, corridaSeq: resto.corridaSeq, cursorReloj: resto.cursorReloj, config: resto.config, partido: resto.partido }),
          p.id,
        )
        for (const e of efectos.eventosNuevos) {
          sql.exec('INSERT INTO eventos (partido_id, id, seq, json) VALUES (?, ?, ?, ?)', p.id, e.id, e.seq, JSON.stringify(e))
        }
        for (const u of efectos.eventosActualizados) {
          const previo = fila('SELECT json FROM eventos WHERE partido_id = ? AND id = ?', p.id, u.id)
          if (!previo) throw new Error(`evento-desconocido:${u.id}`)
          sql.exec('UPDATE eventos SET json = ? WHERE partido_id = ? AND id = ?', JSON.stringify({ ...JSON.parse(previo.json), ...u.cambios }), p.id, u.id)
        }
        for (const a of efectos.auditoria) {
          sql.exec('INSERT INTO auditoria_reloj (partido_id, seq, json) VALUES (?, ?, ?)', p.id, a.seq, JSON.stringify(a))
        }
        // Resumen público DERIVADO del estado que acaba de decidir el motor (los eventos ya están en memoria: ninguna
        // lectura más de la historia). Misma transacción que el recibo, el estado y los eventos: si falla, todo se deshace.
        escribirResumen(
          sql, p.id,
          resumirPartido({ eventos: eventosDespues, localId: p.local_id, visitaId: p.visita_id, deporte: resto.config.deporte }),
          rev,
        )
        sql.exec(
          'INSERT INTO bandeja (partido_id, rev, cmd_id, mensaje_json, creado_en) VALUES (?, ?, ?, ?, ?)',
          p.id, recibo.revDespues, recibo.cmdId, JSON.stringify(mensaje), recibo.meta.recibidoEn,
        )
        return { ok: true }
      })
      // La transactionSync devolvió con normalidad: o hubo conflicto (no se escribió nada) o se confirmó.
      if (resultado.conflicto) {
        traza.fase = 'lectura'
      } else {
        traza.fase = 'confirmada'
        traza.confirmado = { tipo: efectos ? 'aceptado' : 'rechazado', recibo }
        if (trasConfirmar) await trasConfirmar({ gameId: recibo.gameId }) // un fallo aquí es POSTERIOR a la confirmación
      }
      return resultado
    },

    async registrarCuarentena({ esperado, sobre, recibidoEn }) {
      const resultado = transaccionClasificada(traza, sobre.gameId, ({ iniciarEscritura }) => {
        const p = partidoDe(sobre.gameId)
        if (!p) throw new Error('partido-desconocido')
        if (!coincideConLoVigente(p, esperado)) return { conflicto: true }
        iniciarEscritura()
        sql.exec('INSERT INTO cuarentena (partido_id, sobre_json, recibido_en) VALUES (?, ?, ?)', p.id, JSON.stringify(sobre), recibidoEn)
        return { ok: true }
      })
      if (resultado.conflicto) traza.fase = 'lectura'
      else {
        traza.fase = 'confirmada'
        traza.confirmado = { tipo: 'bloqueado' }
      }
      return resultado
    },
    }
  }

  return adaptador
}
