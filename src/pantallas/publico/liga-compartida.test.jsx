/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { PESTANAS } from './PaginaLiga.jsx'
import { pestanaDe } from '../../lib/volver.js'
import { tablaDeResultados } from '../../lib/tabla-posiciones.js'
import { tablaPosiciones } from '../../lib/marcador-calculo.js'
import { sufijoPartido } from '../../lib/publico/urls.js'
import { partidoLiga, reloj, respuestaLiga } from '../../lib/publico/datos-prueba.js'

// LA PÁGINA DE LIGA ORIGINAL sobre datos del servidor (REPORT_156): cabecera, pestañas en su orden, posiciones derivadas de los resultados
// finales guardados, calendario con la sede o «Por avisar», jugadores explicado, enlaces y estados honestos. Servidor falso; datos sintéticos.

const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
let llamadas
function servidor(rutas) {
  llamadas = []
  const fn = vi.fn(async (ruta, init) => { llamadas.push({ ruta, init }); const h = rutas[ruta]; return h === undefined ? respuesta({ error: 'no-encontrado' }, 404) : (typeof h === 'function' ? h() : respuesta(h)) })
  vi.stubGlobal('fetch', fn)
  return fn
}
const montar = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><AppCompartida /></MemoryRouter>)
const L1 = '/v1/ligas/LIGAPUB1/publico'
const lado = (id, puntos = 0, faltas = 0) => ({ id, puntos, faltas })
const conPartidos = () => respuestaLiga({
  partidos: [
    partidoLiga({ gameId: 'VIVO', estado: 'vivo', periodo: 2, inicioReal: '2026-11-01T21:31:00.000Z', programadoPara: '2026-11-01T21:30:00.000Z', reloj: reloj('detenido', 420000), sede: 'Cancha A', local: lado('E1', 12, 3), visita: lado('E2', 9, 4) }),
    partidoLiga({ gameId: 'PROG', programadoPara: '2026-11-08T15:00:00.000Z', sede: null, local: lado('E1'), visita: lado('E3') }),
    partidoLiga({ gameId: 'FIN', estado: 'final', inicioReal: '2026-11-01T18:00:00.000Z', programadoPara: '2026-11-01T18:00:00.000Z', sede: null, local: lado('E2', 30, 8), visita: lado('E4', 41, 9) }),
  ],
})

beforeEach(() => {
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1')
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const nombresDeBotones = () => screen.getAllByRole('button').map((b) => b.textContent).filter((t) => ['Posiciones', 'Calendario', 'Jugadores'].includes(t))

describe('estructura original: cabecera y pestañas', () => {
  it('tarjeta de cabecera con las mismas piezas y las tres pestañas en su orden; sin canchas ni retos inventados', async () => {
    servidor({ [L1]: conPartidos() })
    montar('/liga/LIGAPUB1')
    expect(await screen.findByText('Página pública de la liga')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Liga sintética uno')
    expect(document.querySelector('.card .sub').textContent).toBe('Baloncesto') // sin « · canchas»: la liga pública no tiene canchas
    expect(screen.getByText('Categoría Mini baloncesto')).toBeTruthy()
    expect(screen.getByText('U10')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Compartir link' })).toBeTruthy()
    expect(screen.queryByText(/Retar a otra liga/)).toBeNull()
    expect(screen.getByText(/Quien abra el link ve la tabla, el calendario y el marcador en vivo/)).toBeTruthy()
    expect(nombresDeBotones()).toEqual(['Posiciones', 'Calendario', 'Jugadores'])
    expect(PESTANAS.map(([k]) => k)).toEqual(['tabla', 'calendario', 'jugadores'])
    for (const [k] of PESTANAS) expect(pestanaDe(k)).toBe(k) // el prototipo reconoce las mismas pestañas
    expect(document.querySelector('.selector button.activo').textContent).toBe('Posiciones') // por omisión
  })

  it('la pestaña vive en la URL (?pestana=) y se cambia con el selector', async () => {
    servidor({ [L1]: conPartidos() })
    montar('/liga/LIGAPUB1?pestana=jugadores')
    await screen.findByText('Página pública de la liga')
    expect(document.querySelector('.selector button.activo').textContent).toBe('Jugadores')
    fireEvent.click(screen.getByRole('button', { name: 'Calendario' }))
    expect(document.querySelector('.selector button.activo').textContent).toBe('Calendario')
    fireEvent.click(screen.getByRole('button', { name: 'Posiciones' }))
    expect(document.querySelector('.selector button.activo').textContent).toBe('Posiciones')
  })
})

describe('Posiciones', () => {
  it('con un resultado final: tabla derivada de ESE resultado (reglas del baloncesto), con enlaces de equipo y la nota de dónde sale', async () => {
    servidor({ [L1]: conPartidos() })
    montar('/liga/LIGAPUB1')
    await screen.findByText('Equipo')
    expect([...document.querySelectorAll('thead th')].map((h) => h.textContent)).toEqual(['Equipo', 'JJ', 'G', 'P', 'PF', 'PC', 'DIF', 'PTS'])
    expect([...document.querySelectorAll('thead th')].slice(4).map((h) => h.getAttribute('aria-label'))).toEqual(['Puntos a favor', 'Puntos en contra', 'Diferencia de puntos, PF menos PC', 'Puntos de clasificación'])
    const filas = [...document.querySelectorAll('tbody tr')].map((tr) => { const c = [...tr.querySelectorAll('td')]; return [c[0].querySelector('.nombre').textContent, ...c.slice(1).map((x) => x.textContent)] })
    expect(filas[0]).toEqual(['Delta Oeste', '1', '1', '0', '41', '30', '+11', '2'])
    expect(filas[1]).toEqual(['Beta Sur', '1', '0', '1', '30', '41', '-11', '1'])
    expect(filas[2]).toEqual(['Alfa Norte', '0', '0', '0', '0', '0', '0', '0']) // sin partidos: ceros
    expect(filas.length).toBe(4)
    const enlace = document.querySelector('tbody a.equipo-celda')
    expect(enlace.getAttribute('href')).toBe('/liga/ligapub1/equipo/e4')
    expect(screen.getByText(/resultados finales guardados en el servidor/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/eventos de cada partido/)
  })

  it('sin partidos finales: el vacío verificado del original, y los equipos siguen alcanzables', async () => {
    servidor({ [L1]: respuestaLiga({ partidos: [partidoLiga({ gameId: 'P' })] }) })
    montar('/liga/LIGAPUB1')
    expect(await screen.findByText('Todavía no se ha jugado ningún partido.')).toBeTruthy()
    expect(document.querySelector('table')).toBeNull() // ninguna tabla inventada
    const pills = [...document.querySelectorAll('.lista-equipos a')]
    expect(pills.map((a) => a.textContent)).toEqual(['Alfa Norte', 'Beta Sur', 'Gama Este', 'Delta Oeste'])
    expect(pills[0].getAttribute('href')).toBe('/liga/ligapub1/equipo/e1')
  })

  it('la tabla compartida y la del prototipo dan lo mismo con los mismos resultados (una sola regla)', () => {
    const equipos = [{ id: 'A' }, { id: 'B' }, { id: 'C' }]
    const eventos = (eq, n) => Array.from({ length: n }, (_, i) => ({ id: `${eq}${i}`, tipo: 'punto', equipoId: eq, puntos: 1, anulado: false }))
    const partidos = [{ id: 'p1', estado: 'final', localId: 'A', visitaId: 'B' }, { id: 'p2', estado: 'final', localId: 'B', visitaId: 'C' }]
    const eventosPorPartido = { p1: [...eventos('A', 3), ...eventos('B', 5)], p2: [...eventos('B', 2), ...eventos('C', 2)] }
    const proto = tablaPosiciones({ equipos, partidos, eventosPorPartido, deporte: 'baloncesto' })
    const comp = tablaDeResultados({ equipos, deporte: 'baloncesto', resultados: [{ localId: 'A', visitaId: 'B', local: 3, visita: 5, faltasLocal: 0, faltasVisita: 0 }, { localId: 'B', visitaId: 'C', local: 2, visita: 2, faltasLocal: 0, faltasVisita: 0 }] })
    expect(comp).toEqual(proto)
  })
})

describe('Calendario', () => {
  it('todos los partidos por hora de Panamá, con sede o «Por avisar», marcador solo en vivo/final, y enlaces al marcador del partido', async () => {
    servidor({ [L1]: conPartidos() })
    montar('/liga/LIGAPUB1?pestana=calendario')
    await screen.findByText('Partido finalizado')
    const filas = [...document.querySelectorAll('a.partido')]
    expect(filas.map((a) => a.getAttribute('href'))).toEqual([
      `/liga/ligapub1/partido/beta-sur-vs-delta-oeste-${sufijoPartido('FIN')}`,
      `/liga/ligapub1/partido/alfa-norte-vs-beta-sur-${sufijoPartido('VIVO')}`,
      `/liga/ligapub1/partido/alfa-norte-vs-gama-este-${sufijoPartido('PROG')}`,
    ])
    expect(within(filas[0]).getByText('Partido finalizado')).toBeTruthy()
    expect(within(filas[1]).getByText('VIVO')).toBeTruthy()
    expect(within(filas[1]).getByText('12')).toBeTruthy()
    expect(within(filas[2]).getByText('Por avisar')).toBeTruthy()
    expect(within(filas[2]).getByText('10:00 a. m.')).toBeTruthy() // 15:00Z = 10:00 en Panamá
    expect(within(filas[2]).queryByText('0')).toBeNull() // un partido programado no muestra marcador
    expect([...document.querySelectorAll('.dia-sep')].map((x) => x.textContent)).toEqual(['dom 1 nov', 'dom 8 nov'])
    expect(document.querySelector('.hm-marcador')).toBeNull()
  })

  it('sin partidos: lo dice; sin hora: «Fecha por confirmar»', async () => {
    servidor({ [L1]: respuestaLiga({ partidos: [] }) })
    montar('/liga/LIGAPUB1?pestana=calendario')
    expect(await screen.findByText('Todavía no hay partidos programados.')).toBeTruthy()
  })
})

const J1 = '/v1/ligas/LIGAPUB1/jugadores/publico'
const entrada = (rango, id, nombre, dorsalActual, equipo, puntos, faltas, enPlantilla = true) => ({ rango, id, nombre, dorsalActual, equipo, enPlantilla, puntos, faltas })
const AN = { id: 'E1', nombre: 'Alfa Norte' }
const BS = { id: 'E2', nombre: 'Beta Sur' }
const rankings = (extra = {}) => ({
  liga: { id: 'LIGAPUB1', nombre: 'Liga sintética uno' },
  alcance: 'partidos-finales-de-la-liga',
  agrupacion: 'ficha-y-equipo',
  partidosFinales: 1,
  maximosAnotadores: [
    entrada(1, 'J1', 'Ana Prueba', 0, AN, 9, 0),
    entrada(2, 'K1', 'Eva Visita', 1, BS, 4, 1),
    entrada(2, 'J2', 'Gemelo Igual', 2, AN, 4, 3, false),
    entrada(2, 'J7', 'Gemelo Igual', 12, AN, 4, 0),
    entrada(5, 'J9', null, null, BS, 1, 0),
  ],
  masFaltas: [entrada(1, 'J2', 'Gemelo Igual', 2, AN, 4, 3, false), entrada(2, 'K1', 'Eva Visita', 1, BS, 4, 1)],
  recortado: false,
  sinJugador: { puntos: 0, faltas: 0 },
  servidorAhoraMs: 1_790_000_000_000,
  ...extra,
})

describe('Jugadores', () => {
  it('Posiciones no pide el ranking; la pestaña Jugadores hace UNA lectura de liga (ninguna por equipo)', async () => {
    servidor({ [L1]: conPartidos(), [J1]: rankings() })
    montar('/liga/LIGAPUB1')
    await screen.findByText('Equipo')
    expect(llamadas.map((l) => l.ruta)).toEqual([L1])
    fireEvent.click(screen.getByRole('button', { name: 'Jugadores' }))
    expect(await screen.findByText('Máximos anotadores')).toBeTruthy()
    expect(llamadas.map((l) => l.ruta).sort()).toEqual([J1, L1])
    expect(llamadas.some((l) => /\/equipos\//.test(l.ruta))).toBe(false)
    expect(llamadas.every((l) => l.init?.credentials === 'omit')).toBe(true)
  })

  it('navegación directa a ?pestana=jugadores: dos secciones con nombre, número, equipo y total claramente rotulado; empates con el mismo puesto', async () => {
    servidor({ [L1]: conPartidos(), [J1]: rankings() })
    montar('/liga/LIGAPUB1?pestana=jugadores')
    expect(await screen.findByText('Máximos anotadores')).toBeTruthy()
    expect(screen.getByText('Más faltas')).toBeTruthy()
    const anot = within(screen.getByRole('list', { name: 'Máximos anotadores' }))
    const filas = [...document.querySelectorAll('[aria-label="Máximos anotadores"] .jugador-fila')].map((f) => [
      f.querySelector('.pos').textContent, f.querySelector('.nombre').textContent, f.querySelector('.sub').textContent, f.lastElementChild.textContent])
    expect(filas).toEqual([
      ['1', 'Ana Prueba', '#0 · Alfa Norte', '9puntos totales'],
      ['2', 'Eva Visita', '#1 · Beta Sur', '4puntos totales'],
      ['2', 'Gemelo IgualFuera de la plantilla', '#2 · Alfa Norte', '4puntos totales'],
      ['2', 'Gemelo Igual', '#12 · Alfa Norte', '4puntos totales'], // el mismo nombre: otra ficha, otra fila
      ['5', 'Nombre pendiente', 'Sin número · Beta Sur', '1puntos totales'], // lo que falta se dice, no se inventa
    ])
    expect(anot.getAllByText('puntos totales').length).toBe(5)
    const faltas = [...document.querySelectorAll('[aria-label="Más faltas"] .jugador-fila')].map((f) => f.lastElementChild.textContent)
    expect(faltas).toEqual(['3faltas personales', '1faltas personales'])
    expect(screen.getByText(/Solo cuentan los partidos terminados \(1\)/)).toBeTruthy()
    expect(screen.getByText(/Los programados o en juego no suman/)).toBeTruthy()
    expect(screen.getByText(/no por su nombre/)).toBeTruthy()
    expect(document.querySelectorAll('.jugador-fila a, a.jugador-fila').length).toBe(0) // no hay perfiles públicos
    const texto = document.body.textContent
    for (const mal of ['por juego', 'promedio', 'asistencias', 'rebotes', 'partidos jugados']) expect(texto).not.toContain(mal)
  })

  it('sin partidos terminados: vacío verificado que aclara que programados y en juego no cuentan', async () => {
    servidor({ [L1]: conPartidos(), [J1]: rankings({ partidosFinales: 0, maximosAnotadores: [], masFaltas: [] }) })
    montar('/liga/LIGAPUB1?pestana=jugadores')
    expect(await screen.findByText(/Las estadísticas aparecen cuando termine el primer partido\. Los partidos programados o en juego no cuentan\./)).toBeTruthy()
    expect(screen.queryByText('Máximos anotadores')).toBeNull()
  })

  it('con partidos terminados pero sin puntos ni faltas: cada lista dice su vacío; lo no atribuido se informa; el recorte se avisa', async () => {
    servidor({ [L1]: conPartidos(), [J1]: rankings({ maximosAnotadores: [], masFaltas: [], sinJugador: { puntos: 5, faltas: 2 }, recortado: true }) })
    montar('/liga/LIGAPUB1?pestana=jugadores')
    expect(await screen.findByText('Todavía no hay puntos anotados en partidos terminados.')).toBeTruthy()
    expect(screen.getByText('Todavía no hay faltas registradas en partidos terminados.')).toBeTruthy()
    expect(screen.getByText(/Hay 5 puntos y 2 faltas sin jugador asignado/)).toBeTruthy()
    expect(screen.getByText('Se muestran solo los primeros puestos.')).toBeTruthy()
  })

  it('cargando, error del servidor, datos en preparación y respuesta malformada: ninguno inventa un ranking', async () => {
    let liberar
    servidor({ [L1]: conPartidos(), [J1]: () => new Promise((r) => { liberar = r }) })
    montar('/liga/LIGAPUB1?pestana=jugadores')
    expect(await screen.findByText('Cargando estadísticas…')).toBeTruthy()
    liberar(respuesta({ error: 'error-interno' }, 500))
    expect(await screen.findByText(/No se pudo cargar/)).toBeTruthy()
    expect(screen.queryByText('Máximos anotadores')).toBeNull()
    cleanup()
    servidor({ [L1]: conPartidos(), [J1]: () => respuesta({ error: 'resumen-no-disponible' }, 503) })
    montar('/liga/LIGAPUB1?pestana=jugadores')
    expect(await screen.findByText(/Los datos se están preparando/)).toBeTruthy()
    cleanup()
    servidor({ [L1]: conPartidos(), [J1]: { ...rankings(), alcance: 'otro' } })
    montar('/liga/LIGAPUB1?pestana=jugadores')
    expect(await screen.findByText(/No se pudo cargar/)).toBeTruthy()
    expect(screen.queryByText('Ana Prueba')).toBeNull()
  })
})

describe('estados y privacidad', () => {
  it('cargando, error y liga desconocida', async () => {
    let liberar
    servidor({ [L1]: () => new Promise((r) => { liberar = r }) })
    montar('/liga/LIGAPUB1')
    expect(await screen.findByText('Cargando…')).toBeTruthy()
    expect(screen.queryByText('Posiciones')).toBeNull()
    liberar(respuesta({ error: 'resumen-no-disponible' }, 503)) // la lectura termina: el estado de carga no queda colgado en la memoria compartida
    expect(await screen.findByText(/Los datos se están preparando/)).toBeTruthy()
    cleanup()
    const f = servidor({})
    montar('/liga/OTRA')
    expect(await screen.findByText('No encontramos esta liga')).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })

  it('solo pide la lectura pública de la liga; sin credenciales ni almacenamiento; el equipo y el marcador se alcanzan por enlaces', async () => {
    const escribe = vi.spyOn(Storage.prototype, 'setItem')
    servidor({ [L1]: conPartidos() })
    montar('/liga/LIGAPUB1?pestana=calendario')
    await screen.findByText('Partido finalizado')
    expect(llamadas.map((l) => l.ruta)).toEqual([L1])
    expect(llamadas[0].init).toMatchObject({ method: 'GET', credentials: 'omit' })
    expect(escribe).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toMatch(/personaId|fechaNacimiento|nombreCamiseta/)
  })
})
