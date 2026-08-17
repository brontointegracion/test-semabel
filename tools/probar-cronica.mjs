import { cronicaDePartido, resumenDeJornada } from '../src/lib/cronica.js'

const local = { id: 'a', nombre: 'Halcones' }
const visita = { id: 'b', nombre: 'Titanes del Norte' }
const jugadores = [
  { id: 'j1', equipoId: 'a', nombre: 'Luis Carrasco', dorsal: 7 },
  { id: 'j2', equipoId: 'a', nombre: 'Kevin Ortega', dorsal: 9 },
  { id: 'j3', equipoId: 'b', nombre: 'Ariel Domínguez', dorsal: 4 },
]
const ev = (equipoId, jugadorId, puntos, tipo = 'punto') =>
  ({ equipoId, jugadorId, puntos, tipo, anulado: false })

const eventos = [
  ...Array(11).fill(0).map(() => ev('a', 'j1', 2)),   // 22
  ...Array(6).fill(0).map(() => ev('a', 'j2', 2)),    // 12
  ...Array(15).fill(0).map(() => ev('b', 'j3', 2)),   // 30
  ...Array(20).fill(0).map(() => ev('a', 'j1', 0, 'falta')),
]
const partido = { id: 'p9', estado: 'final', localId: 'a', visitaId: 'b', inicio: '2026-08-15T19:00:00.000Z' }

// Dos victorias previas de Halcones, para que detecte la racha
const previos = [
  { id: 'p7', estado: 'final', localId: 'a', visitaId: 'b', inicio: '2026-08-01T19:00:00.000Z' },
  { id: 'p8', estado: 'final', localId: 'a', visitaId: 'b', inicio: '2026-08-08T19:00:00.000Z' },
]
const eventosPorPartido = {
  p7: [ev('a', 'j1', 40), ev('b', 'j3', 10)],
  p8: [ev('a', 'j1', 30), ev('b', 'j3', 20)],
  p9: eventos,
}

const c = cronicaDePartido({
  partido, liga: { nombre: 'Liga Barrial San Miguelito' },
  cancha: { nombre: 'Cancha Don Bosco' },
  local, visita, jugadores, eventos,
  partidosLiga: [...previos, partido], eventosPorPartido,
})

console.log('TITULAR :', c.titular)
console.log('ENTRADA :', c.entrada)
c.cuerpo.forEach((f) => console.log('        -', f))

console.log()
const r = resumenDeJornada({
  partidos: [...previos, partido],
  eventosPorPartido,
  liga: { nombre: 'Liga Barrial San Miguelito' },
})
console.log('TITULAR :', r.titular)
r.cuerpo.forEach((f) => console.log('        -', f))
