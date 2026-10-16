/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { sufijoPartido } from '../../lib/publico/urls.js'
import { partidoLiga, respuestaEquipo, respuestaJuego, respuestaLiga, SERVIDOR_MS } from '../../lib/publico/datos-prueba.js'

// PÁGINA PÚBLICA DE EQUIPO con un servidor FALSO y datos sintéticos. Ninguna lectura toca la base local ni el prototipo.

const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
let llamadas
// La clave del equipo se resuelve con la lista real de equipos de la liga: toda prueba tiene también esa lectura (salvo que se la quite).
const RUTA_LIGA = '/v1/ligas/LIGAPUB1/publico'
function servidor(rutasDeEquipo) {
  const rutas = { [RUTA_LIGA]: respuestaLiga(), ...rutasDeEquipo }
  llamadas = []
  const fn = vi.fn(async (ruta, init) => {
    llamadas.push({ ruta, init })
    const h = rutas[ruta]
    if (h === undefined) return respuesta({ error: 'no-encontrado' }, 404)
    const r = typeof h === 'function' ? h(llamadas.filter((x) => x.ruta === ruta).length) : h
    return r instanceof Response ? r : respuesta(r)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const RUTA = '/v1/ligas/LIGAPUB1/equipos/E1/publico'
const montar = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><AppCompartida /></MemoryRouter>)

beforeEach(() => {
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1')
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const delEquipo = () => llamadas.filter((l) => l.ruta === RUTA).length
const fila = (texto) => screen.getByText(texto).closest('tr')

describe('Equipo público', () => {
  it('plantilla con número y nombre completo (el 0 incluido, apellidos compuestos), estadísticas por ficha, datos faltantes explícitos y sin enlaces a perfiles', async () => {
    servidor({ [RUTA]: respuestaEquipo() })
    montar('/liga/LIGAPUB1/equipo/E1')
    expect(await screen.findByText('Plantilla')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Alfa Norte/ })).toBeTruthy()
    const ana = fila('Ana Prueba')
    expect(within(ana).getByText('#0')).toBeTruthy() // el 0 se ve
    expect(within(ana).getAllByRole('cell').map((c) => c.textContent)).toEqual(['#0Ana Prueba', '3', '0'])
    const saul = fila('Saúl Montero')
    expect(within(saul).getAllByRole('cell').map((c) => c.textContent)).toEqual(['#2Saúl Montero', '12', '4'])
    expect(within(fila('María José de la Cruz Pérez')).getByText('#7')).toBeTruthy()
    // ficha incompleta: se dice lo que falta
    const incompleta = screen.getByText('Nombre pendiente').closest('tr')
    expect(within(incompleta).getByText('Sin número')).toBeTruthy()
    // dos fichas con el mismo nombre y número se muestran por separado, cada una con lo suyo
    const gemelos = screen.getAllByText('Gemelo Igual').map((x) => x.closest('tr'))
    expect(gemelos.length).toBe(2)
    expect(gemelos.map((g) => within(g).getAllByRole('cell')[1].textContent).sort()).toEqual(['0', '5'])
    // sin enlaces a perfiles ni a equipos de prototipo; sin GP
    expect(screen.queryAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Jugador', 'Pts', 'Faltas', 'Jugador', 'Pts', 'Faltas']) // sin GP/PJ
    expect(document.body.textContent).not.toMatch(/\bGP\b|\bPJ\b|asistencias|rebotes|porcentaje/i)
    const enlaces = [...document.querySelector('.contenido').querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(enlaces.every((h) => h === '/' || h.startsWith('/liga/'))).toBe(true)
    expect(enlaces.some((h) => /\/jugador|\/j\//.test(h))).toBe(false)
    expect(screen.getByText(/No se muestran partidos jugados/)).toBeTruthy()
  })

  it('los históricos van aparte, con su motivo y la advertencia del número actual; los resultados enlazan al partido público', async () => {
    servidor({ [RUTA]: respuestaEquipo() })
    montar('/liga/LIGAPUB1/equipo/E1')
    expect(await screen.findByText('Jugadores que ya no están en la plantilla')).toBeTruthy()
    const retirado = fila('Retirado Ya')
    expect(within(retirado).getByText('Inactivo')).toBeTruthy()
    expect(within(retirado).getAllByRole('cell').map((c) => c.textContent)).toEqual(['#20Retirado YaInactivo', '10', '2'])
    expect(screen.getByText(/no necesariamente el de esos partidos/)).toBeTruthy()
    // el histórico NO está en la tabla de la plantilla
    expect(within(screen.getByRole('table', { name: 'Plantilla actual' })).queryByText('Retirado Ya')).toBeNull()
    const final = screen.getByText('Final').closest('a')
    expect(final.getAttribute('href')).toBe(`/liga/ligapub1/partido/alfa-norte-vs-beta-sur-${sufijoPartido('G1')}`)
    expect(within(final).getByText('30')).toBeTruthy()
    expect(within(final).getByText('41')).toBeTruthy()
  })

  it('vacío: sin jugadores, sin resultados y sin partidos finales no se afirma nada', async () => {
    servidor({ [RUTA]: respuestaEquipo({ plantilla: [], historicos: [], resultados: [], estadisticas: { alcance: 'partidos-finales-del-equipo', partidosFinales: 0, jugadores: [], sinJugador: { puntos: 0, faltas: 0 } } }) })
    montar('/liga/LIGAPUB1/equipo/E1')
    expect(await screen.findByText('Todavía no hay jugadores en la plantilla.')).toBeTruthy()
    expect(screen.getByText('Todavía no hay resultados.')).toBeTruthy()
    expect(screen.getByText(/Todavía no hay partidos finales/)).toBeTruthy()
    expect(screen.queryByText('Jugadores que ya no están en la plantilla')).toBeNull()
  })

  it('sin partidos finales las estadísticas de cada ficha son «—», no ceros', async () => {
    servidor({ [RUTA]: respuestaEquipo({ historicos: [], resultados: [], estadisticas: { alcance: 'partidos-finales-del-equipo', partidosFinales: 0, jugadores: [], sinJugador: { puntos: 0, faltas: 0 } } }) })
    montar('/liga/LIGAPUB1/equipo/E1')
    await screen.findByText('Plantilla')
    expect(within(fila('Saúl Montero')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['#2Saúl Montero', '—', '—'])
  })

  it('peticiones anónimas: GET, sin credenciales ni autorización, solo la lectura pública del equipo; ligas o IDs inválidos no piden nada', async () => {
    const f = servidor({ [RUTA]: respuestaEquipo() })
    montar('/liga/LIGAPUB1/equipo/E1')
    await screen.findByText('Plantilla')
    // la lista de equipos de la liga (para resolver la clave) y el equipo: solo lecturas públicas
    expect(llamadas.map((l) => l.ruta)).toEqual([RUTA_LIGA, RUTA])
    for (const l of llamadas) {
      expect(l.init).toMatchObject({ method: 'GET', credentials: 'omit' })
      expect(JSON.stringify(l.init.headers)).not.toMatch(/authorization|cookie/i)
    }
    cleanup()
    f.mockClear()
    for (const ruta of ['/liga/OTRA/equipo/E1', '/liga/LIGAPUB1/equipo/a%20b']) {
      montar(ruta)
      expect(await screen.findByText('No encontramos este equipo')).toBeTruthy()
      cleanup()
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('errores: 404 del servidor, 503 resumen-no-disponible, 507 y respuestas mal formadas', async () => {
    servidor({})
    montar('/liga/LIGAPUB1/equipo/E1')
    expect(await screen.findByText('No encontramos este equipo')).toBeTruthy()
    cleanup()
    servidor({ [RUTA]: respuesta({ error: 'resumen-no-disponible' }, 503) })
    montar('/liga/LIGAPUB1/equipo/E1')
    expect(await screen.findByText(/Los datos se están preparando/)).toBeTruthy()
    cleanup()
    servidor({ [RUTA]: respuesta({ error: 'equipo-demasiado-grande' }, 507) })
    montar('/liga/LIGAPUB1/equipo/E1')
    expect(await screen.findByText(/demasiado grande/)).toBeTruthy()
    cleanup()
    const malo = respuestaEquipo()
    malo.estadisticas.jugadores[0].puntos = 'tres'
    servidor({ [RUTA]: malo })
    montar('/liga/LIGAPUB1/equipo/E1')
    expect(await screen.findByText(/No se pudo cargar/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('Ana Prueba')
  })

  it('enlaces: la liga lista los equipos como enlaces a su página, y el marcador enlaza a cada equipo', async () => {
    servidor({
      '/v1/ligas/LIGAPUB1/publico': respuestaLiga({ partidos: [partidoLiga({ gameId: 'G1' })] }),
      '/v1/ligas/LIGAPUB1/partidos/G1': respuestaJuego({ gameId: 'G1' }),
      [RUTA]: respuestaEquipo(),
    })
    montar('/liga/LIGAPUB1')
    const pill = await screen.findByRole('link', { name: 'Alfa Norte' })
    expect(pill.getAttribute('href')).toBe('/liga/ligapub1/equipo/e1')
    fireEvent.click(pill)
    expect(await screen.findByText('Plantilla')).toBeTruthy()
    cleanup()
    montar('/liga/LIGAPUB1/partido/G1')
    const enlace = await screen.findByRole('link', { name: 'Beta Sur' })
    expect(enlace.getAttribute('href')).toBe('/liga/ligapub1/equipo/e2')
  })
})

describe('refresco, frescura y ciclo de vida del equipo (tiempo simulado)', () => {
  const FALSOS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance']
  const avanzar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

  it('una sola petición al abrir; ningún sondeo de 5 s; «Actualizar» respeta los 15 s; el refresco programado es de 5 min', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    servidor({ [RUTA]: () => respuestaEquipo({ servidorAhoraMs: SERVIDOR_MS + Math.round(performance.now()) }) })
    const { unmount } = montar('/liga/LIGAPUB1/equipo/E1')
    await avanzar(10)
    expect(delEquipo()).toBe(1)
    expect(llamadas.filter((l) => l.ruta === RUTA_LIGA).length).toBe(1) // la lista de equipos se lee una vez al abrir
    await avanzar(120_000)
    expect(delEquipo()).toBe(1) // dos minutos visible: nada más
    fireEvent.click(screen.getByText('Actualizar'))
    await avanzar(10)
    expect(delEquipo()).toBe(2)
    fireEvent.click(screen.getByText('Actualizar'))
    await avanzar(10)
    expect(delEquipo()).toBe(2) // demasiado pronto
    await avanzar(300_000)
    expect(delEquipo()).toBe(3)
    unmount()
    await avanzar(900_000)
    expect(delEquipo()).toBe(3) // limpieza
  })

  it('si falla un refresco se conserva la última plantilla con «Sin actualizar» y no se afirma frescura', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    let cae = false
    servidor({ [RUTA]: () => (cae ? respuesta({ error: 'x' }, 500) : respuestaEquipo({ servidorAhoraMs: SERVIDOR_MS + Math.round(performance.now()) })) })
    montar('/liga/LIGAPUB1/equipo/E1')
    await avanzar(10)
    expect(screen.queryByText(/Actualizado/)).toBeNull() // la hora de actualización ya no se muestra de rutina (REPORT_160)
    cae = true
    await avanzar(1000 * 301)
    expect(screen.getByText(/Sin actualizar · último dato confirmado a las/)).toBeTruthy()
    expect(screen.getByText('Saúl Montero')).toBeTruthy() // la plantilla sigue
    expect(screen.queryByText(/Actualizado \d\d:\d\d/)).toBeNull()
  })
})
