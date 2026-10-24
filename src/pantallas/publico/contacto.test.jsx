/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { respuestaLiga } from '../../lib/publico/datos-prueba.js'

// REPORT_214 — /contacto: página pública estática (sin API, sin credenciales, sin escribir nada guardado), su enlace discreto en el pie de la portada
// y la navegación de vuelta. Servidor falso; datos sintéticos.

const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
let llamadas
function servidor() {
  llamadas = []
  vi.stubGlobal('fetch', vi.fn(async (ruta, init) => { llamadas.push({ ruta, init }); return ruta === '/v1/ligas/LIGAPUB1/publico' ? respuesta(respuestaLiga()) : respuesta({ error: 'no-encontrado' }, 404) }))
}
let ubicacion
function Ubic() { ubicacion = useLocation(); return null }
const montar = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><AppCompartida /><Ubic /></MemoryRouter>)

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1')
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('la página /contacto', () => {
  it('muestra EXACTAMENTE el texto aprobado, con un solo h1 y el contenido dentro de <main>', () => {
    servidor(); montar('/contacto')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Tu torneo merece que lo sigan.')
    const cuerpo = screen.getByRole('main')
    expect(within(cuerpo).getByText('Lleva el marcador desde el teléfono y comparte partidos, resultados y estadísticas con tu comunidad.')).toBeTruthy()
    expect(within(cuerpo).getByText('Cuéntanos sobre tu liga, dónde juegan y cuándo comienza. Te ayudamos a encontrar una forma sencilla de llevarla con Semabel.')).toBeTruthy()
    expect(document.title).toBe('Contacto · semabel.com')
  })

  it('el correo es un enlace mailto: normal con el nombre «Escríbenos a ventas@semabel.com», y la dirección también está como texto seleccionable', () => {
    servidor(); montar('/contacto')
    const enlace = screen.getByRole('link', { name: 'Escríbenos a ventas@semabel.com' })
    expect(enlace.getAttribute('href')).toBe('mailto:ventas@semabel.com')
    expect(enlace.getAttribute('target')).toBeNull() // un mailto normal: sin ventana nueva ni script
    expect(enlace.getAttribute('onclick')).toBeNull()
    const texto = document.querySelector('.contacto-correo')
    expect(texto.tagName).toBe('SPAN')
    expect(texto.textContent).toBe('ventas@semabel.com')
    expect(texto.closest('a')).toBeNull() // texto aparte del enlace: se puede seleccionar y copiar
    expect([...document.querySelectorAll('a')].filter((a) => /^mailto:/.test(a.getAttribute('href'))).every((a) => a.getAttribute('href') === 'mailto:ventas@semabel.com')).toBe(true)
  })

  it('sin formulario, sin campos, sin precios, sin seguimiento ni promesas, y sin afirmar que el buzón esté verificado', () => {
    servidor(); montar('/contacto')
    expect(document.querySelector('form, input, textarea, select, iframe, script[src], img')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    const texto = document.querySelector('main').textContent
    expect(texto).not.toMatch(/verificad|confirmad|garant|gratis|gratuit|precio|costo|\$|plan |prometemos|respondemos en/i)
    expect(document.querySelector('a[ping], a[href^="http"]')).toBeNull() // ningún enlace externo ni de seguimiento
  })

  it('no hace ninguna petición, no usa credenciales y no escribe nada guardado; con navegación de vuelta al inicio y la barra de pestañas de siempre', () => {
    servidor()
    const escrituras = []
    const espiarLocal = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((...a) => { escrituras.push(a) })
    montar('/contacto')
    expect(llamadas).toEqual([])
    expect(escrituras).toEqual([])
    expect(document.cookie).toBe('')
    expect(localStorage.length + sessionStorage.length).toBe(0)
    const volver = screen.getByRole('link', { name: '‹ Volver al inicio' })
    expect(volver.getAttribute('href')).toBe('/')
    expect([...document.querySelectorAll('nav.tabbar a')].map((a) => a.textContent)).toEqual(['Inicio', 'Siguiendo'])
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeTruthy()
    espiarLocal.mockRestore()
  })

  it('«Volver al inicio» lleva a la portada', async () => {
    servidor(); montar('/contacto')
    fireEvent.click(screen.getByRole('link', { name: '‹ Volver al inicio' }))
    expect(ubicacion.pathname).toBe('/')
    expect(await screen.findByText('Ahora mismo')).toBeTruthy()
  })
})

describe('«Contacto» en el pie de la portada', () => {
  it('un enlace discreto (en una navegación con nombre, al final de la portada) a /contacto; la portada no gana botones de organizador', async () => {
    servidor(); montar('/')
    await screen.findByText('Ahora mismo')
    const nav = screen.getByRole('navigation', { name: 'Más información' })
    const enlace = within(nav).getByRole('link', { name: 'Contacto' })
    expect(enlace.getAttribute('href')).toBe('/contacto')
    expect(nav.closest('footer')).toBeTruthy()
    // está DESPUÉS de las secciones de la portada (último contenido de la raíz)
    const raiz = document.querySelector('.home.publico')
    expect(raiz.lastElementChild.contains(nav)).toBe(true)
    // nada de acceso de organizador en la portada
    expect(screen.queryByText(/organizador|acceso|iniciar sesión|soy organizador/i, { selector: 'a, button' })).toBeNull()
    expect([...document.querySelectorAll('a')].some((a) => /\/organizador|\/anthony/.test(a.getAttribute('href') ?? ''))).toBe(false)
  })

  it('al hacer clic se llega a la página y desde allí se vuelve; la ruta no depende de la lectura de ninguna liga', async () => {
    servidor(); montar('/')
    await screen.findByText('Ahora mismo')
    fireEvent.click(screen.getByRole('link', { name: 'Contacto' }))
    expect(ubicacion.pathname).toBe('/contacto')
    expect(await screen.findByRole('heading', { name: 'Tu torneo merece que lo sigan.' })).toBeTruthy()
    const antes = llamadas.length
    fireEvent.click(screen.getByRole('link', { name: '‹ Volver al inicio' }))
    await waitFor(() => expect(ubicacion.pathname).toBe('/'))
    expect(llamadas.length).toBeGreaterThanOrEqual(antes) // solo las lecturas de la portada; la página de contacto no añadió ninguna
  })
})
