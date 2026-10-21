import { PERIODOS } from '../reloj-calculo.js'

// ---------------------------------------------------------------------------
// Qué se muestra en el marcador grande (REPORT_191), derivado SOLO de lo que el servidor confirmó. Funciones puras.
//
//   programado     el partido aún no empieza (estado autoritativo 'programado'; la hora nunca lo cambia).
//   juego          en juego: reloj corriendo, o detenido de forma normal (pausa, tiempo muerto, periodo recién preparado).
//   fin-periodo    el servidor confirma el final de un periodo que NO es el último: reloj detenido en 00:00 con el partido en juego.
//   fin-tiempo     lo mismo en el ÚLTIMO periodo: el tiempo terminó pero el partido NO está finalizado; no es un resultado final.
//   final          estado autoritativo 'final'.
//
// Una pausa normal NO es un descanso (el reloj detenido con tiempo restante sigue siendo `juego`). Una cuenta regresiva que llega a 0 en
// el dispositivo NO cambia la vista: solo cuenta lo que confirma el servidor (reloj detenido con restante 0). Al preparar el periodo
// siguiente el servidor publica el restante completo y el periodo nuevo, y la vista vuelve a `juego` sin ninguna lógica adicional.
// ---------------------------------------------------------------------------

export const periodosTotales = (deporte) => PERIODOS[deporte] || 2

export function vistaDelMarcador({ estado, periodo, reloj, deporte }) {
  if (estado === 'final') return 'final'
  if (estado !== 'vivo') return 'programado'
  if (reloj?.estado === 'detenido' && reloj.restanteMs === 0) return periodo >= periodosTotales(deporte) ? 'fin-tiempo' : 'fin-periodo'
  return 'juego'
}

const ORDINAL = { 1: '1.er', 2: '2.º', 3: '3.er', 4: '4.º' }
const UNIDAD = { baloncesto: 'cuarto', futsal: 'tiempo' }
/** «2.º cuarto», «1.er tiempo», o «Periodo 2» para un deporte sin nombre propio. */
export function etiquetaPeriodo(deporte, n) {
  const u = UNIDAD[deporte]
  return u ? `${ORDINAL[n] ?? `${n}.º`} ${u}` : `Periodo ${n}`
}

/**
 * El próximo partido SOLO si se puede determinar sin ambigüedad a partir de un alcance EXPLÍCITO que da quien muestra el marcador.
 *   alcance = { sede: true }   «la misma sede»: el siguiente partido programado en la sede del actual.
 * Sin alcance, o sin sede conocida, o con dos candidatos a la misma hora, o si el siguiente no tiene hora → null (se muestra «sin próximo
 * partido» en lugar de adivinar). Nunca elige el partido del organizador ni cambia de partido solo.
 * `partidos`: la lectura pública de la liga (estado, programadoPara, sede, local/visita con id); `actual`: el partido que se muestra.
 */
export function proximoPartido(partidos, actual, alcance) {
  if (!alcance || alcance.sede !== true || !actual || typeof actual.sede !== 'string' || actual.sede === '' || typeof actual.programadoPara !== 'string') return null
  const t0 = Date.parse(actual.programadoPara)
  if (!Number.isFinite(t0)) return null
  const candidatos = partidos.filter((p) => p.gameId !== actual.gameId && p.estado === 'programado' && p.sede === actual.sede && typeof p.programadoPara === 'string' && Date.parse(p.programadoPara) > t0)
  if (candidatos.length === 0) return null
  const primero = Math.min(...candidatos.map((p) => Date.parse(p.programadoPara)))
  const empatados = candidatos.filter((p) => Date.parse(p.programadoPara) === primero)
  return empatados.length === 1 ? empatados[0] : null
}
