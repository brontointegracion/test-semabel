import { env, exports } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { construirSobre } from '../../src/lib/motor/reglas.js'
import { firmaDeReglas } from '../../src/lib/reglas-categoria.js'
import { SEMILLA_TOKEN, T0, payloadDeLiga, tokenDe } from './fixtures/sintetico.js'

export { T0 }
const BASE = 'https://backend.local'

export const stubDe = (ligaId) => env.LIGA.get(env.LIGA.idFromName(ligaId))
/** Ejecuta `fn(instancia, estadoDelObjeto)` DENTRO del Durable Object de la liga. */
export const dentro = (ligaId, fn) => runInDurableObject(stubDe(ligaId), fn)
export const sqlDe = (ligaId, consulta, ...args) =>
  dentro(ligaId, (inst) => inst.almacen.sql.exec(consulta, ...args).toArray())

export async function sembrar(ligaId, payload = payloadDeLiga(ligaId), token = SEMILLA_TOKEN) {
  return exports.default.fetch(new Request(`${BASE}/v1/_semilla/ligas/${ligaId}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }))
}

export const postComando = (ligaId, gameId, token, cuerpo, { cabeceras = {}, crudo } = {}) =>
  exports.default.fetch(new Request(`${BASE}/v1/ligas/${ligaId}/partidos/${gameId}/comandos`, {
    method: 'POST',
    headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), 'content-type': 'application/json', ...cabeceras },
    body: crudo ?? JSON.stringify(cuerpo),
  }))

export const leerPartido = (ligaId, gameId) =>
  exports.default.fetch(new Request(`${BASE}/v1/ligas/${ligaId}/partidos/${gameId}`))

export const leerEstado = (ligaId, gameId, token, { cabeceras = {}, query = '', metodo = 'GET' } = {}) =>
  exports.default.fetch(new Request(`${BASE}/v1/ligas/${ligaId}/partidos/${gameId}/estado${query}`, {
    method: metodo,
    headers: token === null ? cabeceras : { authorization: `Bearer ${token}`, ...cabeceras },
  }))

export const json = async (respuesta) => respuesta.json()

/** Teléfono sintético: ve el estado de confianza del servidor y arma sobres con las funciones del motor. */
export class Telefono {
  constructor(ligaId, gameId, { token = tokenDe(ligaId, gameId), deviceId = `tel-${gameId}` } = {}) {
    this.ligaId = ligaId
    this.gameId = gameId
    this.token = token
    this.deviceId = deviceId
    this.n = 0
  }

  estado() { return dentro(this.ligaId, (inst) => inst.adaptador.estadoVigente(this.gameId)) }
  preparacion() { return dentro(this.ligaId, (inst) => inst.adaptador.preparacionVigente(this.gameId)) }
  ultimoSeq() { return sqlDe(this.ligaId, 'SELECT ultimo_client_seq AS s FROM partidos WHERE id = ?', this.gameId).then((r) => r[0].s) }

  async sobre(tipo, datos = {}, opts = {}) {
    const base = opts.estado ?? await this.estado()
    const orden = { cmdId: opts.cmdId ?? `${this.gameId}-c${++this.n}-${Math.random().toString(36).slice(2, 7)}`, tipo, datos, tiempo: opts.tiempo ?? { accionTs: opts.t ?? T0 } }
    if (tipo === 'iniciar-partido') {
      // Reglas de categoría que «la pantalla mostraba»: por omisión las del estado vigente (como un teléfono al día); solo se
      // envían si hay reglas (un partido sin ellas conserva el sobre de siempre). `opts.reglasConfirmadas` lo fuerza (null = omitir).
      const firma = 'reglasConfirmadas' in opts ? opts.reglasConfirmadas : firmaDeReglas(base.config)
      if (firma != null && firma !== 'ninguna') orden.reglasConfirmadas = firma
      else if (firma === 'ninguna' && 'reglasConfirmadas' in opts) orden.reglasConfirmadas = firma
      if ('preparacionVersion' in opts) {
        if (opts.preparacionVersion != null) orden.preparacionVersion = opts.preparacionVersion
      } else {
        orden.preparacionVersion = (await this.preparacion())?.version
      }
    }
    return construirSobre(base, orden, { deviceId: this.deviceId, clientSeq: opts.seq ?? (await this.ultimoSeq()) + 1 })
  }

  enviar(sobre, token = this.token) { return postComando(this.ligaId, this.gameId, token, sobre) }

  async mandar(tipo, datos, opts) {
    const sobre = await this.sobre(tipo, datos, opts)
    const respuesta = await this.enviar(sobre)
    return { sobre, respuesta, cuerpo: await respuesta.json() }
  }
}

/** Siembra una liga nueva y devuelve los teléfonos de P y Q. */
export async function ligaSembrada(ligaId, payload) {
  const r = await sembrar(ligaId, payload)
  if (r.status !== 201) throw new Error(`siembra falló: ${r.status} ${await r.text()}`)
  return { ligaId, P: new Telefono(ligaId, 'P'), Q: new Telefono(ligaId, 'Q') }
}

/** Cambia el estado guardado de un partido (solo para preparar escenarios). */
export function fijarEstadoDePartido(ligaId, gameId, partido) {
  return dentro(ligaId, (inst) => {
    const sql = inst.almacen.sql
    const fila = sql.exec('SELECT estado_json FROM partidos WHERE id = ?', gameId).one()
    const e = JSON.parse(fila.estado_json)
    e.partido = { ...e.partido, ...partido }
    sql.exec('UPDATE partidos SET estado_json = ? WHERE id = ?', JSON.stringify(e), gameId)
  })
}

export const editarJugador = (ligaId, id, campos) => dentro(ligaId, (inst) => {
  const sql = inst.almacen.sql
  for (const [k, v] of Object.entries(campos)) sql.exec(`UPDATE jugadores SET ${k} = ? WHERE id = ?`, v, id)
})

export const conteos = (ligaId, gameId) => dentro(ligaId, (inst) => {
  const sql = inst.almacen.sql
  const n = (t) => sql.exec(`SELECT COUNT(*) AS n FROM ${t} WHERE partido_id = ?`, gameId).one().n
  const p = sql.exec('SELECT rev, ultimo_client_seq AS seq FROM partidos WHERE id = ?', gameId).one()
  return { recibos: n('recibos'), eventos: n('eventos'), auditoria: n('auditoria_reloj'), bandeja: n('bandeja'), cuarentena: n('cuarentena'), rev: p.rev, seq: p.seq }
})
