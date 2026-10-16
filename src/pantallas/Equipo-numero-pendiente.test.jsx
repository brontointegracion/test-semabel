/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// S3b — avisos "Número pendiente" en las listas de plantilla de Equipo, solo
// para el organizador dueño (esDuenoDe). Equipo real, fake-indexeddb, datos sintéticos.

function borrarBd() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('sebel')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

async function cargar() {
  const dbMod = await import('../db.js')
  const eq = await import('./Equipo.jsx')
  const r = await import('../lib/roster.js')
  await dbMod.db.jugadores.toArray()
  return { db: dbMod.db, Equipo: eq.default, ...r }
}

beforeEach(async () => { await borrarBd(); vi.resetModules() })
afterEach(async () => { cleanup(); await borrarBd() })

const dueno = { rol: 'organizador', cuentaId: 'yo' }
const ajeno = { rol: 'organizador', cuentaId: 'otro' }
const liga = { id: 'liga1', codigo: '1001', estado: 'publicada', organizadorId: 'yo' }
const equipo = { id: 'equipoA', ligaId: 'liga1', codigo: '2001', nombre: 'Los Tigres', corto: 'TIG' }
const base = { apellido2: '', nombreCamiseta: '', fechaNacimiento: '' }

// Activos: Pendiente Uno (sin número), Cero Real (#0), Siete Real (#7).
// Inactivos: Inactivo Pend (sin número), Inactivo Num (#3).
async function sembrar(m) {
  await m.db.ligas.add(liga)
  await m.db.equipos.add(equipo)
  const crear = async (nombrePila, apellido1, extra) => {
    const r = await m.agregarJugador({ sesion: dueno, liga, equipoId: equipo.id, campos: { ...base, nombrePila, apellido1, ...extra } })
    expect(r.tipo).toBe('creado')
    return r.ficha
  }
  // El dominio ya no crea jugadores sin número (política del piloto): estos registros
  // anteriores se siembran directo, como los dejaría un dato heredado.
  const anterior = async (id, nombrePila, apellido1, extra = {}) => {
    const ficha = {
      id, codigo: `9${id.length}00${id.slice(-1)}`, ligaId: liga.id, equipoId: equipo.id, personaId: `p-${id}`,
      nombrePila, apellido1, apellido2: '', nombre: `${nombrePila} ${apellido1}`, nombreCamiseta: '', reclamado: false, activo: true, ...extra,
    }
    await m.db.jugadores.add(ficha)
    return ficha
  }
  const f = {
    pend: await anterior('anterior1', 'Pendiente', 'Uno'),
    cero: await crear('Cero', 'Real', { dorsal: 0 }),
    siete: await crear('Siete', 'Real', { dorsal: 7 }),
    inaPend: await anterior('anterior2', 'Inactivo', 'Pend', { activo: false, desactivadoEn: '2026-01-01T00:00:00.000Z' }),
    inaNum: await crear('Inactivo', 'Num', { dorsal: 3 }),
  }
  await m.desactivarJugador({ sesion: dueno, liga, ficha: f.inaNum })
  return f
}

function renderEquipo(Equipo) {
  render(
    <MemoryRouter initialEntries={[`/e/${equipo.codigo}`]}>
      <Routes><Route path="/e/:slug" element={<Equipo />} /></Routes>
    </MemoryRouter>,
  )
}

const fila = (nombre) => screen.getByText(nombre).closest('.jugador-fila')
const notas = (el) => within(el).queryAllByRole('note')

describe('Equipo — avisos de Número pendiente', () => {
  it('el organizador dueño ve el aviso solo en la fila activa pendiente; #0 y #7 no lo tienen', async () => {
    const m = await cargar(); await sembrar(m)
    await m.db.meta.put({ id: 'sesion', ...dueno })
    renderEquipo(m.Equipo)
    await screen.findByText('Pendiente Uno')
    expect(notas(fila('Pendiente Uno'))).toHaveLength(1)
    expect(notas(fila('Pendiente Uno'))[0].textContent).toContain('Número pendiente')
    expect(within(fila('Pendiente Uno')).getByText('—')).toBeTruthy()
    expect(notas(fila('Cero Real'))).toHaveLength(0)
    expect(within(fila('Cero Real')).getByText('0')).toBeTruthy()
    expect(notas(fila('Siete Real'))).toHaveLength(0)
    expect(screen.getAllByRole('note')).toHaveLength(1)
  })

  it('conserva enlaces de jugador y menú de gestión del dueño', async () => {
    const m = await cargar(); const f = await sembrar(m)
    await m.db.meta.put({ id: 'sesion', ...dueno })
    renderEquipo(m.Equipo)
    await screen.findByText('Pendiente Uno')
    const enlace = fila('Pendiente Uno').querySelector('a')
    expect(enlace.getAttribute('href')).toContain(f.pend.codigo)
    expect(within(fila('Pendiente Uno')).getByRole('button', { name: 'Acciones del jugador' })).toBeTruthy()
  })

  it('en inactivos, el dueño ve el aviso solo del inactivo pendiente', async () => {
    const m = await cargar(); await sembrar(m)
    await m.db.meta.put({ id: 'sesion', ...dueno })
    const user = userEvent.setup()
    renderEquipo(m.Equipo)
    await user.click(await screen.findByRole('button', { name: 'Ver inactivos' }))
    await screen.findByText('Inactivo Pend')
    expect(notas(fila('Inactivo Pend'))).toHaveLength(1)
    expect(within(fila('Inactivo Pend')).getByText('—')).toBeTruthy()
    expect(notas(fila('Inactivo Num'))).toHaveLength(0)
    expect(screen.getAllByRole('note')).toHaveLength(1)
  })

  it.each([
    ['visitante', { rol: 'invitado' }],
    ['organizador ajeno', ajeno],
  ])('%s ve "—" sin aviso ni controles de gestión', async (_n, sesion) => {
    const m = await cargar(); await sembrar(m)
    await m.db.meta.put({ id: 'sesion', ...sesion })
    renderEquipo(m.Equipo)
    await screen.findByText('Pendiente Uno')
    expect(within(fila('Pendiente Uno')).getByText('—')).toBeTruthy()
    expect(screen.queryByText(/Número pendiente/)).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Acciones del jugador' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ver inactivos' })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Añadir jugador' })).toBeNull()
    expect(fila('Pendiente Uno').querySelector('a')).toBeTruthy()
  })

  it('reactivar desde Equipo muestra el aviso en la hoja, pide un número real y no reactiva sola', async () => {
    const m = await cargar(); const f = await sembrar(m)
    await m.db.meta.put({ id: 'sesion', ...dueno })
    const user = userEvent.setup()
    renderEquipo(m.Equipo)
    await user.click(await screen.findByRole('button', { name: 'Ver inactivos' }))
    await screen.findByText('Inactivo Pend')
    await user.click(within(fila('Inactivo Pend')).getByRole('button', { name: 'Acciones del jugador' }))
    await user.click(screen.getByRole('menuitem', { name: 'Reactivar jugador' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Reactivar jugador' })
    expect(within(dialogo).getByRole('note').textContent).toContain('Número pendiente')
    await user.click(within(dialogo).getByRole('button', { name: 'Reactivar jugador' }))
    // Pide un número real: no hay control pendiente y el campo empieza vacío.
    expect((await within(dialogo).findByLabelText('Número *')).value).toBe('')
    expect(within(dialogo).queryByLabelText('Número pendiente')).toBeNull()
    expect((await m.db.jugadores.get(f.inaPend.id)).activo).toBe(false)
  })
})
