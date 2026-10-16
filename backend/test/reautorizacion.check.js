import { describe, expect, it, afterEach } from 'vitest'
import { control } from './worker-prueba.js'
import { nuevaLiga, tokenDe } from './fixtures/sintetico.js'
import { T0, conteos, dentro, editarJugador, ligaSembrada } from './ayuda.js'
import { sha256Hex } from '../src/credenciales.js'
import { revocarCredencial } from '../src/control.js'

// PUNTO DE DECISIÓN DE AUTORIZACIÓN (ver adaptador-liga.js): la comprobación que vale es la que se repite
// DENTRO de leerVista, en el mismo tramo sincrónico que lee recibos y estado. Estas pruebas detienen una petición
// justo DESPUÉS de que `autorizar` la aprobó y ANTES de esa lectura, cambian la autorización desde otra petición,
// y comprueban que nada se devuelve ni se escribe. Son deterministas: la pausa la controla la prueba.

const GENERICO = { error: 'no-autorizado' }
afterEach(() => { control.pausaAut = null; control.pausa = null; control.ahoraMs = null })

// El cuerpo se lee de inmediato: el runtime no permite leerlo después de llamar a otros objetos.
const leerCuerpo = async (respuesta) => ({ status: respuesta.status, cuerpo: await respuesta.json() })

/** Detiene UNA vez la primera petición que acaba de ser autorizada, hasta que la prueba la libere. */
function pausarTrasAutorizar() {
  let avisar
  const pausada = new Promise((r) => { avisar = r })
  let liberar
  const hastaLiberar = new Promise((r) => { liberar = r })
  let usada = false
  control.pausaAut = async () => {
    if (usada) return
    usada = true
    avisar()
    await hastaLiberar
  }
  return { pausada, liberar }
}

const hashDe = (ligaId, partido = 'P') => sha256Hex(tokenDe(ligaId, partido))
const sinCambios = (ligaId, antes) => conteos(ligaId, 'P').then((d) => expect(d).toEqual(antes))

describe('revocación entre la autorización consultiva y la lectura protegida', () => {
  it('un reintento ya aceptado NO recibe el recibo: 401 genérico, sin contenido ni escrituras', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const aceptado = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const antes = await conteos(ligaId, 'P')
    const hash = await hashDe(ligaId)

    const { pausada, liberar } = pausarTrasAutorizar()
    const reintento = P.enviar(aceptado.sobre).then(leerCuerpo) // ya autorizado, aún sin leer recibos
    await pausada
    await dentro(ligaId, (inst) => revocarCredencial(inst.almacen, hash))
    liberar()
    const { status, cuerpo } = await reintento

    expect(status).toBe(401)
    expect(cuerpo).toEqual(GENERICO)
    const texto = JSON.stringify(cuerpo)
    expect(texto).not.toContain(aceptado.sobre.cmdId)
    expect(texto).not.toContain('recibo')
    await sinCambios(ligaId, antes)
  })

  it('un sobre con contenido distinto no revela el conflicto ni el recibo original a una credencial revocada', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    const anotado = await P.mandar('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, { t: T0 + 3000 })
    const distinto = { ...anotado.sobre, datos: { ...anotado.sobre.datos, puntos: 3 } }
    const antes = await conteos(ligaId, 'P')
    const hash = await hashDe(ligaId)

    const { pausada, liberar } = pausarTrasAutorizar()
    const intento = P.enviar(distinto).then(leerCuerpo)
    await pausada
    await dentro(ligaId, (inst) => revocarCredencial(inst.almacen, hash))
    liberar()
    const { status, cuerpo } = await intento

    expect(status).toBe(401) // no 409 conflicto-contenido
    expect(cuerpo).toEqual(GENERICO)
    await sinCambios(ligaId, antes)
  })

  it('una orden nueva tampoco se lee ni se guarda', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    const hash = await hashDe(ligaId)
    const { pausada, liberar } = pausarTrasAutorizar()
    const envio = P.enviar(sobre).then(leerCuerpo)
    await pausada
    await dentro(ligaId, (inst) => revocarCredencial(inst.almacen, hash))
    liberar()
    const { status, cuerpo } = await envio
    expect(status).toBe(401)
    expect(cuerpo).toEqual(GENERICO)
    expect(await conteos(ligaId, 'P')).toEqual({ recibos: 0, eventos: 0, auditoria: 0, bandeja: 0, cuarentena: 0, rev: 0, seq: 0 })
  })
})

describe('asignación o dispositivo cambiados entre la autorización y la lectura', () => {
  const casos = [
    ['la credencial se reasigna a otro partido', (inst, hash) => {
      inst.almacen.sql.exec("DELETE FROM credenciales WHERE partido_id = 'Q'").toArray()
      inst.almacen.sql.exec("UPDATE credenciales SET partido_id = 'Q' WHERE token_hash = ?", hash).toArray()
      inst.almacen.sql.exec("UPDATE partidos SET version_autorizacion = version_autorizacion + 1 WHERE id IN ('P','Q')").toArray()
    }],
    ['la credencial se reasigna a otro partido SIN subir la versión', (inst, hash) => {
      // Una versión que no cambió no puede ser la única defensa: el alcance se vuelve a leer.
      // (Se libera antes la credencial activa de Q: el índice único exige un solo teléfono por partido.)
      inst.almacen.sql.exec("DELETE FROM credenciales WHERE partido_id = 'Q'").toArray()
      inst.almacen.sql.exec("UPDATE credenciales SET partido_id = 'Q' WHERE token_hash = ?", hash).toArray()
    }],
    ['la credencial pasa a otro dispositivo', (inst, hash) => {
      inst.almacen.sql.exec("UPDATE credenciales SET device_id = 'tel-otro' WHERE token_hash = ?", hash).toArray()
    }],
    ['la credencial desaparece', (inst, hash) => {
      inst.almacen.sql.exec('DELETE FROM credenciales WHERE token_hash = ?', hash).toArray()
    }],
  ]
  for (const [nombre, cambio] of casos) {
    it(`${nombre}: reintento aceptado → 401 genérico y sin escrituras`, async () => {
      const { ligaId, P } = await ligaSembrada(nuevaLiga())
      const aceptado = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
      const antes = await conteos(ligaId, 'P')
      const antesQ = await conteos(ligaId, 'Q')
      const hash = await hashDe(ligaId)
      const { pausada, liberar } = pausarTrasAutorizar()
      const reintento = P.enviar(aceptado.sobre).then(leerCuerpo)
      await pausada
      await dentro(ligaId, (inst) => cambio(inst, hash))
      liberar()
      const { status, cuerpo } = await reintento
      expect(status).toBe(401)
      expect(cuerpo).toEqual(GENERICO)
      await sinCambios(ligaId, antes)
      expect(await conteos(ligaId, 'Q')).toEqual(antesQ)
    })
  }

  it('un cambio SOLO de versión con la credencial aún vigente no niega la lectura; la orden nueva se relee antes de escribir', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const aceptado = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const sobreNuevo = await P.sobre('arrancar-reloj', {}, { t: T0 + 2000 })

    // 1) reintento ya aceptado: la lectura protegida está vigente en su punto de decisión
    let p = pausarTrasAutorizar()
    const reintento = P.enviar(aceptado.sobre).then(leerCuerpo)
    await p.pausada
    await dentro(ligaId, (inst) => inst.almacen.sql.exec("UPDATE partidos SET version_autorizacion = version_autorizacion + 1 WHERE id = 'P'").toArray())
    p.liberar()
    const r1 = await reintento
    expect(r1.status).toBe(200)
    expect(r1.cuerpo.resultado).toBe('recibo-existente')
    expect(r1.cuerpo.recibo).toEqual(aceptado.cuerpo.recibo)

    // 2) orden nueva: confirmar detecta la versión distinta, relee (nueva autorización) y confirma una sola vez
    control.pausaAut = null
    p = pausarTrasAutorizar()
    const nueva = P.enviar(sobreNuevo).then(leerCuerpo)
    await p.pausada
    await dentro(ligaId, (inst) => inst.almacen.sql.exec("UPDATE partidos SET version_autorizacion = version_autorizacion + 1 WHERE id = 'P'").toArray())
    p.liberar()
    const r2 = await nueva
    expect(r2.status).toBe(200)
    expect(r2.cuerpo.resultado).toBe('aceptado')
    expect(await conteos(ligaId, 'P')).toMatchObject({ recibos: 2, rev: 2, seq: 2 })
  })
})

describe('lo que NO debe cambiar', () => {
  it('un reintento autorizado devuelve el recibo original aunque la plantilla cambie justo en la ventana', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const aceptado = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const { pausada, liberar } = pausarTrasAutorizar()
    const reintento = P.enviar(aceptado.sobre).then(leerCuerpo)
    await pausada
    await editarJugador(ligaId, 'J2', { dorsal: 61 }) // cambia la huella de preparación
    liberar()
    const { status, cuerpo } = await reintento
    expect(status).toBe(200)
    expect(cuerpo.resultado).toBe('recibo-existente')
    expect(cuerpo.recibo).toEqual(aceptado.cuerpo.recibo)
  })

  it('el mismo contenido sigue siendo obligatorio: un sobre distinto con credencial vigente es 409', async () => {
    const { P } = await ligaSembrada(nuevaLiga())
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await P.mandar('arrancar-reloj', {}, { t: T0 + 2000 })
    const a = await P.mandar('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, { t: T0 + 3000 })
    const r = await P.enviar({ ...a.sobre, datos: { ...a.sobre.datos, puntos: 3 } })
    expect(r.status).toBe(409)
    expect((await r.json()).tipo).toBe('conflicto-contenido')
  })

  it('el 401 por pérdida de autorización es idéntico al de una credencial inválida desde el principio', async () => {
    const { ligaId, P } = await ligaSembrada(nuevaLiga())
    const aceptado = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const desdeElPrincipio = await leerCuerpo(await P.enviar(aceptado.sobre, 'token-inventado-0123456789'))
    const hash = await hashDe(ligaId)
    const { pausada, liberar } = pausarTrasAutorizar()
    const enVentana = P.enviar(aceptado.sobre).then(leerCuerpo)
    await pausada
    await dentro(ligaId, (inst) => revocarCredencial(inst.almacen, hash))
    liberar()
    expect(await enVentana).toEqual(desdeElPrincipio)
  })
})
