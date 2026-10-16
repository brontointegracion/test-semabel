/** @vitest-environment jsdom */
import { createHash, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { instalarCandados, json, conConexion, sinConexion } from '../prueba/compartido'
import { MAX_TOTAL_BYTES, PREFIJO, bytes, clave } from '../lib/control/activacion-almacen'
import { nombreCandado } from '../lib/control/activacion'
import ControlActivar, { fechaHora } from './ControlActivar'

const L = 'LIGA1'
const P = 'P1'
const CODIGO = 'ABCDE-23456-FGHJK-78MNP'
const sha = (t) => createHash('sha256').update(t).digest('hex')
const publico = (estado = 'programado') => json(200, {
  gameId: P, rev: 0, liga: { id: L, nombre: 'Liga Uno' }, estado,
  local: { id: 'E1', nombre: 'Alfa', puntos: 0, faltas: 0 }, visita: { id: 'E2', nombre: 'Beta', puntos: 0, faltas: 0 },
})
const EXPIRA = 1_700_000_100_000
const RETORNO = 1_700_000_900_000
const estadoOk = (estado = 'programado') => json(200, {
  version: 1, gameId: P, deviceId: 'dev-uno', servidorAhoraMs: 1_700_000_000_000, credencial: { expiraEn: EXPIRA, retornoHasta: RETORNO }, estado: { partido: { estado } },
})

let f
let cola
let candados
let espiasConsola
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('crypto', webcrypto)
  candados = instalarCandados()
  conConexion()
  cola = { activar: [], estado: [], publico: () => publico() }
  f = vi.fn(async (url, op) => {
    if (url.endsWith('/activar')) { const r = cola.activar.shift(); if (!r) throw new Error('sin respuesta programada para activar'); return r() }
    if (url.endsWith('/estado')) { const r = cola.estado.shift(); if (!r) return json(401, { error: 'no-autorizado' }); return r() }
    void op
    return cola.publico()
  })
  vi.stubGlobal('fetch', f)
  espiasConsola = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
})
afterEach(() => {
  cleanup(); candados.quitar(); vi.unstubAllGlobals()
  for (const e of espiasConsola) { expect(e).not.toHaveBeenCalled(); e.mockRestore() }
})

const montar = (ruta = `/control/${L}/${P}`) => render(
  <MemoryRouter initialEntries={[ruta]}>
    <Routes><Route path="/control/:ligaId/:partidoId" element={<ControlActivar />} /><Route path="*" element={<p>otra ruta</p>} /></Routes>
  </MemoryRouter>,
)
const campo = () => screen.getByLabelText('Código del partido')
const boton = (nombre) => screen.getByRole('button', { name: nombre })
const guardado = () => JSON.parse(localStorage.getItem(clave(L, P)))
const llamadas = (sufijo) => f.mock.calls.filter(([u]) => u.endsWith(sufijo))
const sembrar = (r) => localStorage.setItem(clave(L, P), JSON.stringify({
  v: 1, ligaId: L, partidoId: P, token: 'a'.repeat(64), tokenHash: sha('a'.repeat(64)), estado: 'incierta', conIncierto: true, intentos: 1,
  creadoEn: 1_700_000_000_000, actualizadoEn: 1_700_000_000_000, deviceId: null, servidor: null, ...r,
}))
async function escribirYEnviar(usuario, texto = CODIGO) {
  await screen.findByText('Alfa — Beta')
  await usuario.type(campo(), texto)
  await usuario.click(boton('Activar este teléfono'))
}
const sinControlesDePuntuacion = () => {
  const nombres = screen.queryAllByRole('button').map((b) => b.textContent)
  for (const n of nombres) expect(n, `botón «${n}»`).not.toMatch(/inici|comenz|punt|anot|falta|marcador|cerrar partido|finaliz/i)
  expect(llamadas('/comandos')).toHaveLength(0)
}
const sinControlesDeBorrado = () => {
  for (const b of screen.queryAllByRole('button')) expect(b.textContent, `botón «${b.textContent}»`).not.toMatch(/borrar|eliminar|reemplaz|nueva identidad|descartar|olvidar|quitar|limpiar|empezar de nuevo/i)
}

describe('enlace y vista previa', () => {
  it('un enlace con identificadores no válidos no hace ninguna petición', async () => {
    montar('/control/LIGA%201/P1')
    expect(await screen.findByText('Este enlace no es válido.')).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
    cleanup()
    montar(`/control/${'x'.repeat(65)}/P1`)
    expect(await screen.findByText('Este enlace no es válido.')).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })

  it('confirma liga, equipos y estado del partido ANTES de pedir el código; la vista previa no lleva credenciales', async () => {
    montar()
    expect(await screen.findByText('Alfa — Beta')).toBeTruthy()
    expect(screen.getByText(/Liga Uno/)).toBeTruthy()
    expect(screen.getByText(/Todavía no ha comenzado/)).toBeTruthy()
    const [url, op] = llamadas(`/partidos/${P}`)[0]
    expect(url).toBe(`/v1/ligas/${L}/partidos/${P}`)
    expect(op.credentials).toBe('omit')
    expect(op.headers.authorization).toBeUndefined()
    expect(localStorage.length).toBe(0) // mirar no guarda nada
  })

  it('partido desconocido: no hay formulario; partido ya en curso y sin registro: tampoco', async () => {
    cola.publico = () => json(404, {})
    montar()
    expect(await screen.findByText('No encontramos este partido en el servidor.')).toBeTruthy()
    expect(screen.queryByLabelText('Código del partido')).toBeNull()
    cleanup()
    cola.publico = () => publico('vivo')
    montar()
    expect(await screen.findByText(/ya está en curso: no se puede activar un teléfono nuevo/)).toBeTruthy()
    expect(screen.queryByLabelText('Código del partido')).toBeNull()
  })
})

describe('formulario y secretos', () => {
  it('campo de texto sin autocompletado ni corrección, mayúsculas en el teclado; el botón espera texto', async () => {
    montar()
    await screen.findByText('Alfa — Beta')
    const c = campo()
    expect(c.getAttribute('type')).toBe('text')
    expect(c.getAttribute('autocomplete')).toBe('off')
    expect(c.getAttribute('autocorrect')).toBe('off')
    expect(c.getAttribute('autocapitalize')).toBe('characters')
    expect(c.getAttribute('spellcheck')).toBe('false')
    expect(c.getAttribute('data-1p-ignore')).toBe('true')
    expect(c.getAttribute('maxlength')).toBe('64')
    expect(boton('Activar este teléfono').disabled).toBe(true)
  })

  it('el código se borra del campo ANTES de enviar y no queda en la pantalla, en el almacenamiento, en la URL ni en la consola', async () => {
    let soltar
    cola.activar.push(() => new Promise((r) => { soltar = () => r(json(200, { deviceId: 'dev-uno', partidoId: P })) }))
    cola.estado.push(() => estadoOk())
    const usuario = userEvent.setup()
    montar()
    await escribirYEnviar(usuario)
    await waitFor(() => expect(llamadas('/activar')).toHaveLength(1))
    expect(campo().value).toBe('') // mientras la respuesta sigue pendiente
    expect(document.body.textContent).not.toContain(CODIGO)
    soltar()
    await screen.findByText(/Comprobado ahora/)
    expect(document.body.textContent).not.toContain(CODIGO)
    expect(JSON.stringify({ ...localStorage })).not.toContain(CODIGO.replaceAll('-', ''))
    for (const [url] of f.mock.calls) expect(url).not.toContain('ABCDE')
    expect(JSON.parse(llamadas('/activar')[0][1].body).codigo).toBe(CODIGO)
  })

  it('el token nunca se muestra ni va en una URL o en el documento', async () => {
    cola.activar.push(() => json(200, { deviceId: 'dev-uno', partidoId: P }))
    cola.estado.push(() => estadoOk())
    const usuario = userEvent.setup()
    montar()
    await escribirYEnviar(usuario)
    await screen.findByText(/Comprobado ahora/)
    const { token, tokenHash } = guardado()
    expect(document.documentElement.outerHTML).not.toContain(token)
    expect(document.body.textContent).not.toContain(token)
    expect(document.documentElement.outerHTML).not.toContain(tokenHash)
    for (const [url] of f.mock.calls) expect(url).not.toContain(token)
  })
})

describe('activación confirmada y NO es el inicio del partido', () => {
  it('activa, comprueba ahora y muestra las fechas del servidor con fecha y hora; no hay botones de inicio ni de puntuación, ni /comandos', async () => {
    cola.activar.push(() => json(200, { deviceId: 'dev-uno', partidoId: P }))
    cola.estado.push(() => estadoOk())
    const usuario = userEvent.setup()
    montar()
    await escribirYEnviar(usuario)
    expect(await screen.findByText(/Comprobado ahora: el servidor reconoce este teléfono como controlador activo/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Teléfono activado' })).toBeTruthy()
    expect(screen.getByText(new RegExp(`Puede procesar acciones hasta: ${fechaHora(EXPIRA).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeTruthy()
    expect(screen.getByText(new RegExp(`solo podrá repetir recibos exactos hasta: ${fechaHora(RETORNO).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeTruthy()
    expect(fechaHora(EXPIRA)).toMatch(/\d{2}.*\d{4}, \d{1,2}:\d{2} [ap]\. m\./) // fecha Y hora de 12 horas
    expect(screen.getAllByText(/no inicia el partido ni permite puntuar todavía/).length).toBeGreaterThan(0)
    expect(screen.getByText(/El partido: Todavía no ha comenzado\./)).toBeTruthy() // el estado que LEYÓ el servidor, no algo que la activación provoque
    sinControlesDePuntuacion()
    sinControlesDeBorrado()
    expect(screen.queryByLabelText('Código del partido')).toBeNull() // ya no se pide otro código
    expect(guardado()).toMatchObject({ estado: 'activada', deviceId: 'dev-uno', conIncierto: false, servidor: { expiraEn: EXPIRA, retornoHasta: RETORNO } })
  })

  it('el servidor sin vencimientos registrados lo dice, sin inventar fechas', async () => {
    cola.activar.push(() => json(200, { deviceId: 'dev-uno', partidoId: P }))
    cola.estado.push(() => json(200, { version: 1, gameId: P, deviceId: 'dev-uno', servidorAhoraMs: 1_700_000_000_000, credencial: { expiraEn: null, retornoHasta: null }, estado: { partido: { estado: 'programado' } } }))
    const usuario = userEvent.setup()
    montar()
    await escribirYEnviar(usuario)
    expect(await screen.findByText(/no registró un vencimiento para procesar acciones/)).toBeTruthy()
    expect(screen.getByText(/no registró un plazo para repetir recibos/)).toBeTruthy()
  })

  it('un partido ya en curso se dice como lo que es (estado leído), sin afirmar que el teléfono lo inició', async () => {
    sembrar({ estado: 'activada', conIncierto: false, deviceId: 'dev-uno' })
    cola.estado.push(() => estadoOk('vivo'))
    montar()
    expect(await screen.findByText(/El partido: En curso\./)).toBeTruthy()
    sinControlesDePuntuacion()
  })
})

describe('lo guardado no es prueba de que siga vigente', () => {
  it('una activación guardada se muestra como «no comprobada ahora» hasta que una lectura la confirma', async () => {
    sembrar({ estado: 'activada', conIncierto: false, deviceId: 'dev-uno', servidor: { ahoraMs: 1, expiraEn: EXPIRA, retornoHasta: RETORNO, leidoEn: 1_700_000_000_000 } })
    let soltar
    cola.estado.push(() => new Promise((r) => { soltar = () => r(estadoOk()) }))
    montar()
    expect(await screen.findByText('Activación guardada en este teléfono. No se ha comprobado ahora.')).toBeTruthy()
    expect(screen.getByText(/Último dato leído del servidor/)).toBeTruthy()
    soltar()
    expect(await screen.findByText(/Comprobado ahora/)).toBeTruthy()
    expect(screen.getByText(/Leído del servidor:/)).toBeTruthy()
  })

  it('401 en la lectura: se explica sin afirmar la causa y el registro queda IDÉNTICO; sin botones de borrar o reemplazar', async () => {
    sembrar({ estado: 'activada', conIncierto: false, deviceId: 'dev-uno' })
    const antes = localStorage.getItem(clave(L, P))
    montar()
    expect(await screen.findByText(/no está activa ahora\. Puede estar revocada, vencida o solo admitir reintentos de recibos; no sabemos cuál/)).toBeTruthy()
    expect(screen.getByText(/organizador puede revisar el control/)).toBeTruthy()
    expect(localStorage.getItem(clave(L, P))).toBe(antes)
    expect(screen.getByRole('heading', { name: 'Activación guardada' })).toBeTruthy() // no se llama «activado» sin prueba actual
    sinControlesDeBorrado()
    sinControlesDePuntuacion()
  })

  it('507: «Acceso confirmado; no se pudo cargar el estado.», sin inventar dispositivo, fechas ni estado, y sin presentarlo como listo para puntuar', async () => {
    sembrar({ estado: 'incierta', conIncierto: true })
    cola.estado.push(() => json(507, { error: 'estado-demasiado-grande' }))
    const usuario = userEvent.setup()
    montar()
    await usuario.click(await screen.findByRole('button', { name: 'Comprobar ahora' }))
    expect(await screen.findByText('Acceso confirmado; no se pudo cargar el estado.')).toBeTruthy()
    expect(screen.getByText(/no indica que el partido esté listo para puntuar/)).toBeTruthy()
    expect(screen.queryByText(/Puede procesar acciones hasta/)).toBeNull()
    expect(screen.queryByText(/dev-/)).toBeNull()
    expect(guardado()).toMatchObject({ estado: 'activada', deviceId: null, servidor: null, token: 'a'.repeat(64) })
    sinControlesDePuntuacion()
  })

  it('507 malformado o respuesta inesperada: sigue sin resolver y el registro no cambia', async () => {
    sembrar({ estado: 'incierta', conIncierto: true })
    const antes = localStorage.getItem(clave(L, P))
    cola.estado.push(() => json(507, { error: 'otra-cosa' }))
    const usuario = userEvent.setup()
    montar()
    await usuario.click(await screen.findByRole('button', { name: 'Comprobar ahora' }))
    expect(await screen.findByText(/No pudimos comprobarlo ahora/)).toBeTruthy()
    expect(screen.queryByText('Acceso confirmado; no se pudo cargar el estado.')).toBeNull()
    expect(localStorage.getItem(clave(L, P))).toBe(antes)
    cola.estado.push(() => json(200, { hola: 1 }))
    await usuario.click(screen.getByRole('button', { name: 'Comprobar ahora' }))
    await waitFor(() => expect(llamadas('/estado')).toHaveLength(2))
    expect(localStorage.getItem(clave(L, P))).toBe(antes)
  })
})

describe('respuesta perdida y recarga', () => {
  it('la respuesta se pierde: «sin confirmar»; «Comprobar ahora» la resuelve SIN volver a escribir el código y con el mismo token', async () => {
    cola.activar.push(() => { throw new TypeError('red') })
    cola.estado.push(() => estadoOk())
    const usuario = userEvent.setup()
    montar()
    await escribirYEnviar(usuario)
    expect(await screen.findByText(/No sabemos si el servidor activó este teléfono/)).toBeTruthy()
    const { token } = guardado()
    expect(guardado()).toMatchObject({ estado: 'incierta', conIncierto: true })
    await usuario.click(boton('Comprobar ahora'))
    expect(await screen.findByText(/Comprobado ahora/)).toBeTruthy()
    expect(llamadas('/activar')).toHaveLength(1) // no se reenvió nada
    expect(llamadas('/estado')[0][1].headers.authorization).toBe(`Bearer ${token}`)
    expect(guardado()).toMatchObject({ estado: 'activada', conIncierto: false, token })
  })

  it('recarga con una activación «sin confirmar»: se muestra tal cual, SIN enviar ni leer nada solo; se puede escribir el código otra vez', async () => {
    sembrar({ estado: 'incierta', conIncierto: true })
    montar()
    expect(await screen.findByText(/No sabemos si el servidor activó este teléfono/)).toBeTruthy()
    await screen.findByText('Alfa — Beta')
    expect(llamadas('/activar')).toHaveLength(0)
    expect(llamadas('/estado')).toHaveLength(0)
    expect(campo()).toBeTruthy()
    sinControlesDeBorrado()
  })

  it('recarga tras cerrar la pestaña con la petición en vuelo (registro «activando» y sin candado): se trata como interrumpida', async () => {
    sembrar({ estado: 'activando', conIncierto: false })
    montar()
    expect(await screen.findByText(/La página se cerró o se recargó mientras se activaba/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Comprobar ahora' })).toBeTruthy()
    expect(llamadas('/activar')).toHaveLength(0)
    expect(llamadas('/estado')).toHaveLength(0)
  })

  it('el código reintenta con el MISMO token y la activación incierta se resuelve', async () => {
    sembrar({ estado: 'incierta', conIncierto: true })
    cola.activar.push(() => json(200, { deviceId: 'dev-uno', partidoId: P }))
    cola.estado.push(() => estadoOk())
    const usuario = userEvent.setup()
    montar()
    await escribirYEnviar(usuario)
    await screen.findByText(/Comprobado ahora/)
    expect(JSON.parse(llamadas('/activar')[0][1].body).tokenHash).toBe(sha('a'.repeat(64)))
    expect(guardado()).toMatchObject({ estado: 'activada', token: 'a'.repeat(64), intentos: 2 })
  })
})

describe('denegaciones y mensajes fijos', () => {
  it('401: mensaje genérico, la identidad se conserva y el siguiente código la reutiliza; no hay borrar ni reemplazar', async () => {
    cola.activar.push(() => json(401, { error: 'no-autorizado' }))
    const usuario = userEvent.setup()
    montar()
    await escribirYEnviar(usuario, 'MAL')
    expect(await screen.findByText(/El servidor no activó este teléfono con ese código/)).toBeTruthy()
    expect(screen.getByText(/Pide al organizador que revise el control de este partido/)).toBeTruthy()
    expect(guardado()).toMatchObject({ estado: 'denegada', conIncierto: false })
    const token = guardado().token
    sinControlesDeBorrado()
    cola.activar.push(() => json(200, { deviceId: 'dev-uno', partidoId: P }))
    cola.estado.push(() => estadoOk())
    await usuario.type(campo(), CODIGO)
    await usuario.click(boton('Activar este teléfono'))
    await screen.findByText(/Comprobado ahora/)
    expect(guardado().token).toBe(token)
  })

  it.each([[429, /Demasiados intentos/], [404, /No encontramos este partido en el servidor/], [422, /no aceptó la solicitud/]])('%s: mensaje propio', async (estado, texto) => {
    cola.activar.push(() => json(estado, {}))
    const usuario = userEvent.setup()
    montar()
    await escribirYEnviar(usuario)
    expect((await screen.findAllByText(texto)).length).toBeGreaterThan(0)
  })

  it('sin conexión: la frase aprobada y no se envía nada', async () => {
    const usuario = userEvent.setup()
    montar()
    await screen.findByText('Alfa — Beta')
    sinConexion()
    await usuario.type(campo(), CODIGO)
    await usuario.click(boton('Activar este teléfono'))
    expect(await screen.findByText('Se requiere conexión a internet para esta acción.')).toBeTruthy()
    expect(llamadas('/activar')).toHaveLength(0)
    expect(localStorage.length).toBe(0)
  })
})

describe('almacenamiento', () => {
  it('cuota excedida: «No se envió nada», sin registro y sin enviar', async () => {
    const usuario = userEvent.setup()
    montar()
    await screen.findByText('Alfa — Beta')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('cuota', 'QuotaExceededError') })
    await usuario.type(campo(), CODIGO)
    await usuario.click(boton('Activar este teléfono'))
    expect(await screen.findByText(/No pudimos guardar en este teléfono el registro necesario .* No se envió nada\./)).toBeTruthy()
    expect(llamadas('/activar')).toHaveLength(0)
    vi.restoreAllMocks()
    expect(localStorage.length).toBe(0)
  })

  it('registro ilegible: se avisa, se conserva sin tocar y no se pide ni envía código', async () => {
    localStorage.setItem(clave(L, P), '{"basura":true}')
    montar()
    expect(await screen.findByText(/registro de control ilegible o inesperado/)).toBeTruthy()
    expect(localStorage.getItem(clave(L, P))).toBe('{"basura":true}')
    expect(screen.queryByLabelText('Código del partido')).toBeNull()
    expect(llamadas('/activar')).toHaveLength(0)
  })

  it('almacenamiento no disponible: se dice y no hay formulario de activación sin respaldo', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    montar()
    expect(await screen.findByText(/No pudimos guardar en este teléfono el registro necesario/)).toBeTruthy()
    expect(screen.queryByLabelText('Código del partido')).toBeNull()
    vi.restoreAllMocks()
  })

  it('capacidad: no se envía, no se borra nada y el mensaje no recomienda borrar todos los datos del sitio', async () => {
    const k = `${PREFIJO}relleno:1`
    const necesario = bytes(clave(L, P)) + 2048
    const resto = MAX_TOTAL_BYTES - necesario + 1 - bytes(k)
    localStorage.setItem(k, 'é'.repeat(Math.floor(resto / 2)) + (resto % 2 ? 'x' : ''))
    const relleno = localStorage.getItem(k)
    const usuario = userEvent.setup()
    montar()
    await escribirYEnviar(usuario)
    const m = await screen.findByText(/Hay demasiados registros de control guardados en este teléfono/)
    expect(m.textContent).not.toMatch(/borrar (todos )?los datos|datos del sitio|borrar el almacenamiento/i)
    expect(m.textContent).toMatch(/no se borra ninguno automáticamente/)
    expect(llamadas('/activar')).toHaveLength(0)
    expect(localStorage.getItem(k)).toBe(relleno)
  })

  it('el servidor respondió pero no se pudo guardar el resultado: no se presenta como activado', async () => {
    const usuario = userEvent.setup()
    cola.activar.push(() => json(200, { deviceId: 'dev-uno', partidoId: P }))
    montar()
    await screen.findByText('Alfa — Beta')
    const escribir = Storage.prototype.setItem
    let n = 0
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { n += 1; if (n >= 2) throw new DOMException('cuota', 'QuotaExceededError'); return escribir.call(this, k, v) })
    await usuario.type(campo(), CODIGO)
    await usuario.click(boton('Activar este teléfono'))
    expect(await screen.findByText(/Todavía no cuenta como activado aquí/)).toBeTruthy()
    expect(screen.queryByText(/Comprobado ahora/)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Teléfono activado' })).toBeNull()
    vi.restoreAllMocks()
  })
})

describe('varias pestañas', () => {
  it('un intento en vuelo en OTRA pestaña se muestra como tal y no se puede enviar otro', async () => {
    sembrar({ estado: 'activando', conIncierto: false })
    let fin
    const retenido = new Promise((r) => { fin = r })
    const dentro = navigator.locks.request(nombreCandado(L, P), {}, () => retenido)
    await Promise.resolve()
    montar()
    expect(await screen.findByText(/Activando… hay un intento en curso en otra pestaña/)).toBeTruthy()
    expect(screen.queryByLabelText('Código del partido')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Comprobar ahora' })).toBeNull()
    fin(); await dentro
  })

  it('si otra pestaña tiene el candado, enviar da el aviso de «en curso» y no sale nada', async () => {
    const usuario = userEvent.setup()
    montar()
    await screen.findByText('Alfa — Beta')
    let fin
    const retenido = new Promise((r) => { fin = r })
    const dentro = navigator.locks.request(nombreCandado(L, P), {}, () => retenido)
    await Promise.resolve()
    await usuario.type(campo(), CODIGO)
    await usuario.click(boton('Activar este teléfono'))
    expect(await screen.findByText(/Ya hay una activación en curso para este partido, en esta u otra pestaña/)).toBeTruthy()
    expect(llamadas('/activar')).toHaveLength(0)
    expect(localStorage.length).toBe(0)
    fin(); await dentro
  })

  it('un cambio hecho por otra pestaña (evento storage) se refleja', async () => {
    montar()
    await screen.findByText('Alfa — Beta')
    expect(screen.queryByText(/Activación sin confirmar/)).toBeNull()
    sembrar({ estado: 'incierta', conIncierto: true })
    window.dispatchEvent(new Event('storage'))
    expect(await screen.findByText(/Activación sin confirmar/)).toBeTruthy()
  })
})

describe('aislamiento', () => {
  it('no escribe en ninguna clave que no sea la suya y no toca las del organizador', async () => {
    localStorage.setItem('sebel.op.v1:org-1:LIGA1', '{"x":1}')
    cola.activar.push(() => json(200, { deviceId: 'dev-uno', partidoId: P }))
    cola.estado.push(() => estadoOk())
    const usuario = userEvent.setup()
    montar()
    await escribirYEnviar(usuario)
    await screen.findByText(/Comprobado ahora/)
    expect(Object.keys(localStorage).sort()).toEqual(['sebel.op.v1:org-1:LIGA1', clave(L, P)].sort())
    expect(localStorage.getItem('sebel.op.v1:org-1:LIGA1')).toBe('{"x":1}')
    expect(within(document.body).queryByText(/sebel/i)).toBeNull()
  })

  it('la página pide que no se indexe', async () => {
    montar()
    await screen.findByText('Alfa — Beta')
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex')
  })
})

describe('REPORT_128: «Abrir control» solo con la activación confirmada', () => {
  it('con un registro activado hay un enlace a la pantalla de puntuación sin secretos en la dirección; sin registro o sin confirmar, no', async () => {
    sembrar({ estado: 'activada', conIncierto: false, deviceId: 'dev-uno' })
    montar()
    const enlace = await screen.findByRole('link', { name: 'Abrir control' })
    expect(enlace.getAttribute('href')).toBe(`/control/${L}/${P}/marcador`)
    expect(enlace.getAttribute('href')).not.toMatch(/a{20}|token|codigo|code/i)
    cleanup(); localStorage.clear()
    montar()
    await screen.findByText('Alfa — Beta')
    expect(screen.queryByRole('link', { name: 'Abrir control' })).toBeNull()
    cleanup(); localStorage.clear()
    sembrar({ estado: 'incierta', conIncierto: true })
    montar()
    await screen.findByText('Activación sin confirmar')
    expect(screen.queryByRole('link', { name: 'Abrir control' })).toBeNull()
  })
})
