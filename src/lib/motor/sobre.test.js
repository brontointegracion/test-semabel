import { describe, expect, it } from 'vitest'
import { canonico, contenidoCanonico, validarSobre } from './sobre'
import { estadoDePrueba, T0 } from './prueba/banco'
import { construirSobre } from './reglas'

const sobreBase = () => construirSobre(
  estadoDePrueba(),
  { cmdId: 'c1', tipo: 'anotar', datos: { equipoId: 'E1', jugadorId: 'J1', puntos: 2 }, tiempo: { accionTs: T0 } },
  { deviceId: 'tel-A', clientSeq: 1 },
)

describe('canonico', () => {
  it('no depende del orden de las claves y omite undefined', () => {
    expect(canonico({ b: 1, a: { d: 2, c: undefined } })).toBe(canonico({ a: { d: 2 }, b: 1 }))
  })
  it('distingue valores distintos y rechaza lo no serializable', () => {
    expect(canonico({ a: 1 })).not.toBe(canonico({ a: 2 }))
    expect(() => canonico({ a: NaN })).toThrow()
    expect(() => canonico({ a: () => 1 })).toThrow()
  })
})

describe('validarSobre', () => {
  it('acepta un sobre completo y rellena los valores por defecto del tiempo', () => {
    const r = validarSobre(sobreBase())
    expect(r.ok).toBe(true)
    expect(r.sobre.accionTsCrudo).toBe(T0)
    expect(r.sobre.ajusteTsMs).toBe(0)
    expect(r.sobre.discontinuidad).toBeNull()
  })

  it('rechaza campos desconocidos en lugar de descartarlos', () => {
    const r = validarSobre({ ...sobreBase(), extra: 1 })
    expect(r.ok).toBe(false)
    expect(r.errores).toContain('campo-desconocido:extra')
  })

  it('rechaza ids vacíos, clientSeq no positivo y tipos desconocidos', () => {
    expect(validarSobre({ ...sobreBase(), cmdId: '' }).errores).toContain('cmdId')
    expect(validarSobre({ ...sobreBase(), clientSeq: 0 }).errores).toContain('clientSeq')
    expect(validarSobre({ ...sobreBase(), tipo: 'otra-cosa' }).errores).toContain('tipo')
  })

  it('rechaza una hora fuera del rango de fechas (no deja pasar algo que rompa Date)', () => {
    expect(validarSobre({ ...sobreBase(), accionTs: 9e15, accionTsCrudo: 9e15 }).errores).toContain('accionTs')
  })

  it('exige que el ajuste de tiempo sea consistente con la hora cruda', () => {
    const r = validarSobre({ ...sobreBase(), accionTsCrudo: T0 - 500, ajusteTsMs: 400 })
    expect(r.errores).toContain('ajusteTsMs')
    expect(validarSobre({ ...sobreBase(), accionTsCrudo: T0 - 500, ajusteTsMs: 500 }).ok).toBe(true)
  })

  it('valida la discontinuidad declarada', () => {
    expect(validarSobre({ ...sobreBase(), discontinuidad: { saltoMs: 4000, causa: 'desconocida' } }).ok).toBe(true)
    expect(validarSobre({ ...sobreBase(), discontinuidad: { saltoMs: 'x' } }).errores).toContain('discontinuidad')
  })

  it('exige los campos observados de cada orden y el tiempo restante visto en las de reloj', () => {
    const s = sobreBase()
    expect(validarSobre({ ...s, observado: { rev: 0 } }).errores).toContain('observado.periodo')
    const reloj = construirSobre(estadoDePrueba(), { cmdId: 'r', tipo: 'arrancar-reloj', tiempo: { accionTs: T0 } }, { deviceId: 'd', clientSeq: 1 })
    expect(validarSobre({ ...reloj, restanteVistoMs: null }).errores).toContain('restanteVistoMs')
  })

  it('la parada automática tiene un cmdId fijo por corrida', () => {
    const base = {
      ...construirSobre(
        estadoDePrueba({ reloj: { relojEstado: 'corriendo', relojRestante: 0, relojDesde: T0 - 1000 } }),
        { cmdId: 'auto:P:12', tipo: 'parada-automatica', datos: { corridaSeq: 12 }, tiempo: { accionTs: T0 } },
        { deviceId: 'd', clientSeq: 1 },
      ),
    }
    expect(validarSobre(base).ok).toBe(true)
    expect(validarSobre({ ...base, cmdId: 'otro' }).errores).toContain('cmdId-de-parada-automatica')
  })

  it('el contenido canónico cambia con cualquier campo, incluido el tiempo y lo observado', () => {
    const a = validarSobre(sobreBase()).sobre
    expect(contenidoCanonico(a)).toBe(contenidoCanonico({ ...a }))
    expect(contenidoCanonico({ ...a, accionTs: a.accionTs + 1, accionTsCrudo: a.accionTsCrudo + 1 })).not.toBe(contenidoCanonico(a))
    expect(contenidoCanonico({ ...a, observado: { ...a.observado, rev: 9 } })).not.toBe(contenidoCanonico(a))
  })
})
