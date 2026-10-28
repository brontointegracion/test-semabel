// ENSAYO DE RESTAURACIÓN EN LOCAL (REPORT_246), con datos SINTÉTICOS y almacenamiento AISLADO:
//   1. levanta el Worker de ensayo (wrangler dev --local, persistencia propia A) y crea datos representativos con las APIS REALES: dos ligas, un organizador con sesión, partidos jugados
//      desde el teléfono, un código de partido activado, una alta de plantilla, una carga del operador con su recibo y un intento de acceso fallido;
//   2. captura con la herramienta privada (respaldo-privado.mjs) y verifica la carpeta;
//   3. detiene A, levanta un Worker NUEVO con persistencia B vacía e importa la captura (restaurar-ensayo.mjs);
//   4. vuelve a capturar B y compara esquema, conteos y sellos por tabla; compara lecturas públicas, la sesión de organizador original, la propiedad, el teléfono y la repetición de un recibo;
//   5. reinicia B (mismo almacenamiento) y comprueba que el arranque no altera lo restaurado.
// NO prueba PITR ni la nube. Nada de los datos ni de los secretos se imprime: solo resultados. Uso (desde la raíz del repo, con vite-node): npx vite-node backend/ensayo/ensayo-restauracion.mjs CARPETA-DE-TRABAJO-NUEVA
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validarCuerpoEstado } from '../../src/lib/control/sesion-motor.js'
import { construirSobre } from '../../src/lib/motor/reglas.js'
import { firmaDeReglas } from '../../src/lib/reglas-categoria.js'

const RAIZ = resolve(new URL('../..', import.meta.url).pathname)
const BACKEND = join(RAIZ, 'backend')
const TRABAJO = resolve(process.argv[2] ?? '')
if (!process.argv[2] || existsSync(TRABAJO)) { console.log(JSON.stringify({ estado: 'carpeta-de-trabajo-debe-ser-nueva' })); process.exit(1) }
mkdirSync(TRABAJO, { mode: 0o700, recursive: true })
const PA = 8821; const PB = 8822
const SEMILLA = 'semilla-sintetica-ensayo-respaldo-0001'
const OPERADOR = 'operador-sintetico-ensayo-respaldo-00000001'
const ORIGEN_ACCESO = 'https://localhost:8812'
const LIGA = 'LIGA-ENSAYO'; const OTRA = 'LIGA-OTRA'
const tokenDe = (g) => `tok-sintetico-${g}-${LIGA}-0001`
const sha = (t) => createHash('sha256').update(t).digest('hex')
const procesos = new Set() // grupos de procesos que ESTE ensayo levantó (se detienen por su id exacto)
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const informe = { aviso: 'Ensayo LOCAL con datos sintéticos. No es un respaldo de producción ni una prueba de PITR en la nube.', pasos: [], comprobaciones: [] }
const ok = (nombre, valor, detalle) => { informe.comprobaciones.push(detalle === undefined ? { nombre, ok: !!valor } : { nombre, ok: !!valor, detalle }); return !!valor }

const detener = (pid) => { try { process.kill(-pid, 'SIGTERM') } catch { /* ya terminó */ } procesos.delete(pid) }
async function levantar(etiqueta, puerto, persistencia) {
  const log = join(TRABAJO, `wrangler-${etiqueta}.log`)
  const hijo = spawn(join(BACKEND, 'node_modules/.bin/wrangler'), ['dev', '-c', 'wrangler.ensayo.jsonc', '--port', String(puerto), '--ip', '127.0.0.1', '--persist-to', persistencia, '--local'], { cwd: BACKEND, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  procesos.add(hijo.pid)
  let salida = ''
  hijo.stdout.on('data', (d) => { salida += d }); hijo.stderr.on('data', (d) => { salida += d })
  for (let i = 0; i < 150; i += 1) { if (salida.includes('Ready on')) break; await dormir(200) }
  writeFileSync(log, salida.replace(/(Bearer|token)[^\s]*/gi, '[redactado]'), { mode: 0o600 })
  if (!salida.includes('Ready on')) { detener(hijo.pid); throw new Error(`wrangler-${etiqueta}-no-arranco`) }
  return { hijo, base: `http://127.0.0.1:${puerto}`, parar: async () => { detener(hijo.pid); await dormir(1500) } }
}

const J = async (r) => ({ status: r.status, cuerpo: await r.json().catch(() => null), cabeceras: r.headers })
const get = (base, ruta, cab = {}) => fetch(`${base}${ruta}`, { headers: cab }).then(J)
const post = (base, ruta, cuerpo, cab = {}) => fetch(`${base}${ruta}`, { method: 'POST', headers: { 'content-type': 'application/json', ...cab }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) }).then(J)
const adminH = { authorization: `Bearer ${OPERADOR}` }
const escritura = (cookie) => ({ origin: ORIGEN_ACCESO, 'x-sebel-peticion': '1', ...(cookie ? { cookie: `__Host-sesion=${cookie}` } : {}) })
const sinHora = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'servidorAhoraMs' ? undefined : v)))

const f = (id, equipoId, nombrePila, apellido1, dorsal, extra = {}) => ({ id, equipoId, nombrePila, apellido1, apellido2: '', dorsal, personaId: `persona-${id}`, ...extra })
const payload = (ligaId, conCredencial) => ({
  liga: { id: ligaId, nombre: `Liga ficticia ${ligaId}`, deporte: 'baloncesto', minutosPorPeriodo: 10 },
  equipos: [{ id: 'E1', nombre: 'Alfa' }, { id: 'E2', nombre: 'Beta' }, { id: 'E3', nombre: 'Gama' }, { id: 'E4', nombre: 'Delta' }],
  jugadores: [f('J1', 'E1', 'Ana', 'Prueba', 0), f('J2', 'E1', 'Beto', 'Muestra', 7, { fechaNacimiento: '2015-03-12', codigo: '4321' }), f('J9', 'E2', 'Eva', 'Visita', 1), f('K1', 'E3', 'Gil', 'Tercero', 4), f('K2', 'E4', 'Hugo', 'Cuarto', 5)],
  partidos: [{ id: 'P', localId: 'E1', visitaId: 'E2', inicio: null }, { id: 'Q', localId: 'E3', visitaId: 'E4', inicio: null }],
  credenciales: conCredencial ? [{ token: tokenDe('P'), partidoId: 'P', deviceId: 'tel-P', actorId: 'actor-P' }] : [],
})

let t = 1_700_000_000_000
async function mandar(base, g, token, tipo, datos = {}) {
  const cab = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const e = await get(base, `/v1/ligas/${LIGA}/partidos/${g}/estado`, cab)
  const v = validarCuerpoEstado(e.cuerpo, { gameId: g })
  if (!v.ok) throw new Error(`estado: ${v.motivo}`)
  t += 1000
  const orden = { cmdId: `ensayo-${g}-${tipo}-${t}`, tipo, datos, tiempo: { accionTs: t } }
  if (tipo === 'iniciar-partido') {
    const p = await get(base, `/v1/ligas/${LIGA}/partidos/${g}/preparacion`, cab)
    orden.preparacionVersion = p.cuerpo.preparacion.version
    const firma = firmaDeReglas(v.estado.config)
    if (firma != null && firma !== 'ninguna') orden.reglasConfirmadas = firma
  }
  const sobre = construirSobre(v.estado, orden, { deviceId: e.cuerpo.deviceId, clientSeq: e.cuerpo.cursor.ultimoClientSeq + 1 })
  const r = await post(base, `/v1/ligas/${LIGA}/partidos/${g}/comandos`, sobre, { authorization: cab.authorization })
  if (r.cuerpo?.resultado !== 'aceptado') throw new Error(`${tipo}: ${JSON.stringify(r.cuerpo).slice(0, 120)}`)
  return { sobre, respuesta: r }
}

function cli(script, args, env = {}) {
  const r = spawnSync(process.execPath, [join(BACKEND, script), ...args], { env: { PATH: process.env.PATH, SEBEL_OPERADOR_TOKEN: OPERADOR, ...env }, encoding: 'utf8', cwd: BACKEND })
  let json = null; try { json = JSON.parse(r.stdout) } catch { /* sin JSON */ }
  return { codigo: r.status, json, vacioDeDatos: !r.stdout.includes(OPERADOR) && !r.stderr.includes(OPERADOR) }
}

const leerCaptura = (dir) => {
  const m = JSON.parse(readFileSync(join(dir, 'MANIFIESTO.json'), 'utf8'))
  return Object.fromEntries(m.objetos.map((o) => [o.objeto, JSON.parse(readFileSync(join(dir, o.archivo), 'utf8'))]))
}

try {
  // ---------------- 1. origen A: datos representativos con las APIs reales ----------------
  const A = await levantar('A', PA, join(TRABAJO, 'estado-A'))
  informe.pasos.push('origen A levantado (persistencia propia, local)')
  for (const [l, c] of [[LIGA, true], [OTRA, false]]) {
    const s = await post(A.base, `/v1/_semilla/ligas/${l}`, payload(l, c), { authorization: `Bearer ${SEMILLA}` })
    if (s.status !== 201) throw new Error(`siembra ${l}: ${s.status}`)
  }
  const org = await post(A.base, '/v1/admin/organizador', { nombre: 'Organizador sintético de ensayo', ligas: [LIGA] }, adminH)
  if (org.status !== 201) throw new Error(`provisión: ${org.status}`)
  const login = await post(A.base, '/v1/acceso/organizador', { codigo: org.cuerpo.codigo }, escritura())
  const cookie = /^__Host-sesion=([^;]*)/.exec(login.cabeceras.get('set-cookie') ?? '')?.[1]
  if (login.status !== 200 || !cookie) throw new Error(`login: ${login.status}`)
  await post(A.base, '/v1/acceso/organizador', { codigo: 'AAAAA-BBBBB-CCCCC-DDDDD' }, { ...escritura(), 'cf-connecting-ip': '203.0.113.9' }) // fallo: fila de límite por fuente
  await mandar(A.base, 'P', tokenDe('P'), 'iniciar-partido'); await mandar(A.base, 'P', tokenDe('P'), 'arrancar-reloj')
  for (const [eq, jug, p] of [['E1', 'J1', 3], ['E1', 'J1', 3], ['E1', 'J2', 2], ['E2', 'J9', 3], ['E2', 'J9', 2]]) await mandar(A.base, 'P', tokenDe('P'), 'anotar', { equipoId: eq, jugadorId: jug, puntos: p })
  await mandar(A.base, 'P', tokenDe('P'), 'falta', { equipoId: 'E1', jugadorId: 'J1' }); await mandar(A.base, 'P', tokenDe('P'), 'detener-reloj')
  const ultimo = await mandar(A.base, 'P', tokenDe('P'), 'cerrar-partido')
  const alta = await post(A.base, `/v1/organizador/ligas/${LIGA}/equipos/E3/jugadores`, { operacionId: 'alta-ensayo-0000000001-aaaa', campos: { nombrePila: 'Carla', apellido1: 'Nueva', dorsal: 12 } }, escritura(cookie))
  const codigoQ = await post(A.base, `/v1/organizador/ligas/${LIGA}/partidos/Q/codigo`, {}, escritura(cookie))
  const tokenQ = `${'ab'.repeat(32)}`
  const act = await post(A.base, `/v1/ligas/${LIGA}/partidos/Q/activar`, { codigo: codigoQ.cuerpo?.codigo, tokenHash: sha(tokenQ) })
  const ren = await post(A.base, `/v1/admin/ligas/${LIGA}/nombre`, { cargaId: 'ensayo-nombre-0000000001', nombre: 'Nombre sintético restaurado' }, adminH)
  informe.pasos.push(`datos creados: alta=${alta.status} codigoQ=${codigoQ.status} activarQ=${act.status} renombrar=${ren.status}`)
  if (![200, 201].includes(alta.status) || ![200, 201].includes(codigoQ.status) || act.status !== 200 || ren.status !== 201) throw new Error('datos-incompletos')

  const lecturas = async (base) => ({
    juegoP: sinHora((await get(base, `/v1/ligas/${LIGA}/partidos/P`)).cuerpo), liga: sinHora((await get(base, `/v1/ligas/${LIGA}/publico`)).cuerpo),
    equipo1: sinHora((await get(base, `/v1/ligas/${LIGA}/equipos/E1/publico`)).cuerpo), jugadores: sinHora((await get(base, `/v1/ligas/${LIGA}/jugadores/publico`)).cuerpo),
    otraLiga: sinHora((await get(base, `/v1/ligas/${OTRA}/publico`)).cuerpo),
    organizador: sinHora(await get(base, `/v1/organizador/ligas/${LIGA}`, escritura(cookie))),
    ajena: (await get(base, `/v1/organizador/ligas/${OTRA}`, escritura(cookie))).status,
    estadoP: (await get(base, `/v1/ligas/${LIGA}/partidos/P/estado`, { authorization: `Bearer ${tokenDe('P')}` })).cuerpo?.cursor,
    estadoQ: (await get(base, `/v1/ligas/${LIGA}/partidos/Q/estado`, { authorization: `Bearer ${tokenQ}` })).status,
    repeticion: await post(base, `/v1/ligas/${LIGA}/partidos/P/comandos`, ultimo.sobre, { authorization: `Bearer ${tokenDe('P')}` }),
  })
  const antes = await lecturas(A.base)
  const repA = { status: antes.repeticion.status, resultado: antes.repeticion.cuerpo?.resultado }
  delete antes.repeticion
  ok('origen: la repetición del último comando de P devuelve su recibo original (sin escribir)', repA.status === 200 || repA.status === 201, repA)
  ok('origen: el organizador ve su liga y NO la ajena', antes.organizador.status === 200 && antes.ajena !== 200, { ajena: antes.ajena })
  ok('origen: el teléfono de Q (activado) funciona', antes.estadoQ === 200)

  // ---------------- 2. captura privada ----------------
  const CAP1 = join(TRABAJO, 'captura-A')
  const sinToken = cli('scripts/respaldo-privado.mjs', ['--origen', A.base, '--liga', LIGA, '--salida', join(TRABAJO, 'x-sin-token'), '--capturar'], { SEBEL_OPERADOR_TOKEN: '' })
  ok('captura sin credencial falla y no hace nada', sinToken.codigo === 1 && !existsSync(join(TRABAJO, 'x-sin-token')))
  const malToken = cli('scripts/respaldo-privado.mjs', ['--origen', A.base, '--liga', LIGA, '--salida', join(TRABAJO, 'x-mal-token'), '--capturar'], { SEBEL_OPERADOR_TOKEN: 'otro-token-sintetico-que-no-sirve-0123456789' })
  ok('un Bearer incorrecto no exporta (401) y no deja ningún archivo con datos', malToken.codigo === 1 && (!existsSync(join(TRABAJO, 'x-mal-token')) || readdirSync(join(TRABAJO, 'x-mal-token')).length === 0))
  for (const ruta of [`/v1/admin/respaldo/ligas/${LIGA}/exportar`, '/v1/admin/respaldo/acceso/exportar']) {
    const a1 = await post(A.base, ruta, {}); const a2 = await post(A.base, ruta, {}, { cookie: `__Host-sesion=${cookie}`, ...escritura(cookie) })
    ok(`exportar sin Bearer / con la cookie del organizador → 401 (${ruta.split('/').slice(-2).join('/')})`, a1.status === 401 && a2.status === 401 && !JSON.stringify([a1.cuerpo, a2.cuerpo]).includes('formato'))
  }
  const cap = cli('scripts/respaldo-privado.mjs', ['--origen', A.base, '--liga', LIGA, '--liga', OTRA, '--acceso', '--salida', CAP1, '--capturar'])
  ok('captura privada completa (2 ligas + acceso)', cap.codigo === 0 && cap.json?.estado === 'completo', cap.json?.estado === 'completo' ? cap.json.archivos.map((x) => x.nombre) : { estado: cap.json?.estado, objeto: cap.json?.objeto, motivo: cap.json?.motivo })
  const ver1 = cli('scripts/respaldo-privado.mjs', ['--verificar', CAP1])
  ok('la carpeta de captura verifica (permisos, checksums, sellos)', ver1.codigo === 0)
  const capA = leerCaptura(CAP1)
  const marcadores = JSON.parse(readFileSync(join(CAP1, 'marcador-liga-LIGA-ENSAYO.json'), 'utf8'))
  ok('el marcador de recuperación local NO se inventa', marcadores.disponible === false, { motivo: marcadores.motivo })
  await A.parar()

  // ---------------- 3. destino B: almacenamiento NUEVO y vacío ----------------
  const persB = join(TRABAJO, 'estado-B')
  let B = await levantar('B', PB, persB)
  informe.pasos.push('destino B levantado (persistencia B vacía, otro puerto)')
  const antesImportar = (await get(B.base, `/v1/ligas/${LIGA}/partidos/P`)).status
  ok('B está vacío antes de importar (el partido no existe)', antesImportar !== 200, { status: antesImportar })
  const sinAut = await post(B.base, `/v1/ensayo/respaldo/ligas/${LIGA}/importar`, '{}')
  ok('importar sin Bearer → 401', sinAut.status === 401)
  const remoto = cli('ensayo/restaurar-ensayo.mjs', ['--origen', 'https://semabel.com', '--carpeta', CAP1])
  ok('la restauración rechaza un destino remoto SIN hacer ninguna petición', remoto.codigo === 1 && /origen-no-local/.test(JSON.stringify(remoto.json)), remoto.json?.estado)
  const manipulada = join(TRABAJO, 'captura-manipulada')
  spawnSync('cp', ['-r', CAP1, manipulada]); const archivoLiga = join(manipulada, 'liga-LIGA-ENSAYO.json')
  writeFileSync(archivoLiga, readFileSync(archivoLiga, 'utf8').replace('"Alfa"', '"Alfx"'), { mode: 0o600 })
  const trucada = cli('ensayo/restaurar-ensayo.mjs', ['--origen', B.base, '--carpeta', manipulada])
  ok('una captura manipulada se rechaza antes de importar', trucada.codigo === 1 && trucada.json?.estado === 'carpeta-invalida')
  ok('…y B sigue vacío', (await get(B.base, `/v1/ligas/${LIGA}/partidos/P`)).status !== 200)
  const imp = cli('ensayo/restaurar-ensayo.mjs', ['--origen', B.base, '--carpeta', CAP1])
  ok('importación en B completa', imp.codigo === 0 && imp.json?.estado === 'completo', imp.json?.resultados?.map((r) => `${r.objeto}:${r.http}`))
  const otraVez = cli('ensayo/restaurar-ensayo.mjs', ['--origen', B.base, '--carpeta', CAP1])
  ok('importar de nuevo (destino ya con datos) se rechaza: destino-no-vacio', otraVez.codigo === 1 && JSON.stringify(otraVez.json).includes('destino-no-vacio'))

  // ---------------- 4. comparación ----------------
  const CAP2 = join(TRABAJO, 'captura-B')
  const cap2 = cli('scripts/respaldo-privado.mjs', ['--origen', B.base, '--liga', LIGA, '--liga', OTRA, '--acceso', '--salida', CAP2, '--capturar'])
  ok('captura de B completa', cap2.codigo === 0 && cap2.json?.estado === 'completo')
  const capB = leerCaptura(CAP2)
  for (const objeto of Object.keys(capA)) {
    const a = capA[objeto]; const b = capB[objeto]
    ok(`${objeto}: esquema idéntico (tablas, índices, disparadores y su texto)`, JSON.stringify(a.esquema) === JSON.stringify(b.esquema))
    ok(`${objeto}: mismas tablas y mismos conteos`, JSON.stringify(a.tablas.map((x) => [x.nombre, x.filas])) === JSON.stringify(b.tablas.map((x) => [x.nombre, x.filas])), a.tablas.map((x) => `${x.nombre}:${x.filas}`).join(' '))
    ok(`${objeto}: checksums canónicos por tabla idénticos`, a.tablas.every((x, i) => x.sha256 === b.tablas[i].sha256), { tablas: a.tablas.length })
    ok(`${objeto}: sello del conjunto idéntico`, a.sha256 === b.sha256)
  }
  const despues = await lecturas(B.base)
  const repB = { status: despues.repeticion.status, resultado: despues.repeticion.cuerpo?.resultado }
  const cuerpoRepB = despues.repeticion.cuerpo; delete despues.repeticion
  ok('lecturas públicas (partido, liga, equipo, jugadores, otra liga) idénticas', JSON.stringify([antes.juegoP, antes.liga, antes.equipo1, antes.jugadores, antes.otraLiga]) === JSON.stringify([despues.juegoP, despues.liga, despues.equipo1, despues.jugadores, despues.otraLiga]))
  ok('el marcador del partido es el original (14 – 6 sintético… lo que haya jugado)', JSON.stringify(antes.juegoP.local) === JSON.stringify(despues.juegoP.local) && antes.juegoP.estado === 'final', { local: despues.juegoP.local.puntos, visita: despues.juegoP.visita.puntos })
  ok('la sesión de organizador ORIGINAL (misma cookie) sigue válida en B y ve lo mismo', despues.organizador.status === 200 && JSON.stringify(antes.organizador) === JSON.stringify(despues.organizador))
  ok('la propiedad se conserva: la liga ajena sigue negada', despues.ajena === antes.ajena && despues.ajena !== 200, { estado: despues.ajena })
  ok('el token del teléfono de P y el activado de Q siguen válidos (credenciales exactas)', JSON.stringify(antes.estadoP) === JSON.stringify(despues.estadoP) && despues.estadoQ === 200)
  ok('la repetición del último comando de P devuelve el MISMO recibo original en B', repB.status === repA.status && repB.resultado === repA.resultado && !!cuerpoRepB?.recibo, repB)

  // ---------------- 5. reinicio de B sobre su almacenamiento ----------------
  await B.parar(); B = await levantar('B2', PB, persB)
  const CAP3 = join(TRABAJO, 'captura-B-tras-reinicio')
  const cap3 = cli('scripts/respaldo-privado.mjs', ['--origen', B.base, '--liga', LIGA, '--liga', OTRA, '--acceso', '--salida', CAP3, '--capturar'])
  const capC = cap3.codigo === 0 ? leerCaptura(CAP3) : {}
  ok('tras reiniciar B, el arranque (esquema y reparación de resúmenes) no altera lo restaurado', Object.keys(capA).every((o) => capC[o]?.sha256 === capA[o].sha256))
  ok('…y sigue sirviendo la sesión original', (await get(B.base, `/v1/organizador/ligas/${LIGA}`, escritura(cookie))).status === 200)
  await B.parar()
} catch (e) {
  informe.error = String(e.message ?? e)
} finally {
  for (const pid of [...procesos]) detener(pid)
  informe.ok = !informe.error && informe.comprobaciones.length > 0 && informe.comprobaciones.every((c) => c.ok)
  writeFileSync(join(TRABAJO, 'informe.json'), JSON.stringify(informe, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ ok: informe.ok, error: informe.error ?? null, comprobaciones: informe.comprobaciones.map((c) => `${c.ok ? 'OK ' : 'FALLA'} ${c.nombre}`), pasos: informe.pasos }, null, 2))
  process.exit(informe.ok ? 0 : 1)
}
