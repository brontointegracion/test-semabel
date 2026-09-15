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
  const rosterMod = await import('./lib/roster.js')
  await dbMod.db.jugadores.toArray()
  return {
    db: dbMod.db,
    FormularioJugador: plantillaMod.FormularioJugador,
    ConfirmarDesactivar: plantillaMod.ConfirmarDesactivar,
    ConfirmarReactivar: plantillaMod.ConfirmarReactivar,
    agregarJugador: rosterMod.agregarJugador,
    editarJugador: rosterMod.editarJugador,
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
const sesionOtro = { rol: 'organizador', cuentaId: 'otro' }

async function sembrarLiga(db) {
  const liga = { id: 'liga1', codigo: '1001', estado: 'publicada', organizadorId: 'yo' }
  const equipoA = { id: 'equipoA', ligaId: liga.id, codigo: '2001' }
  const equipoB = { id: 'equipoB', ligaId: liga.id, codigo: '2002' }
  await db.ligas.add(liga)
  await db.equipos.bulkAdd([equipoA, equipoB])
  return { liga, equipoA, equipoB }
}

function renderFormulario(FormularioJugador, { liga, equipoId, ficha, onCerrar = vi.fn(), onExito = vi.fn() }) {
  render(
    <MemoryRouter>
      <FormularioJugador
        sesion={sesionDueno}
        liga={liga}
        equipoId={equipoId}
        ficha={ficha}
        onCerrar={onCerrar}
        onExito={onExito}
      />
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

describe('FormularioJugador — modo Editar (Stage 3B, Slice 6 — Decisiones 7, 24, 55–57, 63, 68, 84, 104)', () => {
  async function sembrarJugadorActivo(db, agregarJugador, liga, equipoId, campos = camposBase) {
    const r = await agregarJugador({ sesion: sesionDueno, liga, equipoId, campos })
    expect(r.tipo).toBe('creado')
    return r.ficha
  }

  it('abre prellenado con los valores actuales de la ficha, y el botón dice "Guardar cambios"', async () => {
    const { db, FormularioJugador, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const ficha = await sembrarJugadorActivo(db, agregarJugador, liga, equipoA.id, {
      ...camposBase, fechaNacimiento: '2000-05-15',
    })

    renderFormulario(FormularioJugador, { liga, equipoId: equipoA.id, ficha })

    expect(screen.getByLabelText('Nombre *').value).toBe('Miguel')
    expect(screen.getByLabelText('Primer apellido *').value).toBe('Sam')
    expect(screen.getByLabelText('Segundo apellido').value).toBe('Robles')
    expect(screen.getByLabelText('Número *').value).toBe('10')
    expect(screen.getByLabelText('Fecha de nacimiento').value).toBe('2000-05-15')
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Editar jugador' })).toBeTruthy()
  })

  it('cerrar sin tocar nada no pide confirmar', async () => {
    const { db, FormularioJugador, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const ficha = await sembrarJugadorActivo(db, agregarJugador, liga, equipoA.id)
    const user = userEvent.setup()
    const { onCerrar } = renderFormulario(FormularioJugador, { liga, equipoId: equipoA.id, ficha })

    await user.click(screen.getByRole('button', { name: 'Cerrar' }))

    await waitFor(() => expect(onCerrar).toHaveBeenCalled())
    expect(screen.queryByText('Tienes cambios sin guardar. ¿Qué deseas hacer?')).toBeNull()
  })

  it('cambiar un valor y cerrar dispara la protección de cambios sin guardar (Decisión 68)', async () => {
    const { db, FormularioJugador, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const ficha = await sembrarJugadorActivo(db, agregarJugador, liga, equipoA.id)
    const user = userEvent.setup()
    const { onCerrar } = renderFormulario(FormularioJugador, { liga, equipoId: equipoA.id, ficha })

    await user.clear(screen.getByLabelText('Número *'))
    await user.type(screen.getByLabelText('Número *'), '11')
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))

    expect(await screen.findByText('Tienes cambios sin guardar. ¿Qué deseas hacer?')).toBeTruthy()
    expect(onCerrar).not.toHaveBeenCalled()
  })

  it('guardar cambios llama a la operación real editarJugador, persiste, y avisa éxito', async () => {
    const { db, FormularioJugador, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const ficha = await sembrarJugadorActivo(db, agregarJugador, liga, equipoA.id)
    const user = userEvent.setup()
    const { onCerrar, onExito } = renderFormulario(FormularioJugador, { liga, equipoId: equipoA.id, ficha })

    await user.clear(screen.getByLabelText('Segundo apellido'))
    await user.type(screen.getByLabelText('Segundo apellido'), 'Robles Vega')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(onExito).toHaveBeenCalledWith('Jugador actualizado'))
    expect(onCerrar).toHaveBeenCalled()

    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd.apellido2).toBe('Robles Vega')
    expect(enBd.nombre).toBe('Miguel Sam Robles Vega')
    expect(enBd.personaId).toBe(ficha.personaId)
  })

  it('editar solo el número no dispara la resolución de duplicados por nombre (Decisión 7)', async () => {
    const { db, FormularioJugador, agregarJugador } = await cargar()
    const { liga, equipoA, equipoB } = await sembrarLiga(db)
    // Otro jugador con el mismo nombre ya existe en la liga (otro equipo).
    await sembrarJugadorActivo(db, agregarJugador, liga, equipoB.id)
    const ficha = await sembrarJugadorActivo(db, agregarJugador, liga, equipoA.id, {
      ...camposBase, apellido1: 'Distinto', dorsal: 20,
    })
    const user = userEvent.setup()
    const { onExito } = renderFormulario(FormularioJugador, { liga, equipoId: equipoA.id, ficha })

    await user.clear(screen.getByLabelText('Número *'))
    await user.type(screen.getByLabelText('Número *'), '21')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    // Va directo a éxito: nunca pasa por la pantalla de candidatos.
    await waitFor(() => expect(onExito).toHaveBeenCalledWith('Jugador actualizado'))
    expect(screen.queryByText('Encontramos un jugador con el mismo nombre.')).toBeNull()
    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd.dorsal).toBe(21)
  })

  it('editar el nombre a uno que coincide con otro dispara la resolución de identidad, y guardar no cambia personaId (Decisiones 7, 57)', async () => {
    const { db, FormularioJugador, agregarJugador } = await cargar()
    const { liga, equipoA, equipoB } = await sembrarLiga(db)
    const otro = await sembrarJugadorActivo(db, agregarJugador, liga, equipoB.id)
    const ficha = await sembrarJugadorActivo(db, agregarJugador, liga, equipoA.id, {
      ...camposBase, apellido1: 'Distinto', dorsal: 20,
    })
    const user = userEvent.setup()
    const { onExito } = renderFormulario(FormularioJugador, { liga, equipoId: equipoA.id, ficha })

    await user.clear(screen.getByLabelText('Primer apellido *'))
    await user.type(screen.getByLabelText('Primer apellido *'), 'Sam')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('Encontramos un jugador con el mismo nombre.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Es la misma persona' }))

    await waitFor(() => expect(onExito).toHaveBeenCalledWith('Jugador actualizado'))
    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd.apellido1).toBe('Sam')
    // Editar nunca reasigna personaId (Decisión 57), incluso confirmando "misma persona".
    expect(enBd.personaId).toBe(ficha.personaId)
    expect(enBd.personaId).not.toBe(otro.personaId)
  })

  it('puede borrar una fecha de nacimiento previamente registrada (Decisión 56)', async () => {
    const { db, FormularioJugador, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const ficha = await sembrarJugadorActivo(db, agregarJugador, liga, equipoA.id, {
      ...camposBase, fechaNacimiento: '2000-05-15',
    })
    const user = userEvent.setup()
    const { onExito } = renderFormulario(FormularioJugador, { liga, equipoId: equipoA.id, ficha })

    await user.clear(screen.getByLabelText('Fecha de nacimiento'))
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(onExito).toHaveBeenCalledWith('Jugador actualizado'))
    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd.fechaNacimiento).toBeUndefined()
  })

  it('un conflicto de número al guardar preserva los datos escritos (Decisión 63)', async () => {
    const { db, FormularioJugador, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    await sembrarJugadorActivo(db, agregarJugador, liga, equipoA.id, { ...camposBase, dorsal: 5 })
    const ficha = await sembrarJugadorActivo(db, agregarJugador, liga, equipoA.id, {
      ...camposBase, apellido1: 'Distinto', dorsal: 20,
    })
    const user = userEvent.setup()
    renderFormulario(FormularioJugador, { liga, equipoId: equipoA.id, ficha })

    await user.clear(screen.getByLabelText('Número *'))
    await user.type(screen.getByLabelText('Número *'), '5')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText('Ese número ya lo tiene otro jugador activo de este equipo.')).toBeTruthy()
    // El formulario sigue abierto con lo que el organizador ya había escrito.
    expect(screen.getByLabelText('Número *').value).toBe('5')
    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd.dorsal).toBe(20)
  })
})

describe('ConfirmarDesactivar (Stage 3B, Slice 5 — Decisiones 8, 25, 85, 105)', () => {
  async function sembrarJugadorActivo(db, agregarJugador, liga, equipoId) {
    const r = await agregarJugador({ sesion: sesionDueno, liga, equipoId, campos: camposBase })
    expect(r.tipo).toBe('creado')
    return r.ficha
  }

  it('identifica al jugador y cancelar no muta nada', async () => {
    const { db, ConfirmarDesactivar, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const ficha = await sembrarJugadorActivo(db, agregarJugador, liga, equipoA.id)
    const onCerrar = vi.fn()
    const onExito = vi.fn()
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <ConfirmarDesactivar sesion={sesionDueno} liga={liga} ficha={ficha} onCerrar={onCerrar} onExito={onExito} />
      </MemoryRouter>,
    )

    expect(screen.getByText(`#${ficha.dorsal} ${ficha.nombre}`, { exact: false })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onExito).not.toHaveBeenCalled()
    expect(onCerrar).toHaveBeenCalled()
    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd.activo).not.toBe(false)
  })

  it('confirmar desactiva vía la operación real: desaparece de rosterActivo, se conserva la ficha, y libera el número', async () => {
    const { db, ConfirmarDesactivar, agregarJugador } = await cargar()
    const { rosterActivo } = await import('./lib/roster.js')
    const { liga, equipoA } = await sembrarLiga(db)
    const ficha = await sembrarJugadorActivo(db, agregarJugador, liga, equipoA.id)
    const onCerrar = vi.fn()
    const onExito = vi.fn()
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <ConfirmarDesactivar sesion={sesionDueno} liga={liga} ficha={ficha} onCerrar={onCerrar} onExito={onExito} />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Desactivar jugador' }))

    await waitFor(() => expect(onExito).toHaveBeenCalledWith('Jugador desactivado'))
    expect(onCerrar).toHaveBeenCalled()

    // La ficha se conserva — no se borra — pero ya no aparece en la plantilla activa.
    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd).toBeTruthy()
    expect(enBd.activo).toBe(false)
    expect(enBd.desactivadoEn).toBeTruthy()
    const activos = await rosterActivo(equipoA.id)
    expect(activos.find((j) => j.id === ficha.id)).toBeUndefined()

    // El número queda disponible para otro jugador activo del mismo equipo.
    const otro = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipoA.id,
      campos: { nombrePila: 'Ana', apellido1: 'Julia', apellido2: 'Rodríguez', dorsal: ficha.dorsal },
    })
    expect(otro.tipo).toBe('creado')
  })

  it('rechaza la desactivación si la sesión no es la organizadora dueña, y no muta nada', async () => {
    const { db, ConfirmarDesactivar, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const ficha = await sembrarJugadorActivo(db, agregarJugador, liga, equipoA.id)
    const onCerrar = vi.fn()
    const onExito = vi.fn()
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <ConfirmarDesactivar sesion={sesionOtro} liga={liga} ficha={ficha} onCerrar={onCerrar} onExito={onExito} />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Desactivar jugador' }))

    expect(await screen.findByText('No autorizado para modificar la plantilla de este equipo.')).toBeTruthy()
    expect(onExito).not.toHaveBeenCalled()
    expect(onCerrar).not.toHaveBeenCalled()
    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd.activo).not.toBe(false)
  })
})

describe('ConfirmarReactivar (Stage 3B, Slice 7 — Decisiones 31, 32, 40, 44, 63)', () => {
  async function sembrarJugadorInactivo(db, agregarJugador, desactivarJugador, liga, equipoId, campos = camposBase) {
    const r = await agregarJugador({ sesion: sesionDueno, liga, equipoId, campos })
    expect(r.tipo).toBe('creado')
    const d = await desactivarJugador({ sesion: sesionDueno, liga, ficha: r.ficha })
    expect(d.tipo).toBe('desactivado')
    return d.ficha
  }

  function renderReactivar(ConfirmarReactivar, { liga, ficha, onCerrar = vi.fn(), onExito = vi.fn() }) {
    render(
      <MemoryRouter>
        <ConfirmarReactivar sesion={sesionDueno} liga={liga} ficha={ficha} onCerrar={onCerrar} onExito={onExito} />
      </MemoryRouter>,
    )
    return { onCerrar, onExito }
  }

  it('identifica al jugador y cancelar no muta nada', async () => {
    const { db, ConfirmarReactivar, agregarJugador, desactivarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const ficha = await sembrarJugadorInactivo(db, agregarJugador, desactivarJugador, liga, equipoA.id)
    const user = userEvent.setup()
    const { onCerrar, onExito } = renderReactivar(ConfirmarReactivar, { liga, ficha })

    expect(screen.getByText(`#${ficha.dorsal} ${ficha.nombre}`, { exact: false })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onExito).not.toHaveBeenCalled()
    expect(onCerrar).toHaveBeenCalled()
    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd.activo).toBe(false)
  })

  it('confirmar reactiva vía la operación real: recupera el número anterior y reaparece en rosterActivo', async () => {
    const { db, ConfirmarReactivar, agregarJugador, desactivarJugador } = await cargar()
    const { rosterActivo, rosterInactivo } = await import('./lib/roster.js')
    const { liga, equipoA } = await sembrarLiga(db)
    const ficha = await sembrarJugadorInactivo(db, agregarJugador, desactivarJugador, liga, equipoA.id)
    const user = userEvent.setup()
    const { onExito, onCerrar } = renderReactivar(ConfirmarReactivar, { liga, ficha })

    await user.click(screen.getByRole('button', { name: 'Reactivar jugador' }))

    await waitFor(() => expect(onExito).toHaveBeenCalledWith('Jugador reactivado'))
    expect(onCerrar).toHaveBeenCalled()

    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd.activo).toBe(true)
    expect(enBd.dorsal).toBe(ficha.dorsal)
    const activos = await rosterActivo(equipoA.id)
    expect(activos.find((j) => j.id === ficha.id)).toBeTruthy()
    const inactivos = await rosterInactivo(equipoA.id)
    expect(inactivos.find((j) => j.id === ficha.id)).toBeUndefined()
  })

  it('número anterior ocupado por otro activo: no auto-renumera, pide reemplazo y reintenta con éxito', async () => {
    const { db, ConfirmarReactivar, agregarJugador, desactivarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const ficha = await sembrarJugadorInactivo(db, agregarJugador, desactivarJugador, liga, equipoA.id)
    // Otro jugador activo ahora ocupa el número que tenía la ficha inactiva.
    const otro = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipoA.id,
      campos: { nombrePila: 'Ana', apellido1: 'Julia', apellido2: 'Rodríguez', dorsal: ficha.dorsal },
    })
    expect(otro.tipo).toBe('creado')

    const user = userEvent.setup()
    const { onExito } = renderReactivar(ConfirmarReactivar, { liga, ficha })

    await user.click(screen.getByRole('button', { name: 'Reactivar jugador' }))

    expect(await screen.findByText('Ese número ya lo tiene otro jugador activo de este equipo.')).toBeTruthy()
    // Sigue pidiendo confirmación explícita: no reporta éxito ni cambia el número del otro jugador.
    expect(onExito).not.toHaveBeenCalled()
    const otroEnBd = await db.jugadores.get(otro.ficha.id)
    expect(otroEnBd.dorsal).toBe(ficha.dorsal)

    await user.type(screen.getByLabelText('Número *'), '33')
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    await waitFor(() => expect(onExito).toHaveBeenCalledWith('Jugador reactivado'))
    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd.activo).toBe(true)
    expect(enBd.dorsal).toBe(33)
  })

  it('ficha sin número usable exige uno explícito antes de reactivar', async () => {
    const { db, ConfirmarReactivar, agregarJugador, desactivarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const ficha = await sembrarJugadorInactivo(db, agregarJugador, desactivarJugador, liga, equipoA.id)
    // Simula una ficha heredada/inconsistente sin dorsal utilizable.
    await db.jugadores.update(ficha.id, { dorsal: undefined })
    const fichaSinNumero = await db.jugadores.get(ficha.id)

    const user = userEvent.setup()
    const { onExito } = renderReactivar(ConfirmarReactivar, { liga, ficha: fichaSinNumero })

    await user.click(screen.getByRole('button', { name: 'Reactivar jugador' }))

    expect(await screen.findByText('El número es obligatorio.')).toBeTruthy()
    expect(onExito).not.toHaveBeenCalled()
    expect((await db.jugadores.get(ficha.id)).activo).toBe(false)

    await user.type(screen.getByLabelText('Número *'), '12')
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    await waitFor(() => expect(onExito).toHaveBeenCalledWith('Jugador reactivado'))
    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd.activo).toBe(true)
    expect(enBd.dorsal).toBe(12)
  })

  it('un número de reemplazo inválido es recuperable: no cierra el flujo ni reporta éxito', async () => {
    const { db, ConfirmarReactivar, agregarJugador, desactivarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const ficha = await sembrarJugadorInactivo(db, agregarJugador, desactivarJugador, liga, equipoA.id)
    const otro = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipoA.id,
      campos: { nombrePila: 'Ana', apellido1: 'Julia', apellido2: 'Rodríguez', dorsal: ficha.dorsal },
    })
    expect(otro.tipo).toBe('creado')

    const user = userEvent.setup()
    const { onExito, onCerrar } = renderReactivar(ConfirmarReactivar, { liga, ficha })

    await user.click(screen.getByRole('button', { name: 'Reactivar jugador' }))
    expect(await screen.findByText('Ese número ya lo tiene otro jugador activo de este equipo.')).toBeTruthy()

    await user.type(screen.getByLabelText('Número *'), '150')
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('El número debe ser un entero entre 0 y 99.')).toBeTruthy()
    expect(onExito).not.toHaveBeenCalled()
    expect(onCerrar).not.toHaveBeenCalled()
    // El flujo sigue abierto con el número escrito, para corregirlo sin perderlo.
    expect(screen.getByLabelText('Número *').value).toBe('150')
    expect((await db.jugadores.get(ficha.id)).activo).toBe(false)
  })

  it('rechaza la reactivación si la sesión no es la organizadora dueña, y no muta nada', async () => {
    const { db, ConfirmarReactivar, agregarJugador, desactivarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const ficha = await sembrarJugadorInactivo(db, agregarJugador, desactivarJugador, liga, equipoA.id)
    const onExito = vi.fn()
    const onCerrar = vi.fn()
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <ConfirmarReactivar sesion={sesionOtro} liga={liga} ficha={ficha} onCerrar={onCerrar} onExito={onExito} />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Reactivar jugador' }))

    expect(await screen.findByText('No autorizado para modificar la plantilla de este equipo.')).toBeTruthy()
    expect(onExito).not.toHaveBeenCalled()
    expect(onCerrar).not.toHaveBeenCalled()
    const enBd = await db.jugadores.get(ficha.id)
    expect(enBd.activo).toBe(false)
  })
})
