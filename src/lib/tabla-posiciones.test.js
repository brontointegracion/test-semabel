import { describe, it, expect } from 'vitest'
import { tablaDeResultados } from './tabla-posiciones'

// Datos SINTÉTICOS. Cada partido final cuenta su marcador para los DOS equipos: PF propio, PC del rival.
const equipos = ['GRILLOS', 'CORRE', 'UNITY', 'WEST', 'SOLO'].map((id) => ({ id, nombre: id }))
const r = (localId, visitaId, local, visita) => ({ localId, visitaId, local, visita, faltasLocal: 7, faltasVisita: 3 })
const por = (filas, id) => filas.find((f) => f.equipo.id === id)
const diferencia = (f) => f.pf - f.pc

describe('tabla de posiciones: PF, PC y DIF', () => {
  it('derrota 43-49: JJ=1, G=0, P=1, PF=43, PC=49, DIF=-6, PTS=1', () => {
    const t = tablaDeResultados({ equipos, deporte: 'baloncesto', resultados: [r('GRILLOS', 'CORRE', 43, 49)] })
    const g = por(t, 'GRILLOS')
    expect([g.jj, g.jg, g.jp, g.pf, g.pc, diferencia(g), g.pts]).toEqual([1, 0, 1, 43, 49, -6, 1])
    const c = por(t, 'CORRE')
    expect([c.jj, c.jg, c.jp, c.pf, c.pc, diferencia(c), c.pts]).toEqual([1, 1, 0, 49, 43, 6, 2])
  })

  it('empate (diferencia 0), varios partidos como local y visitante, y equipo sin partidos', () => {
    const t = tablaDeResultados({
      equipos,
      deporte: 'baloncesto',
      resultados: [r('GRILLOS', 'CORRE', 43, 49), r('UNITY', 'GRILLOS', 30, 30), r('GRILLOS', 'WEST', 60, 20)],
    })
    const g = por(t, 'GRILLOS')
    expect([g.jj, g.jg, g.jp, g.je, g.pf, g.pc, diferencia(g), g.pts]).toEqual([3, 1, 1, 1, 133, 99, 34, 2 + 1 + 1])
    const u = por(t, 'UNITY')
    expect([u.pf, u.pc, diferencia(u)]).toEqual([30, 30, 0])
    const s = por(t, 'SOLO')
    expect([s.jj, s.jg, s.jp, s.pf, s.pc, diferencia(s), s.pts]).toEqual([0, 0, 0, 0, 0, 0, 0])
  })

  it('en toda la liga la suma de PF es igual a la suma de PC', () => {
    const t = tablaDeResultados({ equipos, deporte: 'baloncesto', resultados: [r('GRILLOS', 'CORRE', 43, 49), r('UNITY', 'WEST', 12, 7), r('CORRE', 'UNITY', 31, 31)] })
    expect(t.reduce((n, f) => n + f.pf, 0)).toBe(t.reduce((n, f) => n + f.pc, 0))
    expect(t.reduce((n, f) => n + diferencia(f), 0)).toBe(0)
  })

  it('el orden no cambia: puntos, luego diferencia, luego PF; los empatados a todo conservan el orden de entrada', () => {
    const t = tablaDeResultados({ equipos, deporte: 'baloncesto', resultados: [r('GRILLOS', 'CORRE', 43, 49), r('UNITY', 'WEST', 50, 10)] })
    // CORRE y UNITY: 2 pts; UNITY mayor diferencia (+40 vs +6) va primero; GRILLOS y WEST: 1 pt; GRILLOS -6 antes que WEST -40; SOLO 0 pts
    expect(t.map((f) => f.equipo.id)).toEqual(['UNITY', 'CORRE', 'GRILLOS', 'WEST', 'SOLO'])
    const empatadas = tablaDeResultados({ equipos, deporte: 'baloncesto', resultados: [r('GRILLOS', 'CORRE', 10, 10)] })
    expect(empatadas.map((f) => f.equipo.id)).toEqual(['GRILLOS', 'CORRE', 'UNITY', 'WEST', 'SOLO'])
  })

  it('las faltas siguen calculadas en los datos (solo se quitan de la pantalla)', () => {
    const t = tablaDeResultados({ equipos, deporte: 'baloncesto', resultados: [r('GRILLOS', 'CORRE', 43, 49)] })
    expect([por(t, 'GRILLOS').faltas, por(t, 'CORRE').faltas]).toEqual([7, 3])
  })
})
