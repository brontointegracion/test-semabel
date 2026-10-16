import { describe, expect, it } from 'vitest'
import { hora12, horaLocal, claveDiaPanama, diaRelativoPanama, fechaCortaPanama, horaCompletaPanama, horaPanama, partesPanama } from './formato.js'

describe('fechas y horas en America/Panama', () => {
  it('cruce de fecha UTC: las 02:30 UTC del lunes 2 son las 21:30 del domingo 1 en Panamá', () => {
    expect(fechaCortaPanama('2026-11-02T02:30:00.000Z')).toBe('dom 1 nov')
    expect(horaPanama('2026-11-02T02:30:00.000Z')).toBe('9:30 p. m.')
    expect(claveDiaPanama('2026-11-02T02:30:00.000Z')).toBe('2026-11-01')
    expect(horaCompletaPanama('2026-11-02T02:30:09.000Z')).toBe('9:30:09 p. m.')
  })
  it('las 05:00 UTC son las 00:00 del mismo día en Panamá; las 04:59 UTC siguen en el día anterior', () => {
    expect(horaPanama('2026-11-02T05:00:00Z')).toBe('12:00 a. m.')
    expect(claveDiaPanama('2026-11-02T05:00:00Z')).toBe('2026-11-02')
    expect(claveDiaPanama('2026-11-02T04:59:59Z')).toBe('2026-11-01')
  })
  it('el resultado NO depende de la zona horaria del dispositivo', () => {
    const original = process.env.TZ
    try {
      const salidas = ['UTC', 'Asia/Tokyo', 'Pacific/Auckland', 'America/Los_Angeles'].map((tz) => {
        process.env.TZ = tz
        return [fechaCortaPanama('2026-11-02T02:30:00Z'), horaPanama('2026-11-02T02:30:00Z'), claveDiaPanama('2026-12-31T23:30:00Z')]
      })
      for (const s of salidas) expect(s).toEqual(['dom 1 nov', '9:30 p. m.', '2026-12-31'])
    } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original }
  })
  it('día relativo según el día de Panamá de «ahora» (no el del dispositivo)', () => {
    const ahora = Date.parse('2026-11-02T03:00:00Z') // 22:00 del domingo 1 en Panamá
    expect(diaRelativoPanama('2026-11-02T02:00:00Z', ahora)).toBe('Hoy')
    expect(diaRelativoPanama('2026-11-02T17:00:00Z', ahora)).toBe('Mañana')
    expect(diaRelativoPanama('2026-11-08T17:00:00Z', ahora)).toBe('dom 8 nov')
  })
  it('valores inválidos dan null, no «Invalid Date»', () => {
    for (const malo of ['nada', null, undefined, NaN]) {
      expect(horaPanama(malo)).toBeNull()
      expect(fechaCortaPanama(malo)).toBeNull()
      expect(partesPanama(malo)).toBeNull()
    }
  })
})

describe('hora de 12 horas con a. m. / p. m. (REPORT_161)', () => {
  it('hora12: mañana, mediodía, tarde y medianoche', () => {
    expect([[9, 0], [13, 0], [18, 0], [0, 0], [12, 0], [0, 5], [12, 59], [23, 59], [1, 7]].map(([h, m]) => hora12(h, m)))
      .toEqual(['9:00 a. m.', '1:00 p. m.', '6:00 p. m.', '12:00 a. m.', '12:00 p. m.', '12:05 a. m.', '12:59 p. m.', '11:59 p. m.', '1:07 a. m.'])
    expect(hora12(0, 0, 9)).toBe('12:00:09 a. m.')
    expect(hora12(15, 5, 9)).toBe('3:05:09 p. m.')
  })
  it('horaPanama: las horas del piloto y los límites del día de Panamá (UTC−5)', () => {
    expect(horaPanama('2026-10-24T14:00:00.000Z')).toBe('9:00 a. m.') // 09:00 Panamá
    expect(horaPanama('2026-10-24T18:00:00.000Z')).toBe('1:00 p. m.') // 13:00
    expect(horaPanama('2026-10-24T23:00:00.000Z')).toBe('6:00 p. m.') // 18:00
    expect(horaPanama('2026-10-24T05:00:00.000Z')).toBe('12:00 a. m.') // medianoche de Panamá
    expect(horaPanama('2026-10-24T17:00:00.000Z')).toBe('12:00 p. m.') // mediodía
    expect(horaPanama('2026-10-25T04:59:00.000Z')).toBe('11:59 p. m.') // último minuto del día 24
    expect(claveDiaPanama('2026-10-25T04:59:00.000Z')).toBe('2026-10-24')
    expect(horaPanama('2026-10-25T05:00:00.000Z')).toBe('12:00 a. m.')
    expect(claveDiaPanama('2026-10-25T05:00:00.000Z')).toBe('2026-10-25')
  })
  it('el orden y la zona no cambian: mismo instante, misma hora de Panamá con cualquier zona del dispositivo; null si no es fecha', () => {
    expect(horaPanama(Date.parse('2026-10-24T14:00:00.000Z'))).toBe('9:00 a. m.')
    expect(horaPanama('basura')).toBeNull()
    expect(horaLocal('basura')).toBeNull()
  })
  it('horaLocal (zona del dispositivo) usa el mismo formato', () => {
    const d = new Date(2026, 9, 24, 15, 7, 9)
    expect(horaLocal(d.getTime())).toBe('3:07 p. m.')
    expect(horaLocal(d.toISOString(), true)).toBe('3:07:09 p. m.')
    expect(horaLocal(new Date(2026, 9, 24, 0, 0).getTime())).toBe('12:00 a. m.')
  })
})

describe('textos de partido compartidos (cabecera) y 12 horas', () => {
  it('«Juegan el … a las 3:07 p. m.»', async () => {
    const { textosDePartido } = await import('../cabecera.js')
    const inicio = new Date(2026, 9, 24, 15, 7).toISOString()
    const t = textosDePartido({ partido: { inicio, estado: 'programado' }, liga: { nombre: 'L' }, cancha: { nombre: 'C' }, local: { nombre: 'A' }, visita: { nombre: 'B' } })
    expect(t.descripcion).toContain('a las 3:07 p. m.')
    expect(t.descripcion).not.toMatch(/\b15:07\b/)
  })
})
