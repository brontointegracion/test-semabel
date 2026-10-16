/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// ---------------------------------------------------------------------------
// S2 (Decisión 115): cómo se VE un número de camiseta que falta o que es 0, en
// cada pantalla que lo muestra. Datos sintéticos; la base es IndexedDB falsa
// en memoria. Son pruebas en jsdom: no reemplazan una comprobación en un
// teléfono real ni en un navegador de escritorio.
//
// Las aserciones se limitan al elemento del jugador (no al texto de la página).
// Lo que no debe aparecer nunca: undefined, NaN, "#—", un "#" suelto.
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

beforeEach(async () => {
  await borrarBd()
  vi.resetModules()
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await borrarBd()
})

const MALO = /undefined|NaN|#—|#\s*$|#\s+[^A-Za-z0-9]|(^|\s)#(\s|$)/

async function cargar() {
  const { db } = await import('./db.js')
  const enlaces = await import('./lib/enlaces.js')
  await db.jugadores.toArray()
  return { db, ...enlaces }
}

const LIGA = {
  id: 'liga1', codigo: '4821', nombre: 'Liga de Prueba', deporte: 'baloncesto', pais: 'PA', provincia: 'Panamá',
  categoria: 'Libre', organizadorId: 'yo', canchaIds: ['c1'],
}
const LIGA_B = { ...LIGA, id: 'liga2', codigo: '4822', nombre: 'Otra Liga', canchaIds: [] }
const EQ_L = { id: 'eL', ligaId: 'liga1', codigo: '1111', nombre: 'Halcones', corto: 'HAL', color: '#c00' }
const EQ_V = { id: 'eV', ligaId: 'liga1', codigo: '2222', nombre: 'Titanes', corto: 'TIT', color: '#06c' }

const jug = (id, codigo, equipoId, nombrePila, apellido1, extra = {}) => ({
  id, codigo, ligaId: 'liga1', equipoId, nombrePila, apellido1, apellido2: '', nombre: `${nombrePila} ${apellido1}`, personaId: `p-${id}`, ...extra,
})

// #0 real, #5, sin número (ausente), número guardado como texto (no utilizable), y dos del visitante.
const JUGADORES = [
  jug('jCero', '9001', 'eL', 'Zoe', 'Cero', { dorsal: 0 }),
  jug('jCinco', '9002', 'eL', 'Beto', 'Cinco', { dorsal: 5 }),
  jug('jPend', '9003', 'eL', 'Carla', 'Pendiente'),
  jug('jTexto', '9004', 'eL', 'Dario', 'Texto', { dorsal: '7' }),
  jug('jVPend', '9005', 'eV', 'Eva', 'Visita'),
  jug('jNueve', '9006', 'eV', 'Fede', 'Nueve', { dorsal: 9 }),
]

let seq = 0
const ev = (partidoId, tipo, equipoId, jugadorId, puntos = 0) => ({
  id: `ev${++seq}`, partidoId, seq, tipo, equipoId, jugadorId, puntos: tipo === 'falta' ? 0 : puntos, periodo: 1, anulado: false, creadoEn: seq,
})

async function sembrar(db, { estado = 'final', eventosExtra = [] } = {}) {
  seq = 0
  await db.meta.put({ id: 'sesion', rol: 'invitado', cuentaId: null })
  await db.canchas.add({ id: 'c1', nombre: 'Cancha Uno', pais: 'PA', provincia: 'Panamá', codigo: '111' })
  await db.ligas.bulkAdd([LIGA, LIGA_B])
  await db.equipos.bulkAdd([EQ_L, EQ_V])
  await db.jugadores.bulkAdd(JUGADORES)
  await db.partidos.add({
    id: 'p1', codigo: '7531', ligaId: 'liga1', canchaId: 'c1', localId: 'eL', visitaId: 'eV', estado,
    inicio: '2026-10-01T15:00:00.000Z', relojEstado: 'detenido', relojRestante: 0, relojDesde: null,
  })
  await db.eventos.bulkAdd([
    ev('p1', 'punto', 'eL', 'jPend', 3), ev('p1', 'punto', 'eL', 'jPend', 3), ev('p1', 'punto', 'eL', 'jCero', 2),
    ev('p1', 'falta', 'eL', 'jPend'), ev('p1', 'falta', 'eL', 'jPend'),
    ev('p1', 'punto', 'eV', 'jVPend', 2), ev('p1', 'punto', 'eV', 'jVPend', 2), ev('p1', 'falta', 'eV', 'jVPend'),
    ev('p1', 'punto', 'eV', 'jNueve', 2),
    ...eventosExtra,
  ])
}

const ficha = (id) => JUGADORES.find((j) => j.id === id)
const filasDe = (nombre) => [...document.querySelectorAll('.jugador-fila')]
  .filter((f) => f.querySelector('.nombre')?.textContent === nombre)
const fila = (nombre) => {
  const f = filasDe(nombre)
  expect(f.length, `fila de ${nombre}`).toBeGreaterThan(0)
  return f[0]
}
const insignia = (f) => f.querySelector('.dorsal')?.textContent
const sinTextoMalo = (nodo) => expect(nodo.textContent).not.toMatch(MALO)
const instantanea = async (db) => ({
  jugadores: (await db.jugadores.toArray()).sort((a, b) => (a.id < b.id ? -1 : 1)),
  eventos: (await db.eventos.toArray()).sort((a, b) => a.seq - b.seq),
})

describe('Equipo: lista de la plantilla', () => {
  async function abrirEquipo() {
    const m = await cargar()
    await sembrar(m.db)
    const Equipo = (await import('./pantallas/Equipo.jsx')).default
    render(
      <MemoryRouter initialEntries={[m.urlEquipo(EQ_L)]}>
        <Routes><Route path="/e/:slug" element={<Equipo />} /></Routes>
      </MemoryRouter>,
    )
    await screen.findByText('Zoe Cero')
    return m
  }

  it('muestra "—" para ausente y para un valor no utilizable, y el 0 real como 0, sin tocar enlaces ni nombres', async () => {
    const m = await abrirEquipo()
    const esperado = { 'Zoe Cero': '0', 'Beto Cinco': '5', 'Carla Pendiente': '—', 'Dario Texto': '—' }
    for (const [nombre, texto] of Object.entries(esperado)) {
      const f = fila(nombre)
      expect(insignia(f), nombre).toBe(texto)
      sinTextoMalo(f)
    }
    // El enlace de cada fila sigue siendo el del jugador (la identidad no cambia).
    expect(fila('Carla Pendiente').querySelector('a').getAttribute('href')).toBe(m.urlJugador(ficha('jPend')))
    expect(fila('Zoe Cero').querySelector('a').getAttribute('href')).toBe(m.urlJugador(ficha('jCero')))
  })

  it('no escribe nada al mostrarse', async () => {
    const m = await cargar()
    await sembrar(m.db)
    const antes = await instantanea(m.db)
    const Equipo = (await import('./pantallas/Equipo.jsx')).default
    render(
      <MemoryRouter initialEntries={[m.urlEquipo(EQ_L)]}>
        <Routes><Route path="/e/:slug" element={<Equipo />} /></Routes>
      </MemoryRouter>,
    )
    await screen.findByText('Zoe Cero')
    expect(await instantanea(m.db)).toEqual(antes)
  })
})

describe('Equipo: lista de inactivos (vista del organizador)', () => {
  it('un inactivo sin número muestra "—" y uno con 0 real muestra 0', async () => {
    const m = await cargar()
    await sembrar(m.db)
    await m.db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'yo' })
    await m.db.jugadores.update('jPend', { activo: false })
    await m.db.jugadores.update('jCero', { activo: false })
    const Equipo = (await import('./pantallas/Equipo.jsx')).default
    render(
      <MemoryRouter initialEntries={[m.urlEquipo(EQ_L)]}>
        <Routes><Route path="/e/:slug" element={<Equipo />} /></Routes>
      </MemoryRouter>,
    )
    await userEvent.setup().click(await screen.findByRole('button', { name: /Ver inactivos/ }))
    await waitFor(() => expect(filasDe('Carla Pendiente').length).toBeGreaterThan(0))
    expect(insignia(fila('Carla Pendiente'))).toBe('—')
    expect(insignia(fila('Zoe Cero'))).toBe('0')
    sinTextoMalo(fila('Carla Pendiente'))
  })
})

describe('Jugador: encabezado y descripción', () => {
  async function abrirJugador(id) {
    const m = await cargar()
    await sembrar(m.db)
    const Jugador = (await import('./pantallas/Jugador.jsx')).default
    const f = ficha(id)
    render(
      <MemoryRouter initialEntries={[m.urlJugador(f)]}>
        <Routes><Route path="/j/:slug" element={<Jugador />} /></Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelector('.perfil-hero .nom')?.textContent).toBe(f.nombre))
    await waitFor(() => expect(document.title).toContain(f.nombre))
    return {
      encabezado: document.querySelector('.perfil-hero .sub'),
      descripcion: document.querySelector('meta[name="description"]').getAttribute('content'),
    }
  }

  it.each([
    ['jCero', '#0', 'dorsal 0'],
    ['jCinco', '#5', 'dorsal 5'],
  ])('%s con número real: %s en el encabezado y "%s" en la descripción', async (id, etiqueta, frase) => {
    const { encabezado, descripcion } = await abrirJugador(id)
    expect(encabezado.textContent.startsWith(`${etiqueta} · `)).toBe(true)
    expect(descripcion).toContain(frase)
    expect(descripcion).not.toMatch(MALO)
  })

  it.each([['jPend'], ['jTexto']])('%s sin número utilizable: "—" en el encabezado y descripción sin mencionar dorsal', async (id) => {
    const { encabezado, descripcion } = await abrirJugador(id)
    expect(encabezado.textContent.startsWith('— · ')).toBe(true)
    sinTextoMalo(encabezado)
    expect(descripcion).not.toMatch(/dorsal|undefined|NaN/)
    expect(descripcion).toContain(ficha(id).nombre)
    expect(descripcion).toContain('Halcones')
  })
})

describe('Partido terminado: tarjetas, votación y figuras', () => {
  async function abrirPartido(opciones) {
    const m = await cargar()
    await sembrar(m.db, opciones)
    const Partido = (await import('./pantallas/Partido.jsx')).default
    const partido = await m.db.partidos.get('p1')
    render(
      <MemoryRouter initialEntries={[m.urlPartido(partido, EQ_L, EQ_V)]}>
        <Routes><Route path="/p/:slug" element={<Partido />} /></Routes>
      </MemoryRouter>,
    )
    await screen.findByText('Jugador del partido')
    return m
  }
  const renglon = (tarjeta, etiqueta) => [...tarjeta.querySelectorAll('.renglon')]
    .find((r) => r.querySelector('.q')?.textContent === etiqueta)

  it('las tarjetas de equipo (mejor y más faltas) muestran "—" para quien no tiene número, enlazando al jugador', async () => {
    const m = await abrirPartido()
    const tarjetas = [...document.querySelectorAll('.destacado')]
    expect(tarjetas).toHaveLength(2)
    const [local, visita] = tarjetas
    for (const [tarjeta, nombre, id] of [[local, 'Carla Pendiente', 'jPend'], [visita, 'Eva Visita', 'jVPend']]) {
      for (const etiqueta of ['Mejor', 'Más faltas']) {
        const quien = renglon(tarjeta, etiqueta).querySelector('.quien')
        expect(quien.textContent).toBe(`— ${nombre}`)
        expect(quien.getAttribute('href')).toBe(m.urlJugador(ficha(id)))
        sinTextoMalo(quien)
      }
    }
  })

  it('la votación del jugador del partido: "—" sin número, 0 real, y el orden sigue siendo por votos', async () => {
    await abrirPartido()
    const filas = [...document.querySelectorAll('.voto-jugador')]
    const por = (nombre) => filas.find((f) => f.querySelector('.quien').textContent === nombre)
    expect(por('Carla Pendiente').querySelector('.dorsal').textContent).toBe('—')
    expect(por('Eva Visita').querySelector('.dorsal').textContent).toBe('—')
    expect(por('Zoe Cero').querySelector('.dorsal').textContent).toBe('0')
    expect(por('Fede Nueve').querySelector('.dorsal').textContent).toBe('9')
    for (const f of filas) sinTextoMalo(f)
    // El orden de la votación no se toca: va por votos, no por número de camiseta.
    const votos = filas.map((f) => Number(f.querySelector('.pct').textContent.replace('%', '')))
    expect([...votos].sort((a, b) => b - a)).toEqual(votos)
  })

  it('el número 0 real se ve como #0 en las tarjetas', async () => {
    await abrirPartido({ eventosExtra: [ev('p1', 'punto', 'eL', 'jCero', 3), ev('p1', 'punto', 'eL', 'jCero', 3), ev('p1', 'punto', 'eL', 'jCero', 3), ev('p1', 'falta', 'eL', 'jCero'), ev('p1', 'falta', 'eL', 'jCero'), ev('p1', 'falta', 'eL', 'jCero'), ev('p1', 'falta', 'eL', 'jCero')] })
    const [local] = [...document.querySelectorAll('.destacado')]
    expect(renglon(local, 'Mejor').querySelector('.quien').textContent).toBe('#0 Zoe Cero')
    expect(renglon(local, 'Más faltas').querySelector('.quien').textContent).toBe('#0 Zoe Cero')
  })

  it('las figuras de pantalla completa usan "—" y #0 de forma segura', async () => {
    Element.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined)
    try {
      await abrirPartido()
      await userEvent.setup().click(screen.getByRole('button', { name: 'Pantalla completa' }))
      const tv = await waitFor(() => {
        const nodo = document.querySelector('.figuras-tv')
        expect(nodo).toBeTruthy()
        return nodo
      })
      const [colLocal, colVisita] = [...tv.querySelectorAll('.col')]
      const figs = (col) => [...col.querySelectorAll('.fig')].map((f) => f.querySelector('.quien').textContent)
      expect(figs(colLocal)).toEqual(['— Carla P.', '— Carla P.'])
      expect(figs(colVisita)).toEqual(['— Eva V.', '— Eva V.'])
      sinTextoMalo(tv)
    } finally {
      delete Element.prototype.requestFullscreen
    }
  })

  it('las figuras de pantalla completa muestran #0 cuando el 0 es el mejor', async () => {
    Element.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined)
    try {
      await abrirPartido({ eventosExtra: [ev('p1', 'punto', 'eL', 'jCero', 3), ev('p1', 'punto', 'eL', 'jCero', 3), ev('p1', 'punto', 'eL', 'jCero', 3), ev('p1', 'punto', 'eL', 'jCero', 3)] })
      await userEvent.setup().click(screen.getByRole('button', { name: 'Pantalla completa' }))
      const tv = await waitFor(() => { const n = document.querySelector('.figuras-tv'); expect(n).toBeTruthy(); return n })
      const [colLocal] = [...tv.querySelectorAll('.col')]
      expect(colLocal.querySelector('.fig .quien').textContent).toBe('#0 Zoe C.')
    } finally {
      delete Element.prototype.requestFullscreen
    }
  })

  it('mostrar la página no cambia puntos, faltas ni a quién se atribuyen', async () => {
    const m = await cargar()
    await sembrar(m.db)
    const antes = await instantanea(m.db)
    const Partido = (await import('./pantallas/Partido.jsx')).default
    render(
      <MemoryRouter initialEntries={[m.urlPartido(await m.db.partidos.get('p1'), EQ_L, EQ_V)]}>
        <Routes><Route path="/p/:slug" element={<Partido />} /></Routes>
      </MemoryRouter>,
    )
    await screen.findByText('Jugador del partido')
    expect(await instantanea(m.db)).toEqual(antes)
  })
})

describe('Liga: máximos anotadores', () => {
  it('muestra "—" y #0 junto al equipo, y no cambia el orden por promedio', async () => {
    const m = await cargar()
    await sembrar(m.db)
    const Liga = (await import('./pantallas/Liga.jsx')).default
    render(
      <MemoryRouter initialEntries={[`${m.urlLiga(LIGA)}?pestana=jugadores`]}>
        <Routes><Route path="/l/:slug" element={<Liga />} /></Routes>
      </MemoryRouter>,
    )
    await screen.findByText('Máximos anotadores')
    const lista = screen.getByText('Máximos anotadores').nextElementSibling
    const filas = [...lista.querySelectorAll('.jugador-fila')]
    const nombres = filas.map((f) => f.querySelector('.nombre').textContent)
    // Carla (6 pts) y Eva (4 pts) van primero, por puntos; el número no entra en el orden.
    expect(nombres.slice(0, 2)).toEqual(['Carla Pendiente', 'Eva Visita'])
    const subDe = (nombre) => filas.find((f) => f.querySelector('.nombre').textContent === nombre).querySelector('.sub').textContent
    expect(subDe('Carla Pendiente')).toBe('— · Halcones')
    expect(subDe('Eva Visita')).toBe('— · Titanes')
    expect(subDe('Zoe Cero')).toBe('#0 · Halcones')
    expect(subDe('Fede Nueve')).toBe('#9 · Titanes')
    for (const f of filas) sinTextoMalo(f)
  })
})

describe('Siguiendo: jugadores que sigues', () => {
  it('"—" para quien no tiene número y 0 para el 0 real', async () => {
    const m = await cargar()
    await sembrar(m.db)
    await m.db.meta.put({ id: 'siguiendo', equipos: ['1111'], jugadores: ['9001', '9003'] })
    const Siguiendo = (await import('./pantallas/Siguiendo.jsx')).default
    render(<MemoryRouter><Siguiendo /></MemoryRouter>)
    await screen.findByText('Jugadores que sigues')
    const cero = fila('Zoe Cero')
    const pend = fila('Carla Pendiente')
    expect(insignia(cero)).toBe('0')
    expect(insignia(pend)).toBe('—')
    sinTextoMalo(cero)
    sinTextoMalo(pend)
    expect(pend.getAttribute('href')).toBe(m.urlJugador(ficha('jPend')))
  })
})

describe('Reto: el que más anotó', () => {
  it('"—" cuando el mejor no tiene número', async () => {
    const m = await cargar()
    await sembrar(m.db)
    await m.db.retos.add({
      id: 'r1', codigo: '6001', nombre: 'Reto de Prueba', categoria: 'Libre', ligaAId: 'liga1', ligaBId: 'liga2',
      desde: '2026-09-25T00:00:00.000Z', hasta: '2026-10-30T00:00:00.000Z', estado: 'activo',
    })
    const Reto = (await import('./pantallas/Reto.jsx')).default
    render(
      <MemoryRouter initialEntries={['/r/reto-de-prueba-6001']}>
        <Routes><Route path="/r/:slug" element={<Reto />} /></Routes>
      </MemoryRouter>,
    )
    await screen.findByText('El que más anotó')
    const f = fila('Carla Pendiente')
    expect(insignia(f)).toBe('—')
    sinTextoMalo(f)
    expect(f.getAttribute('href')).toBe(m.urlJugador(ficha('jPend')))
  })
})

describe('Inicio: buscador de jugadores', () => {
  it('los resultados muestran "—" o el número real, y no listan nada nuevo', async () => {
    const m = await cargar()
    await sembrar(m.db)
    await m.db.meta.put({ id: 'region', pais: 'PA', provincia: 'todas', deporte: 'todos', categoria: 'todas' })
    const Inicio = (await import('./pantallas/Inicio.jsx')).default
    render(<MemoryRouter><Inicio /></MemoryRouter>)
    const buscador = await screen.findByLabelText('Buscar liga, equipo o jugador')
    const user = userEvent.setup()

    await user.type(buscador, 'Carla')
    const seccion = buscador.closest('.hm-buscador')
    await waitFor(() => expect(within(seccion).getByText('Carla Pendiente')).toBeTruthy())
    const pend = [...seccion.querySelectorAll('.jugador-fila')].find((f) => f.textContent.includes('Carla Pendiente'))
    expect(pend.querySelector('.dorsal').textContent).toBe('—')
    sinTextoMalo(pend)

    await user.clear(buscador)
    await user.type(buscador, 'Zoe')
    await waitFor(() => expect(within(seccion).getByText('Zoe Cero')).toBeTruthy())
    const cero = [...seccion.querySelectorAll('.jugador-fila')].find((f) => f.textContent.includes('Zoe Cero'))
    expect(cero.querySelector('.dorsal').textContent).toBe('0')
  })
})

describe('Consola: lista de jugadores', () => {
  async function abrirConsola() {
    const m = await cargar()
    await sembrar(m.db, { estado: 'vivo', eventosExtra: [] })
    await m.db.eventos.clear()
    await m.db.cuenta.put({ id: 'yo', saldo: 5 })
    await m.db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'yo' })
    await m.db.partidos.update('p1', { relojEstado: 'detenido', relojRestante: 600000, relojDesde: null })
    const Consola = (await import('./pantallas/Consola.jsx')).default
    render(
      <MemoryRouter initialEntries={['/p/halcones-vs-titanes-7531/consola']}>
        <Routes>
          <Route path="/p/:slug/consola" element={<Consola />} />
          <Route path="/p/:slug" element={<div>detalle</div>} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    return m
  }

  it('cada fila muestra 0 real o "—", y las etiquetas accesibles de los botones no contienen basura', async () => {
    await abrirConsola()
    const f = (nombre) => filasDe(nombre)[0]
    expect(insignia(f('Zoe Cero'))).toBe('0')
    expect(insignia(f('Beto Cinco'))).toBe('5')
    expect(insignia(f('Carla Pendiente'))).toBe('—')
    expect(insignia(f('Dario Texto'))).toBe('—')
    for (const nombre of ['Zoe Cero', 'Carla Pendiente', 'Dario Texto']) {
      sinTextoMalo(f(nombre))
      for (const boton of f(nombre).querySelectorAll('button')) {
        expect(boton.getAttribute('aria-label') ?? '').not.toMatch(/undefined|NaN|#/)
      }
    }
  })

  it('anotar a un jugador sin número lo atribuye a su id y a su equipo, como siempre', async () => {
    const m = await abrirConsola()
    const user = userEvent.setup()
    await m.db.partidos.update('p1', { relojEstado: 'detenido' })
    await user.click(screen.getByRole('button', { name: 'Carla Pendiente más 2' }))
    await waitFor(async () => expect(await m.db.eventos.count()).toBe(1))
    const [e] = await m.db.eventos.toArray()
    expect(e).toMatchObject({ jugadorId: 'jPend', equipoId: 'eL', puntos: 2, tipo: 'punto', anulado: false })
    // El jugador no cambió: sigue sin número (la pantalla no inventa uno).
    expect('dorsal' in (await m.db.jugadores.get('jPend'))).toBe(false)
  })
})

describe('Diálogos de la plantilla: números que faltan o son 0', () => {
  const sesion = { rol: 'organizador', cuentaId: 'yo' }

  async function montar(Componente, props) {
    render(<MemoryRouter><Componente sesion={sesion} liga={LIGA} onCerrar={vi.fn()} onExito={vi.fn()} {...props} /></MemoryRouter>)
  }

  it('desactivar: "—" para quien no tiene número y #0 para el 0 real', async () => {
    const { ConfirmarDesactivar } = await import('./plantilla.jsx')
    await montar(ConfirmarDesactivar, { ficha: ficha('jPend') })
    expect(screen.getByText('— Carla Pendiente').tagName).toBe('STRONG')
    cleanup()
    await montar(ConfirmarDesactivar, { ficha: ficha('jCero') })
    expect(screen.getByText('#0 Zoe Cero').tagName).toBe('STRONG')
  })

  it('reactivar: el texto de confirmación y los mensajes de número', async () => {
    const m = await cargar()
    await sembrar(m.db)
    const { ConfirmarReactivar } = await import('./plantilla.jsx')
    // Pendiente e inactivo: texto seguro, y un mensaje claro al faltar el número.
    await m.db.jugadores.update('jPend', { activo: false })
    await montar(ConfirmarReactivar, { ficha: await m.db.jugadores.get('jPend') })
    expect(screen.getByText('— Carla Pendiente').tagName).toBe('STRONG')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reactivar jugador' }))
    expect(await screen.findByText(/Carla Pendiente no tiene un número utilizable para reactivarse/)).toBeTruthy()
    cleanup()

    // Número 0 real, tomado por un compañero activo: el mensaje conserva "#0".
    await m.db.jugadores.update('jCero', { activo: false })
    await m.db.jugadores.add(jug('jOtro', '9010', 'eL', 'Hugo', 'Otro', { dorsal: 0 }))
    await montar(ConfirmarReactivar, { ficha: await m.db.jugadores.get('jCero') })
    expect(screen.getByText('#0 Zoe Cero').tagName).toBe('STRONG')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reactivar jugador' }))
    expect(await screen.findByText(/El número #0 de Zoe Cero ya lo tiene otro jugador activo/)).toBeTruthy()
  })

  it('la tarjeta de un posible duplicado muestra "—" si el existente no tiene número', async () => {
    const m = await cargar()
    await sembrar(m.db)
    const { FormularioJugador } = await import('./plantilla.jsx')
    render(
      <MemoryRouter>
        <FormularioJugador sesion={sesion} liga={LIGA} equipoId="eV" onCerrar={vi.fn()} onExito={vi.fn()} />
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Nombre *'), 'carla')
    await user.type(screen.getByLabelText('Primer apellido *'), 'pendiente')
    await user.type(screen.getByLabelText('Número *'), '12')
    await user.click(screen.getByRole('button', { name: 'Añadir jugador' }))
    await screen.findByText('Encontramos un jugador con el mismo nombre.')
    const tarjeta = screen.getByText('Carla Pendiente').closest('.card')
    expect(within(tarjeta).getByText(/Halcones · —/)).toBeTruthy()
    sinTextoMalo(tarjeta)
  })
})
