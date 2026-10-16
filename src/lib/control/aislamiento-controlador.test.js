import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// REPORT_125: dónde puede estar cada cosa. Los Web Locks solo en el candado; la red solo en el adaptador; el controlador no toca
// el DOM ni el almacenamiento del navegador salvo por el registro de activación (módulo existente) ni lleva credenciales a avisos.

const DIR = import.meta.dirname
const codigo = (a) => readFileSync(join(DIR, a), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
const importes = (a) => [...codigo(a).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

describe('aislamiento del candado y del controlador', () => {
  it('imports', () => {
    expect(importes('sesion-candado.js')).toEqual([])
    expect(importes('sesion-controlador.js').sort()).toEqual(['./activacion-almacen', './reloj-telefono', './sesion-almacen', './sesion-api', './sesion-candado', './sesion-emisor', './sesion-motor', './sesion-visualizacion'].sort())
  })
  it('el candado no usa red, almacenamiento, canales ni interfaz; los Web Locks solo están ahí', () => {
    const f = codigo('sesion-candado.js')
    for (const mal of [/\bfetch\b/, /localStorage|sessionStorage|indexedDB/, /BroadcastChannel/, /\bdocument\b|\bwindow\b/, /\.jsx|react/i, /console\./]) expect(f, String(mal)).not.toMatch(mal)
    expect(codigo('sesion-controlador.js')).not.toMatch(/navigator\.locks\.request|locks\.request/)
    for (const a of ['sesion-emisor.js', 'sesion-api.js', 'sesion-almacen.js', 'sesion-motor.js']) expect(codigo(a), a).not.toMatch(/\.locks\b/)
  })
  it('el controlador no usa fetch directo, DOM, almacenamiento propio ni consola; el token no entra en los avisos', () => {
    const f = codigo('sesion-controlador.js')
    for (const mal of [/localStorage|sessionStorage|indexedDB/, /\bdocument\b|\bwindow\b/, /\.jsx|react/i, /console\./, /XMLHttpRequest/, /\/comandos/]) expect(f, String(mal)).not.toMatch(mal)
    expect(f).toMatch(/postMessage\(\{ v: 1, tipo: 'cambio' \}\)/)
    expect((f.match(/postMessage\(/g) ?? []).length).toBe(1)
  })
})
