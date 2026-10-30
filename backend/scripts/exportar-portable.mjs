#!/usr/bin/env node
// Convierte OFFLINE un respaldo `sebel-respaldo-sql` v1 de una liga en un paquete portable (JSON + CSV). Sin red ni credenciales. No modifica la entrada.
//   node scripts/exportar-portable.mjs --entrada ARCHIVO.json --salida CARPETA_NUEVA --informe-tecnico ARCHIVO_NUEVO.json   (ambas rutas NUEVAS, fuera de Git; el informe tecnico PRIVADO va fuera de la carpeta)
//   node scripts/exportar-portable.mjs --verificar CARPETA                              (lector independiente: permisos, checksums, CSV = JSON, totales recalculados)
// Imprime SOLO conteos, nombres de archivo y prefijos de checksum; nunca datos.
import { lstatSync, readFileSync } from 'node:fs'
import { ErrorExportacion, convertir, escribirPaquete } from './lib/exportar-portable.mjs'
import { verificarPaquete } from './lib/lector-portable.mjs'

const MAX_BYTES = 64 * 1024 * 1024

function argumentos(av) {
  const o = {}
  for (let i = 0; i < av.length; i += 2) {
    const k = av[i]
    if (!['--entrada', '--salida', '--verificar', '--informe-tecnico'].includes(k) || typeof av[i + 1] !== 'string' || av[i + 1].startsWith('--')) return null
    if (k in o) return null
    o[k] = av[i + 1]
  }
  return o
}

function leerEntrada(ruta) {
  let st
  try { st = lstatSync(ruta) } catch { throw new ErrorExportacion('entrada-inexistente') }
  if (!st.isFile()) throw new ErrorExportacion('entrada-no-es-archivo-regular')
  if ((st.mode & 0o077) !== 0) throw new ErrorExportacion('entrada-con-permisos-abiertos')
  if (st.size > MAX_BYTES) throw new ErrorExportacion('entrada-demasiado-grande')
  try { return JSON.parse(readFileSync(ruta, 'utf8')) } catch { throw new ErrorExportacion('entrada-no-es-json') }
}

function main() {
  const a = argumentos(process.argv.slice(2))
  const modo = a && (a['--verificar'] ? (Object.keys(a).length === 1 ? 'verificar' : null) : (a['--entrada'] && a['--salida'] && a['--informe-tecnico'] && Object.keys(a).length === 3 ? 'exportar' : null))
  if (!modo) { console.error('uso: --entrada ARCHIVO --salida CARPETA_NUEVA --informe-tecnico ARCHIVO_NUEVO.json | --verificar CARPETA'); return 2 }
  if (modo === 'verificar') {
    const r = verificarPaquete(a['--verificar'])
    console.log(r.ok ? 'verificacion: OK' : `verificacion: FALLA ${r.problemas.join(' ')}`)
    if (r.ok) { console.log(`conteos: ${JSON.stringify(r.counts)}`); for (const f of r.archivos) console.log(`${f.name} ${f.bytes} ${f.sha256}`) }
    return r.ok ? 0 : 1
  }
  try {
    const paquete = convertir(leerEntrada(a['--entrada']))
    const carpeta = escribirPaquete(a['--salida'], paquete, { rutaInforme: a['--informe-tecnico'] })
    console.log('exportacion: completa')
    console.log(`conteos: ${JSON.stringify(paquete.manifiesto.counts)}`)
    console.log(`avisos: ${paquete.manifiesto.derived.findings} (marcadores distintos de los eventos: ${paquete.manifiesto.derived.scoreInconsistencies})`)
    for (const f of paquete.manifiesto.files) console.log(`${f.name} ${f.bytes} ${f.sha256.slice(0, 12)}`)
    console.log(`carpeta: ${carpeta}`)
    console.log('informe tecnico privado escrito aparte (fuera del paquete)')
    return 0
  } catch (e) {
    if (e instanceof ErrorExportacion) { console.error(`exportacion: RECHAZADA ${e.codigo}${e.detalle ? ` (${e.detalle})` : ''}`); return 1 }
    console.error('exportacion: ERROR inesperado'); return 1
  }
}
process.exitCode = main()
