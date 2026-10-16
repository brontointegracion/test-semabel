import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// El motor no puede depender de almacenamiento, pantallas ni servicios, ni leer
// la hora o el azar por su cuenta. Misma idea que la exploración de código de
// reloj.test.js: se lee el código fuente.

const DIR = 'src/lib/motor'
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const archivos = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const ruta = join(dir, e.name)
  return e.isDirectory() ? archivos(ruta) : [ruta]
})
const fuente = (ruta) => sinComentarios(readFileSync(ruta, 'utf8'))
const importes = (texto) => [...texto.matchAll(/(?:import|export)[^'"`]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2])

// Lo que ningún módulo puro del motor (ni la dependencia externa nueva de preparacion.js) puede usar.
const PROHIBIDO = [
  /Date\.now/, /Math\.random/, /new Date\(\s*\)/, /performance\./, /\bcrypto\b/,
  /localStorage|sessionStorage|indexedDB/, /\bfetch\s*\(/, /\bimport\s*\(/, /\brequire\s*\(/,
  /\bprocess\./, /\bsetTimeout|\bsetInterval|\bsetImmediate/, /\bwindow\b|\bdocument\b|\bnavigator\b/,
  /\bDurableObject|\bcloudflare\b|\bwrangler\b/i,
]

const motor = archivos(DIR).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && !f.includes('/prueba/'))
const prueba = archivos(DIR).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f.includes('/prueba/'))

describe('independencia del motor', () => {
  it('hay módulos de motor que revisar', () => {
    expect(motor.length).toBeGreaterThanOrEqual(8)
  })

  it('solo importa a sus hermanos y a los cálculos puros existentes', () => {
    // '../identidad' aporta activoDe (sin imports propios): la misma regla de elegibilidad que usa la app.
    // '../dorsal' y '../prontitud-plantilla' los usa preparacion.js (lectura del número guardado y regla de
    // "listo para comenzar"); su pureza se comprueba abajo, módulo por módulo, no solo por estar en esta lista.
    const permitidos = new Set(['../reloj-calculo', '../marcador-calculo', '../identidad', '../dorsal', '../prontitud-plantilla'])
    for (const f of motor) {
      for (const origen of importes(fuente(f))) {
        const ok = origen.startsWith('./') || permitidos.has(origen)
        expect(ok, `${f} importa ${origen}`).toBe(true)
      }
    }
  })

  it('no toca almacenamiento, red, hora, azar ni entorno', () => {
    const prohibido = PROHIBIDO
    for (const f of motor) {
      const t = fuente(f)
      for (const re of prohibido) expect(re.test(t), `${f} usa ${re}`).toBe(false)
    }
  })

  // Las dependencias externas que preparacion.js incorporó (dorsal, prontitud-plantilla y la identidad que esta
  // usa) quedan acotadas: sin APIs prohibidas y sin importar nada fuera de ese mismo grupo. Cubre solo ese
  // grupo; no revisa el resto de las dependencias permitidas (por ejemplo reloj-calculo.js, que usa Date.now
  // como valor por defecto: una brecha existente y ajena a este paquete).
  it('las dependencias externas de preparacion.js son puras y no importan fuera de su grupo', () => {
    const grupo = ['src/lib/dorsal.js', 'src/lib/prontitud-plantilla.js', 'src/lib/identidad.js']
    const nombres = new Set(['./dorsal', './prontitud-plantilla', './identidad'])
    for (const f of grupo) {
      const t = fuente(f)
      expect(t.length, f).toBeGreaterThan(0)
      for (const origen of importes(t)) expect(nombres.has(origen), `${f} importa ${origen}`).toBe(true)
      for (const re of PROHIBIDO) expect(re.test(t), `${f} usa ${re}`).toBe(false)
    }
    // preparacion.js solo importa lo previsto: sus hermanos y ese grupo.
    expect(importes(fuente('src/lib/motor/preparacion.js')).sort()).toEqual(
      ['../dorsal', '../identidad', '../prontitud-plantilla', './atribucion', './sobre'].sort(),
    )
  })

  it('el código de apoyo de pruebas tampoco importa la base de datos ni la interfaz', () => {
    for (const f of prueba) {
      for (const origen of importes(fuente(f))) {
        expect(origen.startsWith('./') || origen.startsWith('../'), `${f}: ${origen}`).toBe(true)
        expect(/db|react|dexie/.test(origen), `${f}: ${origen}`).toBe(false)
      }
    }
  })

  it('el adaptador de memoria está rotulado como no durable y solo para pruebas', () => {
    const t = readFileSync(join(DIR, 'prueba/adaptador-memoria.js'), 'utf8')
    expect(t).toMatch(/SOLO PARA PRUEBAS/)
    expect(t).toMatch(/NO ES DURABLE/)
  })
})
