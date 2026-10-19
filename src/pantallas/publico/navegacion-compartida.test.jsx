/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { RUTAS_NO_DISPONIBLES, SIN_TABS_COMPARTIDO, TABS } from '../../lib/publico/navegacion.js'
import { __reiniciar, refrescar } from '../../lib/sesion-servidor.js'
import { respuestaLiga } from '../../lib/publico/datos-prueba.js'

// NAVEGACIÓN del modo compartido (REPORT_152): la barra de pestañas del original, las rutas originales sin servidor con su aviso explícito,
// «Mis ligas» hacia el panel del organizador y las pestañas del organizador solo con sesión CONFIRMADA por el servidor.

const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
let llamadas
function servidor(rutas = {}) {
  llamadas = []
  const fn = vi.fn(async (ruta) => {
    llamadas.push(ruta)
    const h = rutas[ruta]
    return h === undefined ? json({ error: 'no-autorizado' }, ruta.startsWith('/v1/organizador') ? 401 : 404) : (typeof h === 'function' ? h() : json(h))
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const montar = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><AppCompartida /></MemoryRouter>)

beforeEach(() => {
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1')
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  __reiniciar()
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('rutas originales sin servidor', () => {
  it('cada una responde con un aviso explícito (qué es y cómo volver); no monta el prototipo ni pide nada', async () => {
    for (const r of RUTAS_NO_DISPONIBLES) {
      const f = servidor()
      const ruta = r.ruta.replace(':slug', 'x-1234').replace(':codigo', '1234').replace(':deporte', 'baloncesto').replace(':categoria', 'u10')
      const { unmount } = montar(ruta)
      expect(await screen.findByText(`${r.nombre}: todavía no está disponible aquí.`), ruta).toBeTruthy()
      expect(screen.getByRole('link', { name: 'Ir al inicio' }).getAttribute('href')).toBe('/')
      expect(f, ruta).not.toHaveBeenCalled()
      expect(screen.queryByText(/Añadir jugador|Soy organizador|Desactivar/)).toBeNull()
      unmount()
    }
  })

  it('la lista cubre las rutas originales que no se montan (y ninguna de las montadas)', () => {
    const montadas = ['/', '/liga/:ligaId', '/organizador', '/anthony', '/control']
    for (const r of RUTAS_NO_DISPONIBLES) expect(montadas.some((m) => r.ruta === m)).toBe(false)
    expect(RUTAS_NO_DISPONIBLES.map((r) => r.ruta)).toEqual(expect.arrayContaining(['/siguiendo', '/saldo', '/nueva', '/canchas', '/figuras', '/noticias', '/l/:slug', '/p/:slug', '/e/:slug', '/j/:slug', '/b/:codigo', '/p/:slug/consola']))
  })

  it('la pestaña «Siguiendo» lleva a su aviso explícito', async () => {
    servidor({ '/v1/ligas/LIGAPUB1/publico': respuestaLiga({ partidos: [] }) })
    montar('/')
    await screen.findByText('Ahora mismo')
    fireEvent.click(screen.getAllByText('Siguiendo')[0])
    expect(await screen.findByText('Siguiendo: todavía no está disponible aquí.')).toBeTruthy()
  })
})

describe('pestañas y sesión del servidor', () => {
  it('un visitante ve Inicio y Siguiendo; la portada NO pregunta por la sesión; el panel y el partido no llevan pestañas', async () => {
    servidor({ '/v1/ligas/LIGAPUB1/publico': respuestaLiga({ partidos: [] }) })
    montar('/')
    await screen.findByText('Ahora mismo')
    expect([...document.querySelectorAll('nav.tabbar a')].map((a) => a.textContent)).toEqual(TABS.filter((t) => !t.organizador).map((t) => t.label))
    expect(llamadas.some((l) => l.startsWith('/v1/organizador'))).toBe(false)
    cleanup()
    servidor()
    montar('/organizador/acceso')
    await screen.findByLabelText('Código de acceso')
    expect(document.querySelector('nav.tabbar')).toBeNull()
    expect(SIN_TABS_COMPARTIDO.some((r) => r.test('/liga/L/partido/G'))).toBe(true)
    expect(SIN_TABS_COMPARTIDO.some((r) => r.test('/liga/L'))).toBe(false)
  })

  it('con la sesión del servidor CONFIRMADA aparecen «Mis ligas» y «Saldo»; sin ella (o con una local) no', async () => {
    servidor({ '/v1/organizador/yo': { organizadorId: 'org-1', ligas: ['LIGAPUB1'], expiraIdle: Date.now() + 1000, expiraAbs: Date.now() + 2000 }, '/v1/ligas/LIGAPUB1/publico': respuestaLiga({ partidos: [] }) })
    const { db } = await import('../../db')
    await db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'yo' }) // un rol LOCAL no concede nada
    montar('/')
    await screen.findByText('Ahora mismo')
    expect([...document.querySelectorAll('nav.tabbar a')].map((a) => a.textContent)).toEqual(['Inicio', 'Siguiendo'])
    await act(async () => { await refrescar({ conAviso: false }) }) // el servidor reconoce la sesión
    expect([...document.querySelectorAll('nav.tabbar a')].map((a) => a.textContent)).toEqual(['Inicio', 'Mis ligas', 'Siguiendo', 'Saldo'])
    expect(document.querySelector('nav.tabbar a[href="/organizador"]')?.textContent).toBe('Mis ligas') // la pestaña usa la dirección canónica (REPORT_179)
    expect(document.querySelector('.app').className).toContain('con-cuatro')
  })

  it('«Mis ligas» (/ligas) lleva al panel del organizador, que exige la sesión del servidor', async () => {
    servidor()
    montar('/ligas')
    expect(await screen.findByLabelText('Código de acceso')).toBeTruthy() // sin sesión: la entrada del organizador
  })
})
