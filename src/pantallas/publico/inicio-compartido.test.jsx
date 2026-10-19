/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { paisPiloto } from '../../lib/publico/config.js'
import { sufijoPartido } from '../../lib/publico/urls.js'
import { partidoLiga, reloj, respuestaLiga } from '../../lib/publico/datos-prueba.js'

// LA PORTADA ORIGINAL sobre datos del servidor (REPORT_152): orden de las secciones, redacción original, enlaces, y los cuatro estados
// honestos (cargando, error, vacío verificado, todavía no disponible). Servidor falso; datos sintéticos.

const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
let llamadas
function servidor(rutas) {
  llamadas = []
  const fn = vi.fn(async (ruta, init) => {
    llamadas.push({ ruta, init })
    const h = rutas[ruta]
    if (h === undefined) return respuesta({ error: 'no-encontrado' }, 404)
    return typeof h === 'function' ? h() : (h instanceof Response ? h : respuesta(h))
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const montar = (ruta = '/') => render(<MemoryRouter initialEntries={[ruta]}><AppCompartida /></MemoryRouter>)
const L1 = '/v1/ligas/LIGAPUB1/publico'
const L2 = '/v1/ligas/LIGAPUB2/publico'
const vivo = () => partidoLiga({ gameId: 'V1', estado: 'vivo', periodo: 2, inicioReal: '2026-11-01T21:31:00.000Z', reloj: reloj('detenido', 420000), local: { id: 'E1', puntos: 12, faltas: 3 }, visita: { id: 'E2', puntos: 9, faltas: 4 } })
const ligaConPartidos = (extra = {}) => respuestaLiga({ partidos: [vivo(), partidoLiga({ gameId: 'P1', local: { id: 'E3', puntos: 0, faltas: 0 }, visita: { id: 'E4', puntos: 0, faltas: 0 } })], ...extra })

beforeEach(() => {
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1')
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('portada original: secciones, orden y redacción', () => {
  it('encabezado original, menú y las secciones en su orden de siempre; «Próximos partidos»; sin provincias ni canchas inventadas', async () => {
    servidor({ [L1]: ligaConPartidos() })
    montar()
    expect(await screen.findByText('Ahora mismo')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('El barrio también tiene estadísticas.')
    expect(screen.getByText(/Sin instalar nada, sin cuenta para mirar/)).toBeTruthy()
    // solo el total que se sabe: «1 liga» (ni provincias ni canchas)
    expect(document.querySelector('.hm-hero-cifras').textContent).toBe('1 liga')
    // orden de las secciones
    const titulos = ['Ahora mismo', 'Próximos partidos', 'Ligas cerca de ti', 'Figuras del barrio', 'Encuentra lo tuyo', 'Espacio patrocinado']
    const posiciones = titulos.map((t) => document.body.textContent.indexOf(t))
    expect(posiciones.every((p) => p >= 0)).toBe(true)
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones)
    // menú del original: marca, menú de escritorio y barra de pestañas con las mismas etiquetas
    expect(document.querySelector('.topbar .marca-publica').textContent).toBe('semabel.com')
    expect([...document.querySelectorAll('.nav-escritorio a')].map((a) => a.textContent)).toEqual(['Inicio', 'Siguiendo'])
    expect([...document.querySelectorAll('nav.tabbar a')].map((a) => a.textContent)).toEqual(['Inicio', 'Siguiendo'])
    // el marcador en vivo, con la tarjeta del original
    const v = document.querySelector('.hm-marcador')
    expect(v.getAttribute('href')).toBe(`/liga/ligapub1/partido/alfa-norte-vs-beta-sur-${sufijoPartido('V1')}`)
    expect(within(v).getByText('12')).toBeTruthy()
  })

  it('la portada NO lleva un botón «Acceso del organizador» (REPORT_180): el organizador entra por /ligas o por su dirección de piloto', async () => {
    servidor({ [L1]: ligaConPartidos() })
    montar()
    await screen.findByText('Ahora mismo')
    expect(screen.queryByRole('link', { name: /Acceso del organizador/ })).toBeNull()
    expect(screen.queryByText(/Acceso del organizador/)).toBeNull()
    expect(document.querySelector('.hm-organizador')).toBeNull()
    expect(document.querySelector('a[href="/organizador/acceso"]')).toBeNull()
    expect(llamadas.some((l) => l.ruta.startsWith('/v1/organizador'))).toBe(false) // la portada no pregunta por la sesión
  })
  it('Ligas cerca de ti: enlaza a la liga con la dirección aprobada y solo dice lo que se sabe', async () => {
    servidor({ [L1]: ligaConPartidos() })
    montar()
    await screen.findByText('Ligas cerca de ti')
    const fila = screen.getByText('Liga sintética uno', { selector: '.nombre' }).closest('a')
    expect(fila.getAttribute('href')).toBe('/liga/ligapub1')
    expect(fila.textContent).toContain('Baloncesto · Mini baloncesto · U10')
    expect(fila.textContent).not.toMatch(/organiza|provincia|Chiriquí|Panamá Oeste/i)
    expect(screen.getByText(/Todavía no se filtran por zona/)).toBeTruthy()
  })

  it('Figuras: sección identificable «todavía no disponible», sin clasificación inventada', async () => {
    servidor({ [L1]: ligaConPartidos() })
    montar()
    await screen.findByText('Figuras del barrio')
    expect(screen.getByText(/Todavía no disponible: las figuras se calcularán/)).toBeTruthy()
    expect(document.querySelector('.podio')).toBeNull()
    expect(document.body.textContent).not.toMatch(/por juego/)
  })

  it('Buscador: dice qué busca; encuentra equipos con su enlace y NO jugadores', async () => {
    servidor({ [L1]: ligaConPartidos() })
    montar()
    const campo = await screen.findByPlaceholderText('Tu liga o tu equipo')
    expect(screen.getByText(/La búsqueda de jugadores todavía no está disponible/)).toBeTruthy()
    fireEvent.change(campo, { target: { value: 'alfa' } })
    const hallazgo = screen.getByText('Alfa Norte', { selector: '.nombre' }).closest('a')
    expect(hallazgo.getAttribute('href')).toBe('/liga/ligapub1/equipo/e1')
    fireEvent.change(campo, { target: { value: 'Ana Prueba' } })
    expect(screen.getByText(/No encontramos nada con «Ana Prueba»/)).toBeTruthy()
  })

  it('Espacio patrocinado: el espacio original, sin patrocinadores inventados', async () => {
    servidor({ [L1]: ligaConPartidos() })
    montar()
    await screen.findByText('Espacio patrocinado')
    expect(document.querySelector('.banner .marca-patro').textContent).toBe('TULOGO')
  })
})

describe('estados honestos', () => {
  it('cargando: no afirma vacíos ni totales', async () => {
    servidor({ [L1]: () => new Promise(() => {}) })
    montar()
    expect(await screen.findAllByText('Cargando…')).toBeTruthy()
    expect(screen.queryByText('Ahora mismo')).toBeNull()
    expect(document.body.textContent).not.toMatch(/0 ligas|No hay partidos/)
  })

  it('error del servidor: lo dice con su motivo y no muestra secciones vacías', async () => {
    servidor({ [L1]: respuesta({ error: 'resumen-no-disponible' }, 503) })
    montar()
    expect(await screen.findByText(/Los datos se están preparando/)).toBeTruthy()
    expect(screen.queryByText('Ahora mismo')).toBeNull()
  })

  it('vacío VERIFICADO: sin partidos, con todas las ligas leídas, se dice con la redacción original', async () => {
    servidor({ [L1]: respuestaLiga({ partidos: [] }) })
    montar()
    expect(await screen.findByText('No hay partidos jugándose en este momento. Prueba «Próximos partidos».')).toBeTruthy()
    expect(screen.getByText('No hay partidos programados con ese filtro.')).toBeTruthy()
  })

  it('una liga falla y otra no: avisa cuál y NO afirma que no hay partidos', async () => {
    vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1,LIGAPUB2')
    servidor({ [L1]: respuestaLiga({ partidos: [] }), [L2]: respuesta({ error: 'x' }, 500) })
    montar()
    expect(await screen.findByText(/No se pudieron cargar todas las ligas \(LIGAPUB2\)/)).toBeTruthy()
    expect(screen.getByText(/todavía no sabemos si hay partidos jugándose/)).toBeTruthy()
    expect(screen.queryByText(/No hay partidos jugándose en este momento/)).toBeNull()
  })
})

describe('configuración', () => {
  it('el país del piloto es explícito: Panamá por omisión y solo un código de dos letras mayúsculas', () => {
    expect(paisPiloto()).toBe('PA')
    vi.stubEnv('VITE_PAIS_PILOTO', 'CO')
    expect(paisPiloto()).toBe('CO')
    vi.stubEnv('VITE_PAIS_PILOTO', 'colombia')
    expect(paisPiloto()).toBe('PA')
  })

  it('la portada solo pide la lectura pública de cada liga (sin sesión, cookies ni rutas protegidas) y no escribe almacenamiento', async () => {
    const escribe = vi.spyOn(Storage.prototype, 'setItem')
    servidor({ [L1]: ligaConPartidos() })
    montar()
    await screen.findByText('Ahora mismo')
    expect(llamadas.map((l) => l.ruta)).toEqual([L1])
    expect(llamadas[0].init).toMatchObject({ method: 'GET', credentials: 'omit' })
    expect(escribe).not.toHaveBeenCalled()
  })
})
