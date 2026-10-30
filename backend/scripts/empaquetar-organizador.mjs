#!/usr/bin/env node
// Empaqueta el paquete del organizador en un ZIP NUEVO (fuera de Git) y lo verifica extrayendolo a una carpeta temporal privada.
//   node scripts/empaquetar-organizador.mjs --paquete CARPETA --zip NUEVO.zip
// Solo entran los archivos aprobados; el informe tecnico privado, los respaldos y las credenciales nunca se incluyen. Imprime solo nombres, tamanos y un prefijo de checksum.
import { ErrorEmpaquetado, empaquetar } from './lib/empaquetar-portable.mjs'
import { ErrorZip } from './lib/zip-portable.mjs'

function main() {
  const av = process.argv.slice(2)
  const o = {}
  for (let i = 0; i < av.length; i += 2) {
    if (!['--paquete', '--zip'].includes(av[i]) || typeof av[i + 1] !== 'string' || av[i + 1].startsWith('--') || av[i] in o) { console.error('uso: --paquete CARPETA --zip NUEVO.zip'); return 2 }
    o[av[i]] = av[i + 1]
  }
  if (!o['--paquete'] || !o['--zip']) { console.error('uso: --paquete CARPETA --zip NUEVO.zip'); return 2 }
  try {
    const r = empaquetar({ paquete: o['--paquete'], zip: o['--zip'] })
    console.log('empaquetado: completo y verificado (extraido a una carpeta temporal privada y leido con el lector independiente)')
    for (const a of r.archivos) console.log(`${a.nombre} ${a.bytes}`)
    console.log(`zip: ${r.zip} ${r.bytes} bytes sha256:${r.sha256.slice(0, 12)}`)
    return 0
  } catch (e) {
    if (e instanceof ErrorEmpaquetado || e instanceof ErrorZip) { console.error(`empaquetado: RECHAZADO ${e.codigo}${e.detalle ? ` (${e.detalle})` : ''}`); return 1 }
    console.error('empaquetado: ERROR inesperado'); return 1
  }
}
process.exitCode = main()
