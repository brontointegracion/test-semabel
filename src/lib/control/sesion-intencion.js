// ---------------------------------------------------------------------------
// De la intención del operador al controlador (REPORT_128). PURO: sin red, sin almacenamiento, sin relojes, sin React.
//
//   - Una INTENCIÓN es «lo que la persona quiso hacer» (p. ej. +2 a este jugador). Genera UN cmdId criptográfico, que se retiene
//     mientras dura el intento de registrarla y NUNCA se regenera si el resultado es incierto (una excepción inesperada).
//   - Mientras la promesa de ESA intención está pendiente, otra pulsación igual se ignora (sin retardos arbitrarios).
//   - Los comandos apuntan a ids de registro estables, jamás a números de camiseta.
//   - Los textos (en español) distinguen lo guardado AQUÍ de lo CONFIRMADO por el servidor, y nunca dicen «guardado» si no se guardó.
// ---------------------------------------------------------------------------

/** UUID criptográfico (o 16 bytes aleatorios en hexadecimal). Sin `crypto`, falla: nunca se cae a Math.random. */
export function nuevoCmdId(prefijo = 'op', cripto = globalThis.crypto) {
  if (cripto && typeof cripto.randomUUID === 'function') return `${prefijo}-${cripto.randomUUID()}`
  if (cripto && typeof cripto.getRandomValues === 'function') {
    const b = cripto.getRandomValues(new Uint8Array(16))
    return `${prefijo}-${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
  }
  throw new Error('sin-criptografia')
}

/** La intención y su clave de «misma intención» (para impedir el doble envío mientras está pendiente). */
export const INTENCIONES = Object.freeze({
  anotar: (equipoId, jugadorId, puntos) => ({ clave: `anotar:${jugadorId}:${puntos}`, tipo: 'anotar', datos: { equipoId, jugadorId, puntos } }),
  falta: (equipoId, jugadorId) => ({ clave: `falta:${jugadorId}`, tipo: 'falta', datos: { equipoId, jugadorId } }),
  deshacer: () => ({ clave: 'deshacer', tipo: 'deshacer', datos: {} }),
  rehacer: () => ({ clave: 'rehacer', tipo: 'rehacer', datos: {} }),
  anular: (eventoId) => ({ clave: `anular-evento:${eventoId}`, tipo: 'anular-evento', datos: { eventoId } }),
  arrancar: () => ({ clave: 'reloj', tipo: 'arrancar-reloj', datos: {} }),
  detener: () => ({ clave: 'reloj', tipo: 'detener-reloj', datos: {} }),
  corregir: (restanteMs) => ({ clave: 'corregir-reloj', tipo: 'corregir-reloj', datos: { restanteMs } }),
  siguientePeriodo: () => ({ clave: 'siguiente-periodo', tipo: 'siguiente-periodo', datos: {} }),
  cerrar: () => ({ clave: 'cerrar-partido', tipo: 'cerrar-partido', datos: {} }),
  iniciar: () => ({ clave: 'iniciar-partido', tipo: 'iniciar-partido', datos: {} }),
})

/**
 * Registro de intenciones en curso. `ejecutar(intencion, accion)` llama a `accion(cmdId)` UNA vez por intención:
 *   - la misma clave pendiente → { duplicada: true } sin llamar a nada;
 *   - el cmdId se crea al primer intento y se conserva si `accion` LANZA (resultado incierto: el reintento usa el MISMO);
 *   - tras un resultado conocido (ok o rechazo) se olvida: la siguiente pulsación es una intención NUEVA con otro cmdId.
 */
export function crearRegistroDeIntenciones({ generar = nuevoCmdId } = {}) {
  const pendientes = new Set()
  const retenidos = new Map()
  return {
    pendiente: (clave) => pendientes.has(clave),
    hayPendientes: () => pendientes.size > 0,
    cmdIdRetenido: (clave) => retenidos.get(clave) ?? null,
    async ejecutar(intencion, accion) {
      const { clave } = intencion
      if (pendientes.has(clave)) return { duplicada: true }
      pendientes.add(clave)
      try {
        if (!retenidos.has(clave)) retenidos.set(clave, generar(intencion.tipo))
        const resultado = await accion(retenidos.get(clave))
        retenidos.delete(clave) // resultado conocido
        return { duplicada: false, resultado }
      } catch (e) {
        return { duplicada: false, incierta: true, error: e?.message === 'sin-criptografia' ? 'sin-criptografia' : 'error' } // se conserva el cmdId
      } finally {
        pendientes.delete(clave)
      }
    },
  }
}

/**
 * Forma canónica «mm:ss» del tiempo que escribe la persona (REPORT_210). SOLO normaliza; no mira la duración del periodo.
 *   «mm:ss» / «m:ss» (1–3 dígitos de minutos, dos de segundos)   →  se conserva y se rellena el minuto a dos dígitos: «8:05» → «08:05»
 *   solo dígitos, TRES o CUATRO («mss» / «mmss»)                  →  «845» → «08:45», «0845» → «08:45», «1000» → «10:00»
 *   uno o dos dígitos («8», «45»), cinco o más, o cualquier otro carácter → 'formato' (no se adivina si son minutos o segundos)
 *   segundos > 59 (con o sin los dos puntos: «08:60», «860»)       → 'segundos' (nunca se acomoda a «09:00»)
 * Los espacios de los extremos se ignoran. Nada se redondea, ajusta ni recorta en silencio.
 * → { ok: true, texto } | { ok: false, motivo: 'formato' | 'segundos' }
 */
export function normalizarTiempoReloj(texto) {
  const t = String(texto ?? '').trim()
  let min
  let seg
  const conPuntos = /^(\d{1,3}):(\d{2})$/.exec(t)
  const soloDigitos = /^(\d{1,2})(\d{2})$/.exec(t)
  if (conPuntos) [, min, seg] = conPuntos
  else if (soloDigitos && /^\d+$/.test(t) && t.length >= 3 && t.length <= 4) [, min, seg] = soloDigitos
  else return { ok: false, motivo: 'formato' }
  if (Number(seg) > 59) return { ok: false, motivo: 'segundos' }
  return { ok: true, texto: `${min.padStart(2, '0')}:${seg}` }
}

/** «mm:ss» (o «m:ss», o «mss»/«mmss» sin los dos puntos) → milisegundos restantes, dentro de 0 … máximo. Nada se redondea ni se corrige en silencio. */
export function restanteDeTexto(texto, maximoMs) {
  const n = normalizarTiempoReloj(texto)
  if (!n.ok) return { ok: false, motivo: n.motivo }
  const [m, s] = n.texto.split(':').map(Number)
  const ms = (m * 60 + s) * 1000
  if (ms > maximoMs) return { ok: false, motivo: 'fuera-de-rango' }
  return { ok: true, restanteMs: ms }
}

/** Texto en español para cada motivo de rechazo del tiempo (el mismo en el borde del campo y al enviar). */
export const MENSAJES_TIEMPO_RELOJ = Object.freeze({
  formato: 'Escribe el tiempo como mm:ss, por ejemplo 08:30 (o solo los números: 830).',
  segundos: 'Los segundos deben estar entre 00 y 59.',
  'fuera-de-rango': 'Ese tiempo no cabe en el periodo.',
})

export const MENSAJES_DE_REGISTRO = Object.freeze({
  guardada: 'Guardado en este teléfono. Pendiente de enviar al servidor.',
  duplicada: 'Esa acción ya estaba guardada.',
  'solo-lectura': 'Este partido se está controlando en otra pestaña. Aquí solo puedes mirar.',
  'sin-web-locks': 'Este navegador no permite controlar el partido de forma segura. Usa otro navegador.',
  cerrado: 'El control está cerrado. Vuelve a abrir esta pantalla.',
  'propiedad-perdida': 'Se perdió el control de este partido en esta pestaña. La acción NO se guardó.',
  'sin-identidad': 'Este teléfono no está activado para este partido.',
  'dispositivo-distinto': 'Los datos guardados son de otro teléfono. Este teléfono no puede controlar el partido.',
  'sin-tiempo-confiable': 'Sin hora del servidor no se puede arrancar ni detener el reloj ahora. La acción NO se guardó. Puntos, faltas y cambios de periodo siguen disponibles.',
  almacenamiento: 'No se pudo guardar la acción en este teléfono. NO quedó registrada.',
  'limite-bytes-partido': 'No hay espacio para guardar más acciones de este partido en este teléfono. La acción NO se guardó.',
  'limite-bytes-total': 'No hay espacio en este teléfono para guardar más acciones. La acción NO se guardó.',
  'limite-comandos': 'Se alcanzó el máximo de acciones guardadas de este partido. La acción NO se guardó.',
  'sobre-reserva': 'No hay espacio para guardar más acciones en este teléfono. La acción NO se guardó.',
  'cola-detenida': 'El envío está detenido: la acción NO se guardó. Avisa al organizador.',
  'sesion-detenida-por-divergencia': 'Los datos de este teléfono no coinciden con el servidor. La acción NO se guardó. Avisa al organizador.',
  'inicio-no-confirmado': 'Todavía no hay un inicio confirmado por el servidor: no se puede puntuar.',
  'inicio-en-curso': 'El inicio se está enviando: no se puede puntuar hasta que el servidor lo confirme.',
  'inicio-sin-resolver': 'Este partido ya estaba en marcha y no se puede puntuar desde aquí.',
  'inicio-rechazado': 'El servidor rechazó el inicio: no se puede puntuar.',
  'registro-corrupto': 'Los datos guardados de este partido no se pueden leer. Avisa al organizador.',
  'sin-internet': 'Se necesita conexión a internet para esta acción.',
  'falta-confirmacion': 'Falta tu confirmación.',
  'preparacion-no-disponible': 'La preparación del partido no está disponible todavía. Inténtalo de nuevo en un momento.',
  'estado-no-disponible': 'No se pudo leer el partido en el servidor. Inténtalo de nuevo.',
  'no-autorizado': 'Este teléfono ya no tiene permiso para este partido (el organizador pudo retirar su acceso): no se puede comenzar ni puntuar desde aquí. No se guardó nada. Avisa al organizador.',
  'plantilla-incompleta': 'No se puede comenzar: hay jugadores activos sin número o con número repetido. Corrige la plantilla e inténtalo de nuevo.',
  'atribucion-no-coincide-con-preparacion': 'La plantilla cambió. Vuelve a intentarlo para actualizarla.',
  'atribucion-no-aplicada': 'No hay espacio en este teléfono para actualizar la plantilla.',
  'ya-iniciado': 'El partido ya está iniciado.',
  'reglas-invalidas': 'Las reglas de categoría guardadas para este partido no son válidas: no se puede comenzar. Avisa al organizador.',
})

const RECHAZOS_LOCALES = Object.freeze({
  nada: 'No hay nada que deshacer o rehacer.',
  'limite-periodo': 'Un cambio de periodo no se puede deshacer ni anular.',
  'periodo-invalido': 'No se puede rehacer: esa acción pertenece a otro periodo.',
  'ya-corriendo': 'El reloj ya estaba en marcha.',
  'no-corre': 'El reloj ya estaba detenido.',
  'sin-tiempo': 'No queda tiempo en este periodo.',
  'ultimo-periodo': 'Ya es el último periodo: no hay otro al que pasar.',
  'reloj-corriendo': 'Detén el reloj antes de corregirlo.',
  'fuera-de-rango': 'Ese tiempo no cabe en el periodo.',
  'sin-cambio': 'El reloj ya marcaba ese tiempo.',
  'jugador-inactivo': 'Ese jugador está inactivo.',
  'partido-no-disponible': 'El partido no admite esa acción ahora.',
  'puntos-invalidos': 'Esos puntos no son válidos en este deporte.',
  'reglas-invalidas': 'Las reglas de categoría guardadas para este partido no son válidas: esta acción (inicio, cambio de periodo o corrección del reloj sin duración propia) está bloqueada. Los puntos, las faltas y el cierre siguen disponibles. Avisa al organizador.',
  'reglas-desactualizadas': 'Las reglas de categoría cambiaron desde que se abrió esta pantalla. Actualiza los datos y confirma de nuevo.',
  'reglas-no-confirmadas': 'Esta pantalla no confirmó las reglas de categoría del partido. Actualiza la aplicación y vuelve a intentarlo.',
})

/**
 * Resultado del controlador → { tipo: 'ok' | 'aviso' | 'error', texto }. Un `ok` dice «guardado AQUÍ, pendiente»: la confirmación del
 * servidor llega después y se ve en la lista. Un error nunca dice «guardado».
 */
export function mensajeDeResultado(r, { acepta = MENSAJES_DE_REGISTRO.guardada } = {}) {
  if (r?.duplicada) return { tipo: 'aviso', texto: MENSAJES_DE_REGISTRO.duplicada }
  if (r?.incierta) return { tipo: 'error', texto: r.error === 'sin-criptografia' ? 'Este navegador no puede generar identificadores seguros. La acción NO se guardó.' : 'No se supo si la acción quedó guardada. Revisa la lista antes de repetirla.' }
  const c = r?.resultado ?? r
  if (c?.ok) return c.duplicada ? { tipo: 'aviso', texto: MENSAJES_DE_REGISTRO.duplicada } : { tipo: 'ok', texto: acepta }
  const motivo = c?.motivo
  if (motivo === 'rechazo-local') return { tipo: 'error', texto: `${RECHAZOS_LOCALES[c?.rechazo?.motivo] ?? 'La acción no se guardó.'}` }
  if (motivo === 'cmdId-reutilizado') return { tipo: 'error', texto: 'Esa acción ya se había decidido. No se guardó otra vez.' }
  return { tipo: 'error', texto: MENSAJES_DE_REGISTRO[motivo] ?? 'La acción no se guardó.' }
}

/**
 * Lo que la pantalla debe mostrar y permitir, derivado SOLO del estado del controlador. Cada aviso: { id, nivel, texto, accion? }.
 * No promete reintentos automáticos si el emisor está detenido o sin presupuesto, y no manda parar el partido físico.
 */
export function situacionDeControl(est) {
  const avisos = []
  const aviso = (id, nivel, texto, accion = null) => avisos.push({ id, nivel, texto, ...(accion ? { accion } : {}) })
  const ses = est?.sesion?.ok ? est.sesion : null
  const emisor = est?.emisor ?? null
  const base = { avisos, puedeActuar: false, puedeReloj: false, puedePuntuar: false, mostrarDatos: false }
  if (!est) return base
  if (est.modo === 'cerrado') { aviso('cerrado', 'error', 'El control está cerrado.'); return base }
  if (est.modo === 'sin-web-locks') { aviso('sin-web-locks', 'error', MENSAJES_DE_REGISTRO['sin-web-locks']); return base }
  if (est.modo === 'configuracion') { aviso('configuracion', 'error', 'La dirección del partido no es válida.'); return base }
  if (est.aviso?.tipo === 'sin-identidad') { aviso('sin-identidad', 'error', MENSAJES_DE_REGISTRO['sin-identidad']); return base }
  if (est.aviso?.tipo === 'dispositivo-distinto') { aviso('dispositivo-distinto', 'error', MENSAJES_DE_REGISTRO['dispositivo-distinto']); return base }
  if (est.modo === 'solo-lectura') aviso('solo-lectura', 'info', 'Este partido se está controlando en otra pestaña. Aquí solo puedes mirar.')
  const propietario = est.propietario === true
  if (!ses) {
    if (est.sesion && est.sesion.motivo && est.sesion.motivo !== 'sesion-inexistente') aviso('sesion-ilegible', 'error', MENSAJES_DE_REGISTRO['registro-corrupto'])
    return { ...base, puedeActuar: propietario, mostrarDatos: false }
  }
  const e = emisor?.fase
  const detenida = ses.detenida
  const divergencia = ses.divergencia
  const sinInicio = ses.inicio !== 'confirmado'
  if (divergencia) aviso('divergencia', 'error', 'Los datos de este teléfono no coinciden con el servidor. Avisa al organizador. El partido físico no tiene por qué parar: lo registrado aquí sigue guardado.')
  else if (detenida?.causa === 'transporte' && detenida.clase === 'no-autorizado') aviso('no-autorizado', 'error', 'Este teléfono ya no está autorizado por el servidor. Lo registrado sigue guardado aquí, pero no se enviará. Avisa al organizador.')
  else if (detenida?.causa === 'transporte') aviso('parada', 'error', 'El envío se detuvo por una respuesta inesperada del servidor. Lo registrado sigue guardado aquí, pero no se enviará. Avisa al organizador.')
  else if (detenida?.causa === 'rechazo-definitivo') {
    const ur = ses.ultimoRechazo
    if (ur?.tipo === 'iniciar-partido' && ['reglas-desactualizadas', 'reglas-no-confirmadas'].includes(ur.motivo)) {
      aviso('rechazo', 'error', 'Las reglas de categoría de este partido cambiaron mientras se preparaba el inicio, así que el servidor NO inició el partido y no se guardó ningún cambio. Hay que actualizar la preparación antes de volver a comenzar.')
    } else if (ur?.motivo === 'reglas-invalidas') {
      aviso('rechazo', 'error', 'El servidor bloqueó esa acción porque las reglas de categoría guardadas para este partido no son válidas (bloquea el inicio, el cambio de periodo y la corrección del reloj si el partido no tiene duración propia). No se guardó ningún cambio. Los puntos, las faltas y el cierre siguen permitidos en el servidor, pero el envío de este teléfono quedó detenido: lo guardado aquí se conserva. Avisa al organizador.')
    } else if (ur?.tipo === 'iniciar-partido') {
      aviso('rechazo', 'error', 'El servidor rechazó el inicio del partido (no se inició y no se guardó ningún cambio). Actualiza la preparación para volver a intentarlo o avisa al organizador.')
    } else {
      aviso('rechazo', 'error', 'El servidor rechazó una acción y las siguientes quedaron sin enviar. Sigue guardado aquí. Avisa al organizador.')
    }
  }
  else if (detenida) aviso('detenida', 'error', 'El envío está detenido. Lo registrado sigue guardado aquí. Avisa al organizador.')
  if (est.estados?.includes('parada-solo-en-memoria')) aviso('parada-memoria', 'error', 'El envío se detuvo, pero no se pudo dejar anotado: si recargas esta pantalla podría intentar enviar otra vez.')
  if (est.estados?.includes('capacidad-rechazada')) aviso('capacidad', 'aviso', 'No hay espacio en este teléfono para actualizar los datos de la plantilla. El partido sigue funcionando con los que ya tiene.')
  if (e === 'almacenamiento') aviso('almacenamiento', 'error', 'No se pudo guardar un dato en este teléfono. No cierres esta pestaña.', null)
  if (!divergencia && !detenida) {
    if (sinInicio && ses.enviando > 0) {
      aviso('inicio-incierto', 'aviso', e === 'reintentos-agotados' || e === 'respuestas-malformadas' || e === 'suspendida-retry-after'
        ? 'No sabemos si el servidor recibió el inicio. Se dejaron de hacer intentos: pulsa «Reintentar ahora».'
        : 'No sabemos todavía si el servidor recibió el inicio. Se sigue intentando. No se puede puntuar hasta que lo confirme.', e === 'esperando-reintento' || e === 'enviando' ? null : 'reintentar')
    } else if (e === 'reintentos-agotados' || e === 'respuestas-malformadas') {
      aviso('envio-agotado', 'aviso', 'No se pudo enviar tras varios intentos. Lo registrado sigue guardado aquí. Pulsa «Reintentar ahora».', 'reintentar')
    } else if (e === 'suspendida-retry-after') {
      aviso('espera-servidor', 'aviso', 'El servidor pidió esperar. Lo registrado sigue guardado aquí. Pulsa «Reintentar ahora» más tarde.', 'reintentar')
    } else if (est.conexion?.enLinea === false && (ses.pendientes + ses.enviando) > 0) {
      aviso('sin-conexion', 'info', `Sin conexión. ${ses.pendientes + ses.enviando} ${ses.pendientes + ses.enviando === 1 ? 'acción guardada' : 'acciones guardadas'} en este teléfono; se enviará${ses.pendientes + ses.enviando === 1 ? '' : 'n'} al volver la conexión.`)
    } else if (est.conexion?.enLinea === false) {
      aviso('sin-conexion', 'info', 'Sin conexión. Lo que anotes queda guardado en este teléfono y se enviará al volver la conexión.')
    }
  }
  if (est.colaBloqueadaPorReloj) aviso('reloj-bloqueado', 'aviso', 'Una acción de reloj espera la hora del servidor; las que siguen esperan detrás. Se enviarán cuando haya hora segura.')
  else if (est.reloj && est.reloj.nivel !== 'confiable' && ses.inicio === 'confirmado' && ses.provisional?.partido?.estado === 'vivo') aviso('reloj-no-disponible', 'info', 'Sin hora del servidor: el reloj no se puede arrancar ni detener ahora. Puntos, faltas y cambios de periodo siguen disponibles.')
  const bloqueado = Boolean(divergencia || detenida)
  const puedePuntuar = propietario && !bloqueado && ses.puntuacion?.habilitada === true && ses.visualizacion?.disponible === true && ses.provisional?.partido?.estado === 'vivo'
  const puedeReloj = propietario && !bloqueado && ses.puntuacion?.habilitada === true && ses.provisional?.partido?.estado === 'vivo'
  return { avisos, puedeActuar: propietario && !bloqueado, puedePuntuar, puedeReloj, mostrarDatos: ses.visualizacion?.disponible === true, bloqueado }
}

/** «Guardado aquí, pendiente» o «Confirmado por el servidor» para un evento de la lista (por su id, que deriva del cmdId). */
export function estadoDeEvento(evento, cmdIdsVivos) {
  const cmd = String(evento.id).replace(/:e$/, '')
  return cmdIdsVivos.includes(cmd) ? 'pendiente' : 'confirmado'
}
