import { describe, expect, it } from 'vitest'
import { crearBanco, T0 } from './prueba/banco'

// ---------------------------------------------------------------------------
// Cursor de tiempo de reloj de confianza.
//
// Avanzan el cursor SOLO las órdenes que usan tiempo transcurrido y pasaron la
// validación: arrancar-reloj, detener-reloj, parada-automatica y, si el reloj
// corría, cerrar-partido. Puntos, faltas, Deshacer/Rehacer/Anular, corregir-reloj,
// iniciar-partido y siguiente-periodo registran su hora como advertencia si es
// sospechosa y nunca la leen para una cuenta ni mueven el cursor.
// ---------------------------------------------------------------------------

const D = { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }
const DIEZ_ANOS = 10 * 365 * 24 * 3600 * 1000

async function corriendo() {
  const b = crearBanco()
  const r = await b.enviar('arrancar-reloj', {}, { t: T0 })
  expect(r.tipo).toBe('aceptado')
  return b
}

describe('una hora sospechosa de un punto no envenena el reloj', () => {
  it('un punto con hora en un futuro lejano, seguido de un Detener válido, no hace fallar el Detener', async () => {
    const b = await corriendo()
    const punto = await b.enviar('anotar', D, { t: T0 + DIEZ_ANOS, recibidoEn: T0 + 5000 })
    expect(punto.tipo).toBe('aceptado')
    expect(punto.recibo.meta.advertenciasRecepcion).toEqual(['tiempo-futuro'])
    expect(b.adaptador.estado().cursorReloj).toBe(T0) // no se movió

    const parar = await b.enviar('detener-reloj', {}, { t: T0 + 30_000, recibidoEn: T0 + 30_000 })
    expect(parar.tipo).toBe('aceptado')
    expect(b.adaptador.estado().partido).toMatchObject({ relojEstado: 'detenido', relojRestante: 570000 })
    expect(b.adaptador.estado().cursorReloj).toBe(T0 + 30_000)
  })

  it('lo mismo con una falta, un Deshacer y una corrección en pausa con horas basura', async () => {
    const b = await corriendo()
    await b.enviar('detener-reloj', {}, { t: T0 + 1000 })
    for (const [tipo, datos] of [
      ['falta', { equipoId: 'E1', jugadorId: 'J1' }],
      ['anotar', D],
      ['deshacer', {}],
      ['corregir-reloj', { restanteMs: 123000 }],
    ]) {
      const r = await b.enviar(tipo, datos, { t: T0 + DIEZ_ANOS, recibidoEn: T0 + 2000 })
      expect(r.tipo, tipo).toBe('aceptado')
      expect(r.recibo.meta.advertenciasRecepcion, tipo).toEqual(['tiempo-futuro'])
    }
    expect(b.adaptador.estado().cursorReloj).toBe(T0 + 1000)
    const sigue = await b.enviar('arrancar-reloj', {}, { t: T0 + 5000, recibidoEn: T0 + 5000 })
    expect(sigue.tipo).toBe('aceptado')
  })

  it('un punto con hora anterior al cursor se acepta con advertencia, sin mover el cursor', async () => {
    const b = await corriendo()
    const r = await b.enviar('anotar', D, { t: T0 - 3000, recibidoEn: T0 + 1000 })
    expect(r.tipo).toBe('aceptado')
    expect(r.recibo.advertencias).toEqual(['tiempo-anterior-al-reloj'])
    expect(b.adaptador.estado().cursorReloj).toBe(T0)
  })
})

describe('las órdenes que usan tiempo transcurrido sí validan la hora', () => {
  it('un Detener con hora en el futuro lejano se rechaza y no mueve el cursor', async () => {
    const b = await corriendo()
    const r = await b.enviar('detener-reloj', {}, { t: T0 + DIEZ_ANOS, recibidoEn: T0 + 1000 })
    expect(r.tipo).toBe('rechazado')
    expect(r.recibo.motivo).toBe('tiempo-invalido')
    expect(b.adaptador.estado().cursorReloj).toBe(T0)
    expect(b.adaptador.estado().partido.relojEstado).toBe('corriendo')
  })

  it('una hora un poco adelantada, dentro de la tolerancia, se acepta', async () => {
    const b = await corriendo()
    const r = await b.enviar('detener-reloj', {}, { t: T0 + 2000, recibidoEn: T0 + 500 })
    expect(r.tipo).toBe('aceptado')
  })

  it('un Detener anterior al arranque o anterior al cursor se rechaza', async () => {
    const b = await corriendo()
    const r = await b.enviar('detener-reloj', {}, { t: T0 - 1, recibidoEn: T0 + 1000 })
    expect(r.recibo.motivo).toBe('tiempo-invalido')
    await b.enviar('detener-reloj', {}, { t: T0 + 10_000 })
    const r2 = await b.enviar('arrancar-reloj', {}, { t: T0 + 5000, recibidoEn: T0 + 20_000 })
    expect(r2.recibo.motivo).toBe('tiempo-invalido') // antes del cursor
  })

  it('cuáles órdenes avanzan el cursor: arrancar, detener, parada automática y cerrar con el reloj corriendo', async () => {
    const b = crearBanco({ reloj: { relojRestante: 5000 } })
    const cursor = () => b.adaptador.estado().cursorReloj
    expect(cursor()).toBeNull()
    await b.enviar('anotar', D, { t: T0 }); expect(cursor()).toBeNull()
    await b.enviar('arrancar-reloj', {}, { t: T0 + 1 }); expect(cursor()).toBe(T0 + 1)
    await b.paradaAutomatica(T0 + 5001); expect(cursor()).toBe(T0 + 5001)
    await b.enviar('corregir-reloj', { restanteMs: 9000 }, { t: T0 + 6000 }); expect(cursor()).toBe(T0 + 5001)
    await b.enviar('arrancar-reloj', {}, { t: T0 + 7000 }); expect(cursor()).toBe(T0 + 7000)
    await b.enviar('cerrar-partido', {}, { t: T0 + 8000 }); expect(cursor()).toBe(T0 + 8000)
  })

  it('cerrar con el reloj detenido, siguiente-periodo e iniciar no mueven el cursor', async () => {
    const b = crearBanco({ estado: 'programado' })
    await b.enviar('iniciar-partido', {}, { t: T0 }); expect(b.adaptador.estado().cursorReloj).toBeNull()
    await b.enviar('siguiente-periodo', {}, { t: T0 + 10 }); expect(b.adaptador.estado().cursorReloj).toBeNull()
    await b.enviar('cerrar-partido', {}, { t: T0 + 20 }); expect(b.adaptador.estado().cursorReloj).toBeNull()
  })
})

describe('las discontinuidades detectadas no se ocultan', () => {
  const tiempo = (extra = {}) => ({ accionTs: T0 + 1000, accionTsCrudo: T0 - 4000, ajusteTsMs: 5000, ...extra })

  it('la hora cruda, la ajustada y la discontinuidad quedan en la auditoría y en el recibo', async () => {
    const b = await corriendo()
    const disc = { saltoMs: -5000, causa: 'desconocida' }
    const r = await b.enviar('detener-reloj', {}, { tiempo: tiempo({ discontinuidad: disc }), recibidoEn: T0 + 1000 })
    expect(r.tipo).toBe('aceptado')
    expect(r.recibo.advertencias).toEqual(['discontinuidad-reloj-dispositivo', 'ajuste-de-tiempo'])
    expect(b.adaptador.auditoria().at(-1)).toMatchObject({
      accionTsCrudo: T0 - 4000, ajusteTsMs: 5000, discontinuidad: disc, ts: new Date(T0 + 1000).toISOString(),
    })
  })

  it('un ajuste sin discontinuidad declarada también deja advertencia', async () => {
    const b = await corriendo()
    const r = await b.enviar('anotar', D, { tiempo: tiempo(), recibidoEn: T0 + 1000 })
    expect(r.recibo.advertencias).toEqual(['ajuste-de-tiempo'])
  })

  it('la discontinuidad viaja también en un rechazo, y el contenido canónico la incluye', async () => {
    const b = await corriendo()
    const disc = { saltoMs: 40_000 }
    const r = await b.enviar('detener-reloj', {}, { tiempo: { accionTs: T0 + DIEZ_ANOS, discontinuidad: disc }, recibidoEn: T0 + 1000 })
    expect(r.recibo.motivo).toBe('tiempo-invalido')
    expect(r.recibo.advertencias).toEqual(['discontinuidad-reloj-dispositivo'])
    expect(r.recibo.contenido).toContain('"saltoMs":40000')
  })

  it('tras un Detener rechazado por tiempo, un Detener nuevo con hora válida y una corrección en pausa sí se aplican; el original sigue sin aplicar', async () => {
    const b = await corriendo()
    const malo = await b.enviar('detener-reloj', {}, { cmdId: 'malo', t: T0 + DIEZ_ANOS, recibidoEn: T0 + 1000 })
    expect(malo.recibo.motivo).toBe('tiempo-invalido')
    const nuevo = await b.enviar('detener-reloj', {}, { cmdId: 'nuevo', t: T0 + 20_000 })
    expect(nuevo.tipo).toBe('aceptado')
    const corr = await b.enviar('corregir-reloj', { restanteMs: 590000 }, { t: T0 + 21_000 })
    expect(corr.tipo).toBe('aceptado')
    // El recibo del original sigue siendo el rechazo: la corrección no lo reaplicó ni lo cambió.
    expect(b.adaptador.recibos().malo.resultado).toBe('rechazado')
    expect(b.adaptador.auditoria().some((f) => f.cmdId === 'malo')).toBe(false)
  })
})
