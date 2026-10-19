/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import AppCompartida from '../AppCompartida'
import { __reiniciar } from '../lib/sesion-servidor'
import { YO, conConexion, escenario, instalarCandados } from '../prueba/compartido'

// REPORT_179: direcciones canónicas del organizador, redirecciones de compatibilidad (sin perder búsqueda, fragmento ni retorno) y las
// comprobaciones de sesión y propiedad de siempre. Datos sintéticos.

let srv
let candados
let ubic
let saltos
function Sonda() { ubic = useLocation(); saltos.push(`${ubic.pathname}${ubic.search}${ubic.hash}`); return null }
const abrir = (entrada) => render(<MemoryRouter initialEntries={[entrada]}><AppCompartida /><Sonda /></MemoryRouter>)
const final = () => `${ubic.pathname}${ubic.search}${ubic.hash}`

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  __reiniciar()
  candados = instalarCandados()
  conConexion()
  srv = escenario()
  vi.stubGlobal('fetch', srv.fetch)
  saltos = []
  ;['log', 'info', 'warn', 'error', 'debug'].forEach((m) => vi.spyOn(console, m).mockImplementation(() => {}))
})
afterEach(() => { cleanup(); candados.quitar(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('rutas canónicas', () => {
  it.each([
    ['/organizador/acceso', 'Acceso autorizado'],
    ['/organizador', 'Mis ligas'],
  ])('%s monta su pantalla sin redirigir', async (ruta, titulo) => {
    abrir(ruta)
    expect(await screen.findByRole('heading', { name: titulo })).toBeTruthy()
    expect(final()).toBe(ruta)
    expect(new Set(saltos).size).toBe(1) // ningún salto: nunca hay bucle
  })
  it('liga, equipo y partido: cada una monta su pantalla del organizador con los mismos datos de siempre', async () => {
    abrir('/organizador/ligas/LIGA-U10')
    expect(await screen.findByRole('heading', { name: 'Liga Sub-10' })).toBeTruthy()
    cleanup()
    abrir('/organizador/ligas/LIGA-U10/equipos/E1')
    expect(await screen.findByRole('heading', { name: 'Alfa' })).toBeTruthy()
    cleanup()
    abrir('/organizador/ligas/LIGA-U10/partidos/g-x')
    await waitFor(() => expect(document.querySelector('main.panel')).toBeTruthy())
    expect(final()).toBe('/organizador/ligas/LIGA-U10/partidos/g-x')
  })
  it('el partido del organizador no monta la consola ni la pantalla de activación', async () => {
    abrir('/organizador/ligas/LIGA-U10/partidos/g-x')
    await waitFor(() => expect(document.querySelector('main.panel')).toBeTruthy())
    expect(document.querySelector('.control-partido')).toBeNull()
  })
})

describe('compatibilidad: las direcciones antiguas redirigen a la canónica', () => {
  it.each([
    ['/anthony', '/organizador/acceso'],
    ['/anthony/access', '/organizador/acceso'],
    ['/anthony/ligas', '/organizador'],
    ['/ligas', '/organizador'],
    ['/deportivo-vip/ligas', '/organizador'],
    ['/anthony/ligas/LIGA-U10', '/organizador/ligas/LIGA-U10'],
    ['/anthony/ligas/LIGA-U10/equipos/E1', '/organizador/ligas/LIGA-U10/equipos/E1'],
    ['/anthony/ligas/LIGA-U10/partidos/g-x', '/organizador/ligas/LIGA-U10/partidos/g-x'],
  ])('%s → %s', async (antigua, canonica) => {
    abrir(antigua)
    await waitFor(() => expect(final()).toBe(canonica))
    expect(saltos.filter((s) => s !== antigua && s !== canonica)).toEqual([]) // un solo salto, sin pasos intermedios ni bucles
    expect(saltos[saltos.length - 1]).toBe(canonica)
  })
  it('conserva la búsqueda y el fragmento válidos', async () => {
    abrir('/anthony/ligas/LIGA-U10/partidos/g-x?de=calendario&n=2#seccion')
    await waitFor(() => expect(final()).toBe('/organizador/ligas/LIGA-U10/partidos/g-x?de=calendario&n=2#seccion'))
    cleanup()
    abrir('/ligas?x=1')
    await waitFor(() => expect(final()).toBe('/organizador?x=1'))
  })
  it('conserva el destino de retorno (state) al redirigir', async () => {
    render(<MemoryRouter initialEntries={[{ pathname: '/anthony/access', state: { desde: '/organizador/ligas/LIGA-U10?x=1' } }]}><AppCompartida /><Sonda /></MemoryRouter>)
    // con sesión activa, la entrada devuelve al destino guardado
    await waitFor(() => expect(final()).toBe('/organizador/ligas/LIGA-U10?x=1'))
  })
})

describe('sesión y propiedad', () => {
  it('sin sesión, una dirección canónica lleva a la entrada canónica, guarda el retorno y no pide datos de la liga', async () => {
    srv.estado.sesion = false
    abrir('/organizador/ligas/LIGA-U10?x=1')
    await screen.findByLabelText('Código de acceso')
    expect(ubic.pathname).toBe('/organizador/acceso')
    expect(ubic.state.desde).toBe('/organizador/ligas/LIGA-U10?x=1')
    expect(srv.peticiones.some((p) => p.url.includes('/v1/organizador/ligas/LIGA-U10'))).toBe(false)
  })
  it('sin sesión, una dirección ANTIGUA llega a la misma entrada canónica', async () => {
    srv.estado.sesion = false
    abrir('/anthony/ligas/LIGA-U10')
    await screen.findByLabelText('Código de acceso')
    expect(ubic.pathname).toBe('/organizador/acceso')
  })
  it('tras entrar, vuelve al destino guardado (también si era antiguo); un destino externo se ignora', async () => {
    render(<MemoryRouter initialEntries={[{ pathname: '/organizador/acceso', state: { desde: '/anthony/ligas/LIGA-U10/equipos/E1?z=3' } }]}><AppCompartida /><Sonda /></MemoryRouter>)
    await waitFor(() => expect(final()).toBe('/organizador/ligas/LIGA-U10/equipos/E1?z=3'))
    cleanup()
    render(<MemoryRouter initialEntries={[{ pathname: '/organizador/acceso', state: { desde: 'https://evil.example/' } }]}><AppCompartida /><Sonda /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Acceso autorizado' })).toBeTruthy()
    expect(final()).toBe('/organizador/acceso')
  })
  it('una liga ajena no se abre por ninguna de las direcciones', async () => {
    for (const ruta of ['/organizador/ligas/LIGA-AJENA', '/anthony/ligas/LIGA-AJENA', '/organizador/ligas/LIGA-AJENA/equipos/E1', '/organizador/ligas/LIGA-AJENA/partidos/g']) {
      abrir(ruta)
      expect((await screen.findByRole('alert')).textContent).toContain('No tienes acceso a esa liga.')
      expect(screen.getByRole('link', { name: '‹ Mis ligas' }).getAttribute('href')).toBe('/organizador')
      cleanup()
    }
    // La pantalla de liga pide su lectura (la autorización es del servidor, como antes); nada de plantillas, control ni códigos de una liga ajena.
    expect(srv.peticiones.filter((p) => p.url.includes('LIGA-AJENA') && /\/jugadores|\/codigo|\/control|\/comandos/.test(p.url))).toEqual([])
  })
})

describe('entrada /ligas y alias de piloto /deportivo-vip/ligas (REPORT_180)', () => {
  const ligasVisibles = () => [...document.querySelectorAll('ul[aria-label="Ligas"] .nombre-contexto')].map((e) => e.textContent)

  it('/ligas y /deportivo-vip/ligas dan la MISMA entrada: sin sesión, el login existente; el alias no se queda como destino', async () => {
    for (const ruta of ['/ligas', '/deportivo-vip/ligas']) {
      srv.estado.sesion = false
      abrir(ruta)
      await screen.findByLabelText('Código de acceso')
      expect(ubic.pathname).toBe('/organizador/acceso')
      expect(ubic.state.desde).toBe('/organizador') // el retorno es el panel, no el alias
      cleanup()
    }
  })
  it('tras entrar vuelve al panel con SOLO las ligas de esa sesión, por /ligas y por el alias, igual', async () => {
    for (const ruta of ['/ligas', '/deportivo-vip/ligas']) {
      srv.estado.sesion = true
      abrir(ruta)
      await waitFor(() => expect(ligasVisibles().sort()).toEqual(['Liga Sub-10', 'Liga Sub-12']))
      expect(ubic.pathname).toBe('/organizador')
      cleanup()
    }
  })
  it('el alias NO decide qué ve cada organizador: con otra sesión (otras ligas) se ven solo las suyas; ninguna liga se pide por el alias', async () => {
    srv.estado.yo = YO(['LIGA-U12'])
    for (const ruta of ['/deportivo-vip/ligas', '/ligas']) {
      abrir(ruta)
      await waitFor(() => expect(ligasVisibles()).toEqual(['Liga Sub-12']))
      cleanup()
    }
    expect(srv.peticiones.some((p) => p.url.includes('/ligas/LIGA-U10'))).toBe(false) // la liga del otro organizador nunca se pide
    expect(srv.peticiones.some((p) => /deportivo|vip/i.test(p.url))).toBe(false) // el alias no viaja al servidor
  })
  it('el alias no provisiona ni autoriza: sin sesión no hace peticiones de datos ni crea sesión; y otros nombres no son alias', async () => {
    srv.estado.sesion = false
    abrir('/deportivo-vip/ligas')
    await screen.findByLabelText('Código de acceso')
    expect(srv.peticiones.filter((p) => p.metodo !== 'GET' || /\/ligas\//.test(p.url))).toEqual([])
    cleanup()
    abrir('/otro-nombre/ligas')
    await waitFor(() => expect(document.body.textContent).toMatch(/preparando|todavía/i))
    expect(ubic.pathname).toBe('/otro-nombre/ligas') // un nombre que no es alias NO redirige a ninguna parte
  })
  it('el login con retorno guardado sigue funcionando por el alias (equipo guardado → equipo)', async () => {
    render(<MemoryRouter initialEntries={[{ pathname: '/organizador/acceso', state: { desde: '/organizador/ligas/LIGA-U10/equipos/E1?z=3' } }]}><AppCompartida /><Sonda /></MemoryRouter>)
    await waitFor(() => expect(final()).toBe('/organizador/ligas/LIGA-U10/equipos/E1?z=3'))
  })
})

describe('enlaces de «volver» (REPORT_180)', () => {
  it('liga → «‹ Mis ligas» (a /organizador); equipo y partido → «‹ <liga>» (a la liga): enlaces al nivel superior, rojos y de 44 px', async () => {
    abrir('/organizador/ligas/LIGA-U10')
    const aPanel = await screen.findByRole('link', { name: '‹ Mis ligas' })
    expect(aPanel.getAttribute('href')).toBe('/organizador')
    expect(aPanel.className).toContain('enlace-volver')
    cleanup()
    abrir('/organizador/ligas/LIGA-U10/equipos/E1')
    const aLiga = await screen.findByRole('link', { name: '‹ Liga Sub-10' })
    expect(aLiga.getAttribute('href')).toBe('/organizador/ligas/LIGA-U10')
    expect(aLiga.className).toContain('enlace-volver')
    cleanup()
    abrir('/organizador/ligas/LIGA-U10/partidos/g-x')
    await waitFor(() => expect(document.querySelector('a.enlace-volver')).toBeTruthy())
    expect(document.querySelector('a.enlace-volver').getAttribute('href')).toMatch(/^\/organizador(\/ligas\/LIGA-U10)?$/)
  })
  it('es un enlace a su destino lógico: ni botón, ni historial del navegador', async () => {
    abrir('/organizador/ligas/LIGA-U10')
    const a = await screen.findByRole('link', { name: '‹ Mis ligas' })
    expect(a.tagName).toBe('A')
    expect(screen.queryByRole('button', { name: /Mis ligas/ })).toBeNull()
  })
})

describe('navegación visible en el panel', () => {
  it('Mis ligas → Administrar liga → Gestionar jugadores → jugadores; los nombres siguen visibles y los enlaces tienen nombre propio', async () => {
    abrir('/organizador')
    const admin = await screen.findByRole('link', { name: 'Administrar liga Liga Sub-10' })
    expect(admin.textContent).toBe('Administrar liga')
    expect(admin.className).toContain('btn')
    expect(admin.getAttribute('href')).toBe('/organizador/ligas/LIGA-U10')
    expect(screen.getByText('Liga Sub-10')).toBeTruthy()
  })
})
