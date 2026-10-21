import { describe, expect, it } from 'vitest'
import { elegirVistaTv, indiceVigilado, interpretarSecuencia, MAX_PARTIDOS_SECUENCIA } from './tv-secuencia.js'

// REPORT_199: la configuración explícita de la transmisión y la elección PURA del partido que se muestra. Todo sintético.

const LIGAS = ['SIMULACRO-PILOTO', 'OTRA-LIGA']

describe('interpretarSecuencia', () => {
  it('ausente o vacía = sin configurar (no hay ningún partido por omisión)', () => {
    for (const v of [undefined, null, '']) expect(interpretarSecuencia(v, LIGAS)).toEqual({ ok: false, error: 'sin-configurar' })
  })
  it('lee los pares liga/partido EN ORDEN', () => {
    expect(interpretarSecuencia('SIMULACRO-PILOTO/A1,SIMULACRO-PILOTO/B2', LIGAS)).toEqual({
      ok: true, pares: [{ ligaId: 'SIMULACRO-PILOTO', gameId: 'A1' }, { ligaId: 'SIMULACRO-PILOTO', gameId: 'B2' }],
    })
  })
  it.each([
    ['un par sin liga', 'A1'],
    ['un par con tres partes', 'SIMULACRO-PILOTO/A1/X'],
    ['un id con caracteres no permitidos', 'SIMULACRO-PILOTO/A 1'],
    ['una coma de más', 'SIMULACRO-PILOTO/A1,'],
    ['un par duplicado', 'SIMULACRO-PILOTO/A1,SIMULACRO-PILOTO/A1'],
    ['una liga que la compilación no lista', 'LIGA-AJENA/A1'],
    ['un valor que no es texto', 42],
  ])('%s → configuración no válida, ENTERA (no se usa «lo que sea válido»)', (_, crudo) => {
    expect(interpretarSecuencia(crudo, LIGAS)).toEqual({ ok: false, error: 'configuracion-invalida' })
  })
  it('un buen par junto a uno malo descarta todo', () => {
    expect(interpretarSecuencia('SIMULACRO-PILOTO/A1,LIGA-AJENA/B2', LIGAS).ok).toBe(false)
  })
  it('admite pares de distintas ligas listadas y rechaza demasiados pares', () => {
    expect(interpretarSecuencia('SIMULACRO-PILOTO/A1,OTRA-LIGA/A1', LIGAS).ok).toBe(true)
    const muchos = Array.from({ length: MAX_PARTIDOS_SECUENCIA + 1 }, (_, i) => `SIMULACRO-PILOTO/G${i}`).join(',')
    expect(interpretarSecuencia(muchos, LIGAS).ok).toBe(false)
  })
})

const PARES = [{ ligaId: 'L', gameId: 'A' }, { ligaId: 'L', gameId: 'B' }]
const con = (estado) => ({ fase: 'listo', datos: { estado }, error: null })
const sin = (fase = 'cargando') => ({ fase, datos: null, error: fase === 'error' ? { tipo: 'red' } : null })
const elegir = (...estados) => elegirVistaTv(PARES.slice(0, estados.length), estados)

describe('elegirVistaTv: la secuencia programado → vivo → final → siguiente → final', () => {
  it('antes del primero: se muestra el primero (por jugar)', () => {
    expect(elegir(con('programado'), con('programado'))).toEqual({ tipo: 'partido', indice: 0, proximo: null, completa: false, incompleto: false })
  })
  it('el primero en vivo (juego, pausa o descanso: lo decide la vista, no la elección)', () => {
    expect(elegir(con('vivo'), con('programado'))).toMatchObject({ tipo: 'partido', indice: 0, proximo: null })
  })
  it('el primero final y el segundo sin empezar: el resultado final con el segundo como próximo', () => {
    expect(elegir(con('final'), con('programado'))).toEqual({ tipo: 'partido', indice: 0, proximo: 1, completa: false, incompleto: false })
  })
  it('el segundo en vivo: se cambia solo al segundo', () => {
    expect(elegir(con('final'), con('vivo'))).toMatchObject({ tipo: 'partido', indice: 1, proximo: null })
  })
  it('el último final: se conserva su resultado y la sesión está completa (sin próximo inventado)', () => {
    expect(elegir(con('final'), con('final'))).toEqual({ tipo: 'partido', indice: 1, proximo: null, completa: true, incompleto: false })
  })
  it('un único partido en la secuencia: por jugar, en vivo y completa', () => {
    expect(elegir(con('programado'))).toMatchObject({ indice: 0, completa: false })
    expect(elegir(con('final'))).toMatchObject({ indice: 0, completa: true })
  })
  it('sin importar el orden de las lecturas, el vivo gana a los demás; un final posterior no adelanta a un pendiente anterior', () => {
    expect(elegir(con('programado'), con('vivo'))).toMatchObject({ indice: 1 })
    expect(elegir(con('programado'), con('final'))).toMatchObject({ indice: 0, proximo: null, completa: false })
  })
})

describe('elegirVistaTv: ambigüedad y fallos', () => {
  it('dos partidos en vivo: conflicto explícito, no se elige ninguno', () => {
    expect(elegir(con('vivo'), con('vivo'))).toEqual({ tipo: 'conflicto', indices: [0, 1] })
  })
  it('un partido que el servidor no encuentra NO es una agenda vacía: es «falta», aunque el otro esté en vivo', () => {
    expect(elegir(con('vivo'), sin('no-encontrado'))).toEqual({ tipo: 'falta', indices: [1] })
  })
  it('todavía nada leído → cargando; todo fallido → sin conexión', () => {
    expect(elegir(sin(), sin())).toEqual({ tipo: 'cargando' })
    expect(elegir(sin('error'), sin('error'))).toEqual({ tipo: 'sin-conexion' })
  })
  it('una lectura que falla NO avanza: con el primero en vivo y el segundo ilegible, sigue el primero (incompleto)', () => {
    expect(elegir(con('vivo'), sin('error'))).toEqual({ tipo: 'partido', indice: 0, proximo: null, completa: false, incompleto: true })
  })
  it('con el primero final y el segundo ilegible: el final, con un próximo desconocido (sin inventarlo) y sin dar la sesión por completa', () => {
    expect(elegir(con('final'), sin('error'))).toEqual({ tipo: 'partido', indice: 0, proximo: 1, completa: false, incompleto: true })
  })
  it('si falta justo la lectura del primero y el segundo está por jugar, no se puede decidir', () => {
    expect(elegir(sin('error'), con('programado'))).toEqual({ tipo: 'sin-conexion' })
  })
  it('un segundo partido en vivo gana aunque el primero aún no se haya leído', () => {
    expect(elegir(sin('error'), con('vivo'))).toMatchObject({ tipo: 'partido', indice: 1, incompleto: true })
  })
})

describe('indiceVigilado: el único partido que se lee rápido', () => {
  const e = (estado) => ({ datos: estado ? { estado } : null })
  it('el primero aún programado: el primero antes de empezar; el siguiente durante el juego o tras el final', () => {
    expect(indiceVigilado([e('programado'), e('programado'), e('programado')])).toBe(0)
    expect(indiceVigilado([e('vivo'), e('programado'), e('programado')])).toBe(1)
    expect(indiceVigilado([e('final'), e('programado'), e('programado')])).toBe(1)
    expect(indiceVigilado([e('final'), e('vivo'), e('programado')])).toBe(2)
  })
  it('ninguno con la secuencia terminada, con dos en vivo y nada programado, o sin datos', () => {
    expect(indiceVigilado([e('final'), e('final')])).toBeNull()
    expect(indiceVigilado([e('vivo'), e('vivo')])).toBeNull()
    expect(indiceVigilado([e(null), e(null)])).toBeNull()
  })
})
