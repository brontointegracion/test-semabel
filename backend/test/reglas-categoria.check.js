import { describe, expect, it } from 'vitest'
import { CAMPOS_PUBLICOS } from '../src/proyeccion-publica.js'
import { repararResumenes } from '../src/resumen-publico.js'
import { REGLAS_POR_CATEGORIA } from '../../src/lib/reglas-categoria.js'
import { nuevaLiga, payloadDeLiga, tokenDe } from './fixtures/sintetico.js'
import { T0, dentro, json, leerEstado, leerPartido, sembrar, sqlDe, Telefono } from './ayuda.js'

// REPORT_175 — reglas por categoría: se FIJAN al iniciar el partido, el alcance de las faltas de equipo llega al tablero
// público, y nada cambia para ligas sin categoría con regla explícita. Todo sintético.

// Las claves del catálogo se siembran por el camino normal (categoría + subcategoría); un valor heredado o desconocido ('Libre', 'mini')
// no pasa la validación de baloncesto, así que se deja directamente en la fila, como lo dejaría una liga anterior.
async function ligaConCategoria(categoria, { minutosPorPeriodo = 10 } = {}) {
  const ligaId = nuevaLiga()
  const base = payloadDeLiga(ligaId, { minutosPorPeriodo })
  const catalogo = categoria in REGLAS_POR_CATEGORIA
  const payload = catalogo ? { ...base, liga: { ...base.liga, categoria, subcategoria: { texto: 'Prueba' } } } : base
  const r = await sembrar(ligaId, payload)
  if (r.status !== 201) throw new Error(`siembra falló: ${r.status} ${await r.text()}`)
  if (categoria !== undefined && !catalogo) await dentro(ligaId, (inst) => { inst.almacen.sql.exec('UPDATE ligas SET categoria = ?', categoria) })
  return { ligaId, P: new Telefono(ligaId, 'P'), Q: new Telefono(ligaId, 'Q') }
}
const D1 = { equipoId: 'E1', jugadorId: 'J1' }
const D1b = { equipoId: 'E1', jugadorId: 'J2' }
const D2 = { equipoId: 'E2', jugadorId: 'J9' }
const publico = async (ligaId, g = 'P') => json(await leerPartido(ligaId, g))
const guardado = async (ligaId, g = 'P') => JSON.parse((await sqlDe(ligaId, 'SELECT estado_json FROM partidos WHERE id = ?', g))[0].estado_json)
let t = T0
const paso = async (tel, tipo, datos) => {
  t += 1000
  const r = await tel.mandar(tipo, datos, { t })
  expect(r.cuerpo.resultado, tipo).toBe('aceptado')
  return r
}
const iniciar = async (P) => { await paso(P, 'iniciar-partido', {}); await paso(P, 'arrancar-reloj', {}) }
const periodoSiguiente = async (P) => { await paso(P, 'detener-reloj', {}); await paso(P, 'corregir-reloj', { restanteMs: 60000 }); await paso(P, 'siguiente-periodo', {}) }

describe('1. configuración efectiva por categoría, fijada al iniciar', () => {
  for (const [clave, regla] of Object.entries(REGLAS_POR_CATEGORIA)) {
    it(`${clave}: antes de iniciar el tablero ya muestra el alcance; al iniciar las reglas quedan fijadas en el partido`, async () => {
      const { ligaId, P } = await ligaConCategoria(clave)
      expect((await publico(ligaId)).faltasEquipo).toBe(regla.faltasEquipo)
      expect((await guardado(ligaId)).config.reglas).toBeUndefined() // todavía no hay nada fijado
      await paso(P, 'iniciar-partido', {})
      const fijadas = (await guardado(ligaId)).config.reglas
      expect(fijadas).toEqual({ version: 1, categoria: clave, ...regla })
      expect((await publico(ligaId)).faltasEquipo).toBe(regla.faltasEquipo)
    })
  }

  it('la duración explícita del partido manda: 2 minutos siguen siendo 2 (no pasan a 8 ni a 10); sin duración, la del preset', async () => {
    const { ligaId, P } = await ligaConCategoria('mini-basketball', { minutosPorPeriodo: 2 })
    await paso(P, 'iniciar-partido', {})
    expect((await publico(ligaId)).reloj.restanteMs).toBe(2 * 60_000)
    expect((await guardado(ligaId)).config.minutosPorPeriodo).toBe(2)
    expect((await guardado(ligaId)).config.reglas.minutosPorPeriodo).toBe(8) // registrado, no aplicado
    // Sin duración explícita (null) se usa el preset de la categoría fijada.
    const otra = await ligaConCategoria('baby')
    await dentro(otra.ligaId, (inst) => {
      const sql = inst.almacen.sql
      const e = JSON.parse(sql.exec("SELECT estado_json FROM partidos WHERE id = 'P'").one().estado_json)
      e.config.minutosPorPeriodo = null
      sql.exec("UPDATE partidos SET estado_json = ? WHERE id = 'P'", JSON.stringify(e))
    })
    await paso(otra.P, 'iniciar-partido', {})
    expect((await publico(otra.ligaId)).reloj.restanteMs).toBe(8 * 60_000)
  })

  it('la lectura privada del teléfono lleva las reglas con una lista blanca y sin identidad ni alias', async () => {
    const { ligaId, P } = await ligaConCategoria('intermediate')
    await paso(P, 'iniciar-partido', {})
    const cuerpo = await json(await leerEstado(ligaId, 'P', tokenDe(ligaId, 'P')))
    expect(Object.keys(cuerpo.estado.config).sort()).toEqual(['deporte', 'minutosPorPeriodo', 'reglas'])
    expect(Object.keys(cuerpo.estado.config.reglas).sort()).toEqual(['categoria', 'faltasEquipo', 'medioCampo', 'minutosPorPeriodo', 'relojTiro', 'version'])
    expect(cuerpo.estado.config.reglas).toMatchObject({ faltasEquipo: 'partido', relojTiro: { activo: true, segundos: 24 }, medioCampo: { activo: true, segundos: 14 } })
  })
})

describe('2. compatibilidad: desconocida, heredada y partido ya iniciado', () => {
  it('categoría heredada («Libre»), sin categoría y clave desconocida: sin reglas, alcance de partido, nada fijado', async () => {
    for (const categoria of [undefined, 'Libre']) {
      const { ligaId, P } = await ligaConCategoria(categoria)
      await paso(P, 'iniciar-partido', {})
      expect((await guardado(ligaId)).config.reglas).toBeUndefined()
      const v = await publico(ligaId)
      expect(v.faltasEquipo).toBe('partido')
      expect(v.local.faltasPeriodo).toBeNull()
    }
    // Una clave que no existe en el catálogo ('mini', 'U10', mayúsculas distintas): nunca se adivina ni se aproxima.
    for (const categoria of ['mini', 'U10', 'Baby', 'ADULT']) {
      const { ligaId, P } = await ligaConCategoria(categoria)
      await paso(P, 'iniciar-partido', {})
      expect((await guardado(ligaId)).config.reglas, categoria).toBeUndefined()
      expect((await publico(ligaId)).faltasEquipo, categoria).toBe('partido')
    }
  })

  it('el nombre de la liga o del equipo no decide la categoría', async () => {
    const ligaId = nuevaLiga()
    const base = payloadDeLiga(ligaId)
    const r = await sembrar(ligaId, { ...base, liga: { ...base.liga, nombre: 'Baby mini intermedia' }, equipos: base.equipos.map((e, i) => (i === 0 ? { ...e, nombre: 'Baby Mini' } : e)) })
    expect(r.status).toBe(201)
    expect((await publico(ligaId)).faltasEquipo).toBe('partido')
  })

  it('un partido ya iniciado conserva sus reglas aunque la categoría de la liga cambie; uno sin iniciar toma las vigentes', async () => {
    const { ligaId, P, Q } = await ligaConCategoria('mini-basketball')
    await paso(P, 'iniciar-partido', {})
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec("UPDATE ligas SET categoria = 'adult'") })
    expect((await publico(ligaId)).faltasEquipo).toBe('periodo') // P sigue con las suyas
    expect((await guardado(ligaId)).config.reglas.categoria).toBe('mini-basketball')
    expect((await publico(ligaId, 'Q')).faltasEquipo).toBe('partido') // Q aún no se inició: ve la categoría vigente
    await paso(Q, 'iniciar-partido', {})
    expect((await guardado(ligaId, 'Q')).config.reglas.categoria).toBe('adult')
  })

  it('un partido iniciado ANTES de existir las reglas (sin reglas guardadas) no se reinterpreta por la categoría de su liga', async () => {
    const { ligaId, P } = await ligaConCategoria(undefined)
    await paso(P, 'iniciar-partido', {})
    await paso(P, 'falta', D1)
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec("UPDATE ligas SET categoria = 'mini-basketball'") })
    const v = await publico(ligaId)
    expect(v.faltasEquipo).toBe('partido')
    expect(v.local.faltas).toBe(1)
    await paso(P, 'falta', D1) // sigue aceptando órdenes sin fijar nada
    expect((await guardado(ligaId)).config.reglas).toBeUndefined()
  })
})

describe('3. faltas de equipo por alcance, a través de dos periodos', () => {
  async function dosPeriodos(categoria) {
    const { ligaId, P } = await ligaConCategoria(categoria)
    await iniciar(P)
    await paso(P, 'falta', D1)
    await paso(P, 'falta', D1b)
    await paso(P, 'falta', D2)
    await periodoSiguiente(P)
    await paso(P, 'falta', D1)
    return { ligaId, P }
  }
  const totales = (v) => ({ l: v.local.faltas, v: v.visita.faltas, lp: v.local.faltasPeriodo, vp: v.visita.faltasPeriodo })

  it('Mini: el tablero cuenta el periodo actual; el total de partido y el historial del jugador no se tocan', async () => {
    const { ligaId } = await dosPeriodos('mini-basketball')
    const v = await publico(ligaId)
    expect(v.periodo).toBe(2)
    expect(v.faltasEquipo).toBe('periodo')
    expect(totales(v)).toEqual({ l: 3, v: 1, lp: 1, vp: 0 })
    // Nada se borró al cambiar de periodo: los cuatro eventos de falta siguen guardados y vivos.
    const faltas = await sqlDe(ligaId, "SELECT json_extract(json,'$.jugadorId') AS j, json_extract(json,'$.anulado') AS a FROM eventos WHERE partido_id='P' AND json_extract(json,'$.tipo')='falta' ORDER BY seq")
    expect(faltas.map((f) => f.j)).toEqual(['J1', 'J2', 'J9', 'J1'])
    expect(faltas.every((f) => !f.a)).toBe(true)
  })

  it('Intermedia, Adulto y Veteranos: alcance de partido completo (el total acumulado), sin cuenta de periodo', async () => {
    for (const c of ['intermediate', 'adult', 'veterans']) {
      const { ligaId } = await dosPeriodos(c)
      const v = await publico(ligaId)
      expect(v.faltasEquipo, c).toBe('partido')
      expect(totales(v), c).toEqual({ l: 3, v: 1, lp: null, vp: null })
    }
  })

  it('Baby: el tablero oculta las faltas de equipo; los eventos y el total de partido siguen intactos', async () => {
    const { ligaId } = await dosPeriodos('baby')
    const v = await publico(ligaId)
    expect(v.faltasEquipo).toBe('oculto')
    expect(totales(v)).toEqual({ l: 3, v: 1, lp: null, vp: null })
    expect((await sqlDe(ligaId, "SELECT COUNT(*) AS n FROM eventos WHERE partido_id='P' AND json_extract(json,'$.tipo')='falta'"))[0].n).toBe(4)
  })

  it('deshacer, rehacer y anular cruzando el límite de periodo mantienen el total y la cuenta del periodo coherentes', async () => {
    const { ligaId, P } = await dosPeriodos('mini-basketball')
    const ids = (await sqlDe(ligaId, "SELECT id FROM eventos WHERE partido_id='P' AND json_extract(json,'$.tipo')='falta' ORDER BY seq")).map((r) => r.id)
    await paso(P, 'deshacer', {}) // la falta del periodo 2
    expect(totales(await publico(ligaId))).toEqual({ l: 2, v: 1, lp: 0, vp: 0 })
    await paso(P, 'rehacer', {})
    expect(totales(await publico(ligaId))).toEqual({ l: 3, v: 1, lp: 1, vp: 0 })
    await paso(P, 'anular-evento', { eventoId: ids[0] }) // falta del periodo 1, anulada desde el periodo 2
    expect(totales(await publico(ligaId))).toEqual({ l: 2, v: 1, lp: 1, vp: 0 })
    // la falta anulada sigue en el historial, marcada
    expect((await sqlDe(ligaId, "SELECT json_extract(json,'$.anulado') AS a FROM eventos WHERE id = ?", ids[0]))[0].a).toBe(1)
  })

  it('el resumen guardado coincide con la reconstrucción desde los eventos (columnas del periodo incluidas)', async () => {
    const { ligaId } = await dosPeriodos('mini-basketball')
    const antes = await sqlDe(ligaId, 'SELECT * FROM resumen_partido')
    await dentro(ligaId, (inst) => { repararResumenes(inst.almacen, { todos: true }) })
    expect(await sqlDe(ligaId, 'SELECT * FROM resumen_partido')).toEqual(antes)
  })
})

describe('4. lista blanca pública', () => {
  it('la lectura pública de un partido tiene exactamente los campos aprobados y ningún alias, etiqueta ni credencial', async () => {
    const { ligaId, P } = await ligaConCategoria('mini-basketball')
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec("UPDATE jugadores SET nombre_camiseta = 'ALIAS-SECRETO' WHERE id = 'J1'") })
    await iniciar(P)
    await paso(P, 'falta', D1)
    const v = await publico(ligaId)
    expect(Object.keys(v).sort()).toEqual([...CAMPOS_PUBLICOS.raiz].sort())
    expect(Object.keys(v.local).sort()).toEqual([...CAMPOS_PUBLICOS.equipo].sort())
    const texto = JSON.stringify(v)
    for (const prohibido of ['ALIAS-SECRETO', 'reglas', 'relojTiro', 'medioCampo', 'token', 'etiquetas', 'nombre_camiseta']) expect(texto).not.toContain(prohibido)
  })
})
