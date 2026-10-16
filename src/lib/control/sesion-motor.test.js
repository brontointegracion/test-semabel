import { describe, expect, it } from 'vitest'
import { canonico, contenidoCanonico } from '../motor'
import { preparacionConCambioDeNumero, preparacionDePrueba, preparacionNoLista } from '../motor/prueba/auxiliares-preparacion'
import { ATRIBUCION_DE_PRUEBA, estadoDePrueba } from '../motor/prueba/banco'
import {
  DEVICE, LIGA, PARTIDO, T0, cuerpoDeServidor, enviarAlServidor, servidorNuevo, sesionDe,
} from './prueba/auxiliares-sesion'
import {
  LIMITES, colaDeFilas, compararInstantanea, construirSesion, evaluarInicio, evaluarRecibo, huellaDeRecibo, medirEntrada, medirSesion,
  ordenDeInicio, prepararEncolado, prepararEnvio, provisionalDe, puntuacionHabilitada, reanudarTrasRechazo, recortarRecibo,
  validarCuerpoEstado, validarFilaEntrada, validarFilaSesion, validarSesionYEntradas, vistaDe,
} from './sesion-motor'

// ---------------------------------------------------------------------------
// Lógica pura: sin IndexedDB. `fusion` hace lo que el almacén haría con la salida de cada función pura.
// ---------------------------------------------------------------------------

const T = (ts) => ({ accionTs: ts, accionTsCrudo: ts, ajusteTsMs: 0, discontinuidad: null })
const ctx = (ahora = T0, extra = {}) => ({ ahoraEstimado: ahora, actorId: 'yo', enLinea: true, ahora, ...extra })
let n = 0
const id = (p) => `${p}${++n}`

function fusion(s, r) {
  const mapa = new Map(s.entradas.map((f) => [f.clientSeq, f]))
  for (const f of r.entradas) mapa.set(f.clientSeq, { ...f, bytes: medirEntrada(f) })
  return { sesion: { ...r.sesion, revision: s.sesion.revision + 1 }, entradas: [...mapa.values()].sort((a, b) => a.clientSeq - b.clientSeq) }
}
function enc(s, orden, c = ctx()) {
  const r = prepararEncolado(s.sesion, s.entradas, orden, c)
  if (r.tipo !== 'ok') throw new Error(`enc: ${r.tipo} ${r.motivo ?? ''} ${JSON.stringify(r.rechazo ?? '')}`)
  return { ...fusion(s, r), r }
}
function env(s, cmdId) {
  const r = prepararEnvio(s.sesion, s.entradas, cmdId)
  if (r.tipo !== 'ok') throw new Error(`env: ${r.motivo}`)
  return { ...fusion(s, r), r }
}
async function aplica(s, recibo, c = ctx()) {
  const huella = await huellaDeRecibo(recibo)
  const r = evaluarRecibo(s.sesion, s.entradas, recibo, huella, c)
  return { r, huella, s: r.tipo === 'aplicar' ? fusion(s, r) : s }
}

/** Sesión con el inicio ya CONFIRMADO por un recibo real del servidor sintético. */
async function conInicio() {
  const banco = servidorNuevo()
  let s = { sesion: sesionDe(banco), entradas: [] }
  const o = ordenDeInicio({ cmdId: 'ini', preparacion: preparacionDePrueba(PARTIDO), tiempo: T(T0), sesion: s.sesion })
  s = enc(s, o.orden)
  s = env(s, 'ini')
  const { recibo } = await enviarAlServidor(banco, s.entradas[0].cuerpoJson)
  const a = await aplica(s, recibo)
  expect(a.r.tipo).toBe('aplicar')
  return { banco, s: a.s }
}
/** Encola, marca y envía al servidor la siguiente orden; devuelve el recibo real. */
async function ciclo(banco, s, orden, { recibidoEn = banco.ahora, c = ctx() } = {}) {
  const e = enc(s, orden, c)
  const m = env(e, orden.cmdId)
  const { recibo, tipo } = await enviarAlServidor(banco, m.entradas.find((f) => f.cmdId === orden.cmdId).cuerpoJson, recibidoEn)
  return { s: m, recibo, tipo }
}
const PUNTOS = (cmdId = id('p'), ts = T0) => ({ cmdId, tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, tiempo: T(ts) })
const FALTA = (cmdId = id('f'), ts = T0) => ({ cmdId, tipo: 'falta', datos: { equipoId: 'E2', jugadorId: 'J9' }, tiempo: T(ts) })
const SIG = (cmdId = id('sp'), ts = T0) => ({ cmdId, tipo: 'siguiente-periodo', datos: {}, tiempo: T(ts) })

describe('instantánea → sesión', () => {
  it('construye una sesión verificada desde un cuerpo válido; un partido programado nace sin iniciar', () => {
    const banco = servidorNuevo()
    const r = construirSesion({ ligaId: LIGA, partidoId: PARTIDO, cuerpoEstado: cuerpoDeServidor(banco) })
    expect(r.ok).toBe(true)
    expect(r.sesion).toMatchObject({
      id: 'L1:P', deviceId: DEVICE, revision: 0, inicio: 'sin-iniciar', siguienteSeq: 1, detenida: null, divergencia: null,
      verificacion: { nivel: 'verificada', verificadaRev: 0 }, base: { ultimoClientSeq: 0 },
    })
    expect(r.sesion.base.estado.atribucion.version).toBe(ATRIBUCION_DE_PRUEBA.version)
    expect(Object.keys(r.sesion)).not.toContain('provisional') // el provisional se deriva, no se guarda
    expect(validarFilaSesion({ ...r.sesion, uso: { bytes: 1, comandos: 0, reservado: 0, sobreReserva: false } }, 'L1:P').ok).toBe(true)
  })
  it('un partido que ya no está programado nace con el inicio «sin resolver» y no se puede puntuar', async () => {
    const { banco } = await conInicio()
    const s = sesionDe(banco)
    expect(s.inicio).toBe('sin-resolver')
    expect(puntuacionHabilitada(s, [])).toEqual({ habilitada: false, motivo: 'inicio-sin-resolver' })
    expect(prepararEncolado(s, [], PUNTOS(), ctx())).toMatchObject({ tipo: 'rechazo', motivo: 'inicio-sin-resolver' })
  })
  it.each([
    ['versión', (c) => ({ ...c, version: 2 })],
    ['otro partido', (c) => ({ ...c, gameId: 'OTRO' })],
    ['sin dispositivo', (c) => ({ ...c, deviceId: '' })],
    ['cursor', (c) => ({ ...c, cursor: { rev: -1, ultimoClientSeq: 0 } })],
    ['estado', (c) => ({ ...c, estado: null })],
    ['eventos', (c) => ({ ...c, estado: { ...c.estado, eventos: [{ id: 'x' }] } })],
    ['atribución manipulada', (c) => ({ ...c, atribucion: { ...c.atribucion, jugadores: { ...c.atribucion.jugadores, J1: { equipoId: 'E1', elegible: false } } } })],
    ['etiquetas', (c) => ({ ...c, etiquetas: null })],
  ])('rechaza un cuerpo con %s', (_nombre, tocar) => {
    const banco = servidorNuevo()
    const r = validarCuerpoEstado(tocar(cuerpoDeServidor(banco)), { gameId: PARTIDO, deviceId: DEVICE })
    expect(r.ok).toBe(false)
  })
  it('exige coincidir con el partido y el dispositivo esperados', () => {
    const banco = servidorNuevo()
    expect(validarCuerpoEstado(cuerpoDeServidor(banco), { gameId: 'X' }).motivo).toBe('juego-distinto')
    expect(validarCuerpoEstado(cuerpoDeServidor(banco), { gameId: PARTIDO, deviceId: 'otro' }).motivo).toBe('dispositivo-distinto')
    expect(construirSesion({ ligaId: 'a:b', partidoId: PARTIDO, cuerpoEstado: cuerpoDeServidor(banco) }).motivo).toBe('identidad')
  })
})

describe('inicio del partido: compuertas y constructor', () => {
  it('evaluarInicio: internet, preparación íntegra y lista, atribución coincidente', () => {
    const banco = servidorNuevo()
    const sesion = sesionDe(banco)
    const prep = preparacionDePrueba(PARTIDO)
    expect(evaluarInicio({ enLinea: true, sesion, entradas: [], preparacion: prep })).toEqual({ puede: true })
    expect(evaluarInicio({ enLinea: false, sesion, entradas: [], preparacion: prep })).toMatchObject({ puede: false, motivo: 'sin-internet' })
    expect(evaluarInicio({ enLinea: undefined, sesion, entradas: [], preparacion: prep }).motivo).toBe('sin-internet')
    expect(evaluarInicio({ enLinea: true, sesion, entradas: [], preparacion: null }).motivo).toBe('preparacion-no-disponible')
    expect(evaluarInicio({ enLinea: true, sesion, entradas: [], preparacion: { ...prep, version: 'falsa' } }).motivo).toBe('preparacion-no-disponible')
    expect(evaluarInicio({ enLinea: true, sesion, entradas: [], preparacion: preparacionDePrueba('OTRO') }).motivo).toBe('preparacion-no-disponible')
    expect(evaluarInicio({ enLinea: true, sesion, entradas: [], preparacion: preparacionNoLista(PARTIDO) }).puede).toBe(false)
    // La plantilla de la preparación no coincide con la atribución de la base: hay que refrescar antes de pedir el inicio.
    const otra = preparacionDePrueba(PARTIDO, { jugadores: preparacionDePrueba(PARTIDO).jugadores.filter((j) => j.id !== 'J8').concat([]) })
    expect(evaluarInicio({ enLinea: true, sesion, entradas: [], preparacion: otra }).puede).toBe(false)
  })
  it('evaluarInicio: ya iniciado, en curso, detenida, divergencia', async () => {
    const banco = servidorNuevo()
    const sesion = sesionDe(banco)
    const prep = preparacionDePrueba(PARTIDO)
    expect(evaluarInicio({ enLinea: true, sesion: { ...sesion, inicio: 'confirmado' }, entradas: [], preparacion: prep }).motivo).toBe('ya-iniciado')
    expect(evaluarInicio({ enLinea: true, sesion: { ...sesion, divergencia: { causa: 'x' } }, entradas: [], preparacion: prep }).motivo).toBe('divergencia')
    expect(evaluarInicio({ enLinea: true, sesion: { ...sesion, detenida: { causa: 'rechazo-definitivo' } }, entradas: [], preparacion: prep }).motivo).toBe('cola-detenida')
    const e = enc({ sesion, entradas: [] }, ordenDeInicio({ cmdId: 'i', preparacion: prep, tiempo: T(T0), sesion }).orden)
    expect(evaluarInicio({ enLinea: true, sesion: e.sesion, entradas: e.entradas, preparacion: prep }).motivo).toBe('inicio-en-curso')
  })
  it('ordenDeInicio captura la versión de preparación y exige una íntegra de ESTE partido', () => {
    const sesion = sesionDe(servidorNuevo())
    const prep = preparacionDePrueba(PARTIDO)
    expect(ordenDeInicio({ cmdId: 'i', preparacion: prep, tiempo: T(T0), sesion }).orden).toMatchObject({ tipo: 'iniciar-partido', preparacionVersion: prep.version })
    expect(ordenDeInicio({ cmdId: '', preparacion: prep, tiempo: T(T0), sesion }).ok).toBe(false)
    expect(ordenDeInicio({ cmdId: 'i', preparacion: preparacionDePrueba('X'), tiempo: T(T0), sesion }).motivo).toBe('preparacion-no-disponible')
  })
  it('el inicio exige internet y la versión de preparación; sin ellos no se encola nada', () => {
    const sesion = sesionDe(servidorNuevo())
    const orden = ordenDeInicio({ cmdId: 'i', preparacion: preparacionDePrueba(PARTIDO), tiempo: T(T0), sesion }).orden
    expect(prepararEncolado(sesion, [], orden, ctx(T0, { enLinea: false }))).toMatchObject({ tipo: 'rechazo', motivo: 'sin-internet' })
    expect(prepararEncolado(sesion, [], orden, ctx(T0, { enLinea: undefined }))).toMatchObject({ motivo: 'sin-internet' })
    const sin = { ...orden }
    delete sin.preparacionVersion
    expect(prepararEncolado(sesion, [], sin, ctx())).toMatchObject({ tipo: 'rechazo', motivo: 'preparacion-ausente' })
  })
  it('no se puntúa mientras el inicio no esté CONFIRMADO: ni sin iniciar, ni con el inicio encolado (el provisional ya dice «vivo»)', () => {
    const sesion = sesionDe(servidorNuevo())
    const motivos = (s) => prepararEncolado(s.sesion, s.entradas, PUNTOS(), ctx())
    expect(motivos({ sesion, entradas: [] })).toMatchObject({ tipo: 'rechazo', motivo: 'inicio-no-confirmado' })
    const e = enc({ sesion, entradas: [] }, ordenDeInicio({ cmdId: 'i', preparacion: preparacionDePrueba(PARTIDO), tiempo: T(T0), sesion }).orden)
    const prov = provisionalDe(e.sesion, colaDeFilas(e.sesion, e.entradas).cola, ctx())
    expect(prov.estado.partido.estado).toBe('vivo') // el provisional sí dice vivo…
    expect(motivos(e)).toMatchObject({ tipo: 'rechazo', motivo: 'inicio-en-curso' }) // …y aun así no se puntúa
    for (const o of [FALTA(), SIG(), { cmdId: 'ar', tipo: 'arrancar-reloj', datos: {}, tiempo: T(T0) }]) {
      expect(prepararEncolado(e.sesion, e.entradas, o, ctx()).tipo, o.tipo).toBe('rechazo')
    }
    expect(puntuacionHabilitada(e.sesion, e.entradas).habilitada).toBe(false)
  })
  it('con el inicio confirmado por un recibo sí se puntúa', async () => {
    const { s } = await conInicio()
    expect(s.sesion.inicio).toBe('confirmado')
    expect(puntuacionHabilitada(s.sesion, s.entradas)).toEqual({ habilitada: true, motivo: null })
    expect(prepararEncolado(s.sesion, s.entradas, PUNTOS(), ctx()).tipo).toBe('ok')
  })
  it('un segundo inicio con el partido ya iniciado se rechaza', async () => {
    const { s } = await conInicio()
    const o = ordenDeInicio({ cmdId: 'otro', preparacion: preparacionDePrueba(PARTIDO), tiempo: T(T0), sesion: s.sesion }).orden
    expect(prepararEncolado(s.sesion, s.entradas, o, ctx())).toMatchObject({ tipo: 'rechazo', motivo: 'ya-iniciado' })
  })
})

describe('encolado puro', () => {
  it('exige una hora estimada entera (sin ella la validación de futuro se saltaría en silencio)', async () => {
    const { s } = await conInicio()
    expect(prepararEncolado(s.sesion, s.entradas, PUNTOS(), { actorId: 'yo' })).toMatchObject({ motivo: 'sin-ahora' })
    expect(prepararEncolado(s.sesion, s.entradas, PUNTOS(), { ahoraEstimado: Number.NaN })).toMatchObject({ motivo: 'sin-ahora' })
  })
  it('asigna el siguiente número, guarda el texto exacto del sobre y no guarda el estado provisional', async () => {
    const { s } = await conInicio()
    const r = prepararEncolado(s.sesion, s.entradas, PUNTOS('c-uno'), ctx())
    expect(r.entradas[0]).toMatchObject({ clientSeq: 2, cmdId: 'c-uno', estado: 'pendiente', intentos: 0, recibo: null, reciboHuella: null })
    expect(r.entradas[0].cuerpoJson).toBe(JSON.stringify(r.resultado.sobre))
    expect(r.sesion.siguienteSeq).toBe(3)
    expect(r.sesion.base).toBe(s.sesion.base) // la base no se toca al encolar
    expect(r.entradas[0].reserva).toBeGreaterThan(0)
  })
  it('un rechazo local no cambia nada ni consume número', async () => {
    const { s } = await conInicio()
    const r = prepararEncolado(s.sesion, s.entradas, { cmdId: 'x', tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'JX', puntos: 2 }, tiempo: T(T0) }, ctx())
    expect(r).toMatchObject({ tipo: 'rechazo', motivo: 'rechazo-local', rechazo: { motivo: 'jugador-inactivo' } })
  })
  it('un cmdId vivo repetido es «duplicada» (mismo sobre, sin número nuevo); uno ya decidido no se reutiliza', async () => {
    const { s } = await conInicio()
    const e = enc(s, PUNTOS('dup'))
    const otra = prepararEncolado(e.sesion, e.entradas, PUNTOS('dup'), ctx())
    expect(otra.tipo).toBe('duplicada')
    expect(otra.sobre.clientSeq).toBe(2)
    expect(prepararEncolado(e.sesion, e.entradas, PUNTOS('ini'), ctx())).toMatchObject({ tipo: 'rechazo', motivo: 'cmdId-reutilizado' })
  })
  it('una sesión con divergencia no encola, no envía ni acepta recibos', async () => {
    const { s } = await conInicio()
    const parada = { ...s.sesion, divergencia: { causa: 'x', cmdId: null, detalle: null, en: null, reciboJson: null } }
    expect(prepararEncolado(parada, s.entradas, PUNTOS(), ctx())).toMatchObject({ motivo: 'sesion-detenida-por-divergencia' })
    expect(prepararEnvio(parada, s.entradas, 'x')).toMatchObject({ motivo: 'sesion-detenida-por-divergencia' })
    expect(evaluarRecibo(parada, s.entradas, {}, 'a'.repeat(64), ctx())).toMatchObject({ tipo: 'bloqueada' })
  })
})

describe('marcar un envío (puro)', () => {
  it('solo la primera viva, en orden, y con el texto guardado', async () => {
    const { s } = await conInicio()
    let e = enc(s, PUNTOS('a'))
    e = enc(e, FALTA('b'))
    expect(prepararEnvio(e.sesion, e.entradas, 'b')).toMatchObject({ tipo: 'rechazo', motivo: 'fuera-de-orden' })
    expect(prepararEnvio(e.sesion, e.entradas, 'zzz')).toMatchObject({ motivo: 'cmdId-desconocido' })
    const m = prepararEnvio(e.sesion, e.entradas, 'a')
    expect(m.entradas[0]).toMatchObject({ estado: 'enviando', intentos: 1 })
    expect(m.resultado.cuerpoJson).toBe(e.entradas.find((f) => f.cmdId === 'a').cuerpoJson)
    // reintento: sigue siendo la primera viva y el texto es el mismo
    const m2 = prepararEnvio(fusion(e, m).sesion, fusion(e, m).entradas, 'a')
    expect(m2.entradas[0].intentos).toBe(2)
    expect(m2.resultado.cuerpoJson).toBe(m.resultado.cuerpoJson)
  })
  it('una cola detenida no envía', async () => {
    const { s } = await conInicio()
    const e = enc(s, PUNTOS('a'))
    expect(prepararEnvio({ ...e.sesion, detenida: { causa: 'rechazo-definitivo' } }, e.entradas, 'a')).toMatchObject({ motivo: 'cola-detenida' })
    expect(prepararEnvio(s.sesion, s.entradas, 'a')).toMatchObject({ motivo: 'nada-que-enviar' })
  })
})

describe('aplicar un recibo (puro)', () => {
  it('aceptado: avanza la base por derivación exacta, la marca «derivada» y no la llama verificada', async () => {
    const { banco, s } = await conInicio()
    const { s: m, recibo } = await ciclo(banco, s, PUNTOS('a'))
    const a = await aplica(m, recibo)
    expect(a.r.tipo).toBe('aplicar')
    expect(a.s.sesion.base.ultimoClientSeq).toBe(2)
    expect(a.s.sesion.base.estado.rev).toBe(recibo.revDespues)
    expect(a.s.sesion.base.estado.eventos.map((e) => e.id)).toEqual(['a'])
    expect(a.s.sesion.verificacion).toEqual({ nivel: 'derivada', verificadaRev: 0 })
    expect(a.s.entradas.at(-1)).toMatchObject({ estado: 'confirmada', reserva: 0, motivoNoAplicada: null })
    expect(a.s.entradas.at(-1).reciboHuella).toBe(a.huella)
    expect(a.s.entradas.at(-1).recibo).toEqual(recortarRecibo(recibo))
    // el estado derivado coincide con el del servidor
    expect(compararInstantanea(a.s.sesion, a.s.entradas, cuerpoDeServidor(banco), ctx()).tipo).toBe('verificada')
  })
  it('el recibo recortado es mucho menor que el completo y no repite el contenido', async () => {
    const { banco, s } = await conInicio()
    const { recibo } = await ciclo(banco, s, PUNTOS('a'))
    const cortado = JSON.stringify(recortarRecibo(recibo))
    expect(cortado.length).toBeLessThan(JSON.stringify(recibo).length / 2)
    expect(cortado).not.toContain('"contenido"')
  })
  it('idéntico a uno ya aplicado: no-op, aunque la secuencia ya no sea la siguiente', async () => {
    const { banco, s } = await conInicio()
    const { s: m, recibo } = await ciclo(banco, s, PUNTOS('a'))
    const a = await aplica(m, recibo)
    expect(a.s.sesion.base.ultimoClientSeq).not.toBe(recibo.clientSeq - 1) // la comprobación de «siguiente» fallaría
    const otra = evaluarRecibo(a.s.sesion, a.s.entradas, JSON.parse(JSON.stringify(recibo)), a.huella, ctx())
    expect(otra.tipo).toBe('noop')
  })
  it('distinto de uno ya aplicado (recortado o solo en el hash): parada, sin tocar lo guardado', async () => {
    const { banco, s } = await conInicio()
    const { s: m, recibo } = await ciclo(banco, s, PUNTOS('a'))
    const a = await aplica(m, recibo)
    const cambios = [
      (r) => { r.meta.recibidoEn += 1 },
      (r) => { r.revDespues += 1 },
      (r) => { r.advertencias = ['x'] },
      (r) => { r.refs.eventosNuevos = ['otro'] },
      (r) => { r.detalle = { solo: 'en-el-hash' } }, // no está en el recibo recortado de un aceptado: lo detecta el hash
    ]
    for (const cambiar of cambios) {
      const r2 = JSON.parse(JSON.stringify(recibo))
      cambiar(r2)
      const h2 = await huellaDeRecibo(r2)
      const e = evaluarRecibo(a.s.sesion, a.s.entradas, r2, h2, ctx())
      expect(e.tipo).toBe('divergencia')
      expect(e.causa).toBe('recibo-incoherente')
      expect(e.sesion.base).toBe(a.s.sesion.base)
      expect(e.sesion.divergencia.reciboJson).toBe(canonico(r2)) // la evidencia queda
    }
    // el mismo recibo con un hash distinto también es incoherente
    expect(evaluarRecibo(a.s.sesion, a.s.entradas, recibo, 'b'.repeat(64), ctx())).toMatchObject({ tipo: 'divergencia', causa: 'recibo-incoherente' })
  })
  it('identidad: gameId, deviceId, clientSeq, contenido o una entrada que no existe → parada con la base intacta', async () => {
    const { banco, s } = await conInicio()
    const { s: m, recibo } = await ciclo(banco, s, PUNTOS('a'))
    const prueba = async (cambiar, causa) => {
      const r = JSON.parse(JSON.stringify(recibo))
      cambiar(r)
      const e = evaluarRecibo(m.sesion, m.entradas, r, await huellaDeRecibo(r), ctx())
      expect(e, causa).toMatchObject({ tipo: 'divergencia', causa })
      expect(e.sesion.base).toBe(m.sesion.base)
      expect(e.entradas).toEqual([])
    }
    await prueba((r) => { r.gameId = 'OTRO' }, 'identidad-de-recibo')
    await prueba((r) => { r.deviceId = 'otro' }, 'identidad-de-recibo')
    await prueba((r) => { r.clientSeq += 1 }, 'identidad-de-recibo')
    await prueba((r) => { r.contenido = contenidoCanonico({ ...JSON.parse(r.contenido), accionTs: 1 }) }, 'contenido-de-recibo')
    await prueba((r) => { r.contenido += ' ' }, 'contenido-de-recibo')
    await prueba((r) => { r.cmdId = 'no-existe' }, 'recibo-sin-entrada')
  })
  it('secuencia y revisión: una base atrasada, un revDespues erróneo, un motor distinto', async () => {
    const { banco, s } = await conInicio()
    const { s: m, recibo } = await ciclo(banco, s, PUNTOS('a'))
    const atrasada = { ...m.sesion, base: { ...m.sesion.base, ultimoClientSeq: m.sesion.base.ultimoClientSeq - 1 } }
    expect(evaluarRecibo(atrasada, m.entradas, recibo, await huellaDeRecibo(recibo), ctx())).toMatchObject({ tipo: 'divergencia', causa: 'secuencia-de-recibo' })
    const r1 = JSON.parse(JSON.stringify(recibo))
    r1.revDespues += 1
    expect(evaluarRecibo(m.sesion, m.entradas, r1, await huellaDeRecibo(r1), ctx())).toMatchObject({ causa: 'revision-de-recibo' })
    const r2 = JSON.parse(JSON.stringify(recibo))
    r2.meta.versionMotor = 7
    expect(evaluarRecibo(m.sesion, m.entradas, r2, await huellaDeRecibo(r2), ctx())).toMatchObject({ causa: 'motor-distinto' })
  })
  it('la derivación local nunca se impone: si no reproduce el recibo hay parada, no se adopta ningún estado', async () => {
    const { banco, s } = await conInicio()
    const { s: m, recibo } = await ciclo(banco, s, PUNTOS('a'))
    const h = await huellaDeRecibo(recibo)
    // base local distinta de la del servidor: el partido «final» → la decisión local contradice un recibo aceptado
    const otra = { ...m.sesion, base: { ...m.sesion.base, estado: { ...m.sesion.base.estado, partido: { ...m.sesion.base.estado.partido, estado: 'final' } } } }
    expect(evaluarRecibo(otra, m.entradas, recibo, h, ctx())).toMatchObject({ tipo: 'divergencia', causa: 'derivacion-contradice-recibo' })
    // referencias y advertencias del recibo que no coinciden con lo derivado
    for (const [cambiar, causa] of [[(r) => { r.refs.eventosNuevos = ['x'] }, 'referencias-derivadas'], [(r) => { r.advertencias = ['x'] }, 'advertencias-derivadas']]) {
      const r = JSON.parse(JSON.stringify(recibo))
      cambiar(r)
      expect(evaluarRecibo(m.sesion, m.entradas, r, await huellaDeRecibo(r), ctx()).causa).toBe(causa)
    }
  })
  it('malformado o sin hash válido: resultado desconocido, nada cambia y NO se declara parada', async () => {
    const { banco, s } = await conInicio()
    const { s: m, recibo } = await ciclo(banco, s, PUNTOS('a'))
    const h = await huellaDeRecibo(recibo)
    for (const malo of [null, {}, { ...recibo, resultado: 'quizá' }, { ...recibo, meta: null }, { ...recibo, refs: { eventosNuevos: 'x' } }, { ...recibo, revDespues: 'uno' }]) {
      expect(evaluarRecibo(m.sesion, m.entradas, malo, h, ctx())).toEqual({ tipo: 'malformado' })
    }
    expect(evaluarRecibo(m.sesion, m.entradas, recibo, 'no-es-hash', ctx())).toEqual({ tipo: 'malformado' })
  })
  it('un recibo para una entrada pendiente, o fuera de orden, es una parada', async () => {
    const { banco, s } = await conInicio()
    const e = enc(enc(s, PUNTOS('a')), FALTA('b'))
    const m = env(e, 'a')
    const { recibo: ra } = await enviarAlServidor(banco, m.entradas.find((f) => f.cmdId === 'a').cuerpoJson)
    // 'b' sigue pendiente: aunque exista un recibo suyo, no se aplica
    const { recibo: rb } = await enviarAlServidor(banco, e.entradas.find((f) => f.cmdId === 'b').cuerpoJson)
    expect(evaluarRecibo(m.sesion, m.entradas, rb, await huellaDeRecibo(rb), ctx())).toMatchObject({ tipo: 'divergencia', causa: 'recibo-para-entrada-no-enviada' })
    expect(ra.clientSeq).toBe(2)
  })
})

describe('rechazos: avanzan la secuencia decidida, no la revisión, y nunca se contradicen', () => {
  async function colaConRechazo() {
    const { banco, s } = await conInicio()
    // La hora de acción es válida para el teléfono (ahora = T0 + 10 s), pero el servidor la recibe «antes»: tiempo-invalido.
    const arrancar = { cmdId: 'ar', tipo: 'arrancar-reloj', datos: {}, tiempo: T(T0 + 10_000) }
    let e = enc(s, arrancar, ctx(T0 + 10_000))
    e = enc(e, SIG('sp', T0 + 10_000), ctx(T0 + 10_000))
    e = enc(e, PUNTOS('p2', T0 + 10_000), ctx(T0 + 10_000))
    e = enc(e, FALTA('f2', T0 + 10_000), ctx(T0 + 10_000))
    const m = env(e, 'ar')
    const { recibo, tipo } = await enviarAlServidor(banco, m.entradas.find((f) => f.cmdId === 'ar').cuerpoJson, T0)
    return { banco, e, m, recibo, tipo }
  }
  it('el servidor rechaza por tiempo-invalido aunque el teléfono lo aceptara', async () => {
    const { recibo, tipo } = await colaConRechazo()
    expect(tipo).toBe('rechazado')
    expect(recibo.motivo).toBe('tiempo-invalido')
  })
  it('la entrada queda rechazada (nunca «confirmada»), la base no cambia de revisión y la secuencia decidida sí avanza', async () => {
    const { m, recibo } = await colaConRechazo()
    const a = await aplica(m, recibo)
    expect(a.r.tipo).toBe('aplicar')
    const antes = m.sesion.base
    expect(a.s.sesion.base.estado.rev).toBe(antes.estado.rev)
    expect(a.s.sesion.base.estado).toBe(antes.estado) // el MISMO estado: sin derivar nada
    expect(a.s.sesion.base.ultimoClientSeq).toBe(recibo.clientSeq)
    expect(a.s.entradas.find((f) => f.cmdId === 'ar')).toMatchObject({ estado: 'rechazada', reserva: 0 })
    expect(a.s.entradas.find((f) => f.cmdId === 'ar').recibo.motivo).toBe('tiempo-invalido')
    expect(a.s.sesion.detenida).toMatchObject({ causa: 'rechazo-definitivo', cmdId: 'ar', motivo: 'tiempo-invalido' })
  })
  it('las dependientes pasan a no-aplicada y se conservan byte a byte; nada se reintroduce solo', async () => {
    const { e, m, recibo } = await colaConRechazo()
    const a = await aplica(m, recibo)
    for (const c of ['sp', 'p2', 'f2']) {
      const antes = e.entradas.find((f) => f.cmdId === c)
      const despues = a.s.entradas.find((f) => f.cmdId === c)
      expect(despues).toMatchObject({ estado: 'no-aplicada', motivoNoAplicada: 'dependiente-de-rechazo', reserva: 0 })
      expect(despues.cuerpoJson).toBe(antes.cuerpoJson)
      expect(despues.clientSeq).toBe(antes.clientSeq)
    }
    expect(prepararEncolado(a.s.sesion, a.s.entradas, PUNTOS(), ctx())).toMatchObject({ tipo: 'rechazo', rechazo: { motivo: 'cola-detenida' } })
    expect(prepararEnvio(a.s.sesion, a.s.entradas, 'sp')).toMatchObject({ motivo: 'cola-detenida' })
  })
  it('un rechazo que no cuadra (revisión que sube, efectos) es parada, no aplicación', async () => {
    const { m, recibo } = await colaConRechazo()
    const r1 = JSON.parse(JSON.stringify(recibo))
    r1.revDespues += 1
    expect(evaluarRecibo(m.sesion, m.entradas, r1, await huellaDeRecibo(r1), ctx())).toMatchObject({ causa: 'revision-de-rechazo' })
    const r2 = JSON.parse(JSON.stringify(recibo))
    r2.refs.eventosNuevos = ['x']
    expect(evaluarRecibo(m.sesion, m.entradas, r2, await huellaDeRecibo(r2), ctx())).toMatchObject({ causa: 'rechazo-con-efectos' })
  })
  it('el motivo y el detalle largos se recortan por construcción; el hash cubre el original', async () => {
    const { m, recibo } = await colaConRechazo()
    const largo = JSON.parse(JSON.stringify(recibo))
    largo.motivo = 'm'.repeat(1000)
    largo.detalle = { x: 'y'.repeat(2000) }
    const c = recortarRecibo(largo)
    expect(c.motivo.length).toBe(LIMITES.motivoMax)
    expect(c.detalle).toEqual({ truncado: true })
    expect(await huellaDeRecibo(largo)).not.toBe(await huellaDeRecibo(recibo))
    expect(m).toBeTruthy()
  })
})

describe('instantánea frente a la base derivada', () => {
  it('sin entradas en vuelo: iguales → verificada; la base no cambia', async () => {
    const { banco, s } = await conInicio()
    const c = compararInstantanea(s.sesion, s.entradas, cuerpoDeServidor(banco), ctx())
    expect(c.tipo).toBe('verificada')
    expect(c.sesion.verificacion).toEqual({ nivel: 'verificada', verificadaRev: s.sesion.base.estado.rev })
    expect(c.sesion.base).toBe(s.sesion.base)
  })
  it('con órdenes sin enviar sigue siendo exacta (no están en el servidor)', async () => {
    const { banco, s } = await conInicio()
    const e = enc(s, PUNTOS('a'))
    expect(compararInstantanea(e.sesion, e.entradas, cuerpoDeServidor(banco), ctx()).tipo).toBe('verificada')
  })
  it('con una orden «enviando» NO se interpreta ni se adopta', async () => {
    const { banco, s } = await conInicio()
    const m = env(enc(s, PUNTOS('a')), 'a')
    const c = compararInstantanea(m.sesion, m.entradas, cuerpoDeServidor(banco), ctx())
    expect(c).toEqual({ tipo: 'no-aplicable', motivo: 'entrada-en-vuelo' })
  })
  it('distinta → divergencia con las diferencias; nunca se infiere la aceptación', async () => {
    const { banco, s } = await conInicio()
    // El servidor aceptó una orden que el teléfono no conoce todavía como resuelta (queda «enviando» → no aplicable)…
    const m = env(enc(s, PUNTOS('a')), 'a')
    await enviarAlServidor(banco, m.entradas.find((f) => f.cmdId === 'a').cuerpoJson)
    // …y si el teléfono tuviera «pendiente» esa orden y el servidor ya la tuviera, la instantánea difiere:
    const c = compararInstantanea(enc(s, PUNTOS('a')).sesion, enc(s, PUNTOS('a')).entradas, cuerpoDeServidor(banco), ctx())
    expect(c.tipo).toBe('divergencia')
    expect(c.diferencias).toEqual(expect.arrayContaining(['rev', 'eventos', 'ultimoClientSeq']))
    expect(c.sesion.base).toBe(s.sesion.base)
    expect(c.sesion.divergencia).toMatchObject({ causa: 'instantanea-distinta' })
  })
  it('un cuerpo inválido no cambia nada', async () => {
    const { s } = await conInicio()
    expect(compararInstantanea(s.sesion, s.entradas, { version: 9 }, ctx())).toMatchObject({ tipo: 'invalida' })
    expect(compararInstantanea(s.sesion, s.entradas, null, ctx()).tipo).toBe('invalida')
  })
  it('cada campo del estado cuenta: reloj, periodo, auditoría y cursor', async () => {
    const { banco, s } = await conInicio()
    const cuerpo = cuerpoDeServidor(banco)
    for (const cambiar of [
      (c) => { c.estado.partido.relojRestante -= 1 },
      (c) => { c.estado.auditSeq += 1 },
      (c) => { c.estado.cursorReloj = 5 },
      (c) => { c.estado.partido.estado = 'final' },
      (c) => { c.cursor.rev += 1 },
    ]) {
      const c = JSON.parse(JSON.stringify(cuerpo))
      cambiar(c)
      expect(compararInstantanea(s.sesion, s.entradas, c, ctx()).tipo).toBe('divergencia')
    }
  })
})

describe('reanudar tras un rechazo definitivo', () => {
  async function inicioRechazado() {
    const banco = servidorNuevo()
    const prep = preparacionDePrueba(PARTIDO)
    let s = { sesion: sesionDe(banco), entradas: [] }
    s = enc(s, ordenDeInicio({ cmdId: 'ini1', preparacion: prep, tiempo: T(T0), sesion: s.sesion }).orden)
    banco.adaptador.fijarPreparacion(preparacionConCambioDeNumero(PARTIDO)) // la plantilla cambió: la preparación capturada quedó vieja
    s = env(s, 'ini1')
    const { recibo, tipo } = await enviarAlServidor(banco, s.entradas[0].cuerpoJson)
    expect(tipo).toBe('rechazado')
    expect(recibo.motivo).toBe('preparacion-desactualizada')
    const a = await aplica(s, recibo)
    return { banco, s: a.s }
  }
  it('el inicio rechazado deja el inicio SIN confirmar, la cola detenida y la entrada preservada', async () => {
    const { s } = await inicioRechazado()
    expect(s.sesion.inicio).toBe('sin-iniciar')
    expect(s.sesion.detenida.causa).toBe('rechazo-definitivo')
    expect(s.entradas[0]).toMatchObject({ estado: 'rechazada' })
    expect(puntuacionHabilitada(s.sesion, s.entradas)).toEqual({ habilitada: false, motivo: 'inicio-rechazado' })
    expect(prepararEncolado(s.sesion, s.entradas, PUNTOS(), ctx())).toMatchObject({ tipo: 'rechazo', motivo: 'inicio-rechazado' })
  })
  it('exige confirmación del operador, una instantánea que coincida con el cursor y una preparación fresca, íntegra y lista', async () => {
    const { banco, s } = await inicioRechazado()
    const cuerpo = cuerpoDeServidor(banco)
    const nueva = preparacionConCambioDeNumero(PARTIDO)
    const base = { cuerpoEstado: cuerpo, preparacion: nueva, confirmadoPorOperador: true }
    expect(reanudarTrasRechazo(s.sesion, s.entradas, { ...base, confirmadoPorOperador: false })).toMatchObject({ motivo: 'falta-confirmacion' })
    expect(reanudarTrasRechazo(s.sesion, s.entradas, { ...base, confirmadoPorOperador: undefined })).toMatchObject({ motivo: 'falta-confirmacion' })
    expect(reanudarTrasRechazo(s.sesion, s.entradas, { ...base, cuerpoEstado: null })).toMatchObject({ motivo: 'instantanea-invalida' })
    const adelantada = JSON.parse(JSON.stringify(cuerpo))
    adelantada.cursor.ultimoClientSeq += 1
    expect(reanudarTrasRechazo(s.sesion, s.entradas, { ...base, cuerpoEstado: adelantada })).toMatchObject({ motivo: 'servidor-no-coincide' })
    expect(reanudarTrasRechazo(s.sesion, s.entradas, { ...base, preparacion: null })).toMatchObject({ motivo: 'preparacion-no-disponible' })
    expect(reanudarTrasRechazo(s.sesion, s.entradas, { ...base, preparacion: preparacionNoLista(PARTIDO) }).tipo).toBe('rechazo')
    expect(reanudarTrasRechazo(s.sesion, s.entradas, { ...base, preparacion: preparacionDePrueba('OTRO') })).toMatchObject({ motivo: 'preparacion-no-disponible' })
  })
  it('reanudar reemplaza la base por la instantánea fresca (verificada), baja la cola detenida y conserva lo rechazado; hace falta un cmdId NUEVO', async () => {
    const { banco, s } = await inicioRechazado()
    const r = reanudarTrasRechazo(s.sesion, s.entradas, { cuerpoEstado: cuerpoDeServidor(banco), preparacion: preparacionConCambioDeNumero(PARTIDO), confirmadoPorOperador: true })
    expect(r.tipo).toBe('ok')
    const t = fusion(s, r)
    expect(t.sesion.detenida).toBeNull()
    expect(t.sesion.verificacion).toEqual({ nivel: 'verificada', verificadaRev: 0 })
    expect(t.sesion.siguienteSeq).toBe(2)
    expect(t.entradas[0]).toEqual({ ...s.entradas[0] }) // la rechazada no cambió
    const prep = preparacionConCambioDeNumero(PARTIDO)
    const mismo = ordenDeInicio({ cmdId: 'ini1', preparacion: prep, tiempo: T(T0), sesion: t.sesion }).orden
    expect(prepararEncolado(t.sesion, t.entradas, mismo, ctx())).toMatchObject({ tipo: 'rechazo', motivo: 'cmdId-reutilizado' })
    const nuevo = ordenDeInicio({ cmdId: 'ini2', preparacion: prep, tiempo: T(T0), sesion: t.sesion }).orden
    const e = prepararEncolado(t.sesion, t.entradas, nuevo, ctx())
    expect(e.tipo).toBe('ok')
    expect(e.entradas[0].clientSeq).toBe(2)
  })
  it('sin un rechazo definitivo no hay nada que reanudar', async () => {
    const { s } = await conInicio()
    expect(reanudarTrasRechazo(s.sesion, s.entradas, { cuerpoEstado: null, confirmadoPorOperador: true })).toMatchObject({ motivo: 'no-reanudable' })
  })
})

describe('validación de filas', () => {
  it('detecta registros corruptos sin lanzar', async () => {
    const { s } = await conInicio()
    const e = enc(s, PUNTOS('a'))
    const f = e.entradas.at(-1)
    expect(validarFilaEntrada(f, 'L1:P').ok).toBe(true)
    for (const mala of [
      { ...f, estado: 'rara' }, { ...f, cuerpoJson: '' }, { ...f, clientSeq: 0 }, { ...f, recibo: {} },
      { ...f, estado: 'confirmada' }, { ...f, estado: 'no-aplicada', reserva: 5 }, { ...f, reciboHuella: 'xyz' }, null, 'texto',
    ]) expect(validarFilaEntrada(mala, 'L1:P').ok).toBe(false)
    expect(validarFilaSesion({}, 'L1:P').ok).toBe(false)
    expect(validarFilaSesion(null, 'L1:P').ok).toBe(false)
    expect(validarFilaSesion({ ...e.sesion, uso: e.sesion.uso }, 'OTRO').ok).toBe(false)
    expect(validarSesionYEntradas(e.sesion, [f, f]).motivo).toBe('entrada:orden-o-repeticion')
    expect(validarSesionYEntradas({ ...e.sesion, siguienteSeq: 1 }, e.entradas).motivo).toBe('sesion:secuencia')
  })
  it('una fila de entrada con el cuerpo cambiado se detecta al reconstruir la cola', async () => {
    const { s } = await conInicio()
    const e = enc(s, PUNTOS('a'))
    const mala = e.entradas.map((f) => (f.cmdId === 'a' ? { ...f, cuerpoJson: f.cuerpoJson.replace('"E1"', '"E2"').replace('"J1"', '"J9"').replace('"cmdId":"a"', '"cmdId":"b"') } : f))
    expect(colaDeFilas(e.sesion, mala)).toMatchObject({ ok: false, motivo: 'cuerpo-incoherente' })
    expect(colaDeFilas(e.sesion, e.entradas.map((f) => (f.cmdId === 'a' ? { ...f, cuerpoJson: '{' } : f)))).toMatchObject({ ok: false, motivo: 'cuerpo-ilegible' })
  })
})

describe('vista derivada', () => {
  it('base confirmada y provisional separados; el provisional se reconstruye de la base + las órdenes vivas', async () => {
    const { s } = await conInicio()
    const e = enc(enc(s, PUNTOS('a')), FALTA('b'))
    const v = vistaDe(e.sesion, e.entradas, ctx())
    expect(v.ok).toBe(true)
    expect(v.confirmado.rev).toBe(1)
    expect(v.estadoProvisional.rev).toBe(3)
    expect(v.estadoProvisional.eventos.map((x) => x.id)).toEqual(['a', 'b'])
    expect(v.pendientes).toBe(2)
    expect(v.nivelBase).toBe('derivada')
  })
  it('tras una recarga tardía no hay falso aviso de futuro (se usa la mayor hora de acción guardada)', async () => {
    const { banco, s } = await conInicio()
    const arr = { cmdId: 'ar', tipo: 'arrancar-reloj', datos: {}, tiempo: T(T0 + 500) }
    const e = enc(s, arr, ctx(T0 + 500))
    // el reloj de «ahora» al recargar quedó 10 s atrás de la acción guardada
    expect(vistaDe(e.sesion, e.entradas, ctx(T0 - 10_000)).ok).toBe(true)
    expect(banco).toBeTruthy()
  })
  it('una cola corrupta o que ya no se reproduce se informa, sin reescribir nada', async () => {
    const { s } = await conInicio()
    const e = enc(s, PUNTOS('a'))
    const torcida = { ...e.sesion, base: { ...e.sesion.base, estado: { ...e.sesion.base.estado, partido: { ...e.sesion.base.estado.partido, estado: 'final' } } } }
    expect(vistaDe(torcida, e.entradas, ctx())).toMatchObject({ ok: false, motivo: 'divergencia-local', estadoProvisional: null })
    expect(vistaDe(e.sesion, e.entradas.map((f) => ({ ...f, cuerpoJson: 'x' })), ctx())).toMatchObject({ ok: false, motivo: 'registro-corrupto' })
  })
})

describe('medición', () => {
  it('cuenta bytes UTF-8, no caracteres, más una sobrecarga fija por fila', async () => {
    const { s } = await conInicio()
    const e = enc(s, PUNTOS('a'))
    const f = e.entradas.at(-1)
    const grande = { ...f, cuerpoJson: `${f.cuerpoJson}€🏀` }
    expect(medirEntrada(grande) - medirEntrada(f)).toBe(3 + 4)
    expect(medirSesion(e.sesion)).toBeGreaterThan(LIMITES.sobrecargaFila)
    expect(medirSesion({ ...e.sesion, uso: { bytes: 9e9, comandos: 9, reservado: 9, sobreReserva: true } })).toBe(medirSesion(e.sesion)) // su propio contador no cuenta
  })
})
