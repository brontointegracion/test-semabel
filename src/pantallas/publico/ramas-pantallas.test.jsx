/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { __reiniciar } from '../../lib/sesion-servidor'
import { respuestaEquipo, respuestaLiga } from '../../lib/publico/datos-prueba.js'
import { conConexion, escenario, instalarCandados } from '../../prueba/compartido'

// REPORT_220 — «Rama: …» en la página pública del equipo y en la pantalla del organizador. Sin rama: no se muestra nada. Sin etiqueta de liga, sin filtro, sin default.

const respuesta = (cuerpo) => new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json' } })
const RUTA_EQ = (e) => `/v1/ligas/LIGAPUB1/equipos/${e}/publico`
function servidor(rama) {
  const liga = respuestaLiga()
  liga.equipos = liga.equipos.map((e, i) => (i === 0 && rama !== undefined ? { ...e, rama } : e))
  const eq = respuestaEquipo()
  eq.equipo = { ...eq.equipo, ...(rama === undefined ? {} : { rama }) }
  const rutas = { '/v1/ligas/LIGAPUB1/publico': liga, [RUTA_EQ('E1')]: eq }
  vi.stubGlobal('fetch', vi.fn(async (ruta) => (rutas[ruta] ? respuesta(rutas[ruta]) : new Response('{"error":"no-encontrado"}', { status: 404, headers: { 'content-type': 'application/json' } }))))
}
const montarEquipo = () => render(<MemoryRouter initialEntries={['/liga/LIGAPUB1/equipo/E1']}><AppCompartida /></MemoryRouter>)

describe('página pública del equipo', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MODO_COMPARTIDO', '1'); vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1')
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it.each([['mixta', 'Mixta'], ['masculino', 'Masculino'], ['femenino', 'Femenino']])('rama %s → «Rama: %s» (pequeña, junto al nombre del equipo)', async (rama, etiqueta) => {
    servidor(rama); montarEquipo()
    expect(await screen.findByText(`Rama: ${etiqueta}`)).toBeTruthy()
    expect(document.querySelector('[data-rama]').getAttribute('data-rama')).toBe(rama)
    expect(document.querySelectorAll('[data-rama]')).toHaveLength(1)
  })

  it('sin rama (null, ausente o un valor desconocido): no se muestra nada ni se inventa «Rama por confirmar» ni un valor por omisión', async () => {
    for (const v of [null, undefined, 'otra']) {
      servidor(v); montarEquipo()
      await screen.findByText('Plantilla')
      expect(document.body.textContent).not.toMatch(/Rama:|Mixta|Masculino|Femenino|por confirmar/)
      cleanup()
    }
  })
})

describe('pantalla del organizador (plantilla del equipo)', () => {
  let srv; let candados
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); __reiniciar(); candados = instalarCandados(); conConexion(); srv = escenario() })
  afterEach(() => { cleanup(); candados.quitar(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
  const conRama = (rama) => vi.stubGlobal('fetch', async (url, op) => {
    const r = await srv.fetch(url, op)
    if (/\/equipos\/E1\/jugadores$/.test(url) && (op?.method ?? 'GET') === 'GET') {
      const c = await r.clone().json()
      return new Response(JSON.stringify({ ...c, equipo: { ...c.equipo, ...(rama === undefined ? {} : { rama }) } }), { status: r.status, headers: r.headers })
    }
    return r
  })
  const abrir = () => render(<MemoryRouter initialEntries={['/organizador/ligas/LIGA-U10/equipos/E1']}><AppCompartida /></MemoryRouter>)

  it('«Rama: Mixta» bajo el nombre del equipo cuando el servidor la da; nada cuando no', async () => {
    conRama('mixta'); abrir()
    expect(await screen.findByText('Rama: Mixta')).toBeTruthy()
    cleanup()
    conRama(undefined); abrir()
    await screen.findByRole('heading', { name: 'Alfa' })
    await waitFor(() => expect(screen.queryByText(/Rama:/)).toBeNull())
  })
})
