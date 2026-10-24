/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { entradaTvDisponible, salidaDeTvCancha } from '../../lib/publico/tv-piloto.js'
import { partidoLiga, respuestaJuego, respuestaLiga } from '../../lib/publico/datos-prueba.js'

// REPORT_221 — alcance del evento real: VITE_LIGAS_PUBLICAS sin la liga ficticia. El botón de salida de /tv/cancha nunca lleva a una lista «no disponible».

const respuesta = (c, status = 200) => new Response(JSON.stringify(c), { status, headers: { 'content-type': 'application/json' } })
let llamadas
let ubicacion
function Ubic() { ubicacion = useLocation(); return null }
function servidor() {
  llamadas = []
  vi.stubGlobal('fetch', vi.fn(async (ruta) => {
    llamadas.push(ruta)
    if (ruta === '/v1/ligas/LIGAPUB1/publico') return respuesta(respuestaLiga({ partidos: [partidoLiga({ gameId: 'G1' })] }))
    if (ruta === '/v1/ligas/LIGAPUB1/partidos/G1') return respuesta(respuestaJuego({ gameId: 'G1', estado: 'programado', inicioReal: null, reloj: { estado: null, restanteMs: null, desdeMs: null } }))
    return respuesta({ error: 'no-encontrado' }, 404)
  }))
}
const montar = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><AppCompartida /><Ubic /></MemoryRouter>)

beforeEach(() => {
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1'); vi.stubEnv('VITE_TV_SECUENCIA', 'LIGAPUB1/G1')
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('funciones puras', () => {
  it('/tv existe solo si la liga ficticia de la entrada está en la compilación; la salida cambia en consecuencia', () => {
    expect(entradaTvDisponible(['PLATINIUM-U10', 'PLATINIUM-U12'])).toBe(false)
    expect(entradaTvDisponible(['PLATINIUM-U10', 'PLATINIUM-U12', 'SIMULACRO-PILOTO'])).toBe(true)
    expect(entradaTvDisponible([])).toBe(false)
    expect(entradaTvDisponible(undefined)).toBe(false)
    expect(salidaDeTvCancha(['PLATINIUM-U10', 'SIMULACRO-PILOTO'])).toEqual({ to: '/tv', etiqueta: '‹ Partidos en TV' })
    expect(salidaDeTvCancha(['PLATINIUM-U10', 'PLATINIUM-U12'])).toEqual({ to: '/', etiqueta: '‹ Inicio' })
  })
})

describe('/tv/cancha', () => {
  it('con la liga ficticia en la compilación (ensayo de tres ligas): el botón sigue siendo «‹ Partidos en TV» → /tv', async () => {
    vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1,SIMULACRO-PILOTO'); servidor()
    montar('/tv/cancha')
    fireEvent.click(await screen.findByRole('button', { name: '‹ Partidos en TV' }))
    expect(ubicacion.pathname).toBe('/tv')
  })

  it('alcance del evento real (sin la liga ficticia): el botón dice «‹ Inicio» y lleva a la portada, que existe; nunca a /tv («no disponible»)', async () => {
    vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1'); servidor()
    montar('/tv/cancha')
    const b = await screen.findByRole('button', { name: '‹ Inicio' })
    expect(screen.queryByRole('button', { name: /Partidos en TV/ })).toBeNull()
    fireEvent.click(b)
    expect(ubicacion.pathname).toBe('/')
    expect(await screen.findByText('Ahora mismo')).toBeTruthy() // la portada real, con los partidos y sus páginas públicas
    expect(screen.queryByText(/no está disponible en esta versión/)).toBeNull()
  })

  it('la transmisión sigue la secuencia sin la liga ficticia (sus lecturas son solo de ligas reales) y no pide nada a ella', async () => {
    vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1'); servidor()
    montar('/tv/cancha')
    await screen.findByRole('button', { name: '‹ Inicio' })
    await waitFor(() => expect(llamadas.some((r) => r === '/v1/ligas/LIGAPUB1/partidos/G1')).toBe(true))
    expect(llamadas.some((r) => /SIMULACRO/.test(r))).toBe(false)
  })

  it('la entrada /tv de la liga ficticia sigue respondiendo «no disponible» cuando no está en la compilación (comportamiento documentado), sin pedir nada', async () => {
    vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1'); servidor()
    montar('/tv')
    expect(await screen.findByText('Esta entrada no está disponible en esta versión de Sebel.')).toBeTruthy()
    expect(llamadas).toEqual([])
  })
})

describe('direcciones públicas antiguas de la liga ficticia (compilación sin ella)', () => {
  it('liga, equipo y partido: «No encontramos…» con salida a la portada, SIN ninguna petición a la API (la API sigue admitida en el servidor; solo la pantalla deja de leerla)', async () => {
    vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1'); servidor()
    for (const [ruta, texto] of [['/liga/simulacro-piloto', 'No encontramos esta liga'], ['/liga/simulacro-piloto/equipo/azul', 'No encontramos este equipo'], ['/liga/simulacro-piloto/partido/azul-vs-verde-abc123', 'No encontramos este partido']]) {
      montar(ruta)
      expect(await screen.findByText(texto)).toBeTruthy()
      cleanup()
    }
    expect(llamadas).toEqual([])
  })
})
