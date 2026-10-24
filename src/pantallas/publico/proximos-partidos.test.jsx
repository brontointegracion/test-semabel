/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { sufijoPartido } from '../../lib/publico/urls.js'
import { partidoLiga, reloj, respuestaLiga } from '../../lib/publico/datos-prueba.js'

// REPORT_213 — «Próximos partidos» de la portada: sin los programados cuya hora ya pasó, el partido EN VIVO nunca se oculta, los que no tienen hora van aparte y
// rotulados, a lo sumo tres a la vista y «Ver más partidos» explícito (sin carga al desplazarse y SIN nuevas peticiones). Servidor falso; datos sintéticos.
// «Ahora» del servidor en estos datos: 2026-11-01T22:00:00Z (= 5:00 p. m. en Panamá).

const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
let llamadas
function servidor(rutas) {
  llamadas = []
  vi.stubGlobal('fetch', vi.fn(async (ruta, init) => {
    llamadas.push({ ruta, init })
    const h = rutas[ruta]
    return h === undefined ? respuesta({ error: 'no-encontrado' }, 404) : (h instanceof Response ? h : respuesta(h))
  }))
}
const L1 = '/v1/ligas/LIGAPUB1/publico'
const montar = () => render(<MemoryRouter initialEntries={['/']}><AppCompartida /></MemoryRouter>)
const lado = (id) => ({ id, puntos: 0, faltas: 0 })
const prog = (gameId, programadoPara, extra = {}) => partidoLiga({ gameId, programadoPara, local: lado('E1'), visita: lado('E2'), sede: null, ...extra })
const filas = () => [...document.querySelectorAll('.hm-seccion-viene .partido')]
const seccion = () => document.querySelector('.hm-seccion-viene')
const entrar = async () => { await screen.findByText('Próximos partidos'); await waitFor(() => expect(document.querySelector('.hm-seccion-viene .partido, .hm-seccion-viene .vacio, .hm-seccion-viene .aviso')).toBeTruthy()) }

beforeEach(() => {
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1')
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('qué entra en «Próximos partidos»', () => {
  it('el título aprobado; los pasados de hora no se listan; los futuros sí, en orden cronológico; el vivo con hora pasada sigue en «Ahora mismo»', async () => {
    servidor({ [L1]: respuestaLiga({ partidos: [
      prog('PASADO', '2026-11-01T21:00:00.000Z'), prog('FUT2', '2026-11-03T15:00:00.000Z'), prog('FUT1', '2026-11-02T15:00:00.000Z'),
      partidoLiga({ gameId: 'VIVO', estado: 'vivo', programadoPara: '2026-11-01T18:00:00.000Z', inicioReal: '2026-11-01T18:05:00.000Z', periodo: 2, reloj: reloj('detenido', 420000), local: lado('E3'), visita: lado('E4'), sede: null }),
    ] }) })
    montar(); await entrar()
    expect(screen.getByRole('heading', { name: 'Próximos partidos' })).toBeTruthy()
    // orden cronológico por la dirección de cada fila (el pasado no está)
    const hrefs = filas().map((f) => f.getAttribute('href'))
    expect(hrefs).toEqual([`/liga/ligapub1/partido/alfa-norte-vs-beta-sur-${sufijoPartido('FUT1')}`, `/liga/ligapub1/partido/alfa-norte-vs-beta-sur-${sufijoPartido('FUT2')}`])
    expect(seccion().textContent).not.toContain('Pendiente de comenzar')
    // el vivo, con su hora programada ya pasada, sigue en su sección y con su enlace
    const vivo = document.querySelector('.hm-seccion-ahora .hm-marcador')
    expect(vivo.getAttribute('href')).toBe(`/liga/ligapub1/partido/gama-este-vs-delta-oeste-${sufijoPartido('VIVO')}`)
    expect(document.querySelector('.hm-seccion-ahora').textContent).toMatch(/2º cuarto/)
    expect(screen.queryByRole('button', { name: /Ver más partidos/ })).toBeNull() // dos partidos: nada que ampliar
  })

  it('frontera de la hora: 4 minutos después de «ahora» se lista; 4 minutos antes no; con fecha de Panamá y hora en 12 horas', async () => {
    servidor({ [L1]: respuestaLiga({ partidos: [prog('ANTES', '2026-11-01T21:56:00.000Z'), prog('DESPUES', '2026-11-01T22:04:00.000Z')] }) })
    montar(); await entrar()
    expect(filas()).toHaveLength(1)
    expect(filas()[0].getAttribute('href')).toContain(sufijoPartido('DESPUES'))
    expect(within(filas()[0]).getByText('5:04 p. m.')).toBeTruthy() // 22:04Z = 5:04 p. m. en Panamá (UTC−5)
  })

  it('sin hora: no se presentan como fechados; van al final bajo «Fecha por confirmar»; con tres fechados a la vista quedan para «Ver más partidos»', async () => {
    servidor({ [L1]: respuestaLiga({ partidos: [prog('SINHORA', null), prog('A', '2026-11-02T15:00:00.000Z'), prog('B', '2026-11-03T15:00:00.000Z'), prog('C', '2026-11-04T15:00:00.000Z')] }) })
    montar(); await entrar()
    expect(filas().map((f) => f.getAttribute('href').split('-').pop())).toEqual([sufijoPartido('A'), sufijoPartido('B'), sufijoPartido('C')])
    expect(screen.queryByText('Fecha por confirmar')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver más partidos' }))
    expect(filas()).toHaveLength(4)
    const separadores = [...document.querySelectorAll('.hm-seccion-viene .dia-sep')].map((e) => e.textContent)
    expect(separadores.at(-1)).toBe('Fecha por confirmar')
    expect(separadores.slice(0, -1).every((t) => t !== 'Fecha por confirmar')).toBe(true)
    expect(filas().at(-1).getAttribute('href')).toContain(sufijoPartido('SINHORA'))
    expect(within(filas().at(-1)).queryByText(/p\. m\.|a\. m\./)).toBeNull() // ninguna hora inventada
  })
})

describe('tres a la vista y «Ver más partidos»', () => {
  const siete = () => respuestaLiga({ partidos: Array.from({ length: 7 }, (_, i) => prog(`G${i + 1}`, `2026-11-0${2 + i}T15:00:00.000Z`)) })

  it('al inicio solo tres; botón accesible con nombre «Ver más partidos», aria-expanded=false y aria-controls a la lista; el resto aparece SIN nuevas peticiones y en el mismo orden', async () => {
    servidor({ [L1]: siete() })
    montar(); await entrar()
    expect(filas()).toHaveLength(3)
    const boton = screen.getByRole('button', { name: 'Ver más partidos' })
    expect(boton.getAttribute('aria-expanded')).toBe('false')
    expect(boton.tagName).toBe('BUTTON') // acción explícita, sin carga al desplazarse
    expect(document.getElementById(boton.getAttribute('aria-controls')).contains(filas()[0])).toBe(true)
    expect(screen.getByText('Mostrando 3 de 7 partidos')).toBeTruthy()
    const antes = llamadas.length
    fireEvent.click(boton)
    expect(filas()).toHaveLength(7)
    expect(filas().map((f) => f.getAttribute('href').split('-').pop())).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].map(sufijoPartido))
    expect(screen.getByRole('button', { name: 'Ver menos partidos' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Mostrando los 7 partidos')).toBeTruthy()
    expect(llamadas.length).toBe(antes) // ampliar la lista NO pide nada al servidor: los datos ya estaban en la página
    fireEvent.click(screen.getByRole('button', { name: 'Ver menos partidos' }))
    expect(filas()).toHaveLength(3)
    expect(llamadas.length).toBe(antes)
  })

  it('exactamente tres: sin botón; los enlaces amigables llevan al partido de cada fila', async () => {
    servidor({ [L1]: respuestaLiga({ partidos: ['G1', 'G2', 'G3'].map((g, i) => prog(g, `2026-11-0${2 + i}T15:00:00.000Z`)) }) })
    montar(); await entrar()
    expect(filas()).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /Ver (más|menos) partidos/ })).toBeNull()
    for (const [i, f] of filas().entries()) expect(f.getAttribute('href')).toBe(`/liga/ligapub1/partido/alfa-norte-vs-beta-sur-${sufijoPartido(`G${i + 1}`)}`)
  })

  it('las lecturas siguen siendo las mismas: UNA por liga con la lista completa, haya tres filas o siete (limitar filas no reduce peticiones)', async () => {
    servidor({ [L1]: siete() })
    montar(); await entrar()
    expect(llamadas.map((l) => l.ruta).filter((r) => !r.endsWith('/jugadores/publico'))).toEqual([L1])
    expect(llamadas.every((l) => l.init.method === 'GET')).toBe(true)
  })
})

describe('estados: nada por venir, no disponible, cargando', () => {
  it('sin ningún programado: el texto de siempre; con programados que ya pasaron de hora: se dice, con el número, y no es «no disponible»', async () => {
    servidor({ [L1]: respuestaLiga({ partidos: [partidoLiga({ gameId: 'F', estado: 'final', inicioReal: '2026-11-01T18:00:00.000Z', local: lado('E1'), visita: lado('E2') })] }) })
    montar(); await entrar()
    expect(seccion().textContent).toContain('No hay partidos programados con ese filtro.')
    cleanup()
    servidor({ [L1]: respuestaLiga({ partidos: [prog('P1', '2026-11-01T20:00:00.000Z'), prog('P2', '2026-11-01T21:00:00.000Z')] }) })
    montar(); await entrar()
    expect(filas()).toHaveLength(0)
    expect(seccion().textContent).toContain('No hay partidos por venir con ese filtro. Hay 2 partidos programados cuya hora ya pasó y todavía no comienzan.')
    expect(seccion().textContent).not.toMatch(/Faltan ligas|No se pudo/)
  })

  it('datos no disponibles: con una liga que falla se dice «Faltan ligas por cargar» (no «no hay partidos»); con todas fallando, el aviso de error de siempre; cargando, el indicador', async () => {
    vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1,LIGAPUB2')
    servidor({ [L1]: respuestaLiga({ partidos: [] }), '/v1/ligas/LIGAPUB2/publico': respuesta({ error: 'x' }, 500) })
    montar()
    await waitFor(() => expect(seccion().textContent).toContain('Faltan ligas por cargar: todavía no sabemos qué partidos vienen.'))
    expect(seccion().textContent).not.toContain('No hay partidos')
    cleanup()
    servidor({})
    montar()
    await waitFor(() => expect(document.querySelector('.aviso')).toBeTruthy())
    expect(screen.queryByText('No hay partidos programados con ese filtro.')).toBeNull()
  })
})
