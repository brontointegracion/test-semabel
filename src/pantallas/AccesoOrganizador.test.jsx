/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { __reiniciar } from '../lib/sesion-servidor'
import AccesoOrganizador from './AccesoOrganizador'

const json = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
const YO = { organizadorId: 'org-1', ligas: ['LIGA-U10', 'LIGA-U12'], expiraIdle: Date.now() + 3_600_000, expiraAbs: Date.now() + 7_200_000 }
const CODIGO = 'ABCDE-23456-FGHJK-78MNP'
const SIN_GUIONES = CODIGO.replaceAll('-', '')

let f
let espiasConsola
const respuestas = (...rs) => rs.forEach((r) => (r instanceof Error ? f.mockRejectedValueOnce(r) : f.mockResolvedValueOnce(r)))
const campo = () => screen.getByLabelText('Código de acceso')

beforeEach(() => {
  __reiniciar()
  f = vi.fn()
  vi.stubGlobal('fetch', f)
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  espiasConsola = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
  localStorage.clear(); sessionStorage.clear()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); espiasConsola.forEach((e) => e.mockRestore()) })

async function abrirSinSesion() {
  respuestas(json(401, { error: 'no-autorizado' }))
  render(<MemoryRouter><AccesoOrganizador /></MemoryRouter>)
  await screen.findByLabelText('Código de acceso')
}
async function escribirYEnviar(usuario, texto = CODIGO) {
  await usuario.type(campo(), texto)
  await usuario.click(screen.getByRole('button', { name: 'Entrar' }))
}

describe('formulario', () => {
  it('es un campo de texto sin autocompletado, corrección ni guardado, con teclado en mayúsculas', async () => {
    await abrirSinSesion()
    const c = campo()
    expect(c.getAttribute('type')).toBe('text')
    expect(c.getAttribute('autocomplete')).toBe('off')
    expect(c.getAttribute('autocorrect')).toBe('off')
    expect(c.getAttribute('autocapitalize')).toBe('characters')
    expect(c.getAttribute('spellcheck')).toBe('false')
    expect(c.getAttribute('data-1p-ignore')).toBe('true')
    expect(c.closest('form').getAttribute('autocomplete')).toBe('off')
    expect(c.closest('form').getAttribute('method')).toBe('post')
  })
  it('añade "noindex" mientras está abierta y lo quita al salir', async () => {
    await abrirSinSesion()
    expect(document.querySelector('meta[name="robots"][content="noindex"]')).not.toBeNull()
    cleanup()
    expect(document.querySelector('meta[name="robots"]')).toBeNull()
  })
  it('el botón no se activa con el campo vacío', async () => {
    await abrirSinSesion()
    expect(screen.getByRole('button', { name: 'Entrar' }).disabled).toBe(true)
  })
})

describe('el código', () => {
  it('se borra del campo al enviar, no queda en URL, almacenamiento, cookies visibles, IndexedDB ni consola, y solo viaja en el cuerpo', async () => {
    const usuario = userEvent.setup()
    await abrirSinSesion()
    const urlAntes = location.href
    respuestas(json(200, { ok: true }), json(200, YO))
    await escribirYEnviar(usuario)
    await screen.findByText('Acceso autorizado')

    expect(location.href).toBe(urlAntes)
    expect(document.body.innerHTML).not.toContain(SIN_GUIONES.slice(5))
    expect(document.body.innerHTML).not.toContain('ABCDE')
    expect(JSON.stringify({ ...localStorage })).not.toContain('ABCDE')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('ABCDE')
    expect(document.cookie).not.toContain('ABCDE')
    expect((await indexedDB.databases()).length).toBe(0) // la página no crea ninguna base
    for (const e of espiasConsola) expect(e).not.toHaveBeenCalled()

    const [url, opciones] = f.mock.calls.find(([, o]) => o.method === 'POST')
    expect(url).not.toContain('ABCDE')
    expect(JSON.parse(opciones.body)).toEqual({ codigo: CODIGO })
    for (const [u] of f.mock.calls) expect(u).not.toContain('ABCDE')
  })

  it('el campo queda vacío en cuanto se envía, incluso si la respuesta tarda o falla', async () => {
    const usuario = userEvent.setup()
    await abrirSinSesion()
    let soltar
    f.mockImplementationOnce(() => new Promise((r) => { soltar = r }))
    await usuario.type(campo(), CODIGO)
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(campo().value).toBe('')
    expect(screen.getByRole('button', { name: /Comprobando/ }).disabled).toBe(true)
    await act(async () => { soltar(json(401, {})) })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Ese código no es válido. Revísalo y vuelve a escribirlo.'))
    expect(campo().value).toBe('') // y hay que escribirlo otra vez: no se recuerda
  })
})

describe('mensajes y confirmación', () => {
  const escenarios = [
    ['código inválido', [json(401, { error: 'no-autorizado' })], 'Ese código no es válido. Revísalo y vuelve a escribirlo.'],
    ['demasiados intentos', [json(429, {})], 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.'],
    ['acceso cerrado', [json(404, {})], 'El acceso no está disponible ahora.'],
    ['fallo de red', [new TypeError('Failed to fetch')], 'No pudimos confirmar el acceso. Vuelve a escribir el código.'],
    ['resultado desconocido (503)', [json(503, { tipo: 'resultado-desconocido', detalle: 'SQLITE_ERROR' })], 'No pudimos confirmar el acceso. Vuelve a escribir el código.'],
    ['sesión que no se mantiene', [json(200, { ok: true }), json(401, {})], 'No se pudo mantener la sesión. Revisa que las cookies estén permitidas e inténtalo de nuevo.'],
  ]
  for (const [nombre, rs, mensaje] of escenarios) {
    it(`${nombre}: mensaje fijo, sin éxito`, async () => {
      const usuario = userEvent.setup()
      await abrirSinSesion()
      respuestas(...rs)
      await escribirYEnviar(usuario)
      expect((await screen.findByRole('alert')).textContent).toContain(mensaje)
      expect(screen.queryByText('Acceso autorizado')).toBeNull()
    })
  }

  it('nunca muestra el texto que devuelve el servidor', async () => {
    const usuario = userEvent.setup()
    await abrirSinSesion()
    respuestas(json(500, { error: 'DIAGNOSTICO-INTERNO-SQLITE', stack: 'at x' }))
    await escribirYEnviar(usuario)
    await screen.findByRole('alert')
    expect(document.body.textContent).not.toMatch(/DIAGNOSTICO|SQLITE|stack/)
  })

  it('sin conexión: la frase aprobada y ninguna petición', async () => {
    const usuario = userEvent.setup()
    await abrirSinSesion()
    f.mockClear()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    await escribirYEnviar(usuario)
    expect((await screen.findByRole('alert')).textContent).toContain('Se requiere conexión a internet para esta acción.')
    expect(f).not.toHaveBeenCalled()
    expect(screen.queryByText('Acceso autorizado')).toBeNull()
  })

  it('un HTML con 200 (la página de la aplicación) no es un acceso', async () => {
    const usuario = userEvent.setup()
    await abrirSinSesion()
    respuestas(new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    await escribirYEnviar(usuario)
    expect((await screen.findByRole('alert')).textContent).toContain('No pudimos confirmar el acceso.')
  })
})

describe('sesión activa', () => {
  async function entrarOk(usuario) {
    await abrirSinSesion()
    respuestas(json(200, { ok: true }), json(200, YO))
    await escribirYEnviar(usuario)
    await screen.findByText('Acceso autorizado')
  }
  it('muestra cuántas ligas tiene, enlaza al panel de plantillas, aclara que el control de partidos no está y no presenta nada como guardado', async () => {
    await entrarOk(userEvent.setup())
    expect(screen.getByText('Tienes acceso a 2 ligas.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ver mis ligas y plantillas' }).getAttribute('href')).toBe('/organizador')
    expect(screen.getByText(/El control de partidos todavía no está disponible desde aquí/)).toBeTruthy()
    expect(screen.queryByText(/plantilla guardada|jugador añadido/i)).toBeNull()
    expect(screen.queryByText(/sin confirmar/)).toBeNull() // sin registros de recuperación no se muestra el aviso de retención
  })
  it('si hay una acción sin confirmar, explica antes de cerrar sesión que se conserva (sin cifrar) y que no se borra', async () => {
    localStorage.setItem('sebel.op.v1:org-1:LIGA-U10', JSON.stringify({ x: 1 })) // aunque sea ilegible, cuenta como registro conservado
    await entrarOk(userEvent.setup())
    const nota = screen.getByRole('note', { name: '' , hidden: false })
    expect(nota.textContent).toMatch(/1 acción sin confirmar/)
    expect(nota.textContent).toMatch(/Cerrar sesión no la borra/)
    expect(nota.textContent).toMatch(/sin cifrar/)
  })
  it('cerrar sesión confirmado vuelve al formulario', async () => {
    const usuario = userEvent.setup()
    await entrarOk(usuario)
    respuestas(json(200, { ok: true }))
    await usuario.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    await screen.findByLabelText('Código de acceso')
  })
  it('cerrar sesión con respuesta perdida NO afirma el cierre', async () => {
    const usuario = userEvent.setup()
    await entrarOk(usuario)
    respuestas(new TypeError('red'), json(200, YO))
    await usuario.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect((await screen.findByRole('alert')).textContent).toContain('No pudimos confirmar el cierre de sesión.')
    expect(screen.getByText('Acceso autorizado')).toBeTruthy()
  })
  it('al volver a la pestaña se pregunta al servidor; una sesión caducada lleva a la reentrada con su aviso', async () => {
    await entrarOk(userEvent.setup())
    respuestas(json(401, { error: 'no-autorizado' }))
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(await screen.findByLabelText('Código de acceso')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Tu sesión terminó. Escribe el código otra vez para entrar.')
  })
  it('con una sesión ya abierta al cargar la página, se muestra sin pedir el código', async () => {
    respuestas(json(200, YO))
    render(<MemoryRouter><AccesoOrganizador /></MemoryRouter>)
    await screen.findByText('Acceso autorizado')
    expect(screen.queryByLabelText('Código de acceso')).toBeNull()
  })
})
