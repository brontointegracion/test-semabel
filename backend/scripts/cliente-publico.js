// Cliente del arnés del navegador de las pantallas públicas (REPORT_135): arma, con las MISMAS funciones del motor, el sobre de
// una corrección posterior al final («anular-evento») que la pantalla de control no ofrece. Se empaqueta con esbuild en un
// directorio TEMPORAL. Todo es sintético; el token solo viaja en la cabecera de la petición del propio arnés.
import { construirSobre } from '../../src/lib/motor/reglas.js'

export function sobreAnular({ gameId, rev, eventoId, deviceId, clientSeq, cmdId, t }) {
  const estado = { gameId, rev, eventos: [], partido: {}, auditSeq: 0, atribucion: null }
  return construirSobre(estado, { cmdId, tipo: 'anular-evento', datos: { eventoId }, tiempo: { accionTs: t } }, { deviceId, clientSeq })
}
