import { ejecutar } from '../../src/lib/motor/orquestador.js'
import { crearAdaptadorLiga } from '../src/adaptador-liga.js'
import { clasificarFallo } from '../src/clasificacion.js'
import { aRespuesta } from '../src/respuestas.js'
import { resumirPartido } from '../src/resumen-publico.js'
import { dentro } from './ayuda.js'

// Ayudas de las pruebas del resumen público. Todo sintético.

/** Almacenamiento que delega en el real y REGISTRA cada sentencia con sus cursores (filas leídas y escritas). */
export function almacenMedido(almacen) {
  const registro = []
  return {
    almacen: {
      sql: { exec: (consulta, ...args) => { const c = almacen.sql.exec(consulta, ...args); registro.push({ consulta, c }); return c } },
      transactionSync: (fn) => almacen.transactionSync(fn),
    },
    /** Se llama DESPUÉS de consumir todo: [{ consulta, rowsRead, rowsWritten }]. */
    sentencias: () => registro.map(({ consulta, c }) => ({ consulta: consulta.replace(/\s+/g, ' ').trim(), rowsRead: c.rowsRead ?? 0, rowsWritten: c.rowsWritten ?? 0 })),
  }
}

export const sumar = (sentencias) => sentencias.reduce(
  (t, s) => ({ consultas: t.consultas + 1, rowsRead: t.rowsRead + s.rowsRead, rowsWritten: t.rowsWritten + s.rowsWritten }),
  { consultas: 0, rowsRead: 0, rowsWritten: 0 },
)
export const tocaResumen = (s) => s.consulta.includes('resumen_partido')
export const escribeResumen = (s) => /^(INSERT|UPDATE|DELETE)\b/i.test(s.consulta) && tocaResumen(s)

/** Ejecuta un sobre con un adaptador sobre el MISMO almacenamiento pero medido. → { resp:{status,cuerpo}, sentencias } */
export const ejecutarMedido = (ligaId, sobre, token, recibidoEn) => dentro(ligaId, async (inst) => {
  const medido = almacenMedido(inst.almacen)
  const adaptador = crearAdaptadorLiga({ storage: medido.almacen })
  const ejecucion = adaptador.paraEjecucion()
  let resp
  try {
    resp = aRespuesta(await ejecutar(ejecucion, sobre, { recibidoEn, credencial: token }))
  } catch (error) {
    resp = clasificarFallo(error, ejecucion.traza)
  }
  return { resp, sentencias: medido.sentencias() }
})

/** Ejecuta un método del objeto (que usa this.almacen) con el almacenamiento medido. */
export const llamarMedido = (ligaId, metodo, ...args) => dentro(ligaId, async (inst) => {
  const real = inst.almacen
  const medido = almacenMedido(real)
  inst.almacen = medido.almacen
  let r
  try { r = await inst[metodo](...args) } finally { inst.almacen = real }
  return { r, sentencias: medido.sentencias() }
})

/** El resumen esperado de un partido, recalculado desde los eventos COMPLETOS guardados (fuente autoritativa). */
export const esperadoDeEventos = (ligaId, gameId) => dentro(ligaId, (inst) => {
  const sql = inst.almacen.sql
  const p = sql.exec('SELECT local_id, visita_id, estado_json, rev FROM partidos WHERE id = ?', gameId).one()
  const eventos = sql.exec('SELECT json FROM eventos WHERE partido_id = ? ORDER BY seq', gameId).toArray().map((r) => JSON.parse(r.json))
  return { rev: p.rev, ...resumirPartido({ eventos, localId: p.local_id, visitaId: p.visita_id, deporte: JSON.parse(p.estado_json).config.deporte }) }
})

/** La fila guardada del resumen, en la misma forma que `esperadoDeEventos`. */
export const resumenGuardado = (ligaId, gameId) => dentro(ligaId, (inst) => {
  const f = inst.almacen.sql.exec('SELECT * FROM resumen_partido WHERE partido_id = ?', gameId).toArray()[0]
  return f ? {
    rev: f.rev_fuente, localId: f.local_id, visitaId: f.visita_id, localPuntos: f.local_puntos, visitaPuntos: f.visita_puntos,
    localFaltas: f.local_faltas, visitaFaltas: f.visita_faltas, localFaltasPeriodo: f.local_faltas_periodo, visitaFaltasPeriodo: f.visita_faltas_periodo, periodo: f.periodo, version: f.version_proyeccion,
  } : null
})

export const filaResumenCruda = (ligaId, gameId) => dentro(ligaId, (inst) =>
  JSON.stringify(inst.almacen.sql.exec('SELECT * FROM resumen_partido WHERE partido_id = ?', gameId).toArray()))

/**
 * HELPER DE PRUEBA, ESCRITURA DIRECTA: reconstruye TODOS los resúmenes desde los eventos con la función de producción.
 * Hay que llamarlo después de insertar eventos directamente en SQL (eso no pasa por el motor y no actualiza el resumen).
 */
export const reconstruirResumenesDePrueba = (ligaId, limites) => dentro(ligaId, async (inst) => {
  const { repararResumenes } = await import('../src/resumen-publico.js')
  return repararResumenes(inst.almacen, { todos: true, ...(limites ? { limites } : {}) })
})
