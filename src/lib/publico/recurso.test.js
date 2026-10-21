import { describe, expect, it, vi } from 'vitest'
import { RETROCESO_MAX_MS, adquirir, crearRecurso, recursosActivos, retrocesoDe } from './recurso.js'

// Entorno falso con tiempo manual: ningún temporizador real, ningún navegador.
function entornoFalso() {
  const e = {
    t: 0, siguiente: 1, timers: new Map(), visibleAhora: true, alEvento: null, oyentesQuitados: 0, azar: 0.5,
    mono: () => e.t, pared: () => e.t, aleatorio: () => e.azar,
    poner: (fn, ms) => { const id = e.siguiente++; e.timers.set(id, { fn, en: e.t + ms }); return id },
    quitar: (id) => { e.timers.delete(id) },
    visible: () => e.visibleAhora,
    oyentes: (fn) => { e.alEvento = fn; return () => { e.alEvento = null; e.oyentesQuitados += 1 } },
    async vaciar() { for (let i = 0; i < 20; i += 1) await Promise.resolve() },
    async avanzar(ms) {
      const meta = e.t + ms
      for (;;) {
        const proximo = [...e.timers.entries()].filter(([, x]) => x.en <= meta).sort((a, b) => a[1].en - b[1].en)[0]
        if (!proximo) break
        e.t = Math.max(e.t, proximo[1].en)
        e.timers.delete(proximo[0])
        proximo[1].fn()
        await e.vaciar()
      }
      e.t = meta
      await e.vaciar()
    },
    async evento(motivo) { e.alEvento?.(motivo); await e.vaciar() },
  }
  return e
}

const ok = (e, extra = {}) => ({ tipo: 'ok', datos: { servidorAhoraMs: 1_000_000 + e.t, estado: 'vivo', ...extra }, monoInicio: e.t, monoFin: e.t })
function definicion({ e, respuestas, periodo = 5000, minimo = periodo, clave = 'k' }) {
  const cargar = vi.fn(async (senal) => {
    const r = typeof respuestas === 'function' ? respuestas(cargar.mock.calls.length, senal) : respuestas
    return r
  })
  return { def: { clave, cargar, periodoDe: () => periodo, intervaloMinDe: () => minimo }, cargar }
}

describe('cadencia', () => {
  it('partido en vivo: una petición al montar y luego una cada 5 s, nunca antes', async () => {
    const e = entornoFalso()
    const { def, cargar } = definicion({ e, respuestas: () => ok(e) })
    const r = crearRecurso(def, e)
    r.iniciar()
    await e.vaciar()
    expect(cargar).toHaveBeenCalledTimes(1)
    await e.avanzar(4999)
    expect(cargar).toHaveBeenCalledTimes(1)
    await e.avanzar(1)
    expect(cargar).toHaveBeenCalledTimes(2)
    await e.avanzar(60_000)
    expect(cargar.mock.calls.length).toBeLessThanOrEqual(14)
    expect(cargar.mock.calls.length).toBeGreaterThanOrEqual(13)
    r.detener()
  })

  it('catálogo: como mucho una petición por 60 s aunque el foco, la visibilidad y la conexión disparen más', async () => {
    const e = entornoFalso()
    const { def, cargar } = definicion({ e, respuestas: () => ok(e), periodo: 60_000 })
    const r = crearRecurso(def, e)
    r.iniciar()
    await e.vaciar()
    for (let i = 0; i < 20; i += 1) { await e.avanzar(2000); await e.evento(['foco', 'visible', 'conexion'][i % 3]) }
    expect(cargar).toHaveBeenCalledTimes(1) // 40 s después de la primera
    await e.avanzar(20_000)
    expect(cargar).toHaveBeenCalledTimes(2)
    r.detener()
  })

  it('final: una cada 5 min; el foco solo refresca si pasaron 30 s desde la anterior', async () => {
    const e = entornoFalso()
    const { def, cargar } = definicion({ e, respuestas: () => ok(e, { estado: 'final' }), periodo: 300_000, minimo: 30_000 })
    const r = crearRecurso(def, e)
    r.iniciar()
    await e.vaciar()
    await e.avanzar(10_000)
    await e.evento('foco')
    expect(cargar).toHaveBeenCalledTimes(1)
    await e.avanzar(21_000)
    await e.evento('foco')
    expect(cargar).toHaveBeenCalledTimes(2)
    await e.avanzar(299_999)
    expect(cargar).toHaveBeenCalledTimes(2)
    await e.avanzar(1)
    expect(cargar).toHaveBeenCalledTimes(3)
    r.detener()
  })

  it('varios disparadores simultáneos se agrupan en UNA petición en vuelo', async () => {
    const e = entornoFalso()
    let soltar
    const { def, cargar } = definicion({ e, respuestas: () => new Promise((res) => { soltar = () => res(ok(e)) }) })
    const r = crearRecurso(def, e)
    r.iniciar()
    for (let i = 0; i < 10; i += 1) await e.evento(['foco', 'visible', 'conexion'][i % 3])
    expect(cargar).toHaveBeenCalledTimes(1)
    soltar()
    await e.vaciar()
    expect(r.obtener()).toMatchObject({ fase: 'listo', enVuelo: false })
    r.detener()
  })
})

describe('pestaña oculta', () => {
  it('al ocultarse se cancela lo que esté en vuelo y no hay peticiones; al volver a verse se pide', async () => {
    const e = entornoFalso()
    let senalVista
    const { def, cargar } = definicion({ e, respuestas: (n, senal) => (n === 1 ? ok(e) : new Promise(() => { senalVista = senal })) })
    const r = crearRecurso(def, e)
    r.iniciar()
    await e.vaciar()
    await e.avanzar(5000) // segunda petición queda en vuelo
    expect(cargar).toHaveBeenCalledTimes(2)
    e.visibleAhora = false
    await e.evento('visible')
    expect(senalVista.aborted).toBe(true)
    expect(e.timers.size).toBe(0)
    await e.avanzar(600_000)
    expect(cargar).toHaveBeenCalledTimes(2) // oculta: ninguna petición
    e.visibleAhora = true
    await e.evento('visible')
    expect(cargar).toHaveBeenCalledTimes(3)
    r.detener()
  })
  it('montado con la pestaña oculta: no pide nada hasta que se vea', async () => {
    const e = entornoFalso()
    e.visibleAhora = false
    const { def, cargar } = definicion({ e, respuestas: () => ok(e) })
    const r = crearRecurso(def, e)
    r.iniciar()
    await e.vaciar()
    await e.avanzar(120_000)
    expect(cargar).not.toHaveBeenCalled()
    e.visibleAhora = true
    await e.evento('visible')
    expect(cargar).toHaveBeenCalledTimes(1)
    r.detener()
  })
})

describe('fallos', () => {
  it('conservan el último dato bueno con el error a la vista y se recuperan', async () => {
    const e = entornoFalso()
    const { def } = definicion({ e, respuestas: (n) => (n === 2 ? { tipo: 'red' } : ok(e, { marca: n })) })
    const r = crearRecurso(def, e)
    r.iniciar()
    await e.vaciar()
    const bueno = r.obtener().datos
    await e.avanzar(5000)
    const s = r.obtener()
    expect(s.datos).toBe(bueno) // el dato bueno sigue ahí
    expect(s).toMatchObject({ fase: 'listo', error: { tipo: 'red' }, fallos: 1 })
    await e.avanzar(60_000)
    expect(r.obtener()).toMatchObject({ error: null, fallos: 0 })
    r.detener()
  })

  it('retroceso exponencial acotado a 60 s con fluctuación, y nunca más rápido que el intervalo mínimo', async () => {
    const e = entornoFalso()
    const inicios = []
    const { def } = definicion({ e, respuestas: () => { inicios.push(e.t); return { tipo: 'red' } } })
    const r = crearRecurso(def, e)
    r.iniciar()
    await e.vaciar()
    await e.avanzar(600_000)
    const huecos = inicios.slice(1).map((t, i) => t - inicios[i])
    expect(huecos.every((h) => h >= 5000 && h <= RETROCESO_MAX_MS)).toBe(true)
    expect(huecos[0]).toBeLessThan(huecos[3]) // crece
    expect(huecos.at(-1)).toBeGreaterThanOrEqual(RETROCESO_MAX_MS * 0.75)
    expect(inicios.length).toBeLessThan(20) // no gira
    r.detener()
    for (let fallos = 1; fallos < 30; fallos += 1) for (const a of [0, 0.5, 0.999]) expect(retrocesoDe(fallos, 'red', () => a)).toBeLessThanOrEqual(RETROCESO_MAX_MS)
  })

  it('el catálogo reintenta no antes de 60 s aunque falle', async () => {
    const e = entornoFalso()
    const { def, cargar } = definicion({ e, respuestas: () => ({ tipo: 'red' }), periodo: 60_000 })
    const r = crearRecurso(def, e)
    r.iniciar()
    await e.vaciar()
    await e.avanzar(59_000)
    expect(cargar).toHaveBeenCalledTimes(1)
    await e.avanzar(1000)
    expect(cargar).toHaveBeenCalledTimes(2)
    r.detener()
  })

  it('respeta Retry-After: no vuelve a pedir antes, ni por temporizador ni por foco', async () => {
    const e = entornoFalso()
    const { def, cargar } = definicion({ e, respuestas: (n) => (n === 1 ? { tipo: 'http', status: 503, reintentoMs: 120_000 } : ok(e)) })
    const r = crearRecurso(def, e)
    r.iniciar()
    await e.vaciar()
    await e.avanzar(100_000)
    await e.evento('foco')
    await e.evento('visible')
    expect(cargar).toHaveBeenCalledTimes(1)
    await e.avanzar(20_001)
    expect(cargar).toHaveBeenCalledTimes(2)
    r.detener()
  })

  it('404 y 507 NO se repiten: una sola petición aunque pase el tiempo o lleguen eventos', async () => {
    for (const [tipo, fase] of [['no-encontrado', 'no-encontrado'], ['demasiado-grande', 'terminal']]) {
      const e = entornoFalso()
      const { def, cargar } = definicion({ e, respuestas: () => ({ tipo }) })
      const r = crearRecurso(def, e)
      r.iniciar()
      await e.avanzar(3_600_000)
      await e.evento('foco')
      await e.evento('visible')
      expect(cargar, tipo).toHaveBeenCalledTimes(1)
      expect(r.obtener().fase).toBe(fase)
      expect(e.timers.size).toBe(0)
      r.detener()
    }
  })

  it('resumen-no-disponible reintenta con retroceso (15 s, 30 s, 60 s…), sin girar', async () => {
    const e = entornoFalso()
    const inicios = []
    const { def } = definicion({ e, respuestas: () => { inicios.push(e.t); return { tipo: 'no-disponible', reintentoMs: 0 } } })
    const r = crearRecurso(def, e)
    r.iniciar()
    await e.vaciar()
    await e.avanzar(300_000)
    const huecos = inicios.slice(1).map((t, i) => t - inicios[i])
    expect(huecos[0]).toBeGreaterThanOrEqual(11_000)
    expect(huecos.every((h) => h <= RETROCESO_MAX_MS)).toBe(true)
    expect(inicios.length).toBeLessThanOrEqual(10)
    expect(r.obtener()).toMatchObject({ fase: 'sin-datos', error: { tipo: 'no-disponible' } })
    r.detener()
  })

  it('una muestra de hora imposible (viaje enorme) se trata como respuesta no utilizable', async () => {
    const e = entornoFalso()
    const { def } = definicion({ e, respuestas: () => ({ tipo: 'ok', datos: { servidorAhoraMs: 5, estado: 'vivo' }, monoInicio: 0, monoFin: 99_999 }) })
    const r = crearRecurso(def, e)
    r.iniciar()
    await e.vaciar()
    expect(r.obtener()).toMatchObject({ datos: null, error: { tipo: 'malformado' } })
    r.detener()
  })
})

describe('limpieza y respuestas tardías', () => {
  it('detener cancela la petición, los temporizadores y los oyentes; una respuesta tardía se descarta', async () => {
    const e = entornoFalso()
    let soltar
    let senalVista
    const { def } = definicion({ e, respuestas: (n, senal) => new Promise((res) => { senalVista = senal; soltar = () => res(ok(e)) }) })
    const r = crearRecurso(def, e)
    r.iniciar()
    await e.vaciar()
    const antes = r.obtener()
    r.detener()
    expect(senalVista.aborted).toBe(true)
    expect(e.timers.size).toBe(0)
    expect(e.oyentesQuitados).toBe(1)
    expect(e.alEvento).toBeNull()
    soltar() // llega tarde
    await e.vaciar()
    expect(r.obtener()).toBe(antes) // nada cambió
    await e.avanzar(600_000)
    expect(e.timers.size).toBe(0)
  })

  it('el registro comparte UN recurso por clave entre consumidores y lo libera con el último', async () => {
    const e = entornoFalso()
    const { def, cargar } = definicion({ e, respuestas: () => ok(e), clave: 'compartida' })
    const antes = recursosActivos()
    const a = adquirir(def, e)
    const b = adquirir(def, e)
    await e.vaciar()
    expect(a.recurso).toBe(b.recurso)
    expect(cargar).toHaveBeenCalledTimes(1)
    expect(recursosActivos()).toBe(antes + 1)
    a.liberar()
    a.liberar() // idempotente
    await e.avanzar(5000)
    expect(cargar).toHaveBeenCalledTimes(2) // sigue activo para el segundo consumidor
    b.liberar()
    expect(recursosActivos()).toBe(antes)
    expect(e.timers.size).toBe(0)
    expect(e.oyentesQuitados).toBe(1)
    await e.avanzar(600_000)
    expect(cargar).toHaveBeenCalledTimes(2)
  })

  it('claves distintas son recursos distintos: una respuesta tardía de una clave no toca a la otra', async () => {
    const e = entornoFalso()
    let soltarA
    const a = definicion({ e, respuestas: () => new Promise((res) => { soltarA = () => res(ok(e, { de: 'A' })) }), clave: 'A' })
    const b = definicion({ e, respuestas: () => ok(e, { de: 'B' }), clave: 'B' })
    const ra = adquirir(a.def, e)
    ra.liberar() // el usuario cambió de ruta antes de que llegara A
    const rb = adquirir(b.def, e)
    await e.vaciar()
    soltarA()
    await e.vaciar()
    expect(rb.recurso.obtener().datos.de).toBe('B')
    expect(ra.recurso.obtener().datos).toBeNull()
    rb.liberar()
  })
})

import { INTERVALO_MIN_EQUIPO_MS, PERIODO_EQUIPO_MS, recursoEquipo } from './recursos.js'

describe('recurso de equipo: bajo demanda, refresco manual y como mucho cada 5 min', () => {
  it('una petición al abrir; nada de sondeo de 5 s; la siguiente programada a los 5 min; el refresco manual respeta 15 s', async () => {
    const e = entornoFalso()
    const def = recursoEquipo('LIGAPUB1', 'E1')
    expect(def.clave).toBe('equipo:LIGAPUB1:E1')
    expect(def.periodoDe()).toBe(PERIODO_EQUIPO_MS)
    expect(def.intervaloMinDe()).toBe(INTERVALO_MIN_EQUIPO_MS)
    const cargar = vi.fn(async () => ok(e))
    const r = crearRecurso({ ...def, cargar }, e)
    r.iniciar()
    await e.vaciar()
    expect(cargar).toHaveBeenCalledTimes(1)
    await e.avanzar(60_000) // un minuto visible: ninguna petición más (no hay sondeo de 5 s)
    expect(cargar).toHaveBeenCalledTimes(1)
    await e.avanzar(1000); r.solicitar('manual') // manual, pasados 60 s: permitido
    await e.vaciar()
    expect(cargar).toHaveBeenCalledTimes(2)
    r.solicitar('manual'); await e.vaciar() // manual otra vez enseguida: demasiado pronto, no se hace
    for (let i = 0; i < 5; i += 1) { await e.evento('foco') }
    expect(cargar).toHaveBeenCalledTimes(2)
    await e.avanzar(15_000)
    r.solicitar('manual'); await e.vaciar()
    expect(cargar).toHaveBeenCalledTimes(3)
    await e.avanzar(PERIODO_EQUIPO_MS - 1)
    expect(cargar).toHaveBeenCalledTimes(3)
    await e.avanzar(1)
    expect(cargar).toHaveBeenCalledTimes(4) // el refresco programado de 5 min
    r.detener()
    expect(e.timers.size).toBe(0)
  })
})


describe('reprogramar (REPORT_201): la cadencia cambia fuera del recurso', () => {
  it('mueve el temporizador pendiente a la cadencia nueva anclado a la última petición; no pide nada por sí sola ni acumula peticiones', async () => {
    const e = entornoFalso()
    let rapido = false
    const cargar = vi.fn(async () => ok(e, { estado: 'programado' }))
    const def = { clave: 'k', cargar, periodoDe: () => (rapido ? 5000 : 30_000), intervaloMinDe: () => (rapido ? 5000 : 30_000) }
    const r = crearRecurso(def, e)
    r.iniciar()
    await e.vaciar()
    expect(cargar).toHaveBeenCalledTimes(1)
    await e.avanzar(12_000)
    rapido = true
    r.reprogramar()
    expect(cargar).toHaveBeenCalledTimes(1) // por sí sola no pide
    await e.avanzar(1)
    expect(cargar).toHaveBeenCalledTimes(2) // ya habían pasado 12 s ≥ 5 s desde la última: toca ya (una sola)
    await e.avanzar(4_998)
    expect(cargar).toHaveBeenCalledTimes(2)
    await e.avanzar(1)
    expect(cargar).toHaveBeenCalledTimes(3) // y luego cada 5 s
    expect(e.timers.size).toBe(1) // un solo temporizador pendiente
    r.detener()
  })
  it('no toca la espera tras un fallo, ni actúa con la pestaña oculta o sin iniciar', async () => {
    const e = entornoFalso()
    const cargar = vi.fn(async () => ({ tipo: 'red' }))
    const r = crearRecurso({ clave: 'k', cargar, periodoDe: () => 5000, intervaloMinDe: () => 5000 }, e)
    r.reprogramar() // sin iniciar: nada
    expect(e.timers.size).toBe(0)
    r.iniciar()
    await e.vaciar()
    const pendiente = [...e.timers.values()][0].en
    r.reprogramar() // con fallos: el retroceso manda
    expect([...e.timers.values()][0].en).toBe(pendiente)
    expect(cargar).toHaveBeenCalledTimes(1)
    r.detener()
  })
})
