import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { servidorNuevo, telefonoNuevo } from './prueba/auxiliares-sesion'
import { NOMBRE_BD } from './sesion-almacen'

// La sesión de puntuación (S1a) es una pieza aparte: no toca la base del prototipo, el registro de activación ni el panel
// del organizador, no habla con la red, no maneja candados ni relojes del sistema y no depende de la interfaz.

const DIR = import.meta.dirname
const MODULOS = ['sesion-almacen.js', 'sesion-motor.js', 'reloj-telefono.js', 'sesion-visualizacion.js']
// Solo el código: los comentarios explican qué NO se hace y pueden nombrarlo.
const codigo = (archivo) => readFileSync(join(DIR, archivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const importes = (archivo) => [...codigo(archivo).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

describe('aislamiento de la sesión de puntuación', () => {
  it('solo importa el motor y a sí misma', () => {
    expect(importes('sesion-motor.js')).toEqual(['../motor', '../reglas-categoria', './sesion-visualizacion'])
    expect(importes('sesion-visualizacion.js')).toEqual([])
    expect(importes('reloj-telefono.js')).toEqual(['../motor'])
    expect(importes('sesion-almacen.js')).toEqual(['./sesion-motor'])
  })
  it('no usa red, candados, localStorage, hora del sistema, azar ni la interfaz', () => {
    for (const m of MODULOS) {
      const f = codigo(m)
      for (const mal of [/\bfetch\b/, /XMLHttpRequest/, /navigator\.locks/, /BroadcastChannel/, /localStorage|sessionStorage/, /\bDexie\b/, /\/comandos/, /Date\.now|new Date\(\)|performance\.now/, /Math\.random/, /\.jsx|ui\.jsx|react/i, /setTimeout|setInterval/]) {
        expect(f, `${m} ${mal}`).not.toMatch(mal)
      }
    }
  })
  it('IndexedDB solo aparece en el almacén; el motor y el reloj son puros', () => {
    expect(codigo('sesion-motor.js')).not.toMatch(/indexedDB|IDB/)
    expect(codigo('reloj-telefono.js')).not.toMatch(/indexedDB|IDB/)
    expect(codigo('sesion-almacen.js')).toMatch(/indexedDB/)
  })
  it('la base es propia: no es la del prototipo (Dexie «sebel»)', () => {
    expect(NOMBRE_BD).toBe('sebel-control-sesion')
    expect(NOMBRE_BD).not.toBe('sebel')
  })
  it('un recorrido completo solo crea bases con nombre de prueba; nunca la del prototipo', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear()
    await tel.iniciar()
    await tel.enviarSiguiente()
    const nombres = (await indexedDB.databases()).map((d) => d.name)
    expect(nombres.length).toBeGreaterThan(0)
    expect(nombres).not.toContain('sebel')
    expect(nombres).not.toContain(NOMBRE_BD)
    expect(nombres.every((n) => n.startsWith('prueba-sesion-'))).toBe(true)
  })
  it('no copia ningún secreto a la sesión: ni token ni credencial', async () => {
    const banco = servidorNuevo()
    const tel = await telefonoNuevo(banco)
    await tel.crear()
    await tel.iniciar()
    const lect = await tel.leer()
    const todo = JSON.stringify([lect.sesion, lect.entradas])
    expect(todo).not.toMatch(/token|credencial|cred-A|bearer/i)
  })
})
