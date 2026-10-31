/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import AppCompartida from '../AppCompartida'
import { __reiniciar } from '../lib/sesion-servidor'
import { conConexion, escenario, instalarCandados, json } from '../prueba/compartido'

// Partidos finalizados de la liga del organizador: solo datos sintéticos.
const lado = (id, puntos = 0) => ({ id, puntos, faltas: 0 })
const partido = (gameId, local, visita, extra = {}) => ({
  gameId, estado: 'programado', rev: 0, periodo: 1, programadoPara: null, inicioReal: null, sede: null,
  reloj: { estado: null, restanteMs: null, desdeMs: null }, local: lado(local), visita: lado(visita), ...extra,
})
const liga = (id, nombre, equipos, partidos) => ({ liga: { id, nombre, deporte: 'baloncesto', categoria: null, subcategoria: null }, servidorAhoraMs: Date.parse('2026-10-19T12:00:00Z'), faltasAlcance: 'partido', equipos, partidos })
const EQ = [{ id: 'E1', nombre: 'Alfa' }, { id: 'E2', nombre: 'Beta' }]
const MIXTA = liga('LIGA-U10', 'Liga Sub-10', EQ, [
  partido('g-f2', 'E2', 'E1', { estado: 'final', programadoPara: '2026-10-18T19:00:00.000Z', local: lado('E2', 40), visita: lado('E1', 22), sede: 'Cancha Uno' }),
  partido('g-vivo', 'E1', 'E2', { estado: 'vivo', programadoPara: '2026-10-19T11:00:00.000Z', local: lado('E1', 5), visita: lado('E2', 4) }),
  partido('g-prog', 'E1', 'E2', { programadoPara: '2026-10-20T14:05:00.000Z' }),
  partido('g-f1', 'E1', 'E2', { estado: 'final', programadoPara: '2026-10-17T17:00:00.000Z', local: lado('E1', 31), visita: lado('E2', 28) }),
])
const TODOS = liga('LIGA-U12', 'Liga Sub-12', [{ id: 'E3', nombre: 'Gama' }, { id: 'E4', nombre: 'Delta' }], [
  partido('g-a', 'E3', 'E4', { estado: 'final', programadoPara: '2026-10-17T17:00:00.000Z', local: lado('E3', 10), visita: lado('E4', 9) }),
])
let publicas
let usuario
let navegar
function Nav() { navegar = useNavigate(); return null }
const abrir = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><AppCompartida /><Nav /></MemoryRouter>)

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  __reiniciar(); instalarCandados(); conConexion()
  publicas = { 'LIGA-U10': MIXTA, 'LIGA-U12': TODOS }
  const base = escenario().fetch
  vi.stubGlobal('fetch', vi.fn(async (url, op = {}) => {
    const m = /^\/v1\/ligas\/([^/]+)\/publico$/.exec(url)
    if (m && publicas[m[1]]) return json(200, publicas[m[1]])
    return base(url, op)
  }))
  usuario = userEvent.setup()
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) vi.spyOn(console, m).mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const resumen = () => screen.findByText(/^Finalizados \(\d+\)$/)
const textos = (lista) => within(lista).getAllByRole('listitem', { hidden: true }).map((li) => li.textContent)

describe('partidos finalizados en la liga del organizador', () => {
  it('mixta: programados y en curso visibles primero; finalizados plegados por defecto y en su orden', async () => {
    abrir('/organizador/ligas/LIGA-U10')
    const resumenEl = await resumen()
    const visibles = textos(screen.getByRole('list', { name: 'Partidos' }))
    expect(visibles).toHaveLength(2)
    expect(visibles[0]).toContain('En curso'); expect(visibles[0]).toContain('5–4')
    expect(visibles[1]).toContain('Programado')
    expect(visibles.join(' ')).not.toContain('Finalizado')
    const det = resumenEl.closest('details')
    expect(det.open).toBe(false)
    expect(resumenEl.textContent).toBe('Finalizados (2)')
    // la sección va debajo de la lista de partidos
    expect(screen.getByRole('list', { name: 'Partidos' }).compareDocumentPosition(det) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const finales = textos(within(det).getByRole('list', { name: 'Partidos finalizados', hidden: true }))
    expect(finales).toHaveLength(2)
    expect(finales[0]).toContain('sáb 17 oct'); expect(finales[0]).toContain('31–28') // el orden por hora se conserva dentro del grupo
    expect(finales[1]).toContain('dom 18 oct'); expect(finales[1]).toContain('40–22'); expect(finales[1]).toContain('Cancha Uno')
  })

  it('expandir con el teclado, insignia «Finalizado» sin «Terminado» ni duplicados, y enlaces y botones intactos', async () => {
    abrir('/organizador/ligas/LIGA-U10')
    const resumenEl = await resumen()
    // <summary> nativo: entra en el orden de tabulación y el navegador lo activa con Enter/Espacio (jsdom no emula esa activación: aquí se prueba con clic).
    await usuario.tab(); await usuario.tab(); await usuario.tab()
    expect(resumenEl.tagName).toBe('SUMMARY')
    await usuario.click(resumenEl)
    const det = resumenEl.closest('details')
    await waitFor(() => expect(det.open).toBe(true))
    const tarjetas = within(det).getAllByRole('listitem')
    expect(tarjetas).toHaveLength(2)
    for (const t of tarjetas) {
      expect(within(t).getAllByText('Finalizado')).toHaveLength(1)
      expect(t.textContent).not.toContain('Terminado')
      expect(t.querySelector('.insignia-finalizado').textContent).toBe('Finalizado')
    }
    const acceso = within(tarjetas[0]).getByRole('link', { name: 'Preparar acceso de puntuación de Alfa contra Beta' })
    expect(acceso.getAttribute('href')).toBe('/organizador/ligas/LIGA-U10/partidos/g-f1')
    expect(within(tarjetas[0]).getByRole('link', { name: 'Ver marcador público de Alfa contra Beta' })).toBeTruthy()
    // los no finalizados conservan sus botones y no llevan insignia
    const vivo = within(screen.getByRole('list', { name: 'Partidos' })).getAllByRole('listitem')[0]
    expect(within(vivo).getByRole('link', { name: /Preparar acceso de puntuación/ })).toBeTruthy()
    expect(vivo.querySelector('.insignia-finalizado')).toBeNull()
  })

  it('la expansión se mantiene en un re-render ordinario (la lectura periódica)', async () => {
    abrir('/organizador/ligas/LIGA-U10')
    const resumenEl = await resumen()
    await usuario.click(resumenEl)
    const det = resumenEl.closest('details')
    expect(det.open).toBe(true)
    publicas['LIGA-U10'] = { ...MIXTA, partidos: MIXTA.partidos.map((p) => (p.gameId === 'g-vivo' ? { ...p, local: lado('E1', 9) } : p)) }
    await waitFor(() => expect(screen.getByText(/^Finalizados \(2\)$/)).toBeTruthy())
    expect(screen.getByText(/^Finalizados \(2\)$/).closest('details')).toBe(det)
    expect(det.open).toBe(true)
  })

  it('solo finalizados: aviso claro y sección plegada; sin partidos: mensaje vacío y sin sección', async () => {
    abrir('/organizador/ligas/LIGA-U12')
    const r = await resumen()
    expect(r.textContent).toBe('Finalizados (1)')
    expect(r.closest('details').open).toBe(false)
    expect(screen.queryByRole('list', { name: 'Partidos' })).toBeNull()
    expect(screen.getByText(/No hay partidos programados ni en curso/)).toBeTruthy()
    cleanup()
    publicas['LIGA-U12'] = { ...TODOS, partidos: [] }
    abrir('/organizador/ligas/LIGA-U12')
    expect(await screen.findByText('Esta liga todavía no tiene partidos.')).toBeTruthy()
    expect(screen.queryByText(/Finalizados/)).toBeNull()
    expect(screen.queryByText(/No hay partidos programados ni en curso/)).toBeNull()
  })

  it('sin finalizados: no hay sección', async () => {
    publicas['LIGA-U10'] = { ...MIXTA, partidos: MIXTA.partidos.filter((p) => p.estado !== 'final') }
    abrir('/organizador/ligas/LIGA-U10')
    expect(await screen.findByRole('list', { name: 'Partidos' })).toBeTruthy()
    expect(screen.queryByText(/Finalizados/)).toBeNull()
    expect(document.querySelector('details.finalizados')).toBeNull()
  })

  it('al cambiar de liga vuelve plegada', async () => {
    publicas['LIGA-U12'] = liga('LIGA-U12', 'Liga Sub-12', [{ id: 'E3', nombre: 'Gama' }, { id: 'E4', nombre: 'Delta' }], [
      partido('g-p', 'E3', 'E4', { programadoPara: '2026-10-21T14:00:00.000Z' }),
      partido('g-a', 'E3', 'E4', { estado: 'final', programadoPara: '2026-10-17T17:00:00.000Z' }),
    ])
    abrir('/organizador/ligas/LIGA-U10')
    await usuario.click(await resumen())
    expect(document.querySelector('details.finalizados').open).toBe(true)
    navegar('/organizador/ligas/LIGA-U12')
    await screen.findByRole('heading', { name: 'Liga Sub-12' })
    const r = await resumen()
    expect(r.closest('details').open).toBe(false)
  })
})
