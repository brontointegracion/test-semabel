/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { partidoLiga, reloj, respuestaJuego, respuestaLiga, SERVIDOR_MS } from '../../lib/publico/datos-prueba.js'
import { sufijoPartido } from '../../lib/publico/urls.js'

// PANTALLAS PÚBLICAS (modo compartido) con un servidor FALSO y datos sintéticos. Ninguna lee la base local ni el prototipo.

const JSON_H = { 'content-type': 'application/json' }
const respuesta = (cuerpo, status = 200, cabeceras = {}) => new Response(JSON.stringify(cuerpo), { status, headers: { ...JSON_H, ...cabeceras } })
let llamadas

function servidor(rutas) {
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

const L = (id, puntos = 0, faltas = 0) => ({ id, puntos, faltas })
const ligaUno = () => respuestaLiga({
  partidos: [
    partidoLiga({ gameId: 'V1', estado: 'vivo', periodo: 2, inicioReal: '2026-11-01T21:31:00.000Z', reloj: reloj('detenido', 420000), sede: 'Cancha A', local: { id: 'E1', puntos: 12, faltas: 3 }, visita: { id: 'E2', puntos: 9, faltas: 4 } }),
    partidoLiga({ gameId: 'ATRASADO', estado: 'programado', programadoPara: '2026-11-01T20:00:00.000Z', sede: 'Cancha B', local: L('E3'), visita: L('E4') }),
    partidoLiga({ gameId: 'FUTURO', estado: 'programado', programadoPara: '2026-11-08T15:00:00.000Z', sede: null, local: L('E1'), visita: L('E3') }),
    partidoLiga({ gameId: 'FIN', estado: 'final', inicioReal: '2026-11-01T18:00:00.000Z', local: { id: 'E2', puntos: 30, faltas: 8 }, visita: { id: 'E4', puntos: 41, faltas: 9 } }),
  ],
})

// REPORT_158: la dirección de un partido se resuelve contra la lectura de la liga; los partidos sintéticos de estas pruebas están en ella.
const ligaConJuegos = (...ids) => respuestaLiga({ partidos: ids.map((gameId) => partidoLiga({ gameId })) })
const urlAlfaBeta = (gameId) => `/liga/ligapub1/partido/alfa-norte-vs-beta-sur-${sufijoPartido(gameId)}`
const pedidosDeJuego = () => llamadas.filter((l) => l.ruta.includes('/partidos/')).length
const montar = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><AppCompartida /></MemoryRouter>)
const hoy = (o = {}) => ({ ruta: '/v1/ligas/LIGAPUB1/publico', ...o })

beforeEach(() => {
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1')
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Inicio público', () => {
  it('Ahora mismo (vivo) y Próximos partidos (programado, también el atrasado); nunca «Soy organizador»; solo las lecturas públicas, sin credenciales', async () => {
    servidor({ '/v1/ligas/LIGAPUB1/publico': ligaUno() })
    montar('/')
    expect(await screen.findByText('Ahora mismo')).toBeTruthy()
    expect(screen.getByText('Próximos partidos')).toBeTruthy() // el título original de la portada
    const vivo = document.querySelector('.hm-marcador')
    expect(vivo.getAttribute('href')).toBe(urlAlfaBeta('V1'))
    expect(within(vivo).getByText('12')).toBeTruthy()
    expect(within(vivo).getByText('9')).toBeTruthy()
    expect(within(vivo).getByText('2º cuarto')).toBeTruthy()
    expect(within(vivo).getByText('07:00')).toBeTruthy()
    expect(within(vivo).getByText('Cancha A · Reloj detenido')).toBeTruthy()
    // el atrasado sigue entre los próximos, rotulado; el futuro no lo está
    const atrasado = screen.getByText('Pendiente de comenzar').closest('a')
    expect(within(atrasado).getByText('Gama Este')).toBeTruthy()
    expect(within(atrasado).getByText('Cancha B')).toBeTruthy()
    expect(within(atrasado).getByText('3:00 p. m.')).toBeTruthy() // 20:00Z = 15:00 en Panamá
    expect(screen.getAllByText('Pendiente de comenzar').length).toBe(1)
    // el final no sale en Inicio
    expect(document.body.textContent).not.toContain('41')
    expect(screen.queryByText('Soy organizador')).toBeNull()
    expect(screen.queryByText(/provincia/i)).toBeNull()
    expect(screen.queryByText('Última jugada')).toBeNull()
    // peticiones: una lectura pública de la liga, GET, sin credenciales ni rutas protegidas
    expect(llamadas.map((l) => l.ruta)).toEqual(['/v1/ligas/LIGAPUB1/publico'])
    for (const l of llamadas) {
      expect(l.init).toMatchObject({ method: 'GET', credentials: 'omit' })
      expect(l.ruta).not.toMatch(/estado|preparacion|comandos|_semilla|organizador|anthony|admin/)
      expect(JSON.stringify(l.init.headers)).not.toMatch(/authorization|cookie/i)
    }
  })

  it('enlaza sin credenciales al marcador y de ahí a la liga', async () => {
    servidor({ '/v1/ligas/LIGAPUB1/publico': ligaUno(), '/v1/ligas/LIGAPUB1/partidos/V1': respuestaJuego({ gameId: 'V1' }) })
    montar('/')
    await screen.findByText('Ahora mismo')
    fireEvent.click(document.querySelector('.hm-marcador'))
    expect(await screen.findByText('Faltas del partido')).toBeTruthy()
    fireEvent.click(screen.getByText('‹ Salir')) // llegó desde Inicio: vuelve a Inicio
    expect(await screen.findByText('Ahora mismo')).toBeTruthy()
  })

  it('sin ligas configuradas (por defecto) no pide nada y muestra «en preparación»', async () => {
    vi.stubEnv('VITE_LIGAS_PUBLICAS', '')
    const f = servidor({})
    montar('/')
    expect(await screen.findByText(/Estamos preparando los resultados/)).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })

  it('una configuración mal formada falla cerrada: nada se pide', async () => {
    vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1,,OTRA')
    const f = servidor({})
    montar('/')
    expect(await screen.findByText(/Estamos preparando los resultados/)).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })

  it('los filtros solo ofrecen lo que los datos respaldan: con una liga y una categoría no hay chips; con dos ligas aparecen los de liga', async () => {
    servidor({ '/v1/ligas/LIGAPUB1/publico': ligaUno() })
    montar('/')
    await screen.findByText('Ahora mismo')
    expect(screen.queryByText('Todas las ligas')).toBeNull()
    expect(screen.queryByText('Toda edad')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    cleanup()

    vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1,LIGAPUB2')
    const dos = respuestaLiga({ id: 'LIGAPUB2', nombre: 'Liga dos', partidos: [partidoLiga({ gameId: 'W1', estado: 'vivo', inicioReal: '2026-11-01T21:31:00.000Z', reloj: reloj('detenido', 1000) })] })
    dos.liga.categoria = 'adult'
    dos.liga.subcategoria = { texto: 'Sub Elite' }
    servidor({ '/v1/ligas/LIGAPUB1/publico': ligaUno(), '/v1/ligas/LIGAPUB2/publico': dos })
    montar('/')
    expect(await screen.findByText('Toda edad')).toBeTruthy() // dos categorías distintas
    expect(screen.queryByText('Todas las ligas')).toBeNull() // la portada original no filtra por liga
    expect(screen.queryByRole('tab')).toBeNull() // un solo deporte
    fireEvent.click(screen.getByRole('button', { name: 'Adulto' }))
    expect([...document.querySelectorAll('.hm-marcador-liga')].map((x) => x.textContent)).toEqual(['Liga dos'])
  })

  it('no usa la base local ni el almacenamiento: con la demostración del prototipo guardada, no aparece y nada se escribe', async () => {
    const { sembrarSiHaceFalta } = await import('../../seed')
    await sembrarSiHaceFalta()
    const { db } = await import('../../db')
    const demo = (await db.ligas.toArray()).map((l) => l.nombre)
    const antes = { ligas: await db.ligas.count(), meta: await db.meta.count() }
    const escribe = vi.spyOn(Storage.prototype, 'setItem')
    servidor({ '/v1/ligas/LIGAPUB1/publico': ligaUno() })
    montar('/')
    await screen.findByText('Ahora mismo')
    for (const n of demo) expect(document.body.textContent).not.toContain(n)
    expect(escribe).not.toHaveBeenCalled()
    expect({ ligas: await db.ligas.count(), meta: await db.meta.count() }).toEqual(antes)
  })

  it('error: 503 resumen-no-disponible → «se están preparando»; respuesta mal formada → «No se pudo cargar»; nada de datos inventados', async () => {
    servidor({ '/v1/ligas/LIGAPUB1/publico': respuesta({ error: 'resumen-no-disponible' }, 503) })
    montar('/')
    expect(await screen.findByText(/Los datos se están preparando/)).toBeTruthy()
    expect(screen.queryByText('Ahora mismo')).toBeNull()
    cleanup()
    const malo = ligaUno()
    malo.partidos[0].local.puntos = 'doce'
    servidor({ '/v1/ligas/LIGAPUB1/publico': malo })
    montar('/')
    expect(await screen.findByText(/No se pudo cargar/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('Alfa Norte')
  })
})

describe('Liga pública', () => {
  it('la página de liga original: categoría y subcategoría, pestañas en su orden, calendario con enlaces al marcador y sin enlaces a perfiles', async () => {
    servidor({ '/v1/ligas/LIGAPUB1/publico': ligaUno() })
    montar('/liga/LIGAPUB1?pestana=calendario')
    expect(await screen.findByText('Categoría Mini baloncesto')).toBeTruthy()
    expect(screen.getByText('U10')).toBeTruthy()
    expect(screen.getAllByRole('button').map((b) => b.textContent).filter((t) => ['Posiciones', 'Calendario', 'Jugadores'].includes(t))).toEqual(['Posiciones', 'Calendario', 'Jugadores'])
    const fin = document.querySelector(`a.partido[href$="-${sufijoPartido('FIN')}"]`)
    expect(within(fin).getByText('30')).toBeTruthy()
    expect(within(fin).getByText('41')).toBeTruthy()
    expect(within(fin).getByText('Partido finalizado')).toBeTruthy()
    expect(fin.getAttribute('href')).toBe(`/liga/ligapub1/partido/beta-sur-vs-delta-oeste-${sufijoPartido('FIN')}`)
    // los enlaces de la página (la barra de pestañas del original queda fuera de `.contenido`)
    const enlaces = [...document.querySelector('.contenido').querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(enlaces.filter((h) => /^\/(e|j|c|p|l)\//.test(h))).toEqual([])
    expect(enlaces.every((h) => h === '/' || h.startsWith('/liga/'))).toBe(true)
  })

  it('metadatos nulos: sin categoría, sin sede (programado → «Por avisar»), sin hora → nada inventado', async () => {
    const r = respuestaLiga({ partidos: [partidoLiga({ gameId: 'X', programadoPara: null, sede: null })] })
    r.liga.categoria = null
    r.liga.subcategoria = null
    servidor({ '/v1/ligas/LIGAPUB1/publico': r })
    montar('/liga/LIGAPUB1?pestana=calendario')
    expect(await screen.findByText('Fecha por confirmar')).toBeTruthy()
    expect(screen.queryByText(/Categoría/)).toBeNull()
    expect(screen.queryByText('Cancha A')).toBeNull()
    expect(screen.getByText(/por avisar/i)).toBeTruthy()
  })

  it('una liga que no está en la configuración no genera ninguna petición; una liga inexistente en el servidor (404) se informa', async () => {
    const f = servidor({})
    montar('/liga/OTRA')
    expect(await screen.findByText('No encontramos esta liga')).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
    cleanup()
    servidor({}) // todo 404
    montar('/liga/LIGAPUB1')
    expect(await screen.findByText('No encontramos esta liga')).toBeTruthy()
  })
})

describe('Compartir partido en el marcador público (REPORT_179)', () => {
  const abrirCon = async (sobre = {}, ruta = '/liga/LIGAPUB1/partido/G1') => {
    servidor({ '/v1/ligas/LIGAPUB1/publico': ligaConJuegos('G1'), '/v1/ligas/LIGAPUB1/partidos/G1': respuestaJuego(sobre) })
    montar(ruta)
    await screen.findByLabelText('Puntos de Alfa Norte')
  }
  const enlaceWa = () => screen.getByRole('link', { name: 'Compartir por WhatsApp' }).getAttribute('href')
  const textoWa = () => decodeURIComponent(enlaceWa().slice('https://wa.me/?text='.length))
  const canonica = () => `${window.location.origin}${urlAlfaBeta('G1')}`
  const antesClip = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  afterEach(() => { if (antesClip) Object.defineProperty(navigator, 'clipboard', antesClip); else delete navigator.clipboard })

  it('el botón «Compartir partido» abre la hoja sin pedir nada ni abrir WhatsApp; el enlace es el canónico (minúsculas, sufijo estable, sin fecha) del origen ACTUAL', async () => {
    await abrirCon()
    const pedidos = llamadas.length
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    fireEvent.click(screen.getByRole('button', { name: 'Compartir partido' }))
    expect(llamadas.length).toBe(pedidos)
    expect(abrir).not.toHaveBeenCalled()
    expect(textoWa()).toContain(canonica())
    expect(canonica()).toMatch(/^https?:\/\/[^/]+\/liga\/ligapub1\/partido\/alfa-norte-vs-beta-sur-[0-9a-z]{6}$/)
    expect(canonica()).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(textoWa()).not.toMatch(/semabel\.com|localhost:8802/)
    expect(screen.getByLabelText('Enlace del partido').value).toBe(canonica())
  })

  it('entrando por el id completo del partido (compatibilidad) se comparte igualmente la dirección canónica, no la del id', async () => {
    await abrirCon({}, '/liga/LIGAPUB1/partido/G1')
    fireEvent.click(screen.getByRole('button', { name: 'Compartir partido' }))
    expect(screen.getByLabelText('Enlace del partido').value).toBe(canonica())
    expect(screen.getByLabelText('Enlace del partido').value).not.toMatch(/partido\/G1$/)
  })

  it('el texto respeta el estado: en vivo no parece próximo; programado con fecha y sede; sin fecha lo dice; terminado da el resultado', async () => {
    await abrirCon({ estado: 'vivo' })
    fireEvent.click(screen.getByRole('button', { name: 'Compartir partido' }))
    expect(textoWa()).toContain('En vivo ahora.')
    expect(textoWa()).not.toMatch(/por confirmar|próximo/i)
    cleanup()
    await abrirCon({ estado: 'programado', inicioReal: null, programadoPara: '2026-11-01T20:00:00.000Z', sede: 'Cancha A', reloj: { estado: null, restanteMs: null, desdeMs: null }, local: { id: 'E1', nombre: 'Alfa Norte', puntos: 0, faltas: 0 }, visita: { id: 'E2', nombre: 'Beta Sur', puntos: 0, faltas: 0 } })
    fireEvent.click(screen.getByRole('button', { name: 'Compartir partido' }))
    expect(textoWa()).toContain('dom 1 nov, 3:00 p. m. (hora de Panamá)')
    expect(textoWa()).toContain('Sede: Cancha A')
    cleanup()
    await abrirCon({ estado: 'programado', inicioReal: null, programadoPara: null, sede: null, reloj: { estado: null, restanteMs: null, desdeMs: null }, local: { id: 'E1', nombre: 'Alfa Norte', puntos: 0, faltas: 0 }, visita: { id: 'E2', nombre: 'Beta Sur', puntos: 0, faltas: 0 } })
    fireEvent.click(screen.getByRole('button', { name: 'Compartir partido' }))
    expect(textoWa()).toContain('Fecha y hora por confirmar')
    expect(textoWa()).toContain('Sede: Por avisar')
    cleanup()
    await abrirCon({ estado: 'final', local: { id: 'E1', nombre: 'Alfa Norte', puntos: 31, faltas: 3 }, visita: { id: 'E2', nombre: 'Beta Sur', puntos: 28, faltas: 4 } })
    fireEvent.click(screen.getByRole('button', { name: 'Compartir partido' }))
    expect(textoWa()).toContain('Alfa Norte 31–28 Beta Sur')
    expect(textoWa()).toContain('Resultado final.')
  })

  it('«Copiar enlace»: copia solo la URL y dice «Enlace copiado.»; si el navegador lo niega, lo dice y deja el campo seleccionable', async () => {
    await abrirCon()
    const escribir = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escribir }, configurable: true })
    fireEvent.click(screen.getByRole('button', { name: 'Compartir partido' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace' })) })
    expect(escribir).toHaveBeenCalledWith(canonica())
    expect(screen.getByText('Enlace copiado.')).toBeTruthy()
    escribir.mockRejectedValueOnce(new Error('denegado'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace' })) })
    expect(screen.getByText(/No se pudo copiar el enlace/)).toBeTruthy()
    expect(screen.queryByText('Enlace copiado.')).toBeNull()
    expect(document.activeElement).toBe(screen.getByLabelText('Enlace del partido'))
  })

  it('«Salir» y la pantalla completa siguen donde estaban; la hoja no cambia el marcador', async () => {
    await abrirCon()
    expect(screen.getByRole('button', { name: 'Pantalla completa' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ver liga' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Compartir partido' }))
    expect(screen.getByLabelText('Puntos de Alfa Norte').textContent).toBe('12')
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByLabelText('Enlace del partido')).toBeNull()
  })
})

describe('Marcador público: alcance de las faltas de equipo (REPORT_175)', () => {
  const lados = (fp) => ({
    local: { id: 'E1', nombre: 'Alfa Norte', puntos: 12, faltas: 7, faltasPeriodo: fp ? 2 : null },
    visita: { id: 'E2', nombre: 'Beta Sur', puntos: 9, faltas: 4, faltasPeriodo: fp ? 1 : null },
  })
  const ver = async (sobre) => {
    servidor({ '/v1/ligas/LIGAPUB1/publico': ligaConJuegos('G1'), '/v1/ligas/LIGAPUB1/partidos/G1': respuestaJuego(sobre) })
    montar('/liga/LIGAPUB1/partido/G1')
    await screen.findByLabelText('Puntos de Alfa Norte')
  }
  const seccion = () => document.querySelector('.faltas-partido')
  it('«periodo» (Mini): muestra la cuenta del periodo con su propio título, no el total', async () => {
    await ver({ faltasEquipo: 'periodo', ...lados(true) })
    expect(screen.getByText('Faltas del período')).toBeTruthy()
    expect(screen.queryByText('Faltas del partido')).toBeNull()
    expect(seccion().textContent).toContain('2')
    expect(seccion().textContent).not.toContain('7')
  })
  it('«partido» (Intermedia, Adulto, Veteranos) y servidor anterior sin el campo: total de partido', async () => {
    await ver({ faltasEquipo: 'partido', ...lados(false) })
    expect(screen.getByText('Faltas del partido')).toBeTruthy()
    expect(seccion().textContent).toContain('7')
    cleanup()
    await ver({})
    expect(screen.getByText('Faltas del partido')).toBeTruthy()
  })
  it('«no-disponible» (reglas guardadas inválidas): no se inventa un alcance; se dice, y no hay sección de faltas ni total', async () => {
    await ver({ faltasEquipo: 'no-disponible', ...lados(false) })
    expect(seccion()).toBeNull()
    expect(screen.getByText('Faltas de equipo no disponibles')).toBeTruthy()
    expect(screen.queryByText(/Faltas del (partido|período)/)).toBeNull()
    expect(screen.getByLabelText('Puntos de Alfa Norte').textContent).toBe('12')
  })
  it('«oculto» (Baby): la sección de faltas no existe, el resto del tablero sigue', async () => {
    await ver({ faltasEquipo: 'oculto', ...lados(false) })
    expect(seccion()).toBeNull()
    expect(screen.queryByText(/Faltas del/)).toBeNull()
    expect(screen.getByLabelText('Puntos de Alfa Norte').textContent).toBe('12')
    expect(screen.getByLabelText('Reloj del partido')).toBeTruthy()
    expect(screen.getByText('Pantalla completa')).toBeTruthy()
  })
})

describe('Marcador público', () => {
  it('muestra nombres, puntos grandes, periodo, reloj, «Faltas del partido», sede, fecha de Panamá y la marca semabel.com', async () => {
    servidor({ '/v1/ligas/LIGAPUB1/publico': ligaConJuegos('G1', 'G2'), '/v1/ligas/LIGAPUB1/partidos/G1': respuestaJuego() })
    montar('/liga/LIGAPUB1/partido/G1')
    expect(await screen.findByText('Faltas del partido')).toBeTruthy()
    expect(screen.getByText('Alfa Norte', { selector: '.corto' })).toBeTruthy()
    expect(screen.getByLabelText('Puntos de Alfa Norte').textContent).toBe('12')
    expect(screen.getByLabelText('Puntos de Beta Sur').textContent).toBe('9')
    expect(screen.getByText('Periodo 2')).toBeTruthy()
    expect(screen.getByLabelText('Reloj del partido').textContent).toBe('07:00')
    expect(screen.getByText('Reloj detenido')).toBeTruthy()
    expect(screen.getByText('EN VIVO')).toBeTruthy()
    expect(screen.getByText('Cancha A')).toBeTruthy()
    expect(screen.getByText(/dom 1 nov · 4:30 p. m./)).toBeTruthy() // 21:30Z = 16:30 en Panamá
    expect(screen.getByText('semabel.com')).toBeTruthy()
    expect(screen.getByText('Pantalla completa')).toBeTruthy()
    expect(screen.queryByText(/Faltas por periodo|posesión|Última jugada/i)).toBeNull()
    expect(document.title).toContain('Alfa Norte 12-9 Beta Sur')
  })

  it('00:00 no es final; final no muestra reloj; programado atrasado dice «Pendiente de comenzar»', async () => {
    servidor({ '/v1/ligas/LIGAPUB1/publico': ligaConJuegos('G1', 'G2'), '/v1/ligas/LIGAPUB1/partidos/G1': respuestaJuego({ reloj: reloj('detenido', 0) }) })
    montar('/liga/LIGAPUB1/partido/G1')
    expect(await screen.findByText('Fin del período')).toBeTruthy()
    expect(screen.getByText('EN VIVO')).toBeTruthy()
    expect(screen.queryByText('Final')).toBeNull()
    cleanup()
    servidor({ '/v1/ligas/LIGAPUB1/publico': ligaConJuegos('G1', 'G2'), '/v1/ligas/LIGAPUB1/partidos/G1': respuestaJuego({ estado: 'final', reloj: reloj('detenido', 0) }) })
    montar('/liga/LIGAPUB1/partido/G1')
    expect(await screen.findByText('Final')).toBeTruthy()
    expect(screen.queryByLabelText('Reloj del partido')).toBeNull()
    expect(screen.queryByText('EN VIVO')).toBeNull()
    cleanup()
    servidor({ '/v1/ligas/LIGAPUB1/publico': ligaConJuegos('G1', 'G2'), '/v1/ligas/LIGAPUB1/partidos/G1': respuestaJuego({ estado: 'programado', inicioReal: null, programadoPara: '2026-11-01T20:00:00.000Z', reloj: { estado: null, restanteMs: null, desdeMs: null }, local: { id: 'E1', nombre: 'Alfa Norte', puntos: 0, faltas: 0 }, visita: { id: 'E2', nombre: 'Beta Sur', puntos: 0, faltas: 0 } }) })
    montar('/liga/LIGAPUB1/partido/G1')
    expect(await screen.findByText('Por jugar')).toBeTruthy()
    expect(screen.getByText('Pendiente de comenzar')).toBeTruthy()
    expect(screen.getByText('3:00 p. m.')).toBeTruthy()
  })

  it('IDs inválidos, ligas fuera de la configuración y partidos inexistentes: «No encontramos este partido» sin pedir lo que no corresponde', async () => {
    const f = servidor({})
    montar('/liga/OTRA/partido/G1')
    expect(await screen.findByText('No encontramos este partido')).toBeTruthy()
    cleanup()
    montar('/liga/LIGAPUB1/partido/a%20b')
    expect(await screen.findByText('No encontramos este partido')).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
    cleanup()
    servidor({ '/v1/ligas/LIGAPUB1/publico': ligaConJuegos('G1') })
    montar('/liga/LIGAPUB1/partido/NOEXISTE')
    expect(await screen.findByText('No encontramos este partido')).toBeTruthy()
    // solo se lee la liga (para resolver la dirección): un partido que no existe en ella no genera ninguna lectura de partido
    expect(llamadas.map((l) => l.ruta)).toEqual(['/v1/ligas/LIGAPUB1/publico'])
  })

  it('pantalla completa: el botón la pide sobre el tablero y la deja', async () => {
    servidor({ '/v1/ligas/LIGAPUB1/publico': ligaConJuegos('G1', 'G2'), '/v1/ligas/LIGAPUB1/partidos/G1': respuestaJuego() })
    montar('/liga/LIGAPUB1/partido/G1')
    const boton = await screen.findByText('Pantalla completa')
    const pedir = vi.fn().mockResolvedValue(undefined)
    Element.prototype.requestFullscreen = pedir
    fireEvent.click(boton)
    expect(pedir).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'fullscreenElement', { value: document.body, configurable: true })
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')) })
    expect(screen.getByText('Salir de pantalla completa')).toBeTruthy()
    expect(document.querySelector('.board.pantalla-completa')).not.toBeNull()
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
    delete Element.prototype.requestFullscreen
  })
})

describe('reloj alineado con el servidor, frescura y ciclo de vida (tiempo simulado)', () => {
  const FALSOS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance']
  const avanzar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

  it('con el reloj del dispositivo adelantado años, el reloj del partido sigue a la hora del SERVIDOR', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    vi.setSystemTime(new Date('2035-06-01T00:00:00Z')) // el dispositivo cree estar en 2035; el servidor, en 2026
    const t0 = performance.now()
    servidor({
      '/v1/ligas/LIGAPUB1/publico': ligaConJuegos('G1', 'G2'),
      '/v1/ligas/LIGAPUB1/partidos/G1': () => {
        const servidorAhoraMs = SERVIDOR_MS + Math.round(performance.now() - t0)
        return respuestaJuego({ servidorAhoraMs, reloj: reloj('corriendo', 300000, servidorAhoraMs - 10_000) })
      },
    })
    montar('/liga/LIGAPUB1/partido/G1')
    await avanzar(10)
    expect(screen.getByLabelText('Reloj del partido').textContent).toBe('04:50')
    await avanzar(3000)
    expect(screen.getByLabelText('Reloj del partido').textContent).toBe('04:47')
    expect(screen.queryByText('Sin actualizar')).toBeNull()
  })

  it('refresco cada 5 s en vivo; si falla, se conserva el dato y se dice «Sin actualizar»; al recuperarse desaparece', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    let modo = 'ok'
    const f = servidor({
      '/v1/ligas/LIGAPUB1/publico': ligaConJuegos('G1', 'G2'),
      '/v1/ligas/LIGAPUB1/partidos/G1': () => {
        if (modo === 'falla') return respuesta({ error: 'x' }, 500)
        return respuestaJuego({ servidorAhoraMs: SERVIDOR_MS + Math.round(performance.now()) })
      },
    })
    montar('/liga/LIGAPUB1/partido/G1')
    await avanzar(10)
    expect(pedidosDeJuego()).toBe(1)
    await avanzar(5000)
    expect(pedidosDeJuego()).toBe(2)
    modo = 'falla'
    await avanzar(5000)
    expect(pedidosDeJuego()).toBe(3)
    expect(screen.getByText(/Sin actualizar · último dato confirmado a las/)).toBeTruthy()
    expect(screen.getByLabelText('Puntos de Alfa Norte').textContent).toBe('12') // el dato sigue ahí
    expect(document.body.textContent).not.toContain('Última jugada')
    modo = 'ok'
    await avanzar(10_000)
    await avanzar(20_000)
    expect(screen.queryByText(/Sin actualizar/)).toBeNull()
    expect(screen.queryByText(/Actualizado/)).toBeNull() // la hora de actualización ya no se muestra de rutina (REPORT_160)
  })

  it('un reloj en marcha cuyo dato se vuelve viejo se congela con «Sin actualizar» (no sigue contando indefinidamente)', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    let caida = false
    const t0 = performance.now()
    servidor({
      '/v1/ligas/LIGAPUB1/publico': ligaConJuegos('G1', 'G2'),
      '/v1/ligas/LIGAPUB1/partidos/G1': () => {
        if (caida) throw new TypeError('sin red')
        const servidorAhoraMs = SERVIDOR_MS + Math.round(performance.now() - t0)
        return respuestaJuego({ servidorAhoraMs, reloj: reloj('corriendo', 300000, servidorAhoraMs) })
      },
    })
    montar('/liga/LIGAPUB1/partido/G1')
    await avanzar(10)
    caida = true
    await avanzar(10_000)
    const durante = screen.getByLabelText('Reloj del partido').textContent
    await avanzar(120_000)
    const despues = screen.getByLabelText('Reloj del partido').textContent
    expect(screen.getByText('Sin actualizar', { selector: '.nota-estado' })).toBeTruthy()
    // pasados más de 3 periodos sin dato, el reloj deja de avanzar (queda en el último valor confirmado)
    await avanzar(120_000)
    expect(screen.getByLabelText('Reloj del partido').textContent).toBe(despues)
    expect(durante).not.toBe('')
  })

  it('un salto del reloj del dispositivo invalida la muestra hasta la siguiente respuesta', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    const t0 = performance.now()
    servidor({
      '/v1/ligas/LIGAPUB1/publico': ligaConJuegos('G1', 'G2'),
      '/v1/ligas/LIGAPUB1/partidos/G1': () => {
        const servidorAhoraMs = SERVIDOR_MS + Math.round(performance.now() - t0)
        return respuestaJuego({ servidorAhoraMs, reloj: reloj('corriendo', 300000, servidorAhoraMs) })
      },
    })
    montar('/liga/LIGAPUB1/partido/G1')
    await avanzar(10)
    expect(screen.queryByText('Sin actualizar')).toBeNull()
    vi.setSystemTime(Date.now() + 3 * 3600_000) // el reloj de pared salta tres horas; el monotónico, no
    await avanzar(600)
    expect(screen.getAllByText(/Sin actualizar/).length).toBeGreaterThan(0)
  })

  it('pestaña oculta: no hay peticiones; al verse otra vez se pide; al desmontar, nada más', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    const f = servidor({ '/v1/ligas/LIGAPUB1/publico': ligaConJuegos('G1', 'G2'), '/v1/ligas/LIGAPUB1/partidos/G1': () => respuestaJuego({ servidorAhoraMs: SERVIDOR_MS + Math.round(performance.now()) }) })
    const { unmount } = montar('/liga/LIGAPUB1/partido/G1')
    await avanzar(10)
    const total = () => f.mock.calls.length
    expect(pedidosDeJuego()).toBe(1)
    const alOcultar = total()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await avanzar(120_000)
    expect(total()).toBe(alOcultar)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(pedidosDeJuego()).toBe(2)
    const alVer = total()
    unmount()
    await avanzar(600_000)
    expect(total()).toBe(alVer)
  })

  it('el catálogo se pide una vez por minuto, y Inicio y Liga montados juntos comparten la misma petición', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    const f = servidor({ '/v1/ligas/LIGAPUB1/publico': () => ({ ...ligaUno(), servidorAhoraMs: SERVIDOR_MS + Math.round(performance.now()) }) })
    montar('/')
    await avanzar(10)
    expect(f).toHaveBeenCalledTimes(1)
    await avanzar(59_000)
    expect(f).toHaveBeenCalledTimes(1)
    await avanzar(1_100)
    expect(f).toHaveBeenCalledTimes(2)
    await avanzar(180_000)
    expect(f.mock.calls.length).toBeLessThanOrEqual(5)
  })

  it('al cambiar de partido por la ruta nunca se ve el anterior, aunque su respuesta llegue tarde', async () => {
    let soltarG1
    servidor({
      '/v1/ligas/LIGAPUB1/publico': ligaConJuegos('G1', 'G2'),
      '/v1/ligas/LIGAPUB1/partidos/G1': () => new Promise((res) => { soltarG1 = () => res(respuestaJuego({ gameId: 'G1' })) }),
      '/v1/ligas/LIGAPUB1/partidos/G2': respuestaJuego({ gameId: 'G2', local: { id: 'E1', nombre: 'Equipo Dos', puntos: 5, faltas: 1 }, visita: { id: 'E2', nombre: 'Rival Dos', puntos: 4, faltas: 2 } }),
    })
    const { rerender } = render(<MemoryRouter initialEntries={['/liga/LIGAPUB1/partido/G1']}><AppCompartida /></MemoryRouter>)
    await act(async () => {})
    expect(screen.queryByText('Faltas del partido')).toBeNull()
    cleanup()
    montar('/liga/LIGAPUB1/partido/G2')
    expect(await screen.findByText('Equipo Dos', { selector: '.corto' })).toBeTruthy()
    soltarG1?.() // la respuesta tardía de G1
    await act(async () => { await Promise.resolve() })
    expect(document.body.textContent).not.toContain('Alfa Norte')
    expect(rerender).toBeDefined()
  })
})
