// Cliente sintético del humo local: arma un sobre de inicio con las MISMAS funciones del motor.
// Se empaqueta con esbuild antes de usarse (el motor usa importaciones sin extensión).
import { crearEstado } from '../../src/lib/motor/estado.js'
import { crearPreparacion } from '../../src/lib/motor/preparacion.js'
import { construirSobre } from '../../src/lib/motor/reglas.js'
import { payloadDeLiga, T0 } from '../test/fixtures/sintetico.js'

export { payloadDeLiga, T0 }

export function sobreDeInicio(ligaId, { cmdId, clientSeq, deviceId = 'tel-P', t = T0 + 1000 }) {
  const p = payloadDeLiga(ligaId)
  const jugadores = p.jugadores.filter((j) => ['E1', 'E2'].includes(j.equipoId))
    .map((j) => ({ id: j.id, equipoId: j.equipoId, dorsal: j.dorsal, activo: j.activo }))
  const prep = crearPreparacion({
    gameId: 'P',
    partido: { ligaId, localId: 'E1', visitaId: 'E2' },
    liga: { id: ligaId },
    equipos: [{ id: 'E1', ligaId }, { id: 'E2', ligaId }],
    jugadores,
    consultaEquipos: ['E1', 'E2'],
  })
  const estado = crearEstado({ gameId: 'P', config: { deporte: 'baloncesto', minutosPorPeriodo: p.liga.minutosPorPeriodo }, partido: { estado: 'programado', inicio: null } })
  return construirSobre(estado, { cmdId, tipo: 'iniciar-partido', datos: {}, tiempo: { accionTs: t }, preparacionVersion: prep.version }, { deviceId, clientSeq })
}
