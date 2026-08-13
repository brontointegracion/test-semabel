import { generarCalendario, rondasRoundRobin } from '../src/lib/calendario.js'

let fallos = 0
const check = (ok, msg) => { console.log(`${ok ? '  ok ' : '  FALLA '} ${msg}`); if (!ok) fallos++ }

for (const n of [4, 5, 6, 8, 12]) {
  const ids = Array.from({ length: n }, (_, i) => `e${i}`)
  const rondas = rondasRoundRobin(ids)
  const pares = rondas.flat()
  const esperados = (n * (n - 1)) / 2

  console.log(`\n${n} equipos`)
  check(pares.length === esperados, `${pares.length} enfrentamientos (esperado ${esperados})`)

  const vistos = new Set(pares.map(([a, b]) => [a, b].sort().join('|')))
  check(vistos.size === esperados, 'todos contra todos, sin repetir pareja')

  for (const ronda of rondas) {
    const equipos = ronda.flat()
    if (new Set(equipos).size !== equipos.length) {
      check(false, 'un equipo aparece dos veces en la misma ronda')
      break
    }
  }

  const desde = new Date('2026-08-03T00:00:00')
  const hasta = new Date('2026-10-30T23:59:59')
  const { partidos, sinEspacio } = generarCalendario({
    equipoIds: ids,
    desde,
    hasta,
    diasSemana: [3, 5],
    canchaIds: ['c1', 'c2'],
    franjas: ['19:00', '20:30'],
  })

  check(!sinEspacio, 'alcanzaron las fechas')
  check(partidos.length === esperados, `${partidos.length} partidos colocados`)

  const franjas = partidos.map((p) => `${p.canchaId}|${p.inicio}`)
  check(new Set(franjas).size === franjas.length, 'ninguna franja de cancha se usó dos veces')

  const porDia = {}
  let choque = null
  for (const p of partidos) {
    const dia = p.inicio.slice(0, 10)
    porDia[dia] ||= new Set()
    for (const eq of [p.localId, p.visitaId]) {
      if (porDia[dia].has(eq)) choque = `${eq} juega dos veces el ${dia}`
      porDia[dia].add(eq)
    }
  }
  check(!choque, choque || 'ningún equipo juega dos veces el mismo día')

  const fuera = partidos.filter((p) => ![3, 5].includes(new Date(p.inicio).getDay()))
  check(fuera.length === 0, 'todos los partidos caen en los días elegidos')

  const ordenado = partidos.every((p, i) => i === 0 || partidos[i - 1].inicio <= p.inicio)
  check(ordenado, 'el calendario sale ordenado en el tiempo')
}

// Franjas ya ocupadas por otra liga en la misma cancha
const ocupadas = [{ canchaId: 'c1', inicio: new Date('2026-08-05T19:00:00').toISOString() }]
const r = generarCalendario({
  equipoIds: ['a', 'b', 'c', 'd'],
  desde: new Date('2026-08-03T00:00:00'),
  hasta: new Date('2026-09-30T23:59:59'),
  diasSemana: [3],
  canchaIds: ['c1'],
  franjas: ['19:00'],
  ocupadas,
})
console.log('\nfranja ya vendida a otra liga')
check(
  !r.partidos.some((p) => p.canchaId === 'c1' && p.inicio === ocupadas[0].inicio),
  'no reutiliza una franja ya ocupada',
)

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo correcto')
process.exit(fallos ? 1 : 0)
