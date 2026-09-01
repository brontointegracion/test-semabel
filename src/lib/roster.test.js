import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const NOMBRE_BD = 'sebel'

function borrarBd() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(NOMBRE_BD)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

// Reimporta db.js/roster.js con registro de módulos limpio en cada test, para
// que cada uno abra su propia instancia de Dexie('sebel') — mismo patrón que
// src/db.test.js.
async function cargar() {
  const dbMod = await import('../db.js')
  const rosterMod = await import('./roster.js')
  await dbMod.db.jugadores.toArray()
  return { db: dbMod.db, ...rosterMod }
}

beforeEach(async () => {
  await borrarBd()
  vi.resetModules()
})

afterEach(async () => {
  await borrarBd()
})

const sesionDueno = { rol: 'organizador', cuentaId: 'yo' }
const sesionOtro = { rol: 'organizador', cuentaId: 'otro' }
const sesionVisitante = { rol: 'invitado', cuentaId: null }

async function sembrarLiga(db) {
  const liga = { id: 'liga1', codigo: '1001', estado: 'publicada', organizadorId: 'yo' }
  const equipoA = { id: 'equipoA', ligaId: liga.id, codigo: '2001' }
  const equipoB = { id: 'equipoB', ligaId: liga.id, codigo: '2002' }
  await db.ligas.add(liga)
  await db.equipos.bulkAdd([equipoA, equipoB])
  return { liga, equipoA, equipoB }
}

const camposBase = { nombrePila: 'Miguel', apellido1: 'Sam', apellido2: 'Robles', dorsal: 10, fechaNacimiento: '' }

describe('lecturas de plantilla', () => {
  it('rosterActivo excluye inactivos y ordena por dorsal; rosterInactivo ordena por más reciente primero', async () => {
    const { db, rosterActivo, rosterInactivo, agregarJugador, desactivarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)

    const a = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, dorsal: 23 } })
    const b = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombrePila: 'Ana', apellido1: 'Torres', apellido2: '', dorsal: 4 } })
    const c = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombrePila: 'Luis', apellido1: 'Pérez', apellido2: '', dorsal: 7 } })

    let activos = await rosterActivo(equipoA.id)
    expect(activos.map((j) => j.dorsal)).toEqual([4, 7, 23])

    await desactivarJugador({ sesion: sesionDueno, liga, ficha: b.ficha })
    await new Promise((r) => setTimeout(r, 2))
    await desactivarJugador({ sesion: sesionDueno, liga, ficha: c.ficha })

    activos = await rosterActivo(equipoA.id)
    expect(activos.map((j) => j.dorsal)).toEqual([23])

    const inactivos = await rosterInactivo(equipoA.id)
    expect(inactivos.map((j) => j.id)).toEqual([c.ficha.id, b.ficha.id])
  })
})

describe('validación de campos (Decisiones 70–83)', () => {
  it('rechaza campos requeridos vacíos, con dígitos, o solo puntuación', async () => {
    const { validarCamposJugador } = await cargar()

    expect(validarCamposJugador({ ...camposBase, nombrePila: '   ' })).toHaveProperty('nombrePila')
    expect(validarCamposJugador({ ...camposBase, apellido1: 'Robles2' })).toHaveProperty('apellido1')
    expect(validarCamposJugador({ ...camposBase, nombrePila: '---' })).toHaveProperty('nombrePila')
    expect(validarCamposJugador({ ...camposBase, apellido1: 'a'.repeat(51) })).toHaveProperty('apellido1')
    expect(validarCamposJugador({ ...camposBase, dorsal: 100 })).toHaveProperty('dorsal')
    expect(validarCamposJugador({ ...camposBase, dorsal: -1 })).toHaveProperty('dorsal')
    expect(validarCamposJugador({ ...camposBase, fechaNacimiento: '2999-01-01' })).toHaveProperty('fechaNacimiento')
  })

  it('acepta un nombre de una sola letra y apellido2 vacío', async () => {
    const { validarCamposJugador } = await cargar()
    expect(validarCamposJugador({ ...camposBase, nombrePila: 'A', apellido2: '' })).toEqual({})
  })
})

describe('duplicados: normalización y coincidencia (Decisiones 72–76)', () => {
  it('coincide sin importar mayúsculas/acentos/espacios repetidos', async () => {
    const { db, buscarCandidatosDuplicados, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombrePila: 'José', apellido1: 'Pérez', apellido2: '' } })

    const candidatos = await buscarCandidatosDuplicados({ ligaId: liga.id, nombrePila: '  jose  ', apellido1: 'PEREZ', apellido2: '' })
    expect(candidatos).toHaveLength(1)
    expect(candidatos[0].nombreCompleto).toBe('José Pérez')
    expect(candidatos[0]).not.toHaveProperty('fechaNacimiento')
  })

  it('preserva la puntuación como significativa: D\'Angelo no coincide con DAngelo', async () => {
    const { db, buscarCandidatosDuplicados, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombrePila: "D'Angelo", apellido1: 'Ruiz', apellido2: '' } })

    const candidatos = await buscarCandidatosDuplicados({ ligaId: liga.id, nombrePila: 'DAngelo', apellido1: 'Ruiz', apellido2: '' })
    expect(candidatos).toHaveLength(0)
  })
})

describe('agregarJugador', () => {
  it('persiste con codigo/personaId/activo y regenera nombre desde las partes (Decisión 114)', async () => {
    const { db, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)

    const r = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: camposBase })

    expect(r.tipo).toBe('creado')
    expect(r.ficha.nombre).toBe('Miguel Sam Robles')
    expect(r.ficha.nombrePila).toBe('Miguel')
    expect(r.ficha.apellido1).toBe('Sam')
    expect(r.ficha.apellido2).toBe('Robles')
    expect(typeof r.ficha.personaId).toBe('string')
    expect(r.ficha.personaId.length).toBeGreaterThan(0)
    expect(r.ficha.activo).toBe(true)
    expect(typeof r.ficha.codigo).toBe('string')

    const guardado = await db.jugadores.get(r.ficha.id)
    expect(guardado.nombre).toBe('Miguel Sam Robles')
  })

  it('devuelve invalido con errores por campo cuando la validación falla', async () => {
    const { db, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const r = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombrePila: '' } })
    expect(r.tipo).toBe('invalido')
    expect(r.errores).toHaveProperty('nombrePila')
  })

  it('rechaza número de camiseta ya usado por un activo del mismo equipo', async () => {
    const { db, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, dorsal: 10 } })

    const r = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombrePila: 'Otro', apellido1: 'Distinto', apellido2: '', dorsal: 10 } })
    expect(r.tipo).toBe('conflicto-numero')
  })

  it('un número liberado por desactivación queda disponible para otro activo', async () => {
    const { db, agregarJugador, desactivarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const primero = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, dorsal: 10 } })
    await desactivarJugador({ sesion: sesionDueno, liga, ficha: primero.ficha })

    const r = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombrePila: 'Otro', apellido1: 'Distinto', apellido2: '', dorsal: 10 } })
    expect(r.tipo).toBe('creado')
  })

  it('rechaza la mutación si la sesión no es la organizadora dueña de la liga', async () => {
    const { db, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    await expect(agregarJugador({ sesion: sesionOtro, liga, equipoId: equipoA.id, campos: camposBase })).rejects.toThrow()
    await expect(agregarJugador({ sesion: sesionVisitante, liga, equipoId: equipoA.id, campos: camposBase })).rejects.toThrow()
  })

  it('revalida el número en el momento de guardar, no solo en la llamada anterior (Decisión 63)', async () => {
    const { db, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, dorsal: 5 } })

    // Dos intentos "concurrentes" por el mismo número: el primero ya tomó el
    // cupo, el segundo debe chocar aunque nada en su propia validación previa
    // lo hubiera anticipado.
    const r2 = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombrePila: 'Otro', apellido1: 'Jugador', apellido2: '', dorsal: 5 } })
    expect(r2.tipo).toBe('conflicto-numero')
  })

  it('registra una entrada de auditoría created', async () => {
    const { db, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const r = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: camposBase })

    const entradas = await db.auditoria.where('fichaId').equals(r.ficha.id).toArray()
    expect(entradas).toHaveLength(1)
    expect(entradas[0].tipo).toBe('created')
    expect(entradas[0].actorId).toBe('yo')
  })
})

describe('resolución de identidad (Decisiones 5–7, 26, 60, 61)', () => {
  it('sin resolución, devuelve todos los candidatos sin crear nada', async () => {
    const { db, agregarJugador } = await cargar()
    const { liga, equipoA, equipoB } = await sembrarLiga(db)
    await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoB.id, campos: camposBase })

    const r = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: camposBase })
    expect(r.tipo).toBe('candidatos')
    expect(r.candidatos).toHaveLength(1)

    const total = await db.jugadores.where('ligaId').equals(liga.id).count()
    expect(total).toBe(1)
  })

  it('misma-persona reusa personaId', async () => {
    const { db, agregarJugador } = await cargar()
    const { liga, equipoA, equipoB } = await sembrarLiga(db)
    const original = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoB.id, campos: camposBase })

    const r = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipoA.id, campos: camposBase,
      resolucionIdentidad: { tipo: 'misma-persona', personaId: original.ficha.personaId },
    })
    expect(r.tipo).toBe('creado')
    expect(r.ficha.personaId).toBe(original.ficha.personaId)
    expect(r.ficha.id).not.toBe(original.ficha.id)
  })

  it('otra-persona crea un personaId distinto pese al nombre igual', async () => {
    const { db, agregarJugador } = await cargar()
    const { liga, equipoA, equipoB } = await sembrarLiga(db)
    const original = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoB.id, campos: camposBase })

    const r = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipoA.id, campos: camposBase,
      resolucionIdentidad: { tipo: 'otra-persona' },
    })
    expect(r.tipo).toBe('creado')
    expect(r.ficha.personaId).not.toBe(original.ficha.personaId)
  })

  it('misma-persona ya activa en este equipo no crea una ficha duplicada', async () => {
    const { db, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const original = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, dorsal: 10 } })

    const r = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, dorsal: 11 },
      resolucionIdentidad: { tipo: 'misma-persona', personaId: original.ficha.personaId },
    })
    expect(r.tipo).toBe('ya-activo')
    expect(r.ficha.id).toBe(original.ficha.id)

    const total = await db.jugadores.where('equipoId').equals(equipoA.id).count()
    expect(total).toBe(1)
  })
})

describe('editarJugador', () => {
  it('actualiza campos, regenera nombre, y registra auditoría edited', async () => {
    const { db, agregarJugador, editarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const creado = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: camposBase })

    const r = await editarJugador({ sesion: sesionDueno, liga, ficha: creado.ficha, campos: { dorsal: 99 } })
    expect(r.tipo).toBe('editado')
    expect(r.ficha.dorsal).toBe(99)
    expect(r.ficha.nombre).toBe('Miguel Sam Robles')

    const entradas = await db.auditoria.where('fichaId').equals(creado.ficha.id).sortBy('seq')
    expect(entradas.map((e) => e.tipo)).toEqual(['created', 'edited'])
  })

  it('cambiar solo el número no reactiva el chequeo de duplicados', async () => {
    const { db, agregarJugador, editarJugador } = await cargar()
    const { liga, equipoA, equipoB } = await sembrarLiga(db)
    await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoB.id, campos: camposBase })
    const propio = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombrePila: 'Distinto', apellido1: 'Nombre', apellido2: '', dorsal: 20 } })

    const r = await editarJugador({ sesion: sesionDueno, liga, ficha: propio.ficha, campos: { dorsal: 21 } })
    expect(r.tipo).toBe('editado')
  })

  it('cambiar el nombre a uno que coincide con otro reactiva el chequeo de duplicados', async () => {
    const { db, agregarJugador, editarJugador } = await cargar()
    const { liga, equipoA, equipoB } = await sembrarLiga(db)
    await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoB.id, campos: camposBase })
    const propio = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombrePila: 'Distinto', apellido1: 'Nombre', apellido2: '', dorsal: 20 } })

    const r = await editarJugador({ sesion: sesionDueno, liga, ficha: propio.ficha, campos: { nombrePila: camposBase.nombrePila, apellido1: camposBase.apellido1, apellido2: camposBase.apellido2 } })
    expect(r.tipo).toBe('candidatos')
  })

  it('nunca cambia personaId, incluso con resolucionIdentidad', async () => {
    const { db, agregarJugador, editarJugador } = await cargar()
    const { liga, equipoA, equipoB } = await sembrarLiga(db)
    const otro = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoB.id, campos: camposBase })
    const propio = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombrePila: 'Distinto', apellido1: 'Nombre', apellido2: '', dorsal: 20 } })
    const personaIdOriginal = propio.ficha.personaId

    const r = await editarJugador({
      sesion: sesionDueno, liga, ficha: propio.ficha,
      campos: { nombrePila: camposBase.nombrePila, apellido1: camposBase.apellido1, apellido2: camposBase.apellido2 },
      resolucionIdentidad: { tipo: 'misma-persona', personaId: otro.ficha.personaId },
    })
    expect(r.tipo).toBe('editado')
    expect(r.ficha.personaId).toBe(personaIdOriginal)
  })
})

describe('desactivarJugador / reactivarJugador (Decisiones 8, 25, 31–34, 37–40, 44)', () => {
  it('desactivar preserva id/personaId/historia y libera el número', async () => {
    const { db, agregarJugador, desactivarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const creado = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, dorsal: 10 } })

    const r = await desactivarJugador({ sesion: sesionDueno, liga, ficha: creado.ficha })
    expect(r.tipo).toBe('desactivado')
    expect(r.ficha.id).toBe(creado.ficha.id)
    expect(r.ficha.personaId).toBe(creado.ficha.personaId)
    expect(r.ficha.activo).toBe(false)
    expect(typeof r.ficha.desactivadoEn).toBe('string')

    const guardado = await db.jugadores.get(creado.ficha.id)
    expect(guardado.activo).toBe(false)
  })

  it('reactivar restaura el activo, preservando id/personaId', async () => {
    const { db, agregarJugador, desactivarJugador, reactivarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const creado = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, dorsal: 10 } })
    await desactivarJugador({ sesion: sesionDueno, liga, ficha: creado.ficha })

    const r = await reactivarJugador({ sesion: sesionDueno, liga, ficha: creado.ficha })
    expect(r.tipo).toBe('reactivado')
    expect(r.ficha.activo).toBe(true)
    expect(r.ficha.dorsal).toBe(10)
    expect(r.ficha.personaId).toBe(creado.ficha.personaId)
  })

  it('reactivar choca si el número anterior ya está activo en otro jugador del equipo', async () => {
    const { db, agregarJugador, desactivarJugador, reactivarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const creado = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, dorsal: 10 } })
    await desactivarJugador({ sesion: sesionDueno, liga, ficha: creado.ficha })
    await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombrePila: 'Otro', apellido1: 'Jugador', apellido2: '', dorsal: 10 } })

    const r = await reactivarJugador({ sesion: sesionDueno, liga, ficha: creado.ficha })
    expect(r.tipo).toBe('conflicto-numero')

    const r2 = await reactivarJugador({ sesion: sesionDueno, liga, ficha: creado.ficha, nuevoDorsal: 55 })
    expect(r2.tipo).toBe('reactivado')
    expect(r2.ficha.dorsal).toBe(55)
  })

  it('registra auditoría deactivated y reactivated', async () => {
    const { db, agregarJugador, desactivarJugador, reactivarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const creado = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, dorsal: 10 } })
    await desactivarJugador({ sesion: sesionDueno, liga, ficha: creado.ficha })
    await reactivarJugador({ sesion: sesionDueno, liga, ficha: creado.ficha })

    const entradas = await db.auditoria.where('fichaId').equals(creado.ficha.id).sortBy('seq')
    expect(entradas.map((e) => e.tipo)).toEqual(['created', 'deactivated', 'reactivated'])
  })

  it('rechaza desactivar/reactivar si la sesión no es la organizadora dueña', async () => {
    const { db, agregarJugador, desactivarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const creado = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: camposBase })

    await expect(desactivarJugador({ sesion: sesionOtro, liga, ficha: creado.ficha })).rejects.toThrow()
    await expect(desactivarJugador({ sesion: sesionVisitante, liga, ficha: creado.ficha })).rejects.toThrow()
  })
})

describe('migración de esquema (Decisiones 93–96)', () => {
  it('la tabla auditoria existe y los datos previos de jugadores no se alteran', async () => {
    const { db, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const creado = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: camposBase })

    expect(db.tables.map((t) => t.name)).toContain('auditoria')
    const guardado = await db.jugadores.get(creado.ficha.id)
    expect(guardado.personaId).toBe(creado.ficha.personaId)
    expect(guardado.apellido1).toBe('Sam')
  })
})
