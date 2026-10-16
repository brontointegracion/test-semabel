import { describe, expect, it } from 'vitest'
import { ahoraServidor, crearMuestra, huboSalto, restanteVisible } from './reloj-servidor.js'
import { vistaReloj, iniciales } from './vista-reloj.js'

const muestra = (servidorAhoraMs, monoInicio = 1000, monoFin = 1100) => crearMuestra({ servidorAhoraMs, monoInicio, monoFin })

describe('hora del servidor estimada con reloj monotónico', () => {
  it('estima en el punto medio del viaje y avanza solo con el monotónico', () => {
    const m = muestra(5_000_000)
    expect(m).toEqual({ servidorAhoraMs: 5_000_000, monoMedio: 1050, incertidumbreMs: 50 })
    expect(ahoraServidor(m, 1050)).toBe(5_000_000)
    expect(ahoraServidor(m, 3050)).toBe(5_002_000)
  })
  it('un viaje imposible no produce muestra', () => {
    expect(crearMuestra({ servidorAhoraMs: 1, monoInicio: 5, monoFin: 4 })).toBeNull()
    expect(crearMuestra({ servidorAhoraMs: 1, monoInicio: 0, monoFin: 20_000 })).toBeNull()
    expect(crearMuestra({ servidorAhoraMs: NaN, monoInicio: 0, monoFin: 1 })).toBeNull()
  })
  it('con el reloj del DISPOSITIVO desfasado (adelantado o atrasado horas) el reloj del partido es el mismo', () => {
    const base = Date.now
    try {
      const m = muestra(9_000_000)
      const reloj = { estado: 'corriendo', restanteMs: 300_000, desdeMs: 8_990_000 }
      for (const desfase of [0, +7 * 3600_000, -3 * 3600_000]) {
        Date.now = () => base() + desfase
        expect(restanteVisible({ reloj, muestra: m, mono: 1050 })).toBe(290_000) // 10 s corridos según el SERVIDOR
        expect(restanteVisible({ reloj, muestra: m, mono: 6050 })).toBe(285_000)
      }
    } finally { Date.now = base }
  })
  it('restanteVisible: detenido = confirmado; corriendo = baja sin pasar de 0 ni subir; sin restante = null', () => {
    const m = muestra(1_000_000)
    expect(restanteVisible({ reloj: { estado: 'detenido', restanteMs: 42_000, desdeMs: null }, muestra: m, mono: 99_999 })).toBe(42_000)
    expect(restanteVisible({ reloj: { estado: 'corriendo', restanteMs: 5_000, desdeMs: 1_000_000 }, muestra: m, mono: 1050 + 60_000 })).toBe(0)
    expect(restanteVisible({ reloj: { estado: 'corriendo', restanteMs: 5_000, desdeMs: 1_005_000 }, muestra: m, mono: 1050 })).toBe(5_000) // desde en el futuro: no sube
    expect(restanteVisible({ reloj: { estado: null, restanteMs: null, desdeMs: null }, muestra: m, mono: 1050 })).toBeNull()
  })
  it('detecta un salto del reloj de pared respecto del monotónico (suspensión, cambio de hora)', () => {
    expect(huboSalto({ pared: 1000, mono: 1000 }, { pared: 1500, mono: 1500 })).toBe(false)
    expect(huboSalto({ pared: 1000, mono: 1000 }, { pared: 1500, mono: 1510 })).toBe(false)
    expect(huboSalto({ pared: 1000, mono: 1000 }, { pared: 60_000, mono: 1500 })).toBe(true) // el reloj de pared saltó
    expect(huboSalto({ pared: 1000, mono: 1000 }, { pared: 1500, mono: 90_000 })).toBe(true)
  })
})

describe('vista del reloj: pausa, 00:00, final y datos viejos', () => {
  const m = muestra(1_000_000)
  const v = (estado, reloj, extra = {}) => vistaReloj({ estado, reloj, muestra: m, mono: 1050, relojConfiable: true, ...extra })
  it('corriendo: cuenta regresiva; detenido: valor confirmado con nota; 00:00: «Fin del período» (no es final)', () => {
    expect(v('vivo', { estado: 'corriendo', restanteMs: 125_000, desdeMs: 1_000_000 - 5000 })).toEqual({ texto: '02:00', nota: null, detenido: false })
    expect(v('vivo', { estado: 'detenido', restanteMs: 125_000, desdeMs: null })).toEqual({ texto: '02:05', nota: 'Reloj detenido', detenido: true })
    expect(v('vivo', { estado: 'detenido', restanteMs: 0, desdeMs: null })).toEqual({ texto: '00:00', nota: 'Fin del período', detenido: true })
    expect(v('vivo', { estado: 'corriendo', restanteMs: 3000, desdeMs: 1_000_000 - 9000 })).toMatchObject({ texto: '00:00', nota: 'Fin del período' })
  })
  it('programado y final no muestran reloj en marcha', () => {
    expect(v('programado', { estado: null, restanteMs: null, desdeMs: null })).toEqual({ texto: null, nota: null, detenido: true })
    expect(v('final', { estado: 'detenido', restanteMs: 0, desdeMs: null }).texto).toBeNull()
  })
  it('dato viejo o muestra rota: se congela el último valor CONFIRMADO con «Sin actualizar» (no se inventa una pausa)', () => {
    const reloj = { estado: 'corriendo', restanteMs: 125_000, desdeMs: 1_000_000 - 5000 }
    expect(vistaReloj({ estado: 'vivo', reloj, muestra: m, mono: 1050 + 600_000, relojConfiable: false })).toEqual({ texto: '02:00', nota: 'Sin actualizar', detenido: true })
    expect(vistaReloj({ estado: 'vivo', reloj, muestra: null, mono: 1, relojConfiable: true })).toMatchObject({ texto: '--:--' })
    expect(vistaReloj({ estado: 'vivo', reloj: { estado: null, restanteMs: null, desdeMs: null }, muestra: m, mono: 1050, relojConfiable: true }).texto).toBe('--:--')
  })
  it('iniciales del escudo de texto', () => {
    expect(iniciales('Los Tigres')).toBe('LT')
    expect(iniciales('Alfa')).toBe('AL')
    expect(iniciales('  ')).toBe('?')
  })
})
