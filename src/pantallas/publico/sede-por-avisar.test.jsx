/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { sufijoPartido } from '../../lib/publico/urls.js'
import { textoSede } from '../../lib/publico/formato.js'
import { partidoLiga, reloj, respuestaJuego, respuestaLiga } from '../../lib/publico/datos-prueba.js'

// «Por avisar» (REPORT_155): un partido PROGRAMADO sin sede (nula) lo muestra en Inicio, en la liga y en el marcador del partido; con sede muestra la
// sede; uno en juego o terminado sin sede no muestra nada. Servidor falso; datos sintéticos.

const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
function servidor(rutas) {
  vi.stubGlobal('fetch', vi.fn(async (ruta) => (rutas[ruta] === undefined ? respuesta({ error: 'no-encontrado' }, 404) : respuesta(rutas[ruta]))))
}
const montar = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><AppCompartida /></MemoryRouter>)
const liga = () => respuestaLiga({
  partidos: [
    partidoLiga({ gameId: 'SIN', programadoPara: '2026-11-02T14:00:00.000Z', sede: null }),
    partidoLiga({ gameId: 'CON', programadoPara: '2026-11-02T16:00:00.000Z', sede: 'Cancha B' }),
    partidoLiga({ gameId: 'VIVO', estado: 'vivo', inicioReal: '2026-11-01T21:31:00.000Z', reloj: reloj('detenido', 1000), sede: null }),
    partidoLiga({ gameId: 'FIN', estado: 'final', inicioReal: '2026-11-01T18:00:00.000Z', sede: null }),
  ],
})

beforeEach(() => {
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1')
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('textoSede', () => {
  it('programado sin sede → «Por avisar»; con sede → la sede; en juego o final sin sede → nada', () => {
    expect(textoSede({ estado: 'programado', sede: null })).toBe('Por avisar')
    expect(textoSede({ estado: 'programado', sede: 'Cancha A' })).toBe('Cancha A')
    expect(textoSede({ estado: 'vivo', sede: null })).toBeNull()
    expect(textoSede({ estado: 'final', sede: null })).toBeNull()
  })
})

describe('«Por avisar» en las superficies públicas', () => {
  for (const [nombre, ruta] of [['Inicio («Lo que viene»)', '/'], ['liga (pestaña Calendario)', '/liga/LIGAPUB1?pestana=calendario']]) {
    it(`${nombre}: el programado sin sede dice «Por avisar»; el que tiene sede muestra su sede; ningún otro estado lo muestra`, async () => {
      servidor({ '/v1/ligas/LIGAPUB1/publico': liga() })
      montar(ruta)
      await screen.findAllByText('Cancha B')
      const filas = [...document.querySelectorAll('a.partido')]
      const sin = filas.find((f) => f.getAttribute('href').endsWith(`-${sufijoPartido('SIN')}`))
      const con = filas.find((f) => f.getAttribute('href').endsWith(`-${sufijoPartido('CON')}`))
      expect(within(sin).getByText('Por avisar')).toBeTruthy()
      expect(within(con).getByText('Cancha B')).toBeTruthy()
      expect(within(con).queryByText('Por avisar')).toBeNull()
      expect(screen.getAllByText('Por avisar').length).toBe(1) // el vivo y el final sin sede no lo muestran
    })
  }

  it('marcador del partido: programado sin sede → «Por avisar»; en juego sin sede → nada', async () => {
    servidor({ '/v1/ligas/LIGAPUB1/publico': liga(), '/v1/ligas/LIGAPUB1/partidos/SIN': respuestaJuego({ gameId: 'SIN', estado: 'programado', sede: null, inicioReal: null, programadoPara: '2026-11-02T14:00:00.000Z' }) })
    montar('/liga/LIGAPUB1/partido/SIN')
    expect(await screen.findByText('Por avisar')).toBeTruthy()
    cleanup()
    servidor({ '/v1/ligas/LIGAPUB1/publico': liga(), '/v1/ligas/LIGAPUB1/partidos/VIVO': respuestaJuego({ gameId: 'VIVO', estado: 'vivo', sede: null }) })
    montar('/liga/LIGAPUB1/partido/VIVO')
    await screen.findByText('Faltas del partido')
    expect(screen.queryByText('Por avisar')).toBeNull()
  })
})
