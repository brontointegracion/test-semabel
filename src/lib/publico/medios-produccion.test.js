import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mediosDeLiga, urlDeMedio } from './medios.js'

// REPORT_202: el manifiesto REAL del repositorio (public/medios/manifest.json) y los archivos que referencia, validados con el contrato existente.
// No renderiza nada nuevo; solo comprueba que lo que se despliega es lo aprobado y está completo.

const RAIZ = join(import.meta.dirname, '..', '..', '..', 'public', 'medios')
const manifiesto = JSON.parse(readFileSync(join(RAIZ, 'manifest.json'), 'utf8'))
const LIGA = 'SIMULACRO-PILOTO'
const LIGAS_REALES = ['PLATINIUM-U10', 'PLATINIUM-U12']
const ORDEN = ['parmigiana', 'workings', 'pce', 'javier-del-rio', 'deportes-jimmy', 'pixeles']
// REPORT_212: las ligas REALES llevan doce patrocinadores (los seis anteriores + seis nuevos); SIMULACRO-PILOTO conserva los seis.
const ORDEN_REAL = [...ORDEN, 'rodsan', 'effort-bull-kennels', 'adminplayers', 'panteras', 'bethancourt-asociados', 'symisa']
const NOMBRES_REAL = ['La Parmigiana', 'WORKINGS', 'Panama Crystal Engineering', 'Javier del Rio Corp', 'Deportes Jimmy', 'Píxeles & Diseños, S.A.', 'Casa de campo RODSAN', 'Effort Bull Kennels', 'AdminPlayers', 'Club Deportivo Panteras', 'Bethancourt & Asociados', 'SYMISA']
// REPORT_216: NUEVE imágenes de equipo (extraídas SIN cambios de la tabla del calendario del PDF de propuesta), usadas por DIECIOCHO equipos distintos.
const EQUIPOS_REALES = {
  'deportivo-vip': { sha: 'c7fff7cd54c49ecf4d9915d02505ee2a1152788a34245195df7d8c6867129c77', ancho: 1536, alto: 1536, ids: ["PLATINIUM-U10-DEPORTIVO", "PLATINIUM-U10-VIP", "PLATINIUM-U12-DEPORTIVO-VIP"] },
  'unity-basketball': { sha: '7960cfdf4c7b919d8f2a9361a0763a7fa6e34c188c1c65b4bf388744c82736b5', ancho: 1443, alto: 1536, ids: ["PLATINIUM-U10-UNITY-BASKETBALL", "PLATINIUM-U12-UNITY-BASKETBALL"] },
  'correcaminos': { sha: 'a7a875bf58ef7e1952d52e6a4ab4e2954fdd4160eea0042d75efa40ac09b46f6', ancho: 1517, alto: 1536, ids: ["PLATINIUM-U10-CORRECAMINOS", "PLATINIUM-U12-CORRECAMINOS"] },
  'hardwork': { sha: 'c277b49059241484fc7ff91bea442fb5497937a95fe8c4673b0db1a34965819c', ancho: 1271, alto: 1536, ids: ["PLATINIUM-U10-HARDWORK-BASKETBALL", "PLATINIUM-U12-HARDWORK-BASKETBALL", "PLATINIUM-U12-HARDWORK-WEST"] },
  'west-hornets': { sha: '5cd49ed796e1aae393e3686a0eae943f1a3145cfc23499542bb3f394d398bad1', ancho: 1369, alto: 1536, ids: ["PLATINIUM-U10-WEST-HORNETS", "PLATINIUM-U12-WEST-HORNETS"] },
  'grizzlies': { sha: 'c6f16d7c040846e07ae3eaca921bf476380da77058947ed8f18118331887906a', ancho: 1402, alto: 1536, ids: ["PLATINIUM-U10-GRIZZLIES", "PLATINIUM-U12-GRIZZLIES"] },
  'grillos-vip': { sha: 'c507e6af4d2a2fe7a35dc8cd37ed86daa3378d2f7c8c8c913a55f2caf8597d50', ancho: 1536, alto: 1536, ids: ["PLATINIUM-U10-GRILLOS-VIP", "PLATINIUM-U12-GRILLOS-VIP"] },
  'cross-level': { sha: '2a3e8d7e0a1595d989ac3a81888df28f7b74a34b7c2827943baf079f115c3bd4', ancho: 1536, alto: 1536, ids: ["PLATINIUM-U10-CROSS-LEVEL"] },
  'west-boys': { sha: '65f1e49985ecaa1168323e51dcca4b65c5c433b5587620efff25d30083cd2641', ancho: 1427, alto: 1536, ids: ["PLATINIUM-U12-WEST-BOYS"] },
}
const sha256 = (ruta) => createHash('sha256').update(readFileSync(join(RAIZ, ruta))).digest('hex')
const MAX_PRECACHE = 2 * 1024 * 1024 // el límite de precaché del PWA; un png por encima rompe la compilación

const lista = (dir = RAIZ, base = '') => readdirSync(dir).flatMap((n) => {
  const ruta = join(dir, n)
  return statSync(ruta).isDirectory() ? lista(ruta, `${base}${n}/`) : [`${base}${n}`]
})
const png = (b) => ({ ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20), tipoColor: b[25] })
function jpg(b) {
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) return null
    const m = b[i + 1]
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) }
    i += 2 + b.readUInt16BE(i + 2)
  }
  return null
}

describe('manifiesto de medios de producción (public/medios)', () => {
  it('SIMULACRO-PILOTO y las dos ligas reales (REPORT_209); la raíz lleva el logo de Semabel; ninguna otra liga ni patrocinador ficticio', () => {
    expect(Object.keys(manifiesto).sort()).toEqual(['ligas', 'semabel', 'version'])
    expect(manifiesto.version).toBe(1)
    expect(Object.keys(manifiesto.ligas)).toEqual([LIGA, ...LIGAS_REALES])
    expect(manifiesto.semabel).toEqual({ logo: 'SMB/semabel-transparente.png' })
  })

  it('el emblema del organizador y los seis patrocinadores, en su orden, con ids únicos', () => {
    const l = manifiesto.ligas[LIGA]
    expect(l.organizador).toEqual({ logo: 'PLATINIUM/platinium-logo.png' })
    expect(l.patrocinadores.map((p) => p.id)).toEqual(ORDEN)
    expect(new Set(l.patrocinadores.map((p) => p.id)).size).toBe(6)
    expect(l.patrocinadores.map((p) => p.nombre)).toEqual(['La Parmigiana', 'WORKINGS', 'Panama Crystal Engineering', 'Javier del Rio Corp', 'Deportes Jimmy', 'Píxeles & Diseños, S.A.'])
  })

  it('el contrato existente los acepta tal cual: seis tarjetas con logo, el emblema y el logo de Semabel', () => {
    const m = mediosDeLiga(manifiesto, LIGA)
    expect(m.semabelLogo).toBe('/medios/SMB/semabel-transparente.png')
    expect(m.organizador.logo).toBe('/medios/PLATINIUM/platinium-logo.png')
    expect(m.patrocinadores.map((p) => p.id)).toEqual(ORDEN)
    for (const p of m.patrocinadores) { expect(p.formato).toBe('tarjeta'); expect(p.disposicion).toBe('logo'); expect(p.logo).toMatch(/^\/medios\//) }
    // una liga que no está en el manifiesto no hereda nada (solo el logo de Semabel, que es de marca)
    const otra = mediosDeLiga(manifiesto, 'OTRA-LIGA')
    expect(otra.patrocinadores).toEqual([])
    expect(otra.organizador.logo ?? null).toBeNull()
  })

  it('REPORT_212: las dos ligas reales llevan EXACTAMENTE el mismo emblema y los mismos DOCE patrocinadores, en este orden; SIMULACRO-PILOTO sigue con sus seis, sin cambios', () => {
    const sinEquipos = (l) => { const { equipos: _e, ...resto } = manifiesto.ligas[l]; return resto } // los logos de EQUIPO son propios de cada liga (REPORT_216)
    expect(sinEquipos(LIGAS_REALES[1])).toEqual(sinEquipos(LIGAS_REALES[0]))
    for (const id of LIGAS_REALES) {
      const l = manifiesto.ligas[id]
      expect(l.organizador, id).toEqual(manifiesto.ligas[LIGA].organizador)
      expect(l.patrocinadores.map((p) => p.id)).toEqual(ORDEN_REAL)
      expect(l.patrocinadores.map((p) => p.nombre)).toEqual(NOMBRES_REAL)
      expect(l.patrocinadores.slice(0, 6)).toEqual(manifiesto.ligas[LIGA].patrocinadores) // los seis aprobados, idénticos y en su orden
      expect(new Set(l.patrocinadores.map((p) => p.id)).size).toBe(12)
      const m = mediosDeLiga(manifiesto, id)
      expect(m.organizador.logo).toBe('/medios/PLATINIUM/platinium-logo.png')
      expect(m.patrocinadores.map((p) => p.id)).toEqual(ORDEN_REAL)
      for (const q of m.patrocinadores) { expect(q.formato).toBe('tarjeta'); expect(q.disposicion).toBe('logo'); expect(q.descriptor ?? null).toBeNull() }
      expect(m.semabelLogo).toBe('/medios/SMB/semabel-transparente.png')
    }
    expect(manifiesto.ligas[LIGA].patrocinadores.map((p) => p.id)).toEqual(ORDEN)
  })

  it('REPORT_212: los seis nuevos, con su presentación aprobada (sin nombre ni rubro añadidos); solo RODSAN lleva nombreEnBanda y su recorte v2', () => {
    const q = Object.fromEntries(manifiesto.ligas[LIGAS_REALES[0]].patrocinadores.map((p) => [p.id, p]))
    const base = { formato: 'tarjeta', disposicion: 'logo' }
    expect(q.rodsan).toEqual({ id: 'rodsan', ...base, nombre: 'Casa de campo RODSAN', logo: 'RODSAN/rodsan-logo-recorte-v2.jpeg', fondo: '#323436', texto: '#FFFFFF', acento: '#FFFFFF', nombreEnBanda: true })
    expect(q['effort-bull-kennels']).toEqual({ id: 'effort-bull-kennels', ...base, nombre: 'Effort Bull Kennels', logo: 'EFFORT/effort-bull-kennels.jpeg', fondo: '#000000', texto: '#FFFFFF', acento: '#FFFFFF' })
    expect(q.adminplayers).toEqual({ id: 'adminplayers', ...base, nombre: 'AdminPlayers', logo: 'ADMINPLAYERS/adminplayers-recorte.jpeg', fondo: '#000000', texto: '#FFFFFF', acento: '#FFFFFF' })
    expect(q.panteras).toEqual({ id: 'panteras', ...base, nombre: 'Club Deportivo Panteras', logo: 'PANTERAS/panteras-logo.png', fondo: '#FFFFFF', texto: '#111111', acento: '#111111' })
    expect(q['bethancourt-asociados']).toEqual({ id: 'bethancourt-asociados', ...base, nombre: 'Bethancourt & Asociados', logo: 'BETHANCOURT/bethancourt-asociados-blanco.png', fondo: '#FFFFFF', texto: '#111111', acento: '#111111' })
    expect(q.symisa).toEqual({ id: 'symisa', ...base, nombre: 'SYMISA', logo: 'SYMISA/symisa.jpeg', fondo: '#FFFFFF', texto: '#111111', acento: '#111111' })
    for (const [id, p] of Object.entries(q)) expect('nombreEnBanda' in p, id).toBe(id === 'rodsan')
  })

  it('REPORT_209: La Parmigiana ya no lleva descriptor («Restaurante italiano»); el resto de sus datos no cambia; ninguna ficha tiene descriptor', () => {
    for (const id of [LIGA, ...LIGAS_REALES]) {
      const parm = manifiesto.ligas[id].patrocinadores.find((p) => p.id === 'parmigiana')
      expect('descriptor' in parm).toBe(false)
      expect(parm).toEqual({ id: 'parmigiana', formato: 'tarjeta', disposicion: 'logo', nombre: 'La Parmigiana', logo: 'PARM/parmigiana.jpeg', fondo: '#000000', texto: '#FFFFFF', acento: '#FFFFFF' })
      expect(manifiesto.ligas[id].patrocinadores).toHaveLength(id === LIGA ? 6 : 12)
    }
    expect(JSON.stringify(manifiesto)).not.toMatch(/Restaurante/)
    expect(mediosDeLiga(manifiesto, 'PLATINIUM-U10').patrocinadores[0].descriptor ?? null).toBeNull()
  })

  const referidos = [...new Set([manifiesto.semabel.logo, manifiesto.ligas[LIGA].organizador.logo, ...Object.values(manifiesto.ligas).flatMap((l) => [...l.patrocinadores.map((p) => p.logo), ...Object.values(l.equipos ?? {}).map((e) => e.logo)])])]
  it('cada archivo referido existe con ese nombre exacto (mayúsculas/minúsculas), es una imagen válida y cabe en el precaché', () => {
    const existentes = new Set(lista())
    for (const r of referidos) {
      expect(urlDeMedio(r)).toBe(`/medios/${r}`)
      expect(existentes.has(r), r).toBe(true) // comparación exacta con el listado del disco, no con existsSync (que en algunos sistemas ignora mayúsculas)
      const b = readFileSync(join(RAIZ, r))
      expect(b.length).toBeGreaterThan(1000)
      expect(b.length).toBeLessThan(MAX_PRECACHE)
      if (r.endsWith('.png')) { expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); const d = png(b); expect(d.ancho).toBeGreaterThan(100); expect(d.alto).toBeGreaterThan(100) }
      else { expect(b.subarray(0, 2).toString('hex')).toBe('ffd8'); const d = jpg(b); expect(d.ancho).toBeGreaterThan(100); expect(d.alto).toBeGreaterThan(100) }
    }
  })

  it('en public/medios solo está el manifiesto y los veintitrés archivos referidos (nada de ligas de pruebas, respaldos, PDF ni imágenes sueltas)', () => {
    expect(lista().sort()).toEqual(['manifest.json', ...referidos].sort())
  })

  it('REPORT_216: dieciocho equipos reales → nueve imágenes distintas; cada imagen se REUTILIZA (un solo archivo por logo compartido) y no se funden equipos', () => {
    const esperados = Object.entries(EQUIPOS_REALES).flatMap(([slug, t]) => t.ids.map((id) => [id, `EQUIPOS/${slug}.jpg`]))
    expect(esperados).toHaveLength(18)
    for (const liga of LIGAS_REALES) {
      const eq = manifiesto.ligas[liga].equipos
      const mios = esperados.filter(([id]) => id.startsWith(`${liga}-`))
      expect(Object.keys(eq).sort(), liga).toEqual(mios.map(([id]) => id).sort())
      for (const [id, ruta] of mios) expect(eq[id], id).toEqual({ logo: ruta }) // sin color ni otros campos: solo el logo
      const m = mediosDeLiga(manifiesto, liga)
      for (const [id, ruta] of mios) expect(m.equipos[id].logo, id).toBe(`/medios/${ruta}`)
      expect(Object.keys(m.equipos)).toHaveLength(mios.length) // un registro por equipo: nada se fusionó
    }
    expect(manifiesto.ligas[LIGAS_REALES[0]].equipos).not.toEqual(manifiesto.ligas[LIGAS_REALES[1]].equipos) // equipos distintos por liga
    const rutas = new Set(LIGAS_REALES.flatMap((l) => Object.values(manifiesto.ligas[l].equipos).map((e) => e.logo)))
    expect(rutas.size).toBe(9)
    // el logo compartido es el MISMO archivo para todos sus equipos (el calendario del PDF lo confirma: Deportivo = VIP = Deportivo VIP; Hardwork = Hardwork West)
    const porRuta = {}
    for (const [id, ruta] of esperados) (porRuta[ruta] ??= []).push(id)
    expect(porRuta['EQUIPOS/deportivo-vip.jpg']).toEqual(['PLATINIUM-U10-DEPORTIVO', 'PLATINIUM-U10-VIP', 'PLATINIUM-U12-DEPORTIVO-VIP'])
    expect(porRuta['EQUIPOS/hardwork.jpg']).toEqual(['PLATINIUM-U10-HARDWORK-BASKETBALL', 'PLATINIUM-U12-HARDWORK-BASKETBALL', 'PLATINIUM-U12-HARDWORK-WEST'])
    expect(porRuta['EQUIPOS/cross-level.jpg']).toEqual(['PLATINIUM-U10-CROSS-LEVEL'])
    expect(porRuta['EQUIPOS/west-boys.jpg']).toEqual(['PLATINIUM-U12-WEST-BOYS'])
    expect(manifiesto.ligas[LIGA].equipos).toBeUndefined() // SIMULACRO no cambia
    // los doce patrocinadores y los emblemas siguen intactos
    for (const liga of LIGAS_REALES) { expect(manifiesto.ligas[liga].patrocinadores.map((p) => p.id)).toEqual(ORDEN_REAL); expect(manifiesto.ligas[liga].organizador).toEqual({ logo: 'PLATINIUM/platinium-logo.png' }) }
  })

  it('REPORT_216: cada archivo de equipo es un JPEG original sin modificar (firma, descodificación, dimensiones y SHA-256 del original extraído del PDF); ninguna imagen se estira ni se recorta (CSS contain)', () => {
    for (const [slug, t] of Object.entries(EQUIPOS_REALES)) {
      const ruta = `EQUIPOS/${slug}.jpg`
      const b = readFileSync(join(RAIZ, ruta))
      expect(b.subarray(0, 3).toString('hex'), ruta).toBe('ffd8ff')
      expect(b.subarray(-2).toString('hex'), ruta).toBe('ffd9') // el archivo termina bien: no está truncado
      expect(jpg(b), ruta).toEqual({ ancho: t.ancho, alto: t.alto })
      expect(sha256(ruta), ruta).toBe(t.sha)
      expect(b.length).toBeLessThan(MAX_PRECACHE)
    }
    const css = readFileSync(join(import.meta.dirname, '..', '..', 'pantallas', 'publico', 'marcador-tv.css'), 'utf8')
    expect(css).toMatch(/\.sb-crest__img \{[^}]*object-fit: contain/) // el escudo muestra la imagen entera, sin deformar ni recortar
  })

  it('REPORT_212: ningún original, recorte anterior, PDF ni manifiesto de respaldo viaja; peso total de los medios y del precaché dentro de lo previsto', () => {
    const todos = lista()
    expect(todos.some((r) => /\.pdf$|\.off$|pre-|rodsan-logo\.jpeg$|rodsan-logo-recorte\.jpeg$|semabel-logo\.png$/i.test(r))).toBe(false)
    const total = todos.reduce((n, r) => n + statSync(join(RAIZ, r)).size, 0)
    const precache = todos.filter((r) => r.endsWith('.png')).reduce((n, r) => n + statSync(join(RAIZ, r)).size, 0) // el PWA solo precachea png/svg/js/css/html (vite.config.js)
    expect(total).toBeLessThan(4.5 * 1024 * 1024)
    expect(precache).toBeLessThan(3 * 1024 * 1024)
  })

  it('dimensiones aprobadas y el logo de Semabel conserva la transparencia (PNG RGBA, esquinas con alfa 0)', () => {
    const dim = (r) => png(readFileSync(join(RAIZ, r)))
    expect(dim('SMB/semabel-transparente.png')).toMatchObject({ ancho: 652, alto: 333, tipoColor: 6 }) // 6 = RGBA
    expect(dim('PLATINIUM/platinium-logo.png')).toMatchObject({ ancho: 354, alto: 353 })
    expect(dim('PIXELES/pixeles-logo.png')).toMatchObject({ ancho: 2640, alto: 997 })
    expect(jpg(readFileSync(join(RAIZ, 'PARM/parmigiana.jpeg')))).toEqual({ ancho: 1600, alto: 1026 })
    expect(jpg(readFileSync(join(RAIZ, 'JIMMY/deportes-jimmy.jpg')))).toEqual({ ancho: 1504, alto: 450 })
    // REPORT_212: los seis nuevos
    expect(jpg(readFileSync(join(RAIZ, 'RODSAN/rodsan-logo-recorte-v2.jpeg')))).toEqual({ ancho: 802, alto: 802 }) // recorte cuadrado del círculo completo
    expect(jpg(readFileSync(join(RAIZ, 'EFFORT/effort-bull-kennels.jpeg')))).toEqual({ ancho: 1156, alto: 988 })
    expect(jpg(readFileSync(join(RAIZ, 'ADMINPLAYERS/adminplayers-recorte.jpeg')))).toEqual({ ancho: 653, alto: 668 })
    expect(dim('PANTERAS/panteras-logo.png')).toMatchObject({ ancho: 1598, alto: 1480 })
    expect(dim('BETHANCOURT/bethancourt-asociados-blanco.png')).toMatchObject({ ancho: 931, alto: 762 })
    expect(jpg(readFileSync(join(RAIZ, 'SYMISA/symisa.jpeg')))).toEqual({ ancho: 849, alto: 829 })
    expect(existsSync(join(RAIZ, 'SMB/semabel-logo.png'))).toBe(false) // el logo opaco anterior no viaja
  })
})
