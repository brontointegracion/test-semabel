import { describe, expect, it } from 'vitest'
import { ejecutar } from '../../src/lib/motor/orquestador.js'
import { contenidosIguales, crearAdaptadorLiga } from '../src/adaptador-liga.js'
import { clasificarFallo } from '../src/clasificacion.js'
import { aRespuesta } from '../src/respuestas.js'
import { nuevaLiga } from './fixtures/sintetico.js'
import { T0, conteos, dentro, ligaSembrada } from './ayuda.js'

// EVIDENCIA DE REVERSIÓN POR CONTENIDO. La garantía de reversión la da transactionSync (la plataforma). Lo que se
// comprueba aquí es lo OBSERVADO tras un fallo: rev, cursor, recuentos, el estado_json exacto y el JSON exacto de los
// eventos que la orden va a actualizar. No demuestra el contenido de toda la base ni la durabilidad en producción.

const REVERTIDO = {
  tipo: 'fallo-sin-escritura', esteIntento: 'sin-escritura', alcance: 'solo-este-intento',
  motivo: 'reversion-verificada', reintento: 'mismo-sobre',
}
const SIN_ESCRIBIR = { ...REVERTIDO, motivo: 'interno' }
const DESCONOCIDO = { tipo: 'resultado-desconocido', reintento: 'mismo-sobre' }
const D = { equipoId: 'E1', jugadorId: 'J1' }
const leer = async (r) => ({ status: r.status, cuerpo: await r.json() })

// Todo lo persistido del partido P, fila por fila y con su contenido exacto.
const volcado = (ligaId) => dentro(ligaId, (inst) => {
  const t = (q) => inst.almacen.sql.exec(q).toArray()
  return JSON.stringify({
    partido: t("SELECT * FROM partidos WHERE id = 'P'"),
    recibos: t("SELECT * FROM recibos WHERE partido_id = 'P' ORDER BY cmd_id"),
    eventos: t("SELECT * FROM eventos WHERE partido_id = 'P' ORDER BY id"),
    auditoria: t("SELECT * FROM auditoria_reloj WHERE partido_id = 'P' ORDER BY seq"),
    bandeja: t("SELECT * FROM bandeja WHERE partido_id = 'P' ORDER BY id"),
    cuarentena: t("SELECT * FROM cuarentena WHERE partido_id = 'P' ORDER BY id"),
  })
})
const filaCruda = (ligaId, consulta, ...args) => dentro(ligaId, (inst) => inst.almacen.sql.exec(consulta, ...args).one())
const estadoJson = (ligaId) => filaCruda(ligaId, "SELECT estado_json AS v FROM partidos WHERE id = 'P'").then((f) => f.v)
const eventoJson = (ligaId, id) => filaCruda(ligaId, "SELECT json AS v FROM eventos WHERE partido_id = 'P' AND id = ?", id).then((f) => f.v)

const instalarFallo = (ligaId) => dentro(ligaId, (inst) => inst.almacen.sql.exec(
  "CREATE TRIGGER fallo_bandeja BEFORE INSERT ON bandeja BEGIN SELECT RAISE(ABORT, 'detalle-sql-interno'); END",
).toArray())
const quitarFallo = (ligaId) => dentro(ligaId, (inst) => inst.almacen.sql.exec('DROP TRIGGER IF EXISTS fallo_bandeja').toArray())

/** Partido en juego con dos anotaciones (dos eventos que las órdenes de corrección pueden actualizar). */
async function partidoConEventos() {
  const liga = await ligaSembrada(nuevaLiga())
  const { P } = liga
  await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
  await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
  const a = await P.mandar('anotar', { ...D, puntos: 2 }, { t: T0 + 3000 })
  const b = await P.mandar('anotar', { ...D, puntos: 3 }, { t: T0 + 4000 })
  return { ...liga, idA: a.sobre.cmdId, idB: b.sobre.cmdId }
}

// Ejecuta un comando contra un almacenamiento DISTINTO del real (para simular fallos de la plataforma) y clasifica.
const correrConAlmacen = (ligaId, sobre, token, recibidoEn, fabricar) => dentro(ligaId, async (inst) => {
  const adaptador = crearAdaptadorLiga({ storage: fabricar(inst.almacen) })
  const ejecucion = adaptador.paraEjecucion()
  try {
    return aRespuesta(await ejecutar(ejecucion, sobre, { recibidoEn, credencial: token }))
  } catch (error) {
    return clasificarFallo(error, ejecucion.traza)
  }
})

describe('1. reversión real en workerd tras UPDATE eventos (deshacer, rehacer, anular)', () => {
  const casos = [
    ['deshacer', 'deshacer', () => ({}), (ctx) => ctx.idB],
    ['rehacer', 'rehacer', () => ({}), (ctx) => ctx.idB],
    ['anular-evento', 'anular-evento', (ctx) => ({ eventoId: ctx.idA }), (ctx) => ctx.idA],
  ]
  it('cada corrección que falla al final deja IDÉNTICOS estado_json, el evento, recibos, cursor y bandeja; el mismo sobre se aplica después', async () => {
    const ctx = await partidoConEventos()
    const { ligaId, P } = ctx
    let t = T0 + 5000
    for (const [nombre, tipo, datos, eventoAfectado] of casos) {
      t += 1000
      const sobre = await P.sobre(tipo, datos(ctx), { t })
      const idEvento = eventoAfectado(ctx)
      const antes = await volcado(ligaId)
      const eventoAntes = await eventoJson(ligaId, idEvento)
      const estadoAntes = await estadoJson(ligaId)
      const contadoresAntes = await conteos(ligaId, 'P')

      await instalarFallo(ligaId) // falla en el ÚLTIMO paso, después del UPDATE eventos
      const r = await leer(await P.enviar(sobre))
      await quitarFallo(ligaId)

      expect(r, nombre).toEqual({ status: 500, cuerpo: REVERTIDO })
      expect(await eventoJson(ligaId, idEvento), nombre).toBe(eventoAntes) // JSON exacto del evento
      expect(await estadoJson(ligaId), nombre).toBe(estadoAntes) // estado_json exacto
      expect(await conteos(ligaId, 'P'), nombre).toEqual(contadoresAntes) // recibos, cursor, bandeja…
      expect(await volcado(ligaId), nombre).toBe(antes) // y todas las filas, tal cual

      // El mismo sobre (mismo cmdId) se aplica después: la orden SÍ actualiza ese evento, así que el fallo
      // ocurrió después de un UPDATE real que la reversión tuvo que deshacer.
      const ok = await leer(await P.enviar(sobre))
      expect(ok.cuerpo.resultado, nombre).toBe('aceptado')
      expect(await eventoJson(ligaId, idEvento), nombre).not.toBe(eventoAntes)
    }
  })
})

describe('2 y 3. reversión PARCIAL simulada: recuentos, rev y cursor restaurados, contenido alterado', () => {
  // transactionSync sin atomicidad que, al fallar, restaura todo salvo lo indicado en `conservar`.
  const reversionParcial = (conservar) => (almacen) => {
    const sql = almacen.sql
    const todas = (q) => sql.exec(q).toArray()
    const insertar = (tabla, fila) => {
      const cols = Object.keys(fila)
      sql.exec(`INSERT INTO ${tabla} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => fila[c])).toArray()
    }
    return {
      sql,
      transactionSync(fn) {
        const foto = {
          recibos: todas("SELECT * FROM recibos WHERE partido_id = 'P'"),
          bandeja: todas("SELECT * FROM bandeja WHERE partido_id = 'P'"),
          auditoria: todas("SELECT * FROM auditoria_reloj WHERE partido_id = 'P'"),
          eventos: todas("SELECT * FROM eventos WHERE partido_id = 'P'"),
          partido: sql.exec("SELECT * FROM partidos WHERE id = 'P'").one(),
        }
        try {
          return fn()
        } catch (error) {
          // La restauración también inserta en bandeja: el disparador de fallo de la prueba no debe bloquearla.
          sql.exec('DROP TRIGGER IF EXISTS fallo_bandeja').toArray()
          for (const [tabla, filas] of [['recibos', foto.recibos], ['bandeja', foto.bandeja], ['auditoria_reloj', foto.auditoria]]) {
            sql.exec(`DELETE FROM ${tabla} WHERE partido_id = 'P'`).toArray()
            for (const f of filas) insertar(tabla, f)
          }
          if (conservar === 'eventos') {
            // quita lo insertado, pero deja las filas existentes con el contenido alterado
            const ids = new Set(foto.eventos.map((e) => e.id))
            for (const e of todas("SELECT id FROM eventos WHERE partido_id = 'P'")) if (!ids.has(e.id)) sql.exec("DELETE FROM eventos WHERE partido_id = 'P' AND id = ?", e.id).toArray()
          } else {
            sql.exec("DELETE FROM eventos WHERE partido_id = 'P'").toArray()
            for (const f of foto.eventos) insertar('eventos', f)
          }
          sql.exec('UPDATE partidos SET rev = ?, ultimo_client_seq = ? WHERE id = ?', foto.partido.rev, foto.partido.ultimo_client_seq, 'P').toArray()
          if (conservar !== 'estado') sql.exec('UPDATE partidos SET estado_json = ? WHERE id = ?', foto.partido.estado_json, 'P').toArray()
          throw error
        }
      },
    }
  }

  it('2. un evento existente queda alterado: el recuento, rev y cursor coinciden, pero la clasificación sigue siendo desconocida', async () => {
    const ctx = await partidoConEventos()
    const { ligaId, P } = ctx
    const sobre = await P.sobre('deshacer', {}, { t: T0 + 6000 })
    const contadoresAntes = await conteos(ligaId, 'P')
    const eventoAntes = await eventoJson(ligaId, ctx.idB)
    const estadoAntes = await estadoJson(ligaId)

    await instalarFallo(ligaId)
    const r = await correrConAlmacen(ligaId, sobre, P.token, T0 + 6000, reversionParcial('eventos'))
    await quitarFallo(ligaId)

    // precondición: la simulación dejó EXACTAMENTE lo que las comprobaciones antiguas no ven
    expect(await conteos(ligaId, 'P')).toEqual(contadoresAntes)
    expect(await estadoJson(ligaId)).toBe(estadoAntes)
    expect(await eventoJson(ligaId, ctx.idB)).not.toBe(eventoAntes)
    // y por eso NO se afirma "sin escritura"
    expect(r).toEqual({ status: 503, cuerpo: DESCONOCIDO })
  })

  it('3. el estado_json queda alterado: igual, la clasificación sigue siendo desconocida', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const sobre = await P.sobre('arrancar-reloj', {}, { t: T0 + 2000 }) // esta orden SÍ cambia el estado_json
    const contadoresAntes = await conteos(ligaId, 'P')
    const estadoAntes = await estadoJson(ligaId)

    await instalarFallo(ligaId)
    const r = await correrConAlmacen(ligaId, sobre, P.token, T0 + 2000, reversionParcial('estado'))
    await quitarFallo(ligaId)

    expect(await conteos(ligaId, 'P')).toEqual(contadoresAntes)
    expect(await estadoJson(ligaId)).not.toBe(estadoAntes)
    expect(r).toEqual({ status: 503, cuerpo: DESCONOCIDO })
  })
})

describe('4. fallos al capturar o al comprobar los valores originales', () => {
  // Almacenamiento real, con una lectura de SQL que falla en el momento indicado.
  const conLecturaQueFalla = (falla) => (almacen) => ({
    sql: { exec: (consulta, ...args) => { falla(consulta); return almacen.sql.exec(consulta, ...args) } },
    transactionSync: (fn) => almacen.transactionSync(fn),
  })
  const CAPTURA_ESTADO = 'estado_json AS valor'
  const CAPTURA_EVENTO = 'json AS valor FROM eventos'

  it('4a. falla la captura del estado_json ANTES de la primera mutación: fallo conocido sin escritura', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    const antes = await volcado(ligaId)
    const r = await correrConAlmacen(ligaId, sobre, P.token, T0 + 1000, conLecturaQueFalla((q) => {
      if (q.includes(CAPTURA_ESTADO)) throw new Error('detalle interno de captura')
    }))
    expect(r).toEqual({ status: 500, cuerpo: SIN_ESCRIBIR })
    expect(await volcado(ligaId)).toBe(antes) // no se llegó a escribir nada
  })

  it('4b. falla la captura del JSON de un evento que se iba a actualizar: también antes de escribir', async () => {
    const ctx = await partidoConEventos()
    const { ligaId, P } = ctx
    const sobre = await P.sobre('deshacer', {}, { t: T0 + 6000 })
    const antes = await volcado(ligaId)
    const r = await correrConAlmacen(ligaId, sobre, P.token, T0 + 6000, conLecturaQueFalla((q) => {
      if (q.includes(CAPTURA_EVENTO)) throw new Error('detalle interno de captura')
    }))
    expect(r).toEqual({ status: 500, cuerpo: SIN_ESCRIBIR })
    expect(await volcado(ligaId)).toBe(antes)
  })

  it('4c. falla la COMPROBACIÓN posterior (ya se había empezado a escribir): no se afirma nada, aunque la reversión haya sido real', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    const antes = await volcado(ligaId)
    await instalarFallo(ligaId)
    let capturas = 0
    const r = await correrConAlmacen(ligaId, sobre, P.token, T0 + 1000, conLecturaQueFalla((q) => {
      if (q.includes(CAPTURA_ESTADO)) { capturas += 1; if (capturas === 2) throw new Error('detalle interno de comprobación') }
    }))
    await quitarFallo(ligaId)
    expect(capturas).toBe(2) // la primera captura (antes) funcionó; la segunda (comprobación) falló
    expect(r).toEqual({ status: 503, cuerpo: DESCONOCIDO })
    expect(await volcado(ligaId)).toBe(antes) // la plataforma sí deshizo: pero no se pudo comprobar, así que no se afirma
  })

  it('4d. fila ausente y valor nulo son cosas distintas, y cualquier diferencia de contenido o de filas vigiladas se detecta', () => {
    const c = (existe, valor) => ({ existe, valor })
    const base = () => ({ estado: c(true, '{"a":1}'), eventos: new Map([['e1', c(true, '{"x":1}')]]) })
    expect(contenidosIguales(base(), base())).toBe(true)
    expect(contenidosIguales({ ...base(), estado: c(false, null) }, { ...base(), estado: c(true, null) })).toBe(false) // ausente ≠ nulo
    expect(contenidosIguales({ ...base(), estado: c(true, null) }, { ...base(), estado: c(true, null) })).toBe(true)
    expect(contenidosIguales(base(), { ...base(), estado: c(true, '{"a":2}') })).toBe(false) // un solo carácter distinto
    expect(contenidosIguales(base(), { ...base(), eventos: new Map([['e1', c(true, '{"x":2}')]]) })).toBe(false)
    expect(contenidosIguales(base(), { ...base(), eventos: new Map([['e1', c(false, null)]]) })).toBe(false) // el evento desapareció
    expect(contenidosIguales(base(), { ...base(), eventos: new Map([['e2', c(true, '{"x":1}')]]) })).toBe(false) // otro id
    expect(contenidosIguales(base(), { ...base(), eventos: new Map() })).toBe(false) // menos filas vigiladas
  })
})
