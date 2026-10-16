import { describe, expect, it } from 'vitest'
import { crearAtribucion } from './atribucion'
import { alRecibir, crearCola, encolar, marcarEnviando, proximoEnvio, reanudar } from './cola'
import { ejecutar } from './orquestador'
import { evaluarPreparacion, preparacionIntegra } from './preparacion'
import { canonico, contenidoCanonico, validarSobre } from './sobre'
import { crearAdaptadorMemoria } from './prueba/adaptador-memoria'
import {
  EQUIPOS_DE_PRUEBA, JUGADORES_NUMERADOS, preparacionConCambioDeNumero, preparacionDePrueba, preparacionNoLista,
} from './prueba/auxiliares-preparacion'
import { T0, crearBanco, ejecutarAutorizado, estadoDePrueba } from './prueba/banco'

// ---------------------------------------------------------------------------
// S5b: compatibilidad del campo opcional `preparacionVersion` del inicio del partido.
//
// LO QUE ESTAS PRUEBAS MUESTRAN: la lógica de decisión del motor y el contrato del adaptador, contra un
// adaptador de MEMORIA (no durable) y contextos sintéticos.
// LO QUE NO MUESTRAN: atomicidad de un servidor duradero, reinicio, concurrencia real entre procesos o
// teléfonos reales, ni que un contexto de preparación venga de una fuente de confianza o esté completo
// (la huella y consultaEquipos no lo prueban).
//
// LITERALES DEL SOBRE ANTIGUO: capturados con el motor SIN modificar (antes de S5b) y pegados tal cual. Nunca se
// regeneran con el código nuevo: son la prueba de que un sobre y un recibo anteriores siguen reconociéndose.
// ---------------------------------------------------------------------------

// Fuentes del motor (SHA-256) en el momento de la captura, antes de cualquier edición de S5b:
//   sobre.js         b672bea57a28981932cf0e256ec09d5387829c51ba6a694630b187ede7862109
//   procesador.js    86b089c07b1e7be7bfe07b1fc2c209f90870f462371b75e92a5c1631c5194668
//   orquestador.js   119e4e473f9e8e2426251c6ded444ba0db49d6fe6beb4acb61e3ad952398b483
//   reglas.js        e3d217e75f07f9fc73c8bf37ca63ba900a3c5eeedd9370707ebc08118b329a48
//   (contrato-adaptador.js e66e30a7…, prueba/adaptador-memoria.js 5e11efbb…, prueba/banco.js 14e87372…)
const SOBRE_ANTIGUO = {
  "cmdId": "legacy-start-1",
  "gameId": "P",
  "deviceId": "tel-A",
  "clientSeq": 1,
  "tipo": "iniciar-partido",
  "datos": {},
  "accionTs": 1700000000000,
  "accionTsCrudo": 1700000000000,
  "ajusteTsMs": 0,
  "discontinuidad": null,
  "observado": {
    "rev": 0,
    "seq": 0,
    "estado": "programado",
    "relojEstado": "detenido",
    "relojRestante": null,
    "relojDesde": null
  },
  "restanteVistoMs": null,
  "atribucionVersion": null
}

const CANONICO_ANTIGUO = "{\"accionTs\":1700000000000,\"accionTsCrudo\":1700000000000,\"ajusteTsMs\":0,\"atribucionVersion\":null,\"clientSeq\":1,\"cmdId\":\"legacy-start-1\",\"datos\":{},\"deviceId\":\"tel-A\",\"discontinuidad\":null,\"gameId\":\"P\",\"observado\":{\"estado\":\"programado\",\"relojDesde\":null,\"relojEstado\":\"detenido\",\"relojRestante\":null,\"rev\":0,\"seq\":0},\"restanteVistoMs\":null,\"tipo\":\"iniciar-partido\"}"

const RECIBO_ANTIGUO = {
  "gameId": "P",
  "cmdId": "legacy-start-1",
  "clientSeq": 1,
  "deviceId": "tel-A",
  "contenido": "{\"accionTs\":1700000000000,\"accionTsCrudo\":1700000000000,\"ajusteTsMs\":0,\"atribucionVersion\":null,\"clientSeq\":1,\"cmdId\":\"legacy-start-1\",\"datos\":{},\"deviceId\":\"tel-A\",\"discontinuidad\":null,\"gameId\":\"P\",\"observado\":{\"estado\":\"programado\",\"relojDesde\":null,\"relojEstado\":\"detenido\",\"relojRestante\":null,\"rev\":0,\"seq\":0},\"restanteVistoMs\":null,\"tipo\":\"iniciar-partido\"}",
  "accionTs": 1700000000000,
  "meta": {
    "recibidoEn": 1700000000000,
    "versionMotor": 1,
    "advertenciasRecepcion": []
  },
  "resultado": "aceptado",
  "revDespues": 1,
  "advertencias": [],
  "refs": {
    "eventosNuevos": [],
    "eventosActualizados": [],
    "auditoria": [
      "legacy-start-1:a"
    ]
  }
}

const ARRANQUE = { recibidoEn: T0 }
const iniciar = (b, opts = {}) => b.enviar('iniciar-partido', {}, { t: T0, ...opts })
const programado = (opciones = {}) => crearBanco({ estado: 'programado', reloj: { relojRestante: null }, ...opciones })
const sinClave = (sobre, clave) => { const { [clave]: _quitada, ...resto } = sobre; return resto }

/** Adaptador con el recibo antiguo ya guardado y el partido ya vivo (como tras aceptar aquel inicio). */
const adaptadorConReciboAntiguo = (preparacion = preparacionDePrueba('P')) => crearAdaptadorMemoria({
  estado: estadoDePrueba({ estado: 'vivo', extra: { rev: 1, auditSeq: 1 } }),
  ultimoClientSeq: 1,
  recibosIniciales: { [RECIBO_ANTIGUO.cmdId]: RECIBO_ANTIGUO },
  preparacion,
})

// Efectos que NO debe tener un rechazo ni un reintento (y sí un rechazo definitivo: recibo + número).
const sinCambioDelPartido = (b, revAntes = 0) => {
  expect(b.adaptador.estado().rev).toBe(revAntes)
  expect(b.adaptador.estado().partido.estado).toBe('programado')
  expect(b.adaptador.auditoria()).toEqual([])
  expect(b.adaptador.bandeja()).toEqual([])
}

describe('sobre y recibo anteriores a S5b (literales capturados antes del cambio)', () => {
  it('el sobre antiguo sigue siendo válido, sin clave nueva, y su contenido canónico no cambió', () => {
    const v = validarSobre(SOBRE_ANTIGUO)
    expect(v.ok).toBe(true)
    expect('preparacionVersion' in v.sobre).toBe(false)
    expect(contenidoCanonico(v.sobre)).toBe(CANONICO_ANTIGUO)
    expect(RECIBO_ANTIGUO.contenido).toBe(CANONICO_ANTIGUO)
    expect(CANONICO_ANTIGUO).not.toContain('preparacionVersion')
  })

  it('el orden de las claves no cambia el contenido canónico, pero una clave añadida sí', () => {
    const al_reves = Object.fromEntries(Object.entries(SOBRE_ANTIGUO).reverse())
    expect(contenidoCanonico(validarSobre(al_reves).sobre)).toBe(CANONICO_ANTIGUO)
    expect(contenidoCanonico({ ...validarSobre(SOBRE_ANTIGUO).sobre, preparacionVersion: 'x' })).not.toBe(CANONICO_ANTIGUO)
    expect(canonico({ preparacionVersion: undefined, a: 1 })).toBe(canonico({ a: 1 }))
    expect(canonico({ preparacionVersion: null, a: 1 })).not.toBe(canonico({ a: 1 }))
  })

  it('un reintento aceptado sin el campo devuelve el recibo original aunque la plantilla ya no esté lista', async () => {
    for (const cambio of [preparacionNoLista('P'), preparacionConCambioDeNumero('P'), null]) {
      const adaptador = adaptadorConReciboAntiguo()
      adaptador.fijarPreparacion(cambio)
      const antes = adaptador.foto()
      const r = await ejecutarAutorizado(adaptador, SOBRE_ANTIGUO, { recibidoEn: T0 + 99_999 })
      expect(r.tipo).toBe('recibo-existente')
      expect(r.recibo).toEqual(RECIBO_ANTIGUO)
      expect(adaptador.confirmaciones()).toBe(0)
      expect(adaptador.foto()).toEqual(antes)
    }
  })

  it('el mismo cmdId con el campo añadido (u otro contenido) es conflicto y no devuelve el recibo como si fuera suyo', async () => {
    const adaptador = adaptadorConReciboAntiguo()
    const antes = adaptador.foto()
    const conVersion = { ...SOBRE_ANTIGUO, preparacionVersion: adaptador.preparacion().version }
    const r = await ejecutarAutorizado(adaptador, conVersion, ARRANQUE)
    expect(r.tipo).toBe('conflicto-contenido')
    expect(r.recibo).toBeUndefined()
    const otro = await ejecutarAutorizado(adaptador, { ...SOBRE_ANTIGUO, accionTs: T0 + 1, accionTsCrudo: T0 + 1 }, ARRANQUE)
    expect(otro.tipo).toBe('conflicto-contenido')
    expect(adaptador.recibos()[RECIBO_ANTIGUO.cmdId]).toEqual(RECIBO_ANTIGUO)
    expect(adaptador.foto()).toEqual(antes)
  })

  it('un null explícito no es "ausente": es un valor inválido y no entra al contenido canónico', async () => {
    const adaptador = adaptadorConReciboAntiguo()
    const r = await ejecutarAutorizado(adaptador, { ...SOBRE_ANTIGUO, preparacionVersion: null }, ARRANQUE)
    expect(r).toMatchObject({ tipo: 'invalido' })
    expect(r.errores).toContain('preparacionVersion')
  })
})

describe('reintento de un inicio con versión, tras cambios de la plantilla', () => {
  it('devuelve el recibo original y no vuelve a confirmar', async () => {
    const b = programado()
    const r = await iniciar(b)
    expect(r.tipo).toBe('aceptado')
    expect(r.sobre.preparacionVersion).toBe(b.adaptador.preparacion().version)
    const confirmaciones = b.adaptador.confirmaciones()
    const recibos = b.adaptador.recibos()
    for (const cambio of [preparacionNoLista('P'), preparacionConCambioDeNumero('P'), null]) {
      b.adaptador.fijarPreparacion(cambio)
      const otra = await b.reenviar(r.sobre, T0 + 99_999)
      expect(otra.tipo).toBe('recibo-existente')
      expect(otra.recibo).toEqual(r.recibo)
    }
    expect(b.adaptador.confirmaciones()).toBe(confirmaciones)
    expect(b.adaptador.recibos()).toEqual(recibos)
  })

  it('el mismo cmdId con la versión quitada, cambiada o con otro contenido es conflicto', async () => {
    const b = programado()
    const r = await iniciar(b, { cmdId: 'i1' })
    const original = b.adaptador.recibos().i1
    const variantes = [
      sinClave(r.sobre, 'preparacionVersion'),
      { ...r.sobre, preparacionVersion: 'otra-version' },
      { ...r.sobre, accionTs: T0 + 5, accionTsCrudo: T0 + 5 },
    ]
    for (const v of variantes) {
      const x = await b.reenviar(v)
      expect(x.tipo).toBe('conflicto-contenido')
      expect(x.reciboOriginal).toEqual(original)
    }
    expect(b.adaptador.recibos().i1).toEqual(original)
    expect(Object.keys(b.adaptador.recibos())).toEqual(['i1'])
  })
})

describe('inicio NUEVO: la puerta de preparación', () => {
  it('con el contexto listo y la versión vigente se acepta', async () => {
    const b = programado()
    const r = await iniciar(b)
    expect(r.tipo).toBe('aceptado')
    expect(b.adaptador.estado().partido.estado).toBe('vivo')
  })

  it('sin versión capturada se rechaza de forma definitiva (consume el número, no cambia el partido)', async () => {
    const b = programado()
    const r = await iniciar(b, { cmdId: 'i1', preparacionVersion: null })
    expect('preparacionVersion' in r.sobre).toBe(false) // el banco no la restauró
    expect(r.tipo).toBe('rechazado')
    expect(r.recibo).toMatchObject({ resultado: 'rechazado', motivo: 'preparacion-version-ausente', clientSeq: 1, revDespues: 0 })
    expect(b.adaptador.ultimoClientSeq()).toBe(1)
    expect(Object.keys(b.adaptador.recibos())).toEqual(['i1'])
    sinCambioDelPartido(b)
    // Un reintento devuelve el mismo rechazo.
    const otra = await b.reenviar(r.sobre, T0 + 5000)
    expect(otra).toMatchObject({ tipo: 'recibo-existente', recibo: r.recibo })
  })

  it('undefined explícito también significa "sin campo"', async () => {
    const b = programado()
    const r = await iniciar(b, { preparacionVersion: undefined })
    expect('preparacionVersion' in r.sobre).toBe(false)
    expect(r.recibo.motivo).toBe('preparacion-version-ausente')
  })

  it('con una versión vieja se rechaza como desactualizada, con la versión vigente del servidor', async () => {
    const b = programado()
    const capturada = b.adaptador.preparacion().version
    b.adaptador.fijarPreparacion(preparacionConCambioDeNumero('P'))
    const r = await iniciar(b, { cmdId: 'i1', preparacionVersion: capturada })
    expect(r.tipo).toBe('rechazado')
    expect(r.recibo).toMatchObject({
      motivo: 'preparacion-desactualizada', clientSeq: 1, revDespues: 0,
      detalle: { versionServidor: b.adaptador.preparacion().version },
    })
    expect(r.recibo.detalle.versionServidor).not.toBe(capturada)
    expect(b.adaptador.ultimoClientSeq()).toBe(1)
    sinCambioDelPartido(b)
  })

  it('con la versión vigente pero el partido no listo, rechaza con el motivo de la regla de "listo"', async () => {
    const b = programado({ preparacion: preparacionNoLista('P') })
    const r = await iniciar(b)
    expect(r.sobre.preparacionVersion).toBe(b.adaptador.preparacion().version)
    expect(r.tipo).toBe('rechazado')
    expect(r.recibo.motivo).toBe('plantilla-incompleta')
    expect(r.recibo.detalle.equipos[0]).toMatchObject({ equipoId: 'E1', duplicados: [0] })
    expect(JSON.stringify(r.recibo)).not.toMatch(/Ana|Beto|Eva|Fede/) // sin nombres de jugadores
    sinCambioDelPartido(b)
  })

  it('el orden es: versión ausente, versión vieja, y solo al final "listo"', async () => {
    const noLista = preparacionNoLista('P')
    const b = programado({ preparacion: noLista })
    const vieja = preparacionDePrueba('P').version
    expect((await iniciar(b, { preparacionVersion: null })).recibo.motivo).toBe('preparacion-version-ausente')
    expect((await iniciar(b, { preparacionVersion: vieja })).recibo.motivo).toBe('preparacion-desactualizada')
  })

  it('un partido que ya no está programado conserva partido-no-disponible, con o sin versión y con o sin contexto', async () => {
    for (const estado of ['vivo', 'final']) {
      for (const opts of [{}, { preparacionVersion: null }, { preparacionVersion: 'cualquiera' }]) {
        for (const preparacion of [undefined, null]) {
          const b = crearBanco({ estado, ...(preparacion === null ? { preparacion } : {}) })
          const r = await iniciar(b, opts)
          expect(r.tipo).toBe('rechazado')
          expect(r.recibo.motivo).toBe('partido-no-disponible')
        }
      }
    }
  })

  it('los cambios que no afectan a "listo" (nombres, acentos, equipos, inactivos) no provocan rechazo por versión', async () => {
    const b = programado()
    const capturada = b.adaptador.preparacion().version
    const cambiada = preparacionDePrueba('P', {
      equipos: EQUIPOS_DE_PRUEBA.map((e) => ({ ...e, nombre: `${e.nombre} Ñandú` })),
      jugadores: [
        ...JUGADORES_NUMERADOS.map((j) => ({ ...j, nombre: `${j.nombre} Ángel`, fechaNacimiento: '2001-02-03' })),
        { id: 'JY', equipoId: 'E2', nombre: 'Otro Inactivo', activo: false },
      ],
    })
    expect(cambiada.version).toBe(capturada)
    b.adaptador.fijarPreparacion(cambiada)
    expect((await iniciar(b, { preparacionVersion: capturada })).tipo).toBe('aceptado')
  })
})

describe('contexto ausente, mal formado, alterado o de otro partido', () => {
  const buena = preparacionDePrueba('P')
  const tramposos = {
    ausente: null,
    'texto en vez de objeto': 'hola',
    'objeto vacío': {},
    'otra forma': { version: 'x', gameId: 'P' },
    'huella corrupta': { ...buena, version: '0000000000000000' },
    'contenido alterado con la misma huella': { ...buena, jugadores: buena.jugadores.slice(1) },
    'clave de más': { ...buena, extra: 1 },
  }

  it.each(Object.entries(tramposos))('%s: rechazo definitivo "no disponible", sin lanzar y sin tocar el partido', async (_n, prep) => {
    const b = programado({ preparacion: prep })
    // Cualquier versión: la integridad se evalúa antes que la versión.
    for (const opts of [{}, { preparacionVersion: null }, { preparacionVersion: buena.version }]) {
      const r = await iniciar(b, { cmdId: `i${Math.random()}`, seq: b.adaptador.ultimoClientSeq() + 1, ...opts })
      expect(r.tipo).toBe('rechazado')
      expect(r.recibo.motivo).toBe('preparacion-no-disponible')
    }
    sinCambioDelPartido(b)
    expect(b.adaptador.ultimoClientSeq()).toBe(3)
  })

  it('un contexto íntegro de OTRO partido, con su propia versión, se rechaza como de otro partido sin nombrarlo', async () => {
    const ajena = preparacionDePrueba('OTRO-PARTIDO')
    expect(preparacionIntegra(ajena)).toBe(true) // internamente válido
    expect(evaluarPreparacion(ajena, { gameId: 'OTRO-PARTIDO' })).toEqual({ lista: true })
    const b = programado({ preparacion: ajena })
    const r = await iniciar(b, { cmdId: 'i1', preparacionVersion: ajena.version }) // la versión coincide con ese contexto
    expect(r.sobre.preparacionVersion).toBe(ajena.version)
    expect(r.tipo).toBe('rechazado')
    expect(r.recibo.motivo).toBe('preparacion-juego-distinto')
    // `contenido` es el eco del propio sobre del teléfono (incluye la versión que ÉL envió); lo que produce el servidor
    // (motivo, detalle, advertencias, refs, meta) no debe nombrar el otro partido ni su versión.
    const { contenido: _eco, ...delServidor } = r.recibo
    expect(JSON.stringify(delServidor)).not.toContain('OTRO-PARTIDO')
    expect(JSON.stringify(delServidor)).not.toContain(ajena.version)
    expect(delServidor.detalle).toEqual({})
    sinCambioDelPartido(b)
  })
})

describe('autorización antes de leer', () => {
  it('sin credencial válida no se lee ni la preparación ni ningún recibo, y no se revela nada', async () => {
    const b = programado()
    const aceptado = await iniciar(b, { cmdId: 'i1' })
    const antes = b.adaptador.foto()
    const lecturas = b.adaptador.lecturasDeVista()
    for (const credencial of ['no-existe', '']) {
      const r = await b.reenviar(aceptado.sobre, T0, credencial)
      expect(r.tipo).toBe('no-autorizado')
      expect(r.recibo).toBeUndefined()
    }
    b.adaptador.revocar('cred-A')
    const revocada = await b.reenviar(aceptado.sobre)
    expect(revocada).toMatchObject({ tipo: 'no-autorizado', motivo: 'credencial-revocada' })
    expect(revocada.recibo).toBeUndefined()
    expect(b.adaptador.lecturasDeVista()).toBe(lecturas)
    expect({ ...b.adaptador.foto(), credenciales: null, versionAutorizacion: null })
      .toEqual({ ...antes, credenciales: null, versionAutorizacion: null })
  })

  it('un inicio nuevo no autorizado tampoco llega a la puerta de preparación', async () => {
    const b = programado()
    const r = await iniciar(b, { credencial: 'no-existe' })
    expect(r.tipo).toBe('no-autorizado')
    expect(b.adaptador.lecturasDeVista()).toBe(0)
    expect(b.adaptador.ultimoClientSeq()).toBe(0)
  })
})

describe('cambio de la preparación entre leer y confirmar', () => {
  it('choca al confirmar, se vuelve a leer y se decide de nuevo con el contexto nuevo', async () => {
    const b = programado()
    const capturada = b.adaptador.preparacion().version
    b.adaptador.ganchos.trasLeer = (a) => a.fijarPreparacion(preparacionConCambioDeNumero('P'))
    const r = await iniciar(b, { cmdId: 'i1', preparacionVersion: capturada })
    expect(b.adaptador.lecturasDeVista()).toBe(2) // lectura inicial + relectura tras el conflicto
    expect(r.tipo).toBe('rechazado')
    expect(r.recibo.motivo).toBe('preparacion-desactualizada')
    expect(r.recibo.detalle.versionServidor).toBe(b.adaptador.preparacion().version) // la lectura FRESCA
    expect(Object.keys(b.adaptador.recibos())).toEqual(['i1'])
    expect(b.adaptador.confirmaciones()).toBe(1) // el primer intento no escribió nada
    sinCambioDelPartido(b)
  })

  it('si el cambio no afecta a "listo", la relectura acepta con la versión nueva ya igual', async () => {
    const b = programado()
    const capturada = b.adaptador.preparacion().version
    // Cambio solo de presentación: misma versión, no hay conflicto y se acepta a la primera.
    b.adaptador.ganchos.trasLeer = (a) => a.fijarPreparacion(preparacionDePrueba('P', {
      jugadores: JUGADORES_NUMERADOS.map((j) => ({ ...j, nombre: `${j.nombre} Z` })),
    }))
    const r = await iniciar(b, { preparacionVersion: capturada })
    expect(r.tipo).toBe('aceptado')
    expect(b.adaptador.lecturasDeVista()).toBe(1)
  })

  it('conflictos repetidos agotan los intentos como siempre y no dejan nada escrito', async () => {
    const b = programado()
    let n = 0
    const rearmar = (a) => {
      n += 1
      a.fijarPreparacion(preparacionDePrueba('P', { jugadores: JUGADORES_NUMERADOS.map((j) => (j.id === 'J2' ? { ...j, dorsal: 10 + n } : { ...j })) }))
      a.ganchos.trasLeer = rearmar
    }
    b.adaptador.ganchos.trasLeer = rearmar
    const antes = b.adaptador.foto().recibos
    await expect(iniciar(b)).rejects.toThrow('contencion-excesiva')
    b.adaptador.ganchos.trasLeer = null
    expect(b.adaptador.foto().recibos).toEqual(antes)
    expect(b.adaptador.ultimoClientSeq()).toBe(0)
    sinCambioDelPartido(b)
    expect(b.adaptador.lecturasDeVista()).toBe(3)
  })
})

describe('las demás órdenes no dependen de la preparación', () => {
  it('no llevan el campo, no lo admiten y no chocan por un cambio de plantilla; solo el inicio lo declara en `esperado`', async () => {
    const b = crearBanco() // partido vivo
    const esperados = []
    const espia = {
      ...b.adaptador,
      transaccion: (g, fn) => b.adaptador.transaccion(g, (tx) => fn({
        ...tx, confirmar: (arg) => { esperados.push(arg.esperado); return tx.confirmar(arg) },
      })),
    }
    const anotar = b.sobre('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, { cmdId: 'a1' })
    expect('preparacionVersion' in anotar).toBe(false)
    expect(validarSobre({ ...anotar, preparacionVersion: 'x' }).errores).toContain('preparacionVersion')
    expect(validarSobre({ ...b.sobre('arrancar-reloj'), preparacionVersion: 'x' }).errores).toContain('preparacionVersion')
    // La ayuda del banco tampoco la inyecta en otras órdenes, aunque se le pida.
    expect('preparacionVersion' in b.sobre('anotar', { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, { preparacionVersion: 'x' })).toBe(false)

    b.adaptador.ganchos.trasLeer = (a) => a.fijarPreparacion(preparacionNoLista('P'))
    const r = await ejecutar(espia, anotar, { recibidoEn: T0, credencial: b.credencial })
    expect(r.tipo).toBe('aceptado')
    expect(b.adaptador.lecturasDeVista()).toBe(1) // sin relectura: no hubo conflicto
    expect('versionPreparacion' in esperados[0]).toBe(false)

    const p = programado()
    const espiaP = {
      ...p.adaptador,
      transaccion: (g, fn) => p.adaptador.transaccion(g, (tx) => fn({
        ...tx, confirmar: (arg) => { esperados.push(arg.esperado); return tx.confirmar(arg) },
      })),
    }
    const inicio = p.sobre('iniciar-partido', {}, { cmdId: 'i1' })
    await ejecutar(espiaP, inicio, { recibidoEn: T0, credencial: p.credencial })
    expect(esperados[1].versionPreparacion).toBe(p.adaptador.preparacion().version)
  })
})

describe('un inicio rechazado en la cola del teléfono', () => {
  const orden = (cmdId, tipo, t, extra = {}) => ({ cmdId, tipo, datos: tipo === 'anotar' ? { equipoId: 'E1', jugadorId: 'J1', puntos: 2 } : {}, tiempo: { accionTs: t }, ...extra })
  const ctxLocal = (t) => ({ ahoraEstimado: t, actorId: 'yo' })

  it('queda guardado con lo que dependía de él, la cola se detiene y nada se reenvía; se recupera con estado fresco, versión vigente y otro cmdId', async () => {
    const b = programado()
    const versionVieja = b.adaptador.preparacion().version
    let cola = crearCola({ gameId: 'P', deviceId: 'tel-A' })
    let estado = b.adaptador.estado()
    for (const o of [
      orden('s1', 'iniciar-partido', T0, { preparacionVersion: versionVieja }),
      orden('s2', 'arrancar-reloj', T0 + 10),
      orden('s3', 'anotar', T0 + 20),
    ]) {
      const e = encolar(cola, estado, o, ctxLocal(o.tiempo.accionTs))
      expect(e.rechazoLocal, `${o.cmdId}`).toBeUndefined()
      cola = e.cola
      estado = e.estado
    }
    const originales = cola.entradas.map((e) => canonico(e.sobre))
    expect(cola.entradas[0].sobre.preparacionVersion).toBe(versionVieja)
    expect('preparacionVersion' in cola.entradas[1].sobre).toBe(false)

    // La plantilla cambió en el servidor antes de que llegara el inicio.
    b.adaptador.fijarPreparacion(preparacionConCambioDeNumero('P'))
    const enviado = proximoEnvio(marcarEnviando(cola, 's1'))
    const r = await ejecutarAutorizado(b.adaptador, enviado, { recibidoEn: T0 + 30 })
    expect(r.tipo).toBe('rechazado')
    expect(r.recibo.motivo).toBe('preparacion-desactualizada')
    cola = alRecibir(marcarEnviando(cola, 's1'), 's1', r)

    expect(cola.entradas.map((e) => e.estado)).toEqual(['rechazada', 'no-aplicada', 'no-aplicada'])
    expect(cola.detenida).toMatchObject({ causa: 'rechazo-definitivo', cmdId: 's1' })
    expect(cola.entradas.map((e) => canonico(e.sobre))).toEqual(originales) // sin reescribir
    expect(proximoEnvio(cola)).toBeNull() // no se reenvía nada solo
    expect(Object.keys(b.adaptador.recibos())).toEqual(['s1']) // lo dependiente nunca llegó al servidor
    expect(b.adaptador.ultimoClientSeq()).toBe(1)
    sinCambioDelPartido(b)
    expect(encolar(cola, estado, orden('n0', 'anotar', T0 + 40), ctxLocal(T0 + 40)).rechazoLocal.motivo).toBe('cola-detenida')

    // Recuperación explícita: estado autoritativo fresco, versión vigente y un cmdId NUEVO.
    const fresco = b.adaptador.estado()
    const rea = reanudar(cola, { ultimoClientSeq: b.adaptador.ultimoClientSeq(), rev: fresco.rev })
    expect(rea.ok).toBe(true)
    const nuevo = encolar(rea.cola, fresco, orden('s4', 'iniciar-partido', T0 + 50, { preparacionVersion: b.adaptador.preparacion().version }), ctxLocal(T0 + 50))
    expect(nuevo.sobre.clientSeq).toBe(2)
    expect(nuevo.sobre.preparacionVersion).toBe(b.adaptador.preparacion().version)
    expect((await ejecutarAutorizado(b.adaptador, nuevo.sobre, { recibidoEn: T0 + 50 })).tipo).toBe('aceptado')

    // Reutilizar el cmdId viejo no sustituye su orden: sigue siendo la original (con la versión vieja).
    const reuso = encolar(rea.cola, fresco, orden('s1', 'iniciar-partido', T0 + 60, { preparacionVersion: b.adaptador.preparacion().version }), ctxLocal(T0 + 60))
    expect(reuso.duplicada).toBe(true)
    expect(reuso.sobre.preparacionVersion).toBe(versionVieja)
    expect(rea.cola.entradas.map((e) => canonico(e.sobre))).toEqual(originales)
    // Y en el servidor su rechazo original sigue siendo el recibo de ese cmdId.
    const otra = await ejecutarAutorizado(b.adaptador, enviado, { recibidoEn: T0 + 70 })
    expect(otra).toMatchObject({ tipo: 'recibo-existente', recibo: { resultado: 'rechazado', motivo: 'preparacion-desactualizada' } })
  })
})

describe('versiones separadas: preparación y atribución', () => {
  const atribucionDe = (jugadores) => crearAtribucion({ equipos: ['E1', 'E2'], jugadores })

  it('un cambio de número mueve la versión de preparación, no la de atribución', () => {
    const cambiados = JUGADORES_NUMERADOS.map((j) => (j.id === 'J2' ? { ...j, dorsal: 8 } : j))
    expect(preparacionConCambioDeNumero('P').version).not.toBe(preparacionDePrueba('P').version)
    expect(atribucionDe(cambiados).version).toBe(atribucionDe(JUGADORES_NUMERADOS).version)
  })

  it('añadir un jugador inactivo mueve la atribución, no la preparación', () => {
    const conInactivo = [...JUGADORES_NUMERADOS, { id: 'JZ', equipoId: 'E2', nombre: 'Nuevo', activo: false }]
    expect(atribucionDe(conInactivo).version).not.toBe(atribucionDe(JUGADORES_NUMERADOS).version)
    expect(preparacionDePrueba('P', { jugadores: conInactivo }).version).toBe(preparacionDePrueba('P').version)
  })

  it('la versión de preparación nunca se confunde con la de atribución', () => {
    expect(preparacionDePrueba('P').version).not.toBe(atribucionDe(JUGADORES_NUMERADOS).version)
  })
})
