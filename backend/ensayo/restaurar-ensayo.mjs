// Restauración SOLO DE ENSAYO LOCAL (REPORT_246): lee una carpeta de captura (ver scripts/respaldo-privado.mjs) y la importa en un Worker de ENSAYO levantado con
// `wrangler dev --local` y `wrangler.ensayo.jsonc`. El destino debe ser local (127.0.0.1 / ::1 / localhost): un destino remoto se rechaza SIN hacer ninguna petición. Nada se imprime
// de los datos. Este archivo no forma parte del paquete de producción.
//   node ensayo/restaurar-ensayo.mjs --origen http://127.0.0.1:PUERTO --carpeta CARPETA-DE-CAPTURA     (token: SEBEL_OPERADOR_TOKEN)
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validarOrigenLocal } from '../scripts/lib/transporte.js'
import { NOMBRE_MANIFIESTO, verificarCarpeta } from '../scripts/lib/respaldo-privado.mjs'

const salir = (o, ok) => { process.stdout.write(`${JSON.stringify(o, null, 2)}\n`); process.exit(ok ? 0 : 1) }
const a = process.argv.slice(2)
const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined }
const origen = validarOrigenLocal(val('--origen') ?? '')
if (origen.error) salir({ estado: origen.error, nota: 'la restauración de ensayo solo acepta un destino local' }, false)
const carpeta = resolve(val('--carpeta') ?? '')
const token = (process.env.SEBEL_OPERADOR_TOKEN ?? '').trim()
if (token.length < 32) salir({ estado: 'sin-credencial' }, false)
const v = await verificarCarpeta(carpeta)
if (!v.ok) salir({ estado: 'carpeta-invalida', problemas: v.problemas }, false)
const manifiesto = JSON.parse(readFileSync(join(carpeta, NOMBRE_MANIFIESTO), 'utf8'))
const resultados = []
for (const o of manifiesto.objetos) {
  const ruta = o.tipo === 'acceso' ? '/v1/ensayo/respaldo/acceso/importar' : `/v1/ensayo/respaldo/ligas/${o.objeto}/importar`
  const cuerpo = readFileSync(join(carpeta, o.archivo), 'utf8')
  let r
  try { r = await fetch(`${origen.origen}${ruta}`, { method: 'POST', redirect: 'manual', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: cuerpo }) } catch { salir({ estado: 'peticion-fallida', objeto: o.objeto, resultados }, false) }
  const j = await r.json().catch(() => ({}))
  resultados.push({ objeto: o.objeto, http: r.status, estado: j.estado ?? null, motivo: j.motivo ?? null, tablas: j.filas ? Object.keys(j.filas).length : 0 })
  if (r.status !== 200) salir({ estado: 'detenido', resultados }, false)
}
salir({ estado: 'completo', resultados }, true)
