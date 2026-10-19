import { afterEach, describe, expect, it, vi } from 'vitest'
import { copiarTexto, esOrigenLoopback, mensajeDePartido, mensajeInvitacion, urlActivacion, urlPublicaDePartido, urlWhatsApp } from './compartir.js'

const RUTA = '/liga/platinium-u10/partido/cross-level-vs-deportivo-s0rqrd'
const BASE = { liga: 'Liga Sintética', local: 'Alfa Norte', visita: 'Beta Sur' }

describe('urlPublicaDePartido', () => {
  it('usa el origen ACTUAL (nada fijo) y solo la dirección pública canónica del partido', () => {
    expect(urlPublicaDePartido('https://localhost:8802', RUTA)).toBe(`https://localhost:8802${RUTA}`)
    expect(urlPublicaDePartido('https://otro.ejemplo', RUTA)).toBe(`https://otro.ejemplo${RUTA}`)
    expect(urlPublicaDePartido('http://localhost:3000/ruta?x=1#y', RUTA)).toBe(`http://localhost:3000${RUTA}`) // solo el origen
  })
  it('rechaza rutas privadas o que no son de partido, y orígenes no http(s)', () => {
    for (const r of ['/organizador/ligas/L/partidos/g', '/control/L/g', '/control/L/g/marcador', '/liga/x', '/liga/x/equipo/y', '/liga/x/partido/y?codigo=1', '/liga/x/partido/y#z', '/liga/x/partido/y/z', '//evil.example/liga/x/partido/y', undefined, 5]) {
      expect(urlPublicaDePartido('https://localhost:8802', r), String(r)).toBeNull()
    }
    for (const o of ['javascript:alert(1)', 'ftp://x', '', 'no es url', undefined]) expect(urlPublicaDePartido(o, RUTA), String(o)).toBeNull()
  })
  it('la dirección no lleva fecha ni credenciales', () => {
    const u = urlPublicaDePartido('https://localhost:8802', RUTA)
    expect(u).not.toMatch(/\d{4}-\d{2}-\d{2}|token|codigo|code|\?|#/i)
  })
})

describe('mensajeDePartido', () => {
  const url = `https://localhost:8802${RUTA}`
  it('programado con fecha: liga, equipos, fecha y hora de Panamá en 12 horas, sede y enlace', () => {
    const m = mensajeDePartido({ ...BASE, estado: 'programado', programadoPara: '2026-11-01T21:30:00.000Z', sede: 'Cancha A' }, url)
    expect(m).toContain('Liga Sintética')
    expect(m).toContain('Alfa Norte vs Beta Sur')
    expect(m).toContain('dom 1 nov, 4:30 p. m. (hora de Panamá)') // 21:30Z = 16:30 en Panamá
    expect(m).toContain('Sede: Cancha A')
    expect(m.endsWith(url)).toBe(true)
    expect(m).not.toMatch(/En vivo|Resultado final/)
  })
  it('sin fecha: lo dice; sin sede: «Por avisar»', () => {
    const m = mensajeDePartido({ ...BASE, estado: 'programado', programadoPara: null, sede: null }, url)
    expect(m).toContain('Fecha y hora por confirmar')
    expect(m).toContain('Sede: Por avisar')
    expect(m).not.toMatch(/Invalid|NaN|undefined|null/)
  })
  it('en vivo: no se presenta como próximo (ni fecha futura ni «Fecha y hora por confirmar») y no incluye un marcador que quedaría viejo', () => {
    const m = mensajeDePartido({ ...BASE, estado: 'vivo', programadoPara: '2026-11-01T21:30:00.000Z', inicioReal: '2026-11-01T21:35:00.000Z', sede: null, puntosLocal: 12, puntosVisita: 9 }, url)
    expect(m).toContain('En vivo ahora.')
    expect(m).toContain('Sigue el marcador:')
    expect(m).not.toContain('por confirmar')
    expect(m).not.toContain('12–9')
    expect(m).not.toMatch(/Por avisar/) // la sede ausente de un partido ya iniciado no se anuncia como «por avisar»
  })
  it('terminado: resultado final; sin puntos conocidos, «Partido terminado» sin inventar un marcador', () => {
    const m = mensajeDePartido({ ...BASE, estado: 'final', programadoPara: '2026-11-01T21:30:00.000Z', puntosLocal: 31, puntosVisita: 28 }, url)
    expect(m).toContain('Alfa Norte 31–28 Beta Sur')
    expect(m).toContain('Resultado final.')
    expect(m).not.toMatch(/próximo|por confirmar|En vivo/)
    const sin = mensajeDePartido({ ...BASE, estado: 'final' }, url)
    expect(sin).toContain('Partido terminado.')
    expect(sin).not.toMatch(/\d+–\d+/)
  })
  it('solo datos públicos: el texto no puede contener nada más que lo recibido', () => {
    const m = mensajeDePartido({ ...BASE, estado: 'programado', programadoPara: null, codigo: 'ZZ-SECRETO', token: 'abc', jugadores: ['Ana'] }, url)
    expect(m).not.toMatch(/ZZ-SECRETO|abc|Ana|organizador|control|activ/i)
  })
})

describe('urlWhatsApp', () => {
  it('abre el redactor con el texto codificado (no envía nada) y el enlace íntegro dentro', () => {
    const texto = 'Alfa vs Beta\nhttps://localhost:8802/liga/x/partido/y-abc123'
    const w = urlWhatsApp(texto)
    expect(w.startsWith('https://wa.me/?text=')).toBe(true)
    expect(decodeURIComponent(w.slice('https://wa.me/?text='.length))).toBe(texto)
  })
})

describe('invitación de activación (REPORT_182)', () => {
  it('urlActivacion: origen ACTUAL + /control/<liga>/<partido>, sin código, token, búsqueda ni fragmento', () => {
    expect(urlActivacion('https://localhost:8802', 'SINTETICA-173', 'g3-azules-verdes')).toBe('https://localhost:8802/control/SINTETICA-173/g3-azules-verdes')
    expect(urlActivacion('https://otro.ejemplo/ruta?x=1#y', 'L1', 'g1')).toBe('https://otro.ejemplo/control/L1/g1')
    expect(urlActivacion('http://localhost:3000', 'L1', 'g1')).not.toMatch(/\?|#|token|codigo/i)
  })
  it('rechaza identificadores o orígenes dudosos (nunca arma una dirección que pueda llevar otra cosa)', () => {
    for (const [l, g] of [['', 'g'], ['L', ''], ['../x', 'g'], ['L', 'g/marcador'], ['L', 'g?c=1'], ['L', 'g#x'], ['L L', 'g'], [undefined, 'g'], ['L', 7]]) expect(urlActivacion('https://x.test', l, g), `${l}/${g}`).toBeNull()
    for (const o of ['javascript:alert(1)', 'ftp://x', '', 'no es url', undefined]) expect(urlActivacion(o, 'L', 'g'), String(o)).toBeNull()
  })
  it('mensajeInvitacion: equipos, enlace y la aclaración de que el código va aparte; no tiene dónde llevar un código', () => {
    const url = 'https://localhost:8802/control/L1/g1'
    const m = mensajeInvitacion({ local: 'Alfa Norte', visita: 'Beta Sur', codigo: 'ZZ-SECRETO-0000', token: 'abc' }, url)
    expect(m).toContain('Alfa Norte vs Beta Sur')
    expect(m).toContain(url)
    expect(m).toContain('El código te lo da el organizador por separado')
    expect(m).toContain('Activar el teléfono no comienza el partido')
    expect(m).not.toMatch(/ZZ-SECRETO|abc|organizador\/|sesi[oó]n/i)
    expect(m).not.toMatch(/\/liga\//) // no es el marcador público
  })
  it('esOrigenLoopback: localhost, 127.x y ::1 sí; una dirección alcanzable no', () => {
    for (const o of ['https://localhost:8802', 'http://127.0.0.1:3000', 'http://127.1.2.3', 'http://[::1]:8000', 'http://app.localhost']) expect(esOrigenLoopback(o), o).toBe(true)
    for (const o of ['https://semabel.example', 'http://192.168.1.20:8802', 'http://10.0.0.5', 'no es url', undefined]) expect(esOrigenLoopback(o), String(o)).toBe(false)
  })
})

describe('copiarTexto', () => {
  const orig = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  afterEach(() => { if (orig) Object.defineProperty(navigator, 'clipboard', orig); else delete navigator.clipboard })
  it('true solo si el navegador confirma; false si lo niega o no existe; copia EXACTAMENTE el texto', async () => {
    const escribir = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escribir }, configurable: true })
    expect(await copiarTexto('texto exacto')).toBe(true)
    expect(escribir).toHaveBeenCalledWith('texto exacto')
    escribir.mockRejectedValueOnce(new Error('denegado'))
    expect(await copiarTexto('x')).toBe(false)
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    expect(await copiarTexto('x')).toBe(false)
  })
})
