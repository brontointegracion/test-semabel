import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Archivo aparte de seed.test.jsx: aquí no se monta la app, así que no hay React
// escuchando la base mientras estas pruebas la siembran y la reordenan.

const NOMBRE_BD = 'sebel'

function borrarBd() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(NOMBRE_BD)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  await borrarBd()
  vi.resetModules()
})

afterEach(async () => {
  vi.restoreAllMocks()
  const { db } = await import('./db.js')
  db.close()
  await borrarBd()
})

async function sembrar() {
  const { db } = await import('./db.js')
  const seed = await import('./seed.js')
  await seed.sembrarSiHaceFalta()
  return { db, seed }
}


// ---------------------------------------------------------------------------
// Historia de la demo en el orden en que pasó.
// ---------------------------------------------------------------------------

describe('orden de la historia de la demo (siembra nueva)', () => {
  async function leerTodo() {
    const { db } = await import('./db.js')
    const M = await import('./lib/marcador.js')
    const ligas = Object.fromEntries((await db.ligas.toArray()).map((l) => [l.id, l]))
    const partidos = await db.partidos.toArray()
    const porPartido = new Map()
    for (const p of partidos) {
      porPartido.set(p.id, {
        partido: p,
        liga: ligas[p.ligaId],
        eventos: (await db.eventos.where('partidoId').equals(p.id).toArray()).sort((a, b) => a.seq - b.seq),
      })
    }
    return { db, M, partidos: [...porPartido.values()].filter((x) => x.eventos.length) }
  }

  it('cada punto y falta tiene el periodo que le corresponde por su lugar; el seq es único, contiguo y creciente', async () => {
    await sembrar()
    const { M, partidos } = await leerTodo()
    expect(partidos.length).toBeGreaterThan(10)
    let acciones = 0
    for (const { liga, eventos } of partidos) {
      expect(eventos.map((e) => e.seq)).toEqual(eventos.map((_, i) => i + 1))
      for (let i = 1; i < eventos.length; i++) expect(eventos[i].creadoEn).toBeGreaterThan(eventos[i - 1].creadoEn)
      for (const e of eventos.filter((x) => x.tipo !== 'periodo')) {
        expect(e.periodo).toBe(M.periodoEnPosicion(eventos, e.seq, liga.deporte))
        acciones++
      }
    }
    expect(acciones).toBeGreaterThan(300)
  })

  it('en la siembra completa, cada transición viva lleva el número del período que cierra', async () => {
    await sembrar()
    const { partidos } = await leerTodo()
    let vivas = 0
    for (const { eventos } of partidos) {
      eventos.filter((e) => e.tipo === 'periodo' && !e.anulado).forEach((t, i) => {
        expect(t.periodo).toBe(i + 1)
        const previas = eventos.filter((e) => e.seq < t.seq && e.tipo !== 'periodo')
        expect(Math.max(...previas.map((e) => e.periodo))).toBe(t.periodo)
        vivas++
      })
    }
    expect(vivas).toBeGreaterThan(30)
  })

  it('las marcas de corrección se conservan: lo anulado sigue bloqueado para rehacer y su hora deriva de su seq', async () => {
    await sembrar()
    const { partidos } = await leerTodo()
    const anulados = partidos.flatMap((x) => x.eventos).filter((e) => e.anulado)
    expect(anulados.length).toBeGreaterThan(0)
    for (const e of anulados) {
      expect(e.rehacerBloqueado).toBe(true)
      expect(e.anuladoEn).toBe(e.creadoEn + 9000)
    }
  })

  it('el partido en vivo conserva su período actual y su reloj inicial; los terminados, su reloj en cero', async () => {
    await sembrar()
    const { M, partidos } = await leerTodo()
    const vivos = partidos.filter((x) => x.partido.estado === 'vivo')
    expect(vivos.length).toBeGreaterThan(0)
    for (const { partido, liga, eventos } of vivos) {
      const jugados = liga.deporte === 'baloncesto' ? 2 : 1 // períodos ya terminados del partido en juego
      expect(eventos.filter((e) => e.tipo === 'periodo' && !e.anulado).length).toBeLessThanOrEqual(jugados)
      expect(M.periodoActual(eventos)).toBeGreaterThan(1)
      expect(partido.relojEstado).toBe('corriendo')
      expect(partido.relojRestante).toBe(liga.minutosPorPeriodo * 60 * 1000)
    }
    for (const { partido } of partidos.filter((x) => x.partido.estado === 'final')) {
      expect([partido.relojEstado, partido.relojRestante, partido.relojDesde]).toEqual(['detenido', 0, null])
    }
  })

  it('Anular un punto o una falta sembrados y luego Rehacer los restaura, en cualquier periodo', async () => {
    await sembrar()
    const { db, M, partidos } = await leerTodo()
    const { anularEvento, rehacer, marcadorEquipo, faltasEquipo } = M
    let probados = 0
    for (const { partido, eventos } of partidos.filter((x) => x.partido.estado === 'vivo' || x.eventos.length > 60).slice(0, 4)) {
      for (const periodo of [1, 2]) {
        for (const tipo of ['punto', 'falta']) {
          const e = eventos.find((x) => x.tipo === tipo && x.periodo === periodo && !x.anulado)
          if (!e) continue
          const antes = await db.eventos.where('partidoId').equals(partido.id).toArray()
          const marcadorAntes = marcadorEquipo(antes, e.equipoId)
          const faltasAntes = faltasEquipo(antes, e.equipoId)

          expect((await anularEvento(e.id)).resultado).toBe('anulado')
          const medio = await db.eventos.where('partidoId').equals(partido.id).toArray()
          if (tipo === 'punto') expect(marcadorEquipo(medio, e.equipoId)).toBe(marcadorAntes - e.puntos)
          else expect(faltasEquipo(medio, e.equipoId)).toBe(faltasAntes - 1)

          expect((await rehacer(partido.id)).resultado).toBe('rehecho')
          const despues = await db.eventos.where('partidoId').equals(partido.id).toArray()
          expect(marcadorEquipo(despues, e.equipoId)).toBe(marcadorAntes)
          expect(faltasEquipo(despues, e.equipoId)).toBe(faltasAntes)
          expect(despues.find((x) => x.id === e.id)).toMatchObject({ anulado: false })
          probados++
        }
      }
    }
    expect(probados).toBeGreaterThanOrEqual(8)
  })
})


// Fixtures deterministas (no dependen de la fecha): el orden antiguo de la siembra, con
// todas las acciones primero y las transiciones al final, para cada forma de historia.
describe('ordenarHistoria con transiciones (fixtures deterministas)', () => {
  let M
  let ordenarHistoria
  beforeEach(async () => {
    M = await import('./lib/marcador-calculo.js')
    ;({ ordenarHistoria } = await import('./seed.js'))
  })

  // `transiciones`: [etiqueta, anulada] en el orden en que las generaba la siembra. La siembra anula
  // como máximo un evento por partido, así que aquí hay a lo sumo una transición anulada: con dos
  // anuladas y menos fronteras vivas que períodos jugados ningún orden podría cumplir la regla de posición.
  function historiaAntigua({ periodos, transiciones }) {
    const eventos = []
    let seq = 0
    const ev = (campos) => eventos.push({
      id: `e${++seq}`, partidoId: 'P', seq, anulado: false, creadoEn: 0, ...campos,
    })
    // Primero todo lo anotado (equipo A entero y luego B), como hacía la siembra.
    for (const equipoId of ['A', 'B']) {
      for (let p = 1; p <= periodos; p++) {
        ev({ tipo: 'punto', equipoId, jugadorId: `j${equipoId}1`, puntos: 2, periodo: p })
        ev({ tipo: 'punto', equipoId, jugadorId: `j${equipoId}2`, puntos: p === 1 ? 3 : 1, periodo: p })
      }
      for (let p = 1; p <= periodos; p++) ev({ tipo: 'falta', equipoId, jugadorId: `j${equipoId}1`, puntos: 0, periodo: p })
    }
    // Una corrección de un punto (anulado y bloqueado), para comprobar que las marcas no cambian.
    eventos[1].anulado = true
    eventos[1].anuladoEn = 777
    eventos[1].rehacerBloqueado = true
    for (const [etiqueta, anulada] of transiciones) {
      ev({ tipo: 'periodo', periodo: etiqueta, ...(anulada ? { anulado: true, anuladoEn: 5, rehacerBloqueado: true } : {}) })
    }
    return eventos
  }

  const casos = [
    ['baloncesto: anulada con reemplazo (T2!)', 4, [[1, false], [2, true], [3, false], [4, false]]],
    ['baloncesto: anulada sin reemplazo (T4!)', 4, [[1, false], [2, false], [3, false], [4, true]]],
    ['baloncesto: anulada con reemplazo (T1!)', 4, [[1, true], [2, false], [3, false], [4, false]]],
    ['baloncesto: anulada con reemplazo (T3!)', 4, [[1, false], [2, false], [3, true], [4, false]]],
    ['baloncesto: sin anuladas', 4, [[1, false], [2, false], [3, false], [4, false]]],
    ['baloncesto: partido en vivo (2 períodos jugados)', 2, [[1, false], [2, false]]],
    ['futsal: anulada con reemplazo (T1!)', 2, [[1, true], [2, false]]],
    ['futsal: anulada sin reemplazo (T2!)', 2, [[1, false], [2, true]]],
    ['futsal: partido en vivo (1 período jugado)', 1, [[1, false]]],
  ]

  it.each(casos)('%s', (_nombre, periodos, transiciones) => {
    const antes = historiaAntigua({ periodos, transiciones })
    const copiaAntes = JSON.parse(JSON.stringify(antes))
    ordenarHistoria(antes, 1000)
    const ev = [...antes].sort((a, b) => a.seq - b.seq)

    // seq único, contiguo y creciente; horas coherentes con el orden.
    expect(ev.map((e) => e.seq)).toEqual(ev.map((_, i) => i + 1))
    ev.forEach((e) => {
      expect(e.creadoEn).toBe(1000 + e.seq * 20000)
      if (e.anulado) expect(e.anuladoEn).toBe(e.creadoEn + 9000)
    })

    // Cada punto y falta tiene el período que le corresponde por su lugar.
    for (const e of ev.filter((x) => x.tipo !== 'periodo')) {
      expect(e.periodo).toBe(M.periodoEnPosicion(ev, e.seq))
    }

    // Cada transición viva lleva el número del período que cierra: el de la frontera,
    // el de la última acción anterior y el anterior al de la siguiente acción.
    const vivas = ev.filter((e) => e.tipo === 'periodo' && !e.anulado)
    vivas.forEach((t, i) => {
      expect(t.periodo).toBe(i + 1)
      const previas = ev.filter((e) => e.seq < t.seq && e.tipo !== 'periodo')
      expect(Math.max(...previas.map((e) => e.periodo))).toBe(t.periodo)
      const siguiente = ev.find((e) => e.seq > t.seq && e.tipo !== 'periodo')
      if (siguiente) expect(siguiente.periodo).toBe(t.periodo + 1)
    })

    // Cada anulada queda justo antes de la viva con su número, o al final si no hay.
    const anuladas = ev.filter((e) => e.tipo === 'periodo' && e.anulado)
    const cola = ev.slice(ev.length - anuladas.length)
    anuladas.forEach((a) => {
      const viva = vivas.find((t) => t.periodo === a.periodo)
      if (viva) {
        const sig = ev.find((e) => e.seq > a.seq && !(e.tipo === 'periodo' && e.anulado))
        expect(sig).toBe(viva)
        expect(ev.slice(ev.indexOf(a) + 1, ev.indexOf(viva)).every((e) => e.tipo === 'periodo' && e.anulado && e.periodo === a.periodo)).toBe(true)
      } else {
        expect(cola).toContain(a)
      }
    })

    // Lo demás no cambia: ids, tipos, puntos, equipos, períodos de las acciones y todas las marcas.
    for (const e of ev) {
      const o = copiaAntes.find((x) => x.id === e.id)
      const sinDerivados = (x) => ({ ...x, seq: 0, creadoEn: 0, anuladoEn: 0 })
      if (e.tipo === 'periodo' && !e.anulado) expect(sinDerivados({ ...e, periodo: 0 })).toEqual(sinDerivados({ ...o, periodo: 0 }))
      else expect(sinDerivados(e)).toEqual(sinDerivados(o))
    }
    // Marcadores, faltas y período actual iguales.
    for (const equipo of ['A', 'B']) {
      expect(M.marcadorEquipo(ev, equipo)).toBe(M.marcadorEquipo(copiaAntes, equipo))
      expect(M.faltasEquipo(ev, equipo)).toBe(M.faltasEquipo(copiaAntes, equipo))
    }
    for (const j of ['jA1', 'jA2', 'jB1', 'jB2']) {
      expect(M.puntosJugador(ev, j)).toBe(M.puntosJugador(copiaAntes, j))
      expect(M.faltasJugador(ev, j)).toBe(M.faltasJugador(copiaAntes, j))
    }
    expect(M.periodoActual(ev)).toBe(M.periodoActual(copiaAntes))
    expect(vivas.length).toBe(copiaAntes.filter((e) => e.tipo === 'periodo' && !e.anulado).length)
  })

  it('ejemplo concreto: baloncesto con T2 anulada, antes y después', () => {
    const antes = historiaAntigua({ periodos: 4, transiciones: [[1, false], [2, true], [3, false], [4, false]] })
    ordenarHistoria(antes, 0)
    const ev = [...antes].sort((a, b) => a.seq - b.seq)
    const resumen = []
    for (const e of ev) {
      const k = e.tipo === 'periodo' ? `T${e.periodo}${e.anulado ? '!' : ''}` : `a${e.periodo}`
      if (resumen.at(-1)?.[0] === k) resumen.at(-1)[1]++
      else resumen.push([k, 1])
    }
    expect(resumen.map(([k, n]) => (n > 1 ? `${k}x${n}` : k)).join(' '))
      .toBe('a1x6 T1 a2x6 T2! T2 a3x6 T3 a4x6')
  })
})

describe('instalaciones que ya tienen la siembra actual', () => {
  it('no se tocan ni se vuelven a sembrar: una historia con el orden antiguo se queda como está', async () => {
    const { db } = await sembrar()
    const marcaAntes = await db.meta.get('semilla')

    // Convierte un partido con muchos eventos al orden antiguo (transiciones al final).
    const partidos = await db.partidos.toArray()
    let elegido
    for (const p of partidos) {
      const n = await db.eventos.where('partidoId').equals(p.id).count()
      if (n > 60) { elegido = p; break }
    }
    const ev = (await db.eventos.where('partidoId').equals(elegido.id).toArray()).sort((a, b) => a.seq - b.seq)
    const antiguo = [...ev.filter((e) => e.tipo !== 'periodo'), ...ev.filter((e) => e.tipo === 'periodo')]
    await Promise.all(antiguo.map((e, i) => db.eventos.update(e.id, { seq: i + 1 })))

    const fotoAntes = JSON.stringify({
      eventos: (await db.eventos.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
      partidos: (await db.partidos.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
    })
    const { sembrarSiHaceFalta } = await import('./seed.js')
    await sembrarSiHaceFalta()
    const fotoDespues = JSON.stringify({
      eventos: (await db.eventos.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
      partidos: (await db.partidos.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
    })
    expect(fotoDespues).toBe(fotoAntes)
    expect(await db.meta.get('semilla')).toEqual(marcaAntes)
  })
})
