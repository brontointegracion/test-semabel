import { afterEach, describe, expect, it } from 'vitest'
import { env, exports } from 'cloudflare:workers'
import worker from '../src/worker.js'
import { VERSION_ESQUEMA, crearEsquema } from '../src/esquema.js'
import { CAMPOS_PUBLICOS, CAMPOS_PUBLICOS_LIGA } from '../src/proyeccion-publica.js'
import { LIMITES_LECTURA_PUBLICA } from '../src/liga-do.js'
import { SEMILLA_TOKEN, nuevaLiga, payloadDeLiga, tokenDe } from './fixtures/sintetico.js'
import { T0, json, leerPartido, ligaSembrada, sembrar, sqlDe, dentro, fijarEstadoDePartido } from './ayuda.js'
import { control } from './worker-prueba.js'

// LECTURA PÚBLICA DE LA LIGA (GET /v1/ligas/{liga}/publico) y la hora programada. Todo sintético, en workerd real.

const BASE = 'https://backend.local'
const leerLiga = (ligaId, init) => exports.default.fetch(new Request(`${BASE}/v1/ligas/${ligaId}/publico`, init))
const claves = (o) => Object.keys(o).sort()
const ordenadas = (xs) => [...xs].sort()
const PROG_P = '2026-11-01T19:00:00.000Z'
const PROG_Q = '2026-11-01T17:30:00.000Z'

const payloadConAgenda = (ligaId, extra = {}) => {
  const p = payloadDeLiga(ligaId)
  p.liga.categoria = 'mini-basketball'
  p.liga.subcategoria = { clave: 'u10' }
  p.partidos[0] = { ...p.partidos[0], programadoPara: PROG_P, sede: 'Cancha A' }
  p.partidos[1] = { ...p.partidos[1], programadoPara: PROG_Q, sede: 'Cancha B' }
  return { ...p, ...extra }
}
const sembrada = (payload) => ligaSembrada(payload.liga.id, payload)

afterEach(() => { control.ahoraMs = null; control.limitesPublicos = null })

describe('1. acceso: sin credenciales, tras la admisión', () => {
  it('una liga admitida se lee sin credenciales, sin caché y con las cabeceras de seguridad', async () => {
    const { ligaId } = await sembrada(payloadConAgenda(nuevaLiga()))
    const r = await leerLiga(ligaId)
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('authorization')).toBeNull()
    expect((await json(r)).liga.id).toBe(ligaId)
  })

  it('una liga NO admitida recibe el 404 uniforme y el binding no se toca; el método incorrecto de una admitida es 405', async () => {
    const accesos = []
    const LIGA = new Proxy({}, { get(_, p) { accesos.push(String(p)); return () => { throw new Error('binding tocado') } } })
    const entorno = { ENTORNO: 'prueba', LIGAS_ADMITIDAS: 'SOLOESTA', LIGA }
    const referencia = await worker.fetch(new Request(`${BASE}/otra/ruta`), entorno)
    for (const metodo of ['GET', 'POST', 'HEAD']) {
      const r = await worker.fetch(new Request(`${BASE}/v1/ligas/NOADMITIDA/publico`, { method: metodo, body: metodo === 'POST' ? '{}' : undefined }), entorno)
      expect(r.status).toBe(404)
      if (metodo !== 'HEAD') expect(await r.text()).toBe(await referencia.clone().text())
    }
    expect(accesos).toEqual([])
    const { ligaId } = await sembrada(payloadConAgenda(nuevaLiga()))
    const r = await leerLiga(ligaId, { method: 'POST', body: '{}' })
    expect(r.status).toBe(405)
    expect(r.headers.get('allow')).toBe('GET')
  })

  it('admitida pero sin datos: 404 sin detalle', async () => {
    const r = await leerLiga(nuevaLiga())
    expect(r.status).toBe(404)
    expect(await json(r)).toEqual({ error: 'no-encontrado' })
  })
})

describe('2. contrato exacto y exclusión de lo sensible', () => {
  it('las claves son exactamente la lista blanca en cada nivel', async () => {
    const { ligaId, P } = await sembrada(payloadConAgenda(nuevaLiga()))
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const c = await json(await leerLiga(ligaId))
    expect(claves(c)).toEqual(ordenadas(CAMPOS_PUBLICOS_LIGA.raiz))
    expect(claves(c.liga)).toEqual(ordenadas(CAMPOS_PUBLICOS_LIGA.liga))
    expect(c.equipos.length).toBe(4)
    for (const e of c.equipos) expect(claves(e)).toEqual(ordenadas(CAMPOS_PUBLICOS_LIGA.equipo))
    expect(c.partidos.length).toBe(2)
    for (const p of c.partidos) {
      expect(claves(p)).toEqual(ordenadas(CAMPOS_PUBLICOS_LIGA.partido))
      expect(claves(p.reloj)).toEqual(ordenadas(CAMPOS_PUBLICOS_LIGA.reloj))
      expect(claves(p.local)).toEqual(ordenadas(CAMPOS_PUBLICOS_LIGA.lado))
      expect(claves(p.visita)).toEqual(ordenadas(CAMPOS_PUBLICOS_LIGA.lado))
    }
    expect(c.faltasAlcance).toBe('partido')
    expect(typeof c.servidorAhoraMs).toBe('number')
  })

  it('contenido de la liga: clasificación, equipos y partidos', async () => {
    const { ligaId } = await sembrada(payloadConAgenda(nuevaLiga()))
    const c = await json(await leerLiga(ligaId))
    expect(c.liga).toEqual({ id: ligaId, nombre: `Liga sintética ${ligaId}`, deporte: 'baloncesto', categoria: 'mini-basketball', subcategoria: { clave: 'u10' } })
    expect(c.equipos).toEqual([{ id: 'E1', nombre: 'Alfa', rama: null }, { id: 'E2', nombre: 'Beta', rama: null }, { id: 'E3', nombre: 'Gama', rama: null }, { id: 'E4', nombre: 'Delta', rama: null }]) // rama: nullable, sin fijar → null (REPORT_220)
    // Q está programado antes que P: el orden es por hora programada.
    expect(c.partidos.map((p) => p.gameId)).toEqual(['Q', 'P'])
    expect(c.partidos[1]).toEqual({
      gameId: 'P', rev: 0, estado: 'programado', programadoPara: PROG_P, inicioReal: null, sede: 'Cancha A', periodo: 1,
      reloj: { estado: null, restanteMs: null, desdeMs: null },
      local: { id: 'E1', puntos: 0, faltas: 0 }, visita: { id: 'E2', puntos: 0, faltas: 0 },
    })
  })

  it('no aparece ninguna credencial, hash, dispositivo, recibo, persona, jugador, contacto ni dato interno', async () => {
    const payload = payloadConAgenda(nuevaLiga())
    payload.jugadores[0] = { ...payload.jugadores[0], nombrePila: 'Zenobio', apellido1: 'Ficticio', fechaNacimiento: '2015-03-04', nombreCamiseta: 'ZENO', codigo: 'COD-SECRETO-1' }
    const { ligaId, P } = await sembrada(payload)
    const inicio = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    await P.mandar('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, { t: T0 + 3000 })
    const r = await leerLiga(ligaId)
    const texto = await r.text()
    const prohibidos = [
      tokenDe(ligaId, 'P'), tokenDe(ligaId, 'Q'), 'tok-sintetico', 'semilla-sintetica', 'tel-P', 'tel-Q', 'actor-P', 'deviceId',
      'persona', 'J1', 'J2', 'K1', 'Ana', 'Beto', 'Eva', 'Zenobio', 'Ficticio', 'ZENO', '2015-03-04', 'COD-SECRETO', 'dorsal', 'jugador',
      'recibo', 'cmdId', inicio.sobre.cmdId, 'atribucion', 'preparacion', 'token_hash', 'clientSeq', 'bandeja', 'cuarentena',
      'auditoria', 'credencial', 'organizador', 'ultimoClientSeq', 'versionBloqueo', 'bloqueo', 'contacto', 'documento', 'telefono',
    ]
    for (const p of prohibidos) expect(texto, `contiene «${p}»`).not.toContain(p)
  })

  it('metadatos ausentes: todo queda null, nada se fabrica; la lectura no cambia nada', async () => {
    const { ligaId } = await ligaSembrada(nuevaLiga()) // fixture sin categoría, hora ni sede
    const antes = await sqlDe(ligaId, 'SELECT * FROM partidos ORDER BY id')
    const uno = await json(await leerLiga(ligaId))
    const dos = await json(await leerLiga(ligaId))
    expect({ ...uno, servidorAhoraMs: 0 }).toEqual({ ...dos, servidorAhoraMs: 0 })
    expect(uno.liga.categoria).toBeNull()
    expect(uno.liga.subcategoria).toBeNull()
    for (const p of uno.partidos) expect(p).toMatchObject({ programadoPara: null, inicioReal: null, sede: null })
    expect(await sqlDe(ligaId, 'SELECT * FROM partidos ORDER BY id')).toEqual(antes)
  })

  it('el game GET conserva sus campos y añade hora programada, inicio real, sede, clasificación y alcance de faltas', async () => {
    const { ligaId, P } = await sembrada(payloadConAgenda(nuevaLiga()))
    const comprobar = (c) => {
      expect(claves(c)).toEqual(ordenadas(CAMPOS_PUBLICOS.raiz))
      expect(claves(c.liga)).toEqual(ordenadas(CAMPOS_PUBLICOS.liga))
    }
    const antes = await json(await leerPartido(ligaId, 'P'))
    comprobar(antes)
    expect(antes).toMatchObject({
      estado: 'programado', inicio: null, programadoPara: PROG_P, inicioReal: null, sede: 'Cancha A', faltasAlcance: 'partido',
      liga: { id: ligaId, categoria: 'mini-basketball', subcategoria: { clave: 'u10' } },
    })
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const despues = await json(await leerPartido(ligaId, 'P'))
    comprobar(despues)
    expect(despues).toMatchObject({ estado: 'vivo', inicio: new Date(T0 + 1000).toISOString(), inicioReal: new Date(T0 + 1000).toISOString(), programadoPara: PROG_P, sede: 'Cancha A' })
  })
})

describe('3. semántica de estado, marcador y reloj', () => {
  it('un partido programado cuya hora ya pasó sigue programado y listado como próximo', async () => {
    const payload = payloadConAgenda(nuevaLiga())
    payload.partidos[0].programadoPara = '2020-01-01T10:00:00Z'
    const { ligaId } = await sembrada(payload)
    control.ahoraMs = Date.parse('2030-01-01T00:00:00Z')
    const c = await json(await leerLiga(ligaId))
    expect(c.servidorAhoraMs).toBe(control.ahoraMs)
    const p = c.partidos.find((x) => x.gameId === 'P')
    expect(p).toMatchObject({ estado: 'programado', programadoPara: '2020-01-01T10:00:00.000Z', inicioReal: null })
    expect(c.partidos.map((x) => x.gameId)).toContain('P')
    expect((await json(await leerPartido(ligaId, 'P'))).estado).toBe('programado')
  })

  it('pausa, descanso entre periodos y 00:00 siguen siendo vivo; solo el cierre autoritativo es final', async () => {
    const { ligaId, P } = await sembrada(payloadConAgenda(nuevaLiga()))
    const estadoDeP = async () => (await json(await leerLiga(ligaId))).partidos.find((x) => x.gameId === 'P')
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    expect(await estadoDeP()).toMatchObject({ estado: 'vivo', reloj: { estado: 'corriendo' } })
    await P.mandar('detener-reloj', {}, { t: T0 + 5000 })
    expect(await estadoDeP()).toMatchObject({ estado: 'vivo', reloj: { estado: 'detenido' } }) // pausa
    await fijarEstadoDePartido(ligaId, 'P', { relojEstado: 'detenido', relojRestante: 0, relojDesde: null })
    expect(await estadoDeP()).toMatchObject({ estado: 'vivo', reloj: { estado: 'detenido', restanteMs: 0 } }) // 00:00
    const sig = await P.mandar('siguiente-periodo', {}, { t: T0 + 6000 })
    expect(sig.cuerpo.resultado).toBe('aceptado')
    expect(await estadoDeP()).toMatchObject({ estado: 'vivo', periodo: 2 }) // descanso entre periodos
    const cierre = await P.mandar('cerrar-partido', {}, { t: T0 + 7000 })
    expect(cierre.cuerpo.resultado).toBe('aceptado')
    expect(await estadoDeP()).toMatchObject({ estado: 'final' })
    const otro = (await json(await leerLiga(ligaId))).partidos.find((x) => x.gameId === 'Q')
    expect(otro.estado).toBe('programado') // el otro partido no cambia
  })

  it('anotar, faltas, deshacer, periodo y cierre se ven en la liga y coinciden con la lectura del partido', async () => {
    const { ligaId, P } = await sembrada(payloadConAgenda(nuevaLiga()))
    const ambas = async () => ({
      liga: (await json(await leerLiga(ligaId))).partidos.find((x) => x.gameId === 'P'),
      juego: await json(await leerPartido(ligaId, 'P')),
    })
    const coinciden = ({ liga, juego }) => {
      expect(liga.rev).toBe(juego.rev)
      expect(liga.estado).toBe(juego.estado)
      expect(liga.periodo).toBe(juego.periodo)
      expect(liga.reloj).toEqual(juego.reloj)
      expect(liga.local).toEqual({ id: juego.local.id, puntos: juego.local.puntos, faltas: juego.local.faltas })
      expect(liga.visita).toEqual({ id: juego.visita.id, puntos: juego.visita.puntos, faltas: juego.visita.faltas })
      expect(liga.programadoPara).toBe(juego.programadoPara)
      expect(liga.inicioReal).toBe(juego.inicioReal)
      expect(liga.sede).toBe(juego.sede)
    }
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    await P.mandar('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 3 }, { t: T0 + 3000 })
    await P.mandar('anotar', { equipoId: 'E2', jugadorId: 'J9', puntos: 2 }, { t: T0 + 4000 })
    await P.mandar('falta', { equipoId: 'E1', jugadorId: 'J1' }, { t: T0 + 5000 })
    await P.mandar('falta', { equipoId: 'E1', jugadorId: 'J1' }, { t: T0 + 6000 })
    let v = await ambas()
    coinciden(v)
    expect(v.liga.local).toEqual({ id: 'E1', puntos: 3, faltas: 2 })
    expect(v.liga.visita).toEqual({ id: 'E2', puntos: 2, faltas: 0 })
    await P.mandar('deshacer', {}, { t: T0 + 7000 }) // quita la última falta
    v = await ambas()
    coinciden(v)
    expect(v.liga.local.faltas).toBe(1)
    await P.mandar('detener-reloj', {}, { t: T0 + 8000 })
    await P.mandar('siguiente-periodo', {}, { t: T0 + 9000 })
    v = await ambas()
    coinciden(v)
    expect(v.liga.periodo).toBe(2)
    await P.mandar('cerrar-partido', {}, { t: T0 + 10000 })
    v = await ambas()
    coinciden(v)
    expect(v.liga).toMatchObject({ estado: 'final', local: { puntos: 3 }, visita: { puntos: 2 } })
    // anular un evento tras el cierre también se refleja
    const eventos = await sqlDe(ligaId, "SELECT id FROM eventos WHERE partido_id = 'P' AND json_extract(json, '$.tipo') = 'punto' ORDER BY seq")
    const an = await P.mandar('anular-evento', { eventoId: eventos[0].id }, { t: T0 + 11000 })
    expect(an.cuerpo.resultado).toBe('aceptado')
    v = await ambas()
    coinciden(v)
    expect(v.liga.local.puntos).toBe(0)
  })
})

describe('4. hora programada: sobrevive al inicio', () => {
  it('iniciar el partido no cambia programado_para (columna) y sí fija el inicio real', async () => {
    const { ligaId, P } = await sembrada(payloadConAgenda(nuevaLiga()))
    const antes = await sqlDe(ligaId, "SELECT programado_para, sede FROM partidos WHERE id = 'P'")
    expect(antes).toEqual([{ programado_para: PROG_P, sede: 'Cancha A' }])
    const r = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(r.cuerpo.resultado).toBe('aceptado')
    expect(await sqlDe(ligaId, "SELECT programado_para, sede FROM partidos WHERE id = 'P'")).toEqual(antes)
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    await P.mandar('cerrar-partido', {}, { t: T0 + 3000 })
    expect(await sqlDe(ligaId, "SELECT programado_para, sede FROM partidos WHERE id = 'P'")).toEqual(antes)
    const p = (await json(await leerLiga(ligaId))).partidos.find((x) => x.gameId === 'P')
    expect(p).toMatchObject({ estado: 'final', programadoPara: PROG_P, inicioReal: new Date(T0 + 1000).toISOString() })
  })

  it('la siembra normaliza la hora, acepta milisegundos y rechaza valores inválidos sin sembrar nada', async () => {
    const ligaId = nuevaLiga()
    const ok = payloadConAgenda(ligaId)
    ok.partidos[0].programadoPara = '2026-11-01T14:00:00-05:00'
    ok.partidos[1].programadoPara = Date.parse(PROG_Q)
    expect((await sembrar(ligaId, ok)).status).toBe(201)
    const c = await json(await leerLiga(ligaId))
    expect(c.partidos.find((x) => x.gameId === 'P').programadoPara).toBe('2026-11-01T19:00:00.000Z')
    expect(c.partidos.find((x) => x.gameId === 'Q').programadoPara).toBe(PROG_Q)
    for (const [campo, valor, error] of [
      ['programadoPara', 'mañana', 'partidos.programadoPara'], ['programadoPara', '2026-11-01', 'partidos.programadoPara'],
      ['programadoPara', '2026-11-01T19:00:00', 'partidos.programadoPara'], ['programadoPara', 1.5, 'partidos.programadoPara'],
      ['sede', '', 'partidos.sede'], ['sede', ' con espacio ', 'partidos.sede'], ['sede', 'a\nb', 'partidos.sede'], ['sede', 'x'.repeat(81), 'partidos.sede'], ['sede', 5, 'partidos.sede'],
    ]) {
      const otraLiga = nuevaLiga()
      const malo = payloadConAgenda(otraLiga)
      malo.partidos[0][campo] = valor
      const r = await sembrar(otraLiga, malo)
      expect(r.status, `${campo}=${valor}`).toBe(422)
      expect((await json(r)).errores).toContain(error)
      expect((await leerLiga(otraLiga)).status).toBe(404) // nada se sembró
    }
  })

  it('la clasificación de la siembra usa las representaciones validadas; una inválida se rechaza', async () => {
    const casos = [
      [{ categoria: 'intermediate', subcategoria: { clave: 'u12' } }, { categoria: 'intermediate', subcategoria: { clave: 'u12' } }],
      [{ categoria: 'adult', subcategoria: { texto: '  Sub   Elite ' } }, { categoria: 'adult', subcategoria: { texto: 'Sub Elite' } }],
    ]
    for (const [entrada, esperado] of casos) {
      const ligaId = nuevaLiga()
      const p = payloadDeLiga(ligaId)
      Object.assign(p.liga, entrada)
      expect((await sembrar(ligaId, p)).status).toBe(201)
      expect((await json(await leerLiga(ligaId))).liga).toMatchObject(esperado)
    }
    for (const entrada of [
      { categoria: 'u10', subcategoria: { clave: 'u10' } }, { categoria: 'mini-basketball', subcategoria: { clave: 'u12' } },
      { categoria: 'mini-basketball' }, { subcategoria: { clave: 'u10' } }, { categoria: 'adult', subcategoria: { clave: 'u10', texto: 'x' } },
    ]) {
      const ligaId = nuevaLiga()
      const p = payloadDeLiga(ligaId)
      Object.assign(p.liga, entrada)
      const r = await sembrar(ligaId, p)
      expect(r.status, JSON.stringify(entrada)).toBe(422)
      expect((await json(r)).errores).toContain('liga.categoria')
    }
  })
})

describe('5. migración de la versión 3 en adelante: datos heredados', () => {
  const aVersionTres = (sql) => {
    for (const s of [
      'DROP TABLE resumen_partido',
      'ALTER TABLE ligas DROP COLUMN categoria', 'ALTER TABLE ligas DROP COLUMN subcategoria_json',
      'ALTER TABLE partidos DROP COLUMN programado_para', 'ALTER TABLE partidos DROP COLUMN sede',
      "UPDATE meta SET valor = '3' WHERE clave = 'esquema'",
    ]) sql.exec(s).toArray()
  }
  const poner = (sql, id, estadoParcial) => {
    const fila = sql.exec('SELECT estado_json FROM partidos WHERE id = ?', id).one()
    const e = JSON.parse(fila.estado_json)
    e.partido = { ...e.partido, ...estadoParcial }
    sql.exec('UPDATE partidos SET estado_json = ? WHERE id = ?', JSON.stringify(e), id)
  }
  const volcado = (sql) => JSON.stringify({
    partidos: sql.exec('SELECT id, liga_id, local_id, visita_id, estado_json, rev, ultimo_client_seq, version_bloqueo, version_autorizacion, bloqueo_json FROM partidos ORDER BY id').toArray(),
    ligas: sql.exec('SELECT id, nombre, deporte, minutos_por_periodo FROM ligas').toArray(),
    equipos: sql.exec('SELECT * FROM equipos ORDER BY id').toArray(),
    eventos: sql.exec('SELECT * FROM eventos ORDER BY partido_id, seq').toArray(),
    recibos: sql.exec('SELECT * FROM recibos ORDER BY partido_id, cmd_id').toArray(),
    credenciales: sql.exec('SELECT * FROM credenciales ORDER BY token_hash').toArray(),
    bandeja: sql.exec('SELECT * FROM bandeja ORDER BY id').toArray(),
  })

  it('programado con inicio válido lo conserva como programadoPara; vivo/final y valores no válidos quedan null; no cambia ninguna otra fila', async () => {
    const payload = payloadDeLiga(nuevaLiga())
    payload.partidos.push(
      { id: 'R', localId: 'E1', visitaId: 'E3', inicio: null }, { id: 'S', localId: 'E2', visitaId: 'E4', inicio: null },
      { id: 'T', localId: 'E1', visitaId: 'E4', inicio: null }, { id: 'U', localId: 'E2', visitaId: 'E3', inicio: null },
    )
    const { ligaId, P } = await sembrada(payload)
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 }) // P: vivo con inicio real
    const antes = await dentro(ligaId, (inst) => {
      const sql = inst.almacen.sql
      aVersionTres(sql)
      poner(sql, 'Q', { inicio: '2026-12-05T20:15:00.000Z' }) // programado, válido
      poner(sql, 'R', { inicio: '2026-12-05T15:15:00-05:00' }) // programado, válido con zona → se normaliza
      poner(sql, 'S', { inicio: 'pronto' }) // programado, no es un instante
      poner(sql, 'T', { inicio: '2026-12-05T20:15:00' }) // programado, sin zona: ambiguo
      poner(sql, 'U', { estado: 'final', inicio: '2026-12-05T20:15:00.000Z' }) // final: su inicio puede ser el real
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe('3')
      return volcado(sql)
    })
    const despues = await dentro(ligaId, (inst) => {
      crearEsquema(inst.almacen)
      crearEsquema(inst.almacen) // idempotente
      const sql = inst.almacen.sql
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe(String(VERSION_ESQUEMA))
      inst.repararResumenesAlArrancar() // el arranque real repara los resúmenes que la migración dejó sin llenar
      return {
        volcado: volcado(sql),
        filas: Object.fromEntries(sql.exec('SELECT id, programado_para, sede FROM partidos').toArray().map((f) => [f.id, f])),
        liga: sql.exec('SELECT categoria, subcategoria_json FROM ligas').one(),
      }
    })
    expect(despues.volcado).toBe(antes) // ninguna fila existente cambió
    expect(despues.filas.Q).toEqual({ id: 'Q', programado_para: '2026-12-05T20:15:00.000Z', sede: null })
    expect(despues.filas.R.programado_para).toBe('2026-12-05T20:15:00.000Z')
    for (const id of ['P', 'S', 'T', 'U']) expect(despues.filas[id], id).toEqual({ id, programado_para: null, sede: null }) // P es vivo; U final
    expect(despues.liga).toEqual({ categoria: null, subcategoria_json: null })
    // y la lectura pública lo refleja sin inventar nada
    const c = await json(await leerLiga(ligaId))
    const por = Object.fromEntries(c.partidos.map((x) => [x.gameId, x]))
    expect(por.Q).toMatchObject({ estado: 'programado', programadoPara: '2026-12-05T20:15:00.000Z', sede: null })
    expect(por.P).toMatchObject({ estado: 'vivo', programadoPara: null, inicioReal: new Date(T0 + 1000).toISOString() })
    expect(por.U).toMatchObject({ estado: 'final', programadoPara: null })
    expect(c.liga.categoria).toBeNull()
    // lo heredado sigue funcionando: se inicia Q y su hora programada no cambia
    const Q = new (P.constructor)(ligaId, 'Q')
    const r = await Q.mandar('iniciar-partido', {}, { t: T0 + 2000 })
    expect(r.cuerpo.resultado).toBe('aceptado')
    expect(await sqlDe(ligaId, "SELECT programado_para FROM partidos WHERE id = 'Q'")).toEqual([{ programado_para: '2026-12-05T20:15:00.000Z' }])
  })

  it('si la migración falla a mitad, se deshace entera: sin columnas, sin datos nuevos y versión 3', async () => {
    const { ligaId } = await sembrada(payloadConAgenda(nuevaLiga()))
    await dentro(ligaId, (inst) => {
      const sql = inst.almacen.sql
      aVersionTres(sql)
      sql.exec('ALTER TABLE partidos ADD COLUMN sede TEXT').toArray() // la cuarta sentencia chocará
      const antes = volcado(sql)
      expect(() => crearEsquema(inst.almacen)).toThrow()
      const cols = (t) => sql.exec(`PRAGMA table_info(${t})`).toArray().map((c) => c.name)
      expect(cols('ligas')).not.toContain('categoria') // las sentencias anteriores también se deshicieron
      expect(cols('partidos')).not.toContain('programado_para')
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe('3')
      expect(volcado(sql)).toBe(antes)
    })
  })

  it('un fallo en la conservación de datos (después de añadir las columnas) también deshace todo', async () => {
    const { ligaId } = await sembrada(payloadConAgenda(nuevaLiga()))
    await dentro(ligaId, (inst) => {
      const sql = inst.almacen.sql
      aVersionTres(sql)
      poner(sql, 'P', { inicio: '2026-12-05T20:15:00.000Z' })
      // Cualquier UPDATE de partidos aborta: la fase de datos fallará DESPUÉS de que las cuatro columnas ya se añadieron.
      sql.exec("CREATE TRIGGER falla_prueba BEFORE UPDATE ON partidos BEGIN SELECT RAISE(ABORT, 'falla-de-prueba'); END").toArray()
      const antes = volcado(sql)
      expect(() => crearEsquema(inst.almacen)).toThrow()
      const cols = (t) => sql.exec(`PRAGMA table_info(${t})`).toArray().map((c) => c.name)
      expect(cols('ligas')).not.toContain('categoria')
      expect(cols('partidos')).not.toEqual(expect.arrayContaining(['programado_para', 'sede']))
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe('3')
      expect(volcado(sql)).toBe(antes)
      sql.exec('DROP TRIGGER falla_prueba').toArray()
      crearEsquema(inst.almacen) // sin el fallo, la migración se completa
      expect(sql.exec("SELECT valor FROM meta WHERE clave = 'esquema'").one().valor).toBe(String(VERSION_ESQUEMA))
      expect(sql.exec("SELECT programado_para FROM partidos WHERE id = 'P'").one().programado_para).toBe('2026-12-05T20:15:00.000Z')
    })
  })
})

describe('6. límites y orden determinista', () => {
  it('el orden es: hora programada ascendente, partidos sin hora al final, y por id en empates; no depende del orden de inserción', async () => {
    const ligaId = nuevaLiga()
    const p = payloadDeLiga(ligaId)
    p.partidos = [
      { id: 'Z', localId: 'E1', visitaId: 'E2', programadoPara: null },
      { id: 'B', localId: 'E1', visitaId: 'E3', programadoPara: '2026-11-02T10:00:00Z' },
      { id: 'A', localId: 'E1', visitaId: 'E4', programadoPara: '2026-11-02T10:00:00Z' },
      { id: 'C', localId: 'E2', visitaId: 'E3', programadoPara: '2026-11-01T10:00:00Z' },
      { id: 'Y', localId: 'E2', visitaId: 'E4', programadoPara: null },
    ]
    p.credenciales = []
    expect((await sembrar(ligaId, p)).status).toBe(201)
    const uno = await json(await leerLiga(ligaId))
    expect(uno.partidos.map((x) => x.gameId)).toEqual(['C', 'A', 'B', 'Y', 'Z'])
    const dos = await json(await leerLiga(ligaId))
    expect(dos.partidos).toEqual(uno.partidos)
    expect(uno.equipos.map((e) => e.id)).toEqual(['E1', 'E2', 'E3', 'E4'])
  })

  it('un tope rebasado devuelve el error acotado documentado, nunca una lista truncada', async () => {
    const { ligaId, P } = await sembrada(payloadConAgenda(nuevaLiga()))
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const normal = LIMITES_LECTURA_PUBLICA
    for (const limites of [{ ...normal, partidos: 1 }, { ...normal, equipos: 3 }]) {
      control.limitesPublicos = limites
      const r = await leerLiga(ligaId)
      expect(r.status).toBe(507)
      expect(await json(r)).toEqual({ error: 'liga-demasiado-grande' })
    }
    control.limitesPublicos = { ...normal, partidos: 2, equipos: 4 } // justo en el tope: cabe
    const ok = await leerLiga(ligaId)
    expect(ok.status).toBe(200)
    expect((await json(ok)).partidos.length).toBe(2)
  })

  it('los topes de producción son los documentados', () => {
    expect(LIMITES_LECTURA_PUBLICA).toEqual({ partidos: 300, equipos: 100 })
  })
})
