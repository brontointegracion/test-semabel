import 'fake-indexeddb/auto'
import Dexie from 'dexie'
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

// Crea la base tal como quedaba en la versión 7 (nombrePila + apellido, sin
// apellido1/apellido2) y le carga filas de prueba, para simular una base
// real que todavía no pasó por la migración de la versión 8.
async function sembrarComoV7(jugadores) {
  const legacy = new Dexie(NOMBRE_BD)
  legacy.version(7).stores({ jugadores: 'id, ligaId, equipoId, codigo, personaId' })
  await legacy.open()
  await legacy.table('jugadores').bulkAdd(jugadores)
  legacy.close()
}

// Crea la base tal como quedaba antes de la versión 7: mismo índice de
// jugadores que las versiones 5 y 6 reales ('id, ligaId, equipoId, codigo,
// personaId'), pero con filas que todavía no pasaron por ningún backfill —
// sin personaId, sin nombrePila, sin apellido. Solo existe nombre, que es lo
// único que el jugador siempre tuvo.
async function sembrarComoPreV7(jugadores) {
  const legacy = new Dexie(NOMBRE_BD)
  legacy.version(6).stores({ jugadores: 'id, ligaId, equipoId, codigo, personaId' })
  await legacy.open()
  await legacy.table('jugadores').bulkAdd(jugadores)
  legacy.close()
}

// Reimporta src/db.js con un registro de módulos limpio, para que cada test
// abra su propia instancia de Dexie('sebel') en vez de reutilizar una ya
// abierta contra una base que el test anterior borró.
async function abrirDbReal() {
  const mod = await import('./db.js')
  await mod.db.jugadores.toArray()
  return mod.db
}

beforeEach(async () => {
  await borrarBd()
  vi.resetModules()
})

afterEach(async () => {
  await borrarBd()
})

describe('migración v7 → v8: apellido → apellido1/apellido2', () => {
  it('copia apellido a apellido1, agrega apellido2 vacío y borra apellido', async () => {
    await sembrarComoV7([
      {
        id: 'j1', ligaId: 'l1', equipoId: 'e1', codigo: '1001', personaId: 'p1',
        nombre: 'Miguel Sam Robles', nombrePila: 'Miguel Sam', apellido: 'Robles',
        dorsal: 10, activo: true,
      },
    ])

    const db = await abrirDbReal()
    const j = await db.jugadores.get('j1')

    expect(j.apellido1).toBe('Robles')
    expect(j.apellido2).toBe('')
    expect(j).not.toHaveProperty('apellido')
  })

  it('preserva personaId exactamente, sin regenerarlo', async () => {
    await sembrarComoV7([
      {
        id: 'j1', ligaId: 'l1', equipoId: 'e1', codigo: '1001', personaId: 'p-original-123',
        nombre: 'Ana Julia Rodríguez', nombrePila: 'Ana Julia', apellido: 'Rodríguez',
        dorsal: 7, activo: true,
      },
    ])

    const db = await abrirDbReal()
    const j = await db.jugadores.get('j1')

    expect(j.personaId).toBe('p-original-123')
  })

  it('preserva mayúsculas, acentos y apellidos compuestos con guion tal cual', async () => {
    await sembrarComoV7([
      {
        id: 'j1', ligaId: 'l1', equipoId: 'e1', codigo: '1001', personaId: 'p1',
        nombre: 'José Pérez', nombrePila: 'José', apellido: 'María-José Pérez',
        dorsal: 5, activo: true,
      },
    ])

    const db = await abrirDbReal()
    const j = await db.jugadores.get('j1')

    expect(j.apellido1).toBe('María-José Pérez')
  })

  it('no corrompe una fila que ya está en la forma nueva (apellido1/apellido2 ya presentes)', async () => {
    await sembrarComoV7([
      {
        id: 'legado', ligaId: 'l1', equipoId: 'e1', codigo: '1001', personaId: 'p1',
        nombre: 'Miguel Robles', nombrePila: 'Miguel', apellido: 'Robles',
        dorsal: 10, activo: true,
      },
      {
        id: 'ya-migrado', ligaId: 'l1', equipoId: 'e1', codigo: '1002', personaId: 'p2',
        nombre: 'Ana Julia Rodríguez Solís', nombrePila: 'Ana Julia',
        apellido1: 'Rodríguez', apellido2: 'Solís',
        dorsal: 11, activo: true,
      },
    ])

    const db = await abrirDbReal()

    const legado = await db.jugadores.get('legado')
    expect(legado.apellido1).toBe('Robles')
    expect(legado.apellido2).toBe('')
    expect(legado).not.toHaveProperty('apellido')

    const yaMigrado = await db.jugadores.get('ya-migrado')
    expect(yaMigrado.apellido1).toBe('Rodríguez')
    expect(yaMigrado.apellido2).toBe('Solís')
    expect(yaMigrado).not.toHaveProperty('apellido')
  })
})

describe('migración pre-v7 → v7 → v8 (cadena completa desde una base histórica real)', () => {
  it('respalda personaId/nombrePila/apellido1 en v7 y los reparte en v8, en una sola apertura', async () => {
    await sembrarComoPreV7([
      {
        id: 'j1', ligaId: 'l1', equipoId: 'e1', codigo: '1001',
        // Sin personaId, sin nombrePila, sin apellido: exactamente lo que
        // existía antes de la versión 7. "Carlos Vega" es inequívoco: un
        // solo apellido, sin margen para confundir dónde termina el nombre.
        nombre: 'Carlos Vega', dorsal: 9, activo: true,
      },
    ])

    const db = await abrirDbReal()
    const j = await db.jugadores.get('j1')

    // personaId lo generó el backfill de v7: no hay valor previo que comparar,
    // solo que exista y no esté vacío.
    expect(typeof j.personaId).toBe('string')
    expect(j.personaId.length).toBeGreaterThan(0)

    expect(j.nombrePila).toBe('Carlos')
    expect(j.apellido1).toBe('Vega')
    expect(j.apellido1).not.toBeUndefined()
    expect(j.apellido2).toBe('')
    expect(j).not.toHaveProperty('apellido')
  })
})
