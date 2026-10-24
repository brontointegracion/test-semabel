/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { partidoLiga, reloj, respuestaJuego, respuestaLiga, SERVIDOR_MS } from '../../lib/publico/datos-prueba.js'
import { olvidarMedios } from '../../lib/publico/medios.js'
import { SIN_TABS_COMPARTIDO } from '../../lib/publico/navegacion.js'
import { esDestinoInterno } from '../../lib/volver.js'

// /tv/cancha (REPORT_199): UNA dirección estable que sigue la secuencia explícita de dos partidos FICTICIOS. Servidor falso con estado
// mutable (lo que el árbitro haría con la puntuación se imita cambiando lo que el servidor responde); tiempo simulado. Todo sintético.

const LIGA = 'SIMULACRO-PILOTO'
const A = 'TVTEST-A'
const B = 'TVTEST-B'
const C = 'TVTEST-C'
const FALSOS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance']
const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
const ruta = (g) => `/v1/ligas/${LIGA}/partidos/${g}`
const RUTA_LIGA = `/v1/ligas/${LIGA}/publico`

const E = {
  [A]: { local: { id: 'EA1', nombre: 'Alfa Norte' }, visita: { id: 'EA2', nombre: 'Beta Sur' }, programadoPara: '2026-10-21T13:00:00.000Z' },
  [B]: { local: { id: 'EB1', nombre: 'Gama Este' }, visita: { id: 'EB2', nombre: 'Delta Oeste' }, programadoPara: '2026-10-21T14:00:00.000Z' },
  [C]: { local: { id: 'EC1', nombre: 'Épsilon Sur' }, visita: { id: 'EC2', nombre: 'Zeta Norte' }, programadoPara: '2026-10-21T15:00:00.000Z' },
}
/** Lo que el servidor responde hoy de cada partido (se muta durante la prueba). */
let ahora
let juegos
let llamadas
let retardo = 0
const base = (g, sobre = {}) => respuestaJuego({
  ligaId: LIGA, gameId: g, estado: 'programado', inicio: null, inicioReal: null, programadoPara: E[g].programadoPara, periodo: 1, reloj: { estado: null, restanteMs: null, desdeMs: null },
  local: { ...E[g].local, puntos: 0, faltas: 0 }, visita: { ...E[g].visita, puntos: 0, faltas: 0 }, servidorAhoraMs: ahora, ...sobre,
})
const vivo = (g, sobre = {}) => base(g, { estado: 'vivo', inicio: E[g].programadoPara, inicioReal: E[g].programadoPara, reloj: reloj('corriendo', 300000, ahora - 1000), ...sobre })
const ponerJuego = (g, cuerpo) => { juegos[g] = cuerpo }
function servidor() {
  llamadas = []
  vi.stubGlobal('fetch', vi.fn(async (r, init) => {
    llamadas.push({ ruta: r, metodo: init?.method })
    if (r === RUTA_LIGA) return json(respuestaLiga({ id: LIGA, nombre: 'Simulacro — datos ficticios', partidos: [partidoLiga({ gameId: A }), partidoLiga({ gameId: B }), partidoLiga({ gameId: C })], servidorAhoraMs: ahora }))
    for (const g of [A, B, C]) {
      if (r === ruta(g)) {
        if (retardo > 0) await new Promise((ok) => setTimeout(ok, retardo))
        const c = juegos[g]
        if (c === 404) return json({ error: 'no-encontrado' }, 404)
        if (c === 'red') throw new TypeError('sin red')
        return json({ ...c, servidorAhoraMs: ahora })
      }
    }
    return json({ error: 'no-encontrado' }, 404) // incluye /medios/manifest.json: sin medios configurados
  }))
}
const avanzar = async (ms) => { ahora += ms; await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
let ubicacion
const Espia = () => { ubicacion = useLocation(); return null }
const montar = () => render(<MemoryRouter initialEntries={['/tv/cancha']}><Espia /><AppCompartida /></MemoryRouter>)
const marco = () => document.querySelector('.sb-app')
const textoTv = () => document.querySelector('.sb-tv')?.textContent ?? ''

beforeEach(() => {
  vi.useFakeTimers({ toFake: FALSOS })
  ahora = SERVIDOR_MS
  retardo = 0
  juegos = { [A]: base(A), [B]: base(B), [C]: base(C) }
  olvidarMedios()
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', LIGA)
  vi.stubEnv('VITE_TV_SECUENCIA', `${LIGA}/${A},${LIGA}/${B}`)
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  servidor()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('la secuencia completa en UNA dirección', () => {
  it('por jugar → en vivo → pausa → descanso → final con próximo → siguiente en vivo → último final: la dirección nunca cambia y el marco no se desmonta', async () => {
    montar()
    await avanzar(50)
    // Antes del primero: su información programada y la presentación de patrocinio/promoción (sin patrocinadores propios: Semabel).
    expect(marco().getAttribute('data-vista')).toBe('programado')
    expect(textoTv()).toContain('Alfa Norte')
    expect(textoTv()).toContain('Beta Sur')
    expect(textoTv()).toContain('Por jugar')
    expect(document.querySelector('.sb-header__day').textContent).toBe('Miércoles 21 de octubre · 8:00 a. m. aprox.') // antes de empezar: fecha completa y hora programada estimada (REPORT_228)
    expect(document.querySelector('.sb-sched').textContent).toBe('8:00 a. m.') // la hora grande no cambia
    expect(document.querySelector('.sb-sched-nota').textContent).toBe('Hora estimada')
    expect(document.querySelector('.sb-sched + .sb-sched-nota')).not.toBeNull() // justo debajo de la hora grande
    expect(document.querySelector('.sb-band')).not.toBeNull()
    const elMarco = marco()

    // El árbitro inicia el primero: el servidor lo confirma en vivo (el partido que se espera se lee cada 5 s).
    ponerJuego(A, vivo(A))
    await avanzar(30_000)
    expect(marco().getAttribute('data-vista')).toBe('juego')
    expect(screen.getByLabelText('Reloj del partido').textContent).toMatch(/^0[45]:/)
    expect(screen.getByText('EN VIVO')).toBeTruthy()
    expect(document.querySelector('.sb-header__day').textContent).toBe('Miércoles 21 de octubre') // en juego no se repite la hora programada
    expect(textoTv()).not.toContain('aprox.')
    expect(textoTv()).not.toContain('Hora estimada')

    // Pausa ordinaria: se queda el marcador con «Reloj detenido».
    ponerJuego(A, vivo(A, { reloj: reloj('detenido', 240000) }))
    await avanzar(5_000)
    expect(marco().getAttribute('data-vista')).toBe('juego')
    expect(screen.getByText('Reloj detenido')).toBeTruthy()
    expect(textoTv()).not.toContain('Resultado final')
    expect(textoTv()).not.toContain('aprox.')
    expect(textoTv()).not.toContain('Hora estimada')

    // Final de período confirmado por el servidor (detenido en 00:00): la vista de descanso existente.
    ponerJuego(A, vivo(A, { periodo: 1, reloj: reloj('detenido', 0) }))
    await avanzar(5_000)
    expect(marco().getAttribute('data-vista')).toBe('fin-periodo')
    expect(document.querySelector('.sb-header__day').textContent).toBe('Miércoles 21 de octubre') // tampoco en el descanso
    expect(textoTv()).not.toContain('aprox.')
    expect(textoTv()).not.toContain('Hora estimada')

    // Final del primero con el segundo sin empezar: resultado final + equipos, fecha y hora del siguiente.
    ponerJuego(A, base(A, { estado: 'final', inicioReal: E[A].programadoPara, periodo: 4, reloj: reloj('detenido', 0), local: { ...E[A].local, puntos: 31, faltas: 5 }, visita: { ...E[A].visita, puntos: 28, faltas: 6 } }))
    await avanzar(5_000)
    expect(marco().getAttribute('data-vista')).toBe('final')
    expect(textoTv()).toContain('Resultado final')
    expect(textoTv()).toContain('Próximo partido')
    for (const n of ['Gama Este', 'Delta Oeste']) expect(textoTv()).toContain(n)
    expect(textoTv()).toMatch(/Miércoles 21 de octubre/i)
    expect(textoTv()).toMatch(/9:00 a\. m\./)
    expect(document.querySelector('.sb-next__time').textContent).toBe('9:00 a. m.') // la hora grande del próximo no cambia
    expect(document.querySelector('.sb-next__time + .sb-next__aprox').textContent).toBe('aprox.') // REPORT_228
    expect(document.querySelector('.sb-header__day').textContent).toBe('Miércoles 21 de octubre · 8:00 a. m.') // el final conserva su encabezado (sin «aprox.»)
    expect(textoTv()).not.toContain('Hora estimada')
    expect(textoTv()).not.toContain('Sesión completada')
    expect(document.querySelector('.sb-stage')).not.toBeNull() // la rotación grande de patrocinio/promoción

    // El árbitro inicia el segundo y el servidor lo confirma: la pantalla cambia sola, en la MISMA dirección y el MISMO marco.
    ponerJuego(B, vivo(B))
    await avanzar(30_000)
    expect(marco().getAttribute('data-vista')).toBe('juego')
    expect(textoTv()).toContain('Gama Este')
    expect(textoTv()).not.toContain('Alfa Norte')
    expect(ubicacion.pathname).toBe('/tv/cancha')
    expect(marco()).toBe(elMarco)

    // Termina el último: se conserva su resultado y se dice, sin inventar nada, que la sesión terminó.
    ponerJuego(B, base(B, { estado: 'final', inicioReal: E[B].programadoPara, periodo: 4, reloj: reloj('detenido', 0), local: { ...E[B].local, puntos: 40, faltas: 2 }, visita: { ...E[B].visita, puntos: 22, faltas: 3 } }))
    await avanzar(5_000)
    expect(marco().getAttribute('data-vista')).toBe('final')
    expect(textoTv()).toContain('Resultado final')
    expect(textoTv()).toContain('Gama Este')
    expect(textoTv()).toContain('Sesión completada')
    expect(textoTv()).toContain('Este fue el último partido de esta transmisión.')
    expect(textoTv()).not.toContain('Próximo partido')
    expect(ubicacion.pathname).toBe('/tv/cancha')
  })

  it('el final del último periodo sin partido final sigue siendo «fin de tiempo», no un resultado', async () => {
    ponerJuego(A, vivo(A, { periodo: 4, reloj: reloj('detenido', 0) }))
    montar()
    await avanzar(50)
    expect(marco().getAttribute('data-vista')).toBe('fin-tiempo')
    expect(textoTv()).not.toContain('Resultado final')
  })
})

describe('reconstrucción al recargar', () => {
  it('recargar en mitad del segundo partido muestra el segundo enseguida, desde el estado del servidor', async () => {
    ponerJuego(A, base(A, { estado: 'final', inicioReal: E[A].programadoPara, periodo: 4, reloj: reloj('detenido', 0) }))
    ponerJuego(B, vivo(B))
    const r = montar()
    await avanzar(50)
    expect(textoTv()).toContain('Gama Este')
    r.unmount()
    cleanup()
    montar()
    await avanzar(50)
    expect(textoTv()).toContain('Gama Este')
    expect(marco().getAttribute('data-vista')).toBe('juego')
  })
  it('recargar con el primero ya final y el segundo por jugar vuelve al final con el próximo', async () => {
    ponerJuego(A, base(A, { estado: 'final', inicioReal: E[A].programadoPara, periodo: 4, reloj: reloj('detenido', 0) }))
    montar()
    await avanzar(50)
    expect(textoTv()).toContain('Resultado final')
    expect(textoTv()).toContain('Delta Oeste')
  })
})

describe('reconocimiento de canastas: nunca se repite el pasado', () => {
  const canasta = (seq, nombre, lado = 'local') => ({ seq, lado, puntos: 2, jugador: { nombre, dorsalActual: 7 } })

  it('un partido que ya tiene canastas al aparecer (cambio de partido, recarga) no las anuncia; una nueva sí', async () => {
    ponerJuego(A, vivo(A, { anotaciones: [canasta(1, 'Ana Vieja')] }))
    montar()
    await avanzar(50)
    expect(document.querySelector('.sb-notice')).toBeNull() // primera lectura: línea base
    ponerJuego(A, vivo(A, { anotaciones: [canasta(1, 'Ana Vieja'), canasta(2, 'Ana Nueva')] }))
    await avanzar(5_000)
    expect(document.querySelector('.sb-notice')?.textContent).toContain('Ana Nueva')

    // El primero termina y el segundo ya trae canastas cuando el servidor lo confirma en vivo: NO se anuncian al cambiar.
    ponerJuego(A, base(A, { estado: 'final', inicioReal: E[A].programadoPara, periodo: 4, reloj: reloj('detenido', 0) }))
    await avanzar(5_000)
    ponerJuego(B, vivo(B, { anotaciones: [canasta(1, 'Beto Viejo', 'visita'), canasta(2, 'Beto Viejo', 'visita')] }))
    await avanzar(30_000)
    expect(textoTv()).toContain('Gama Este')
    expect(document.querySelector('.sb-notice')).toBeNull()
    expect(textoTv()).not.toContain('Beto Viejo')
    // …y una canasta realmente nueva del segundo sí.
    ponerJuego(B, vivo(B, { anotaciones: [canasta(1, 'Beto Viejo', 'visita'), canasta(2, 'Beto Viejo', 'visita'), canasta(3, 'Gina Nueva')] }))
    await avanzar(5_000)
    expect(document.querySelector('.sb-notice')?.textContent).toContain('Gina Nueva')
  })

  it('tras un fallo de lectura y la reconexión, lo ocurrido mientras tanto no se anuncia', async () => {
    ponerJuego(A, vivo(A, { anotaciones: [canasta(1, 'Ana Vieja')] }))
    montar()
    await avanzar(50)
    ponerJuego(A, 'red')
    await avanzar(5_000)
    ponerJuego(A, vivo(A, { anotaciones: [canasta(1, 'Ana Vieja'), canasta(2, 'Se Perdio')] }))
    await avanzar(30_000)
    expect(document.querySelector('.sb-notice')).toBeNull()
  })
})

describe('ambigüedad y fallos', () => {
  it('dos partidos en vivo: estado de conflicto explícito, con enlaces a cada marcador fijo; no se elige ni se alterna', async () => {
    ponerJuego(A, vivo(A))
    ponerJuego(B, vivo(B))
    montar()
    await avanzar(50)
    expect(screen.getByText('Más de un partido en vivo')).toBeTruthy()
    const enlaces = [...document.querySelectorAll('.sb-tv-mensaje__lista a')]
    expect(enlaces.map((a) => a.getAttribute('href'))).toEqual([`/liga/${LIGA}/partido/${A}`, `/liga/${LIGA}/partido/${B}`])
    expect(textoTv()).toContain('Alfa Norte')
    expect(textoTv()).toContain('Gama Este')
    expect(document.querySelector('.sb-layout')).toBeNull()
    await avanzar(30_000)
    expect(screen.getByText('Más de un partido en vivo')).toBeTruthy() // no cicla
    // Cuando uno termina, la ambigüedad se resuelve sola.
    ponerJuego(A, base(A, { estado: 'final', inicioReal: E[A].programadoPara, periodo: 4, reloj: reloj('detenido', 0) }))
    await avanzar(5_000)
    expect(screen.queryByText('Más de un partido en vivo')).toBeNull()
    expect(textoTv()).toContain('Gama Este')
  })

  it('un partido de la secuencia que el servidor no encuentra se dice: no es una agenda vacía ni se ignora', async () => {
    ponerJuego(B, 404)
    montar()
    await avanzar(50)
    expect(screen.getByText('Partido no encontrado')).toBeTruthy()
    expect(textoTv()).toContain(`Partido 2: ${B}`)
    expect(document.querySelector('.sb-layout')).toBeNull()
  })

  it('con todas las lecturas fallidas: «Sin conexión», no una pantalla vacía', async () => {
    ponerJuego(A, 'red')
    ponerJuego(B, 'red')
    montar()
    await avanzar(20_000)
    expect(screen.getByText('Sin conexión con el servidor')).toBeTruthy()
  })

  it('al perder la conexión se conserva la última vista confirmada con «Sin actualizar» y NO se avanza', async () => {
    ponerJuego(A, vivo(A))
    montar()
    await avanzar(50)
    expect(marco().getAttribute('data-vista')).toBe('juego')
    // Se cae la red; mientras, el servidor ya habría terminado el primero y empezado el segundo, pero eso NO se sabe.
    ponerJuego(A, 'red')
    ponerJuego(B, 'red')
    await avanzar(40_000)
    expect(marco().getAttribute('data-vista')).toBe('juego')
    expect(textoTv()).toContain('Alfa Norte')
    expect(textoTv()).not.toContain('Gama Este')
    expect(document.querySelector('.sb-stale')?.textContent).toMatch(/Sin actualizar/)
    // Vuelve la red con el estado nuevo: ahora sí se avanza.
    ponerJuego(A, base(A, { estado: 'final', inicioReal: E[A].programadoPara, periodo: 4, reloj: reloj('detenido', 0) }))
    ponerJuego(B, vivo(B))
    await avanzar(70_000)
    expect(textoTv()).toContain('Gama Este')
    expect(document.querySelector('.sb-stale')).toBeNull()
  })

  it('si solo falla la lectura del SIGUIENTE, el final del actual sigue y se avisa; el próximo no se inventa', async () => {
    ponerJuego(A, base(A, { estado: 'final', inicioReal: E[A].programadoPara, periodo: 4, reloj: reloj('detenido', 0) }))
    ponerJuego(B, 'red')
    montar()
    await avanzar(20_000)
    expect(marco().getAttribute('data-vista')).toBe('final')
    expect(textoTv()).toContain('Resultado final')
    expect(textoTv()).not.toContain('Delta Oeste')
    expect(textoTv()).toContain('La información del próximo partido no está disponible por ahora.')
    expect(textoTv()).not.toContain('Sesión completada')
    expect(document.querySelector('.sb-stale')?.textContent).toMatch(/Sin actualizar/)
  })
})

describe('configuración', () => {
  it.each([
    ['', 'Transmisión no configurada'],
    ['SIMULACRO-PILOTO/TVTEST-A,SIMULACRO-PILOTO/TVTEST-A', 'Configuración no válida'],
    ['LIGA-AJENA/TVTEST-A', 'Configuración no válida'],
  ])('«%s» → %s, y no se pide ninguna lectura de partido', async (valor, titulo) => {
    vi.stubEnv('VITE_TV_SECUENCIA', valor)
    montar()
    await avanzar(50)
    expect(screen.getByText(titulo)).toBeTruthy()
    expect(llamadas.filter((c) => c.ruta.startsWith('/v1/'))).toEqual([])
  })
})

describe('solo lee, y sin lecturas de más', () => {
  it('abrir la pantalla y recorrer toda la secuencia solo hace GET a lecturas públicas conocidas (ninguna mutación, ningún privado)', async () => {
    montar()
    await avanzar(50)
    ponerJuego(A, vivo(A))
    await avanzar(30_000)
    ponerJuego(A, base(A, { estado: 'final', inicioReal: E[A].programadoPara, periodo: 4, reloj: reloj('detenido', 0) }))
    ponerJuego(B, vivo(B))
    await avanzar(35_000)
    const permitidas = new Set([RUTA_LIGA, ruta(A), ruta(B), '/medios/manifest.json'])
    expect(llamadas.length).toBeGreaterThan(4)
    for (const c of llamadas) {
      expect(c.metodo).toBe('GET')
      expect(permitidas.has(c.ruta)).toBe(true)
    }
  })

  it('una sola suscripción por partido: el que se muestra no duplica su lectura (≈ una cada 5 s en vivo)', async () => {
    ponerJuego(A, vivo(A))
    ponerJuego(B, base(B))
    montar()
    await avanzar(50)
    const antes = llamadas.filter((c) => c.ruta === ruta(A)).length
    await avanzar(30_000)
    const enVivo = llamadas.filter((c) => c.ruta === ruta(A)).length - antes
    expect(enVivo).toBeGreaterThanOrEqual(5)
    expect(enVivo).toBeLessThanOrEqual(7)
    // El siguiente (el que se espera) también se lee cada 5 s (REPORT_201); la liga, una por minuto como máximo.
    expect(llamadas.filter((c) => c.ruta === ruta(B)).length).toBeLessThanOrEqual(8)
    expect(llamadas.filter((c) => c.ruta === RUTA_LIGA).length).toBeLessThanOrEqual(2)
  })
})

describe('la entrada /tv y las direcciones fijas siguen funcionando', () => {
  it('/tv/cancha va sin barra de pestañas y es un origen válido de «Salir»; /tv sigue igual', () => {
    expect(SIN_TABS_COMPARTIDO.some((r) => r.test('/tv/cancha'))).toBe(true)
    expect(SIN_TABS_COMPARTIDO.some((r) => r.test('/tv'))).toBe(true)
    expect(SIN_TABS_COMPARTIDO.some((r) => r.test('/tv/otra'))).toBe(false)
    expect(esDestinoInterno('/tv/cancha')).toBe(true)
    expect(esDestinoInterno('/tv')).toBe(true)
  })
  it('/tv ofrece el enlace a la transmisión solo si la compilación la configura, y la lista de partidos sigue ahí', async () => {
    const r = render(<MemoryRouter initialEntries={['/tv']}><Espia /><AppCompartida /></MemoryRouter>)
    await avanzar(50)
    expect(screen.getByRole('link', { name: /transmisión de la cancha/ }).getAttribute('href')).toBe('/tv/cancha')
    expect(screen.getByRole('heading', { name: 'Partidos en TV' })).toBeTruthy()
    r.unmount()
    vi.stubEnv('VITE_TV_SECUENCIA', '')
    render(<MemoryRouter initialEntries={['/tv']}><Espia /><AppCompartida /></MemoryRouter>)
    await avanzar(50)
    expect(screen.queryByRole('link', { name: /transmisión de la cancha/ })).toBeNull()
  })
  it('un partido fijo (/liga/…/partido/…) sigue mostrando su marcador con la misma vista', async () => {
    ponerJuego(A, vivo(A))
    render(<MemoryRouter initialEntries={[`/liga/${LIGA}/partido/${A}`]}><Espia /><AppCompartida /></MemoryRouter>)
    await avanzar(50)
    expect(marco().getAttribute('data-vista')).toBe('juego')
    expect(textoTv()).toContain('Alfa Norte')
  })
})

describe('cadencia del partido que se espera (REPORT_201)', () => {
  const secuencia3 = () => vi.stubEnv('VITE_TV_SECUENCIA', `${LIGA}/${A},${LIGA}/${B},${LIGA}/${C}`)
  const lecturas = (g, desde = 0) => llamadas.slice(desde).filter((c) => c.ruta === ruta(g)).length
  const final = (g) => base(g, { estado: 'final', inicioReal: E[g].programadoPara, periodo: 4, reloj: reloj('detenido', 0) })

  it('con el primero en juego: el siguiente se lee cada 5 s y el tercero (futuro) sigue a 30 s; la liga, una por minuto', async () => {
    secuencia3()
    ponerJuego(A, vivo(A))
    montar()
    await avanzar(50)
    const n0 = llamadas.length
    await avanzar(60_000)
    const t = (g) => lecturas(g, n0)
    expect(t(A)).toBeGreaterThanOrEqual(11); expect(t(A)).toBeLessThanOrEqual(13)
    expect(t(B)).toBeGreaterThanOrEqual(11); expect(t(B)).toBeLessThanOrEqual(13) // ≈ 12 por minuto
    expect(t(C)).toBeLessThanOrEqual(3) // ≈ 2 por minuto: no hay lectura rápida de todos los futuros
    expect(llamadas.slice(n0).filter((c) => c.ruta === RUTA_LIGA).length).toBeLessThanOrEqual(2)
  })

  it('antes de empezar: solo el primero va a 5 s (es el que se espera); los demás a 30 s', async () => {
    secuencia3()
    montar()
    await avanzar(50)
    const n0 = llamadas.length
    await avanzar(60_000)
    expect(lecturas(A, n0)).toBeGreaterThanOrEqual(11)
    expect(lecturas(B, n0)).toBeLessThanOrEqual(3)
    expect(lecturas(C, n0)).toBeLessThanOrEqual(3)
  })

  it('el cambio al siguiente partido se detecta en unos 5 s (no 30): la pantalla cambia sin recargar', async () => {
    ponerJuego(A, vivo(A))
    montar()
    await avanzar(50)
    ponerJuego(A, final(A))
    await avanzar(6_000)
    expect(marco().getAttribute('data-vista')).toBe('final')
    ponerJuego(B, vivo(B)) // el servidor confirma el segundo
    await avanzar(6_000)
    expect(textoTv()).toContain('Gama Este')
    expect(marco().getAttribute('data-vista')).toBe('juego')
    expect(textoTv()).not.toContain('Sesión completada')
  })

  it('cuando el partido esperado cambia (el primero arranca), el siguiente pasa a 5 s sin esperar su temporizador de 30 s', async () => {
    secuencia3()
    montar()
    await avanzar(50)
    await avanzar(20_000) // B y C llevan 20 s de su espera de 30 s
    const n0 = llamadas.length
    ponerJuego(A, vivo(A))
    await avanzar(10_000) // A se detecta en vivo en ≤5 s → B es ahora el esperado
    expect(lecturas(B, n0)).toBeGreaterThanOrEqual(2) // lee ya (sin esperar su temporizador de 30 s) y luego cada 5 s; sin el ajuste habría una sola, a los 30 s
    expect(lecturas(B, n0)).toBeLessThanOrEqual(3)
    expect(lecturas(C, n0)).toBeLessThanOrEqual(1)
  })

  it('un partido esperado que falla NO se reintenta a toda prisa: retroceso, y la pantalla no avanza', async () => {
    ponerJuego(A, final(A))
    ponerJuego(B, 'red')
    montar()
    await avanzar(50)
    const n0 = llamadas.length
    await avanzar(30_000)
    expect(lecturas(B, n0)).toBeLessThanOrEqual(4) // retroceso exponencial (5, 10, 20 s…), no 6 lecturas por 30 s
    expect(marco().getAttribute('data-vista')).toBe('final')
    expect(textoTv()).not.toContain('Sesión completada')
  })

  it('nunca dos lecturas del mismo partido a la vez, aunque el servidor tarde más que el periodo', async () => {
    retardo = 7_000
    ponerJuego(A, vivo(A))
    const enVuelo = { A: 0, B: 0 }; let maximo = 0
    const f = fetch
    vi.stubGlobal('fetch', vi.fn(async (r, i) => {
      const k = r === ruta(A) ? 'A' : r === ruta(B) ? 'B' : null
      if (k) { enVuelo[k] += 1; maximo = Math.max(maximo, enVuelo[k]) }
      try { return await f(r, i) } finally { if (k) enVuelo[k] -= 1 }
    }))
    montar()
    await avanzar(60_000)
    expect(maximo).toBe(1)
  })

  it('con la pestaña oculta no se lee nada; al volver, se retoma', async () => {
    ponerJuego(A, vivo(A))
    montar()
    await avanzar(50)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    const n0 = llamadas.length
    await avanzar(60_000)
    expect(llamadas.length - n0).toBe(0)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await avanzar(6_000)
    expect(llamadas.length - n0).toBeGreaterThan(0)
  })

  it('al salir de la pantalla se cancela todo: ninguna lectura después', async () => {
    secuencia3()
    ponerJuego(A, vivo(A))
    const r = montar()
    await avanzar(10_000)
    r.unmount()
    const n0 = llamadas.length
    await avanzar(120_000)
    expect(llamadas.length - n0).toBe(0)
  })

  it('sigue siendo de solo lectura: todas las peticiones son GET a lecturas públicas', async () => {
    secuencia3()
    ponerJuego(A, vivo(A))
    montar()
    await avanzar(30_000)
    for (const c of llamadas) expect(c.metodo).toBe('GET')
  })
})

describe('fecha del encabezado (REPORT_201)', () => {
  it('nombres completos en español, en Panamá, y la frontera de medianoche usa la fecha de Panamá, no la UTC', async () => {
    const { fechaLargaPanama } = await import('../../lib/publico/formato.js')
    expect(fechaLargaPanama('2026-10-21T13:00:00.000Z')).toBe('Miércoles 21 de octubre')
    expect(fechaLargaPanama('2026-10-22T04:59:00.000Z')).toBe('Miércoles 21 de octubre') // 23:59 del 21 en Panamá, ya 22 en UTC
    expect(fechaLargaPanama('2026-10-22T05:00:00.000Z')).toBe('Jueves 22 de octubre') // 00:00 del 22 en Panamá
    expect(fechaLargaPanama('2026-12-31T23:30:00.000Z')).toBe('Jueves 31 de diciembre')
    expect(fechaLargaPanama('2026-01-01T02:00:00.000Z')).toBe('Miércoles 31 de diciembre') // aún 2025 en Panamá
    expect(fechaLargaPanama('no es fecha')).toBeNull()
    expect(fechaLargaPanama(null)).toBeNull()
  })
  it('hora programada solo antes de empezar (y en el final); en juego, pausas y descansos no; sin fecha, honesto', async () => {
    const { fechaDeEncabezado } = await import('./PantallaMarcador.jsx')
    const P = '2026-10-21T13:00:00.000Z'
    expect(fechaDeEncabezado({ estado: 'programado', programadoPara: P, inicioReal: null })).toBe('Miércoles 21 de octubre · 8:00 a. m. aprox.')
    expect(fechaDeEncabezado({ estado: 'vivo', programadoPara: P, inicioReal: P })).toBe('Miércoles 21 de octubre')
    expect(fechaDeEncabezado({ estado: 'final', programadoPara: P, inicioReal: P })).toBe('Miércoles 21 de octubre · 8:00 a. m.')
    expect(fechaDeEncabezado({ estado: 'programado', programadoPara: null, inicioReal: null })).toBe('Fecha por confirmar')
    expect(fechaDeEncabezado({ estado: 'vivo', programadoPara: null, inicioReal: P })).toBe('Miércoles 21 de octubre')
    expect(fechaDeEncabezado({ estado: 'vivo', programadoPara: null, inicioReal: null })).toBeNull()
  })
})

describe('hora estimada (REPORT_228)', () => {
  it('sin hora programada: «Fecha por confirmar», «—» y ningún «aprox.» ni «Hora estimada»', async () => {
    ponerJuego(A, base(A, { programadoPara: null }))
    montar()
    await avanzar(1_000)
    expect(document.querySelector('.sb-header__day').textContent).toBe('Fecha por confirmar')
    expect(document.querySelector('.sb-sched').textContent).toBe('—')
    expect(textoTv()).not.toContain('aprox.')
    expect(textoTv()).not.toContain('Hora estimada')
  })
  it('el próximo sin hora sigue en «Por confirmar» sin «aprox.»; el final conserva su presentación', async () => {
    ponerJuego(A, base(A, { estado: 'final', inicioReal: E[A].programadoPara, periodo: 4, reloj: reloj('detenido', 0), local: { ...E[A].local, puntos: 31, faltas: 5 }, visita: { ...E[A].visita, puntos: 28, faltas: 6 } }))
    ponerJuego(B, base(B, { programadoPara: null }))
    montar()
    await avanzar(5_000)
    expect(textoTv()).toContain('Próximo partido')
    expect(textoTv()).toContain('Por confirmar')
    expect(document.querySelector('.sb-next__time').textContent).toBe('—')
    expect(document.querySelector('.sb-next__aprox')).toBeNull()
    expect(textoTv()).not.toContain('aprox.')
  })
})
