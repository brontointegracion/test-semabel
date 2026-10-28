// Verificación del PAQUETE DE PRODUCCIÓN del precursor (REPORT_246; solo local, sin cuenta ni red): empaqueta con `wrangler deploy --dry-run --env production` (copia aislada de la
// configuración: solo cambian `main` y las carpetas de assets) y comprueba que el paquete NO contiene importación ni restauración, que SÍ contiene el respaldo de lectura y que
// los exports, los enlaces y las variables son los de la base c082574 (empaquetada igual, desde `git archive`).
//   node ensayo/verificar-paquete.mjs CARPETA-DE-TRABAJO-NUEVA
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const trabajo = resolve(process.argv[2] ?? '')
if (!process.argv[2] || existsSync(trabajo)) { console.log(JSON.stringify({ estado: 'carpeta-de-trabajo-debe-ser-nueva' })); process.exit(1) }
mkdirSync(trabajo, { recursive: true })
const RAIZ = resolve(new URL('../..', import.meta.url).pathname)
const WRANGLER = join(RAIZ, 'backend/node_modules/.bin/wrangler')

function empaquetar(nombre, raiz) {
  const dist = join(trabajo, `${nombre}-assets`); mkdirSync(dist); writeFileSync(join(dist, 'index.html'), 'x')
  const cfg = join(trabajo, `${nombre}.jsonc`)
  let s = readFileSync(join(raiz, 'backend/wrangler.jsonc'), 'utf8')
  s = s.replace('"main": "src/worker.js"', `"main": "${join(raiz, 'backend/src/worker.js')}"`).replaceAll('"directory": "../dist"', `"directory": "${dist}"`)
  writeFileSync(cfg, s)
  const out = join(trabajo, `${nombre}-out`)
  const salida = execFileSync(WRANGLER, ['deploy', '--dry-run', '--env', 'production', '-c', cfg, '--outdir', out], { cwd: join(raiz, 'backend'), env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const js = readFileSync(join(out, 'worker.js'), 'utf8')
  return { js, bytes: statSync(join(out, 'worker.js')).size, sha256: createHash('sha256').update(js).digest('hex'), salida, exports: /export \{([^}]*)\}\s*;?\s*(?:\/\/#.*)?$/m.exec(js)?.[1].split(',').map((x) => x.trim()).filter(Boolean) ?? [], vars: [...salida.matchAll(/env\.([A-Z_]+) \("([^"]*)"\)/g)].map((m) => `${m[1]}=${m[2]}`), enlaces: [...salida.matchAll(/env\.([A-Z]+) \((\w+)\)\s+Durable Object/g)].map((m) => `${m[1]}:${m[2]}`), total: /Total Upload: ([0-9.]+ KiB \/ gzip: [0-9.]+ KiB)/.exec(salida)?.[1] }
}

const base = join(trabajo, 'base-c082574'); mkdirSync(base)
execFileSync('sh', ['-c', `git -C "${RAIZ}" archive c082574 | tar -x -C "${base}"`])
execFileSync('ln', ['-s', join(RAIZ, 'node_modules'), join(base, 'node_modules')])
execFileSync('ln', ['-s', join(RAIZ, 'backend/node_modules'), join(base, 'backend/node_modules')])
const b = empaquetar('base', base)
const p = empaquetar('precursor', RAIZ)
const PROHIBIDAS = ['importarRespaldoEnsayo', 'importarObjeto', '/v1/ensayo', 'ENTORNO_ENSAYO', 'ensayo-respaldo', 'sebel-respaldo-ensayo', 'solo-ensayo-local', 'restaurarRespaldo', 'DELETE FROM meta']
const REQUERIDAS = ['exportarRespaldoOperador', 'marcadorRecuperacionOperador', '/v1/admin/respaldo/', 'sebel-respaldo-sql']
const informe = {
  base: { bytes: b.bytes, total: b.total, exports: b.exports, vars: b.vars, enlaces: b.enlaces },
  precursor: { bytes: p.bytes, total: p.total, exports: p.exports, vars: p.vars, enlaces: p.enlaces },
  mismosExports: JSON.stringify(b.exports) === JSON.stringify(p.exports),
  mismasVars: JSON.stringify(b.vars) === JSON.stringify(p.vars),
  mismosEnlaces: JSON.stringify(b.enlaces) === JSON.stringify(p.enlaces),
  puertaCerrada: p.vars.includes('ACCESO_ADMIN_HABILITADO=0'),
  prohibidasPresentes: PROHIBIDAS.filter((x) => p.js.includes(x)),
  requeridasAusentes: REQUERIDAS.filter((x) => !p.js.includes(x)),
  baseSinRespaldo: !b.js.includes('exportarRespaldoOperador'),
}
informe.ok = informe.mismosExports && informe.mismasVars && informe.mismosEnlaces && informe.puertaCerrada && informe.prohibidasPresentes.length === 0 && informe.requeridasAusentes.length === 0 && informe.baseSinRespaldo
console.log(JSON.stringify(informe, null, 2))
process.exit(informe.ok ? 0 : 1)
