// Invariantes del puerto de la exportacion de LIGAS sobre ca7a2eb: solo se AÑADE respaldo de lectura; esquema, constructores, configuracion de produccion y comportamiento base no cambian;
// no hay exportacion del objeto de acceso, ni importacion, restauracion o rutas de control de pruebas. Lee Git (solo lectura) y los fuentes; sin red.
import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it } from 'node:test'

const RAIZ = new URL('../..', import.meta.url).pathname
const git = (...a) => execFileSync('git', ['-C', RAIZ, ...a], { encoding: 'utf8' })
const BASE = 'ca7a2eb'
const CAMBIADOS_PERMITIDOS = ['backend/src/worker.js', 'backend/src/liga-do.js', 'backend/test/worker-prueba.js']
const NUEVOS_PERMITIDOS = [
  'backend/src/respaldo.js', 'backend/src/respaldo-rutas.js', 'backend/scripts/respaldo-privado.mjs', 'backend/scripts/lib/respaldo-privado.mjs',
  'backend/test/respaldo-liga.check.js', 'backend/test/cli-respaldo-liga.node-test.mjs', 'backend/test/respaldo-liga-invariantes.node-test.mjs',
  // convertidor portatil y su empaquetado (REPORT_261 a REPORT_265)
  'backend/scripts/exportar-portable.mjs', 'backend/scripts/empaquetar-organizador.mjs', 'backend/scripts/verificar-lecturas-publicas.mjs',
  'backend/scripts/lib/exportar-portable.mjs', 'backend/scripts/lib/lector-portable.mjs', 'backend/scripts/lib/paquete-organizador.mjs', 'backend/scripts/lib/util-portable.mjs',
  'backend/scripts/lib/zip-portable.mjs', 'backend/scripts/lib/empaquetar-portable.mjs', 'backend/scripts/lib/lecturas-publicas.mjs',
  'backend/test/exportar-portable.node-test.mjs', 'backend/test/lecturas-publicas.node-test.mjs', 'docs/export/',
]
const lista = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? lista(p) : [p] })
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('el puerto solo AÑADE exportacion de lectura de ligas', () => {
  it('los archivos base modificados son solo los permitidos y sus cambios son ADITIVOS; los nuevos son solo los previstos', () => {
    const cambiados = git('diff', '--name-only', '--diff-filter=MDRT', BASE).split('\n').filter(Boolean)
    assert.deepEqual(cambiados.filter((f) => !CAMBIADOS_PERMITIDOS.includes(f)), [], 'archivo base modificado fuera de lo permitido')
    for (const l of git('diff', '--numstat', '--diff-filter=MDRT', BASE).split('\n').filter(Boolean)) {
      const [, borradas, f] = l.split('\t')
      assert.equal(borradas, '0', `${f}: se borro codigo base`)
    }
    const nuevos = [...git('diff', '--name-only', '--diff-filter=A', BASE).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean)
    for (const f of nuevos) assert.ok(NUEVOS_PERMITIDOS.some((p) => f === p || (p.endsWith('/') && f.startsWith(p))), `archivo nuevo inesperado: ${f}`)
  })

  it('configuracion de produccion, esquema, acceso, rutas de carga y proyecciones identicos a ca7a2eb; compuerta cerrada; esquema 9 / acceso 1', () => {
    for (const f of ['backend/wrangler.jsonc', 'backend/wrangler.test.jsonc', 'backend/package.json', 'backend/package-lock.json', 'backend/src/esquema.js', 'backend/src/acceso/esquema-acceso.js', 'backend/src/acceso/acceso-do.js',
      'backend/src/acceso/config.js', 'backend/src/acceso/rutas.js', 'backend/src/resumen-publico.js', 'backend/src/adaptador-liga.js', 'backend/src/rutas-carga.js', 'backend/src/sede-ortografia.js',
      'backend/src/proyeccion-publica.js', 'backend/src/proyeccion-equipo.js', 'backend/src/proyeccion-jugadores.js', 'backend/src/admision.js', 'backend/src/credenciales.js', 'package.json', 'package-lock.json', 'vite.config.js']) {
      assert.equal(git('diff', '--stat', BASE, '--', f).trim(), '', `${f} cambio`)
    }
    assert.match(readFileSync(join(RAIZ, 'backend/src/esquema.js'), 'utf8'), /export const VERSION_ESQUEMA = 9\b/)
    assert.match(readFileSync(join(RAIZ, 'backend/src/acceso/esquema-acceso.js'), 'utf8'), /export const VERSION_ESQUEMA_ACCESO = 1\b/)
    const cfg = readFileSync(join(RAIZ, 'backend/wrangler.jsonc'), 'utf8')
    assert.ok(!/respaldo|ensayo/i.test(cfg))
    assert.ok((cfg.match(/"ACCESO_ADMIN_HABILITADO": "0"/g) ?? []).length >= 3) // local, staging y produccion: cerrada
    assert.ok(!/"migrations"[^\]]*respaldo/i.test(cfg))
  })

  it('el constructor y la logica de ordenes no cambian: LigaDO solo gana los metodos de respaldo; el Worker solo gana el import y una linea de enrutamiento', () => {
    const diff = git('diff', '-U0', BASE, '--', 'backend/src/liga-do.js')
    const añadidas = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n')
    assert.ok(!/constructor|crearEsquema|CREATE TABLE|ALTER TABLE|migrac/i.test(añadidas))
    assert.match(añadidas, /exportarRespaldoOperador/); assert.match(añadidas, /marcadorRecuperacionOperador/)
    const w = git('diff', '-U0', BASE, '--', 'backend/src/worker.js').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    assert.equal(w.length, 2)
    assert.match(w.join('\n'), /esRutaDeRespaldo/)
    assert.equal(git('diff', '--stat', BASE, '--', 'backend/src/acceso/acceso-do.js').trim(), '') // el objeto de acceso no gana ningun metodo de exportacion
  })

  it('el codigo exporta SOLO ligas: sin tablas del objeto de acceso, sin ruta de acceso, sin importacion/restauracion/control de pruebas', () => {
    const r = readFileSync(join(RAIZ, 'backend/src/respaldo.js'), 'utf8')
    assert.ok(!/AccesoDO|organizadores|sesiones|codigos_organizador|asignaciones_liga/.test(sinComentarios(r)))
    const rutas = readFileSync(join(RAIZ, 'backend/src/respaldo-rutas.js'), 'utf8')
    assert.ok(!/acceso|ACCESO\b/.test(sinComentarios(rutas).replace(/administracionHabilitada|\.\/acceso\/(config|http)\.js|ACCESO_ADMIN_TOKEN/g, '')))
    for (const f of lista(join(RAIZ, 'backend/src'))) {
      const t = sinComentarios(readFileSync(f, 'utf8'))
      const nombre = relative(RAIZ, f)
      assert.ok(!/ensayo\//.test(t), `${nombre} importa ensayo/`)
      assert.ok(!/importarRespaldo|importarObjeto|\/v1\/ensayo|ENTORNO_ENSAYO|restaurarRespaldo|\/restaurar-respaldo/i.test(t), `${nombre} contiene importacion o restauracion`)
    }
  })

  it('respaldo.js solo ejecuta SELECT; las rutas no ejecutan SQL', () => {
    for (const f of ['backend/src/respaldo.js', 'backend/src/respaldo-rutas.js']) {
      const t = readFileSync(join(RAIZ, f), 'utf8')
      const llamadas = [...t.matchAll(/\.exec\(\s*([`'"])([\s\S]*?)\1/g)].map((m) => m[2].trim().split(/\s+/)[0].toUpperCase())
      assert.deepEqual([...new Set(llamadas)], f.endsWith('rutas.js') ? [] : ['SELECT'], `${f}: sentencia que no es SELECT`)
    }
  })

  it('el cliente de captura solo pide exportar/marcador de LIGAS por POST y no tiene ninguna opcion para el objeto de acceso', () => {
    const t = readFileSync(join(RAIZ, 'backend/scripts/lib/respaldo-privado.mjs'), 'utf8') + readFileSync(join(RAIZ, 'backend/scripts/respaldo-privado.mjs'), 'utf8')
    assert.ok(!/acceso/i.test(sinComentarios(t).replace(/ACCESO_ADMIN|acceso-/g, '')), 'el cliente menciona el objeto de acceso')
    assert.match(t, /\/v1\/admin\/respaldo\/ligas\//)
  })
})
