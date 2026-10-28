// Captura PRIVADA de los respaldos solo lectura del operador (REPORT_246). NO es un respaldo de producción por sí sola: hay que desplegar antes la versión precursora y abrir la
// puerta del operador en una ventana aparte. Nada de los datos se imprime.
//
//   Plan (POR DEFECTO, sin red):   node scripts/respaldo-privado.mjs --origen ORIGEN --liga LIGA [--liga …] [--acceso] --salida CARPETA-NUEVA
//   Capturar (explícito):          … --capturar [--remoto]   token: variable SEBEL_OPERADOR_TOKEN o --token-archivo RUTA (0600). NUNCA por argumentos.
//   Verificar una carpeta (offline): node scripts/respaldo-privado.mjs --verificar CARPETA
//     · local por omisión (127.0.0.1 / ::1 / localhost); producción: --remoto --origen https://semabel.com (origen exacto aprobado); sin redirecciones; TLS normal.
//     · la carpeta de salida debe ser NUEVA, fuera de cualquier repositorio; se crea 0700 y cada archivo 0600 (nunca se sobrescribe).
//     · el cifrado (p. ej. gpg) y la copia fuera del equipo son un paso aparte y documentado.
import { capturar, planDeCaptura, verificarCarpeta } from './lib/respaldo-privado.mjs'
import { leerSecretoDeArchivo } from './lib/archivos-privados.mjs'

const salir = (objeto, ok) => { process.stdout.write(`${JSON.stringify(objeto, null, 2)}\n`); process.exit(ok ? 0 : 1) }
const fallar = (estado) => { process.stdout.write(`${JSON.stringify({ estado })}\n`); process.exit(1) }

const argv = process.argv.slice(2)
if (argv.some((a) => /^[A-Za-z0-9_-]{32,}$/.test(a))) fallar('credencial-en-argumentos')
const BANDERAS = ['--capturar', '--acceso', '--remoto']
const REPETIBLES = ['liga']
const PERMITIDAS = ['origen', 'liga', 'salida', 'verificar', 'token-archivo', 'tiempo-ms']
const valores = {}; const banderas = new Set()
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]
  if (BANDERAS.includes(a)) banderas.add(a)
  else if (a.startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
    const k = a.slice(2)
    if (!PERMITIDAS.includes(k)) fallar('opcion-desconocida')
    if (REPETIBLES.includes(k)) (valores[k] ??= []).push(argv[i + 1]); else valores[k] = argv[i + 1]
    i += 1
  } else fallar('argumento-desconocido')
}

if (valores.verificar) {
  if (valores.origen || valores.liga || valores.salida || banderas.size) fallar('verificar-es-offline')
  const r = await verificarCarpeta(valores.verificar)
  salir({ modo: 'verificar-carpeta', ok: r.ok, problemas: r.problemas, objetos: r.objetos }, r.ok)
}

const entrada = { origen: valores.origen, remoto: banderas.has('--remoto'), entorno: process.env, tiempoMs: valores['tiempo-ms'], ligas: valores.liga ?? [], acceso: banderas.has('--acceso'), salida: valores.salida }
if (!banderas.has('--capturar')) {
  const p = planDeCaptura(entrada)
  salir({ modo: 'plan', nota: 'sin --capturar no se hace ninguna petición ni se crea ningún archivo', ok: p.ok, problemas: p.problemas, destino: p.destino, archivos: p.objetivos.flatMap((o) => [o.archivo, o.marcador]) }, p.ok)
}
let token
try {
  if (process.env.SEBEL_OPERADOR_TOKEN) token = process.env.SEBEL_OPERADOR_TOKEN.trim()
  else if (valores['token-archivo']) token = leerSecretoDeArchivo(valores['token-archivo'])
  else fallar('sin-credencial')
} catch (e) { fallar(e.message === 'permisos-abiertos' ? 'archivo-de-credencial-con-permisos-abiertos' : 'credencial-ilegible') }
const r = await capturar({ ...entrada, fetch, token })
salir({ modo: 'capturar', estado: r.estado, ...(r.problemas ? { problemas: r.problemas } : {}), ...(r.motivo ? { objeto: r.objeto, motivo: r.motivo } : {}), archivos: (r.archivos ?? []).map((a) => ({ nombre: a.nombre, bytes: a.bytes, sha256: a.sha256.slice(0, 12) })) }, r.estado === 'completo')
