import 'fake-indexeddb/auto'
import { reglasDeConfig } from '../../reglas-categoria'
import { crearBanco, estadoDePrueba, T0 } from '../../motor/prueba/banco'
import { abrirAlmacen } from '../sesion-almacen'
import { construirSesion, validarCuerpoEstado } from '../sesion-motor'
import { crearRelojTelefono, estimar, incorporarMuestra } from '../reloj-telefono'

// Ayudas SINTÉTICAS de las pruebas de la sesión de puntuación: un «servidor» en memoria (el banco del motor, que usa el
// procesador real) y bases de IndexedDB falso con nombre único. Nada toca datos reales ni la red.

export { T0 }
export const LIGA = 'L1'
export const PARTIDO = 'P'
export const ID = `${LIGA}:${PARTIDO}`
export const DEVICE = 'tel-A'

const CAMPOS_EVENTO = ['id', 'partidoId', 'seq', 'tipo', 'equipoId', 'jugadorId', 'puntos', 'periodo', 'anulado', 'creadoEn', 'anuladoEn', 'anuladoRev', 'rehacerBloqueado']

/** Un servidor sintético: el banco del motor (procesador real, adaptador de memoria). */
export function servidorNuevo(opciones = {}) {
  const banco = crearBanco({ estadoInicial: estadoDePrueba({ estado: 'programado', ...opciones }) })
  banco.ahora = T0
  return banco
}

/** Cuerpo con la forma de GET …/estado, armado desde el estado del servidor sintético. */
const DORSALES_DE_PRUEBA = { J1: 0, J2: 7, JX: 4, J9: 1, J8: 9 }
const NOMBRES_DE_PRUEBA = { E1: 'Alfa', E2: 'Beta' }

/** Datos para mostrar SINTÉTICOS del servidor sintético: nombres «Nombre-Jx», el 0 es un número real. */
export function visualizacionDeServidor(banco) {
  const e = banco.adaptador.estado()
  const referenciados = new Set(e.eventos.map((x) => x.jugadorId).filter((x) => typeof x === 'string'))
  const jugadores = Object.entries(e.atribucion.jugadores)
    .filter(([id, j]) => j.elegible || referenciados.has(id))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, j]) => ({ id, equipoId: j.equipoId, nombrePila: `Nombre-${id}`, apellido1: `Apellido-${id}`, dorsal: DORSALES_DE_PRUEBA[id] ?? null, activo: j.elegible }))
  return { equipos: ['E1', 'E2'].map((id) => ({ id, nombre: NOMBRES_DE_PRUEBA[id] })), jugadores }
}

export function cuerpoDeServidor(banco, { deviceId = DEVICE, visualizacion = false } = {}) {
  const e = banco.adaptador.estado()
  return JSON.parse(JSON.stringify({
    version: 1,
    gameId: e.gameId,
    deviceId,
    servidorAhoraMs: banco.ahora,
    credencial: { expiraEn: null, retornoHasta: null },
    cursor: { rev: e.rev, ultimoClientSeq: banco.adaptador.ultimoClientSeq() },
    partido: { ligaId: LIGA, localId: 'E1', visitaId: 'E2' },
    estado: {
      config: { deporte: e.config.deporte, minutosPorPeriodo: e.config.minutosPorPeriodo ?? null, ...reglasDeConfig(e.config) },
      partido: {
        estado: e.partido.estado ?? null,
        inicio: e.partido.inicio ?? null,
        ...Object.fromEntries(['relojEstado', 'relojRestante', 'relojDesde'].map((k) => [k, e.partido[k] ?? null])),
      },
      auditSeq: e.auditSeq,
      corridaSeq: e.corridaSeq,
      cursorReloj: e.cursorReloj,
      eventos: e.eventos.map((ev) => Object.fromEntries(CAMPOS_EVENTO.filter((k) => k in ev).map((k) => [k, ev[k]]))),
    },
    atribucion: e.atribucion ? { version: e.atribucion.version, equipos: [...e.atribucion.equipos], jugadores: Object.fromEntries(Object.entries(e.atribucion.jugadores).map(([id, j]) => [id, { equipoId: j.equipoId, elegible: j.elegible }])) } : null,
    etiquetas: [{ id: 'J1', etiqueta: 'Ana' }],
    ...(visualizacion === true ? { visualizacion: visualizacionDeServidor(banco) } : visualizacion ? { visualizacion } : {}),
  }))
}

/** La fila de sesión que construiría el teléfono desde el cuerpo del servidor. */
export function sesionDe(banco, extra = {}) {
  const r = construirSesion({ ligaId: LIGA, partidoId: PARTIDO, cuerpoEstado: cuerpoDeServidor(banco), ...extra })
  if (!r.ok) throw new Error(`sesionDe: ${r.motivo}`)
  return r.sesion
}

let n = 0
/** Una base de IndexedDB falsa nueva (nombre único). */
export async function almacenNuevo(opciones = {}) {
  n += 1
  const a = await abrirAlmacen({ nombre: `prueba-sesion-${n}-${Math.random().toString(36).slice(2)}`, ...opciones })
  return a
}

/** Otro «teléfono-pestaña» sobre la MISMA base. */
export const reabrir = (almacen, opciones = {}) => abrirAlmacen({ nombre: almacen.db.name, ...opciones })

/** Envía al servidor sintético el texto exacto guardado y devuelve su recibo. */
export async function enviarAlServidor(banco, cuerpoJson, recibidoEn = banco.ahora) {
  const r = await banco.reenviar(JSON.parse(cuerpoJson), recibidoEn)
  if (!r.recibo) throw new Error(`sin recibo: ${r.tipo}`)
  return { tipo: r.tipo, recibo: JSON.parse(JSON.stringify(r.recibo)) }
}

export { validarCuerpoEstado }

/** Estimación confiable fija para las pruebas (ancla monótona de la «página» p1). */
export function estimacionConfiable(servidorMs = T0, mono = 1000) {
  const muestra = incorporarMuestra(crearRelojTelefono(), { servidorAhoraMs: servidorMs, rttMs: 100 }, { paredMs: servidorMs + 50, monoMs: mono, sesionId: 'p1' })
  const reloj = muestra.reloj
  return { reloj, estimar: (extraMs = 0) => estimar(reloj, { paredMs: servidorMs + 50 + extraMs, monoMs: mono + extraMs, sesionId: 'p1' }) }
}

// ---------------------------------------------------------------------------
// Un «teléfono» de prueba: la sesión durable sobre una base falsa + el servidor sintético. Sin red ni controlador real
// (eso es S1b): el sencillo `enviarSiguiente` hace lo que hará el emisor, en este orden: marcar → enviar el texto guardado →
// aplicar el recibo.
// ---------------------------------------------------------------------------
import { aplicarRecibo, crearSesion, encolar, leerSesion, marcarEnviando } from '../sesion-almacen'
import { evaluarInicio, ordenDeInicio } from '../sesion-motor'
import { preparacionDePrueba } from '../../motor/prueba/auxiliares-preparacion'
import { tiempoInformativo } from '../reloj-telefono'

let contadorCmd = 0
export const cmd = (p = 'c') => `${p}${++contadorCmd}`

export async function telefonoNuevo(banco, { almacen = null, gancho = null } = {}) {
  const a = almacen ?? await almacenNuevo({ gancho })
  const tel = {
    almacen: a,
    banco,
    revision: 0,
    ahora: banco.ahora,
    ctx: (extra = {}) => ({ ahoraEstimado: tel.ahora, actorId: 'yo', enLinea: true, ahora: tel.ahora, ...extra }),
    nota(r) { if (r?.vista) tel.revision = r.vista.revision; return r },
    async crear(extra) {
      const r = await crearSesion(a, sesionDe(banco, extra))
      return tel.nota(r)
    },
    async leer() {
      const r = await leerSesion(a, ID, tel.ctx())
      if (r.ok) tel.revision = r.sesion.revision
      return r
    },
    async encolar(orden, ctx = tel.ctx()) {
      return tel.nota(await encolar(a, { id: ID, revision: tel.revision, orden, ctx }))
    },
    /** Orden con tiempo informativo (puntos, faltas, periodo, corrección con el reloj detenido). */
    orden(tipo, datos = {}, cmdId = cmd(), extra = {}) {
      const est = { accionTsCrudo: tel.ahora, estimadoMs: tel.ahora, nivel: 'confiable', discontinuidad: null }
      return { cmdId, tipo, datos, tiempo: tiempoInformativo(est).tiempo, ...extra }
    },
    async iniciar() {
      const lect = await tel.leer()
      const prep = preparacionDePrueba(PARTIDO)
      const g = evaluarInicio({ enLinea: true, sesion: lect.sesion, entradas: lect.entradas, preparacion: prep })
      if (!g.puede) throw new Error(`iniciar: ${g.motivo}`)
      const o = ordenDeInicio({ cmdId: cmd('ini'), preparacion: prep, tiempo: tel.orden('x').tiempo, sesion: lect.sesion })
      return tel.encolar(o.orden)
    },
    /** Marca, envía el texto exacto guardado al servidor sintético y aplica el recibo. */
    async enviarSiguiente({ recibidoEn = tel.banco.ahora } = {}) {
      const lect = await tel.leer()
      const primera = lect.entradas.find((e) => e.estado === 'pendiente' || e.estado === 'enviando')
      if (!primera) return { nada: true }
      const m = tel.nota(await marcarEnviando(a, { id: ID, revision: tel.revision, cmdId: primera.cmdId, ctx: tel.ctx() }))
      if (!m.ok) return { marcar: m }
      const s = await enviarAlServidor(tel.banco, m.cuerpoJson, recibidoEn)
      const ap = tel.nota(await aplicarRecibo(a, { id: ID, revision: tel.revision, recibo: s.recibo, ctx: tel.ctx() }))
      return { marcar: m, servidor: s, aplicado: ap, cuerpoJson: m.cuerpoJson }
    },
    async enviarTodo(opciones) {
      const salidas = []
      for (let i = 0; i < 200; i += 1) {
        const r = await tel.enviarSiguiente(opciones)
        if (r.nada) break
        salidas.push(r)
        if (!r.aplicado?.ok) break
        const lect = await tel.leer()
        if (lect.sesion.detenida) break
      }
      return salidas
    },
  }
  return tel
}
