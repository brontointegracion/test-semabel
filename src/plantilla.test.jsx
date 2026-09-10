/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Interacción real de FormularioJugador (Stage 3B, Slice 4) contra la base
// falsa/real (fake-indexeddb) y las operaciones de dominio reales — mismo
// principio que src/lib/roster.test.js: no se mockea agregarJugador ni la
// resolución de duplicados, para que un desajuste entre lo que la UI manda y
// lo que el dominio espera lo detecte esta prueba, no un mock que lo esconda.
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

// Reimporta db.js/plantilla.jsx con registro de módulos limpio en cada test,
// para que cada uno abra su propia instancia de Dexie('sebel') — mismo patrón
// que src/lib/roster.test.js.
async function cargar() {
  const dbMod = await import('./db.js')
  const plantillaMod = await import('./plantilla.jsx')
  await dbMod.db.jugadores.toArray()
  return { db: dbMod.db, FormularioJugador: plantillaMod.FormularioJugador }
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

async function sembrarLiga(db) {
  const liga = { id: 'liga1', codigo: '1001', estado: 'publicada', organizadorId: 'yo' }
  const equipoA = { id: 'equipoA', ligaId: liga.id, codigo: '2001' }
  const equipoB = { id: 'equipoB', ligaId: liga.id, codigo: '2002' }
  await db.ligas.add(liga)
  await db.equipos.bulkAdd([equipoA, equipoB])
  return { liga, equipoA, equipoB }
}

function renderFormulario(FormularioJugador, { liga, equipoId, onCerrar = vi.fn(), onExito = vi.fn() }) {
  render(
    <MemoryRouter>
      <FormularioJugador sesion={sesionDueno} liga={liga} equipoId={equipoId} onCerrar={onCerrar} onExito={onExito} />
    </MemoryRouter>,
  )
  return { onCerrar, onExito }
}

async function llenarCampos(user, { nombrePila, apellido1, apellido2, dorsal }) {
  if (nombrePila !== undefined) await user.type(screen.getByLabelText('Nombre *'), nombrePila)
  if (apellido1 !== undefined) await user.type(screen.getByLabelText('Primer apellido *'), apellido1)
  if (apellido2 !== undefined) await user.type(screen.getByLabelText('Segundo apellido'), apellido2)
  if (dorsal !== undefined) await user.type(screen.getByLabelText('Número *'), String(dorsal))
}

const camposBase = { nombrePila: 'Miguel', apellido1: 'Sam', apellido2: 'Robles', dorsal: 10 }

describe('FormularioJugador — validación de campos requeridos', () => {
  it('enviar el formulario vacío mantiene la hoja abierta y muestra los errores de la operación real', async () => {
    const { db, FormularioJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const user = userEvent.setup()
    renderFormulario(FormularioJugador, { liga, equipoId: equipoA.id })

    await user.click(screen.getByRole('button', { name: 'Añadir jugador' }))

    // nombrePila/apellido1 comparten mensaje; dorsal tiene el suyo propio
    // (validarDorsal, src/lib/roster.js) — se comprueban por separado.
    expect(await screen.findAllByText('Este campo es obligatorio.')).toHaveLength(2)
    expect(screen.getByText('El número es obligatorio.')).toBeTruthy()
    // La hoja sigue abierta: el campo Nombre y el botón de envío siguen presentes.
    expect(screen.getByLabelText('Nombre *')).toBeTruthy()
    expect(await db.jugadores.count()).toBe(0)
  })
})

describe('FormularioJugador — alta exitosa', () => {
  it('un jugador válido y sin duplicados se crea vía la operación real y avisa éxito', async () => {
    const { db, FormularioJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const user = userEvent.setup()
    const { onExito } = renderFormulario(FormularioJugador, { liga, equipoId: equipoA.id })

    await llenarCampos(user, camposBase)
    await user.click(screen.getByRole('button', { name: 'Añadir jugador' }))

    expect(await screen.findByText('Jugador añadido a la plantilla.')).toBeTruthy()
    expect(onExito).toHaveBeenCalledWith('Jugador añadido')

    const creados = await db.jugadores.where('equipoId').equals(equipoA.id).toArray()
    expect(creados).toHaveLength(1)
    expect(creados[0]).toMatchObject({ nombrePila: 'Miguel', apellido1: 'Sam', apellido2: 'Robles', dorsal: 10 })
  })
})

describe('FormularioJugador — resolución de identidad ante duplicado (Decisiones 5–7, 26, 60, 61)', () => {
  it('"Es la misma persona" reusa el personaId existente vía la operación real', async () => {
    const { db, FormularioJugador } = await cargar()
    const { liga, equipoA, equipoB } = await sembrarLiga(db)
    const { agregarJugador } = await import('./lib/roster.js')
    const original = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoB.id, campos: camposBase })
    expect(original.tipo).toBe('creado')

    const user = userEvent.setup()
    renderFormulario(FormularioJugador, { liga, equipoId: equipoA.id })
    await llenarCampos(user, camposBase)
    await user.click(screen.getByRole('button', { name: 'Añadir jugador' }))

    expect(await screen.findByText('Encontramos un jugador con el mismo nombre.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Es la misma persona' }))

    expect(await screen.findByText('Jugador añadido a la plantilla.')).toBeTruthy()
    const nuevo = await db.jugadores.where('equipoId').equals(equipoA.id).first()
    expect(nuevo.personaId).toBe(original.ficha.personaId)
    expect(nuevo.id).not.toBe(original.ficha.id)
  })

  it('"Es otra persona" crea un personaId distinto pese al nombre igual', async () => {
    const { db, FormularioJugador } = await cargar()
    const { liga, equipoA, equipoB } = await sembrarLiga(db)
    const { agregarJugador } = await import('./lib/roster.js')
    const original = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoB.id, campos: camposBase })
    expect(original.tipo).toBe('creado')

    const user = userEvent.setup()
    renderFormulario(FormularioJugador, { liga, equipoId: equipoA.id })
    await llenarCampos(user, camposBase)
    await user.click(screen.getByRole('button', { name: 'Añadir jugador' }))

    expect(await screen.findByText('Encontramos un jugador con el mismo nombre.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Es otra persona' }))

    expect(await screen.findByText('Jugador añadido a la plantilla.')).toBeTruthy()
    const nuevo = await db.jugadores.where('equipoId').equals(equipoA.id).first()
    expect(nuevo.personaId).not.toBe(original.ficha.personaId)
  })
})

describe('FormularioJugador — protección de cambios sin guardar (Decisiones 68–69)', () => {
  it('cerrar con datos escritos pide confirmar; "Seguir editando" preserva lo escrito', async () => {
    const { db, FormularioJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const user = userEvent.setup()
    const { onCerrar } = renderFormulario(FormularioJugador, { liga, equipoId: equipoA.id })

    await user.type(screen.getByLabelText('Nombre *'), 'Miguel')
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))

    expect(await screen.findByText('Tienes cambios sin guardar. ¿Qué deseas hacer?')).toBeTruthy()
    expect(onCerrar).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Seguir editando' }))
    await waitFor(() => expect(screen.getByLabelText('Nombre *').value).toBe('Miguel'))
    expect(onCerrar).not.toHaveBeenCalled()
  })

  it('cerrar un formulario vacío no pide confirmación', async () => {
    const { db, FormularioJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const user = userEvent.setup()
    const { onCerrar } = renderFormulario(FormularioJugador, { liga, equipoId: equipoA.id })

    await user.click(screen.getByRole('button', { name: 'Cerrar' }))

    await waitFor(() => expect(onCerrar).toHaveBeenCalled())
    expect(screen.queryByText('Tienes cambios sin guardar. ¿Qué deseas hacer?')).toBeNull()
  })
})
