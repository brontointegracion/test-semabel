import { describe, expect, it, afterEach } from 'vitest'
import { env } from 'cloudflare:workers'
import worker from '../src/worker.js'
import { control } from './worker-prueba.js'
import { nuevaLiga } from './fixtures/sintetico.js'
import { ejecutar } from '../../src/lib/motor/orquestador.js'
import { crearAdaptadorLiga } from '../src/adaptador-liga.js'
import { clasificarFallo } from '../src/clasificacion.js'
import { aRespuesta } from '../src/respuestas.js'
import { T0, conteos, dentro, ligaSembrada } from './ayuda.js'

// CONTRATO DE RESPUESTA de un comando (ver README.md). Cada clase tiene su evidencia y su acción de cliente:
//   422/400/413            validación           corregir el sobre
//   401                    autorización         (genérico, sin detalle)
//   200 rechazado          rechazo DEFINITIVO   recibo durable; flujo aprobado: releer, confirmar, cmdId NUEVO
//   500/503 fallo-sin-escritura   fallo conocido, este intento no escribió   reenviar el MISMO sobre
//   503 resultado-desconocido     desenlace no probado                         reenviar el MISMO sobre
//   200 aceptado           confirmado           (la publicación pendiente no es un fallo)

afterEach(() => { control.trasConfirmar = null; control.pausa = null; control.pausaAut = null; control.ahoraMs = null })

const SIN_ESCRITURA = (motivo) => ({
  tipo: 'fallo-sin-escritura', esteIntento: 'sin-escritura', alcance: 'solo-este-intento', motivo, reintento: 'mismo-sobre',
})
const DESCONOCIDO = { tipo: 'resultado-desconocido', reintento: 'mismo-sobre' }
const leer = async (r) => ({ status: r.status, cuerpo: await r.json() })

// Daño que hace fallar la LECTURA (antes de cualquier escritura) y que se puede reparar.
const dañarBloqueo = (ligaId) => dentro(ligaId, (inst) => inst.almacen.sql.exec("UPDATE partidos SET bloqueo_json = '{no es json' WHERE id = 'P'").toArray())
const repararBloqueo = (ligaId) => dentro(ligaId, (inst) => inst.almacen.sql.exec("UPDATE partidos SET bloqueo_json = NULL WHERE id = 'P'").toArray())

describe('1. fallo conocido ANTES de cualquier escritura', () => {
  it('no se etiqueta como resultado desconocido: es fallo-sin-escritura, sin cambios, y el mismo sobre funciona al repararse', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    const antes = await conteos(ligaId, 'P')
    await dañarBloqueo(ligaId)

    const r = await leer(await P.enviar(sobre))
    expect(r.status).toBe(500)
    expect(r.cuerpo).toEqual(SIN_ESCRITURA('interno'))
    expect(r.cuerpo.tipo).not.toBe('resultado-desconocido')
    expect(await conteos(ligaId, 'P')).toEqual(antes)

    await repararBloqueo(ligaId)
    const ok = await leer(await P.enviar(sobre)) // el MISMO sobre, el mismo cmdId
    expect(ok.status).toBe(200)
    expect(ok.cuerpo.resultado).toBe('aceptado')
    expect((await conteos(ligaId, 'P')).recibos).toBe(1)
  })

  it('un fallo de lectura nunca es un rechazo definitivo: no hay recibo ni se consume la secuencia', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    await dañarBloqueo(ligaId)
    const r = await leer(await P.enviar(sobre))
    expect(r.cuerpo).not.toHaveProperty('recibo')
    expect(r.cuerpo).not.toHaveProperty('resultado')
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 0, seq: 0 })
  })
})

describe('2. reversión comprobada de una transacción', () => {
  it('clasifica reversion-verificada y deja intactos estado previo, recibos, cursor, eventos y bandeja', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    await P.mandar('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, { t: T0 + 3000 })
    const antes = await conteos(ligaId, 'P')
    const estadoAntes = await P.estado()
    await dentro(ligaId, (inst) => inst.almacen.sql.exec(
      "CREATE TRIGGER fallo_bandeja BEFORE INSERT ON bandeja BEGIN SELECT RAISE(ABORT, 'detalle-sql-interno'); END",
    ).toArray())
    const sobre = await P.sobre('anotar', { equipoId: 'E2', jugadorId: 'J9', puntos: 3 }, { t: T0 + 4000 })

    const r = await leer(await P.enviar(sobre))
    expect(r.status).toBe(500)
    expect(r.cuerpo).toEqual(SIN_ESCRITURA('reversion-verificada'))
    expect(await conteos(ligaId, 'P')).toEqual(antes)
    expect(await P.estado()).toEqual(estadoAntes)
  })
})

describe('2b. sin evidencia no hay clasificación de "sin escritura"', () => {
  // Un almacenamiento de pruebas que NO deshace nada o cuyo cierre falla: la clasificación debe negarse a afirmar
  // "sin escritura" y dejar el resultado desconocido. Usa el SQLite real del objeto pero sin la transacción.
  const clasificarConAlmacen = (ligaId, sobre, token, fabricar) => dentro(ligaId, async (inst) => {
    const falso = fabricar(inst.almacen)
    const adaptador = crearAdaptadorLiga({ storage: falso })
    const ejecucion = adaptador.paraEjecucion()
    try {
      return aRespuesta(await ejecutar(ejecucion, sobre, { recibidoEn: T0 + 5000, credencial: token }))
    } catch (error) {
      return clasificarFallo(error, ejecucion.traza)
    }
  })

  it('si lo observable después NO coincide con lo de antes (no hubo reversión), un error SQL queda desconocido', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    await dentro(ligaId, (inst) => inst.almacen.sql.exec(
      "CREATE TRIGGER fallo_bandeja BEFORE INSERT ON bandeja BEGIN SELECT RAISE(ABORT, 'detalle-sql-interno'); END",
    ).toArray())
    // transactionSync "sin rollback": el recibo y el cursor ya escritos se quedan.
    const r = await clasificarConAlmacen(ligaId, sobre, P.token, (almacen) => ({ sql: almacen.sql, transactionSync: (fn) => fn() }))
    expect(r).toEqual({ status: 503, cuerpo: DESCONOCIDO })
    expect((await conteos(ligaId, 'P')).recibos).toBe(1) // y en efecto quedó escrito: afirmar "sin escritura" habría sido falso
  })

  it('si el cierre de la transacción falla DESPUÉS de que el callback terminó bien, queda desconocido', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    const r = await clasificarConAlmacen(ligaId, sobre, P.token, (almacen) => ({
      sql: almacen.sql,
      transactionSync: (fn) => { const valor = fn(); void valor; throw new Error('fallo al cerrar la transacción') },
    }))
    expect(r).toEqual({ status: 503, cuerpo: DESCONOCIDO })
  })
})

describe('3. fallo POSTERIOR a la confirmación', () => {
  it('conserva el comando aceptado, responde lo confirmado y un reintento autorizado devuelve el recibo original', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    control.trasConfirmar = async () => { throw new Error('fallo-despues-de-confirmar: detalle interno') }

    const r = await leer(await P.enviar(sobre))
    expect(r.status).toBe(200) // confirmado: no es un fallo del comando
    expect(r.cuerpo.resultado).toBe('aceptado')
    expect(r.cuerpo.publicacion).toBe('pendiente')
    expect(JSON.stringify(r.cuerpo)).not.toContain('detalle interno')
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 1, rev: 1, seq: 1, bandeja: 1 })

    control.trasConfirmar = null
    const retry = await leer(await P.enviar(sobre))
    expect(retry.cuerpo.resultado).toBe('recibo-existente')
    expect(retry.cuerpo.recibo).toEqual(r.cuerpo.recibo)
    expect((await conteos(ligaId, 'P')).recibos).toBe(1)
  })

  it('un fallo posterior a un rechazo definitivo también devuelve el rechazo guardado', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000, preparacionVersion: null })
    control.trasConfirmar = async () => { throw new Error('detalle interno') }
    const r = await leer(await P.enviar(sobre))
    expect(r.status).toBe(200)
    expect(r.cuerpo.resultado).toBe('rechazado')
    expect(r.cuerpo.recibo.motivo).toBe('preparacion-version-ausente')
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 1, seq: 1, rev: 0 })
  })

  it('el fallo de PUBLICACIÓN no se describe como fallo de la confirmación', async () => {
    const { P } = await ligaSembrada(nuevaLiga())
    const r = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(r.respuesta.status).toBe(200)
    expect(r.cuerpo).toMatchObject({ resultado: 'aceptado', publicacion: 'pendiente' })
    expect(r.cuerpo).not.toHaveProperty('tipo')
  })
})

describe('4. respuesta perdida o fallo de transporte Worker ↔ Durable Object', () => {
  // El Durable Object ejecuta y CONFIRMA el comando, pero la respuesta nunca llega al Worker.
  const envConRespuestaPerdida = () => ({
    ...env,
    LIGA: {
      idFromName: (n) => env.LIGA.idFromName(n),
      get: (id) => {
        const real = env.LIGA.get(id)
        return { ejecutarComando: async (a) => { await real.ejecutarComando(a); throw new Error('conexión perdida: detalle interno') } }
      },
    },
  })
  const peticion = (ligaId, token, sobre) => new Request(`https://x/v1/ligas/${ligaId}/partidos/P/comandos`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(sobre),
  })

  it('sigue siendo resultado desconocido (no se afirma ni éxito ni fracaso) y el reintento recupera el recibo original', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    const perdida = await leer(await worker.fetch(peticion(ligaId, P.token, sobre), envConRespuestaPerdida()))
    expect(perdida.status).toBe(503)
    expect(perdida.cuerpo).toEqual(DESCONOCIDO)
    expect(JSON.stringify(perdida.cuerpo)).not.toContain('detalle interno')
    expect((await conteos(ligaId, 'P')).recibos).toBe(1) // en realidad SÍ se confirmó

    const retry = await leer(await P.enviar(sobre)) // mismo sobre, mismo cmdId
    expect(retry.cuerpo.resultado).toBe('recibo-existente')
    expect(retry.cuerpo.recibo.cmdId).toBe(sobre.cmdId)
  })

  it('la contención agotada es un fallo conocido (cada conflicto salió sin escribir), no un desconocido', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    // Cada vez que el servidor lee, otra petición sube la versión de autorización: 3 conflictos seguidos.
    let veces = 0
    control.pausa = async () => {
      veces += 1
      await dentro(ligaId, (inst) => inst.almacen.sql.exec("UPDATE partidos SET version_autorizacion = version_autorizacion + 1 WHERE id = 'P'").toArray())
    }
    const r = await leer(await P.enviar(sobre))
    expect(veces).toBe(3)
    expect(r.status).toBe(503)
    expect(r.cuerpo).toEqual(SIN_ESCRITURA('contencion'))
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 0, seq: 0, rev: 0 })
  })
})

describe('5. un reintento fallido no implica que el comando anterior se rechazó', () => {
  it('el reintento de un comando ya aceptado que falla al leer dice solo "este intento no escribió"; el recibo sigue ahí', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const aceptado = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await dañarBloqueo(ligaId)

    const r = await leer(await P.enviar(aceptado.sobre))
    expect(r.status).toBe(500)
    expect(r.cuerpo).toEqual(SIN_ESCRITURA('interno'))
    expect(r.cuerpo.alcance).toBe('solo-este-intento')
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/rechaz|nuevo|cmdId|recibo/i)
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 1, rev: 1, seq: 1 }) // lo aceptado antes sigue intacto

    await repararBloqueo(ligaId)
    const final = await leer(await P.enviar(aceptado.sobre))
    expect(final.cuerpo.resultado).toBe('recibo-existente')
    expect(final.cuerpo.recibo).toEqual(aceptado.cuerpo.recibo)
  })
})

describe('6. las demás clases conservan su comportamiento distinto', () => {
  it('validación 422, autorización 401, rechazo definitivo 200 y fallo conocido 500 son cuatro respuestas diferentes', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const valido = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })

    const validacion = await leer(await P.enviar({ ...valido, campoRaro: 1 }))
    expect(validacion.status).toBe(422)
    expect(validacion.cuerpo.error).toBe('sobre-invalido')

    const noAut = await leer(await P.enviar(valido, 'token-inventado-0123456789'))
    expect(noAut).toEqual({ status: 401, cuerpo: { error: 'no-autorizado' } })

    const rechazo = await leer(await P.enviar(await P.sobre('iniciar-partido', {}, { t: T0 + 1000, preparacionVersion: null })))
    expect(rechazo.status).toBe(200)
    expect(rechazo.cuerpo.resultado).toBe('rechazado')

    await dañarBloqueo(ligaId)
    const fallo = await leer(await P.enviar(await P.sobre('iniciar-partido', {}, { t: T0 + 2000, seq: 2 })))
    expect(fallo.status).toBe(500)
    expect(fallo.cuerpo.tipo).toBe('fallo-sin-escritura')
  })

  it('un fallo interno NO se filtra a quien no está autorizado: sigue el 401 genérico', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    await dañarBloqueo(ligaId) // el estado está dañado, pero eso no se revela sin autorización
    const r = await leer(await P.enviar(sobre, 'token-inventado-0123456789'))
    expect(r).toEqual({ status: 401, cuerpo: { error: 'no-autorizado' } })
  })
})

describe('7. las respuestas públicas no contienen diagnósticos sensibles', () => {
  it('ni SQL, ni trazas, ni mensajes internos, ni credenciales, ni recibos en los fallos', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await dentro(ligaId, (inst) => inst.almacen.sql.exec(
      "CREATE TRIGGER fallo_bandeja BEFORE INSERT ON bandeja BEGIN SELECT RAISE(ABORT, 'detalle-sql-interno'); END",
    ).toArray())
    const revertido = await P.enviar(await P.sobre('iniciar-partido', {}, { t: T0 + 1000 }))
    await dentro(ligaId, (inst) => inst.almacen.sql.exec('DROP TRIGGER fallo_bandeja').toArray())
    await dañarBloqueo(ligaId)
    const lectura = await P.enviar(await P.sobre('iniciar-partido', {}, { t: T0 + 1000, seq: 1 }))
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    const perdida = await worker.fetch(new Request(`https://x/v1/ligas/${ligaId}/partidos/P/comandos`, {
      method: 'POST', headers: { authorization: `Bearer ${P.token}` }, body: JSON.stringify(sobre),
    }), { ...env, LIGA: { idFromName: (n) => env.LIGA.idFromName(n), get: () => ({ ejecutarComando: async () => { throw new Error('SQLITE_ERROR stack at detalle') } }) } })

    const prohibido = /SQLITE|SQL|trigger|RAISE|detalle|stack|\bat \w|Unexpected token|JSON|Error|partido_id|bandeja|bloqueo_json|tok-sintetico|recibo|cmdId/i
    for (const respuesta of [revertido, lectura, perdida]) {
      const texto = await respuesta.text()
      expect(texto, texto).not.toMatch(prohibido)
      expect(['fallo-sin-escritura', 'resultado-desconocido']).toContain(JSON.parse(texto).tipo)
    }
  })
})
