/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { partidoLiga, reloj, respuestaJuego, respuestaLiga } from '../../lib/publico/datos-prueba.js'
import { TV_PILOTO } from '../../lib/publico/tv-piloto.js'
import { sufijoPartido } from '../../lib/publico/urls.js'
import { SIN_TABS_COMPARTIDO } from '../../lib/publico/navegacion.js'
import { esDestinoInterno } from '../../lib/volver.js'

// /tv (REPORT_186): entrada corta y pública del piloto. Servidor falso; datos SINTÉTICOS con la forma del Simulacro (ninguno real).
// Comprueba: cuatro enlaces grandes agrupados por día de Panamá, enlace canónico al marcador EXISTENTE, teclado (foco + Enter), sin
// lecturas privadas, sin selección automática por hora, estados verdaderos (cargando / no disponible / vacío) y que no admite otra liga.

const LIGA = TV_PILOTO.ligaId
const NOMBRE = 'Simulacro — datos ficticios'
const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
let llamadas
function servidor(rutas) {
  llamadas = []
  vi.stubGlobal('fetch', vi.fn(async (ruta, init) => {
    llamadas.push({ ruta, init })
    const h = rutas[ruta]
    if (h === undefined) return respuesta({ error: 'no-encontrado' }, 404)
    return typeof h === 'function' ? h() : (h instanceof Response ? h : respuesta(h))
  }))
}
const eq = (k, n) => ({ id: `${LIGA}-DEMO-${k}`, nombre: n })
const EQUIPOS = [eq('AZUL', 'Demo Azul'), eq('VERDE', 'Demo Verde'), eq('ROJO', 'Demo Rojo'), eq('AMARILLO', 'Demo Amarillo')]
const lado = (k, puntos = 0, faltas = 0) => ({ id: `${LIGA}-DEMO-${k}`, puntos, faltas })
// 10:00 y 10:30 a. m. de Panamá = 15:00Z y 15:30Z
const J = [
  ['AZUL', 'VERDE', '2026-10-19T15:00:00.000Z'], ['ROJO', 'AMARILLO', '2026-10-19T15:30:00.000Z'],
  ['AZUL', 'ROJO', '2026-10-20T15:00:00.000Z'], ['VERDE', 'AMARILLO', '2026-10-20T15:30:00.000Z'],
]
const idDe = (a, b) => `${LIGA}-${a}-VS-${b}`
const partidos = (sobre = {}) => J.map(([a, b, t]) => partidoLiga({ gameId: idDe(a, b), programadoPara: t, sede: 'Cancha de prueba — simulacro', local: lado(a), visita: lado(b), ...(sobre[idDe(a, b)] ?? {}) }))
const liga = (extra = {}) => respuestaLiga({ id: LIGA, nombre: NOMBRE, equipos: EQUIPOS, partidos: partidos(), servidorAhoraMs: Date.parse('2026-10-19T14:00:00.000Z'), ...extra })
const RUTA_LIGA = `/v1/ligas/${LIGA}/publico`
const montar = (ruta = '/tv') => {
  let ubicacion
  const Espia = () => { ubicacion = useLocation(); return null }
  const r = render(<MemoryRouter initialEntries={[ruta]}><Espia /><AppCompartida /></MemoryRouter>)
  return { ...r, ubicacion: () => ubicacion }
}

beforeEach(() => {
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', `PLATINIUM-U10,PLATINIUM-U12,${LIGA}`)
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('/tv: la lista de partidos', () => {
  it('cuatro enlaces agrupados por día de Panamá, con equipos, hora de 12 horas, estado y el nombre ficticio', async () => {
    servidor({ [RUTA_LIGA]: liga() })
    montar()
    const enlaces = await screen.findAllByRole('link')
    expect(enlaces).toHaveLength(4)
    expect(enlaces.map((a) => a.textContent)).toEqual([
      `${NOMBRE}Demo Azul vs Demo Verde10:00 a. m.Por jugar`,
      `${NOMBRE}Demo Rojo vs Demo Amarillo10:30 a. m.Por jugar`,
      `${NOMBRE}Demo Azul vs Demo Rojo10:00 a. m.Por jugar`,
      `${NOMBRE}Demo Verde vs Demo Amarillo10:30 a. m.Por jugar`,
    ])
    const grupos = screen.getAllByRole('region')
    expect(grupos.map((g) => g.getAttribute('aria-label'))).toEqual(['Hoy · lun 19 oct', 'Mañana · mar 20 oct'])
    expect(within(grupos[0]).getAllByRole('link')).toHaveLength(2)
    expect(within(grupos[1]).getAllByRole('link')).toHaveLength(2)
    expect(document.body.textContent).not.toMatch(/\b\d{1,2}:\d{2}\s?(AM|PM)\b/i) // sin formato de 24 horas ni AM/PM sueltos
    expect(document.title).toBe('Partidos en TV · semabel.com')
  })

  it('cada enlace usa la dirección canónica del partido (la misma de la portada y la liga) y guarda /tv como origen de «Salir»', async () => {
    servidor({ [RUTA_LIGA]: liga() })
    montar()
    const enlaces = await screen.findAllByRole('link')
    expect(enlaces.map((a) => a.getAttribute('href'))).toEqual(
      J.map(([a, b]) => `/liga/simulacro-piloto/partido/demo-${a.toLowerCase()}-vs-demo-${b.toLowerCase()}-${sufijoPartido(idDe(a, b))}`),
    )
  })

  it('sin barra de pestañas, sin sesión, sin código y sin lecturas privadas: solo UNA petición pública de la liga del piloto', async () => {
    servidor({ [RUTA_LIGA]: liga() })
    montar()
    await screen.findAllByRole('link')
    expect(document.querySelector('nav.tabbar')).toBeNull()
    expect(llamadas.map((l) => l.ruta)).toEqual([RUTA_LIGA])
    expect(llamadas.some((l) => /organizador|acceso|control|admin|comandos/.test(l.ruta))).toBe(false)
    expect(llamadas[0].init?.headers?.authorization ?? null).toBeNull()
    expect(document.body.textContent).not.toMatch(/c[óo]digo|contraseña|token|iniciar sesi/i)
    expect(SIN_TABS_COMPARTIDO.some((r) => r.test('/tv'))).toBe(true)
    expect(esDestinoInterno('/tv')).toBe(true)
  })

  it('muestra el estado del SERVIDOR y no cambia nada por la hora: un partido programado cuya hora ya pasó sigue «Por jugar»', async () => {
    servidor({ [RUTA_LIGA]: liga({ servidorAhoraMs: Date.parse('2026-10-19T16:30:00.000Z') }) }) // las 11:30 a. m.: ya pasó la hora de los dos primeros
    montar()
    const enlaces = await screen.findAllByRole('link')
    expect(enlaces[0].textContent).toContain('Por jugar')
    expect(enlaces[0].textContent).toContain('Pendiente de comenzar')
    expect(enlaces[0].className).toContain('programado')
    expect(enlaces[0].textContent).not.toContain('En vivo')
    expect(enlaces).toHaveLength(4) // no oculta ni reordena partidos
  })

  it('un partido en vivo y uno final se rotulan con su estado y su marcador', async () => {
    servidor({ [RUTA_LIGA]: liga({ partidos: partidos({
      [idDe('AZUL', 'VERDE')]: { estado: 'vivo', inicioReal: '2026-10-19T15:02:00.000Z', reloj: reloj('corriendo', 90000, Date.parse('2026-10-19T14:00:00.000Z')), local: lado('AZUL', 7, 2), visita: lado('VERDE', 4, 1) },
      [idDe('ROJO', 'AMARILLO')]: { estado: 'final', inicioReal: '2026-10-19T15:31:00.000Z', local: lado('ROJO', 16, 3), visita: lado('AMARILLO', 11, 2) },
    }) }) })
    montar()
    const enlaces = await screen.findAllByRole('link')
    expect(enlaces[0].textContent).toContain('En vivo · 7–4')
    expect(enlaces[1].textContent).toContain('Final · 16–11')
    expect(enlaces[2].textContent).toContain('Por jugar')
  })
})

describe('/tv: teclado y marcador existente', () => {
  it('el foco empieza en el primer partido; Tab recorre los demás y Enter abre el marcador público existente; «Salir» vuelve a /tv', async () => {
    const user = userEvent.setup()
    const id = idDe('AZUL', 'ROJO')
    servidor({
      [RUTA_LIGA]: liga(),
      [`/v1/ligas/${LIGA}/partidos/${id}`]: respuestaJuego({
        ligaId: LIGA, gameId: id, liga: { id: LIGA, nombre: NOMBRE, categoria: 'mini-basketball', subcategoria: { texto: 'Prueba' } }, estado: 'programado', programadoPara: '2026-10-20T15:00:00.000Z', inicioReal: null, sede: 'Cancha de prueba — simulacro',
        local: { id: `${LIGA}-DEMO-AZUL`, nombre: 'Demo Azul', puntos: 0, faltas: 0 }, visita: { id: `${LIGA}-DEMO-ROJO`, nombre: 'Demo Rojo', puntos: 0, faltas: 0 },
      }),
    })
    const { ubicacion } = montar()
    const enlaces = await screen.findAllByRole('link')
    await waitFor(() => expect(document.activeElement).toBe(enlaces[0]))
    await user.tab()
    expect(document.activeElement).toBe(enlaces[1])
    await user.tab()
    expect(document.activeElement).toBe(enlaces[2])
    await user.keyboard('{Enter}')
    expect(await screen.findByLabelText('Puntos de Demo Azul')).toBeTruthy() // el MISMO marcador público (PartidoPublico)
    expect(screen.getByText(NOMBRE)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pantalla completa' })).toBeTruthy()
    expect(ubicacion().pathname).toBe(`/liga/simulacro-piloto/partido/demo-azul-vs-demo-rojo-${sufijoPartido(id)}`)
    await user.click(screen.getByRole('button', { name: '‹ Salir' }))
    expect(await screen.findAllByRole('link')).toHaveLength(4)
    expect(ubicacion().pathname).toBe('/tv')
  })

  it('refrescar o abrir /tv directo (ruta de la SPA) monta la misma lista, también con barra final', async () => {
    servidor({ [RUTA_LIGA]: liga() })
    montar('/tv/')
    expect(await screen.findAllByRole('link')).toHaveLength(4)
  })
})

describe('/tv: estados verdaderos', () => {
  it('cargando: lo dice y no inventa partidos', async () => {
    let soltar
    servidor({ [RUTA_LIGA]: () => new Promise((r) => { soltar = () => r(respuesta(liga())) }) })
    montar()
    expect(await screen.findByText('Cargando los partidos…')).toBeTruthy()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    await act(async () => { soltar() })
    expect(await screen.findAllByRole('link')).toHaveLength(4)
  })

  it('liga sin cargar en el servidor (404): lo dice', async () => {
    servidor({})
    montar()
    expect(await screen.findByText('Esta liga todavía no está cargada en el servidor.')).toBeTruthy()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('servidor no disponible: aviso de reintento, sin lista', async () => {
    servidor({ [RUTA_LIGA]: respuesta({ error: 'x' }, 503) })
    montar()
    expect(await screen.findByText(/No se pudo cargar|Los datos se están preparando/)).toBeTruthy()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('liga leída pero sin partidos: vacío verificado', async () => {
    servidor({ [RUTA_LIGA]: liga({ partidos: [] }) })
    montar()
    expect(await screen.findByText('Esta liga no tiene partidos programados todavía.')).toBeTruthy()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('compilación SIN la liga del piloto (o con configuración mal formada): «no disponible» y NINGUNA petición', async () => {
    for (const valor of ['PLATINIUM-U10,PLATINIUM-U12', 'SIMULACRO-PILOTO,', '']) {
      vi.stubEnv('VITE_LIGAS_PUBLICAS', valor)
      servidor({ [RUTA_LIGA]: liga() })
      const { unmount } = montar()
      expect(await screen.findByText('Esta entrada no está disponible en esta versión de Sebel.')).toBeTruthy()
      expect(llamadas).toEqual([])
      unmount()
    }
  })

  it('/tv nunca pide otra liga aunque esté configurada (solo la del piloto)', async () => {
    servidor({ [RUTA_LIGA]: liga() })
    montar()
    await screen.findAllByRole('link')
    expect(llamadas.every((l) => l.ruta === RUTA_LIGA)).toBe(true)
  })
})

describe('Simulacro frente a las ligas reales en las vistas existentes', () => {
  it('la portada y la liga muestran el nombre «Simulacro — datos ficticios», distinto del de la liga real, también en las tarjetas', async () => {
    const real = respuestaLiga({ id: 'PLATINIUM-U10', nombre: 'Platinium U10 2026' })
    servidor({ [RUTA_LIGA]: liga(), '/v1/ligas/PLATINIUM-U10/publico': real, '/v1/ligas/PLATINIUM-U12/publico': respuestaLiga({ id: 'PLATINIUM-U12', nombre: 'Platinium U12 2026' }) })
    montar('/')
    expect(await screen.findByText(NOMBRE, { selector: '.nombre' })).toBeTruthy()
    expect(screen.getByText('Platinium U10 2026', { selector: '.nombre' })).toBeTruthy()
    cleanup()
    montar('/liga/simulacro-piloto')
    expect(await screen.findAllByText(NOMBRE)).not.toHaveLength(0)
    expect(screen.queryByText('Platinium U10 2026')).toBeNull()
  })

  it('en la portada cada fila de próximos partidos y de resultados lleva el nombre de SU liga: el partido ficticio no se confunde con uno real', async () => {
    const real = respuestaLiga({ id: 'PLATINIUM-U10', nombre: 'Platinium U10 2026', partidos: [partidoLiga({ gameId: 'R1', programadoPara: '2026-10-19T16:00:00.000Z' }), partidoLiga({ gameId: 'R2', estado: 'final', programadoPara: '2026-10-18T16:00:00.000Z', inicioReal: '2026-10-18T16:01:00.000Z', local: { id: 'E3', puntos: 20, faltas: 5 }, visita: { id: 'E4', puntos: 18, faltas: 4 } })] })
    servidor({ [RUTA_LIGA]: liga(), '/v1/ligas/PLATINIUM-U10/publico': real, '/v1/ligas/PLATINIUM-U12/publico': respuestaLiga({ id: 'PLATINIUM-U12', nombre: 'Platinium U12 2026', partidos: [] }) })
    montar('/')
    await screen.findByText('Próximos partidos')
    await waitFor(() => expect(document.querySelectorAll('.partido .fila-liga-partido').length).toBe(5))
    const porLiga = [...document.querySelectorAll('.partido')].map((f) => f.querySelector('.fila-liga-partido').textContent)
    expect(porLiga.filter((n) => n === NOMBRE)).toHaveLength(4) // los cuatro partidos del Simulacro
    expect(porLiga.filter((n) => n === 'Platinium U10 2026')).toHaveLength(1)
    expect(porLiga.every((n) => n === NOMBRE || n === 'Platinium U10 2026')).toBe(true)
  })
})
