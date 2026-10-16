/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { respuestaEquipo, respuestaLiga } from '../../lib/publico/datos-prueba.js'

// CLAVES PÚBLICAS DE EQUIPO (REPORT_152): /liga/<liga>/equipo/<clave> con la clave resuelta contra la lista real de equipos de la liga.
// Servidor falso y datos sintéticos.

const L = 'PLAT-U10'
const RUTA_LIGA = `/v1/ligas/${L}/publico`
const rutaEquipo = (id) => `/v1/ligas/${L}/equipos/${id}/publico`
const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
let llamadas

function servidor(equiposDeLaLiga) {
  llamadas = []
  const liga = respuestaLiga({ id: L, nombre: 'Liga con prefijo', partidos: [] })
  liga.equipos = equiposDeLaLiga
  const fn = vi.fn(async (ruta) => {
    llamadas.push(ruta)
    if (ruta === RUTA_LIGA) return respuesta(liga)
    const m = /^\/v1\/ligas\/PLAT-U10\/equipos\/([^/]+)\/publico$/.exec(ruta)
    const e = m && equiposDeLaLiga.find((x) => x.id === m[1])
    if (!e) return respuesta({ error: 'no-encontrado' }, 404)
    const r = respuestaEquipo({ ligaId: L, equipoId: e.id })
    r.equipo.nombre = e.nombre
    return respuesta(r)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const montar = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><AppCompartida /></MemoryRouter>)
const EQUIPOS = [{ id: `${L}-DEPORTIVO`, nombre: 'Deportivo' }, { id: `${L}-VIP`, nombre: 'VIP' }]

beforeEach(() => {
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', L)
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('clave pública de equipo en la dirección', () => {
  it('/liga/<liga>/equipo/DEPORTIVO abre el equipo correcto y pide su id interno completo', async () => {
    servidor(EQUIPOS)
    montar(`/liga/${L}/equipo/DEPORTIVO`)
    expect(await screen.findByText('Plantilla')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Deportivo/ })).toBeTruthy()
    expect(llamadas).toEqual([RUTA_LIGA, rutaEquipo(`${L}-DEPORTIVO`)])
  })

  it('compatibilidad: el id completo sigue funcionando; también la clave en minúsculas', async () => {
    servidor(EQUIPOS)
    montar(`/liga/${L}/equipo/${L}-VIP`)
    expect(await screen.findByRole('heading', { name: /VIP/ })).toBeTruthy()
    cleanup()
    servidor(EQUIPOS)
    montar(`/liga/${L}/equipo/vip`)
    expect(await screen.findByRole('heading', { name: /VIP/ })).toBeTruthy()
  })

  it('clave desconocida: falla claro y NO pide ningún equipo', async () => {
    servidor(EQUIPOS)
    montar(`/liga/${L}/equipo/NO-EXISTE`)
    expect(await screen.findByText('No encontramos este equipo')).toBeTruthy()
    expect(llamadas).toEqual([RUTA_LIGA])
  })

  it('clave ambigua: falla claro (no elige uno) y NO pide ningún equipo', async () => {
    servidor([{ id: `${L}-Deportivo`, nombre: 'Uno' }, { id: `${L}-DEPORTIVO`, nombre: 'Dos' }, { id: `${L}-VIP`, nombre: 'VIP' }])
    montar(`/liga/${L}/equipo/deportivo`)
    expect(await screen.findByText('Este enlace de equipo no es claro')).toBeTruthy()
    expect(llamadas).toEqual([RUTA_LIGA])
  })

  it('la liga muestra sus equipos con la clave (sin repetir la liga) y esos enlaces abren el equipo', async () => {
    servidor(EQUIPOS)
    montar(`/liga/${L}`)
    const enlace = await screen.findByRole('link', { name: 'Deportivo' })
    expect(enlace.getAttribute('href')).toBe(`/liga/${L.toLowerCase()}/equipo/deportivo`)
    expect(screen.getByRole('link', { name: 'VIP' }).getAttribute('href')).toBe(`/liga/${L.toLowerCase()}/equipo/vip`)
  })
})
