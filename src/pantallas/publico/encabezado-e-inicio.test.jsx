/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { partidoLiga, respuestaEquipo, respuestaJuego, respuestaLiga } from '../../lib/publico/datos-prueba.js'

// REPORT_160: nombre real de la liga y clasificación legibles, sin la hora de actualización de rutina, y «Inicio» siempre disponible sin
// depender del historial. Servidor falso; datos SINTÉTICOS con los nombres reales de las dos ligas.

const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
const servidor = (rutas) => vi.stubGlobal('fetch', vi.fn(async (ruta) => (rutas[ruta] === undefined ? respuesta({ error: 'no-encontrado' }, 404) : respuesta(rutas[ruta]))))

const LIGAS = {
  'PLATINIUM-U10': { nombre: 'Platinium U10 2026', categoria: 'mini-basketball', subcategoria: { clave: 'u10' }, etiqueta: 'Categoría Mini baloncesto U10' },
  'PLATINIUM-U12': { nombre: 'Platinium U12 2026', categoria: 'intermediate', subcategoria: { clave: 'u12' }, etiqueta: 'Categoría Intermedia U12' },
}
function lectura(id) {
  const l = LIGAS[id]
  const r = respuestaLiga({ id, nombre: l.nombre, partidos: [partidoLiga({ gameId: `${id}-20261024-A-VS-B`, programadoPara: '2026-10-24T14:00:00.000Z', sede: null })] })
  r.liga.categoria = l.categoria
  r.liga.subcategoria = l.subcategoria
  r.equipos = [{ id: `${id}-A`, nombre: 'Cross Level' }, { id: `${id}-B`, nombre: 'Deportivo' }]
  r.partidos[0].local.id = `${id}-A`
  r.partidos[0].visita.id = `${id}-B`
  return r
}
const rutas = () => {
  const r = {}
  for (const id of Object.keys(LIGAS)) {
    r[`/v1/ligas/${id}/publico`] = lectura(id)
    r[`/v1/ligas/${id}/equipos/${id}-A/publico`] = respuestaEquipo({ ligaId: id, equipoId: `${id}-A` })
    r[`/v1/ligas/${id}/partidos/${id}-20261024-A-VS-B`] = respuestaJuego({ ligaId: id, gameId: `${id}-20261024-A-VS-B`, estado: 'programado', inicioReal: null, reloj: { estado: null, restanteMs: null, desdeMs: null } })
  }
  return r
}
let ubicacion
let navegar
function Sonda() { ubicacion = useLocation(); navegar = useNavigate(); return null }
const montar = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><AppCompartida /><Sonda /></MemoryRouter>)

beforeEach(() => {
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', Object.keys(LIGAS).join(','))
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('encabezado de la liga', () => {
  for (const [id, l] of Object.entries(LIGAS)) {
    it(`${id}: muestra el nombre real «${l.nombre}» en la tarjeta y la clasificación con espacio`, async () => {
      servidor(rutas())
      montar(`/liga/${id.toLowerCase()}`)
      const titulo = await screen.findByRole('heading', { level: 2, name: l.nombre })
      expect(titulo.closest('.card')).not.toBeNull() // dentro de la tarjeta de cabecera, no solo en la barra superior
      expect(screen.getByText('Página pública de la liga')).toBeTruthy() // la etiqueta original se conserva
      expect(screen.getByText('Baloncesto')).toBeTruthy()
      const pills = [...titulo.closest('.card').querySelectorAll('.pill')]
      expect(pills.map((p) => p.textContent)).toEqual([l.etiqueta.replace(/ U1[02]$/, ''), l.etiqueta.slice(-3)])
      // legible también como texto (lectores de pantalla, copiar): hay un espacio entre categoría y subcategoría
      expect(titulo.closest('.card').textContent).toContain(l.etiqueta)
      expect(titulo.closest('.card').textContent).not.toMatch(/baloncestoU10|IntermediaU12/)
      // el nombre sale de los datos: no es texto fijo
      expect(document.querySelector('.topbar h1').textContent).toBe(l.nombre)
    })
  }
})

describe('sin hora de actualización de rutina', () => {
  const sinRutina = () => expect(document.body.textContent).not.toMatch(/Actualizado|hora de Panamá\)/)
  it('Inicio, las tres pestañas de la liga, el equipo y el partido no la muestran', async () => {
    servidor(rutas())
    const id = 'PLATINIUM-U10'
    montar('/')
    await screen.findByText('Ligas cerca de ti')
    sinRutina()
    cleanup()
    for (const p of ['', '?pestana=calendario', '?pestana=jugadores']) {
      montar(`/liga/platinium-u10${p}`)
      await screen.findByRole('heading', { level: 2, name: 'Platinium U10 2026' })
      sinRutina()
      cleanup()
    }
    montar('/liga/platinium-u10/equipo/a')
    await screen.findByText('Plantilla')
    sinRutina()
    cleanup()
    montar(`/liga/platinium-u10/partido/${id}-20261024-A-VS-B`)
    await screen.findByLabelText('Pantalla del marcador')
    sinRutina()
  })
})

describe('«Inicio» y retorno al padre', () => {
  it('la secuencia del usuario: liga → equipo → «Liga» → liga → «‹ Inicio» abre Inicio (no vuelve al equipo)', async () => {
    servidor(rutas())
    montar('/liga/platinium-u10')
    await screen.findByRole('heading', { level: 2, name: 'Platinium U10 2026' })
    fireEvent.click(screen.getByRole('link', { name: 'Cross Level' }))
    await screen.findByText('Plantilla')
    expect(ubicacion.pathname).toBe('/liga/platinium-u10/equipo/a')
    fireEvent.click(screen.getByRole('link', { name: '‹ Liga' })) // el padre semántico del equipo es su liga
    await screen.findByRole('heading', { level: 2, name: 'Platinium U10 2026' })
    expect(ubicacion.pathname).toBe('/liga/platinium-u10')
    fireEvent.click(screen.getByRole('link', { name: '‹ Inicio' }))
    await screen.findByText('Ligas cerca de ti')
    expect(ubicacion.pathname).toBe('/')
  })

  it('el «Atrás» del navegador no se rompe: tras «‹ Liga», atrás vuelve al equipo', async () => {
    servidor(rutas())
    montar('/liga/platinium-u10/equipo/a')
    await screen.findByText('Plantilla')
    fireEvent.click(screen.getByRole('link', { name: '‹ Liga' }))
    await screen.findByRole('heading', { level: 2, name: 'Platinium U10 2026' })
    await act(async () => { navegar(-1) })
    await waitFor(() => expect(ubicacion.pathname).toBe('/liga/platinium-u10/equipo/a'))
  })

  it('«Inicio» está en la barra superior de la liga y del equipo (además de la barra de pestañas) y siempre apunta a «/»', async () => {
    servidor(rutas())
    for (const ruta of ['/liga/platinium-u12', '/liga/platinium-u12/equipo/a']) {
      montar(ruta)
      await waitFor(() => expect(document.querySelector('.topbar a[href="/"]')).not.toBeNull())
      const superior = [...document.querySelectorAll('.topbar a')].filter((a) => /Inicio/.test(a.textContent))
      expect(superior.length).toBe(1)
      expect(superior[0].getAttribute('href')).toBe('/')
      expect(document.querySelector('nav.tabbar a[href="/"]')).not.toBeNull()
      fireEvent.click(superior[0])
      await screen.findByText('Ligas cerca de ti')
      expect(ubicacion.pathname).toBe('/')
      cleanup()
    }
  })
})
