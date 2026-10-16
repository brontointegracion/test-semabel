/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Regresión: la pestaña activa del selector de Liga (Posiciones/Calendario/
// Jugadores) fijaba su fondo con `var(--accent)`, una variable CSS que nunca
// existió en styles.css (el proyecto usa `--acento`). El resultado era texto
// blanco sobre fondo sin rellenar: la pestaña activa —Posiciones por
// defecto— quedaba invisible, como si hubiera desaparecido de la navegación.
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

async function cargar() {
  const dbMod = await import('../db.js')
  const ligaMod = await import('./Liga.jsx')
  await dbMod.db.jugadores.toArray()
  return { db: dbMod.db, Liga: ligaMod.default }
}

beforeEach(async () => {
  await borrarBd()
})

afterEach(async () => {
  cleanup()
  await borrarBd()
})

function renderLiga(Liga, codigo) {
  render(
    <MemoryRouter initialEntries={[`/l/liga-${codigo}`]}>
      <Routes>
        <Route path="/l/:slug" element={<Liga />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Liga — el selector Posiciones/Calendario/Jugadores', () => {
  async function sembrarLiga(db) {
    const liga = {
      id: 'liga1', codigo: '4821', nombre: 'Liga Barrial', deporte: 'futsal', canchaIds: [],
    }
    await db.ligas.add(liga)
    return liga
  }

  it('Posiciones está activa al cargar, con var(--acento) en vez de var(--accent), y las tres pestañas quedan visibles', async () => {
    const { db, Liga } = await cargar()
    const liga = await sembrarLiga(db)

    renderLiga(Liga, liga.codigo)
    await screen.findByRole('heading', { name: liga.nombre })

    const posiciones = screen.getByRole('button', { name: 'Posiciones' })
    const calendario = screen.getByRole('button', { name: 'Calendario' })
    const jugadores = screen.getByRole('button', { name: 'Jugadores' })

    expect(posiciones.className).toContain('activo')
    expect(posiciones.style.background).toBe('var(--acento)')
    expect(posiciones.style.background).not.toContain('--accent')

    expect(calendario.className).not.toContain('activo')
    expect(jugadores.className).not.toContain('activo')
    expect(calendario.style.background).toBe('')
    expect(jugadores.style.background).toBe('')
  })

  it('hacer clic en Calendario lo activa y desactiva Posiciones', async () => {
    const { db, Liga } = await cargar()
    const liga = await sembrarLiga(db)
    const user = userEvent.setup()

    renderLiga(Liga, liga.codigo)
    await screen.findByRole('heading', { name: liga.nombre })

    await user.click(screen.getByRole('button', { name: 'Calendario' }))

    const posiciones = screen.getByRole('button', { name: 'Posiciones' })
    const calendario = screen.getByRole('button', { name: 'Calendario' })
    const jugadores = screen.getByRole('button', { name: 'Jugadores' })

    expect(calendario.className).toContain('activo')
    expect(calendario.style.background).toBe('var(--acento)')
    expect(posiciones.className).not.toContain('activo')
    expect(jugadores.className).not.toContain('activo')
  })

  it('hacer clic en Jugadores lo activa y desactiva la pestaña anterior', async () => {
    const { db, Liga } = await cargar()
    const liga = await sembrarLiga(db)
    const user = userEvent.setup()

    renderLiga(Liga, liga.codigo)
    await screen.findByRole('heading', { name: liga.nombre })

    await user.click(screen.getByRole('button', { name: 'Calendario' }))
    await user.click(screen.getByRole('button', { name: 'Jugadores' }))

    const posiciones = screen.getByRole('button', { name: 'Posiciones' })
    const calendario = screen.getByRole('button', { name: 'Calendario' })
    const jugadores = screen.getByRole('button', { name: 'Jugadores' })

    expect(jugadores.className).toContain('activo')
    expect(jugadores.style.background).toBe('var(--acento)')
    expect(calendario.className).not.toContain('activo')
    expect(posiciones.className).not.toContain('activo')
  })
})

describe('Liga — Calendario: "Partido finalizado"', () => {
  const partido = (id, localId, visitaId, estado, inicio) => ({
    id, codigo: `70${id.length}${id.slice(-1)}1`, ligaId: 'liga1', canchaId: 'c1', localId, visitaId, estado, inicio,
  })

  async function sembrarCalendario(db) {
    await db.canchas.add({ id: 'c1', nombre: 'Cancha', pais: 'EC', provincia: 'X', codigo: '111' })
    await db.ligas.add({ id: 'liga1', codigo: '4821', nombre: 'Liga Barrial', deporte: 'futsal', canchaIds: ['c1'] })
    await db.equipos.bulkAdd(['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => ({
      id: `e${n}`, ligaId: 'liga1', codigo: `${i + 1}${i + 1}${i + 1}${i + 1}`, nombre: `Equipo ${n}`, corto: n, color: '#06c',
    })))
    await db.partidos.bulkAdd([
      partido('pf', 'eA', 'eB', 'final', '2026-08-01T10:00:00.000Z'),
      partido('pv', 'eC', 'eD', 'vivo', '2026-08-02T10:00:00.000Z'),
      // Programado pero con fecha pasada: el estado manda, no la fecha.
      partido('ps', 'eE', 'eF', 'programado', '2020-01-01T10:00:00.000Z'),
    ])
  }

  it('solo el partido con estado final lleva la etiqueta; vivo y programado (aun con fecha pasada) no', async () => {
    const { db, Liga } = await cargar()
    await sembrarCalendario(db)
    render(
      <MemoryRouter initialEntries={['/l/liga-4821?pestana=calendario']}>
        <Routes><Route path="/l/:slug" element={<Liga />} /></Routes>
      </MemoryRouter>,
    )
    await screen.findByText('Equipo A')

    const etiquetas = screen.getAllByText('Partido finalizado')
    expect(etiquetas).toHaveLength(1)
    expect(etiquetas[0].textContent).toBe('Partido finalizado')
    const fila = (nombre) => screen.getByText(nombre).closest('a.partido')
    expect(fila('Equipo A').contains(etiquetas[0])).toBe(true)
    expect(fila('Equipo C').textContent).not.toContain('Partido finalizado')
    expect(fila('Equipo C').textContent).toContain('VIVO')
    expect(fila('Equipo E').textContent).not.toContain('Partido finalizado')
    // La fila final conserva equipos, marcador, hora y el enlace al partido.
    expect(fila('Equipo A').getAttribute('href')).toMatch(/^\/p\//)
    expect(fila('Equipo A').textContent).toContain('Equipo B')
    expect(fila('Equipo A').querySelectorAll('.goles')).toHaveLength(2)
    expect(fila('Equipo A').querySelector('.hora')).not.toBeNull()
  })
})
