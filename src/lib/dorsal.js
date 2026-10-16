// ---------------------------------------------------------------------------
// El número de camiseta (dorsal), sin base de datos ni pantallas.
//
// Un número es un entero de 0 a 99 (Decisiones 49 y 50; `0` es un número real
// y `00` no es distinto de `0`). Un número que falta se guarda AUSENTE: la
// propiedad `dorsal` no existe en la ficha. Nunca se guarda `0`, `NaN`, `null`,
// una cadena vacía ni otro marcador en su lugar (Decisión 115).
//
// Aquí vive la lectura estricta de lo que escribe una persona o llega de otro
// código, la regla de la intención explícita "Número pendiente", y los
// ayudantes de presentación y orden que usarán las pantallas más adelante.
// ---------------------------------------------------------------------------

export const DORSAL_MIN = 0
export const DORSAL_MAX = 99

const VACIO = Object.freeze({ tipo: 'vacio' })
const INVALIDO = Object.freeze({ tipo: 'invalido' })

/**
 * Lee un número de camiseta de forma estricta.
 *   { tipo: 'real', valor }  entero 0–99, o texto de solo dígitos (con o sin ceros
 *                            a la izquierda y espacios alrededor) en ese rango
 *   { tipo: 'vacio' }        undefined, null, o texto vacío / solo espacios
 *   { tipo: 'invalido' }     todo lo demás: booleanos, arreglos, objetos, NaN,
 *                            Infinity, negativos, fracciones, fuera de rango,
 *                            texto con algo que no sea un dígito
 *
 * Un texto en blanco NUNCA es cero: `Number('  ')` vale 0 y por eso no se usa.
 */
export function leerDorsal(valor) {
  if (valor === undefined || valor === null) return VACIO

  if (typeof valor === 'number') {
    if (!Number.isInteger(valor) || valor < DORSAL_MIN || valor > DORSAL_MAX) return INVALIDO
    return { tipo: 'real', valor: valor === 0 ? 0 : valor } // normaliza -0
  }

  if (typeof valor === 'string') {
    const t = valor.trim()
    if (t === '') return VACIO
    if (!/^[0-9]+$/.test(t)) return INVALIDO
    const n = Number(t)
    return n <= DORSAL_MAX ? { tipo: 'real', valor: n } : INVALIDO
  }

  return INVALIDO
}

export const MENSAJES_DORSAL = Object.freeze({
  obligatorio: 'El número es obligatorio.',
  invalido: 'El número debe ser un entero entre 0 y 99.',
  contradictorio: 'Elige un número o márcalo como pendiente, no ambos.',
  'intencion-invalida': 'La marca de número pendiente debe ser verdadera o falsa.',
})

const error = (clave) => ({ tipo: 'error', clave, mensaje: MENSAJES_DORSAL[clave] })

/**
 * Resuelve lo que se pidió para el número de una ficha cuando hay un valor de
 * entrada (alta; edición con `dorsal` presente; reactivación con número nuevo).
 *
 *   { tipo: 'real', valor }   guardar ese entero
 *   { tipo: 'pendiente' }     guardar el número como ausente (intención explícita)
 *   { tipo: 'error', clave, mensaje }
 *
 * `numeroPendiente` es la intención explícita del organizador: debe ser un
 * booleano o no venir. Vacío sin esa intención es un error (no se omite sin
 * querer); un número real junto con la intención es una contradicción; un
 * valor mal formado es un error aunque haya intención de dejarlo pendiente.
 */
export function resolverEntradaDorsal({ dorsal, numeroPendiente } = {}) {
  if (numeroPendiente !== undefined && typeof numeroPendiente !== 'boolean') return error('intencion-invalida')
  const leido = leerDorsal(dorsal)
  if (leido.tipo === 'invalido') return error('invalido')
  if (leido.tipo === 'real') return numeroPendiente === true ? error('contradictorio') : { tipo: 'real', valor: leido.valor }
  return numeroPendiente === true ? { tipo: 'pendiente' } : error('obligatorio')
}

// --- Presentación y orden (puras; todavía no se usan en pantallas) ----------

/** Número guardado en una ficha: entero 0–99, o null si falta o no es utilizable. */
export function dorsalDe(ficha) {
  const d = ficha?.dorsal
  return typeof d === 'number' && Number.isInteger(d) && d >= DORSAL_MIN && d <= DORSAL_MAX ? (d === 0 ? 0 : d) : null
}

export const tieneNumero = (ficha) => dorsalDe(ficha) !== null

/** "7", "0" o "—". */
export function textoDorsal(ficha) {
  const d = dorsalDe(ficha)
  return d === null ? '—' : String(d)
}

/** "#7", "#0" o "—" (sin almohadilla delante de la raya). */
export function etiquetaDorsal(ficha) {
  const d = dorsalDe(ficha)
  return d === null ? '—' : `#${d}`
}

const sinAcentos = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const clavePersona = (f) => (f?.apellido1 !== undefined || f?.nombrePila !== undefined
  ? `${sinAcentos(f.apellido1)} ${sinAcentos(f.nombrePila)} ${sinAcentos(f.apellido2)}`
  : sinAcentos(f?.nombre))
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0) // por unidades de código: no depende de la configuración regional

/**
 * Orden determinista: con número, de menor a mayor (el 0 antes que el 1); sin
 * número, al final; luego apellido, nombre y por último el id de la ficha.
 */
export function compararPorDorsal(a, b) {
  const numA = dorsalDe(a)
  const numB = dorsalDe(b)
  if (numA !== numB) {
    if (numA === null) return 1
    if (numB === null) return -1
    return numA - numB
  }
  return cmp(clavePersona(a), clavePersona(b)) || cmp(String(a?.id ?? ''), String(b?.id ?? ''))
}
