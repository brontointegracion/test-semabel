import { camposDeReloj } from '../estado'
import { crearBanco, estadoDePrueba, T0 } from './banco'

// ---------------------------------------------------------------------------
// Contrato de comportamiento compartido: escenarios como datos.
//
// Un escenario es un guion de pasos con el resultado esperado de cada uno. Lo
// ejecutan (1) el motor y (2) las funciones actuales sobre Dexie (paridad), y
// más adelante cualquier adaptador real. No se copian las pruebas existentes:
// se comparan comportamientos observables.
//
//   paso = { op, t?, datos?, esperado, guardar?, usar? }
//   op: iniciar | arrancar | detener | auto | siguiente | cerrar |
//       anotar | falta | deshacer | rehacer | anular
//   guardar: 'x'  → guarda lo que la pantalla veía antes de este paso
//   usar: 'x'     → este paso actúa con lo que la pantalla guardó como 'x'
// ---------------------------------------------------------------------------

const D = { equipoId: 'E1', jugadorId: 'J1' }

export const ESCENARIOS = [
  {
    nombre: 'flujo básico: iniciar, correr, dos toques iguales, falta, detener, deshacer, rehacer y cerrar',
    inicial: { estado: 'programado', restante: null },
    pasos: [
      { op: 'iniciar', esperado: 'ok' },
      { op: 'arrancar', esperado: 'ok' },
      { op: 'anotar', datos: { ...D, puntos: 2 }, esperado: 'ok' },
      { op: 'anotar', datos: { ...D, puntos: 2 }, esperado: 'ok' },
      { op: 'falta', datos: D, esperado: 'ok' },
      { op: 'detener', esperado: 'ok' },
      { op: 'deshacer', esperado: 'ok' },
      { op: 'deshacer', esperado: 'ok' },
      { op: 'rehacer', esperado: 'ok' },
      { op: 'cerrar', esperado: 'ok' },
    ],
  },
  {
    nombre: 'periodos: la transición es frontera para Deshacer; Rehacer conserva su periodo',
    inicial: {},
    pasos: [
      { op: 'anotar', datos: { ...D, puntos: 3 }, esperado: 'ok' },
      { op: 'siguiente', esperado: 'ok' },
      { op: 'anotar', datos: { ...D, puntos: 1 }, esperado: 'ok' },
      { op: 'deshacer', esperado: 'ok' },
      { op: 'deshacer', esperado: 'limite-periodo' },
      { op: 'rehacer', esperado: 'ok' },
      { op: 'siguiente', esperado: 'ok' },
      { op: 'siguiente', esperado: 'ok' },
      { op: 'siguiente', esperado: 'ultimo-periodo' },
    ],
  },
  {
    nombre: 'pantallas viejas: periodo y reloj desactualizados no escriben',
    inicial: {},
    pasos: [
      { op: 'anotar', datos: { ...D, puntos: 2 }, esperado: 'ok', guardar: 'p1' },
      { op: 'siguiente', esperado: 'ok' },
      { op: 'anotar', datos: { ...D, puntos: 2 }, esperado: 'periodo-desactualizado', usar: 'p1' },
      { op: 'siguiente', esperado: 'periodo-desactualizado', usar: 'p1' },
      { op: 'arrancar', esperado: 'ok', guardar: 'r1' },
      { op: 'detener', esperado: 'ok' },
      { op: 'arrancar', esperado: 'ok' },
      { op: 'detener', esperado: 'reloj-desactualizado', usar: 'r1' },
      { op: 'cerrar', esperado: 'reloj-desactualizado', usar: 'r1' },
    ],
  },
  {
    nombre: 'rehacer: orden de anulación, bloqueo al anotar y evento de periodo anterior',
    inicial: {},
    pasos: [
      { op: 'anotar', datos: { ...D, puntos: 1 }, esperado: 'ok' },
      { op: 'anotar', datos: { ...D, puntos: 2 }, esperado: 'ok' },
      { op: 'anotar', datos: { ...D, puntos: 3 }, esperado: 'ok' },
      { op: 'deshacer', esperado: 'ok' },
      { op: 'deshacer', esperado: 'ok' },
      { op: 'rehacer', esperado: 'ok' },
      { op: 'anotar', datos: { ...D, puntos: 1 }, esperado: 'ok' },
      { op: 'rehacer', esperado: 'nada' },
    ],
  },
  {
    nombre: 'anular un evento de un periodo anterior y rehacerlo; anular una transición se rechaza',
    inicial: {},
    pasos: [
      { op: 'anotar', datos: { ...D, puntos: 2 }, esperado: 'ok' },
      { op: 'siguiente', esperado: 'ok' },
      { op: 'anular', datos: { seq: 1 }, esperado: 'ok' },
      { op: 'anular', datos: { seq: 1 }, esperado: 'nada' },
      { op: 'anular', datos: { seq: 2 }, esperado: 'limite-periodo' },
      { op: 'rehacer', esperado: 'ok' },
    ],
  },
  {
    nombre: 'parada automática: solo sin tiempo; luego no hay tiempo para volver a arrancar',
    inicial: { restante: 5000 },
    pasos: [
      { op: 'detener', esperado: 'no-corre' },
      { op: 'arrancar', esperado: 'ok', t: T0 },
      { op: 'arrancar', esperado: 'ya-corriendo', t: T0 + 100 },
      { op: 'auto', esperado: 'aun-hay-tiempo', t: T0 + 1000 },
      { op: 'auto', esperado: 'ok', t: T0 + 5000 },
      { op: 'arrancar', esperado: 'sin-tiempo', t: T0 + 5100 },
    ],
  },
  {
    nombre: 'tras el cierre: Deshacer, Rehacer y Anular siguen; puntos y reloj no',
    inicial: {},
    pasos: [
      { op: 'anotar', datos: { ...D, puntos: 2 }, esperado: 'ok' },
      { op: 'cerrar', esperado: 'ok' },
      { op: 'anotar', datos: { ...D, puntos: 2 }, esperado: 'partido-no-disponible' },
      { op: 'deshacer', esperado: 'ok' },
      { op: 'rehacer', esperado: 'ok' },
      { op: 'anular', datos: { seq: 1 }, esperado: 'ok' },
      { op: 'arrancar', esperado: 'partido-no-disponible' },
      { op: 'cerrar', esperado: 'partido-no-disponible' },
      { op: 'siguiente', esperado: 'partido-no-disponible' },
    ],
  },
  {
    nombre: 'cerrar con el reloj corriendo guarda el tiempo efectivo',
    inicial: {},
    pasos: [
      { op: 'arrancar', esperado: 'ok', t: T0 },
      { op: 'siguiente', esperado: 'ok', t: T0 + 2000 },
      { op: 'arrancar', esperado: 'ok', t: T0 + 3000 },
      { op: 'cerrar', esperado: 'ok', t: T0 + 33_000 },
    ],
  },
  {
    nombre: 'antes de iniciar no se anota ni se corre',
    inicial: { estado: 'programado', restante: null },
    pasos: [
      { op: 'anotar', datos: { ...D, puntos: 2 }, esperado: 'partido-no-disponible' },
      { op: 'arrancar', esperado: 'partido-no-disponible' },
      { op: 'iniciar', esperado: 'ok' },
      { op: 'iniciar', esperado: 'partido-no-disponible' },
    ],
  },
]

// --- Proyección común ------------------------------------------------------

const o = (v) => (v === undefined ? null : v)

export function proyectar({ partido, eventos, auditoria }) {
  return {
    partido: {
      estado: o(partido.estado),
      inicio: o(partido.inicio),
      ...camposDeReloj(o(partido.relojEstado), o(partido.relojRestante), o(partido.relojDesde)),
    },
    eventos: [...eventos].sort((a, b) => a.seq - b.seq).map((e) => ({
      seq: e.seq,
      tipo: e.tipo,
      equipoId: o(e.equipoId),
      jugadorId: o(e.jugadorId),
      puntos: o(e.puntos),
      periodo: e.periodo,
      anulado: !!e.anulado,
      anuladoEn: o(e.anuladoEn),
      rehacerBloqueado: !!e.rehacerBloqueado,
      creadoEn: e.creadoEn,
    })),
    auditoria: [...auditoria].sort((a, b) => a.seq - b.seq).map((f) => ({
      seq: f.seq,
      comando: f.comando,
      periodo: f.periodo,
      periodoDespues: o(f.periodoDespues),
      antes: f.antes,
      despues: f.despues,
      ts: f.ts,
      origen: f.origen,
      actorId: o(f.actorId),
      ceroEnDerivado: o(f.ceroEnDerivado),
    })),
  }
}

/** Tiempo de cada paso: el indicado, o 1 s después del anterior. */
export function tiemposDe(escenario) {
  let t = T0
  return escenario.pasos.map((p) => { t = p.t ?? t + 1000; return t })
}

// --- Ejecución en el motor -------------------------------------------------

const TIPO_MOTOR = {
  iniciar: 'iniciar-partido', arrancar: 'arrancar-reloj', detener: 'detener-reloj', siguiente: 'siguiente-periodo',
  cerrar: 'cerrar-partido', anotar: 'anotar', falta: 'falta', deshacer: 'deshacer', rehacer: 'rehacer',
}

export async function correrEnMotor(escenario) {
  const i = escenario.inicial ?? {}
  const banco = crearBanco({
    estadoInicial: estadoDePrueba({
      estado: i.estado ?? 'vivo',
      reloj: camposDeReloj('detenido', i.restante === undefined ? 600000 : i.restante, null),
    }),
  })
  const vistas = {}
  const tiempos = tiemposDe(escenario)
  const resultados = []

  for (const [n, p] of escenario.pasos.entries()) {
    const t = tiempos[n]
    if (p.guardar) vistas[p.guardar] = banco.adaptador.estado()
    const opts = { t, ...(p.usar ? { estado: vistas[p.usar] } : {}) }

    if (p.op === 'auto') {
      const r = await banco.paradaAutomatica(t)
      if (r) resultados.push(r.resultado.tipo === 'aceptado' ? 'ok' : r.resultado.recibo.motivo)
      else {
        const e = banco.adaptador.estado()
        resultados.push(e.partido.relojEstado === 'corriendo' ? 'aun-hay-tiempo' : 'no-corre')
      }
      continue
    }
    let datos = p.datos ?? {}
    let tipo = TIPO_MOTOR[p.op]
    if (p.op === 'anular') {
      tipo = 'anular-evento'
      datos = { eventoId: banco.adaptador.estado().eventos.find((e) => e.seq === p.datos.seq).id }
    }
    const r = await banco.enviar(tipo, datos, opts)
    if (r.tipo === 'aceptado') resultados.push('ok')
    else if (r.tipo === 'rechazado') resultados.push(r.recibo.motivo)
    else resultados.push(`@${r.tipo}`)
  }
  const e = banco.adaptador.estado()
  return {
    resultados,
    proyeccion: proyectar({ partido: e.partido, eventos: e.eventos, auditoria: banco.adaptador.auditoria() }),
  }
}
