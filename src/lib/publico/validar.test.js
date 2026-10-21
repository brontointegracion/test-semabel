import { describe, expect, it } from 'vitest'
import { partidoLiga, reloj, respuestaJuego, respuestaLiga } from './datos-prueba.js'
import { validarJuego, validarJugadores, validarLiga } from './validar.js'

describe('validación de la lectura de la liga', () => {
  it('acepta una respuesta válida y devuelve una COPIA con solo los campos conocidos', () => {
    const entrada = respuestaLiga({ partidos: [partidoLiga({ estado: 'vivo', inicioReal: '2026-11-01T21:31:00.000Z', reloj: reloj('corriendo', 500000, 1) })] })
    entrada.secreto = 'no debe pasar'
    entrada.partidos[0].tokenHash = 'no debe pasar'
    entrada.equipos[0].persona = 'no debe pasar'
    const v = validarLiga(entrada, 'LIGAPUB1')
    expect(v).not.toBeNull()
    expect(JSON.stringify(v)).not.toContain('no debe pasar')
    expect(v.liga).toEqual({ id: 'LIGAPUB1', nombre: 'Liga sintética uno', deporte: 'baloncesto', categoria: 'mini-basketball', subcategoria: { clave: 'u10' } })
  })
  it('acepta metadatos nulos sin inventar nada', () => {
    const e = respuestaLiga({ partidos: [partidoLiga({ programadoPara: null, sede: null })] })
    e.liga.categoria = null
    e.liga.subcategoria = null
    const v = validarLiga(e, 'LIGAPUB1')
    expect(v.liga.categoria).toBeNull()
    expect(v.partidos[0]).toMatchObject({ programadoPara: null, sede: null })
  })
  it('rechaza formas inválidas', () => {
    const casos = {
      'otra liga': (e) => { e.liga.id = 'OTRA' },
      'sin faltasAlcance': (e) => { delete e.faltasAlcance },
      'faltas por periodo': (e) => { e.faltasAlcance = 'periodo' },
      'estado desconocido': (e) => { e.partidos[0].estado = 'cancelado' },
      'estado nulo': (e) => { e.partidos[0].estado = null },
      'puntos negativos': (e) => { e.partidos[0].local.puntos = -1 },
      'puntos texto': (e) => { e.partidos[0].local.puntos = '3' },
      'hora no ISO': (e) => { e.partidos[0].programadoPara = 'mañana' },
      'programado con inicio real': (e) => { e.partidos[0].inicioReal = '2026-11-01T21:31:00.000Z' },
      'reloj con estado raro': (e) => { e.partidos[0].reloj = reloj('pausado') },
      'servidorAhoraMs ausente': (e) => { delete e.servidorAhoraMs },
      'partidos no es lista': (e) => { e.partidos = {} },
      'partidos repetidos': (e) => { e.partidos.push(partidoLiga()) },
      'demasiados partidos': (e) => { e.partidos = Array.from({ length: 301 }, (_, i) => partidoLiga({ gameId: `G${i}` })) },
      'demasiados equipos': (e) => { e.equipos = Array.from({ length: 101 }, (_, i) => ({ id: `E${i}`, nombre: 'x' })) },
      'subcategoría con dos claves': (e) => { e.liga.subcategoria = { clave: 'u10', texto: 'x' } },
      'gameId con barra': (e) => { e.partidos[0].gameId = 'a/b' },
      'nombre demasiado largo': (e) => { e.liga.nombre = 'x'.repeat(201) },
    }
    for (const [nombre, mutar] of Object.entries(casos)) {
      const e = respuestaLiga()
      mutar(e)
      expect(validarLiga(e, 'LIGAPUB1'), nombre).toBeNull()
    }
    for (const basura of [null, [], 'x', 5, undefined]) expect(validarLiga(basura, 'LIGAPUB1')).toBeNull()
    expect(validarLiga(respuestaLiga(), '../x')).toBeNull()
  })
})

describe('validación de la lectura de un partido', () => {
  it('acepta una respuesta válida y exige que coincidan la liga y el partido pedidos', () => {
    const v = validarJuego(respuestaJuego(), 'LIGAPUB1', 'G1')
    expect(v).toMatchObject({ gameId: 'G1', estado: 'vivo', local: { nombre: 'Alfa Norte', puntos: 12, faltas: 3 } })
    expect(validarJuego(respuestaJuego(), 'LIGAPUB1', 'G2')).toBeNull()
    expect(validarJuego(respuestaJuego(), 'LIGAPUB2', 'G1')).toBeNull()
  })
  it('rechaza formas inválidas', () => {
    const casos = {
      'sin nombre de equipo': (e) => { delete e.local.nombre },
      'faltas por periodo': (e) => { e.faltasAlcance = 'periodo' },
      'periodo cero': (e) => { e.periodo = 0 },
      'estado final con reloj inválido': (e) => { e.estado = 'final'; e.reloj = { estado: 'x', restanteMs: 0, desdeMs: null } },
      'rev negativa': (e) => { e.rev = -1 },
    }
    for (const [nombre, mutar] of Object.entries(casos)) {
      const e = respuestaJuego()
      mutar(e)
      expect(validarJuego(e, 'LIGAPUB1', 'G1'), nombre).toBeNull()
    }
  })
  it('un campo extra del servidor (por ejemplo, algo sensible) no llega a la copia', () => {
    const e = respuestaJuego()
    e.jugadores = [{ nombre: 'Persona Real' }]
    e.dorsal = 9
    expect(JSON.stringify(validarJuego(e, 'LIGAPUB1', 'G1'))).not.toContain('Persona Real')
  })
})

import { respuestaEquipo } from './datos-prueba.js'
import { validarEquipo } from './validar.js'

describe('validación de la lectura de un equipo', () => {
  it('acepta una respuesta válida (número 0, nombre nulo, número nulo, histórico) y copia solo lo conocido', () => {
    const e = respuestaEquipo()
    e.personaId = 'no debe pasar'
    e.plantilla[0].fechaNacimiento = '2015-01-01'
    e.plantilla[1].persona = 'no debe pasar'
    const v = validarEquipo(e, 'LIGAPUB1', 'E1')
    expect(v).not.toBeNull()
    expect(v.plantilla[0]).toEqual({ id: 'J1', nombre: 'Ana Prueba', dorsalActual: 0 })
    expect(v.plantilla[3]).toEqual({ id: 'J5', nombre: null, dorsalActual: null })
    expect(JSON.stringify(v)).not.toMatch(/no debe pasar|2015-01-01|personaId/)
  })
  it('rechaza formas inválidas', () => {
    const casos = {
      'otro equipo': (e) => { e.equipo.id = 'E9' },
      'otra liga': (e) => { e.liga.id = 'OTRA' },
      'alcance distinto': (e) => { e.estadisticas.alcance = 'temporada' },
      'número fuera de rango': (e) => { e.plantilla[0].dorsalActual = 100 },
      'número texto': (e) => { e.plantilla[0].dorsalActual = '0' },
      'ficha repetida': (e) => { e.plantilla.push({ ...e.plantilla[0] }) },
      'histórico sin motivo válido': (e) => { e.historicos[0].motivo = 'borrado' },
      'estadística de una ficha que no está en ninguna lista': (e) => { e.estadisticas.jugadores.push({ id: 'FANTASMA', puntos: 1, faltas: 0 }) },
      'puntos negativos': (e) => { e.estadisticas.jugadores[0].puntos = -1 },
      'puntos texto': (e) => { e.estadisticas.jugadores[0].puntos = '3' },
      'resultado con partido repetido': (e) => { e.resultados.push({ ...e.resultados[0] }) },
      'resultado sin nombre': (e) => { delete e.resultados[0].local.nombre },
      'sinJugador ausente': (e) => { delete e.estadisticas.sinJugador },
      'demasiados resultados': (e) => { e.resultados = Array.from({ length: 101 }, (_, i) => ({ ...e.resultados[0], gameId: `G${i}` })) },
      'plantilla no es lista': (e) => { e.plantilla = {} },
    }
    for (const [nombre, mutar] of Object.entries(casos)) {
      const e = respuestaEquipo()
      mutar(e)
      expect(validarEquipo(e, 'LIGAPUB1', 'E1'), nombre).toBeNull()
    }
    for (const basura of [null, [], 'x', 5]) expect(validarEquipo(basura, 'LIGAPUB1', 'E1')).toBeNull()
    expect(validarEquipo(respuestaEquipo(), 'LIGAPUB1', '../x')).toBeNull()
  })
})

describe('validarJugadores', () => {
  const e = (rango, id, puntos, faltas = 0, extra = {}) => ({ rango, id, nombre: `N ${id}`, dorsalActual: 3, equipo: { id: 'E1', nombre: 'Alfa' }, enPlantilla: true, puntos, faltas, ...extra })
  const base = () => ({
    liga: { id: 'L1', nombre: 'Liga' }, alcance: 'partidos-finales-de-la-liga', agrupacion: 'ficha-y-equipo', partidosFinales: 2,
    maximosAnotadores: [e(1, 'a', 9), e(2, 'b', 4)], masFaltas: [e(1, 'b', 4, 3)], recortado: false, sinJugador: { puntos: 0, faltas: 0 }, servidorAhoraMs: 1_790_000_000_000,
  })
  it('acepta la forma exacta y copia solo los campos conocidos (nada de personaId ni fecha de nacimiento)', () => {
    const x = base()
    x.maximosAnotadores[0].personaId = 'persona-secreta'
    x.maximosAnotadores[0].fechaNacimiento = '2015-01-01'
    const v = validarJugadores(x, 'L1')
    expect(v.maximosAnotadores[0]).toEqual(e(1, 'a', 9))
    expect(JSON.stringify(v)).not.toContain('persona')
  })
  it('rechaza otra liga, otro alcance, orden roto, puntos o faltas negativos, valor cero en su lista y tipos incorrectos', () => {
    expect(validarJugadores(base(), 'L2')).toBeNull()
    expect(validarJugadores({ ...base(), alcance: 'x' }, 'L1')).toBeNull()
    expect(validarJugadores({ ...base(), agrupacion: 'nombre' }, 'L1')).toBeNull()
    expect(validarJugadores({ ...base(), recortado: 'no' }, 'L1')).toBeNull()
    const orden = base(); orden.maximosAnotadores = [e(1, 'a', 4), e(2, 'b', 9)]
    expect(validarJugadores(orden, 'L1')).toBeNull()
    const neg = base(); neg.masFaltas = [e(1, 'b', 4, -1)]
    expect(validarJugadores(neg, 'L1')).toBeNull()
    const cero = base(); cero.maximosAnotadores = [e(1, 'a', 0)]
    expect(validarJugadores(cero, 'L1')).toBeNull()
    const tipo = base(); tipo.maximosAnotadores = [e(1, 'a', 9, 0, { enPlantilla: 1 })]
    expect(validarJugadores(tipo, 'L1')).toBeNull()
    expect(validarJugadores(null, 'L1')).toBeNull()
    expect(validarJugadores({ ...base(), maximosAnotadores: Array.from({ length: 51 }, (_, i) => e(1, `i${i}`, 5)) }, 'L1')).toBeNull()
  })
})

describe('validarJuego: canastas confirmadas (REPORT_191)', () => {
  const an = (seq, extra = {}) => ({ seq, lado: 'local', puntos: 2, jugador: { nombre: 'Ana Prueba', dorsalActual: 0 }, ...extra })
  it('servidor anterior (sin el campo) o dato malo: el marcador sigue valiendo y las anotaciones son null (no se actúa)', () => {
    expect(validarJuego(respuestaJuego(), 'LIGAPUB1', 'G1').anotaciones).toBeNull()
    for (const malo of ['x', {}, [an(1), an(1)], [an(0)], [an(1, { lado: 'centro' })], [an(1, { puntos: 0 })], [an(1, { puntos: 'dos' })], [an(1, { jugador: null })], [an(1, { jugador: { nombre: '', dorsalActual: 1 } })], [an(1, { jugador: { nombre: 'A', dorsalActual: 100 } })], Array.from({ length: 13 }, (_, i) => an(i + 1))]) {
      const v = validarJuego(respuestaJuego({ anotaciones: malo }), 'LIGAPUB1', 'G1')
      expect(v, JSON.stringify(malo)).not.toBeNull()
      expect(v.anotaciones).toBeNull()
      expect(v.local.puntos).toBe(12)
    }
  })
  it('lista válida: copia solo los campos aprobados, en el mismo orden', () => {
    const v = validarJuego(respuestaJuego({ anotaciones: [{ ...an(7), personaId: 'p-secreta', jugadorId: 'J1', cmdId: 'c' }, an(6, { lado: 'visita' })] }), 'LIGAPUB1', 'G1')
    expect(v.anotaciones).toEqual([an(7), an(6, { lado: 'visita' })])
    expect(JSON.stringify(v)).not.toMatch(/persona|jugadorId|cmdId/)
    expect(validarJuego(respuestaJuego({ anotaciones: [] }), 'LIGAPUB1', 'G1').anotaciones).toEqual([])
  })
})
