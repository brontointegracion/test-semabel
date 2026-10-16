import { describe, expect, it } from 'vitest'
import { clasificar, etiquetasDe, partidosDe, pendienteDeComenzar, textoPeriodo } from './agrupar.js'
import { partidoLiga, reloj, respuestaLiga, SERVIDOR_MS } from './datos-prueba.js'
import { validarLiga } from './validar.js'
import { crearMuestra } from './reloj-servidor.js'

const estadoDe = (respuesta) => {
  const datos = validarLiga(respuesta, respuesta.liga.id)
  return { datos, muestra: crearMuestra({ servidorAhoraMs: datos.servidorAhoraMs, monoInicio: 1000, monoFin: 1000 }) }
}

describe('agrupación de partidos', () => {
  const ligaA = respuestaLiga({
    partidos: [
      partidoLiga({ gameId: 'V1', estado: 'vivo', inicioReal: '2026-11-01T21:31:00.000Z', reloj: reloj('corriendo', 400000, 1) }),
      partidoLiga({ gameId: 'F1', estado: 'final', inicioReal: '2026-11-01T19:00:00.000Z', local: { id: 'E1', puntos: 30, faltas: 5 }, visita: { id: 'E2', puntos: 20, faltas: 6 } }),
      partidoLiga({ gameId: 'P2', programadoPara: '2026-11-08T15:00:00.000Z' }),
      partidoLiga({ gameId: 'P1', programadoPara: '2026-11-01T20:00:00.000Z' }), // su hora ya pasó (servidor 22:00Z): atrasado
      partidoLiga({ gameId: 'P0', programadoPara: null, sede: null }),
      partidoLiga({ gameId: 'V2', estado: 'vivo', inicioReal: '2026-11-01T21:40:00.000Z', reloj: reloj('detenido', 0), local: { id: 'E3', puntos: 1, faltas: 0 }, visita: { id: 'E4', puntos: 1, faltas: 0 } }),
    ],
  })

  it('vivo → Ahora mismo (incluye reloj en 00:00); programado → próximos (también los atrasados); final → resultados', () => {
    const { vivos, proximos, finales } = clasificar(partidosDe([estadoDe(ligaA)]))
    expect(vivos.map((p) => p.gameId).sort()).toEqual(['V1', 'V2'])
    expect(proximos.map((p) => p.gameId)).toEqual(['P1', 'P2', 'P0']) // por hora; sin hora al final
    expect(finales.map((p) => p.gameId)).toEqual(['F1'])
    const v2 = vivos.find((p) => p.gameId === 'V2')
    expect(v2.estado).toBe('vivo') // 00:00 no es final
  })

  it('un programado atrasado se rotula como pendiente por la hora del SERVIDOR, sin cambiar de estado', () => {
    const { proximos } = clasificar(partidosDe([estadoDe(ligaA)]))
    const por = Object.fromEntries(proximos.map((p) => [p.gameId, p]))
    expect(pendienteDeComenzar(por.P1, 1000)).toBe(true)
    expect(pendienteDeComenzar(por.P2, 1000)).toBe(false)
    expect(pendienteDeComenzar(por.P0, 1000)).toBe(false) // sin hora no se afirma nada
    expect(por.P1.estado).toBe('programado')
    // 10 minutos de reloj monotónico después, P2 (en una semana) sigue sin estar atrasado
    expect(pendienteDeComenzar(por.P2, 1000 + 600_000)).toBe(false)
  })

  it('los nombres de equipo salen de la liga; las etiquetas de categoría usan el catálogo y faltan sin inventarse', () => {
    const p = partidosDe([estadoDe(ligaA)]).find((x) => x.gameId === 'F1')
    expect(p.local.nombre).toBe('Alfa Norte')
    expect(p.etiquetaCategoria).toBe('Mini baloncesto')
    expect(p.etiquetaSubcategoria).toBe('U10')
    const sin = respuestaLiga()
    sin.liga.categoria = null
    sin.liga.subcategoria = null
    expect(etiquetasDe(validarLiga(sin, 'LIGAPUB1').liga)).toEqual({ categoria: null, subcategoria: null })
    const texto = respuestaLiga()
    texto.liga.categoria = 'adult'
    texto.liga.subcategoria = { texto: 'Sub Elite' }
    expect(etiquetasDe(validarLiga(texto, 'LIGAPUB1').liga)).toEqual({ categoria: 'Adulto', subcategoria: 'Sub Elite' })
  })

  it('varias ligas se agrupan juntas y el orden es determinista', () => {
    const b = respuestaLiga({ id: 'LIGAPUB2', nombre: 'Liga dos', partidos: [partidoLiga({ gameId: 'W1', estado: 'vivo', inicioReal: '2026-11-01T21:31:00.000Z', reloj: reloj('detenido', 1000) })] })
    const todo = partidosDe([estadoDe(ligaA), estadoDe(b)])
    expect(clasificar(todo).vivos.map((p) => `${p.ligaId}:${p.gameId}`)).toEqual(['LIGAPUB2:W1', 'LIGAPUB1:V1', 'LIGAPUB1:V2'])
    expect(clasificar([...todo].reverse()).vivos.map((p) => `${p.ligaId}:${p.gameId}`)).toEqual(['LIGAPUB2:W1', 'LIGAPUB1:V1', 'LIGAPUB1:V2'])
  })

  it('texto del periodo según el deporte conocido', () => {
    expect(textoPeriodo('baloncesto', 2)).toBe('2º cuarto')
    expect(textoPeriodo('futsal', 1)).toBe('1º tiempo')
    expect(textoPeriodo('otro', 3)).toBe('Periodo 3')
    expect(SERVIDOR_MS).toBeGreaterThan(0)
  })
})
