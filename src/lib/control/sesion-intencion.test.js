import { describe, expect, it } from 'vitest'
import {
  INTENCIONES, MENSAJES_DE_REGISTRO, crearRegistroDeIntenciones, estadoDeEvento, mensajeDeResultado, nuevoCmdId, restanteDeTexto, situacionDeControl, normalizarTiempoReloj, MENSAJES_TIEMPO_RELOJ,
} from './sesion-intencion'

// REPORT_128: el mapeo PURO de la intención del operador al controlador y los textos que ve.

const tick = () => new Promise((r) => setTimeout(r, 0))
const ses = (o = {}) => ({
  ok: true, inicio: 'confirmado', puntuacion: { habilitada: true, motivo: null }, pendientes: 0, enviando: 0, confirmadas: 1, detenida: null, divergencia: null,
  provisional: { partido: { estado: 'vivo' } }, visualizacion: { disponible: true }, ...o,
})
const est = (o = {}, s = {}) => ({
  modo: 'propietario', propietario: true, conexion: { enLinea: true }, reloj: { nivel: 'confiable' }, emisor: { fase: 'inactivo' }, sesion: ses(s), estados: [], colaBloqueadaPorReloj: null, aviso: null, ...o,
})
const ids = (x) => x.avisos.map((a) => a.id)

describe('cmdId criptográfico', () => {
  it('uno por intención, único y con prefijo; sin crypto falla (nunca Math.random)', () => {
    const a = nuevoCmdId('anotar'); const b = nuevoCmdId('anotar')
    expect(a).toMatch(/^anotar-[0-9a-f-]{36}$/)
    expect(a).not.toBe(b)
    expect(nuevoCmdId('x', { getRandomValues: (u) => u.fill(7) })).toBe(`x-${'07'.repeat(16)}`)
    expect(() => nuevoCmdId('x', null)).toThrow('sin-criptografia')
    expect(() => nuevoCmdId('x', {})).toThrow('sin-criptografia')
  })
})

describe('intenciones y retención del cmdId', () => {
  it('apuntan a ids de registro, nunca a números; la clave distingue jugador y puntos', () => {
    expect(INTENCIONES.anotar('E1', 'J7', 2)).toEqual({ clave: 'anotar:J7:2', tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J7', puntos: 2 } })
    expect(INTENCIONES.falta('E1', 'J7').datos).toEqual({ equipoId: 'E1', jugadorId: 'J7' })
    expect(INTENCIONES.anular('ev1')).toMatchObject({ tipo: 'anular-evento', datos: { eventoId: 'ev1' } })
    expect(INTENCIONES.corregir(510000)).toMatchObject({ tipo: 'corregir-reloj', datos: { restanteMs: 510000 } })
    expect(INTENCIONES.arrancar().clave).toBe(INTENCIONES.detener().clave)
    expect(JSON.stringify(INTENCIONES.anotar('E1', 'J0', 3))).not.toContain('dorsal')
  })
  it('la misma intención pendiente no se duplica; terminada, la siguiente es NUEVA con otro cmdId; sin retardos', async () => {
    const r = crearRegistroDeIntenciones({ generar: (t) => `${t}-${Math.random()}` })
    const llamadas = []
    let abrir
    const accion = (cmdId) => { llamadas.push(cmdId); return new Promise((res) => { abrir = () => res({ ok: true }) }) }
    const i = INTENCIONES.anotar('E1', 'J1', 2)
    const p1 = r.ejecutar(i, accion)
    expect(r.pendiente(i.clave)).toBe(true)
    expect(await r.ejecutar(i, accion)).toEqual({ duplicada: true }) // doble toque
    expect(await r.ejecutar(INTENCIONES.anotar('E1', 'J1', 3), async (c) => { llamadas.push(c); return { ok: true } })).toMatchObject({ duplicada: false }) // otra intención no se bloquea
    expect(llamadas).toHaveLength(2)
    abrir()
    expect(await p1).toMatchObject({ duplicada: false, resultado: { ok: true } })
    expect(r.pendiente(i.clave)).toBe(false)
    await r.ejecutar(i, async (c) => { llamadas.push(c); return { ok: true } })
    expect(llamadas[2]).not.toBe(llamadas[0])
  })
  it('si la acción LANZA (resultado incierto) el cmdId se conserva y el reintento usa el MISMO; tras un resultado conocido se olvida', async () => {
    const r = crearRegistroDeIntenciones()
    const vistos = []
    const i = INTENCIONES.falta('E1', 'J1')
    expect(await r.ejecutar(i, async (c) => { vistos.push(c); throw new Error('x') })).toMatchObject({ incierta: true })
    expect(r.cmdIdRetenido(i.clave)).toBe(vistos[0])
    await r.ejecutar(i, async (c) => { vistos.push(c); return { ok: false, motivo: 'solo-lectura' } })
    expect(vistos[1]).toBe(vistos[0])
    expect(r.cmdIdRetenido(i.clave)).toBeNull() // el rechazo es un resultado conocido
    await r.ejecutar(i, async (c) => { vistos.push(c); return { ok: true } })
    expect(vistos[2]).not.toBe(vistos[0])
    // sin crypto: no se registra nada y se dice por qué
    const sin = crearRegistroDeIntenciones({ generar: () => { throw new Error('sin-criptografia') } })
    expect(await sin.ejecutar(i, async () => ({ ok: true }))).toMatchObject({ incierta: true, error: 'sin-criptografia' })
    await tick()
  })
})

describe('corrección del reloj', () => {
  it('mm:ss validado: formato, rango; el 00:00 y el máximo valen; nada se redondea', () => {
    expect(restanteDeTexto('08:30', 600000)).toEqual({ ok: true, restanteMs: 510000 })
    expect(restanteDeTexto(' 8:05 ', 600000)).toEqual({ ok: true, restanteMs: 485000 })
    expect(restanteDeTexto('00:00', 600000)).toEqual({ ok: true, restanteMs: 0 })
    expect(restanteDeTexto('10:00', 600000)).toEqual({ ok: true, restanteMs: 600000 })
    expect(restanteDeTexto('10:01', 600000)).toEqual({ ok: false, motivo: 'fuera-de-rango' })
    for (const mal of ['', '8', '8:5', '-1:00', 'ab:cd', '08:30:00', null, undefined, '8,5']) expect(restanteDeTexto(mal, 600000), String(mal)).toEqual({ ok: false, motivo: 'formato' })
    expect(restanteDeTexto('08:60', 600000)).toEqual({ ok: false, motivo: 'segundos' }) // antes «formato»; ahora dice cuál es el problema
  })
  it('REPORT_210: sin dos puntos, 3 o 4 dígitos son «mss» / «mmss»: 845 y 0845 → 08:45; 1000 → 10:00; nada se adivina', () => {
    expect(normalizarTiempoReloj('845')).toEqual({ ok: true, texto: '08:45' })
    expect(normalizarTiempoReloj('0845')).toEqual({ ok: true, texto: '08:45' })
    expect(normalizarTiempoReloj(' 845 ')).toEqual({ ok: true, texto: '08:45' })
    expect(normalizarTiempoReloj('1000')).toEqual({ ok: true, texto: '10:00' })
    expect(normalizarTiempoReloj('000')).toEqual({ ok: true, texto: '00:00' })
    expect(normalizarTiempoReloj('8:05')).toEqual({ ok: true, texto: '08:05' })
    expect(normalizarTiempoReloj('08:30')).toEqual({ ok: true, texto: '08:30' })
    expect(restanteDeTexto('845', 600000)).toEqual({ ok: true, restanteMs: 525000 })
    expect(restanteDeTexto('0845', 600000)).toEqual({ ok: true, restanteMs: 525000 })
    expect(restanteDeTexto('1000', 600000)).toEqual({ ok: true, restanteMs: 600000 })
    expect(restanteDeTexto('1001', 600000)).toEqual({ ok: false, motivo: 'fuera-de-rango' }) // nunca se recorta a 10:00
    expect(restanteDeTexto('2000', 600000)).toEqual({ ok: false, motivo: 'fuera-de-rango' })
    for (const ambiguo of ['8', '45', '84', '08450', '8 45', '8-45', '08.45', '84a', '+845']) expect(normalizarTiempoReloj(ambiguo), ambiguo).toEqual({ ok: false, motivo: 'formato' }) // uno o dos dígitos: no se sabe si son minutos o segundos
    for (const mal of ['860', '0860', '08:60', '8:99', '1099']) expect(normalizarTiempoReloj(mal), mal).toEqual({ ok: false, motivo: 'segundos' }) // nunca 860 → 09:00
    expect(Object.keys(MENSAJES_TIEMPO_RELOJ).sort()).toEqual(['formato', 'fuera-de-rango', 'segundos'])
    for (const m of Object.values(MENSAJES_TIEMPO_RELOJ)) expect(m).toMatch(/[a-z]{4}/)
  })
})

describe('mensajes de resultado: nunca «guardado» si no se guardó', () => {
  it('éxito = guardado AQUÍ, pendiente; duplicada; errores con su texto', () => {
    expect(mensajeDeResultado({ resultado: { ok: true } })).toEqual({ tipo: 'ok', texto: MENSAJES_DE_REGISTRO.guardada })
    expect(mensajeDeResultado({ resultado: { ok: true } }, { acepta: 'X' }).texto).toBe('X')
    expect(mensajeDeResultado({ duplicada: true }).tipo).toBe('aviso')
    expect(mensajeDeResultado({ resultado: { ok: true, duplicada: true } }).tipo).toBe('aviso')
    for (const motivo of ['almacenamiento', 'limite-bytes-partido', 'limite-bytes-total', 'limite-comandos', 'sobre-reserva', 'sin-tiempo-confiable', 'propiedad-perdida', 'cola-detenida', 'sesion-detenida-por-divergencia']) {
      const m = mensajeDeResultado({ resultado: { ok: false, motivo } })
      expect(m.tipo, motivo).toBe('error')
      expect(m.texto, motivo).toMatch(/NO (se guardó|quedó registrada)|no se guardó|NO se guardó/i)
      expect(m.texto, motivo).not.toMatch(/^Guardado/)
    }
    expect(mensajeDeResultado({ resultado: { ok: false, motivo: 'rechazo-local', rechazo: { motivo: 'ultimo-periodo' } } }).texto).toContain('último periodo')
    expect(mensajeDeResultado({ resultado: { ok: false, motivo: 'desconocido-raro' } }).texto).toBe('La acción no se guardó.')
    expect(mensajeDeResultado({ incierta: true, error: 'error' }).texto).toContain('No se supo')
    expect(mensajeDeResultado({ incierta: true, error: 'sin-criptografia' }).texto).toContain('NO se guardó')
    // nada de promesas de reintento ni de parar el partido
    for (const t of Object.values(MENSAJES_DE_REGISTRO)) expect(t).not.toMatch(/detén el partido|parar el partido|pausa/i)
  })
  it('estado de un evento: pendiente si su orden aún no tiene recibo (también el evento «:e» de un periodo)', () => {
    expect(estadoDeEvento({ id: 'c1' }, ['c1'])).toBe('pendiente')
    expect(estadoDeEvento({ id: 'c1:e' }, ['c1'])).toBe('pendiente')
    expect(estadoDeEvento({ id: 'c2' }, ['c1'])).toBe('confirmado')
  })
})

describe('situación de control (qué se avisa y qué se permite)', () => {
  it('normal: se puede puntuar y actuar; sin avisos', () => {
    const s = situacionDeControl(est())
    expect(s).toMatchObject({ puedeActuar: true, puedePuntuar: true, puedeReloj: true, mostrarDatos: true })
    expect(s.avisos).toEqual([])
  })
  it('pestaña de solo lectura, sin Web Locks, cerrado, sin identidad, otro dispositivo: nada se permite', () => {
    expect(ids(situacionDeControl(est({ modo: 'solo-lectura', propietario: false })))).toEqual(['solo-lectura'])
    expect(situacionDeControl(est({ modo: 'solo-lectura', propietario: false }))).toMatchObject({ puedeActuar: false, puedePuntuar: false, puedeReloj: false })
    for (const [o, id] of [[{ modo: 'sin-web-locks', propietario: false }, 'sin-web-locks'], [{ modo: 'cerrado' }, 'cerrado'], [{ aviso: { tipo: 'sin-identidad' } }, 'sin-identidad'], [{ aviso: { tipo: 'dispositivo-distinto' } }, 'dispositivo-distinto']]) {
      const s = situacionDeControl(est(o))
      expect(ids(s), id).toEqual([id])
      expect(s.puedeActuar || s.puedePuntuar || s.puedeReloj).toBe(false)
    }
  })
  it('solo un inicio CONFIRMADO habilita puntuar; un inicio sin recibo es «incierto» y no se promete el reintento si el emisor se detuvo', () => {
    expect(situacionDeControl(est({}, { inicio: 'sin-iniciar', puntuacion: { habilitada: false } }))).toMatchObject({ puedePuntuar: false, puedeReloj: false })
    const esperando = situacionDeControl(est({ emisor: { fase: 'esperando-reintento' } }, { inicio: 'sin-iniciar', enviando: 1, puntuacion: { habilitada: false } }))
    expect(esperando.avisos[0]).toMatchObject({ id: 'inicio-incierto' })
    expect(esperando.avisos[0].texto).toContain('Se sigue intentando')
    expect(esperando.avisos[0].accion).toBeUndefined()
    const agotado = situacionDeControl(est({ emisor: { fase: 'reintentos-agotados' } }, { inicio: 'sin-iniciar', enviando: 1, puntuacion: { habilitada: false } }))
    expect(agotado.avisos[0].texto).toContain('Se dejaron de hacer intentos')
    expect(agotado.avisos[0].texto).not.toContain('Se sigue intentando')
    expect(agotado.avisos[0].accion).toBe('reintentar')
    // un «vivo» del servidor sin recibo de inicio nunca habilita
    expect(situacionDeControl(est({}, { inicio: 'sin-resolver', puntuacion: { habilitada: false, motivo: 'inicio-sin-resolver' } })).puedePuntuar).toBe(false)
  })
  it('sin conexión: cuenta lo guardado; agotado/suspendido/malformado no prometen reintento automático', () => {
    const off = situacionDeControl(est({ conexion: { enLinea: false } }, { pendientes: 2 }))
    expect(off.avisos[0]).toMatchObject({ id: 'sin-conexion' })
    expect(off.avisos[0].texto).toContain('2 acciones guardadas')
    expect(off.puedePuntuar).toBe(true) // sigue anotando sin conexión
    expect(situacionDeControl(est({ conexion: { enLinea: false } }, { pendientes: 1 })).avisos[0].texto).toContain('1 acción guardada')
    for (const fase of ['reintentos-agotados', 'respuestas-malformadas', 'suspendida-retry-after']) {
      const a = situacionDeControl(est({ emisor: { fase } }, { pendientes: 1 })).avisos[0]
      expect(a.accion, fase).toBe('reintentar')
      expect(a.texto, fase).not.toMatch(/automátic|se reintentará|se enviará solo/i)
    }
  })
  it('paradas y divergencia: textos distintos, sin mandar parar el partido, y no se puede actuar', () => {
    const casos = [
      [{ detenida: { causa: 'transporte', clase: 'no-autorizado' } }, 'no-autorizado'],
      [{ detenida: { causa: 'transporte', clase: 'conflicto' } }, 'parada'],
      [{ detenida: { causa: 'rechazo-definitivo' } }, 'rechazo'],
      [{ divergencia: { causa: 'x' } }, 'divergencia'],
    ]
    for (const [s, id] of casos) {
      const r = situacionDeControl(est({}, s))
      expect(r.avisos[0].id, id).toBe(id)
      expect(r.avisos[0].texto, id).toMatch(/Avisa al organizador/)
      expect(r.avisos[0].texto, id).not.toMatch(/detén el partido|pausa|parar el partido/i)
      expect(r.puedeActuar || r.puedePuntuar, id).toBe(false)
    }
    expect(ids(situacionDeControl(est({ estados: ['parada-solo-en-memoria'] }, { detenida: { causa: 'transporte', clase: 'no-autorizado' } })))).toContain('parada-memoria')
  })
  it('reloj: sin hora el reloj no se puede mover pero se sigue anotando; una acción de reloj encolada que bloquea se EXPONE', () => {
    const sin = situacionDeControl(est({ reloj: { nivel: 'sin-estimacion' } }))
    expect(ids(sin)).toContain('reloj-no-disponible')
    expect(sin).toMatchObject({ puedePuntuar: true, puedeReloj: true })
    const bloq = situacionDeControl(est({ colaBloqueadaPorReloj: { cmdId: 'c1', motivo: 'sin-tiempo-confiable' } }))
    expect(ids(bloq)).toEqual(['reloj-bloqueado'])
  })
  it('capacidad, almacenamiento y datos ausentes son estados distintos; sin nombres no hay botones de puntuar', () => {
    expect(ids(situacionDeControl(est({ estados: ['capacidad-rechazada'] })))).toEqual(['capacidad'])
    expect(ids(situacionDeControl(est({ emisor: { fase: 'almacenamiento' } })))).toEqual(['almacenamiento'])
    const sinDatos = situacionDeControl(est({}, { visualizacion: { disponible: false } }))
    expect(sinDatos).toMatchObject({ puedePuntuar: false, puedeReloj: true, mostrarDatos: false })
  })
})

describe('inicio con un teléfono sin permiso (REPORT_181)', () => {
  it('«no-autorizado» tiene su propio texto: dice que ya no tiene permiso, que no se guardó nada y que avise al organizador (no «no se pudo leer»)', () => {
    const t = mensajeDeResultado({ ok: false, motivo: 'no-autorizado' })
    expect(t.tipo).toBe('error')
    expect(t.texto).toMatch(/ya no tiene permiso para este partido/)
    expect(t.texto).toMatch(/No se guardó nada/)
    expect(t.texto).not.toMatch(/No se pudo leer/)
  })
})
