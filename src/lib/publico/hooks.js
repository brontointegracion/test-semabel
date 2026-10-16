import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { adquirir, espiar, estadoInicial, refrescarRecurso } from './recurso.js'
import { huboSalto } from './reloj-servidor.js'

// Ganchos de React sobre los recursos públicos. Ninguna pantalla pública lee la base local ni datos del prototipo.

/**
 * Un recurso. Mientras la clave no esté montada devuelve el estado inicial (nunca los datos de otra clave: al cambiar de
 * partido por la ruta no se ve el anterior ni un instante). `def` debe ser estable mientras no cambie su clave.
 */
export function useRecurso(def) {
  const clave = def?.clave ?? null
  const defRef = useRef(def)
  defRef.current = def
  const sostenido = useRef(null)
  const suscribir = useCallback((aviso) => {
    if (clave === null) return () => {}
    const mio = adquirir(defRef.current)
    sostenido.current = mio
    const quitar = mio.recurso.suscribir(aviso)
    aviso()
    return () => { quitar(); mio.liberar(); if (sostenido.current === mio) sostenido.current = null }
  }, [clave])
  const leer = useCallback(() => (clave === null ? estadoInicial() : espiar(clave)), [clave])
  return useSyncExternalStore(suscribir, leer, leer)
}

/** Varios recursos a la vez (uno por liga configurada) con un único suscriptor y una instantánea estable. */
export function useRecursos(defs) {
  const claves = defs.map((d) => d.clave).join('|')
  const defsRef = useRef(defs)
  defsRef.current = defs
  const cache = useRef({ llave: '', valor: [] })
  const suscribir = useCallback((aviso) => {
    const mios = defsRef.current.map((d) => adquirir(d))
    const quitar = mios.map((m) => m.recurso.suscribir(aviso))
    aviso()
    return () => { quitar.forEach((q) => q()); mios.forEach((m) => m.liberar()) }
  }, [claves])
  const leer = useCallback(() => {
    const estados = defsRef.current.map((d) => espiar(d.clave))
    const llave = `${claves}#${estados.map((e) => e.version).join(',')}`
    if (cache.current.llave !== llave) cache.current = { llave, valor: estados }
    return cache.current.valor
  }, [claves])
  return useSyncExternalStore(suscribir, leer, leer)
}

/**
 * Reloj monotónico de la pantalla: `mono` se actualiza cada `cadenciaMs` mientras `activo`, y `saltoMono` marca el último
 * instante en que se detectó que el reloj de pared saltó respecto del monotónico (suspensión, cambio de hora). Una muestra
 * de hora del servidor tomada ANTES de ese instante ya no es confiable.
 */
export function useMono({ activo = true, cadenciaMs = 500 } = {}) {
  const [mono, setMono] = useState(() => performance.now())
  const [saltoMono, setSaltoMono] = useState(null)
  useEffect(() => {
    if (!activo) return undefined
    let ultimo = { pared: Date.now(), mono: performance.now() }
    const id = setInterval(() => {
      const ahora = { pared: Date.now(), mono: performance.now() }
      if (huboSalto(ultimo, ahora)) setSaltoMono(ahora.mono)
      ultimo = ahora
      setMono(ahora.mono)
    }, cadenciaMs)
    return () => clearInterval(id)
  }, [activo, cadenciaMs])
  return { mono, saltoMono }
}

/** Cómo está la información que se muestra, según el estado del recurso y el instante monotónico `mono`. */
export function frescura(estado, mono, { periodoMs, saltoMono = null }) {
  const edadMs = estado.ultimoExito ? mono - estado.ultimoExito.mono : null
  const falloReciente = estado.error !== null
  const vencida = edadMs !== null && edadMs > 3 * periodoMs
  const muestraInvalida = estado.muestra !== null && saltoMono !== null && saltoMono > estado.muestra.monoMedio
  return {
    edadMs,
    sinActualizar: estado.datos !== null && (falloReciente || vencida || muestraInvalida),
    // el reloj en marcha solo se puede seguir mostrando mientras la muestra sea reciente y confiable
    relojConfiable: estado.muestra !== null && !vencida && !muestraInvalida,
  }
}

/** Función para el botón «Actualizar» de un recurso montado (no hace nada si no lo está o si es demasiado pronto). */
export function useRefrescar(clave) {
  return useCallback(() => (clave === null ? undefined : refrescarRecurso(clave)), [clave])
}
