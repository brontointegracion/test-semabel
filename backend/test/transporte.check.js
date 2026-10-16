import { describe, expect, it } from 'vitest'
import { ORIGEN_REMOTO_APROBADO, TIEMPO_PREDETERMINADO_MS, bloqueoDeEntorno, crearTransporte, tiempoValido, validarDestino, validarOrigenLocal } from '../scripts/lib/transporte.js'

// Transporte de las herramientas de carga: destino, entorno TLS, redirecciones y tiempos. Sin red: `fetch` simulado.

describe('destino: loopback por omisión, remoto solo con opt-in y el origen exacto', () => {
  it('por omisión solo acepta loopback; semabel.com sin opt-in es «no local»', () => {
    for (const o of ['http://127.0.0.1:8787', 'https://localhost:8802', 'http://[::1]:9']) expect(validarDestino(o)).toMatchObject({ remoto: false })
    expect(validarDestino('https://semabel.com')).toEqual({ error: 'origen-no-local' })
    expect(validarDestino(ORIGEN_REMOTO_APROBADO, { remoto: false })).toEqual({ error: 'origen-no-local' })
    expect(validarOrigenLocal('http://127.0.0.1:1')).toEqual({ origen: 'http://127.0.0.1:1', remoto: false })
  })
  it('con opt-in acepta EXACTAMENTE https://semabel.com', () => {
    expect(validarDestino('https://semabel.com', { remoto: true })).toEqual({ origen: 'https://semabel.com', remoto: true })
  })
  it('con opt-in rechaza esquema, puerto, credenciales, ruta, mayúsculas, subdominios, sufijos y cualquier otro host', () => {
    const malos = [
      'http://semabel.com', 'https://semabel.com:443', 'https://semabel.com:8443', 'https://semabel.com/', 'https://semabel.com/v1', 'https://semabel.com?x=1',
      'https://semabel.com#a', 'https://user@semabel.com', 'https://user:clave@semabel.com', 'https://SEMABEL.COM', 'HTTPS://semabel.com', 'https://www.semabel.com',
      'https://semabel.com.evil.test', 'https://evilsemabel.com', 'https://semabel.com@evil.test', 'https://evil.test', 'https://sebel-liga-backend.workers.dev',
      'https://localhost', 'http://127.0.0.1:8787', ' https://semabel.com', 'https://semabel.com ', '', undefined, null, 42,
    ]
    for (const m of malos) expect(validarDestino(m, { remoto: true }), String(m)).toHaveProperty('error')
  })
  it('no hay lista configurable: el origen aprobado es una constante', () => {
    expect(validarDestino('https://otro.example', { remoto: true })).toEqual({ error: 'origen-remoto-no-aprobado' })
  })
})

describe('entorno: la verificación TLS no se puede relajar en remoto', () => {
  const remoto = { origen: ORIGEN_REMOTO_APROBADO, remoto: true }
  it('NODE_TLS_REJECT_UNAUTHORIZED=0 y las CA adicionales bloquean un destino remoto', () => {
    expect(bloqueoDeEntorno({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, remoto)).toBe('tls-verificacion-desactivada')
    expect(bloqueoDeEntorno({ NODE_TLS_REJECT_UNAUTHORIZED: ' 0 ' }, remoto)).toBe('tls-verificacion-desactivada')
    expect(bloqueoDeEntorno({ NODE_EXTRA_CA_CERTS: '/tmp/ca.pem' }, remoto)).toBe('ca-adicional-no-permitida')
    expect(bloqueoDeEntorno({}, remoto)).toBeNull()
    expect(bloqueoDeEntorno({ NODE_TLS_REJECT_UNAUTHORIZED: '1' }, remoto)).toBeNull()
    expect(bloqueoDeEntorno(undefined, remoto)).toBeNull()
  })
  it('en loopback no cambia nada (el ensayo local con certificado propio sigue funcionando)', () => {
    expect(bloqueoDeEntorno({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, { origen: 'https://localhost:8802', remoto: false })).toBeNull()
  })
})

describe('tiempo por petición', () => {
  it('predeterminado, acotado entre 1 s y 60 s, y rechaza valores raros', () => {
    expect(tiempoValido(undefined)).toBe(TIEMPO_PREDETERMINADO_MS)
    expect(tiempoValido('5000')).toBe(5000)
    expect(tiempoValido(1000)).toBe(1000)
    expect(tiempoValido(60000)).toBe(60000)
    for (const m of [999, 60001, '0', '-5', '1e3', 'abc', 1.5, '99999999', NaN]) expect(tiempoValido(m), String(m)).toBeNull()
  })
})

describe('transporte: sin redirecciones, un solo origen y tiempo máximo', () => {
  const destino = { origen: ORIGEN_REMOTO_APROBADO, remoto: true }
  it('cada petición lleva redirect:manual y una señal de tiempo; no cambia cabeceras ni cuerpo', async () => {
    const vistas = []
    const t = crearTransporte({ fetch: async (u, init) => { vistas.push({ u, init }); return new Response('{}', { status: 200 }) }, destino })
    await t('https://semabel.com/v1/x', { method: 'POST', headers: { authorization: 'Bearer abc' }, body: '{"a":1}' })
    expect(vistas).toHaveLength(1)
    expect(vistas[0].init).toMatchObject({ method: 'POST', redirect: 'manual', body: '{"a":1}', headers: { authorization: 'Bearer abc' } })
    expect(vistas[0].init.signal).toBeInstanceOf(AbortSignal)
  })
  it('una redirección (301/302/303/307/308) se rechaza y NO se sigue: una sola petición', async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      let n = 0
      const t = crearTransporte({ fetch: async () => { n += 1; return new Response(null, { status, headers: { location: 'https://evil.test/' } }) }, destino })
      await expect(t('https://semabel.com/v1/x', { method: 'POST', headers: { authorization: 'Bearer abc' } })).rejects.toThrow('redireccion-rechazada')
      expect(n).toBe(1)
    }
  })
  it('una dirección de otro origen (incluso con el mismo texto al inicio) se rechaza ANTES de llamar a fetch', async () => {
    let n = 0
    const t = crearTransporte({ fetch: async () => { n += 1; return new Response('{}') }, destino })
    for (const u of ['https://evil.test/v1/x', 'http://semabel.com/v1/x', 'https://semabel.com.evil.test/v1/x', 'https://semabel.com:8443/v1/x', 'https://user@semabel.com@evil.test/', 'nada']) {
      await expect(t(u, {})).rejects.toThrow()
    }
    expect(n).toBe(0)
  })
  it('se agota el tiempo: la petición se aborta y falla (resultado desconocido para quien llama)', async () => {
    const t = crearTransporte({
      fetch: (u, init) => new Promise((_, rechazar) => { init.signal.addEventListener('abort', () => rechazar(new Error('abortada'))) }),
      destino, tiempoMs: 30,
    })
    await expect(t('https://semabel.com/v1/x', {})).rejects.toThrow()
  })
})
