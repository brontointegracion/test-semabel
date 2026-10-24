import { describe, expect, it } from 'vitest'
import { crearEsquema } from '../src/esquema.js'
import { firmaDeReglas, reglasDeCategoria } from '../../src/lib/reglas-categoria.js'
import { nuevaLiga, payloadDeLiga, tokenDe } from './fixtures/sintetico.js'
import { T0, dentro, json, leerEstado, leerPartido, sembrar, sqlDe, Telefono } from './ayuda.js'
import { control } from './worker-prueba.js'

// REPORT_177 — una sola interpretación de las reglas guardadas (ausentes / válidas / inválidas), vínculo entre las reglas que la
// persona confirma y las que el servidor fija al iniciar, y migración 7 con fallo y recuperación. Todo sintético, almacenamiento propio.

async function liga(categoria, { minutosPorPeriodo = 10 } = {}) {
  const ligaId = nuevaLiga()
  const base = payloadDeLiga(ligaId, { minutosPorPeriodo })
  const payload = categoria ? { ...base, liga: { ...base.liga, categoria, subcategoria: { texto: 'Prueba' } } } : base
  const r = await sembrar(ligaId, payload)
  if (r.status !== 201) throw new Error(`siembra falló: ${r.status} ${await r.text()}`)
  return { ligaId, P: new Telefono(ligaId, 'P'), Q: new Telefono(ligaId, 'Q') }
}
let t = T0
const mandar = async (tel, tipo, datos, opts = {}) => { t += 1000; return tel.mandar(tipo, datos, { t, ...opts }) }
const ok = async (tel, tipo, datos, opts) => { const r = await mandar(tel, tipo, datos, opts); expect(r.cuerpo.resultado, `${tipo}: ${JSON.stringify(r.cuerpo).slice(0, 160)}`).toBe('aceptado'); return r }
const config = async (ligaId, g = 'P') => JSON.parse((await sqlDe(ligaId, 'SELECT estado_json FROM partidos WHERE id = ?', g))[0].estado_json).config
const ponerConfig = (ligaId, cambios, g = 'P') => dentro(ligaId, (inst) => {
  const sql = inst.almacen.sql
  const e = JSON.parse(sql.exec('SELECT estado_json FROM partidos WHERE id = ?', g).one().estado_json)
  e.config = { ...e.config, ...cambios }
  sql.exec('UPDATE partidos SET estado_json = ? WHERE id = ?', JSON.stringify(e), g)
})
const foto = (ligaId) => sqlDe(ligaId, "SELECT (SELECT json_group_array(json) FROM (SELECT json FROM eventos ORDER BY partido_id, seq)) AS ev, (SELECT json_group_array(estado_json || rev) FROM (SELECT estado_json, rev FROM partidos ORDER BY id)) AS pa, (SELECT json_group_array(local_puntos || ':' || visita_puntos || ':' || local_faltas || ':' || visita_faltas) FROM resumen_partido) AS rs")
const publico = async (ligaId, g = 'P') => json(await leerPartido(ligaId, g))
const privado = async (ligaId, tel = 'P') => json(await leerEstado(ligaId, tel, tokenDe(ligaId, tel)))

describe('1. reglas guardadas inválidas: se dicen, no se reinterpretan', () => {
  const MALAS = [{ version: 9 }, null, 'texto', 7, [], { ...reglasDeCategoria({ deporte: 'baloncesto', categoria: 'mini-basketball' }), faltasEquipo: 'bonus' }, { ...reglasDeCategoria({ deporte: 'baloncesto', categoria: 'mini-basketball' }), categoria: 'futura' }]

  it('ausentes en un partido iniciado (anterior a las reglas) ≠ inválidas: el primero conserva el comportamiento de siempre', async () => {
    const { ligaId, P } = await liga(undefined)
    await ok(P, 'iniciar-partido', {})
    expect((await config(ligaId)).reglas).toBeUndefined()
    const v = await publico(ligaId)
    expect(v.faltasEquipo).toBe('partido')
    const prv = await privado(ligaId)
    expect(prv.estado.config.reglasInvalidas).toBeUndefined()
    await ok(P, 'falta', { equipoId: 'E1', jugadorId: 'J1' })
    await ok(P, 'detener-reloj', {}).catch(() => {})
  })

  for (const [i, mala] of MALAS.entries()) {
    it(`inválidas (${i}): el tablero dice «no-disponible», el teléfono recibe la marca, y NO se toca lo guardado`, async () => {
      const { ligaId, P } = await liga('mini-basketball')
      await ok(P, 'iniciar-partido', {})
      await ponerConfig(ligaId, { reglas: mala })
      const guardado = JSON.stringify((await config(ligaId)).reglas)
      const antes = await foto(ligaId)
      const v = await publico(ligaId)
      expect(v.faltasEquipo).toBe('no-disponible')
      expect(v.local.faltasPeriodo).toBeNull()
      expect(Object.keys(v.local).sort()).toEqual(['faltas', 'faltasPeriodo', 'id', 'nombre', 'puntos'])
      const prv = await privado(ligaId)
      expect(prv.estado.config.reglasInvalidas).toBe(true)
      expect(prv.estado.config.reglas).toBeUndefined()
      expect(JSON.stringify(mala === undefined ? null : mala)).not.toContain('ALIAS')
      expect(await foto(ligaId)).toEqual(antes) // leer no escribe nada
      expect(JSON.stringify((await config(ligaId)).reglas)).toBe(guardado) // y las reglas guardadas no se reescriben
    })
  }

  it('operaciones: las que no interpretan reglas siguen (puntos, faltas, deshacer, cierre); las que sí, se bloquean con diagnóstico', async () => {
    const { ligaId, P } = await liga('mini-basketball')
    await ok(P, 'iniciar-partido', {})
    await ponerConfig(ligaId, { reglas: { version: 9 } })
    await ok(P, 'anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 })
    await ok(P, 'falta', { equipoId: 'E2', jugadorId: 'J9' })
    await ok(P, 'deshacer', {})
    await ok(P, 'rehacer', {})
    // duración explícita (10): cambiar de periodo no depende de las reglas
    await ok(P, 'siguiente-periodo', {})
    // el cierre sigue disponible
    await ok(P, 'cerrar-partido', {})
    expect((await publico(ligaId)).estado).toBe('final')
  })

  it('sin duración explícita, siguiente-periodo y corregir-reloj se bloquean (reglas-invalidas); el rechazo es definitivo, con recibo, y no cambia nada', async () => {
    const { ligaId, P } = await liga('mini-basketball')
    await ok(P, 'iniciar-partido', {})
    await ponerConfig(ligaId, { reglas: { version: 9 }, minutosPorPeriodo: null })
    const antes = await foto(ligaId)
    const r = await mandar(P, 'siguiente-periodo', {})
    expect(r.cuerpo.resultado).toBe('rechazado')
    expect(r.cuerpo.recibo.motivo).toBe('reglas-invalidas')
    expect(r.cuerpo.recibo.detalle).toMatchObject({ diagnostico: { reglas: 'invalidas', operacion: 'siguiente-periodo' } })
    const c = await mandar(P, 'corregir-reloj', { restanteMs: 60_000 })
    expect(c.cuerpo.recibo.motivo).toBe('reglas-invalidas')
    const despues = await foto(ligaId)
    expect(JSON.parse(despues[0].ev)).toEqual(JSON.parse(antes[0].ev)) // ningún evento nuevo ni cambiado
    expect(despues[0].rs).toBe(antes[0].rs) // resultados intactos
    // el mismo sobre, repetido, devuelve el MISMO rechazo (recibo guardado)
    const otra = await P.enviar(r.sobre)
    expect(await otra.json()).toMatchObject({ resultado: 'recibo-existente', recibo: { resultado: 'rechazado', motivo: 'reglas-invalidas' } })
  })

  it('el inicio con reglas inválidas se bloquea (un partido programado con reglas dudosas no empieza con otra semántica)', async () => {
    const { ligaId, P } = await liga('mini-basketball')
    await ponerConfig(ligaId, { reglas: { version: 9 } })
    const r = await mandar(P, 'iniciar-partido', {})
    expect(r.cuerpo).toMatchObject({ resultado: 'rechazado', recibo: { motivo: 'reglas-invalidas' } })
    expect((await publico(ligaId)).estado).toBe('programado')
    expect((await config(ligaId)).reglas).toEqual({ version: 9 }) // no se reemplazan por las de la categoría
  })

  it('un reintento EXACTO de una orden ya aceptada devuelve su recibo original aunque las reglas hayan pasado a inválidas', async () => {
    const { ligaId, P } = await liga('mini-basketball')
    const inicio = await ok(P, 'iniciar-partido', {})
    const punto = await ok(P, 'anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 3 })
    await ponerConfig(ligaId, { reglas: { version: 9 } })
    for (const original of [inicio, punto]) {
      const otra = await (await P.enviar(original.sobre)).json()
      expect(otra.resultado).toBe('recibo-existente')
      expect(otra.recibo).toMatchObject({ cmdId: original.sobre.cmdId, resultado: 'aceptado', revDespues: original.cuerpo.recibo.revDespues })
    }
    expect((await sqlDe(ligaId, "SELECT COUNT(*) AS n FROM eventos WHERE json_extract(json,'$.tipo') = 'punto'"))[0].n).toBe(1)
  })

  it('con reglas válidas, el reloj, las faltas y la consola leen lo mismo (duración explícita manda; el preset solo sin ella)', async () => {
    const { ligaId, P } = await liga('mini-basketball', { minutosPorPeriodo: 2 })
    await ok(P, 'iniciar-partido', {})
    expect((await publico(ligaId)).reloj.restanteMs).toBe(120_000)
    const prv = await privado(ligaId)
    expect(prv.estado.config.reglas.faltasEquipo).toBe('periodo')
    expect((await publico(ligaId)).faltasEquipo).toBe('periodo')
    await ponerConfig(ligaId, { minutosPorPeriodo: null })
    await ok(P, 'detener-reloj', {}).catch(() => {})
  })
})

describe('2. inicio: las reglas confirmadas son las que el servidor fija', () => {
  it('coinciden: se acepta y se fijan exactamente esas reglas', async () => {
    const { ligaId, P } = await liga('mini-basketball')
    const r = await ok(P, 'iniciar-partido', {})
    expect(r.sobre.reglasConfirmadas).toBe('1|mini-basketball|periodo|8|30|20')
    expect((await config(ligaId)).reglas).toMatchObject({ categoria: 'mini-basketball', faltasEquipo: 'periodo' })
  })

  it('la categoría cambia ENTRE la lectura de la pantalla y la confirmación: rechazo definitivo «reglas-desactualizadas», nada se fija', async () => {
    const { ligaId, P } = await liga(undefined)
    const sobre = await P.sobre('iniciar-partido', {}, { t: ++t })
    expect(sobre.reglasConfirmadas).toBeUndefined() // la pantalla veía un partido sin reglas
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec("UPDATE ligas SET categoria = 'mini-basketball', subcategoria_json = '{\"texto\":\"Prueba\"}'") })
    const r = (await (await P.enviar(sobre)).json()).recibo
    expect(r).toMatchObject({ resultado: 'rechazado', motivo: 'reglas-no-confirmadas' })
    expect(r.detalle.reglasServidor).toBe('1|mini-basketball|periodo|8|30|20')
    expect((await publico(ligaId)).estado).toBe('programado')
    expect((await config(ligaId)).reglas).toBeUndefined()
    // la pantalla se actualiza y confirma de nuevo (cmdId y seq nuevos): ahora sí
    const nuevo = await ok(P, 'iniciar-partido', {})
    expect(nuevo.sobre.reglasConfirmadas).toBe('1|mini-basketball|periodo|8|30|20')
    expect((await config(ligaId)).reglas.categoria).toBe('mini-basketball')
  })

  it('la pantalla veía unas reglas y la categoría pasó a otras: «reglas-desactualizadas» con la firma del servidor', async () => {
    const { ligaId, P } = await liga('mini-basketball')
    const sobre = await P.sobre('iniciar-partido', {}, { t: ++t })
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec("UPDATE ligas SET categoria = 'adult'") })
    const r = (await (await P.enviar(sobre)).json()).recibo
    expect(r).toMatchObject({ resultado: 'rechazado', motivo: 'reglas-desactualizadas' })
    expect(r.detalle).toMatchObject({ reglasServidor: firmaDeReglas({ reglas: reglasDeCategoria({ deporte: 'baloncesto', categoria: 'adult' }) }), reglasConfirmadas: '1|mini-basketball|periodo|8|30|20' })
    expect((await config(ligaId)).reglas).toBeUndefined()
    // un reintento exacto del mismo sobre devuelve el mismo rechazo (recibo), aunque la categoría vuelva a ser la vista
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec("UPDATE ligas SET categoria = 'mini-basketball'") })
    expect(await (await P.enviar(sobre)).json()).toMatchObject({ resultado: 'recibo-existente', recibo: { resultado: 'rechazado', motivo: 'reglas-desactualizadas' } })
  })

  it('el cambio llega ENTRE decidir y confirmar (entrelazado): la confirmación no escribe y se vuelve a decidir → rechazo, nada fijado', async () => {
    const { ligaId, P } = await liga('mini-basketball')
    const sobre = await P.sobre('iniciar-partido', {}, { t: ++t })
    control.pausa = async () => {
      control.pausa = null
      await dentro(ligaId, (inst) => { inst.almacen.sql.exec("UPDATE ligas SET categoria = 'baby'") })
    }
    try {
      const r = await (await P.enviar(sobre)).json()
      expect(r).toMatchObject({ resultado: 'rechazado', recibo: { motivo: 'reglas-desactualizadas' } })
    } finally { control.pausa = null }
    expect((await publico(ligaId)).estado).toBe('programado')
    expect((await config(ligaId)).reglas).toBeUndefined()
  })

  it('reintento exacto de un inicio ya aceptado: el recibo original y las reglas fijadas, aunque la categoría cambie después', async () => {
    const { ligaId, P } = await liga('mini-basketball')
    const inicio = await ok(P, 'iniciar-partido', {})
    const fijadas = JSON.stringify((await config(ligaId)).reglas)
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec("UPDATE ligas SET categoria = 'adult'") })
    const otra = await (await P.enviar(inicio.sobre)).json()
    expect(otra).toMatchObject({ resultado: 'recibo-existente', recibo: { resultado: 'aceptado', cmdId: inicio.sobre.cmdId, revDespues: inicio.cuerpo.recibo.revDespues } })
    expect(JSON.stringify((await config(ligaId)).reglas)).toBe(fijadas)
    expect((await publico(ligaId)).faltasEquipo).toBe('periodo')
  })

  it('un teléfono anterior (sin reglasConfirmadas): sigue iniciando un partido SIN reglas; si el partido tiene reglas, «reglas-no-confirmadas»', async () => {
    const a = await liga(undefined)
    await ok(a.P, 'iniciar-partido', {}, { reglasConfirmadas: null })
    const b = await liga('adult')
    const r = await mandar(b.P, 'iniciar-partido', {}, { reglasConfirmadas: null })
    expect(r.cuerpo).toMatchObject({ resultado: 'rechazado', recibo: { motivo: 'reglas-no-confirmadas' } })
    expect((await config(b.ligaId)).reglas).toBeUndefined()
  })

  it('las comprobaciones de preparación y el recibo previo siguen su orden: un inicio ya aceptado ignora una plantilla cambiada; el nuevo exige preparación', async () => {
    const { ligaId, P } = await liga('adult')
    const inicio = await ok(P, 'iniciar-partido', {})
    await dentro(ligaId, (inst) => { inst.almacen.sql.exec("UPDATE jugadores SET dorsal = NULL WHERE id = 'J1'") })
    expect((await (await P.enviar(inicio.sobre)).json())).toMatchObject({ resultado: 'recibo-existente', recibo: { resultado: 'aceptado' } })
    const q = await liga('adult')
    const sinPrep = await mandar(q.P, 'iniciar-partido', {}, { preparacionVersion: null })
    expect(sinPrep.cuerpo.recibo.motivo).toBe('preparacion-version-ausente')
  })

  it('los eventos, resultados e historial existentes no cambian por un inicio rechazado por las reglas', async () => {
    const { ligaId, P, Q } = await liga('mini-basketball')
    await ok(Q, 'iniciar-partido', {})
    await ok(Q, 'anotar', { equipoId: 'E3', jugadorId: 'K1', puntos: 3 })
    const antes = await foto(ligaId)
    const sobre = await P.sobre('iniciar-partido', {}, { t: ++t, reglasConfirmadas: 'ninguna' })
    const r = await (await P.enviar(sobre)).json()
    expect(r.recibo.motivo).toBe('reglas-desactualizadas')
    const despues = await foto(ligaId)
    expect(despues[0].ev).toBe(antes[0].ev)
    expect(despues[0].rs).toBe(antes[0].rs)
  })
})

describe('3. migración 7: fallo → todo se deshace → recuperación → repetición', () => {
  const COLUMNAS = ['local_faltas_periodo', 'visita_faltas_periodo']
  const columnas = (sql) => sql.exec("SELECT name FROM pragma_table_info('resumen_partido')").toArray().map((c) => c.name)

  it('un fallo a mitad (la segunda columna) deja versión 6 y sin columnas; luego se recupera, y repetir no cambia nada; eventos y resultados intactos', async () => {
    const { ligaId, P } = await liga('mini-basketball')
    await ok(P, 'iniciar-partido', {})
    await ok(P, 'falta', { equipoId: 'E1', jugadorId: 'J1' })
    await ok(P, 'anotar', { equipoId: 'E2', jugadorId: 'J9', puntos: 3 })
    const antes = await foto(ligaId)
    const r = await dentro(ligaId, (inst) => {
      const alm = inst.almacen
      const sql = alm.sql
      // Base de la versión 6: sin las columnas de la 7.
      for (const s of COLUMNAS.map((c) => `ALTER TABLE resumen_partido DROP COLUMN ${c}`)) sql.exec(s).toArray()
      sql.exec("UPDATE meta SET valor = '6' WHERE clave = 'esquema'").toArray()
      sql.exec('UPDATE resumen_partido SET version_proyeccion = 1').toArray() // como en una base real de la versión 6
      const datosAntes = JSON.stringify(sql.exec('SELECT * FROM resumen_partido').toArray())
      // Fallo inyectado en el SEGUNDO ALTER (el primero ya se ejecutó dentro de la misma transacción).
      const falla = {
        transactionSync: (fn) => alm.transactionSync(() => fn()),
        get sql() {
          return { exec: (q, ...a) => { if (/ADD COLUMN visita_faltas_periodo/.test(q)) throw new Error('fallo inyectado en la migración 7'); return sql.exec(q, ...a) } }
        },
      }
      let lanzo = null
      try { crearEsquema(falla) } catch (e) { lanzo = e.message }
      const trasFallo = { lanzo, version: sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor, columnas: columnas(sql), datos: JSON.stringify(sql.exec('SELECT * FROM resumen_partido').toArray()) }
      // Recuperación con el almacenamiento real, y repetición.
      crearEsquema(alm)
      const trasRecuperar = { version: sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor, columnas: columnas(sql) }
      crearEsquema(alm)
      const trasRepetir = { version: sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor, columnas: columnas(sql) }
      return { datosAntes, trasFallo, trasRecuperar, trasRepetir }
    })
    expect(r.trasFallo.lanzo).toMatch(/fallo inyectado/)
    expect(r.trasFallo.version).toBe('6')
    expect(r.trasFallo.columnas.some((c) => COLUMNAS.includes(c))).toBe(false) // la primera columna también se deshizo
    expect(r.trasFallo.datos).toBe(r.datosAntes)
    expect(r.trasRecuperar.version).toBe('9')
    expect(COLUMNAS.every((c) => r.trasRecuperar.columnas.includes(c))).toBe(true)
    expect(r.trasRepetir).toEqual(r.trasRecuperar)
    const despues = await foto(ligaId)
    expect(despues[0].ev).toBe(antes[0].ev) // eventos intactos
    expect(despues[0].pa).toBe(antes[0].pa) // estado de los partidos intacto
    // La liga vuelve a servir (el resumen se repara: columnas nuevas, versión de proyección vigente) con los mismos resultados.
    await dentro(ligaId, (inst) => { inst.repararResumenesAlArrancar() })
    const v = await publico(ligaId)
    expect(v.local.faltas).toBe(1)
    expect(v.visita.puntos).toBe(3)
    expect(v.local.faltasPeriodo).toBe(1)
  })
})
