/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AppCompartida from '../AppCompartida'
import { __reiniciar } from '../lib/sesion-servidor'
import { PREFIJO, clave } from '../lib/operacion-pendiente'
import { aplicado, conConexion, escenario, ficha, instalarCandados, json, rechazado, sinConexion, YO } from '../prueba/compartido'

const FRASE = 'Se requiere conexión a internet para esta acción.'
let srv
let candados
let usuario
let consola

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  __reiniciar()
  candados = instalarCandados()
  conConexion()
  srv = escenario()
  vi.stubGlobal('fetch', srv.fetch)
  usuario = userEvent.setup()
  consola = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
})
afterEach(() => { cleanup(); candados.quitar(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const abrir = (ruta = '/anthony/ligas/LIGA-U10/equipos/E1') => render(<MemoryRouter initialEntries={[ruta]}><AppCompartida /></MemoryRouter>)
const abrirPlantilla = async () => { abrir(); await screen.findByText('Beto Muestra'); await screen.findByRole('heading', { name: 'Alfa' }) }
const fila = (nombre) => within(screen.getByText(nombre).closest('li'))
const hoja = () => within(screen.getByRole('dialog'))
const escribir = async (etiqueta, texto, ambito = screen) => { const c = ambito.getByLabelText(etiqueta); await usuario.clear(c); await usuario.type(c, texto) }
const llaves = () => Object.keys(localStorage).filter((k) => k.startsWith(PREFIJO))
const rellenarAlta = async (nombre = 'Carla', apellido = 'Nueva', numero = '12') => {
  await usuario.click(screen.getByRole('button', { name: 'Añadir jugador' }))
  await escribir('Nombre *', nombre, hoja())
  await escribir('Primer apellido *', apellido, hoja())
  await escribir('Número *', numero, hoja())
}
const enviarAlta = () => usuario.click(hoja().getByRole('button', { name: 'Añadir jugador' }))
const op = (req) => req.json.operacionId

describe('navegación autorizada: ligas → equipos → plantilla (solo lecturas del servidor)', () => {
  it('muestra las ligas con su nombre, los equipos con sus conteos y la plantilla separando activos e inactivos', async () => {
    abrir('/anthony/ligas')
    const enlace = await screen.findByRole('link', { name: 'Liga Sub-10' })
    expect(screen.getByRole('link', { name: 'Liga Sub-12' })).toBeTruthy()
    await usuario.click(enlace)
    expect(await screen.findByRole('heading', { name: 'Liga Sub-10' })).toBeTruthy()
    expect(screen.getByText('2 activos · 2 inactivos')).toBeTruthy()
    await usuario.click(screen.getByRole('link', { name: 'Alfa' }))
    await screen.findByText('Beto Muestra')
    expect(within(screen.getByRole('list', { name: 'Plantilla activa' })).getAllByRole('listitem')).toHaveLength(2)
    expect(within(screen.getByRole('list', { name: 'Jugadores inactivos' })).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('En camiseta: ANA', { exact: false })).toBeTruthy()
    expect(srv.peticiones.every((p) => p.metodo === 'GET')).toBe(true)
    expect(srv.posts).toHaveLength(0)
    expect(llaves()).toEqual([])
  })

  it('una liga que el organizador no posee no se abre', async () => {
    abrir('/anthony/ligas/LIGA-AJENA/equipos/E1')
    expect((await screen.findByRole('alert')).textContent).toContain('No tienes acceso a esa liga.')
    expect(srv.peticiones.some((p) => p.url.includes('LIGA-AJENA'))).toBe(false)
  })

  it('sin sesión lleva a la entrada y no pide datos de plantillas', async () => {
    srv.estado.sesion = false
    abrir()
    await screen.findByLabelText('Código de acceso')
    expect(srv.peticiones.filter((p) => p.url.includes('/jugadores'))).toHaveLength(0)
  })

  it('una liga que no se puede leer se muestra por su identificador con aviso, sin inventar nombre', async () => {
    delete srv.estado.ligas['LIGA-U12']
    abrir('/anthony/ligas')
    await screen.findByRole('link', { name: 'Liga Sub-10' })
    expect(screen.getByRole('link', { name: 'LIGA-U12' })).toBeTruthy()
    expect(screen.getByText(/No pudimos cargar esta liga/)).toBeTruthy()
  })
})

describe('las cuatro operaciones', () => {
  it('añadir: solicitud exacta, resultado visible y plantilla releída del servidor', async () => {
    await abrirPlantilla()
    srv.cola.push((req) => aplicado('creado', op(req), ficha('N1', 'E1', 'Carla', 'Nueva', 12)))
    await rellenarAlta()
    const lecturas = srv.peticiones.length
    await enviarAlta()
    await screen.findByText('Jugador añadido.')
    expect(srv.posts).toHaveLength(1)
    expect(srv.posts[0].url).toBe('/v1/organizador/ligas/LIGA-U10/equipos/E1/jugadores')
    expect(srv.posts[0].json).toEqual({ operacionId: expect.stringMatching(/^op-/), campos: { nombrePila: 'Carla', apellido1: 'Nueva', dorsal: '12' } })
    expect(srv.peticiones.length).toBeGreaterThan(lecturas) // volvió a leer
    expect(llaves()).toEqual([]) // resultado decidido: sin registro pendiente
  })

  it('añadir con todos los campos opcionales: segundo apellido, nombre en camiseta y fecha de nacimiento', async () => {
    await abrirPlantilla()
    srv.cola.push((req) => aplicado('creado', op(req), ficha('N1', 'E1', 'Carla', 'Nueva', 12)))
    await rellenarAlta()
    await escribir('Segundo apellido', 'Segunda', hoja())
    await escribir('Nombre en camiseta', 'CARLA', hoja())
    await escribir('Fecha de nacimiento', '2014-05-01', hoja())
    await enviarAlta()
    await screen.findByText('Jugador añadido.')
    expect(srv.posts[0].json.campos).toEqual({ nombrePila: 'Carla', apellido1: 'Nueva', dorsal: '12', apellido2: 'Segunda', nombreCamiseta: 'CARLA', fechaNacimiento: '2014-05-01' })
  })

  it('editar: solo viaja lo que cambió, con la revisión que se vio', async () => {
    await abrirPlantilla()
    srv.cola.push((req) => aplicado('editado', op(req), ficha('J2', 'E1', 'Beto', 'Muestra', 9, { rev: 4 })))
    await usuario.click(fila('Beto Muestra').getByRole('button', { name: 'Editar' }))
    await escribir('Número *', '9', hoja())
    await usuario.click(hoja().getByRole('button', { name: 'Guardar cambios' }))
    await screen.findByText('Jugador actualizado.')
    expect(srv.posts[0].url).toBe('/v1/organizador/ligas/LIGA-U10/equipos/E1/jugadores/J2/editar')
    expect(srv.posts[0].json).toEqual({ operacionId: expect.any(String), revEsperada: 3, campos: { dorsal: '9' } })
  })

  it('editar sin cambios no envía nada', async () => {
    await abrirPlantilla()
    await usuario.click(fila('Beto Muestra').getByRole('button', { name: 'Editar' }))
    await usuario.click(hoja().getByRole('button', { name: 'Guardar cambios' }))
    expect((await screen.findByRole('alert')).textContent).toContain('No hay cambios que guardar.')
    expect(srv.posts).toHaveLength(0)
  })

  it('desactivar: confirma, explica que no se elimina y envía la revisión', async () => {
    await abrirPlantilla()
    srv.cola.push((req) => aplicado('desactivado', op(req), ficha('J2', 'E1', 'Beto', 'Muestra', 7, { activo: false })))
    await usuario.click(fila('Beto Muestra').getByRole('button', { name: 'Desactivar' }))
    expect(hoja().getByText(/No se elimina a nadie/)).toBeTruthy()
    await usuario.click(hoja().getByRole('button', { name: 'Desactivar' }))
    await screen.findByText('Jugador desactivado.')
    expect(srv.posts[0].json).toEqual({ operacionId: expect.any(String), revEsperada: 3 })
    expect(srv.posts[0].url.endsWith('/J2/desactivar')).toBe(true)
  })

  it('reactivar: recupera el número anterior sin enviarlo; un registro anterior sin número exige uno', async () => {
    await abrirPlantilla()
    srv.cola.push((req) => aplicado('reactivado', op(req), ficha('JX', 'E1', 'Dario', 'Inactivo', 9)))
    await usuario.click(fila('Dario Inactivo').getByRole('button', { name: 'Reactivar' }))
    await usuario.click(hoja().getByRole('button', { name: 'Reactivar' }))
    await screen.findByText('Jugador reactivado.')
    expect(srv.posts[0].json).toEqual({ operacionId: expect.any(String), revEsperada: 1 })

    await usuario.click(fila('Legado Sin Numero').getByRole('button', { name: 'Reactivar' }))
    await usuario.click(hoja().getByRole('button', { name: 'Reactivar' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Este registro no tiene número')
    expect(srv.posts).toHaveLength(1) // no se envió
    srv.cola.push((req) => aplicado('reactivado', op(req), ficha('L1', 'E1', 'Legado', 'Sin', 15)))
    await escribir('Número *', '15', hoja())
    await usuario.click(hoja().getByRole('button', { name: 'Reactivar' }))
    await waitFor(() => expect(srv.posts).toHaveLength(2))
    expect(srv.posts[1].json).toEqual({ operacionId: expect.any(String), revEsperada: 1, nuevoDorsal: '15' })
  })

  it('un registro anterior: se explica, no se adivinan partes del nombre y no se guarda sin número válido', async () => {
    await abrirPlantilla()
    expect(fila('Legado Sin Numero').getByText(/Sin número: es un registro anterior/)).toBeTruthy()
    await usuario.click(fila('Legado Sin Numero').getByRole('button', { name: 'Editar' }))
    expect(hoja().getByText(/Nombre registrado: «Legado Sin Numero»/)).toBeTruthy()
    expect(hoja().getByLabelText('Nombre *').value).toBe('') // nunca se parte el nombre por nosotros
    expect(hoja().getByLabelText('Primer apellido *').value).toBe('')
    expect(hoja().getByLabelText('Número *').value).toBe('')
    await usuario.click(hoja().getByRole('button', { name: 'Guardar cambios' }))
    expect(hoja().getAllByText('El número es obligatorio.').length).toBeGreaterThan(0)
    expect(srv.posts).toHaveLength(0)
  })

  it('no existe ningún control para eliminar a un jugador', async () => {
    await abrirPlantilla()
    expect(screen.queryByRole('button', { name: /eliminar|borrar/i })).toBeNull()
  })

  it('el personaId, el código y la fecha exacta no se muestran ni se pueden editar', async () => {
    await abrirPlantilla()
    expect(document.body.textContent).not.toMatch(/persona-J|1234|2015-03-12/)
    await usuario.click(fila('Beto Muestra').getByRole('button', { name: 'Editar' }))
    expect(hoja().getByLabelText('Fecha de nacimiento').value).toBe('2015-03-12') // la ve el propio organizador en el formulario
    expect(hoja().queryByLabelText(/persona|código/i)).toBeNull()
  })
})

describe('identidad: candidatos, unión verificada y buscador por otra ortografía', () => {
  const candidatoOtraLiga = { ligaId: 'LIGA-U12', fichaId: 'K9', personaId: 'persona-K9', equipoId: 'E3', equipoNombre: 'Gama', nombreCompleto: 'Beto Muestra', dorsal: 4, activo: true, edad: 8 }

  it('muestra al candidato con contexto deportivo, exige confirmar y envía la unión como una operación NUEVA', async () => {
    await abrirPlantilla()
    srv.cola.push((req) => rechazado('candidatos', op(req), { candidatos: [candidatoOtraLiga] }))
    await rellenarAlta('Beto', 'Muestra', '21')
    await enviarAlta()
    await screen.findByText('¿Es alguien que ya está registrado?')
    const tarjeta = hoja().getByText('Beto Muestra').closest('.card')
    expect(within(tarjeta).getByText(/Otra liga: Liga Sub-12 · Gama · #4 · 8 años · Activo/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/2015|persona-K9/) // ni fecha ni identificador interno
    expect(srv.posts).toHaveLength(1)
    await usuario.click(within(tarjeta).getByRole('button', { name: 'Es la misma persona' }))
    expect(hoja().getByText(/no existe una operación para deshacer ni separar esta unión/)).toBeTruthy()
    expect(srv.posts).toHaveLength(1) // todavía nada
    srv.cola.push((req) => aplicado('creado', op(req), ficha('N2', 'E1', 'Beto', 'Muestra', 21, { personaId: 'persona-K9' })))
    await usuario.click(hoja().getByRole('button', { name: /Sí, es la misma persona y entiendo que no se puede deshacer/ }))
    await screen.findByText('Jugador añadido.')
    expect(srv.posts[1].json.resolucionIdentidad).toEqual({ tipo: 'misma-persona-otra-liga', ligaOrigenId: 'LIGA-U12', fichaOrigenId: 'K9', personaId: 'persona-K9' })
    expect(srv.posts[1].json.operacionId).not.toBe(srv.posts[0].json.operacionId)
    expect(srv.posts[1].json.campos).toEqual(srv.posts[0].json.campos)
  })

  it('un candidato de la propia liga se une con misma-persona', async () => {
    await abrirPlantilla()
    srv.cola.push((req) => rechazado('candidatos', op(req), { candidatos: [{ ...candidatoOtraLiga, ligaId: 'LIGA-U10', fichaId: 'J2', personaId: 'persona-J2', equipoId: 'E1', equipoNombre: 'Alfa' }] }))
    await rellenarAlta('Beto', 'Muestra', '21')
    await enviarAlta()
    await screen.findByText('¿Es alguien que ya está registrado?')
    await usuario.click(hoja().getByRole('button', { name: 'Es la misma persona' }))
    srv.cola.push((req) => aplicado('creado', op(req), ficha('N2', 'E1', 'Beto', 'Muestra', 21)))
    await usuario.click(hoja().getByRole('button', { name: /Sí, es la misma persona/ }))
    await waitFor(() => expect(srv.posts).toHaveLength(2))
    expect(srv.posts[1].json.resolucionIdentidad).toEqual({ tipo: 'misma-persona', personaId: 'persona-J2' })
  })

  it('«es otra persona» también se confirma y envía otra-persona; nunca se une ni se crea sola', async () => {
    await abrirPlantilla()
    srv.cola.push((req) => rechazado('candidatos', op(req), { candidatos: [candidatoOtraLiga] }))
    await rellenarAlta('Beto', 'Muestra', '21')
    await enviarAlta()
    await screen.findByText('¿Es alguien que ya está registrado?')
    await usuario.click(hoja().getByRole('button', { name: 'Es otra persona distinta' }))
    expect(srv.posts).toHaveLength(1)
    expect(hoja().getByText(/no se podrá unir con las otras fichas/i)).toBeTruthy()
    srv.cola.push((req) => aplicado('creado', op(req), ficha('N2', 'E1', 'Beto', 'Muestra', 21)))
    await usuario.click(hoja().getByRole('button', { name: 'Sí, es otra persona' }))
    await waitFor(() => expect(srv.posts).toHaveLength(2))
    expect(srv.posts[1].json.resolucionIdentidad).toEqual({ tipo: 'otra-persona' })
  })

  it('«corregir datos» vuelve al formulario sin enviar nada más', async () => {
    await abrirPlantilla()
    srv.cola.push((req) => rechazado('candidatos', op(req), { candidatos: [candidatoOtraLiga] }))
    await rellenarAlta('Beto', 'Muestra', '21')
    await enviarAlta()
    await usuario.click(await screen.findByRole('button', { name: 'Corregir datos' }))
    expect(hoja().getByLabelText('Nombre *').value).toBe('Beto')
    expect(srv.posts).toHaveLength(1)
  })

  it('buscador: con otra ortografía se elige a un jugador de otra liga propia con las lecturas existentes y se confirma antes de unir', async () => {
    await abrirPlantilla()
    await rellenarAlta('Evita', 'Doce', '8')
    await usuario.click(hoja().getByRole('button', { name: /Ya está registrado en otra liga/ }))
    await usuario.click(await screen.findByRole('button', { name: 'Liga Sub-12' }))
    await usuario.click(await screen.findByRole('button', { name: 'Gama' }))
    const tarjeta = (await screen.findByText('Eva Doce')).closest('.card')
    expect(within(tarjeta).getByText(/Gama · #5 · \d+ años · Activo/)).toBeTruthy() // edad calculada, nunca la fecha
    expect(document.body.textContent).not.toContain('2014-06-01')
    await usuario.click(within(tarjeta).getByRole('button', { name: 'Elegir a este jugador' }))
    expect(hoja().getByText(/no existe una operación para deshacer/)).toBeTruthy()
    expect(srv.posts).toHaveLength(0)
    srv.cola.push((req) => aplicado('creado', op(req), ficha('N3', 'E1', 'Evita', 'Doce', 8)))
    await usuario.click(hoja().getByRole('button', { name: /Sí, es la misma persona/ }))
    await waitFor(() => expect(srv.posts).toHaveLength(1))
    expect(srv.posts[0].json.resolucionIdentidad).toEqual({ tipo: 'misma-persona-otra-liga', ligaOrigenId: 'LIGA-U12', fichaOrigenId: 'K1', personaId: 'persona-K1' })
    expect(srv.posts[0].json.campos.nombrePila).toBe('Evita') // el nombre escrito no se sustituye por el de la ficha elegida
  })

  it('si no se pudo verificar la otra liga no se creó nada y se puede reintentar', async () => {
    await abrirPlantilla()
    srv.cola.push(json(503, { error: 'identidad-no-verificable', reintento: 'misma-solicitud' }))
    await rellenarAlta()
    await enviarAlta()
    expect((await screen.findByRole('alert')).textContent).toContain('No pudimos leer la otra liga para verificar la identidad, así que no se creó nada.')
    expect(llaves()).toEqual([]) // primer intento sin escritura: queda resuelto como «no aplicado»
  })
})

describe('sin conexión: no se envía nada', () => {
  it('muestra exactamente la frase aprobada, no manda ninguna petición y no guarda ningún registro', async () => {
    await abrirPlantilla()
    await rellenarAlta()
    sinConexion()
    const antes = srv.peticiones.length
    await enviarAlta()
    expect((await screen.findByRole('alert')).textContent).toBe(FRASE)
    expect(srv.peticiones.length).toBe(antes)
    expect(srv.posts).toHaveLength(0)
    expect(llaves()).toEqual([])
  })
})

describe('resultado incierto: recuperación exacta', () => {
  it('tras perder la respuesta: aviso, registro guardado, nada más se puede enviar; repetir manda el MISMO cuerpo y no duplica', async () => {
    await abrirPlantilla()
    srv.cola.push(new TypeError('Failed to fetch'))
    await rellenarAlta()
    await enviarAlta()
    const banner = await screen.findByRole('group', { name: /Acción sin confirmar/ })
    expect(within(banner).getByText(/No sabemos si el servidor aplicó esta acción/)).toBeTruthy()
    expect(llaves()).toEqual([clave('org-1', 'LIGA-U10')])
    for (const nombre of ['Añadir jugador']) expect(screen.getByRole('button', { name: nombre }).disabled).toBe(true)
    expect(fila('Beto Muestra').getByRole('button', { name: 'Editar' }).disabled).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(srv.posts).toHaveLength(1)

    srv.cola.push((req) => aplicado('creado', op(req), ficha('N1', 'E1', 'Carla', 'Nueva', 12), true))
    await usuario.click(within(banner).getByRole('button', { name: 'Repetir la misma solicitud' }))
    await waitFor(() => expect(srv.posts).toHaveLength(2))
    expect(srv.posts[1].cuerpo).toBe(srv.posts[0].cuerpo) // byte a byte
    expect(srv.posts[1].json.operacionId).toBe(srv.posts[0].json.operacionId)
    await waitFor(() => expect(screen.getByRole('status', { name: '' }) || true).toBeTruthy())
    await screen.findByText(/Jugador añadido\. Esta acción ya se había procesado antes\./)
    await waitFor(() => expect(llaves()).toEqual([]))
    expect(screen.getByRole('button', { name: 'Añadir jugador' }).disabled).toBe(false)
  })

  it('sobrevive a una recarga: el aviso vuelve, se puede consultar la plantilla y repetir exactamente; nada se reenvía solo', async () => {
    await abrirPlantilla()
    srv.cola.push(new TypeError('Failed to fetch'))
    await rellenarAlta()
    await enviarAlta()
    await screen.findByRole('group', { name: /Acción sin confirmar/ })
    const primero = srv.posts[0].cuerpo
    cleanup() // «recargar»: se pierde todo el estado en memoria
    __reiniciar()
    srv.fetch.mockClear()
    abrir()
    await screen.findByRole('group', { name: /Acción sin confirmar/ })
    await screen.findByText('Beto Muestra') // consulta de solo lectura
    expect(srv.posts).toHaveLength(1) // no hubo ningún envío automático
    srv.cola.push((req) => aplicado('creado', op(req), ficha('N1', 'E1', 'Carla', 'Nueva', 12), true))
    await usuario.click(screen.getByRole('button', { name: 'Repetir la misma solicitud' }))
    await waitFor(() => expect(srv.posts).toHaveLength(2))
    expect(srv.posts[1].cuerpo).toBe(primero)
  })

  it('un fallo definitivo posterior (404) no resuelve el intento incierto anterior: el aviso permanece', async () => {
    await abrirPlantilla()
    srv.cola.push(new TypeError('Failed to fetch'))
    await rellenarAlta()
    await enviarAlta()
    const banner = await screen.findByRole('group', { name: /Acción sin confirmar/ })
    srv.cola.push(json(404, { error: 'no-encontrado' }))
    await usuario.click(within(banner).getByRole('button', { name: 'Repetir la misma solicitud' }))
    await waitFor(() => expect(screen.getAllByText(/un intento anterior sigue sin confirmarse/).length).toBeGreaterThan(0))
    expect(screen.getByRole('group', { name: /Acción sin confirmar/ })).toBeTruthy()
    expect(llaves()).toHaveLength(1)
  })

  it('no hay botón para descartar: solo repetir y consultar', async () => {
    await abrirPlantilla()
    srv.cola.push(new TypeError('Failed to fetch'))
    await rellenarAlta()
    await enviarAlta()
    await screen.findByRole('group', { name: /Acción sin confirmar/ })
    expect(screen.queryByRole('button', { name: /descartar|cancelar|olvidar|borrar/i })).toBeNull()
    expect(screen.getByText(/Cómo se conserva esto/)).toBeTruthy()
  })

  it('la explicación dice que no está cifrado y que borrar los datos del navegador puede impedir la repetición exacta', async () => {
    await abrirPlantilla()
    srv.cola.push(new TypeError('Failed to fetch'))
    await rellenarAlta()
    await enviarAlta()
    const banner = await screen.findByRole('group', { name: /Acción sin confirmar/ })
    const texto = banner.textContent
    expect(texto).toMatch(/Cerrar sesión no lo borra/)
    expect(texto).toMatch(/No está cifrado/)
    expect(texto).toMatch(/ya no se podrá repetir exactamente/)
    expect(texto).toMatch(/ventana privada/)
  })
})

describe('doble pulsación', () => {
  it('pulsar dos veces enviar crea UNA sola operación', async () => {
    await abrirPlantilla()
    srv.cola.push((req) => aplicado('creado', op(req), ficha('N1', 'E1', 'Carla', 'Nueva', 12)))
    await rellenarAlta()
    await usuario.dblClick(hoja().getByRole('button', { name: 'Añadir jugador' }))
    await screen.findByText('Jugador añadido.')
    expect(srv.posts).toHaveLength(1)
  })
})

describe('revisión desactualizada y partido que empieza mientras tanto', () => {
  it('muestra qué cambió, conserva lo que el organizador cambió, adopta lo que no tocó y exige volver a enviar con una operación nueva', async () => {
    await abrirPlantilla()
    await usuario.click(fila('Beto Muestra').getByRole('button', { name: 'Editar' }))
    await escribir('Número *', '9', hoja())
    srv.cola.push((req) => rechazado('ficha-desactualizada', op(req), { ficha: ficha('J2', 'E1', 'Beto', 'Muestra', 7, { rev: 4, nombreCamiseta: 'BETO' }) }))
    await usuario.click(hoja().getByRole('button', { name: 'Guardar cambios' }))
    await screen.findByText('Esta ficha cambió mientras la editabas')
    expect(hoja().getByText(/Nombre en camiseta:/).closest('li').textContent).toMatch(/— → BETO/)
    expect(srv.posts).toHaveLength(1) // nada se reenvía solo
    await usuario.click(hoja().getByRole('button', { name: 'Revisar y guardar de nuevo' }))
    expect(hoja().getByLabelText('Nombre en camiseta').value).toBe('BETO') // lo que cambió el otro teléfono se adopta
    expect(hoja().getByLabelText('Número *').value).toBe('9') // el cambio del organizador se conserva
    srv.cola.push((req) => aplicado('editado', op(req), ficha('J2', 'E1', 'Beto', 'Muestra', 9, { rev: 5, nombreCamiseta: 'BETO' })))
    await usuario.click(hoja().getByRole('button', { name: 'Guardar cambios' }))
    await screen.findByText('Jugador actualizado.')
    expect(srv.posts[1].json).toEqual({ operacionId: expect.any(String), revEsperada: 4, campos: { dorsal: '9' } })
    expect(srv.posts[1].json.operacionId).not.toBe(srv.posts[0].json.operacionId)
  })

  it('si otro teléfono inicia el partido tras abrir el formulario, el servidor manda: se explica, se bloquea y no queda registro pendiente', async () => {
    await abrirPlantilla()
    await rellenarAlta()
    srv.cola.push((req) => {
      srv.estado.plantillas['LIGA-U10/E1'].bloqueada = true // el partido empezó
      return rechazado('equipo-bloqueado', op(req))
    })
    await enviarAlta()
    await screen.findByText(/Un partido de este equipo está en curso/)
    await usuario.click(hoja().getAllByRole('button', { name: 'Cerrar' }).find((b) => b.textContent === 'Cerrar'))
    await waitFor(() => expect(screen.getAllByText(/Hay un partido de este equipo en curso o en pausa/).length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: 'Añadir jugador' }).disabled).toBe(true)
    expect(fila('Ana Prueba').getByRole('button', { name: 'Editar' }).disabled).toBe(true)
    expect(llaves()).toEqual([])
  })

  it('un equipo bloqueado desde el principio se puede consultar pero no cambiar, y una hora programada por sí sola no bloquea nada', async () => {
    srv.estado.plantillas['LIGA-U10/E1'].bloqueada = true
    await abrirPlantilla()
    expect(screen.getByText(/Una hora programada, por sí sola, no la bloquea/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Añadir jugador' }).disabled).toBe(true)
    expect(srv.posts).toHaveLength(0)
  })
})

describe('sesión terminada y cierre de sesión con acciones sin confirmar', () => {
  it('un 401 conserva el registro, lleva a la entrada y, al volver a entrar con el mismo organizador, se vuelve a la plantilla con la acción para repetir', async () => {
    await abrirPlantilla()
    srv.cola.push(() => { srv.estado.sesion = false; return json(401, { error: 'no-autorizado' }) })
    await rellenarAlta()
    await enviarAlta()
    await screen.findByLabelText('Código de acceso')
    expect(llaves()).toEqual([clave('org-1', 'LIGA-U10')])
    expect(JSON.parse(localStorage.getItem(llaves()[0])).ultimo).toBe('sesion')
    expect(screen.queryByText('Acción sin confirmar')).toBeNull() // sin sesión no se expone la gestión
    await usuario.type(screen.getByLabelText('Código de acceso'), 'ABCDE-23456-FGHJK-78MNP')
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }))
    await screen.findByRole('group', { name: /Acción sin confirmar/ })
    srv.cola.push((req) => aplicado('creado', op(req), ficha('N1', 'E1', 'Carla', 'Nueva', 12)))
    await usuario.click(screen.getByRole('button', { name: 'Repetir la misma solicitud' }))
    await waitFor(() => expect(llaves()).toEqual([]))
    expect(srv.posts[1].cuerpo).toBe(srv.posts[0].cuerpo)
  })

  it('cerrar sesión no borra el registro, y otro organizador en el mismo navegador no lo ve ni lo puede repetir', async () => {
    await abrirPlantilla()
    srv.cola.push(new TypeError('Failed to fetch'))
    await rellenarAlta()
    await enviarAlta()
    await screen.findByRole('group', { name: /Acción sin confirmar/ })
    cleanup(); __reiniciar()
    abrir('/anthony/ligas')
    await screen.findByText('Mis ligas')
    expect(screen.getByText(/cerrar sesión no las borra/i)).toBeTruthy()
    await usuario.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    await screen.findByLabelText('Código de acceso')
    expect(llaves()).toEqual([clave('org-1', 'LIGA-U10')])
    // otro organizador entra
    srv.estado.yo = YO(['LIGA-U10']); srv.estado.yo.organizadorId = 'org-2'
    await usuario.type(screen.getByLabelText('Código de acceso'), 'ABCDE-23456-FGHJK-78MNP')
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }))
    await screen.findByText('Mis ligas')
    expect(screen.queryByText(/Acción sin confirmar/)).toBeNull()
    expect(llaves()).toEqual([clave('org-1', 'LIGA-U10')]) // intacto
  })
})

describe('almacenamiento que falla: no se envía', () => {
  it('si no se puede guardar el registro de recuperación, no se envía y se explica', async () => {
    await abrirPlantilla()
    await rellenarAlta()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('cuota', 'QuotaExceededError') })
    await enviarAlta()
    expect((await screen.findByRole('alert')).textContent).toContain('No pudimos guardar en este navegador el registro necesario para recuperar la acción')
    expect(srv.posts).toHaveLength(0)
  })

  it('un registro ilegible se conserva intacto, se explica y bloquea los cambios de esa liga', async () => {
    localStorage.setItem(clave('org-1', 'LIGA-U10'), '{"basura":true}')
    await abrirPlantilla()
    await screen.findByText('Registro de recuperación ilegible')
    expect(screen.getByRole('button', { name: 'Añadir jugador' }).disabled).toBe(true)
    expect(localStorage.getItem(clave('org-1', 'LIGA-U10'))).toBe('{"basura":true}')
    expect(srv.posts).toHaveLength(0)
  })

  it('con el almacenamiento no disponible los cambios quedan desactivados y se explica', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    abrir()
    await screen.findByText('Beto Muestra')
    expect(screen.getByRole('button', { name: 'Añadir jugador' }).disabled).toBe(true)
    expect(screen.getAllByText(/No pudimos guardar en este navegador el registro necesario/).length).toBeGreaterThan(0)
  })
})

describe('sin datos de demostración ni escrituras locales de plantilla', () => {
  it('el panel no crea ninguna base local ni muestra nada que no venga del servidor', async () => {
    await abrirPlantilla()
    srv.cola.push((req) => aplicado('creado', op(req), ficha('N1', 'E1', 'Carla', 'Nueva', 12)))
    await rellenarAlta()
    await enviarAlta()
    await screen.findByText('Jugador añadido.')
    expect((await indexedDB.databases()).length).toBe(0)
    expect(JSON.stringify({ ...sessionStorage })).toBe('{}')
    expect(document.body.textContent).not.toMatch(/demostración|Liga Demo/i)
    for (const c of consola) expect(c).not.toHaveBeenCalled()
  })
})

describe('un envío en vuelo no se presenta como «sin confirmar»', () => {
  const registro = (ultimo) => JSON.stringify({ v: 1, operacionId: 'op-0123456789abcdef', tipo: 'alta', ligaId: 'LIGA-U10', equipoId: 'E1', fichaId: null, cuerpoJson: JSON.stringify({ operacionId: 'op-0123456789abcdef', campos: { nombrePila: 'A', apellido1: 'B', dorsal: '1' } }), creadoEn: Date.now(), intentos: 1, ultimo, conIncierto: false })

  it('con el candado de la liga retenido (envío en curso en otra pestaña): «enviando», sin botón de repetir y con los cambios desactivados', async () => {
    localStorage.setItem(clave('org-1', 'LIGA-U10'), registro('enviando'))
    let fin
    const retenido = new Promise((r) => { fin = r })
    const dentro = navigator.locks.request('sebel-op:org-1:LIGA-U10', {}, () => retenido)
    await abrirPlantilla()
    await screen.findByRole('status', { name: /Enviando en Liga Sub-10/ })
    expect(screen.queryByRole('button', { name: 'Repetir la misma solicitud' })).toBeNull()
    expect(screen.queryByText(/No sabemos si el servidor aplicó/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Añadir jugador' }).disabled).toBe(true)
    fin(); await dentro
  })

  it('con el candado libre (la pestaña que enviaba ya no existe): es una acción sin confirmar con su botón', async () => {
    localStorage.setItem(clave('org-1', 'LIGA-U10'), registro('enviando'))
    await abrirPlantilla()
    expect(await screen.findByRole('group', { name: /Acción sin confirmar/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Repetir la misma solicitud' })).toBeTruthy()
    expect(screen.getByText(/Se estaba enviando cuando la página se cerró/)).toBeTruthy()
  })
})
