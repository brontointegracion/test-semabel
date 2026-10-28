// REPORT_246 — invariantes del PRECURSOR de respaldo sobre c082574: solo se AÑADE respaldo de lectura; esquema, constructores, configuración y comportamiento base no cambian;
// la importación solo existe en `ensayo/` y nada de `src/` la alcanza.
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it } from 'node:test'

const RAIZ = new URL('../..', import.meta.url).pathname
const git = (...a) => execFileSync('git', ['-C', RAIZ, ...a], { encoding: 'utf8' })
const BASE = 'c082574'
const CAMBIADOS_PERMITIDOS = ['backend/src/worker.js', 'backend/src/liga-do.js', 'backend/src/acceso/acceso-do.js', 'backend/test/worker-prueba.js']
const NUEVOS_PERMITIDOS = [
  'backend/src/respaldo.js', 'backend/src/respaldo-rutas.js', 'backend/ensayo/', 'backend/RESPALDO-PRECURSOR.md', 'backend/wrangler.ensayo.jsonc',
  'backend/scripts/respaldo-privado.mjs', 'backend/scripts/lib/respaldo-privado.mjs', 'backend/test/respaldo.check.js', 'backend/test/cli-respaldo.node-test.mjs', 'backend/test/respaldo-precursor.node-test.mjs',
]
const lista = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? lista(p) : [p] })

describe('el precursor solo AÑADE respaldo de lectura', () => {
  it(`los archivos base modificados son solo los permitidos y sus cambios son ADITIVOS (cero líneas borradas); los nuevos son solo los del respaldo`, () => {
    const cambiados = git('diff', '--name-only', BASE).split('\n').filter(Boolean)
    assert.deepEqual(cambiados.filter((f) => !CAMBIADOS_PERMITIDOS.includes(f)), [], 'archivo base modificado fuera de lo permitido')
    for (const l of git('diff', '--numstat', BASE).split('\n').filter(Boolean)) {
      const [, borradas, f] = l.split('\t')
      assert.equal(borradas, '0', `${f}: se borró código base`)
    }
    const nuevos = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)
    for (const f of nuevos) assert.ok(NUEVOS_PERMITIDOS.some((p) => f === p || (p.endsWith('/') && f.startsWith(p))), `archivo nuevo inesperado: ${f}`)
  })

  it('configuración de producción, esquema y versiones idénticos a c082574 (sin migraciones, sin cambios de bindings, assets ni vars)', () => {
    for (const f of ['backend/wrangler.jsonc', 'backend/src/esquema.js', 'backend/src/acceso/esquema-acceso.js', 'backend/src/resumen-publico.js', 'backend/src/acceso/config.js', 'backend/src/adaptador-liga.js', 'backend/src/rutas-carga.js', 'backend/package.json', 'package.json']) {
      assert.equal(git('diff', '--stat', BASE, '--', f).trim(), '', `${f} cambió`)
    }
    assert.match(readFileSync(join(RAIZ, 'backend/src/esquema.js'), 'utf8'), /export const VERSION_ESQUEMA = 9\b/)
    assert.match(readFileSync(join(RAIZ, 'backend/src/acceso/esquema-acceso.js'), 'utf8'), /export const VERSION_ESQUEMA_ACCESO = 1\b/)
    const cfg = readFileSync(join(RAIZ, 'backend/wrangler.jsonc'), 'utf8')
    assert.ok(!/respaldo|ensayo/i.test(cfg))
    assert.ok(cfg.includes('"ACCESO_ADMIN_HABILITADO": "0"')) // la puerta sigue cerrada por omisión
  })

  it('el constructor de cada objeto y la lógica de órdenes no cambian: las clases solo ganan los métodos de respaldo', () => {
    for (const f of ['backend/src/liga-do.js', 'backend/src/acceso/acceso-do.js']) {
      const diff = git('diff', '-U0', BASE, '--', f)
      const añadidas = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n')
      assert.ok(!/constructor|crearEsquema|transactionSync\(\(\) => \{\s*sql\.exec\((?!'SELECT)/.test(añadidas), `${f}: toca el constructor o el esquema`)
      assert.match(añadidas, /exportarRespaldoOperador/); assert.match(añadidas, /marcadorRecuperacionOperador/)
    }
    const w = git('diff', '-U0', BASE, '--', 'backend/src/worker.js')
    assert.equal(w.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length, 2) // el import y la línea de enrutamiento
  })
})

describe('la importación no existe fuera del ensayo', () => {
  it('ningún archivo de src/ importa ensayo/ ni contiene una ruta o un método de importación', () => {
    for (const f of lista(join(RAIZ, 'backend/src'))) {
      const t = readFileSync(f, 'utf8')
      const r = relative(RAIZ, f)
      assert.ok(!/ensayo\//.test(t.replace(/\/\/.*$/gm, '')), `${r} importa ensayo/`)
      assert.ok(!/importarRespaldo|importarObjeto|\/v1\/ensayo|ENTORNO_ENSAYO|restaurar.*respaldo/i.test(t.replace(/\/\/.*$/gm, '')), `${r} contiene importación`)
    }
    for (const f of ['backend/src/respaldo.js', 'backend/src/respaldo-rutas.js']) {
      // ninguna llamada `.exec(` / `.exec(` con SQL que no sea SELECT (las lecturas usan SELECT; nada escribe, ni siquiera PRAGMA)
      const t = readFileSync(join(RAIZ, f), 'utf8')
      const llamadas = [...t.matchAll(/\.exec\(\s*([`'"])([\s\S]*?)\1/g)].map((m) => m[2].trim().split(/\s+/)[0].toUpperCase())
      assert.ok(llamadas.length > 0 || f.endsWith('rutas.js'))
      assert.deepEqual([...new Set(llamadas)], f.endsWith('rutas.js') ? [] : ['SELECT'], `${f}: sentencia que no es SELECT`)
    }
  })

  it('el punto de entrada de ensayo no es el `main` de ninguna configuración que no sea la de ensayo', () => {
    const configs = readdirSync(join(RAIZ, 'backend')).filter((f) => /^wrangler[^/]*\.jsonc$/.test(f)).map((f) => join(RAIZ, 'backend', f))
    for (const c of configs) {
      const main = /"main":\s*"([^"]+)"/.exec(readFileSync(c, 'utf8'))?.[1]
      if (/ensayo\//.test(main ?? '')) assert.ok(c.endsWith('wrangler.ensayo.jsonc'), `${c} apunta al ensayo`)
    }
    const e = readFileSync(join(RAIZ, 'backend/wrangler.ensayo.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '') // sin los comentarios
    assert.ok(!/"routes"|account_id|custom_domain|"zone/.test(e)); assert.match(e, /"ENTORNO": "ensayo-respaldo"/)
  })
})
