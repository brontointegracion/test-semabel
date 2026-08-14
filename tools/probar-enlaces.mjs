import { slug, codigoDe, urlLiga, urlPartido, urlJugador, urlTele } from '../src/lib/enlaces.js'

let fallos = 0
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FALLA '}${msg}`); if (!ok) fallos++ }
const eq = (a, b, msg) => check(a === b, `${msg}  →  ${a}`)

console.log('nombres a texto de dirección')
eq(slug('Águilas de Betania'), 'aguilas-de-betania', 'quita acentos')
eq(slug('Marañón'), 'maranon', 'la ñ pasa a n')
eq(slug('Guerreros 24 de Diciembre'), 'guerreros-24-de-diciembre', 'conserva números')
eq(slug('  ¡Liga!  del   Barrio  '), 'liga-del-barrio', 'sin signos ni espacios de más')

console.log('\ndirecciones')
const liga = { nombre: 'Liga Barrial San Miguelito', codigo: '4821' }
const local = { nombre: 'Halcones' }
const visita = { nombre: 'Titanes del Norte' }
const partido = { codigo: '7531' }
const jugador = { nombre: 'Luis Carrasco', codigo: '3092' }

eq(urlLiga(liga), '/l/liga-barrial-san-miguelito-4821', 'liga')
eq(urlPartido(partido, local, visita), '/p/halcones-vs-titanes-del-norte-7531', 'partido')
eq(urlJugador(jugador), '/j/luis-carrasco-3092', 'jugador')
eq(urlTele(partido), '/b/7531', 'código para el televisor')

console.log('\nel código es lo que identifica')
eq(codigoDe('halcones-vs-titanes-del-norte-7531'), '7531', 'lo saca del final')
eq(codigoDe('liga-barrial-san-miguelito-4821'), '4821', 'de una liga')
eq(codigoDe('7531'), '7531', 'un código pelado también vale')
eq(codigoDe('guerreros-24-de-diciembre-vs-halcones-1234'), '1234',
   'el número del nombre no confunde')
check(
  codigoDe('cualquier-cosa-inventada-7531') === codigoDe(urlPartido(partido, local, visita).split('/').pop()),
  'si el nombre cambia, el código sigue encontrando el partido',
)

console.log('\nlo que se comparte se puede leer')
const url = urlPartido(partido, local, visita)
check(!/[A-Z]/.test(url), 'todo en minúsculas')
check(!/[^a-z0-9/-]/.test(url), 'sin acentos ni signos raros')

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo correcto')
process.exit(fallos ? 1 : 0)
