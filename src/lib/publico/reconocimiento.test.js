import { describe, expect, it } from 'vitest'
import { DURACION_AVISO_MS, estadoInicialReconocimiento, siguienteReconocimiento, textoDeAviso } from './reconocimiento.js'

const a = (seq, puntos = 2, nombre = `J${seq}`) => ({ seq, lado: 'local', puntos, jugador: { nombre, dorsalActual: 3 } })
const paso = (estado, anotaciones, extra = {}) => siguienteReconocimiento(estado, { gameId: 'G', anotaciones, ...extra })

describe('reconocimiento de canastas confirmadas', () => {
  it('la primera lectura fija la línea base: nada del pasado se anuncia', () => {
    const e = paso(estadoInicialReconocimiento(), [a(3), a(2), a(1)])
    expect(e.aviso).toBeNull()
    expect([...e.vistos].sort()).toEqual([1, 2, 3])
  })
  it('una canasta nueva se anuncia; el mismo sondeo repetido no la anuncia otra vez', () => {
    let e = paso(estadoInicialReconocimiento(), [a(1)])
    e = paso(e, [a(2), a(1)])
    expect(e.aviso.seq).toBe(2)
    const igual = paso(e, [a(2), a(1)])
    expect(igual).toBe(e) // exactamente el mismo estado: ni aviso nuevo ni cambio
  })
  it('varias canastas nuevas de golpe: solo la más nueva (reemplaza a la anterior)', () => {
    let e = paso(estadoInicialReconocimiento(), [a(1)])
    e = paso(e, [a(2)] .concat([a(1)]))
    e = paso(e, [a(5), a(4), a(3), a(2), a(1)])
    expect(e.aviso.seq).toBe(5)
  })
  it('deshacer la canasta que se muestra retira el aviso; deshacer otra no lo toca', () => {
    let e = paso(estadoInicialReconocimiento(), [a(1)])
    e = paso(e, [a(2), a(1)])
    const otra = paso(e, [a(2)]) // se deshizo la 1, no la mostrada
    expect(otra.aviso.seq).toBe(2)
    expect(paso(e, [a(1)]).aviso).toBeNull() // se deshizo la 2: la lista ya no la trae
  })
  it('rehacer una canasta ya anunciada (mismo seq) no la anuncia de nuevo', () => {
    let e = paso(estadoInicialReconocimiento(), [a(1)])
    e = paso(e, [a(2), a(1)])
    e = paso(e, [a(1)]) // deshacer
    expect(e.aviso).toBeNull()
    e = paso(e, [a(2), a(1)]) // rehacer
    expect(e.aviso).toBeNull()
  })
  it('rebase (reconexión, fallo de lectura, pestaña oculta): lo ocurrido mientras tanto no se repite', () => {
    let e = paso(estadoInicialReconocimiento(), [a(1)])
    e = paso(e, [a(4), a(3), a(2), a(1)], { rebase: true })
    expect(e.aviso).toBeNull()
    e = paso(e, [a(5), a(4)])
    expect(e.aviso.seq).toBe(5)
  })
  it('rebase conserva el aviso vigente solo si su canasta sigue vigente', () => {
    let e = paso(estadoInicialReconocimiento(), [a(1)])
    e = paso(e, [a(2), a(1)])
    expect(paso(e, [a(2), a(1)], { rebase: true }).aviso.seq).toBe(2)
    expect(paso(e, [a(1)], { rebase: true }).aviso).toBeNull()
  })
  it('otro partido: línea base nueva; lista ausente o mala: no hace nada', () => {
    let e = paso(estadoInicialReconocimiento(), [a(1)])
    e = paso(e, [a(2), a(1)])
    const otro = siguienteReconocimiento(e, { gameId: 'H', anotaciones: [a(9)] })
    expect(otro.aviso).toBeNull()
    expect(otro.gameId).toBe('H')
    expect(siguienteReconocimiento(e, { gameId: 'G', anotaciones: null })).toBe(e)
    expect(siguienteReconocimiento(e, { gameId: 'G', anotaciones: undefined })).toBe(e)
  })
  it('el número de camiseta (dorsalActual): «#0» se muestra; sin número, solo el nombre; ningún valor raro se escribe', () => {
    const con = (dorsalActual) => ({ seq: 1, lado: 'local', puntos: 2, jugador: { nombre: 'Miguel Sam', dorsalActual } })
    expect(textoDeAviso(con(7), 'Cometas')).toBe('#7 Miguel Sam · +2 puntos · Cometas')
    expect(textoDeAviso(con(0), 'Cometas')).toBe('#0 Miguel Sam · +2 puntos · Cometas')
    expect(textoDeAviso(con(99), 'Cometas')).toBe('#99 Miguel Sam · +2 puntos · Cometas')
    for (const sin of [null, undefined, '7', -1, 7.5, NaN]) expect(textoDeAviso(con(sin), 'Cometas')).toBe('Miguel Sam · +2 puntos · Cometas')
  })
  it('texto: jugador público, puntos y equipo; singular para un punto', () => {
    expect(textoDeAviso(a(1, 3, 'Ana Prueba'), 'Alfa')).toBe('#3 Ana Prueba · +3 puntos · Alfa')
    expect(textoDeAviso(a(1, 1, 'Ana Prueba'), 'Alfa')).toBe('#3 Ana Prueba · +1 punto · Alfa')
    expect(DURACION_AVISO_MS).toBe(4000)
  })
})
