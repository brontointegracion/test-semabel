import { describe, expect, it } from 'vitest'
import { atribucionIntegra, crearAtribucion } from './atribucion'
import { alRecibir, crearCola, encolar, marcarEnviando, proximoEnvio, reanudar } from './cola'
import { sobreContenidoSeguro } from './prueba/auxiliares-atribucion'
import { ATRIBUCION_DE_PRUEBA, JUGADORES_DE_PRUEBA, T0, crearBanco, ejecutarAutorizado, estadoDePrueba, nuevoId } from './prueba/banco'
import { validarSobre } from './sobre'
import { construirSobre } from './reglas'

// ---------------------------------------------------------------------------
// M2: puntos y faltas NUEVOS solo se atribuyen a jugadores elegibles del
// partido, validados contra un contexto de atribución de confianza y con
// versión. Las correcciones de eventos que ya existen no dependen de la
// plantilla actual.
// ---------------------------------------------------------------------------

const P = (extra = {}) => ({ equipoId: 'E1', jugadorId: 'J1', puntos: 2, ...extra })
const F = (extra = {}) => ({ equipoId: 'E1', jugadorId: 'J1', ...extra })
const evento = (c) => ({
  id: `x${c.seq}`, partidoId: 'P', anulado: false, creadoEn: 1, equipoId: 'E1', jugadorId: 'J1', puntos: 2, periodo: 1, tipo: 'punto', ...c,
})

async function rechazado(b, tipo, datos, motivo) {
  const antes = b.adaptador.estado()
  const r = await b.enviar(tipo, datos)
  expect(r.tipo, JSON.stringify(r.recibo ?? r)).toBe('rechazado')
  expect(r.recibo.motivo).toBe(motivo)
  const despues = b.adaptador.estado()
  expect(despues.eventos).toEqual(antes.eventos) // sin efectos
  expect(despues.rev).toBe(antes.rev)
  return r
}

describe('crearAtribucion', () => {
  it('ordena los equipos, solo incluye jugadores de esos equipos y usa activoDe para la elegibilidad', () => {
    const at = crearAtribucion({
      equipos: ['E2', 'E1'],
      jugadores: [
        { id: 'a', equipoId: 'E1' }, // sin marca: activo
        { id: 'b', equipoId: 'E1', activo: true },
        { id: 'c', equipoId: 'E1', activo: false },
        { id: 'd', equipoId: 'E2', activo: undefined },
        { id: 'ajeno', equipoId: 'E9' },
      ],
    })
    expect(at.equipos).toEqual(['E1', 'E2'])
    expect(at.jugadores).toEqual({
      a: { equipoId: 'E1', elegible: true },
      b: { equipoId: 'E1', elegible: true },
      c: { equipoId: 'E1', elegible: false },
      d: { equipoId: 'E2', elegible: true },
    })
    expect(atribucionIntegra(at)).toBe(true)
  })

  it('lanza ante datos dudosos en lugar de producir un contexto en silencio', () => {
    expect(() => crearAtribucion({ equipos: [], jugadores: [] })).toThrow()
    expect(() => crearAtribucion({ jugadores: [] })).toThrow()
    expect(() => crearAtribucion({ equipos: ['E1'], jugadores: [{ id: 'a', equipoId: 'E1' }, { id: 'a', equipoId: 'E1' }] })).toThrow('repetido')
    expect(() => crearAtribucion({ equipos: ['E1'], jugadores: [{ id: '', equipoId: 'E1' }] })).toThrow()
  })

  it('la versión no cambia con nombres, acentos, nombre en camiseta, dorsal ni datos personales', () => {
    const antes = crearAtribucion({
      equipos: ['E1', 'E2'],
      jugadores: JUGADORES_DE_PRUEBA.map((j) => ({ ...j, dorsal: 4, nombreCamiseta: 'ANA' })),
    })
    const despues = crearAtribucion({
      equipos: ['E2', 'E1'],
      jugadores: JUGADORES_DE_PRUEBA.map((j) => ({
        ...j, nombre: `${j.nombre} González`, nombrePila: 'Ñandú', apellido1: 'Pérez', dorsal: 99, nombreCamiseta: 'GONZÁLEZ', fechaNacimiento: '2015-01-01',
      })),
    })
    expect(despues.version).toBe(antes.version)
    expect(despues.version).toBe(ATRIBUCION_DE_PRUEBA.version)
  })

  it('la versión cambia si cambia la elegibilidad, el equipo de un jugador, la plantilla o los equipos', () => {
    const v = (jugadores, equipos = ['E1', 'E2']) => crearAtribucion({ equipos, jugadores }).version
    const base = v(JUGADORES_DE_PRUEBA)
    expect(v(JUGADORES_DE_PRUEBA.map((j) => (j.id === 'J1' ? { ...j, activo: false } : j)))).not.toBe(base)
    expect(v(JUGADORES_DE_PRUEBA.map((j) => (j.id === 'JX' ? { ...j, activo: true } : j)))).not.toBe(base)
    expect(v(JUGADORES_DE_PRUEBA.map((j) => (j.id === 'J1' ? { ...j, equipoId: 'E2' } : j)))).not.toBe(base)
    expect(v([...JUGADORES_DE_PRUEBA, { id: 'J7', equipoId: 'E1' }])).not.toBe(base)
    expect(v(JUGADORES_DE_PRUEBA, ['E1', 'E3'])).not.toBe(base)
  })

  it('atribucionIntegra detecta un contexto manipulado, incompleto o ausente', () => {
    expect(atribucionIntegra(null)).toBe(false)
    expect(atribucionIntegra({})).toBe(false)
    expect(atribucionIntegra({ ...ATRIBUCION_DE_PRUEBA, equipos: [] })).toBe(false)
    const adulterado = structuredClone(ATRIBUCION_DE_PRUEBA)
    adulterado.jugadores.JX.elegible = true // sin recalcular la versión
    expect(atribucionIntegra(adulterado)).toBe(false)
  })
})

describe('puntos y faltas nuevos: atribución de confianza', () => {
  it('un jugador válido del equipo del partido se acepta (punto y falta)', async () => {
    const b = crearBanco()
    expect((await b.enviar('anotar', P())).tipo).toBe('aceptado')
    expect((await b.enviar('falta', { equipoId: 'E2', jugadorId: 'J9' })).tipo).toBe('aceptado')
    expect(b.adaptador.estado().eventos.map((e) => [e.equipoId, e.jugadorId])).toEqual([['E1', 'J1'], ['E2', 'J9']])
  })

  it('sin contexto de atribución se rechaza todo punto y toda falta nueva (falla cerrada)', async () => {
    const b = crearBanco({ atribucion: null })
    await rechazado(b, 'anotar', P(), 'atribucion-no-disponible')
    await rechazado(b, 'falta', F(), 'atribucion-no-disponible')
  })

  it('un contexto adulterado o malformado también falla cerrado', async () => {
    const malo = structuredClone(ATRIBUCION_DE_PRUEBA)
    malo.jugadores.JX.elegible = true
    for (const atribucion of [malo, { version: 'x' }, { ...ATRIBUCION_DE_PRUEBA, equipos: [] }]) {
      const b = crearBanco({ estadoInicial: estadoDePrueba({ atribucion }) })
      const sobre = b.sobre('anotar', P(), { estado: estadoDePrueba() }) // el teléfono sí tenía la versión buena
      const r = await b.reenviar(sobre)
      expect(r.recibo.motivo).toBe('atribucion-no-disponible')
      expect(b.adaptador.estado().eventos).toHaveLength(0)
    }
  })

  it('jugador desconocido, de otro equipo, inactivo o ausente (null) se rechaza sin efectos', async () => {
    const b = crearBanco()
    await rechazado(b, 'anotar', P({ jugadorId: 'nadie' }), 'jugador-desconocido')
    await rechazado(b, 'falta', F({ jugadorId: 'nadie' }), 'jugador-desconocido')
    await rechazado(b, 'anotar', P({ jugadorId: 'J9' }), 'jugador-de-otro-equipo') // J9 es de E2
    await rechazado(b, 'falta', F({ equipoId: 'E2', jugadorId: 'J1' }), 'jugador-de-otro-equipo')
    await rechazado(b, 'anotar', P({ jugadorId: 'JX' }), 'jugador-inactivo')
    await rechazado(b, 'falta', F({ jugadorId: 'JX' }), 'jugador-inactivo')
    await rechazado(b, 'anotar', P({ jugadorId: null }), 'jugador-requerido')
    await rechazado(b, 'falta', F({ jugadorId: null }), 'jugador-requerido')
    await rechazado(b, 'anotar', P({ equipoId: 'E3' }), 'equipo-invalido')
  })

  it('los nombres de propiedades heredadas de Object no cuentan como jugadores', async () => {
    const b = crearBanco()
    for (const jugadorId of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      await rechazado(b, 'anotar', P({ jugadorId }), 'jugador-desconocido')
    }
  })

  it('cambiar el nombre, los acentos o el nombre en camiseta no invalida lo guardado ni cambia a quién se atribuye', async () => {
    const rowsAntes = JUGADORES_DE_PRUEBA.map((j) => ({ ...j, nombreCamiseta: 'ANA' }))
    const rowsDespues = JUGADORES_DE_PRUEBA.map((j) => ({ ...j, nombre: 'Ana González', nombreCamiseta: 'GONZÁLEZ' }))
    const v1 = crearAtribucion({ equipos: ['E1', 'E2'], jugadores: rowsAntes })
    const v2 = crearAtribucion({ equipos: ['E1', 'E2'], jugadores: rowsDespues })
    expect(v2.version).toBe(v1.version)

    const b = crearBanco({ estadoInicial: estadoDePrueba({ atribucion: v1 }) })
    const antes = b.sobre('anotar', P(), { cmdId: 'a' }) // validado por el teléfono con v1
    b.adaptador.fijarAtribucion(v2) // el adaptador publica la plantilla con nombres editados
    const r = await b.reenviar(antes)
    expect(r.tipo).toBe('aceptado')
    expect(b.adaptador.estado().eventos[0]).toMatchObject({ id: 'a', jugadorId: 'J1', equipoId: 'E1' })
  })
})

describe('correcciones históricas: no dependen de la plantilla actual', () => {
  const historia = [
    evento({ seq: 1, jugadorId: 'JX', puntos: 3 }),
    evento({ seq: 2, jugadorId: 'JX', puntos: 1, anulado: true, anuladoEn: 5 }),
    evento({ seq: 3, jugadorId: 'retirado', puntos: 2, equipoId: 'E1' }), // ya no está en la plantilla
  ]

  it('Deshacer, Rehacer y Anular funcionan sobre eventos de un jugador inactivo o retirado', async () => {
    const b = crearBanco({ eventos: historia })
    expect((await b.enviar('deshacer')).tipo).toBe('aceptado') // anula el evento 3 (jugador retirado)
    expect((await b.enviar('rehacer')).tipo).toBe('aceptado') // la anulación más reciente es la del evento 3
    expect((await b.enviar('anular-evento', { eventoId: 'x1' })).tipo).toBe('aceptado') // jugador inactivo
    const vivos = b.adaptador.estado().eventos.filter((e) => !e.anulado).map((e) => e.seq)
    expect(vivos).toEqual([3])
  })

  it('siguen funcionando aunque el estado no tenga ningún contexto de atribución', async () => {
    const b = crearBanco({ eventos: historia, atribucion: null })
    expect((await b.enviar('deshacer')).tipo).toBe('aceptado')
    expect((await b.enviar('anular-evento', { eventoId: 'x1' })).tipo).toBe('aceptado')
  })

  it('no llevan versión de atribución; mandarla en estas órdenes es un sobre inválido', () => {
    const e = estadoDePrueba({ eventos: historia })
    const s = construirSobre(e, { cmdId: 'u', tipo: 'deshacer', tiempo: { accionTs: T0 } }, { deviceId: 'tel-A', clientSeq: 1 })
    expect(s.atribucionVersion).toBeNull()
    expect(validarSobre(s).ok).toBe(true)
    expect(validarSobre({ ...s, atribucionVersion: 'v' }).errores).toContain('atribucionVersion')
  })
})

describe('la versión de atribución en el sobre', () => {
  it('los puntos y las faltas la llevan, y forma parte del contenido canónico', () => {
    const e = estadoDePrueba()
    const s = construirSobre(e, { cmdId: 'p', tipo: 'anotar', datos: P(), tiempo: { accionTs: T0 } }, { deviceId: 'tel-A', clientSeq: 1 })
    expect(s.atribucionVersion).toBe(ATRIBUCION_DE_PRUEBA.version)
    const otro = { ...s, atribucionVersion: 'otra' }
    expect(sobreContenidoSeguro(otro)).not.toBe(sobreContenidoSeguro(s))
  })

  it('un sobre sin versión, o con una versión que no es la del servidor, se rechaza con la versión actual', async () => {
    const b = crearBanco()
    const s = b.sobre('anotar', P(), { cmdId: 'a' })
    const sinVersion = await b.reenviar({ ...s, atribucionVersion: null })
    expect(sinVersion.recibo).toMatchObject({ motivo: 'atribucion-desactualizada', detalle: { versionServidor: ATRIBUCION_DE_PRUEBA.version } })
    const siguiente = b.sobre('anotar', P(), { cmdId: 'b' })
    const vieja = await b.reenviar({ ...siguiente, atribucionVersion: 'vieja' })
    expect(vieja.recibo.motivo).toBe('atribucion-desactualizada')
    expect(b.adaptador.estado().eventos).toHaveLength(0)
  })
})

describe('cambio de elegibilidad con órdenes pendientes (resultado seguro definido)', () => {
  const sinJ2 = crearAtribucion({
    equipos: ['E1', 'E2'], jugadores: JUGADORES_DE_PRUEBA.map((j) => (j.id === 'J2' ? { ...j, activo: false } : j)),
  })

  function telefono(b) {
    return {
      cola: crearCola({ gameId: 'P', deviceId: b.deviceId, ultimoClientSeqServidor: 0, revServidor: 0 }),
      estado: b.adaptador.estado(),
    }
  }
  const pulsar = (tel, tipo, datos, t, cmdId = nuevoId('o')) => {
    const r = encolar(tel.cola, tel.estado, { cmdId, tipo, datos, tiempo: { accionTs: t } }, { ahoraEstimado: t, actorId: 'yo' })
    return { r, tel: { cola: r.cola, estado: r.estado } }
  }

  it('una orden validada con la versión anterior se rechaza, detiene la cola, conserva lo pendiente y no se reinterpreta', async () => {
    const b = crearBanco()
    let tel = telefono(b)
    tel = pulsar(tel, 'anotar', P({ jugadorId: 'J2' }), T0 + 10, 'c1').tel // J2 es elegible con v1
    tel = pulsar(tel, 'anotar', P({ jugadorId: 'J1' }), T0 + 20, 'c2').tel
    const guardado = tel.cola.entradas.map((e) => e.sobre)

    b.adaptador.fijarAtribucion(sinJ2) // mientras tanto el organizador desactivó a J2

    const sobre = proximoEnvio(tel.cola)
    const r = await ejecutarAutorizado(b.adaptador, sobre, { recibidoEn: T0 + 3000 })
    expect(r.tipo).toBe('rechazado')
    expect(r.recibo).toMatchObject({ motivo: 'atribucion-desactualizada', detalle: { versionServidor: sinJ2.version } })
    expect(b.adaptador.estado().eventos).toHaveLength(0)
    expect(b.adaptador.ultimoClientSeq()).toBe(1) // el rechazo consumió su número

    const cola = alRecibir(marcarEnviando(tel.cola, 'c1'), 'c1', r)
    expect(cola.entradas.map((e) => e.estado)).toEqual(['rechazada', 'no-aplicada'])
    expect(cola.entradas.map((e) => e.sobre)).toEqual(guardado) // registros intactos
    expect(proximoEnvio(cola)).toBeNull() // la segunda NO se reenvía contra la plantilla nueva

    // Reanudar con el estado del servidor: ahora la validación local usa la plantilla nueva.
    const rea = reanudar(cola, { ultimoClientSeq: 1, rev: 0 })
    const servidor = b.adaptador.estado()
    const j2 = encolar(rea.cola, servidor, { cmdId: 'n1', tipo: 'anotar', datos: P({ jugadorId: 'J2' }), tiempo: { accionTs: T0 + 4000 } }, { ahoraEstimado: T0 + 4000, actorId: 'yo' })
    expect(j2.rechazoLocal.motivo).toBe('jugador-inactivo')
    expect(j2.cola.siguienteSeq).toBe(rea.cola.siguienteSeq) // el rechazo local no consume número
    const j1 = encolar(rea.cola, servidor, { cmdId: 'n2', tipo: 'anotar', datos: P({ jugadorId: 'J1' }), tiempo: { accionTs: T0 + 4000 } }, { ahoraEstimado: T0 + 4000, actorId: 'yo' })
    expect(j1.sobre.clientSeq).toBe(2)
    expect((await ejecutarAutorizado(b.adaptador, j1.sobre, { recibidoEn: T0 + 4000 })).tipo).toBe('aceptado')
  })

  it('un cambio que no toca la elegibilidad (solo nombres) no detiene la cola', async () => {
    const b = crearBanco()
    let tel = telefono(b)
    tel = pulsar(tel, 'anotar', P(), T0 + 10, 'c1').tel
    tel = pulsar(tel, 'falta', F(), T0 + 20, 'c2').tel
    b.adaptador.fijarAtribucion(crearAtribucion({
      equipos: ['E1', 'E2'], jugadores: JUGADORES_DE_PRUEBA.map((j) => ({ ...j, nombre: 'Otro Nombre', nombreCamiseta: 'XYZ' })),
    }))
    let cola = tel.cola
    for (let i = 0; i < 2; i += 1) {
      const sobre = proximoEnvio(cola)
      cola = marcarEnviando(cola, sobre.cmdId)
      const r = await ejecutarAutorizado(b.adaptador, sobre, { recibidoEn: T0 + 5000 })
      expect(r.tipo).toBe('aceptado')
      cola = alRecibir(cola, sobre.cmdId, r)
    }
    expect(b.adaptador.estado().eventos).toHaveLength(2)
  })

  it('la validación local usa las mismas reglas: un jugador desconocido no consume clientSeq', () => {
    const b = crearBanco()
    const tel = telefono(b)
    const r = pulsar(tel, 'anotar', P({ jugadorId: 'nadie' }), T0)
    expect(r.r.rechazoLocal.motivo).toBe('jugador-desconocido')
    expect(r.tel.cola).toBe(tel.cola)
  })
})
