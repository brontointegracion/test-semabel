import { nuevaLiga, tokenDe } from './fixtures/sintetico.js'
import { Telefono, dentro, sembrar, sqlDe } from './ayuda.js'
import { comoOrganizador, iniciarSesion, provisionar, reiniciarAcceso, T0 } from './ayuda-acceso.js'

// Ayudas de las pruebas de plantilla. Todo es SINTÉTICO (nombres, ligas, personas, credenciales).

export { T0 }

let contadorOp = 0
/** Identificador de operación nuevo (16–64 caracteres del alfabeto permitido). */
export const nuevaOp = (prefijo = 'op') => `${prefijo}-prueba-${String(++contadorOp).padStart(6, '0')}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Liga sintética con fichas COMPLETAS (partes del nombre) y tres partidos:
 *   P: E1 – E2    Q: E3 – E4    R: E1 – E3    (E1 y E3 juegan dos partidos)
 * E1: Ana Prueba #0, Beto Muestra #7, Dario Inactivo (inactivo, #9 anterior)
 * E2: Eva Visita #1
 * E4: Hugo Cuarto #5 y una ficha ANTERIOR sin número válido (L1), solo con `nombre` (el partido Q no puede iniciar).
 */
export function payloadPlantilla(ligaId, { sinPartidos = false } = {}) {
  const f = (id, equipoId, nombrePila, apellido1, dorsal, extra = {}) => ({
    id, equipoId, nombrePila, apellido1, apellido2: '', dorsal, personaId: `persona-${id}`, ...extra,
  })
  return {
    liga: { id: ligaId, nombre: `Liga sintética ${ligaId}`, deporte: 'baloncesto', minutosPorPeriodo: 10 },
    equipos: [{ id: 'E1', nombre: 'Alfa' }, { id: 'E2', nombre: 'Beta' }, { id: 'E3', nombre: 'Gama' }, { id: 'E4', nombre: 'Delta' }],
    jugadores: [
      f('J1', 'E1', 'Ana', 'Prueba', 0, { nombreCamiseta: 'ANA' }),
      f('J2', 'E1', 'Beto', 'Muestra', 7, { fechaNacimiento: '2015-03-12', codigo: '4321' }),
      f('JX', 'E1', 'Dario', 'Inactivo', 9, { activo: false }),
      f('J9', 'E2', 'Eva', 'Visita', 1),
      { id: 'L1', equipoId: 'E4', nombre: 'Legado Sin Numero', dorsal: null, personaId: 'persona-L1' },
      f('K1', 'E3', 'Gil', 'Tercero', 4),
      f('K2', 'E4', 'Hugo', 'Cuarto', 5),
    ],
    partidos: sinPartidos ? [] : [
      { id: 'P', localId: 'E1', visitaId: 'E2', inicio: null },
      { id: 'Q', localId: 'E3', visitaId: 'E4', inicio: null },
      { id: 'R', localId: 'E1', visitaId: 'E3', inicio: null },
    ],
    credenciales: sinPartidos ? [] : ['P', 'Q', 'R'].map((p) => ({ token: tokenDe(ligaId, p), partidoId: p, deviceId: `tel-${p}`, actorId: `actor-${p}` })),
  }
}

/** Siembra `n` ligas, provisiona UN organizador que las posee e inicia sesión. */
export async function escenarioPlantilla({ ligas = 1, payload = payloadPlantilla, ahora = T0 } = {}) {
  const ids = Array.from({ length: ligas }, () => nuevaLiga())
  for (const id of ids) {
    const r = await sembrar(id, payload(id))
    if (r.status !== 201) throw new Error(`siembra falló: ${r.status} ${await r.text()}`)
  }
  await reiniciarAcceso(ahora)
  const { codigo, organizadorId } = await provisionar(ids)
  const sesion = await iniciarSesion(codigo)
  const telefono = (ligaId, partido) => new Telefono(ligaId, partido)
  return { ligas: ids, ligaId: ids[0], cookie: sesion.cookie, organizadorId, codigo, telefono }
}

const base = (ligaId, equipoId) => `/v1/organizador/ligas/${ligaId}/equipos/${equipoId}/jugadores`

export const leerLiga = (cookie, ligaId) => comoOrganizador(cookie, 'GET', `/v1/organizador/ligas/${ligaId}`)
export const leerRoster = (cookie, ligaId, equipoId) => comoOrganizador(cookie, 'GET', base(ligaId, equipoId))
export const alta = (cookie, ligaId, equipoId, cuerpo) => comoOrganizador(cookie, 'POST', base(ligaId, equipoId), { operacionId: nuevaOp('alta'), ...cuerpo })
export const accion = (cookie, ligaId, equipoId, fichaId, tipo, cuerpo) =>
  comoOrganizador(cookie, 'POST', `${base(ligaId, equipoId)}/${fichaId}/${tipo}`, { operacionId: nuevaOp(tipo), ...cuerpo })
/** Con identificador de operación explícito (para reintentos). */
export const conOp = (cookie, ligaId, equipoId, fichaId, tipo, cuerpo) =>
  comoOrganizador(cookie, 'POST', fichaId ? `${base(ligaId, equipoId)}/${fichaId}/${tipo}` : base(ligaId, equipoId), cuerpo)

export const campos = (extra = {}) => ({ nombrePila: 'Carla', apellido1: 'Nueva', dorsal: 12, ...extra })

/** Fila cruda de una ficha. */
export const fila = async (ligaId, fichaId) => (await sqlDe(ligaId, 'SELECT * FROM jugadores WHERE id = ?', fichaId))[0]
export const contar = async (ligaId, tabla) => (await sqlDe(ligaId, `SELECT COUNT(*) AS n FROM ${tabla}`))[0].n
export const volcarPlantilla = (ligaId) => dentro(ligaId, (inst) => {
  const sql = inst.almacen.sql
  return JSON.stringify({
    jugadores: sql.exec('SELECT * FROM jugadores ORDER BY id').toArray(),
    operaciones: sql.exec('SELECT * FROM operaciones_plantilla ORDER BY organizador_id, operacion_id').toArray(),
    auditoria: sql.exec('SELECT * FROM auditoria_plantilla ORDER BY id').toArray(),
  })
})

/** Quita las ligas del organizador que no sea `ligaId` (simula que ya no las posee). */
export { Telefono }

// --- Pruebas de bajo nivel --------------------------------------------------------------------------------------------
import { env } from 'cloudflare:workers'
import { ORIGEN, accesoStub, cabecerasEscritura, conCookie, enAcceso, ligaStub, pedir } from './ayuda-acceso.js'

export { accesoStub, enAcceso, ligaStub }

/** Afirmación de organizador armada a mano (solo para llamar a la liga directamente en pruebas). */
export const asercionDe = (e, extra = {}) => ({ organizadorId: e.organizadorId, sesionId: 's-prueba', ligas: e.ligas, validadoEn: T0, ...extra })

/** Llama directamente a la operación de la liga (sin Worker): para probar principal, afirmación y recibos. */
export const operarEnLiga = (e, { asercion = asercionDe(e), ligaId = e.ligaId, tipo = 'alta', equipoId = 'E1', fichaId = null, operacionId, contenido, verificacion = null }) =>
  ligaStub(ligaId).ejecutarOperacionPlantilla({ asercion, ligaId, tipo, equipoId, fichaId, operacionId, contenido, verificacion })

/**
 * Como `comoOrganizador`, pero con un entorno que ENVUELVE el binding de ligas: registra a qué ligas se accede y puede
 * hacer que algunas "no estén disponibles".
 */
export function conLigasObservadas({ noDisponibles = [], fallarEn = null } = {}) {
  const accesos = []
  const LIGA = {
    idFromName: (nombre) => ({ nombre, id: env.LIGA.idFromName(nombre) }),
    get: ({ nombre, id }) => {
      accesos.push(nombre)
      if (noDisponibles.includes(nombre)) throw new Error('liga no disponible (prueba)')
      const stub = env.LIGA.get(id)
      return fallarEn ? fallarEn(nombre, stub) : stub
    },
  }
  const entorno = { ...env, LIGA }
  const llamar = (cookie, metodo, ruta, cuerpo) => pedir(metodo, ruta, {
    cuerpo: metodo === 'GET' ? undefined : cuerpo,
    cabeceras: metodo === 'GET' ? conCookie(cookie) : conCookie(cookie, cabecerasEscritura()),
    entorno,
  })
  return { accesos, llamar, entorno }
}
