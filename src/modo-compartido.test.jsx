/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// MODO COMPARTIDO: nada local concede permisos, no se siembra la demostración y no se montan las pantallas del
// prototipo, pero los registros que ya hubiera en el navegador NO se borran.

const NOMBRE_BD = 'sebel'
const borrarBd = () => new Promise((resolve) => { const r = indexedDB.deleteDatabase(NOMBRE_BD); r.onsuccess = r.onerror = r.onblocked = () => resolve() })

beforeEach(async () => {
  await borrarBd()
  vi.resetModules()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"no-autorizado"}', { status: 401, headers: { 'content-type': 'application/json' } })))
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})
afterEach(async () => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); await borrarBd() })

const compartido = () => vi.stubEnv('VITE_MODO_COMPARTIDO', '1')

async function conDemostracion() {
  const { sembrarSiHaceFalta } = await import('./seed')
  await sembrarSiHaceFalta()
  const { db } = await import('./db')
  const liga = (await db.ligas.toArray()).find((l) => l.organizadorId === 'yo')
  return { db, liga, nombres: (await db.ligas.toArray()).map((l) => l.nombre) }
}

describe('el modo por defecto sigue siendo el prototipo', () => {
  it('sin la variable: el rol local sigue valiendo y el botón existe', async () => {
    const { db, liga } = await conDemostracion()
    await db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'yo' })
    const { asegurarSesion, esDuenoDe, esOrganizador } = await import('./lib/sesion')
    const sesion = await asegurarSesion()
    expect(esOrganizador(sesion)).toBe(true)
    expect(esDuenoDe(sesion, liga)).toBe(true)
    const { Marca } = await import('./ui')
    render(<MemoryRouter><Marca /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: /Salir|Soy organizador/ })).toBeTruthy()
  })
})

describe('modo compartido', () => {
  it('un rol de organizador guardado antes en el navegador se reemplaza por invitado y no concede nada; sus datos no se borran', async () => {
    const { db, liga, nombres } = await conDemostracion()
    await db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'yo' }) // rastro de uso anterior del prototipo
    const antes = { ligas: await db.ligas.count(), jugadores: await db.jugadores.count(), partidos: await db.partidos.count() }
    compartido()
    vi.resetModules()
    const { asegurarSesion, esDuenoDe, esOrganizador, entrar } = await import('./lib/sesion')
    const sesion = await asegurarSesion()
    expect(sesion).toEqual({ id: 'sesion', rol: 'invitado', cuentaId: null })
    expect((await (await import('./db')).db.meta.get('sesion')).rol).toBe('invitado')
    // aunque alguien reescriba el rol local a mano, nada lo respeta
    expect(esOrganizador({ rol: 'organizador', cuentaId: 'yo' })).toBe(false)
    expect(esDuenoDe({ rol: 'organizador', cuentaId: 'yo' }, liga)).toBe(false)
    await entrar() // el atajo no existe
    expect((await (await import('./db')).db.meta.get('sesion')).rol).toBe('invitado')
    const { db: db2 } = await import('./db')
    expect({ ligas: await db2.ligas.count(), jugadores: await db2.jugadores.count(), partidos: await db2.partidos.count() }).toEqual(antes)
    expect((await db2.ligas.toArray()).map((l) => l.nombre)).toEqual(nombres)
  })

  it('el botón "Soy organizador" no se dibuja', async () => {
    compartido()
    const { Marca } = await import('./ui')
    render(<MemoryRouter><Marca /></MemoryRouter>)
    await screen.findByText('sebel')
    expect(screen.queryByText('Soy organizador')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Salir' })).toBeNull()
  })

  it('con datos de demostración ya guardados, ninguna ruta pública ni del prototipo los muestra: sale la frontera "en preparación"', async () => {
    const { nombres, db } = await conDemostracion()
    const partido = (await db.partidos.toArray())[0]
    const equipo = (await db.equipos.toArray())[0]
    compartido()
    vi.resetModules()
    const { default: App } = await import('./App')
    // Sin ligas configuradas la portada y lo desconocido dicen «en preparación»; las rutas ORIGINALES sin servidor dicen explícitamente que no están
    // disponibles. En ningún caso se monta una pantalla del prototipo ni aparece un dato de demostración.
    const preparacion = ['/', '/cualquier/cosa']
    const noDisponibles = ['/nueva', '/saldo', '/canchas', `/p/${partido.codigo}`, `/p/${partido.codigo}/consola`, `/e/${equipo.codigo}`, '/l/liga-4821', '/siguiendo', '/noticias']
    for (const ruta of [...preparacion, ...noDisponibles]) {
      const { unmount } = render(<MemoryRouter initialEntries={[ruta]}><App /></MemoryRouter>)
      expect(await screen.findByText(preparacion.includes(ruta) ? /Estamos preparando los resultados/ : /todavía no está disponible aquí/), ruta).toBeTruthy()
      for (const n of nombres) expect(document.body.textContent, `${ruta}: ${n}`).not.toContain(n)
      expect(screen.queryByText(/Añadir jugador|Desactivar|Editar|Soy organizador/i), ruta).toBeNull()
      unmount()
    }
    // «Mis ligas» (/ligas) lleva al panel del organizador, que pide la sesión del servidor: nunca a la pantalla local.
    const { unmount } = render(<MemoryRouter initialEntries={['/ligas']}><App /></MemoryRouter>)
    await waitFor(() => expect(document.body.textContent).not.toContain('Estamos preparando'))
    for (const n of nombres) expect(document.body.textContent).not.toContain(n)
    unmount()
  })

  it('/organizador/acceso monta la entrada del organizador (y /anthony/access y /anthony redirigen a ella)', async () => {
    compartido()
    vi.resetModules()
    const { default: App } = await import('./App')
    for (const ruta of ['/organizador/acceso', '/anthony/access', '/anthony']) {
      const { unmount } = render(<MemoryRouter initialEntries={[ruta]}><App /></MemoryRouter>)
      expect(await screen.findByLabelText('Código de acceso')).toBeTruthy()
      unmount()
    }
  })

  it('los controles de plantilla del prototipo no existen: la pantalla de equipo no se monta, aunque el rol local lo pidiera', async () => {
    const { db } = await conDemostracion()
    await db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'yo' })
    const equipo = (await db.equipos.toArray())[0]
    compartido()
    vi.resetModules()
    const { default: App } = await import('./App')
    render(<MemoryRouter initialEntries={[`/e/${equipo.codigo}`]}><App /></MemoryRouter>)
    await screen.findByText(/todavía no está disponible aquí/)
    expect(screen.queryByText(/Añadir jugador|Desactivar|Editar/i)).toBeNull()
  })
})

describe('arranque (main.jsx)', () => {
  async function arrancar() {
    const sembrar = vi.fn().mockResolvedValue(undefined)
    const region = vi.fn().mockResolvedValue(undefined)
    vi.doMock('./seed', () => ({ sembrarSiHaceFalta: sembrar }))
    vi.doMock('./lib/region', () => ({ resolverRegion: region }))
    const pintar = vi.fn()
    vi.doMock('react-dom/client', () => ({ createRoot: () => ({ render: pintar }) }))
    document.body.innerHTML = '<div id="root"></div>'
    await import('./main.jsx')
    await vi.waitFor(() => expect(pintar).toHaveBeenCalled()) // el arranque terminó: la aplicación se monta al final
    return { sembrar, region }
  }
  it('por defecto siembra la demostración y busca la región', async () => {
    const { sembrar, region } = await arrancar()
    expect(sembrar).toHaveBeenCalledTimes(1)
    expect(region).toHaveBeenCalledTimes(1)
  })
  it('en modo compartido NO siembra (la siembra además vacía tablas al cambiar de versión) y NO busca la región (el país del piloto es una configuración)', async () => {
    compartido()
    const { sembrar, region } = await arrancar()
    expect(sembrar).not.toHaveBeenCalled()
    expect(region).not.toHaveBeenCalled()
  })
})
