import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dentro } from './ayuda.js'
import { T0, TOKEN_OPERADOR, admin, comoOrganizador, control, iniciarSesion, reiniciarAcceso } from './ayuda-acceso.js'
import {
  accion, alta, asercionDe, campos, conLigasObservadas, conOp, contar, enAcceso, escenarioPlantilla, fila, leerRoster, nuevaOp, operarEnLiga,
  volcarPlantilla,
} from './ayuda-plantilla.js'

beforeEach(async () => { await reiniciarAcceso() })
afterEach(() => { control.ahoraMs = null; control.desfasesAcceso = null; control.pausa = null })

const GENERICO = { error: 'no-autorizado' }
const ruta = (e, equipo = 'E1') => `/v1/organizador/ligas/${e.ligaId}/equipos/${equipo}/jugadores`
const sinReproducido = (c) => { const { reproducido: _r, ...resto } = c; return resto }

describe('reintento exacto: se devuelve el resultado original ANTES de repetir cualquier decisión', () => {
  it('el reintento de un alta aplicado devuelve el mismo resultado y no escribe nada más', async () => {
    const e = await escenarioPlantilla()
    const op = nuevaOp()
    const cuerpo = { operacionId: op, campos: campos() }
    const primero = await comoOrganizador(e.cookie, 'POST', ruta(e), cuerpo)
    expect(primero.cuerpo.reproducido).toBe(false)
    const estado = await volcarPlantilla(e.ligaId)
    const segundo = await comoOrganizador(e.cookie, 'POST', ruta(e), cuerpo)
    expect(segundo.status).toBe(200)
    expect(segundo.cuerpo.reproducido).toBe(true)
    expect(sinReproducido(segundo.cuerpo)).toEqual(sinReproducido(primero.cuerpo))
    expect(await volcarPlantilla(e.ligaId)).toBe(estado)
  })

  it('tras un cambio de la ficha, el reintento de la edición devuelve lo aplicado (no "ficha desactualizada") y no la vuelve a aplicar', async () => {
    const e = await escenarioPlantilla()
    const op = nuevaOp()
    const cuerpo = { operacionId: op, revEsperada: 1, campos: { dorsal: 8 } }
    const primero = await comoOrganizador(e.cookie, 'POST', `${ruta(e)}/J2/editar`, cuerpo)
    expect(primero.cuerpo.tipo).toBe('editado')
    await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 2, campos: { dorsal: 9 } }) // otra edición posterior
    const reintento = await comoOrganizador(e.cookie, 'POST', `${ruta(e)}/J2/editar`, cuerpo)
    expect(reintento.cuerpo).toMatchObject({ resultado: 'aplicado', tipo: 'editado', reproducido: true, ficha: { dorsal: 8, rev: 2 } })
    expect((await fila(e.ligaId, 'J2')).dorsal).toBe(9) // la ficha no se tocó otra vez
  })

  it('después de un bloqueo, el reintento de lo ya aplicado devuelve lo aplicado; lo rechazado por bloqueo se repite igual aunque el bloqueo ya haya terminado', async () => {
    const e = await escenarioPlantilla()
    const aplicada = { operacionId: nuevaOp(), campos: campos() }
    const primero = await comoOrganizador(e.cookie, 'POST', ruta(e), aplicada)
    const P = e.telefono(e.ligaId, 'P')
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    const bloqueada = { operacionId: nuevaOp(), campos: campos({ nombrePila: 'Otra', dorsal: 44 }) }
    expect((await comoOrganizador(e.cookie, 'POST', ruta(e), bloqueada)).cuerpo.tipo).toBe('equipo-bloqueado')
    // con el equipo bloqueado, el reintento de lo aplicado sigue devolviendo lo aplicado
    expect(sinReproducido((await comoOrganizador(e.cookie, 'POST', ruta(e), aplicada)).cuerpo)).toEqual(sinReproducido(primero.cuerpo))
    // el partido termina: el bloqueo se levanta; el reintento exacto de lo rechazado sigue siendo el rechazo original
    control.ahoraMs = T0 + 5000
    await P.mandar('cerrar-partido', {}, { t: T0 + 5000 })
    expect((await leerRoster(e.cookie, e.ligaId, 'E1')).cuerpo.bloqueada).toBe(false)
    const reintento = await comoOrganizador(e.cookie, 'POST', ruta(e), bloqueada)
    expect(reintento.cuerpo).toMatchObject({ resultado: 'rechazado', tipo: 'equipo-bloqueado', reproducido: true })
    expect(await contar(e.ligaId, 'jugadores')).toBe(8) // 7 sembrados + el alta aplicado; nada del rechazado
    // la corrección tras un rechazo CONOCIDO usa un identificador nuevo, y entonces sí se aplica
    expect((await comoOrganizador(e.cookie, 'POST', ruta(e), { ...bloqueada, operacionId: nuevaOp() })).cuerpo.tipo).toBe('creado')
  })

  it('un rechazo por número ocupado también se repite igual aunque el número ya esté libre', async () => {
    const e = await escenarioPlantilla()
    const cuerpo = { operacionId: nuevaOp(), campos: campos({ dorsal: 7 }) }
    expect((await comoOrganizador(e.cookie, 'POST', ruta(e), cuerpo)).cuerpo.tipo).toBe('conflicto-numero')
    await accion(e.cookie, e.ligaId, 'E1', 'J2', 'desactivar', { revEsperada: 1 }) // el 7 queda libre
    const reintento = await comoOrganizador(e.cookie, 'POST', ruta(e), cuerpo)
    expect(reintento.cuerpo).toMatchObject({ tipo: 'conflicto-numero', reproducido: true })
  })

  it('el reintento no vuelve a buscar candidatos: el candidato original sigue en el recibo aunque la ficha ya no exista como coincidencia', async () => {
    const e = await escenarioPlantilla()
    const cuerpo = { operacionId: nuevaOp(), campos: campos({ nombrePila: 'Ana', apellido1: 'Prueba', dorsal: 22 }) }
    const primero = await comoOrganizador(e.cookie, 'POST', ruta(e, 'E2'), cuerpo)
    expect(primero.cuerpo.tipo).toBe('candidatos')
    await accion(e.cookie, e.ligaId, 'E1', 'J1', 'editar', { revEsperada: 1, confirmaCandidatos: true, campos: { nombrePila: 'Nombre', apellido1: 'Distinto' } })
    const reintento = await comoOrganizador(e.cookie, 'POST', ruta(e, 'E2'), cuerpo)
    expect(sinReproducido(reintento.cuerpo)).toEqual(sinReproducido(primero.cuerpo))
    expect(reintento.cuerpo.candidatos[0].nombreCompleto).toBe('Ana Prueba') // lo que se mostró entonces
  })
})

describe('el mismo identificador con otro contenido es un conflicto sin datos', () => {
  it('cualquier cambio de contenido, de destino o de tipo da 409 y no revela el resultado guardado', async () => {
    const e = await escenarioPlantilla()
    const op = nuevaOp()
    const original = await comoOrganizador(e.cookie, 'POST', ruta(e), { operacionId: op, campos: campos({ fechaNacimiento: '2014-05-01' }) })
    expect(original.cuerpo.tipo).toBe('creado')
    const estado = await volcarPlantilla(e.ligaId)
    const variantes = [
      ['otro número', ruta(e), { operacionId: op, campos: campos({ fechaNacimiento: '2014-05-01', dorsal: 13 }) }],
      ['otro nombre', ruta(e), { operacionId: op, campos: campos({ fechaNacimiento: '2014-05-01', nombrePila: 'Otra' }) }],
      ['campo de más', ruta(e), { operacionId: op, campos: campos({ fechaNacimiento: '2014-05-01', apellido2: '' }) }],
      ['el número como texto', ruta(e), { operacionId: op, campos: campos({ fechaNacimiento: '2014-05-01', dorsal: '12' }) }],
      ['con resolución', ruta(e), { operacionId: op, campos: campos({ fechaNacimiento: '2014-05-01' }), resolucionIdentidad: { tipo: 'otra-persona' } }],
      ['otro equipo', ruta(e, 'E2'), { operacionId: op, campos: campos({ fechaNacimiento: '2014-05-01' }) }],
    ]
    for (const [nombre, destino, cuerpo] of variantes) {
      const r = await comoOrganizador(e.cookie, 'POST', destino, cuerpo)
      expect(r.status, nombre).toBe(409)
      expect(r.cuerpo, nombre).toEqual({ error: 'operacion-conflicto' })
      expect(JSON.stringify(r.cuerpo)).not.toContain('Carla')
    }
    // la misma operación sobre una ficha (otro tipo de operación) tampoco
    const comoEdicion = await comoOrganizador(e.cookie, 'POST', `${ruta(e)}/J1/editar`, { operacionId: op, revEsperada: 1, campos: { dorsal: 40 } })
    expect(comoEdicion).toMatchObject({ status: 409, cuerpo: { error: 'operacion-conflicto' } })
    expect(await volcarPlantilla(e.ligaId)).toBe(estado)
    // y el original sigue disponible para el reintento exacto
    expect((await comoOrganizador(e.cookie, 'POST', ruta(e), { operacionId: op, campos: campos({ fechaNacimiento: '2014-05-01' }) })).cuerpo.reproducido).toBe(true)
  })

  it('un rechazo registrado tampoco acepta otro contenido con el mismo identificador (la corrección lleva uno nuevo)', async () => {
    const e = await escenarioPlantilla()
    const op = nuevaOp()
    expect((await comoOrganizador(e.cookie, 'POST', ruta(e), { operacionId: op, campos: campos({ dorsal: 7 }) })).cuerpo.tipo).toBe('conflicto-numero')
    const corregido = await comoOrganizador(e.cookie, 'POST', ruta(e), { operacionId: op, campos: campos({ dorsal: 18 }) })
    expect(corregido.status).toBe(409)
    expect(await contar(e.ligaId, 'jugadores')).toBe(7)
  })
})

describe('autorización ANTES de revelar un resultado guardado', () => {
  async function conResultadoGuardado() {
    const e = await escenarioPlantilla()
    const cuerpo = { operacionId: nuevaOp(), campos: campos({ nombreCamiseta: 'SECRETO-CAMISETA', fechaNacimiento: '2014-05-01' }) }
    const original = await comoOrganizador(e.cookie, 'POST', ruta(e), cuerpo)
    expect(original.cuerpo.tipo).toBe('creado')
    return { e, cuerpo }
  }
  const nadaRevelado = (r) => {
    expect(r.status).toBe(401)
    expect(r.cuerpo).toEqual(GENERICO)
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/SECRETO|Carla|2014/)
  }

  it('sin cookie, con cookie de sesión cerrada y con el organizador desactivado: el 401 genérico, igual que con un identificador desconocido', async () => {
    const { e, cuerpo } = await conResultadoGuardado()
    nadaRevelado(await comoOrganizador(null, 'POST', ruta(e), cuerpo))
    nadaRevelado(await comoOrganizador('0'.repeat(32) + '.' + '0'.repeat(64), 'POST', ruta(e), cuerpo))
    const desconocido = await comoOrganizador(null, 'POST', ruta(e), { ...cuerpo, operacionId: nuevaOp() })
    expect(desconocido.cuerpo).toEqual(GENERICO) // mismo 401: no hay oráculo de existencia
    const sesion2 = await iniciarSesion(e.codigo)
    await comoOrganizador(sesion2.cookie, 'POST', '/v1/organizador/salir')
    nadaRevelado(await comoOrganizador(sesion2.cookie, 'POST', ruta(e), cuerpo))
    expect((await admin('/v1/admin/organizador/desactivar', {}, TOKEN_OPERADOR)).status).toBe(200)
    nadaRevelado(await comoOrganizador(e.cookie, 'POST', ruta(e), cuerpo))
  })

  it('si el organizador deja de poseer la liga, el reintento no revela nada; si la recupera, el recibo vuelve a estar disponible', async () => {
    const { e, cuerpo } = await conResultadoGuardado()
    const filas = await enAcceso((inst) => inst.almacen.sql.exec('SELECT * FROM propiedad WHERE liga_id = ?', e.ligaId).toArray())
    expect(filas).toHaveLength(1)
    await enAcceso((inst) => inst.almacen.sql.exec('DELETE FROM propiedad WHERE liga_id = ?', e.ligaId).toArray())
    nadaRevelado(await comoOrganizador(e.cookie, 'POST', ruta(e), cuerpo))
    nadaRevelado(await comoOrganizador(e.cookie, 'GET', ruta(e)))
    await enAcceso((inst) => inst.almacen.sql.exec('INSERT INTO propiedad (organizador_id, liga_id) VALUES (?, ?)', filas[0].organizador_id, e.ligaId).toArray())
    expect((await comoOrganizador(e.cookie, 'POST', ruta(e), cuerpo)).cuerpo.reproducido).toBe(true)
  })

  it('en la liga, una afirmación vencida, futura, de otras ligas o malformada NUNCA devuelve el recibo (ni lo escribe)', async () => {
    const { e, cuerpo } = await conResultadoGuardado()
    const base = { ligaId: e.ligaId, tipo: 'alta', equipoId: 'E1', operacionId: cuerpo.operacionId, contenido: { campos: cuerpo.campos } }
    const estado = await volcarPlantilla(e.ligaId)
    const casos = {
      vencida: [asercionDe(e, { validadoEn: T0 - 5001 }), 'asercion-vencida'],
      futura: [asercionDe(e, { validadoEn: T0 + 1001 }), 'asercion-vencida'],
      'otra liga': [asercionDe(e, { ligas: ['LIGA99'] }), 'no-autorizado'],
      'sin ligas': [asercionDe(e, { ligas: [] }), 'no-autorizado'],
      'sin organizador': [{ sesionId: 's', ligas: e.ligas, validadoEn: T0 }, 'no-autorizado'],
      nula: [null, 'no-autorizado'],
    }
    for (const [nombre, [asercion, tipo]] of Object.entries(casos)) {
      const r = await operarEnLiga(e, { ...base, asercion })
      expect(r, nombre).toEqual({ tipo })
    }
    // en el límite (5000 ms exactos) todavía vale
    expect((await operarEnLiga(e, { ...base, asercion: asercionDe(e, { validadoEn: T0 - 5000 }) })).tipo).toBe('decidido')
    expect(await volcarPlantilla(e.ligaId)).toBe(estado)
  })

  it('en el Worker, una afirmación vencida se revalida UNA vez; si vuelve a vencer, 503 sin escritura y sin recibo', async () => {
    const { e, cuerpo } = await conResultadoGuardado()
    control.desfasesAcceso = [-6000] // la primera validación queda "vieja" para la liga; la segunda ya no
    const r = await comoOrganizador(e.cookie, 'POST', ruta(e), cuerpo)
    expect(r.status).toBe(200)
    expect(r.cuerpo.reproducido).toBe(true)
    control.desfasesAcceso = [-6000, -6000]
    const dos = await comoOrganizador(e.cookie, 'POST', ruta(e), cuerpo)
    expect(dos.status).toBe(503)
    expect(dos.cuerpo).toMatchObject({ tipo: 'fallo-sin-escritura', motivo: 'asercion-vencida', reintento: 'mismo-sobre' })
    expect(JSON.stringify(dos.cuerpo)).not.toMatch(/Carla|SECRETO/)
  })
})

describe('los recibos pertenecen al organizador que los creó', () => {
  it('otro principal con el MISMO identificador no ve ni choca con el recibo: tiene el suyo; el original sigue intacto', async () => {
    const e = await escenarioPlantilla()
    const op = nuevaOp()
    const contenido = { campos: campos({ nombreCamiseta: 'SECRETO' }) }
    const mio = await comoOrganizador(e.cookie, 'POST', ruta(e), { operacionId: op, ...contenido })
    expect(mio.cuerpo.tipo).toBe('creado')
    const otroPrincipal = asercionDe(e, { organizadorId: 'org-ajeno', sesionId: 's-ajena' })
    const suyo = await operarEnLiga(e, { asercion: otroPrincipal, operacionId: op, contenido })
    // no recibe mi resultado guardado: para él es una operación NUEVA, decidida ahora con el estado vigente de la liga
    // (aquí encuentra como candidata la ficha que yo creé, dato de la propia liga que ambos podrían leer)
    expect(suyo.reproducido).toBe(false)
    expect(suyo.cuerpo).toMatchObject({ resultado: 'rechazado', tipo: 'candidatos', operacionId: op })
    const filas = await dentro(e.ligaId, (inst) => inst.almacen.sql.exec('SELECT organizador_id, operacion_id FROM operaciones_plantilla ORDER BY organizador_id').toArray())
    expect(filas).toEqual([{ organizador_id: e.organizadorId, operacion_id: op }, { organizador_id: 'org-ajeno', operacion_id: op }].sort((a, b) => (a.organizador_id < b.organizador_id ? -1 : 1)))
    expect((await comoOrganizador(e.cookie, 'POST', ruta(e), { operacionId: op, ...contenido })).cuerpo.reproducido).toBe(true)
  })

  it('el recibo guarda principal, liga, operación, tipo, destino y huella; y solo hashes/ids (sin secretos)', async () => {
    const e = await escenarioPlantilla()
    const op = nuevaOp()
    await comoOrganizador(e.cookie, 'POST', `${ruta(e)}/J2/desactivar`, { operacionId: op, revEsperada: 1 })
    const [r] = await dentro(e.ligaId, (inst) => inst.almacen.sql.exec('SELECT * FROM operaciones_plantilla').toArray())
    expect(r).toMatchObject({ organizador_id: e.organizadorId, operacion_id: op, liga_id: e.ligaId, tipo: 'desactivar', equipo_id: 'E1', ficha_id: 'J2', resultado: 'aplicado', creado_en: T0 })
    expect(r.huella).toMatch(/^[0-9a-f]{64}$/)
    expect(r.sesion_id).toMatch(/^[0-9a-f]+$/)
    expect(JSON.stringify(r)).not.toContain(e.codigo)
  })
})

describe('el cambio, la auditoría y el recibo se confirman JUNTOS o no se confirma nada', () => {
  const objetivos = [
    ['alta', 'jugadores'], ['alta', 'auditoria_plantilla'], ['alta', 'operaciones_plantilla'],
    ['editar', 'jugadores'], ['editar', 'auditoria_plantilla'], ['editar', 'operaciones_plantilla'],
    ['desactivar', 'auditoria_plantilla'], ['desactivar', 'operaciones_plantilla'],
    ['reactivar', 'auditoria_plantilla'], ['reactivar', 'operaciones_plantilla'],
    ['rechazo', 'operaciones_plantilla'],
  ]
  for (const [tipo, tabla] of objetivos) {
    it(`si falla la escritura en ${tabla} durante «${tipo}», se deshace todo y el reintento con el mismo identificador la aplica una vez`, async () => {
      const e = await escenarioPlantilla()
      const evento = tabla === 'jugadores' && tipo === 'alta' ? 'INSERT' : tabla === 'jugadores' ? 'UPDATE' : 'INSERT'
      const cuerpoDe = {
        alta: { path: ruta(e), cuerpo: { operacionId: nuevaOp(), campos: campos() } },
        editar: { path: `${ruta(e)}/J2/editar`, cuerpo: { operacionId: nuevaOp(), revEsperada: 1, campos: { dorsal: 8 } } },
        desactivar: { path: `${ruta(e)}/J2/desactivar`, cuerpo: { operacionId: nuevaOp(), revEsperada: 1 } },
        reactivar: { path: `${ruta(e)}/JX/reactivar`, cuerpo: { operacionId: nuevaOp(), revEsperada: 1 } },
        rechazo: { path: ruta(e), cuerpo: { operacionId: nuevaOp(), campos: campos({ dorsal: 7 }) } }, // número ocupado: solo escribe el recibo
      }[tipo]
      await dentro(e.ligaId, (inst) => inst.almacen.sql.exec(`CREATE TRIGGER prueba_falla BEFORE ${evento} ON ${tabla} BEGIN SELECT RAISE(ABORT, 'falla de prueba'); END`).toArray())
      const antes = await volcarPlantilla(e.ligaId)
      const fallo = await comoOrganizador(e.cookie, 'POST', cuerpoDe.path, cuerpoDe.cuerpo)
      expect(fallo.status).toBe(503)
      expect(fallo.cuerpo).toEqual({ tipo: 'resultado-desconocido', reintento: 'mismo-sobre' })
      expect(await volcarPlantilla(e.ligaId), 'nada quedó escrito').toBe(antes)
      await dentro(e.ligaId, (inst) => inst.almacen.sql.exec('DROP TRIGGER prueba_falla').toArray())
      const reintento = await comoOrganizador(e.cookie, 'POST', cuerpoDe.path, cuerpoDe.cuerpo)
      expect(reintento.status).toBe(200)
      expect(reintento.cuerpo.reproducido).toBe(false) // se aplicó ahora, una sola vez
      expect(await contar(e.ligaId, 'operaciones_plantilla')).toBe(1)
      expect(await contar(e.ligaId, 'auditoria_plantilla')).toBe(tipo === 'rechazo' ? 0 : 1)
      const otra = await comoOrganizador(e.cookie, 'POST', cuerpoDe.path, cuerpoDe.cuerpo)
      expect(otra.cuerpo.reproducido).toBe(true)
      expect(await contar(e.ligaId, 'auditoria_plantilla')).toBe(tipo === 'rechazo' ? 0 : 1)
    })
  }
})
