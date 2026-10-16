import { describe, expect, it } from 'vitest'
import { crearCola, encolar } from '../motor'
import { ATRIBUCION_DE_PRUEBA, estadoDePrueba, T0 } from '../motor/prueba/banco'
import {
  PARAMETROS_RELOJ, crearOrden, crearRelojTelefono, estimar, evaluarParadaAutomatica, incorporarMuestra, marcaDeAguaDeReloj,
  requiereTiempoDeConfianza, tiempoDeConfianza, tiempoInformativo,
} from './reloj-telefono'

const L = (paredMs, monoMs, sesionId = 'p1') => ({ paredMs, monoMs, sesionId })
// Una muestra: el servidor dijo SERV con RTT 100 → ancla en SERV + 50, tomada con pared PARED y monótono 1000.
const conMuestra = (serv = T0, rtt = 100, lectura = L(serv + 50, 1000)) => {
  const r = incorporarMuestra(crearRelojTelefono(), { servidorAhoraMs: serv, rttMs: rtt }, lectura)
  expect(r.ok).toBe(true)
  return r.reloj
}
const cola0 = (e) => crearCola({ gameId: e.gameId, deviceId: 'tel-A', ultimoClientSeqServidor: 0, revServidor: e.rev })

describe('parámetros provisionales', () => {
  it('son los aprobados y están congelados', () => {
    expect(PARAMETROS_RELOJ).toEqual({ rttMaxMs: 1000, derivaPpm: 200, presupuestoMs: 1000, remuestreoMs: 300000, saltoMs: 1000, retrocesoMaxMs: 500 })
    expect(Object.isFrozen(PARAMETROS_RELOJ)).toBe(true)
    expect(PARAMETROS_RELOJ.retrocesoMaxMs).toBeLessThanOrEqual(500)
  })
})

describe('muestras del servidor', () => {
  it('RTT 1000 ms se acepta; 1001 ms se descarta y se conserva el estado anterior', () => {
    const base = conMuestra()
    expect(incorporarMuestra(crearRelojTelefono(), { servidorAhoraMs: T0, rttMs: 1000 }, L(T0, 5)).ok).toBe(true)
    const mala = incorporarMuestra(base, { servidorAhoraMs: T0 + 9, rttMs: 1001 }, L(T0, 5))
    expect(mala).toEqual({ ok: false, motivo: 'rtt-excesivo', reloj: base })
  })
  it('el ancla es la hora del servidor más medio RTT', () => {
    expect(conMuestra(T0, 100).ancla.servidorMs).toBe(T0 + 50)
    expect(conMuestra(T0, 101).ancla.servidorMs).toBe(T0 + 51) // redondeo
  })
  it('muestras inválidas no se aceptan', () => {
    for (const m of [{ servidorAhoraMs: 1.5, rttMs: 10 }, { servidorAhoraMs: T0, rttMs: -1 }, { servidorAhoraMs: T0, rttMs: Number.NaN }]) {
      expect(incorporarMuestra(crearRelojTelefono(), m, L(1, 1)).motivo).toBe('muestra-invalida')
    }
    expect(incorporarMuestra(crearRelojTelefono(), { servidorAhoraMs: T0, rttMs: 10 }, { paredMs: 1, monoMs: 1 }).motivo).toBe('muestra-invalida')
  })
})

describe('estimación', () => {
  it('sin muestra: no hay estimación, solo la hora cruda', () => {
    const e = estimar(crearRelojTelefono(), L(T0 + 7, 3))
    expect(e).toMatchObject({ nivel: 'sin-estimacion', motivo: 'sin-muestra', estimadoMs: null, accionTsCrudo: T0 + 7, remuestreoDebido: true })
  })
  it('confiable: el tiempo monótono transcurrido se suma al ancla y la incertidumbre es RTT/2 + deriva', () => {
    const reloj = conMuestra(T0, 100)
    const e = estimar(reloj, L(T0 + 50 + 10_000, 1000 + 10_000))
    expect(e.nivel).toBe('confiable')
    expect(e.estimadoMs).toBe(T0 + 50 + 10_000)
    expect(e.incertidumbreMs).toBe(Math.ceil(50 + 10_000 * 200 / 1e6)) // 52
    expect(e.discontinuidad).toBeNull()
    expect(e.remuestreoDebido).toBe(false)
  })
  it('deriva: el presupuesto de 1000 ms se agota a los 3.000.000 ms con RTT 800 (200 ppm = 600 ms)', () => {
    const reloj = conMuestra(T0, 800, L(T0, 0))
    expect(estimar(reloj, L(T0 + 3_000_000, 3_000_000)).nivel).toBe('confiable') // U = 1000 exactos
    const e = estimar(reloj, L(T0 + 3_000_001, 3_000_001))
    expect(e).toMatchObject({ nivel: 'degradado', motivo: 'incertidumbre-excedida', incertidumbreMs: 1001, remuestreoDebido: true })
  })
  it('remuestreo debido a los 5 minutos aunque todavía sea confiable', () => {
    const reloj = conMuestra(T0, 100, L(T0, 0))
    expect(estimar(reloj, L(T0 + 299_999, 299_999)).remuestreoDebido).toBe(false)
    const e = estimar(reloj, L(T0 + 300_000, 300_000))
    expect(e.nivel).toBe('confiable')
    expect(e.remuestreoDebido).toBe(true)
  })
  it('sueño del dispositivo: el monótono se atrasa 30 s respecto de la pared → degradado con discontinuidad', () => {
    const reloj = conMuestra(T0, 100, L(T0, 0))
    const e = estimar(reloj, L(T0 + 30_100, 100))
    expect(e).toMatchObject({ nivel: 'degradado', motivo: 'salto-de-reloj', discontinuidad: { saltoMs: 30_000, causa: 'pared-adelanta-al-monotono' }, remuestreoDebido: true })
  })
  it('el umbral de salto es 1000 ms: 1000 sigue confiable y 1001 no', () => {
    const reloj = conMuestra(T0, 100, L(T0, 0))
    expect(estimar(reloj, L(T0 + 5_000, 4_000)).nivel).toBe('confiable') // salto = 1000
    const e = estimar(reloj, L(T0 + 5_001, 4_000))
    expect(e.nivel).toBe('degradado')
    expect(e.discontinuidad.saltoMs).toBe(1001)
  })
  it('salto de la hora de pared hacia adelante (+10 min) o hacia atrás (−5 min)', () => {
    const reloj = conMuestra(T0, 100, L(T0, 0))
    const adelante = estimar(reloj, L(T0 + 600_000 + 2_000, 2_000))
    expect(adelante.discontinuidad).toEqual({ saltoMs: 600_000, causa: 'pared-adelanta-al-monotono' })
    const atras = estimar(reloj, L(T0 + 2_000 - 300_000, 2_000))
    expect(atras.discontinuidad).toEqual({ saltoMs: -300_000, causa: 'pared-atrasa-al-monotono' })
    expect(atras.nivel).toBe('degradado')
  })
  it('un salto mantiene la pérdida de confianza hasta una muestra nueva', () => {
    const reloj = conMuestra(T0, 100, L(T0, 0))
    expect(estimar(reloj, L(T0 + 400_000, 1_000)).nivel).toBe('degradado')
    expect(estimar(reloj, L(T0 + 401_000, 2_000)).nivel).toBe('degradado') // el salto sigue ahí
    const nueva = incorporarMuestra(reloj, { servidorAhoraMs: T0 + 401_000, rttMs: 80 }, L(T0 + 401_000, 2_000))
    expect(nueva.ok).toBe(true)
    expect(estimar(nueva.reloj, L(T0 + 402_000, 3_000)).nivel).toBe('confiable')
  })
  it('recarga sin conexión: se pierde el ancla monótona → degradado; usa el desfase guardado y arrastra un salto de pared', () => {
    const reloj = JSON.parse(JSON.stringify(conMuestra(T0, 100, L(T0 + 5_000, 7_000)))) // el estado es serializable
    // otra sesión de página; la hora de pared saltó +10 min mientras estaba cerrada
    const e = estimar(reloj, L(T0 + 5_000 + 60_000 + 600_000, 10, 'p2'))
    expect(e).toMatchObject({ nivel: 'degradado', motivo: 'ancla-perdida', remuestreoDebido: true, discontinuidad: null })
    expect(e.estimadoMs).toBe(T0 + 5_000 + 60_000 + 600_000 + (T0 + 50 - (T0 + 5_000)))
    expect(tiempoDeConfianza(estadoDePrueba({ estado: 'vivo' }), e)).toMatchObject({ ok: false, motivo: 'sin-tiempo-confiable', detalle: 'ancla-perdida', requiereResincronizacion: true })
  })
  it('un monótono que retrocede no es de confianza', () => {
    expect(estimar(conMuestra(T0, 100, L(T0, 5000)), L(T0 + 10, 4000))).toMatchObject({ nivel: 'degradado', motivo: 'mono-retrocede', estimadoMs: null })
  })
})

describe('tiempo informativo (puntos, faltas, periodo, corrección con el reloj detenido)', () => {
  it('sin ninguna muestra: la hora cruda tal cual, sin ajuste y marcada como cruda', () => {
    const { tiempo, fuente } = tiempoInformativo(estimar(crearRelojTelefono(), L(T0 + 9, 1)))
    expect(fuente).toBe('crudo')
    expect(tiempo).toEqual({ accionTs: T0 + 9, accionTsCrudo: T0 + 9, ajusteTsMs: 0, discontinuidad: null })
  })
  it('confiable: la estimación, con la hora cruda y el ajuste visibles', () => {
    const reloj = conMuestra(T0, 100, L(T0 + 4_000, 0)) // el teléfono va 3950 ms por delante del servidor
    const { tiempo, fuente } = tiempoInformativo(estimar(reloj, L(T0 + 4_000, 0)))
    expect(fuente).toBe('estimado')
    expect(tiempo).toEqual({ accionTs: T0 + 50, accionTsCrudo: T0 + 4_000, ajusteTsMs: -3_950, discontinuidad: null })
  })
  it('degradado: la estimación identificada como tal y la discontinuidad, si se vio una', () => {
    const reloj = conMuestra(T0, 100, L(T0, 0))
    const { tiempo, fuente } = tiempoInformativo(estimar(reloj, L(T0 + 30_100, 100)))
    expect(fuente).toBe('estimado-degradado')
    expect(tiempo.discontinuidad).toEqual({ saltoMs: 30_000, causa: 'pared-adelanta-al-monotono' })
    expect(tiempo.ajusteTsMs).toBe(tiempo.accionTs - tiempo.accionTsCrudo)
  })
})

describe('marca de agua del reloj de confianza', () => {
  it('sale del estado del motor: cursor y ancla de la corrida, nada más', () => {
    expect(marcaDeAguaDeReloj(estadoDePrueba({ estado: 'vivo' }))).toBeNull()
    expect(marcaDeAguaDeReloj(estadoDePrueba({ extra: { cursorReloj: T0 + 10 } }))).toBe(T0 + 10)
    const corriendo = estadoDePrueba({ reloj: { relojEstado: 'corriendo', relojRestante: 600000, relojDesde: T0 + 50 }, extra: { cursorReloj: T0 + 10, corridaSeq: 1 } })
    expect(marcaDeAguaDeReloj(corriendo)).toBe(T0 + 50)
  })
  it('una hora cruda lejana en el futuro de un PUNTO no la toca (no envenena la resincronización)', () => {
    const estado = estadoDePrueba({ estado: 'vivo' })
    const lejana = { accionTs: T0 + 3_600_000, accionTsCrudo: T0 + 3_600_000, ajusteTsMs: 0, discontinuidad: null }
    const r = encolar(cola0(estado), estado, { cmdId: 'p1', tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, tiempo: lejana }, { ahoraEstimado: T0 })
    expect(r.rechazoLocal).toBeUndefined()
    expect(r.estado.eventos[0].creadoEn).toBe(T0 + 3_600_000)
    expect(marcaDeAguaDeReloj(r.estado)).toBeNull()
    expect(r.estado.cursorReloj).toBeNull()
    // Y una orden de reloj posterior con tiempo de confianza correcto es válida para el motor.
    const est = estimar(conMuestra(T0, 100, L(T0, 0)), L(T0 + 10, 10))
    const orden = crearOrden({ estadoProvisional: r.estado, tipo: 'arrancar-reloj', cmdId: 'a1', estimacion: est })
    expect(orden.ok).toBe(true)
    const a = encolar(r.cola, r.estado, orden.orden, { ahoraEstimado: est.estimadoMs })
    expect(a.rechazoLocal).toBeUndefined()
    expect(a.sobre.accionTs).toBeLessThan(T0 + 3_600_000)
  })
})

describe('tiempo de confianza y retroceso', () => {
  const corriendo = estadoDePrueba({ reloj: { relojEstado: 'corriendo', relojRestante: 600000, relojDesde: T0 + 1000 }, extra: { cursorReloj: T0 + 1000, corridaSeq: 1, auditSeq: 1 } })
  const est = (estimadoMs) => ({ nivel: 'confiable', estimadoMs, accionTsCrudo: estimadoMs + 3, discontinuidad: null })
  it('una estimación por delante de la marca de agua se usa tal cual', () => {
    expect(tiempoDeConfianza(corriendo, est(T0 + 5000))).toEqual({
      ok: true, tiempo: { accionTs: T0 + 5000, accionTsCrudo: T0 + 5003, ajusteTsMs: -3, discontinuidad: null }, ajustadoPorRetroceso: false,
    })
  })
  it('un retroceso de hasta 500 ms sube la hora a la marca de agua (y queda el ajuste)', () => {
    const r = tiempoDeConfianza(corriendo, est(T0 + 1000 - 500))
    expect(r).toMatchObject({ ok: true, ajustadoPorRetroceso: true })
    expect(r.tiempo.accionTs).toBe(T0 + 1000)
    expect(r.tiempo.ajusteTsMs).toBe(r.tiempo.accionTs - r.tiempo.accionTsCrudo)
  })
  it('más de 500 ms por detrás NO se sostiene: se pide resincronizar y no se crea nada', () => {
    const r = tiempoDeConfianza(corriendo, est(T0 + 1000 - 501))
    expect(r).toEqual({ ok: false, motivo: 'estimacion-detras-del-reloj', faltaMs: 501, requiereResincronizacion: true })
    expect(tiempoDeConfianza(corriendo, est(T0 + 1000 - 4000)).faltaMs).toBe(4000) // ejemplo B del informe
  })
  it('sin tiempo confiable no hay orden de reloj, con o sin retroceso', () => {
    expect(tiempoDeConfianza(corriendo, { nivel: 'degradado', motivo: 'salto-de-reloj', estimadoMs: T0 + 9000, accionTsCrudo: T0 + 9000 }).ok).toBe(false)
    expect(tiempoDeConfianza(corriendo, { nivel: 'sin-estimacion', motivo: 'sin-muestra', estimadoMs: null, accionTsCrudo: T0 }).ok).toBe(false)
  })
})

describe('qué órdenes necesitan tiempo de confianza (reglas del motor, sin cambiarlas)', () => {
  const parado = estadoDePrueba({ estado: 'vivo' })
  const marcha = estadoDePrueba({ reloj: { relojEstado: 'corriendo', relojRestante: 600000, relojDesde: T0 }, extra: { corridaSeq: 1 } })
  it('tabla', () => {
    for (const tipo of ['arrancar-reloj', 'detener-reloj', 'parada-automatica']) expect(requiereTiempoDeConfianza(parado, tipo)).toBe(true)
    for (const tipo of ['anotar', 'falta', 'deshacer', 'rehacer', 'anular-evento', 'siguiente-periodo', 'corregir-reloj', 'iniciar-partido']) {
      expect(requiereTiempoDeConfianza(parado, tipo), tipo).toBe(false)
      expect(requiereTiempoDeConfianza(marcha, tipo), tipo).toBe(false)
    }
    expect(requiereTiempoDeConfianza(parado, 'cerrar-partido')).toBe(false)
    expect(requiereTiempoDeConfianza(marcha, 'cerrar-partido')).toBe(true)
  })
  it('sin muestra: puntos, faltas, siguiente periodo y corregir un reloj detenido se crean con la hora cruda; detener y arrancar no', () => {
    const sin = estimar(crearRelojTelefono(), L(T0, 1))
    for (const [tipo, datos] of [['anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }], ['falta', { equipoId: 'E1', jugadorId: 'J1' }], ['siguiente-periodo', {}], ['corregir-reloj', { restanteMs: 500000 }]]) {
      const r = crearOrden({ estadoProvisional: parado, tipo, datos, cmdId: `x-${tipo}`, estimacion: sin })
      expect(r, tipo).toMatchObject({ ok: true, fuente: 'crudo' })
    }
    for (const tipo of ['arrancar-reloj', 'detener-reloj']) {
      expect(crearOrden({ estadoProvisional: marcha, tipo, cmdId: 'z', estimacion: sin })).toMatchObject({ ok: false, motivo: 'sin-tiempo-confiable', requiereResincronizacion: true })
    }
  })
  it('con el reloj en marcha y sin tiempo de confianza: se puede pasar de periodo (regla del motor) pero no corregir ni detener', () => {
    const sin = estimar(crearRelojTelefono(), L(T0, 1))
    const cola = cola0(marcha)
    const sig = crearOrden({ estadoProvisional: marcha, tipo: 'siguiente-periodo', cmdId: 'sp', estimacion: sin })
    expect(sig.ok).toBe(true)
    const r = encolar(cola, marcha, sig.orden, { ahoraEstimado: T0 })
    expect(r.rechazoLocal).toBeUndefined()
    expect(r.estado.partido).toMatchObject({ relojEstado: 'detenido', relojRestante: 600000, relojDesde: null })
    expect(r.estado.corridaSeq).toBeNull()
    const corr = crearOrden({ estadoProvisional: marcha, tipo: 'corregir-reloj', datos: { restanteMs: 400000 }, cmdId: 'cr', estimacion: sin })
    expect(corr.ok).toBe(true) // se crea, pero el motor lo rechaza con el reloj en marcha
    expect(encolar(cola, marcha, corr.orden, { ahoraEstimado: T0 }).rechazoLocal).toEqual({ motivo: 'reloj-corriendo' })
    expect(crearOrden({ estadoProvisional: marcha, tipo: 'detener-reloj', cmdId: 'dt', estimacion: sin }).ok).toBe(false)
  })
})

describe('parada automática', () => {
  const plazo = T0 + 600_000 // relojDesde + relojRestante
  const marcha = estadoDePrueba({ reloj: { relojEstado: 'corriendo', relojRestante: 600000, relojDesde: T0 }, extra: { cursorReloj: T0, corridaSeq: 1, auditSeq: 1 } })
  const conf = (estimadoMs, crudo = estimadoMs + 7) => ({ nivel: 'confiable', estimadoMs, accionTsCrudo: crudo, discontinuidad: null })
  it('con el reloj detenido no aplica', () => {
    expect(evaluarParadaAutomatica(estadoDePrueba({ estado: 'vivo' }), conf(plazo))).toEqual({ estado: 'no-aplica' })
  })
  it('antes del plazo: no vencida, con lo que falta', () => {
    expect(evaluarParadaAutomatica(marcha, conf(plazo - 1))).toEqual({ estado: 'no-vencida', vencimientoMs: plazo, faltaMs: 1 })
  })
  it('sin poder establecer si venció: incierta, y no se inventa la orden (aunque la pared ya pasó el plazo)', () => {
    const e = evaluarParadaAutomatica(marcha, { nivel: 'degradado', motivo: 'ancla-perdida', estimadoMs: plazo + 99999, accionTsCrudo: plazo + 99999, discontinuidad: null })
    expect(e).toEqual({ estado: 'incierta', vencimientoMs: plazo, motivo: 'ancla-perdida' })
    expect(e.orden).toBeUndefined()
    expect(evaluarParadaAutomatica(marcha, { nivel: 'sin-estimacion', motivo: 'sin-muestra', estimadoMs: null, accionTsCrudo: plazo }).estado).toBe('incierta')
  })
  it('en el plazo exacto o después: vencida; usa el plazo calculado, conserva la hora cruda y el ajuste, y el cmdId fijo', () => {
    for (const estimado of [plazo, plazo + 5000]) {
      const e = evaluarParadaAutomatica(marcha, conf(estimado, estimado + 11))
      expect(e.estado).toBe('vencida')
      expect(e.orden.cmdId).toBe('auto:P:1')
      expect(e.orden.tipo).toBe('parada-automatica')
      expect(e.orden.tiempo).toEqual({ accionTs: plazo, accionTsCrudo: estimado + 11, ajusteTsMs: plazo - (estimado + 11), discontinuidad: null })
    }
  })
  it('el motor la acepta, no se duplica y, ya encolada, deja de aplicar', () => {
    const e = evaluarParadaAutomatica(marcha, conf(plazo + 40))
    const r = encolar(cola0(marcha), marcha, e.orden, { ahoraEstimado: plazo + 40 })
    expect(r.rechazoLocal).toBeUndefined()
    expect(r.sobre.accionTs).toBe(plazo)
    expect(r.sobre.restanteVistoMs).toBe(0)
    expect(r.estado.partido.relojEstado).toBe('detenido')
    // el mismo cmdId otra vez: duplicada, sin número nuevo
    const otra = encolar(r.cola, r.estado, e.orden, { ahoraEstimado: plazo + 80 })
    expect(otra.duplicada).toBe(true)
    expect(otra.cola.siguienteSeq).toBe(r.cola.siguienteSeq)
    // y sobre el estado provisional ya detenido no hay nada que evaluar
    expect(evaluarParadaAutomatica(r.estado, conf(plazo + 80))).toEqual({ estado: 'no-aplica' })
  })
  it('conserva la discontinuidad si la hubiera', () => {
    const e = evaluarParadaAutomatica(marcha, { ...conf(plazo), discontinuidad: { saltoMs: 1500, causa: 'x' } })
    expect(e.orden.tiempo.discontinuidad).toEqual({ saltoMs: 1500, causa: 'x' })
  })
})

describe('atribución en las pruebas', () => {
  it('la atribución de prueba tiene los jugadores esperados', () => {
    expect(Object.keys(ATRIBUCION_DE_PRUEBA.jugadores)).toContain('J1')
  })
})
