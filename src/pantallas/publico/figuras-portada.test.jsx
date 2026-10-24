/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { respuestaJugadores, respuestaLiga } from '../../lib/publico/datos-prueba.js'

// REPORT_215 — «Figuras del barrio» de la portada compartida: un podio por liga con el ranking PÚBLICO ya publicado (puntos totales de partidos terminados),
// sin mezclar ligas, sin fusionar personas, con estados separados (cargando / no disponible / sin partidos / sin puntos) y sin sondeo más rápido que el ranking. Datos sintéticos.

const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
let llamadas
function servidor(rutas) {
  llamadas = []
  const f = vi.fn(async (ruta, init) => {
    llamadas.push({ ruta, init })
    const h = rutas[ruta]
    if (h === undefined) return respuesta({ error: 'no-encontrado' }, 404)
    return typeof h === 'function' ? h() : (h instanceof Response ? h : respuesta(h))
  })
  vi.stubGlobal('fetch', f)
  return f
}
const LIGA = (n) => `/v1/ligas/LIGAPUB${n}/publico`
const JUG = (n) => `/v1/ligas/LIGAPUB${n}/jugadores/publico`
let ubicacion
function Ubic() { ubicacion = useLocation(); return null }
const montar = () => render(<MemoryRouter initialEntries={['/']}><AppCompartida /><Ubic /></MemoryRouter>)
const E1 = { id: 'E1', nombre: 'Alfa Norte' }
const E2 = { id: 'E2', nombre: 'Beta Sur' }
const E3 = { id: 'E3', nombre: 'Gama Este' }
const seccion = () => document.querySelector('.hm-figuras')
const grupo = (nombre) => within(seccion()).getByRole('group', { name: `Figuras de ${nombre}` })
const filasDe = (g) => [...g.querySelectorAll('.escalon')]
const dosLigas = () => ({
  [LIGA(1)]: respuestaLiga({ id: 'LIGAPUB1', nombre: 'Liga Uno', partidos: [] }),
  [LIGA(2)]: respuestaLiga({ id: 'LIGAPUB2', nombre: 'Liga Dos', partidos: [] }),
})

beforeEach(() => {
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1,LIGAPUB2')
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('qué muestra: un podio por liga, con el valor, el número y el equipo del ranking público', () => {
  it('cada liga con sus propias figuras (puntos totales), rotuladas por liga; empates comparten puesto; los enlaces van al equipo (destino amigable), nunca a un perfil de jugador', async () => {
    servidor({
      ...dosLigas(),
      [JUG(1)]: respuestaJugadores({ id: 'LIGAPUB1', nombre: 'Liga Uno', partidosFinales: 3, anotadores: [
        { id: 'F1', nombre: 'Ana Prueba', dorsalActual: 7, equipo: E1, puntos: 31 }, { id: 'F2', nombre: 'Saúl Montero', dorsalActual: 0, equipo: E2, puntos: 20 },
        { id: 'F3', nombre: 'Zoe Sin', dorsalActual: null, equipo: E1, puntos: 20 }, { id: 'F4', nombre: 'Cuarto Lugar', dorsalActual: 9, equipo: E2, puntos: 11 }] }),
      [JUG(2)]: respuestaJugadores({ id: 'LIGAPUB2', nombre: 'Liga Dos', partidosFinales: 1, anotadores: [{ id: 'G1', nombre: 'Gil Dos', dorsalActual: 4, equipo: E3, puntos: 8 }] }),
    })
    montar()
    await waitFor(() => expect(within(seccion()).queryAllByRole('group')).toHaveLength(2))
    expect(screen.getByRole('heading', { name: 'Figuras del barrio' })).toBeTruthy()
    expect(seccion().textContent).toMatch(/puntos totales en partidos terminados\. Cada liga va por separado; sus números no se mezclan/)
    expect(seccion().textContent).not.toMatch(/por juego/)
    const uno = filasDe(grupo('Liga Uno'))
    expect(uno).toHaveLength(3) // puestos 1, 2, 2; el cuarto no entra
    expect(uno.map((f) => [f.querySelector('.puesto').textContent, f.querySelector('.quien').firstChild.textContent, f.querySelector('.cifra').textContent, f.querySelector('.unidad').textContent])).toEqual([
      ['1', 'Ana Prueba', '31', 'puntos totales'], ['2', 'Saúl Montero', '20', 'puntos totales'], ['2', 'Zoe Sin', '20', 'puntos totales']])
    expect(uno.map((f) => f.querySelector('.equipo-nombre').textContent)).toEqual(['#7 · Alfa Norte', '#0 · Beta Sur', 'Sin número · Alfa Norte']) // el #0 es un número real
    expect(uno.map((f) => f.getAttribute('href'))).toEqual(['/liga/ligapub1/equipo/e1', '/liga/ligapub1/equipo/e2', '/liga/ligapub1/equipo/e1'])
    expect(filasDe(grupo('Liga Dos')).map((f) => f.getAttribute('href'))).toEqual(['/liga/ligapub2/equipo/e3'])
    expect(grupo('Liga Dos').textContent).toContain('Gil Dos')
    expect(grupo('Liga Uno').textContent).not.toContain('Gil Dos') // las ligas no se mezclan
    // destinos: la tabla de cada liga (pestaña Jugadores); ninguna ruta de perfil de jugador inventada
    const enlaces = [...seccion().querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(enlaces).toContain('/liga/ligapub1?pestana=jugadores')
    expect(enlaces).toContain('/liga/ligapub2?pestana=jugadores')
    expect(enlaces.some((h) => /\/jugador|\/j\//.test(h))).toBe(false)
  })

  it('dos personas con el mismo nombre (y el mismo número) son dos filas; la misma ficha en otro equipo es otra fila; nada se funde; sin campos privados ni alias de camiseta', async () => {
    const r = respuestaJugadores({ id: 'LIGAPUB1', nombre: 'Liga Uno', partidosFinales: 2, anotadores: [
      { id: 'F1', nombre: 'Ana Prueba', dorsalActual: 7, equipo: E1, puntos: 14 }, { id: 'F2', nombre: 'Ana Prueba', dorsalActual: 7, equipo: E2, puntos: 14 },
      { id: 'F1', nombre: 'Ana Prueba', dorsalActual: 7, equipo: E2, puntos: 9 }] })
    for (const e of [...r.maximosAnotadores, ...r.masFaltas]) Object.assign(e, { nombreCamiseta: 'ALIAS-SECRETO', personaId: 'persona-secreta', fechaNacimiento: '2015-01-01', codigo: 'COD-PRIVADO' })
    servidor({ ...dosLigas(), [JUG(1)]: r, [JUG(2)]: respuestaJugadores({ id: 'LIGAPUB2', nombre: 'Liga Dos', partidosFinales: 0 }) })
    montar()
    await waitFor(() => expect(filasDe(grupo('Liga Uno'))).toHaveLength(3))
    expect(filasDe(grupo('Liga Uno')).map((f) => f.getAttribute('href'))).toEqual(['/liga/ligapub1/equipo/e1', '/liga/ligapub1/equipo/e2', '/liga/ligapub1/equipo/e2'])
    expect(filasDe(grupo('Liga Uno')).map((f) => f.querySelector('.cifra').textContent)).toEqual(['14', '14', '9'])
    expect(filasDe(grupo('Liga Uno')).map((f) => f.querySelector('.puesto').textContent)).toEqual(['1', '1', '3'])
    expect(document.body.textContent).not.toMatch(/ALIAS-SECRETO|persona-secreta|2015-01-01|COD-PRIVADO/)
  })

  it('un empate completo en el último puesto del podio no se corta; con más de cinco empatados se dice cuántos quedan en la tabla de la liga', async () => {
    servidor({ ...dosLigas(),
      [JUG(1)]: respuestaJugadores({ id: 'LIGAPUB1', nombre: 'Liga Uno', partidosFinales: 5, anotadores: Array.from({ length: 7 }, (_, i) => ({ id: `T${i}`, nombre: `Empatado ${i}`, equipo: E1, puntos: 10 })) }),
      [JUG(2)]: respuestaJugadores({ id: 'LIGAPUB2', nombre: 'Liga Dos', partidosFinales: 5, anotadores: [{ id: 'G1', nombre: 'Gil Dos', equipo: E3, puntos: 8 }] }) })
    montar()
    await waitFor(() => expect(filasDe(grupo('Liga Uno'))).toHaveLength(5))
    expect(grupo('Liga Uno').textContent).toContain('Hay 2 jugadores más con estos puestos; están en la tabla de la liga.')
  })
})

describe('estados separados', () => {
  it('cargando: indicador propio (no «sin figuras»); luego aparecen las de la liga que ya respondió aunque la otra siga pendiente', async () => {
    let soltar
    servidor({ ...dosLigas(), [JUG(1)]: respuestaJugadores({ id: 'LIGAPUB1', nombre: 'Liga Uno', partidosFinales: 1, anotadores: [{ id: 'F1', nombre: 'Ana Prueba', equipo: E1, puntos: 5 }] }),
      [JUG(2)]: () => new Promise((res) => { soltar = () => res(respuesta(respuestaJugadores({ id: 'LIGAPUB2', nombre: 'Liga Dos', partidosFinales: 0 }))) }) })
    montar()
    await waitFor(() => expect(filasDe(grupo('Liga Uno'))).toHaveLength(1))
    expect(seccion().textContent).not.toMatch(/Las figuras aparecen cuando termine/)
    await act(async () => { soltar() })
    await waitFor(() => expect(grupo('Liga Dos').textContent).toContain('Todavía no hay partidos terminados en esta liga.'))
  })

  it('cargando todo: «Cargando las figuras…» (no un vacío verificado)', async () => {
    servidor({ ...dosLigas(), [JUG(1)]: () => new Promise(() => {}), [JUG(2)]: () => new Promise(() => {}) })
    montar()
    await waitFor(() => expect(seccion().textContent).toContain('Cargando las figuras…'))
    expect(seccion().textContent).not.toMatch(/aparecen cuando termine|No se pudieron/)
  })

  it('ninguna liga tiene partidos terminados: un solo mensaje claro, sin podios ni «no disponible»', async () => {
    servidor({ ...dosLigas(), [JUG(1)]: respuestaJugadores({ id: 'LIGAPUB1', nombre: 'Liga Uno', partidosFinales: 0 }), [JUG(2)]: respuestaJugadores({ id: 'LIGAPUB2', nombre: 'Liga Dos', partidosFinales: 0 }) })
    montar()
    await waitFor(() => expect(seccion().textContent).toContain('Las figuras aparecen cuando termine el primer partido. Los partidos programados o en juego no cuentan.'))
    expect(document.querySelector('.podio')).toBeNull()
    expect(seccion().textContent).not.toMatch(/No se pudieron/)
  })

  it('una liga falla y la otra no: aviso con el nombre de la que falló (no «no hay figuras») y el podio de la otra sigue visible', async () => {
    servidor({ ...dosLigas(), [JUG(1)]: respuestaJugadores({ id: 'LIGAPUB1', nombre: 'Liga Uno', partidosFinales: 2, anotadores: [{ id: 'F1', nombre: 'Ana Prueba', equipo: E1, puntos: 5 }] }), [JUG(2)]: respuesta({ error: 'x' }, 500) })
    montar()
    await waitFor(() => expect(seccion().textContent).toContain('No se pudieron cargar las figuras de Liga Dos. Las demás ligas se muestran con lo último confirmado.'))
    expect(filasDe(grupo('Liga Uno'))).toHaveLength(1)
    expect(within(seccion()).queryByRole('group', { name: 'Figuras de Liga Dos' })).toBeNull()
  })

  it('con partidos terminados pero sin puntos en una liga: se dice, distinto de «sin partidos»; con todas las ligas fallando: solo el aviso', async () => {
    servidor({ ...dosLigas(), [JUG(1)]: respuestaJugadores({ id: 'LIGAPUB1', nombre: 'Liga Uno', partidosFinales: 2, anotadores: [] }),
      [JUG(2)]: respuestaJugadores({ id: 'LIGAPUB2', nombre: 'Liga Dos', partidosFinales: 1, anotadores: [{ id: 'G1', nombre: 'Gil Dos', equipo: E3, puntos: 3 }] }) })
    montar()
    await waitFor(() => expect(grupo('Liga Uno').textContent).toContain('Todavía no hay puntos anotados en partidos terminados de esta liga.'))
    cleanup()
    servidor({ ...dosLigas(), [JUG(1)]: respuesta({ error: 'x' }, 500), [JUG(2)]: respuesta({ error: 'x' }, 500) })
    montar()
    await waitFor(() => expect(seccion().textContent).toContain('No se pudieron cargar las figuras de Liga Uno, Liga Dos.'))
    expect(document.querySelector('.podio')).toBeNull()
  })

  it('un ranking mal formado se trata como no disponible (nada se inventa)', async () => {
    servidor({ ...dosLigas(), [JUG(1)]: { liga: { id: 'LIGAPUB1', nombre: 'Liga Uno' } }, [JUG(2)]: respuestaJugadores({ id: 'LIGAPUB2', nombre: 'Liga Dos', partidosFinales: 1, anotadores: [{ id: 'G1', nombre: 'Gil Dos', equipo: E3, puntos: 3 }] }) })
    montar()
    await waitFor(() => expect(seccion().textContent).toContain('No se pudieron cargar las figuras de Liga Uno.'))
  })
})

describe('peticiones: cuántas, cuándo y con qué cadencia', () => {
  it('al abrir la portada: UNA lectura del ranking por liga (además de la lectura de siempre), solo GET sin credenciales; ninguna más al ampliar o navegar a «Ver la tabla»', async () => {
    servidor({ ...dosLigas(), [JUG(1)]: respuestaJugadores({ id: 'LIGAPUB1', nombre: 'Liga Uno', partidosFinales: 1, anotadores: [{ id: 'F1', nombre: 'Ana Prueba', equipo: E1, puntos: 5 }] }), [JUG(2)]: respuestaJugadores({ id: 'LIGAPUB2', nombre: 'Liga Dos', partidosFinales: 0 }) })
    montar()
    await waitFor(() => expect(filasDe(grupo('Liga Uno'))).toHaveLength(1))
    expect(llamadas.map((l) => l.ruta).sort()).toEqual([LIGA(1), LIGA(2), JUG(1), JUG(2)].sort())
    for (const l of llamadas) expect(l.init).toMatchObject({ method: 'GET', credentials: 'omit' })
    expect(llamadas.filter((l) => l.ruta.endsWith('/jugadores/publico'))).toHaveLength(2)
  })

  it('cadencia: el ranking se vuelve a pedir cada 5 minutos (la del recurso de equipo y de la pestaña «Jugadores»), nunca antes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
    const f = servidor({ ...dosLigas(), [JUG(1)]: respuestaJugadores({ id: 'LIGAPUB1', nombre: 'Liga Uno', partidosFinales: 1, anotadores: [{ id: 'F1', nombre: 'Ana', equipo: E1, puntos: 5 }] }), [JUG(2)]: respuestaJugadores({ id: 'LIGAPUB2', nombre: 'Liga Dos', partidosFinales: 0 }) })
    montar()
    const avanzar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
    const rank = () => f.mock.calls.filter(([u]) => u.endsWith('/jugadores/publico')).length
    await avanzar(50)
    expect(rank()).toBe(2)
    await avanzar(239_000) // 4 minutos
    expect(rank()).toBe(2) // ni una lectura más (el catálogo sí se repite cada minuto, el ranking no)
    await avanzar(62_000) // pasan los 5 minutos
    expect(rank()).toBe(4)
  })
})

describe('filtros y «Ver la tabla»', () => {
  it('el enlace «Ver la tabla de …» lleva a la pestaña Jugadores de esa liga', async () => {
    servidor({ ...dosLigas(), [JUG(1)]: respuestaJugadores({ id: 'LIGAPUB1', nombre: 'Liga Uno', partidosFinales: 1, anotadores: [{ id: 'F1', nombre: 'Ana', equipo: E1, puntos: 5 }] }), [JUG(2)]: respuestaJugadores({ id: 'LIGAPUB2', nombre: 'Liga Dos', partidosFinales: 0 }) })
    montar()
    await waitFor(() => expect(filasDe(grupo('Liga Uno'))).toHaveLength(1))
    fireEvent.click(screen.getByRole('link', { name: 'Ver la tabla de Liga Uno' }))
    expect(ubicacion.pathname + ubicacion.search).toBe('/liga/ligapub1?pestana=jugadores')
  })
})
