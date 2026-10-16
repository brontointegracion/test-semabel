import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLAVE_DESBORDAMIENTO, MAX_FALLOS_FUENTE, MAX_FUENTES_ACTIVAS, VENTANA_FUENTE_MS } from '../src/acceso/config.js'
import { fuenteBloqueada, registrarFalloFuente } from '../src/acceso/limites.js'
import { crearEsquema } from '../src/esquema.js'
import { nuevaLiga } from './fixtures/sintetico.js'
import { T0 } from './ayuda.js'
import {
  accesoStub, activar, control, emitirCodigoDePartido, enAcceso, enLiga, escenarioDeCodigos, iniciarSesion, provisionar, reiniciarAcceso,
  tokenDeTelefono,
} from './ayuda-acceso.js'

// CONTADORES TEMPORALES POR FUENTE: acotados. Máximo MAX_FUENTES_ACTIVAS filas propias + 1 de desbordamiento por objeto.

const TOPE = MAX_FUENTES_ACTIVAS + 1
const MIN = 60 * 1000
afterEach(() => { control.ahoraMs = null })

const registrar = (storage, fuente, ahora) => storage.transactionSync(() => registrarFalloFuente(storage.sql, fuente, ahora))
const bloqueada = (storage, fuente, ahora) => storage.transactionSync(() => fuenteBloqueada(storage.sql, fuente, ahora))
const filas = (storage) => storage.sql.exec('SELECT fuente, inicio, fallos FROM limite_fuente').toArray()
const fallar = (storage, fuente, veces, ahora) => { for (let i = 0; i < veces; i += 1) registrar(storage, fuente, ahora) }
const fuentes = (desde, hasta) => Array.from({ length: hasta - desde }, (_, i) => `fuente-${desde + i}`)

// Las mismas pruebas contra el objeto de acceso y contra el de una liga: son las dos copias de la tabla.
const objetos = [
  ['objeto de acceso', () => enAcceso],
  ['objeto de liga', () => { const liga = nuevaLiga(); return (fn) => enLiga(liga, fn) }],
]

for (const [nombre, fabricar] of objetos) {
  describe(`contadores por fuente en el ${nombre}`, () => {
    let dentro
    // El objeto de acceso es único y se comparte entre pruebas: cada una empieza con los contadores vacíos.
    beforeEach(async () => { dentro = fabricar(); await dentro((inst) => inst.almacen.sql.exec('DELETE FROM limite_fuente').toArray()) })

    it('borra las filas vencidas al ritmo de la ventana de 10 minutos, en la misma transacción', async () => {
      await dentro((inst) => {
        for (const f of fuentes(0, 10)) registrar(inst.almacen, f, T0)
        expect(filas(inst.almacen)).toHaveLength(10)
        registrar(inst.almacen, 'nueva', T0 + VENTANA_FUENTE_MS - 1)
        expect(filas(inst.almacen)).toHaveLength(11) // aún dentro de la ventana
        registrar(inst.almacen, 'otra', T0 + VENTANA_FUENTE_MS)
        expect(filas(inst.almacen).map((f) => f.fuente).sort()).toEqual(['nueva', 'otra']) // las 10 de T0 ya vencieron
        // una consulta también limpia, y una fuente vencida deja de estar bloqueada
        fallar(inst.almacen, 'insistente', MAX_FALLOS_FUENTE, T0 + VENTANA_FUENTE_MS)
        expect(bloqueada(inst.almacen, 'insistente', T0 + 2 * VENTANA_FUENTE_MS - 1)).toBe(true)
        expect(bloqueada(inst.almacen, 'insistente', T0 + 2 * VENTANA_FUENTE_MS)).toBe(false)
        expect(filas(inst.almacen).some((f) => f.fuente === 'insistente')).toBe(false)
      })
    })

    it(`con muchas fuentes distintas en una ventana activa nunca hay más de ${TOPE} filas`, async () => {
      await dentro((inst) => {
        for (const f of fuentes(0, 2000)) registrar(inst.almacen, f, T0)
        const fs = filas(inst.almacen)
        expect(fs.length).toBeLessThanOrEqual(TOPE)
        expect(fs.filter((f) => f.fuente !== CLAVE_DESBORDAMIENTO)).toHaveLength(MAX_FUENTES_ACTIVAS)
        const desborde = fs.find((f) => f.fuente === CLAVE_DESBORDAMIENTO)
        expect(desborde.fallos).toBe(2000 - MAX_FUENTES_ACTIVAS) // los fallos de las fuentes que no cupieron se cuentan, no se pierden
      })
    })

    it('el desbordamiento no expulsa ni reinicia a una fuente que ya tenía fila', async () => {
      await dentro((inst) => {
        fallar(inst.almacen, 'A', MAX_FALLOS_FUENTE - 1, T0) // A está a un fallo del bloqueo
        for (const f of fuentes(0, 800)) registrar(inst.almacen, f, T0) // se llena el tope y se desborda
        expect(filas(inst.almacen).find((f) => f.fuente === 'A')).toMatchObject({ inicio: T0, fallos: MAX_FALLOS_FUENTE - 1 }) // intacta
        registrar(inst.almacen, 'A', T0) // su fallo número 20
        expect(bloqueada(inst.almacen, 'A', T0)).toBe(true) // su asignación NO se reinició
        expect(filas(inst.almacen).find((f) => f.fuente === 'A').fallos).toBe(MAX_FALLOS_FUENTE)
        expect(filas(inst.almacen).length).toBeLessThanOrEqual(TOPE)
      })
    })

    it('con el tope lleno la protección no se apaga: el cubo compartido bloquea a las fuentes nuevas con el mismo umbral', async () => {
      await dentro((inst) => {
        for (const f of fuentes(0, MAX_FUENTES_ACTIVAS)) registrar(inst.almacen, f, T0) // tope lleno, cada una con 1 fallo
        expect(bloqueada(inst.almacen, 'recien-llegada', T0)).toBe(false) // todavía no hay fallos de desbordamiento
        for (let i = 0; i < MAX_FALLOS_FUENTE - 1; i += 1) registrar(inst.almacen, `nueva-${i}`, T0)
        expect(bloqueada(inst.almacen, 'otra-recien-llegada', T0)).toBe(false) // 19 en el cubo compartido
        registrar(inst.almacen, 'nueva-final', T0) // el 20.º
        expect(bloqueada(inst.almacen, 'otra-recien-llegada', T0)).toBe(true) // ahora las fuentes nuevas están limitadas
        expect(bloqueada(inst.almacen, 'fuente-0', T0)).toBe(false) // una fuente con fila propia y 1 fallo sigue como estaba
        expect(filas(inst.almacen).length).toBeLessThanOrEqual(TOPE)
      })
    })

    it('al terminar la ventana, todo vuelve a empezar y el almacenamiento vuelve a bajar', async () => {
      await dentro((inst) => {
        for (const f of fuentes(0, 900)) registrar(inst.almacen, f, T0)
        expect(bloqueada(inst.almacen, 'x', T0 + VENTANA_FUENTE_MS - 1)).toBe(true)
        expect(bloqueada(inst.almacen, 'x', T0 + VENTANA_FUENTE_MS)).toBe(false)
        expect(filas(inst.almacen)).toHaveLength(0)
        registrar(inst.almacen, 'x', T0 + VENTANA_FUENTE_MS)
        expect(filas(inst.almacen)).toHaveLength(1)
      })
    })

    it('solo toca los contadores: sesiones, códigos, credenciales y auditoría no se borran al limpiar', async () => {
      await dentro((inst) => {
        const sql = inst.almacen.sql
        const tablas = inst.almacen === undefined ? [] : sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'limite_fuente'").toArray().map((t) => t.name)
        const cuenta = () => Object.fromEntries(tablas.map((t) => [t, sql.exec(`SELECT COUNT(*) AS n FROM ${t}`).one().n]))
        sql.exec("INSERT INTO auditoria_acceso (ts, tipo) VALUES (?, 'prueba')", T0)
        const antes = cuenta()
        for (const f of fuentes(0, 600)) registrar(inst.almacen, f, T0)
        registrar(inst.almacen, 'x', T0 + 3 * VENTANA_FUENTE_MS) // limpia todo lo vencido
        expect(cuenta()).toEqual(antes)
      })
    })
  })
}

describe('de extremo a extremo por HTTP', () => {
  it('objeto de acceso: 520 direcciones distintas fallando el inicio de sesión no pasan de 501 filas; el cubo compartido limita; la ventana lo libera', async () => {
    await reiniciarAcceso()
    const { codigo } = await provisionar([nuevaLiga()])
    for (let i = 0; i < 520; i += 1) await iniciarSesion('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', { ip: `198.18.${Math.floor(i / 250)}.${i % 250}` })
    const n = await enAcceso((inst) => inst.almacen.sql.exec('SELECT COUNT(*) AS n FROM limite_fuente').one().n)
    expect(n).toBeLessThanOrEqual(TOPE)
    expect((await iniciarSesion(codigo, { ip: '203.0.113.200' })).status).toBe(429) // fuente nueva con el cubo compartido lleno
    expect((await iniciarSesion(codigo, { ip: '198.18.0.1' })).status).toBe(200) // una fuente con fila propia y pocos fallos entra
    control.ahoraMs = T0 + VENTANA_FUENTE_MS
    expect((await iniciarSesion(codigo, { ip: '203.0.113.200' })).status).toBe(200)
  }, 90_000)

  it('objeto de liga: lo mismo para la activación de partidos', async () => {
    const e = await escenarioDeCodigos()
    const { codigo } = await emitirCodigoDePartido(e.cookie, e.ligaId)
    const { tokenHash } = await tokenDeTelefono()
    for (let i = 0; i < 520; i += 1) await activar(e.ligaId, 'P', 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', tokenHash, { ip: `198.18.${Math.floor(i / 250)}.${i % 250}` })
    const n = await enLiga(e.ligaId, (inst) => inst.almacen.sql.exec('SELECT COUNT(*) AS n FROM limite_fuente').one().n)
    expect(n).toBeLessThanOrEqual(TOPE)
    expect((await activar(e.ligaId, 'P', codigo, tokenHash, { ip: '203.0.113.201' })).status).toBe(429)
    control.ahoraMs = T0 + VENTANA_FUENTE_MS
    expect((await activar(e.ligaId, 'P', codigo, tokenHash, { ip: '203.0.113.201' })).status).toBe(200)
  }, 90_000)

  it('la autorización y la activación siguen igual en ambos objetos con contadores en uso', async () => {
    await reiniciarAcceso()
    const { codigo } = await provisionar([nuevaLiga()])
    await iniciarSesion('ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', { ip: '192.0.2.1' })
    expect((await iniciarSesion(codigo, { ip: '192.0.2.2' })).status).toBe(200)
    expect((await iniciarSesion(`${codigo.slice(0, 5)}-00000-00000-00000`, { ip: '192.0.2.3' })).status).toBe(401)
    expect(await accesoStub().desactivarOrganizador()).toEqual({ ok: true })
  })
})

describe('esquema: el índice de los contadores', () => {
  it('existe, y una base que ya estaba en la versión 2 sin él lo recibe al abrirse (aditivo e idempotente)', async () => {
    const liga = nuevaLiga()
    await enLiga(liga, (inst) => {
      const sql = inst.almacen.sql
      const indices = () => sql.exec('PRAGMA index_list(limite_fuente)').toArray().map((i) => i.name)
      expect(indices()).toContain('ix_limite_fuente_inicio')
      sql.exec('DROP INDEX ix_limite_fuente_inicio').toArray()
      sql.exec("INSERT INTO limite_fuente (fuente, inicio, fallos) VALUES ('f', 1, 1)").toArray()
      crearEsquema(inst.almacen); crearEsquema(inst.almacen)
      expect(indices()).toContain('ix_limite_fuente_inicio')
      expect(sql.exec("SELECT fallos FROM limite_fuente WHERE fuente = 'f'").one().fallos).toBe(1) // la fila sigue
    })
  })
})
