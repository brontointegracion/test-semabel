import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ID, drenar, entornoEmisor, volcarBase } from './prueba/auxiliares-emisor'

// REPORT_124: dónde puede estar cada cosa. La red SOLO en el adaptador; el emisor no la toca ni maneja candados, almacenamiento
// del navegador ni interfaz; y el token no se copia a ningún sitio.

const DIR = import.meta.dirname
const codigo = (archivo) => readFileSync(join(DIR, archivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
const importes = (archivo) => [...codigo(archivo).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

describe('aislamiento del adaptador y del emisor', () => {
  it('imports: el adaptador no importa nada; el emisor solo el almacén S1a y el módulo de reloj', () => {
    expect(importes('sesion-api.js')).toEqual([])
    expect(importes('sesion-emisor.js')).toEqual(['./sesion-almacen', './reloj-telefono'])
  })
  it('el emisor no usa red, candados, almacenamiento del navegador, canales ni interfaz', () => {
    const f = codigo('sesion-emisor.js')
    for (const mal of [/\bfetch\b/, /XMLHttpRequest/, /navigator/, /BroadcastChannel/, /localStorage|sessionStorage|indexedDB/, /\bDexie\b/, /\/comandos/, /\.jsx|react/i, /\bdocument\b|\bwindow\b/, /console\./]) {
      expect(f, String(mal)).not.toMatch(mal)
    }
  })
  it('el adaptador no usa almacenamiento, candados ni interfaz, ni escribe en consola; el token solo se usa en la cabecera Authorization', () => {
    const f = codigo('sesion-api.js')
    for (const mal of [/localStorage|sessionStorage|indexedDB/, /navigator/, /BroadcastChannel/, /\.jsx|react/i, /\bdocument\b|\bwindow\b/, /console\./, /\bDexie\b/]) {
      expect(f, String(mal)).not.toMatch(mal)
    }
    expect((f.match(/authorization/g) ?? []).length).toBe(1)
    expect(f).not.toMatch(/\$\{t\}[^`]*\/|encodeURIComponent\(t\)|\?token|token=/)
  })
  it('ni el almacén, ni el estado del emisor, ni las URL, ni los resultados contienen el token tras un recorrido completo', async () => {
    const e = await entornoEmisor()
    await e.tel.iniciar()
    await e.tel.leer()
    e.emisor.despertar(); await drenar(e)
    const vistos = []
    e.emisor.suscribir((s) => vistos.push(s))
    await e.emisor.verificarAhora()
    expect(await volcarBase(e.tel.almacen)).not.toContain('TOKEN-SECRETO')
    expect(JSON.stringify(e.emisor.estado())).not.toContain('TOKEN-SECRETO')
    expect(JSON.stringify(vistos)).not.toContain('TOKEN-SECRETO')
    expect(e.f.llamadas.every((l) => !l.url.includes('TOKEN-SECRETO') && JSON.stringify(l.init.body ?? '').indexOf('TOKEN-SECRETO') === -1)).toBe(true)
    expect(e.f.llamadas.length).toBeGreaterThan(0)
    expect(ID).toBe('L1:P')
    await e.emisor.cerrar()
  })
})
