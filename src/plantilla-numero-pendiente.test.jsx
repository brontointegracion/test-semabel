/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Política del piloto: solo jugadores con número. Formularios reales de añadir /
// editar / reactivar contra fake-indexeddb y las operaciones de dominio reales.
// No hay control de "Número pendiente"; un registro anterior sin número se corrige
// dándole uno. Datos sintéticos.
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
  const dbMod = await import('./db.js')
  const p = await import('./plantilla.jsx')
  const r = await import('./lib/roster.js')
  const eq = await import('./pantallas/Equipo.jsx')
  await dbMod.db.jugadores.toArray()
  return { db: dbMod.db, ...p, ...r, Equipo: eq.default }
}

beforeEach(async () => { await borrarBd(); vi.resetModules() })
afterEach(async () => { cleanup(); await borrarBd() })

const sesionDueno = { rol: 'organizador', cuentaId: 'yo' }
const liga = { id: 'liga1', codigo: '1001', estado: 'publicada', organizadorId: 'yo' }
const equipo = { id: 'equipoA', ligaId: 'liga1', codigo: '2001', nombre: 'Los Tigres', corto: 'TIG' }

async function sembrar(db) {
  await db.ligas.add(liga)
  await db.equipos.add(equipo)
  await db.meta.put({ id: 'sesion', ...sesionDueno })
}

const base = { nombrePila: 'Ana', apellido1: 'Julia', apellido2: '', nombreCamiseta: '', fechaNacimiento: '' }
const crear = async (m, campos) => {
  const r = await m.agregarJugador({ sesion: sesionDueno, liga, equipoId: equipo.id, campos: { ...base, ...campos } })
  expect(r.tipo).toBe('creado')
  return r.ficha
}
// Registro anterior sin número válido: el dominio ya no puede crearlo, se siembra directo.
const legado = async (m, extra = {}) => {
  const ficha = {
    id: 'legado1', codigo: '9100', ligaId: liga.id, equipoId: equipo.id, personaId: 'persona-legado',
    nombrePila: 'Ana', apellido1: 'Julia', apellido2: '', nombre: 'Ana Julia', nombreCamiseta: '', reclamado: false, activo: true, ...extra,
  }
  await m.db.jugadores.add(ficha)
  return ficha
}

function montar(m, props) {
  const onCerrar = vi.fn()
  const onExito = vi.fn()
  render(
    <MemoryRouter>
      <m.FormularioJugador sesion={sesionDueno} liga={liga} equipoId={equipo.id} onCerrar={onCerrar} onExito={onExito} {...props} />
    </MemoryRouter>,
  )
  return { onCerrar, onExito }
}

const numero = () => screen.getByLabelText('Número *')
const sinControlPendiente = () => {
  expect(screen.queryByLabelText('Número pendiente')).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
}
const fichas = (db) => db.jugadores.toArray()

async function llenarNombre(user, nombre = 'Luis', apellido = 'Perez') {
  await user.type(screen.getByLabelText('Nombre *'), nombre)
  await user.type(screen.getByLabelText('Primer apellido *'), apellido)
}

describe('Añadir — solo con número', () => {
  it('no hay control de Número pendiente', async () => {
    const m = await cargar(); await sembrar(m.db)
    montar(m)
    sinControlPendiente()
    expect(numero().disabled).toBe(false)
  })

  it('en blanco se rechaza: el error es visible, está asociado al campo y nada se guarda', async () => {
    const m = await cargar(); await sembrar(m.db)
    const user = userEvent.setup()
    montar(m)
    await llenarNombre(user)
    await user.click(screen.getByRole('button', { name: 'Añadir jugador' }))
    const error = await screen.findByText('El número es obligatorio.')
    expect(numero().getAttribute('aria-invalid')).toBe('true')
    expect(numero().getAttribute('aria-describedby')).toBe(error.id)
    expect(await fichas(m.db)).toHaveLength(0)
  })

  it('el número real 0 se acepta y se guarda como 0; "007" queda como 7', async () => {
    const m = await cargar(); await sembrar(m.db)
    const user = userEvent.setup()
    montar(m)
    await llenarNombre(user)
    await user.type(numero(), '0')
    await user.click(screen.getByRole('button', { name: 'Añadir jugador' }))
    await screen.findByText('Jugador añadido a la plantilla.')
    await user.click(screen.getByRole('button', { name: 'Añadir otro jugador' }))
    await llenarNombre(user, 'Beto', 'Luna')
    await user.type(numero(), '007')
    await user.click(screen.getByRole('button', { name: 'Añadir jugador' }))
    await screen.findByText('Jugador añadido a la plantilla.')
    expect((await fichas(m.db)).map((f) => f.dorsal).sort((a, b) => a - b)).toEqual([0, 7])
  })

  it('número duplicado entre activos, también el 0: el error sigue visible y no se crea ficha', async () => {
    const m = await cargar(); await sembrar(m.db)
    await crear(m, { nombrePila: 'Otro', apellido1: 'Tipo', dorsal: 0 })
    const user = userEvent.setup()
    montar(m)
    await llenarNombre(user)
    await user.type(numero(), '0')
    await user.click(screen.getByRole('button', { name: 'Añadir jugador' }))
    expect(await screen.findByText('Ese número ya lo tiene otro jugador activo de este equipo.')).toBeTruthy()
    expect(await fichas(m.db)).toHaveLength(1)
  })

  it('la fecha de nacimiento sigue siendo opcional', async () => {
    const m = await cargar(); await sembrar(m.db)
    const user = userEvent.setup()
    montar(m)
    await llenarNombre(user, 'J', 'Perez')
    await user.type(numero(), '5')
    await user.click(screen.getByRole('button', { name: 'Añadir jugador' }))
    await screen.findByText('Jugador añadido a la plantilla.')
    expect((await fichas(m.db))[0].fechaNacimiento).toBeUndefined()
  })
})

describe('Editar — solo con número', () => {
  it('un cambio de nombre conserva el número, la identidad y la ficha', async () => {
    const m = await cargar(); await sembrar(m.db)
    const ficha = await crear(m, { dorsal: 9 })
    const user = userEvent.setup()
    const { onCerrar } = montar(m, { ficha })
    sinControlPendiente()
    expect(numero().value).toBe('9')
    await user.clear(screen.getByLabelText('Nombre *'))
    await user.type(screen.getByLabelText('Nombre *'), 'Anita')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await vi.waitFor(() => expect(onCerrar).toHaveBeenCalled())
    expect(await m.db.jugadores.get(ficha.id)).toMatchObject({ nombrePila: 'Anita', dorsal: 9, personaId: ficha.personaId, codigo: ficha.codigo })
  })

  it('borrar el número y guardar se rechaza con error visible; la ficha no cambia', async () => {
    const m = await cargar(); await sembrar(m.db)
    const ficha = await crear(m, { dorsal: 9 })
    const user = userEvent.setup()
    const { onCerrar } = montar(m, { ficha })
    await user.clear(numero())
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('El número es obligatorio.')).toBeTruthy()
    expect(onCerrar).not.toHaveBeenCalled()
    expect((await m.db.jugadores.get(ficha.id)).dorsal).toBe(9)
  })

  it('un registro anterior sin número abre con el campo vacío y sin control pendiente; guardar sin número se rechaza y no lo cambia', async () => {
    const m = await cargar(); await sembrar(m.db)
    const l = await legado(m)
    const original = await m.db.jugadores.get(l.id)
    const user = userEvent.setup()
    const { onCerrar } = montar(m, { ficha: l })
    sinControlPendiente()
    expect(numero().value).toBe('')
    expect(numero().disabled).toBe(false)
    await user.clear(screen.getByLabelText('Nombre *'))
    await user.type(screen.getByLabelText('Nombre *'), 'Nuevo')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('El número es obligatorio.')).toBeTruthy()
    expect(onCerrar).not.toHaveBeenCalled()
    expect(await m.db.jugadores.get(l.id)).toEqual(original)
  })

  it('darle un número a un registro anterior lo guarda (el 0 es válido) y conserva identidad e historial', async () => {
    const m = await cargar(); await sembrar(m.db)
    const l = await legado(m)
    const user = userEvent.setup()
    const { onCerrar } = montar(m, { ficha: l })
    await user.type(numero(), '0')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await vi.waitFor(() => expect(onCerrar).toHaveBeenCalled())
    expect(await m.db.jugadores.get(l.id)).toMatchObject({ id: l.id, personaId: l.personaId, codigo: l.codigo, dorsal: 0 })
    expect((await m.db.auditoria.toArray()).filter((a) => a.fichaId === l.id).map((a) => a.tipo)).toEqual(['edited'])
  })

  it('un número duplicado al darle uno a un registro anterior: error visible y sigue sin número', async () => {
    const m = await cargar(); await sembrar(m.db)
    await crear(m, { nombrePila: 'Otro', apellido1: 'Tipo', dorsal: 4 })
    const l = await legado(m)
    const user = userEvent.setup()
    montar(m, { ficha: l })
    await user.type(numero(), '4')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Ese número ya lo tiene otro jugador activo de este equipo.')).toBeTruthy()
    expect('dorsal' in (await m.db.jugadores.get(l.id))).toBe(false)
  })
})

describe('Reactivar — solo con número', () => {
  const montarReactivar = (m, ficha) => {
    const onCerrar = vi.fn()
    const onExito = vi.fn()
    render(<m.ConfirmarReactivar sesion={sesionDueno} liga={liga} ficha={ficha} onCerrar={onCerrar} onExito={onExito} />)
    return { onCerrar, onExito }
  }
  const desactivar = (m, ficha) => m.desactivarJugador({ sesion: sesionDueno, liga, ficha })

  it('número anterior disponible: se conserva sin pedir nada', async () => {
    const m = await cargar(); await sembrar(m.db)
    const ficha = await crear(m, { dorsal: 8 })
    await desactivar(m, ficha)
    const user = userEvent.setup()
    const { onExito } = montarReactivar(m, ficha)
    await user.click(screen.getByRole('button', { name: 'Reactivar jugador' }))
    await vi.waitFor(() => expect(onExito).toHaveBeenCalledWith('Jugador reactivado'))
    expect(await m.db.jugadores.get(ficha.id)).toMatchObject({ activo: true, dorsal: 8 })
  })

  it('número ocupado: pide reemplazo sin control pendiente; en blanco se rechaza; uno válido (#0) reactiva', async () => {
    const m = await cargar(); await sembrar(m.db)
    const ficha = await crear(m, { dorsal: 8 })
    await desactivar(m, ficha)
    await crear(m, { nombrePila: 'Otro', apellido1: 'Tipo', dorsal: 8 })
    const user = userEvent.setup()
    const { onExito } = montarReactivar(m, ficha)
    await user.click(screen.getByRole('button', { name: 'Reactivar jugador' }))
    expect(await screen.findByText('Ese número ya lo tiene otro jugador activo de este equipo.')).toBeTruthy()
    sinControlPendiente()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    const error = await screen.findByText('El número es obligatorio.')
    expect(numero().getAttribute('aria-invalid')).toBe('true')
    expect(numero().getAttribute('aria-describedby')).toBe(error.id)
    expect((await m.db.jugadores.get(ficha.id)).activo).toBe(false)
    await user.type(numero(), '0')
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    await vi.waitFor(() => expect(onExito).toHaveBeenCalled())
    expect(await m.db.jugadores.get(ficha.id)).toMatchObject({ activo: true, dorsal: 0, personaId: ficha.personaId })
  })

  it('número ocupado y duplicado de nuevo: el error sigue visible y no se reactiva', async () => {
    const m = await cargar(); await sembrar(m.db)
    const ficha = await crear(m, { dorsal: 8 })
    await desactivar(m, ficha)
    await crear(m, { nombrePila: 'Otro', apellido1: 'Tipo', dorsal: 8 })
    const user = userEvent.setup()
    montarReactivar(m, ficha)
    await user.click(screen.getByRole('button', { name: 'Reactivar jugador' }))
    await screen.findByLabelText('Número *')
    await user.type(numero(), '8')
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Ese número ya lo tiene otro jugador activo de este equipo.')).toBeTruthy()
    expect((await m.db.jugadores.get(ficha.id)).activo).toBe(false)
  })

  it('registro anterior sin número: muestra el aviso, no reactiva solo, y con un número válido conserva identidad', async () => {
    const m = await cargar(); await sembrar(m.db)
    const l = await legado(m, { activo: false, desactivadoEn: '2026-01-01T00:00:00.000Z' })
    const user = userEvent.setup()
    const { onExito } = montarReactivar(m, l)
    expect(screen.getByRole('note').textContent).toContain('Número pendiente')
    await user.click(screen.getByRole('button', { name: 'Reactivar jugador' }))
    await screen.findByLabelText('Número *')
    sinControlPendiente()
    expect((await m.db.jugadores.get(l.id)).activo).toBe(false)
    expect((await m.db.auditoria.toArray()).filter((a) => a.tipo === 'reactivated')).toHaveLength(0)
    await user.type(numero(), '12')
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    await vi.waitFor(() => expect(onExito).toHaveBeenCalled())
    expect(await m.db.jugadores.get(l.id)).toMatchObject({ activo: true, dorsal: 12, id: l.id, personaId: l.personaId, codigo: l.codigo })
  })
})

describe('Avisos y acceso', () => {
  function renderEquipo(Equipo) {
    render(
      <MemoryRouter initialEntries={[`/e/${equipo.codigo}`]}>
        <Routes><Route path="/e/:slug" element={<Equipo />} /></Routes>
      </MemoryRouter>,
    )
  }

  it('el organizador edita un registro anterior desde Equipo: sin control pendiente y con el número vacío', async () => {
    const m = await cargar(); await sembrar(m.db)
    const l = await legado(m)
    const user = userEvent.setup()
    renderEquipo(m.Equipo)
    await screen.findByText(l.nombre)
    await user.click(screen.getByRole('button', { name: 'Acciones del jugador' }))
    await user.click(screen.getByRole('menuitem', { name: 'Editar jugador' }))
    const editar = await screen.findByRole('dialog', { name: 'Editar jugador' })
    expect(within(editar).queryByLabelText('Número pendiente')).toBeNull()
    expect(within(editar).getByLabelText('Número *').value).toBe('')
  })

  it('el visitante ve "—" y ningún texto "Número pendiente" ni controles de gestión', async () => {
    const m = await cargar(); await sembrar(m.db)
    const l = await legado(m)
    await m.db.meta.put({ id: 'sesion', rol: 'invitado' })
    renderEquipo(m.Equipo)
    await screen.findByText(l.nombre)
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.queryByText(/Número pendiente/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Acciones del jugador' })).toBeNull()
  })

  it('AvisoNumeroPendiente no aparece para fichas con número, incluido el 0', async () => {
    const m = await cargar()
    render(<><m.AvisoNumeroPendiente ficha={{ dorsal: 0 }} /><m.AvisoNumeroPendiente ficha={{ dorsal: 7 }} /></>)
    expect(screen.queryByRole('note')).toBeNull()
  })
})
