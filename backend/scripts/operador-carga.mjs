// Herramienta del OPERADOR para la carga inicial (ver scripts/lib/operador.js y el README del backend).
//
//   Simulacro (POR DEFECTO): valida y resume; NINGUNA petición, NINGUNA escritura.
//     node scripts/operador-carga.mjs estructura  --estructura U10.json --estructura U12.json
//     node scripts/operador-carga.mjs partidos    --partidos LIGA_ID=lote.json [--partidos …] [--estructura U10.json]
//     node scripts/operador-carga.mjs equipos     --equipos LIGA_ID=anexo.json [--equipos …]   (AÑADE equipos a una liga ya cargada; cargaId NUEVO)
//     node scripts/operador-carga.mjs provisionar --nombre "Nombre" --ligas LIGA_A,LIGA_B
//     node scripts/operador-carga.mjs recuperar
//     node scripts/operador-carga.mjs asignar     --organizador org-… --ligas LIGA_A[,LIGA_B]   (AÑADE ligas a un organizador existente; solo añade)
//     node scripts/operador-carga.mjs verificar   --estructura U10.json [--equipos LIGA_ID=anexo.json] --partidos LIGA_ID=lote.json
//
//     node scripts/operador-carga.mjs retirar     --retiros LIGA_ID=retiro.json [--retiros …]   (RETIRA partidos programados sin actividad; cuerpo { cargaId, partidos: [id,…] })
//     node scripts/operador-carga.mjs restaurar   --retiros LIGA_ID=retiro.json [--retiros …]   (RESTAURA partidos retirados; operación APARTE, cargaId distinto)
//     node scripts/operador-carga.mjs verificar-retiro | verificar-restauracion --retiros LIGA_ID=retiro.json --leer --origen ORIGEN [--remoto]   (solo GET públicos)
//     node scripts/operador-carga.mjs renombrar   --nombres LIGA_ID=nombre.json [--nombres …]   (cambia SOLO el nombre que se muestra; cuerpo { cargaId, nombre }; revertir = OTRO archivo con otro cargaId)
//     node scripts/operador-carga.mjs verificar-nombre --nombres LIGA_ID=nombre.json --leer --origen ORIGEN [--remoto]   (solo GET públicos)
//     node scripts/operador-carga.mjs corregir-ortografia-sede --ortografias LIGA_ID=ortografia.json [--ortografias …]   (corrige SOLO la ortografía —tildes, mayúsculas, espacios— de la sede de partidos programados o FINALES; cuerpo { cargaId, sedeAnterior, sede, partidos: [id,…] }; revertir = OTRO archivo con otro cargaId)
//     node scripts/operador-carga.mjs capturar-base-ortografia --ortografias LIGA_ID=ortografia.json --base-salida LIGA_ID=base-NUEVA.json --leer --origen ORIGEN [--remoto]   (solo GET públicos: guarda la base ANTES de aplicar)
//     node scripts/operador-carga.mjs verificar-ortografia-sede --ortografias LIGA_ID=ortografia.json --base LIGA_ID=base.json --leer --origen ORIGEN [--remoto]   (solo GET públicos: solo cambió la sede de los nombrados)
//     node scripts/operador-carga.mjs ramas       --ramas LIGA_ID=ramas.json [--ramas …]   (FIJA la rama de equipos YA existentes; cuerpo { cargaId, ramas: [{ equipoId, rama }] }; solo NULL → valor)
//     node scripts/operador-carga.mjs verificar-ramas --ramas LIGA_ID=ramas.json --leer --origen ORIGEN [--remoto]   (solo GET públicos)
//   Aplicar (explícito): añadir --aplicar --origen ORIGEN --diario RUTA-PRIVADA/diario.json
//     · local por omisión (127.0.0.1 / ::1 / localhost); producción: --remoto --origen https://semabel.com (origen exacto aprobado)
//     · token del operador: variable SEBEL_OPERADOR_TOKEN o --token-archivo RUTA (permisos 0600). NUNCA por argumentos.
//     · provisionar / recuperar: --codigo-salida RUTA-PRIVADA/archivo-NUEVO (se crea 0600 antes de enviar; el código nunca se imprime)
//     · recuperar exige además --confirmo-rotacion (revoca el código vigente y cierra las sesiones);
//       tras un intento de rotación incierto exige también --confirmo-rotacion-repetida
//   Leer/verificar contra un servidor (solo GET públicos): añadir --leer --origen ORIGEN [--remoto] [--diario RUTA]
//   Opcional: --tiempo-ms N (1000–60000) tiempo máximo por petición. Sin redirecciones. Con --remoto no se ejecuta con la verificación
//   TLS desactivada (NODE_TLS_REJECT_UNAUTHORIZED=0) ni con NODE_EXTRA_CA_CERTS.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { aplicarCarga, construirPlanAsignacion, construirPlanCarga, construirPlanOrganizador, construirPlanNombre, construirPlanRamas, construirPlanRetiro, construirPlanOrtografia, capturarBaseOrtografia, resumenDelPlanCarga, verificarCarga, verificarNombre, verificarRamas, verificarRetiro, verificarOrtografia } from './lib/operador.js'
import { almacenDeDiario, leerSecretoDeArchivo, salidaDeCodigoPrivada } from './lib/archivos-privados.mjs'
import { bloqueoDeEntorno, tiempoValido, validarDestino } from './lib/transporte.js'

const COMANDOS = ['estructura', 'partidos', 'equipos', 'provisionar', 'recuperar', 'asignar', 'verificar', 'retirar', 'restaurar', 'verificar-retiro', 'verificar-restauracion', 'renombrar', 'verificar-nombre', 'ramas', 'verificar-ramas', 'corregir-ortografia-sede', 'capturar-base-ortografia', 'verificar-ortografia-sede']
const VERIFICACIONES = ['verificar', 'verificar-retiro', 'verificar-restauracion', 'verificar-nombre', 'verificar-ramas', 'capturar-base-ortografia', 'verificar-ortografia-sede']
const BANDERAS = ['--aplicar', '--leer', '--remoto', '--confirmo-rotacion', '--confirmo-rotacion-repetida']
const REPETIBLES = ['estructura', 'partidos', 'equipos', 'retiros', 'nombres', 'ramas', 'ortografias', 'base', 'base-salida']
const MAX_ARCHIVO = 256 * 1024
const FORMA_SECRETO = /^[A-Za-z0-9_-]{32,}$/ // ningún valor con forma de token/credencial en la línea de comandos

function fallar(codigo, extra = {}) {
  process.stdout.write(`${JSON.stringify({ estado: codigo, ...extra })}\n`)
  process.exit(1)
}
function salir(objeto, ok) {
  process.stdout.write(`${JSON.stringify(objeto, null, 2)}\n`)
  process.exit(ok ? 0 : 1)
}

const argv = process.argv.slice(2)
const comando = argv.shift()
if (!COMANDOS.includes(comando)) fallar('comando-desconocido', { comandos: COMANDOS })
if (argv.some((a) => FORMA_SECRETO.test(a) || /^[A-Za-z0-9]{5}(-?[A-Za-z0-9]{5}){3}$/.test(a))) fallar('credencial-en-argumentos')
const valores = {}
const banderas = new Set()
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]
  if (BANDERAS.includes(a)) banderas.add(a)
  else if (a.startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
    const k = a.slice(2)
    if (REPETIBLES.includes(k)) (valores[k] ??= []).push(argv[i + 1]); else valores[k] = argv[i + 1]
    i += 1
  } else fallar('argumento-desconocido')
}
const PERMITIDAS = ['estructura', 'partidos', 'equipos', 'retiros', 'nombres', 'ramas', 'ortografias', 'base', 'base-salida', 'nombre', 'ligas', 'organizador', 'origen', 'diario', 'token-archivo', 'codigo-salida', 'tiempo-ms']
for (const k of Object.keys(valores)) if (!PERMITIDAS.includes(k)) fallar('opcion-desconocida', { opcion: k })

function leerArchivo(ruta) {
  if (!existsSync(ruta) || statSync(ruta).size > MAX_ARCHIVO) fallar('archivo-inexistente-o-demasiado-grande')
  return readFileSync(ruta, 'utf8')
}
const estructuras = (valores.estructura ?? []).map(leerArchivo)
const conLiga = (lista, opcion) => (lista ?? []).map((v) => {
  const i = v.indexOf('=')
  if (i < 1) fallar(`${opcion}-requiere-LIGA=archivo`)
  return { ligaId: v.slice(0, i), texto: leerArchivo(v.slice(i + 1)) }
})
const conLigaSalida = (lista) => new Map((lista ?? []).map((v) => {
  const i = v.indexOf('=')
  if (i < 1) fallar('base-salida-requiere-LIGA=archivo')
  return [v.slice(0, i), v.slice(i + 1)]
}))
const partidos = conLiga(valores.partidos, 'partidos')
const anexos = conLiga(valores.equipos, 'equipos')
const retiros = conLiga(valores.retiros, 'retiros')
const nombres = conLiga(valores.nombres, 'nombres')
const ramasEquipos = conLiga(valores.ramas, 'ramas')
const ortografias = conLiga(valores.ortografias, 'ortografias')
const basesOrtografia = conLiga(valores.base, 'base')
const esOrtografia = comando === 'corregir-ortografia-sede' || comando === 'capturar-base-ortografia' || comando === 'verificar-ortografia-sede'
const esRamas = comando === 'ramas' || comando === 'verificar-ramas'
const esNombre = comando === 'renombrar' || comando === 'verificar-nombre'
const tipoDeRetiro = comando === 'retirar' || comando === 'verificar-retiro' ? 'retirar' : comando === 'restaurar' || comando === 'verificar-restauracion' ? 'restaurar' : null

const aplicando = banderas.has('--aplicar')
const leyendo = banderas.has('--leer')
if (aplicando && leyendo) fallar('modo-ambiguo')
if (aplicando && VERIFICACIONES.includes(comando)) fallar('verificar-no-aplica')
if (leyendo && !VERIFICACIONES.includes(comando)) fallar('leer-solo-con-verificar')
if (tipoDeRetiro && (valores.partidos || valores.estructura || valores.equipos || valores.nombres || valores.ramas)) fallar('retiro-solo-con-retiros')
if (esNombre && (valores.partidos || valores.estructura || valores.equipos || valores.retiros || valores.ramas)) fallar('nombre-solo-con-nombres')
if (!esNombre && valores.nombres) fallar('nombres-solo-con-renombrar')
if (esRamas && (valores.partidos || valores.estructura || valores.equipos || valores.retiros || valores.nombres)) fallar('ramas-solo-con-ramas')
if (!esRamas && valores.ramas) fallar('ramas-solo-con-el-comando-ramas')
if (esOrtografia && (valores.estructura || valores.equipos || valores.retiros || valores.nombres || valores.ramas || valores.partidos)) fallar('ortografia-solo-con-ortografias')
if (!esOrtografia && (valores.ortografias || valores.base || valores['base-salida'])) fallar('ortografias-solo-con-los-comandos-de-ortografia')
if (valores.base && comando !== 'verificar-ortografia-sede') fallar('base-solo-con-verificar-ortografia-sede')
if (valores['base-salida'] && comando !== 'capturar-base-ortografia') fallar('base-salida-solo-con-capturar-base-ortografia')
const remoto = banderas.has('--remoto')

// ---- Plan / simulacro (sin red) ----
const plan = comando === 'asignar'
  ? await construirPlanAsignacion({ organizadorId: valores.organizador, ligas: valores.ligas ? valores.ligas.split(',') : undefined })
  : comando === 'provisionar' || comando === 'recuperar'
  ? await construirPlanOrganizador({ tipo: comando, nombre: valores.nombre, ligas: valores.ligas ? valores.ligas.split(',') : undefined })
  : esOrtografia
  ? await construirPlanOrtografia({ ortografias })
  : esRamas
  ? await construirPlanRamas({ ramas: ramasEquipos })
  : esNombre
  ? await construirPlanNombre({ nombres })
  : tipoDeRetiro
  ? await construirPlanRetiro({ tipo: tipoDeRetiro, retiros })
  : await construirPlanCarga({ tipo: comando === 'verificar' ? 'estructura' : comando, estructuras, partidos, anexos })

if (!aplicando && !leyendo) {
  if (comando === 'verificar-nombre' || comando === 'verificar-ramas' || comando === 'capturar-base-ortografia' || comando === 'verificar-ortografia-sede') {
    salir({ modo: 'simulacro', nota: 'sin --leer no se hace ninguna petición', archivosValidos: plan.ok, elementos: plan.usadas.map((e) => ({ ...e.resumen, problemas: e.problemas })) }, plan.ok)
  }
  if (comando === 'verificar-retiro' || comando === 'verificar-restauracion') {
    salir({ modo: 'simulacro', nota: 'sin --leer no se hace ninguna petición', archivosValidos: plan.ok, elementos: plan.usadas.map((e) => ({ ...e.resumen, problemas: e.problemas })) }, plan.ok)
  }
  if (comando === 'verificar') {
    // La verificación acepta cualquier combinación de estructura, equipos añadidos y partidos: basta con que haya archivos y todos sean válidos.
    const validos = plan.elementos.length > 0 && plan.elementos.every((e) => e.ok)
    salir({ modo: 'simulacro', nota: 'sin --leer no se hace ninguna petición', archivosValidos: validos, elementos: plan.elementos.map((e) => ({ ...e.resumen, problemas: e.problemas })) }, validos)
  }
  salir({ modo: 'simulacro', ...resumenDelPlanCarga(plan), nota: 'ninguna petición, ninguna escritura' }, plan.ok)
}

// ---- A partir de aquí hay red: destino explícito, TLS normal, sin redirecciones ----
const destino = validarDestino(valores.origen ?? '', { remoto })
if (destino.error) fallar(destino.error)
const bloqueo = bloqueoDeEntorno(process.env, destino)
if (bloqueo) fallar(bloqueo)
const tiempoMs = tiempoValido(valores['tiempo-ms'])
if (tiempoMs === null) fallar('tiempo-invalido')

if (leyendo) {
  let almacen
  if (valores.diario) { try { almacen = almacenDeDiario(valores.diario) } catch (e) { fallar(`diario-${e.message}`) } }
  if (comando === 'capturar-base-ortografia') {
    // Cada base se escribe en un archivo NUEVO (nunca se sobrescribe nada); si falta cualquier --base-salida no se hace ninguna petición.
    const salidas = conLigaSalida(valores['base-salida'])
    if (ortografias.some((o) => !salidas.has(o.ligaId))) fallar('falta-base-salida-por-liga')
    for (const ruta of salidas.values()) if (existsSync(ruta)) fallar('base-salida-ya-existe')
    const rb = await capturarBaseOrtografia({ ortografias, fetch, origen: destino.origen, remoto, entorno: process.env, tiempoMs })
    const escritas = []
    if (rb.ok) for (const [ligaId, base] of Object.entries(rb.bases)) { writeFileSync(salidas.get(ligaId), `${JSON.stringify(base, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); escritas.push({ ligaId, archivo: salidas.get(ligaId) }) }
    salir({ modo: 'capturar', ok: rb.ok, comprobaciones: rb.comprobaciones, escritas }, rb.ok)
  }
  if (comando === 'verificar-ortografia-sede') {
    const ro = await verificarOrtografia({ ortografias, bases: basesOrtografia, fetch, origen: destino.origen, remoto, entorno: process.env, tiempoMs })
    salir({ modo: 'verificar', ok: ro.ok, comprobaciones: ro.comprobaciones }, ro.ok)
  }
  if (esRamas) {
    const rr2 = await verificarRamas({ ramas: ramasEquipos, fetch, origen: destino.origen, remoto, entorno: process.env, tiempoMs })
    salir({ modo: 'verificar', ok: rr2.ok, comprobaciones: rr2.comprobaciones }, rr2.ok)
  }
  if (esNombre) {
    const rn = await verificarNombre({ nombres, fetch, origen: destino.origen, remoto, entorno: process.env, tiempoMs })
    salir({ modo: 'verificar', ok: rn.ok, comprobaciones: rn.comprobaciones }, rn.ok)
  }
  if (tipoDeRetiro) {
    const rr = await verificarRetiro({ tipo: tipoDeRetiro, retiros, fetch, origen: destino.origen, remoto, entorno: process.env, tiempoMs })
    salir({ modo: 'verificar', ok: rr.ok, comprobaciones: rr.comprobaciones }, rr.ok)
  }
  const r = await verificarCarga({ estructuras, partidos, anexos, fetch, origen: destino.origen, remoto, entorno: process.env, tiempoMs, almacen })
  salir({ modo: 'verificar', ok: r.ok, comprobaciones: r.comprobaciones }, r.ok)
}

if (!valores.diario) fallar('falta-diario')
let almacen
try { almacen = almacenDeDiario(valores.diario) } catch (e) { fallar(`diario-${e.message}`) }
let token
try {
  if (process.env.SEBEL_OPERADOR_TOKEN) token = process.env.SEBEL_OPERADOR_TOKEN.trim()
  else if (valores['token-archivo']) token = leerSecretoDeArchivo(valores['token-archivo'])
  else fallar('sin-credencial')
} catch (e) { fallar(e.message === 'permisos-abiertos' ? 'archivo-de-credencial-con-permisos-abiertos' : 'credencial-ilegible') }

let salidaDeCodigo
if (comando === 'provisionar' || comando === 'recuperar') {
  if (!valores['codigo-salida']) fallar('falta-codigo-salida')
  try { salidaDeCodigo = salidaDeCodigoPrivada(valores['codigo-salida']) } catch (e) { fallar(`codigo-salida-${e.message}`) }
}
const confirmaciones = new Set()
if (banderas.has('--confirmo-rotacion')) confirmaciones.add('rotacion')
if (banderas.has('--confirmo-rotacion-repetida')) confirmaciones.add('rotacion-repetida')

const r = await aplicarCarga({ plan, almacen, fetch, origen: destino.origen, remoto, entorno: process.env, tiempoMs, token, salidaDeCodigo, confirmaciones })
salir({ modo: 'aplicar', ...r }, r.estado === 'completo')
