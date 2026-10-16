import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// El panel del organizador (modo compartido) no debe poder escribir en Dexie ni conceder permisos del prototipo: ningún
// módulo alcanzable desde AppCompartida.jsx puede importar la base local, los datos del prototipo, los roles locales,
// la plantilla local, las operaciones de plantilla de Dexie ni la siembra de demostración.

const RAIZ = resolve(import.meta.dirname, '..')
const PROHIBIDOS = ['db.js', 'datos.js', 'seed.js', 'plantilla.jsx', 'ui.jsx', 'lib/roster.js', 'lib/sesion.js', 'lib/seguir.js', 'lib/reloj.js', 'lib/marcador.js']
const EXTENSIONES = ['', '.js', '.jsx', '/index.js', '/index.jsx']

function resolverImport(desde, especificador) {
  const base = resolve(dirname(desde), especificador)
  for (const e of EXTENSIONES) if (existsSync(base + e) && !base.endsWith('.css') && (e !== '' || /\.(jsx?|css)$/.test(base))) return base + e
  return null
}

function alcanzables(entrada) {
  const vistos = new Set()
  const pila = [entrada]
  while (pila.length) {
    const archivo = pila.pop()
    if (vistos.has(archivo)) continue
    vistos.add(archivo)
    if (!/\.jsx?$/.test(archivo)) continue
    const fuente = readFileSync(archivo, 'utf8')
    for (const m of fuente.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)) {
      const esp = m[1] ?? m[2]
      if (!esp.startsWith('.')) continue
      const ruta = resolverImport(archivo, esp)
      if (ruta) pila.push(ruta)
    }
  }
  return [...vistos].map((a) => a.slice(RAIZ.length + 1))
}

describe('aislamiento del modo compartido', () => {
  const todos = alcanzables(join(RAIZ, 'AppCompartida.jsx'))
  it('AppCompartida alcanza las pantallas del panel (la prueba mira lo correcto)', () => {
    for (const esperado of ['pantallas/PlantillaOrganizador.jsx', 'pantallas/FormularioJugadorCompartido.jsx', 'lib/operacion-pendiente.js', 'lib/roster-api.js', 'lib/roster-reglas.js']) expect(todos).toContain(esperado)
  })
  it('ningún módulo alcanzable importa Dexie, datos del prototipo, roles locales o la plantilla local', () => {
    const malos = todos.filter((a) => PROHIBIDOS.some((p) => a === p || a.endsWith(`/${p}`)))
    expect(malos).toEqual([])
  })
  // REPORT_128: la pantalla de puntuación también está montada. Lo que se permite es EXACTAMENTE la lista de módulos aceptados y cada
  // operación sensible solo en el módulo que le corresponde; todas las demás prohibiciones siguen igual.
  const ACTIVACION = ['lib/control/activacion.js', 'lib/control/activacion-api.js', 'lib/control/activacion-almacen.js']
  const SESION = [
    'lib/control/reloj-telefono.js', 'lib/control/sesion-almacen.js', 'lib/control/sesion-api.js', 'lib/control/sesion-candado.js',
    'lib/control/sesion-controlador.js', 'lib/control/sesion-emisor.js', 'lib/control/sesion-intencion.js', 'lib/control/sesion-motor.js',
    'lib/control/sesion-visualizacion.js',
  ]
  const codigoDe = (archivo) => readFileSync(join(RAIZ, archivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  it('la activación y la pantalla de puntuación están montadas y los módulos de control son EXACTAMENTE los aceptados', () => {
    for (const esperado of ['pantallas/ControlActivar.jsx', 'pantallas/ControlPartido.jsx', ...ACTIVACION, ...SESION]) expect(todos, esperado).toContain(esperado)
    const deControl = todos.filter((a) => a.startsWith('lib/control/')).sort()
    expect(deControl).toEqual([...ACTIVACION, ...SESION].sort())
    // y lo que usan de fuera: solo cálculos puros (marcador, reloj, dorsal) y el motor
    const puros = todos.filter((a) => /^lib\/(marcador-calculo|reloj-calculo|dorsal)\.js$/.test(a) || a.startsWith('lib/motor/'))
    expect(puros.length).toBeGreaterThan(0)
  })
  it('cada operación sensible vive solo donde corresponde: /comandos, IndexedDB, localStorage, Web Locks; nada del organizador', () => {
    const propios = todos.filter((a) => a.startsWith('lib/control/') || a === 'pantallas/ControlActivar.jsx' || a === 'pantallas/ControlPartido.jsx')
    for (const archivo of propios) {
      const fuente = codigoDe(archivo)
      if (archivo !== 'lib/control/sesion-api.js') expect(fuente, `${archivo} menciona /comandos`).not.toMatch(/\/comandos/)
      expect(fuente, `${archivo} toca claves del organizador`).not.toContain('sebel.op.v1')
      expect(fuente, `${archivo} importa el panel del organizador`).not.toMatch(/from\s+['"][^'"]*(operacion-pendiente|roster-api|sesion-servidor|ComunOrganizador)['"]/)
      if (archivo !== 'lib/control/sesion-almacen.js') expect(fuente, `${archivo} usa indexedDB`).not.toMatch(/indexedDB/)
      if (archivo !== 'lib/control/activacion-almacen.js') expect(fuente, `${archivo} usa localStorage directamente`).not.toMatch(/localStorage/)
      expect(fuente, `${archivo} usa Dexie`).not.toMatch(/\bDexie\b|dexie/)
      if (!['lib/control/sesion-candado.js', 'lib/control/activacion.js'].includes(archivo)) expect(fuente, `${archivo} pide Web Locks`).not.toMatch(/locks\.request/)
    }
    // las piezas de activación siguen sin saber nada de /comandos ni de la cola
    for (const archivo of [...ACTIVACION, 'pantallas/ControlActivar.jsx']) expect(codigoDe(archivo), archivo).not.toMatch(/\/comandos|sesion-(almacen|controlador|emisor)/)
  })
  it('la pantalla de puntuación no escribe puntos locales, no siembra datos ni concede permisos del prototipo', () => {
    const f = codigoDe('pantallas/ControlPartido.jsx')
    for (const mal of [/from\s+['"][^'"]*(\/db|datos|seed|lib\/sesion|lib\/marcador|lib\/reloj|ui)['"]/, /(?<!INTENCIONES\.)\banotar\(|\bmarcarFalta\(|useLiveQuery|esDuenoDe|esOrganizador|sembrar/]) expect(f, String(mal)).not.toMatch(mal)
  })
  it('las reglas compartidas que sí se importan no dependen de la base local', () => {
    const reglas = alcanzables(join(RAIZ, 'lib/roster-reglas.js'))
    expect(reglas.sort()).toEqual(['lib/dorsal.js', 'lib/identidad.js', 'lib/roster-reglas.js'])
  })

  // REPORT_135: las pantallas públicas están montadas y se alimentan SOLO de las lecturas públicas del servidor.
  describe('pantallas públicas', () => {
    const PUBLICAS = ['pantallas/publico/InicioCompartido.jsx', 'pantallas/publico/LigaCompartida.jsx', 'pantallas/publico/PartidoPublico.jsx', 'pantallas/publico/EquipoPublico.jsx']
    const PUROS_PERMITIDOS = ['lib/categorias.js', 'lib/enlaces.js', 'lib/reloj-calculo.js', 'lib/tabla-posiciones.js', 'lib/volver.js'] // tabla-posiciones.js: las reglas de la tabla, una sola vez (REPORT_156); enlaces.js (slug) y volver.js (destino de «Salir» validado): puros y sin importaciones (REPORT_158)
    const deLasPublicas = [...new Set(PUBLICAS.flatMap((a) => alcanzables(join(RAIZ, a))))].sort()
    const propios = deLasPublicas.filter((a) => a.startsWith('lib/publico/') || a.startsWith('pantallas/publico/'))

    it('están montadas desde AppCompartida', () => {
      for (const a of PUBLICAS) expect(todos, a).toContain(a)
    })
    it('lo alcanzable desde ellas son EXACTAMENTE sus módulos y dos cálculos puros: ni Dexie, ni datos, ni sesión, ni siembra, ni marcador/reloj locales, ni ui.jsx, ni el panel, ni el control', () => {
      const ajenos = deLasPublicas.filter((a) => !a.startsWith('lib/publico/') && !a.startsWith('pantallas/publico/') && !PUROS_PERMITIDOS.includes(a))
      expect(ajenos).toEqual([])
      expect(deLasPublicas.filter((a) => PROHIBIDOS.some((p) => a === p || a.endsWith(`/${p}`)))).toEqual([])
      expect(deLasPublicas.some((a) => a.startsWith('lib/control/') || a.startsWith('lib/motor/'))).toBe(false)
    })
    it('los cálculos puros permitidos no importan nada', () => {
      for (const a of PUROS_PERMITIDOS) expect(alcanzables(join(RAIZ, a)), a).toEqual([a])
    })
    it('solo cliente.js pide a la red, y solo las dos lecturas públicas; nadie toca almacenamiento, cookies ni credenciales', () => {
      for (const archivo of propios.filter((a) => /\.jsx?$/.test(a) && !/\.test\./.test(a) && !a.endsWith('datos-prueba.js'))) {
        const f = codigoDe(archivo)
        if (archivo !== 'lib/publico/cliente.js') expect(f, `${archivo} usa fetch`).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/)
        for (const mal of [/indexedDB/, /localStorage|sessionStorage/, /document\.cookie/, /\bDexie\b|dexie/, /\/estado\b|\/preparacion|\/comandos|\/_semilla|\/v1\/organizador|\/v1\/admin/, /authorization|Bearer /i, /ipwho|resolverRegion/, /useLiveQuery/]) {
          expect(f, `${archivo} ${mal}`).not.toMatch(mal)
        }
      }
      expect(codigoDe('lib/publico/cliente.js')).toMatch(/credentials: 'omit'/)
    })
    it('main.jsx: el arranque compartido NO busca la región (REPORT_152); el prototipo sí', () => {
      expect(codigoDe('main.jsx')).toMatch(/if \(!modoCompartido\(\)\) await resolverRegion\(\)/)
    })
  })
})
