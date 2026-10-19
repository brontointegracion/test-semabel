/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import AppCompartida from '../AppCompartida'
import { sufijoPartido } from '../lib/publico/urls.js'
import { __reiniciar } from '../lib/sesion-servidor'
import { conConexion, escenario, instalarCandados, json, sinConexion } from '../prueba/compartido'

// Acceso de puntuación del organizador. Solo datos sintéticos; el «código» es un texto inventado que nunca es de un partido real.
const CODIGO = 'ZZ-SINTETICO-0001'
const lado = (id, puntos = 0) => ({ id, puntos, faltas: 0 })
const partido = (gameId, local, visita, extra = {}) => ({
  gameId, estado: 'programado', rev: 0, periodo: 1, programadoPara: null, inicioReal: null, sede: null,
  reloj: { estado: null, restanteMs: null, desdeMs: null }, local: lado(local), visita: lado(visita), ...extra,
})
const PUBLICA = {
  liga: { id: 'LIGA-U10', nombre: 'Liga Sub-10', deporte: 'baloncesto', categoria: null, subcategoria: null },
  servidorAhoraMs: Date.parse('2026-10-19T12:00:00Z'), faltasAlcance: 'partido',
  equipos: [{ id: 'E1', nombre: 'Alfa' }, { id: 'E2', nombre: 'Beta' }],
  partidos: [
    partido('g-tarde', 'E2', 'E1', { programadoPara: '2026-10-20T23:30:00.000Z' }), // 6:30 p. m. en Panamá
    partido('g-temprano', 'E1', 'E2', { programadoPara: '2026-10-20T14:05:00.000Z' }), // 9:05 a. m.
    partido('g-final', 'E1', 'E2', { estado: 'final', programadoPara: '2026-10-18T17:00:00.000Z', inicioReal: '2026-10-18T17:02:00.000Z', local: lado('E1', 31), visita: lado('E2', 28) }),
    partido('g-sin-hora', 'E1', 'E2'),
  ],
}
const CONTROL = { partido: 'programado', codigoPendiente: false, codigoExpiraEn: null, credencial: 'ninguna' }

let srv
let usuario
let consola
let espia
let control
let emisiones
let revocaciones

function montar() {
  srv = escenario()
  control = { 'g-temprano': { ...CONTROL }, 'g-tarde': { ...CONTROL } }
  emisiones = []
  revocaciones = []
  revocaciones.respuestas = []
  espia = []
  const base = srv.fetch
  vi.stubGlobal('fetch', vi.fn(async (url, opciones = {}) => {
    const metodo = opciones.method ?? 'GET'
    espia.push({ url, metodo, cuerpo: opciones.body, credenciales: opciones.credentials })
    if (url === '/v1/ligas/LIGA-U10/publico') return json(200, PUBLICA)
    let m = /^\/v1\/organizador\/ligas\/([^/]+)\/partidos\/([^/]+)\/control$/.exec(url)
    if (m && metodo === 'GET') {
      if (!srv.estado.sesion) return json(401, { error: 'no-autorizado' })
      return control[m[2]] ? json(200, { partidoId: m[2], ...control[m[2]] }) : json(404, { error: 'no-encontrado' })
    }
    m = /^\/v1\/organizador\/ligas\/([^/]+)\/partidos\/([^/]+)\/codigo$/.exec(url)
    if (m && metodo === 'POST') {
      emisiones.push({ url, cuerpo: opciones.body })
      const r = emisiones.respuestas.shift()
      if (!r) return json(500, { error: 'sin respuesta programada' })
      if (r instanceof Error) throw r
      return typeof r === 'function' ? r(m[2]) : r
    }
    m = /^\/v1\/organizador\/ligas\/([^/]+)\/partidos\/([^/]+)\/control\/revocar$/.exec(url)
    if (m && metodo === 'POST') {
      revocaciones.push({ url, cuerpo: opciones.body, cabeceras: opciones.headers, credenciales: opciones.credentials })
      const r = revocaciones.respuestas.shift()
      if (!r) return json(500, { error: 'sin respuesta programada' })
      if (r instanceof Error) throw r
      return typeof r === 'function' ? r(m[2]) : r
    }
    return base(url, opciones)
  }))
}
/** Un servidor que cumple el contrato real: revoca de verdad (y deja la credencial en «ninguna») y responde cuántas revocó. */
const revocaDeVerdad = (id) => { const n = control[id].credencial !== 'ninguna' ? 1 : 0; control[id] = { ...control[id], credencial: 'ninguna', codigoPendiente: false, codigoExpiraEn: null }; return json(200, { ok: true, credencialesRevocadas: n }) }
const ok = (partidoId) => json(200, { partidoId, codigo: CODIGO, expiraEn: Date.parse('2026-10-22T15:00:00Z') })
const abrir = (ruta) => render(<MemoryRouter initialEntries={[ruta]}><AppCompartida /><Ubic /></MemoryRouter>)
let ubicacion
function Ubic() { ubicacion = useLocation(); return null }
const abrirPartido = async (gameId = 'g-temprano') => {
  abrir(`/organizador/ligas/LIGA-U10/partidos/${gameId}`)
  await screen.findByRole('heading', { name: 'Acceso de puntuación' })
}
const esperarControl = () => waitFor(() => expect(espia.some((p) => p.url.endsWith('/control'))).toBe(true))
const almacenado = () => JSON.stringify([...Object.entries(localStorage), ...Object.entries(sessionStorage)])

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  __reiniciar()
  instalarCandados()
  conConexion()
  montar()
  emisiones.respuestas = []
  usuario = userEvent.setup()
  consola = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('navegación visible y compartir (REPORT_179)', () => {
  const RUTA_PUBLICA = () => `/liga/liga-u10/partido/alfa-vs-beta-${sufijoPartido('g-temprano')}`
  const copiaOriginal = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  afterEach(() => { if (copiaOriginal) Object.defineProperty(navigator, 'clipboard', copiaOriginal); else delete navigator.clipboard })

  it('la lista de partidos ofrece «Preparar acceso de puntuación» y «Ver marcador público» (enlaces con nombre propio) y conserva los nombres como contexto', async () => {
    abrir('/organizador/ligas/LIGA-U10')
    const lista = await screen.findByRole('list', { name: 'Partidos' })
    const filas = within(lista).getAllByRole('listitem')
    const temprano = filas[1]
    expect(within(temprano).getByText('Alfa — Beta')).toBeTruthy()
    const preparar = within(temprano).getByRole('link', { name: /Preparar acceso de puntuación de Alfa contra Beta/ })
    expect(preparar.textContent).toBe('Preparar acceso de puntuación')
    expect(preparar.getAttribute('href')).toBe('/organizador/ligas/LIGA-U10/partidos/g-temprano')
    const publico = within(temprano).getByRole('link', { name: /Ver marcador público de Alfa contra Beta/ })
    expect(publico.getAttribute('href')).toBe(RUTA_PUBLICA())
    expect(preparar.getAttribute('href')).not.toBe(publico.getAttribute('href')) // el público y el privado son destinos distintos
  })

  it('el partido distingue el marcador público (mirar/compartir) de la activación del teléfono de puntuación; ningún enlace abre la consola', async () => {
    await abrirPartido()
    const publico = screen.getByRole('link', { name: 'Ver marcador público' })
    expect(publico.getAttribute('href')).toBe(RUTA_PUBLICA())
    expect(screen.getByText(/solo para mirar y compartir: no sirve para puntuar/)).toBeTruthy()
    const activacion = screen.getByRole('link', { name: 'Abrir pantalla de activación' })
    expect(activacion.getAttribute('href')).toBe('/control/LIGA-U10/g-temprano')
    expect(screen.getByText(/Desde aquí no se abre la consola de un teléfono ya activado/)).toBeTruthy()
    for (const a of document.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').not.toMatch(/\/marcador$/) // la consola es del teléfono que tiene el control
    expect(screen.getByRole('button', { name: 'Compartir partido' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Obtener código de acceso' })).toBeTruthy() // el botón sigue siendo una ACCIÓN
  })

  it('«Compartir partido» no envía nada al abrirse; WhatsApp lleva SOLO el enlace público canónico del origen actual y datos públicos', async () => {
    await abrirPartido()
    const antes = espia.length
    await usuario.click(screen.getByRole('button', { name: 'Compartir partido' }))
    expect(espia.length).toBe(antes) // ni una petición
    const wa = screen.getByRole('link', { name: 'Compartir por WhatsApp' })
    expect(wa.getAttribute('target')).toBe('_blank')
    expect(wa.getAttribute('rel')).toContain('noopener')
    expect(wa.getAttribute('href').startsWith('https://wa.me/?text=')).toBe(true)
    const texto = decodeURIComponent(wa.getAttribute('href').slice('https://wa.me/?text='.length))
    const url = `${window.location.origin}${RUTA_PUBLICA()}`
    expect(texto).toContain(url)
    expect(texto).toContain('Liga Sub-10')
    expect(texto).toContain('Alfa vs Beta')
    expect(texto).toContain('mar 20 oct, 9:05 a. m. (hora de Panamá)')
    expect(texto).toContain('Sede: Por avisar')
    expect(texto).not.toMatch(/localhost:8802|semabel\.com|organizador|\/control|ZZ-|token/i)
    expect((screen.getByLabelText('Enlace del partido')).value).toBe(url)
  })

  it('el código emitido nunca aparece en el enlace ni en el texto para compartir', async () => {
    emisiones.respuestas.push(ok('g-temprano'))
    await abrirPartido()
    await usuario.click(await screen.findByRole('button', { name: 'Obtener código de acceso' }))
    await screen.findByText(CODIGO)
    await usuario.click(screen.getByRole('button', { name: 'Compartir partido' }))
    const wa = screen.getByRole('link', { name: 'Compartir por WhatsApp' })
    expect(decodeURIComponent(wa.getAttribute('href'))).not.toContain(CODIGO)
    expect(screen.getByLabelText('Enlace del partido').value).not.toContain(CODIGO)
  })

  it('«Copiar enlace»: éxito → «Enlace copiado.» y se copia SOLO la URL; fallo → mensaje verdadero y campo seleccionable', async () => {
    await abrirPartido()
    const escribir = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escribir }, configurable: true })
    await usuario.click(screen.getByRole('button', { name: 'Compartir partido' }))
    await usuario.click(screen.getByRole('button', { name: 'Copiar enlace' }))
    expect(escribir).toHaveBeenCalledWith(`${window.location.origin}${RUTA_PUBLICA()}`)
    expect(document.querySelector('[data-compartir="estado"]').textContent).toBe('Enlace copiado.')
    // ahora falla
    escribir.mockRejectedValueOnce(new Error('denegado'))
    await usuario.click(screen.getByRole('button', { name: 'Copiar enlace' }))
    await waitFor(() => expect(document.querySelector('[data-compartir="estado"]').textContent).toMatch(/No se pudo copiar el enlace/))
    expect(document.querySelector('[data-compartir="estado"]').textContent).not.toMatch(/copiado/i)
    const campo = screen.getByLabelText('Enlace del partido')
    expect(campo.readOnly).toBe(true)
    expect(document.activeElement).toBe(campo)
  })

  it('sin portapapeles disponible: el mismo mensaje de fallo (nunca «copiado»)', async () => {
    await abrirPartido()
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    await usuario.click(screen.getByRole('button', { name: 'Compartir partido' }))
    await usuario.click(screen.getByRole('button', { name: 'Copiar enlace' }))
    await waitFor(() => expect(document.querySelector('[data-compartir="estado"]').textContent).toMatch(/No se pudo copiar el enlace/))
  })
})

describe('lista de partidos de la liga', () => {
  it('muestra los equipos correctos, hora en 12 horas, estado y orden por hora (sin hora al final); solo lecturas', async () => {
    abrir('/organizador/ligas/LIGA-U10')
    const lista = await screen.findByRole('list', { name: 'Partidos' })
    const filas = within(lista).getAllByRole('listitem').map((li) => li.textContent)
    expect(filas).toHaveLength(4)
    expect(filas[0]).toContain('Alfa — Beta') // el final de dos días antes va primero
    expect(filas[0]).toContain('dom 18 oct, 12:00 p. m.')
    expect(filas[0]).toContain('Terminado')
    expect(filas[0]).toContain('31–28')
    expect(filas[1]).toContain('Alfa — Beta')
    expect(filas[1]).toContain('mar 20 oct, 9:05 a. m.')
    expect(filas[1]).toContain('Programado')
    expect(filas[2]).toContain('Beta — Alfa')
    expect(filas[2]).toContain('mar 20 oct, 6:30 p. m.')
    expect(filas[3]).toContain('Fecha por confirmar')
    expect(filas.join(' ')).not.toMatch(/\b(a|p)\.m\./) // siempre «a. m.» / «p. m.» con espacio
    expect(screen.getByRole('link', { name: 'Gestionar jugadores de Alfa' })).toBeTruthy() // la gestión de equipos sigue ahí
    expect(espia.every((p) => p.metodo === 'GET')).toBe(true)
    expect(almacenado()).not.toContain('g-')
  })

  it('una liga que el organizador no posee no se abre ni se lee', async () => {
    abrir('/organizador/ligas/LIGA-AJENA/partidos/g-temprano')
    expect((await screen.findByRole('alert')).textContent).toContain('No tienes acceso a esa liga.')
    expect(espia.some((p) => p.url.includes('LIGA-AJENA'))).toBe(false)
  })

  it('sin sesión lleva a la entrada y no pide ni emite nada', async () => {
    srv.estado.sesion = false
    abrir('/organizador/ligas/LIGA-U10/partidos/g-temprano')
    await screen.findByLabelText('Código de acceso')
    expect(espia.filter((p) => p.url.includes('/control') || p.url.includes('/codigo'))).toHaveLength(0)
  })
})

describe('emisión del código', () => {
  it('abrir y refrescar solo leen: ninguna emisión sin pulsar el botón', async () => {
    await abrirPartido()
    await esperarControl()
    await screen.findByRole('button', { name: 'Obtener código de acceso' })
    await usuario.click(document.body) // clic fuera del botón
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(emisiones).toHaveLength(0)
    expect(espia.filter((p) => p.metodo === 'POST')).toHaveLength(0)
    expect(screen.queryByText(CODIGO)).toBeNull()
  })

  it('un clic emite UNA vez, muestra el código y entrega al flujo de activación sin poner el código en ningún enlace ni almacenamiento', async () => {
    emisiones.respuestas.push(ok('g-temprano'))
    await abrirPartido()
    await usuario.click(await screen.findByRole('button', { name: 'Obtener código de acceso' }))
    expect(await screen.findByText(CODIGO)).toBeTruthy()
    expect(emisiones).toHaveLength(1)
    expect(emisiones[0].url).toBe('/v1/organizador/ligas/LIGA-U10/partidos/g-temprano/codigo')
    expect(emisiones[0].cuerpo).toBe('{}')
    const enlace = screen.getByRole('link', { name: 'Abrir pantalla de activación' })
    expect(enlace.getAttribute('href')).toBe('/control/LIGA-U10/g-temprano')
    for (const a of document.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').not.toContain('ZZ-')
    expect(ubicacion.pathname + ubicacion.search + ubicacion.hash).not.toContain('ZZ-')
    expect(almacenado()).not.toContain('ZZ-')
    expect(JSON.stringify(consola.map((c) => c.mock.calls))).not.toContain('ZZ-')
    expect(screen.getByText(/no inicia el partido/)).toBeTruthy()
    expect(espia.some((p) => p.url.includes('/comandos'))).toBe(false)
    await usuario.click(screen.getByRole('button', { name: 'Ocultar código' }))
    expect(screen.queryByText(CODIGO)).toBeNull()
  })

  it('el código desaparece al salir de la pantalla y no vuelve a aparecer', async () => {
    emisiones.respuestas.push(ok('g-temprano'))
    await abrirPartido()
    await usuario.click(await screen.findByRole('button', { name: 'Obtener código de acceso' }))
    await screen.findByText(CODIGO)
    await usuario.click(screen.getByRole('link', { name: /Liga Sub-10/ }))
    await screen.findByRole('heading', { name: 'Equipos' })
    await usuario.click((await screen.findAllByRole('link', { name: /Preparar acceso de puntuación de Alfa contra Beta/ }))[1]) // el de las 9:05 a. m.
    await screen.findByRole('heading', { name: 'Acceso de puntuación' })
    expect(screen.queryByText(CODIGO)).toBeNull()
    expect(emisiones).toHaveLength(1)
  })

  it('protege contra envío doble mientras hay una petición pendiente', async () => {
    let soltar
    emisiones.respuestas.push(() => new Promise((r) => { soltar = () => r(ok('g-temprano')) }))
    await abrirPartido()
    const b = await screen.findByRole('button', { name: 'Obtener código de acceso' })
    await usuario.dblClick(b)
    await waitFor(() => expect(emisiones).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Emitiendo…' }).disabled).toBe(true)
    soltar()
    await screen.findByText(CODIGO)
    expect(emisiones).toHaveLength(1)
  })

  it('con un código sin usar avisa de que uno nuevo lo anula', async () => {
    control['g-temprano'] = { ...CONTROL, codigoPendiente: true, codigoExpiraEn: Date.parse('2026-10-22T15:00:00Z') }
    await abrirPartido()
    expect(await screen.findByRole('button', { name: 'Emitir un código nuevo' })).toBeTruthy()
    expect(screen.getByText('Un código nuevo anula el que está sin usar.')).toBeTruthy()
    expect(screen.getByText(/Hay un código sin usar que vence el/)).toBeTruthy()
    expect(screen.queryByText(CODIGO)).toBeNull() // el estado nunca trae el código
  })

  it('un partido ya iniciado o con teléfono activado no permite emitir', async () => {
    control['g-temprano'] = { ...CONTROL, partido: 'vivo' }
    control['g-tarde'] = { ...CONTROL, credencial: 'activa' }
    await abrirPartido('g-temprano')
    expect((await screen.findByRole('button', { name: 'Obtener código de acceso' })).disabled).toBe(true)
    expect(screen.getByText(/ya está en curso/)).toBeTruthy()
    cleanup()
    await abrirPartido('g-tarde')
    expect((await screen.findByRole('button', { name: 'Obtener código de acceso' })).disabled).toBe(true)
    expect(screen.getByText(/Un código nuevo no lo reemplaza/)).toBeTruthy()
    expect(emisiones).toHaveLength(0)
  })

  it('rechazo 409: mensaje claro, sin código y sin reintento', async () => {
    emisiones.respuestas.push(json(409, { error: 'partido-iniciado' }))
    await abrirPartido()
    await usuario.click(await screen.findByRole('button', { name: 'Obtener código de acceso' }))
    expect((await screen.findByText(/ya no está programado/)).textContent).toContain('No se creó nada')
    expect(screen.queryByText(CODIGO)).toBeNull()
    expect(emisiones).toHaveLength(1)
  })

  it('respuesta perdida: queda incierto, no se repite sola y la nueva emisión es una acción explícita', async () => {
    emisiones.respuestas.push(new TypeError('red'), ok('g-temprano'))
    await abrirPartido()
    await usuario.click(await screen.findByRole('button', { name: 'Obtener código de acceso' }))
    expect((await screen.findByRole('alert', {})).textContent).toContain('No pudimos confirmar si se emitió un código')
    expect(screen.queryByText(CODIGO)).toBeNull()
    await new Promise((r) => setTimeout(r, 50))
    expect(emisiones).toHaveLength(1) // nada se reenvió solo
    expect(screen.getByRole('button', { name: 'Comprobar estado' })).toBeTruthy()
    await usuario.click(screen.getByRole('button', { name: 'Emitir un código nuevo' }))
    expect(await screen.findByText(CODIGO)).toBeTruthy()
    expect(emisiones).toHaveLength(2)
  })

  it('503 de resultado desconocido y cuerpo ilegible también son inciertos; sin conexión no envía nada', async () => {
    emisiones.respuestas.push(json(503, { tipo: 'resultado-desconocido' }), json(200, { partidoId: 'otro', codigo: CODIGO, expiraEn: 1 }))
    await abrirPartido()
    await usuario.click(await screen.findByRole('button', { name: 'Obtener código de acceso' }))
    await screen.findByText(/No pudimos confirmar si se emitió/)
    await usuario.click(screen.getByRole('button', { name: 'Emitir un código nuevo' }))
    await waitFor(() => expect(emisiones).toHaveLength(2))
    await screen.findByText(/No pudimos confirmar si se emitió/)
    expect(screen.queryByText(CODIGO)).toBeNull() // un código de OTRO partido nunca se muestra
    sinConexion()
    await usuario.click(screen.getByRole('button', { name: 'Emitir un código nuevo' }))
    expect((await screen.findAllByText('Se requiere conexión a internet para esta acción.')).length).toBeGreaterThan(0)
    expect(emisiones).toHaveLength(2)
  })

  it('401 al emitir: sesión terminada, vuelve a la entrada y el código no se muestra', async () => {
    emisiones.respuestas.push(() => { srv.estado.sesion = false; return json(401, { error: 'no-autorizado' }) })
    await abrirPartido()
    await usuario.click(await screen.findByRole('button', { name: 'Obtener código de acceso' }))
    await screen.findByLabelText('Código de acceso')
    expect(screen.queryByText(CODIGO)).toBeNull()
  })

  it('401 al leer el estado del control: vuelve a la entrada', async () => {
    srv.estado.sesion = true
    const original = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (url, o) => (String(url).endsWith('/control') ? json(401, { error: 'no-autorizado' }) : original(url, o))))
    abrir('/organizador/ligas/LIGA-U10/partidos/g-temprano')
    await screen.findByLabelText('Código de acceso')
  })
})

describe('retirar el acceso del teléfono antes del inicio (REPORT_181)', () => {
  const activo = () => { control['g-temprano'] = { ...CONTROL, credencial: 'activa' } }
  const botonRetirar = () => screen.getByRole('button', { name: 'Retirar acceso del teléfono' })
  const abrirPanel = async () => { await usuario.click(botonRetirar()); return screen.getByRole('group', { name: 'Confirmar el retiro del acceso del teléfono' }) }

  it('solo se ofrece con una lectura fresca que confirma «programado» y un teléfono con acceso; no hay botón sin teléfono, ni con el partido en curso o terminado', async () => {
    await abrirPartido()
    expect(screen.queryByRole('button', { name: 'Retirar acceso del teléfono' })).toBeNull() // sin teléfono
    cleanup()
    control['g-temprano'] = { ...CONTROL, partido: 'vivo', credencial: 'activa' }
    await abrirPartido()
    expect(screen.queryByRole('button', { name: 'Retirar acceso del teléfono' })).toBeNull()
    expect(screen.getByText(/después del inicio no está disponible en este piloto/)).toBeTruthy()
    cleanup()
    control['g-temprano'] = { ...CONTROL, partido: 'final', credencial: 'activa' }
    await abrirPartido()
    expect(screen.queryByRole('button', { name: 'Retirar acceso del teléfono' })).toBeNull()
    expect(screen.getByText(/después del inicio no está disponible en este piloto/)).toBeTruthy()
    cleanup()
    activo()
    await abrirPartido()
    expect(botonRetirar()).toBeTruthy()
    expect(revocaciones).toHaveLength(0)
  })

  it('abrir, refrescar, enfocar y entrar al panel de confirmación NO envían nada; el panel explica las consecuencias y ofrece Cancelar y confirmar', async () => {
    activo()
    await abrirPartido()
    window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
    const panel = await abrirPanel()
    expect(panel.textContent).toMatch(/perderá el permiso para iniciar el partido y puntuar/)
    expect(panel.textContent).toMatch(/NO inicia el partido/)
    expect(panel.textContent).toMatch(/generar un\s+código nuevo, aparte y a propósito/)
    expect(within(panel).getByRole('button', { name: 'Cancelar' })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Sí, retirar el acceso' })).toBeTruthy()
    expect(revocaciones).toHaveLength(0)
    expect(espia.filter((p) => p.metodo !== 'GET')).toHaveLength(0)
  })

  it('Cancelar no cambia nada: ni petición, ni estado, y el panel se cierra', async () => {
    activo()
    await abrirPartido()
    const panel = await abrirPanel()
    await usuario.click(within(panel).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('group', { name: 'Confirmar el retiro del acceso del teléfono' })).toBeNull()
    expect(revocaciones).toHaveLength(0)
    expect(control['g-temprano'].credencial).toBe('activa')
    expect(botonRetirar()).toBeTruthy()
  })

  it('confirmar: UNA petición POST con la cabecera de petición del sitio; luego relee el estado, dice la verdad y NO genera ningún código; «Obtener código» queda habilitado solo por la lectura nueva', async () => {
    activo()
    revocaciones.respuestas.push(() => revocaDeVerdad('g-temprano'))
    await abrirPartido()
    expect((await screen.findByRole('button', { name: 'Obtener código de acceso' })).disabled).toBe(true) // con teléfono activo no se puede emitir
    const lecturasAntes = espia.filter((p) => p.url.endsWith('/control') && p.metodo === 'GET').length
    await usuario.click(within(await abrirPanel()).getByRole('button', { name: 'Sí, retirar el acceso' }))
    const msg = await screen.findByText(/Acceso retirado\./)
    expect(msg.textContent).toMatch(/NO se ha iniciado y no se generó ningún código/)
    expect(revocaciones).toHaveLength(1)
    expect(revocaciones[0].url).toBe('/v1/organizador/ligas/LIGA-U10/partidos/g-temprano/control/revocar')
    expect(revocaciones[0].cuerpo).toBe('{}')
    expect(revocaciones[0].cabeceras['x-sebel-peticion']).toBe('1')
    expect(revocaciones[0].credenciales).toBe('same-origin')
    await waitFor(() => expect(espia.filter((p) => p.url.endsWith('/control') && p.metodo === 'GET').length).toBeGreaterThan(lecturasAntes)) // lectura fresca
    expect(emisiones).toHaveLength(0) // ningún código solo
    await waitFor(() => expect(screen.getByRole('button', { name: 'Obtener código de acceso' }).disabled).toBe(false))
    expect(screen.queryByRole('button', { name: 'Retirar acceso del teléfono' })).toBeNull() // ya no hay a quién retirar
    expect(screen.getByText('Ningún teléfono activado todavía.')).toBeTruthy()
  })

  it('el código de otro intento nunca queda a la vista: tras retirar no hay código en pantalla', async () => {
    activo()
    revocaciones.respuestas.push(() => revocaDeVerdad('g-temprano'))
    await abrirPartido()
    await usuario.click(within(await abrirPanel()).getByRole('button', { name: 'Sí, retirar el acceso' }))
    await screen.findByText(/Acceso retirado\./)
    expect(screen.queryByText(CODIGO)).toBeNull()
    expect(document.querySelector('output.codigo-valor')).toBeNull()
  })

  it('protección contra doble clic: dos clics rápidos en confirmar envían UNA petición; mientras dura, nada más se puede pulsar (tampoco emitir)', async () => {
    activo()
    let soltar
    revocaciones.respuestas.push(() => new Promise((r) => { soltar = () => r(revocaDeVerdad('g-temprano')) }))
    await abrirPartido()
    const confirmar = within(await abrirPanel()).getByRole('button', { name: 'Sí, retirar el acceso' })
    await Promise.all([usuario.click(confirmar), usuario.click(confirmar)])
    await waitFor(() => expect(revocaciones).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Obtener código de acceso' }).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Sí, retirar el acceso' })).toBeNull() // el panel se cerró al enviar
    soltar()
    await screen.findByText(/Acceso retirado\./)
    expect(revocaciones).toHaveLength(1)
  })

  it('solapamiento con la emisión: mientras se retira no se puede emitir, y mientras se emite no se puede retirar', async () => {
    activo()
    let soltar
    revocaciones.respuestas.push(() => new Promise((r) => { soltar = () => r(revocaDeVerdad('g-temprano')) }))
    await abrirPartido()
    await usuario.click(within(await abrirPanel()).getByRole('button', { name: 'Sí, retirar el acceso' }))
    await waitFor(() => expect(revocaciones).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Obtener código de acceso' }).disabled).toBe(true)
    soltar()
    await screen.findByText(/Acceso retirado\./)
    expect(emisiones).toHaveLength(0)
  })

  it('respuesta perdida: NO afirma éxito, no repite, no genera código, ofrece «Comprobar estado» (solo lectura) y la lectura no se atribuye a ninguna petición', async () => {
    activo()
    revocaciones.respuestas.push(new TypeError('red'))
    await abrirPartido()
    await usuario.click(within(await abrirPanel()).getByRole('button', { name: 'Sí, retirar el acceso' }))
    const aviso = await screen.findByText(/No sabemos si el servidor retiró el acceso/)
    expect(aviso.textContent).toMatch(/No se repite solo y no se genera ningún código/)
    expect(screen.queryByText(/Acceso retirado\./)).toBeNull()
    expect(revocaciones).toHaveLength(1) // sin reintento automático
    expect(emisiones).toHaveLength(0)
    // el servidor SÍ lo había retirado: la lectura de solo lectura lo muestra, sin atribuirlo
    control['g-temprano'] = { ...CONTROL, credencial: 'ninguna' }
    const antes = espia.filter((p) => p.metodo !== 'GET').length
    await usuario.click(await screen.findByRole('button', { name: 'Comprobar estado' }))
    const leido = await screen.findByText(/Estado leído del servidor ahora/)
    expect(leido.textContent).toMatch(/no indica qué petición produjo ese estado/)
    expect(screen.getByText('Ningún teléfono activado todavía.')).toBeTruthy()
    expect(espia.filter((p) => p.metodo !== 'GET').length).toBe(antes) // comprobar no muta
    expect(revocaciones).toHaveLength(1)
    expect(emisiones).toHaveLength(0)
  })

  it.each([
    ['500 sin cuerpo útil', () => json(500, { error: 'x' })],
    ['503 resultado desconocido', () => json(503, { error: 'resultado-desconocido' })],
    ['200 con cuerpo ilegible', () => new Response('no es json', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['200 con forma incorrecta', () => json(200, { ok: true })],
    ['200 con conteo imposible', () => json(200, { ok: true, credencialesRevocadas: -1 })],
  ])('resultado dudoso (%s): incierto, sin éxito ni reintento ni código', async (_n, resp) => {
    activo()
    revocaciones.respuestas.push(resp)
    await abrirPartido()
    await usuario.click(within(await abrirPanel()).getByRole('button', { name: 'Sí, retirar el acceso' }))
    await screen.findByText(/No sabemos si el servidor retiró el acceso/)
    expect(screen.queryByText(/Acceso retirado\./)).toBeNull()
    expect(revocaciones).toHaveLength(1)
    expect(emisiones).toHaveLength(0)
  })

  it('el servidor dice que no había nada que retirar (n = 0): se dice tal cual, sin código', async () => {
    activo()
    revocaciones.respuestas.push(() => { control['g-temprano'] = { ...CONTROL, credencial: 'ninguna' }; return json(200, { ok: true, credencialesRevocadas: 0 }) })
    await abrirPartido()
    await usuario.click(within(await abrirPanel()).getByRole('button', { name: 'Sí, retirar el acceso' }))
    expect((await screen.findByText(/no encontró ningún teléfono con acceso que retirar/)).textContent).toMatch(/No se generó ningún código/)
    expect(screen.queryByText(/Acceso retirado\./)).toBeNull()
  })

  it('el partido empezó mientras tanto (409): se explica que después del inicio no se cambia el teléfono; nada cambió y la lectura lo confirma', async () => {
    activo()
    revocaciones.respuestas.push(() => { control['g-temprano'] = { ...CONTROL, partido: 'vivo', credencial: 'activa' }; return json(409, { error: 'partido-iniciado' }) })
    await abrirPartido()
    await usuario.click(within(await abrirPanel()).getByRole('button', { name: 'Sí, retirar el acceso' }))
    const m = await screen.findByText(/El partido ya empezó/)
    expect(m.textContent).toMatch(/después del inicio no está disponible en este piloto/)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retirar acceso del teléfono' })).toBeNull())
    expect(screen.getByText(/ya está en curso/)).toBeTruthy()
    expect(emisiones).toHaveLength(0)
  })

  it('401 (sesión caducada o liga ajena): lleva a la entrada; 403/400: la petición no se decidió, nada cambió; 404: no encontrado; sin conexión: no se envía nada', async () => {
    activo()
    revocaciones.respuestas.push(json(403, { error: 'prohibido' }))
    await abrirPartido()
    await usuario.click(within(await abrirPanel()).getByRole('button', { name: 'Sí, retirar el acceso' }))
    expect((await screen.findByText(/no aceptó la petición, así que no se cambió nada/)).textContent).toBeTruthy()
    revocaciones.respuestas.push(json(404, { error: 'no-encontrado' }))
    await usuario.click(await screen.findByRole('button', { name: 'Retirar acceso del teléfono' }))
    await usuario.click(within(screen.getByRole('group', { name: 'Confirmar el retiro del acceso del teléfono' })).getByRole('button', { name: 'Sí, retirar el acceso' }))
    expect(await screen.findByText(/No encontramos ese partido, o no tienes acceso/)).toBeTruthy()
    sinConexion()
    await usuario.click(await screen.findByRole('button', { name: 'Retirar acceso del teléfono' }))
    const n = revocaciones.length
    await usuario.click(within(screen.getByRole('group', { name: 'Confirmar el retiro del acceso del teléfono' })).getByRole('button', { name: 'Sí, retirar el acceso' }))
    expect((await screen.findAllByText(/Se requiere conexión a internet/)).length).toBeGreaterThan(0)
    expect(revocaciones).toHaveLength(n) // sin conexión no sale nada
    conConexion()
    cleanup()
    activo()
    revocaciones.respuestas.push(() => { srv.estado.sesion = false; return json(401, { error: 'no-autorizado' }) }) // el servidor ya no reconoce la sesión
    await abrirPartido()
    await usuario.click(within(await abrirPanel()).getByRole('button', { name: 'Sí, retirar el acceso' }))
    await screen.findByLabelText('Código de acceso') // el 401 invalida la sesión y lleva a la entrada
    expect(ubicacion.pathname).toBe('/organizador/acceso')
  })

  it('una activación anterior sin retirar (solo recibos / vencida) también se puede retirar: bloquea el código nuevo', async () => {
    for (const credencial of ['solo-recibos', 'vencida']) {
      control['g-temprano'] = { ...CONTROL, credencial }
      await abrirPartido()
      expect(await screen.findByText(/activación anterior sin retirar/)).toBeTruthy()
      expect(botonRetirar()).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Obtener código de acceso' }).disabled).toBe(true)
      cleanup()
    }
  })

  it('nada del retiro toca el almacenamiento del navegador ni deja códigos en enlaces', async () => {
    activo()
    revocaciones.respuestas.push(() => revocaDeVerdad('g-temprano'))
    await abrirPartido()
    await usuario.click(within(await abrirPanel()).getByRole('button', { name: 'Sí, retirar el acceso' }))
    await screen.findByText(/Acceso retirado\./)
    expect(almacenado()).not.toMatch(/revoc|retir|ZZ-/i)
    for (const a of document.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').not.toMatch(/ZZ-|token/i)
  })
})

describe('invitación de activación y copia del código (REPORT_182)', () => {
  const ACT = () => `${window.location.origin}/control/LIGA-U10/g-temprano`
  const copiaOriginal = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  let escribir
  beforeEach(() => { escribir = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { value: { writeText: escribir }, configurable: true }) })
  afterEach(() => { if (copiaOriginal) Object.defineProperty(navigator, 'clipboard', copiaOriginal); else delete navigator.clipboard })
  const estadoInv = () => document.querySelector('[data-invitacion="estado"]').textContent
  const emitirCodigoEnPantalla = async () => {
    emisiones.respuestas.push(ok('g-temprano'))
    await usuario.click(await screen.findByRole('button', { name: 'Obtener código de acceso' }))
    await screen.findByText(CODIGO)
  }

  it('el bloque «Invitar al árbitro» está en «Acceso de puntuación», separado de «Compartir partido», con la explicación y SIN enviar nada al abrir', async () => {
    await abrirPartido()
    const bloque = screen.getByRole('region', { name: 'Invitar al árbitro' })
    expect(bloque.textContent).toMatch(/Envía este enlace al árbitro\. Comparte el código por separado\. La persona debe abrirlo en el teléfono que usará para puntuar\. Activar el teléfono no comienza el partido\./)
    expect(screen.getByRole('link', { name: 'Abrir pantalla de activación' })).toBeTruthy() // sigue disponible
    expect(within(bloque).getByRole('button', { name: 'Copiar enlace de activación' })).toBeTruthy()
    expect(within(bloque).getByRole('link', { name: 'Compartir invitación por WhatsApp' })).toBeTruthy()
    expect(bloque.closest('section[aria-label="Marcador público"]')).toBeNull() // no es la sección de espectadores
    expect(screen.getByRole('button', { name: 'Compartir partido' })).toBeTruthy() // el de espectadores sigue aparte
    expect(espia.filter((p) => p.metodo !== 'GET')).toHaveLength(0)
    expect(escribir).not.toHaveBeenCalled()
    expect(emisiones).toHaveLength(0)
  })

  it('«Copiar enlace de activación»: copia SOLO la URL absoluta del origen actual de ESTE partido, sin código, token ni query; éxito verdadero; no emite ni activa nada', async () => {
    await abrirPartido()
    await usuario.click(screen.getByRole('button', { name: 'Copiar enlace de activación' }))
    await waitFor(() => expect(estadoInv()).toBe('Enlace copiado.'))
    expect(escribir).toHaveBeenCalledTimes(1)
    expect(escribir).toHaveBeenCalledWith(ACT())
    expect(escribir.mock.calls[0][0]).not.toMatch(/\?|#|token|ZZ-|codigo/i)
    expect(screen.getByLabelText('Enlace de activación').value).toBe(ACT())
    expect(emisiones).toHaveLength(0)
    expect(espia.filter((p) => p.metodo !== 'GET')).toHaveLength(0)
  })

  it('si el navegador niega la copia: mensaje verdadero (nunca «copiado») y campo seleccionable con el enlace', async () => {
    await abrirPartido()
    escribir.mockRejectedValueOnce(new Error('denegado'))
    await usuario.click(screen.getByRole('button', { name: 'Copiar enlace de activación' }))
    await waitFor(() => expect(estadoInv()).toMatch(/No se pudo copiar el enlace/))
    expect(estadoInv()).not.toMatch(/copiado/i)
    const campo = screen.getByLabelText('Enlace de activación')
    expect(campo.readOnly).toBe(true)
    expect(document.activeElement).toBe(campo)
  })

  it('WhatsApp: destino wa.me con los equipos y el enlace de activación; NUNCA el código (ni con el código a la vista); se abre en otra pestaña solo al pulsar', async () => {
    await abrirPartido()
    await emitirCodigoEnPantalla()
    const wa = screen.getByRole('link', { name: 'Compartir invitación por WhatsApp' })
    expect(wa.getAttribute('target')).toBe('_blank')
    expect(wa.getAttribute('rel')).toContain('noopener')
    const href = wa.getAttribute('href')
    expect(href.startsWith('https://wa.me/?text=')).toBe(true)
    const texto = decodeURIComponent(href.slice('https://wa.me/?text='.length))
    expect(texto).toContain('Alfa vs Beta')
    expect(texto).toContain(ACT())
    expect(texto).toContain('El código te lo da el organizador por separado')
    expect(href).not.toContain(CODIGO)
    expect(texto).not.toContain(CODIGO)
    expect(texto).not.toMatch(/ZZ-|token|\/liga\/|marcador/i)
    expect(screen.getByLabelText('Enlace de activación').value).not.toContain(CODIGO)
  })

  it('«Copiar código» solo existe mientras el código está a la vista; copia EXACTAMENTE ese código SIN otra emisión; «Código copiado.»', async () => {
    await abrirPartido()
    expect(screen.queryByRole('button', { name: 'Copiar código' })).toBeNull() // sin código nuevo no hay nada que copiar (y no se recupera ninguno viejo)
    await emitirCodigoEnPantalla()
    expect(emisiones).toHaveLength(1)
    await usuario.click(screen.getByRole('button', { name: 'Copiar código' }))
    await waitFor(() => expect(document.querySelector('[data-codigo="estado"]').textContent).toBe('Código copiado.'))
    expect(escribir).toHaveBeenCalledWith(CODIGO)
    expect(emisiones).toHaveLength(1) // ninguna emisión más
    expect(espia.filter((p) => p.url.endsWith('/codigo') && p.metodo === 'POST')).toHaveLength(1)
    expect(espia.some((p) => /revocar|comandos|activar/.test(p.url))).toBe(false)
  })

  it('si falla la copia del código: mensaje verdadero y campo seleccionable DENTRO de la zona privada del código', async () => {
    await abrirPartido()
    await emitirCodigoEnPantalla()
    escribir.mockRejectedValueOnce(new Error('denegado'))
    await usuario.click(screen.getByRole('button', { name: 'Copiar código' }))
    await waitFor(() => expect(document.querySelector('[data-codigo="estado"]').textContent).toMatch(/No se pudo copiar el código/))
    const campo = screen.getByLabelText('Código para copiar a mano')
    expect(campo.value).toBe(CODIGO)
    expect(campo.closest('.codigo-emitido')).toBeTruthy() // la misma zona privada que se oculta con «Ocultar código»
    expect(document.activeElement).toBe(campo)
    expect(screen.queryByText('Código copiado.')).toBeNull()
  })

  it('Ocultar código quita el código, el campo de respaldo y el aviso; un código nuevo empieza sin aviso', async () => {
    await abrirPartido()
    await emitirCodigoEnPantalla()
    await usuario.click(screen.getByRole('button', { name: 'Copiar código' }))
    await screen.findByText('Código copiado.')
    await usuario.click(screen.getByRole('button', { name: 'Ocultar código' }))
    expect(screen.queryByText(CODIGO)).toBeNull()
    expect(screen.queryByText('Código copiado.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copiar código' })).toBeNull()
    expect(document.querySelector('[data-codigo="estado"]')).toBeNull()
    expect(document.body.innerHTML).not.toContain(CODIGO)
    emisiones.respuestas.push(ok('g-temprano'))
    await usuario.click(screen.getByRole('button', { name: 'Obtener código de acceso' }))
    await screen.findByText(CODIGO)
    expect(document.querySelector('[data-codigo="estado"]').textContent).toBe('') // no hereda el «copiado» del código anterior
  })

  it('salir de la pantalla deja el código y su aviso fuera; ningún texto del código llega al almacenamiento ni a enlaces', async () => {
    await abrirPartido()
    await emitirCodigoEnPantalla()
    await usuario.click(screen.getByRole('button', { name: 'Copiar código' }))
    await screen.findByText('Código copiado.')
    expect(almacenado()).not.toContain(CODIGO)
    for (const a of document.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').not.toContain(CODIGO)
    await usuario.click(screen.getByRole('link', { name: /Liga Sub-10/ }))
    await screen.findByRole('heading', { name: 'Equipos' })
    expect(document.body.innerHTML).not.toContain(CODIGO)
    expect(consola.some((c) => JSON.stringify(c.mock.calls).includes(CODIGO))).toBe(false)
  })

  it('la sesión que termina limpia el código y su aviso (401 al emitir/leer lleva a la entrada)', async () => {
    await abrirPartido()
    await emitirCodigoEnPantalla()
    srv.estado.sesion = false
    window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
    await screen.findByLabelText('Código de acceso')
    expect(document.body.innerHTML).not.toContain(CODIGO)
  })

  it('en un partido iniciado o terminado no se ofrece la invitación (la activación nueva ya no existe)', async () => {
    control['g-temprano'] = { ...CONTROL, partido: 'vivo' }
    abrir('/organizador/ligas/LIGA-U10/partidos/g-final') // g-final está «Terminado» en la liga
    await screen.findByRole('heading', { name: 'Acceso de puntuación' })
    expect(screen.queryByRole('region', { name: 'Invitar al árbitro' })).toBeNull()
  })

  it('«Compartir partido» sigue dando la URL de espectadores, distinta del enlace de activación', async () => {
    await abrirPartido()
    await usuario.click(screen.getByRole('button', { name: 'Compartir partido' }))
    const publico = screen.getByLabelText('Enlace del partido').value
    expect(publico).toMatch(/\/liga\/liga-u10\/partido\/alfa-vs-beta-/)
    expect(publico).not.toContain('/control/')
    expect(publico).not.toBe(ACT())
  })

  it('en un origen de este computador (localhost) avisa que un teléfono físico necesita una dirección alcanzable', async () => {
    await abrirPartido()
    expect(window.location.hostname).toBe('localhost')
    expect(screen.getByText(/funciona aquí\. Un teléfono físico necesita una dirección que pueda alcanzar/)).toBeTruthy()
  })
})
