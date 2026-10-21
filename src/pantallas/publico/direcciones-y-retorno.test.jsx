/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { partidoLiga, reloj, respuestaJuego, respuestaLiga } from '../../lib/publico/datos-prueba.js'
import { sufijoPartido } from '../../lib/publico/urls.js'

// REPORT_158: direcciones públicas amigables (minúsculas, partido sin fecha con sufijo estable, ids internos y enlaces viejos intactos) y
// «Salir» de un partido que vuelve a la pestaña Calendario, también tras recargar la página. Servidor falso; datos SINTÉTICOS en dos ligas
// (los partidos vivo y final son sintéticos: no se toca ningún partido real).

const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
let llamadas
function servidor(rutas) {
  llamadas = []
  vi.stubGlobal('fetch', vi.fn(async (ruta) => { llamadas.push(ruta); return rutas[ruta] === undefined ? respuesta({ error: 'no-encontrado' }, 404) : respuesta(rutas[ruta]) }))
}

const LIGAS = ['PLATINIUM-U10', 'PLATINIUM-U12']
const equipos = [{ id: 'A', nombre: 'Cross Level' }, { id: 'B', nombre: 'Deportivo' }, { id: 'C', nombre: 'West Hornets' }, { id: 'D', nombre: 'VIP' }]
const idJuego = (liga, clave) => `${liga}-20261024-${clave}`
const JUEGOS = { programado: 'CROSS-LEVEL-VS-DEPORTIVO', vivo: 'WEST-HORNETS-VS-VIP', final: 'DEPORTIVO-VS-VIP' }
const lado = (id, puntos = 0, faltas = 0) => ({ id, puntos, faltas })

function lecturaLiga(liga) {
  const r = respuestaLiga({
    id: liga, nombre: `Liga ${liga}`,
    partidos: [
      partidoLiga({ gameId: idJuego(liga, JUEGOS.programado), estado: 'programado', programadoPara: '2026-10-24T14:00:00.000Z', sede: null, local: lado('A'), visita: lado('B') }),
      partidoLiga({ gameId: idJuego(liga, JUEGOS.vivo), estado: 'vivo', programadoPara: '2026-10-24T16:50:00.000Z', inicioReal: '2026-10-24T16:55:00.000Z', reloj: reloj('detenido', 300000), local: lado('C', 4, 1), visita: lado('D', 2, 0) }),
      partidoLiga({ gameId: idJuego(liga, JUEGOS.final), estado: 'final', programadoPara: '2026-10-24T13:00:00.000Z', inicioReal: '2026-10-24T13:02:00.000Z', local: lado('B', 20, 5), visita: lado('D', 18, 4) }),
    ],
  })
  r.equipos = equipos
  return r
}
function rutasDe(liga) {
  const l = lecturaLiga(liga)
  const nombre = (id) => equipos.find((e) => e.id === id).nombre
  const rutas = { [`/v1/ligas/${liga}/publico`]: l }
  for (const p of l.partidos) {
    rutas[`/v1/ligas/${liga}/partidos/${p.gameId}`] = respuestaJuego({
      ligaId: liga, gameId: p.gameId, estado: p.estado, programadoPara: p.programadoPara, inicioReal: p.inicioReal, reloj: p.reloj, sede: p.sede,
      local: { ...p.local, nombre: nombre(p.local.id) }, visita: { ...p.visita, nombre: nombre(p.visita.id) },
    })
  }
  return rutas
}
const todasLasRutas = () => ({ ...rutasDe(LIGAS[0]), ...rutasDe(LIGAS[1]) })

let ubicacion
let navegar
function Sonda() {
  ubicacion = useLocation()
  navegar = useNavigate()
  return null
}
const montar = (entrada) => render(<MemoryRouter initialEntries={[entrada]}><AppCompartida /><Sonda /></MemoryRouter>)

beforeEach(() => {
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', LIGAS.join(','))
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const calendarioActivo = () => screen.getByRole('button', { name: 'Calendario' }).className.includes('activo')
const enlaceDePartido = (liga, clave) => document.querySelector(`a.partido[href$="-${sufijoPartido(idJuego(liga, clave))}"]`)
const rutaCanonica = (liga, clave, nombres) => `/liga/${liga.toLowerCase()}/partido/${nombres}-${sufijoPartido(idJuego(liga, clave))}`
const NOMBRES = { programado: 'cross-level-vs-deportivo', vivo: 'west-hornets-vs-vip', final: 'deportivo-vs-vip' }
const esperaPartido = async () => screen.findByLabelText('Pantalla del marcador')

describe('direcciones canónicas en minúsculas', () => {
  for (const liga of LIGAS) {
    it(`${liga}: la liga y el calendario enlazan a /liga/${liga.toLowerCase()}/partido/<nombre-sin-fecha>-<sufijo>`, async () => {
      servidor(todasLasRutas())
      montar(`/liga/${liga.toLowerCase()}?pestana=calendario`)
      await screen.findByText('Partido finalizado')
      const hrefs = [...document.querySelectorAll('a.partido')].map((a) => a.getAttribute('href'))
      expect(hrefs.sort()).toEqual(Object.keys(JUEGOS).map((e) => rutaCanonica(liga, JUEGOS[e], NOMBRES[e])).sort())
      for (const h of hrefs) expect(h).not.toMatch(/2026|1024/) // sin fecha
    })
  }

  it('la liga en mayúsculas (enlace viejo) se normaliza a minúsculas SIN perder ?pestana=', async () => {
    servidor(todasLasRutas())
    montar('/liga/PLATINIUM-U10?pestana=calendario')
    await screen.findByText('Partido finalizado')
    expect(ubicacion.pathname).toBe('/liga/platinium-u10')
    expect(ubicacion.search).toBe('?pestana=calendario')
    expect(calendarioActivo()).toBe(true)
    // las llamadas al servidor siguen usando el id interno
    expect(llamadas).toContain('/v1/ligas/PLATINIUM-U10/publico')
    expect(llamadas.some((r) => r.includes('platinium'))).toBe(false)
  })

  it('el equipo: minúsculas, y los enlaces con el id completo o en mayúsculas siguen funcionando y se normalizan', async () => {
    const rutas = todasLasRutas()
    rutas['/v1/ligas/PLATINIUM-U10/publico'].equipos = [{ id: 'PLATINIUM-U10-DEPORTIVO', nombre: 'Deportivo' }]
    rutas['/v1/ligas/PLATINIUM-U10/publico'].partidos = []
    rutas['/v1/ligas/PLATINIUM-U10/equipos/PLATINIUM-U10-DEPORTIVO/publico'] = {
      liga: { id: 'PLATINIUM-U10', nombre: 'Liga PLATINIUM-U10' }, equipo: { id: 'PLATINIUM-U10-DEPORTIVO', nombre: 'Deportivo' }, plantilla: [], historicos: [], resultados: [],
      estadisticas: { alcance: 'partidos-finales-del-equipo', partidosFinales: 0, jugadores: [], sinJugador: { puntos: 0, faltas: 0 } }, servidorAhoraMs: rutas['/v1/ligas/PLATINIUM-U10/publico'].servidorAhoraMs, faltasAlcance: 'partido',
    }
    for (const entrada of ['/liga/PLATINIUM-U10/equipo/DEPORTIVO', '/liga/platinium-u10/equipo/deportivo', '/liga/PLATINIUM-U10/equipo/PLATINIUM-U10-DEPORTIVO?x=1']) {
      servidor(rutas)
      montar(entrada)
      await screen.findByRole('heading', { name: 'Deportivo' })
      await waitFor(() => expect(ubicacion.pathname).toBe('/liga/platinium-u10/equipo/deportivo'))
      cleanup()
    }
  })

  it('el partido con el id completo (enlace viejo) abre el partido y se normaliza a la dirección canónica conservando la búsqueda', async () => {
    servidor(todasLasRutas())
    montar(`/liga/PLATINIUM-U10/partido/${idJuego('PLATINIUM-U10', JUEGOS.vivo)}?x=1`)
    await esperaPartido()
    await waitFor(() => expect(ubicacion.pathname).toBe(rutaCanonica('PLATINIUM-U10', JUEGOS.vivo, NOMBRES.vivo)))
    expect(ubicacion.search).toBe('?x=1')
  })

  it('un nombre desactualizado con el sufijo correcto sigue abriendo el partido y se corrige', async () => {
    servidor(todasLasRutas())
    montar(`/liga/platinium-u12/partido/nombre-viejo-vs-otro-${sufijoPartido(idJuego('PLATINIUM-U12', JUEGOS.final))}`)
    await esperaPartido()
    await waitFor(() => expect(ubicacion.pathname).toBe(rutaCanonica('PLATINIUM-U12', JUEGOS.final, NOMBRES.final)))
  })

  it('identificadores desconocidos: fallan claro y no piden ningún partido', async () => {
    servidor(todasLasRutas())
    for (const ruta of ['/liga/platinium-u10/partido/no-existe-vs-nadie-zzzzzz', '/liga/platinium-u10/partido/NOEXISTE', '/liga/otra/partido/x-vs-y-abc123']) {
      montar(ruta)
      expect(await screen.findByText('No encontramos este partido')).toBeTruthy()
      cleanup()
    }
    expect(llamadas.filter((r) => r.includes('/partidos/'))).toEqual([])
    montar('/liga/otra')
    expect(await screen.findByText('No encontramos esta liga')).toBeTruthy()
  })

  it('un sufijo repetido en la liga es ambiguo: «no es claro», sin elegir ninguno', async () => {
    const rutas = todasLasRutas()
    const l = rutas['/v1/ligas/PLATINIUM-U10/publico']
    l.partidos = [partidoLiga({ gameId: 'COL-60792', local: lado('A'), visita: lado('B') }), partidoLiga({ gameId: 'COL-75646', local: lado('C'), visita: lado('D') })]
    servidor(rutas)
    montar('/liga/platinium-u10?pestana=calendario')
    await screen.findAllByText('Cross Level')
    // ambos usan el id completo, porque el sufijo choca
    expect([...document.querySelectorAll('a.partido')].map((a) => a.getAttribute('href')).sort()).toEqual(['/liga/platinium-u10/partido/COL-60792', '/liga/platinium-u10/partido/COL-75646'])
    cleanup()
    montar(`/liga/platinium-u10/partido/algo-vs-algo-${sufijoPartido('COL-60792')}`)
    expect(await screen.findByText('Este enlace de partido no es claro')).toBeTruthy()
    expect(llamadas.filter((r) => r.includes('/partidos/'))).toEqual([])
  })
})

describe('«Salir» de un partido vuelve al Calendario', () => {
  for (const liga of LIGAS) {
    for (const estado of ['programado', 'vivo', 'final']) {
      it(`${liga} · ${estado}: Calendario → partido → Salir; y otra vez tras recargar el partido (con y sin historial)`, async () => {
        servidor(todasLasRutas())
        montar(`/liga/${liga.toLowerCase()}?pestana=calendario`)
        await screen.findByText('Partido finalizado')
        fireEvent.click(enlaceDePartido(liga, JUEGOS[estado]))
        await esperaPartido()
        expect(ubicacion.pathname).toBe(rutaCanonica(liga, JUEGOS[estado], NOMBRES[estado]))
        const entrada = { pathname: ubicacion.pathname, search: ubicacion.search, state: ubicacion.state } // lo que el navegador conserva al recargar

        // 1) Salir sin recargar
        fireEvent.click(screen.getByRole('button', { name: '‹ Salir' }))
        await screen.findByText('Partido finalizado')
        expect(ubicacion.pathname).toBe(`/liga/${liga.toLowerCase()}`)
        expect(ubicacion.search).toBe('?pestana=calendario')
        expect(calendarioActivo()).toBe(true)
        cleanup()

        // 2) recargar la página del partido (el `state` del historial se conserva) y salir
        montar(entrada)
        await esperaPartido()
        fireEvent.click(screen.getByRole('button', { name: '‹ Salir' }))
        await screen.findByText('Partido finalizado')
        expect(ubicacion.search).toBe('?pestana=calendario')
        expect(calendarioActivo()).toBe(true)
        cleanup()

        // 3) abrir directo el enlace generado por el calendario (sin origen: otra pestaña, WhatsApp…): la liga en Calendario
        montar(entrada.pathname)
        await esperaPartido()
        fireEvent.click(screen.getByRole('button', { name: 'Ver liga' }))
        await screen.findByText('Partido finalizado')
        expect(ubicacion.pathname).toBe(`/liga/${liga.toLowerCase()}`)
        expect(ubicacion.search).toBe('?pestana=calendario')
        expect(calendarioActivo()).toBe(true)
      })
    }
  }

  it('la flecha «atrás» del navegador sigue funcionando: vuelve al Calendario sin pasar por el origen guardado', async () => {
    servidor(todasLasRutas())
    montar('/liga/platinium-u10?pestana=calendario')
    await screen.findByText('Partido finalizado')
    fireEvent.click(enlaceDePartido('PLATINIUM-U10', JUEGOS.final))
    await esperaPartido()
    await act(async () => { navegar(-1) })
    await screen.findByText('Partido finalizado')
    expect(ubicacion.search).toBe('?pestana=calendario')
    expect(calendarioActivo()).toBe(true)
  })

  it('desde Inicio (otro origen válido) «Salir» vuelve a Inicio, no al Calendario; Posiciones y Jugadores conservan su pestaña por la URL', async () => {
    servidor(todasLasRutas())
    montar('/')
    await screen.findByText('Ahora mismo')
    fireEvent.click(document.querySelector('.hm-marcador'))
    await esperaPartido()
    fireEvent.click(screen.getByRole('button', { name: '‹ Salir' }))
    expect(await screen.findByText('Ahora mismo')).toBeTruthy()
    expect(ubicacion.pathname).toBe('/')
    cleanup()
    for (const [pestana, texto] of [['jugadores', 'Jugadores'], [null, 'Posiciones']]) {
      montar(`/liga/platinium-u10${pestana ? `?pestana=${pestana}` : ''}`)
      await screen.findByRole('button', { name: texto })
      expect(screen.getByRole('button', { name: texto }).className).toContain('activo')
      cleanup()
    }
  })

  it('un origen inválido en el historial se ignora (ruta externa, partido, esquema peligroso): «Ver liga» → Calendario', async () => {
    servidor(todasLasRutas())
    const ruta = rutaCanonica('PLATINIUM-U10', JUEGOS.final, NOMBRES.final)
    for (const volverA of ['https://evil.example/', '//evil.example', 'javascript:alert(1)', '/liga/platinium-u10/partido/otro-xxxxxx', '/anthony/ligas', '/organizador/ligas/x']) {
      montar({ pathname: ruta, state: { volverA } })
      await esperaPartido()
      fireEvent.click(screen.getByRole('button', { name: 'Ver liga' }))
      await screen.findByText('Partido finalizado')
      expect(ubicacion.pathname).toBe('/liga/platinium-u10')
      expect(ubicacion.search).toBe('?pestana=calendario')
      cleanup()
    }
  })

  it('con un origen válido pero la liga no cargada todavía, el partido muestra «Salir» y no se rompe', async () => {
    servidor({})
    montar({ pathname: '/liga/platinium-u10/partido/x-vs-y-abc123', state: { volverA: '/liga/platinium-u10?pestana=calendario' } })
    expect(await screen.findByText('No encontramos este partido')).toBeTruthy()
    expect(within(document.body).queryByRole('button', { name: '‹ Salir' })).toBeNull()
  })
})
