import { describe, expect, it } from 'vitest'
import { exports } from 'cloudflare:workers'
import { ANOTACIONES_PUBLICAS, CAMPOS_PUBLICOS } from '../src/proyeccion-publica.js'
import { nuevaLiga, payloadDeLiga } from './fixtures/sintetico.js'
import { T0, json, ligaSembrada, sqlDe } from './ayuda.js'

// ANOTACIONES CONFIRMADAS en la lectura pública de un partido (REPORT_191). Todo sintético, en workerd real.

const leer = (ligaId, g = 'P') => exports.default.fetch(new Request(`https://backend.local/v1/ligas/${ligaId}/partidos/${g}`))
const ver = async (ligaId, g) => json(await leer(ligaId, g))

function payload(ligaId) {
  const p = payloadDeLiga(ligaId)
  p.jugadores = [
    { id: 'A1', equipoId: 'E1', personaId: 'persona-A1', activo: true, nombrePila: 'Ana', apellido1: 'Prueba', dorsal: 0, nombreCamiseta: 'ANITA-SECRETA', fechaNacimiento: '2014-02-03' },
    { id: 'A2', equipoId: 'E1', personaId: 'persona-A2', activo: true, nombrePila: 'Saúl', apellido1: 'Montero', dorsal: 7 },
    { id: 'A3', equipoId: 'E1', personaId: 'persona-A3', activo: true, dorsal: 9 }, // sin nombre público
    { id: 'B1', equipoId: 'E2', personaId: 'persona-B1', activo: true, nombrePila: 'Eva', apellido1: 'Visita', dorsal: 1 },
  ]
  return p
}
async function partido() {
  const ligaId = nuevaLiga()
  const base = await ligaSembrada(ligaId, payload(ligaId))
  let t = T0
  const ok = async (tipo, datos) => { t += 1000; const r = await base.P.mandar(tipo, datos, { t }); expect(r.cuerpo.resultado, tipo).toBe('aceptado'); return r }
  return { ...base, ok }
}
const A = (jugadorId, puntos, equipoId = 'E1') => ({ equipoId, jugadorId, puntos })

describe('anotaciones públicas', () => {
  it('programado: lista vacía; en juego: canasta confirmada con nombre público, número y lado; claves exactas', async () => {
    const { ligaId, ok } = await partido()
    expect((await ver(ligaId)).anotaciones).toEqual([])
    await ok('iniciar-partido', {}); await ok('arrancar-reloj', {})
    expect((await ver(ligaId)).anotaciones).toEqual([])
    await ok('anotar', A('A1', 3))
    const c = await ver(ligaId)
    expect(c.anotaciones).toEqual([{ seq: expect.any(Number), lado: 'local', puntos: 3, jugador: { nombre: 'Ana Prueba', dorsalActual: 0 } }]) // el 0 es un número real
    expect(Object.keys(c.anotaciones[0]).sort()).toEqual([...CAMPOS_PUBLICOS.anotacion].sort())
    expect(Object.keys(c.anotaciones[0].jugador).sort()).toEqual([...CAMPOS_PUBLICOS.jugadorAnotacion].sort())
    expect(Object.keys(c).sort()).toEqual([...CAMPOS_PUBLICOS.raiz].sort())
    const texto = JSON.stringify(c)
    for (const mal of ['ANITA', 'persona', '2014', '"A1"', 'cmdId', 'creadoEn', 'anulado', 'jugadorId', 'equipoId']) expect(texto, mal).not.toContain(mal)
  })

  it('más nuevo primero, lado de la visita, seq creciente y estable; tope de ANOTACIONES_PUBLICAS', async () => {
    const { ligaId, ok } = await partido()
    await ok('iniciar-partido', {}); await ok('arrancar-reloj', {})
    for (let i = 0; i < ANOTACIONES_PUBLICAS + 3; i += 1) await ok('anotar', i % 2 ? A('B1', 2, 'E2') : A('A2', 2))
    const a = (await ver(ligaId)).anotaciones
    expect(a.length).toBe(ANOTACIONES_PUBLICAS)
    expect(a.map((x) => x.seq)).toEqual([...a.map((x) => x.seq)].sort((x, y) => y - x))
    expect(a[0].lado).toBe('local') // el noveno (índice 8) es del local
    expect(new Set(a.map((x) => x.seq)).size).toBe(a.length)
    expect((await ver(ligaId)).anotaciones.map((x) => x.seq)).toEqual(a.map((x) => x.seq)) // la misma lectura repetida: mismas identidades
  })

  it('deshacer lo quita, rehacer lo devuelve con el MISMO seq; anular lo quita', async () => {
    const { ligaId, ok } = await partido()
    await ok('iniciar-partido', {}); await ok('arrancar-reloj', {})
    const uno = await ok('anotar', A('A2', 2))
    await ok('anotar', A('B1', 3, 'E2'))
    const antes = (await ver(ligaId)).anotaciones
    expect(antes.map((x) => x.jugador.nombre)).toEqual(['Eva Visita', 'Saúl Montero'])
    await ok('deshacer', {})
    expect((await ver(ligaId)).anotaciones.map((x) => x.jugador.nombre)).toEqual(['Saúl Montero'])
    await ok('rehacer', {})
    expect((await ver(ligaId)).anotaciones).toEqual(antes)
    await ok('anular-evento', { eventoId: uno.sobre.cmdId })
    expect((await ver(ligaId)).anotaciones.map((x) => x.jugador.nombre)).toEqual(['Eva Visita'])
  })

  it('sin ficha asignada o sin nombre público: no se publica; faltas y otros eventos tampoco', async () => {
    const { ligaId, ok } = await partido()
    await ok('iniciar-partido', {}); await ok('arrancar-reloj', {})
    await ok('anotar', A('A3', 2)) // ficha sin nombre
    await ok('falta', { equipoId: 'E1', jugadorId: 'A2' })
    await ok('anotar', A('A2', 1))
    await sqlDe(ligaId, "UPDATE eventos SET json = json_set(json, '$.jugadorId', NULL) WHERE partido_id = 'P' AND json_extract(json, '$.tipo') = 'punto' AND json_extract(json, '$.puntos') = 1")
    expect((await ver(ligaId)).anotaciones).toEqual([])
  })

  it('al terminar el partido la lista queda vacía', async () => {
    const { ligaId, ok } = await partido()
    await ok('iniciar-partido', {}); await ok('arrancar-reloj', {})
    await ok('anotar', A('A2', 2))
    expect((await ver(ligaId)).anotaciones.length).toBe(1)
    await ok('detener-reloj', {}); await ok('cerrar-partido', {})
    const c = await ver(ligaId)
    expect(c.estado).toBe('final')
    expect(c.anotaciones).toEqual([])
  })
})
