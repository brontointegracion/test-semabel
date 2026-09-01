import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'

const NOMBRE_BD = 'sebel'

function borrarBd() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(NOMBRE_BD)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

describe('sembrarSiHaceFalta', () => {
  it('los jugadores sembrados usan apellido1/apellido2, nunca apellido', async () => {
    await borrarBd()

    const { db } = await import('./db.js')
    const { sembrarSiHaceFalta } = await import('./seed.js')
    await sembrarSiHaceFalta()

    const jugadores = await db.jugadores.toArray()
    expect(jugadores.length).toBeGreaterThan(0)

    for (const j of jugadores) {
      expect(typeof j.apellido1).toBe('string')
      expect(typeof j.apellido2).toBe('string')
      expect(j).not.toHaveProperty('apellido')
    }
  })
})
