import { describe, expect, it } from 'vitest'
import { estadoDeFilas } from './estado'
import { ordenParadaAutomatica, construirSobre } from './reglas'
import { crearAdaptadorMemoria } from './prueba/adaptador-memoria'
import { ATRIBUCION_DE_PRUEBA, T0, crearBanco, ejecutarAutorizado } from './prueba/banco'

// ---------------------------------------------------------------------------
// M3: identidad de la corrida y cursor de tiempo reconstruidos desde filas.
// Una fila de arranque solo identifica la corrida actual si su estado
// registrado coincide con el actual y nada vino después; si no, la corrida es
// heredada y lo dice. El cursor solo usa horas de órdenes de reloj que se
// pueden comprobar.
// ---------------------------------------------------------------------------

const liga = { id: 'L', deporte: 'baloncesto' }
const iso = (ms) => new Date(ms).toISOString()
const estadoReloj = (relojEstado, relojRestante, relojDesde) => ({ estado: 'vivo', relojEstado, relojRestante, relojDesde, efectivoMs: relojRestante })
const fila = (seq, comando, ts, antes, despues, extra = {}) => ({
  id: `a${seq}`, partidoId: 'P', seq, reloj: 'juego', comando, ts: iso(ts), antes, despues, ...extra,
})
const arranque = (seq, ts, restante = 5000) => fila(seq, 'arrancar', ts, estadoReloj('detenido', restante, null), estadoReloj('corriendo', restante, ts))
const parada = (seq, ts, desde, comando = 'detener') => fila(seq, comando, ts, estadoReloj('corriendo', 5000, desde), estadoReloj('detenido', 0, null))
const corriendo = (desde, restante = 5000) => ({ id: 'P', estado: 'vivo', relojEstado: 'corriendo', relojRestante: restante, relojDesde: desde })

const reconstruir = (partido, filas) => estadoDeFilas({ partido, liga, auditoriaReloj: filas })

describe('identidad de la corrida desde las filas', () => {
  it('una corrida genuina conserva su identidad: el último arranque, con el mismo ancla y restante', () => {
    const e = reconstruir(corriendo(T0 + 10), [fila(1, 'inicio-partido', T0, null, estadoReloj('detenido', 5000, null)), arranque(2, T0 + 10)])
    expect(e.corridaSeq).toBe(2)
    expect(e.cursorReloj).toBe(T0 + 10)
  })

  it('un arranque antiguo seguido de parada, periodo o cierre no es la corrida actual sin registro', () => {
    for (const posterior of [
      parada(2, T0 + 1000, T0, 'detener'),
      parada(2, T0 + 5000, T0, 'parada-automatica'),
      fila(2, 'reinicio-periodo', T0 + 900, estadoReloj('corriendo', 5000, T0), estadoReloj('detenido', 600000, null)),
      parada(2, T0 + 900, T0, 'cierre-partido'),
      fila(2, 'inicio-partido', T0 + 900, null, estadoReloj('detenido', 600000, null)),
      fila(2, 'correccion-reloj', T0 + 900, estadoReloj('detenido', 5000, null), estadoReloj('detenido', 7000, null)),
    ]) {
      // La corrida actual arrancó después, sin dejar su propio registro (escritura directa o dato antiguo).
      const e = reconstruir(corriendo(T0 + 2000), [arranque(1, T0), posterior])
      expect(e.corridaSeq, posterior.comando).toBe(`legacy:${T0 + 2000}:2`)
      expect(e.corridaSeq).not.toBe(1)
    }
  })

  it('un arranque cuyo ancla o restante no coinciden con el estado actual no se hereda', () => {
    expect(reconstruir(corriendo(T0 + 7), [arranque(1, T0)]).corridaSeq).toBe(`legacy:${T0 + 7}:1`)
    expect(reconstruir(corriendo(T0, 4000), [arranque(1, T0, 5000)]).corridaSeq).toBe(`legacy:${T0}:1`)
  })

  it('un arranque sin evidencia de su estado registrado no se usa', () => {
    const sinDespues = { ...arranque(1, T0), despues: undefined }
    expect(reconstruir(corriendo(T0), [sinDespues]).corridaSeq).toBe(`legacy:${T0}:1`)
    const estadoAjeno = { ...arranque(1, T0), despues: estadoReloj('detenido', 5000, null) }
    expect(reconstruir(corriendo(T0), [estadoAjeno]).corridaSeq).toBe(`legacy:${T0}:1`)
  })

  it('solo con el registro de inicio del partido y un reloj corriendo sin arranque registrado es heredada', () => {
    const e = reconstruir(corriendo(T0 + 5), [fila(1, 'inicio-partido', T0, null, estadoReloj('detenido', 5000, null))])
    expect(e.corridaSeq).toBe(`legacy:${T0 + 5}:1`)
  })

  it('sin filas, la corrida es heredada con auditoría 0; con el reloj detenido no hay corrida', () => {
    expect(reconstruir(corriendo(T0), []).corridaSeq).toBe(`legacy:${T0}:0`)
    expect(reconstruir({ id: 'P', estado: 'vivo', relojEstado: 'detenido', relojRestante: 5, relojDesde: null }, [arranque(1, T0)]).corridaSeq).toBeNull()
  })

  it('el recibo de parada automática de una corrida anterior no suprime la parada de la corrida actual', async () => {
    // Corrida 1, con su parada automática ya recibida por el servidor.
    const viejo = crearBanco({ reloj: { relojRestante: 5000 } })
    await viejo.enviar('arrancar-reloj', {}, { t: T0 })
    const p = await viejo.paradaAutomatica(T0 + 5000)
    expect(p.resultado.tipo).toBe('aceptado')
    expect(Object.keys(viejo.adaptador.recibos())).toContain('auto:P:1')

    // Después, un reloj vuelve a correr sin dejar registro; se reconstruye desde las filas.
    const partido = { id: 'P', estado: 'vivo', relojEstado: 'corriendo', relojRestante: 5000, relojDesde: T0 + 20_000 }
    const estado = estadoDeFilas({
      partido, liga, auditoriaReloj: viejo.adaptador.auditoria(), eventos: [], rev: viejo.adaptador.estado().rev,
      atribucion: ATRIBUCION_DE_PRUEBA,
    })
    expect(estado.corridaSeq).toBe(`legacy:${T0 + 20_000}:2`)

    const adaptador = crearAdaptadorMemoria({
      estado, ultimoClientSeq: viejo.adaptador.ultimoClientSeq(), recibosIniciales: viejo.adaptador.recibos(),
    })
    const orden = ordenParadaAutomatica(estado, { accionTs: T0 + 25_000 })
    expect(orden.cmdId).not.toBe('auto:P:1')
    const sobre = construirSobre(estado, orden, { deviceId: 'tel-A', clientSeq: adaptador.ultimoClientSeq() + 1 })
    const r = await ejecutarAutorizado(adaptador, sobre, { recibidoEn: T0 + 25_000 })
    expect(r.tipo).toBe('aceptado')
    expect(adaptador.estado().partido).toMatchObject({ relojEstado: 'detenido', relojRestante: 0 })
    expect(adaptador.auditoria().at(-1)).toMatchObject({ comando: 'parada-automatica', corridaSeq: `legacy:${T0 + 20_000}:2` })
    // El recibo de la corrida anterior sigue intacto.
    expect(adaptador.recibos()['auto:P:1']).toEqual(viejo.adaptador.recibos()['auto:P:1'])
  })
})

describe('cursor de tiempo desde las filas', () => {
  it('cerrar con el reloj ya detenido no avanza el cursor de confianza', () => {
    const filas = [
      arranque(1, T0),
      parada(2, T0 + 1000, T0),
      fila(3, 'cierre-partido', T0 + 99_999, estadoReloj('detenido', 4000, null), { ...estadoReloj('detenido', 4000, null), estado: 'final' }),
    ]
    expect(reconstruir({ id: 'P', estado: 'final', relojEstado: 'detenido', relojRestante: 4000, relojDesde: null }, filas).cursorReloj).toBe(T0 + 1000)
  })

  it('cerrar con el reloj corriendo sí lo avanza', () => {
    const filas = [arranque(1, T0), parada(2, T0 + 3000, T0, 'cierre-partido')]
    expect(reconstruir({ id: 'P', estado: 'final', relojEstado: 'detenido', relojRestante: 0, relojDesde: null }, filas).cursorReloj).toBe(T0 + 3000)
  })

  it('horas de filas que no son de tiempo transcurrido, o que no se pueden comprobar, no lo envenenan', () => {
    const lejano = T0 + 10 * 365 * 24 * 3600 * 1000
    const filas = [
      arranque(1, T0),
      parada(2, T0 + 2000, T0),
      fila(3, 'correccion-reloj', lejano, estadoReloj('detenido', 0, null), estadoReloj('detenido', 9000, null)),
      fila(4, 'reinicio-periodo', lejano, estadoReloj('detenido', 9000, null), estadoReloj('detenido', 600000, null)),
      fila(5, 'inicio-partido', lejano, null, estadoReloj('detenido', 600000, null)),
      // Filas de reloj con evidencia falsa o ausente:
      fila(6, 'arrancar', lejano, estadoReloj('detenido', 600000, null), estadoReloj('corriendo', 600000, T0 + 3000)), // la hora no es el ancla
      fila(7, 'detener', lejano, estadoReloj('detenido', 1, null), estadoReloj('detenido', 1, null)), // el reloj no corría
      fila(8, 'detener', T0 + 1, estadoReloj('corriendo', 1, T0 + 5000), estadoReloj('detenido', 1, null)), // antes de su propio ancla
      { ...fila(9, 'detener', T0 + 4000, null, null), antes: undefined },
      { ...fila(10, 'arrancar', T0, null, null), ts: 'no es una fecha' },
    ]
    const e = reconstruir({ id: 'P', estado: 'vivo', relojEstado: 'detenido', relojRestante: 600000, relojDesde: null }, filas)
    expect(e.cursorReloj).toBe(T0 + 2000)
    // Los eventos de marcador con horas absurdas tampoco cuentan.
    const conEventos = estadoDeFilas({
      partido: { id: 'P', estado: 'vivo', relojEstado: 'detenido', relojRestante: 1, relojDesde: null },
      liga,
      auditoriaReloj: [arranque(1, T0), parada(2, T0 + 2000, T0)],
      eventos: [{ id: 'e', seq: 1, tipo: 'punto', creadoEn: lejano, anuladoEn: lejano }],
    })
    expect(conEventos.cursorReloj).toBe(T0 + 2000)
  })
})

describe('las filas reconstruyen el mismo estado que produjo el motor', () => {
  async function recorrer(pasos, inicial = {}) {
    const b = crearBanco(inicial)
    let t = T0
    for (const [tipo, datos, avance = 1000] of pasos) {
      t += avance
      const r = tipo === 'auto' ? (await b.paradaAutomatica(t))?.resultado : await b.enviar(tipo, datos ?? {}, { t })
      expect(r?.tipo, `${tipo} @${t}`).toBe('aceptado')
      const motor = b.adaptador.estado()
      const filas = estadoDeFilas({
        partido: { id: 'P', ...motor.partido },
        liga,
        eventos: motor.eventos,
        auditoriaReloj: b.adaptador.auditoria(),
        rev: motor.rev,
        atribucion: motor.atribucion,
      })
      expect(filas.corridaSeq, `corridaSeq tras ${tipo}`).toEqual(motor.corridaSeq)
      expect(filas.cursorReloj, `cursor tras ${tipo}`).toEqual(motor.cursorReloj)
      expect(filas.auditSeq, `auditSeq tras ${tipo}`).toEqual(motor.auditSeq)
      expect(filas).toEqual(motor)
    }
  }

  it('en una secuencia completa con paradas, correcciones, periodo con el reloj corriendo y cierre', async () => {
    await recorrer([
      ['arrancar-reloj'], ['anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }], ['detener-reloj'],
      ['corregir-reloj', { restanteMs: 5000 }], ['arrancar-reloj'], ['auto', null, 5000],
      ['corregir-reloj', { restanteMs: 3000 }], ['arrancar-reloj'], ['siguiente-periodo'],
      ['arrancar-reloj'], ['cerrar-partido'],
    ], { reloj: { relojRestante: 5000 } })
  })

  it('cerrar con el reloj detenido', async () => {
    await recorrer([['arrancar-reloj'], ['detener-reloj'], ['cerrar-partido']])
  })

  it('desde el inicio del partido', async () => {
    await recorrer([['iniciar-partido'], ['arrancar-reloj'], ['detener-reloj'], ['siguiente-periodo']], { estado: 'programado', reloj: { relojRestante: null } })
  })
})
