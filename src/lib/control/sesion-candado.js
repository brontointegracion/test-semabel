// ---------------------------------------------------------------------------
// CANDADO de la sesión de puntuación (REPORT_125): un Web Lock EXCLUSIVO por liga y partido. Es coordinación entre pestañas del
// MISMO navegador; no sustituye la autorización del servidor (partido/dispositivo) ni protege nada entre navegadores.
//
//   - Sin Web Locks no hay control: nunca se «finge» propiedad ni se cae a otra cosa (`sin-web-locks`).
//   - Una pestaña que no obtiene el candado queda en SOLO LECTURA y deja UNA petición en cola (bloqueante) para ser promovida
//     cuando el propietario lo suelte. Esa petición se cancela con `cerrar()` (AbortController).
//   - Al obtenerlo se llama a `alAdquirir()` (el llamador vuelve a leer lo durable ANTES de actuar).
//   - Al soltarlo (`cerrar()`) PRIMERO se llama a `alSoltar()` (el llamador cierra el emisor y espera a que terminen sus
//     operaciones de almacenamiento) y SOLO DESPUÉS se libera el candado: nunca hay dos propietarios activos.
//   - Si el candado llega cuando ya se cerró (o cambió la generación) se libera al instante sin llamar a `alAdquirir`.
// `esPropietario()` pasa a falso en cuanto empieza a soltarse, antes de esperar nada.
// ---------------------------------------------------------------------------

export const RE_ID = /^[A-Za-z0-9_-]{1,64}$/
export const nombreCandadoSesion = (ligaId, partidoId) => `sebel-ctl-sesion:${ligaId}:${partidoId}`

/**
 * crearCandado({ ligaId, partidoId, locks?, alAdquirir?, alSoltar?, alCambiar? })
 * estados: 'inicial' | 'sin-web-locks' | 'configuracion' | 'solo-lectura' | 'propietario' | 'soltando' | 'cerrado'
 */
export function crearCandado({
  ligaId, partidoId, locks = globalThis.navigator?.locks, alAdquirir = async () => {}, alSoltar = async () => {}, alCambiar = () => {},
} = {}) {
  let estado = 'inicial'
  let generacion = 0
  let cerrado = false
  let liberar = null // resuelve la promesa que MANTIENE el candado
  let titular = null // promesa de locks.request del candado que se tiene
  let cola = null // { controlador, promesa } de la petición bloqueante
  let adquiriendo = null // promesa de alAdquirir en curso

  const poner = (nuevo) => { if (estado !== nuevo) { estado = nuevo; try { alCambiar(nuevo) } catch { /* un oyente no rompe el candado */ } } }

  /** Cuerpo del callback de locks.request: se mantiene el candado mientras esta promesa no se resuelva. */
  async function mantener(g) {
    if (cerrado || g !== generacion) return // llegó tarde: se libera sin hacer nada
    let soltar
    const fin = new Promise((r) => { soltar = r })
    liberar = soltar
    poner('propietario')
    adquiriendo = (async () => { try { await alAdquirir() } catch { /* el llamador informa su propio fallo */ } })()
    await adquiriendo
    await fin
  }

  async function iniciar() {
    if (cerrado) return estado
    if (typeof ligaId !== 'string' || typeof partidoId !== 'string' || !RE_ID.test(ligaId) || !RE_ID.test(partidoId)) { poner('configuracion'); return estado }
    if (!locks || typeof locks.request !== 'function') { poner('sin-web-locks'); return estado }
    const nombre = nombreCandadoSesion(ligaId, partidoId)
    const g = generacion
    const libre = await new Promise((resolver) => {
      let resuelto = false
      const decidir = (v) => { if (!resuelto) { resuelto = true; resolver(v) } }
      titular = locks.request(nombre, { mode: 'exclusive', ifAvailable: true }, (lock) => {
        if (!lock) { decidir(false); return undefined }
        decidir(true)
        return mantener(g)
      }).catch(() => { decidir(false) })
    })
    if (cerrado) return estado
    if (libre) return estado
    // Ocupado: solo lectura y UNA petición en cola para ser promovida.
    titular = null
    poner('solo-lectura')
    const controlador = new AbortController()
    cola = { controlador, promesa: null }
    cola.promesa = locks.request(nombre, { mode: 'exclusive', signal: controlador.signal }, (lock) => {
      if (!lock) return undefined
      cola = null
      return mantener(g)
    }).catch(() => { /* cancelada (cierre) o rechazada: sigue en solo lectura / cerrado */ })
    titular = cola.promesa
    return estado
  }

  /** Suelta ordenadamente: primero `alSoltar` (cierre del emisor y de sus operaciones), después el candado. */
  async function cerrar() {
    if (cerrado) return
    cerrado = true
    generacion += 1
    if (cola) { try { cola.controlador.abort() } catch { /* nada */ } }
    if (estado === 'propietario') {
      poner('soltando')
      try { await adquiriendo } catch { /* nada */ }
      try { await alSoltar() } catch { /* el llamador informa su propio fallo */ }
      if (liberar) liberar()
    }
    try { await titular } catch { /* nada */ }
    cola = null
    poner('cerrado')
  }

  return Object.freeze({
    iniciar,
    cerrar,
    estado: () => estado,
    esPropietario: () => estado === 'propietario',
  })
}
