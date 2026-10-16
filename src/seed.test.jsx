/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'

// Raíces de React creadas por la app (main.jsx las crea por dentro y no las expone). El envoltorio llama al
// createRoot real y a su render real; solo anota la raíz y si se desmontó, para poder desmontarla y comprobarlo.
const { raices } = vi.hoisted(() => ({ raices: [] }))
vi.mock('react-dom/client', async (importarOriginal) => {
  const real = await importarOriginal()
  return {
    ...real,
    createRoot: (...args) => {
      const raiz = real.createRoot(...args)
      const entrada = { raiz, desmontada: false }
      const desmontar = raiz.unmount.bind(raiz)
      raiz.unmount = () => { entrada.desmontada = true; return desmontar() }
      raices.push(entrada)
      return raiz
    },
  }
})

// Instancias de Dexie que estas pruebas usaron (una por cada carga de db.js tras vi.resetModules).
const bases = new Set()
const registrar = (db) => { bases.add(db); return db }

// ---------------------------------------------------------------------------
// Slice A: ya no hay mantenimiento automático del reloj. Un reloj detenido
// sigue detenido al arrancar la app, al recargar o desde otra pestaña, y uno
// agotado no se rellena ni se reinicia solo. La siembra inicial de la demo
// conserva el estado de reloj con el que siempre se creó.
//
// Son pruebas automáticas en jsdom: no reemplazan una comprobación en un
// navegador real.
// ---------------------------------------------------------------------------

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
  document.body.innerHTML = '<div id="root"></div>'
})

// A diferencia de borrarBd(), no da por buena una eliminación bloqueada: si queda una conexión abierta, falla.
function borrarBdSinForzar() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(NOMBRE_BD)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('borrar la base quedó bloqueado: hay una conexión abierta'))
  })
}

// Cada paso de limpieza corre aunque otro falle (también tras una aserción fallida o un arranque roto); los
// errores no se tragan: se juntan y se lanzan al final.
afterEach(async () => {
  const errores = []
  const paso = async (fn) => { try { await fn() } catch (e) { errores.push(e) } }
  const entradas = raices.splice(0).reverse()
  const conexiones = [...bases]
  bases.clear()

  for (const entrada of entradas) await paso(() => act(async () => { entrada.raiz.unmount() }))
  await paso(() => cleanup())
  await paso(() => expect(entradas.filter((e) => !e.desmontada)).toEqual([]))
  for (const conexion of conexiones) await paso(() => conexion.close())
  await paso(() => expect(conexiones.filter((c) => c.isOpen())).toEqual([]))
  await paso(() => vi.restoreAllMocks())
  await paso(() => vi.unstubAllGlobals())
  await paso(() => { document.body.innerHTML = '' })
  await paso(() => borrarBdSinForzar())

  if (errores.length) throw new AggregateError(errores, 'limpieza de seed.test.jsx')
})

async function sembrar() {
  const { db } = await import('./db.js')
  registrar(db)
  const seed = await import('./seed.js')
  await seed.sembrarSiHaceFalta()
  return { db, seed }
}

describe('siembra inicial de la demo', () => {
  it('sigue creando el partido en vivo con su reloj inicial corriendo, y no exporta mantenimiento', async () => {
    const { db, seed } = await sembrar()
    expect(seed.mantenerPartidoEnVivo).toBeUndefined()
    expect(seed.pausarMantenimiento).toBeUndefined()

    const vivos = await db.partidos.where('estado').equals('vivo').toArray()
    expect(vivos.length).toBeGreaterThan(0)
    for (const p of vivos) {
      expect(p.relojEstado).toBe('corriendo')
      expect(typeof p.relojDesde).toBe('number')
      expect(p.relojRestante).toBeGreaterThan(0)
    }
    // Los partidos ya jugados conservan su reloj detenido en cero.
    const finales = await db.partidos.where('estado').equals('final').toArray()
    expect(finales.length).toBeGreaterThan(0)
    for (const p of finales) {
      expect([p.relojEstado, p.relojRestante, p.relojDesde]).toEqual(['detenido', 0, null])
    }
  })
})

describe('arranque de la app sin mantenimiento', () => {
  async function prepararRelojes() {
    const { db } = await sembrar()
    const [a, b, c] = await db.partidos.toArray()
    // Fixtures aislados sobre filas existentes: tres partidos en vivo con tres relojes distintos.
    const ahora = Date.now()
    const filas = [
      [a, { estado: 'vivo', relojEstado: 'detenido', relojRestante: 123000, relojDesde: null }],
      [b, { estado: 'vivo', relojEstado: 'corriendo', relojRestante: 1000, relojDesde: ahora - 60000 }],
      [c, { estado: 'vivo', relojEstado: 'detenido', relojRestante: 0, relojDesde: null }],
    ]
    for (const [p, cambios] of filas) await db.partidos.update(p.id, cambios)
    return { db, ids: filas.map(([p]) => p.id) }
  }

  const foto = async (db, ids) => Promise.all(ids.map((id) => db.partidos.get(id)))

  // El arranque real (main.jsx) detecta la región por red (ipwho.is) antes de montar la app. Esta prueba trata
  // de los relojes, no de la red: se simula un dispositivo sin conexión, que es el camino de respaldo real
  // (zona horaria) de resolverRegion. Así el arranque no depende de internet ni de su latencia.
  const sinRed = () => vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('sin red (prueba)'))))

  // Una instancia de la app = ejecutar main.jsx de verdad. El arranque termina cuando arrancar() ya sembró,
  // resolvió región y sesión, y montó la app: eso es observable —la portada (.home) está en pantalla—, no
  // un tiempo. Después, una escritura nula sobre las tablas de partidos y reloj sirve de barrera: las
  // transacciones de IndexedDB con alcance común corren en orden, así que cuando termina, toda escritura que
  // el arranque ya hubiera pedido sobre esas tablas ya terminó y no queda nada pendiente que esperar.
  async function iniciarInstancia(db) {
    await import('./main.jsx')
    await vi.waitFor(() => {
      expect(document.querySelector('.home')).not.toBeNull()
    }, { timeout: 4000 })
    await db.transaction('rw', db.partidos, db.auditoriaReloj, async () => {})
    // El arranque llegó hasta el final: dejó la sesión y la región guardadas.
    expect(await db.meta.get('sesion')).toBeTruthy()
    expect(await db.meta.get('region')).toBeTruthy()
  }

  it('el arranque no programa ningún intervalo de 15 s ni escribe partidos (reloj detenido, agotado, vencido)', async () => {
    sinRed()
    const { db, ids } = await prepararRelojes()
    const antes = await foto(db, ids)
    const intervalos = vi.spyOn(globalThis, 'setInterval')
    const escrituras = [
      vi.spyOn(db.partidos, 'update'), vi.spyOn(db.partidos, 'put'),
      vi.spyOn(db.partidos, 'bulkPut'), vi.spyOn(db.partidos, 'bulkAdd'),
    ]

    await iniciarInstancia(db)

    // Los intervalos legítimos de la interfaz (p. ej. el de 500 ms de un reloj corriendo) no cuentan.
    expect(intervalos.mock.calls.filter(([, ms]) => ms === 15000)).toHaveLength(0)
    escrituras.forEach((e) => expect(e).not.toHaveBeenCalled())
    // Detenido sigue detenido; vencido no se rellena; agotado no se reinicia.
    expect(await foto(db, ids)).toEqual(antes)
    expect(await db.auditoriaReloj.count()).toBe(0)
  })

  // Esta prueba de integración hace dos arranques reales de la aplicación (import de main.jsx y montaje de la
  // portada, dos veces) y necesita margen de ejecución durante la suite ordinaria en paralelo.
  it('recargar y abrir otra pestaña (otra instancia de la app) tampoco cambia los relojes', async () => {
    sinRed()
    const { db, ids } = await prepararRelojes()
    const antes = await foto(db, ids)
    const intervalos = vi.spyOn(globalThis, 'setInterval')

    await iniciarInstancia(db) // primera pestaña

    // Segunda pestaña, no una recarga con cierre previo: la primera instancia sigue montada y con su conexión
    // abierta mientras la segunda arranca (documento nuevo, módulos nuevos, su propia conexión a la base).
    document.body.innerHTML = '<div id="root"></div>'
    vi.resetModules()
    const { db: db2 } = await import('./db.js')
    registrar(db2)
    expect(db2).not.toBe(db)
    await iniciarInstancia(db2)

    expect(intervalos.mock.calls.filter(([, ms]) => ms === 15000)).toHaveLength(0)
    const despues = await foto(db2, ids)
    expect(despues).toEqual(antes)
    expect(despues[0]).toMatchObject({ relojEstado: 'detenido', relojRestante: 123000, relojDesde: null })
    expect(despues[1]).toMatchObject({ relojEstado: 'corriendo', relojRestante: 1000 })
    expect(despues[2]).toMatchObject({ relojEstado: 'detenido', relojRestante: 0, relojDesde: null })
    expect(await db2.auditoriaReloj.count()).toBe(0)
  }, 15000)
})
