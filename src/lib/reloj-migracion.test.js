import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Una base que ya está en la versión 9 sube a la 10 conservando todo y con la
// tabla de auditoría vacía: no se inventa historia para lo que ya existía.

const NOMBRE_BD = 'sebel'

function borrarBd() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(NOMBRE_BD)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  await borrarBd()
  vi.resetModules()
})

afterEach(async () => {
  const { db } = await import('../db.js')
  db.close()
  await borrarBd()
})

describe('migración v9 → v10', () => {
  it('conserva todas las filas existentes y arranca con la auditoría vacía', async () => {
    const { db } = await import('../db.js')
    // El esquema de la versión 9: el actual sin la tabla nueva.
    const tablaNueva = 'auditoriaReloj'
    const esquemaV9 = Object.fromEntries(
      db.tables
        .filter((t) => t.name !== tablaNueva)
        .map((t) => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(',')]),
    )
    expect(Object.keys(esquemaV9)).toContain('auditoria') // la auditoría de fichas ya existía en v9

    const filas = {
      ligas: [{ id: 'L', codigo: '4821', nombre: 'Liga', deporte: 'baloncesto' }],
      partidos: [{ id: 'P', ligaId: 'L', codigo: '7531', estado: 'vivo', relojEstado: 'corriendo', relojRestante: 5000, relojDesde: 123 }],
      eventos: [{ id: 'e1', partidoId: 'P', seq: 1, tipo: 'punto', puntos: 2, periodo: 1, anulado: false }],
      jugadores: [{ id: 'j1', ligaId: 'L', equipoId: 'E', codigo: '1111', personaId: 'p1', nombre: 'Ana' }],
      auditoria: [{ id: 'a1', fichaId: 'j1', tipo: 'created', ts: '2026-01-01T00:00:00.000Z', seq: 0, actorId: null }],
      cuenta: [{ id: 'yo', saldo: 7 }],
      meta: [{ id: 'sesion', rol: 'organizador', cuentaId: 'yo' }],
    }

    const viejo = new Dexie(NOMBRE_BD)
    viejo.version(9).stores(esquemaV9)
    await viejo.open()
    expect(viejo.verno).toBe(9)
    for (const [tabla, rows] of Object.entries(filas)) await viejo.table(tabla).bulkAdd(rows)
    viejo.close()

    await db.open() // la app: sube a la versión 10
    expect(db.verno).toBe(10)
    for (const [tabla, rows] of Object.entries(filas)) {
      expect(await db.table(tabla).toArray()).toEqual(rows)
    }
    expect(await db.auditoriaReloj.count()).toBe(0)
    // La tabla nueva funciona y su orden por partido es único.
    await db.auditoriaReloj.add({ id: 'r1', partidoId: 'P', seq: 1 })
    await expect(db.auditoriaReloj.add({ id: 'r2', partidoId: 'P', seq: 1 })).rejects.toThrow()
    await db.auditoriaReloj.add({ id: 'r3', partidoId: 'Q', seq: 1 })
  })
})
