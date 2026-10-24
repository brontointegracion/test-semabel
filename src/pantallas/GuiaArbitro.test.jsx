/** @vitest-environment jsdom */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AppCompartida from '../AppCompartida'
import { SIN_TABS_COMPARTIDO } from '../lib/publico/navegacion.js'
import { clave } from '../lib/control/activacion-almacen'
import ControlPartido from './ControlPartido'
import ControlActivar from './ControlActivar'
import GuiaArbitro, { GuiaEnLinea, SECCIONES, TITULO_GUIA } from './GuiaArbitro'
import { conConexion, instalarCandados, json } from '../prueba/compartido'

// REPORT_206: la guía es contenido estático. Estas pruebas fijan que (1) está en su ruta pública sin tocar la red ni el almacenamiento,
// (2) los nombres de botones que cita existen de verdad en las pantallas, (3) abrirla y cerrarla dentro de la activación, la consola y el
// acceso del organizador no cambia nada de lo que esas pantallas guardan o envían.

const TEXTO_GUIA = SECCIONES.flatMap((s) => [s.titulo, ...s.puntos]).join('\n')
const fuente = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8')
let f
let usuario
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  f = vi.fn(async () => json(404, { error: 'no-encontrado' }))
  vi.stubGlobal('fetch', f)
  usuario = userEvent.setup()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })

describe('la página pública /ayuda/arbitro', () => {
  it('muestra el título y las cinco secciones, sin barra de pestañas, sin ninguna petición y sin escribir nada guardado', () => {
    render(<MemoryRouter initialEntries={['/ayuda/arbitro']}><AppCompartida /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Guía de puntuación' })).toBeTruthy()
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titulos).toEqual(['1. Antes del partido', '2. Activar el teléfono', '3. Comenzar y puntuar', '4. Si el teléfono se bloquea o falla la conexión', '5. Periodos y resultado final'])
    expect(f).not.toHaveBeenCalled()
    expect(localStorage.length + sessionStorage.length).toBe(0)
    expect(SIN_TABS_COMPARTIDO.some((r) => r.test('/ayuda/arbitro'))).toBe(true)
    expect(document.querySelector('nav')).toBeNull()
  })

  it('es solo de lectura: ningún botón ni formulario, y el único enlace lleva al inicio', () => {
    render(<MemoryRouter><GuiaArbitro /></MemoryRouter>)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(document.querySelector('form, input, textarea')).toBeNull()
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/'])
  })
})

describe('el contenido', () => {
  it('no contiene códigos, tokens, direcciones con datos, teléfonos de soporte ni promesas que la versión no cumple', () => {
    expect(TEXTO_GUIA).not.toMatch(/https?:\/\//i)
    expect(TEXTO_GUIA).not.toMatch(/\b[A-Z0-9]{5}-[A-Z0-9]{5}-/) // forma de un código de partido
    expect(TEXTO_GUIA).not.toMatch(/token|contraseña|\+?\d[\d\s-]{7,}\d/i) // ni secretos ni un número de teléfono inventado
    expect(TEXTO_GUIA).toMatch(/mm:ss/)
    // REPORT_210: el formato 845 / 0845 → 08:45 existe al salir del campo; la guía lo explica tal como funciona
    expect(TEXTO_GUIA).toMatch(/845 o 0845 \(también vale 08:45\), y toca fuera del campo: queda como 08:45/)
    expect(TEXTO_GUIA).toMatch(/Dar formato al tiempo no envía nada/)
    expect(TEXTO_GUIA).toMatch(/segundos van de 00 a 59/)
    expect(TEXTO_GUIA).toMatch(/no adivina/)
    expect(TEXTO_GUIA).toMatch(/No borres los datos del sitio, no cambies de navegador y no actives otro teléfono/)
    expect(TEXTO_GUIA).toMatch(/no está verificado en esta versión/)
    expect(TEXTO_GUIA).toMatch(/8 minutos por periodo \(08:00\).*10 minutos \(10:00\).*no reglas universales/s)
    expect(TEXTO_GUIA).toMatch(/ANTES de que el partido comience/)
    expect(TEXTO_GUIA).toMatch(/no permite pasar el control a otro teléfono con el partido ya en marcha/)
  })

  it('cada botón o etiqueta que cita existe en la pantalla real', () => {
    const activar = fuente('./ControlActivar.jsx')
    const consola = fuente('./ControlPartido.jsx')
    const piezas = fuente('./publico/ConsolaPiezas.jsx')
    const organizador = fuente('./PartidoOrganizador.jsx')
    const donde = [
      ['Código del partido', activar], ['Activar este teléfono', activar], ['Teléfono activado', activar], ['Abrir control', activar],
      ['Retirar acceso del teléfono', organizador],
      ['Comenzar el partido', consola], ['Confirmar inicio', consola], ['Cerrar el partido', consola], ['Confirmar cierre', consola],
      ['Corregir reloj (mm:ss)', consola], ['Corregir', consola], ['Empezar el ', consola], ['Terminar el ', consola], ['antes de tiempo', consola],
      ['Guardado aquí, pendiente de enviar', consola], ['Confirmado por el servidor', consola], ['faltas del período', consola],
      ['Pendiente', consola], ['Confirmado', consola],
      ['▶  Arrancar', piezas], ['❚❚  Detener', piezas], ['Últimas acciones', piezas], ['anular', piezas], ['↺ Deshacer', piezas], ['↻ Rehacer', piezas],
    ]
    for (const [texto, origen] of donde) expect(origen, `«${texto}»`).toContain(texto)
    // …y la guía las cita (con la grafía de la pantalla, salvo los espacios dobles de los botones del reloj).
    for (const t of ['Código del partido', 'Activar este teléfono', 'Teléfono activado', 'Abrir control', 'Retirar acceso del teléfono', 'Comenzar el partido', 'Confirmar inicio',
      'Cerrar el partido', 'Confirmar cierre', 'Corregir reloj (mm:ss)', 'Corregir', 'Últimas acciones', 'anular', '↺ Deshacer', '↻ Rehacer', '▶ Arrancar', '❚❚ Detener',
      'Pendiente', 'Confirmado', 'Empezar el 2º cuarto', 'Terminar el 1º cuarto antes de tiempo']) expect(TEXTO_GUIA, t).toContain(t.replace('Detener', 'Detener'))
  })

  it('«Detener» y «Arrancar» se citan con los textos de la consola', () => {
    expect(TEXTO_GUIA).toContain('«▶ Arrancar» y «❚❚ Detener»')
  })
})

describe('GuiaEnLinea: abrir y cerrar no navega ni pide nada', () => {
  it('un botón con nombre «Guía de puntuación» que despliega las cinco secciones y se cierra', async () => {
    render(<MemoryRouter><GuiaEnLinea /></MemoryRouter>)
    const b = screen.getByRole('button', { name: TITULO_GUIA })
    expect(b.getAttribute('aria-expanded')).toBe('false')
    await usuario.click(b)
    expect(b.getAttribute('aria-expanded')).toBe('true')
    const panel = screen.getByRole('region', { name: TITULO_GUIA })
    expect(panel.querySelectorAll('summary')).toHaveLength(5)
    await usuario.click(within(panel).getByRole('button', { name: 'Cerrar la guía' }))
    expect(screen.queryByRole('region', { name: TITULO_GUIA })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})

describe('en la pantalla de activación', () => {
  it('conserva lo escrito en «Código del partido» al abrir y cerrar la guía, sin peticiones nuevas ni escrituras', async () => {
    const restore = instalarCandados()
    conConexion()
    f.mockImplementation(async () => json(200, {
      gameId: 'P1', rev: 0, liga: { id: 'LIGA1', nombre: 'Liga Uno' }, estado: 'programado',
      local: { id: 'E1', nombre: 'Alfa', puntos: 0, faltas: 0 }, visita: { id: 'E2', nombre: 'Beta', puntos: 0, faltas: 0 },
    }))
    render(<MemoryRouter initialEntries={['/control/LIGA1/P1']}><Routes><Route path="/control/:ligaId/:partidoId" element={<ControlActivar />} /></Routes></MemoryRouter>)
    const campo = await screen.findByLabelText('Código del partido')
    await usuario.type(campo, 'ESCRITO-A-MEDIAS')
    await new Promise((r) => setTimeout(r, 50))
    const antes = f.mock.calls.length
    const guardadoAntes = JSON.stringify({ ...localStorage })
    await usuario.click(screen.getByRole('button', { name: TITULO_GUIA }))
    expect(screen.getByRole('region', { name: TITULO_GUIA })).toBeTruthy()
    await usuario.click(screen.getByRole('button', { name: 'Cerrar la guía' }))
    expect(screen.getByLabelText('Código del partido').value).toBe('ESCRITO-A-MEDIAS')
    expect(f.mock.calls.length).toBe(antes)
    expect(f.mock.calls.every(([u]) => !/\/comandos|\/activar/.test(u))).toBe(true)
    expect(JSON.stringify({ ...localStorage })).toBe(guardadoAntes)
    restore.quitar()
  })
})

describe('en la consola de puntuación', () => {
  const sha = (t) => createHash('sha256').update(t).digest('hex')
  it('abrir y cerrar la guía no cierra el controlador, no registra ningún comando y la consola sigue montada', async () => {
    localStorage.setItem(clave('LIGA1', 'P1'), JSON.stringify({
      v: 1, ligaId: 'LIGA1', partidoId: 'P1', token: 'a'.repeat(64), tokenHash: sha('a'.repeat(64)), estado: 'activada', conIncierto: false, intentos: 1,
      creadoEn: 1, actualizadoEn: 1, deviceId: 'dev-uno', servidor: null,
    }))
    const estado = {
      modo: 'propietario', propietario: true, conexion: { enLinea: true, visible: true }, reloj: { nivel: 'confiable', motivo: null, estimadoMs: Date.now(), remuestreoDebido: false, muestreando: false },
      emisor: { fase: 'inactivo' }, colaBloqueadaPorReloj: null, estados: [], ultimaVerificacion: null, ultimoRefresco: null, ultimaVisualizacion: null, aviso: null, listo: true,
      sesion: { ok: true, inicio: 'sin-iniciar', puntuacion: { habilitada: false, motivo: null }, pendientes: 0, enviando: 0, confirmadas: 0, cmdIdsVivos: [], detenida: null, divergencia: null, provisional: null, visualizacion: { disponible: false } },
    }
    const ctl = {
      estado: () => estado, suscribir: () => () => {}, abrir: vi.fn(async () => estado), cerrar: vi.fn(async () => ({})), registrar: vi.fn(), iniciarPartido: vi.fn(),
      reintentarAhora: vi.fn(), asegurarDatosParaMostrar: vi.fn(async () => ({})), relojAhora: () => ({ estimadoMs: Date.now(), nivel: 'confiable' }),
    }
    const cerrar = vi.fn(async () => { await ctl.cerrar() })
    const fabrica = vi.fn(async () => ({ ctl, cerrar }))
    render(<MemoryRouter initialEntries={['/control/LIGA1/P1/marcador']}><Routes><Route path="/control/:ligaId/:partidoId/marcador" element={<ControlPartido fabrica={fabrica} />} /></Routes></MemoryRouter>)
    await screen.findByText('Consola del árbitro')
    const abrirCtl = ctl.abrir.mock.calls.length
    const guardadoAntes = JSON.stringify({ ...localStorage })
    await usuario.click(screen.getByRole('button', { name: TITULO_GUIA }))
    const panel = screen.getByRole('region', { name: TITULO_GUIA })
    expect(within(panel).getAllByText(/./).length).toBeGreaterThan(5)
    expect(screen.getByRole('button', { name: 'Comenzar el partido' })).toBeTruthy() // la consola sigue ahí
    await usuario.click(within(panel).getByRole('button', { name: 'Cerrar la guía' }))
    expect(fabrica).toHaveBeenCalledTimes(1)
    expect(ctl.abrir.mock.calls.length).toBe(abrirCtl)
    expect(cerrar).not.toHaveBeenCalled()
    expect(ctl.registrar).not.toHaveBeenCalled()
    expect(ctl.iniciarPartido).not.toHaveBeenCalled()
    expect(f).not.toHaveBeenCalled()
    expect(JSON.stringify({ ...localStorage })).toBe(guardadoAntes)
    expect(screen.getByRole('link', { name: '‹ Activación' }).getAttribute('href')).toBe('/control/LIGA1/P1') // el contexto del partido no cambió
  })
})
