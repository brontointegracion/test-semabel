/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// ---------------------------------------------------------------------------
// S2 (Decisión 115): orden de las listas que van por número de camiseta, a
// través de los consumidores reales: rosterActivo (dominio), useEquipo (dato de
// la pantalla de equipo), la pantalla Equipo y la consola del árbitro.
//
// Con número, de menor a mayor (el 0 real primero); sin número (o con un valor
// no utilizable), al final; empates por apellido, nombre y, por último, id.
// Datos sintéticos; IndexedDB falsa en memoria. Son pruebas en jsdom.
// ---------------------------------------------------------------------------

const NOMBRE_BD = 'sebel'

function borrarBd() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(NOMBRE_BD)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  await borrarBd()
  vi.resetModules()
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await borrarBd()
})

const LIGA = { id: 'liga1', codigo: '4821', nombre: 'Liga', deporte: 'baloncesto', pais: 'PA', provincia: 'Panamá', organizadorId: 'yo', canchaIds: ['c1'] }
const EQ = { id: 'eL', ligaId: 'liga1', codigo: '1111', nombre: 'Halcones', corto: 'HAL', color: '#c00' }
const EQ2 = { id: 'eV', ligaId: 'liga1', codigo: '2222', nombre: 'Titanes', corto: 'TIT', color: '#06c' }

const jug = (id, codigo, nombrePila, apellido1, extra = {}) => ({
  id, codigo, ligaId: 'liga1', equipoId: 'eL', nombrePila, apellido1, apellido2: '', nombre: `${nombrePila} ${apellido1}`, personaId: `p-${id}`, ...extra,
})

// En un orden de inserción deliberadamente revuelto.
const FICHAS = [
  jug('idB', '9101', 'Ana', 'Zeta'), // sin número, mismo nombre que idA: desempata el id
  jug('p5', '9102', 'Beto', 'Cinco', { dorsal: 5 }),
  jug('pAlvaro', '9103', 'Álvaro', 'Zeta'), // sin número; el acento no cambia el orden
  jug('p12', '9104', 'Hugo', 'Doce', { dorsal: 12 }),
  jug('idA', '9105', 'Ana', 'Zeta'),
  jug('pBea', '9106', 'Bea', 'Alba', { nombreCamiseta: 'ZZ' }), // el alias no entra en el orden
  jug('p0', '9107', 'Zoe', 'Cero', { dorsal: 0 }),
  jug('pTexto', '9108', 'Dario', 'Texto', { dorsal: '7' }), // valor guardado no utilizable: cuenta como sin número
  jug('pInactivo', '9109', 'Gus', 'Inactivo', { dorsal: 1, activo: false }),
]
const ORDEN_ACTIVOS = ['p0', 'p5', 'p12', 'pBea', 'pTexto', 'pAlvaro', 'idA', 'idB']
const ORDEN_TODOS = ['p0', 'pInactivo', 'p5', 'p12', 'pBea', 'pTexto', 'pAlvaro', 'idA', 'idB']

async function cargar() {
  const { db } = await import('./../db.js')
  await db.jugadores.toArray()
  await db.canchas.add({ id: 'c1', nombre: 'Cancha', pais: 'PA', provincia: 'Panamá', codigo: '111' })
  await db.ligas.add(LIGA)
  await db.equipos.bulkAdd([EQ, EQ2])
  return { db }
}

describe('rosterActivo (dominio)', () => {
  it('numerados de menor a mayor con el 0 primero, sin número al final, con empates deterministas', async () => {
    const { db } = await cargar()
    const { rosterActivo } = await import('./roster.js')
    await db.jugadores.bulkAdd(FICHAS)
    expect((await rosterActivo('eL')).map((j) => j.id)).toEqual(ORDEN_ACTIVOS)
  })

  it('el resultado no depende del orden en que se guardaron las fichas', async () => {
    const { db } = await cargar()
    const { rosterActivo } = await import('./roster.js')
    for (const orden of [FICHAS, [...FICHAS].reverse(), [...FICHAS].sort((a, b) => (a.codigo < b.codigo ? 1 : -1))]) {
      await db.jugadores.clear()
      await db.jugadores.bulkAdd(orden)
      expect((await rosterActivo('eL')).map((j) => j.id)).toEqual(ORDEN_ACTIVOS)
    }
  })

  it('un registro anterior sin número (sembrado directo) queda después del 0 real y de los demás numerados', async () => {
    const { db } = await cargar()
    const { agregarJugador, rosterActivo } = await import('./roster.js')
    const sesion = { rol: 'organizador', cuentaId: 'yo' }
    const base = { apellido2: '', fechaNacimiento: '' }
    for (const campos of [
      { nombrePila: 'Luis', apellido1: 'Pérez', dorsal: 30 },
      { nombrePila: 'Nora', apellido1: 'Ríos', dorsal: 0 },
      { nombrePila: 'Omar', apellido1: 'Soto', dorsal: 2 },
    ]) {
      expect((await agregarJugador({ sesion, liga: LIGA, equipoId: 'eL', campos: { ...base, ...campos } })).tipo).toBe('creado')
    }
    // El dominio ya no puede crear un jugador sin número: el registro anterior se siembra directo.
    await db.jugadores.add({
      id: 'legado1', codigo: '9100', ligaId: LIGA.id, equipoId: 'eL', personaId: 'p-legado',
      nombrePila: 'Mara', apellido1: 'Quiroz', apellido2: '', nombre: 'Mara Quiroz', reclamado: false, activo: true,
    })
    expect((await rosterActivo('eL')).map((j) => j.nombre)).toEqual(['Nora Ríos', 'Omar Soto', 'Luis Pérez', 'Mara Quiroz'])
    expect((await db.jugadores.toArray()).filter((j) => 'dorsal' in j)).toHaveLength(3) // el registro anterior sigue sin número
  })
})

describe('useEquipo (dato de la pantalla de equipo)', () => {
  it('ordena todas las fichas del equipo, activas e inactivas, con las mismas reglas', async () => {
    const { db } = await cargar()
    await db.jugadores.bulkAdd(FICHAS)
    const { useEquipo } = await import('./../datos.js')
    let ultimo = null
    function Sonda() {
      ultimo = useEquipo('1111')
      return null
    }
    render(<Sonda />)
    await waitFor(() => expect(ultimo).toBeTruthy())
    expect(ultimo.jugadores.map((j) => j.id)).toEqual(ORDEN_TODOS)
  })
})

describe('pantallas', () => {
  it('Equipo: la plantilla activa se lista en ese orden', async () => {
    const { db } = await cargar()
    await db.jugadores.bulkAdd(FICHAS)
    await db.meta.put({ id: 'sesion', rol: 'invitado', cuentaId: null })
    const { urlEquipo } = await import('./enlaces.js')
    const Equipo = (await import('./../pantallas/Equipo.jsx')).default
    render(
      <MemoryRouter initialEntries={[urlEquipo(EQ)]}>
        <Routes><Route path="/e/:slug" element={<Equipo />} /></Routes>
      </MemoryRouter>,
    )
    await screen.findByText('Zoe Cero')
    const nombres = []
    for (const n of document.querySelectorAll('.jugador-fila .nombre')) if (!nombres.includes(n.textContent)) nombres.push(n.textContent)
    const esperado = ORDEN_ACTIVOS.map((id) => FICHAS.find((f) => f.id === id).nombre)
    expect(nombres.filter((n) => esperado.includes(n))).toEqual([...new Set(esperado)])
  })

  it('Consola: el plantel activo del lado local va en ese orden y el alias de camiseta no cambia el orden', async () => {
    const { db } = await cargar()
    await db.jugadores.bulkAdd(FICHAS)
    await db.cuenta.put({ id: 'yo', saldo: 5 })
    await db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'yo' })
    await db.partidos.add({
      id: 'p1', codigo: '7531', ligaId: 'liga1', canchaId: 'c1', localId: 'eL', visitaId: 'eV', estado: 'vivo',
      inicio: '2026-10-18T10:00:00.000Z', relojEstado: 'detenido', relojRestante: 600000, relojDesde: null,
    })
    const Consola = (await import('./../pantallas/Consola.jsx')).default
    render(
      <MemoryRouter initialEntries={['/p/halcones-vs-titanes-7531/consola']}>
        <Routes>
          <Route path="/p/:slug/consola" element={<Consola />} />
          <Route path="/p/:slug" element={<div>detalle</div>} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    const filas = [...document.querySelectorAll('.jugador-fila')]
    const nombres = filas.map((f) => f.querySelector('.nombre').textContent)
    // Bea Alba se muestra con su alias ("ZZ") pero ocupa su lugar por apellido y nombre.
    const esperado = ORDEN_ACTIVOS.map((id) => {
      const f = FICHAS.find((x) => x.id === id)
      return f.nombreCamiseta || f.nombre
    })
    expect(nombres).toEqual(esperado)
    expect(nombres[3]).toBe('ZZ')
    expect(filas.map((f) => f.querySelector('.dorsal').textContent)).toEqual(['0', '5', '12', '—', '—', '—', '—', '—'])
    // El inactivo sigue sin aparecer en la consola.
    expect(nombres).not.toContain('Gus Inactivo')
  })
})
