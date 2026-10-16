// Ejecutor LOCAL de plantillas del operador (ver scripts/lib/runner-plantilla.js y el README del backend).
//
//   Simulacro (POR DEFECTO, sin red, cero escrituras):
//     node scripts/runner-plantilla.mjs --paquete PAQUETE.json --mapeo MAPEO.json
//   Aplicar (explícito; por omisión SOLO destinos locales 127.0.0.1 / ::1 / localhost):
//     node scripts/runner-plantilla.mjs --aplicar --paquete … --mapeo … --origen http://127.0.0.1:PUERTO \
//          --acceso-origen https://ORIGEN-CONFIGURADO --diario RUTA-PRIVADA/diario.json
//   Aplicar en PRODUCCIÓN (opt-in explícito; solo el origen exacto aprobado, ver scripts/lib/transporte.js):
//     node scripts/runner-plantilla.mjs --aplicar --remoto --origen https://semabel.com --acceso-origen https://semabel.com \
//          --paquete … --mapeo … --diario RUTA-PRIVADA-NUEVA/diario-produccion.json --codigo-archivo RUTA-PRIVADA/codigo
//   Verificar (lecturas):  igual que aplicar pero con --verificar en lugar de --aplicar.
//   Opcional: --tiempo-ms N (1000–60000) tiempo máximo por petición. Sin redirecciones; con --remoto no se ejecuta con la
//   verificación TLS desactivada ni con NODE_EXTRA_CA_CERTS.
//
// La credencial del organizador NO se pasa por argumentos ni por dirección: variable de entorno SEBEL_CODIGO_ORGANIZADOR, o
// un archivo con permisos 0600 indicado con --codigo-archivo. Nunca se escribe en el diario ni en la salida.
import { closeSync, existsSync, fstatSync, fsyncSync, openSync, readFileSync, renameSync, statSync, writeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { aplicar, construirPlan, resumenDelPlan, verificar } from './lib/runner-plantilla.js'
import { bloqueoDeEntorno, tiempoValido, validarDestino } from './lib/transporte.js'

const FORMA_CODIGO = /^[A-Za-z0-9]{5}(-?[A-Za-z0-9]{5}){3}$/
const argv = process.argv.slice(2)
// Una credencial nunca va por la línea de comandos (ni como argumento ni como valor de una opción).
if (argv.some((a) => FORMA_CODIGO.test(a))) fallar('credencial-en-argumentos')
const valores = {}
const banderas = new Set()
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]
  if (['--aplicar', '--verificar', '--remoto'].includes(a)) banderas.add(a)
  else if (a.startsWith('--') && i + 1 < argv.length) { valores[a.slice(2)] = argv[i + 1]; i += 1 }
  else fallar('argumento-desconocido')
}

function fallar(codigo, extra = {}) {
  process.stdout.write(`${JSON.stringify({ estado: codigo, ...extra })}\n`)
  process.exit(1)
}

if (banderas.has('--aplicar') && banderas.has('--verificar')) fallar('modo-ambiguo')
if (!valores.paquete || !valores.mapeo) fallar('faltan-paquete-o-mapeo')
for (const k of ['paquete', 'mapeo']) if (!existsSync(valores[k])) fallar('archivo-inexistente', { cual: k })

const paqueteTexto = readFileSync(valores.paquete, 'utf8')
let mapeo
try { mapeo = JSON.parse(readFileSync(valores.mapeo, 'utf8')) } catch { fallar('mapeo-ilegible') }
const plan = await construirPlan({ paqueteTexto, mapeo })

if (!banderas.has('--aplicar') && !banderas.has('--verificar')) {
  // SIMULACRO: ni una petición, ni un archivo escrito.
  process.stdout.write(`${JSON.stringify({ modo: 'simulacro', ...resumenDelPlan(plan) }, null, 2)}\n`)
  process.exit(plan.ok ? 0 : 1)
}

// --- A partir de aquí hay red: destino local, credencial fuera de los archivos versionados, diario privado ---
const remoto = banderas.has('--remoto')
const destino = validarDestino(valores.origen ?? '', { remoto })
if (destino.error) fallar(destino.error)
const bloqueo = bloqueoDeEntorno(process.env, destino)
if (bloqueo) fallar(bloqueo)
const tiempoMs = tiempoValido(valores['tiempo-ms'])
if (tiempoMs === null) fallar('tiempo-invalido')
if (!valores['acceso-origen']) fallar('falta-acceso-origen')
if (!valores.diario) fallar('falta-diario')

function codigoDelOrganizador() {
  if (process.env.SEBEL_CODIGO_ORGANIZADOR) return process.env.SEBEL_CODIGO_ORGANIZADOR.trim()
  if (valores['codigo-archivo']) {
    const modo = statSync(valores['codigo-archivo']).mode & 0o777
    if (modo & 0o077) fallar('archivo-de-credencial-con-permisos-abiertos')
    return readFileSync(valores['codigo-archivo'], 'utf8').trim()
  }
  return fallar('sin-credencial')
}

// El diario contiene los cuerpos exactos (nombres de personas): privado, fuera de cualquier repositorio, modo 0600.
const rutaDiario = resolve(valores.diario)
for (let d = dirname(rutaDiario); ; d = dirname(d)) {
  if (existsSync(`${d}/.git`)) fallar('diario-dentro-de-un-repositorio')
  if (dirname(d) === d) break
}
if (!existsSync(dirname(rutaDiario))) fallar('carpeta-del-diario-inexistente')
const almacen = {
  async leer() { return existsSync(rutaDiario) ? readFileSync(rutaDiario, 'utf8') : null },
  async escribir(texto) {
    const tmp = `${rutaDiario}.tmp`
    const fd = openSync(tmp, 'w', 0o600)
    try { writeSync(fd, texto); fsyncSync(fd); if ((fstatSync(fd).mode & 0o077) !== 0) throw new Error('permisos') } finally { closeSync(fd) }
    renameSync(tmp, rutaDiario)
  },
}

const comun = { plan, almacen, fetch, origen: destino.origen, accesoOrigen: valores['acceso-origen'], codigo: codigoDelOrganizador(), remoto, entorno: process.env, tiempoMs }
if (banderas.has('--verificar')) {
  if (!plan.ok) fallar('plan-invalido', { problemas: plan.problemas })
  const r = await verificar(comun)
  process.stdout.write(`${JSON.stringify({ modo: 'verificar', ok: r.ok, comprobaciones: r.comprobaciones }, null, 2)}\n`)
  process.exit(r.ok ? 0 : 1)
}
const r = await aplicar(comun)
process.stdout.write(`${JSON.stringify({ modo: 'aplicar', ...r }, null, 2)}\n`)
process.exit(r.estado === 'completo' ? 0 : 1)
