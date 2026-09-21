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
