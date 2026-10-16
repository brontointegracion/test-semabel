// Cliente sintético del navegador de plantillas: arma el sobre de inicio de un partido con las MISMAS funciones del motor.
// Se empaqueta con esbuild antes de usarse.
import { crearEstado } from '../../src/lib/motor/estado.js'
import { construirSobre } from '../../src/lib/motor/reglas.js'

export function sobreDeInicio({ gameId, minutosPorPeriodo = 10, cmdId, clientSeq, deviceId, version, t }) {
  const estado = crearEstado({ gameId, config: { deporte: 'baloncesto', minutosPorPeriodo }, partido: { estado: 'programado', inicio: null } })
  return construirSobre(estado, { cmdId, tipo: 'iniciar-partido', datos: {}, tiempo: { accionTs: t }, preparacionVersion: version }, { deviceId, clientSeq })
}
