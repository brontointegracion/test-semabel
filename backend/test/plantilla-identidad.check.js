import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sqlDe } from './ayuda.js'
import { T0, comoOrganizador, control, reiniciarAcceso } from './ayuda-acceso.js'
import {
  accion, alta, asercionDe, campos, conLigasObservadas, contar, escenarioPlantilla, fila, ligaStub, nuevaOp, operarEnLiga, payloadPlantilla, volcarPlantilla,
} from './ayuda-plantilla.js'

beforeEach(async () => { await reiniciarAcceso() })
afterEach(() => { control.ahoraMs = null; control.desfasesAcceso = null })

// Dos ligas del mismo organizador (U10 y U12 sintéticas). Cada liga tiene personas PROPIAS: ninguna se comparte por casualidad.
const payloadSeparado = (ligaId) => {
  const p = payloadPlantilla(ligaId)
  for (const j of p.jugadores) j.personaId = `persona-${ligaId}-${j.id}`
  return p
}
const dosLigas = () => escenarioPlantilla({ ligas: 2, payload: payloadSeparado })
const ruta = (ligaId, equipo = 'E1') => `/v1/organizador/ligas/${ligaId}/equipos/${equipo}/jugadores`
const BETO = { nombrePila: 'Beto', apellido1: 'Muestra' } // J2 de cada liga (dorsal 7, nacido en 2015)
const link = (a, ficha, persona) => ({ tipo: 'misma-persona-otra-liga', ligaOrigenId: a, fichaOrigenId: ficha, personaId: persona })

describe('misma persona en dos ligas: vínculo explícito y verificado', () => {
  it('sin resolución, el nombre solo SUGIERE: el alta se detiene con el candidato de la otra liga y no crea nada', async () => {
    const e = await dosLigas()
    const [A, B] = e.ligas
    const antes = await volcarPlantilla(B)
    const r = await comoOrganizador(e.cookie, 'POST', ruta(B), { operacionId: nuevaOp(), campos: campos({ ...BETO, dorsal: 20 }) })
    expect(r.cuerpo).toMatchObject({ resultado: 'rechazado', tipo: 'candidatos' })
    const cand = r.cuerpo.candidatos.find((c) => c.ligaId === A)
    expect(cand).toMatchObject({ fichaId: 'J2', personaId: `persona-${A}-J2`, equipoId: 'E1', equipoNombre: 'Alfa', nombreCompleto: 'Beto Muestra', activo: true, edad: 8 })
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/2015|4321/) // ni la fecha exacta ni el código
    expect(await contar(B, 'jugadores')).toBe(7)
    expect(JSON.parse(await volcarPlantilla(B)).jugadores).toEqual(JSON.parse(antes).jugadores)
    expect(await contar(B, 'auditoria_plantilla')).toBe(0)
  })

  it('con el vínculo explícito la ficha NUEVA de la liga B conserva el personaId de la ficha de la liga A; las dos fichas son distintas', async () => {
    const e = await dosLigas()
    const [A, B] = e.ligas
    const antesA = await volcarPlantilla(A)
    const op = nuevaOp()
    const r = await comoOrganizador(e.cookie, 'POST', ruta(B), { operacionId: op, campos: campos({ ...BETO, dorsal: 20 }), resolucionIdentidad: link(A, 'J2', `persona-${A}-J2`) })
    expect(r.cuerpo).toMatchObject({ resultado: 'aplicado', tipo: 'creado' })
    expect(r.cuerpo.ficha.personaId).toBe(`persona-${A}-J2`)
    expect(r.cuerpo.ficha.id).not.toBe('J2')
    expect(r.cuerpo.ficha.ligaId).toBe(B)
    expect((await fila(B, r.cuerpo.ficha.id)).persona_id).toBe((await fila(A, 'J2')).persona_id)
    expect(await volcarPlantilla(A)).toBe(antesA) // la liga de origen no se tocó
    const [a] = await sqlDe(B, 'SELECT detalle_json FROM auditoria_plantilla')
    expect(JSON.parse(a.detalle_json).identidad).toEqual({ tipo: 'misma-persona-otra-liga', ligaOrigenId: A, fichaOrigenId: 'J2' })
    // repetir el vínculo con la persona ya activa en ese equipo no crea otra ficha
    const otra = await comoOrganizador(e.cookie, 'POST', ruta(B), { operacionId: nuevaOp(), campos: campos({ ...BETO, dorsal: 21 }), resolucionIdentidad: link(A, 'J2', `persona-${A}-J2`) })
    expect(otra.cuerpo).toMatchObject({ resultado: 'rechazado', tipo: 'ya-activo' })
    expect(await contar(B, 'jugadores')).toBe(8)
  })

  it('el vínculo también vale con una ficha INACTIVA de la liga de origen', async () => {
    const e = await dosLigas()
    const [A, B] = e.ligas
    const r = await comoOrganizador(e.cookie, 'POST', ruta(B, 'E2'), { operacionId: nuevaOp(), campos: campos({ nombrePila: 'Dario', apellido1: 'Inactivo', dorsal: 30 }), resolucionIdentidad: link(A, 'JX', `persona-${A}-JX`) })
    expect(r.cuerpo.ficha.personaId).toBe(`persona-${A}-JX`)
  })

  it('«otra persona» es una decisión EXPLÍCITA: crea una identidad nueva aunque el nombre coincida, y queda en la auditoría', async () => {
    const e = await dosLigas()
    const [A, B] = e.ligas
    const r = await comoOrganizador(e.cookie, 'POST', ruta(B), { operacionId: nuevaOp(), campos: campos({ ...BETO, dorsal: 20 }), resolucionIdentidad: { tipo: 'otra-persona' } })
    expect(r.cuerpo.tipo).toBe('creado')
    expect(r.cuerpo.ficha.personaId).toMatch(/^pr-/)
    expect(r.cuerpo.ficha.personaId).not.toBe(`persona-${A}-J2`)
    const [a] = await sqlDe(B, 'SELECT detalle_json FROM auditoria_plantilla')
    expect(JSON.parse(a.detalle_json).identidad).toEqual({ tipo: 'otra-persona' })
  })

  it('una persona genuinamente nueva (sin coincidencias en NINGUNA liga del organizador) recibe una identidad nueva, con constancia de qué ligas se consultaron', async () => {
    const e = await dosLigas()
    const [A, B] = e.ligas
    const r = await alta(e.cookie, B, 'E1', { campos: campos({ nombrePila: 'Zoe', apellido1: 'Original', dorsal: 20 }) })
    expect(r.cuerpo.tipo).toBe('creado')
    expect(r.cuerpo.ficha.personaId).toMatch(/^pr-[0-9a-f-]{36}$/)
    const [a] = await sqlDe(B, 'SELECT detalle_json FROM auditoria_plantilla')
    expect(JSON.parse(a.detalle_json).identidad).toEqual({ tipo: 'nueva-sin-coincidencias', ligasConsultadas: [A] })
  })

  it('misma persona dentro de la propia liga: reutiliza su personaId, y no se acepta uno de otra liga ni inventado', async () => {
    const e = await dosLigas()
    const [A, B] = e.ligas
    const dentro = await comoOrganizador(e.cookie, 'POST', ruta(B, 'E2'), { operacionId: nuevaOp(), campos: campos({ ...BETO, dorsal: 25 }), resolucionIdentidad: { tipo: 'misma-persona', personaId: `persona-${B}-J2` } })
    expect(dentro.cuerpo.ficha.personaId).toBe(`persona-${B}-J2`)
    for (const personaId of [`persona-${A}-J2`, 'persona-inventada', 'pr-00000000-0000-0000-0000-000000000000']) {
      const r = await comoOrganizador(e.cookie, 'POST', ruta(B, 'E3'), { operacionId: nuevaOp(), campos: campos({ ...BETO, dorsal: 26 }), resolucionIdentidad: { tipo: 'misma-persona', personaId } })
      expect(r.cuerpo, personaId).toMatchObject({ resultado: 'rechazado', tipo: 'identidad-invalida' })
    }
    expect(await contar(B, 'jugadores')).toBe(8)
  })
})

describe('lo que dice el cliente sobre identidad no se acepta sin verificar', () => {
  it('personaId inventado o de otra persona, ficha inexistente, liga no poseída o la propia liga: identidad inválida, sin crear nada y SIN leer más ligas de las necesarias', async () => {
    const e = await dosLigas()
    const [A, B] = e.ligas
    const casos = {
      'personaId que no es el de esa ficha': link(A, 'J2', `persona-${A}-J1`),
      'personaId inventado': link(A, 'J2', 'persona-inventada'),
      'ficha inexistente': link(A, 'NO-EXISTE', `persona-${A}-J2`),
      'liga admitida pero ajena': link('LIGA99', 'J2', 'persona-x'),
      'la propia liga': link(B, 'J2', `persona-${B}-J2`),
    }
    for (const [nombre, resolucionIdentidad] of Object.entries(casos)) {
      const antes = await volcarPlantilla(B)
      const obs = conLigasObservadas()
      const r = await obs.llamar(e.cookie, 'POST', ruta(B), { operacionId: nuevaOp(), campos: campos({ ...BETO, dorsal: 20 }), resolucionIdentidad })
      expect(r.cuerpo, nombre).toMatchObject({ resultado: 'rechazado', tipo: 'identidad-invalida' })
      expect(obs.accesos.includes('LIGA99'), nombre).toBe(false) // jamás se consulta una liga que no es del organizador
      const ahora = JSON.parse(await volcarPlantilla(B))
      expect(ahora.jugadores, nombre).toEqual(JSON.parse(antes).jugadores)
      expect(ahora.auditoria, nombre).toEqual([])
    }
  })

  it('el cliente no puede enviar evidencia propia: «vinculo» y «verificacion» son claves desconocidas (422)', async () => {
    const e = await dosLigas()
    const [A, B] = e.ligas
    for (const extra of [{ vinculo: { ligaId: A, fichaId: 'J2', personaId: `persona-${A}-J2` } }, { verificacion: { vinculo: {} } }]) {
      const r = await comoOrganizador(e.cookie, 'POST', ruta(B), { operacionId: nuevaOp(), campos: campos(), resolucionIdentidad: link(A, 'J2', `persona-${A}-J2`), ...extra })
      expect(r.status).toBe(422)
    }
    const r = await comoOrganizador(e.cookie, 'POST', ruta(B), { operacionId: nuevaOp(), campos: campos(), resolucionIdentidad: { ...link(A, 'J2', `persona-${A}-J2`), vinculo: true } })
    expect(r.status).toBe(422)
  })

  it('la liga de destino comprueba que la evidencia del Worker coincide con lo pedido (evidencia de otra ficha o persona no sirve)', async () => {
    const e = await dosLigas()
    const [A, B] = e.ligas
    const contenido = { campos: campos({ ...BETO, dorsal: 20 }), resolucionIdentidad: link(A, 'J2', `persona-${A}-J2`) }
    const falsas = [
      { vinculo: { ligaId: A, fichaId: 'J1', personaId: `persona-${A}-J2` } },
      { vinculo: { ligaId: A, fichaId: 'J2', personaId: `persona-${A}-J1` } },
      { vinculo: { ligaId: B, fichaId: 'J2', personaId: `persona-${A}-J2` } },
      { vinculo: null },
    ]
    for (const verificacion of falsas) {
      const r = await operarEnLiga(e, { ligaId: B, operacionId: nuevaOp(), contenido, verificacion })
      expect(r.cuerpo, JSON.stringify(verificacion)).toMatchObject({ tipo: 'identidad-invalida' })
    }
    expect(await contar(B, 'jugadores')).toBe(7)
    // sin evidencia, la liga la PIDE (y no escribe nada)
    const pide = await operarEnLiga(e, { ligaId: B, operacionId: nuevaOp(), contenido })
    expect(pide).toMatchObject({ tipo: 'requiere-verificacion', accion: 'vinculo', ligaOrigenId: A, fichaOrigenId: 'J2' })
    // y sin cobertura completa de las demás ligas, tampoco se afirma que no haya candidatos
    const parcial = await operarEnLiga(e, { ligaId: B, operacionId: nuevaOp(), contenido: { campos: campos({ nombrePila: 'Nuevo', apellido1: 'Total', dorsal: 20 }) }, verificacion: { ligasConsultadas: [], candidatos: [] } })
    expect(parcial.tipo).toBe('requiere-verificacion')
    expect(await contar(B, 'operaciones_plantilla')).toBe(4)
  })
})

describe('si no se puede verificar la identidad, NO se crea nada', () => {
  it('liga de origen no disponible: 503 identidad-no-verificable, sin ficha, sin auditoría y sin recibo; al volver, el mismo identificador se aplica una vez', async () => {
    const e = await dosLigas()
    const [A, B] = e.ligas
    let creadas = 0
    for (const resolucionIdentidad of [undefined, link(A, 'J2', `persona-${A}-J2`)]) {
      const antes = await volcarPlantilla(B)
      const op = nuevaOp()
      const cuerpo = { operacionId: op, campos: campos({ ...BETO, dorsal: 20 + creadas, nombrePila: resolucionIdentidad ? 'Beto' : 'Nuevo' , apellido1: resolucionIdentidad ? 'Muestra' : 'Persona' }), ...(resolucionIdentidad ? { resolucionIdentidad } : {}) }
      const caida = conLigasObservadas({ noDisponibles: [A] })
      const r = await caida.llamar(e.cookie, 'POST', ruta(B), cuerpo)
      expect(r.status).toBe(503)
      expect(r.cuerpo).toEqual({ error: 'identidad-no-verificable', reintento: 'misma-solicitud' })
      expect(await volcarPlantilla(B)).toBe(antes)
      const ok = await conLigasObservadas().llamar(e.cookie, 'POST', ruta(B), cuerpo)
      expect(ok.cuerpo).toMatchObject({ resultado: 'aplicado', tipo: 'creado', reproducido: false })
      creadas += 1
      expect(await contar(B, 'jugadores')).toBe(7 + creadas)
      expect((await conLigasObservadas().llamar(e.cookie, 'POST', ruta(B), cuerpo)).cuerpo.reproducido).toBe(true)
    }
  })

  it('una lectura de la otra liga con afirmación vencida o ajena no devuelve datos', async () => {
    const e = await dosLigas()
    const [A] = e.ligas
    const lectura = (asercion) => ligaStub(A).candidatosParaOtraLiga({ asercion, ligaId: A, clave: 'beto muestra ' })
    expect(await lectura(asercionDe(e, { validadoEn: T0 - 5001 }))).toEqual({ tipo: 'asercion-vencida' })
    expect(await lectura(asercionDe(e, { ligas: ['LIGA99'] }))).toEqual({ tipo: 'no-autorizado' })
    const ficha = (asercion) => ligaStub(A).resolverFichaParaOtraLiga({ asercion, ligaId: A, fichaId: 'J2' })
    expect(await ficha(asercionDe(e, { validadoEn: T0 - 5001 }))).toEqual({ tipo: 'asercion-vencida' })
    expect(await ficha(asercionDe(e, { ligas: [] }))).toEqual({ tipo: 'no-autorizado' })
    expect((await ficha(asercionDe(e))).vinculo).toMatchObject({ ligaId: A, fichaId: 'J2', personaId: `persona-${A}-J2` })
  })
})

describe('el recibo se devuelve ANTES de leer otras ligas', () => {
  it('con la liga de origen caída o cambiada, el reintento exacto devuelve el resultado original sin tocar la liga de origen', async () => {
    const e = await dosLigas()
    const [A, B] = e.ligas
    const aplicada = { operacionId: nuevaOp(), campos: campos({ ...BETO, dorsal: 20 }), resolucionIdentidad: link(A, 'J2', `persona-${A}-J2`) }
    const rechazada = { operacionId: nuevaOp(), campos: campos({ nombrePila: 'Ana', apellido1: 'Prueba', dorsal: 21 }) } // coincide con J1 de la otra liga
    const nueva = { operacionId: nuevaOp(), campos: campos({ nombrePila: 'Zoe', apellido1: 'Original', dorsal: 22 }) }
    const o1 = await comoOrganizador(e.cookie, 'POST', ruta(B), aplicada)
    const o2 = await comoOrganizador(e.cookie, 'POST', ruta(B), rechazada)
    const o3 = await comoOrganizador(e.cookie, 'POST', ruta(B), nueva)
    expect([o1.cuerpo.tipo, o2.cuerpo.tipo, o3.cuerpo.tipo]).toEqual(['creado', 'candidatos', 'creado'])

    // la liga de origen cambia (la ficha se desactiva y se renombra) y además deja de estar disponible
    await accion(e.cookie, A, 'E1', 'J2', 'editar', { revEsperada: 1, confirmaCandidatos: true, campos: { nombrePila: 'Otro', apellido1: 'Nombre' } })
    await accion(e.cookie, A, 'E1', 'J1', 'editar', { revEsperada: 1, confirmaCandidatos: true, campos: { nombrePila: 'Cambiada', apellido1: 'Del Todo' } })
    const caida = conLigasObservadas({ noDisponibles: [A] })
    for (const [orig, cuerpo] of [[o1, aplicada], [o2, rechazada], [o3, nueva]]) {
      const r = await caida.llamar(e.cookie, 'POST', ruta(B), cuerpo)
      expect(r.status).toBe(200)
      expect(r.cuerpo.reproducido).toBe(true)
      const { reproducido: _a, ...x } = r.cuerpo
      const { reproducido: _b, ...y } = orig.cuerpo
      expect(x).toEqual(y)
    }
    expect(caida.accesos.every((n) => n === B)).toBe(true) // jamás se intentó llegar a la liga de origen
    // un identificador NUEVO sí necesita la liga de origen y falla cerrado
    const nuevoId = await caida.llamar(e.cookie, 'POST', ruta(B), { ...nueva, operacionId: nuevaOp(), campos: campos({ nombrePila: 'Otra', apellido1: 'Cosa', dorsal: 23 }) })
    expect(nuevoId.status).toBe(503)
  })

  it('un organizador con UNA sola liga no lee ninguna otra: se decide en una sola llamada', async () => {
    const e = await escenarioPlantilla({ ligas: 1 })
    const obs = conLigasObservadas()
    const r = await obs.llamar(e.cookie, 'POST', ruta(e.ligaId), { operacionId: nuevaOp(), campos: campos() })
    expect(r.cuerpo.tipo).toBe('creado')
    expect([...new Set(obs.accesos)]).toEqual([e.ligaId])
  })
})

describe('límites de la verificación entre ligas (no prueba unicidad global)', () => {
  it('el nombre se compara sin mayúsculas ni acentos, pero una grafía distinta NO coincide: sugiere, no prueba', async () => {
    const e = await dosLigas()
    const [, B] = e.ligas
    const r1 = await alta(e.cookie, B, 'E2', { campos: campos({ nombrePila: 'BÉTO', apellido1: 'muestra', dorsal: 31 }) })
    expect(r1.cuerpo.tipo).toBe('candidatos') // coincide (acentos y mayúsculas)
    const r2 = await alta(e.cookie, B, 'E2', { campos: campos({ nombrePila: 'Betho', apellido1: 'Muestra', dorsal: 31 }) })
    expect(r2.cuerpo.tipo).toBe('creado') // otra grafía: no se detecta
    expect(r2.cuerpo.ficha.personaId).toMatch(/^pr-/)
  })

  it('una escritura concurrente en la otra liga, posterior a la lectura de candidatos, no se ve: pueden quedar dos identidades (no hay atomicidad entre objetos)', async () => {
    const e = await dosLigas()
    const [A, B] = e.ligas
    // Justo DESPUÉS de que la liga A responda "sin candidatos", otra alta crea a la misma persona en A.
    const fallarEn = (nombre, stub) => (nombre !== A ? stub : new Proxy(stub, {
      get(objetivo, prop) {
        if (prop !== 'candidatosParaOtraLiga') return objetivo[prop]
        return async (args) => {
          const r = await objetivo.candidatosParaOtraLiga(args)
          await operarEnLiga(e, { ligaId: A, operacionId: nuevaOp(), contenido: { campos: campos({ nombrePila: 'Zoe', apellido1: 'Concurrente', dorsal: 40 }), resolucionIdentidad: { tipo: 'otra-persona' } } })
          return r
        }
      },
    }))
    const obs = conLigasObservadas({ fallarEn })
    const enB = await obs.llamar(e.cookie, 'POST', ruta(B), { operacionId: nuevaOp(), campos: campos({ nombrePila: 'Zoe', apellido1: 'Concurrente', dorsal: 41 }) })
    expect(enB.cuerpo.tipo).toBe('creado') // la lectura no vio la escritura concurrente
    const personas = [
      ...(await sqlDe(A, "SELECT persona_id FROM jugadores WHERE nombre_pila = 'Zoe'")),
      ...(await sqlDe(B, "SELECT persona_id FROM jugadores WHERE nombre_pila = 'Zoe'")),
    ].map((f) => f.persona_id)
    expect(personas).toHaveLength(2)
    expect(new Set(personas).size).toBe(2) // dos identidades: documentado como límite; la próxima alta con ese nombre ya mostrará ambas como candidatas
    const siguiente = await alta(e.cookie, B, 'E2', { campos: campos({ nombrePila: 'Zoe', apellido1: 'Concurrente', dorsal: 42 }) })
    expect(siguiente.cuerpo.tipo).toBe('candidatos')
  })

  it('las fichas anteriores sin partes de nombre no se pueden comparar por nombre (límite conocido)', async () => {
    const e = await dosLigas()
    const [, B] = e.ligas
    const r = await alta(e.cookie, B, 'E2', { campos: campos({ nombrePila: 'Legado', apellido1: 'Sin', apellido2: 'Numero', dorsal: 31 }) })
    expect(r.cuerpo.tipo).toBe('creado') // «Legado Sin Numero» (L1) solo tiene `nombre`, así que no coincide
  })
})
