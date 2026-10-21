import { useEffect, useRef, useState } from 'react'
import { DURACION_AVISO_MS, estadoInicialReconocimiento, siguienteReconocimiento, textoDeAviso } from './reconocimiento.js'

const DESVANECER_MS = 800

/**
 * Aviso sutil de la última canasta confirmada (ver reconocimiento.js). `datos`: la lectura pública validada del partido (o null);
 * `error`: el error vigente del recurso (un fallo de red o del servidor entre dos lecturas); `activo`: solo con el partido en juego.
 * → null o { seq, texto, visible }. `visible` pasa a false a los 4 s (el CSS lo desvanece) y el aviso se retira poco después.
 * La línea base se vuelve a fijar tras un fallo de lectura y tras volver a ver la pestaña: lo ocurrido mientras no se miraba no se repite.
 */
export function useReconocimiento({ gameId, datos, error, activo }) {
  const [r, setR] = useState(estadoInicialReconocimiento)
  const [mostrado, setMostrado] = useState(null)
  const rebase = useRef(false)

  useEffect(() => { if (error) rebase.current = true }, [error])
  useEffect(() => {
    const alCambiar = () => { if (document.visibilityState === 'hidden') rebase.current = true }
    document.addEventListener('visibilitychange', alCambiar)
    return () => document.removeEventListener('visibilitychange', alCambiar)
  }, [])

  useEffect(() => {
    if (!datos || !gameId) return
    const volver = rebase.current
    rebase.current = false
    // Fuera de juego no hay avisos: solo se actualiza la línea base (un partido que pasa a 'vivo' empieza sin pasado que anunciar).
    setR((previo) => siguienteReconocimiento(previo, { gameId, anotaciones: activo ? datos.anotaciones : [], rebase: volver || !activo }))
  }, [datos, gameId, activo])

  const seq = r.aviso?.seq ?? null
  const equipo = r.aviso ? (r.aviso.lado === 'local' ? datos?.local?.nombre : datos?.visita?.nombre) : null
  useEffect(() => {
    if (seq === null || !r.aviso || equipo == null) { setMostrado(null); return undefined }
    setMostrado({ seq, texto: textoDeAviso(r.aviso, equipo), visible: true })
    const a = window.setTimeout(() => setMostrado((m) => (m && m.seq === seq ? { ...m, visible: false } : m)), DURACION_AVISO_MS)
    const b = window.setTimeout(() => setMostrado((m) => (m && m.seq === seq ? null : m)), DURACION_AVISO_MS + DESVANECER_MS)
    return () => { window.clearTimeout(a); window.clearTimeout(b) }
  }, [seq]) // eslint-disable-line react-hooks/exhaustive-deps
  return mostrado
}
