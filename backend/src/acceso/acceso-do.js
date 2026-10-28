import { DurableObject } from 'cloudflare:workers'
import {
  DURACIONES, MAX_SESIONES, REFRESCO_USO_SESION_MS,
} from './config.js'
import { canonico } from '../../../src/lib/motor/sobre.js'
import { sha256Hex } from '../credenciales.js'
import { aleatorioHex, generarCodigo, hashSecreto, hashesIguales, partirCodigo } from './codigos.js'
import { crearEsquemaAcceso } from './esquema-acceso.js'
import { RespaldoNoSoportado, exportarObjeto, marcadorDeRecuperacion } from '../respaldo.js'
import { despuesDeFalloDeCodigo, fuenteBloqueada, registrarFalloFuente } from './limites.js'

// ---------------------------------------------------------------------------
// Objeto de ACCESO (uno para todo el piloto): el organizador, qué ligas posee, su código privado y sus sesiones.
// Los objetos de liga no guardan sesiones: reciben una AFIRMACIÓN con la hora de validación (ver asercion.js).
//
// Todo lo que decide es SINCRÓNICO dentro de una transacción de este objeto. La revocación de una sesión queda
// ordenada aquí; no es atómica con ninguna mutación de un objeto de liga (otro objeto).
// ---------------------------------------------------------------------------

const COOKIE = /^([0-9a-f]{32})\.([0-9a-f]{64})$/
const ID_LIGA = /^[A-Za-z0-9_-]{1,64}$/
const ID_OPERACION = /^[A-Za-z0-9_-]{16,64}$/
const ID_ORGANIZADOR = /^[A-Za-z0-9_-]{1,64}$/
const MAX_LIGAS_ASIGNACION = 10
const FALLO = Object.freeze({ tipo: 'no-autorizado' })

export class AccesoDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.almacen = ctx.storage
    ctx.blockConcurrencyWhile(async () => { crearEsquemaAcceso(ctx.storage) })
  }

  /** Hora del servidor. Las pruebas la sustituyen; en producción es el reloj real. */
  ahora() { return Date.now() }

  /** Respaldo SOLO LECTURA del objeto de acceso (operador; ver ../respaldo.js). Contiene hashes de secretos: es material privado. */
  async exportarRespaldoOperador() {
    try {
      const r = await exportarObjeto(this.almacen, { clase: 'AccesoDO', objeto: 'acceso', ahora: this.ahora(), ...this.opcionesRespaldo() })
      return { estado: 'ok', texto: JSON.stringify(r) }
    } catch (e) {
      if (e instanceof RespaldoNoSoportado) return { estado: 'no-soportado', motivo: e.codigo }
      throw e
    }
  }

  /** Marcador de recuperación (PITR) si la plataforma lo ofrece; evidencia APARTE de la exportación. */
  async marcadorRecuperacionOperador() { return marcadorDeRecuperacion(this.almacen, { ahora: this.ahora() }) }

  /** Topes del respaldo. Las pruebas los sustituyen. */
  opcionesRespaldo() { return {} }

  #auditar(tipo, { organizadorId = null, sesionId = null, detalle = null } = {}, ahora = this.ahora()) {
    this.almacen.sql.exec(
      'INSERT INTO auditoria_acceso (ts, tipo, organizador_id, sesion_id, detalle) VALUES (?, ?, ?, ?, ?)',
      ahora, tipo, organizadorId, sesionId, detalle,
    )
  }

  // --- Provisión del operador (la ruta que la llama está desactivada por defecto) --------------------------------

  async provisionar({ nombre, ligas }) {
    if (typeof nombre !== 'string' || nombre.length < 1 || nombre.length > 100) return { ok: false, error: 'nombre-invalido' }
    if (!Array.isArray(ligas) || ligas.length < 1 || ligas.length > 10 || !ligas.every((l) => typeof l === 'string' && ID_LIGA.test(l))) {
      return { ok: false, error: 'ligas-invalidas' }
    }
    const codigo = generarCodigo()
    const hash = await hashSecreto('organizador', codigo.secreto)
    return this.almacen.transactionSync(() => {
      const sql = this.almacen.sql
      const ahora = this.ahora()
      if (sql.exec('SELECT 1 AS x FROM organizadores WHERE activo = 1').toArray().length) return { ok: false, error: 'organizador-existente' }
      const id = `org-${aleatorioHex(8)}`
      sql.exec('INSERT INTO organizadores (id, nombre, activo, creado_en) VALUES (?, ?, 1, ?)', id, nombre, ahora)
      for (const l of new Set(ligas)) sql.exec('INSERT INTO propiedad (organizador_id, liga_id) VALUES (?, ?)', id, l)
      const expiraEn = ahora + DURACIONES.codigoOrganizador
      sql.exec(
        'INSERT INTO codigos_organizador (id, organizador_id, secreto_hash, creado_en, expira_en) VALUES (?, ?, ?, ?, ?)',
        codigo.id, id, hash, ahora, expiraEn,
      )
      this.#auditar('organizador-creado', { organizadorId: id }, ahora)
      return { ok: true, organizadorId: id, codigo: codigo.texto, expiraEn }
    })
  }

  /** Punto de extensión SOLO de pruebas: se llama dentro de la transacción de `asignarLigas`, tras escribir la propiedad y antes del recibo. */
  puntoDeFallaAsignacion() {}

  /**
   * AÑADE propiedad de ligas a un organizador EXISTENTE y ACTIVO, indicado de forma explícita (REPORT_187). Solo añade: nunca quita,
   * transfiere ni reemplaza; no toca el código, sus hashes, la caducidad, las sesiones ni la propiedad ya existente.
   *   - Recibo por `operacionId` con la huella del contenido (organizador + ligas ordenadas): mismo id y mismo contenido → el resultado
   *     ORIGINAL con `reproducido: true` y ninguna escritura; mismo id y otro contenido → 409 `operacion-conflicto`, ninguna escritura.
   *   - Una liga que ya es de OTRO organizador es un conflicto: se rechaza TODO el lote, sin escribir nada (no hay lotes parciales).
   *   - Una liga que ya es del organizador indicado no es un error: se informa en `yaExistian`.
   *   - Propiedad + auditoría + recibo se escriben en UNA transacción: si algo falla, no queda nada.
   * El llamador (la ruta) ya validó la forma y la admisión de las ligas. → { ok:true, … } | { ok:false, error, status }
   */
  async asignarLigas({ operacionId, organizadorId, ligas }) {
    if (typeof operacionId !== 'string' || !ID_OPERACION.test(operacionId)) return { ok: false, status: 422, error: 'operacion-invalida' }
    if (typeof organizadorId !== 'string' || !ID_ORGANIZADOR.test(organizadorId)) return { ok: false, status: 422, error: 'organizador-invalido' }
    if (!Array.isArray(ligas) || ligas.length < 1 || ligas.length > MAX_LIGAS_ASIGNACION || !ligas.every((l) => typeof l === 'string' && ID_LIGA.test(l)) || new Set(ligas).size !== ligas.length) {
      return { ok: false, status: 422, error: 'ligas-invalidas' }
    }
    const ordenadas = [...ligas].sort()
    const huella = await sha256Hex(canonico({ tipo: 'asignar-ligas', organizadorId, ligas: ordenadas }))
    return this.almacen.transactionSync(() => {
      const sql = this.almacen.sql
      const previo = sql.exec('SELECT huella, resultado_json FROM asignaciones_liga WHERE operacion_id = ?', operacionId).toArray()[0]
      if (previo) {
        if (previo.huella !== huella) return { ok: false, status: 409, error: 'operacion-conflicto' }
        return { ...JSON.parse(previo.resultado_json), reproducido: true }
      }
      const org = sql.exec('SELECT id FROM organizadores WHERE id = ? AND activo = 1', organizadorId).toArray()[0]
      if (!org) return { ok: false, status: 409, error: 'organizador-no-activo' }
      const ajenas = ordenadas.filter((l) => sql.exec('SELECT 1 AS x FROM propiedad WHERE liga_id = ? AND organizador_id <> ? LIMIT 1', l, organizadorId).toArray().length > 0)
      if (ajenas.length) return { ok: false, status: 409, error: 'liga-con-otro-propietario', ligas: ajenas }
      const yaExistian = ordenadas.filter((l) => sql.exec('SELECT 1 AS x FROM propiedad WHERE organizador_id = ? AND liga_id = ?', organizadorId, l).toArray().length > 0)
      const agregadas = ordenadas.filter((l) => !yaExistian.includes(l))
      const ahora = this.ahora()
      for (const l of agregadas) sql.exec('INSERT INTO propiedad (organizador_id, liga_id) VALUES (?, ?)', organizadorId, l)
      this.#auditar('ligas-asignadas', { organizadorId, detalle: agregadas.join(',') }, ahora)
      this.puntoDeFallaAsignacion()
      const resultado = {
        ok: true, organizadorId, agregadas, yaExistian,
        ligas: sql.exec('SELECT liga_id FROM propiedad WHERE organizador_id = ? ORDER BY liga_id', organizadorId).toArray().map((r) => r.liga_id),
      }
      sql.exec('INSERT INTO asignaciones_liga (operacion_id, huella, resultado_json, creado_en) VALUES (?, ?, ?, ?)', operacionId, huella, JSON.stringify(resultado), ahora)
      return { ...resultado, reproducido: false }
    })
  }

  /** Emite un código nuevo y revoca los anteriores. Por defecto también cierra las sesiones (respuesta a una fuga). */
  async rotarCodigo({ cerrarSesiones = true } = {}) {
    const codigo = generarCodigo()
    const hash = await hashSecreto('organizador', codigo.secreto)
    return this.almacen.transactionSync(() => {
      const sql = this.almacen.sql
      const ahora = this.ahora()
      const org = sql.exec('SELECT id FROM organizadores WHERE activo = 1').toArray()[0]
      if (!org) return { ok: false, error: 'sin-organizador' }
      sql.exec('UPDATE codigos_organizador SET revocado_en = ? WHERE organizador_id = ? AND revocado_en IS NULL', ahora, org.id)
      const expiraEn = ahora + DURACIONES.codigoOrganizador
      sql.exec(
        'INSERT INTO codigos_organizador (id, organizador_id, secreto_hash, creado_en, expira_en) VALUES (?, ?, ?, ?, ?)',
        codigo.id, org.id, hash, ahora, expiraEn,
      )
      if (cerrarSesiones) sql.exec("UPDATE sesiones SET revocada_en = ?, motivo = 'rotacion' WHERE revocada_en IS NULL", ahora)
      this.#auditar('codigo-rotado', { organizadorId: org.id, detalle: cerrarSesiones ? 'con-cierre-de-sesiones' : 'sin-cierre-de-sesiones' }, ahora)
      return { ok: true, codigo: codigo.texto, expiraEn }
    })
  }

  cerrarTodasLasSesiones() {
    return this.almacen.transactionSync(() => {
      const ahora = this.ahora()
      this.almacen.sql.exec("UPDATE sesiones SET revocada_en = ?, motivo = 'operador' WHERE revocada_en IS NULL", ahora)
      this.#auditar('sesiones-cerradas', {}, ahora)
      return { ok: true }
    })
  }

  desactivarOrganizador() {
    return this.almacen.transactionSync(() => {
      const sql = this.almacen.sql
      const ahora = this.ahora()
      sql.exec('UPDATE organizadores SET activo = 0 WHERE activo = 1')
      sql.exec('UPDATE codigos_organizador SET revocado_en = ? WHERE revocado_en IS NULL', ahora)
      sql.exec("UPDATE sesiones SET revocada_en = ?, motivo = 'desactivado' WHERE revocada_en IS NULL", ahora)
      this.#auditar('organizador-desactivado', {}, ahora)
      return { ok: true }
    })
  }

  // --- Entrada con el código ------------------------------------------------------------------------------------

  /** → { tipo:'ok', cookie, expiraIdle, expiraAbs } | { tipo:'no-autorizado' } | { tipo:'limitado' } */
  async iniciarSesion({ codigo, fuente }) {
    const partes = partirCodigo(codigo)
    const fuenteOk = typeof fuente === 'string' && fuente.length > 0 && fuente.length <= 128 ? fuente : 'desconocida'
    const hashPresentado = partes ? await hashSecreto('organizador', partes.secreto) : null
    const secretoSesion = aleatorioHex(32)
    const hashSesion = await hashSecreto('sesion', secretoSesion)
    const idSesion = aleatorioHex(16)

    return this.almacen.transactionSync(() => {
      const sql = this.almacen.sql
      const ahora = this.ahora()
      if (fuenteBloqueada(sql, fuenteOk, ahora)) return { tipo: 'limitado' }

      const fila = partes ? sql.exec('SELECT * FROM codigos_organizador WHERE id = ?', partes.id).toArray()[0] : null
      if (!fila) { registrarFalloFuente(sql, fuenteOk, ahora); return FALLO }
      if (fila.bloqueado_hasta !== null && ahora < fila.bloqueado_hasta) { registrarFalloFuente(sql, fuenteOk, ahora); return FALLO }

      if (!hashesIguales(hashPresentado, fila.secreto_hash)) {
        const n = despuesDeFalloDeCodigo({ fallos: fila.fallos, bloqueos: fila.bloqueos }, ahora)
        sql.exec('UPDATE codigos_organizador SET fallos = ?, bloqueos = ?, bloqueado_hasta = ? WHERE id = ?', n.fallos, n.bloqueos, n.bloqueadoHasta, fila.id)
        registrarFalloFuente(sql, fuenteOk, ahora)
        return FALLO
      }

      const org = sql.exec('SELECT id, activo FROM organizadores WHERE id = ?', fila.organizador_id).toArray()[0]
      if (fila.revocado_en !== null || ahora >= fila.expira_en || !org || org.activo !== 1) return FALLO

      sql.exec('UPDATE codigos_organizador SET fallos = 0, bloqueos = 0, bloqueado_hasta = NULL, usos = usos + 1 WHERE id = ?', fila.id)
      // Máximo de sesiones simultáneas: si ya hay MAX_SESIONES vivas, se cierra la menos usada recientemente.
      const vivas = sql.exec(
        'SELECT id FROM sesiones WHERE revocada_en IS NULL AND ? < expira_idle AND ? < expira_abs ORDER BY ultimo_uso ASC',
        ahora, ahora,
      ).toArray()
      for (let i = 0; i <= vivas.length - MAX_SESIONES; i += 1) {
        sql.exec("UPDATE sesiones SET revocada_en = ?, motivo = 'maximo' WHERE id = ?", ahora, vivas[i].id)
      }
      const expiraIdle = ahora + DURACIONES.sesionIdle
      const expiraAbs = ahora + DURACIONES.sesionAbsoluta
      sql.exec(
        `INSERT INTO sesiones (id, secreto_hash, organizador_id, codigo_id, creada_en, ultimo_uso, expira_idle, expira_abs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        idSesion, hashSesion, org.id, fila.id, ahora, ahora, expiraIdle, expiraAbs,
      )
      this.#auditar('sesion-iniciada', { organizadorId: org.id, sesionId: idSesion }, ahora)
      return { tipo: 'ok', cookie: `${idSesion}.${secretoSesion}`, expiraIdle, expiraAbs }
    })
  }

  // --- Validación de una sesión: ESTE es el punto de decisión de autorización del organizador -----------------

  /** → afirmación { organizadorId, sesionId, ligas, validadoEn, expiraIdle, expiraAbs } | null */
  async validarSesion({ cookie }) {
    const m = typeof cookie === 'string' && cookie.length <= 128 ? COOKIE.exec(cookie) : null
    if (!m) return null
    const hash = await hashSecreto('sesion', m[2])
    return this.almacen.transactionSync(() => {
      const sql = this.almacen.sql
      const ahora = this.ahora()
      const s = sql.exec('SELECT * FROM sesiones WHERE id = ?', m[1]).toArray()[0]
      if (!s || !hashesIguales(hash, s.secreto_hash)) return null
      if (s.revocada_en !== null || ahora >= s.expira_abs || ahora >= s.expira_idle) return null
      const org = sql.exec('SELECT id, activo FROM organizadores WHERE id = ?', s.organizador_id).toArray()[0]
      if (!org || org.activo !== 1) return null

      let expiraIdle = s.expira_idle
      if (ahora - s.ultimo_uso >= REFRESCO_USO_SESION_MS) {
        expiraIdle = ahora + DURACIONES.sesionIdle
        sql.exec('UPDATE sesiones SET ultimo_uso = ?, expira_idle = ? WHERE id = ?', ahora, expiraIdle, s.id)
      }
      const ligas = sql.exec('SELECT liga_id FROM propiedad WHERE organizador_id = ? ORDER BY liga_id', org.id).toArray().map((r) => r.liga_id)
      return { organizadorId: org.id, sesionId: s.id, ligas, validadoEn: ahora, expiraIdle, expiraAbs: s.expira_abs }
    })
  }

  cerrarSesion({ sesionId }) {
    return this.almacen.transactionSync(() => {
      const ahora = this.ahora()
      this.almacen.sql.exec("UPDATE sesiones SET revocada_en = ?, motivo = 'salida' WHERE id = ? AND revocada_en IS NULL", ahora, sesionId)
      this.#auditar('sesion-cerrada', { sesionId }, ahora)
      return { ok: true }
    })
  }
}
