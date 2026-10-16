import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { preparacionIntegra } from '../../src/lib/motor/preparacion.js'
import { tokenDe } from './fixtures/sintetico.js'
import { conteos, dentro, sqlDe } from './ayuda.js'
import { T0, control, pedir, reiniciarAcceso } from './ayuda-acceso.js'
import { accion, escenarioPlantilla, nuevaOp, payloadPlantilla } from './ayuda-plantilla.js'

beforeEach(async () => { await reiniciarAcceso() })
afterEach(() => { control.ahoraMs = null; control.trasConfirmar = null })

const leer = (ligaId, juego, token, extra = {}) => pedir('GET', `/v1/ligas/${ligaId}/partidos/${juego}/preparacion`, {
  cabeceras: token === null ? extra : { authorization: `Bearer ${token}`, ...extra },
})
const GENERICO = { error: 'no-autorizado' }

describe('lectura de preparación del teléfono: contenido', () => {
  it('devuelve SOLO { preparacion, etiquetas, rev, ultimoClientSeq }; la preparación es la íntegra del motor y las etiquetas van fuera de ella', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const r = await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))
    expect(r.status).toBe(200)
    expect(Object.keys(r.cuerpo).sort()).toEqual(['etiquetas', 'preparacion', 'rev', 'ultimoClientSeq'])
    expect(r.respuesta.headers.get('cache-control')).toBe('no-store')
    expect(r.cuerpo.preparacion).toEqual(await P.preparacion()) // exactamente lo que el servidor compara al confirmar el inicio
    expect(preparacionIntegra(r.cuerpo.preparacion, { gameId: 'P' })).toBe(true)
    expect(r.cuerpo.preparacion).not.toHaveProperty('etiquetas')
    expect(r.cuerpo).toMatchObject({ rev: 0, ultimoClientSeq: 0 })
    // etiquetas: nombre en camiseta si lo hay; si no, el nombre completo; solo jugadores ACTIVOS de los dos equipos
    expect(r.cuerpo.etiquetas).toEqual([
      { id: 'J1', etiqueta: 'ANA' }, { id: 'J2', etiqueta: 'Beto Muestra' }, { id: 'J9', etiqueta: 'Eva Visita' },
    ])
    expect(r.cuerpo.preparacion.jugadores.map((j) => j.id)).toEqual(r.cuerpo.etiquetas.map((x) => x.id)) // mismas personas, mismo orden
  })

  it('no envía fecha de nacimiento, persona, código, partes del nombre, revisión de ficha, inactivos ni datos del organizador', async () => {
    const e = await escenarioPlantilla()
    const texto = JSON.stringify((await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))).cuerpo)
    for (const prohibido of ['2015', '4321', 'persona-', 'personaId', 'codigo', 'fechaNacimiento', 'nombrePila', 'apellido', 'JX', 'Dario', 'desactivad', e.organizadorId, 'operacion', 'auditoria', 'L1', 'Hugo']) {
      expect(texto, prohibido).not.toContain(prohibido)
    }
  })

  it('rev y ultimoClientSeq salen de la misma lectura que la preparación y avanzan con el partido; la huella no cambia con los nombres', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const v1 = (await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))).cuerpo
    expect((await P.mandar('iniciar-partido', {}, { t: T0 + 1000, preparacionVersion: v1.preparacion.version })).cuerpo.resultado).toBe('aceptado')
    const v2 = (await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))).cuerpo
    const c = await conteos(e.ligaId, 'P')
    expect([v2.rev, v2.ultimoClientSeq]).toEqual([c.rev, c.seq])
    expect(v2.preparacion.version).toBe(v1.preparacion.version)
  })

  it('un cambio de número cambia la huella; un cambio de nombre en camiseta cambia la etiqueta pero no la huella', async () => {
    const e = await escenarioPlantilla()
    const v1 = (await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))).cuerpo
    await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: { nombreCamiseta: 'BETO' } })
    const v2 = (await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))).cuerpo
    expect(v2.preparacion.version).toBe(v1.preparacion.version)
    expect(v2.etiquetas.find((x) => x.id === 'J2').etiqueta).toBe('BETO')
    await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 2, campos: { dorsal: 8 } })
    const v3 = (await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))).cuerpo
    expect(v3.preparacion.version).not.toBe(v1.preparacion.version)
    await accion(e.cookie, e.ligaId, 'E1', 'J2', 'desactivar', { revEsperada: 3 })
    const v4 = (await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))).cuerpo
    expect(v4.etiquetas.map((x) => x.id)).not.toContain('J2') // el refresco trae solo activos: el cliente conserva sus etiquetas históricas
    expect(v2.etiquetas.map((x) => x.id)).toContain('J2')
  })
})

describe('lectura de preparación: solo una credencial activa del partido', () => {
  it('sin credencial, token desconocido, token de OTRO partido, revocada, vencida o en recuperación: siempre el mismo 401', async () => {
    const e = await escenarioPlantilla()
    const tokenP = tokenDe(e.ligaId, 'P')
    const respuestas = []
    respuestas.push(await leer(e.ligaId, 'P', null))
    respuestas.push(await leer(e.ligaId, 'P', 'token-que-no-existe-0000000000'))
    respuestas.push(await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'Q'))) // credencial de otro partido
    respuestas.push(await leer(e.ligaId, 'Q', tokenP)) // y al revés
    respuestas.push(await leer(e.ligaId, 'P', null, { cookie: `__Host-sesion=${e.cookie}` })) // la cookie del organizador no es una credencial de partido
    for (const r of respuestas) { expect(r.status).toBe(401); expect(r.cuerpo).toEqual(GENERICO) }

    expect((await leer(e.ligaId, 'P', tokenP)).status).toBe(200)
    // en recuperación (pasó la hora de procesar comandos, pero sigue el horizonte de reintentos): 401 aquí
    await dentro(e.ligaId, (inst) => inst.almacen.sql.exec("UPDATE credenciales SET expira_en = ?, retorno_hasta = ? WHERE partido_id = 'P'", T0 - 1, T0 + 10_000).toArray())
    expect(await leer(e.ligaId, 'P', tokenP)).toMatchObject({ status: 401, cuerpo: GENERICO })
    // vencida del todo
    await dentro(e.ligaId, (inst) => inst.almacen.sql.exec("UPDATE credenciales SET retorno_hasta = ? WHERE partido_id = 'P'", T0 - 1).toArray())
    expect(await leer(e.ligaId, 'P', tokenP)).toMatchObject({ status: 401, cuerpo: GENERICO })
    // vigente otra vez (antes de expirar)
    await dentro(e.ligaId, (inst) => inst.almacen.sql.exec("UPDATE credenciales SET expira_en = ?, retorno_hasta = ? WHERE partido_id = 'P'", T0 + 10_000, T0 + 20_000).toArray())
    expect((await leer(e.ligaId, 'P', tokenP)).status).toBe(200)
    // revocada
    await dentro(e.ligaId, (inst) => inst.almacen.sql.exec("UPDATE credenciales SET revocada = 1 WHERE partido_id = 'P'").toArray())
    expect(await leer(e.ligaId, 'P', tokenP)).toMatchObject({ status: 401, cuerpo: GENERICO })
    expect((await leer(e.ligaId, 'Q', tokenDe(e.ligaId, 'Q'))).status).toBe(200) // la de Q no se afectó
  })

  it('liga no admitida o partido desconocido; método distinto de GET', async () => {
    const e = await escenarioPlantilla()
    expect((await leer('LIGA-NO-ADMITIDA', 'P', 'x'.repeat(20))).status).toBe(404)
    expect((await leer(e.ligaId, 'NO-EXISTE', tokenDe(e.ligaId, 'P'))).status).toBe(401)
    const post = await pedir('POST', `/v1/ligas/${e.ligaId}/partidos/P/preparacion`, { cuerpo: {}, cabeceras: { authorization: `Bearer ${tokenDe(e.ligaId, 'P')}`, 'content-type': 'application/json' } })
    expect(post.status).toBe(405)
  })
})

describe('inicio del partido con la lectura: reintentos y rechazo definitivo (el motor no cambia)', () => {
  it('un resultado desconocido se reintenta con el MISMO sobre y el mismo cmdId; devuelve el recibo original', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const v = (await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))).cuerpo
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000, preparacionVersion: v.preparacion.version, seq: v.ultimoClientSeq + 1 })
    await (await P.enviar(sobre)).text() // el servidor confirmó, pero el teléfono perdió la respuesta: no lo sabe
    const copia = JSON.stringify(sobre)
    const reintento = await (await P.enviar(JSON.parse(copia))).json()
    expect(reintento.resultado).toBe('recibo-existente')
    expect(reintento.recibo.cmdId).toBe(sobre.cmdId)
    expect((await conteos(e.ligaId, 'P')).recibos).toBe(1)
  })

  it('inicio rechazado de forma definitiva por huella vieja: consume su secuencia, el sobre original se repite igual y la recuperación usa refresco + cmdId NUEVO', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const v1 = (await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))).cuerpo
    const original = await P.sobre('iniciar-partido', {}, { t: T0 + 1000, preparacionVersion: v1.preparacion.version, seq: v1.ultimoClientSeq + 1 })
    // la plantilla cambia ANTES de que el servidor reciba el inicio
    expect((await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: { dorsal: 8 } })).cuerpo.tipo).toBe('editado')
    const rechazo = await (await P.enviar(original)).json()
    expect(rechazo.resultado).toBe('rechazado')
    expect(rechazo.recibo.motivo).toBe('preparacion-desactualizada')
    expect(await conteos(e.ligaId, 'P')).toMatchObject({ recibos: 1, seq: 1, rev: 0, eventos: 0 })
    // el mismo sobre, repetido, devuelve el mismo rechazo (no se "arregla" con un refresco)
    const repetido = await (await P.enviar(original)).json()
    expect(repetido).toMatchObject({ resultado: 'recibo-existente', recibo: rechazo.recibo })

    // un comando dependiente, ya armado contra el estado provisional, también tendría su propia decisión: aquí NO se envía
    // (el cliente lo conserva como «no aplicado» para tratarlo explícitamente). Refresco autorizado:
    const v2 = (await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))).cuerpo
    expect(v2.ultimoClientSeq).toBe(1) // el rechazo consumió su número
    expect(v2.preparacion.version).not.toBe(v1.preparacion.version)
    expect(v2.preparacion.version).toBe(rechazo.recibo.detalle.versionServidor)
    // tras la confirmación del operador: sobre NUEVO (cmdId nuevo, secuencia siguiente, huella del refresco)
    const nuevo = await P.sobre('iniciar-partido', {}, { t: T0 + 2000, preparacionVersion: v2.preparacion.version, seq: v2.ultimoClientSeq + 1 })
    expect(nuevo.cmdId).not.toBe(original.cmdId)
    expect(nuevo.clientSeq).toBe(2)
    const aceptado = await (await P.enviar(nuevo)).json()
    expect(aceptado.resultado).toBe('aceptado')
    expect(await conteos(e.ligaId, 'P')).toMatchObject({ recibos: 2, seq: 2 })
    // y el recibo del rechazo original sigue siendo el rechazo
    expect((await (await P.enviar(original)).json()).recibo).toEqual(rechazo.recibo)
  })

  it('una credencial en recuperación NO refresca, pero sí repite un sobre ya guardado', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const v = (await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))).cuerpo
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000, preparacionVersion: v.preparacion.version, seq: 1 })
    expect((await (await P.enviar(sobre)).json()).resultado).toBe('aceptado')
    await dentro(e.ligaId, (inst) => inst.almacen.sql.exec("UPDATE credenciales SET expira_en = ?, retorno_hasta = ? WHERE partido_id = 'P'", T0 - 1, T0 + 10_000).toArray())
    expect((await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))).status).toBe(401)
    expect((await (await P.enviar(sobre)).json()).resultado).toBe('recibo-existente')
  })

  it('la plantilla no cambia tras el inicio: la huella leída durante el partido es la del inicio, y las ediciones se rechazan', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const v = (await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))).cuerpo
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000, preparacionVersion: v.preparacion.version })
    expect((await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: { dorsal: 8 } })).cuerpo.tipo).toBe('equipo-bloqueado')
    expect((await leer(e.ligaId, 'P', tokenDe(e.ligaId, 'P'))).cuerpo.preparacion).toEqual(v.preparacion)
    expect(await sqlDe(e.ligaId, 'SELECT COUNT(*) AS n FROM auditoria_plantilla')).toEqual([{ n: 0 }])
    void nuevaOp; void payloadPlantilla
  })
})
