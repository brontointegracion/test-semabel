// ---------------------------------------------------------------------------
// Lectura de cuerpos JSON con límite de BYTES, por flujo.
//
//   - Content-Length es solo una pista temprana: si ya declara más que el límite, se rechaza sin leer. Nunca es
//     la única defensa (puede faltar, ser falso o no coincidir con lo que llega).
//   - Se cuentan los bytes REALES de cada trozo; en cuanto la suma supera el límite se deja de leer y se CANCELA el
//     flujo (no se consume el resto). Se cuentan bytes, no caracteres (UTF-8 de varios bytes).
//   - Los trozos se juntan antes de decodificar, así un carácter partido entre dos trozos no se estropea. Un UTF-8
//     inválido es un cuerpo inválido, no se "repara".
//   - Un error del flujo (cliente que corta, flujo roto) no se propaga: es un cuerpo inválido.
//   - Nunca se registra ni se devuelve contenido del cuerpo: solo un código fijo.
//
// → { valor } | { estado: 413, error: 'cuerpo-demasiado-grande' } | { estado: 400, error: 'json-invalido' }
// `peticion` es cualquier objeto con `headers.get` y `body` (un Request sirve).
// ---------------------------------------------------------------------------

const DEMASIADO_GRANDE = Object.freeze({ estado: 413, error: 'cuerpo-demasiado-grande' })
const INVALIDO = Object.freeze({ estado: 400, error: 'json-invalido' })

async function cancelar(lector, cuerpo) {
  try { if (lector) await lector.cancel(); else if (cuerpo) await cuerpo.cancel() } catch { /* ya cerrado o roto: da igual */ }
}

export async function leerJsonConLimite(peticion, max) {
  if (!Number.isSafeInteger(max) || max < 1) throw new Error('limite-de-cuerpo-invalido')
  const cuerpo = peticion.body ?? null

  const declarado = peticion.headers.get('content-length')
  if (declarado !== null && Number.isFinite(Number(declarado)) && Number(declarado) > max) {
    await cancelar(null, cuerpo) // pista temprana: ni se lee
    return DEMASIADO_GRANDE
  }

  const trozos = []
  let total = 0
  if (cuerpo) {
    const lector = cuerpo.getReader()
    try {
      for (;;) {
        const { done, value } = await lector.read()
        if (done) break
        if (!(value instanceof Uint8Array)) { await cancelar(lector); return INVALIDO }
        total += value.byteLength
        if (total > max) { await cancelar(lector); return DEMASIADO_GRANDE }
        trozos.push(value)
      }
    } catch {
      await cancelar(lector)
      return INVALIDO // error del flujo
    }
  }

  const bytes = new Uint8Array(total)
  let posicion = 0
  for (const t of trozos) { bytes.set(t, posicion); posicion += t.byteLength }
  try {
    return { valor: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  } catch {
    return INVALIDO // UTF-8 inválido o JSON mal formado
  }
}
