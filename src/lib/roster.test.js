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

describe('nombreCamiseta', () => {
  it('se guarda recortado y con espacios colapsados; nombre y datos de identidad no cambian', async () => {
    const { db, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const r = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombreCamiseta: '   El   Profe  ' },
    })
    expect(r.tipo).toBe('creado')
    const guardado = await db.jugadores.get(r.ficha.id)
    expect(guardado.nombreCamiseta).toBe('El Profe')
    expect(guardado.nombre).toBe('Miguel Sam Robles')
    expect(guardado.dorsal).toBe(10)
  })

  it('omitido o en blanco al crear se guarda como cadena vacía', async () => {
    const { db, agregarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const a = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: camposBase })
    const b = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipoA.id,
      campos: { ...camposBase, nombrePila: 'Ana', apellido1: 'Torres', apellido2: '', dorsal: 4, nombreCamiseta: '   ' },
    })
    expect((await db.jugadores.get(a.ficha.id)).nombreCamiseta).toBe('')
    expect((await db.jugadores.get(b.ficha.id)).nombreCamiseta).toBe('')
  })

  it('20 caracteres es válido; 21 se rechaza (tras normalizar) y no escribe nada', async () => {
    const { db, agregarJugador, validarCamposJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    expect(validarCamposJugador({ ...camposBase, nombreCamiseta: 'a'.repeat(20) })).toEqual({})
    expect(validarCamposJugador({ ...camposBase, nombreCamiseta: `  ${'a'.repeat(20)}  ` })).toEqual({})
    expect(validarCamposJugador({ ...camposBase, nombreCamiseta: 'a'.repeat(21) }).nombreCamiseta).toBe('Máximo 20 caracteres.')

    const r = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombreCamiseta: 'a'.repeat(21) },
    })
    expect(r.tipo).toBe('invalido')
    expect(r.errores.nombreCamiseta).toBeTruthy()
    expect(await db.jugadores.count()).toBe(0)
  })

  it('editar: cambiar, vaciar y omitir (se conserva el valor existente)', async () => {
    const { db, agregarJugador, editarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const creado = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombreCamiseta: 'SAM' },
    })
    const id = creado.ficha.id

    await editarJugador({ sesion: sesionDueno, liga, ficha: creado.ficha, campos: { dorsal: 11 } })
    expect((await db.jugadores.get(id)).nombreCamiseta).toBe('SAM')

    await editarJugador({ sesion: sesionDueno, liga, ficha: creado.ficha, campos: { nombreCamiseta: '  MIKE  ' } })
    expect((await db.jugadores.get(id)).nombreCamiseta).toBe('MIKE')

    await editarJugador({ sesion: sesionDueno, liga, ficha: creado.ficha, campos: { nombreCamiseta: '   ' } })
    expect((await db.jugadores.get(id)).nombreCamiseta).toBe('')

    const largo = await editarJugador({ sesion: sesionDueno, liga, ficha: creado.ficha, campos: { nombreCamiseta: 'a'.repeat(21) } })
    expect(largo.tipo).toBe('invalido')
    expect((await db.jugadores.get(id)).nombreCamiseta).toBe('')
  })

  it('una ficha anterior al campo sigue sin él tras una edición que no lo envía', async () => {
    const { db, agregarJugador, editarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const creado = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: camposBase })
    await db.jugadores.where('id').equals(creado.ficha.id).modify((j) => { delete j.nombreCamiseta })

    await editarJugador({ sesion: sesionDueno, liga, ficha: creado.ficha, campos: { dorsal: 12 } })
    const viva = await db.jugadores.get(creado.ficha.id)
    expect('nombreCamiseta' in viva).toBe(false)
    expect(viva.dorsal).toBe(12)
  })

  it('editar nombreCamiseta no cambia id, codigo, personaId ni nombre, y no dispara el chequeo de duplicados', async () => {
    const { db, agregarJugador, editarJugador } = await cargar()
    const { liga, equipoA } = await sembrarLiga(db)
    const a = await agregarJugador({ sesion: sesionDueno, liga, equipoId: equipoA.id, campos: camposBase })
    // Otra ficha con el mismo nombre completo: un cambio de nombre sí pediría resolver duplicados.
    await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, dorsal: 22 },
      resolucionIdentidad: { tipo: 'otra-persona' },
    })
    const antes = await db.jugadores.get(a.ficha.id)
    const r = await editarJugador({ sesion: sesionDueno, liga, ficha: a.ficha, campos: { nombreCamiseta: 'SAM' } })
    expect(r.tipo).toBe('editado')
    const despues = await db.jugadores.get(a.ficha.id)
    for (const k of ['id', 'codigo', 'personaId', 'nombre', 'nombrePila', 'apellido1', 'apellido2', 'equipoId', 'dorsal']) {
      expect(despues[k]).toEqual(antes[k])
    }
  })

  it('la misma persona puede tener nombres de camiseta distintos en equipos distintos, y no se usa para detectar duplicados', async () => {
    const { db, agregarJugador } = await cargar()
    const { liga, equipoA, equipoB } = await sembrarLiga(db)
    const enA = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipoA.id, campos: { ...camposBase, nombreCamiseta: 'SAM' },
    })
    const enB = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipoB.id, campos: { ...camposBase, nombreCamiseta: 'MIKE' },
      resolucionIdentidad: { tipo: 'misma-persona', personaId: enA.ficha.personaId },
    })
    expect(enB.tipo).toBe('creado')
    expect(enB.ficha.personaId).toBe(enA.ficha.personaId)
    expect((await db.jugadores.get(enA.ficha.id)).nombreCamiseta).toBe('SAM')
    expect((await db.jugadores.get(enB.ficha.id)).nombreCamiseta).toBe('MIKE')

    // Un nombre en camiseta igual al nombre de otra persona no genera candidatos.
    const otro = await agregarJugador({
      sesion: sesionDueno, liga, equipoId: equipoA.id,
      campos: { nombrePila: 'Luis', apellido1: 'Paz', apellido2: '', dorsal: 30, nombreCamiseta: 'Miguel Sam Robles' },
    })
    expect(otro.tipo).toBe('creado')
  })
})

// ---------------------------------------------------------------------------
// Política del piloto: solo jugadores con número. Toda alta, edición y reactivación
// termina con un entero válido de 0 a 99; el parámetro heredado `numeroPendiente`
// ya no autoriza nada. Un registro anterior sin número válido no se borra ni se
// repara solo: se corrige dándole uno (y mientras no lo tenga, no se edita ni se
// reactiva). El analizador estricto, el 0 real, la unicidad entre activos y la
// identidad se conservan.
// ---------------------------------------------------------------------------

const MENSAJE_OBLIGATORIO = 'El número es obligatorio.'
const MENSAJE_RANGO = 'El número debe ser un entero entre 0 y 99.'
const MENSAJE_PENDIENTE = 'En el piloto cada jugador necesita un número del 0 al 99; no se puede dejar pendiente.'
const NOMBRES_UNICOS = [
  ['Ana', 'Torres'], ['Beto', 'Luna'], ['Carla', 'Mora'], ['Dario', 'Pino'], ['Eva', 'Rios'], ['Fede', 'Sol'],
  ['Gus', 'Vera'], ['Hugo', 'Zapata'], ['Iris', 'Campos'], ['Joel', 'Duarte'], ['Kira', 'Espino'], ['Lalo', 'Fuentes'],
]
const porId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const INTENCIONES_HEREDADAS = [true, 'true', 'si', 1, 0, null, [], {}]

async function entorno() {
  const m = await cargar()
  const { db } = m
  const { liga, equipoA, equipoB } = await sembrarLiga(db)
  let usados = 0
  const alta = (extra = {}, { equipo = equipoA, sesion = sesionDueno } = {}) => {
    const [nombrePila, apellido1] = NOMBRES_UNICOS[usados++ % NOMBRES_UNICOS.length]
    return m.agregarJugador({
      sesion, liga, equipoId: equipo.id, campos: { nombrePila, apellido1, apellido2: '', fechaNacimiento: '', ...extra },
    })
  }
  const editar = (ficha, campos, sesion = sesionDueno) => m.editarJugador({ sesion, liga, ficha, campos })
  const foto = async () => ({
    jugadores: (await db.jugadores.toArray()).sort(porId),
    auditoria: (await db.auditoria.toArray()).sort(porId),
    eventos: (await db.eventos.toArray()).sort(porId),
  })
  const bruto = (ficha) => db.jugadores.get(ficha.id)
  // Un registro anterior sin número válido (no se puede crear con el dominio): se siembra directo.
  const legado = async (extra = {}, equipo = equipoA) => {
    const [nombrePila, apellido1] = NOMBRES_UNICOS[usados++ % NOMBRES_UNICOS.length]
    const ficha = {
      id: `legado-${usados}`, codigo: `9${usados}00`, ligaId: liga.id, equipoId: equipo.id, personaId: `persona-${usados}`,
      nombrePila, apellido1, apellido2: '', nombre: `${nombrePila} ${apellido1}`, nombreCamiseta: '', reclamado: false, activo: true, ...extra,
    }
    await db.jugadores.add(ficha)
    return ficha
  }
  return { ...m, db, liga, equipoA, equipoB, alta, editar, foto, bruto, legado }
}

describe('solo con número: alta', () => {
  it('cada forma válida de número se guarda como entero', async () => {
    const { alta, bruto, db } = await entorno()
    const casos = [[0, 0], ['007', 7], [' 12 ', 12], ['99', 99], [5, 5], ['1', 1]]
    for (const [entrada, esperado] of casos) {
      const r = await alta({ dorsal: entrada })
      expect(r.tipo, String(entrada)).toBe('creado')
      expect((await bruto(r.ficha)).dorsal).toBe(esperado)
      await db.jugadores.update(r.ficha.id, { activo: false })
    }
  })

  it('en blanco, ausente, nulo o mal formado se rechaza y no escribe nada', async () => {
    const { alta, foto } = await entorno()
    const antes = await foto()
    for (const extra of [{}, { dorsal: undefined }, { dorsal: null }, { dorsal: '' }, { dorsal: '   ' }, { dorsal: '\t\n' }]) {
      expect(await alta(extra), JSON.stringify(extra)).toMatchObject({ tipo: 'invalido', errores: { dorsal: MENSAJE_OBLIGATORIO } })
    }
    for (const dorsal of ['abc', '1.5', '-1', '100', 100, -1, 1.5, NaN, Infinity, true, [], {}, '1e1', '0x10']) {
      expect(await alta({ dorsal }), String(dorsal)).toMatchObject({ tipo: 'invalido', errores: { dorsal: MENSAJE_RANGO } })
    }
    expect(await foto()).toEqual(antes)
  })

  it('regresión: un texto en blanco nunca se guarda como el número 0', async () => {
    const { alta, db } = await entorno()
    await alta({ dorsal: '   ' })
    expect(await db.jugadores.count()).toBe(0)
  })

  it('la intención heredada de dejar el número pendiente no autoriza nada, con o sin número', async () => {
    const { alta, foto } = await entorno()
    const antes = await foto()
    for (const numeroPendiente of INTENCIONES_HEREDADAS) {
      for (const dorsal of [undefined, '', 7]) {
        const r = await alta({ dorsal, numeroPendiente })
        expect(r.tipo, `${String(numeroPendiente)} / ${String(dorsal)}`).toBe('invalido')
        expect(r.errores.numeroPendiente).toBe(MENSAJE_PENDIENTE)
      }
    }
    expect(await foto()).toEqual(antes)
  })

  it('numeroPendiente: false o ausente se tolera: es lo mismo que no mandarlo', async () => {
    const { alta } = await entorno()
    expect((await alta({ dorsal: 3, numeroPendiente: false })).tipo).toBe('creado')
    expect((await alta({ dorsal: 4, numeroPendiente: undefined })).tipo).toBe('creado')
  })

  it('la unicidad aplica entre activos del mismo equipo, también el 0 en cualquiera de sus escrituras', async () => {
    const { alta, equipoB, db } = await entorno()
    expect((await alta({ dorsal: 0 })).tipo).toBe('creado')
    for (const dorsal of [0, '0', '00', ' 0 ']) {
      expect(await alta({ dorsal }), String(dorsal)).toEqual({ tipo: 'conflicto-numero' })
    }
    expect((await alta({ dorsal: 0 }, { equipo: equipoB })).tipo).toBe('creado')
    expect(await db.jugadores.count()).toBe(2)
  })

  it('un jugador inactivo no reserva el número', async () => {
    const { alta, desactivarJugador, liga } = await entorno()
    const a = await alta({ dorsal: 8 })
    await desactivarJugador({ sesion: sesionDueno, liga, ficha: a.ficha })
    expect((await alta({ dorsal: 8 })).tipo).toBe('creado')
  })

  it('un nombre de una letra y sin fecha de nacimiento se aceptan', async () => {
    const { alta, bruto } = await entorno()
    const r = await alta({ nombrePila: 'J', apellido1: 'Pérez', dorsal: 5 })
    expect(r.tipo).toBe('creado')
    const f = await bruto(r.ficha)
    expect(f.nombrePila).toBe('J')
    expect(f.fechaNacimiento).toBeUndefined()
  })

  it('la resolución de duplicados sigue igual', async () => {
    const m = await entorno()
    const original = await m.alta({ nombrePila: 'Mara', apellido1: 'Quiroz', dorsal: 6 })
    const candidato = await m.alta({ nombrePila: 'mara', apellido1: 'QUIROZ', dorsal: 6 }, { equipo: m.equipoB })
    expect(candidato.tipo).toBe('candidatos')
    expect(candidato.candidatos[0]).toMatchObject({ fichaId: original.ficha.id, dorsal: 6 })
    const misma = await m.alta(
      { nombrePila: 'mara', apellido1: 'QUIROZ', dorsal: 6 }, { equipo: m.equipoB },
    )
    expect(misma.tipo).toBe('candidatos')
    const r = await m.agregarJugador({
      sesion: sesionDueno, liga: m.liga, equipoId: m.equipoB.id,
      campos: { nombrePila: 'Mara', apellido1: 'Quiroz', apellido2: '', fechaNacimiento: '', dorsal: 6 },
      resolucionIdentidad: { tipo: 'misma-persona', personaId: original.ficha.personaId },
    })
    expect(r.tipo).toBe('creado')
    expect(r.ficha.personaId).toBe(original.ficha.personaId)
    expect((await m.bruto(r.ficha)).dorsal).toBe(6)
  })

  it('un llamador sin permiso no puede guardar a nadie', async () => {
    const { alta, foto } = await entorno()
    const antes = await foto()
    await expect(alta({ dorsal: 3 }, { sesion: sesionOtro })).rejects.toThrow('No autorizado')
    await expect(alta({ dorsal: 3 }, { sesion: sesionVisitante })).rejects.toThrow('No autorizado')
    expect(await foto()).toEqual(antes)
  })

  it('validarCamposJugador: exige número, no acepta la intención heredada y el blanco no pasa por 0', async () => {
    const { validarCamposJugador } = await entorno()
    expect(validarCamposJugador({ ...camposBase, dorsal: 0 })).toEqual({})
    expect(validarCamposJugador({ ...camposBase, dorsal: '' })).toEqual({ dorsal: MENSAJE_OBLIGATORIO })
    expect(validarCamposJugador({ ...camposBase, dorsal: '   ' })).toEqual({ dorsal: MENSAJE_OBLIGATORIO })
    expect(validarCamposJugador({ ...camposBase, dorsal: 'x' })).toEqual({ dorsal: MENSAJE_RANGO })
    expect(validarCamposJugador({ ...camposBase, dorsal: '', numeroPendiente: true }))
      .toEqual({ dorsal: MENSAJE_OBLIGATORIO, numeroPendiente: MENSAJE_PENDIENTE })
    expect(validarCamposJugador({ ...camposBase, dorsal: 7, numeroPendiente: true })).toEqual({ numeroPendiente: MENSAJE_PENDIENTE })
    expect(validarCamposJugador({ ...camposBase, dorsal: 7, numeroPendiente: false })).toEqual({})
  })
})

describe('solo con número: edición', () => {
  it('un cambio de nombre conserva el número válido, la identidad y la historia', async () => {
    const { alta, editar, bruto, db } = await entorno()
    const a = await alta({ dorsal: 9 })
    const antes = await bruto(a.ficha)
    const r = await editar(a.ficha, { nombrePila: 'Anita' })
    expect(r.tipo).toBe('editado')
    const f = await bruto(a.ficha)
    expect(f).toMatchObject({ id: antes.id, personaId: antes.personaId, codigo: antes.codigo, dorsal: 9, nombrePila: 'Anita' })
    expect((await db.auditoria.toArray()).filter((x) => x.tipo === 'edited')).toHaveLength(1)
  })

  it('el mismo número, otro número, el 0 y los ceros a la izquierda se aceptan; el 0 también es único', async () => {
    const { alta, editar, bruto } = await entorno()
    const a = await alta({ dorsal: 9 })
    const b = await alta({ dorsal: 10 })
    expect((await editar(a.ficha, { dorsal: 9 })).tipo).toBe('editado')
    expect((await editar(a.ficha, { dorsal: '007' })).tipo).toBe('editado')
    expect((await bruto(a.ficha)).dorsal).toBe(7)
    expect((await editar(a.ficha, { dorsal: '0' })).tipo).toBe('editado')
    expect((await bruto(a.ficha)).dorsal).toBe(0)
    for (const dorsal of [0, '0', '00']) expect(await editar(b.ficha, { dorsal })).toEqual({ tipo: 'conflicto-numero' })
    expect((await bruto(b.ficha)).dorsal).toBe(10)
  })

  it('un número ocupado por un compañero activo rechaza y no cambia nada', async () => {
    const { alta, editar, foto } = await entorno()
    const a = await alta({ dorsal: 3 })
    await alta({ dorsal: 4 })
    const antes = await foto()
    expect(await editar(a.ficha, { dorsal: 4 })).toEqual({ tipo: 'conflicto-numero' })
    expect(await foto()).toEqual(antes)
  })

  it('en blanco, nulo o mal formado se rechaza; borrar el número ya no es posible y nada cambia', async () => {
    const { alta, editar, foto } = await entorno()
    const a = await alta({ dorsal: 9 })
    const antes = await foto()
    for (const dorsal of ['', '   ', null]) {
      expect(await editar(a.ficha, { dorsal }), String(dorsal)).toMatchObject({ tipo: 'invalido', errores: { dorsal: MENSAJE_OBLIGATORIO } })
    }
    for (const dorsal of ['x', 100, -1, 1.5, NaN, true]) {
      expect(await editar(a.ficha, { dorsal }), String(dorsal)).toMatchObject({ tipo: 'invalido', errores: { dorsal: MENSAJE_RANGO } })
    }
    expect(await foto()).toEqual(antes)
  })

  it('la intención heredada de dejarlo pendiente no puede borrar el número ni acompañar un cambio', async () => {
    const { alta, editar, foto, bruto } = await entorno()
    const a = await alta({ dorsal: 9 })
    const antes = await foto()
    for (const numeroPendiente of INTENCIONES_HEREDADAS) {
      for (const extra of [{}, { dorsal: '' }, { dorsal: 12 }, { nombrePila: 'Otro' }]) {
        const r = await editar(a.ficha, { ...extra, numeroPendiente })
        expect(r.tipo, `${String(numeroPendiente)} ${JSON.stringify(extra)}`).toBe('invalido')
        expect(r.errores.numeroPendiente).toBe(MENSAJE_PENDIENTE)
      }
    }
    expect(await foto()).toEqual(antes)
    expect((await bruto(a.ficha)).dorsal).toBe(9)
  })

  it('un registro anterior sin número válido no se edita hasta recibir uno; el rechazo lo deja intacto', async () => {
    const { legado, editar, foto, bruto } = await entorno()
    const l = await legado()
    const antes = await foto()
    const original = await bruto(l)
    expect(await editar(l, { nombrePila: 'Nuevo' })).toMatchObject({ tipo: 'invalido', errores: { dorsal: MENSAJE_OBLIGATORIO } })
    expect(await editar(l, { nombrePila: 'Nuevo', dorsal: '' })).toMatchObject({ tipo: 'invalido', errores: { dorsal: MENSAJE_OBLIGATORIO } })
    expect(await editar(l, { dorsal: 'x' })).toMatchObject({ tipo: 'invalido', errores: { dorsal: MENSAJE_RANGO } })
    expect(await editar(l, { nombrePila: 'Nuevo', numeroPendiente: true })).toMatchObject({ tipo: 'invalido' })
    expect(await foto()).toEqual(antes)
    expect(await bruto(l)).toEqual(original)
  })

  it.each([['ausente', {}], ['nulo', { dorsal: null }], ['cadena vacía', { dorsal: '' }], ['NaN', { dorsal: NaN }], ['texto', { dorsal: '07' }]])(
    'un registro anterior con número %s cuenta como sin número', async (_n, extra) => {
      const { legado, editar, foto } = await entorno()
      const l = await legado(extra)
      const antes = await foto()
      expect((await editar(l, { nombrePila: 'Nuevo' })).tipo).toBe('invalido')
      expect(await foto()).toEqual(antes)
    })

  it('darle un número válido a un registro anterior conserva identidad e historia y valida unicidad', async () => {
    const { legado, alta, editar, bruto, db } = await entorno()
    const l = await legado()
    await alta({ dorsal: 4 })
    const original = await bruto(l)
    expect(await editar(l, { dorsal: 4 })).toEqual({ tipo: 'conflicto-numero' })
    expect('dorsal' in (await bruto(l))).toBe(false)
    expect((await editar(l, { dorsal: '0' })).tipo).toBe('editado')
    const f = await bruto(l)
    expect(f).toMatchObject({ id: original.id, personaId: original.personaId, codigo: original.codigo, dorsal: 0 })
    expect((await db.auditoria.toArray()).filter((x) => x.fichaId === l.id).map((x) => x.tipo)).toEqual(['edited'])
  })

  it('un cambio de nombre reactiva el chequeo de duplicados; cambiar solo el número no', async () => {
    const m = await entorno()
    const a = await m.alta({ nombrePila: 'Mara', apellido1: 'Quiroz', dorsal: 3 })
    const b = await m.alta({ nombrePila: 'Otro', apellido1: 'Nombre', dorsal: 4 })
    expect((await m.editar(a.ficha, { dorsal: 5 })).tipo).toBe('editado')
    const r = await m.editar(b.ficha, { nombrePila: 'mara', apellido1: 'QUIROZ' })
    expect(r.tipo).toBe('candidatos')
  })

  it('"conservar" se vuelve a comprobar contra la ficha releída dentro de la transacción', async () => {
    const { legado, editar, db, foto } = await entorno()
    const l = await legado() // guardado: sin número válido
    const antes = await foto()
    // La lectura previa a la transacción (copia vieja) todavía veía un número; la releída dentro no.
    vi.spyOn(db.jugadores, 'get').mockResolvedValueOnce({ ...l, dorsal: 11 })
    expect(await editar(l, { nombrePila: 'Nuevo' })).toMatchObject({ tipo: 'invalido', errores: { dorsal: MENSAJE_OBLIGATORIO } })
    vi.restoreAllMocks()
    expect(await foto()).toEqual(antes)
  })

  it('la fecha de nacimiento sigue siendo opcional al editar', async () => {
    const { alta, editar, bruto } = await entorno()
    const a = await alta({ dorsal: 2, fechaNacimiento: '2001-05-05' })
    expect((await editar(a.ficha, { fechaNacimiento: '' })).tipo).toBe('editado')
    expect((await bruto(a.ficha)).fechaNacimiento).toBeUndefined()
  })

  it('un llamador sin permiso no puede editar el número de nadie', async () => {
    const { alta, editar, foto } = await entorno()
    const a = await alta({ dorsal: 2 })
    const antes = await foto()
    await expect(editar(a.ficha, { dorsal: 3 }, sesionOtro)).rejects.toThrow('No autorizado')
    await expect(editar(a.ficha, { dorsal: 3 }, sesionVisitante)).rejects.toThrow('No autorizado')
    expect(await foto()).toEqual(antes)
  })
})

describe('solo con número: reactivación', () => {
  async function inactiva(m, extra = {}) {
    const a = await m.alta({ dorsal: 8, ...extra })
    await m.desactivarJugador({ sesion: sesionDueno, liga: m.liga, ficha: a.ficha })
    return a.ficha
  }
  const reactivar = (m, ficha, extra = {}, sesion = sesionDueno) => m.reactivarJugador({ sesion, liga: m.liga, ficha, ...extra })

  it('restaura el número anterior si sigue libre', async () => {
    const m = await entorno()
    const f = await inactiva(m)
    const r = await reactivar(m, f)
    expect(r.tipo).toBe('reactivado')
    expect((await m.bruto(f))).toMatchObject({ activo: true, dorsal: 8 })
  })

  it('con el número anterior tomado pide uno disponible; con uno disponible reactiva', async () => {
    const m = await entorno()
    const f = await inactiva(m)
    await m.alta({ nombrePila: 'Otro', apellido1: 'Tomador', dorsal: 8 })
    expect(await reactivar(m, f)).toEqual({ tipo: 'conflicto-numero' })
    expect((await m.bruto(f)).activo).toBe(false)
    expect(await reactivar(m, f, { nuevoDorsal: 8 })).toEqual({ tipo: 'conflicto-numero' })
    expect((await reactivar(m, f, { nuevoDorsal: '0' })).tipo).toBe('reactivado')
    expect(await m.bruto(f)).toMatchObject({ activo: true, dorsal: 0 })
  })

  it('un número duplicado, incluido el 0, rechaza sin cambios', async () => {
    const m = await entorno()
    const f = await inactiva(m)
    await m.alta({ nombrePila: 'Cero', apellido1: 'Dueño', dorsal: 0 })
    const antes = await m.foto()
    for (const nuevoDorsal of [0, '0', '00']) expect(await reactivar(m, f, { nuevoDorsal })).toEqual({ tipo: 'conflicto-numero' })
    expect(await m.foto()).toEqual(antes)
  })

  it('un registro anterior sin número válido no se reactiva sin uno: queda inactivo y sin cambios', async () => {
    const m = await entorno()
    const l = await m.legado({ activo: false, desactivadoEn: '2026-01-01T00:00:00.000Z' })
    const antes = await m.foto()
    expect(await reactivar(m, l)).toMatchObject({ tipo: 'invalido', errores: { dorsal: MENSAJE_OBLIGATORIO } })
    for (const nuevoDorsal of ['', '   ', null, 'x', 100]) {
      expect((await reactivar(m, l, { nuevoDorsal })).tipo, String(nuevoDorsal)).toBe('invalido')
    }
    expect(await m.foto()).toEqual(antes)
  })

  it('un registro anterior se reactiva con un número válido disponible, conservando identidad e historia', async () => {
    const m = await entorno()
    const l = await m.legado({ activo: false, desactivadoEn: '2026-01-01T00:00:00.000Z' })
    const original = await m.bruto(l)
    expect((await reactivar(m, l, { nuevoDorsal: '012' })).tipo).toBe('reactivado')
    expect(await m.bruto(l)).toMatchObject({ id: original.id, personaId: original.personaId, codigo: original.codigo, activo: true, dorsal: 12 })
    expect((await m.db.auditoria.toArray()).filter((a) => a.fichaId === l.id).map((a) => a.tipo)).toEqual(['reactivated'])
  })

  it('la intención heredada de dejarlo pendiente no autoriza nada, con número, sin número o con registro anterior', async () => {
    const m = await entorno()
    const f = await inactiva(m)
    const l = await m.legado({ activo: false, desactivadoEn: '2026-01-01T00:00:00.000Z' })
    const antes = await m.foto()
    for (const numeroPendiente of INTENCIONES_HEREDADAS) {
      for (const ficha of [f, l]) {
        for (const extra of [{}, { nuevoDorsal: '' }, { nuevoDorsal: 5 }]) {
          const r = await reactivar(m, ficha, { ...extra, numeroPendiente })
          expect(r.tipo, `${String(numeroPendiente)} ${JSON.stringify(extra)}`).toBe('invalido')
          expect(r.errores.numeroPendiente).toBe(MENSAJE_PENDIENTE)
        }
      }
    }
    expect(await m.foto()).toEqual(antes)
  })

  it('valores mal formados se rechazan sin cambios', async () => {
    const m = await entorno()
    const f = await inactiva(m)
    const antes = await m.foto()
    for (const nuevoDorsal of ['abc', '1.5', -1, 100, NaN, true, []]) {
      expect(await reactivar(m, f, { nuevoDorsal }), String(nuevoDorsal)).toMatchObject({ tipo: 'invalido', errores: { dorsal: MENSAJE_RANGO } })
    }
    expect(await m.foto()).toEqual(antes)
  })

  it('conserva id, personaId, codigo e historial, y la auditoría registra la reactivación', async () => {
    const m = await entorno()
    const f = await inactiva(m)
    expect((await reactivar(m, f)).tipo).toBe('reactivado')
    const g = await m.bruto(f)
    expect(g).toMatchObject({ id: f.id, personaId: f.personaId, codigo: f.codigo })
    expect((await m.db.auditoria.toArray()).filter((a) => a.fichaId === f.id).map((a) => a.tipo).sort())
      .toEqual(['created', 'deactivated', 'reactivated'])
  })

  it('un llamador sin permiso no puede reactivar', async () => {
    const m = await entorno()
    const f = await inactiva(m)
    await expect(reactivar(m, f, {}, sesionOtro)).rejects.toThrow('No autorizado')
    expect((await m.bruto(f)).activo).toBe(false)
  })
})
