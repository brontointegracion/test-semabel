import { afterEach, describe, expect, it } from 'vitest'
import { exports } from 'cloudflare:workers'
import { VERSION_ESQUEMA, crearEsquema } from '../src/esquema.js'
import { contenidosIguales } from '../src/adaptador-liga.js'
import { LIMITES_REPARACION, VERSION_PROYECCION, repararResumenes, resumenValido, resumirPartido } from '../src/resumen-publico.js'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import { T0, conteos, dentro, fijarEstadoDePartido, json, leerPartido, ligaSembrada, sembrar, sqlDe } from './ayuda.js'
import {
  almacenMedido, ejecutarMedido, escribeResumen, esperadoDeEventos, filaResumenCruda, llamarMedido,
  reconstruirResumenesDePrueba, resumenGuardado, tocaResumen,
} from './ayuda-resumen.js'
import { control } from './worker-prueba.js'
import { crearAdaptadorLiga } from '../src/adaptador-liga.js'
import { ejecutar } from '../../src/lib/motor/orquestador.js'
import { clasificarFallo } from '../src/clasificacion.js'
import { aRespuesta } from '../src/respuestas.js'

// RESUMEN PÚBLICO ALMACENADO (resumen_partido): derivado, atómico con cada orden aceptada y reparable. Todo sintético.

const BASE = 'https://backend.local'
const leerLiga = (ligaId) => exports.default.fetch(new Request(`${BASE}/v1/ligas/${ligaId}/publico`))
const D1 = { equipoId: 'E1', jugadorId: 'J1' }
const D2 = { equipoId: 'E2', jugadorId: 'J9' }
const REVERTIDO = {
  tipo: 'fallo-sin-escritura', esteIntento: 'sin-escritura', alcance: 'solo-este-intento', motivo: 'reversion-verificada', reintento: 'mismo-sobre',
}
const SIN_ESCRIBIR = { ...REVERTIDO, motivo: 'interno' }
const DESCONOCIDO = { tipo: 'resultado-desconocido', reintento: 'mismo-sobre' }
const NO_DISPONIBLE = { error: 'resumen-no-disponible' }

afterEach(() => { control.limitesReparacion = null })

const coincide = (guardado, esperado) => {
  expect(guardado).not.toBeNull()
  expect({ ...guardado, version: undefined }).toEqual({ ...esperado, version: undefined })
  expect(guardado.version).toBe(VERSION_PROYECCION)
}
/** El resumen guardado, la lectura de la liga y la del partido coinciden con lo derivado de los eventos autoritativos. */
async function verificarTodo(ligaId, gameId = 'P') {
  const esperado = await esperadoDeEventos(ligaId, gameId)
  coincide(await resumenGuardado(ligaId, gameId), esperado)
  const juego = await json(await leerPartido(ligaId, gameId))
  const enLiga = (await json(await leerLiga(ligaId))).partidos.find((x) => x.gameId === gameId)
  for (const v of [juego, enLiga]) {
    expect(v.rev).toBe(esperado.rev)
    expect(v.periodo).toBe(esperado.periodo)
    expect(v.local.puntos).toBe(esperado.localPuntos)
    expect(v.visita.puntos).toBe(esperado.visitaPuntos)
    expect(v.local.faltas).toBe(esperado.localFaltas)
    expect(v.visita.faltas).toBe(esperado.visitaFaltas)
  }
  return esperado
}

describe('1. derivación y paridad con los eventos autoritativos, orden por orden', () => {
  it('la derivación es la de las cuentas del marcador (anulados no cuentan, periodo con tope)', () => {
    const ev = (tipo, equipoId, puntos, anulado = false) => ({ tipo, equipoId, puntos, anulado })
    const r = resumirPartido({
      eventos: [ev('punto', 'A', 3), ev('punto', 'B', 2), ev('punto', 'A', 2, true), ev('falta', 'A', 0), ev('falta', 'B', 0, true), ev('periodo', undefined, 0), ev('periodo', undefined, 0, true)],
      localId: 'A', visitaId: 'B', deporte: 'baloncesto',
    })
    expect(r).toEqual({ localId: 'A', visitaId: 'B', localPuntos: 3, visitaPuntos: 2, localFaltas: 1, visitaFaltas: 0, periodo: 2 })
    const muchos = Array.from({ length: 9 }, () => ev('periodo', undefined, 0))
    expect(resumirPartido({ eventos: muchos, localId: 'A', visitaId: 'B', deporte: 'baloncesto' }).periodo).toBe(4)
    expect(() => resumirPartido({ eventos: [ev('punto', 'A', 'x')], localId: 'A', visitaId: 'B', deporte: 'baloncesto' })).toThrow('resumen-invalido')
  })

  it('cada orden aceptada deja el resumen igual a lo derivado de los eventos (inicio, reloj, puntos, faltas, deshacer, rehacer, anular, corrección, periodo, cierre, correcciones tras el final)', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    let t = T0
    let anotacion3
    const paso = async (tipo, datos, esperadoExplicito) => {
      t += 1000
      const r = await P.mandar(tipo, datos, { t })
      expect(r.cuerpo.resultado, tipo).toBe('aceptado')
      const e = await verificarTodo(ligaId)
      if (esperadoExplicito) expect({ lp: e.localPuntos, vp: e.visitaPuntos, lf: e.localFaltas, vf: e.visitaFaltas, per: e.periodo }, tipo).toEqual(esperadoExplicito)
      return r
    }
    // Antes de la primera orden: el resumen sembrado (0-0, periodo 1, revisión 0).
    coincide(await resumenGuardado(ligaId, 'P'), await esperadoDeEventos(ligaId, 'P'))
    await paso('iniciar-partido', {}, { lp: 0, vp: 0, lf: 0, vf: 0, per: 1 })
    await paso('arrancar-reloj', {}, { lp: 0, vp: 0, lf: 0, vf: 0, per: 1 })
    anotacion3 = (await paso('anotar', { ...D1, puntos: 3 }, { lp: 3, vp: 0, lf: 0, vf: 0, per: 1 })).sobre.cmdId
    await paso('anotar', { ...D2, puntos: 2 }, { lp: 3, vp: 2, lf: 0, vf: 0, per: 1 })
    await paso('falta', D1, { lp: 3, vp: 2, lf: 1, vf: 0, per: 1 })
    await paso('falta', { equipoId: 'E1', jugadorId: 'J2' }, { lp: 3, vp: 2, lf: 2, vf: 0, per: 1 })
    await paso('deshacer', {}, { lp: 3, vp: 2, lf: 1, vf: 0, per: 1 })
    await paso('rehacer', {}, { lp: 3, vp: 2, lf: 2, vf: 0, per: 1 })
    await paso('anular-evento', { eventoId: anotacion3 }, { lp: 0, vp: 2, lf: 2, vf: 0, per: 1 })
    await paso('detener-reloj', {})
    await paso('corregir-reloj', { restanteMs: 120000 })
    await paso('siguiente-periodo', {}, { lp: 0, vp: 2, lf: 2, vf: 0, per: 2 })
    await paso('anotar', { equipoId: 'E2', jugadorId: 'J8', puntos: 3 }, { lp: 0, vp: 5, lf: 2, vf: 0, per: 2 })
    await paso('cerrar-partido', {}, { lp: 0, vp: 5, lf: 2, vf: 0, per: 2 })
    expect((await json(await leerPartido(ligaId, 'P'))).estado).toBe('final')
    // correcciones DESPUÉS del final
    await paso('deshacer', {}, { lp: 0, vp: 2, lf: 2, vf: 0, per: 2 })
    await paso('rehacer', {})
    const eventos = await sqlDe(ligaId, "SELECT id FROM eventos WHERE partido_id = 'P' AND json_extract(json, '$.tipo') = 'falta' ORDER BY seq")
    await paso('anular-evento', { eventoId: eventos[0].id })
    expect((await json(await leerPartido(ligaId, 'P'))).estado).toBe('final')
  })

  it('la parada automática (cero) actualiza el resumen como cualquier orden aceptada', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    await P.mandar('anotar', { ...D1, puntos: 2 }, { t: T0 + 2500 })
    await fijarEstadoDePartido(ligaId, 'P', { relojRestante: 1000 })
    const est = await P.estado()
    const r = await P.mandar('parada-automatica', { corridaSeq: est.corridaSeq }, { t: T0 + 3000, cmdId: `auto:P:${est.corridaSeq}` })
    expect(r.cuerpo.resultado).toBe('aceptado')
    const e = await verificarTodo(ligaId)
    expect(e.localPuntos).toBe(2)
    expect((await json(await leerPartido(ligaId, 'P'))).reloj).toMatchObject({ estado: 'detenido', restanteMs: 0 })
  })
})

describe('2. rechazos, reintentos duplicados y escrituras (sentencias medidas)', () => {
  it('una orden aceptada escribe el resumen EXACTAMENTE una vez y no lee la historia para ello; un reintento aceptado no escribe; un rechazo no cambia los totales', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })

    const sobre = await P.sobre('anotar', { ...D1, puntos: 2 }, { t: T0 + 3000 })
    const a = await ejecutarMedido(ligaId, sobre, P.token, T0 + 3010)
    expect(a.resp.cuerpo.resultado).toBe('aceptado')
    const escrituras = a.sentencias.filter(escribeResumen)
    expect(escrituras.length).toBe(1)
    expect(escrituras[0].consulta).toMatch(/^INSERT INTO resumen_partido .* ON CONFLICT\(partido_id\) DO UPDATE/)
    expect(a.sentencias.filter(tocaResumen).every((s) => !s.consulta.includes('eventos'))).toBe(true) // el resumen no consulta eventos
    const totalesTras = await resumenGuardado(ligaId, 'P')
    expect(totalesTras).toMatchObject({ localPuntos: 2, rev: 3 })

    // reintento del MISMO sobre: recibo existente, sin ninguna escritura del resumen y sin doble cuenta
    const crudoAntes = await filaResumenCruda(ligaId, 'P')
    const dup = await ejecutarMedido(ligaId, sobre, P.token, T0 + 3020)
    expect(dup.resp.cuerpo.resultado).toBe('recibo-existente')
    expect(dup.sentencias.filter(escribeResumen)).toEqual([])
    expect(dup.sentencias.some(tocaResumen)).toBe(false)
    expect(await filaResumenCruda(ligaId, 'P')).toBe(crudoAntes)
    expect((await resumenGuardado(ligaId, 'P')).localPuntos).toBe(2)

    // rechazo definitivo (puntos inválidos): guarda recibo, no toca el resumen
    const malo = await P.sobre('anotar', { ...D1, puntos: 5 }, { t: T0 + 4000 })
    const rech = await ejecutarMedido(ligaId, malo, P.token, T0 + 4010)
    expect(rech.resp.cuerpo.resultado).toBe('rechazado')
    expect(rech.sentencias.filter(escribeResumen)).toEqual([])
    expect(await filaResumenCruda(ligaId, 'P')).toBe(crudoAntes)
    expect((await conteos(ligaId, 'P')).recibos).toBe(4) // inicio, arrancar, anotar, rechazo
    await verificarTodo(ligaId)
  })
})

describe('3. un fallo al escribir el resumen deshace toda la orden', () => {
  const volcado = (ligaId) => dentro(ligaId, (inst) => {
    const t = (q) => inst.almacen.sql.exec(q).toArray()
    return JSON.stringify({
      partido: t("SELECT * FROM partidos WHERE id = 'P'"), recibos: t("SELECT * FROM recibos WHERE partido_id = 'P' ORDER BY cmd_id"),
      eventos: t("SELECT * FROM eventos WHERE partido_id = 'P' ORDER BY id"), auditoria: t("SELECT * FROM auditoria_reloj WHERE partido_id = 'P' ORDER BY seq"),
      bandeja: t("SELECT * FROM bandeja WHERE partido_id = 'P' ORDER BY id"), resumen: t("SELECT * FROM resumen_partido WHERE partido_id = 'P'"),
    })
  })
  const fallo = (ligaId, momento = 'UPDATE') => dentro(ligaId, (inst) => inst.almacen.sql.exec(
    `CREATE TRIGGER fallo_resumen BEFORE ${momento} ON resumen_partido BEGIN SELECT RAISE(ABORT, 'detalle-sql-interno'); END`,
  ).toArray())
  const sinFallo = (ligaId) => dentro(ligaId, (inst) => inst.almacen.sql.exec('DROP TRIGGER IF EXISTS fallo_resumen').toArray())

  it('el fallo del resumen deja IDÉNTICAS todas las filas (incluido el resumen), responde reversión verificada y el mismo sobre se acepta después una sola vez', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    const sobre = await P.sobre('anotar', { ...D1, puntos: 3 }, { t: T0 + 3000 })
    const antes = await volcado(ligaId)
    const publicoAntes = await json(await leerLiga(ligaId))
    await fallo(ligaId)
    const r = await P.enviar(sobre)
    await sinFallo(ligaId)
    expect(r.status).toBe(500)
    const cuerpo = await r.json()
    expect(cuerpo).toEqual(REVERTIDO)
    expect(JSON.stringify(cuerpo)).not.toContain('detalle-sql-interno')
    expect(await volcado(ligaId)).toBe(antes)
    // la lectura pública sigue siendo coherente y no cambió
    const publicoDespues = await json(await leerLiga(ligaId))
    expect({ ...publicoDespues, servidorAhoraMs: 0 }).toEqual({ ...publicoAntes, servidorAhoraMs: 0 })

    const ok = await (await P.enviar(sobre)).json()
    expect(ok.resultado).toBe('aceptado')
    expect((await resumenGuardado(ligaId, 'P')).localPuntos).toBe(3)
    expect((await (await P.enviar(sobre)).json()).resultado).toBe('recibo-existente')
    expect((await resumenGuardado(ligaId, 'P')).localPuntos).toBe(3) // no se cuenta dos veces
    await verificarTodo(ligaId)
  })

  it('un fallo en la inserción del resumen de un partido SIN resumen previo también se revierte con comprobación', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await dentro(ligaId, (inst) => inst.almacen.sql.exec("DELETE FROM resumen_partido WHERE partido_id = 'P'").toArray()) // ausente
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    const antes = await volcado(ligaId)
    await fallo(ligaId, 'INSERT')
    const r = await P.enviar(sobre)
    await sinFallo(ligaId)
    expect({ status: r.status, cuerpo: await r.json() }).toEqual({ status: 500, cuerpo: REVERTIDO })
    expect(await volcado(ligaId)).toBe(antes) // sigue AUSENTE, no nulo ni a medias
    expect(await resumenGuardado(ligaId, 'P')).toBeNull()
    expect((await (await P.enviar(sobre)).json()).resultado).toBe('aceptado') // la orden aceptada repara su propio partido
    await verificarTodo(ligaId)
  })

  // transactionSync sin atomicidad: al fallar restaura TODO salvo el resumen (que queda como lo escribió la orden).
  const reversionSalvoResumen = (almacen) => {
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
          recibos: todas("SELECT * FROM recibos WHERE partido_id = 'P'"), bandeja: todas("SELECT * FROM bandeja WHERE partido_id = 'P'"),
          auditoria: todas("SELECT * FROM auditoria_reloj WHERE partido_id = 'P'"), eventos: todas("SELECT * FROM eventos WHERE partido_id = 'P'"),
          partido: sql.exec("SELECT * FROM partidos WHERE id = 'P'").one(),
        }
        try {
          return fn()
        } catch (error) {
          sql.exec('DROP TRIGGER IF EXISTS fallo_bandeja').toArray()
          for (const [tabla, filas] of [['recibos', foto.recibos], ['bandeja', foto.bandeja], ['auditoria_reloj', foto.auditoria], ['eventos', foto.eventos]]) {
            sql.exec(`DELETE FROM ${tabla} WHERE partido_id = 'P'`).toArray()
            for (const f of filas) insertar(tabla, f)
          }
          sql.exec('UPDATE partidos SET rev = ?, ultimo_client_seq = ?, estado_json = ? WHERE id = ?', foto.partido.rev, foto.partido.ultimo_client_seq, foto.partido.estado_json, 'P').toArray()
          throw error
        }
      },
    }
  }

  it('reversión parcial simulada: todo restaurado salvo el CONTENIDO del resumen → resultado-desconocido (los recuentos no bastan)', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    const sobre = await P.sobre('anotar', { ...D1, puntos: 3 }, { t: T0 + 3000 })
    const contadoresAntes = await conteos(ligaId, 'P')
    const resumenAntes = await filaResumenCruda(ligaId, 'P')
    await dentro(ligaId, (inst) => inst.almacen.sql.exec(
      "CREATE TRIGGER fallo_bandeja BEFORE INSERT ON bandeja BEGIN SELECT RAISE(ABORT, 'detalle-sql-interno'); END",
    ).toArray())
    const r = await dentro(ligaId, async (inst) => {
      const adaptador = crearAdaptadorLiga({ storage: reversionSalvoResumen(inst.almacen) })
      const ejecucion = adaptador.paraEjecucion()
      try {
        return aRespuesta(await ejecutar(ejecucion, sobre, { recibidoEn: T0 + 3010, credencial: P.token }))
      } catch (error) {
        return clasificarFallo(error, ejecucion.traza)
      }
    })
    await dentro(ligaId, (inst) => inst.almacen.sql.exec('DROP TRIGGER IF EXISTS fallo_bandeja').toArray())
    // precondición: la simulación dejó iguales recuentos, rev, cursor, estado y eventos, pero NO el resumen
    expect(await conteos(ligaId, 'P')).toEqual(contadoresAntes)
    expect(await filaResumenCruda(ligaId, 'P')).not.toBe(resumenAntes)
    expect(r).toEqual({ status: 503, cuerpo: DESCONOCIDO })
  })

  it('fallos al capturar la fila del resumen: antes de escribir es un fallo conocido sin escritura; en la comprobación posterior no se afirma nada', async () => {
    const conLectura = (falla) => (almacen) => ({
      sql: { exec: (q, ...a) => { falla(q); return almacen.sql.exec(q, ...a) } },
      transactionSync: (fn) => almacen.transactionSync(fn),
    })
    const correr = (ligaId, sobre, token, fabricar) => dentro(ligaId, async (inst) => {
      const adaptador = crearAdaptadorLiga({ storage: fabricar(inst.almacen) })
      const ejecucion = adaptador.paraEjecucion()
      try { return aRespuesta(await ejecutar(ejecucion, sobre, { recibidoEn: T0 + 1010, credencial: token })) } catch (e) { return clasificarFallo(e, ejecucion.traza) }
    })
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    const antes = await volcado(ligaId)
    const r1 = await correr(ligaId, sobre, P.token, conLectura((q) => { if (q.includes('FROM resumen_partido')) throw new Error('detalle de captura') }))
    expect(r1).toEqual({ status: 500, cuerpo: SIN_ESCRIBIR }) // la captura del resumen falló ANTES de marcar el inicio de la escritura
    expect(await volcado(ligaId)).toBe(antes)

    let capturas = 0
    await dentro(ligaId, (inst) => inst.almacen.sql.exec("CREATE TRIGGER fallo_bandeja BEFORE INSERT ON bandeja BEGIN SELECT RAISE(ABORT, 'x'); END").toArray())
    const r2 = await correr(ligaId, sobre, P.token, conLectura((q) => {
      if (q.includes('FROM resumen_partido')) { capturas += 1; if (capturas === 2) throw new Error('detalle de comprobación') }
    }))
    await dentro(ligaId, (inst) => inst.almacen.sql.exec('DROP TRIGGER IF EXISTS fallo_bandeja').toArray())
    expect(capturas).toBe(2)
    expect(r2).toEqual({ status: 503, cuerpo: DESCONOCIDO })
    expect(await volcado(ligaId)).toBe(antes)
  })

  it('la comparación de contenido distingue resumen ausente, presente con valores y presente con otro valor', () => {
    const c = (existe, valor) => ({ existe, valor })
    const base = (resumen) => ({ estado: c(true, '{}'), eventos: new Map(), ...(resumen === undefined ? {} : { resumen }) })
    expect(contenidosIguales(base(c(true, '[1,2]')), base(c(true, '[1,2]')))).toBe(true)
    expect(contenidosIguales(base(c(false, null)), base(c(false, null)))).toBe(true)
    expect(contenidosIguales(base(c(false, null)), base(c(true, null)))).toBe(false) // ausente ≠ presente con nulo
    expect(contenidosIguales(base(c(true, '[1,2]')), base(c(true, '[1,3]')))).toBe(false)
    expect(contenidosIguales(base(c(true, '[1,2]')), base())).toBe(false) // una captura sin resumen no iguala a una con él
    expect(contenidosIguales(base(), base())).toBe(true) // compatibilidad con capturas antiguas sin resumen
  })
})

describe('4. migración 5, reparación acotada y disponibilidad de las órdenes', () => {
  const aVersionCuatro = (sql) => {
    for (const s of ['DROP TABLE resumen_partido', "UPDATE meta SET valor = '4' WHERE clave = 'esquema'"]) sql.exec(s).toArray()
  }
  /** Liga con P (varios eventos reales), Q sin eventos y R en final. */
  async function ligaConHistoria() {
    const payload = payloadDeLiga(nuevaLiga())
    payload.partidos.push({ id: 'R', localId: 'E1', visitaId: 'E3', inicio: null })
    payload.credenciales.push({ token: `tok-sintetico-R-${payload.liga.id}-0001`, partidoId: 'R', deviceId: 'tel-R', actorId: 'actor-R' })
    const { ligaId, P, Q } = await ligaSembrada(payload.liga.id, payload)
    const { Telefono } = await import('./ayuda.js')
    const R = new Telefono(ligaId, 'R')
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    await P.mandar('anotar', { ...D1, puntos: 3 }, { t: T0 + 3000 })
    await P.mandar('falta', D1, { t: T0 + 4000 })
    await R.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await R.mandar('cerrar-partido', {}, { t: T0 + 2000 })
    return { ligaId, P, Q, R }
  }

  it('migración 4 → 5: la tabla nace vacía (esquema), las lecturas dan 503 hasta reparar, y la reparación llena todo (incluido el partido sin eventos) igual que lo derivado de los eventos', async () => {
    const { ligaId } = await ligaConHistoria()
    const antes = await dentro(ligaId, (inst) => {
      const sql = inst.almacen.sql
      aVersionCuatro(sql)
      return JSON.stringify(['partidos', 'eventos', 'recibos', 'bandeja', 'credenciales', 'jugadores'].map((t) => sql.exec(`SELECT * FROM ${t} ORDER BY 1, 2`).toArray()))
    })
    const tras = await dentro(ligaId, (inst) => {
      const sql = inst.almacen.sql
      crearEsquema(inst.almacen) // lo que ocurre al abrir el objeto
      crearEsquema(inst.almacen) // idempotente
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe(String(VERSION_ESQUEMA))
      expect(sql.exec('SELECT COUNT(*) AS n FROM resumen_partido').one().n).toBe(0)
      return JSON.stringify(['partidos', 'eventos', 'recibos', 'bandeja', 'credenciales', 'jugadores'].map((t) => sql.exec(`SELECT * FROM ${t} ORDER BY 1, 2`).toArray()))
    })
    expect(tras).toBe(antes) // ninguna fila autoritativa cambió
    const r503 = await leerLiga(ligaId)
    expect({ status: r503.status, cuerpo: await r503.json() }).toEqual({ status: 503, cuerpo: NO_DISPONIBLE })
    expect((await leerPartido(ligaId, 'P')).status).toBe(503)

    const rep = await dentro(ligaId, (inst) => inst.repararResumenesAlArrancar()) // el arranque real
    expect(rep).toEqual({ estado: 'ok', reparados: 3, fallidos: [] })
    for (const id of ['P', 'Q', 'R']) coincide(await resumenGuardado(ligaId, id), await esperadoDeEventos(ligaId, id))
    expect(await resumenGuardado(ligaId, 'Q')).toMatchObject({ localPuntos: 0, visitaPuntos: 0, periodo: 1, rev: 0 }) // sin eventos
    expect(await resumenGuardado(ligaId, 'P')).toMatchObject({ localPuntos: 3, localFaltas: 1, rev: 4 })
    expect((await leerLiga(ligaId)).status).toBe(200)
    // reparar otra vez no hace nada (idempotente, ya vigente)
    expect(await dentro(ligaId, (inst) => inst.repararResumenesAlArrancar())).toEqual({ estado: 'ok', reparados: 0, fallidos: [] })
  })

  it('una migración OBLIGATORIA que falla no se esconde: el esquema se deshace, la versión no cambia y no se declara éxito', async () => {
    const { ligaId } = await ligaSembrada(nuevaLiga())
    await dentro(ligaId, (inst) => {
      const sql = inst.almacen.sql
      aVersionCuatro(sql)
      sql.exec('CREATE INDEX resumen_partido ON partidos(sede)').toArray() // el nombre ya está en uso: CREATE TABLE no puede
      expect(() => crearEsquema(inst.almacen)).toThrow()
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe('4')
      expect(sql.exec("SELECT type FROM sqlite_master WHERE name = 'resumen_partido'").toArray()).toEqual([{ type: 'index' }]) // no hay tabla a medias
      sql.exec('DROP INDEX resumen_partido').toArray()
      crearEsquema(inst.almacen) // sin el obstáculo, se completa
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe(String(VERSION_ESQUEMA))
    })
  })

  it('resumen de otra versión, otra revisión o otros equipos: 503 (nunca un marcador viejo); el arranque lo repara', async () => {
    const { ligaId } = await ligaConHistoria()
    const mutar = (sql_) => dentro(ligaId, (inst) => inst.almacen.sql.exec(sql_).toArray())
    const reparar = () => dentro(ligaId, (inst) => inst.repararResumenesAlArrancar())
    for (const [nombre, sentencia] of [
      ['otra versión de proyección', `UPDATE resumen_partido SET version_proyeccion = ${VERSION_PROYECCION - 1} WHERE partido_id = 'P'`],
      ['otra revisión', "UPDATE resumen_partido SET rev_fuente = rev_fuente - 1 WHERE partido_id = 'P'"],
      ['otro equipo local', "UPDATE resumen_partido SET local_id = 'E9' WHERE partido_id = 'P'"],
      ['otro equipo visitante', "UPDATE resumen_partido SET visita_id = NULL WHERE partido_id = 'P'"],
      ['resumen ausente', "DELETE FROM resumen_partido WHERE partido_id = 'P'"],
    ]) {
      await mutar(sentencia)
      for (const ruta of [`/v1/ligas/${ligaId}/publico`, `/v1/ligas/${ligaId}/partidos/P`]) {
        const r = await exports.default.fetch(new Request(`${BASE}${ruta}`))
        expect({ nombre, ruta, status: r.status, cuerpo: await r.json() }).toEqual({ nombre, ruta, status: 503, cuerpo: NO_DISPONIBLE })
      }
      expect((await reparar()).estado, nombre).toBe('ok')
      await verificarTodo(ligaId)
    }
  })

  it('una lectura con resumen faltante NO reconstruye nada y no consulta eventos; los demás partidos tampoco se reconstruyen', async () => {
    const { ligaId } = await ligaConHistoria()
    await dentro(ligaId, (inst) => inst.almacen.sql.exec("DELETE FROM resumen_partido WHERE partido_id = 'P'").toArray())
    const l = await llamarMedido(ligaId, 'leerPublicoLiga')
    expect(l.r).toEqual({ status: 503, cuerpo: NO_DISPONIBLE })
    const g = await llamarMedido(ligaId, 'leerPublico', 'P')
    expect(g.r).toEqual({ status: 503, cuerpo: NO_DISPONIBLE })
    for (const s of [...l.sentencias, ...g.sentencias]) {
      expect(s.consulta, s.consulta).toMatch(/^SELECT/) // ninguna escritura
      expect(s.consulta).not.toContain('FROM eventos') // ningún recorrido de la historia
    }
    expect(await resumenGuardado(ligaId, 'P')).toBeNull() // sigue ausente
  })

  it('límites de la reparación: se aplican antes de leer; al rebasarlos las lecturas afectadas dan 503 y LAS ÓRDENES SIGUEN; una orden aceptada repara su propio partido', async () => {
    const { ligaId, P, Q } = await ligaConHistoria()
    const borrar = () => dentro(ligaId, (inst) => inst.almacen.sql.exec('DELETE FROM resumen_partido').toArray())
    await borrar()

    // 1. demasiados partidos pendientes: no se lee ningún evento
    const m1 = await llamarMedido(ligaId, 'repararResumenesAlArrancar') // límites de producción: repara
    expect(m1.r.estado).toBe('ok')
    await borrar()
    control.limitesReparacion = { partidos: 2, eventos: LIMITES_REPARACION.eventos }
    const lim = await dentro(ligaId, (inst) => {
      const medido = almacenMedido(inst.almacen)
      const r = repararResumenes(medido.almacen, { limites: inst.limitesReparacion() })
      return { r, sentencias: medido.sentencias() }
    })
    expect(lim.r).toEqual({ estado: 'limite-partidos', reparados: 0, fallidos: [] })
    expect(lim.sentencias.length).toBe(1) // solo la consulta acotada de candidatos (LIMIT 3)
    expect(lim.sentencias[0].consulta).not.toContain('FROM eventos')

    // 2. presupuesto de eventos agotado a mitad: P (4 eventos de marcador/falta/periodo… ) no cabe
    control.limitesReparacion = { partidos: 300, eventos: 1 }
    expect(await dentro(ligaId, (inst) => inst.repararResumenesAlArrancar())).toMatchObject({ estado: 'limite-eventos' })
    expect(await resumenGuardado(ligaId, 'P')).toBeNull()
    expect((await leerLiga(ligaId)).status).toBe(503)

    // 3. las órdenes siguen disponibles y la aceptada repara SU partido
    const r = await P.mandar('anotar', { ...D2, puntos: 2 }, { t: T0 + 5000 })
    expect(r.cuerpo.resultado).toBe('aceptado')
    coincide(await resumenGuardado(ligaId, 'P'), await esperadoDeEventos(ligaId, 'P'))
    expect((await leerPartido(ligaId, 'P')).status).toBe(200) // P ya se puede leer
    expect((await leerPartido(ligaId, 'Q')).status).toBe(503) // Q sigue sin resumen
    expect((await leerLiga(ligaId)).status).toBe(503) // y la liga no omite a Q ni sirve a medias
    const qa = await Q.mandar('iniciar-partido', {}, { t: T0 + 6000 })
    expect(qa.cuerpo.resultado).toBe('aceptado')
    expect((await leerPartido(ligaId, 'Q')).status).toBe(200)

    // 4. con límites normales, el siguiente arranque termina de reparar
    control.limitesReparacion = null
    expect(await dentro(ligaId, (inst) => inst.repararResumenesAlArrancar())).toMatchObject({ estado: 'ok', fallidos: [] })
    expect((await leerLiga(ligaId)).status).toBe(200)
    await verificarTodo(ligaId)
  })

  it('un partido que no se puede reparar (datos imposibles) no impide reparar los demás ni inhabilita las órdenes de los otros partidos', async () => {
    const { ligaId, P, Q } = await ligaConHistoria()
    await dentro(ligaId, (inst) => {
      const sql = inst.almacen.sql
      sql.exec("DELETE FROM resumen_partido WHERE partido_id IN ('P', 'Q')").toArray()
      const fila = sql.exec("SELECT id, json FROM eventos WHERE partido_id = 'P' AND json_extract(json, '$.tipo') = 'punto'").one()
      sql.exec('UPDATE eventos SET json = ? WHERE partido_id = ? AND id = ?', JSON.stringify({ ...JSON.parse(fila.json), puntos: 'x' }), 'P', fila.id).toArray()
    })
    const rep = await dentro(ligaId, (inst) => inst.repararResumenesAlArrancar())
    expect(rep).toEqual({ estado: 'parcial', reparados: 1, fallidos: ['P'] })
    expect(await resumenGuardado(ligaId, 'P')).toBeNull()
    expect(await resumenGuardado(ligaId, 'Q')).not.toBeNull()
    expect((await leerLiga(ligaId)).status).toBe(503) // P afectado: nada se publica a medias
    const q = await Q.mandar('iniciar-partido', {}, { t: T0 + 6000 })
    expect(q.cuerpo.resultado).toBe('aceptado') // las órdenes de otros partidos siguen
    expect(P).toBeDefined()
  })

  it('resumenValido compara versión, revisión y equipos (null cuenta como valor)', () => {
    const fila = { rev: 3, local_id: 'A', visita_id: null }
    const ok = { version_proyeccion: VERSION_PROYECCION, rev_fuente: 3, local_id: 'A', visita_id: null }
    expect(resumenValido(ok, fila)).toBe(true)
    expect(resumenValido(null, fila)).toBe(false)
    expect(resumenValido({ ...ok, visita_id: 'B' }, fila)).toBe(false)
    expect(resumenValido({ ...ok, rev_fuente: 2 }, fila)).toBe(false)
    expect(resumenValido({ ...ok, version_proyeccion: VERSION_PROYECCION + 1 }, fila)).toBe(false)
  })
})

describe('5. siembra y ayuda de reconstrucción', () => {
  it('la siembra crea el resumen de cada partido (0-0, periodo 1, revisión 0) en su transacción; una siembra inválida no deja nada', async () => {
    const ligaId = nuevaLiga()
    expect((await sembrar(ligaId, payloadDeLiga(ligaId))).status).toBe(201)
    for (const id of ['P', 'Q']) expect(await resumenGuardado(ligaId, id)).toMatchObject({ rev: 0, localPuntos: 0, visitaPuntos: 0, periodo: 1, version: VERSION_PROYECCION })
    const mala = nuevaLiga()
    const p = payloadDeLiga(mala)
    p.partidos[0].sede = ''
    expect((await sembrar(mala, p)).status).toBe(422)
    expect(await sqlDe(mala, 'SELECT COUNT(*) AS n FROM resumen_partido')).toEqual([{ n: 0 }])
  })

  it('HELPER de escritura directa: tras insertar eventos en SQL, la reconstrucción de prueba deja el resumen igual a lo derivado', async () => {
    const { ligaId } = await ligaSembrada(nuevaLiga())
    await dentro(ligaId, (inst) => {
      const sql = inst.almacen.sql
      const ev = (seq, tipo, equipoId, puntos) => JSON.stringify({ id: `X${seq}`, partidoId: 'P', seq, tipo, equipoId, jugadorId: 'J1', puntos, periodo: 1, anulado: false, creadoEn: T0 })
      sql.exec('INSERT INTO eventos (partido_id, id, seq, json) VALUES (?, ?, ?, ?)', 'P', 'X1', 1, ev(1, 'punto', 'E1', 3)).toArray()
      sql.exec('INSERT INTO eventos (partido_id, id, seq, json) VALUES (?, ?, ?, ?)', 'P', 'X2', 2, ev(2, 'falta', 'E2', 0)).toArray()
    })
    expect(await resumenGuardado(ligaId, 'P')).toMatchObject({ localPuntos: 0 }) // la escritura directa NO actualiza el resumen
    expect((await reconstruirResumenesDePrueba(ligaId)).estado).toBe('ok')
    expect(await resumenGuardado(ligaId, 'P')).toMatchObject({ localPuntos: 3, visitaFaltas: 1 })
    coincide(await resumenGuardado(ligaId, 'P'), await esperadoDeEventos(ligaId, 'P'))
  })
})
