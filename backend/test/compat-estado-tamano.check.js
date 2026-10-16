import { afterEach, describe, expect, it } from 'vitest'
import { LIMITES_ESTADO_CONTROL } from '../src/lectura-estado-control.js'
import { nuevaLiga, tokenDe } from './fixtures/sintetico.js'
import { Telefono, dentro, leerEstado, ligaSembrada } from './ayuda.js'
import { control } from './ayuda-acceso.js'

// REPORT_120, experimento 3: dónde caen de verdad los topes de /estado (4.000 eventos y 1 MiB de cuerpo UTF-8) y cómo
// responde el Worker. Datos SINTÉTICOS y desechables.
//
// QUÉ ES REAL Y QUÉ NO. Los primeros eventos de cada partida (REALES) se producen con comandos reales por /comandos. El resto
// hasta llegar a los topes son filas INSERTADAS DIRECTAMENTE en la tabla de eventos con la misma forma JSON que un evento real
// (se toma como plantilla uno producido por un comando real). Esto mide el tamaño de LECTURA del servidor. NO mide el
// almacenamiento del teléfono, ni demuestra que el tope propuesto de 1.200 comandos por partido sea adecuado: un comando no
// siempre produce un evento, y la forma de los ids reales de la cancha aún no se conoce.
//
// Cómo se mide: el cuerpo 200 se lee como texto y se cuentan sus bytes UTF-8 (lo mismo que cuenta el tope). El primer caso
// rechazado (507) no trae el tamaño; se mide el MISMO estado con un tope subido solo en la prueba (control.limitesEstado).
// El punto exacto se busca por bisección «aparcando» filas (cambiando su partido_id) para tener exactamente K eventos.

afterEach(() => { control.ahoraMs = null; control.limitesEstado = null })
const bytesUtf8 = (t) => new TextEncoder().encode(t).length
const ver = async (r) => { const texto = await r.text(); let cuerpo = null; try { cuerpo = JSON.parse(texto) } catch { /* sin JSON */ } return { status: r.status, texto, cuerpo } }
const APARCADO = 'aparcado'
const relleno = (prefijo, n, largo) => `${prefijo}${String(n).padStart(8, '0')}`.padStart(largo, 'x')

const PERFILES = {
  normal: {
    nombre: 'normal (juego 8, equipo 8, jugador 8, cmdId 36)',
    juego: 'g7k2m9qa',
    equipo: (i) => ['e1a2b3c4', 'e5d6f7g8'][i],
    jugador: (i, k) => `j${i}${String(k).padStart(2, '0')}x${i}${k}ab`.slice(0, 8).padEnd(8, 'z'),
    cmdId: () => globalThis.crypto.randomUUID(), // 36 caracteres
  },
  maximo: {
    nombre: 'máximo válido (juego 64, equipo 200, jugador 200, cmdId 200)',
    juego: relleno('G', 1, 64),
    equipo: (i) => relleno(`E${i}`, i, 200),
    jugador: (i, k) => relleno(`J${i}-`, k, 200),
    cmdId: (n) => relleno('c', n, 200),
  },
}

function payload(ligaId, perfil) {
  const jugadores = []
  for (const i of [0, 1]) for (let k = 1; k <= 15; k += 1) jugadores.push({ id: perfil.jugador(i, k), equipoId: perfil.equipo(i), nombre: `Jugador ${i}-${k}`, dorsal: k, activo: true, personaId: relleno('p', i * 100 + k, 16) })
  return {
    liga: { id: ligaId, nombre: `Liga sintética ${ligaId}`, deporte: 'baloncesto', minutosPorPeriodo: 10 },
    equipos: [{ id: perfil.equipo(0), nombre: 'Alfa' }, { id: perfil.equipo(1), nombre: 'Beta' }],
    jugadores,
    partidos: [{ id: perfil.juego, localId: perfil.equipo(0), visitaId: perfil.equipo(1), inicio: null }],
    credenciales: [{ token: tokenDe(ligaId, perfil.juego), partidoId: perfil.juego, deviceId: `tel-${perfil.juego}`, actorId: 'actor-sintetico' }],
  }
}

async function medir(perfil) {
  const ligaId = nuevaLiga()
  await ligaSembrada(ligaId, payload(ligaId, perfil))
  const P = new Telefono(ligaId, perfil.juego)
  let n = 0
  const mandar = async (tipo, datos, extra = {}) => {
    const r = await P.mandar(tipo, datos, { cmdId: perfil.cmdId(++n), t: 1000 + n, ...extra })
    expect(r.respuesta.status, JSON.stringify(r.cuerpo)).toBe(200)
    expect(r.cuerpo.resultado, JSON.stringify(r.cuerpo)).toBe('aceptado')
    return r
  }
  const leer = async () => ver(await leerEstado(ligaId, perfil.juego, P.token))
  const jug = (i, k) => ({ equipoId: perfil.equipo(i), jugadorId: perfil.jugador(i, k), puntos: 2 })

  await mandar('iniciar-partido', {})
  const base = await leer()
  expect(base.status).toBe(200)
  const bytesBase = bytesUtf8(base.texto)

  // --- eventos REALES (por /comandos) ---
  const ids = []
  for (let k = 0; k < 20; k += 1) { const r = await mandar('anotar', jug(k % 2, (k % 15) + 1)); ids.push(r.sobre.cmdId) }
  const x1 = await mandar('anotar', jug(0, 1)); await mandar('anular-evento', { eventoId: x1.sobre.cmdId }); await mandar('anotar', jug(1, 2)) // x1 queda anulado y con rehacerBloqueado
  await mandar('siguiente-periodo', {})
  const conReales = await leer()
  const eventosReales = conReales.cuerpo.estado.eventos
  const nReales = eventosReales.length
  const plano = eventosReales.find((e) => e.tipo === 'punto' && !e.anulado)
  const peor = eventosReales.find((e) => e.anulado && e.rehacerBloqueado)
  expect(peor, 'debe existir un evento real anulado con rehacerBloqueado').toBeTruthy()
  const bytesEvento = { plano: bytesUtf8(JSON.stringify(plano)), peorCasoReal: bytesUtf8(JSON.stringify(peor)), periodo: bytesUtf8(JSON.stringify(eventosReales.find((e) => e.tipo === 'periodo'))) }
  const sinEventos = bytesBase
  const bytesRealesTotal = bytesUtf8(conReales.texto)

  const resultados = {}
  for (const [forma, plantilla] of [['plano', plano], ['peor-caso-real', peor]]) {
    // Filas INSERTADAS directamente hasta tener 4.001 eventos en total (dejando los reales intactos).
    await dentro(ligaId, (inst) => {
      const sql = inst.almacen.sql
      sql.exec('DELETE FROM eventos WHERE partido_id = ? AND seq > ?', perfil.juego, nReales)
      sql.exec('DELETE FROM eventos WHERE partido_id = ?', APARCADO)
      for (let s = nReales + 1; s <= 4001; s += 1) {
        sql.exec('INSERT INTO eventos (partido_id, id, seq, json) VALUES (?, ?, ?, ?)', perfil.juego, perfil.cmdId(100000 + s), s, JSON.stringify({ ...plantilla, id: perfil.cmdId(100000 + s), seq: s }))
      }
    })
    const evaluar = async (K, limites = null) => {
      await dentro(ligaId, (inst) => {
        const sql = inst.almacen.sql
        sql.exec('UPDATE eventos SET partido_id = ? WHERE partido_id = ?', perfil.juego, APARCADO)
        sql.exec('UPDATE eventos SET partido_id = ? WHERE partido_id = ? AND seq > ?', APARCADO, perfil.juego, K)
      })
      control.limitesEstado = limites
      const r = await leer()
      control.limitesEstado = null
      return { status: r.status, bytes: r.status === 200 ? bytesUtf8(r.texto) : null, eventos: r.status === 200 ? r.cuerpo.estado.eventos.length : null, cuerpo507: r.status === 507 ? r.cuerpo : null }
    }
    expect(control.limitesEstado).toBeNull() // topes por defecto
    let lo = nReales // 200
    let hi = 4001 // 507
    expect((await evaluar(lo)).status).toBe(200)
    expect((await evaluar(hi)).status).toBe(507)
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((await evaluar(mid)).status === 200) lo = mid; else hi = mid }
    const ultimoBueno = await evaluar(lo)
    const primerRechazo = await evaluar(hi)
    const tamanoPrimerRechazo = await evaluar(hi, { maxEventos: 1_000_000, maxBytes: 64 * 1024 * 1024 })
    const en = {}
    for (const K of [nReales, 1200, 2000, 4000]) en[K] = K <= lo ? (await evaluar(K)).bytes : 'rechazado'
    resultados[forma] = {
      eventosMaximos200: lo,
      bytesEnElMaximo: ultimoBueno.bytes,
      primerRechazoEventos: hi,
      primerRechazo: primerRechazo.cuerpo507,
      bytesDelPrimerRechazo_conTopeSubido: tamanoPrimerRechazo.bytes,
      causaDelPrimerRechazo: hi > LIMITES_ESTADO_CONTROL.maxEventos ? 'cantidad-de-eventos' : 'bytes',
      bytesPorEventoInsertado: Math.round((tamanoPrimerRechazo.bytes - bytesRealesTotal) / (hi - nReales) * 100) / 100,
      bytesEnK: en,
    }
    // Invariantes del tope, en cada forma
    expect(primerRechazo.cuerpo507).toEqual({ error: 'estado-demasiado-grande' })
    expect(ultimoBueno.bytes).toBeLessThanOrEqual(LIMITES_ESTADO_CONTROL.maxBytes)
    expect(ultimoBueno.eventos).toBe(lo)
    if (resultados[forma].causaDelPrimerRechazo === 'bytes') expect(tamanoPrimerRechazo.bytes).toBeGreaterThan(LIMITES_ESTADO_CONTROL.maxBytes)
    else { expect(lo).toBe(LIMITES_ESTADO_CONTROL.maxEventos); expect(hi).toBe(LIMITES_ESTADO_CONTROL.maxEventos + 1); expect(tamanoPrimerRechazo.bytes).toBeLessThanOrEqual(LIMITES_ESTADO_CONTROL.maxBytes) }
  }
  return {
    perfil: perfil.nombre,
    topes: { ...LIMITES_ESTADO_CONTROL },
    jugadoresPorEquipo: 15,
    bytesSinEventos: sinEventos,
    eventosReales: nReales,
    bytesConEventosReales: bytesRealesTotal,
    bytesDeUnEvento: bytesEvento,
    resultados,
  }
}

describe('E3 — topes de /estado (4.000 eventos, 1 MiB): medición con datos sintéticos', () => {
  it('perfil con ids de longitud normal', async () => {
    const m = await medir(PERFILES.normal)
    console.log(`MEDICION ${JSON.stringify(m)}`)
    expect(m.topes).toEqual({ maxEventos: 4000, maxBytes: 1048576 })
  }, 180_000)
  it('perfil con ids de longitud máxima válida', async () => {
    const m = await medir(PERFILES.maximo)
    console.log(`MEDICION ${JSON.stringify(m)}`)
    expect(m.topes).toEqual({ maxEventos: 4000, maxBytes: 1048576 })
  }, 180_000)
})
