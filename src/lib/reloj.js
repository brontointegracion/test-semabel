import { db, uid } from '../db'
import { restanteMs, duracionMs, corriendo } from './reloj-calculo'

// Acciones del reloj: lo que lo mueve y lo guarda.
// La cuenta en sí vive en reloj-calculo.js, sin base de datos, para poder probarla.
export * from './reloj-calculo'

export async function arrancarReloj(partido, liga) {
  await db.partidos.update(partido.id, {
    relojEstado: 'corriendo',
    relojRestante: restanteMs(partido, liga),
    relojDesde: Date.now(),
  })
}

export async function detenerReloj(partido, liga) {
  await db.partidos.update(partido.id, {
    relojEstado: 'detenido',
    relojRestante: restanteMs(partido, liga),
    relojDesde: null,
  })
}

/** Cierra el período en curso y deja el reloj listo para el siguiente. */
export async function siguientePeriodo(partido, liga, periodo) {
  const previos = await db.eventos.where('partidoId').equals(partido.id).toArray()
  const seq = previos.reduce((m, e) => Math.max(m, e.seq), 0) + 1

  await db.eventos.add({
    id: uid(),
    partidoId: partido.id,
    seq,
    tipo: 'periodo',
    periodo,
    anulado: false,
    creadoEn: Date.now(),
  })

  await db.partidos.update(partido.id, {
    relojEstado: 'detenido',
    relojRestante: duracionMs(liga),
    relojDesde: null,
  })
}

/** Ajuste manual, para cuando el reloj de la cancha y el de la app no coinciden. */
export async function ajustarReloj(partido, liga, deltaSegundos) {
  const actual = restanteMs(partido, liga)
  const nuevo = Math.max(0, Math.min(duracionMs(liga), actual + deltaSegundos * 1000))
  await db.partidos.update(partido.id, {
    relojRestante: nuevo,
    relojDesde: corriendo(partido) ? Date.now() : null,
  })
}
