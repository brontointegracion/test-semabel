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
  return {
    db: dbMod.db,
    Equipo: equipoMod.default,
    agregarJugador: rosterMod.agregarJugador,
    desactivarJugador: rosterMod.desactivarJugador,
  }
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

describe('Equipo — organizador edita jugador vía el menú ⋯ (Stage 3B, Slice 6)', () => {
  it('abrir el menú y hacer clic en "Editar jugador" abre el formulario real prellenado', async () => {
    const { db, Equipo, agregarJugador } = await cargar()
    const { equipo, ficha } = await sembrarEquipoConJugador(db, agregarJugador)
    const user = userEvent.setup()

    renderEquipo(Equipo, equipo.codigo)

    await screen.findByText(ficha.nombre)

    await user.click(screen.getByRole('button', { name: 'Acciones del jugador' }))
    await user.click(screen.getByRole('menuitem', { name: 'Editar jugador' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Editar jugador' })
    expect(within(dialogo).getByLabelText('Nombre *').value).toBe(ficha.nombrePila)
    expect(within(dialogo).getByLabelText('Primer apellido *').value).toBe(ficha.apellido1)
    expect(within(dialogo).getByLabelText('Número *').value).toBe(String(ficha.dorsal))
  })

  it('guardar un cambio real actualiza la fila de la plantilla activa sin recargar (Decisión 63)', async () => {
    const { db, Equipo, agregarJugador } = await cargar()
    const { equipo, ficha } = await sembrarEquipoConJugador(db, agregarJugador)
    const user = userEvent.setup()

    renderEquipo(Equipo, equipo.codigo)

    await screen.findByText(ficha.nombre)
    await user.click(screen.getByRole('button', { name: 'Acciones del jugador' }))
    await user.click(screen.getByRole('menuitem', { name: 'Editar jugador' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Editar jugador' })
    const numero = within(dialogo).getByLabelText('Número *')
    await user.clear(numero)
    await user.type(numero, '77')
    await user.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }))

    // La ficha real muestra el nuevo dorsal en Plantilla, sin recargar la página:
    // useRosterActivo() es una consulta viva sobre la misma base real.
    await screen.findByText('Jugador actualizado')
    await screen.findByText('77')
    expect(screen.queryByRole('dialog', { name: 'Editar jugador' })).toBeNull()
    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd.dorsal).toBe(77)
  })

  it('un visitante sin sesión de organizador no puede acceder a Editar jugador', async () => {
    const { db, Equipo, agregarJugador } = await cargar()
    const { equipo, ficha } = await sembrarEquipoConJugador(db, agregarJugador)
    await db.meta.put({ id: 'sesion', rol: 'invitado' })

    renderEquipo(Equipo, equipo.codigo)

    await screen.findByText(ficha.nombre)
    expect(screen.queryByRole('button', { name: 'Acciones del jugador' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Editar jugador' })).toBeNull()
  })
})

describe('Equipo — organizador ve inactivos y reactiva jugador (Stage 3B, Slice 7)', () => {
  async function sembrarDosJugadores(db, agregarJugador) {
    const liga = { id: 'liga1', codigo: '1001', estado: 'publicada', organizadorId: 'yo' }
    const equipo = { id: 'equipoA', ligaId: liga.id, codigo: '2001', nombre: 'Los Tigres', corto: 'TIG' }
    await db.ligas.add(liga)
    await db.equipos.add(equipo)
    await db.meta.put({ id: 'sesion', ...sesionDueno })
    const a = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipo.id,
      campos: { nombrePila: 'Ana', apellido1: 'Julia', apellido2: '', dorsal: 5 },
    })
    const b = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipo.id,
      campos: { nombrePila: 'Miguel', apellido1: 'Sam', apellido2: 'Robles', dorsal: 10 },
    })
    expect(a.tipo).toBe('creado')
    expect(b.tipo).toBe('creado')
    return { liga, equipo, fichaA: a.ficha, fichaB: b.ficha }
  }

  it('organizador abre Ver inactivos y ve el roster inactivo, con el más recientemente desactivado primero', async () => {
    const { db, Equipo, agregarJugador, desactivarJugador } = await cargar()
    const { liga, equipo, fichaA, fichaB } = await sembrarDosJugadores(db, agregarJugador)
    await desactivarJugador({ sesion: sesionDueno, liga, ficha: fichaA })
    await desactivarJugador({ sesion: sesionDueno, liga, ficha: fichaB })
    const user = userEvent.setup()

    renderEquipo(Equipo, equipo.codigo)

    await user.click(await screen.findByRole('button', { name: 'Ver inactivos' }))

    const nombres = [...document.querySelectorAll('.jugador-fila.inactivo .nombre')].map((n) => n.textContent)
    expect(nombres).toEqual([fichaB.nombre, fichaA.nombre])
    expect(screen.getAllByText('Inactivo')).toHaveLength(2)
    // De vuelta a la plantilla activa: ya no se muestran las filas inactivas.
    await user.click(screen.getByRole('button', { name: '← Volver a la plantilla activa' }))
    expect(document.querySelectorAll('.jugador-fila.inactivo')).toHaveLength(0)
  })

  it('el menú de una fila inactiva ofrece Editar jugador y Reactivar jugador, no Desactivar', async () => {
    const { db, Equipo, agregarJugador, desactivarJugador } = await cargar()
    const { equipo, liga, ficha } = await sembrarEquipoConJugador(db, agregarJugador)
    await desactivarJugador({ sesion: sesionDueno, liga, ficha })
    const user = userEvent.setup()

    renderEquipo(Equipo, equipo.codigo)
    await user.click(await screen.findByRole('button', { name: 'Ver inactivos' }))
    await user.click(screen.getByRole('button', { name: 'Acciones del jugador' }))

    expect(screen.getByRole('menuitem', { name: 'Editar jugador' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Reactivar jugador' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Desactivar jugador' })).toBeNull()
  })

  it('Editar jugador sobre una ficha inactiva abre el formulario real prellenado, y guardar no la reactiva', async () => {
    const { db, Equipo, agregarJugador, desactivarJugador } = await cargar()
    const { equipo, liga, ficha } = await sembrarEquipoConJugador(db, agregarJugador)
    const inactiva = (await desactivarJugador({ sesion: sesionDueno, liga, ficha })).ficha
    const user = userEvent.setup()

    renderEquipo(Equipo, equipo.codigo)
    await user.click(await screen.findByRole('button', { name: 'Ver inactivos' }))
    await user.click(screen.getByRole('button', { name: 'Acciones del jugador' }))
    await user.click(screen.getByRole('menuitem', { name: 'Editar jugador' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Editar jugador' })
    expect(within(dialogo).getByLabelText('Nombre *').value).toBe(inactiva.nombrePila)
    const numero = within(dialogo).getByLabelText('Número *')
    expect(numero.value).toBe(String(inactiva.dorsal))

    await user.clear(numero)
    await user.type(numero, '77')
    await user.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }))

    await screen.findByText('Jugador actualizado')
    expect(screen.queryByRole('dialog', { name: 'Editar jugador' })).toBeNull()
    const enBd = await db.jugadores.get(inactiva.id)
    expect(enBd.dorsal).toBe(77)
    // Editar una ficha inactiva nunca la reactiva por sí sola.
    expect(enBd.activo).toBe(false)
  })

  it('Reactivar jugador reactiva vía la operación real, vuelve a la plantilla activa y avisa el éxito', async () => {
    const { db, Equipo, agregarJugador, desactivarJugador } = await cargar()
    const { equipo, liga, ficha } = await sembrarEquipoConJugador(db, agregarJugador)
    await desactivarJugador({ sesion: sesionDueno, liga, ficha })
    const user = userEvent.setup()

    renderEquipo(Equipo, equipo.codigo)
    await user.click(await screen.findByRole('button', { name: 'Ver inactivos' }))
    await user.click(screen.getByRole('button', { name: 'Acciones del jugador' }))
    await user.click(screen.getByRole('menuitem', { name: 'Reactivar jugador' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Reactivar jugador' })
    await user.click(within(dialogo).getByRole('button', { name: 'Reactivar jugador' }))

    await screen.findByText('Jugador reactivado')
    expect(screen.queryByRole('dialog', { name: 'Reactivar jugador' })).toBeNull()
    // Volvió a la plantilla activa (Slice 7): la fila reactivada aparece ahí, sin recargar.
    await screen.findByText(ficha.nombre)
    expect(document.querySelectorAll('.jugador-fila.inactivo')).toHaveLength(0)

    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd.activo).toBe(true)
    expect(enBd.dorsal).toBe(ficha.dorsal)
  })

  it('un visitante sin sesión de organizador no ve Ver inactivos ni puede gestionar fichas inactivas', async () => {
    const { db, Equipo, agregarJugador, desactivarJugador } = await cargar()
    const { equipo, liga, ficha } = await sembrarEquipoConJugador(db, agregarJugador)
    await desactivarJugador({ sesion: sesionDueno, liga, ficha })
    await db.meta.put({ id: 'sesion', rol: 'invitado' })

    renderEquipo(Equipo, equipo.codigo)
    await screen.findByText('Resultados')

    expect(screen.queryByRole('button', { name: 'Ver inactivos' })).toBeNull()
    expect(screen.queryByText(ficha.nombre)).toBeNull()
  })
})
