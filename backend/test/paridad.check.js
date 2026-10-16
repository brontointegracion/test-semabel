import { describe, expect, it, afterEach } from 'vitest'
import { control } from './worker-prueba.js'
import { ESCENARIOS, correrEnMotor, proyectar, tiemposDe } from '../../src/lib/motor/prueba/escenarios.js'
import { construirSobre, ordenParadaAutomatica } from '../../src/lib/motor/reglas.js'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import { Telefono, dentro, fijarEstadoDePartido, sembrar } from './ayuda.js'

// PARIDAD: el mismo guion de comportamiento que ya corre el motor contra el adaptador de memoria
// se corre aquí contra el adaptador real (SQLite de un Durable Object, por HTTP) y se comparan los
// resultados de cada paso y la proyección final (partido, eventos y auditoría del reloj).
// Esto demuestra que se ejercitó el adaptador nuevo; no sustituye las pruebas de plataforma.

afterEach(() => { control.ahoraMs = null })

const TIPO_MOTOR = {
  iniciar: 'iniciar-partido', arrancar: 'arrancar-reloj', detener: 'detener-reloj', siguiente: 'siguiente-periodo',
  cerrar: 'cerrar-partido', anotar: 'anotar', falta: 'falta', deshacer: 'deshacer', rehacer: 'rehacer',
}

async function correrEnBackend(escenario) {
  const ligaId = nuevaLiga()
  const payload = payloadDeLiga(ligaId)
  payload.credenciales[0].actorId = 'yo' // el banco de memoria usa este actor
  expect((await sembrar(ligaId, payload)).status).toBe(201)
  const i = escenario.inicial ?? {}
  const estado = i.estado ?? 'vivo'
  const restante = i.restante === undefined ? 600000 : i.restante
  await fijarEstadoDePartido(ligaId, 'P', { estado, relojEstado: 'detenido', relojRestante: restante, relojDesde: null })
  const tel = new Telefono(ligaId, 'P')

  const vistas = {}
  const resultados = []
  const tiempos = tiemposDe(escenario)
  for (const [n, p] of escenario.pasos.entries()) {
    const t = tiempos[n]
    control.ahoraMs = t
    if (p.guardar) vistas[p.guardar] = await tel.estado()
    const base = p.usar ? vistas[p.usar] : undefined

    if (p.op === 'auto') {
      const estadoActual = await tel.estado()
      const orden = ordenParadaAutomatica(estadoActual, { accionTs: t })
      if (!orden) {
        resultados.push(estadoActual.partido.relojEstado === 'corriendo' ? 'aun-hay-tiempo' : 'no-corre')
        continue
      }
      const sobre = construirSobre(estadoActual, orden, { deviceId: tel.deviceId, clientSeq: (await tel.ultimoSeq()) + 1 })
      const c = await (await tel.enviar(sobre)).json()
      resultados.push(c.resultado === 'aceptado' ? 'ok' : c.recibo.motivo)
      continue
    }
    let datos = p.datos ?? {}
    let tipo = TIPO_MOTOR[p.op]
    if (p.op === 'anular') {
      tipo = 'anular-evento'
      datos = { eventoId: (await tel.estado()).eventos.find((e) => e.seq === p.datos.seq).id }
    }
    const { respuesta, cuerpo } = await tel.mandar(tipo, datos, { t, ...(base ? { estado: base } : {}) })
    if (cuerpo.resultado === 'aceptado') resultados.push('ok')
    else if (cuerpo.resultado === 'rechazado') resultados.push(cuerpo.recibo.motivo)
    else resultados.push(`@${cuerpo.resultado ?? cuerpo.tipo ?? respuesta.status}`)
  }
  const e = await tel.estado()
  const auditoria = await dentro(ligaId, (inst) => inst.almacen.sql
    .exec("SELECT json FROM auditoria_reloj WHERE partido_id = 'P' ORDER BY seq").toArray().map((r) => JSON.parse(r.json)))
  return { resultados, proyeccion: proyectar({ partido: e.partido, eventos: e.eventos, auditoria }) }
}

describe('paridad con el adaptador de memoria del motor', () => {
  for (const escenario of ESCENARIOS) {
    it(escenario.nombre, async () => {
      const memoria = await correrEnMotor(escenario)
      const backend = await correrEnBackend(escenario)
      expect(backend.resultados).toEqual(memoria.resultados)
      expect(backend.proyeccion).toEqual(memoria.proyeccion)
    })
  }
})
