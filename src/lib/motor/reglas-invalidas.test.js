import { describe, expect, it } from 'vitest'
import { crearEstado } from './estado'
import { procesar } from './procesador'
import { crearPreparacion } from './preparacion'
import { construirSobre, decidirOrden } from './reglas'
import { contenidoCanonico } from './sobre'
import { evaluarInicio, ordenDeInicio } from '../control/sesion-motor'
import { firmaDeReglas, reglasDeCategoria } from '../reglas-categoria'

// REPORT_177: reglas de categoría ausentes / válidas / inválidas en el motor y en el inicio del teléfono. Sintético.
const T = 1_700_000_000_000
const MINI = reglasDeCategoria({ deporte: 'baloncesto', categoria: 'mini-basketball' })
const estadoCon = (config, partido = {}) => crearEstado({
  gameId: 'G', config: { deporte: 'baloncesto', minutosPorPeriodo: null, ...config },
  partido: { estado: 'vivo', inicio: null, relojEstado: 'detenido', relojRestante: 60_000, relojDesde: null, ...partido },
})
const sobre = (estado, tipo, datos = {}, extra = {}) => construirSobre(estado, { cmdId: `c-${tipo}`, tipo, datos, tiempo: { accionTs: T }, ...extra }, { deviceId: 'd', clientSeq: 1 })
const decide = (config, tipo, datos) => { const e = estadoCon(config); return decidirOrden(e, sobre(e, tipo, datos), { recibidoEn: T, actorId: 'a' }) }

describe('motor: operaciones que dependen de interpretar las reglas', () => {
  it('reglas inválidas sin duración propia: siguiente-periodo y corregir-reloj se rechazan con diagnóstico', () => {
    for (const [tipo, datos] of [['siguiente-periodo', {}], ['corregir-reloj', { restanteMs: 30_000 }]]) {
      const r = decide({ reglas: { version: 9 } }, tipo, datos)
      expect(r, tipo).toMatchObject({ ok: false, motivo: 'reglas-invalidas', diagnostico: { reglas: 'invalidas', operacion: tipo } })
    }
  })
  it('con duración propia esas operaciones no dependen de las reglas; puntos, faltas y cierre tampoco', () => {
    const e = estadoCon({ reglas: { version: 9 }, minutosPorPeriodo: 10 })
    expect(decidirOrden(e, sobre(e, 'siguiente-periodo'), { recibidoEn: T, actorId: 'a' }).ok).toBe(true)
    for (const [tipo, datos] of [['cerrar-partido', {}]]) {
      const s = estadoCon({ reglas: null })
      expect(decidirOrden(s, sobre(s, tipo, datos), { recibidoEn: T, actorId: 'a' }).motivo).not.toBe('reglas-invalidas')
    }
  })
  it('ausentes ≠ inválidas: sin reglas se decide como siempre', () => {
    expect(decide({}, 'siguiente-periodo', {}).ok).toBe(true)
    expect(decide({ reglas: MINI }, 'siguiente-periodo', {}).ok).toBe(true)
  })
  it('el inicio con reglas inválidas se rechaza siempre', () => {
    const e = estadoCon({ reglas: { version: 9 }, minutosPorPeriodo: 10 }, { estado: 'programado' })
    expect(decidirOrden(e, sobre(e, 'iniciar-partido'), { recibidoEn: T, actorId: 'a' })).toMatchObject({ ok: false, motivo: 'reglas-invalidas' })
  })
  it('un recibo ya guardado se devuelve ANTES de mirar las reglas', () => {
    const e = estadoCon({ reglas: { version: 9 } })
    const s = sobre(e, 'siguiente-periodo')
    const recibo = { cmdId: s.cmdId, contenido: contenidoCanonico(s), resultado: 'aceptado' }
    const vista = { estado: e, ultimoClientSeq: 1, reciboPorCmdId: recibo, reciboPorSeq: null, bloqueo: null, preparacion: null }
    expect(procesar(vista, s, { recibidoEn: T, actorId: 'a', gameId: 'G', deviceId: 'd' })).toMatchObject({ tipo: 'recibo-existente', recibo }) // el mismo recibo; no se decide
    expect(procesar({ ...vista, reciboPorCmdId: null, ultimoClientSeq: 0 }, s, { recibidoEn: T, actorId: 'a', gameId: 'G', deviceId: 'd' }).tipo).toBe('rechazado') // una orden NUEVA sí se rechaza
  })
})

describe('sobre de inicio: reglasConfirmadas', () => {
  const e = estadoCon({}, { estado: 'programado' })
  const base = { cmdId: 'c', tipo: 'iniciar-partido', datos: {}, tiempo: { accionTs: T } }
  it('opcional (un sobre sin ella no cambia), solo en el inicio, y es texto', () => {
    const con = construirSobre(e, { ...base, reglasConfirmadas: 'ninguna' }, { deviceId: 'd', clientSeq: 1 })
    expect(con.reglasConfirmadas).toBe('ninguna')
    expect('reglasConfirmadas' in construirSobre(e, base, { deviceId: 'd', clientSeq: 1 })).toBe(false)
    const otro = construirSobre(e, { ...base, tipo: 'anotar', datos: { equipoId: 'A', jugadorId: 'j', puntos: 2 }, reglasConfirmadas: 'x' }, { deviceId: 'd', clientSeq: 1 })
    expect('reglasConfirmadas' in otro).toBe(false) // el motor solo la escribe en el inicio
  })
})

describe('teléfono: inicio con las reglas que mostraba la pantalla', () => {
  const prep = crearPreparacion({
    gameId: 'G', partido: { ligaId: 'L', localId: 'A', visitaId: 'B' }, liga: { id: 'L' },
    equipos: [{ id: 'A', ligaId: 'L' }, { id: 'B', ligaId: 'L' }], jugadores: [], consultaEquipos: ['A', 'B'],
  })
  const ses = (config) => ({ partidoId: 'G', inicio: 'sin-iniciar', divergencia: null, detenida: null, base: { estado: { config } } })
  it('ordenDeInicio lleva la firma de las reglas de la base si las hay; sin reglas conserva el sobre de siempre (sin la clave)', () => {
    expect('reglasConfirmadas' in ordenDeInicio({ cmdId: 'c', preparacion: prep, tiempo: { accionTs: T }, sesion: ses({ deporte: 'baloncesto' }) }).orden).toBe(false)
    expect(ordenDeInicio({ cmdId: 'c', preparacion: prep, tiempo: { accionTs: T }, sesion: ses({ reglas: MINI }) }).orden.reglasConfirmadas).toBe(firmaDeReglas({ reglas: MINI }))
  })
  it('evaluarInicio no permite comenzar con reglas inválidas (marca del servidor o forma dudosa)', () => {
    for (const config of [{ reglasInvalidas: true }, { reglas: { version: 9 } }]) {
      expect(evaluarInicio({ enLinea: true, sesion: ses(config), entradas: [], preparacion: prep })).toMatchObject({ puede: false, motivo: 'reglas-invalidas' })
    }
  })
})
