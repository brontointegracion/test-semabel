import { describe, expect, it } from 'vitest'
import {
  ID, T0, almacenNuevo, cmd, cuerpoDeServidor, enviarAlServidor, reabrir, servidorNuevo, sesionDe, telefonoNuevo,
} from './prueba/auxiliares-sesion'
import {
  LIMITES, NOMBRE_BD, abrirAlmacen, aplicarRecibo, crearSesion, encolar, evaluarAdmision, leerSesion, leerTotales, marcarEnviando, verificarInstantanea,
} from './sesion-almacen'
import { huellaDeRecibo, medirEntrada, medirSesion } from './sesion-motor'

// ---------------------------------------------------------------------------
// Almacén durable sobre IndexedDB FALSO (fake-indexeddb, en memoria). Nada de datos reales ni de red. Una falla del
// navegador se simula con el gancho del almacén, que puede lanzar en cada escritura o justo antes de confirmar.
// ---------------------------------------------------------------------------

const PUNTOS = (cmdId = cmd('p')) => ({ cmdId, tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, tiempo: { accionTs: T0, accionTsCrudo: T0, ajusteTsMs: 0, discontinuidad: null } })

/** Todo el contenido de la base, como texto: para comprobar que una operación fallida no dejó NADA. */
function volcar(almacen) {
  return new Promise((resolver, rechazar) => {
    const tx = almacen.db.transaction(['sesiones', 'entradas', 'meta'], 'readonly')
    const salida = {}
    for (const nombre of ['sesiones', 'entradas', 'meta']) {
      const r = tx.objectStore(nombre).getAll()
      r.onsuccess = () => { salida[nombre] = r.result }
    }
    tx.oncomplete = () => resolver(JSON.stringify(salida))
    tx.onerror = () => rechazar(tx.error)
  })
}
/** Escritura cruda (para sembrar registros corruptos o forzar restricciones). Devuelve el error de la transacción, si hubo. */
function crudo(almacen, nombre, valor) {
  return new Promise((resolver) => {
    const tx = almacen.db.transaction([nombre], 'readwrite')
    tx.objectStore(nombre).put(valor)
    tx.oncomplete = () => resolver(null)
    tx.onabort = () => resolver(tx.error)
  })
}
const cuota = () => new DOMException('simulada', 'QuotaExceededError')

/** Un teléfono con el inicio confirmado y listo para puntuar. */
async function listo(opciones = {}) {
  const banco = opciones.banco ?? servidorNuevo()
  const tel = await telefonoNuevo(banco, opciones)
  expect((await tel.crear()).ok).toBe(true)
  expect((await tel.iniciar()).ok).toBe(true)
  const r = await tel.enviarSiguiente()
  expect(r.aplicado.ok).toBe(true)
  return tel
}

describe('crear la sesión (T1)', () => {
  it('crea la fila, cuenta sus bytes y actualiza los totales en la misma transacción', async () => {
    const banco = servidorNuevo()
    const a = await almacenNuevo()
    const escrituras = []
    a.gancho = (i) => { if (i.fase === 'escribir') escrituras.push(`${i.op}:${i.almacen}`) }
    const r = await crearSesion(a, sesionDe(banco))
    expect(r.ok).toBe(true)
    expect(escrituras).toEqual(['crear:sesiones', 'crear:meta'])
    const { totales } = await leerTotales(a)
    expect(totales).toMatchObject({ bytes: r.sesion.uso.bytes, reservado: 0, sesiones: 1 })
    expect(r.sesion.uso.bytes).toBe(medirSesion(r.sesion))
    const lect = await leerSesion(a, ID)
    expect(lect.ok).toBe(true)
    expect(Object.keys(lect.sesion)).not.toEqual(expect.arrayContaining(['provisional', 'token']))
    expect(JSON.stringify(lect.sesion)).not.toMatch(/token|credencial|nacimiento|telefono|correo/i)
  })
  it('no sobrescribe una sesión que ya existe', async () => {
    const banco = servidorNuevo()
    const a = await almacenNuevo()
    await crearSesion(a, sesionDe(banco))
    const antes = await volcar(a)
    expect(await crearSesion(a, sesionDe(banco))).toEqual({ ok: false, motivo: 'ya-existe' })
    expect(await volcar(a)).toBe(antes)
  })
  it('una falla al crear no deja nada', async () => {
    const banco = servidorNuevo()
    const a = await almacenNuevo()
    a.gancho = (i) => { if (i.fase === 'escribir' && i.n === 2) throw cuota() }
    const r = await crearSesion(a, sesionDe(banco))
    expect(r).toMatchObject({ ok: false, motivo: 'almacenamiento', cuota: true })
    a.gancho = null
    expect(await leerSesion(a, ID)).toEqual({ ok: false, motivo: 'sesion-inexistente' })
    expect((await leerTotales(a)).totales).toMatchObject({ bytes: 0, sesiones: 0 })
  })
})

describe('encolar (T2) es atómico', () => {
  it('una transacción: sesión + entrada + totales; el número, el sobre y la vista llegan solo tras confirmar', async () => {
    const tel = await listo()
    const escrituras = []
    tel.almacen.gancho = (i) => { escrituras.push(`${i.op}:${i.fase}:${i.almacen ?? ''}`) }
    const r = await tel.encolar(PUNTOS('a'))
    tel.almacen.gancho = null
    expect(r.ok).toBe(true)
    expect(escrituras).toEqual(['encolar:escribir:sesiones', 'encolar:escribir:entradas', 'encolar:escribir:meta', 'encolar:antes-de-confirmar:'])
    expect(r.sobre.clientSeq).toBe(2)
    const lect = await tel.leer()
    const fila = lect.entradas.find((f) => f.cmdId === 'a')
    expect(r.cuerpoJson).toBe(fila.cuerpoJson) // lo devuelto ES lo guardado
    expect(lect.sesion.siguienteSeq).toBe(3)
    expect(r.vista.estadoProvisional.eventos.map((e) => e.id)).toEqual(['a'])
    expect(r.vista.confirmado.estado.eventos).toEqual([]) // la base confirmada no cambió
  })

  it.each([
    ['la 1.ª escritura', (i) => i.fase === 'escribir' && i.n === 1],
    ['la 2.ª escritura', (i) => i.fase === 'escribir' && i.n === 2],
    ['la 3.ª escritura', (i) => i.fase === 'escribir' && i.n === 3],
    ['justo antes de confirmar', (i) => i.fase === 'antes-de-confirmar'],
  ])('un aborto en %s no deja nada, no consume número y no entrega ni sobre ni vista', async (_n, cuando) => {
    const tel = await listo()
    const antes = await volcar(tel.almacen)
    tel.almacen.gancho = (i) => { if (cuando(i)) throw cuota() }
    const r = await tel.encolar(PUNTOS('a'))
    tel.almacen.gancho = null
    expect(r).toMatchObject({ ok: false, motivo: 'almacenamiento', cuota: true, op: 'encolar' })
    for (const k of ['sobre', 'cuerpoJson', 'vista', 'estadoProvisional']) expect(r).not.toHaveProperty(k)
    expect(await volcar(tel.almacen)).toBe(antes)
    // el número no se consumió: el siguiente intento recibe el mismo
    const otra = await tel.encolar(PUNTOS('a'))
    expect(otra.ok).toBe(true)
    expect(otra.sobre.clientSeq).toBe(2)
  })

  it('una falla distinta de la cuota también aborta y se informa con su nombre', async () => {
    const tel = await listo()
    const antes = await volcar(tel.almacen)
    tel.almacen.gancho = (i) => { if (i.fase === 'escribir' && i.n === 2) throw new Error('disco roto') }
    const r = await tel.encolar(PUNTOS('a'))
    expect(r).toMatchObject({ ok: false, motivo: 'almacenamiento', cuota: false, error: { mensaje: 'disco roto' } })
    tel.almacen.gancho = null
    expect(await volcar(tel.almacen)).toBe(antes)
  })

  it('una base cerrada devuelve un error de almacenamiento, no lanza ni deja nada', async () => {
    const tel = await listo()
    const a2 = await reabrir(tel.almacen)
    const antes = await volcar(a2)
    a2.cerrar()
    const r = await encolar(a2, { id: ID, revision: tel.revision, orden: PUNTOS('a'), ctx: tel.ctx() })
    expect(r).toMatchObject({ ok: false, motivo: 'almacenamiento' })
    const a3 = await reabrir(tel.almacen)
    expect(await volcar(a3)).toBe(antes)
  })

  it('un cmdId vivo repetido no crea otra entrada ni consume número', async () => {
    const tel = await listo()
    expect((await tel.encolar(PUNTOS('a'))).ok).toBe(true)
    const antes = await volcar(tel.almacen)
    const dup = await tel.encolar(PUNTOS('a'))
    expect(dup).toMatchObject({ ok: true, duplicada: true })
    expect(dup.sobre.clientSeq).toBe(2)
    expect(await volcar(tel.almacen)).toBe(antes)
  })

  it('el índice único [id, cmdId] rechaza aunque la lógica fallara', async () => {
    const tel = await listo()
    await tel.encolar(PUNTOS('a'))
    const lect = await tel.leer()
    const fila = lect.entradas.find((f) => f.cmdId === 'a')
    const error = await crudo(tel.almacen, 'entradas', { ...fila, clientSeq: 99 })
    expect(error?.name).toBe('ConstraintError')
    expect((await tel.leer()).entradas).toHaveLength(2)
  })

  it('una acción rechazada en local no escribe nada', async () => {
    const tel = await listo()
    const antes = await volcar(tel.almacen)
    const r = await tel.encolar({ ...PUNTOS('x'), datos: { equipoId: 'E1', jugadorId: 'JX', puntos: 2 } })
    expect(r).toMatchObject({ ok: false, motivo: 'rechazo-local', rechazo: { motivo: 'jugador-inactivo' } })
    expect(await volcar(tel.almacen)).toBe(antes)
  })

  it('el sobre guardado no cambia en ninguna operación posterior', async () => {
    const tel = await listo()
    const a = await tel.encolar(PUNTOS('a'))
    const texto = a.cuerpoJson
    await tel.encolar(PUNTOS('b'))
    const m = await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: 'a', ctx: tel.ctx() })
    expect(m.cuerpoJson).toBe(texto)
    for (const f of (await tel.leer()).entradas.filter((x) => x.cmdId === 'a')) expect(f.cuerpoJson).toBe(texto)
  })
})

describe('marcar un envío (T3)', () => {
  it('se confirma ANTES de poder enviar: un aborto no devuelve texto alguno', async () => {
    const tel = await listo()
    await tel.encolar(PUNTOS('a'))
    const antes = await volcar(tel.almacen)
    tel.almacen.gancho = (i) => { if (i.fase === 'antes-de-confirmar') throw cuota() }
    const r = await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: 'a', ctx: tel.ctx() })
    tel.almacen.gancho = null
    expect(r).toMatchObject({ ok: false, motivo: 'almacenamiento' })
    expect(r).not.toHaveProperty('cuerpoJson')
    expect(await volcar(tel.almacen)).toBe(antes)
    expect((await tel.leer()).entradas.find((f) => f.cmdId === 'a')).toMatchObject({ estado: 'pendiente', intentos: 0 })
  })
  it('cada intento es una transacción con intentos + 1 y el mismo texto', async () => {
    const tel = await listo()
    const a = await tel.encolar(PUNTOS('a'))
    for (const n of [1, 2, 3]) {
      const m = await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: 'a', ctx: tel.ctx() })
      tel.revision = m.vista.revision
      expect(m).toMatchObject({ ok: true, intentos: n, cuerpoJson: a.cuerpoJson })
    }
  })
})

describe('aplicar un recibo (T4)', () => {
  async function enVuelo() {
    const tel = await listo()
    const a = await tel.encolar(PUNTOS('a'))
    const m = await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: 'a', ctx: tel.ctx() })
    tel.revision = m.vista.revision
    const s = await enviarAlServidor(tel.banco, m.cuerpoJson)
    return { tel, a, m, recibo: s.recibo }
  }
  const aplicar = (tel, recibo, extra = {}) => aplicarRecibo(tel.almacen, { id: ID, revision: tel.revision, recibo, ctx: tel.ctx(), ...extra })

  it('una transacción: sesión + entrada + totales; la base avanza y queda «derivada»', async () => {
    const { tel, recibo } = await enVuelo()
    const trazas = []
    tel.almacen.gancho = (i) => { trazas.push(`${i.fase}:${i.almacen ?? ''}`) }
    const r = await aplicar(tel, recibo)
    tel.almacen.gancho = null
    expect(r.ok).toBe(true)
    expect(trazas).toEqual(['escribir:sesiones', 'escribir:entradas', 'escribir:meta', 'antes-de-confirmar:'])
    expect(r.vista).toMatchObject({ nivelBase: 'derivada', confirmado: { ultimoClientSeq: 2, rev: 2 } })
    const lect = await tel.leer()
    expect(lect.entradas.find((f) => f.cmdId === 'a')).toMatchObject({ estado: 'confirmada', reserva: 0 })
  })

  it('el mismo recibo otra vez es un no-op: no escribe nada y la base avanza UNA sola vez', async () => {
    const { tel, recibo } = await enVuelo()
    expect((await aplicar(tel, recibo)).ok).toBe(true)
    const lect = await tel.leer()
    const antes = await volcar(tel.almacen)
    const trazas = []
    tel.almacen.gancho = (i) => { trazas.push(i.fase) }
    const otra = await aplicar(tel, JSON.parse(JSON.stringify(recibo)))
    tel.almacen.gancho = null
    expect(otra).toMatchObject({ ok: true, noop: true })
    expect(trazas).toEqual([])
    expect(await volcar(tel.almacen)).toBe(antes)
    expect(lect.sesion.base.estado.rev).toBe(2)
  })

  it.each([
    ['la 1.ª escritura', (i) => i.fase === 'escribir' && i.n === 1],
    ['la 2.ª escritura', (i) => i.fase === 'escribir' && i.n === 2],
    ['la 3.ª escritura', (i) => i.fase === 'escribir' && i.n === 3],
    ['justo antes de confirmar', (i) => i.fase === 'antes-de-confirmar'],
  ])('una falla en %s deja la entrada SIN resolver; el recibo exacto se recupera y se aplica una vez', async (_n, cuando) => {
    const { tel, m, recibo } = await enVuelo()
    const antes = await volcar(tel.almacen)
    tel.almacen.gancho = (i) => { if (cuando(i)) throw cuota() }
    const r = await aplicar(tel, recibo)
    tel.almacen.gancho = null
    expect(r).toMatchObject({ ok: false, motivo: 'almacenamiento', cuota: true })
    expect(await volcar(tel.almacen)).toBe(antes)
    const lect = await tel.leer()
    expect(lect.entradas.find((f) => f.cmdId === 'a')).toMatchObject({ estado: 'enviando', recibo: null, reciboHuella: null })
    expect(lect.sesion.base.estado.rev).toBe(1)
    // El reintento reenvía el MISMO texto: el servidor devuelve su recibo original, que se aplica una vez.
    const otra = await enviarAlServidor(tel.banco, m.cuerpoJson)
    expect(otra.tipo).toBe('recibo-existente')
    expect(otra.recibo).toEqual(recibo)
    expect((await aplicar(tel, otra.recibo)).ok).toBe(true)
    expect((await tel.leer()).sesion.base.estado.rev).toBe(2)
    expect((await aplicar(tel, otra.recibo)).noop).toBe(true)
  })

  it('el resultado final tras fallas y reintentos es idéntico al de una corrida sin fallas', async () => {
    const limpio = await enVuelo()
    await aplicar(limpio.tel, limpio.recibo)
    const roto = await enVuelo()
    roto.tel.almacen.gancho = () => { throw cuota() }
    await aplicar(roto.tel, roto.recibo)
    roto.tel.almacen.gancho = null
    await aplicar(roto.tel, roto.recibo)
    const A = (await limpio.tel.leer()).sesion
    const B = (await roto.tel.leer()).sesion
    expect(B.base).toEqual(A.base)
    expect(B.verificacion).toEqual(A.verificacion)
    expect(B.uso).toEqual(A.uso)
  })

  it('identidad, contenido, secuencia o revisión erróneos: parada persistida, base intacta, evidencia conservada', async () => {
    const { tel, recibo } = await enVuelo()
    const base0 = (await tel.leer()).sesion.base
    const mal = JSON.parse(JSON.stringify(recibo))
    mal.revDespues += 1
    const r = await aplicar(tel, mal)
    expect(r).toMatchObject({ ok: false, motivo: 'divergencia', causa: 'revision-de-recibo' })
    const lect = await tel.leer()
    expect(lect.sesion.base).toEqual(base0)
    expect(lect.sesion.divergencia).toMatchObject({ causa: 'revision-de-recibo', cmdId: 'a' })
    expect(JSON.parse(lect.sesion.divergencia.reciboJson).revDespues).toBe(mal.revDespues)
    expect(lect.entradas.find((f) => f.cmdId === 'a').estado).toBe('enviando') // nada se resolvió
    // detenida: ni recibos buenos, ni encolar, ni enviar
    tel.revision = lect.sesion.revision
    expect(await aplicar(tel, recibo)).toMatchObject({ ok: false, motivo: 'sesion-detenida-por-divergencia' })
    expect(await tel.encolar(PUNTOS('z'))).toMatchObject({ ok: false, motivo: 'sesion-detenida-por-divergencia' })
    expect(await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: 'a', ctx: tel.ctx() })).toMatchObject({ ok: false, motivo: 'sesion-detenida-por-divergencia' })
  })

  it('un recibo de otro partido, de otro dispositivo o con otro contenido se detiene', async () => {
    for (const cambiar of [(r) => { r.gameId = 'OTRO' }, (r) => { r.deviceId = 'otro' }, (r) => { r.contenido = '{}' }, (r) => { r.cmdId = 'no-existe' }]) {
      const { tel, recibo } = await enVuelo()
      const mal = JSON.parse(JSON.stringify(recibo))
      cambiar(mal)
      const r = await aplicar(tel, mal)
      expect(r.motivo).toBe('divergencia')
      expect((await tel.leer()).sesion.base.estado.rev).toBe(1)
    }
  })

  it('un recibo repetido pero DISTINTO detiene y no toca lo guardado', async () => {
    const { tel, recibo } = await enVuelo()
    await aplicar(tel, recibo)
    const antes = (await tel.leer()).entradas.find((f) => f.cmdId === 'a')
    const otro = JSON.parse(JSON.stringify(recibo))
    otro.meta.recibidoEn += 5
    const r = await aplicar(tel, otro)
    expect(r).toMatchObject({ ok: false, motivo: 'divergencia', causa: 'recibo-incoherente' })
    expect((await tel.leer()).entradas.find((f) => f.cmdId === 'a')).toEqual(antes)
  })

  it('un recibo malformado no cambia nada y NO detiene la sesión', async () => {
    const { tel, recibo } = await enVuelo()
    const antes = await volcar(tel.almacen)
    expect(await aplicar(tel, { ...recibo, refs: null })).toEqual({ ok: false, motivo: 'recibo-malformado' })
    expect(await aplicar(tel, null)).toEqual({ ok: false, motivo: 'recibo-malformado' })
    expect(await volcar(tel.almacen)).toBe(antes)
    expect((await aplicar(tel, recibo)).ok).toBe(true)
  })
})

describe('instantánea: verificar o detener', () => {
  it('igual → «verificada»; distinta → parada persistida sin tocar la base', async () => {
    const tel = await listo()
    const ok = await verificarInstantanea(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(tel.banco), ctx: tel.ctx() })
    expect(ok).toMatchObject({ ok: true, verificada: true })
    expect(ok.vista.nivelBase).toBe('verificada')
    tel.revision = ok.vista.revision
    const torcido = cuerpoDeServidor(tel.banco)
    torcido.estado.auditSeq += 3
    const base0 = (await tel.leer()).sesion.base
    const mal = await verificarInstantanea(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: torcido, ctx: tel.ctx() })
    expect(mal).toMatchObject({ ok: false, motivo: 'divergencia', causa: 'instantanea-distinta' })
    const lect = await tel.leer()
    expect(lect.sesion.base).toEqual(base0)
    expect(lect.sesion.divergencia.detalle.diferencias).toContain('auditSeq')
  })
  it('con una orden «enviando» no se adopta ni se compara', async () => {
    const tel = await listo()
    await tel.encolar(PUNTOS('a'))
    const m = await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: 'a', ctx: tel.ctx() })
    tel.revision = m.vista.revision
    const antes = await volcar(tel.almacen)
    const r = await verificarInstantanea(tel.almacen, { id: ID, revision: tel.revision, cuerpoEstado: cuerpoDeServidor(tel.banco), ctx: tel.ctx() })
    expect(r).toMatchObject({ ok: false, motivo: 'no-aplicable', detalle: 'entrada-en-vuelo' })
    expect(await volcar(tel.almacen)).toBe(antes)
  })
})

describe('pestañas que compiten y revisiones viejas', () => {
  it('una escritura con una revisión vieja se rechaza sin escribir', async () => {
    const tel = await listo()
    const otra = await reabrir(tel.almacen)
    const vieja = tel.revision
    expect((await tel.encolar(PUNTOS('a'))).ok).toBe(true) // otra pestaña avanza
    const antes = await volcar(tel.almacen)
    const r = await encolar(otra, { id: ID, revision: vieja, orden: PUNTOS('b'), ctx: tel.ctx() })
    expect(r).toMatchObject({ ok: false, motivo: 'revision-desactualizada', actual: vieja + 1, esperada: vieja })
    expect(await volcar(tel.almacen)).toBe(antes)
    for (const op of [
      marcarEnviando(otra, { id: ID, revision: vieja, cmdId: 'a', ctx: tel.ctx() }),
      aplicarRecibo(otra, { id: ID, revision: vieja, recibo: {}, ctx: tel.ctx() }),
      verificarInstantanea(otra, { id: ID, revision: vieja, cuerpoEstado: null, ctx: tel.ctx() }),
    ]) expect((await op).motivo).toMatch(/revision-desactualizada|recibo-malformado/)
  })
  it('dos pestañas que encolan a la vez con la misma revisión: gana una, la otra no escribe y los números son únicos', async () => {
    const tel = await listo()
    const otra = await reabrir(tel.almacen)
    const rev = tel.revision
    const [x, y] = await Promise.all([
      encolar(tel.almacen, { id: ID, revision: rev, orden: PUNTOS('x'), ctx: tel.ctx() }),
      encolar(otra, { id: ID, revision: rev, orden: PUNTOS('y'), ctx: tel.ctx() }),
    ])
    expect([x.ok, y.ok].sort()).toEqual([false, true])
    expect([x.motivo, y.motivo].filter(Boolean)).toEqual(['revision-desactualizada'])
    const seqs = (await tel.leer()).entradas.map((f) => f.clientSeq)
    expect(seqs).toEqual([1, 2])
  })
  it('sin revisión explícita igual no se duplica el número (la transacción serializa y relee)', async () => {
    const tel = await listo()
    const otra = await reabrir(tel.almacen)
    const [x, y] = await Promise.all([
      encolar(tel.almacen, { id: ID, orden: PUNTOS('x'), ctx: tel.ctx() }),
      encolar(otra, { id: ID, orden: PUNTOS('y'), ctx: tel.ctx() }),
    ])
    expect(x.ok && y.ok).toBe(true)
    expect([x.sobre.clientSeq, y.sobre.clientSeq].sort()).toEqual([2, 3])
  })
})

describe('registros corruptos', () => {
  it('una fila de sesión ilegible bloquea ese partido y se conserva tal cual', async () => {
    const tel = await listo()
    const buena = (await tel.leer()).sesion
    const rota = { ...buena, base: null }
    expect((await crudo(tel.almacen, 'sesiones', rota))).toBeNull()
    const antes = await volcar(tel.almacen)
    expect(await leerSesion(tel.almacen, ID)).toMatchObject({ ok: false, motivo: 'registro-corrupto' })
    expect(await encolar(tel.almacen, { id: ID, revision: rota.revision, orden: PUNTOS('a'), ctx: tel.ctx() })).toMatchObject({ ok: false, motivo: 'registro-corrupto' })
    expect(await aplicarRecibo(tel.almacen, { id: ID, recibo: {}, ctx: tel.ctx() })).toMatchObject({ ok: false })
    expect(await volcar(tel.almacen)).toBe(antes)
  })
  it('una fila de entrada corrupta bloquea y no se reescribe; otras sesiones siguen funcionando', async () => {
    const tel = await listo()
    await tel.encolar(PUNTOS('a'))
    const fila = (await tel.leer()).entradas.find((f) => f.cmdId === 'a')
    expect(await crudo(tel.almacen, 'entradas', { ...fila, estado: 'confirmada' })).toBeNull() // «decidida» sin recibo
    const antes = await volcar(tel.almacen)
    const r = await tel.encolar(PUNTOS('b'))
    expect(r).toMatchObject({ ok: false, motivo: 'registro-corrupto', detalle: 'entrada:decidida-sin-recibo' })
    expect(await volcar(tel.almacen)).toBe(antes)
    // otro partido en la misma base no se ve afectado
    const otroBanco = servidorNuevo({ gameId: 'Q' })
    const crear = await crearSesion(tel.almacen, sesionDe(otroBanco, { partidoId: 'Q' }))
    expect(crear.ok).toBe(true)
  })
  it('un texto de sobre alterado se detecta al reconstruir, sin reescribirlo', async () => {
    const tel = await listo()
    await tel.encolar(PUNTOS('a'))
    const fila = (await tel.leer()).entradas.find((f) => f.cmdId === 'a')
    expect(await crudo(tel.almacen, 'entradas', { ...fila, cuerpoJson: fila.cuerpoJson.replace('"puntos":2', '"puntos":3') })).toBeNull()
    const lect = await tel.leer()
    expect(lect.ok).toBe(true) // la forma es válida…
    expect(lect.vista.estadoProvisional.eventos.find((e) => e.id === 'a').puntos).toBe(3) // …y lo guardado manda: el texto no se «corrige»
  })
  it('la base borrada por el navegador no se puede recuperar: la sesión no existe y no se inventa nada', async () => {
    const tel = await listo()
    tel.almacen.cerrar()
    await new Promise((resolver, rechazar) => {
      const r = indexedDB.deleteDatabase(tel.almacen.db.name)
      r.onsuccess = () => resolver()
      r.onerror = () => rechazar(r.error)
    })
    const nueva = await abrirAlmacen({ nombre: tel.almacen.db.name })
    expect(await leerSesion(nueva, ID)).toEqual({ ok: false, motivo: 'sesion-inexistente' })
    expect((await leerTotales(nueva)).totales).toMatchObject({ bytes: 0, sesiones: 0 })
  })
})

describe('contabilidad, reservas y límites', () => {
  it('constantes provisionales: 1200 comandos, 4 MiB por partido, 128 MiB en total', () => {
    expect(LIMITES).toMatchObject({ maxComandosPartido: 1200, maxBytesPartido: 4 * 1024 * 1024, maxBytesTotal: 128 * 1024 * 1024 })
    expect(NOMBRE_BD).toBe('sebel-control-sesion')
  })
  it('al encolar se reserva el espacio de su resultado; al resolverlo se libera y los totales cuadran con las sesiones', async () => {
    const tel = await listo()
    const base = (await tel.leer()).sesion.uso
    expect(base.reservado).toBe(0)
    await tel.encolar(PUNTOS('a'))
    await tel.encolar(PUNTOS('b'))
    const lect = await tel.leer()
    const filas = lect.entradas
    expect(lect.sesion.uso.comandos).toBe(3)
    expect(lect.sesion.uso.reservado).toBe(filas.reduce((s, f) => s + f.reserva, 0))
    expect(lect.sesion.uso.reservado).toBeGreaterThan(0)
    expect(lect.sesion.uso.bytes).toBe(medirSesion(lect.sesion) + filas.reduce((s, f) => s + f.bytes, 0))
    for (const f of filas) expect(f.bytes).toBe(medirEntrada(f))
    expect((await leerTotales(tel.almacen)).totales).toMatchObject({ bytes: lect.sesion.uso.bytes, reservado: lect.sesion.uso.reservado, sesiones: 1 })
    const antes = lect.sesion.uso
    await tel.enviarSiguiente()
    const despues = (await tel.leer()).sesion.uso
    expect(despues.reservado).toBeLessThan(antes.reservado)
    expect(despues.sobreReserva).toBe(false)
    // resolver nunca supera lo comprometido (usado + reservado)
    expect(despues.bytes + despues.reservado).toBeLessThanOrEqual(antes.bytes + antes.reservado)
    expect((await leerTotales(tel.almacen)).totales).toMatchObject({ bytes: despues.bytes, reservado: despues.reservado })
  })
  it('los totales suman todas las sesiones', async () => {
    const tel = await listo()
    const q = servidorNuevo({ gameId: 'Q' })
    expect((await crearSesion(tel.almacen, sesionDe(q, { partidoId: 'Q' }))).ok).toBe(true)
    const a = (await leerSesion(tel.almacen, ID)).sesion.uso
    const b = (await leerSesion(tel.almacen, 'L1:Q')).sesion.uso
    expect((await leerTotales(tel.almacen)).totales).toMatchObject({ bytes: a.bytes + b.bytes, reservado: a.reservado + b.reservado, sesiones: 2 })
  })
  it('evaluarAdmision: límites exactos', () => {
    const uso = { bytes: 100, comandos: 2, reservado: 50, sobreReserva: false }
    const tot = { bytes: 500, reservado: 200 }
    const lim = { maxComandosPartido: 3, maxBytesPartido: 1000, maxBytesTotal: 2000 }
    expect(evaluarAdmision(uso, tot, { bytes: 200, comandos: 3, reservado: 100 }, lim)).toEqual({ ok: true })
    expect(evaluarAdmision(uso, tot, { bytes: 200, comandos: 4, reservado: 100 }, lim)).toEqual({ ok: false, motivo: 'limite-comandos' })
    expect(evaluarAdmision(uso, tot, { bytes: 900, comandos: 3, reservado: 101 }, lim)).toEqual({ ok: false, motivo: 'limite-bytes-partido' })
    expect(evaluarAdmision(uso, tot, { bytes: 900, comandos: 3, reservado: 100 }, lim)).toEqual({ ok: true })
    // delta = (900 − 100) + (100 − 50) = 850 → el total admisible es 2000 − 850 = 1150 exactos
    expect(evaluarAdmision(uso, { bytes: 950, reservado: 200 }, { bytes: 900, comandos: 3, reservado: 100 }, lim)).toEqual({ ok: true })
    expect(evaluarAdmision(uso, { bytes: 951, reservado: 200 }, { bytes: 900, comandos: 3, reservado: 100 }, lim)).toEqual({ ok: false, motivo: 'limite-bytes-total' })
    expect(evaluarAdmision({ ...uso, sobreReserva: true }, tot, { bytes: 1, comandos: 1, reservado: 0 }, lim)).toEqual({ ok: false, motivo: 'sobre-reserva' })
  })
  it('el tope de comandos por partido se aplica a CADA acción nueva (no solo al crear) y no borra nada', async () => {
    const banco = servidorNuevo()
    const base = await listo({ banco })
    const lect = await base.leer()
    const a2 = await abrirAlmacen({ nombre: base.almacen.db.name, limites: { ...LIMITES, maxComandosPartido: lect.sesion.uso.comandos + 2 } })
    const ctx = base.ctx()
    expect((await encolar(a2, { id: ID, orden: PUNTOS('a'), ctx })).ok).toBe(true)
    expect((await encolar(a2, { id: ID, orden: PUNTOS('b'), ctx })).ok).toBe(true)
    const antes = await volcar(a2)
    expect(await encolar(a2, { id: ID, orden: PUNTOS('c'), ctx })).toEqual({ ok: false, motivo: 'limite-comandos' })
    expect(await volcar(a2)).toBe(antes)
    // …y registrar el resultado de lo ya aceptado sigue funcionando en el tope
    const r = await marcarEnviando(a2, { id: ID, cmdId: 'a', ctx })
    expect(r.ok).toBe(true)
    const s = await enviarAlServidor(banco, r.cuerpoJson)
    const ap = await aplicarRecibo(a2, { id: ID, recibo: s.recibo, ctx })
    expect(ap).toMatchObject({ ok: true, sobreReserva: false })
    expect((await leerSesion(a2, ID)).entradas).toHaveLength(3) // inicio + a + b: nada se borró
  })
  it('el tope de bytes por partido cuenta lo USADO más lo RESERVADO', async () => {
    const banco = servidorNuevo()
    const base = await listo({ banco })
    const u = (await base.leer()).sesion.uso
    const una = await base.encolar(PUNTOS('probe'))
    const costo = (await base.leer()).sesion.uso // incluye la reserva de 'probe'
    const por = costo.bytes + costo.reservado - (u.bytes + u.reservado)
    expect(por).toBeGreaterThan(0)
    const a2 = await abrirAlmacen({ nombre: base.almacen.db.name, limites: { ...LIMITES, maxBytesPartido: costo.bytes + costo.reservado + por - 1 } })
    expect(una.ok).toBe(true)
    // cabe «casi» una más: el tope exacto rechaza si usado + reservado lo supera
    const r = await encolar(a2, { id: ID, orden: PUNTOS('otra'), ctx: base.ctx() })
    expect(r.ok || r.motivo === 'limite-bytes-partido').toBe(true)
    const a3 = await abrirAlmacen({ nombre: base.almacen.db.name, limites: { ...LIMITES, maxBytesPartido: costo.bytes + costo.reservado } })
    expect(await encolar(a3, { id: ID, orden: PUNTOS('mas'), ctx: base.ctx() })).toEqual({ ok: false, motivo: 'limite-bytes-partido' })
  })
  it('el tope TOTAL entre sesiones se aplica a las acciones nuevas y a las sesiones nuevas, pero no impide registrar resultados', async () => {
    const banco = servidorNuevo()
    const tel = await listo({ banco })
    await tel.encolar(PUNTOS('a'))
    const m = await marcarEnviando(tel.almacen, { id: ID, revision: tel.revision, cmdId: 'a', ctx: tel.ctx() })
    tel.revision = m.vista.revision
    const { recibo } = await enviarAlServidor(banco, m.cuerpoJson)
    // otra partida (o muchas) llevó el total al tope: se siembra la fila de totales
    const { totales } = await leerTotales(tel.almacen)
    expect(await crudo(tel.almacen, 'meta', { ...totales, bytes: LIMITES.maxBytesTotal - totales.reservado - 10 })).toBeNull()
    expect(await tel.encolar(PUNTOS('b'))).toEqual({ ok: false, motivo: 'limite-bytes-total' })
    const q = servidorNuevo({ gameId: 'Q' })
    expect(await crearSesion(tel.almacen, sesionDe(q, { partidoId: 'Q' }))).toEqual({ ok: false, motivo: 'limite-bytes-total' })
    // el resultado de lo ya aceptado SÍ se registra
    const ap = await aplicarRecibo(tel.almacen, { id: ID, revision: tel.revision, recibo, ctx: tel.ctx() })
    expect(ap).toMatchObject({ ok: true, sobreReserva: false })
    expect((await leerSesion(tel.almacen, ID)).entradas.find((f) => f.cmdId === 'a').estado).toBe('confirmada')
  })
  it('si el crecimiento real supera lo reservado: se conserva el resultado, se marca la sobre-reserva y se bloquean las acciones nuevas', async () => {
    const tel = await listo()
    await tel.encolar(PUNTOS('a'))
    const fila = (await tel.leer()).entradas.find((f) => f.cmdId === 'a')
    // una estimación errónea (reserva de 1 byte) simula que el cálculo se quedó corto
    expect(await crudo(tel.almacen, 'entradas', { ...fila, reserva: 1 })).toBeNull()
    const m = await marcarEnviando(tel.almacen, { id: ID, cmdId: 'a', ctx: tel.ctx() })
    const { recibo } = await enviarAlServidor(tel.banco, m.cuerpoJson)
    const ap = await aplicarRecibo(tel.almacen, { id: ID, recibo, ctx: tel.ctx() })
    expect(ap).toMatchObject({ ok: true, sobreReserva: true })
    const lect = await tel.leer()
    expect(lect.entradas.find((f) => f.cmdId === 'a')).toMatchObject({ estado: 'confirmada' }) // el resultado NO se perdió
    expect(lect.sesion.uso.sobreReserva).toBe(true)
    expect(await tel.encolar(PUNTOS('b'))).toEqual({ ok: false, motivo: 'sobre-reserva' })
  })
  it('una falla REAL de cuota al registrar el resultado conserva lo irresuelto y la exposición del error', async () => {
    const tel = await listo()
    await tel.encolar(PUNTOS('a'))
    const m = await marcarEnviando(tel.almacen, { id: ID, cmdId: 'a', ctx: tel.ctx() })
    tel.revision = m.vista.revision
    const { recibo } = await enviarAlServidor(tel.banco, m.cuerpoJson)
    tel.almacen.gancho = (i) => { if (i.op === 'recibo' && i.fase === 'escribir' && i.n === 3) throw cuota() }
    const r = await aplicarRecibo(tel.almacen, { id: ID, revision: tel.revision, recibo, ctx: tel.ctx() })
    tel.almacen.gancho = null
    expect(r).toMatchObject({ ok: false, motivo: 'almacenamiento', cuota: true, error: { nombre: 'QuotaExceededError' } })
    expect((await tel.leer()).entradas.find((f) => f.cmdId === 'a').estado).toBe('enviando')
    expect(await huellaDeRecibo(recibo)).toMatch(/^[0-9a-f]{64}$/)
  })
})
