import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ESCENARIOS, correrEnMotor, proyectar, tiemposDe } from './prueba/escenarios'

// ---------------------------------------------------------------------------
// Paridad con las funciones ACTUALES sobre Dexie (marcador.js y reloj.js, sin
// modificarlas): el mismo guion, el mismo resultado de cada paso y la misma
// proyección final (eventos, partido y auditoría del reloj). Las bases son
// IndexedDB falso en memoria, nunca datos del navegador.
//
// Diferencias intencionales y conocidas del motor, que no se comparan aquí:
// el motor exige `rev` (más estricto), valida los puntos del deporte y ordena
// Rehacer por revisión; con guiones normales dan lo mismo que el orden por hora.
// ---------------------------------------------------------------------------

const NOMBRE_BD = 'sebel'

function borrarBd() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(NOMBRE_BD)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

let db
let R
let M
let ahora

beforeEach(async () => {
  await borrarBd()
  vi.resetModules()
  ahora = 1_700_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => ahora)
  ;({ db } = await import('../../db.js'))
  R = await import('../reloj.js')
  M = await import('../marcador.js')
})

afterEach(async () => {
  vi.restoreAllMocks()
  db.close()
  await borrarBd()
})

const resultado = (r) => {
  if (r.ok === true) return 'ok'
  if (r.ok === false) return r.motivo
  return ['anulado', 'rehecho'].includes(r.resultado) ? 'ok' : r.resultado
}

async function correrEnDexie(esc) {
  const i = esc.inicial ?? {}
  await db.ligas.add({ id: 'L', deporte: 'baloncesto', nombre: 'Liga', organizadorId: 'yo' })
  // Fixture: el inicio exige dos equipos válidos de la liga (Decisión 115). Solo datos de prueba.
  await db.equipos.bulkAdd([{ id: 'EL', ligaId: 'L', nombre: 'Local' }, { id: 'EV', ligaId: 'L', nombre: 'Visita' }])
  await db.partidos.add({
    id: 'P', ligaId: 'L', localId: 'EL', visitaId: 'EV', estado: i.estado ?? 'vivo', relojEstado: 'detenido',
    relojRestante: i.restante === undefined ? 600000 : i.restante, relojDesde: null,
  })
  await db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'yo' })

  const eventos = () => db.eventos.where('partidoId').equals('P').toArray()
  const obs = async () => R.observadoDe(await db.partidos.get('P'), await R.ultimoSeqAuditoria('P'))
  const vista = async () => {
    const ev = await eventos()
    return { periodo: M.periodoVisible(ev, 'baloncesto'), marcaPeriodo: M.marcaDePeriodo(ev), observado: await obs() }
  }

  const vistas = {}
  const tiempos = tiemposDe(esc)
  const resultados = []
  for (const [n, p] of esc.pasos.entries()) {
    ahora = tiempos[n]
    if (p.guardar) vistas[p.guardar] = await vista()
    const v = p.usar ? vistas[p.usar] : await vista()
    const d = p.datos ?? {}
    let r
    switch (p.op) {
      case 'iniciar': r = await R.iniciarPartido('P', v.observado); break
      case 'arrancar': r = await R.arrancarReloj('P', v.observado); break
      case 'detener': r = await R.detenerReloj('P', v.observado); break
      case 'auto': r = await R.detenerReloj('P', v.observado, { origen: 'sistema' }); break
      case 'cerrar': r = await R.cerrarPartido('P', v.observado); break
      case 'siguiente':
        r = await R.siguientePeriodo({ id: 'P' }, await db.ligas.get('L'), v.periodo, v.marcaPeriodo, v.observado)
        break
      case 'anotar':
        r = await M.anotar({ partidoId: 'P', equipoId: d.equipoId, jugadorId: d.jugadorId, puntos: d.puntos, periodo: v.periodo, marcaPeriodo: v.marcaPeriodo })
        break
      case 'falta':
        r = await M.marcarFalta({ partidoId: 'P', equipoId: d.equipoId, jugadorId: d.jugadorId, periodo: v.periodo, marcaPeriodo: v.marcaPeriodo })
        break
      case 'deshacer': r = await M.deshacer('P'); break
      case 'rehacer': r = await M.rehacer('P'); break
      case 'anular': r = await M.anularEvento((await eventos()).find((e) => e.seq === d.seq)?.id); break
      default: throw new Error(`op desconocida ${p.op}`)
    }
    resultados.push(resultado(r))
  }
  return {
    resultados,
    proyeccion: proyectar({
      partido: await db.partidos.get('P'),
      eventos: await eventos(),
      auditoria: await db.auditoriaReloj.where('partidoId').equals('P').toArray(),
    }),
  }
}

describe('paridad: el motor se comporta como las funciones actuales de Dexie', () => {
  for (const esc of ESCENARIOS) {
    it(esc.nombre, async () => {
      const dexie = await correrEnDexie(esc)
      const motor = await correrEnMotor(esc)
      // La comparación no es vacía: hubo algo que comparar.
      expect(dexie.proyeccion.eventos.length + dexie.proyeccion.auditoria.length).toBeGreaterThan(0)
      expect(motor.resultados).toEqual(dexie.resultados)
      expect(motor.proyeccion).toEqual(dexie.proyeccion)
      // Y ambos coinciden con la intención declarada en el guion.
      expect(dexie.resultados).toEqual(esc.pasos.map((p) => p.esperado))
    })
  }
})
