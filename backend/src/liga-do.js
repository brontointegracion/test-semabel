import { DurableObject } from 'cloudflare:workers'
import { ejecutar } from '../../src/lib/motor/orquestador.js'
import { generarCodigo, hashSecreto, partirCodigo } from './acceso/codigos.js'
import { fuenteBloqueada, registrarFalloFuente } from './acceso/limites.js'
import { crearAdaptadorLiga } from './adaptador-liga.js'
import { activar, crearCodigo, estadoControl, revocarControl } from './codigos-partido.js'
import { clasificarFallo } from './clasificacion.js'
import { crearEsquema } from './esquema.js'
import { leerPreparacionTelefono } from './lectura-preparacion.js'
import { LIMITES_ESTADO_CONTROL, leerEstadoControl } from './lectura-estado-control.js'
import { candidatosExternos, ejecutarOperacion, huellaDe, leerLiga, leerPlantilla, resolverFichaParaVinculo } from './plantilla.js'
import { LIMITES_EQUIPO_PUBLICO, leerEquipoPublico } from './proyeccion-equipo.js'
import { LIMITES_JUGADORES_PUBLICO, leerJugadoresPublico } from './proyeccion-jugadores.js'
import { ANOTACIONES_PUBLICAS, proyectarLigaPublica, proyectarPartidoPublico } from './proyeccion-publica.js'
import { nombrePublico } from './proyeccion-equipo.js'
import { leerDorsal } from '../../src/lib/dorsal.js'
import { cargarEquipos, cargarEstructura, cargarPartidos, huellaDeCarga } from './carga.js'
import { aRespuesta } from './respuestas.js'
import { LIMITES_REPARACION, repararResumenes, resumenValido } from './resumen-publico.js'
import { fijarRamas, huellaDeRamas } from './ramas-equipos.js'
import { huellaDeRenombre, renombrarLiga } from './renombre-liga.js'
import { huellaDeRetiro, restaurarPartidos, retirarPartidos } from './retiro-partidos.js'
import { sembrarLiga } from './semilla.js'

// ---------------------------------------------------------------------------
// Un Durable Object por liga: la frontera de consistencia. Aquí viven la plantilla,
// los partidos, eventos, recibos, cursores, autorización/bloqueo y la bandeja de salida,
// de modo que una edición de plantilla y el inicio de un partido de la liga se ordenan
// dentro del mismo objeto.
//
// Los métodos públicos son RPC (los llama worker.js) y devuelven { status, cuerpo }.
// ---------------------------------------------------------------------------

// Topes de la lectura pública de una liga (partidos y equipos). La lectura ya no recorre eventos: usa el resumen.
export const LIMITES_LECTURA_PUBLICA = Object.freeze({ partidos: 300, equipos: 100 })

const RESUMEN_NO_DISPONIBLE = Object.freeze({ status: 503, cuerpo: Object.freeze({ error: 'resumen-no-disponible' }) })

export class LigaDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.almacen = ctx.storage
    // El esquema es OBLIGATORIO: si falla, el objeto no abre (falla de forma segura, sin esconderlo). La reparación de
    // resúmenes es RECUPERABLE: nunca lanza ni impide abrir el objeto, así que no inhabilita las órdenes.
    ctx.blockConcurrencyWhile(async () => {
      crearEsquema(ctx.storage)
      this.repararResumenesAlArrancar()
    })
    this.adaptador = crearAdaptadorLiga({
      storage: ctx.storage,
      pausaTrasLeer: (sobre) => this.pausaTrasLeer(sobre),
      pausaTrasAutorizar: (info) => this.pausaTrasAutorizar(info),
      trasConfirmar: (info) => this.trasConfirmar(info),
      ahora: () => this.ahora(),
    })
  }

  /**
   * Reparación acotada de resúmenes públicos faltantes, de otra versión o de otra revisión (ver resumen-publico.js).
   * No lanza: un fallo deja `this.reparacion.estado = 'error'` y las lecturas públicas afectadas en 503.
   */
  repararResumenesAlArrancar() {
    try {
      this.reparacion = repararResumenes(this.almacen, { limites: this.limitesReparacion() })
    } catch {
      this.reparacion = { estado: 'error', reparados: 0, fallidos: [] }
    }
    return this.reparacion
  }

  /** Topes de esa reparación. Las pruebas los sustituyen; en producción son estos. */
  limitesReparacion() { return LIMITES_REPARACION }

  /** Hora del servidor. Las pruebas la sustituyen; en producción es el reloj real. */
  ahora() { return Date.now() }

  /** Punto de extensión para pruebas de concurrencia. No hace nada aquí. */
  async pausaTrasLeer() {}

  /** Punto de extensión para pruebas: entre la autorización consultiva y la lectura protegida. No hace nada aquí. */
  async pausaTrasAutorizar() {}

  /** Punto de extensión para pruebas: justo DESPUÉS de confirmar una orden. No hace nada aquí. */
  async trasConfirmar() {}

  async ejecutarComando({ credencial, sobre }) {
    // Un adaptador por ejecución: su traza dice qué llegó a confirmarse. La clasificación de un fallo se
    // apoya en ella y en errores tipados (clasificacion.js), nunca en el texto del error.
    const ejecucion = this.adaptador.paraEjecucion()
    try {
      const resultado = await ejecutar(ejecucion, sobre, { recibidoEn: this.ahora(), credencial })
      return aRespuesta(resultado)
    } catch (error) {
      return clasificarFallo(error, ejecucion.traza)
    }
  }

  async leerPublico(gameId) {
    const sql = this.almacen.sql
    const fila = (q, ...a) => sql.exec(q, ...a).toArray()[0] ?? null
    const p = fila(
      'SELECT id, liga_id, local_id, visita_id, estado_json, rev, programado_para, sede FROM partidos WHERE id = ? AND retirado_en IS NULL', gameId,
    )
    if (!p) return { status: 404, cuerpo: { error: 'no-encontrado' } }
    const liga = fila('SELECT id, nombre, deporte, categoria, subcategoria_json FROM ligas WHERE id = ?', p.liga_id)
    const local = fila('SELECT id, nombre FROM equipos WHERE id = ?', p.local_id)
    const visita = fila('SELECT id, nombre FROM equipos WHERE id = ?', p.visita_id)
    if (!liga || !local || !visita) return { status: 404, cuerpo: { error: 'no-encontrado' } }
    const resumen = fila('SELECT * FROM resumen_partido WHERE partido_id = ?', gameId)
    if (!resumenValido(resumen, p)) return RESUMEN_NO_DISPONIBLE
    return {
      status: 200,
      cuerpo: proyectarPartidoPublico({ fila: p, resumen, liga, local, visita, servidorAhoraMs: this.ahora(), anotaciones: this.anotacionesPublicas(p) }),
    }
  }

  /**
   * Últimas canastas confirmadas de un partido EN JUEGO (ver `anotaciones` en proyeccion-publica.js): una lectura acotada por el índice
   * (partido, seq) y a lo sumo ANOTACIONES_PUBLICAS lecturas de ficha por clave. Solo lectura; nada se guarda.
   */
  anotacionesPublicas(p) {
    let estado
    try { estado = JSON.parse(p.estado_json).partido?.estado } catch { return [] }
    if (estado !== 'vivo') return []
    const sql = this.almacen.sql
    const filas = sql.exec(
      `SELECT seq, json_extract(json, '$.equipoId') AS equipo_id, json_extract(json, '$.jugadorId') AS jugador_id, json_extract(json, '$.puntos') AS puntos
         FROM eventos WHERE partido_id = ? AND json_extract(json, '$.tipo') = 'punto' AND COALESCE(json_extract(json, '$.anulado'), 0) = 0
        ORDER BY seq DESC LIMIT ?`, p.id, ANOTACIONES_PUBLICAS,
    ).toArray()
    const salida = []
    for (const f of filas) {
      const lado = f.equipo_id === p.local_id ? 'local' : f.equipo_id === p.visita_id ? 'visita' : null
      if (lado === null || typeof f.jugador_id !== 'string' || !Number.isSafeInteger(f.puntos) || f.puntos < 1) continue
      const ficha = sql.exec('SELECT nombre, nombre_pila, apellido1, apellido2, dorsal FROM jugadores WHERE id = ?', f.jugador_id).toArray()[0]
      const nombre = ficha ? nombrePublico(ficha) : null
      if (nombre === null) continue
      const d = leerDorsal(ficha.dorsal)
      salida.push({ seq: f.seq, lado, puntos: f.puntos, jugador: { nombre, dorsalActual: d.tipo === 'real' ? d.valor : null } })
    }
    return salida
  }

  /**
   * Lectura pública de TODA la liga (ver proyeccion-publica.js). Estrategia: 3 consultas por petición, ninguna por partido
   * y NINGUNA sobre `eventos`: la liga, los equipos y los partidos con su resumen (un LEFT JOIN por clave primaria). Con
   * topes explícitos (`LIMIT tope+1`): si la liga los rebasa se responde un error acotado, nunca una lista truncada. Si el
   * resumen de ALGÚN partido falta o no corresponde a su revisión/equipos vigentes, 503 para toda la lectura: no se
   * omite el partido, no se publica un marcador viejo y NO se reconstruye nada en la petición.
   */
  async leerPublicoLiga() {
    const sql = this.almacen.sql
    const limites = this.limitesLecturaPublica()
    const liga = sql.exec('SELECT id, nombre, deporte, categoria, subcategoria_json FROM ligas').toArray()[0] ?? null
    if (!liga) return { status: 404, cuerpo: { error: 'no-encontrado' } }
    const demasiado = () => ({ status: 507, cuerpo: { error: 'liga-demasiado-grande' } })
    const equipos = sql.exec('SELECT id, nombre, rama FROM equipos ORDER BY id LIMIT ?', limites.equipos + 1).toArray()
    if (equipos.length > limites.equipos) return demasiado()
    const filas = sql.exec(
      `SELECT p.id, p.local_id, p.visita_id, p.estado_json, p.rev, p.programado_para, p.sede,
              r.partido_id AS r_partido_id, r.local_id AS r_local_id, r.visita_id AS r_visita_id, r.local_puntos, r.visita_puntos,
              r.local_faltas, r.visita_faltas, r.periodo, r.rev_fuente, r.version_proyeccion
         FROM partidos p LEFT JOIN resumen_partido r ON r.partido_id = p.id
       WHERE p.retirado_en IS NULL
        ORDER BY p.programado_para IS NULL, p.programado_para, p.id LIMIT ?`,
      limites.partidos + 1,
    ).toArray()
    if (filas.length > limites.partidos) return demasiado()
    const partidos = []
    for (const f of filas) {
      const resumen = f.r_partido_id === null ? null : { ...f, local_id: f.r_local_id, visita_id: f.r_visita_id }
      if (!resumenValido(resumen, { rev: f.rev, local_id: f.local_id, visita_id: f.visita_id })) return RESUMEN_NO_DISPONIBLE
      partidos.push({ fila: f, resumen })
    }
    return { status: 200, cuerpo: proyectarLigaPublica({ liga, equipos, partidos, servidorAhoraMs: this.ahora() }) }
  }

  /** Lectura pública de un equipo: plantilla activa, resultados finales y estadísticas básicas (ver proyeccion-equipo.js). */
  async leerEquipoPublico(equipoId) {
    return leerEquipoPublico(this.almacen.sql, equipoId, this.limitesEquipoPublico(), this.ahora())
  }

  /** Rankings públicos de jugadores de toda la liga, de partidos finales (ver proyeccion-jugadores.js). */
  async leerJugadoresPublico() {
    return leerJugadoresPublico(this.almacen.sql, this.limitesJugadoresPublico(), this.ahora())
  }

  /** Topes de esa lectura. Las pruebas los sustituyen; en producción son LIMITES_JUGADORES_PUBLICO. */
  limitesJugadoresPublico() { return LIMITES_JUGADORES_PUBLICO }

  /** Topes de esa lectura. Las pruebas los sustituyen; en producción son LIMITES_EQUIPO_PUBLICO. */
  limitesEquipoPublico() { return LIMITES_EQUIPO_PUBLICO }

  /** Topes de esa lectura. Las pruebas los sustituyen; en producción son estos. */
  limitesLecturaPublica() { return LIMITES_LECTURA_PUBLICA }

  async sembrar(payload) {
    const r = await sembrarLiga(this.almacen, payload)
    if (r.ok) return { status: 201, cuerpo: { ok: true } }
    if (r.yaSembrada) return { status: 409, cuerpo: { error: 'ya-sembrada' } }
    return { status: 422, cuerpo: { error: 'payload-invalido', errores: r.errores } }
  }

  // --- Carga del operador (ver carga.js): la huella es asíncrona y se calcula ANTES de la transacción sincrónica ---------------

  async cargarEstructuraOperador({ ligaId, normalizado }) {
    const huella = await huellaDeCarga('estructura', ligaId, normalizado)
    return cargarEstructura(this.almacen, { normalizado, huella, ahora: this.ahora() })
  }

  async cargarEquiposOperador({ ligaId, normalizado }) {
    const huella = await huellaDeCarga('equipos', ligaId, normalizado)
    return cargarEquipos(this.almacen, { ligaId, normalizado, huella, ahora: this.ahora() })
  }

  async cargarPartidosOperador({ ligaId, normalizado }) {
    const huella = await huellaDeCarga('partidos', ligaId, normalizado)
    return cargarPartidos(this.almacen, { ligaId, normalizado, huella, ahora: this.ahora() })
  }

  // --- Retiro y restauración de partidos (operador; ver retiro-partidos.js). La huella se calcula ANTES de la transacción ---------

  async retirarPartidosOperador({ ligaId, normalizado }) {
    const huella = await huellaDeRetiro('retiro', ligaId, normalizado)
    return retirarPartidos(this.almacen, { ligaId, normalizado, huella, ahora: this.ahora() })
  }

  async restaurarPartidosOperador({ ligaId, normalizado }) {
    const huella = await huellaDeRetiro('restauracion', ligaId, normalizado)
    return restaurarPartidos(this.almacen, { ligaId, normalizado, huella, ahora: this.ahora() })
  }

  /** Fija la rama de equipos YA existentes (operador; ver ramas-equipos.js): solo NULL → valor, en UNA transacción. La huella se calcula ANTES. */
  async fijarRamasOperador({ ligaId, normalizado }) {
    const huella = await huellaDeRamas(ligaId, normalizado)
    return fijarRamas(this.almacen, { ligaId, normalizado, huella, ahora: this.ahora() })
  }

  /** Renombra la liga (operador; ver renombre-liga.js): SOLO `ligas.nombre`, en UNA transacción. La huella se calcula ANTES. */
  async renombrarLigaOperador({ ligaId, normalizado }) {
    const huella = await huellaDeRenombre(ligaId, normalizado)
    return renombrarLiga(this.almacen, { ligaId, normalizado, huella, ahora: this.ahora() })
  }

  // --- Acceso por códigos -------------------------------------------------------------------------------------------
  // Las operaciones del organizador reciben la AFIRMACIÓN que el Worker obtuvo del objeto de acceso. Cada una
  // comprueba su hora como primera sentencia de su transacción (ver acceso/asercion.js). Devuelven valores simples;
  // el Worker los traduce a HTTP. Nunca se registran ni se devuelven secretos salvo el código recién emitido.

  async crearCodigoPartido({ asercion, ligaId, partidoId }) {
    for (let intento = 0; intento < 3; intento += 1) {
      const codigo = generarCodigo()
      const secretoHash = await hashSecreto('partido', codigo.secreto)
      try {
        const r = crearCodigo(this.almacen, { asercion, ligaId, partidoId, codigoId: codigo.id, secretoHash, ahoraFn: () => this.ahora() })
        return r.tipo === 'ok' ? { tipo: 'ok', codigo: codigo.texto, expiraEn: r.expiraEn } : r
      } catch (error) {
        if (!String(error?.message).includes('UNIQUE')) throw error // solo un choque improbable de identificador se reintenta
      }
    }
    throw new Error('codigo-no-emitido')
  }

  revocarControlDePartido({ asercion, ligaId, partidoId }) {
    return revocarControl(this.almacen, { asercion, ligaId, partidoId, ahoraFn: () => this.ahora() })
  }

  estadoControlDePartido({ asercion, ligaId, partidoId }) {
    return estadoControl(this.almacen, { asercion, ligaId, partidoId, ahoraFn: () => this.ahora() })
  }

  async activarPartido({ partidoId, codigo, tokenHash, fuente }) {
    const fuenteOk = typeof fuente === 'string' && fuente.length > 0 && fuente.length <= 128 ? fuente : 'desconocida'
    const partes = partirCodigo(codigo)
    if (!partes) {
      return this.almacen.transactionSync(() => {
        const ahora = this.ahora()
        if (fuenteBloqueada(this.almacen.sql, fuenteOk, ahora)) return { tipo: 'limitado' }
        registrarFalloFuente(this.almacen.sql, fuenteOk, ahora)
        return { tipo: 'no-autorizado' }
      })
    }
    const secretoHash = await hashSecreto('partido', partes.secreto)
    return activar(this.almacen, { partidoId, codigoId: partes.id, secretoHash, tokenHash, fuente: fuenteOk, ahoraFn: () => this.ahora() })
  }

  // --- Plantilla compartida (organizador) ---------------------------------------------------------------------------
  // Cada método comprueba la afirmación como primera sentencia de su transacción sincrónica (ver plantilla.js).

  leerLigaOrganizador({ asercion, ligaId }) {
    return leerLiga(this.almacen, { asercion, ligaId, ahoraFn: () => this.ahora() })
  }

  leerPlantillaOrganizador({ asercion, ligaId, equipoId }) {
    return leerPlantilla(this.almacen, { asercion, ligaId, equipoId, ahoraFn: () => this.ahora() })
  }

  /** Lectura de ESTA liga pedida desde otra del mismo organizador: candidatos por clave de nombre (solo sugiere). */
  candidatosParaOtraLiga({ asercion, ligaId, clave }) {
    return candidatosExternos(this.almacen, { asercion, ligaId, clave, ahoraFn: () => this.ahora() })
  }

  /** Lectura de ESTA liga pedida desde otra del mismo organizador: la ficha y su persona, para un vínculo explícito. */
  resolverFichaParaOtraLiga({ asercion, ligaId, fichaId }) {
    return resolverFichaParaVinculo(this.almacen, { asercion, ligaId, fichaId, ahoraFn: () => this.ahora() })
  }

  /**
   * Una operación de plantilla. La huella se calcula ANTES (el hash es asíncrono); la transacción es sincrónica.
   * `verificacion` solo la arma el Worker; nunca viene del cliente.
   */
  async ejecutarOperacionPlantilla({ asercion, ligaId, tipo, equipoId, fichaId = null, operacionId, contenido, verificacion = null }) {
    const huella = await huellaDe({ ligaId, tipo, equipoId, fichaId, contenido })
    return ejecutarOperacion(this.almacen, {
      asercion, ligaId, tipo, equipoId, fichaId, operacionId, huella, contenido, verificacion, ahoraFn: () => this.ahora(),
    })
  }

  // --- Preparación del teléfono ------------------------------------------------------------------------------------

  leerPreparacion({ credencial, gameId }) {
    return leerPreparacionTelefono({ storage: this.almacen, adaptador: this.adaptador, credencial, gameId, ahoraFn: () => this.ahora() })
  }

  // --- Estado autoritativo para el teléfono que controla el partido ---------------------------------------------------

  leerEstadoControl({ credencial, gameId }) {
    return leerEstadoControl({
      storage: this.almacen, adaptador: this.adaptador, credencial, gameId, ahoraFn: () => this.ahora(),
      limites: this.limitesEstadoControl(), pausaTrasResumir: () => this.pausaTrasResumirEstado(),
    })
  }

  /** Topes provisionales de disponibilidad de esa lectura. Las pruebas los sustituyen; en producción son estos. */
  limitesEstadoControl() { return LIMITES_ESTADO_CONTROL }

  /** Punto de extensión para pruebas: entre el resumen del token y la lectura protegida. No hace nada aquí. */
  async pausaTrasResumirEstado() {}
}
