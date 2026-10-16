import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dentro, sqlDe } from './ayuda.js'
import { T0, cabecerasEscritura, comoOrganizador, conCookie, control, pedir, reiniciarAcceso } from './ayuda-acceso.js'
import { accion, alta, campos, contar, conOp, escenarioPlantilla, fila, leerLiga, leerRoster, nuevaOp } from './ayuda-plantilla.js'

beforeEach(async () => { await reiniciarAcceso() })
afterEach(() => { control.ahoraMs = null; control.pausa = null })

const MENSAJE_PENDIENTE = 'En el piloto cada jugador necesita un número del 0 al 99; no se puede dejar pendiente.'
const rutaJugadores = (ligaId, equipoId) => `/v1/organizador/ligas/${ligaId}/equipos/${equipoId}/jugadores`

describe('lecturas del organizador', () => {
  it('la liga lista sus equipos con bloqueo y conteos, y la plantilla trae los campos privados y separa inactivos', async () => {
    const e = await escenarioPlantilla()
    const liga = await leerLiga(e.cookie, e.ligaId)
    expect(liga.status).toBe(200)
    expect(liga.cuerpo.liga).toMatchObject({ id: e.ligaId, deporte: 'baloncesto' })
    expect(liga.cuerpo.equipos.find((t) => t.id === 'E1')).toEqual({ id: 'E1', nombre: 'Alfa', bloqueada: false, activos: 2, inactivos: 1 })
    expect(liga.respuesta.headers.get('cache-control')).toBe('no-store')

    const r = await leerRoster(e.cookie, e.ligaId, 'E1')
    expect(r.status).toBe(200)
    expect(r.cuerpo.bloqueada).toBe(false)
    expect(r.cuerpo.activos.map((j) => [j.id, j.dorsal])).toEqual([['J1', 0], ['J2', 7]])
    expect(r.cuerpo.inactivos.map((j) => j.id)).toEqual(['JX'])
    expect(r.cuerpo.activos[1]).toMatchObject({
      id: 'J2', ligaId: e.ligaId, equipoId: 'E1', personaId: 'persona-J2', codigo: '4321', nombrePila: 'Beto', apellido1: 'Muestra',
      nombre: 'Beto Muestra', nombreCamiseta: null, fechaNacimiento: '2015-03-12', activo: true, reclamado: false, rev: 1,
    })
    expect(r.cuerpo.activos[0].nombreCamiseta).toBe('ANA')
  })

  it('un equipo desconocido es 404; sin sesión o sin poseer la liga es el 401 genérico', async () => {
    const e = await escenarioPlantilla()
    expect((await leerRoster(e.cookie, e.ligaId, 'E9')).status).toBe(404)
    expect((await leerRoster(null, e.ligaId, 'E1')).status).toBe(401)
    expect((await leerRoster(e.cookie, 'LIGA-AJENA-1', 'E1')).status).toBe(404) // no admitida
    expect((await leerRoster(e.cookie, 'LIGA99', 'E1')).cuerpo).toEqual({ error: 'no-autorizado' }) // admitida, pero no es suya
  })
})

describe('alta', () => {
  it('crea la ficha con identificadores del servidor, rev 1, código, nombre derivado, auditoría y recibo, todo junto', async () => {
    const e = await escenarioPlantilla()
    const op = nuevaOp('alta')
    const r = await conOp(e.cookie, e.ligaId, 'E1', null, 'alta', { operacionId: op, campos: campos({ nombreCamiseta: ' Cami ', fechaNacimiento: '2014-05-01', apellido2: 'Segundo' }) })
    expect(r.status).toBe(200)
    expect(r.cuerpo).toMatchObject({ resultado: 'aplicado', tipo: 'creado', operacionId: op, reproducido: false })
    const f = r.cuerpo.ficha
    expect(f.id).toMatch(/^f-[0-9a-f-]{36}$/)
    expect(f.personaId).toMatch(/^pr-[0-9a-f-]{36}$/)
    expect(f.codigo).toMatch(/^[1-9][0-9]{3}$/)
    expect(f).toMatchObject({ nombre: 'Carla Nueva Segundo', nombreCamiseta: 'Cami', dorsal: 12, activo: true, rev: 1, reclamado: false, fechaNacimiento: '2014-05-01', ligaId: e.ligaId, equipoId: 'E1' })
    expect(await sqlDe(e.ligaId, 'SELECT tipo, rev_antes, rev_despues, operacion_id, organizador_id FROM auditoria_plantilla')).toEqual([
      { tipo: 'created', rev_antes: null, rev_despues: 1, operacion_id: op, organizador_id: e.organizadorId },
    ])
    expect(await contar(e.ligaId, 'operaciones_plantilla')).toBe(1)
  })

  it('número ocupado, campos inválidos y número ausente son rechazos DECIDIDOS: se registran y no escriben ficha', async () => {
    const e = await escenarioPlantilla()
    const antes = await contar(e.ligaId, 'jugadores')
    const ocupado = await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ dorsal: 7 }) })
    expect(ocupado.cuerpo).toMatchObject({ resultado: 'rechazado', tipo: 'conflicto-numero' })
    const invalido = await alta(e.cookie, e.ligaId, 'E1', { campos: { nombrePila: '', apellido1: 'X1', dorsal: 100, fechaNacimiento: 'no-es-fecha' } })
    expect(invalido.cuerpo.tipo).toBe('invalido')
    expect(Object.keys(invalido.cuerpo.errores).sort()).toEqual(['apellido1', 'dorsal', 'fechaNacimiento', 'nombrePila'])
    const futura = await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ fechaNacimiento: '2099-01-01' }) })
    expect(futura.cuerpo.errores.fechaNacimiento).toBe('La fecha no puede ser futura.') // con el reloj del SERVIDOR
    expect(await contar(e.ligaId, 'jugadores')).toBe(antes)
    expect(await contar(e.ligaId, 'operaciones_plantilla')).toBe(3)
    expect(await contar(e.ligaId, 'auditoria_plantilla')).toBe(0)
  })

  it('un nombre en camiseta largo se rechaza como en la plantilla local y no se inventan reglas nuevas (sin fecha, sin edad, sin tamaño)', async () => {
    const e = await escenarioPlantilla()
    expect((await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ nombreCamiseta: 'x'.repeat(21) }) })).cuerpo.errores.nombreCamiseta).toBe('Máximo 20 caracteres.')
    // sin fecha de nacimiento, sin apellido2 y sin nombre en camiseta: válido
    expect((await alta(e.cookie, e.ligaId, 'E1', { campos: campos() })).cuerpo.tipo).toBe('creado')
    // una fecha muy antigua o muy reciente (pero no futura) no se rechaza: el servidor no inventa límites de edad
    expect((await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ nombrePila: 'Abuela', dorsal: 13, fechaNacimiento: '1930-01-01' }) })).cuerpo.tipo).toBe('creado')
    expect((await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ nombrePila: 'Bebe', dorsal: 14, fechaNacimiento: '2023-11-14' }) })).cuerpo.tipo).toBe('creado')
  })
})

describe('registro sin número frente a la preparación del inicio', () => {
  it('las reglas aceptadas piden un número 0–99 al registrar y toleran false/ausente en numeroPendiente; la intención verdadera se rechaza', async () => {
    const e = await escenarioPlantilla()
    for (const dorsal of [undefined, null, '', '   ', 100, -1, 1.5, 'a']) {
      const campo = { nombrePila: 'Sin', apellido1: 'Numero', ...(dorsal === undefined ? {} : { dorsal }) }
      const r = await alta(e.cookie, e.ligaId, 'E1', { campos: campo })
      expect(r.cuerpo.tipo, String(dorsal)).toBe('invalido')
      expect(r.cuerpo.errores.dorsal).toBeTruthy()
    }
    for (const numeroPendiente of [true, 'si', 1, null, {}, ['x']]) {
      const r = await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ numeroPendiente }) })
      expect(r.status, JSON.stringify(numeroPendiente)).toBe(200) // la regla decide, no el sobre
      expect(r.cuerpo.errores.numeroPendiente, JSON.stringify(numeroPendiente)).toBe(MENSAJE_PENDIENTE)
    }
    expect((await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ numeroPendiente: false }) })).cuerpo.tipo).toBe('creado')
    expect((await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ nombrePila: 'Otra', dorsal: '13' }) })).cuerpo.ficha.dorsal).toBe(13) // "13" se lee igual que local
  })

  it('una ficha anterior sin número NO se edita ni se reactiva sin uno; el inicio sigue bloqueado hasta asignarlo, y entonces pasa', async () => {
    const e = await escenarioPlantilla()
    const P = e.telefono(e.ligaId, 'Q')
    const sinNumero = await P.mandar('iniciar-partido', {}, { t: T0 + 1000 })
    expect(sinNumero.cuerpo.resultado).toBe('rechazado')
    expect(sinNumero.cuerpo.recibo.motivo).toBe('plantilla-incompleta')
    expect(sinNumero.cuerpo.recibo.detalle.equipos).toEqual([{ equipoId: 'E4', nombre: null, sinNumero: 1, duplicados: [] }])

    const r = await leerRoster(e.cookie, e.ligaId, 'E4')
    const legado = r.cuerpo.activos.find((j) => j.id === 'L1')
    expect(legado).toMatchObject({ dorsal: null, nombrePila: null }) // el servidor no inventa partes del nombre ni números
    // editar sin número: sigue siendo "obligatorio" (y sin partes de nombre, también lo son)
    const sinNum = await accion(e.cookie, e.ligaId, 'E4', 'L1', 'editar', { revEsperada: 1, campos: { nombrePila: 'Legado', apellido1: 'Sin' } })
    expect(sinNum.cuerpo).toMatchObject({ resultado: 'rechazado', tipo: 'invalido' })
    expect(sinNum.cuerpo.errores.dorsal).toBe('El número es obligatorio.')
    const conNum = await accion(e.cookie, e.ligaId, 'E4', 'L1', 'editar', { revEsperada: 1, campos: { nombrePila: 'Legado', apellido1: 'Sin', dorsal: 15 } })
    expect(conNum.cuerpo).toMatchObject({ resultado: 'aplicado', tipo: 'editado' })

    // desactivada y reactivada sin número válido: también exige uno
    const L = (await fila(e.ligaId, 'L1'))
    await accion(e.cookie, e.ligaId, 'E4', 'L1', 'desactivar', { revEsperada: L.rev })
    await dentro(e.ligaId, (inst) => inst.almacen.sql.exec('UPDATE jugadores SET dorsal = NULL WHERE id = ?', 'L1').toArray())
    const rev = (await fila(e.ligaId, 'L1')).rev
    const sinR = await accion(e.cookie, e.ligaId, 'E4', 'L1', 'reactivar', { revEsperada: rev })
    expect(sinR.cuerpo).toMatchObject({ tipo: 'invalido', errores: { dorsal: 'El número es obligatorio.' } })
    expect((await accion(e.cookie, e.ligaId, 'E4', 'L1', 'reactivar', { revEsperada: rev, numeroPendiente: true })).cuerpo.errores.numeroPendiente).toBe(MENSAJE_PENDIENTE)
    expect((await accion(e.cookie, e.ligaId, 'E4', 'L1', 'reactivar', { revEsperada: rev, nuevoDorsal: 15 })).cuerpo.tipo).toBe('reactivado')

    // con la plantilla completa el inicio pasa (el teléfono toma la huella vigente)
    const inicio = await P.mandar('iniciar-partido', {}, { t: T0 + 2000 })
    expect(inicio.cuerpo.resultado).toBe('aceptado')
  })
})

describe('edición con revisión esperada', () => {
  it('aplica los cambios, sube rev, conserva personaId y audita los campos; una revisión vieja es un rechazo decidido', async () => {
    const e = await escenarioPlantilla()
    const antes = await fila(e.ligaId, 'J2')
    const r = await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: { nombreCamiseta: 'BETO', dorsal: 8, fechaNacimiento: null } })
    expect(r.cuerpo).toMatchObject({ resultado: 'aplicado', tipo: 'editado' })
    expect(r.cuerpo.ficha).toMatchObject({ rev: 2, dorsal: 8, nombreCamiseta: 'BETO', fechaNacimiento: null, personaId: antes.persona_id, nombre: 'Beto Muestra', codigo: '4321' })
    const aud = (await sqlDe(e.ligaId, 'SELECT * FROM auditoria_plantilla'))[0]
    expect(aud).toMatchObject({ tipo: 'edited', rev_antes: 1, rev_despues: 2 })
    expect(JSON.parse(aud.detalle_json)).toEqual({ campos: ['nombreCamiseta', 'fechaNacimiento', 'dorsal'], dorsalAntes: 7, dorsalDespues: 8 })
    expect(aud.detalle_json).not.toContain('2015') // la auditoría no copia la fecha de nacimiento

    const vieja = await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 1, campos: { dorsal: 9 } })
    expect(vieja.cuerpo).toMatchObject({ resultado: 'rechazado', tipo: 'ficha-desactualizada' })
    expect(vieja.cuerpo.ficha.rev).toBe(2) // devuelve la ficha vigente
    expect((await fila(e.ligaId, 'J2')).dorsal).toBe(8)
    expect((await accion(e.cookie, e.ligaId, 'E1', 'J2', 'editar', { revEsperada: 2, campos: { dorsal: 9 } })).cuerpo.ficha.rev).toBe(3)
  })

  it('omitido se conserva; vacío borra el nombre en camiseta; un número ocupado se rechaza; un nombre que coincide pide confirmación', async () => {
    const e = await escenarioPlantilla()
    const conserva = await accion(e.cookie, e.ligaId, 'E1', 'J1', 'editar', { revEsperada: 1, campos: { fechaNacimiento: '2013-02-02' } })
    expect(conserva.cuerpo.ficha).toMatchObject({ nombreCamiseta: 'ANA', dorsal: 0, fechaNacimiento: '2013-02-02' })
    const borra = await accion(e.cookie, e.ligaId, 'E1', 'J1', 'editar', { revEsperada: 2, campos: { nombreCamiseta: '' } })
    expect(borra.cuerpo.ficha.nombreCamiseta).toBe('')
    expect((await accion(e.cookie, e.ligaId, 'E1', 'J1', 'editar', { revEsperada: 3, campos: { dorsal: 7 } })).cuerpo.tipo).toBe('conflicto-numero')
    // J1 pasa a llamarse como J2: candidato en la misma liga → pide confirmación y NO escribe
    const igual = await accion(e.cookie, e.ligaId, 'E1', 'J1', 'editar', { revEsperada: 3, campos: { nombrePila: 'beto', apellido1: 'MUESTRA' } })
    expect(igual.cuerpo.tipo).toBe('candidatos')
    expect(igual.cuerpo.candidatos).toHaveLength(1)
    expect(igual.cuerpo.candidatos[0]).toMatchObject({ fichaId: 'J2', personaId: 'persona-J2', equipoNombre: 'Alfa', edad: 8, ligaId: e.ligaId })
    expect(JSON.stringify(igual.cuerpo)).not.toContain('2015') // nunca la fecha exacta
    expect((await fila(e.ligaId, 'J1')).nombre_pila).toBe('Ana')
    const confirmada = await accion(e.cookie, e.ligaId, 'E1', 'J1', 'editar', { revEsperada: 3, confirmaCandidatos: true, campos: { nombrePila: 'beto', apellido1: 'MUESTRA' } })
    expect(confirmada.cuerpo.tipo).toBe('editado')
    expect((await fila(e.ligaId, 'J1')).persona_id).toBe('persona-J1') // la edición nunca cambia la persona
  })
})

describe('desactivar y reactivar', () => {
  it('desactivar conserva la ficha y libera el número; reactivar recupera el anterior o exige uno cuando está ocupado', async () => {
    const e = await escenarioPlantilla()
    const d = await accion(e.cookie, e.ligaId, 'E1', 'J2', 'desactivar', { revEsperada: 1 })
    expect(d.cuerpo).toMatchObject({ resultado: 'aplicado', tipo: 'desactivado' })
    expect(d.cuerpo.ficha).toMatchObject({ activo: false, rev: 2, dorsal: 7, desactivadoEn: new Date(T0).toISOString() })
    expect((await fila(e.ligaId, 'J2')).nombre_pila).toBe('Beto') // la ficha se conserva
    expect((await accion(e.cookie, e.ligaId, 'E1', 'J2', 'desactivar', { revEsperada: 2 })).cuerpo.tipo).toBe('ya-inactiva')
    // el número 7 quedó libre
    expect((await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ dorsal: 7 }) })).cuerpo.tipo).toBe('creado')
    // reactivar sin número: el 7 ya está tomado → conflicto; con otro número, reactiva
    expect((await accion(e.cookie, e.ligaId, 'E1', 'J2', 'reactivar', { revEsperada: 2 })).cuerpo.tipo).toBe('conflicto-numero')
    const r = await accion(e.cookie, e.ligaId, 'E1', 'J2', 'reactivar', { revEsperada: 2, nuevoDorsal: 20 })
    expect(r.cuerpo).toMatchObject({ resultado: 'aplicado', tipo: 'reactivado', ficha: { activo: true, dorsal: 20, rev: 3 } })
    expect((await accion(e.cookie, e.ligaId, 'E1', 'J2', 'reactivar', { revEsperada: 3 })).cuerpo.tipo).toBe('ya-activa')
    // recupera el anterior cuando está libre
    expect((await accion(e.cookie, e.ligaId, 'E1', 'JX', 'reactivar', { revEsperada: 1 })).cuerpo.ficha.dorsal).toBe(9)
  })

  it('revisión vieja: ni desactivar ni reactivar escriben', async () => {
    const e = await escenarioPlantilla()
    await accion(e.cookie, e.ligaId, 'E1', 'J2', 'desactivar', { revEsperada: 1 })
    const antes = await contar(e.ligaId, 'auditoria_plantilla')
    expect((await accion(e.cookie, e.ligaId, 'E1', 'J2', 'reactivar', { revEsperada: 1 })).cuerpo.tipo).toBe('ficha-desactualizada')
    expect((await accion(e.cookie, e.ligaId, 'E1', 'JX', 'desactivar', { revEsperada: 5 })).cuerpo.tipo).toBe('ficha-desactualizada')
    expect(await contar(e.ligaId, 'auditoria_plantilla')).toBe(antes)
    expect((await fila(e.ligaId, 'J2')).activo).toBe(0)
  })

  it('una ficha de OTRO equipo en la dirección es 404 y no se registra nada', async () => {
    const e = await escenarioPlantilla()
    const antes = await contar(e.ligaId, 'operaciones_plantilla')
    expect((await accion(e.cookie, e.ligaId, 'E2', 'J1', 'desactivar', { revEsperada: 1 })).status).toBe(404)
    expect((await accion(e.cookie, e.ligaId, 'E1', 'NO-EXISTE', 'editar', { revEsperada: 1, campos: {} })).status).toBe(404)
    expect((await alta(e.cookie, e.ligaId, 'E9', { campos: campos() })).status).toBe(404)
    expect(await contar(e.ligaId, 'operaciones_plantilla')).toBe(antes)
  })
})

describe('validación por tipo de campo del sobre', () => {
  const rechazada = async (e, ruta, cuerpo) => {
    const antes = await contar(e.ligaId, 'operaciones_plantilla')
    const r = await comoOrganizador(e.cookie, 'POST', ruta, cuerpo)
    expect(r.status, JSON.stringify(cuerpo)).toBe(422)
    expect(r.cuerpo).toEqual({ error: 'solicitud-invalida' })
    expect(await contar(e.ligaId, 'operaciones_plantilla')).toBe(antes) // un sobre mal formado no se registra
  }

  it('operacionId: solo el alfabeto y el largo permitidos', async () => {
    const e = await escenarioPlantilla()
    const ruta = rutaJugadores(e.ligaId, 'E1')
    for (const operacionId of [undefined, null, 5, '', 'corto', 'x'.repeat(65), 'con espacios 1234567890', 'ñandú-1234567890123', ['abcdefghijklmnop']]) {
      await rechazada(e, ruta, { ...(operacionId === undefined ? {} : { operacionId }), campos: campos() })
    }
  })

  it('revEsperada: solo un entero JSON ≥ 1; nunca un texto, un decimal, un objeto ni un booleano', async () => {
    const e = await escenarioPlantilla()
    const ruta = `${rutaJugadores(e.ligaId, 'E1')}/J1/desactivar`
    for (const revEsperada of [undefined, '1', 1.5, 0, -1, true, null, [1], { rev: 1 }, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
      await rechazada(e, ruta, { operacionId: nuevaOp(), ...(revEsperada === undefined ? {} : { revEsperada }) })
    }
    await rechazada(e, rutaJugadores(e.ligaId, 'E1'), { operacionId: nuevaOp(), revEsperada: 1, campos: campos() }) // el alta no lleva revisión
  })

  it('campos: un objeto simple; los de texto son texto o null (nunca número, objeto ni arreglo); claves desconocidas, no', async () => {
    const e = await escenarioPlantilla()
    const ruta = rutaJugadores(e.ligaId, 'E1')
    for (const c of [null, [], 'x', 5, campos({ nombrePila: 5 }), campos({ nombrePila: { a: 1 } }), campos({ apellido1: ['Ana'] }), campos({ nombreCamiseta: false }),
      campos({ fechaNacimiento: 20150101 }), campos({ nombrePila: 'x'.repeat(201) }), campos({ dorsal: [[[[1]]]] }), campos({ extra: 1 })]) {
      await rechazada(e, ruta, { operacionId: nuevaOp(), campos: c })
    }
    await rechazada(e, ruta, { operacionId: nuevaOp() }) // campos es obligatorio
  })

  it('el número y la intención heredada llegan a la REGLA aceptada (no se filtran por tipo): la regla los rechaza con su mensaje', async () => {
    const e = await escenarioPlantilla()
    for (const dorsal of [{}, [7], true, 'abc']) {
      const r = await alta(e.cookie, e.ligaId, 'E1', { campos: campos({ dorsal }) })
      expect(r.status, JSON.stringify(dorsal)).toBe(200)
      expect(r.cuerpo.errores.dorsal, JSON.stringify(dorsal)).toBe('El número debe ser un entero entre 0 y 99.')
    }
  })

  it('resolucionIdentidad: solo las tres formas, con sus claves e identificadores válidos', async () => {
    const e = await escenarioPlantilla()
    const ruta = rutaJugadores(e.ligaId, 'E1')
    for (const resolucionIdentidad of ['otra-persona', {}, { tipo: 'otra' }, { tipo: 'otra-persona', personaId: 'x' }, { tipo: 'misma-persona' },
      { tipo: 'misma-persona', personaId: 'con espacio' }, { tipo: 'misma-persona-otra-liga', ligaOrigenId: 'A', fichaOrigenId: 'B' },
      { tipo: 'misma-persona-otra-liga', ligaOrigenId: 'A', fichaOrigenId: 'B', personaId: 'C', extra: 1 }, null]) {
      await rechazada(e, ruta, { operacionId: nuevaOp(), campos: campos(), resolucionIdentidad })
    }
  })

  it('no existen campos de cola, borrador u hora del cliente: cualquier clave no listada se rechaza (incluidas las que intentan fijar identidad o rev)', async () => {
    const e = await escenarioPlantilla()
    const ruta = rutaJugadores(e.ligaId, 'E1')
    for (const extra of ['encoladoEn', 'clientTs', 'offline', 'borrador', 'ts', 'enCola', 'guardadoLocal', 'vinculo', 'verificacion', 'personaId', 'activo', 'rev', 'codigo', 'nombre', 'ligaId', 'equipoId']) {
      await rechazada(e, ruta, { operacionId: nuevaOp(), campos: campos(), [extra]: 1 })
      await rechazada(e, ruta, { operacionId: nuevaOp(), campos: campos({ [extra]: 'x' }) })
    }
    // y la clave __proto__ (que JSON.parse crea como propia) tampoco pasa
    await rechazada(e, ruta, `{"operacionId":"${nuevaOp()}","campos":{"nombrePila":"A","apellido1":"B","dorsal":3},"__proto__":{"x":1}}`)
  })

  it('cuerpo: más de 8 KiB es 413, un JSON roto es 400, sin cabeceras de escritura es 403; ninguno toca la base', async () => {
    const e = await escenarioPlantilla()
    const ruta = rutaJugadores(e.ligaId, 'E1')
    const antes = await contar(e.ligaId, 'operaciones_plantilla')
    expect((await comoOrganizador(e.cookie, 'POST', ruta, JSON.stringify({ operacionId: nuevaOp(), campos: campos({ nombrePila: 'a'.repeat(9000) }) }))).status).toBe(413)
    expect((await comoOrganizador(e.cookie, 'POST', ruta, '{no es json')).status).toBe(400)
    const base = { operacionId: nuevaOp(), campos: campos() }
    expect((await pedir('POST', ruta, { cuerpo: base, cabeceras: conCookie(e.cookie, { 'content-type': 'application/json' }) })).status).toBe(403) // sin Origin ni cabecera propia
    expect((await pedir('POST', ruta, { cuerpo: base, cabeceras: conCookie(e.cookie, cabecerasEscritura({ origin: 'https://otro.example' })) })).status).toBe(403)
    expect((await pedir('POST', ruta, { cuerpo: base, cabeceras: { ...cabecerasEscritura() } })).status).toBe(401) // sin cookie
    expect(await contar(e.ligaId, 'operaciones_plantilla')).toBe(antes)
  })
})

describe('sin borrado físico', () => {
  it('no hay ruta ni método para borrar; y ninguna operación borra una fila (un disparador de prueba lo haría fallar)', async () => {
    const e = await escenarioPlantilla()
    for (const ruta of [rutaJugadores(e.ligaId, 'E1'), `${rutaJugadores(e.ligaId, 'E1')}/J1`, `${rutaJugadores(e.ligaId, 'E1')}/J1/borrar`, `${rutaJugadores(e.ligaId, 'E1')}/J1/eliminar`]) {
      const r = await comoOrganizador(e.cookie, 'DELETE', ruta, { operacionId: nuevaOp() })
      expect([404, 405], ruta).toContain(r.status)
    }
    expect((await comoOrganizador(e.cookie, 'POST', `${rutaJugadores(e.ligaId, 'E1')}/J1/borrar`, { operacionId: nuevaOp() })).status).toBe(404)
    await dentro(e.ligaId, (inst) => inst.almacen.sql.exec("CREATE TRIGGER prueba_sin_borrado BEFORE DELETE ON jugadores BEGIN SELECT RAISE(ABORT, 'borrado'); END").toArray())
    const antes = await contar(e.ligaId, 'jugadores')
    const creada = await alta(e.cookie, e.ligaId, 'E1', { campos: campos() })
    expect(creada.cuerpo.tipo).toBe('creado')
    await accion(e.cookie, e.ligaId, 'E1', creada.cuerpo.ficha.id, 'desactivar', { revEsperada: 1 })
    await accion(e.cookie, e.ligaId, 'E1', creada.cuerpo.ficha.id, 'reactivar', { revEsperada: 2 })
    await accion(e.cookie, e.ligaId, 'E1', 'J1', 'editar', { revEsperada: 1, campos: { dorsal: 30 } })
    expect(await contar(e.ligaId, 'jugadores')).toBe(antes + 1)
  })
})
