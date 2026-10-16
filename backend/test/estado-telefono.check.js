import { afterEach, describe, expect, it } from 'vitest'
import { crearEstado } from '../../src/lib/motor/estado.js'
import { atribucionIntegra } from '../../src/lib/motor/atribucion.js'
import { aplicarEfectos, decidirOrden } from '../../src/lib/motor/reglas.js'
import { validarSobre } from '../../src/lib/motor/sobre.js'
import { crearCola, encolar, reconstruirProvisional } from '../../src/lib/motor/cola.js'
import { duracionMs } from '../../src/lib/reloj-calculo.js'
import { revocarCredencial } from '../src/control.js'
import { sha256Hex } from '../src/credenciales.js'
import { LIMITES_ESTADO_CONTROL } from '../src/lectura-estado-control.js'
import { tokenDe } from './fixtures/sintetico.js'
import { conteos, dentro, editarJugador, leerEstado, leerPartido } from './ayuda.js'
import { T0, control, ligaStub, pedir, volcarObjeto } from './ayuda-acceso.js'
import { accion, conLigasObservadas, escenarioPlantilla, payloadPlantilla } from './ayuda-plantilla.js'

// Lectura autoritativa del estado para el teléfono que controla un partido (backend/src/lectura-estado-control.js).
// Todo es SINTÉTICO. La lista de claves de cada nivel está escrita aquí a mano a propósito: si fuera la del código, un
// cambio accidental de contrato no se vería.

const GENERICO = { error: 'no-autorizado' }
afterEach(() => { control.ahoraMs = null; control.pausaEstado = null; control.limitesEstado = null })

const claves = (o) => Object.keys(o).sort()
const ver = async (respuesta) => {
  const texto = await respuesta.text() // el cuerpo se lee de inmediato: el runtime no permite leerlo después de llamar a otros objetos
  let cuerpo = null
  try { cuerpo = JSON.parse(texto) } catch { /* sin JSON */ }
  return { status: respuesta.status, texto, cuerpo, respuesta }
}
const leer = async (ligaId, juego, token, extra) => ver(await leerEstado(ligaId, juego, token, extra))
const leerP = (e) => leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))
const bytesUtf8 = (texto) => new TextEncoder().encode(texto).length

/** El estado del motor tal como lo reconstruiría un cliente con SOLO esta respuesta. */
const estadoDeLectura = (c) => crearEstado({
  gameId: c.gameId, rev: c.cursor.rev, config: c.estado.config, partido: c.estado.partido, eventos: c.estado.eventos,
  auditSeq: c.estado.auditSeq, corridaSeq: c.estado.corridaSeq, cursorReloj: c.estado.cursorReloj, atribucion: c.atribucion,
})

const JUGADA = [
  // [nombre, tipo, datos(sobre) o función de cmdId previos, t]
  ['inicio', 'iniciar-partido', {}, 1000],
  ['arranque', 'arrancar-reloj', {}, 2000],
  ['punto J1', 'anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, 3000],
  ['falta J9', 'falta', { equipoId: 'E2', jugadorId: 'J9' }, 4000],
  ['punto J2', 'anotar', { equipoId: 'E1', jugadorId: 'J2', puntos: 3 }, 5000],
  ['parada', 'detener-reloj', {}, 6000],
  ['anular punto J1', 'anular-evento', 'anular-J1', 7000],
  ['deshacer', 'deshacer', {}, 8000],
  ['rehacer', 'rehacer', {}, 9000],
  ['siguiente periodo', 'siguiente-periodo', {}, 10000],
  ['punto J9', 'anotar', { equipoId: 'E2', jugadorId: 'J9', puntos: 1 }, 11000],
  ['cierre', 'cerrar-partido', {}, 12000],
]

/** Manda UNA orden con el reloj del servidor en `t`. */
async function mandar(P, tipo, datos, t) {
  control.ahoraMs = T0 + t
  return P.mandar(tipo, datos, { t: T0 + t })
}

describe('contrato: lista blanca exacta', () => {
  it('claves exactas en cada nivel, antes y después de jugar; cabeceras sin caché', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const comprobar = (c) => {
      expect(claves(c)).toEqual(['atribucion', 'credencial', 'cursor', 'deviceId', 'estado', 'etiquetas', 'gameId', 'partido', 'servidorAhoraMs', 'version', 'visualizacion'])
      expect(claves(c.credencial)).toEqual(['expiraEn', 'retornoHasta'])
      expect(claves(c.cursor)).toEqual(['rev', 'ultimoClientSeq'])
      expect(claves(c.partido)).toEqual(['ligaId', 'localId', 'visitaId'])
      expect(claves(c.estado)).toEqual(['auditSeq', 'config', 'corridaSeq', 'cursorReloj', 'eventos', 'partido'])
      expect(claves(c.estado.config)).toEqual(['deporte', 'minutosPorPeriodo'])
      expect(claves(c.estado.partido)).toEqual(['estado', 'inicio', 'relojDesde', 'relojEstado', 'relojRestante'])
      expect(claves(c.atribucion)).toEqual(['equipos', 'jugadores', 'version'])
      for (const j of Object.values(c.atribucion.jugadores)) expect(claves(j)).toEqual(['elegible', 'equipoId'])
      for (const x of c.etiquetas) expect(claves(x)).toEqual(['etiqueta', 'id'])
      const permitidos = ['id', 'partidoId', 'seq', 'tipo', 'equipoId', 'jugadorId', 'puntos', 'periodo', 'anulado', 'creadoEn', 'anuladoEn', 'anuladoRev', 'rehacerBloqueado']
      for (const ev of c.estado.eventos) for (const k of Object.keys(ev)) expect(permitidos, `clave de evento «${k}»`).toContain(k)
    }
    const antes = await leerP(e)
    expect(antes.status).toBe(200)
    comprobar(antes.cuerpo)
    expect(antes.cuerpo).toMatchObject({
      version: 1, gameId: 'P', deviceId: 'tel-P', servidorAhoraMs: T0, credencial: { expiraEn: null, retornoHasta: null },
      cursor: { rev: 0, ultimoClientSeq: 0 }, partido: { ligaId: e.ligaId, localId: 'E1', visitaId: 'E2' },
    })
    expect(antes.cuerpo.estado).toEqual({
      config: { deporte: 'baloncesto', minutosPorPeriodo: 10 },
      partido: { estado: 'programado', inicio: null, relojEstado: null, relojRestante: null, relojDesde: null },
      auditSeq: 0, corridaSeq: null, cursorReloj: null, eventos: [],
    })
    expect(antes.respuesta.headers.get('cache-control')).toBe('no-store')
    expect(antes.respuesta.headers.get('x-content-type-options')).toBe('nosniff')
    expect(antes.respuesta.headers.get('referrer-policy')).toBe('no-referrer')
    expect(antes.respuesta.headers.get('content-type')).toMatch(/^application\/json/)

    await mandar(P, 'iniciar-partido', {}, 1000)
    await mandar(P, 'arrancar-reloj', {}, 2000)
    await mandar(P, 'anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, 3000)
    await mandar(P, 'falta', { equipoId: 'E2', jugadorId: 'J9' }, 4000)
    comprobar((await leerP(e)).cuerpo)
  })

  it('la configuración efectiva se devuelve tal cual está guardada, también nula, sin inventar duraciones', async () => {
    for (const minutos of [null, 12]) {
      const e = await escenarioPlantilla({ payload: (id) => { const p = payloadPlantilla(id); p.liga.minutosPorPeriodo = minutos; return p } })
      const P = e.telefono(e.ligaId, 'P')
      const antes = (await leerP(e)).cuerpo
      expect(antes.estado.config).toEqual({ deporte: 'baloncesto', minutosPorPeriodo: minutos })
      expect((await mandar(P, 'iniciar-partido', {}, 1000)).cuerpo.resultado).toBe('aceptado')
      const despues = (await leerP(e)).cuerpo
      expect(despues.estado.config).toEqual(antes.estado.config)
      // lo guardado al iniciar es exactamente lo que la función del motor calcula con ESA configuración (la de respaldo del
      // prototipo cuando es nula: no es una duración aprobada para el piloto real)
      expect(despues.estado.partido.relojRestante).toBe(duracionMs(despues.estado.config))
    }
  })
})

describe('instantáneas consistentes y compatibles con el motor', () => {
  it('tras cada orden aceptada: cursor, eventos, reloj y atribución coinciden con el estado del servidor y la atribución es íntegra', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    let idPuntoJ1 = null
    for (const [nombre, tipo, datos, t] of JUGADA) {
      const d = datos === 'anular-J1' ? { eventoId: idPuntoJ1 } : datos
      const r = await mandar(P, tipo, d, t)
      expect(r.cuerpo.resultado, nombre).toBe('aceptado')
      if (nombre === 'punto J1') idPuntoJ1 = r.sobre.cmdId // el id del evento deriva del cmdId

      const l = await leerP(e)
      expect(l.status, nombre).toBe(200)
      const c = l.cuerpo
      const cont = await conteos(e.ligaId, 'P')
      expect(c.cursor, nombre).toEqual({ rev: cont.rev, ultimoClientSeq: cont.seq })
      expect(c.servidorAhoraMs).toBe(T0 + t)
      expect(atribucionIntegra(c.atribucion), nombre).toBe(true)
      expect(c.estado.eventos.length).toBe(cont.eventos)
      expect(estadoDeLectura(c), nombre).toEqual(await P.estado()) // la reconstrucción del cliente ES el estado del servidor
    }
  })

  it('paridad de la siguiente orden: decidir sobre el estado hidratado da lo mismo que decide el servidor (aceptadas y rechazadas)', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    await mandar(P, 'iniciar-partido', {}, 1000)
    await mandar(P, 'arrancar-reloj', {}, 2000)
    const viejo = await P.estado()

    const casos = [
      ['punto válido', 'anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, 3000, {}],
      ['ficha inactiva', 'anotar', { equipoId: 'E1', jugadorId: 'JX', puntos: 2 }, 3500, {}],
      ['jugador de otro equipo', 'falta', { equipoId: 'E1', jugadorId: 'J9' }, 4000, {}],
      ['puntos no válidos', 'anotar', { equipoId: 'E1', jugadorId: 'J2', puntos: 5 }, 4500, {}],
      ['observación vieja', 'anotar', { equipoId: 'E1', jugadorId: 'J2', puntos: 2 }, 5000, { estado: viejo }],
      ['falta válida', 'falta', { equipoId: 'E2', jugadorId: 'J9' }, 5500, {}],
      ['parada', 'detener-reloj', {}, 6000, {}],
      ['deshacer', 'deshacer', {}, 7000, {}],
      ['anular desconocido', 'anular-evento', { eventoId: 'no-existe' }, 8000, {}],
    ]
    let aceptados = 0
    let rechazados = 0
    for (const [nombre, tipo, datos, t, opts] of casos) {
      control.ahoraMs = T0 + t
      const base = estadoDeLectura((await leerP(e)).cuerpo)
      const sobre = await P.sobre(tipo, datos, { t: T0 + t, ...opts })
      const v = validarSobre(sobre)
      expect(v.ok, nombre).toBe(true)
      const local = decidirOrden(base, v.sobre, { recibidoEn: T0 + t, actorId: 'actor-P' })
      const cuerpo = await (await P.enviar(sobre)).json()
      if (local.ok) {
        aceptados += 1
        expect(cuerpo.resultado, nombre).toBe('aceptado')
        expect(cuerpo.recibo.revDespues, nombre).toBe(base.rev + 1)
        expect(cuerpo.recibo.refs.eventosNuevos, nombre).toEqual(local.efectos.eventosNuevos.map((x) => x.id))
        expect(estadoDeLectura((await leerP(e)).cuerpo), nombre).toEqual(aplicarEfectos(base, local.efectos))
      } else {
        rechazados += 1
        expect(cuerpo.resultado, nombre).toBe('rechazado')
        expect(cuerpo.recibo.motivo, nombre).toBe(local.motivo)
        expect(estadoDeLectura((await leerP(e)).cuerpo), nombre).toEqual(base) // un rechazo no cambia el estado
      }
    }
    expect([aceptados > 0, rechazados > 0]).toEqual([true, true]) // la prueba cubre ambos caminos
  })

  it('reconstrucción provisional: base hidratada + órdenes en cola da el mismo estado que el servidor tras aceptarlas', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    await mandar(P, 'iniciar-partido', {}, 1000)
    const c = (await leerP(e)).cuerpo
    const base = estadoDeLectura(c)
    const ctx = (t) => ({ ahoraEstimado: T0 + t, actorId: 'actor-P' })

    let cola = crearCola({ gameId: c.gameId, deviceId: c.deviceId, ultimoClientSeqServidor: c.cursor.ultimoClientSeq, revServidor: c.cursor.rev })
    let provisional = base
    const sobres = []
    for (const [cmdId, tipo, datos, t] of [
      ['prov-arranque', 'arrancar-reloj', {}, 2000],
      ['prov-punto', 'anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, 3000],
      ['prov-falta', 'falta', { equipoId: 'E2', jugadorId: 'J9' }, 4000],
    ]) {
      const r = encolar(cola, provisional, { cmdId, tipo, datos, tiempo: { accionTs: T0 + t } }, ctx(t))
      expect(r.rechazoLocal, cmdId).toBeUndefined()
      cola = r.cola; provisional = r.estado; sobres.push([r.sobre, t])
    }
    expect(sobres.map(([s]) => s.clientSeq)).toEqual([c.cursor.ultimoClientSeq + 1, c.cursor.ultimoClientSeq + 2, c.cursor.ultimoClientSeq + 3])
    const rec = reconstruirProvisional(base, cola, ctx(4000))
    expect(rec.ok).toBe(true)
    expect(rec.estado).toEqual(provisional)

    for (const [sobre, t] of sobres) {
      control.ahoraMs = T0 + t
      expect((await (await P.enviar(sobre)).json()).resultado).toBe('aceptado')
    }
    expect(estadoDeLectura((await leerP(e)).cuerpo)).toEqual(provisional)
  })
})

describe('etiquetas', () => {
  it('activos de los dos equipos y referenciados por los eventos, también si se desactivaron después; null si la ficha no tiene nombre', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    for (const [, tipo, datos, t] of JUGADA.slice(0, 6)) await mandar(P, tipo, datos, t)
    await mandar(P, 'cerrar-partido', {}, 7000) // el cierre libera el bloqueo de plantilla
    const antes = (await leerP(e)).cuerpo
    expect(antes.etiquetas).toEqual([
      { id: 'J1', etiqueta: 'ANA' }, { id: 'J2', etiqueta: 'Beto Muestra' }, { id: 'J9', etiqueta: 'Eva Visita' },
    ])
    expect(antes.etiquetas.map((x) => x.id)).not.toContain('JX') // inactivo y sin eventos

    const baja = await accion(e.cookie, e.ligaId, 'E1', 'J2', 'desactivar', { revEsperada: 1 })
    expect(baja.cuerpo.resultado).toBe('aplicado')
    const despues = (await leerP(e)).cuerpo
    expect(despues.atribucion.jugadores.J2.elegible).toBe(false) // ya no es elegible…
    expect(despues.etiquetas.find((x) => x.id === 'J2')).toEqual({ id: 'J2', etiqueta: 'Beto Muestra' }) // …pero su evento sigue teniendo nombre
    expect(despues.estado.eventos.some((ev) => ev.jugadorId === 'J2')).toBe(true)
    expect(despues.etiquetas.map((x) => x.id)).toEqual(['J1', 'J2', 'J9'])
    expect(despues.atribucion.jugadores.JX.elegible).toBe(false)
    expect(despues.etiquetas.map((x) => x.id)).not.toContain('JX')

    // nombre en camiseta manda sobre el nombre; ficha anterior sin ningún nombre → null
    await editarJugador(e.ligaId, 'J2', { nombre_camiseta: 'BETO' })
    await editarJugador(e.ligaId, 'J9', { nombre: null, nombre_camiseta: null })
    const fin = (await leerP(e)).cuerpo
    expect(fin.etiquetas).toEqual([{ id: 'J1', etiqueta: 'ANA' }, { id: 'J2', etiqueta: 'BETO' }, { id: 'J9', etiqueta: null }])
    // y las etiquetas están FUERA de la atribución: cambiarlas no cambia su versión ni su integridad
    expect(fin.atribucion).toEqual(despues.atribucion)
    expect(atribucionIntegra(fin.atribucion)).toBe(true)
  })
})

describe('privacidad', () => {
  it('ni fechas, contactos, personas globales, códigos, hashes, recibos, auditoría ni otros partidos; los identificadores de evento derivados de cmdId sí se permiten', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const R = e.telefono(e.ligaId, 'R') // otro partido de la misma liga (comparte E1)
    const tokenP = tokenDe(e.ligaId, 'P')
    const inicioP = await mandar(P, 'iniciar-partido', {}, 1000)
    const arranque = await mandar(P, 'arrancar-reloj', {}, 2000)
    const punto = await mandar(P, 'anotar', { equipoId: 'E1', jugadorId: 'J2', puntos: 3 }, 3000)
    const rechazada = await mandar(P, 'anotar', { equipoId: 'E1', jugadorId: 'JX', puntos: 2 }, 3500) // recibo de rechazo, sin evento
    expect([punto.cuerpo.resultado, rechazada.cuerpo.resultado]).toEqual(['aceptado', 'rechazado'])
    // otro partido con sus propios comandos y eventos (P ocupa E1, así que R no puede iniciar aquí: se prueba con Q-no-listo y R rechazado)
    const deR = await R.mandar('iniciar-partido', {}, { t: T0 + 1000 })

    const texto = (await ver(await leerEstado(e.ligaId, 'P', tokenP))).texto
    const hashP = await sha256Hex(tokenP)
    const prohibidos = [
      '2015', '4321', 'persona-', 'personaId', 'fechaNacimiento', 'codigo', 'apellido2', 'nombreCamiseta', 'nacimiento', // (REPORT_127: nombrePila y apellido1 ahora SÍ van, en `visualizacion`, por contrato)
      'Dario', 'Hugo', 'Gil', 'Legado', 'L1', 'K1', 'K2',
      tokenP, tokenDe(e.ligaId, 'Q'), tokenDe(e.ligaId, 'R'), hashP, 'tok-sintetico', 'actor-P', 'token_hash', 'tokenHash',
      e.organizadorId, 'operacion', 'auditoria', 'bandeja', 'cuarentena', 'recibo', 'cmdId', 'preparacion', 'bloqueo',
      // identificadores de comandos que NO son eventos: relojes (su fila de auditoría lleva «:a»), recibos de rechazo y otro partido
      inicioP.sobre.cmdId, arranque.sobre.cmdId, rechazada.sobre.cmdId, deR.sobre.cmdId,
    ]
    for (const p of prohibidos) expect(texto, `contiene «${p}»`).not.toContain(p)
    // lo que SÍ puede aparecer: el id del evento aceptado, que deriva del cmdId de su orden
    expect(JSON.parse(texto).estado.eventos.map((ev) => ev.id)).toEqual([punto.sobre.cmdId])
    // y el partido de la respuesta es solo este
    expect(JSON.parse(texto).gameId).toBe('P')
    expect(JSON.parse(texto).estado.eventos.every((ev) => ev.partidoId === 'P')).toBe(true)
  })
})

describe('privacidad: lo que no está en la lista blanca no sale aunque esté guardado', () => {
  it('claves desconocidas de un evento, del partido o de la configuración guardados no se copian', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    await mandar(P, 'iniciar-partido', {}, 1000)
    await dentro(e.ligaId, (inst) => {
      const sql = inst.almacen.sql
      sql.exec(
        'INSERT INTO eventos (partido_id, id, seq, json) VALUES (?, ?, ?, ?)', 'P', 'ev-extra', 1,
        JSON.stringify({ id: 'ev-extra', partidoId: 'P', seq: 1, tipo: 'punto', equipoId: 'E1', jugadorId: 'J1', puntos: 2, periodo: 1, anulado: false, creadoEn: T0, interno: 'SECRETO-EVENTO', reciboPrivado: { x: 'SECRETO-RECIBO' } }),
      )
      const fila = sql.exec("SELECT estado_json FROM partidos WHERE id = 'P'").one()
      const est = JSON.parse(fila.estado_json)
      est.partido.interno = 'SECRETO-PARTIDO'
      est.config.interno = 'SECRETO-CONFIG'
      sql.exec("UPDATE partidos SET estado_json = ? WHERE id = 'P'", JSON.stringify(est))
    })
    const r = await leerP(e)
    expect(r.status).toBe(200)
    expect(r.cuerpo.estado.eventos.map((ev) => ev.id)).toEqual(['ev-extra'])
    expect(r.texto).not.toContain('SECRETO')
    expect(claves(r.cuerpo.estado.eventos[0])).toEqual(['anulado', 'creadoEn', 'equipoId', 'id', 'jugadorId', 'partidoId', 'periodo', 'puntos', 'seq', 'tipo'])
    expect(claves(r.cuerpo.estado.config)).toEqual(['deporte', 'minutosPorPeriodo'])
    expect(claves(r.cuerpo.estado.partido)).toEqual(['estado', 'inicio', 'relojDesde', 'relojEstado', 'relojRestante'])
  })
})

describe('credencial, método y encabezado', () => {
  it('sin credencial, token desconocido, token de otro partido, cookie de organizador, esquema o formato malos, token en la URL: siempre el mismo 401', async () => {
    const e = await escenarioPlantilla()
    const tokenP = tokenDe(e.ligaId, 'P')
    const intentos = [
      await leer(e.ligaId, 'P', null),
      await leer(e.ligaId, 'P', 'token-que-no-existe-0000000000'),
      await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'Q')),
      await leer(e.ligaId, 'Q', tokenP),
      await leer(e.ligaId, 'P', null, { cabeceras: { cookie: `__Host-sesion=${e.cookie}` } }),
      await leer(e.ligaId, 'P', null, { query: `?token=${tokenP}&access_token=${tokenP}` }),
      await leer(e.ligaId, 'P', null, { cabeceras: { authorization: `Basic ${tokenP}` } }),
      await leer(e.ligaId, 'P', null, { cabeceras: { authorization: `bearer ${tokenP}` } }),
      await leer(e.ligaId, 'P', null, { cabeceras: { authorization: 'Bearer' } }),
      await leer(e.ligaId, 'P', null, { cabeceras: { authorization: `Bearer ${tokenP} x` } }),
      await leer(e.ligaId, 'P', 'x'.repeat(600)),
      await leer(e.ligaId, 'NO-EXISTE', tokenP), // partido desconocido
    ]
    for (const r of intentos) { expect(r.status).toBe(401); expect(r.cuerpo).toEqual(GENERICO); expect(r.respuesta.headers.get('cache-control')).toBe('no-store') }
    expect((await leerP(e)).status).toBe(200)
  })

  it('el token de OTRA liga no sirve aquí, aunque el partido tenga el mismo id', async () => {
    const e = await escenarioPlantilla({ ligas: 2 })
    const [a, b] = e.ligas
    expect((await leer(a, 'P', tokenDe(a, 'P'))).status).toBe(200)
    expect(await leer(b, 'P', tokenDe(a, 'P'))).toMatchObject({ status: 401, cuerpo: GENERICO })
  })

  it('solo GET: los demás métodos reciben 405 con allow: GET', async () => {
    const e = await escenarioPlantilla()
    for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'), { metodo })
      expect(r.status, metodo).toBe(405)
      expect(r.respuesta.headers.get('allow')).toBe('GET')
    }
  })

  it('revocada: 401 genérico; la de otro partido no se afecta', async () => {
    const e = await escenarioPlantilla()
    const hash = await sha256Hex(tokenDe(e.ligaId, 'P'))
    expect((await leerP(e)).status).toBe(200)
    await dentro(e.ligaId, (inst) => revocarCredencial(inst.almacen, hash))
    expect(await leerP(e)).toMatchObject({ status: 401, cuerpo: GENERICO })
    expect((await leer(e.ligaId, 'Q', tokenDe(e.ligaId, 'Q'))).status).toBe(200)
  })

  it('borde de la caducidad: activa un instante antes de expira_en; desde ese instante ni en recuperación ni vencida (siempre 401)', async () => {
    const e = await escenarioPlantilla()
    const fijar = (expira, retorno) => dentro(e.ligaId, (inst) => inst.almacen.sql.exec("UPDATE credenciales SET expira_en = ?, retorno_hasta = ? WHERE partido_id = 'P'", expira, retorno).toArray())
    await fijar(T0 + 5000, T0 + 9000)
    control.ahoraMs = T0 + 4999
    const dentroDeVigencia = await leerP(e)
    expect(dentroDeVigencia.status).toBe(200)
    expect(dentroDeVigencia.cuerpo.credencial).toEqual({ expiraEn: T0 + 5000, retornoHasta: T0 + 9000 })
    control.ahoraMs = T0 + 5000 // en recuperación: solo repite recibos
    expect(await leerP(e)).toMatchObject({ status: 401, cuerpo: GENERICO })
    control.ahoraMs = T0 + 8999
    expect((await leerP(e)).status).toBe(401)
    control.ahoraMs = T0 + 9000 // vencida del todo
    expect((await leerP(e)).status).toBe(401)
    await fijar(T0 + 5000, null)
    control.ahoraMs = T0 + 5000
    expect((await leerP(e)).status).toBe(401)
  })

  it('en recuperación NO lee el estado, pero el reintento exacto de una orden ya aceptada sigue devolviendo su recibo original', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const inicio = await mandar(P, 'iniciar-partido', {}, 1000)
    await dentro(e.ligaId, (inst) => inst.almacen.sql.exec("UPDATE credenciales SET expira_en = ?, retorno_hasta = ? WHERE partido_id = 'P'", T0 + 1500, T0 + 100_000).toArray())
    control.ahoraMs = T0 + 2000
    expect(await leerP(e)).toMatchObject({ status: 401, cuerpo: GENERICO })
    const reintento = await (await P.enviar(inicio.sobre)).json()
    expect(reintento.resultado).toBe('recibo-existente')
    expect(reintento.recibo).toEqual(inicio.cuerpo.recibo)
  })
})

describe('admisión de la liga antes de cualquier acceso al binding', () => {
  it('liga no admitida: 404 sin tocar ningún Durable Object, con cualquier método y con credencial de apariencia válida', async () => {
    const e = await escenarioPlantilla()
    const { accesos, entorno } = conLigasObservadas()
    const cabeceras = { authorization: `Bearer ${tokenDe(e.ligaId, 'P')}` }
    for (const metodo of ['GET', 'POST', 'DELETE']) {
      const r = await pedir(metodo, '/v1/ligas/LIGA-NO-ADMITIDA/partidos/P/estado', { cabeceras, entorno, cuerpo: metodo === 'GET' ? undefined : {} })
      expect(r.status, metodo).toBe(404)
      expect(r.cuerpo).toEqual({ error: 'no-encontrado' })
    }
    expect(accesos).toEqual([])
  })

  it('en una liga admitida: el método y el encabezado se rechazan sin tocar el binding; solo una petición bien formada llega al objeto', async () => {
    const e = await escenarioPlantilla()
    const { accesos, entorno } = conLigasObservadas()
    const ruta = `/v1/ligas/${e.ligaId}/partidos/P/estado`
    expect((await pedir('POST', ruta, { cuerpo: {}, cabeceras: { authorization: `Bearer ${tokenDe(e.ligaId, 'P')}` }, entorno })).status).toBe(405)
    expect((await pedir('GET', ruta, { entorno })).status).toBe(401)
    expect(accesos).toEqual([])
    expect((await pedir('GET', ruta, { cabeceras: { authorization: `Bearer ${tokenDe(e.ligaId, 'P')}` }, entorno })).status).toBe(200)
    expect(accesos).toEqual([e.ligaId])
  })

  it('rutas vecinas no cambian: la lectura pública y la de preparación siguen donde estaban; /estado/ con barra final no existe', async () => {
    const e = await escenarioPlantilla()
    expect((await leerPartido(e.ligaId, 'P')).status).toBe(200)
    expect((await pedir('GET', `/v1/ligas/${e.ligaId}/partidos/P/preparacion`, { cabeceras: { authorization: `Bearer ${tokenDe(e.ligaId, 'P')}` } })).status).toBe(200)
    expect((await pedir('GET', `/v1/ligas/${e.ligaId}/partidos/P/estado/`, { cabeceras: { authorization: `Bearer ${tokenDe(e.ligaId, 'P')}` } })).status).toBe(404)
  })
})

describe('la autorización se vuelve a comprobar antes de leer nada protegido', () => {
  /** Detiene UNA vez la primera lectura justo después de resumir el token y antes del tramo sincrónico. */
  function pausarTrasResumir() {
    let avisar
    const pausada = new Promise((r) => { avisar = r })
    let liberar
    const hastaLiberar = new Promise((r) => { liberar = r })
    let usada = false
    control.pausaEstado = async () => { if (usada) return; usada = true; avisar(); await hastaLiberar }
    return { pausada, liberar }
  }
  const sinContenido = (r) => {
    expect(r.status).toBe(401)
    expect(r.cuerpo).toEqual(GENERICO)
    for (const p of ['eventos', 'gameId', 'deviceId', 'atribucion', 'etiquetas', 'Beto', 'tel-P']) expect(r.texto).not.toContain(p)
  }

  async function enMarcha() {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    await mandar(P, 'iniciar-partido', {}, 1000)
    await mandar(P, 'anotar', { equipoId: 'E1', jugadorId: 'J2', puntos: 2 }, 2000)
    return { e, hash: await sha256Hex(tokenDe(e.ligaId, 'P')), antes: await conteos(e.ligaId, 'P') }
  }

  it('revocada entre el resumen y la lectura: 401 genérico sin contenido', async () => {
    const { e, hash, antes } = await enMarcha()
    const { pausada, liberar } = pausarTrasResumir()
    const lectura = leerEstado(e.ligaId, 'P', tokenDe(e.ligaId, 'P')).then(ver)
    await pausada
    await dentro(e.ligaId, (inst) => revocarCredencial(inst.almacen, hash))
    liberar()
    sinContenido(await lectura)
    expect(await conteos(e.ligaId, 'P')).toEqual(antes)
  })

  it('reasignada a otro partido entre el resumen y la lectura: 401 genérico', async () => {
    const { e, hash } = await enMarcha()
    const { pausada, liberar } = pausarTrasResumir()
    const lectura = leerEstado(e.ligaId, 'P', tokenDe(e.ligaId, 'P')).then(ver)
    await pausada
    await dentro(e.ligaId, (inst) => {
      inst.almacen.sql.exec("UPDATE credenciales SET revocada = 1 WHERE partido_id = 'Q'").toArray() // el índice único solo admite una activa por partido
      inst.almacen.sql.exec("UPDATE credenciales SET partido_id = 'Q' WHERE token_hash = ?", hash).toArray()
    })
    liberar()
    sinContenido(await lectura)
  })

  it('vence entre el resumen y la lectura (la hora se toma DENTRO del tramo protegido): 401 genérico', async () => {
    const { e } = await enMarcha()
    await dentro(e.ligaId, (inst) => inst.almacen.sql.exec("UPDATE credenciales SET expira_en = ?, retorno_hasta = ? WHERE partido_id = 'P'", T0 + 50_000, T0 + 90_000).toArray())
    const { pausada, liberar } = pausarTrasResumir()
    const lectura = leerEstado(e.ligaId, 'P', tokenDe(e.ligaId, 'P')).then(ver)
    await pausada
    control.ahoraMs = T0 + 50_000
    liberar()
    sinContenido(await lectura)
  })
})

describe('no escribe nada y no altera los reintentos aceptados', () => {
  it('leer (incluidas las denegaciones y el 507) no cambia ninguna tabla; el reintento exacto de lo aceptado devuelve su recibo original aunque la plantilla haya cambiado', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const inicio = await mandar(P, 'iniciar-partido', {}, 1000)
    await mandar(P, 'arrancar-reloj', {}, 2000)
    const punto = await mandar(P, 'anotar', { equipoId: 'E1', jugadorId: 'J2', puntos: 3 }, 3000)
    await mandar(P, 'detener-reloj', {}, 4000)
    await mandar(P, 'cerrar-partido', {}, 5000)

    const volcado = () => volcarObjeto(ligaStub(e.ligaId))
    const antes = await volcado()
    const conteoAntes = await conteos(e.ligaId, 'P')
    for (let i = 0; i < 3; i += 1) expect((await leerP(e)).status).toBe(200)
    expect((await leer(e.ligaId, 'P', 'desconocido-0000000000000')).status).toBe(401)
    control.limitesEstado = { maxEventos: 0, maxBytes: 10 }
    expect((await leerP(e)).status).toBe(507)
    control.limitesEstado = null
    expect(await volcado()).toBe(antes)
    expect(await conteos(e.ligaId, 'P')).toEqual(conteoAntes)

    // la plantilla cambia después del cierre (J2 anotó y ahora se desactiva y se renumera)
    expect((await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: { dorsal: 8 } })).cuerpo.resultado).toBe('aplicado')
    expect((await accion(e.cookie, e.ligaId, 'E1', 'J2', 'desactivar', { revEsperada: 2 })).cuerpo.resultado).toBe('aplicado')
    for (const previa of [inicio, punto]) {
      const r = await (await P.enviar(previa.sobre)).json()
      expect(r.resultado).toBe('recibo-existente')
      expect(r.recibo).toEqual(previa.cuerpo.recibo)
    }
  })
})

describe('límites provisionales: cantidad de eventos y bytes UTF-8', () => {
  async function conTresEventos() {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    await mandar(P, 'iniciar-partido', {}, 1000)
    await mandar(P, 'arrancar-reloj', {}, 2000)
    await mandar(P, 'anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, 3000)
    await mandar(P, 'falta', { equipoId: 'E2', jugadorId: 'J9' }, 4000)
    await mandar(P, 'anotar', { equipoId: 'E1', jugadorId: 'J2', puntos: 3 }, 5000)
    expect((await conteos(e.ligaId, 'P')).eventos).toBe(3)
    return e
  }
  const instrumentar = (ligaId) => dentro(ligaId, (inst) => {
    inst.__llamadas = 0
    inst.__original = inst.adaptador.estadoVigente
    inst.adaptador.estadoVigente = (g) => { inst.__llamadas += 1; return inst.__original(g) }
  })
  const llamadas = (ligaId) => dentro(ligaId, (inst) => { const n = inst.__llamadas; inst.adaptador.estadoVigente = inst.__original; return n })

  it('los valores por defecto son los aprobados como provisionales y sin sustituir funcionan', async () => {
    expect(LIMITES_ESTADO_CONTROL).toEqual({ maxEventos: 4000, maxBytes: 1024 * 1024 })
    const e = await conTresEventos()
    control.limitesEstado = null
    expect((await leerP(e)).status).toBe(200)
  })

  it('cantidad de eventos: exactamente el tope pasa; uno más es 507 fijo, sin cuerpo parcial, y el recuento va ANTES de armar la instantánea', async () => {
    const e = await conTresEventos()
    control.limitesEstado = { maxEventos: 3, maxBytes: 1024 * 1024 }
    await instrumentar(e.ligaId)
    expect((await leerP(e)).status).toBe(200)
    expect(await llamadas(e.ligaId)).toBe(1)

    control.limitesEstado = { maxEventos: 2, maxBytes: 1024 * 1024 }
    await instrumentar(e.ligaId)
    const r = await leerP(e)
    expect(r.status).toBe(507)
    expect(r.cuerpo).toEqual({ error: 'estado-demasiado-grande' })
    for (const p of ['eventos', 'cursor', 'atribucion', 'gameId']) expect(r.texto).not.toContain(p)
    expect(r.respuesta.headers.get('cache-control')).toBe('no-store')
    expect(await llamadas(e.ligaId)).toBe(0) // no se armó el estado
  })

  it('bytes: el tope cuenta BYTES UTF-8, no caracteres; exactamente el tope pasa y uno menos es 507 sin cuerpo parcial', async () => {
    const e = await conTresEventos()
    await editarJugador(e.ligaId, 'J2', { nombre_camiseta: 'ÑANDÚ🏀' }) // varios bytes por carácter
    const libre = await leerP(e)
    expect(libre.status).toBe(200)
    const bytes = bytesUtf8(libre.texto)
    expect(bytes).toBeGreaterThan(libre.texto.length) // si no, la prueba no distinguiría bytes de caracteres
    expect(JSON.parse(libre.texto).etiquetas.find((x) => x.id === 'J2').etiqueta).toBe('ÑANDÚ🏀')

    control.limitesEstado = { maxEventos: 4000, maxBytes: bytes }
    const justo = await leerP(e)
    expect(justo.status).toBe(200)
    expect(justo.texto).toBe(libre.texto)

    control.limitesEstado = { maxEventos: 4000, maxBytes: bytes - 1 }
    const pasado = await leerP(e)
    expect(pasado.status).toBe(507)
    expect(pasado.cuerpo).toEqual({ error: 'estado-demasiado-grande' })
    expect(pasado.texto).not.toContain('eventos')

    control.limitesEstado = { maxEventos: 4000, maxBytes: libre.texto.length } // el número de caracteres no basta
    expect((await leerP(e)).status).toBe(507)
  })

  it('con los topes por defecto: 4000 eventos caben (y son una instantánea completa); 4001 es 507', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    await mandar(P, 'iniciar-partido', {}, 1000)
    const insertar = (desde, hasta) => dentro(e.ligaId, (inst) => {
      for (let n = desde; n <= hasta; n += 1) {
        inst.almacen.sql.exec(
          'INSERT INTO eventos (partido_id, id, seq, json) VALUES (?, ?, ?, ?)', 'P', `sint-${n}`, n,
          JSON.stringify({ id: `sint-${n}`, partidoId: 'P', seq: n, tipo: 'punto', equipoId: 'E1', jugadorId: 'J1', puntos: 1, periodo: 1, anulado: false, creadoEn: T0 }),
        )
      }
    })
    await insertar(1, 4000)
    const lleno = await leerP(e)
    expect(lleno.status).toBe(200)
    expect(lleno.cuerpo.estado.eventos).toHaveLength(4000)
    expect(bytesUtf8(lleno.texto)).toBeLessThan(LIMITES_ESTADO_CONTROL.maxBytes)
    await insertar(4001, 4001)
    const pasado = await leerP(e)
    expect(pasado.status).toBe(507)
    expect(pasado.cuerpo).toEqual({ error: 'estado-demasiado-grande' })
  })

  it('el tamaño no se revela a quien no está autorizado: con topes mínimos, una credencial mala sigue recibiendo el 401 genérico', async () => {
    const e = await conTresEventos()
    control.limitesEstado = { maxEventos: 0, maxBytes: 1 }
    expect(await leer(e.ligaId, 'P', 'desconocido-0000000000000')).toMatchObject({ status: 401, cuerpo: GENERICO })
    expect(await leer(e.ligaId, 'P', null)).toMatchObject({ status: 401, cuerpo: GENERICO })
    expect((await leerP(e)).status).toBe(507)
  })

  it('superar los topes solo bloquea la lectura: el manejo de órdenes no cambia', async () => {
    const e = await conTresEventos()
    const P = e.telefono(e.ligaId, 'P')
    control.limitesEstado = { maxEventos: 0, maxBytes: 1 }
    expect((await leerP(e)).status).toBe(507)
    expect((await mandar(P, 'falta', { equipoId: 'E2', jugadorId: 'J9' }, 6000)).cuerpo.resultado).toBe('aceptado')
  })
})
