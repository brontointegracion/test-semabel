import { describe, expect, it } from 'vitest'
import { crearAtribucion } from './atribucion'
import { crearPreparacion, evaluarPreparacion, preparacionIntegra } from './preparacion'

// ---------------------------------------------------------------------------
// S5a: contexto de preparación puro. Fixtures sintéticos; sin base de datos, sin motor, sin adaptador.
//
// Lo que estas pruebas NO muestran: recuperación completa desde un servidor, atomicidad de un servidor,
// autenticación ni aceptación en un dispositivo real. Demuestran la forma, la huella y la evaluación de un
// contexto que alguien de confianza ya armó; incluyen ejemplos de las limitaciones (ver al final).
// ---------------------------------------------------------------------------

const GAME = 'P1'
const partido = { ligaId: 'L1', localId: 'A', visitaId: 'B' }
const liga = { id: 'L1' }
const equipos = [{ id: 'A', ligaId: 'L1', nombre: 'Alfa' }, { id: 'B', ligaId: 'L1', nombre: 'Beta' }]
const j = (id, equipoId, dorsal, extra = {}) => ({ id, equipoId, ...(dorsal === undefined ? {} : { dorsal }), ...extra })
const base = () => ({
  gameId: GAME, partido: { ...partido }, liga: { ...liga }, equipos: equipos.map((e) => ({ ...e })),
  jugadores: [j('a1', 'A', 0), j('a2', 'A', 7), j('b1', 'B', 0), j('b2', 'B', 9)], consultaEquipos: ['A', 'B'],
})
const armar = (sobre = {}) => crearPreparacion({ ...base(), ...sobre })
const evaluar = (sobre = {}, esperado = GAME) => evaluarPreparacion(armar(sobre), { gameId: esperado })

describe('contexto de preparación: evaluación (usa la misma regla que el arranque conectado)', () => {
  it('plantillas válidas pasan, con un 0 real; equipos vacíos y fecha de nacimiento ausente también', () => {
    expect(evaluar()).toEqual({ lista: true })
    expect(evaluar({ jugadores: [] })).toEqual({ lista: true })
    expect(evaluar({ jugadores: [j('a1', 'A', 3, { fechaNacimiento: undefined }), j('b1', 'B', 3, { fechaNacimiento: '2001-02-03' })] }))
      .toEqual({ lista: true })
  })

  it.each([
    ['ausente', undefined], ['null', null], ['cadena vacía', ''], ['texto guardado "07"', '07'], ['NaN', NaN],
    ['fuera de rango', 100], ['negativo', -1], ['fracción', 1.5], ['booleano', true],
  ])('un activo con número guardado %s no está listo, y no se repara', (_n, dorsal) => {
    const r = evaluar({ jugadores: [j('a1', 'A', dorsal)] })
    expect(r).toMatchObject({ lista: false, motivo: 'plantilla-incompleta' })
    expect(r.detalle.equipos).toEqual([{ equipoId: 'A', nombre: null, sinNumero: 1, duplicados: [] }])
  })

  it('números repetidos entre activos del mismo equipo no están listos, también dos 0; en equipos distintos sí', () => {
    const r = evaluar({ jugadores: [j('a1', 'A', 0), j('a2', 'A', 0), j('a3', 'A', 5), j('a4', 'A', 5)] })
    expect(r.detalle.equipos).toEqual([{ equipoId: 'A', nombre: null, sinNumero: 0, duplicados: [0, 5] }])
    expect(evaluar({ jugadores: [j('a1', 'A', 3), j('b1', 'B', 3)] })).toEqual({ lista: true })
  })

  it('los inactivos no bloquean ni repiten; activo ausente, explícito o indefinido cuenta como activo', () => {
    expect(evaluar({ jugadores: [j('a1', 'A', 4), j('a2', 'A', undefined, { activo: false }), j('a3', 'A', 4, { activo: false })] }))
      .toEqual({ lista: true })
    for (const activo of [true, undefined]) {
      expect(evaluar({ jugadores: [j('a1', 'A', undefined, { activo })] })).toMatchObject({ motivo: 'plantilla-incompleta' })
    }
  })

  it.each([
    ['sin liga', { liga: null }, 'liga'],
    ['liga con otro id', { liga: { id: 'OTRA' } }, 'liga'],
    ['partido sin ligaId', { partido: { ...partido, ligaId: undefined } }, 'liga'],
    ['sin local', { partido: { ...partido, localId: undefined }, consultaEquipos: ['B'], equipos: [equipos[1]], jugadores: [] }, 'equipos-distintos'],
    ['mismo equipo dos veces', { partido: { ...partido, visitaId: 'A' }, consultaEquipos: ['A'], equipos: [equipos[0]], jugadores: [] }, 'equipos-distintos'],
    ['equipo inexistente', { equipos: [equipos[0]] }, 'equipo-inexistente'],
    ['equipo de otra liga', { equipos: [equipos[0], { id: 'B', ligaId: 'OTRA' }] }, 'equipo-otra-liga'],
    ['equipo sin liga', { equipos: [equipos[0], { id: 'B' }] }, 'equipo-otra-liga'],
  ])('%s: equipos-invalidos (no es un error de estructura)', (_n, sobre, causa) => {
    expect(evaluar(sobre)).toEqual({ lista: false, motivo: 'equipos-invalidos', detalle: { causa } })
  })

  it('los equipos inválidos tienen precedencia sobre la plantilla', () => {
    expect(evaluar({ liga: null, jugadores: [j('a1', 'A', undefined)] }).motivo).toBe('equipos-invalidos')
  })
})

describe('contexto de preparación: partido esperado y manipulación detectable', () => {
  it('un contexto de otro partido no sirve, ni válido ni listo', () => {
    expect(evaluar({}, 'OTRO')).toEqual({ lista: false, motivo: 'juego-distinto' })
    expect(evaluarPreparacion(armar(), {})).toEqual({ lista: false, motivo: 'juego-distinto' })
    expect(preparacionIntegra(armar(), { gameId: 'OTRO' })).toBe(false)
    expect(preparacionIntegra(armar(), { gameId: GAME })).toBe(true)
  })

  it('relabelar el partido de un contexto ya armado rompe su huella', () => {
    const p = armar()
    expect(evaluarPreparacion({ ...p, gameId: 'OTRO' }, { gameId: 'OTRO' })).toEqual({ lista: false, motivo: 'preparacion-no-disponible' })
  })

  it('cualquier alteración posterior de un contexto armado se detecta', () => {
    const alteraciones = {
      'otro equipo local': (p) => { p.partido.localId = 'Z' },
      'liga': (p) => { p.liga.id = 'X' },
      'un número': (p) => { p.jugadores[0].dorsal = 99 },
      'un jugador de más': (p) => { p.jugadores.push({ id: 'zz', equipoId: 'A', dorsal: 50 }) },
      'un jugador quitado': (p) => { p.jugadores.pop() },
      'orden de jugadores': (p) => { p.jugadores.reverse() },
      'orden de equipos': (p) => { p.equipos.reverse() },
      'huella': (p) => { p.version = 'x' },
      'campo extra en el contexto': (p) => { p.extra = 1 },
      'campo extra en una fila': (p) => { p.jugadores[0].nombre = 'Ana' },
      'cobertura quitada': (p) => { p.consultaEquipos.pop() },
      'número fuera de forma con huella recalculada': (p) => { p.jugadores[0].dorsal = '07' },
    }
    for (const [nombre, alterar] of Object.entries(alteraciones)) {
      const p = structuredClone(armar())
      alterar(p)
      expect(preparacionIntegra(p), nombre).toBe(false)
      expect(evaluarPreparacion(p, { gameId: GAME }), nombre).toEqual({ lista: false, motivo: 'preparacion-no-disponible' })
    }
  })

  it.each([
    ['ausente', undefined], ['null', null], ['texto', 'x'], ['arreglo', []], ['objeto vacío', {}],
    ['sin jugadores', { version: 'v', gameId: GAME }], ['número', 5],
    ['con valores que no se pueden serializar', { ...structuredClone(armar()), jugadores: [{ id: 'a', equipoId: 'A', dorsal: NaN }] }],
  ])('un contexto %s no es íntegro ni lanza: preparacion-no-disponible', (_n, malo) => {
    expect(() => preparacionIntegra(malo)).not.toThrow()
    expect(preparacionIntegra(malo)).toBe(false)
    expect(evaluarPreparacion(malo, { gameId: GAME })).toEqual({ lista: false, motivo: 'preparacion-no-disponible' })
  })

  it('la evaluación no lanza con argumentos raros', () => {
    for (const args of [[undefined], [null], [armar(), undefined], [armar(), null], [{ get version() { throw new Error('x') } }, { gameId: GAME }]]) {
      expect(() => evaluarPreparacion(...args)).not.toThrow()
    }
  })
})

describe('contexto de preparación: estructura de entrada (el constructor rechaza lo dudoso)', () => {
  it.each([
    ['gameId vacío', { gameId: '' }], ['gameId no texto', { gameId: 7 }], ['sin partido', { partido: null }],
    ['liga no objeto', { liga: 'L1' }], ['equipos no es lista', { equipos: {} }],
    ['equipo sin id', { equipos: [{ ligaId: 'L1' }, equipos[1]] }],
    ['equipo repetido', { equipos: [equipos[0], equipos[0], equipos[1]] }],
    ['fila de un equipo inesperado', { equipos: [...equipos, { id: 'C', ligaId: 'L1' }] }],
    ['jugador sin id', { jugadores: [{ equipoId: 'A' }] }],
    ['jugador sin equipo', { jugadores: [{ id: 'a1' }] }],
    ['jugador repetido', { jugadores: [j('a1', 'A', 1), j('a1', 'B', 2)] }],
    ['jugador de un equipo inesperado', { jugadores: [j('c1', 'C', 1)] }],
    ['fila de jugador inactivo de un equipo inesperado', { jugadores: [j('c1', 'C', 1, { activo: false })] }],
    ['cobertura faltante de un equipo', { consultaEquipos: ['A'] }],
    ['cobertura vacía', { consultaEquipos: [] }],
    ['cobertura con un equipo ajeno', { consultaEquipos: ['A', 'B', 'C'] }],
    ['cobertura con identidad repetida', { consultaEquipos: ['A', 'A', 'B'] }],
    ['cobertura con identidad inválida', { consultaEquipos: ['A', 7] }],
  ])('%s lanza', (_n, sobre) => {
    expect(() => armar(sobre)).toThrow(/^preparacion:|preparacion/)
  })

  it('un partido con equipos inexistentes no lanza: es un resultado de dominio', () => {
    expect(() => armar({ equipos: [] })).not.toThrow()
    expect(evaluar({ equipos: [] })).toMatchObject({ motivo: 'equipos-invalidos' })
  })
})

describe('contexto de preparación: identidades y versión determinista', () => {
  it('el orden de entrada no cambia ni la versión ni el contenido', () => {
    const a = armar()
    const b = armar({ jugadores: [...base().jugadores].reverse(), equipos: [...base().equipos].reverse(), consultaEquipos: ['B', 'A'] })
    expect(b).toEqual(a)
    expect(b.version).toBe(a.version)
  })

  it('las identidades se aceptan tal cual y distintas siguen distintas', () => {
    const raros = ['7', '07', 'Á', 'a b', ' a', 'A', 'a', 'x'.repeat(500), 'ñ-1', '0']
    const jugadores = raros.map((id, i) => j(id, i % 2 ? 'B' : 'A', i))
    const p = armar({ jugadores })
    expect(p.jugadores.map((x) => x.id).sort()).toEqual([...raros].sort())
    expect(new Set(p.jugadores.map((x) => x.id)).size).toBe(raros.length)
    expect(evaluarPreparacion(p, { gameId: GAME })).toEqual({ lista: true })
    // Equipos y partido con identidades poco comunes también.
    const rareza = { ligaId: 'Liga ñ 1', localId: '07', visitaId: '7' }
    const q = crearPreparacion({
      gameId: 'Partido Á', partido: rareza, liga: { id: 'Liga ñ 1' },
      equipos: [{ id: '7', ligaId: 'Liga ñ 1' }, { id: '07', ligaId: 'Liga ñ 1' }], jugadores: [j('x', '7', 1), j('y', '07', 1)],
      consultaEquipos: ['07', '7'],
    })
    expect(evaluarPreparacion(q, { gameId: 'Partido Á' })).toEqual({ lista: true })
  })

  it('cambia con cada cosa que importa para estar listo', () => {
    const v0 = armar().version
    const cambios = {
      'un número': { jugadores: [j('a1', 'A', 1), j('a2', 'A', 7), j('b1', 'B', 0), j('b2', 'B', 9)] },
      'un número borrado': { jugadores: [j('a1', 'A', undefined), j('a2', 'A', 7), j('b1', 'B', 0), j('b2', 'B', 9)] },
      'un activo de más': { jugadores: [...base().jugadores, j('a3', 'A', 12)] },
      'un activo que se desactiva': { jugadores: base().jugadores.map((x) => (x.id === 'b2' ? { ...x, activo: false } : x)) },
      'un jugador que cambia de equipo': { jugadores: base().jugadores.map((x) => (x.id === 'a2' ? { ...x, equipoId: 'B' } : x)) },
      'la liga del equipo': { equipos: [equipos[0], { id: 'B', ligaId: 'OTRA' }] },
      'la liga que falta': { liga: null },
      'el equipo del partido': { partido: { ...partido, visitaId: 'C' }, equipos: [equipos[0], { id: 'C', ligaId: 'L1' }], consultaEquipos: ['A', 'C'], jugadores: [] },
      'el partido': { gameId: 'P2' },
    }
    const vistos = new Set([v0])
    for (const [nombre, sobre] of Object.entries(cambios)) {
      const v = armar(sobre).version
      expect(v, nombre).not.toBe(v0)
      vistos.add(v)
    }
    expect(vistos.size).toBe(Object.keys(cambios).length + 1)
  })

  it('no cambia con lo que no importa: nombres, acentos, alias, fecha de nacimiento, jugadores inactivos, datos de los equipos', () => {
    const v0 = armar().version
    const ruido = base().jugadores.map((x, i) => ({
      ...x, nombre: `Nombre ${i}`, nombrePila: 'Álvaro', apellido1: 'Peña', nombreCamiseta: `ALIAS${i}`, fechaNacimiento: `2000-01-0${i + 1}`,
    }))
    const conInactivo = [...ruido, j('inactivo', 'A', 7, { activo: false }), j('inactivo2', 'B', undefined, { activo: false })]
    expect(armar({ jugadores: conInactivo }).version).toBe(v0)
    expect(armar({ equipos: equipos.map((e) => ({ ...e, nombre: 'Otro', color: '#fff', corto: 'XX' })) }).version).toBe(v0)
  })

  it('número ausente y número mal formado se normalizan igual (null): cambiar entre ellos no cambia la versión', () => {
    const con = (dorsal) => armar({ jugadores: [j('a1', 'A', dorsal)] })
    const versiones = [undefined, null, '', '07', NaN, 100, -1, 2.5, false, {}].map((d) => con(d).version)
    expect(new Set(versiones).size).toBe(1)
    expect(con(undefined).jugadores).toEqual([{ id: 'a1', equipoId: 'A', dorsal: null }])
  })

  it('un cambio de número solo mueve la huella de preparación, no la de atribución', () => {
    const filas = (n) => [{ id: 'a1', equipoId: 'A', dorsal: n }, { id: 'b1', equipoId: 'B', dorsal: 1 }]
    const atribucion = (n) => crearAtribucion({ equipos: ['A', 'B'], jugadores: filas(n) }).version
    const preparacion = (n) => armar({ jugadores: filas(n) }).version
    expect(atribucion(1)).toBe(atribucion(2))
    expect(atribucion(1)).toBe(atribucion(undefined))
    expect(preparacion(1)).not.toBe(preparacion(2))
    // Desactivar a alguien cambia las dos.
    const sin = filas(1).map((x) => (x.id === 'a1' ? { ...x, activo: false } : x))
    expect(crearAtribucion({ equipos: ['A', 'B'], jugadores: sin }).version).not.toBe(atribucion(1))
    expect(armar({ jugadores: sin }).version).not.toBe(preparacion(1))
  })
})

describe('contexto de preparación: aislamiento de la entrada', () => {
  it('cambiar la entrada o el resultado después no cambia el contexto ya armado', () => {
    const entrada = base()
    const p = crearPreparacion(entrada)
    const copia = structuredClone(p)
    entrada.jugadores[0].dorsal = 55
    entrada.jugadores.push(j('nuevo', 'A', 1))
    entrada.partido.localId = 'Z'
    entrada.equipos[0].ligaId = 'X'
    entrada.consultaEquipos.length = 0
    entrada.liga.id = 'Q'
    expect(p).toEqual(copia)
    expect(preparacionIntegra(p, { gameId: GAME })).toBe(true)
    // Y cambiar el resultado no afecta a otro armado de la misma entrada.
    const otro = armar()
    p.jugadores[0].dorsal = 77
    expect(otro.jugadores[0].dorsal).toBe(0)
  })
})

describe('contexto de preparación: límites que las pruebas dejan a la vista', () => {
  it('un jugador omitido NO se detecta: un contexto por lo demás válido con la plantilla recortada pasa', () => {
    const completo = armar({ jugadores: [j('a1', 'A', 5), j('a2', 'A', undefined)] }) // a2 sin número: no está listo
    expect(evaluarPreparacion(completo, { gameId: GAME })).toMatchObject({ lista: false, motivo: 'plantilla-incompleta' })
    const recortado = armar({ jugadores: [j('a1', 'A', 5)] }) // a2 "omitido" por una recuperación incompleta
    expect(preparacionIntegra(recortado, { gameId: GAME })).toBe(true)
    expect(evaluarPreparacion(recortado, { gameId: GAME })).toEqual({ lista: true })
  })

  it('la cobertura declarada no prueba que se hayan consultado las plantillas: es una declaración', () => {
    const sinFilas = armar({ jugadores: [] }) // dice haber consultado A y B, pero no trajo nada
    expect(sinFilas.consultaEquipos).toEqual(['A', 'B'])
    expect(evaluarPreparacion(sinFilas, { gameId: GAME })).toEqual({ lista: true })
  })

  it('un contexto equivocado reconstruido con el mismo id y su huella se acepta: no autentica su origen', () => {
    const falso = crearPreparacion({ ...base(), jugadores: [], partido: { ligaId: 'L1', localId: 'A', visitaId: 'B' } })
    expect(preparacionIntegra(falso, { gameId: GAME })).toBe(true)
    expect(evaluarPreparacion(falso, { gameId: GAME })).toEqual({ lista: true })
  })

  it('la huella es un detector de cambios: se recalcula sin secreto', () => {
    const p = structuredClone(armar())
    p.jugadores[0].dorsal = 99
    const r = crearPreparacion({ ...base(), jugadores: p.jugadores })
    expect(preparacionIntegra(r)).toBe(true) // quien conoce la forma puede producir una huella válida
  })
})
