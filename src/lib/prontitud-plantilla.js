import { dorsalDe } from './dorsal'
import { activoDe } from './identidad'

// ---------------------------------------------------------------------------
// ¿Puede empezar este partido? (Decisión 115, punto 6.) Cálculo puro, sin base
// de datos: quien lo llama le entrega lo que leyó dentro de su propia
// transacción.
//
//   - Dos equipos distintos, ambos existentes y de la liga del partido; la liga existe.
//   - Todo jugador ACTIVO de cada equipo tiene un número guardado válido (entero
//     0–99, el 0 incluido) y no repetido entre los activos de ese equipo.
//
// Los datos mal formados se rechazan tal cual: no se corrigen ni se normalizan
// aquí. Los inactivos, la fecha de nacimiento y el tamaño de la plantilla no
// cuentan: un equipo sin jugadores pasa esta comprobación.
//
// El detalle de un rechazo no lleva nombres de jugadores ni datos privados:
// solo el equipo, cuántos activos no tienen número y qué números se repiten.
// ---------------------------------------------------------------------------

const idValido = (id) => typeof id === 'string' && id !== ''

export function evaluarProntitud({ partido, liga, equipos = [], jugadores = [] }) {
  const invalido = (causa) => ({ lista: false, motivo: 'equipos-invalidos', detalle: { causa } })

  if (!partido || !idValido(partido.ligaId) || !liga || liga.id !== partido.ligaId) return invalido('liga')
  const { localId, visitaId } = partido
  if (!idValido(localId) || !idValido(visitaId) || localId === visitaId) return invalido('equipos-distintos')

  const porId = new Map(equipos.filter(Boolean).map((e) => [e.id, e]))
  for (const id of [localId, visitaId]) {
    const e = porId.get(id)
    if (!e) return invalido('equipo-inexistente')
    if (e.ligaId !== partido.ligaId) return invalido('equipo-otra-liga')
  }

  const problemas = []
  for (const id of [localId, visitaId]) {
    const activos = jugadores.filter((j) => j?.equipoId === id && activoDe(j))
    const cuenta = new Map()
    let sinNumero = 0
    for (const j of activos) {
      const d = dorsalDe(j)
      if (d === null) sinNumero++
      else cuenta.set(d, (cuenta.get(d) ?? 0) + 1)
    }
    const duplicados = [...cuenta].filter(([, n]) => n > 1).map(([d]) => d).sort((a, b) => a - b)
    if (sinNumero || duplicados.length) {
      problemas.push({ equipoId: id, nombre: porId.get(id).nombre ?? null, sinNumero, duplicados })
    }
  }
  if (problemas.length) return { lista: false, motivo: 'plantilla-incompleta', detalle: { equipos: problemas } }
  return { lista: true }
}
