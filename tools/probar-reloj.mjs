import { restanteMs, mmss, duracionMs, corriendo } from '../src/lib/reloj-calculo.js'

let fallos = 0
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FALLA '}${msg}`); if (!ok) fallos++ }

const basket = { deporte: 'baloncesto', minutosPorPeriodo: 10 }
const futsal = { deporte: 'futsal', minutosPorPeriodo: 20 }
const t0 = 1_000_000_000_000

console.log('duración')
check(duracionMs(basket) === 600000, 'baloncesto: 10 min por cuarto')
check(duracionMs(futsal) === 1200000, 'futsal: 20 min por tiempo')
check(duracionMs({ deporte: 'baloncesto' }) === 600000, 'sin config, cae al valor del deporte')

console.log('\nformato')
check(mmss(210000) === '03:30', '3:30 se ve como 03:30')
check(mmss(0) === '00:00', 'cero se ve como 00:00')
check(mmss(59400) === '01:00', '59.4s redondea arriba, no muestra 00:59')
check(mmss(600000) === '10:00', 'período completo')

console.log('\ndetenido')
const parado = { relojEstado: 'detenido', relojRestante: 210000, relojDesde: null }
check(restanteMs(parado, basket, t0) === 210000, 'no corre')
check(restanteMs(parado, basket, t0 + 60000) === 210000, 'sigue igual un minuto después')
check(!corriendo(parado), 'no figura como corriendo')

console.log('\ncorriendo')
const andando = { relojEstado: 'corriendo', relojRestante: 210000, relojDesde: t0 }
check(restanteMs(andando, basket, t0) === 210000, 'al arrancar quedan 3:30')
check(mmss(restanteMs(andando, basket, t0 + 10000)) === '03:20', 'diez segundos después: 03:20')
check(mmss(restanteMs(andando, basket, t0 + 20000)) === '03:10', 'veinte segundos después: 03:10')
check(restanteMs(andando, basket, t0 + 210000) === 0, 'a los 3:30 llega a cero')
check(restanteMs(andando, basket, t0 + 999999) === 0, 'no se pasa a negativo')

console.log('\nsin reloj guardado')
check(restanteMs({}, basket, t0) === 600000, 'empieza con el período entero')

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo correcto')
process.exit(fallos ? 1 : 0)
