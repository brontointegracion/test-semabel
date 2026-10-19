import { firmaDeReglas } from '../../reglas-categoria'
import { camposDeReloj, crearEstado } from '../estado'

// ---------------------------------------------------------------------------
// ADAPTADOR DE MEMORIA — SOLO PARA PRUEBAS. NO ES DURABLE.
//
// Sirve para probar la lógica de decisión del motor y su comportamiento ante
// fallos inyectados (nada parcial, nada publicado, sin doble aplicación). No
// prueba reinicio del servidor, persistencia, concurrencia real entre procesos
// ni teléfonos reales: nada de eso se puede afirmar con un Map en memoria. Un
// adaptador real (Durable Object, IndexedDB) debe pasar los mismos escenarios
// y aportar su propia evidencia.
// ---------------------------------------------------------------------------

const copia = (v) => structuredClone(v)

export function crearAdaptadorMemoria({
  estado,
  credenciales = { 'cred-A': { gameId: 'P', deviceId: 'tel-A', actorId: 'yo' } },
  ultimoClientSeq = 0,
  recibosIniciales = {},
  preparacion = null,
} = {}) {
  let almacen = {
    estado: estado ?? crearEstado({ gameId: 'P', partido: { estado: 'vivo', ...camposDeReloj('detenido', 600000, null) } }),
    ultimoClientSeq,
    recibos: copia(recibosIniciales),
    cmdPorSeq: Object.fromEntries(Object.values(recibosIniciales).map((r) => [r.clientSeq, r.cmdId])),
    auditoria: [],
    bloqueo: null,
    versionBloqueo: 0,
    credenciales: copia(credenciales),
    versionAutorizacion: 0,
    bandeja: [],
    cuarentena: [],
    preparacion: copia(preparacion),
  }
  const entregados = []
  const ganchos = { trasLeer: null, falloEn: null, destino: (m) => { entregados.push(copia(m)) } }
  let cola = Promise.resolve()
  let conteoConfirmaciones = 0
  let conteoLecturas = 0

  // Versión del contexto de preparación vigente (null si no hay uno con versión).
  const versionPreparacionVigente = () => (typeof almacen.preparacion?.version === 'string' ? almacen.preparacion.version : null)

  const autorizacionDe = ({ gameId, credencial }) => {
    const version = almacen.versionAutorizacion
    const c = typeof credencial === 'string' && Object.prototype.hasOwnProperty.call(almacen.credenciales, credencial)
      ? almacen.credenciales[credencial]
      : null
    if (!c) return { autorizado: false, motivo: 'credencial-invalida', version }
    if (c.revocada) return { autorizado: false, motivo: 'credencial-revocada', version }
    if (c.gameId !== gameId || gameId !== almacen.estado.gameId) return { autorizado: false, motivo: 'juego-distinto', version }
    return { autorizado: true, gameId: c.gameId, deviceId: c.deviceId, actorId: c.actorId, version }
  }

  function verificarEsperado(esperado) {
    return esperado.rev === almacen.estado.rev
      && esperado.ultimoClientSeq === almacen.ultimoClientSeq
      && esperado.versionBloqueo === almacen.versionBloqueo
      && esperado.versionAutorizacion === almacen.versionAutorizacion
      // Solo el inicio del partido trae esta clave: las demás órdenes no chocan por la plantilla.
      && (!('versionPreparacion' in esperado) || esperado.versionPreparacion === versionPreparacionVigente())
      // Idem para las reglas de categoría que decidieron el inicio (firma).
      && (!('firmaReglas' in esperado) || esperado.firmaReglas === firmaDeReglas(almacen.estado.config))
  }

  function fallar(punto) {
    if (ganchos.falloEn === punto) {
      ganchos.falloEn = null
      throw new Error(`fallo inyectado: ${punto}`)
    }
  }

  const adaptador = {
    esDeMemoriaSoloParaPruebas: true,

    transaccion(gameId, fn) {
      const corrida = cola.then(async () => {
        let borrador = null
        const tx = {
          async autorizar(peticion) { return autorizacionDe(peticion) },
          async leerVista(sobre) {
            conteoLecturas += 1
            const vista = {
              estado: copia(almacen.estado),
              ultimoClientSeq: almacen.ultimoClientSeq,
              reciboPorCmdId: copia(almacen.recibos[sobre.cmdId] ?? null),
              reciboPorSeq: copia(almacen.recibos[almacen.cmdPorSeq[sobre.clientSeq]] ?? null),
              bloqueo: copia(almacen.bloqueo),
              versionBloqueo: almacen.versionBloqueo,
              preparacion: copia(almacen.preparacion),
            }
            // Simula que "alguien más" cambió algo entre leer y confirmar.
            if (ganchos.trasLeer) { const g = ganchos.trasLeer; ganchos.trasLeer = null; g(adaptador) }
            return vista
          },
          async confirmar({ esperado, recibo, efectos, estadoDespues, mensaje }) {
            if (!verificarEsperado(esperado)) return { conflicto: true }
            fallar('antes-de-confirmar')
            borrador = copia(almacen)
            borrador.recibos[recibo.cmdId] = copia(recibo)
            fallar('tras-recibo')
            borrador.cmdPorSeq[recibo.clientSeq] = recibo.cmdId
            borrador.ultimoClientSeq = recibo.clientSeq
            if (efectos) {
              borrador.estado = copia(estadoDespues)
              borrador.auditoria.push(...copia(efectos.auditoria))
              borrador.bandeja.push({ rev: recibo.revDespues, mensaje: copia(mensaje), entregado: false })
            }
            fallar('durante-confirmar')
            return { ok: true }
          },
          async registrarCuarentena({ esperado, sobre, recibidoEn }) {
            if (!verificarEsperado(esperado)) return { conflicto: true }
            borrador = copia(almacen)
            borrador.cuarentena.push({ sobre: copia(sobre), recibidoEn })
            return { ok: true }
          },
        }
        const salida = await fn(tx) // si lanza, el borrador se descarta: nada se escribió
        if (borrador) { almacen = borrador; conteoConfirmaciones += 1 }
        return salida
      })
      cola = corrida.catch(() => {})
      return corrida
    },

    async publicarPendientes() {
      for (const item of almacen.bandeja) {
        if (item.entregado) continue
        fallar('publicar')
        ganchos.destino(item.mensaje)
        item.entregado = true
      }
    },

    // --- Controles y lecturas para las pruebas ---
    ganchos,
    bloquear(info = { por: 'organizador', motivo: 'prueba' }) { almacen.bloqueo = info; almacen.versionBloqueo += 1 },
    desbloquear() { almacen.bloqueo = null; almacen.versionBloqueo += 1 },
    otorgar(credencial, info) { almacen.credenciales[credencial] = copia(info); almacen.versionAutorizacion += 1 },
    revocar(credencial) { almacen.credenciales[credencial].revocada = true; almacen.versionAutorizacion += 1 },
    /** Cambia la atribución de confianza (lo que haría el adaptador real al cambiar la plantilla). */
    fijarAtribucion(atribucion) { almacen.estado.atribucion = copia(atribucion) },
    /** Cambia el contexto de preparación vigente (lo que haría el adaptador real al cambiar la plantilla). */
    fijarPreparacion(prep) { almacen.preparacion = copia(prep) },
    /** Solo pruebas: cambia la config del partido (p. ej. unas reglas de categoría) como lo haría una edición del servidor. */
    fijarConfig(cambios) { almacen.estado.config = { ...almacen.estado.config, ...copia(cambios) } },
    preparacion: () => copia(almacen.preparacion),
    /** Cuántas veces se leyó la vista (recibos, estado, preparación): debe seguir en 0 si no hubo autorización. */
    lecturasDeVista: () => conteoLecturas,
    estado: () => copia(almacen.estado),
    recibos: () => copia(almacen.recibos),
    auditoria: () => copia(almacen.auditoria),
    cuarentena: () => copia(almacen.cuarentena),
    bandeja: () => copia(almacen.bandeja),
    entregados: () => copia(entregados),
    ultimoClientSeq: () => almacen.ultimoClientSeq,
    confirmaciones: () => conteoConfirmaciones,
    foto: () => copia(almacen),
  }
  return adaptador
}
