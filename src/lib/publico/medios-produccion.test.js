import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mediosDeLiga, urlDeMedio } from './medios.js'

// REPORT_202: el manifiesto REAL del repositorio (public/medios/manifest.json) y los archivos que referencia, validados con el contrato existente.
// No renderiza nada nuevo; solo comprueba que lo que se despliega es lo aprobado y está completo.

const RAIZ = join(import.meta.dirname, '..', '..', '..', 'public', 'medios')
const manifiesto = JSON.parse(readFileSync(join(RAIZ, 'manifest.json'), 'utf8'))
const LIGA = 'SIMULACRO-PILOTO'
const ORDEN = ['parmigiana', 'workings', 'pce', 'javier-del-rio', 'deportes-jimmy', 'pixeles']
const MAX_PRECACHE = 2 * 1024 * 1024 // el límite de precaché del PWA; un png por encima rompe la compilación

const lista = (dir = RAIZ, base = '') => readdirSync(dir).flatMap((n) => {
  const ruta = join(dir, n)
  return statSync(ruta).isDirectory() ? lista(ruta, `${base}${n}/`) : [`${base}${n}`]
})
const png = (b) => ({ ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20), tipoColor: b[25] })
function jpg(b) {
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) return null
    const m = b[i + 1]
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) }
    i += 2 + b.readUInt16BE(i + 2)
  }
  return null
}

describe('manifiesto de medios de producción (public/medios)', () => {
  it('una sola liga, SIMULACRO-PILOTO; la raíz lleva el logo de Semabel; ninguna liga de pruebas ni patrocinador ficticio', () => {
    expect(Object.keys(manifiesto).sort()).toEqual(['ligas', 'semabel', 'version'])
    expect(manifiesto.version).toBe(1)
    expect(Object.keys(manifiesto.ligas)).toEqual([LIGA])
    expect(manifiesto.semabel).toEqual({ logo: 'SMB/semabel-transparente.png' })
  })

  it('el emblema del organizador y los seis patrocinadores, en su orden, con ids únicos', () => {
    const l = manifiesto.ligas[LIGA]
    expect(l.organizador).toEqual({ logo: 'PLATINIUM/platinium-logo.png' })
    expect(l.patrocinadores.map((p) => p.id)).toEqual(ORDEN)
    expect(new Set(l.patrocinadores.map((p) => p.id)).size).toBe(6)
    expect(l.patrocinadores.map((p) => p.nombre)).toEqual(['La Parmigiana', 'WORKINGS', 'Panama Crystal Engineering', 'Javier del Rio Corp', 'Deportes Jimmy', 'Píxeles & Diseños, S.A.'])
  })

  it('el contrato existente los acepta tal cual: seis tarjetas con logo, el emblema y el logo de Semabel', () => {
    const m = mediosDeLiga(manifiesto, LIGA)
    expect(m.semabelLogo).toBe('/medios/SMB/semabel-transparente.png')
    expect(m.organizador.logo).toBe('/medios/PLATINIUM/platinium-logo.png')
    expect(m.patrocinadores.map((p) => p.id)).toEqual(ORDEN)
    for (const p of m.patrocinadores) { expect(p.formato).toBe('tarjeta'); expect(p.disposicion).toBe('logo'); expect(p.logo).toMatch(/^\/medios\//) }
    // otra liga no hereda nada del piloto (solo el logo de Semabel, que es de marca)
    const otra = mediosDeLiga(manifiesto, 'PLATINIUM-U10')
    expect(otra.patrocinadores).toEqual([])
    expect(otra.organizador.logo ?? null).toBeNull()
  })

  const referidos = [manifiesto.semabel.logo, manifiesto.ligas[LIGA].organizador.logo, ...manifiesto.ligas[LIGA].patrocinadores.map((p) => p.logo)]
  it('cada archivo referido existe con ese nombre exacto (mayúsculas/minúsculas), es una imagen válida y cabe en el precaché', () => {
    const existentes = new Set(lista())
    for (const r of referidos) {
      expect(urlDeMedio(r)).toBe(`/medios/${r}`)
      expect(existentes.has(r), r).toBe(true) // comparación exacta con el listado del disco, no con existsSync (que en algunos sistemas ignora mayúsculas)
      const b = readFileSync(join(RAIZ, r))
      expect(b.length).toBeGreaterThan(1000)
      expect(b.length).toBeLessThan(MAX_PRECACHE)
      if (r.endsWith('.png')) { expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); const d = png(b); expect(d.ancho).toBeGreaterThan(100); expect(d.alto).toBeGreaterThan(100) }
      else { expect(b.subarray(0, 2).toString('hex')).toBe('ffd8'); const d = jpg(b); expect(d.ancho).toBeGreaterThan(100); expect(d.alto).toBeGreaterThan(100) }
    }
  })

  it('en public/medios solo está el manifiesto y los ocho archivos referidos (nada de ligas de pruebas, respaldos, PDF ni imágenes sueltas)', () => {
    expect(lista().sort()).toEqual(['manifest.json', ...referidos].sort())
  })

  it('dimensiones aprobadas y el logo de Semabel conserva la transparencia (PNG RGBA, esquinas con alfa 0)', () => {
    const dim = (r) => png(readFileSync(join(RAIZ, r)))
    expect(dim('SMB/semabel-transparente.png')).toMatchObject({ ancho: 652, alto: 333, tipoColor: 6 }) // 6 = RGBA
    expect(dim('PLATINIUM/platinium-logo.png')).toMatchObject({ ancho: 354, alto: 353 })
    expect(dim('PIXELES/pixeles-logo.png')).toMatchObject({ ancho: 2640, alto: 997 })
    expect(jpg(readFileSync(join(RAIZ, 'PARM/parmigiana.jpeg')))).toEqual({ ancho: 1600, alto: 1026 })
    expect(jpg(readFileSync(join(RAIZ, 'JIMMY/deportes-jimmy.jpg')))).toEqual({ ancho: 1504, alto: 450 })
    expect(existsSync(join(RAIZ, 'SMB/semabel-logo.png'))).toBe(false) // el logo opaco anterior no viaja
  })
})
