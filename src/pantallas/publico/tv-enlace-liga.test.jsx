/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { MarcoPantalla } from './PantallaMarcador.jsx'
import { partidoLiga, reloj, respuestaJuego, respuestaLiga, SERVIDOR_MS } from '../../lib/publico/datos-prueba.js'
import { olvidarMedios } from '../../lib/publico/medios.js'

// REPORT_226: «Ver estadísticas de la liga» en la barra de /tv/cancha. Datos SINTÉTICOS con la forma de los ids reales; servidor falso, tiempo simulado.

const U10 = 'PLATINIUM-U10'
const U12 = 'PLATINIUM-U12'
const A = `${U10}-20261024-UNITY-BASKETBALL-VS-VIP`
const B = `${U12}-20261024-UNITY-BASKETBALL-VS-DEPORTIVO-VIP`
const LIGA_DE = { [A]: U10, [B]: U12 }
const FALSOS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance']
const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
const E = {
  [A]: { local: { id: 'A1', nombre: 'Unity Basketball' }, visita: { id: 'A2', nombre: 'VIP' }, programadoPara: '2026-10-25T00:00:00.000Z' },
  [B]: { local: { id: 'B1', nombre: 'Unity Basketball' }, visita: { id: 'B2', nombre: 'Deportivo VIP' }, programadoPara: '2026-10-25T00:50:00.000Z' },
}
let ahora
let juegos
let llamadas
const base = (g, sobre = {}) => respuestaJuego({
  ligaId: LIGA_DE[g], gameId: g, estado: 'programado', inicio: null, inicioReal: null, programadoPara: E[g].programadoPara, periodo: 1, reloj: { estado: null, restanteMs: null, desdeMs: null },
  local: { ...E[g].local, puntos: 0, faltas: 0 }, visita: { ...E[g].visita, puntos: 0, faltas: 0 }, servidorAhoraMs: ahora, ...sobre,
})
const vivo = (g) => base(g, { estado: 'vivo', inicio: E[g].programadoPara, inicioReal: E[g].programadoPara, reloj: reloj('corriendo', 300000, ahora - 1000) })
const final = (g) => base(g, { estado: 'final', inicioReal: E[g].programadoPara, periodo: 4, reloj: reloj('detenido', 0), local: { ...E[g].local, puntos: 30, faltas: 2 }, visita: { ...E[g].visita, puntos: 20, faltas: 3 } })
function servidor() {
  llamadas = []
  vi.stubGlobal('fetch', vi.fn(async (r, init) => {
    llamadas.push({ ruta: r, metodo: init?.method })
    for (const l of [U10, U12]) if (r === `/v1/ligas/${l}/publico`) return json(respuestaLiga({ id: l, nombre: `Platinum ${l.slice(-3)} 2026`, partidos: [partidoLiga({ gameId: l === U10 ? A : B })], servidorAhoraMs: ahora }))
    for (const g of [A, B]) {
      if (r === `/v1/ligas/${LIGA_DE[g]}/partidos/${g}`) {
        const c = juegos[g]
        if (c === 404) return json({ error: 'no-encontrado' }, 404)
        if (c === 'red') throw new TypeError('sin red')
        return json({ ...c, servidorAhoraMs: ahora })
      }
    }
    return json({ error: 'no-encontrado' }, 404)
  }))
}
const avanzar = async (ms) => { ahora += ms; await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const montar = () => render(<MemoryRouter initialEntries={['/tv/cancha']}><AppCompartida /></MemoryRouter>)
const marco = () => document.querySelector('.sb-app')
const enlace = () => document.querySelector('.sb-toolbar a[data-enlace="estadisticas-liga"]')

beforeEach(() => {
  vi.useFakeTimers({ toFake: FALSOS })
  ahora = SERVIDOR_MS
  juegos = { [A]: base(A), [B]: base(B) }
  olvidarMedios()
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', `${U10},${U12}`)
  vi.stubEnv('VITE_TV_SECUENCIA', `${U10}/${A},${U12}/${B}`)
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  servidor()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('«Ver estadísticas de la liga» en /tv/cancha', () => {
  it('junto a «Inicio», a la liga del partido mostrado (platinum-u10), en otra pestaña y anunciado como tal', async () => {
    montar()
    await avanzar(50)
    const a = enlace()
    expect(a).not.toBeNull()
    expect(a.textContent).toContain('Ver estadísticas de la liga')
    expect(a.getAttribute('href')).toBe('/liga/platinum-u10') // la página de liga existente; sin pestaña inventada
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.getAttribute('aria-label')).toBe('Ver estadísticas de la liga (se abre en otra pestaña)')
    expect(a.previousElementSibling.textContent).toBe('‹ Inicio') // al lado de «Inicio»
  })

  it('sigue la liga del partido mostrado: U10 → resultado final con el próximo (U10) → U12 en vivo (U12) → último resultado con la sesión completa (U12), con el MISMO marco', async () => {
    montar()
    await avanzar(50)
    const elMarco = marco()
    expect(enlace().getAttribute('href')).toBe('/liga/platinum-u10')
    juegos[A] = vivo(A)
    await avanzar(30_000)
    expect(enlace().getAttribute('href')).toBe('/liga/platinum-u10')
    // Resultado final del primero con el próximo (de OTRA liga) en vista previa: el enlace es el de la liga del RESULTADO mostrado.
    juegos[A] = final(A)
    await avanzar(5_000)
    expect(marco().getAttribute('data-vista')).toBe('final')
    expect(document.querySelector('.sb-tv').textContent).toContain('Próximo partido')
    expect(enlace().getAttribute('href')).toBe('/liga/platinum-u10')
    // El segundo (U12) arranca: la pantalla cambia sola y el enlace cambia de liga sin desmontar el marco.
    juegos[B] = vivo(B)
    await avanzar(30_000)
    expect(document.querySelector('.sb-tv').textContent).toContain('Deportivo VIP')
    expect(enlace().getAttribute('href')).toBe('/liga/platinum-u12')
    expect(marco()).toBe(elMarco)
    // Sesión completa: el último resultado conserva su enlace.
    juegos[B] = final(B)
    await avanzar(5_000)
    expect(document.querySelector('.sb-tv').textContent).toContain('Sesión completada')
    expect(enlace().getAttribute('href')).toBe('/liga/platinum-u12')
    expect(marco()).toBe(elMarco)
  })

  it('no aparece cuando no hay un solo partido en pantalla: cargando, sin conexión, partido no encontrado, conflicto y configuración', async () => {
    // cargando (las lecturas no han vuelto)
    montar()
    expect(screen.getByText('Cargando la transmisión…')).toBeTruthy()
    expect(enlace()).toBeNull()
    cleanup()
    // sin conexión con el servidor
    juegos = { [A]: 'red', [B]: 'red' }
    montar()
    await avanzar(20_000)
    expect(screen.getByText('Sin conexión con el servidor')).toBeTruthy()
    expect(enlace()).toBeNull()
    cleanup()
    // partido no encontrado
    juegos = { [A]: base(A), [B]: 404 }
    montar()
    await avanzar(50)
    expect(screen.getByText('Partido no encontrado')).toBeTruthy()
    expect(enlace()).toBeNull()
    cleanup()
    // conflicto (dos en vivo)
    juegos = { [A]: vivo(A), [B]: vivo(B) }
    montar()
    await avanzar(50)
    expect(screen.getByText('Más de un partido en vivo')).toBeTruthy()
    expect(enlace()).toBeNull()
    cleanup()
    // configuración no válida / sin configurar
    for (const [valor, titulo] of [['', 'Transmisión no configurada'], [`${U10}/${A},${U10}/${A}`, 'Configuración no válida']]) {
      vi.stubEnv('VITE_TV_SECUENCIA', valor)
      montar()
      await avanzar(50)
      expect(screen.getByText(titulo)).toBeTruthy()
      expect(enlace()).toBeNull()
      cleanup()
    }
  })

  it('no añade lecturas ni suscripciones: solo GET a las lecturas públicas de siempre, y nada hacia la dirección de la liga', async () => {
    montar()
    await avanzar(50)
    juegos[A] = vivo(A)
    await avanzar(30_000)
    expect(enlace()).not.toBeNull()
    expect(llamadas.every((c) => c.metodo === undefined || c.metodo === 'GET')).toBe(true)
    expect(llamadas.some((c) => c.ruta.startsWith('/liga/') || c.ruta.includes('platinum'))).toBe(false)
    // Una lectura cada 5 s del partido en vivo: ~6 en 30 s (con el enlace no hay más).
    expect(llamadas.filter((c) => c.ruta === `/v1/ligas/${U10}/partidos/${A}`).length).toBeLessThanOrEqual(9)
  })

  it('MarcoPantalla sin la propiedad (los demás consumidores) no muestra ningún enlace de estadísticas', () => {
    render(<MemoryRouter><MarcoPantalla vista="juego" enVivo={false} liga="Liga" botonSalir={<button>Salir</button>}><p>x</p></MarcoPantalla></MemoryRouter>)
    expect(enlace()).toBeNull()
    expect(screen.queryByText(/Ver estadísticas de la liga/)).toBeNull()
  })
})
