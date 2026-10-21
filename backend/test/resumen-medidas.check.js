import { describe, expect, it } from 'vitest'
import { crearAdaptadorLiga } from '../src/adaptador-liga.js'
import { proyectarLigaPublica, proyectarPartidoPublico } from '../src/proyeccion-publica.js'
import { VERSION_PROYECCION, repararResumenes, resumirPartido } from '../src/resumen-publico.js'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import { T0, Telefono, dentro, sembrar } from './ayuda.js'
import { almacenMedido, ejecutarMedido, escribeResumen, llamarMedido, sumar, tocaResumen } from './ayuda-resumen.js'

// MEDICIONES LOCALES (workerd + SQLite del Durable Object). NO son una previsión de facturación de Cloudflare: miden
// `rowsRead` / `rowsWritten` de los cursores SQL, el número de sentencias y los bytes de respuesta, sobre datos sintéticos.
//
// Los datos de LECTURA se construyen con SQL directo (FIXTURE_SQL_DIRECTO: no pasan por el motor) y luego se llama a la
// reconstrucción de producción para llenar los resúmenes. Los datos de las ÓRDENES se crean con órdenes reales.
// La referencia "antes" es una proyección SOLO DE PRUEBA: las mismas sentencias que usaba la lectura de REPORT_132
// (liga) y `adaptador.estadoVigente` (partido), sin cambiar el código de producción.

const medida = (o) => console.log(`MEDIDA ${JSON.stringify(o)}`)

async function construirLiga({ partidos, porPartido }) {
  const ligaId = nuevaLiga()
  const p = payloadDeLiga(ligaId)
  p.equipos = Array.from({ length: 12 }, (_, i) => ({ id: `T${i + 1}`, nombre: `Equipo ${i + 1}` }))
  p.jugadores = p.equipos.flatMap((e) => Array.from({ length: 10 }, (_, j) => ({
    id: `${e.id}J${j + 1}`, equipoId: e.id, nombre: `Jugador ${e.id}-${j + 1}`, dorsal: j, activo: true, personaId: `persona-${e.id}-${j + 1}`,
  })))
  p.credenciales = []
  p.partidos = Array.from({ length: partidos }, (_, i) => ({
    id: `G${i + 1}`, localId: `T${(i % 12) + 1}`, visitaId: `T${((i + 5) % 12) + 1}`,
    programadoPara: new Date(Date.UTC(2026, 10, 1 + (i % 30), 15 + (i % 6))).toISOString(), sede: `Cancha ${(i % 3) + 1}`,
  }))
  expect((await sembrar(ligaId, p)).status).toBe(201)
  // FIXTURE_SQL_DIRECTO: eventos insertados directamente (medidos), estado de partido vivo/final.
  const fixture = await dentro(ligaId, (inst) => {
    const medido = almacenMedido(inst.almacen)
    const sql = medido.almacen.sql
    for (let i = 0; i < partidos; i += 1) {
      const id = `G${i + 1}`
      const local = `T${(i % 12) + 1}`
      const visita = `T${((i + 5) % 12) + 1}`
      let periodos = 0
      for (let k = 1; k <= porPartido; k += 1) {
        const mod = k % 10
        let ev
        const base = { id: `${id}-e${k}`, partidoId: id, seq: k, jugadorId: 'J', periodo: 1, anulado: k % 17 === 0, creadoEn: T0 + k }
        if (mod === 9 && periodos < 3) { ev = { ...base, tipo: 'periodo', puntos: 0 }; periodos += 1 }
        else if (mod < 5) ev = { ...base, tipo: 'punto', equipoId: local, puntos: 2 }
        else if (mod < 8) ev = { ...base, tipo: 'punto', equipoId: visita, puntos: 3 }
        else ev = { ...base, tipo: 'falta', equipoId: local, puntos: 0 }
        sql.exec('INSERT INTO eventos (partido_id, id, seq, json) VALUES (?, ?, ?, ?)', id, ev.id, ev.seq, JSON.stringify(ev)).toArray()
      }
      sql.exec('UPDATE partidos SET estado_json = ?, rev = ? WHERE id = ?',
        JSON.stringify({ auditSeq: 0, corridaSeq: null, cursorReloj: null, config: { deporte: 'baloncesto', minutosPorPeriodo: 10 }, partido: { estado: i % 2 ? 'final' : 'vivo', inicio: new Date(T0).toISOString(), relojEstado: 'detenido', relojRestante: 0, relojDesde: null } }),
        porPartido, id).toArray()
    }
    return sumar(medido.sentencias())
  })
  const reconstruccion = await dentro(ligaId, (inst) => {
    const medido = almacenMedido(inst.almacen)
    const r = repararResumenes(medido.almacen, { todos: true })
    return { r, ...sumar(medido.sentencias()) }
  })
  expect(reconstruccion.r).toMatchObject({ estado: 'ok', reparados: partidos })
  return { ligaId, fixture, reconstruccion }
}

/** REFERENCIA SOLO DE PRUEBA: la lectura de liga de REPORT_132 (6 consultas, todos los eventos de marcador). */
const referenciaLiga = (ligaId) => dentro(ligaId, (inst) => {
  const medido = almacenMedido(inst.almacen)
  const sql = medido.almacen.sql
  const liga = sql.exec('SELECT id, nombre, deporte, categoria, subcategoria_json FROM ligas').toArray()[0]
  const n = (t) => sql.exec(`SELECT COUNT(*) AS n FROM ${t}`).one().n
  n('partidos'); n('equipos')
  const equipos = sql.exec('SELECT id, nombre FROM equipos ORDER BY id').toArray()
  const partidos = sql.exec(
    `SELECT id, local_id, visita_id, estado_json, rev, programado_para, sede FROM partidos ORDER BY programado_para IS NULL, programado_para, id`,
  ).toArray()
  const filas = sql.exec(
    `SELECT partido_id, json_extract(json, '$.tipo') AS tipo, json_extract(json, '$.equipoId') AS equipoId,
            json_extract(json, '$.puntos') AS puntos, json_extract(json, '$.anulado') AS anulado
       FROM eventos WHERE json_extract(json, '$.tipo') IN ('punto', 'falta', 'periodo') ORDER BY partido_id, seq LIMIT ?`, 50_001,
  ).toArray()
  const porPartido = new Map()
  for (const f of filas) {
    if (!porPartido.has(f.partido_id)) porPartido.set(f.partido_id, [])
    porPartido.get(f.partido_id).push({ tipo: f.tipo, equipoId: f.equipoId, puntos: f.puntos, anulado: Boolean(f.anulado) })
  }
  const lista = partidos.map((f) => {
    const r = resumirPartido({ eventos: porPartido.get(f.id) ?? [], localId: f.local_id, visitaId: f.visita_id, deporte: 'baloncesto' })
    return { fila: f, resumen: { periodo: r.periodo, local_puntos: r.localPuntos, visita_puntos: r.visitaPuntos, local_faltas: r.localFaltas, visita_faltas: r.visitaFaltas } }
  })
  const cuerpo = proyectarLigaPublica({ liga, equipos, partidos: lista, servidorAhoraMs: 0 })
  return { cuerpo, ...sumar(medido.sentencias()) }
})

/** REFERENCIA SOLO DE PRUEBA: la lectura de partido anterior (estadoVigente = todos los eventos + plantilla de 2 equipos). */
const referenciaPartido = (ligaId, gameId) => dentro(ligaId, (inst) => {
  const medido = almacenMedido(inst.almacen)
  const adaptador = crearAdaptadorLiga({ storage: medido.almacen })
  const estado = adaptador.estadoVigente(gameId)
  const sql = medido.almacen.sql
  const fila = (q, ...a) => sql.exec(q, ...a).toArray()[0]
  const p = fila('SELECT id, liga_id, local_id, visita_id, estado_json, rev, programado_para, sede FROM partidos WHERE id = ?', gameId)
  const liga = fila('SELECT id, nombre, deporte, categoria, subcategoria_json FROM ligas WHERE id = ?', p.liga_id)
  const local = fila('SELECT id, nombre FROM equipos WHERE id = ?', p.local_id)
  const visita = fila('SELECT id, nombre FROM equipos WHERE id = ?', p.visita_id)
  const r = resumirPartido({ eventos: estado.eventos, localId: p.local_id, visitaId: p.visita_id, deporte: estado.config.deporte })
  const cuerpo = proyectarPartidoPublico({
    fila: p, liga, local, visita, servidorAhoraMs: 0,
    resumen: { periodo: r.periodo, local_puntos: r.localPuntos, visita_puntos: r.visitaPuntos, local_faltas: r.localFaltas, visita_faltas: r.visitaFaltas },
  })
  return { cuerpo, ...sumar(medido.sentencias()) }
})

const bytes = (o) => JSON.stringify(o).length
const sinHora = (c) => ({ ...c, servidorAhoraMs: 0 })

describe('lecturas: referencia por eventos (antes) frente a resumen almacenado (después)', () => {
  for (const partidos of [60, 66]) {
    for (const porPartido of [100, 200, 400]) {
      it(`${partidos} partidos × ${porPartido} eventos sintéticos`, async () => {
        const { ligaId, fixture, reconstruccion } = await construirLiga({ partidos, porPartido })
        const antesLiga = await referenciaLiga(ligaId)
        const despuesLiga = await llamarMedido(ligaId, 'leerPublicoLiga')
        expect(despuesLiga.r.status).toBe(200)
        expect(sinHora(despuesLiga.r.cuerpo)).toEqual(sinHora(antesLiga.cuerpo)) // misma respuesta
        const sumaD = sumar(despuesLiga.sentencias)
        expect(despuesLiga.sentencias.some((s) => s.consulta.includes('FROM eventos'))).toBe(false)

        const id = 'G7'
        const antesJuego = await referenciaPartido(ligaId, id)
        const despuesJuego = await llamarMedido(ligaId, 'leerPublico', id)
        expect(despuesJuego.r.status).toBe(200)
        expect(sinHora(despuesJuego.r.cuerpo)).toEqual(sinHora(antesJuego.cuerpo))
        const sumaJ = sumar(despuesJuego.sentencias)
        // REPORT_191: la lectura de UN partido en juego hace una única lectura acotada de eventos (las últimas canastas confirmadas, por el índice
        // (partido, seq), LIMIT 6); nunca recorre la historia del partido. La lectura de la LIGA sigue sin tocar `eventos`.
        const sobreEventos = despuesJuego.sentencias.filter((s) => s.consulta.includes('FROM eventos'))
        expect(sobreEventos.length).toBeLessThanOrEqual(1)
        for (const s of sobreEventos) expect(s.consulta).toMatch(/WHERE partido_id = \?[\s\S]*ORDER BY seq DESC LIMIT \?/)

        medida({
          caso: 'lectura', partidos, porPartido, eventos: partidos * porPartido,
          fixtureSqlDirecto: fixture, reconstruccion: { consultas: reconstruccion.consultas, rowsRead: reconstruccion.rowsRead, rowsWritten: reconstruccion.rowsWritten },
          liga: { bytes: bytes(despuesLiga.r.cuerpo), antes: { consultas: antesLiga.consultas, rowsRead: antesLiga.rowsRead }, despues: { consultas: sumaD.consultas, rowsRead: sumaD.rowsRead } },
          partido: { bytes: bytes(despuesJuego.r.cuerpo), antes: { consultas: antesJuego.consultas, rowsRead: antesJuego.rowsRead }, despues: { consultas: sumaJ.consultas, rowsRead: sumaJ.rowsRead } },
        })
        expect(sumaD.rowsRead).toBeLessThan(antesLiga.rowsRead)
        expect(sumaJ.rowsRead).toBeLessThan(antesJuego.rowsRead)
      }, 120_000)
    }
  }
})

describe('órdenes REALES: coste por tipo con y sin la escritura del resumen', () => {
  // "sin resumen" = el total menos las sentencias que tocan resumen_partido (el resto de sentencias es idéntico:
  // el código de producción ya no tiene otra versión). Es una descomposición, no una segunda ejecución.
  for (const historia of [100, 400]) {
    it(`partido con ~${historia} eventos creados por órdenes reales`, async () => {
      const ligaId = nuevaLiga()
      expect((await sembrar(ligaId, payloadDeLiga(ligaId))).status).toBe(201)
      const P = new Telefono(ligaId, 'P')
      let t = T0
      const mandar = async (tipo, datos) => { t += 1000; const r = await P.mandar(tipo, datos, { t }); expect(r.cuerpo.resultado, tipo).toBe('aceptado'); return r }
      await mandar('iniciar-partido', {})
      await mandar('arrancar-reloj', {})
      for (let i = 0; i < historia; i += 1) {
        const lado = i % 2 ? { equipoId: 'E2', jugadorId: 'J9' } : { equipoId: 'E1', jugadorId: 'J1' }
        if (i % 4 === 3) await mandar('falta', lado)
        else await mandar('anotar', { ...lado, puntos: i % 2 ? 2 : 3 })
      }
      const eventos = await dentro(ligaId, (inst) => inst.almacen.sql.exec("SELECT COUNT(*) AS n FROM eventos WHERE partido_id = 'P'").one().n)
      const [primero, segundo] = await dentro(ligaId, (inst) => inst.almacen.sql.exec("SELECT id FROM eventos WHERE partido_id = 'P' AND json_extract(json, '$.tipo') = 'punto' ORDER BY seq LIMIT 2").toArray().map((f) => f.id))

      const filas = []
      let ultimoSobre = null
      const medir = async (nombre, tipo, datos, { esperado = 'aceptado' } = {}) => {
        t += 1000
        const sobre = await P.sobre(tipo, datos, { t })
        const m = await ejecutarMedido(ligaId, sobre, P.token, t + 10)
        expect(m.resp.cuerpo.resultado, nombre).toBe(esperado)
        ultimoSobre = sobre
        const total = sumar(m.sentencias)
        const res = sumar(m.sentencias.filter(tocaResumen))
        const escrituras = m.sentencias.filter(escribeResumen).length
        filas.push({ nombre, total, resumen: res, sinResumen: { consultas: total.consultas - res.consultas, rowsRead: total.rowsRead - res.rowsRead, rowsWritten: total.rowsWritten - res.rowsWritten }, escriturasResumen: escrituras })
        return m
      }
      await medir('anotar', 'anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 })
      await medir('falta', 'falta', { equipoId: 'E2', jugadorId: 'J9' })
      await medir('deshacer', 'deshacer', {})
      await medir('rehacer', 'rehacer', {})
      await medir('anular-evento', 'anular-evento', { eventoId: primero })
      await medir('rechazada (puntos inválidos)', 'anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 5 }, { esperado: 'rechazado' })
      // reintento duplicado de una orden ya aceptada
      const aceptada = await P.sobre('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 1 }, { t: t + 500 })
      t += 1500
      await ejecutarMedido(ligaId, aceptada, P.token, t)
      const dup = await ejecutarMedido(ligaId, aceptada, P.token, t + 10)
      expect(dup.resp.cuerpo.resultado).toBe('recibo-existente')
      const dt = sumar(dup.sentencias)
      filas.push({ nombre: 'duplicado (recibo existente)', total: dt, resumen: sumar(dup.sentencias.filter(tocaResumen)), sinResumen: dt, escriturasResumen: dup.sentencias.filter(escribeResumen).length })
      await medir('detener-reloj', 'detener-reloj', {})
      await medir('corregir-reloj', 'corregir-reloj', { restanteMs: 120000 })
      await medir('siguiente-periodo', 'siguiente-periodo', {})
      await medir('cerrar-partido', 'cerrar-partido', {})
      await medir('anular-evento tras el final', 'anular-evento', { eventoId: segundo })

      for (const f of filas) {
        const aceptada = !f.nombre.startsWith('rechazada') && !f.nombre.startsWith('duplicado')
        expect(f.escriturasResumen, f.nombre).toBe(aceptada ? 1 : 0)
        if (aceptada) expect(f.resumen.rowsWritten, f.nombre).toBeGreaterThan(0)
        else expect(f.resumen.rowsWritten, f.nombre).toBe(0)
      }
      medida({ caso: 'ordenes', historiaEventos: eventos, ordenes: filas })
    }, 120_000)
  }
})
