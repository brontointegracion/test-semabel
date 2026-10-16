import { describe, expect, it } from 'vitest'
import { POLITICA_EMISOR, traducirVerificacion } from './sesion-emisor'
import { T0, ID, cmd, conInicioYPuntos, drenar, entornoEmisor, respuesta, servidorNuevo, tick, volcarBase } from './prueba/auxiliares-emisor'
import { leerSesion, abrirAlmacen } from './sesion-almacen'
import { cuerpoDeServidor } from './prueba/auxiliares-sesion'

// REPORT_124: el emisor serie. El servidor es el banco sintético del motor (procesador real); la red, la propiedad y los
// relojes son dobles inyectados. Cada prueba mira lo que quedó EN EL ALMACÉN, no lo que el emisor dice de sí mismo.

const PUNTOS = (tel) => tel.orden('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 })
const leer = async (e) => (await leerSesion(e.tel.almacen, ID, { ahoraEstimado: T0, actorId: 'x', enLinea: true, ahora: T0 }))
const BODY = (llamada) => llamada.cuerpo

async function conInicioPendiente({ guion = [], ...resto } = {}) {
  const e = await entornoEmisor({ guion, ...resto })
  await e.tel.iniciar() // el inicio YA fue creado por la persona; el emisor solo lo envía
  return e
}

describe('orden, persistencia previa y bytes exactos', () => {
  it('envía de uno en uno y en orden; «enviando» ya está en el almacén cuando sale la petición; el texto es el guardado', async () => {
    const e = await entornoEmisor()
    await e.tel.iniciar(); await e.tel.enviarSiguiente()
    for (let i = 0; i < 3; i += 1) await e.tel.encolar(PUNTOS(e.tel))
    const guardado = (await leer(e)).entradas.filter((x) => x.estado === 'pendiente')
    const vistoAlEnviar = []
    const original = e.f.fetch
    e.f.fetch = async (url, init) => {
      const l = await leer(e)
      vistoAlEnviar.push(l.entradas.map((x) => [x.clientSeq, x.estado, x.intentos]))
      return original(url, init)
    }
    const { crearClienteSesion } = await import('./sesion-api')
    const cliente = crearClienteSesion({ ligaId: 'L1', partidoId: 'P', token: 't', fetchImpl: e.f.fetch, setTimeoutImpl: e.rv.setTimeoutImpl, clearTimeoutImpl: e.rv.clearTimeoutImpl, monoAhora: e.rv.monoAhora })
    const emisor = e.crear({ cliente })
    emisor.despertar()
    await drenar(e, emisor)
    expect(e.f.llamadas.map(BODY)).toEqual(guardado.map((x) => x.cuerpoJson)) // bytes exactos, mismo orden
    expect(vistoAlEnviar.map((v) => v.filter((x) => x[1] === 'enviando').length)).toEqual([1, 1, 1])
    const fin = await leer(e)
    expect(fin.entradas.every((x) => x.estado === 'confirmada')).toBe(true)
    expect(fin.sesion.base.ultimoClientSeq).toBe(4)
    expect(emisor.estado().fase).toBe('inactivo')
    await emisor.cerrar()
  })

  it('una petición a la vez: nunca hay dos en vuelo', async () => {
    const e = await entornoEmisor()
    await e.tel.iniciar(); await e.tel.enviarSiguiente()
    for (let i = 0; i < 4; i += 1) await e.tel.encolar(PUNTOS(e.tel))
    let enVuelo = 0
    let maximo = 0
    const base = e.f.fetch
    const { crearClienteSesion } = await import('./sesion-api')
    const fetchImpl = async (u, i) => { enVuelo += 1; maximo = Math.max(maximo, enVuelo); await tick(); try { return await base(u, i) } finally { enVuelo -= 1 } }
    const emisor = e.crear({ cliente: crearClienteSesion({ ligaId: 'L1', partidoId: 'P', token: 't', fetchImpl, setTimeoutImpl: e.rv.setTimeoutImpl, clearTimeoutImpl: e.rv.clearTimeoutImpl, monoAhora: e.rv.monoAhora }) })
    emisor.despertar(); await drenar(e, emisor)
    expect(maximo).toBe(1)
    expect(e.f.llamadas).toHaveLength(4)
    await emisor.cerrar()
  })

  it('cada reintento reenvía el MISMO texto (cmdId, hora, número y versiones intactos) e incrementa solo los intentos', async () => {
    const e = await conInicioPendiente({ guion: [new Error('red'), respuesta(503, { tipo: 'resultado-desconocido', reintento: 'mismo-sobre' }), new Error('red')] })
    const antes = (await leer(e)).entradas[0]
    e.emisor.despertar(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(4)
    expect(new Set(e.f.llamadas.map(BODY)).size).toBe(1)
    expect(e.f.llamadas[0].cuerpo).toBe(antes.cuerpoJson)
    const fin = (await leer(e)).entradas[0]
    expect(fin).toMatchObject({ cmdId: antes.cmdId, clientSeq: antes.clientSeq, cuerpoJson: antes.cuerpoJson, intentos: 4, estado: 'confirmada' })
    await e.emisor.cerrar()
  })

  it('NUNCA crea un inicio: sin órdenes no envía nada y una sesión «sin-iniciar» sigue sin iniciar', async () => {
    const e = await entornoEmisor()
    e.emisor.despertar(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(0)
    const l = await leer(e)
    expect(l.entradas).toEqual([])
    expect(l.sesion.inicio).toBe('sin-iniciar')
    expect(e.emisor.estado().fase).toBe('inactivo')
    await e.emisor.cerrar()
  })

  it('solo el núcleo habilita la puntuación: un inicio incierto (o un 200 falso) no la habilita; el recibo aceptado sí', async () => {
    const html = respuesta(200, null, { texto: '<html>captive portal</html>', tipo: 'text/html' })
    const e = await conInicioPendiente({ guion: [html, new Error('red')] })
    e.emisor.despertar()
    await drenar(e, e.emisor, { hasta: () => e.f.llamadas.length >= 2 })
    const medio = await leer(e)
    expect(medio.sesion.inicio).toBe('sin-iniciar')
    expect(medio.vista.puntuacion.habilitada).toBe(false)
    expect(medio.entradas[0].estado).toBe('enviando')
    await drenar(e)
    const fin = await leer(e)
    expect(fin.sesion.inicio).toBe('confirmado')
    expect(fin.vista.puntuacion.habilitada).toBe(true)
    await e.emisor.cerrar()
  })
})

describe('recibos: aceptado, repetido y rechazado', () => {
  it('un recibo repetido (recibo-existente) se aplica sin cambios (idempotente)', async () => {
    const e = await conInicioPendiente()
    e.emisor.despertar(); await drenar(e)
    const l1 = await leer(e)
    // el servidor devuelve el recibo existente si se reenvía; el núcleo lo trata como no-op
    const reenvio = await e.banco.reenviar(JSON.parse(l1.entradas[0].cuerpoJson), T0)
    expect(reenvio.tipo).toBe('recibo-existente')
    const { aplicarRecibo } = await import('./sesion-almacen')
    const r = await aplicarRecibo(e.tel.almacen, { id: ID, revision: l1.sesion.revision, recibo: JSON.parse(JSON.stringify(reenvio.recibo)), ctx: e.tel.ctx() })
    expect(r).toMatchObject({ ok: true, noop: true })
    await e.emisor.cerrar()
  })

  it('un rechazo definitivo detiene el envío de las dependientes y no se envía NADA más', async () => {
    const e = await entornoEmisor()
    await e.tel.iniciar(); await e.tel.enviarSiguiente()
    // una orden de reloj con la hora del servidor MUY por detrás: el servidor la rechaza (tiempo-invalido)
    e.tel.ahora = T0 + 10_000 // el teléfono cree estar 10 s adelante…
    e.banco.ahora = T0 // …el servidor recibe 10 s ANTES de la hora de acción: tiempo-invalido definitivo
    const orden = e.tel.orden('arrancar-reloj', {}, cmd('arr'), { tiempo: { accionTs: T0 + 10_000, accionTsCrudo: T0 + 10_000, ajusteTsMs: 0, discontinuidad: null } })
    expect((await e.tel.encolar(orden)).ok).toBe(true)
    await e.tel.encolar(PUNTOS(e.tel)); await e.tel.encolar(PUNTOS(e.tel))
    const reloj = { estimar: () => ({ nivel: 'confiable', estimadoMs: T0 + 10_000 }) }
    const emisor = e.crear({ reloj })
    emisor.despertar(); await drenar(e, emisor)
    const l = await leer(e)
    expect(e.f.llamadas).toHaveLength(1) // solo la orden rechazada
    expect(l.entradas.map((x) => x.estado)).toEqual(['confirmada', 'rechazada', 'no-aplicada', 'no-aplicada'])
    expect(emisor.estado()).toMatchObject({ fase: 'detenida', causa: 'rechazo-definitivo' })
    emisor.despertar(); await drenar(e, emisor)
    expect(e.f.llamadas).toHaveLength(1)
    await emisor.cerrar()
  })
})

describe('clases de parada: persistidas, sin recibo fabricado y sin reenvío solo', () => {
  const CASOS = [
    ['401', respuesta(401, { error: 'no-autorizado' }), { clase: 'no-autorizado', http: 401 }],
    ['400 juego-distinto', respuesta(400, { error: 'juego-distinto' }), { clase: 'protocolo', subtipo: 'juego-distinto', http: 400 }],
    ['400 json-invalido', respuesta(400, { error: 'json-invalido' }), { clase: 'protocolo', subtipo: 'json-invalido', http: 400 }],
    ['404', respuesta(404, { error: 'no-encontrado' }), { clase: 'protocolo', subtipo: 'no-encontrado', http: 404 }],
    ['405', respuesta(405, { error: 'metodo-no-permitido' }), { clase: 'protocolo', subtipo: 'metodo-no-permitido', http: 405 }],
    ['413', respuesta(413, { error: 'cuerpo-demasiado-grande' }), { clase: 'protocolo', subtipo: 'cuerpo-demasiado-grande', http: 413 }],
    ['409 bloqueado', respuesta(409, { tipo: 'bloqueado' }), { clase: 'conflicto', subtipo: 'bloqueado', http: 409 }],
    ['409 hueco', respuesta(409, { tipo: 'hueco', esperado: 3 }), { clase: 'conflicto', subtipo: 'hueco', http: 409 }],
    ['409 secuencia-ocupada', respuesta(409, { tipo: 'secuencia-ocupada', ocupadaPor: 'x' }), { clase: 'conflicto', subtipo: 'secuencia-ocupada', http: 409 }],
    ['409 conflicto-contenido', respuesta(409, { tipo: 'conflicto-contenido', reciboOriginal: { cmdId: 'x' } }), { clase: 'conflicto', subtipo: 'conflicto-contenido', http: 409 }],
    ['422', respuesta(422, { error: 'sobre-invalido', errores: ['x'] }), { clase: 'sobre-invalido', http: 422 }],
  ]
  for (const [nombre, resp, esperado] of CASOS) {
    it(`${nombre}: parada de transporte persistida; la orden sigue incierta; tras recargar NO se envía solo`, async () => {
      const e = await conInicioPendiente({ guion: [resp] })
      const antes = (await leer(e)).entradas[0]
      e.emisor.despertar(); await drenar(e)
      expect(e.f.llamadas).toHaveLength(1)
      expect(e.emisor.estado()).toMatchObject({ fase: 'detenida', causa: 'transporte', persistida: true, ...esperado })
      const l = await leer(e)
      expect(l.sesion.detenida).toMatchObject({ causa: 'transporte', ...esperado, cmdId: antes.cmdId })
      expect(l.sesion.divergencia).toBeNull()
      expect(l.entradas[0]).toMatchObject({ estado: 'enviando', recibo: null, reciboHuella: null, cuerpoJson: antes.cuerpoJson, cmdId: antes.cmdId })
      expect(l.sesion.inicio).toBe('sin-iniciar')
      // despertar de nuevo, y un emisor nuevo tras «recargar»
      e.emisor.despertar(); await drenar(e)
      const otro = e.crear()
      otro.despertar(); await drenar(e, otro)
      expect(e.f.llamadas).toHaveLength(1)
      expect(otro.estado()).toMatchObject({ fase: 'detenida', causa: 'transporte' })
      await e.emisor.cerrar(); await otro.cerrar()
    })
  }

  it('no se envía nada más después de la parada: las órdenes que siguen no salen', async () => {
    const e = await entornoEmisor({ guion: [respuesta(409, { tipo: 'hueco', esperado: 9 })] })
    await e.tel.iniciar(); await e.tel.enviarSiguiente()
    for (let i = 0; i < 3; i += 1) await e.tel.encolar(PUNTOS(e.tel))
    e.emisor.despertar(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(1)
    const l = await leer(e)
    expect(l.entradas.map((x) => x.estado)).toEqual(['confirmada', 'enviando', 'pendiente', 'pendiente'])
    await e.emisor.cerrar()
  })
})

describe('respuestas desconocidas o mal formadas: nunca fabrican un rechazo ni un recibo', () => {
  const html = (status) => respuesta(status, null, { texto: '<!doctype html><title>x</title>', tipo: 'text/html' })
  const CASOS = [
    ['HTML 200', () => html(200)], ['HTML 401', () => html(401)], ['HTML 409', () => html(409)], ['HTML 422', () => html(422)],
    ['JSON ilegible', () => respuesta(200, null, { texto: '{no' })],
    ['200 con clave de más', () => respuesta(200, { resultado: 'aceptado', recibo: {}, publicacion: 1, extra: 1 })],
    ['200 con resultado inconsistente', () => respuesta(200, { resultado: 'aceptado', recibo: { resultado: 'rechazado' }, publicacion: 'no-aplica' })],
    ['200 sin recibo', () => respuesta(200, { resultado: 'aceptado', publicacion: 1 })],
    ['409 de tipo desconocido', () => respuesta(409, { tipo: 'otra-cosa' })],
    ['401 con otro cuerpo', () => respuesta(401, { error: 'otra' })],
    ['403', () => respuesta(403, { error: 'no-autorizado' })],
    ['302/estado raro', () => respuesta(418, { error: 'tetera' })],
    ['cuerpo demasiado grande', () => respuesta(200, { relleno: 'x'.repeat(70 * 1024) })],
  ]
  for (const [nombre, hacer] of CASOS) {
    it(`${nombre}: sin parada persistida, sin recibo, la orden sigue «enviando»; tras 3 seguidas se suspende`, async () => {
      const e = await conInicioPendiente({ guion: [hacer(), hacer(), hacer()] })
      e.emisor.despertar(); await drenar(e)
      expect(e.f.llamadas).toHaveLength(3)
      expect(e.emisor.estado()).toMatchObject({ fase: 'respuestas-malformadas', persistida: false })
      const l = await leer(e)
      expect(l.sesion.detenida).toBeNull()
      expect(l.sesion.divergencia).toBeNull()
      expect(l.entradas[0]).toMatchObject({ estado: 'enviando', recibo: null, intentos: 3 })
      expect(l.sesion.inicio).toBe('sin-iniciar')
      await e.emisor.cerrar()
    })
  }

  it('un 200 «aceptado» con recibo de otra orden: el núcleo lo detiene como divergencia (no se confirma nada)', async () => {
    const e = await conInicioPendiente()
    const falso = await (async () => {
      const otro = servidorNuevo()
      const s = (await e.tel.leer()).entradas[0]
      const o = JSON.parse(s.cuerpoJson)
      const r = await otro.reenviar({ ...o, cmdId: 'otro-cmd' }, T0)
      return JSON.parse(JSON.stringify(r.recibo))
    })()
    e.f.guion.push(respuesta(200, { resultado: 'aceptado', recibo: falso, publicacion: {} }))
    e.emisor.despertar(); await drenar(e)
    const l = await leer(e)
    expect(l.entradas[0].estado).toBe('enviando')
    expect(l.sesion.inicio).toBe('sin-iniciar')
    expect(e.emisor.estado().fase).toBe('detenida')
    await e.emisor.cerrar()
  })
})

describe('incertidumbre: red, tiempo agotado, 503, 5xx y 429', () => {
  it('espera exacta de REPORT_119: 1, 2, 4, 8, 16, 30, 30 s; 8 intentos y entonces «reintentos-agotados»; la orden sigue «enviando»', async () => {
    const e = await conInicioPendiente({ guion: Array.from({ length: 8 }, () => new Error('red')) })
    e.emisor.despertar()
    const esperas = await drenar(e)
    expect(esperas).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
    expect(e.f.llamadas).toHaveLength(8)
    expect(e.emisor.estado()).toMatchObject({ fase: 'reintentos-agotados', intentos: 8 })
    const l = await leer(e)
    expect(l.entradas[0]).toMatchObject({ estado: 'enviando', intentos: 8, recibo: null })
    expect(l.sesion.detenida).toBeNull()
    // un despertar explícito empieza una corrida nueva con el mismo texto
    e.emisor.despertar(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(9)
    expect(new Set(e.f.llamadas.map(BODY)).size).toBe(1)
    expect(e.emisor.estado().fase).toBe('inactivo')
    await e.emisor.cerrar()
  })

  it('el jitter es ±20 % (acotado)', async () => {
    for (const [azar, factor] of [[0, 0.8], [1, 1.2]]) {
      const e = await conInicioPendiente({ guion: [new Error('red')], azar: () => azar })
      e.emisor.despertar()
      const esperas = await drenar(e)
      expect(esperas[0]).toBe(Math.round(1000 * factor))
      await e.emisor.cerrar()
    }
  })

  it('503 resultado-desconocido, fallo-sin-escritura (500/503) y 5xx genéricos conservan la incertidumbre y reintentan el MISMO sobre', async () => {
    const e = await conInicioPendiente({ guion: [
      respuesta(503, { tipo: 'resultado-desconocido', reintento: 'mismo-sobre' }),
      respuesta(503, { tipo: 'fallo-sin-escritura', esteIntento: 'sin-escritura', alcance: 'solo-este-intento', motivo: 'contencion', reintento: 'mismo-sobre' }),
      respuesta(500, { tipo: 'fallo-sin-escritura', esteIntento: 'sin-escritura', alcance: 'solo-este-intento', motivo: 'interno', reintento: 'mismo-sobre' }),
      respuesta(502, null, { texto: '<html>bad gateway</html>', tipo: 'text/html' }),
    ] })
    e.emisor.despertar(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(5)
    expect(new Set(e.f.llamadas.map(BODY)).size).toBe(1)
    const l = await leer(e)
    expect(l.entradas[0]).toMatchObject({ estado: 'confirmada', intentos: 5 })
    expect(l.sesion.detenida).toBeNull()
    await e.emisor.cerrar()
  })

  it('«fallo-sin-escritura» de ESTE intento no resuelve un intento anterior: la orden sigue sin recibo hasta tenerlo', async () => {
    const e = await conInicioPendiente({ guion: [new Error('red'), respuesta(503, { tipo: 'fallo-sin-escritura', esteIntento: 'sin-escritura', alcance: 'solo-este-intento', motivo: 'contencion', reintento: 'mismo-sobre' }), new Error('red'), 'colgar'] })
    e.emisor.despertar()
    await drenar(e, e.emisor, { hasta: () => e.f.llamadas.length === 4 })
    expect(e.f.llamadas).toHaveLength(4) // la cuarta queda colgada: nada la resuelve
    const l = await leer(e)
    expect(l.entradas[0]).toMatchObject({ estado: 'enviando', recibo: null })
    expect(l.entradas[0].motivoNoAplicada).toBeNull()
    await e.emisor.cerrar()
  })
})

describe('Retry-After', () => {
  it('429 con Retry-After mayor que la espera: no hay ningún envío antes de que venza; luego sí', async () => {
    const e = await conInicioPendiente({ guion: [respuesta(429, { error: 'x' }, { cabeceras: { 'retry-after': '20' } })] })
    e.emisor.despertar()
    await drenar(e, e.emisor, { hasta: () => e.f.llamadas.length === 1 })
    const t0 = e.rv.mono
    const esperas = await drenar(e)
    expect(esperas[0]).toBe(20_000)
    expect(e.f.llamadas).toHaveLength(2)
    expect(e.rv.mono - t0).toBeGreaterThanOrEqual(20_000)
    await e.emisor.cerrar()
  })

  it('Retry-After que supera el presupuesto: se SUSPENDE (no se acorta); un reintento explícito antes de vencer tampoco envía', async () => {
    const e = await conInicioPendiente({ guion: [respuesta(503, { tipo: 'resultado-desconocido', reintento: 'mismo-sobre' }, { cabeceras: { 'retry-after': '600' } })] })
    e.emisor.despertar(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(1)
    expect(e.emisor.estado()).toMatchObject({ fase: 'suspendida-retry-after' })
    expect(e.rv.timers).toHaveLength(0)
    await e.emisor.reintentarAhora(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(1) // antes de vencer: nada
    e.rv.mono += 600_000
    await e.emisor.reintentarAhora(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(2)
    expect(e.emisor.estado().fase).toBe('inactivo')
    await e.emisor.cerrar()
  })

  it('un Retry-After inválido (texto, negativo, desmedido) se ignora y manda la espera normal', async () => {
    for (const valor of ['abc', '-5', '99999999999', '']) {
      const e = await conInicioPendiente({ guion: [respuesta(429, { error: 'x' }, { cabeceras: { 'retry-after': valor } })] })
      e.emisor.despertar()
      const esperas = await drenar(e)
      expect(esperas[0], valor).toBe(1000)
      await e.emisor.cerrar()
    }
  })
})

describe('sin conexión', () => {
  it('sin internet no se envía nada ni se marca «enviando»; al volver la conexión sí', async () => {
    const e = await conInicioPendiente({ enLinea: false })
    e.emisor.despertar(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(0)
    expect(e.emisor.estado().fase).toBe('sin-conexion')
    const l = await leer(e)
    expect(l.entradas[0]).toMatchObject({ estado: 'pendiente', intentos: 0 })
    e.conectar(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(1)
    expect((await leer(e)).entradas[0].estado).toBe('confirmada')
    await e.emisor.cerrar()
  })
  it('si se pierde la conexión durante la espera, al despertar el temporizador no envía', async () => {
    const e = await conInicioPendiente({ guion: [new Error('red')] })
    e.emisor.despertar()
    await drenar(e, e.emisor, { hasta: () => e.emisor.estado().fase === 'esperando-reintento' })
    e.desconectar()
    await drenar(e)
    expect(e.f.llamadas).toHaveLength(1)
    expect(e.emisor.estado().fase).toBe('sin-conexion')
    await e.emisor.cerrar()
  })
})

describe('fallas de almacenamiento', () => {
  const cuota = () => { const x = new Error('cuota'); x.name = 'QuotaExceededError'; return x }
  it('si NO se pudo persistir «enviando», no se transmite nada', async () => {
    const e = await conInicioPendiente()
    e.tel.almacen.gancho = (g) => { if (g.op === 'enviar' && g.fase === 'escribir') throw cuota() }
    e.emisor.despertar(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(0)
    expect(e.emisor.estado()).toMatchObject({ fase: 'almacenamiento', enviado: false })
    e.tel.almacen.gancho = null
    expect((await leer(e)).entradas[0]).toMatchObject({ estado: 'pendiente', intentos: 0 })
    await e.emisor.cerrar()
  })

  it('el recibo obtenido se persiste ANTES de seguir: si falla una vez se reintenta a los 500 ms y continúa', async () => {
    const e = await entornoEmisor()
    await e.tel.iniciar(); await e.tel.enviarSiguiente(); await e.tel.encolar(PUNTOS(e.tel))
    let fallos = 1
    e.tel.almacen.gancho = (g) => { if (g.op === 'recibo' && g.fase === 'escribir' && g.n === 1 && fallos > 0) { fallos -= 1; throw cuota() } }
    e.emisor.despertar()
    const esperas = await drenar(e, e.emisor, { hasta: null })
    await drenar(e)
    expect(e.f.llamadas).toHaveLength(1)
    expect((await leer(e)).entradas[1].estado).toBe('confirmada')
    void esperas
    await e.emisor.cerrar()
  })

  it('si el recibo no se puede guardar tras 4 intentos (0,5 / 1 / 2 s) se DETIENE, no se envía la siguiente y no se confirma de memoria; al reabrir se reenvía el original', async () => {
    const e = await entornoEmisor()
    await e.tel.iniciar(); await e.tel.enviarSiguiente()
    await e.tel.encolar(PUNTOS(e.tel)); await e.tel.encolar(PUNTOS(e.tel))
    e.tel.almacen.gancho = (g) => { if (g.op === 'recibo' && g.fase === 'escribir') throw cuota() }
    e.emisor.despertar()
    const esperas = []
    for (let i = 0; i < 40 && e.emisor.estado().fase !== 'almacenamiento'; i += 1) {
      await tick()
      if (e.rv.timers.length) { const a = e.rv.mono; e.rv.dispararSiguiente(); esperas.push(e.rv.mono - a) }
    }
    await e.emisor.reposo()
    expect(esperas).toEqual([500, 1000, 2000])
    expect(e.emisor.estado()).toMatchObject({ fase: 'almacenamiento', reciboSoloEnMemoria: true })
    expect(e.f.llamadas).toHaveLength(1)
    const l = await leer(e)
    expect(l.entradas.map((x) => x.estado)).toEqual(['confirmada', 'enviando', 'pendiente'])
    // el almacén vuelve a funcionar: el nuevo emisor reenvía el MISMO texto y el servidor devuelve el mismo recibo
    e.tel.almacen.gancho = null
    const otro = e.crear()
    otro.despertar(); await drenar(e, otro)
    expect(e.f.llamadas[1].cuerpo).toBe(e.f.llamadas[0].cuerpo)
    expect((await leer(e)).entradas.map((x) => x.estado)).toEqual(['confirmada', 'confirmada', 'confirmada'])
    await e.emisor.cerrar(); await otro.cerrar()
  })

  it('si NO se puede grabar la parada de transporte: se detiene en memoria y se dice que una recarga no la protege', async () => {
    const e = await conInicioPendiente({ guion: [respuesta(401, { error: 'no-autorizado' })] })
    e.tel.almacen.gancho = (g) => { if (g.op === 'parada' && g.fase === 'escribir') throw cuota() }
    e.emisor.despertar(); await drenar(e)
    expect(e.emisor.estado()).toMatchObject({ fase: 'detenida', causa: 'transporte', clase: 'no-autorizado', persistida: false, protegidaTrasRecarga: false })
    expect((await leer(e)).sesion.detenida).toBeNull()
    e.tel.almacen.gancho = null
    e.emisor.despertar(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(1) // en memoria sigue detenido
    await e.emisor.cerrar()
  })
})

let e_ = null
describe('reloj: retención sin reescribir el sobre', () => {
  async function conRelojDeOrden(reloj) {
    const e = await entornoEmisor({ reloj })
    await e.tel.iniciar(); await e.tel.enviarSiguiente()
    const o = e.tel.orden('arrancar-reloj', {}, cmd('arr'))
    expect((await e.tel.encolar(o)).ok).toBe(true)
    return { e, o }
  }
  it('sin reloj inyectado o sin estimación confiable: la orden de reloj se retiene y el sobre no cambia', async () => {
    for (const reloj of [null, { estimar: () => ({ nivel: 'degradado', estimadoMs: T0 }) }, { estimar: () => { throw new Error('x') } }]) {
      const { e } = await conRelojDeOrden(reloj)
      const antes = (await leer(e)).entradas[1]
      e.emisor.despertar(); await drenar(e)
      expect(e.f.llamadas).toHaveLength(0) // (el inicio se confirmó fuera del emisor)
      expect(e.emisor.estado().fase).toBe('retenida-por-reloj')
      const despues = (await leer(e)).entradas[1]
      expect(despues).toEqual(antes)
      expect(despues.estado).toBe('pendiente')
      await e.emisor.cerrar()
    }
  })
  it('los puntos y faltas NO se retienen aunque no haya estimación', async () => {
    const e = await entornoEmisor({ reloj: { estimar: () => ({ nivel: 'sin-estimacion', estimadoMs: null }) } })
    await e.tel.iniciar(); await e.tel.enviarSiguiente()
    await e.tel.encolar(PUNTOS(e.tel)); await e.tel.encolar(e.tel.orden('falta', { equipoId: 'E1', jugadorId: 'J1' }))
    e.emisor.despertar(); await drenar(e)
    expect((await leer(e)).entradas.slice(1).map((x) => x.estado)).toEqual(['confirmada', 'confirmada'])
    await e.emisor.cerrar()
  })
  it('hora de acción adelantada respecto de la estimación: espera lo justo y luego envía el MISMO sobre', async () => {
    const mono0 = 1000
    const { e } = await conRelojDeOrden({ estimar: () => ({ nivel: 'confiable', estimadoMs: T0 - 1500 + (e_.rv.mono - mono0) }) })
    const antes = (await leer(e)).entradas[1]
    e_ = e
    e.emisor.despertar()
    const esperas = await drenar(e)
    expect(esperas).toEqual([500]) // accionTs = T0; exceso = T0 − (T0 − 1500 + 1000) = 500 ms
    expect(e.f.llamadas).toHaveLength(1)
    expect(e.f.llamadas[0].cuerpo).toBe(antes.cuerpoJson)
    await e.emisor.cerrar()
  })
  it('más de 30 s por delante: «reloj-adelantado» (se suspende, sin temporizador) y el sobre no cambia', async () => {
    const { e } = await conRelojDeOrden({ estimar: () => ({ nivel: 'confiable', estimadoMs: T0 - 40_000 }) })
    const antes = (await leer(e)).entradas[1]
    e.emisor.despertar(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(0)
    expect(e.emisor.estado()).toMatchObject({ fase: 'retenida-por-reloj', motivo: 'reloj-adelantado' })
    expect(e.rv.timers).toHaveLength(0)
    expect((await leer(e)).entradas[1]).toEqual(antes)
    await e.emisor.cerrar()
  })
  it('una orden ya enviada («enviando») NO se retiene por el reloj al reintentar', async () => {
    const { e } = await conRelojDeOrden({ estimar: () => ({ nivel: 'confiable', estimadoMs: T0 }) })
    e.f.guion.push(new Error('red'))
    e.emisor.despertar(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(2)
    await e.emisor.cerrar()
  })
})

// ---------------------------------------------------------------------------
describe('cierre y pérdida de propiedad', () => {
  const hash = (e) => volcarBase(e.tel.almacen)
  /** El servidor EJECUTA el comando (confirma) pero la respuesta llega cuando el test lo decide, ignorando la cancelación. */
  const respuestaTardia = (e) => (llamada) => new Promise((resolver) => {
    e.banco.reenviar(JSON.parse(llamada.cuerpo), e.banco.ahora).then((r) => {
      const recibo = JSON.parse(JSON.stringify(r.recibo))
      llamada.llegar = () => resolver(respuesta(200, { resultado: r.tipo, recibo, publicacion: {} }))
    })
  })

  it('cerrar con una petición en vuelo: se aborta, se cancelan los temporizadores, la orden queda «enviando» y no se afirma que el servidor no confirmó', async () => {
    const e = await conInicioPendiente({ guion: ['colgar'] })
    e.emisor.despertar()
    await drenar(e, e.emisor, { hasta: () => e.f.llamadas.length === 1 })
    const r = await e.emisor.cerrar()
    expect(r).toMatchObject({ cerrado: true, peticionAbortada: true, resultadoDelServidorDesconocido: true, operacionesPendientes: 0 })
    expect(e.f.llamadas[0].abortada).toBe(true)
    expect(e.rv.timers).toHaveLength(0)
    expect(e.emisor.estado().fase).toBe('cerrado')
    expect((await leer(e)).entradas[0]).toMatchObject({ estado: 'enviando', recibo: null })
    // ni despertar ni reintentar envían después de cerrar
    e.emisor.despertar(); await e.emisor.reintentarAhora(); await tick()
    expect(e.f.llamadas).toHaveLength(1)
    expect(await e.emisor.reintentarConConfirmacion({ confirmadoPorOperador: true })).toMatchObject({ ok: false, motivo: 'no-disponible' })
  })

  it('una respuesta TARDÍA (el servidor sí confirmó) llega tras cerrar: se descarta, el almacén no cambia y no sale otra petición; el siguiente propietario la resuelve', async () => {
    const e = await conInicioPendiente()
    e.f.guion.push(respuestaTardia(e))
    e.emisor.despertar()
    await drenar(e, e.emisor, { hasta: () => e.f.llamadas.length === 1 })
    await tick(); await tick()
    const cierre = e.emisor.cerrar()
    await cierre
    const antes = await hash(e)
    e.f.llamadas[0].llegar() // llega la respuesta de la generación vencida
    for (let i = 0; i < 10; i += 1) await tick()
    expect(await hash(e)).toBe(antes)
    expect(e.f.llamadas).toHaveLength(1)
    expect((await leer(e)).entradas[0]).toMatchObject({ estado: 'enviando', recibo: null })
    expect(e.banco.adaptador.estado().partido.estado).toBe('vivo') // el servidor SÍ confirmó
    // el siguiente propietario reenvía el mismo texto y recibe el recibo guardado
    const siguiente = e.crear()
    siguiente.despertar(); await drenar(e, siguiente)
    expect(e.f.llamadas[1].cuerpo).toBe(e.f.llamadas[0].cuerpo)
    expect((await leer(e)).entradas[0].estado).toBe('confirmada')
    await siguiente.cerrar()
  })

  it('perder la propiedad durante la espera de un reintento: sin temporizadores, sin envíos y sin escrituras; estado «propiedad-perdida»', async () => {
    const e = await conInicioPendiente({ guion: [new Error('red')] })
    e.emisor.despertar()
    await drenar(e, e.emisor, { hasta: () => e.emisor.estado().fase === 'esperando-reintento' })
    const capturados = [...e.rv.timers]
    e.perderPropiedad()
    expect(e.rv.timers).toHaveLength(0)
    await e.emisor.reposo()
    const antes = await hash(e)
    for (const t of capturados) t.fn() // devolución tardía del temporizador cancelado
    for (let i = 0; i < 10; i += 1) await tick()
    expect(e.f.llamadas).toHaveLength(1)
    expect(await hash(e)).toBe(antes)
    expect(e.emisor.estado().fase).toBe('propiedad-perdida')
    e.emisor.despertar(); await tick()
    expect(e.f.llamadas).toHaveLength(1)
    await e.emisor.cerrar()
  })

  it('perder la propiedad con una petición en vuelo: se aborta; la respuesta tardía no escribe ni dispara otro envío', async () => {
    const e = await conInicioPendiente()
    e.f.guion.push(respuestaTardia(e))
    e.emisor.despertar()
    await drenar(e, e.emisor, { hasta: () => e.f.llamadas.length === 1 })
    await tick(); await tick()
    e.perderPropiedad()
    await e.emisor.reposo()
    const antes = await hash(e)
    e.f.llamadas[0].llegar()
    for (let i = 0; i < 10; i += 1) await tick()
    expect(await hash(e)).toBe(antes)
    expect(e.f.llamadas).toHaveLength(1)
    expect(e.f.llamadas[0].abortada).toBe(true)
    await e.emisor.cerrar()
  })

  it('sin aviso, la propiedad se pierde con la petición en vuelo: la respuesta que llega NO se aplica (guardia por generación/propiedad)', async () => {
    const e = await conInicioPendiente()
    e.f.guion.push(respuestaTardia(e))
    e.emisor.despertar()
    await drenar(e, e.emisor, { hasta: () => e.f.llamadas.length === 1 })
    await tick(); await tick()
    e.estadoProp.propietario = false // sin callback: solo la comprobación puede notarlo
    const antes = await hash(e)
    e.f.llamadas[0].llegar()
    await e.emisor.reposo()
    expect(await hash(e)).toBe(antes)
    expect(e.f.llamadas).toHaveLength(1)
    expect((await leer(e)).entradas[0]).toMatchObject({ estado: 'enviando', recibo: null })
    await e.emisor.cerrar()
  })

  it('sin aviso de pérdida pero sin propiedad al comprobar: ni se marca ni se envía', async () => {
    const e = await conInicioPendiente()
    e.estadoProp.propietario = false
    const antes = await hash(e)
    e.emisor.despertar(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(0)
    expect(await hash(e)).toBe(antes)
    await e.emisor.cerrar()
  })

  it('cerrar justo después de despertar: no sale ninguna petición y no queda ninguna operación pendiente ni escritura posterior', async () => {
    const e = await conInicioPendiente()
    e.emisor.despertar()
    const r = await e.emisor.cerrar()
    expect(r.operacionesPendientes).toBe(0)
    const antes = await hash(e)
    for (let i = 0; i < 10; i += 1) await tick()
    expect(e.f.llamadas).toHaveLength(0)
    expect(await hash(e)).toBe(antes)
  })

  it('cerrar es idempotente y los suscriptores no reciben nada después', async () => {
    const e = await conInicioPendiente()
    const vistos = []
    e.emisor.suscribir((s) => vistos.push(s.fase))
    await e.emisor.cerrar()
    const n = vistos.length
    expect(await e.emisor.cerrar()).toMatchObject({ yaCerrado: true })
    e.emisor.despertar(); await tick()
    expect(vistos).toHaveLength(n)
    expect(vistos.at(-1)).toBe('cerrado')
  })
})

describe('vía explícita para obtener el recibo bajo una parada de transporte', () => {
  async function conParada401() {
    const e = await conInicioPendiente({ guion: [respuesta(401, { error: 'no-autorizado' })] })
    e.emisor.despertar(); await drenar(e)
    expect(e.emisor.estado()).toMatchObject({ fase: 'detenida', causa: 'transporte' })
    return e
  }
  it('sin confirmación no envía; con confirmación reenvía el sobre ORIGINAL una vez, aplica el recibo y NO borra la parada', async () => {
    const e = await conParada401()
    const original = (await leer(e)).entradas[0].cuerpoJson
    expect(await e.emisor.reintentarConConfirmacion({})).toMatchObject({ ok: false, motivo: 'falta-confirmacion' })
    expect(await e.emisor.reintentarConConfirmacion({ confirmadoPorOperador: false })).toMatchObject({ ok: false, motivo: 'falta-confirmacion' })
    expect(e.f.llamadas).toHaveLength(1)
    const r = await e.emisor.reintentarConConfirmacion({ confirmadoPorOperador: true })
    expect(r.ok).toBe(true)
    expect(e.f.llamadas).toHaveLength(2)
    expect(e.f.llamadas[1].cuerpo).toBe(original)
    const l = await leer(e)
    expect(l.entradas[0]).toMatchObject({ estado: 'confirmada', cuerpoJson: original })
    expect(l.sesion.inicio).toBe('confirmado')
    expect(l.sesion.detenida).toMatchObject({ causa: 'transporte' })
    expect(e.emisor.estado()).toMatchObject({ fase: 'detenida', causa: 'transporte', ultimoReintento: 'recibo' })
    e.emisor.despertar(); await drenar(e)
    expect(e.f.llamadas).toHaveLength(2)
    await e.emisor.cerrar()
  })
  it('un intento explícito incierto cuenta como UN intento: no entra en un bucle de reintentos', async () => {
    const e = await conParada401()
    e.f.guion.push(new Error('red'))
    const r = await e.emisor.reintentarConConfirmacion({ confirmadoPorOperador: true })
    expect(r.ok).toBe(true)
    expect(e.f.llamadas).toHaveLength(2)
    expect(e.rv.timers).toHaveLength(0)
    expect(e.emisor.estado()).toMatchObject({ fase: 'detenida', ultimoReintento: 'red' })
    await e.emisor.cerrar()
  })
  it('una parada por rechazo definitivo (u otra) no se reabre con esta vía', async () => {
    const e = await entornoEmisor()
    await e.tel.iniciar(); await e.tel.enviarSiguiente()
    e.tel.ahora = T0 + 10_000; e.banco.ahora = T0
    await e.tel.encolar(e.tel.orden('arrancar-reloj', {}, cmd('arr'), { tiempo: { accionTs: T0 + 10_000, accionTsCrudo: T0 + 10_000, ajusteTsMs: 0, discontinuidad: null } }))
    const emisor = e.crear({ reloj: { estimar: () => ({ nivel: 'confiable', estimadoMs: T0 + 10_000 }) } })
    emisor.despertar(); await drenar(e, emisor)
    expect(emisor.estado()).toMatchObject({ causa: 'rechazo-definitivo' })
    const n = e.f.llamadas.length
    expect((await emisor.reintentarConConfirmacion({ confirmadoPorOperador: true })).ok).toBe(true)
    expect(e.f.llamadas).toHaveLength(n)
    expect(emisor.estado()).toMatchObject({ fase: 'detenida', causa: 'rechazo-definitivo' })
    await emisor.cerrar()
  })
})

describe('verificación explícita y atribución', () => {
  const estadoOk = (banco) => respuesta(200, cuerpoDeServidor(banco))
  it('verifica la instantánea fresca; en vuelo se rechaza sin pedir nada; sin credencial detiene con parada persistida', async () => {
    const e = await entornoEmisor()
    await e.tel.iniciar(); await e.tel.enviarSiguiente()
    e.f.guion.push(estadoOk(e.banco))
    expect(await e.emisor.verificarAhora()).toMatchObject({ ok: true, sincronizada: true })
    expect((await leer(e)).sesion.verificacion.nivel).toBe('verificada')
    // orden en vuelo
    await e.tel.leer()
    await e.tel.encolar(PUNTOS(e.tel))
    const { marcarEnviando } = await import('./sesion-almacen')
    const l = await leer(e)
    await marcarEnviando(e.tel.almacen, { id: ID, revision: l.sesion.revision, cmdId: l.entradas[1].cmdId, ctx: e.tel.ctx() })
    const n = e.f.llamadas.length
    expect(await e.emisor.verificarAhora()).toMatchObject({ ok: false, motivo: 'entrada-en-vuelo' })
    expect(e.f.llamadas).toHaveLength(n)
    await e.emisor.cerrar()
    // 401 en la lectura protegida
    const e2 = await entornoEmisor({ guion: [respuesta(401, { error: 'no-autorizado' })] })
    expect(await e2.emisor.verificarAhora()).toMatchObject({ ok: false, motivo: 'sin-credencial', sincronizada: false })
    expect((await leer(e2)).sesion.detenida).toMatchObject({ causa: 'transporte', clase: 'no-autorizado', cmdId: null })
    await e2.emisor.cerrar()
  })

  it('«atribucion-no-aplicada» se informa como NO sincronizada y no cambia nada', async () => {
    const { crearAtribucion } = await import('../motor')
    const { JUGADORES_DE_PRUEBA } = await import('../motor/prueba/banco')
    const banco = servidorNuevo()
    const e = await entornoEmisor({ banco })
    await e.tel.iniciar(); await e.tel.enviarSiguiente()
    await e.tel.encolar(PUNTOS(e.tel)); await e.tel.enviarSiguiente()
    await e.tel.encolar(e.tel.orden('cerrar-partido')); await e.tel.enviarSiguiente()
    expect(banco.adaptador.estado().partido.estado).toBe('final')
    const l = await leer(e)
    const estrecho = await abrirAlmacen({ nombre: e.tel.almacen.db.name, limites: { maxComandosPartido: 1200, maxBytesPartido: l.sesion.uso.bytes + l.sesion.uso.reservado, maxBytesTotal: 1 << 30, sobrecargaFila: 256, margenReservaBytes: 128, dependienteBytes: 64, motivoMax: 120, detalleMaxBytes: 512, advertenciasMax: 8, advertenciaMaxChars: 64, evidenciaMaxChars: 4096 } })
    const extras = Array.from({ length: 12 }, (_, i) => ({ id: `N${i}`, equipoId: i % 2 ? 'E1' : 'E2', nombre: `Extra ${i}` }))
    banco.adaptador.fijarAtribucion(crearAtribucion({ equipos: ['E1', 'E2'], jugadores: [...JUGADORES_DE_PRUEBA.map((j) => ({ ...j })), ...extras] }))
    e.f.guion.push(estadoOk(banco))
    const antes = await volcarBase(e.tel.almacen)
    const emisor = e.crear({ almacen: estrecho })
    const r = await emisor.verificarAhora()
    expect(r).toMatchObject({ ok: false, motivo: 'atribucion-no-aplicada', sincronizada: false, atribucionAdoptada: false, causa: 'limite-de-almacenamiento' })
    expect(await volcarBase(e.tel.almacen)).toBe(antes)
    expect(emisor.estado().ultimaVerificacion).toMatchObject({ sincronizada: false })
    await emisor.cerrar(); await e.emisor.cerrar()
  })

  it('traducirVerificacion: éxito, atribución no aplicada, divergencia y desconocidos', () => {
    expect(traducirVerificacion({ ok: true, verificada: true, atribucionRefrescada: { de: 'a', a: 'b' } })).toEqual({ ok: true, sincronizada: true, atribucionRefrescada: { de: 'a', a: 'b' } })
    expect(traducirVerificacion({ ok: false, motivo: 'atribucion-no-aplicada', causa: 'limite-de-almacenamiento', limite: 'limite-bytes-partido' })).toMatchObject({ sincronizada: false, atribucionAdoptada: false })
    expect(traducirVerificacion({ ok: false, motivo: 'divergencia', causa: 'x' })).toMatchObject({ sincronizada: false, motivo: 'divergencia' })
    expect(traducirVerificacion(null)).toMatchObject({ ok: false, sincronizada: false })
    expect(POLITICA_EMISOR.esperasMs).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
  })
})
