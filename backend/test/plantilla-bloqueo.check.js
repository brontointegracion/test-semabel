import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dentro, fijarEstadoDePartido, sqlDe } from './ayuda.js'
import { T0, control, reiniciarAcceso } from './ayuda-acceso.js'
import { accion, alta, campos, contar, escenarioPlantilla, fila, leerLiga, leerRoster, volcarPlantilla } from './ayuda-plantilla.js'

beforeEach(async () => { await reiniciarAcceso() })
afterEach(() => { control.ahoraMs = null; control.pausa = null })

// El cuerpo se lee de inmediato: el runtime no permite leerlo después de otras llamadas a objetos distintos.
const leerCuerpo = async (respuesta) => ({ status: respuesta.status, cuerpo: await respuesta.json() })

function pausarUnaVez(esCandidata = () => true) {
  let avisar
  const pausada = new Promise((r) => { avisar = r })
  let liberar
  const hastaLiberar = new Promise((r) => { liberar = r })
  let usada = false
  control.pausa = async (sobre) => {
    if (usada || !esCandidata(sobre)) return
    usada = true
    avisar()
    await hastaLiberar
  }
  return { pausada, liberar }
}

/** Las cuatro operaciones contra un equipo; devuelve los cuerpos. */
async function intentarTodo(e, equipoId, fichaId, rev) {
  return {
    alta: (await alta(e.cookie, e.ligaId, equipoId, { campos: campos({ dorsal: 77 }) })).cuerpo,
    editar: (await accion(e.cookie, e.ligaId, equipoId, fichaId, 'editar', { revEsperada: rev, campos: { dorsal: 78 } })).cuerpo,
    desactivar: (await accion(e.cookie, e.ligaId, equipoId, fichaId, 'desactivar', { revEsperada: rev })).cuerpo,
    reactivar: (await accion(e.cookie, e.ligaId, equipoId, fichaId, 'reactivar', { revEsperada: rev })).cuerpo,
  }
}

const SIN_DATOS = ['resultado', 'tipo', 'operacionId', 'reproducido']

/** Manda un comando con el reloj del servidor y la hora de la acción al mismo instante (T0 + ms). */
const en = (tel, tipo, ms, datos = {}) => { control.ahoraMs = T0 + ms; return tel.mandar(tipo, datos, { t: T0 + ms }) }

describe('bloqueo de los dos equipos mientras el partido está en curso', () => {
  it('programado no bloquea (ni siquiera con la hora programada ya pasada); vivo bloquea a AMBOS equipos y a ninguno más', async () => {
    const e = await escenarioPlantilla()
    await fijarEstadoDePartido(e.ligaId, 'P', { inicio: T0 - 3_600_000 }) // hora programada pasada: no es un inicio aceptado
    expect((await leerRoster(e.cookie, e.ligaId, 'E1')).cuerpo.bloqueada).toBe(false)
    expect((await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ dorsal: 31 }) })).cuerpo.tipo).toBe('creado')

    const P = e.telefono(e.ligaId, 'P')
    expect((await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })).cuerpo.resultado).toBe('aceptado')

    const antes = await volcarPlantilla(e.ligaId)
    const jugadoresAntes = JSON.parse(antes).jugadores
    for (const [equipoId, ficha] of [['E1', 'J2'], ['E2', 'J9']]) {
      const r = await intentarTodo(e, equipoId, ficha, 1)
      for (const [tipo, cuerpo] of Object.entries(r)) {
        expect(cuerpo, `${equipoId} ${tipo}`).toMatchObject({ resultado: 'rechazado', tipo: 'equipo-bloqueado' })
        expect(Object.keys(cuerpo).sort(), 'un rechazo por bloqueo no lleva datos de jugadores').toEqual(SIN_DATOS.slice().sort())
      }
    }
    // no hubo ninguna escritura de plantilla (solo los recibos de los rechazos)
    expect(JSON.parse(await volcarPlantilla(e.ligaId)).jugadores).toEqual(jugadoresAntes)
    expect(await contar(e.ligaId, 'auditoria_plantilla')).toBe(1) // el alta anterior
    // la lectura sigue permitida y avisa del bloqueo
    expect((await leerRoster(e.cookie, e.ligaId, 'E1')).cuerpo.bloqueada).toBe(true)
    const equipos = (await leerLiga(e.cookie, e.ligaId)).cuerpo.equipos
    expect(equipos.map((t) => [t.id, t.bloqueada])).toEqual([['E1', true], ['E2', true], ['E3', false], ['E4', false]])
    // los equipos del otro partido (Q) siguen editables
    expect((await alta(e.cookie, e.ligaId, 'E4', { campos: campos({ nombrePila: 'Dora', dorsal: 40 }) })).cuerpo.tipo).toBe('creado')
  })

  it('una pausa del reloj y el descanso entre periodos siguen bloqueando; el final desbloquea', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const bloqueada = async (equipo = 'E1') => (await leerRoster(e.cookie, e.ligaId, equipo)).cuerpo.bloqueada
    const siempreRechaza = async () => (await alta(e.cookie, e.ligaId, 'E2', { campos: campos({ dorsal: 66 + Math.floor(Math.random() * 10) }) })).cuerpo.tipo

    expect((await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })).cuerpo.resultado).toBe('aceptado')
    expect((await en(P, 'arrancar-reloj', 2000)).cuerpo.resultado).toBe('aceptado')
    expect((await P.estado()).partido.estado).toBe('vivo')
    expect(await bloqueada()).toBe(true)

    expect((await en(P, 'detener-reloj', 3000)).cuerpo.resultado).toBe('aceptado') // pausa
    expect((await P.estado()).partido.estado).toBe('vivo')
    expect(await bloqueada()).toBe(true)
    expect(await siempreRechaza()).toBe('equipo-bloqueado')

    const descanso = await en(P, 'siguiente-periodo', 4000) // descanso entre periodos
    expect(descanso.cuerpo.resultado).toBe('aceptado')
    expect((await P.estado()).partido.estado).toBe('vivo')
    expect(await bloqueada()).toBe(true)
    expect(await bloqueada('E2')).toBe(true)
    expect(await siempreRechaza()).toBe('equipo-bloqueado')

    expect((await en(P, 'cerrar-partido', 5000)).cuerpo.resultado).toBe('aceptado')
    expect((await P.estado()).partido.estado).toBe('final')
    expect(await bloqueada()).toBe(false)
    expect((await alta(e.cookie, e.ligaId, 'E2', { campos: campos({ dorsal: 60 }) })).cuerpo.tipo).toBe('creado')
  })

  it('un equipo con varios partidos sigue bloqueado mientras CUALQUIERA de ellos esté en curso', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const R = e.telefono(e.ligaId, 'R')
    const estados = async () => Object.fromEntries((await leerLiga(e.cookie, e.ligaId)).cuerpo.equipos.map((t) => [t.id, t.bloqueada]))
    await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    await R.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(await estados()).toEqual({ E1: true, E2: true, E3: true, E4: false })
    await en(P, 'cerrar-partido', 2000)
    // P terminó: E2 queda libre; E1 sigue en R junto con E3
    expect(await estados()).toEqual({ E1: true, E2: false, E3: true, E4: false })
    expect((await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ dorsal: 50 }) })).cuerpo.tipo).toBe('equipo-bloqueado')
    expect((await alta(e.cookie, e.ligaId, 'E2', { campos: campos({ dorsal: 50 }) })).cuerpo.tipo).toBe('creado')
    await en(R, 'cerrar-partido', 3000)
    expect(await estados()).toEqual({ E1: false, E2: false, E3: false, E4: false })
  })

  it('un estado desconocido o ausente bloquea (falla cerrado); un estado ilegible deshace la operación entera', async () => {
    const e = await escenarioPlantilla()
    for (const estado of ['suspendido', '', null, 'VIVO', 7]) {
      await fijarEstadoDePartido(e.ligaId, 'P', { estado })
      const r = await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ dorsal: 51 }) })
      expect(r.cuerpo, String(estado)).toMatchObject({ resultado: 'rechazado', tipo: 'equipo-bloqueado' })
    }
    await fijarEstadoDePartido(e.ligaId, 'P', { estado: 'programado' })
    expect((await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ dorsal: 52 }) })).cuerpo.tipo).toBe('creado')

    await dentro(e.ligaId, (inst) => inst.almacen.sql.exec("UPDATE partidos SET estado_json = '{no es json' WHERE id = 'R'").toArray())
    const antes = await volcarPlantilla(e.ligaId)
    const r = await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ dorsal: 53 }) })
    expect(r.status).toBe(503)
    expect(r.cuerpo).toEqual({ tipo: 'resultado-desconocido', reintento: 'mismo-sobre' })
    expect(await volcarPlantilla(e.ligaId)).toBe(antes)
  })
})

describe('edición de plantilla frente al inicio: los dos órdenes, sin escrituras parciales', () => {
  it('la edición confirmada ANTES del inicio hace que el inicio con la huella vieja se rechace de forma definitiva (y la edición se conserva)', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const vieja = (await P.preparacion()).version
    expect((await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: { dorsal: 8 } })).cuerpo.tipo).toBe('editado')
    const r = await P.mandar('iniciar-partido', {}, { t: T0 + 1000, preparacionVersion: vieja })
    expect(r.cuerpo.resultado).toBe('rechazado')
    expect(r.cuerpo.recibo.motivo).toBe('preparacion-desactualizada')
    expect((await P.estado()).partido.estado).toBe('programado')
    expect((await fila(e.ligaId, 'J2')).dorsal).toBe(8)
  })

  it('el inicio confirmado ANTES de la edición la deja rechazada por bloqueo y la ficha intacta', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    expect((await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })).cuerpo.resultado).toBe('aceptado')
    const antes = await fila(e.ligaId, 'J2')
    const r = await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: { dorsal: 8 } })
    expect(r.cuerpo.tipo).toBe('equipo-bloqueado')
    expect(await fila(e.ligaId, 'J2')).toEqual(antes)
  })

  it('edición que llega MIENTRAS el inicio está leído pero sin confirmar: se confirma primero y el inicio se rechaza sin escribir nada', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    const { pausada, liberar } = pausarUnaVez((s) => s.tipo === 'iniciar-partido')
    const envio = P.enviar(sobre).then(leerCuerpo)
    await pausada // el servidor ya leyó la huella V1 y todavía no confirmó
    const edicion = await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: { dorsal: 8 } })
    expect(edicion.cuerpo.tipo).toBe('editado') // el partido aún no está en curso: no hay bloqueo
    liberar()
    const { cuerpo } = await envio
    expect(cuerpo.resultado).toBe('rechazado')
    expect(cuerpo.recibo.motivo).toBe('preparacion-desactualizada')
    expect((await P.estado()).partido.estado).toBe('programado')
    expect(await sqlDe(e.ligaId, "SELECT COUNT(*) AS n FROM eventos WHERE partido_id = 'P'")).toEqual([{ n: 0 }])
    expect((await fila(e.ligaId, 'J2')).dorsal).toBe(8)
  })

  it('un cambio que no afecta la preparación (el nombre en camiseta) mientras se confirma el inicio no lo invalida', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'P')
    const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
    const { pausada, liberar } = pausarUnaVez((s) => s.tipo === 'iniciar-partido')
    const envio = P.enviar(sobre).then(leerCuerpo)
    await pausada
    expect((await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: { nombreCamiseta: 'BETO' } })).cuerpo.tipo).toBe('editado')
    liberar()
    expect((await envio).cuerpo.resultado).toBe('aceptado')
    expect((await fila(e.ligaId, 'J2')).nombre_camiseta).toBe('BETO')
  })

  it('carrera simultánea: el resultado es siempre uno de los dos órdenes coherentes, nunca una mezcla', async () => {
    const resultados = { editoPrimero: 0, inicioPrimero: 0 }
    for (let i = 0; i < 6; i += 1) {
      const e = await escenarioPlantilla()
      const P = e.telefono(e.ligaId, 'P')
      const sobre = await P.sobre('iniciar-partido', {}, { t: T0 + 1000 })
      const [inicio, edicion] = await Promise.all([
        P.enviar(sobre).then(leerCuerpo),
        accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: { dorsal: 8 } }).then((r) => r.cuerpo),
      ])
      const estado = (await P.estado()).partido.estado
      const dorsal = (await fila(e.ligaId, 'J2')).dorsal
      if (edicion.tipo === 'editado') {
        resultados.editoPrimero += 1
        expect(dorsal).toBe(8)
        // la edición cambió la huella: o el inicio ya se había rechazado por ello, o aún no se confirmó
        expect(inicio.cuerpo.resultado === 'rechazado' && inicio.cuerpo.recibo.motivo === 'preparacion-desactualizada').toBe(true)
        expect(estado).toBe('programado')
      } else {
        resultados.inicioPrimero += 1
        expect(edicion.tipo).toBe('equipo-bloqueado')
        expect(dorsal).toBe(7)
        expect(inicio.cuerpo.resultado).toBe('aceptado')
        expect(estado).toBe('vivo')
      }
      expect(await contar(e.ligaId, 'auditoria_plantilla')).toBe(edicion.tipo === 'editado' ? 1 : 0)
    }
    expect(resultados.editoPrimero + resultados.inicioPrimero).toBe(6)
  })
})
