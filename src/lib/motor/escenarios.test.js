import { describe, expect, it } from 'vitest'
import { alRecibir, crearCola, encolar, marcarEnviando, proximoEnvio } from './cola'
import { ejecutarAutorizado as ejecutar } from './prueba/banco'
import { crearBanco, nuevoId, T0 } from './prueba/banco'
import { ESCENARIOS, correrEnMotor } from './prueba/escenarios'

describe('escenarios compartidos en el motor', () => {
  for (const esc of ESCENARIOS) {
    it(esc.nombre, async () => {
      const { resultados } = await correrEnMotor(esc)
      const esperados = esc.pasos.map((p) => p.esperado)
      expect(resultados).toEqual(esperados)
    })
  }
})

describe('registro sin conexión mezclado (marcador y reloj) y reconexión desde una base fija', () => {
  const D = { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }

  function tocar(tel, tipo, datos, t, cmdId) {
    const r = encolar(
      tel.cola, tel.estado, { cmdId: cmdId ?? nuevoId('o'), tipo, datos, tiempo: { accionTs: t } }, { ahoraEstimado: t, actorId: 'yo' },
    )
    expect(r.rechazoLocal, `${tipo}: ${JSON.stringify(r.rechazoLocal)}`).toBeUndefined()
    return { cola: r.cola, estado: r.estado }
  }

  async function sinConexion() {
    const b = crearBanco()
    let tel = {
      cola: crearCola({ gameId: 'P', deviceId: b.deviceId }),
      estado: b.adaptador.estado(),
    }
    tel = tocar(tel, 'arrancar-reloj', {}, T0)
    tel = tocar(tel, 'anotar', D, T0 + 20_000)
    tel = tocar(tel, 'anotar', { ...D, puntos: 3 }, T0 + 35_000)
    tel = tocar(tel, 'falta', { equipoId: 'E2', jugadorId: 'J9' }, T0 + 40_000)
    tel = tocar(tel, 'deshacer', {}, T0 + 41_000)
    tel = tocar(tel, 'detener-reloj', {}, T0 + 120_000)
    tel = tocar(tel, 'corregir-reloj', { restanteMs: 500_000 }, T0 + 130_000)
    tel = tocar(tel, 'arrancar-reloj', {}, T0 + 140_000)
    tel = tocar(tel, 'siguiente-periodo', {}, T0 + 150_000)
    tel = tocar(tel, 'anotar', D, T0 + 160_000)
    tel = tocar(tel, 'cerrar-partido', {}, T0 + 170_000)
    return { b, tel }
  }

  it('al reconectar se sincroniza en orden, de a una, y el servidor queda igual al estado provisional del teléfono', async () => {
    const { b, tel } = await sinConexion()
    expect(tel.cola.entradas.map((e) => e.sobre.clientSeq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(b.adaptador.estado().rev).toBe(0) // nada llegó mientras estuvo sin conexión

    let cola = tel.cola
    const horaDeReconexion = T0 + 3_600_000 // mucho después de las horas de acción
    for (let i = 0; i < 11; i += 1) {
      const sobre = proximoEnvio(cola)
      cola = marcarEnviando(cola, sobre.cmdId)
      const r = await ejecutar(b.adaptador, sobre, { recibidoEn: horaDeReconexion })
      expect(r.tipo, `${sobre.tipo}: ${JSON.stringify(r.recibo?.motivo)}`).toBe('aceptado')
      cola = alRecibir(cola, sobre.cmdId, r)
    }
    expect(proximoEnvio(cola)).toBeNull()
    expect(cola.base).toEqual({ ultimoClientSeq: 11, rev: 11 })
    expect(b.adaptador.estado()).toEqual(tel.estado)

    // La hora de reconexión no se usó como hora de acción: las horas son las originales.
    const arranques = b.adaptador.auditoria().filter((f) => f.comando === 'arrancar')
    expect(arranques.map((f) => f.ts)).toEqual([new Date(T0).toISOString(), new Date(T0 + 140_000).toISOString()])
    expect(b.adaptador.estado().partido).toMatchObject({ estado: 'final', relojEstado: 'detenido' })
  })

  it('el mismo registro desde la misma base da el mismo resultado; reenviarlo entero no aplica nada dos veces', async () => {
    const { b, tel } = await sinConexion()
    const reenvio = async (banco) => {
      for (const e of tel.cola.entradas) {
        const r = await ejecutar(banco.adaptador, e.sobre, { recibidoEn: T0 + 3_600_000 })
        expect(r.tipo).toBe('aceptado')
      }
    }
    await reenvio(b)
    const otro = crearBanco()
    await reenvio(otro)
    expect(otro.adaptador.foto().estado).toEqual(b.adaptador.foto().estado)
    expect(otro.adaptador.auditoria()).toEqual(b.adaptador.auditoria())

    const antes = b.adaptador.foto()
    for (const e of tel.cola.entradas) {
      expect((await ejecutar(b.adaptador, e.sobre, { recibidoEn: T0 + 9_999_999 })).tipo).toBe('recibo-existente')
    }
    expect(b.adaptador.foto()).toEqual(antes)
  })
})
