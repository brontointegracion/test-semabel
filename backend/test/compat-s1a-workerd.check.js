import { describe, expect, it } from 'vitest'

// REPORT_120, experimento 1: ¿se puede cargar el núcleo S1a (src/lib/control/sesion-*.js, reloj-telefono.js) dentro del
// runtime de Workers (workerd), con sus importaciones SIN extensión, y funciona fake-indexeddb ahí? Cada prueba importa de
// forma dinámica para que un fallo de una importación no oculte las demás. Los fallos se dejan fallar: no se debilita nada.

describe('E1 — importaciones del motor y del núcleo S1a en workerd', () => {
  it('motor con extensión explícita (como ya hacen las pruebas del backend)', async () => {
    const m = await import('../../src/lib/motor/reglas.js')
    expect(typeof m.decidirOrden).toBe('function')
  })
  it('índice del motor por DIRECTORIO (así lo importa S1a: from "../motor")', async () => {
    const m = await import('../../src/lib/motor')
    expect(typeof m.encolar).toBe('function')
  })
  it('sesion-motor.js (importa "../motor")', async () => {
    const m = await import('../../src/lib/control/sesion-motor.js')
    expect(typeof m.prepararEncolado).toBe('function')
  })
  it('reloj-telefono.js (importa "../motor")', async () => {
    const m = await import('../../src/lib/control/reloj-telefono.js')
    expect(typeof m.estimar).toBe('function')
  })
  it('sesion-almacen.js (importa "./sesion-motor", sin extensión)', async () => {
    const m = await import('../../src/lib/control/sesion-almacen.js')
    expect(typeof m.abrirAlmacen).toBe('function')
  })
  it('fake-indexeddb/auto instala indexedDB en el runtime', async () => {
    await import('fake-indexeddb/auto')
    expect(typeof globalThis.indexedDB?.open).toBe('function')
    expect(typeof globalThis.IDBKeyRange).toBe('function')
  })

  // IMPORTANTE: fake-indexeddb es una EMULACIÓN en JavaScript de IndexedDB, también dentro de workerd. Esta prueba demuestra
  // que el almacén S1a (transacciones, abortos, índice único) funciona sobre esa emulación en este runtime. NO prueba
  // IndexedDB real de un navegador (durabilidad, cuota real, Web Locks): eso es del navegador aislado de S1b.
  it('almacén S1a sobre fake-indexeddb en workerd: operaciones, aborto atómico e índice único', async () => {
    await import('fake-indexeddb/auto')
    const aux = await import('../../src/lib/control/prueba/auxiliares-sesion.js')
    const banco = aux.servidorNuevo()
    const tel = await aux.telefonoNuevo(banco)
    expect((await tel.crear()).ok).toBe(true)
    expect((await tel.iniciar()).ok).toBe(true)
    expect((await tel.enviarSiguiente()).aplicado.ok).toBe(true)
    const volcar = () => new Promise((resolver, rechazar) => {
      const tx = tel.almacen.db.transaction(['sesiones', 'entradas', 'meta'], 'readonly')
      const out = {}
      for (const nombre of ['sesiones', 'entradas', 'meta']) { const r = tx.objectStore(nombre).getAll(); r.onsuccess = () => { out[nombre] = r.result } }
      tx.oncomplete = () => resolver(JSON.stringify(out))
      tx.onerror = () => rechazar(tx.error)
    })
    const punto = () => ({ cmdId: 'wd-1', tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, tiempo: { accionTs: aux.T0, accionTsCrudo: aux.T0, ajusteTsMs: 0, discontinuidad: null } })
    const antes = await volcar()
    for (const cuando of [(i) => i.fase === 'escribir' && i.n === 1, (i) => i.fase === 'escribir' && i.n === 3, (i) => i.fase === 'antes-de-confirmar']) {
      tel.almacen.gancho = (i) => { if (cuando(i)) throw new DOMException('simulada', 'QuotaExceededError') }
      const r = await tel.encolar(punto())
      tel.almacen.gancho = null
      expect(r).toMatchObject({ ok: false, motivo: 'almacenamiento', cuota: true })
      expect(await volcar()).toBe(antes)
    }
    const ok = await tel.encolar(punto())
    expect(ok.ok).toBe(true)
    expect(ok.sobre.clientSeq).toBe(2)
    // índice único [id, cmdId]: una fila cruda con el mismo cmdId aborta
    const fila = (await tel.leer()).entradas.find((f) => f.cmdId === 'wd-1')
    const error = await new Promise((resolver) => {
      const tx = tel.almacen.db.transaction(['entradas'], 'readwrite')
      tx.objectStore('entradas').put({ ...fila, clientSeq: 99 })
      tx.oncomplete = () => resolver(null)
      tx.onabort = () => resolver(tx.error)
    })
    expect(error?.name).toBe('ConstraintError')
  })
})
