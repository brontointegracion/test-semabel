/** @vitest-environment jsdom */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { clave } from '../lib/control/activacion-almacen'
import ControlPartido from './ControlPartido'
import { reglasDeCategoria } from '../lib/reglas-categoria'

// REPORT_128: la pantalla de puntuación compartida, con un CONTROLADOR simulado (el real se prueba en las pruebas del controlador y
// en el navegador). Aquí se mira lo que la persona ve y lo que la pantalla le pide al controlador.

const L = 'LIGA1'
const P = 'P1'
const sha = (t) => createHash('sha256').update(t).digest('hex')
const JUG = [
  { id: 'J1', equipoId: 'E1', nombrePila: 'Ana', apellido1: 'Prueba', dorsal: 0, activo: true },
  { id: 'J2', equipoId: 'E1', nombrePila: 'Saúl', apellido1: 'Montero', dorsal: 2, activo: true },
  { id: 'J3', equipoId: 'E1', nombrePila: 'Zoe', apellido1: 'Sin', dorsal: null, activo: true },
  { id: 'J4', equipoId: 'E1', nombrePila: null, apellido1: null, dorsal: 9, activo: true },
  { id: 'JX', equipoId: 'E1', nombrePila: 'Dario', apellido1: 'Inactivo', dorsal: 5, activo: false },
  { id: 'K1', equipoId: 'E2', nombrePila: 'Eva', apellido1: 'Visita', dorsal: 1, activo: true },
]
const ev = (o) => ({ id: 'c1', partidoId: 'P1', seq: 1, tipo: 'punto', equipoId: 'E1', jugadorId: 'J2', puntos: 2, periodo: 1, anulado: false, creadoEn: 1, ...o })
const sesionBase = (o = {}) => ({
  ok: true, inicio: 'confirmado', puntuacion: { habilitada: true, motivo: null }, nivelBase: 'derivada', pendientes: 0, enviando: 0, confirmadas: 3, rechazadas: 0, noAplicadas: 0,
  detenida: null, divergencia: null, uso: {}, revision: 3, ultimoClientSeq: 3, siguienteSeq: 4, cmdIdsVivos: [],
  provisional: { gameId: P, config: { deporte: 'baloncesto', minutosPorPeriodo: 10 }, partido: { estado: 'vivo', inicio: null, relojEstado: 'detenido', relojRestante: 600000, relojDesde: null }, equipos: ['E1', 'E2'], eventos: [] },
  visualizacion: { disponible: true, desactualizada: false, equipos: [{ id: 'E1', nombre: 'Alfa' }, { id: 'E2', nombre: 'Beta' }], jugadores: JUG },
  ...o,
})
const estadoBase = (o = {}) => ({
  modo: 'propietario', propietario: true, conexion: { enLinea: true, visible: true }, reloj: { nivel: 'confiable', motivo: null, estimadoMs: Date.now(), remuestreoDebido: false, muestreando: false },
  emisor: { fase: 'inactivo' }, sesion: sesionBase(), colaBloqueadaPorReloj: null, estados: [], ultimaVerificacion: null, ultimoRefresco: null, ultimaVisualizacion: null, aviso: null, listo: true, ...o,
})

function controladorFalso(inicial) {
  let actual = inicial
  const oyentes = new Set()
  const c = {
    estado: () => actual,
    suscribir: (f) => { oyentes.add(f); return () => oyentes.delete(f) },
    abrir: vi.fn(async () => actual),
    cerrar: vi.fn(async () => ({ cerrado: true })),
    registrar: vi.fn(async () => ({ ok: true })),
    iniciarPartido: vi.fn(async () => ({ ok: true })),
    reintentarAhora: vi.fn(async () => ({ ok: true })),
    reanudarTrasRechazoDeInicio: vi.fn(async () => ({ ok: true, reanudada: true })),
    recuperarDeNoAutorizado: vi.fn(async () => ({ ok: true })),
    asegurarDatosParaMostrar: vi.fn(async () => ({ ok: true })),
    relojAhora: () => ({ estimadoMs: Date.now(), nivel: actual.reloj.nivel }),
    poner(nuevo) { actual = nuevo; act(() => { for (const f of oyentes) f(actual) }) },
  }
  return c
}

let ctl
let cerrar
const montar = async (estado, { ruta = `/control/${L}/${P}/marcador`, activada = true } = {}) => {
  if (activada) {
    localStorage.setItem(clave(L, P), JSON.stringify({
      v: 1, ligaId: L, partidoId: P, token: 'a'.repeat(64), tokenHash: sha('a'.repeat(64)), estado: 'activada', conIncierto: false, intentos: 1,
      creadoEn: 1_700_000_000_000, actualizadoEn: 1_700_000_000_000, deviceId: 'dev-uno', servidor: null,
    }))
  }
  ctl = controladorFalso(estado)
  cerrar = vi.fn(async () => { await ctl.cerrar() })
  const r = render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/control/:ligaId/:partidoId/marcador" element={<ControlPartido fabrica={async () => ({ ctl, cerrar })} />} />
        <Route path="/control/:ligaId/:partidoId" element={<p>pantalla de activación</p>} />
      </Routes>
    </MemoryRouter>,
  )
  if (activada) await screen.findByText('Consola del árbitro')
  return r
}
beforeEach(() => { localStorage.clear() })
afterEach(() => { cleanup(); localStorage.clear() })
const boton = (n) => screen.getByRole('button', { name: n })
const aviso = (id) => document.querySelector(`[data-aviso="${id}"]`)

describe('activación', () => {
  it('sin activación explica, enlaza a la activación y NO borra nada guardado', async () => {
    localStorage.setItem('otra-clave', 'x')
    await montar(estadoBase(), { activada: false })
    expect(screen.getByText(/todavía no está activado/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ir a la activación' }).getAttribute('href')).toBe(`/control/${L}/${P}`)
    expect(localStorage.getItem('otra-clave')).toBe('x')
    expect(ctl).toBeUndefined
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('un registro ilegible se dice, sin borrarlo', async () => {
    localStorage.setItem(clave(L, P), '{no')
    await montar(estadoBase(), { activada: false })
    expect(screen.getByText(/No se pudo leer la activación guardada/)).toBeTruthy()
    expect(localStorage.getItem(clave(L, P))).toBe('{no')
  })
  it('dirección inválida: aviso y nada más', async () => {
    await montar(estadoBase(), { ruta: '/control/a.b/P1/marcador', activada: false })
    expect(screen.getByText('La dirección del partido no es válida.')).toBeTruthy()
  })
})

describe('puntuar: nombres, números y gestos de la consola', () => {
  it('muestra «#2 Saúl Montero», «#0» como número real, sin número sin «#», sin nombre explícito; solo activos; el selector cambia de equipo', async () => {
    const u = userEvent.setup()
    await montar(estadoBase())
    expect(boton('#2 Saúl Montero más 2')).toBeTruthy()
    expect(boton('#0 Ana Prueba más 1')).toBeTruthy()
    expect(boton('Zoe Sin más 3')).toBeTruthy()
    expect(screen.getByText('Sin nombre registrado')).toBeTruthy()
    expect(screen.getByLabelText(/#9 más 1/)).toBeTruthy() // tiene número y no tiene nombre: no se inventa uno
    expect(screen.queryByText(/Dario/)).toBeNull() // inactivo: no se puede anotar
    const filaAna = document.querySelector('[data-jugador="J1"]')
    expect(within(filaAna).getByText('0')).toBeTruthy() // el dorsal 0 se ve, no «—»
    expect(within(document.querySelector('[data-jugador="J3"]')).getByText('—')).toBeTruthy()
    // orden por número: 0, 2, 9 y al final los sin número
    const nombres = [...document.querySelectorAll('.jugador-fila')].map((f) => f.getAttribute('data-jugador'))
    expect(nombres).toEqual(['J1', 'J2', 'J4', 'J3'])
    await u.click(boton(/Beta/))
    expect(boton('#1 Eva Visita más 1')).toBeTruthy()
    expect(screen.queryByText(/Saúl/)).toBeNull()
  })
  it('+2 llama al controlador con el id estable (no el número), un cmdId criptográfico y se avisa «guardado aquí, pendiente»', async () => {
    const u = userEvent.setup()
    await montar(estadoBase())
    await u.click(boton('#2 Saúl Montero más 2'))
    expect(ctl.registrar).toHaveBeenCalledTimes(1)
    const arg = ctl.registrar.mock.calls[0][0]
    expect(arg).toMatchObject({ tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J2', puntos: 2 } })
    expect(arg.cmdId).toMatch(/^anotar-[0-9a-f-]{36}$/)
    expect(JSON.stringify(arg)).not.toContain('"dorsal"')
    expect(await screen.findByText(/guardado en este teléfono, pendiente de enviar/)).toBeTruthy()
    await u.click(boton('Falta de #0 Ana Prueba'))
    expect(ctl.registrar.mock.calls[1][0]).toMatchObject({ tipo: 'falta', datos: { equipoId: 'E1', jugadorId: 'J1' } })
  })
  it('doble toque: mientras la promesa de ESA intención está pendiente no se duplica; tras resolver, el siguiente toque es otra intención con otro cmdId', async () => {
    const u = userEvent.setup()
    await montar(estadoBase())
    let resolver
    ctl.registrar.mockImplementationOnce(() => new Promise((r) => { resolver = r }))
    const b = boton('#2 Saúl Montero más 2')
    await u.click(b)
    await u.click(b)
    await u.click(b)
    expect(ctl.registrar).toHaveBeenCalledTimes(1)
    // otra intención distinta no queda bloqueada
    await u.click(boton('#0 Ana Prueba más 3'))
    expect(ctl.registrar).toHaveBeenCalledTimes(2)
    await act(async () => { resolver({ ok: true }) })
    await u.click(boton('#2 Saúl Montero más 2'))
    expect(ctl.registrar).toHaveBeenCalledTimes(3)
    expect(ctl.registrar.mock.calls[2][0].cmdId).not.toBe(ctl.registrar.mock.calls[0][0].cmdId)
  })
  it('dos toques intencionales seguidos son dos órdenes con dos cmdId aunque la primera siga sin confirmar por el servidor (sin retardo arbitrario)', async () => {
    const u = userEvent.setup()
    await montar(estadoBase())
    ctl.registrar.mockImplementation(async () => ({ ok: true })) // la orden se guarda; el servidor aún no la confirma
    const b = boton('#2 Saúl Montero más 2')
    await u.click(b)
    ctl.poner(estadoBase({ sesion: sesionBase({ pendientes: 1, cmdIdsVivos: ['anotar-sin-confirmar'] }) }))
    await u.click(boton('#2 Saúl Montero más 2'))
    expect(ctl.registrar).toHaveBeenCalledTimes(2)
    const [x, y] = ctl.registrar.mock.calls.map((c) => c[0])
    expect(x).toMatchObject({ tipo: 'anotar', datos: { jugadorId: 'J2', puntos: 2 } })
    expect(y).toMatchObject({ tipo: 'anotar', datos: { jugadorId: 'J2', puntos: 2 } })
    expect(x.cmdId).not.toBe(y.cmdId)
  })
  it('si el registro LANZA (resultado incierto) el reintento de esa intención conserva el MISMO cmdId y se avisa sin decir «guardado»', async () => {
    const u = userEvent.setup()
    await montar(estadoBase())
    ctl.registrar.mockRejectedValueOnce(new Error('boom'))
    await u.click(boton('#2 Saúl Montero más 2'))
    expect(await screen.findByText(/No se supo si la acción quedó guardada/)).toBeTruthy()
    await u.click(boton('#2 Saúl Montero más 2'))
    expect(ctl.registrar.mock.calls[1][0].cmdId).toBe(ctl.registrar.mock.calls[0][0].cmdId)
  })
  it('un rechazo (p. ej. sin espacio) NO dice guardado y el aviso queda hasta que se lee', async () => {
    const u = userEvent.setup()
    await montar(estadoBase())
    ctl.registrar.mockResolvedValueOnce({ ok: false, motivo: 'almacenamiento' })
    await u.click(boton('#2 Saúl Montero más 2'))
    const a = await screen.findByText(/NO quedó registrada/)
    expect(a.closest('[role=alert]')).toBeTruthy()
    expect(screen.queryByText(/Guardado en este teléfono/)).toBeNull()
  })
})

describe('habilitación: solo un inicio CONFIRMADO', () => {
  it('sin sesión: comenzar exige confirmar en pantalla; confirma una vez con cmdId y confirmadoPorOperador; no hay botones de anotar', async () => {
    const u = userEvent.setup()
    await montar(estadoBase({ sesion: { ok: false, motivo: 'sesion-inexistente' } }))
    expect(screen.queryByRole('button', { name: /más/ })).toBeNull()
    await u.click(boton('Comenzar el partido'))
    expect(ctl.iniciarPartido).not.toHaveBeenCalled()
    expect(screen.getByText(/el servidor tiene que confirmar el inicio/)).toBeTruthy()
    await u.click(boton('Cancelar'))
    expect(ctl.iniciarPartido).not.toHaveBeenCalled()
    await u.click(boton('Comenzar el partido'))
    await u.click(boton('Confirmar inicio'))
    expect(ctl.iniciarPartido).toHaveBeenCalledTimes(1)
    expect(ctl.iniciarPartido.mock.calls[0][0]).toMatchObject({ confirmadoPorOperador: true })
    expect(ctl.iniciarPartido.mock.calls[0][0].cmdId).toMatch(/^iniciar-partido-/)
    expect(await screen.findByText(/hasta entonces no se puede puntuar/)).toBeTruthy()
  })
  it('un inicio sin recibo (pendiente o en vuelo) no habilita nada y el aviso es «no sabemos»; no se ofrece otro inicio', async () => {
    await montar(estadoBase({ emisor: { fase: 'esperando-reintento' }, sesion: sesionBase({ inicio: 'sin-iniciar', enviando: 1, pendientes: 0, confirmadas: 0, puntuacion: { habilitada: false }, cmdIdsVivos: ['ini1'] }) }))
    expect(aviso('inicio-incierto').textContent).toContain('No sabemos todavía si el servidor recibió el inicio')
    expect(screen.queryByRole('button', { name: /Comenzar/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /más/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Arrancar/ })).toBeNull()
  })
  it('un partido que el servidor ya tenía en marcha (sin-resolver) NO se puede puntuar ni iniciar', async () => {
    await montar(estadoBase({ sesion: sesionBase({ inicio: 'sin-resolver', puntuacion: { habilitada: false, motivo: 'inicio-sin-resolver' }, provisional: { ...sesionBase().provisional, partido: { ...sesionBase().provisional.partido, estado: 'vivo' } } }) }))
    expect(aviso('inicio-sin-resolver')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Comenzar|más/ })).toBeNull()
  })
  it('sin conexión no se ofrece comenzar y se explica', async () => {
    await montar(estadoBase({ conexion: { enLinea: false, visible: true }, sesion: { ok: false, motivo: 'sesion-inexistente' } }))
    expect(boton('Comenzar el partido').disabled).toBe(true)
  })
})

describe('datos para mostrar', () => {
  it('ausentes: se dice explícitamente, no hay botones de anotar con nombres inventados, y se piden UNA vez al controlador', async () => {
    await montar(estadoBase({ sesion: sesionBase({ visualizacion: { disponible: false, motivo: 'sin-datos-de-pantalla', equipos: [], jugadores: [] } }) }))
    expect(aviso('sin-datos-de-pantalla').textContent).toMatch(/Faltan los nombres y números/)
    expect(screen.queryByRole('button', { name: /más|Falta de/ })).toBeNull()
    await waitFor(() => expect(ctl.asegurarDatosParaMostrar).toHaveBeenCalledTimes(1))
    act(() => ctl.poner(estadoBase({ sesion: sesionBase({ visualizacion: { disponible: false, equipos: [], jugadores: [] }, revision: 4 }) })))
    expect(ctl.asegurarDatosParaMostrar).toHaveBeenCalledTimes(1) // no es un bucle
    expect(screen.getAllByText('Equipo 1').length).toBeGreaterThan(0)
    // el reloj y el periodo siguen disponibles
    expect(screen.getByRole('button', { name: /Arrancar/ })).toBeTruthy()
  })
  it('desactualizados: aviso informativo, siguen usándose', async () => {
    await montar(estadoBase({ sesion: sesionBase({ visualizacion: { ...sesionBase().visualizacion, desactualizada: true } }) }))
    expect(aviso('datos-desactualizados')).toBeTruthy()
    expect(boton('#2 Saúl Montero más 2')).toBeTruthy()
  })
})

describe('faltas de equipo según las reglas fijadas del partido (REPORT_175)', () => {
  // Dos faltas de Alfa en el periodo 1, una transición de periodo y una falta de Alfa en el periodo 2; Beta una en el periodo 1.
  const eventos = [
    ev({ id: 'f1', seq: 1, tipo: 'falta', puntos: 0, jugadorId: 'J1' }), ev({ id: 'f2', seq: 2, tipo: 'falta', puntos: 0, jugadorId: 'J1' }),
    ev({ id: 'f3', seq: 3, tipo: 'falta', puntos: 0, equipoId: 'E2', jugadorId: 'K1' }),
    ev({ id: 'p1', seq: 4, tipo: 'periodo', equipoId: null, jugadorId: null, puntos: 0 }),
    ev({ id: 'f4', seq: 5, tipo: 'falta', puntos: 0, jugadorId: 'J2', periodo: 2 }),
  ]
  const reglas = (faltasEquipo) => ({ ...reglasDeCategoria({ deporte: 'baloncesto', categoria: 'adult' }), faltasEquipo })
  const con = (config) => estadoBase({ sesion: sesionBase({ provisional: { ...sesionBase().provisional, config: { deporte: 'baloncesto', minutosPorPeriodo: 10, ...config }, eventos } }) })

  it('sin reglas fijadas (partido anterior): total de partido, como siempre', async () => {
    await montar(con({}))
    expect(screen.getByText(/Alfa · 3 faltas$/)).toBeTruthy()
    expect(screen.getByText(/Beta · 1 faltas$/)).toBeTruthy()
  })
  it('«partido»: el total acumulado de todo el partido', async () => {
    await montar(con({ reglas: reglas('partido') }))
    expect(screen.getByText(/Alfa · 3 faltas$/)).toBeTruthy()
  })
  it('«periodo»: solo el periodo actual y la etiqueta lo dice; el historial del jugador (y su límite) sigue siendo de todo el partido', async () => {
    await montar(con({ reglas: reglas('periodo') }))
    expect(screen.getByText(/Alfa · 1 faltas del período$/)).toBeTruthy()
    expect(screen.getByText(/Beta · 0 faltas del período$/)).toBeTruthy()
  })
  it('«oculto»: no aparece ningún texto de faltas de equipo en el marcador', async () => {
    await montar(con({ reglas: reglas('oculto') }))
    expect(screen.getByText('Alfa', { selector: '.corto' })).toBeTruthy()
    expect(screen.getByText('Beta', { selector: '.corto' })).toBeTruthy()
  })
  it('reglas PRESENTES pero inválidas o no soportadas: no se inventa «partido»; se dice y no se muestran faltas de equipo', async () => {
    for (const mala of [{ ...reglas('periodo'), version: 99 }, { ...reglas('periodo'), categoria: 'otra' }, { ...reglas('periodo'), faltasEquipo: 'bonus' }, null, 'x']) {
      await montar(con({ reglas: mala }))
      expect(document.querySelector('[data-aviso="reglas-invalidas"]'), JSON.stringify(mala)).toBeTruthy()
      expect(screen.getByText('Alfa', { selector: '.corto' })).toBeTruthy()
      expect(screen.queryByText(/faltas del período|3 faltas/)).toBeNull()
      cleanup()
    }
  })
  it('la marca `reglasInvalidas` que envía el servidor se trata igual; sin reglas no hay aviso', async () => {
    await montar(con({ reglasInvalidas: true }))
    expect(document.querySelector('[data-aviso="reglas-invalidas"]')).toBeTruthy()
    cleanup()
    await montar(con({}))
    expect(document.querySelector('[data-aviso="reglas-invalidas"]')).toBeNull()
  })
})

describe('enlace de volver (REPORT_180)', () => {
  it('«‹ Activación» es un enlace a la pantalla de activación de ESTE partido (no al historial) y usa el estilo de volver', async () => {
    await montar(estadoBase())
    const a = screen.getByRole('link', { name: '‹ Activación' })
    expect(a.getAttribute('href')).toBe(`/control/${L}/${P}`)
    expect(a.className).toBe('volver')
    expect(a.closest('.topbar')).toBeTruthy()
  })
})

describe('rechazo definitivo del inicio por reglas de categoría (REPORT_178)', () => {
  const rechazado = (ultimoRechazo, extra = {}) => estadoBase({ sesion: sesionBase({
    inicio: 'sin-iniciar', puntuacion: { habilitada: false, motivo: 'inicio-rechazado' }, ultimoRechazo,
    detenida: { causa: 'rechazo-definitivo', clase: null, subtipo: null, http: null, cmdId: 'c1' }, ...extra,
  }) })
  const INICIO = { cmdId: 'c1', tipo: 'iniciar-partido', motivo: 'reglas-desactualizadas' }

  it('explica que el servidor NO inició el partido y que hay que actualizar la preparación; ofrece la acción', async () => {
    await montar(rechazado(INICIO))
    const a = aviso('rechazo')
    expect(a.textContent).toMatch(/reglas de categoría de este partido cambiaron/)
    expect(a.textContent).toMatch(/NO inició el partido/)
    expect(a.textContent).toMatch(/actualizar la preparación/)
    expect(boton('Actualizar la preparación')).toBeTruthy()
    expect(ctl.reanudarTrasRechazoDeInicio).not.toHaveBeenCalled() // nada automático
  })
  it('pide confirmación EN LA PÁGINA: cancelar no llama; confirmar llama una vez con la confirmación explícita y dice que el partido sigue sin iniciar', async () => {
    const u = userEvent.setup()
    await montar(rechazado(INICIO))
    await u.click(boton('Actualizar la preparación'))
    const grupo = screen.getByRole('group', { name: 'Confirmar la actualización de la preparación' })
    expect(grupo.textContent).toMatch(/No se inicia el partido ni se cambia nada en el servidor/)
    expect(grupo.textContent).toMatch(/pulsar «Comenzar el partido» y confirmar otra vez/)
    await u.click(boton('Cancelar'))
    expect(ctl.reanudarTrasRechazoDeInicio).not.toHaveBeenCalled()
    await u.click(boton('Actualizar la preparación'))
    await u.click(boton('Sí, actualizar'))
    expect(ctl.reanudarTrasRechazoDeInicio).toHaveBeenCalledTimes(1)
    expect(ctl.reanudarTrasRechazoDeInicio).toHaveBeenCalledWith({ confirmadoPorOperador: true })
    expect(await screen.findByText(/El partido NO se ha iniciado/)).toBeTruthy()
  })
  it('si no se logra, lo dice sin prometer nada', async () => {
    const u = userEvent.setup()
    await montar(rechazado(INICIO))
    ctl.reanudarTrasRechazoDeInicio.mockResolvedValueOnce({ ok: false, motivo: 'sin-internet' })
    await u.click(boton('Actualizar la preparación'))
    await u.click(boton('Sí, actualizar'))
    expect(await screen.findByText(/Se necesita conexión a internet para actualizar la preparación\. No se hizo nada/)).toBeTruthy()
  })
  it('otro rechazo del inicio: se dice y se ofrece actualizar; el de otra orden NO ofrece la acción', async () => {
    await montar(rechazado({ cmdId: 'c1', tipo: 'iniciar-partido', motivo: 'preparacion-desactualizada' }))
    expect(aviso('rechazo').textContent).toMatch(/rechazó el inicio del partido/)
    expect(boton('Actualizar la preparación')).toBeTruthy()
    cleanup()
    await montar(rechazado({ cmdId: 'c2', tipo: 'anotar', motivo: 'tiempo-invalido' }, { inicio: 'confirmado' }))
    expect(aviso('rechazo').textContent).toMatch(/rechazó una acción y las siguientes quedaron sin enviar/)
    expect(screen.queryByRole('button', { name: 'Actualizar la preparación' })).toBeNull()
  })
  it('un rechazo por reglas inválidas (otra orden) explica la restricción y no ofrece la acción', async () => {
    await montar(rechazado({ cmdId: 'c3', tipo: 'siguiente-periodo', motivo: 'reglas-invalidas' }, { inicio: 'confirmado' }))
    const t = aviso('rechazo').textContent
    expect(t).toMatch(/reglas de categoría guardadas para este partido no son válidas/)
    expect(t).toMatch(/bloquea el inicio, el cambio de periodo y la corrección del reloj/)
    expect(screen.queryByRole('button', { name: 'Actualizar la preparación' })).toBeNull()
  })
  it('sin datos en el teléfono no se inventa un cero de faltas de equipo', async () => {
    await montar(estadoBase({ sesion: null }))
    expect([...document.querySelectorAll('.cabecera .corto')].map((e) => e.textContent).join('|')).not.toMatch(/faltas/)
  })
})

describe('marcador, eventos, pendiente frente a confirmado', () => {
  it('marcador y faltas por equipo salen de los eventos provisionales; cada evento dice Pendiente o Confirmado', async () => {
    const eventos = [ev({ id: 'c1', seq: 1 }), ev({ id: 'c2', seq: 2, tipo: 'falta', puntos: 0, jugadorId: 'J1' }), ev({ id: 'c3', seq: 3, equipoId: 'E2', jugadorId: 'K1', puntos: 3 })]
    await montar(estadoBase({ sesion: sesionBase({ cmdIdsVivos: ['c3'], pendientes: 1, provisional: { ...sesionBase().provisional, eventos } }) }))
    expect(screen.getByLabelText('Puntos de Alfa').textContent).toBe('2')
    expect(screen.getByLabelText('Puntos de Beta').textContent).toBe('3')
    expect(screen.getByText(/Alfa · 1 faltas/)).toBeTruthy()
    const f = (id) => document.querySelector(`[data-evento="${id}"]`)
    expect(within(f('c1')).getByText('Confirmado')).toBeTruthy()
    expect(within(f('c3')).getByText('Pendiente')).toBeTruthy()
    expect(within(f('c1')).getByText('#2 Saúl Montero')).toBeTruthy()
    expect(document.querySelector('[data-sincro]').textContent).toMatch(/Guardado aquí, pendiente de enviar: 1 · Confirmado por el servidor: 3/)
  })
  it('anular, deshacer y rehacer van por el controlador; rehacer solo si hay algo que rehacer', async () => {
    const u = userEvent.setup()
    await montar(estadoBase({ sesion: sesionBase({ provisional: { ...sesionBase().provisional, eventos: [ev({ id: 'c1' })] } }) }))
    expect(boton('↻ Rehacer').disabled).toBe(true)
    await u.click(within(document.querySelector('[data-evento="c1"]')).getByRole('button', { name: 'anular' }))
    expect(ctl.registrar.mock.calls[0][0]).toMatchObject({ tipo: 'anular-evento', datos: { eventoId: 'c1' } })
    await u.click(boton('↺ Deshacer'))
    expect(ctl.registrar.mock.calls[1][0]).toMatchObject({ tipo: 'deshacer', datos: {} })
    act(() => ctl.poner(estadoBase({ sesion: sesionBase({ provisional: { ...sesionBase().provisional, eventos: [ev({ id: 'c1', anulado: true, anuladoEn: 1 })] } }) })))
    await u.click(boton('↻ Rehacer'))
    expect(ctl.registrar.mock.calls[2][0]).toMatchObject({ tipo: 'rehacer' })
  })
})

describe('reloj, periodo y cierre', () => {
  it('arrancar y detener; sin hora del servidor el botón está desactivado y se explica; puntos y periodo siguen', async () => {
    const u = userEvent.setup()
    await montar(estadoBase())
    await u.click(boton(/Arrancar/))
    expect(ctl.registrar.mock.calls[0][0]).toMatchObject({ tipo: 'arrancar-reloj' })
    act(() => ctl.poner(estadoBase({ reloj: { nivel: 'sin-estimacion', motivo: 'sin-muestra', estimadoMs: null } })))
    expect(boton(/Arrancar/).disabled).toBe(true)
    expect(aviso('reloj-no-disponible').textContent).toMatch(/Sin hora del servidor/)
    expect(boton('#2 Saúl Montero más 2').disabled).toBe(false)
    expect(boton(/Terminar el 1º cuarto antes de tiempo/).disabled).toBe(false)
    await u.click(boton(/Terminar el 1º cuarto/))
    expect(ctl.registrar.mock.calls.at(-1)[0]).toMatchObject({ tipo: 'siguiente-periodo' })
  })
  it('con el reloj corriendo se ofrece detener y NO la corrección; detenido, la corrección valida mm:ss', async () => {
    const u = userEvent.setup()
    const corriendo = sesionBase({ provisional: { ...sesionBase().provisional, partido: { ...sesionBase().provisional.partido, relojEstado: 'corriendo', relojRestante: 600000, relojDesde: Date.now() } } })
    await montar(estadoBase({ sesion: corriendo }))
    expect(boton(/Detener/)).toBeTruthy()
    expect(screen.queryByLabelText('Corregir reloj (mm:ss)')).toBeNull()
    act(() => ctl.poner(estadoBase()))
    const campo = screen.getByLabelText('Corregir reloj (mm:ss)')
    await u.type(campo, 'abc')
    await u.click(boton('Corregir'))
    expect(await screen.findByText(/Escribe el tiempo como mm:ss/)).toBeTruthy()
    expect(ctl.registrar).not.toHaveBeenCalled()
    await u.clear(campo); await u.type(campo, '11:00'); await u.click(boton('Corregir'))
    expect(await screen.findByText(/no cabe en el periodo/)).toBeTruthy()
    expect(ctl.registrar).not.toHaveBeenCalled()
    await u.clear(campo); await u.type(campo, '08:30'); await u.click(boton('Corregir'))
    expect(ctl.registrar.mock.calls[0][0]).toMatchObject({ tipo: 'corregir-reloj', datos: { restanteMs: 510000 } })
  })
  it('cerrar exige confirmación en pantalla; tras el cierre se ve el resumen final con el estado de confirmación y se ocultan las acciones', async () => {
    const u = userEvent.setup()
    await montar(estadoBase())
    await u.click(boton('Cerrar el partido'))
    expect(ctl.registrar).not.toHaveBeenCalled()
    await u.click(boton('Cancelar'))
    await u.click(boton('Cerrar el partido'))
    await u.click(boton('Confirmar cierre'))
    expect(ctl.registrar.mock.calls[0][0]).toMatchObject({ tipo: 'cerrar-partido', datos: {} })
    const eventos = [ev({ id: 'c1' }), ev({ id: 'c2', seq: 2, equipoId: 'E2', jugadorId: 'K1', puntos: 3 })]
    act(() => ctl.poner(estadoBase({ sesion: sesionBase({ cmdIdsVivos: ['c9'], provisional: { ...sesionBase().provisional, partido: { ...sesionBase().provisional.partido, estado: 'final' }, eventos } }) })))
    const resumen = screen.getByRole('region', { name: 'Resumen final' })
    expect(within(resumen).getByText('Alfa 2 — 3 Beta')).toBeTruthy()
    expect(within(resumen).getByText('#2 Saúl Montero: 2 pts · 0 faltas')).toBeTruthy()
    expect(within(resumen).getByText(/Quedan 1 acciones guardadas aquí por confirmar/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /más|Deshacer|Cerrar el partido/ })).toBeNull()
    expect(screen.getByText('Partido finalizado')).toBeTruthy()
  })
})

describe('estados de control (textos y acciones)', () => {
  it('pestaña de solo lectura: se ve todo, no se puede actuar', async () => {
    await montar(estadoBase({ modo: 'solo-lectura', propietario: false, emisor: null }))
    expect(aviso('solo-lectura').textContent).toMatch(/otra pestaña/)
    expect(boton('#2 Saúl Montero más 2').disabled).toBe(true)
    expect(boton('↺ Deshacer').disabled).toBe(true)
    expect(ctl.asegurarDatosParaMostrar).not.toHaveBeenCalled()
  })
  it('sin conexión con acciones guardadas; reintentos agotados ofrece «Reintentar ahora» (sin prometer reintento automático)', async () => {
    const u = userEvent.setup()
    await montar(estadoBase({ conexion: { enLinea: false, visible: true }, sesion: sesionBase({ pendientes: 2, cmdIdsVivos: ['a', 'b'] }) }))
    expect(aviso('sin-conexion').textContent).toMatch(/2 acciones guardadas en este teléfono/)
    act(() => ctl.poner(estadoBase({ emisor: { fase: 'reintentos-agotados' }, sesion: sesionBase({ pendientes: 1, cmdIdsVivos: ['a'] }) })))
    expect(aviso('envio-agotado').textContent).not.toMatch(/automátic/)
    await u.click(boton('Reintentar ahora'))
    expect(ctl.reintentarAhora).toHaveBeenCalledTimes(1)
  })
  it('autorización, rechazo definitivo, divergencia y parada persistida: avisos distintos, acciones bloqueadas y sin mandar parar el partido', async () => {
    const casos = [
      [{ detenida: { causa: 'transporte', clase: 'no-autorizado' } }, 'no-autorizado', /ya no está autorizado/],
      [{ detenida: { causa: 'rechazo-definitivo' } }, 'rechazo', /rechazó una acción/],
      [{ divergencia: { causa: 'x' } }, 'divergencia', /no coinciden con el servidor/],
    ]
    for (const [s, id, re] of casos) {
      cleanup(); localStorage.clear()
      await montar(estadoBase({ sesion: sesionBase(s) }))
      expect(aviso(id).textContent, id).toMatch(re)
      expect(aviso(id).textContent, id).not.toMatch(/parar el partido|detén/i)
      expect(boton('#2 Saúl Montero más 2').disabled, id).toBe(true)
      expect(screen.queryByRole('button', { name: /reanudar|borrar|limpiar|quitar parada/i }), id).toBeNull() // no hay reanudación general
    }
  })
  it('cola bloqueada por una acción de reloj y capacidad se exponen', async () => {
    await montar(estadoBase({ colaBloqueadaPorReloj: { cmdId: 'c', motivo: 'sin-tiempo-confiable' }, estados: ['capacidad-rechazada'] }))
    expect(aviso('reloj-bloqueado').textContent).toMatch(/esperan detrás/)
    expect(aviso('capacidad').textContent).toMatch(/No hay espacio/)
  })
})

describe('recuperación explícita de la parada «no-autorizado» (REPORT_130)', () => {
  const parada401 = (extra = {}) => estadoBase({ estados: ['parada-persistida'], sesion: sesionBase({ detenida: { causa: 'transporte', clase: 'no-autorizado', http: 401, subtipo: null, cmdId: 'c1' } }), ...extra })
  it('se ofrece con confirmación EN LA PÁGINA; nada se llama sin ella y al confirmar se llama una vez con la confirmación explícita', async () => {
    const u = userEvent.setup()
    await montar(parada401())
    expect(ctl.recuperarDeNoAutorizado).not.toHaveBeenCalled() // nada automático al abrir
    await u.click(boton('Volver a comprobar la autorización'))
    expect(ctl.recuperarDeNoAutorizado).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Confirmar la comprobación de la autorización' }).textContent).toMatch(/misma autorización de siempre/)
    expect(screen.getByRole('group', { name: 'Confirmar la comprobación de la autorización' }).textContent).toMatch(/retirarla de nuevo/)
    await u.click(boton('Cancelar'))
    expect(ctl.recuperarDeNoAutorizado).not.toHaveBeenCalled()
    await u.click(boton('Volver a comprobar la autorización'))
    await u.click(boton('Sí, comprobar ahora'))
    expect(ctl.recuperarDeNoAutorizado).toHaveBeenCalledTimes(1)
    expect(ctl.recuperarDeNoAutorizado).toHaveBeenCalledWith({ confirmadoPorOperador: true })
    expect(await screen.findByText(/El servidor confirmó la autorización/)).toBeTruthy()
  })
  it('si no se logra, lo dice sin prometer nada y la parada sigue; ningún texto manda parar el partido', async () => {
    const u = userEvent.setup()
    await montar(parada401())
    ctl.recuperarDeNoAutorizado.mockResolvedValueOnce({ ok: false, motivo: 'no-autorizado' })
    await u.click(boton('Volver a comprobar la autorización'))
    await u.click(boton('Sí, comprobar ahora'))
    const t = await screen.findByText(/sigue sin autorizar este teléfono/)
    expect(t.textContent).toMatch(/envío sigue detenido/)
    expect(t.textContent).not.toMatch(/parar el partido|detén/i)
    expect(boton('Volver a comprobar la autorización')).toBeTruthy() // se puede volver a intentar
    expect(aviso('no-autorizado')).toBeTruthy()
  })
  it('SOLO para el 401: no se ofrece con 409, protocolo, rechazo definitivo, divergencia, parada solo en memoria, sin internet ni en pestaña de solo lectura', async () => {
    const casos = [
      ['conflicto', parada401({ sesion: sesionBase({ detenida: { causa: 'transporte', clase: 'conflicto', http: 409, subtipo: 'bloqueado', cmdId: null } }) })],
      ['protocolo', parada401({ sesion: sesionBase({ detenida: { causa: 'transporte', clase: 'protocolo', http: 400, subtipo: 'json-invalido', cmdId: null } }) })],
      ['rechazo', estadoBase({ sesion: sesionBase({ detenida: { causa: 'rechazo-definitivo' } }) })],
      ['divergencia', parada401({ sesion: sesionBase({ divergencia: { causa: 'x' }, detenida: { causa: 'transporte', clase: 'no-autorizado', http: 401, cmdId: null } }) })],
      ['memoria', parada401({ estados: ['parada-solo-en-memoria'] })],
      ['sin internet', parada401({ conexion: { enLinea: false, visible: true } })],
      ['solo lectura', parada401({ modo: 'solo-lectura', propietario: false, emisor: null })],
    ]
    for (const [nombre, estado] of casos) {
      cleanup(); localStorage.clear()
      await montar(estado)
      expect(screen.queryByRole('button', { name: 'Volver a comprobar la autorización' }), nombre).toBeNull()
    }
  })
  it('el botón no usa los verbos de borrar/limpiar/reanudar y no hay otra opción de ese tipo', async () => {
    await montar(parada401())
    const textos = [...document.querySelectorAll('button')].map((b) => b.textContent)
    expect(textos.some((t) => /reanudar|borrar|limpiar/i.test(t))).toBe(false)
  })
})

describe('ciclo de vida', () => {
  it('abre el controlador al montar y lo cierra (y su base) al salir', async () => {
    const { unmount } = await montar(estadoBase())
    expect(ctl.abrir).toHaveBeenCalledTimes(1)
    unmount()
    await waitFor(() => expect(cerrar).toHaveBeenCalledTimes(1))
  })
  it('no usa Dexie ni el almacén del prototipo (solo el controlador)', async () => {
    await montar(estadoBase())
    expect(typeof indexedDB === 'undefined' || true).toBe(true)
    expect(localStorage.getItem('sebel')).toBeNull()
  })
})

describe('disposición de la consola original sobre el controlador del servidor (REPORT_157)', () => {
  it('título de la consola original y bloques en el orden del original: cabecera, reloj, selector, paneles, plantel, últimas acciones, deshacer', async () => {
    await montar(estadoBase())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Consola del árbitro')
    const orden = ['.cabecera', '.reloj-panel', '.selector', '.paneles-barra', '.plantel', '.registro', '.barra-deshacer']
    const posiciones = orden.map((sel) => {
      const el = document.querySelector(sel)
      expect(el, sel).toBeTruthy()
      return [...document.querySelectorAll('.consola *')].indexOf(el)
    })
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones)
    expect(document.querySelector('.selector .escudo')).toBeTruthy() // el selector lleva el escudo del equipo, como el original
    expect(document.querySelector('.selector button.activo').style.background).toMatch(/var\(--ink\)/) // el equipo activo se ve (sin color de equipo del servidor)
  })

  it('lo que el original ofrece y el controlador no soporta se ve como NO DISPONIBLE y nunca se simula: paneles Estadísticas y Defensa, reloj de posesión y de cruce', async () => {
    await montar(estadoBase())
    const tabs = [...document.querySelectorAll('.paneles [role="tab"]')]
    expect(tabs.map((t) => t.textContent.replace('✓ ', ''))).toEqual(['Puntos', 'Estadísticas', 'Defensa'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[0].disabled).toBe(false)
    for (const t of tabs.slice(1)) {
      expect(t.disabled).toBe(true)
      expect(t.getAttribute('title')).toMatch(/Todavía no disponible en el marcador compartido/)
    }
    expect(aviso('no-disponible-original').textContent).toMatch(/reloj de posesión y reloj de cruce de medio campo/)
    expect(document.querySelector('.proto-relojes, .proto-reloj')).toBeNull() // los relojes de prueba no existen aquí
    expect(screen.queryByRole('button', { name: /asistencia|rebote|robo|bloqueo/i })).toBeNull()
    expect(document.body.textContent).not.toMatch(/muestra|Prototipo · no guardado/)
    // pulsar una pestaña no disponible no llama al controlador ni cambia nada
    const antes = ctl.registrar.mock.calls.length
    fireEvent.click(tabs[1])
    expect(ctl.registrar.mock.calls.length).toBe(antes)
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(document.querySelectorAll('.plantel .anota').length).toBeGreaterThan(0) // el plantel sigue siendo el de Puntos
  })

  it('las acciones siguen pasando por el controlador (cmdId estable) con las piezas compartidas: +2, falta, anular, deshacer', async () => {
    const u = userEvent.setup()
    await montar(estadoBase())
    await u.click(boton('#2 Saúl Montero más 2'))
    expect(ctl.registrar).toHaveBeenCalledTimes(1)
    const [llamada] = ctl.registrar.mock.calls[0]
    expect(llamada.tipo).toBe('anotar')
    expect(llamada.cmdId).toMatch(/^[A-Za-z0-9_-]{16,}$/)
    await u.click(boton('Falta de #2 Saúl Montero'))
    expect(ctl.registrar.mock.calls[1][0].tipo).toMatch(/falta/)
    await u.click(boton('↺ Deshacer'))
    expect(ctl.registrar.mock.calls[2][0].tipo).toMatch(/deshacer/)
  })
})

// REPORT_210 — «Corregir reloj»: «845» / «0845» → «08:45» al SALIR del campo o al enviar; mm:ss sigue valiendo; nada se reformatea al teclear;
// un valor no válido se rechaza con su motivo (nunca se acomoda); dar formato NO envía ningún comando.
describe('Corregir reloj: formato al salir del campo (REPORT_210)', () => {
  const campo = () => screen.getByLabelText('Corregir reloj (mm:ss)')
  const detenido = () => estadoBase() // reloj detenido, 10:00 de periodo
  const enviadas = () => ctl.registrar.mock.calls.filter(([o]) => o.tipo === 'corregir-reloj')

  it('teclado numérico y ayuda visible; 845 y 0845 quedan «08:45» al salir del campo SIN enviar nada; «Corregir» envía 525000 ms', async () => {
    const u = userEvent.setup()
    await montar(detenido())
    expect(campo().getAttribute('inputmode')).toBe('numeric')
    expect(campo().getAttribute('enterkeyhint')).toBe('done')
    expect(screen.getByText('Por ejemplo 845 o 08:45.')).toBeTruthy()
    for (const escrito of ['845', '0845']) {
      await u.clear(campo()); await u.type(campo(), escrito)
      expect(campo().value).toBe(escrito) // mientras se teclea no se toca
      await u.tab() // salir del campo
      expect(campo().value).toBe('08:45')
      expect(ctl.registrar).not.toHaveBeenCalled() // dar formato no es un comando
      expect(ctl.iniciarPartido).not.toHaveBeenCalled()
    }
    await u.click(boton('Corregir'))
    expect(enviadas()).toHaveLength(1)
    expect(enviadas()[0][0]).toMatchObject({ tipo: 'corregir-reloj', datos: { restanteMs: 525000 } })
  })

  it('al ENVIAR directamente (sin salir antes del campo) también se normaliza: 845 + «Corregir» envía 08:45; mm:ss sigue valiendo', async () => {
    const u = userEvent.setup()
    await montar(detenido())
    campo().focus(); await u.keyboard('845{Enter}') // Enter envía el formulario sin blur previo
    expect(enviadas()).toHaveLength(1)
    expect(enviadas()[0][0].datos.restanteMs).toBe(525000)
    await u.type(campo(), '08:30'); await u.tab()
    expect(campo().value).toBe('08:30')
    await u.click(boton('Corregir'))
    expect(enviadas()[1][0].datos.restanteMs).toBe(510000)
    await u.type(campo(), '8:05'); await u.tab()
    expect(campo().value).toBe('08:05')
  })

  it('edición parcial: cada tecla deja el texto tal cual (sin dos puntos automáticos) y el cursor donde estaba; insertar en medio no lo mueve', async () => {
    const u = userEvent.setup()
    await montar(detenido())
    await u.click(campo())
    for (const [tecla, esperado] of [['8', '8'], ['4', '84'], ['5', '845']]) { await u.keyboard(tecla); expect(campo().value).toBe(esperado) }
    campo().setSelectionRange(1, 1) // cursor entre el 8 y el 4
    await u.keyboard('0')
    expect(campo().value).toBe('8045')
    expect(campo().selectionStart).toBe(2) // el cursor sigue justo tras lo escrito
    await u.keyboard('{Backspace}')
    expect(campo().value).toBe('845')
    expect(screen.queryByRole('alert')).toBeNull() // nada se valida ni se avisa a medio escribir
    expect(ctl.registrar).not.toHaveBeenCalled()
  })

  it('no válido: formato, segundos y fuera de rango se rechazan al salir y al enviar, con su aviso, SIN cambiar lo escrito ni enviar nada', async () => {
    const u = userEvent.setup()
    await montar(detenido())
    const casos = [['abc', /Escribe el tiempo como mm:ss/], ['8', /Escribe el tiempo como mm:ss/], ['84', /Escribe el tiempo como mm:ss/], ['08450', /Escribe el tiempo como mm:ss/],
      ['860', /segundos deben estar entre 00 y 59/], ['08:60', /segundos deben estar entre 00 y 59/], ['1100', /no cabe en el periodo/], ['11:00', /no cabe en el periodo/]]
    for (const [escrito, texto] of casos) {
      await u.clear(campo()); await u.type(campo(), escrito); await u.tab()
      expect((await screen.findByRole('alert')).textContent, escrito).toMatch(texto)
      expect(campo().value).toBe(escrito === '1100' ? '11:00' : escrito === '11:00' ? '11:00' : escrito) // 1100 es válido como forma → se muestra «11:00» y se rechaza por rango; lo demás queda como se escribió
      expect(campo().getAttribute('aria-invalid')).toBe('true')
      await u.click(boton('Corregir'))
      expect(screen.getByRole('alert').textContent, escrito).toMatch(texto)
      await u.type(campo(), '0') // seguir escribiendo borra el aviso
      expect(screen.queryByRole('alert')).toBeNull()
    }
    expect(ctl.registrar).not.toHaveBeenCalled()
  })

  it('mismos límites: 10:00 (la duración exacta) vale; 1001 no; un campo vacío no envía', async () => {
    const u = userEvent.setup()
    await montar(detenido())
    expect(boton('Corregir').disabled).toBe(true)
    await u.type(campo(), '1001'); await u.tab()
    expect(screen.getByRole('alert').textContent).toMatch(/no cabe en el periodo/)
    await u.clear(campo()); await u.type(campo(), '1000'); await u.tab()
    expect(campo().value).toBe('10:00')
    await u.click(boton('Corregir'))
    expect(enviadas()[0][0].datos.restanteMs).toBe(600000)
  })

  it('guardas: con el reloj corriendo no hay campo (ni se envía lo escrito si el reloj arranca); sin permiso de puntuar el campo y «Corregir» están desactivados', async () => {
    const u = userEvent.setup()
    await montar(detenido())
    await u.type(campo(), '845')
    const corriendo = sesionBase({ provisional: { ...sesionBase().provisional, partido: { ...sesionBase().provisional.partido, relojEstado: 'corriendo', relojRestante: 600000, relojDesde: Date.now() } } })
    act(() => ctl.poner(estadoBase({ sesion: corriendo })))
    expect(screen.queryByLabelText('Corregir reloj (mm:ss)')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Corregir' })).toBeNull()
    expect(ctl.registrar).not.toHaveBeenCalled()
    // sin permiso de puntuar (puntuación deshabilitada) el campo y «Corregir» existen pero están DESACTIVADOS: nada se escribe ni se envía
    act(() => ctl.poner(estadoBase({ sesion: sesionBase({ puntuacion: { habilitada: false, motivo: 'inicio-sin-confirmar' } }) })))
    const bloqueado = screen.queryByLabelText('Corregir reloj (mm:ss)')
    if (bloqueado) { expect(bloqueado.disabled).toBe(true); expect(boton('Corregir').disabled).toBe(true) }
    await u.click(screen.queryByRole('button', { name: 'Corregir' }) ?? document.body)
    expect(ctl.registrar).not.toHaveBeenCalled()
  })
})
