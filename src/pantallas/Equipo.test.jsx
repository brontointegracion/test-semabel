/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Regresión Stage 3B Slice 5 — falla de QA manual: el menú ⋯ de un jugador
// abría, pero "Desactivar jugador" no producía ninguna confirmación visible.
//
// La causa vivía en el borde entre MenuJugador y Equipo (src/ui.jsx): un
// listener de pointerdown en document cerraba el menú, desmontando el botón,
// antes de que el click de React llegara a disparar onDesactivar. Ningún test
// existente lo detectaba porque plantilla.test.jsx monta ConfirmarDesactivar
// directamente, sin pasar por MenuJugador ni por Equipo — por eso esta prueba
// monta la pantalla Equipo real y usa userEvent (pointerdown + click reales,
// en ese orden) para recorrer el mismo camino que siguió la validación manual.
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
  const equipoMod = await import('./Equipo.jsx')
  const rosterMod = await import('../lib/roster.js')
  await dbMod.db.jugadores.toArray()
  return { db: dbMod.db, Equipo: equipoMod.default, agregarJugador: rosterMod.agregarJugador }
}

beforeEach(async () => {
  await borrarBd()
  vi.resetModules()
})

afterEach(async () => {
  cleanup()
  await borrarBd()
})

const sesionDueno = { rol: 'organizador', cuentaId: 'yo' }

const camposBase = { nombrePila: 'Miguel', apellido1: 'Sam', apellido2: 'Robles', dorsal: 10 }

async function sembrarEquipoConJugador(db, agregarJugador) {
  const liga = { id: 'liga1', codigo: '1001', estado: 'publicada', organizadorId: 'yo' }
  const equipo = { id: 'equipoA', ligaId: liga.id, codigo: '2001', nombre: 'Los Tigres', corto: 'TIG' }
  await db.ligas.add(liga)
  await db.equipos.add(equipo)
  await db.meta.put({ id: 'sesion', ...sesionDueno })
  const r = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipo.id, campos: camposBase })
  expect(r.tipo).toBe('creado')
  return { liga, equipo, ficha: r.ficha }
}

function renderEquipo(Equipo, codigo) {
  render(
    <MemoryRouter initialEntries={[`/e/${codigo}`]}>
      <Routes>
        <Route path="/e/:slug" element={<Equipo />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Equipo — organizador desactiva jugador vía el menú ⋯ (Stage 3B, Slice 5)', () => {
  it('abrir el menú y hacer clic en "Desactivar jugador" muestra la confirmación real', async () => {
    const { db, Equipo, agregarJugador } = await cargar()
    const { equipo, ficha } = await sembrarEquipoConJugador(db, agregarJugador)
    const user = userEvent.setup()

    renderEquipo(Equipo, equipo.codigo)

    await screen.findByText(ficha.nombre)

    await user.click(screen.getByRole('button', { name: 'Acciones del jugador' }))
    expect(screen.getByRole('menuitem', { name: 'Desactivar jugador' })).toBeTruthy()

    // Antes del arreglo, este clic caía en el mismo listener de pointerdown
    // que cierra el menú al hacer clic afuera: el botón se desmontaba antes
    // de que su propio onClick llegara a ejecutarse, y esta aserción fallaba.
    await user.click(screen.getByRole('menuitem', { name: 'Desactivar jugador' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Desactivar jugador' })
    expect(dialogo).toBeTruthy()
    expect(within(dialogo).getByText(ficha.nombre, { exact: false })).toBeTruthy()
  })

  it('un visitante sin sesión de organizador no ve el menú ⋯ del jugador', async () => {
    const { db, Equipo, agregarJugador } = await cargar()
    const { equipo, ficha } = await sembrarEquipoConJugador(db, agregarJugador)
    await db.meta.put({ id: 'sesion', rol: 'invitado' })

    renderEquipo(Equipo, equipo.codigo)

    await screen.findByText(ficha.nombre)
    expect(screen.queryByRole('button', { name: 'Acciones del jugador' })).toBeNull()
  })
})
