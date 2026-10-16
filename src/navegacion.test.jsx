/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

// Retorno dentro de la app: el origen viaja en el `state` de la navegación,
// se valida al usarlo y nunca toca el historial nativo del navegador.

const NOMBRE_BD = 'sebel'
const SLUG = 'halcones-vs-titanes-2026-10-18-7531'
const CALENDARIO = '/l/liga-4821?pestana=calendario'

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
  const [Liga, Partido, Consola, Codigo, Inicio, Equipo] = await Promise.all([
    import('./pantallas/Liga.jsx'), import('./pantallas/Partido.jsx'), import('./pantallas/Consola.jsx'),
    import('./pantallas/Codigo.jsx'), import('./pantallas/Inicio.jsx'), import('./pantallas/Equipo.jsx'),
  ])
  await dbMod.db.jugadores.toArray()
  return { db: dbMod.db, P: { Liga: Liga.default, Partido: Partido.default, Consola: Consola.default, Codigo: Codigo.default, Inicio: Inicio.default, Equipo: Equipo.default } }
}

beforeEach(async () => { await borrarBd(); navigator.vibrate = vi.fn() })
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await borrarBd() })

async function sembrar(db, { estado = 'vivo' } = {}) {
  await db.cuenta.put({ id: 'yo', saldo: 5 })
  await db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'yo' })
  await db.canchas.add({ id: 'c1', nombre: 'Cancha', pais: 'EC', provincia: 'X', codigo: '111' })
  await db.ligas.add({ id: 'liga1', codigo: '4821', nombre: 'Liga', deporte: 'baloncesto', organizadorId: 'yo', canchaIds: ['c1'], provincia: 'X' })
  await db.equipos.bulkAdd([
    { id: 'eL', ligaId: 'liga1', codigo: '1111', nombre: 'Halcones', corto: 'HAL', color: '#c00' },
    { id: 'eV', ligaId: 'liga1', codigo: '2222', nombre: 'Titanes', corto: 'TIT', color: '#06c' },
  ])
  await db.partidos.add({
    id: 'p1', codigo: '7531', ligaId: 'liga1', canchaId: 'c1', localId: 'eL', visitaId: 'eV',
    estado, inicio: '2026-10-18T10:00:00.000Z', relojEstado: 'detenido', relojRestante: 600000, relojDesde: null,
  })
}

function Ubic() {
  const l = useLocation()
  return <div data-testid="ubic">{`${l.pathname}${l.search}`}|{JSON.stringify(l.state)}</div>
}

function montar(P, entrada) {
  render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/" element={<><P.Inicio /><Ubic /></>} />
        <Route path="/l/:slug" element={<><P.Liga /><Ubic /></>} />
        <Route path="/e/:slug" element={<><P.Equipo /><Ubic /></>} />
        <Route path="/b/:codigo" element={<><P.Codigo /><Ubic /></>} />
        <Route path="/p/:slug" element={<><P.Partido /><Ubic /></>} />
        <Route path="/p/:slug/consola" element={<><P.Consola /><Ubic /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

const ubic = () => screen.getByTestId('ubic').textContent
const parte = () => { const [r, s] = ubic().split('|'); return { ruta: r, state: s === 'null' || s === undefined ? null : JSON.parse(s) } }

describe('Liga — pestaña en la URL', () => {
  it('abre la pestaña pedida, cae a Posiciones si es inválida y conserva otros parámetros', async () => {
    const { db, P } = await cargar()
    await sembrar(db)
    montar(P, '/l/liga-4821?pestana=calendario&x=1')
    await screen.findByText('Halcones')
    expect(screen.getByRole('button', { name: 'Calendario' }).style.background).not.toBe('')
    cleanup()
    montar(P, '/l/liga-4821?pestana=nada')
    await screen.findByRole('button', { name: 'Posiciones' })
    expect(screen.getByRole('button', { name: 'Posiciones' }).style.background).not.toBe('')
    expect(screen.getByRole('button', { name: 'Calendario' }).style.background).toBe('')
  })

  it('cambiar de pestaña actualiza ?pestana= sin perder otros parámetros; Posiciones lo quita', async () => {
    const { db, P } = await cargar()
    await sembrar(db)
    montar(P, '/l/liga-4821?x=1')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Calendario' }))
    expect(parte().ruta).toBe('/l/liga-4821?x=1&pestana=calendario')
    await user.click(screen.getByRole('button', { name: 'Jugadores' }))
    expect(parte().ruta).toBe('/l/liga-4821?x=1&pestana=jugadores')
    await user.click(screen.getByRole('button', { name: 'Posiciones' }))
    expect(parte().ruta).toBe('/l/liga-4821?x=1')
  })
})

describe('Partido — Salir / Ver liga', () => {
  it('Calendario → Partido guarda el origen con su pestaña, y Salir vuelve a ella', async () => {
    const { db, P } = await cargar()
    await sembrar(db)
    montar(P, CALENDARIO)
    const user = userEvent.setup()
    await user.click(await screen.findByText('Titanes'))
    await screen.findByRole('button', { name: '‹ Salir' })
    expect(parte().ruta).toBe(`/p/${SLUG}`)
    expect(parte().state).toEqual({ volverA: CALENDARIO })
    await user.click(screen.getByRole('button', { name: '‹ Salir' }))
    expect(parte().ruta).toBe(CALENDARIO)
  })

  it('entrada directa: "Ver liga" abre la liga en Calendario', async () => {
    const { db, P } = await cargar()
    await sembrar(db)
    montar(P, `/p/${SLUG}`)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Ver liga' }))
    expect(parte().ruta).toBe(CALENDARIO)
  })

  it.each([
    ['externo', 'https://evil.com'], ['mismo origen sin ruta', '//evil.com'],
    ['otro partido', '/p/otro-1234'], ['la consola', `/p/${SLUG}/consola`], ['no cadena', 5],
  ])('un origen inválido (%s) se ignora: "Ver liga"', async (_n, valor) => {
    const { db, P } = await cargar()
    await sembrar(db)
    render(
      <MemoryRouter initialEntries={[{ pathname: `/p/${SLUG}`, state: { volverA: valor } }]}>
        <Routes>
          <Route path="/p/:slug" element={<><P.Partido /><Ubic /></>} />
          <Route path="/l/:slug" element={<Ubic />} />
        </Routes>
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Ver liga' }))
    expect(parte().ruta).toBe(CALENDARIO)
  })

  it('desde Inicio y desde Equipo vuelve a esa pantalla', async () => {
    const { db, P } = await cargar()
    await sembrar(db)
    const user = userEvent.setup()
    // Equipo
    montar(P, '/e/halcones-1111')
    const enlace = await screen.findAllByRole('link')
    const aPartido = enlace.find((a) => a.getAttribute('href') === `/p/${SLUG}`)
    expect(aPartido).toBeTruthy()
    await user.click(aPartido)
    expect(parte().state).toEqual({ volverA: '/e/halcones-1111' })
    await user.click(await screen.findByRole('button', { name: '‹ Salir' }))
    expect(parte().ruta).toBe('/e/halcones-1111')
  })

  it('"Llevar el marcador" reenvía el origen a la consola', async () => {
    const { db, P } = await cargar()
    await sembrar(db)
    montar(P, `/p/${SLUG}`)
    const user = userEvent.setup()
    await screen.findByRole('button', { name: 'Ver liga' })
    cleanup()
    render(
      <MemoryRouter initialEntries={[{ pathname: `/p/${SLUG}`, state: { volverA: CALENDARIO } }]}>
        <Routes>
          <Route path="/p/:slug" element={<><P.Partido /><Ubic /></>} />
          <Route path="/p/:slug/consola" element={<Ubic />} />
        </Routes>
      </MemoryRouter>,
    )
    await user.click(await screen.findByRole('link', { name: 'Llevar el marcador' }))
    expect(parte().ruta).toBe(`/p/${SLUG}/consola`)
    expect(parte().state).toEqual({ volverA: CALENDARIO })
  })
})

describe('Consola — Atrás y cierre', () => {
  const entrar = (P, state) => render(
    <MemoryRouter initialEntries={[{ pathname: `/p/${SLUG}/consola`, state }]}>
      <Routes>
        <Route path="/p/:slug/consola" element={<><P.Consola /><Ubic /></>} />
        <Route path="/p/:slug" element={<><P.Partido /><Ubic /></>} />
        <Route path="/l/:slug" element={<Ubic />} />
      </Routes>
    </MemoryRouter>,
  )

  it('Atrás abre el partido y conserva el origen; el Salir siguiente vuelve a Calendario', async () => {
    const { db, P } = await cargar()
    await sembrar(db)
    entrar(P, { volverA: CALENDARIO })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Volver' }))
    await screen.findByRole('button', { name: '‹ Salir' })
    expect(parte().ruta).toBe(`/p/${SLUG}`)
    expect(parte().state).toEqual({ volverA: CALENDARIO })
    await user.click(screen.getByRole('button', { name: '‹ Salir' }))
    expect(parte().ruta).toBe(CALENDARIO)
  })

  it('consola abierta directo: Atrás abre el partido sin origen, y ahí "Ver liga"', async () => {
    const { db, P } = await cargar()
    await sembrar(db)
    entrar(P, undefined)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Volver' }))
    await user.click(await screen.findByRole('button', { name: 'Ver liga' }))
    expect(parte().ruta).toBe(CALENDARIO)
  })

  it('un origen manipulado no se reenvía', async () => {
    const { db, P } = await cargar()
    await sembrar(db)
    entrar(P, { volverA: 'https://evil.com' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Volver' }))
    await screen.findByRole('button', { name: 'Ver liga' })
    expect(parte().state).toBeNull()
  })

  it('cierre exitoso: mismo destino (el partido), conserva el origen y el Salir vuelve a Calendario', async () => {
    const { db, P } = await cargar()
    await sembrar(db)
    vi.stubGlobal('confirm', vi.fn(() => true))
    entrar(P, { volverA: CALENDARIO })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Cerrar el partido/ }))
    await screen.findByRole('button', { name: '‹ Salir' })
    expect(parte().ruta).toBe(`/p/${SLUG}`)
    expect(parte().state).toEqual({ volverA: CALENDARIO })
    expect((await db.partidos.get('p1')).estado).toBe('final')
    await user.click(screen.getByRole('button', { name: '‹ Salir' }))
    expect(parte().ruta).toBe(CALENDARIO)
  })
})

describe('Código corto', () => {
  it('/b/:codigo abre el partido sin origen: "Ver liga"', async () => {
    const { db, P } = await cargar()
    await sembrar(db)
    montar(P, '/b/7531')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Ver liga' }))
    expect(parte().ruta).toBe(CALENDARIO)
  })
})

describe('Cobertura de enlaces', () => {
  it('ninguna pantalla enlaza a un partido con <Link> directo', () => {
    const dir = path.join(__dirname, 'pantallas')
    const malos = fs.readdirSync(dir)
      .filter((f) => /\.jsx$/.test(f) && !/\.test\./.test(f))
      .filter((f) => /<Link[^>]*to=\{urlPartido\(/s.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    expect(malos).toEqual([])
  })
})
