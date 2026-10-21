import { describe, expect, it, vi } from 'vitest'
import { MAX_PATROCINADORES, MEDIOS_VACIOS, contraste, diapositivasDeBanda, leerMedios, mediosDeLiga, olvidarMedios, parejasDePatrocinio, patrocinadorValido, tintasDe, urlDeMedio } from './medios.js'

const manifiesto = (liga) => ({ version: 1, ligas: { LIGA1: liga } })

describe('urlDeMedio: solo archivos de imagen locales', () => {
  it('acepta rutas relativas a /medios/', () => {
    expect(urlDeMedio('liga/a.png')).toBe('/medios/liga/a.png')
    expect(urlDeMedio('a-b_c.1/logo.SVG')).toBe('/medios/a-b_c.1/logo.SVG')
    expect(urlDeMedio('x.webp')).toBe('/medios/x.webp')
  })
  it('descarta URLs externas, esquemas, «..», rutas absolutas, ocultas y tipos que no son imagen', () => {
    for (const mala of ['https://x.com/a.png', '//x.com/a.png', 'data:image/png;base64,AA', 'javascript:alert(1).png', '../a.png', 'a/../b.png', '/a.png', 'a//b.png', '.oculto/a.png', 'a/.b.png', 'a.exe', 'a.html', 'a', '', null, undefined, 5, 'a b.png', 'a?x=1.png', `${'a'.repeat(130)}.png`]) {
      expect(urlDeMedio(mala), String(mala)).toBeNull()
    }
  })
})

describe('mediosDeLiga', () => {
  it('manifiesto ausente, roto o de otra versión: sin medios, nunca un error; no existe ningún patrocinador por omisión', () => {
    for (const m of [null, undefined, 5, 'x', [], {}, { version: 2, ligas: {} }, { version: 1 }, { version: 1, ligas: [] }, manifiesto(null), manifiesto('x')]) {
      expect(mediosDeLiga(m, 'LIGA1')).toEqual(MEDIOS_VACIOS)
    }
    expect(mediosDeLiga(manifiesto({}), 'OTRA').patrocinadores).toEqual([])
    expect(mediosDeLiga(manifiesto({ patrocinadores: [{ id: 'a', nombre: 'A' }] }), '__proto__')).toEqual(MEDIOS_VACIOS)
  })
  it('lee organizador, equipos por id y patrocinadores; lo inválido se omite entrada por entrada', () => {
    const m = mediosDeLiga(manifiesto({
      organizador: { logo: 'L/org.png' },
      equipos: { E1: { logo: 'L/e1.png', color: '#1F4FA3' }, E2: { logo: 'https://malo/e2.png' }, E3: { color: 'rojo' }, 'a b': { logo: 'L/x.png' }, E4: 'x' },
      patrocinadores: [
        { id: 'a', nombre: 'Agua', imagen: 'L/a.png', fondo: '#FFFFFF', descriptor: 'Bebidas' },
        { id: 'a', nombre: 'Repetido' }, { id: 'b' }, { id: 'c', nombre: 'Solo texto' }, { id: 'd', imagen: '../x.png' }, { id: 'e', imagen: 'L/e.png' }, 'x', null,
      ],
    }), 'LIGA1')
    expect(m.organizador.logo).toBe('/medios/L/org.png')
    expect(m.equipos).toEqual({ E1: { logo: '/medios/L/e1.png', color: '#1F4FA3' } })
    expect(m.patrocinadores.map((p) => p.id)).toEqual(['a', 'c', 'e'])
    expect(m.patrocinadores[0]).toEqual({ id: 'a', formato: 'arte', nombre: 'Agua', descriptor: 'Bebidas', logo: null, imagen: '/medios/L/a.png', imagenGrande: null, fondo: '#FFFFFF', texto: null, acento: null, borde: false, disposicion: null })
    expect(m.patrocinadores[1]).toMatchObject({ id: 'c', formato: 'tarjeta', nombre: 'Solo texto', imagen: null })
    expect(m.patrocinadores[2]).toMatchObject({ formato: 'arte', nombre: null, imagen: '/medios/L/e.png' })
  })
  it('cada liga ve solo lo suyo (por id estable) y hay un tope de patrocinadores', () => {
    const man = { version: 1, ligas: { A: { patrocinadores: [{ id: 'x', nombre: 'De A' }] }, B: { patrocinadores: Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, nombre: `S${i}` })) } } }
    expect(mediosDeLiga(man, 'A').patrocinadores.map((p) => p.nombre)).toEqual(['De A'])
    expect(mediosDeLiga(man, 'C').patrocinadores).toEqual([])
    expect(mediosDeLiga(man, 'B').patrocinadores.length).toBe(MAX_PATROCINADORES)
  })
})

describe('parejasDePatrocinio', () => {
  it('de dos en dos; una pareja incompleta se completa con el relleno', () => {
    const r = { tipo: 'semabel' }
    expect(parejasDePatrocinio([], r)).toEqual([])
    expect(parejasDePatrocinio([{ id: 1 }], r)).toEqual([[{ id: 1 }, r]])
    expect(parejasDePatrocinio([{ id: 1 }, { id: 2 }, { id: 3 }], r)).toEqual([[{ id: 1 }, { id: 2 }], [{ id: 3 }, r]])
  })
})

describe('leerMedios: una sola lectura por carga y los fallos son «sin medios»', () => {
  it('pide una vez, guarda el resultado y trata un error como null', async () => {
    olvidarMedios()
    const pedir = vi.fn(async () => ({ tipo: 'ok', cuerpo: { version: 1, ligas: {} } }))
    expect(await leerMedios(pedir)).toEqual({ version: 1, ligas: {} })
    await leerMedios(pedir)
    expect(pedir).toHaveBeenCalledTimes(1)
    expect(pedir.mock.calls[0][0]).toBe('/medios/manifest.json')
    olvidarMedios()
    expect(await leerMedios(async () => ({ tipo: 'no-encontrado' }))).toBeNull()
    olvidarMedios()
    expect(await leerMedios(async () => { throw new Error('x') })).toBeNull()
    olvidarMedios()
  })
})


describe('patrocinadores: dos formatos explícitos y compatibilidad con el manifiesto del REPORT_191', () => {
  const v = (o) => patrocinadorValido({ id: 'x', ...o })
  it('sin «formato» se deduce como antes: con imagen válida es «arte»; sin ella, con nombre, «tarjeta»; sin nada que mostrar, se omite', () => {
    expect(v({ nombre: 'A', imagen: 'L/a.png', fondo: '#FFFFFF', descriptor: 'R' })).toMatchObject({ formato: 'arte', imagen: '/medios/L/a.png', nombre: 'A', descriptor: 'R', fondo: '#FFFFFF' })
    expect(v({ imagen: 'L/a.png' })).toMatchObject({ formato: 'arte', nombre: null })
    expect(v({ nombre: 'Solo texto' })).toMatchObject({ formato: 'tarjeta', imagen: null })
    expect(v({ nombre: 'A', imagen: 'https://x.com/a.png' })).toMatchObject({ formato: 'tarjeta', imagen: null }) // la imagen externa se descarta y queda el nombre
    expect(v({ imagen: '../a.png' })).toBeNull()
    expect(v({ descriptor: 'Solo rubro' })).toBeNull()
    expect(v({})).toBeNull()
  })
  it('«tarjeta» exige nombre; «arte» exige una imagen válida y, sin ella, cae a tarjeta si hay nombre', () => {
    expect(v({ formato: 'tarjeta', logo: 'L/logo.png' })).toBeNull()
    expect(v({ formato: 'tarjeta', nombre: 'A', logo: 'L/logo.png', imagen: 'L/a.png' })).toMatchObject({ formato: 'tarjeta', logo: '/medios/L/logo.png' })
    expect(v({ formato: 'arte' })).toBeNull()
    expect(v({ formato: 'arte', imagen: 'x.exe' })).toBeNull()
    expect(v({ formato: 'arte', nombre: 'A', imagen: 'x.exe' })).toMatchObject({ formato: 'tarjeta', nombre: 'A', imagen: null })
    expect(v({ formato: 'arte', imagen: 'L/a.png', imagenGrande: 'L/g.webp' })).toMatchObject({ imagen: '/medios/L/a.png', imagenGrande: '/medios/L/g.webp' })
    expect(v({ formato: 'raro', nombre: 'A' })).toMatchObject({ formato: 'tarjeta' }) // un formato desconocido se ignora y se deduce
  })
  it('colores: solo #RRGGBB (se normalizan a mayúsculas); cualquier otra cosa se descarta campo por campo', () => {
    const ok = v({ nombre: 'A', fondo: '#1c2b3a', texto: '#ffffff', acento: '#F2B33D' })
    expect([ok.fondo, ok.texto, ok.acento]).toEqual(['#1C2B3A', '#FFFFFF', '#F2B33D'])
    for (const malo of ['red', '#fff', '#12345', '#1234567', 'rgb(0,0,0)', 'url(x)', 'javascript:1', '#GGGGGG', 'var(--x)', '#FFFFFF; background:red', 5, null]) {
      const e = v({ nombre: 'A', fondo: malo, texto: malo, acento: malo })
      expect([e.fondo, e.texto, e.acento], String(malo)).toEqual([null, null, null])
    }
  })
  it('los campos desconocidos (HTML, estilos, scripts, enlaces) nunca pasan; el nombre y el rubro son texto con tope', () => {
    const e = v({ nombre: '<b>X</b>', descriptor: 'Rubro', html: '<script>1</script>', style: 'x', css: 'y', enlace: 'https://x.com', onclick: 'z', borde: 'sí' })
    expect(Object.keys(e).sort()).toEqual(['acento', 'borde', 'descriptor', 'disposicion', 'fondo', 'formato', 'id', 'imagen', 'imagenGrande', 'logo', 'nombre', 'texto'])
    expect(e.nombre).toBe('<b>X</b>') // es texto: React lo escribe como texto, jamás como HTML
    expect(e.borde).toBe(false)
    expect(v({ nombre: 'A', borde: true }).borde).toBe(true)
    expect(v({ nombre: 'x'.repeat(61) })).toBeNull()
    expect(v({ nombre: 'A', descriptor: 'x'.repeat(41) }).descriptor).toBeNull()
  })
  it('tintasDe: los colores del diseño v0 pasan SIN cambios; un texto ilegible sobre su fondo se corrige', () => {
    const V0 = [['#1C2B3A', '#FFFFFF', '#F2B33D'], ['#F3E3C3', '#4A2F12', '#B5651D'], ['#0E6BA8', '#FFFFFF', '#BFE6FF'], ['#FFFFFF', '#14171F', '#C8202F'], ['#232323', '#FFD23F', '#FFD23F'], ['#1E7A4C', '#FFFFFF', '#CFF2DD']]
    for (const [fondo, texto, acento] of V0) expect(tintasDe({ fondo, texto, acento }), fondo).toEqual({ fondo, texto, acento })
    expect(tintasDe({ fondo: '#FFFFFF', texto: '#FFFFFE' })).toMatchObject({ texto: '#12151C' }) // blanco sobre blanco → oscuro
    expect(tintasDe({ fondo: '#101010', texto: '#111111' })).toMatchObject({ texto: '#FFFFFF' })
    expect(tintasDe({ fondo: '#FFFFFF', texto: '#12151C', acento: '#FEFEFE' })).toMatchObject({ acento: '#12151C' }) // acento ilegible → color del nombre
    expect(tintasDe({})).toEqual({ fondo: '#FFFFFF', texto: '#12151C', acento: '#12151C' })
    expect(contraste('#000000', '#FFFFFF')).toBeCloseTo(21, 0)
  })
  it('el manifiesto del REPORT_191 (entradas con id, nombre, descriptor, imagen, fondo) produce el mismo contenido visible', () => {
    const m = mediosDeLiga(manifiesto({ patrocinadores: [{ id: 'a', nombre: 'Agua Pura', imagen: 'L1/sp-a.svg' }, { id: 'd', nombre: 'Óptica Visión', descriptor: 'Óptica', imagen: 'L1/falta.png' }, { id: 'c', imagen: 'L1/sp-c.svg' }] }), 'LIGA1')
    expect(m.patrocinadores.map((p) => [p.id, p.formato, p.nombre, p.imagen])).toEqual([['a', 'arte', 'Agua Pura', '/medios/L1/sp-a.svg'], ['d', 'arte', 'Óptica Visión', '/medios/L1/falta.png'], ['c', 'arte', null, '/medios/L1/sp-c.svg']])
  })
})


describe('disposición «logo» (REPORT_194)', () => {
  const v = (o) => patrocinadorValido({ id: 'x', ...o })
  it('solo vale en una tarjeta con logo válido; en cualquier otro caso se ignora y la tarjeta es la de siempre', () => {
    expect(v({ formato: 'tarjeta', nombre: 'La Parmigiana', descriptor: 'Restaurante italiano', logo: 'PARM/parmigiana.jpeg', disposicion: 'logo', fondo: '#000000', texto: '#ffffff', acento: '#ffffff' }))
      .toMatchObject({ formato: 'tarjeta', disposicion: 'logo', logo: '/medios/PARM/parmigiana.jpeg', nombre: 'La Parmigiana', fondo: '#000000', texto: '#FFFFFF' })
    expect(v({ formato: 'tarjeta', nombre: 'A', disposicion: 'logo' }).disposicion).toBeNull() // sin logo
    expect(v({ formato: 'tarjeta', nombre: 'A', logo: 'https://x.com/l.png', disposicion: 'logo' }).disposicion).toBeNull() // logo externo
    expect(v({ formato: 'tarjeta', nombre: 'A', logo: 'L/l.png', disposicion: 'otra' }).disposicion).toBeNull() // valor desconocido
    expect(v({ formato: 'tarjeta', nombre: 'A', logo: 'L/l.png' }).disposicion).toBeNull() // sin pedirla, la tarjeta no cambia
    expect(v({ formato: 'arte', imagen: 'L/a.png', logo: 'L/l.png', disposicion: 'logo' }).disposicion).toBeNull() // el arte terminado no la usa
    expect(v({ formato: 'tarjeta', logo: 'L/l.png', disposicion: 'logo' })).toBeNull() // el nombre sigue siendo obligatorio (texto accesible)
  })
  it('.jpeg es una extensión de imagen permitida', () => {
    expect(urlDeMedio('PARM/parmigiana.jpeg')).toBe('/medios/PARM/parmigiana.jpeg')
  })
})


describe('diapositivasDeBanda (REPORT_196): patrocinadores en orden + una diapositiva dedicada de Semabel en cada ciclo', () => {
  const ORG = { id: 'org' }
  const ESP = { id: 'esp' }
  const ids = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}` }))
  const forma = (n) => diapositivasDeBanda(ids(n), ORG, ESP).map((par) => par.map((t) => t.id))
  it('0 patrocinadores: solo la diapositiva de Semabel', () => { expect(forma(0)).toEqual([['org', 'esp']]) })
  it('1: el patrocinador con la tarjeta del espectador, y la diapositiva dedicada', () => { expect(forma(1)).toEqual([['s1', 'esp'], ['org', 'esp']]) })
  it('2: la pareja y la diapositiva dedicada (sin relleno)', () => { expect(forma(2)).toEqual([['s1', 's2'], ['org', 'esp']]) })
  it('5: tres diapositivas de patrocinadores (la última con la tarjeta del espectador) y la dedicada', () => {
    expect(forma(5)).toEqual([['s1', 's2'], ['s3', 's4'], ['s5', 'esp'], ['org', 'esp']])
  })
  it('6: tres parejas completas y la dedicada, sin relleno', () => {
    expect(forma(6)).toEqual([['s1', 's2'], ['s3', 's4'], ['s5', 's6'], ['org', 'esp']])
  })
  it('para cualquier cantidad: ningún patrocinador se pierde ni se repite, conservan su orden, cada diapositiva tiene dos tarjetas y la dedicada es la última', () => {
    for (let n = 0; n <= 13; n += 1) {
      const d = diapositivasDeBanda(ids(n), ORG, ESP)
      expect(d.every((par) => par.length === 2), `n=${n}`).toBe(true)
      expect(d[d.length - 1]).toEqual([ORG, ESP])
      const propios = d.flat().filter((t) => t.id.startsWith('s')).map((t) => t.id)
      expect(propios).toEqual(ids(n).map((t) => t.id))
      expect(d.length).toBe(Math.ceil(n / 2) + 1)
      const semabel = d.flat().filter((t) => !t.id.startsWith('s')).length
      expect(semabel).toBe(n % 2 === 1 ? 3 : 2) // solo con un número impar la tarjeta del espectador aparece dos veces
    }
  })
})

describe('logo de Semabel en el manifiesto (raíz «semabel.logo»)', () => {
  it('se lee de la raíz y sirve a todas las ligas, también a las que no tienen entrada; una ruta mala se descarta', () => {
    const m = { version: 1, semabel: { logo: 'SMB/semabel-logo.png' }, ligas: { A: { patrocinadores: [{ id: 'x', nombre: 'X' }] } } }
    expect(mediosDeLiga(m, 'A').semabelLogo).toBe('/medios/SMB/semabel-logo.png')
    expect(mediosDeLiga(m, 'OTRA').semabelLogo).toBe('/medios/SMB/semabel-logo.png')
    for (const mala of ['https://x.com/l.png', '../l.png', 'l.exe', '', null, 5]) expect(mediosDeLiga({ version: 1, semabel: { logo: mala }, ligas: {} }, 'A').semabelLogo, String(mala)).toBeNull()
    expect(mediosDeLiga({ version: 1, ligas: {} }, 'A').semabelLogo).toBeNull()
    expect(mediosDeLiga(null, 'A').semabelLogo).toBeNull()
    expect(mediosDeLiga({ version: 1, semabel: 'x', ligas: {} }, 'A').semabelLogo).toBeNull()
  })
})
