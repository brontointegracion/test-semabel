import { describe, expect, it } from 'vitest'
import {
  CATEGORIAS_BALONCESTO, CATEGORIAS_LEGADO, SUBCATEGORIA_TEXTO_MAX, categoriaDeBaloncesto, copiaSubcategoriaParaReto,
  esRivalCompatible, etiquetaCategoria, etiquetaSubcategoria, huellaSubcategoria, normalizarTextoSubcategoria,
  opcionesDeCategoria, presetsDeCategoria, resolverClasificacion, sugerenciaPreset, validarClasificacion,
} from './categorias'
import { cabeceraDePartido, textosDePartido } from './cabecera'
import { crearPreparacion } from './motor/preparacion'
import {
  EQUIPOS_DE_PRUEBA, JUGADORES_NUMERADOS, LIGA_DE_PRUEBA, preparacionDePrueba,
} from './motor/prueba/auxiliares-preparacion'

// ---------------------------------------------------------------------------
// Categoría y subcategoría de una liga: catálogo, validación, compatibilidad de retos.
// Es solo clasificación: ninguna de estas pruebas define edades, elegibilidad ni reglas de marcador.
// ---------------------------------------------------------------------------

describe('catálogo de baloncesto', () => {
  it('tiene las cinco categorías con clave estable y etiquetas es/en', () => {
    expect(CATEGORIAS_BALONCESTO.map((c) => [c.clave, c.es, c.en])).toEqual([
      ['baby', 'Baby baloncesto', 'Baby'],
      ['mini-basketball', 'Mini baloncesto', 'Mini Basketball'],
      ['intermediate', 'Intermedia', 'Intermediate'],
      ['adult', 'Adulto', 'Adult'],
      ['veterans', 'Veteranos', 'Veterans'],
    ])
  })

  it('solo Mini Basketball (u10) e Intermediate (u12) traen presets', () => {
    expect(presetsDeCategoria('mini-basketball')).toEqual([{ clave: 'u10', etiqueta: 'U10' }])
    expect(presetsDeCategoria('intermediate')).toEqual([{ clave: 'u12', etiqueta: 'U12' }])
    for (const c of ['baby', 'adult', 'veterans']) expect(presetsDeCategoria(c)).toEqual([])
    expect(presetsDeCategoria('Libre')).toEqual([])
  })

  it('ninguna clave nueva coincide con un valor de ligas de antes', () => {
    const viejos = CATEGORIAS_LEGADO.map((c) => c.valor)
    for (const c of CATEGORIAS_BALONCESTO) expect(viejos).not.toContain(c.clave)
    expect(new Set(CATEGORIAS_BALONCESTO.map((c) => c.clave)).size).toBe(5)
  })

  it('baloncesto ofrece solo las cinco; los demás deportes conservan la lista de siempre', () => {
    expect(opcionesDeCategoria('baloncesto').map((o) => o.valor)).toEqual(
      ['baby', 'mini-basketball', 'intermediate', 'adult', 'veterans'],
    )
    expect(opcionesDeCategoria('futsal')).toEqual([
      { valor: 'Libre', etiqueta: 'Libre (cualquier edad)' },
      { valor: '35+', etiqueta: 'Veteranos 35+' },
      { valor: '40+', etiqueta: 'Veteranos 40+' },
      { valor: '45+', etiqueta: 'Veteranos 45+' },
      { valor: '50+', etiqueta: 'Veteranos 50+' },
    ])
  })

  it('las etiquetas salen en español por defecto y en inglés si se pide; lo desconocido se muestra tal cual', () => {
    expect(etiquetaCategoria('mini-basketball')).toBe('Mini baloncesto')
    expect(etiquetaCategoria('mini-basketball', 'en')).toBe('Mini Basketball')
    expect(etiquetaCategoria('mini-basketball', 'fr')).toBe('Mini baloncesto')
    for (const v of ['Libre', '35+', '40+', '45+', '50+', 'algo raro']) expect(etiquetaCategoria(v)).toBe(v)
    expect(etiquetaCategoria(undefined)).toBe('')
    expect(categoriaDeBaloncesto('constructor')).toBeNull()
  })
})

describe('texto de subcategoría personalizada', () => {
  const ok = (t) => normalizarTextoSubcategoria(t)

  it('NFC, recorte y espacios colapsados; conserva mayúsculas, acentos y puntuación', () => {
    expect(ok('  Sub   13   Fém.  ')).toEqual({ ok: true, texto: 'Sub 13 Fém.' })
    expect(ok('Café Ñandú')).toEqual({ ok: true, texto: 'Café Ñandú' })
    expect(ok("O'Neil-Sub (A/B)").texto).toBe("O'Neil-Sub (A/B)")
    expect(ok('U10')).toEqual({ ok: true, texto: 'U10' })
  })

  it('rechaza controles, saltos de línea y caracteres invisibles ANTES de normalizar espacios', () => {
    for (const malo of ['Sub\t13', 'Sub\n13', 'Sub\r13', 'Sub\u000B13', 'Sub\u2028 13', 'Sub\u2029 13', 'Sub\u200b13', 'Sub\u0085 13', '\u0000x']) {
      expect(ok(malo).ok, JSON.stringify(malo)).toBe(false)
    }
    // Un salto al final también: recortar espacios no lo esconde.
    expect(ok('Sub 13\n').ok).toBe(false)
  })

  it('1 a 30 puntos de código; cuenta caracteres, no unidades UTF-16', () => {
    expect(ok('a').ok).toBe(true)
    expect(ok('a'.repeat(SUBCATEGORIA_TEXTO_MAX)).ok).toBe(true)
    expect(ok('a'.repeat(SUBCATEGORIA_TEXTO_MAX + 1)).ok).toBe(false)
    const conEmoji = `a${'😀'.repeat(29)}` // 30 puntos de código, 59 unidades UTF-16
    expect(ok(conEmoji).ok).toBe(true)
    expect(ok(`${conEmoji}😀`).ok).toBe(false)
    expect(ok('').ok).toBe(false)
    expect(ok('    ').ok).toBe(false)
  })

  it('exige al menos una letra o un número y rechaza lo que no es texto', () => {
    expect(ok('---').ok).toBe(false)
    expect(ok('(+)').ok).toBe(false)
    expect(ok('+1').ok).toBe(true)
    for (const v of [undefined, null, 10, {}, ['a']]) expect(ok(v).ok).toBe(false)
  })

  it('no produce clave ni slug: textos parecidos siguen siendo distintos', () => {
    expect(ok('Sub 13').texto).not.toBe(ok('Sub-13').texto)
    expect(ok('Sub 13').texto).not.toBe(ok('sub 13').texto)
    expect(Object.keys(ok('Sub 13'))).toEqual(['ok', 'texto'])
  })

  it('una sugerencia de preset nunca convierte el texto', () => {
    expect(sugerenciaPreset('mini-basketball', ' u10 ')).toBe('u10')
    expect(sugerenciaPreset('mini-basketball', 'U12')).toBeNull()
    expect(sugerenciaPreset('baby', 'U10')).toBeNull()
    const r = resolverClasificacion({ deporte: 'baloncesto', categoria: 'mini-basketball', subcategoria: { texto: 'U10' } })
    expect(r.ok).toBe(true)
    expect(r.subcategoria).toEqual({ texto: 'U10' }) // sigue siendo texto: no es el preset
    expect(r.subcategoria).not.toEqual({ clave: 'u10' })
  })
})

describe('resolverClasificacion / validarClasificacion', () => {
  const bal = (categoria, subcategoria) => ({ deporte: 'baloncesto', categoria, subcategoria })

  it('acepta los dos presets confirmados', () => {
    expect(resolverClasificacion(bal('mini-basketball', { clave: 'u10' }))).toEqual({
      ok: true, errores: {}, categoria: 'mini-basketball', subcategoria: { clave: 'u10' },
    })
    expect(resolverClasificacion(bal('intermediate', { clave: 'u12' })).subcategoria).toEqual({ clave: 'u12' })
  })

  it('un preset solo vale en su categoría', () => {
    expect(validarClasificacion(bal('intermediate', { clave: 'u10' })).subcategoria).toBeTruthy()
    expect(validarClasificacion(bal('mini-basketball', { clave: 'u12' })).subcategoria).toBeTruthy()
    expect(validarClasificacion(bal('baby', { clave: 'u10' })).subcategoria).toBeTruthy()
    expect(validarClasificacion(bal('adult', { clave: 'constructor' })).subcategoria).toBeTruthy()
  })

  it('texto personalizado válido bajo las cinco categorías, normalizado y guardado como { texto }', () => {
    for (const c of ['baby', 'mini-basketball', 'intermediate', 'adult', 'veterans']) {
      const r = resolverClasificacion(bal(c, { texto: '  Sub-13  Fém. ' }))
      expect(r.ok, c).toBe(true)
      expect(r.subcategoria).toEqual({ texto: 'Sub-13 Fém.' })
    }
  })

  it('exige una subcategoría explícita en baloncesto', () => {
    for (const c of ['baby', 'mini-basketball', 'intermediate', 'adult', 'veterans']) {
      expect(validarClasificacion(bal(c, undefined)).subcategoria, c).toBeTruthy()
    }
    expect(validarClasificacion(bal('adult', { texto: '' })).subcategoria).toBeTruthy()
    expect(validarClasificacion(bal('adult', null)).subcategoria).toBeTruthy()
  })

  it('nunca clave y texto a la vez, ni propiedades de más', () => {
    expect(validarClasificacion(bal('mini-basketball', { clave: 'u10', texto: 'x' })).subcategoria).toBeTruthy()
    expect(validarClasificacion(bal('mini-basketball', { clave: 'u10', extra: 1 })).subcategoria).toBeTruthy()
    expect(validarClasificacion(bal('mini-basketball', {})).subcategoria).toBeTruthy()
    expect(validarClasificacion(bal('mini-basketball', 'u10')).subcategoria).toBeTruthy()
  })

  it('baloncesto nuevo exige una de las cinco categorías (no acepta valores de antes ni vacíos)', () => {
    for (const c of ['', undefined, 'Libre', '40+', 'MINI-BASKETBALL', 'otra']) {
      expect(validarClasificacion(bal(c, { texto: 'x' })).categoria, String(c)).toBeTruthy()
    }
  })

  it('fútbol sala conserva su lista y no admite subcategoría', () => {
    for (const v of ['Libre', '35+', '40+', '45+', '50+']) {
      const r = resolverClasificacion({ deporte: 'futsal', categoria: v })
      expect(r).toEqual({ ok: true, errores: {}, categoria: v, subcategoria: undefined })
    }
    expect(validarClasificacion({ deporte: 'futsal', categoria: 'Libre', subcategoria: { texto: 'x' } }).subcategoria).toBeTruthy()
    expect(validarClasificacion({ deporte: 'futsal', categoria: 'Libre', subcategoria: null }).subcategoria).toBeTruthy()
    expect(validarClasificacion({ deporte: 'futsal', categoria: 'mini-basketball' }).categoria).toBeTruthy()
    expect(validarClasificacion({ deporte: 'futsal', categoria: '' }).categoria).toBeTruthy()
  })
})

describe('etiquetas de subcategoría', () => {
  it('preset con su etiqueta, texto tal cual, y nada si no se reconoce', () => {
    expect(etiquetaSubcategoria({ clave: 'u10' })).toBe('U10')
    expect(etiquetaSubcategoria({ clave: 'u12' }, 'en')).toBe('U12')
    expect(etiquetaSubcategoria({ texto: 'Sub 13 Fém.' })).toBe('Sub 13 Fém.')
    for (const v of [undefined, null, 'u10', {}, { clave: 'zz' }, { clave: 'u10', texto: 'x' }, { texto: '  ' }, { otra: 1 }]) {
      expect(etiquetaSubcategoria(v)).toBeNull()
    }
  })
})

describe('compatibilidad de retos', () => {
  const L = (deporte, categoria, subcategoria) => ({ id: 'x', deporte, categoria, ...(subcategoria === undefined ? {} : { subcategoria }) })
  const bal = (categoria, subcategoria) => L('baloncesto', categoria, subcategoria)

  it('ligas de antes: igual que siempre (mismo deporte y categoría, sin subcategoría)', () => {
    expect(esRivalCompatible(L('baloncesto', '40+'), L('baloncesto', '40+'))).toBe(true)
    expect(esRivalCompatible(L('futsal', 'Libre'), L('futsal', 'Libre'))).toBe(true)
    expect(esRivalCompatible(L('baloncesto', '40+'), L('baloncesto', '45+'))).toBe(false)
    expect(esRivalCompatible(L('baloncesto', '40+'), L('futsal', '40+'))).toBe(false)
    // Una liga sin categoría guardada se comportaba como igual a otra sin categoría.
    expect(esRivalCompatible({ deporte: 'futsal' }, { deporte: 'futsal' })).toBe(true)
  })

  it('una liga de antes no se empareja con una nueva, aunque se parezcan', () => {
    expect(esRivalCompatible(L('baloncesto', '40+'), bal('veterans', { clave: 'u10' }))).toBe(false)
    expect(esRivalCompatible(bal('veterans', { texto: '40+' }), L('baloncesto', '40+'))).toBe(false)
  })

  it('mismo preset válido, misma categoría y deporte: compatibles', () => {
    expect(esRivalCompatible(bal('mini-basketball', { clave: 'u10' }), bal('mini-basketball', { clave: 'u10' }))).toBe(true)
    expect(esRivalCompatible(bal('intermediate', { clave: 'u12' }), bal('intermediate', { clave: 'u12' }))).toBe(true)
  })

  it('preset distinto o categoría distinta: no', () => {
    expect(esRivalCompatible(bal('mini-basketball', { clave: 'u10' }), bal('intermediate', { clave: 'u12' }))).toBe(false)
    expect(esRivalCompatible(bal('mini-basketball', { clave: 'u10' }), bal('mini-basketball', { clave: 'u12' }))).toBe(false)
  })

  it('un texto personalizado no se empareja con nada, ni siquiera con el mismo texto', () => {
    expect(esRivalCompatible(bal('baby', { texto: 'Sub 7' }), bal('baby', { texto: 'Sub 7' }))).toBe(false)
    expect(esRivalCompatible(bal('mini-basketball', { texto: 'U10' }), bal('mini-basketball', { clave: 'u10' }))).toBe(false)
    expect(esRivalCompatible(bal('mini-basketball', { clave: 'u10' }), bal('mini-basketball', { texto: 'U10' }))).toBe(false)
    expect(esRivalCompatible(bal('mini-basketball', { texto: 'U10' }), bal('mini-basketball', { texto: 'U10' }))).toBe(false)
  })

  it('subcategoría ausente, mal formada o de otra categoría en una liga nueva: no', () => {
    const buena = bal('mini-basketball', { clave: 'u10' })
    for (const mala of [
      bal('mini-basketball'), bal('mini-basketball', null), bal('mini-basketball', {}), bal('mini-basketball', 'u10'),
      bal('mini-basketball', { clave: 'u12' }), bal('mini-basketball', { clave: 'u10', texto: 'x' }), bal('mini-basketball', { clave: 'u10', extra: 1 }),
      bal('mini-basketball', { clave: 'constructor' }),
    ]) {
      expect(esRivalCompatible(buena, mala), JSON.stringify(mala.subcategoria)).toBe(false)
      expect(esRivalCompatible(mala, buena), JSON.stringify(mala.subcategoria)).toBe(false)
      expect(esRivalCompatible(mala, mala)).toBe(false)
    }
  })

  it('una clave nueva en otro deporte, o una liga de antes con subcategoría suelta, no se empareja', () => {
    expect(esRivalCompatible(L('futsal', 'mini-basketball', { clave: 'u10' }), L('futsal', 'mini-basketball', { clave: 'u10' }))).toBe(false)
    expect(esRivalCompatible(L('futsal', 'Libre', { clave: 'u10' }), L('futsal', 'Libre', { clave: 'u10' }))).toBe(false)
    expect(esRivalCompatible(L('futsal', 'Libre', { clave: 'u10' }), L('futsal', 'Libre'))).toBe(false)
  })

  it('entradas que no son ligas', () => {
    expect(esRivalCompatible(null, bal('adult', { texto: 'x' }))).toBe(false)
    expect(esRivalCompatible(undefined, undefined)).toBe(false)
    expect(esRivalCompatible('a', 'a')).toBe(false)
  })

  it('la huella de dependencia es un texto estable y la copia para un reto solo sale de un preset válido', () => {
    expect(huellaSubcategoria(undefined)).toBe('')
    expect(huellaSubcategoria({ clave: 'u10' })).toBe('{"clave":"u10"}')
    expect(huellaSubcategoria({ clave: 'u10' })).toBe(huellaSubcategoria({ clave: 'u10' }))
    expect(huellaSubcategoria({ clave: 'u10' })).not.toBe(huellaSubcategoria({ texto: 'u10' }))
    expect(huellaSubcategoria('x')).toBe('?')

    const liga = bal('mini-basketball', { clave: 'u10' })
    const copia = copiaSubcategoriaParaReto(liga)
    expect(copia).toEqual({ clave: 'u10' })
    expect(copia).not.toBe(liga.subcategoria)
    expect(copiaSubcategoriaParaReto(bal('mini-basketball', { texto: 'U10' }))).toBeUndefined()
    expect(copiaSubcategoriaParaReto(L('baloncesto', '40+'))).toBeUndefined()
    expect(copiaSubcategoriaParaReto(bal('mini-basketball', { clave: 'u12' }))).toBeUndefined()
  })
})

describe('cabecera de partido (texto para WhatsApp y buscadores)', () => {
  const datos = (liga, estado = 'programado') => ({
    partido: { inicio: '2030-02-03T19:30:00.000Z', estado },
    liga,
    cancha: { nombre: 'Gimnasio' },
    local: { nombre: 'A' },
    visita: { nombre: 'B' },
    golesLocal: 2,
    golesVisita: 1,
  })

  it('ligas de antes: el texto es el de siempre', () => {
    expect(textosDePartido(datos({ nombre: 'Liga Z', categoria: '40+' })).descripcion).toMatch(/\. Liga Z, categoría 40\+\.$/)
    expect(textosDePartido(datos({ nombre: 'Liga Z', categoria: '40+' }, 'final')).descripcion).toMatch(/ en Gimnasio\. Liga Z, categoría 40\+\.$/)
    for (const sinCategoria of [{ nombre: 'Liga Z', categoria: 'Libre' }, { nombre: 'Liga Z' }]) {
      expect(textosDePartido(datos(sinCategoria)).descripcion).toMatch(/\. Liga Z\.$/)
    }
    expect(textosDePartido(datos({ nombre: 'Liga Z', categoria: 'algo raro' }, 'final')).descripcion).toMatch(/Liga Z, categoría algo raro\.$/)
    // En vivo no incluía la categoría y sigue sin incluirla.
    expect(textosDePartido(datos({ nombre: 'Liga Z', categoria: '40+' }, 'vivo')).descripcion).toBe('Se está jugando ahora en Gimnasio. Liga Z.')
  })

  it('ligas nuevas: etiqueta de la categoría y subcategoría', () => {
    const preset = { nombre: 'Liga Z', categoria: 'mini-basketball', subcategoria: { clave: 'u10' } }
    expect(textosDePartido(datos(preset)).descripcion).toMatch(/\. Liga Z, categoría Mini baloncesto, subcategoría U10\.$/)
    const texto = { nombre: 'Liga Z', categoria: 'veterans', subcategoria: { texto: 'Sub 40 Fém.' } }
    expect(textosDePartido(datos(texto, 'final')).descripcion).toMatch(/Liga Z, categoría Veteranos, subcategoría Sub 40 Fém\.\.$/)
  })

  it('las etiquetas completas se siguen escapando y no cambian para una liga de antes', () => {
    const antes = cabeceraDePartido({ ...datos({ nombre: 'Liga Z', categoria: '40+' }), url: 'https://sebel.test/p/x-1' })
    expect(antes).toContain('<meta name="description" content="Juegan el ')
    expect(antes).toContain('Liga Z, categoría 40+.">')
    const raro = cabeceraDePartido({ ...datos({ nombre: 'Liga Z', categoria: 'mini-basketball', subcategoria: { texto: '<b>"x"</b>' } }), url: 'https://sebel.test/p/x-1' })
    expect(raro).toContain('subcategoría &lt;b&gt;&quot;x&quot;&lt;/b&gt;.')
    expect(raro).not.toContain('<b>')
  })
})

describe('la clasificación no cambia la versión de preparación', () => {
  const base = () => preparacionDePrueba('P')

  it('añadir categoría, subcategoría y deporte a la fila de la liga deja la misma versión', () => {
    const conClasificacion = preparacionDePrueba('P', {
      liga: { ...LIGA_DE_PRUEBA, deporte: 'baloncesto', categoria: 'mini-basketball', subcategoria: { clave: 'u10' } },
    })
    const conTexto = preparacionDePrueba('P', {
      liga: { ...LIGA_DE_PRUEBA, categoria: 'veterans', subcategoria: { texto: 'Sub 40 Fém.' } },
    })
    const legada = preparacionDePrueba('P', { liga: { ...LIGA_DE_PRUEBA, categoria: '40+' } })
    expect(conClasificacion.version).toBe(base().version)
    expect(conTexto.version).toBe(base().version)
    expect(legada.version).toBe(base().version)
    expect(conClasificacion).toEqual(base())
    expect(conClasificacion.liga).toEqual({ id: 'L1' })
  })

  it('la versión de la preparación de prueba sigue siendo la fijada antes de este cambio', () => {
    expect(base().version).toBe(VERSION_FIJADA)
  })

  it('un cambio real de plantilla sí cambia la versión (la prueba no es vacía)', () => {
    const cambiada = crearPreparacion({
      gameId: 'P',
      partido: { ligaId: 'L1', localId: 'E1', visitaId: 'E2' },
      liga: { ...LIGA_DE_PRUEBA },
      equipos: EQUIPOS_DE_PRUEBA.map((e) => ({ ...e })),
      jugadores: JUGADORES_NUMERADOS.map((j) => (j.id === 'J2' ? { ...j, dorsal: 8 } : { ...j })),
      consultaEquipos: ['E1', 'E2'],
    })
    expect(cambiada.version).not.toBe(base().version)
  })
})

// Versión de preparacionDePrueba('P') medida con el módulo de preparación SIN modificar (nada bajo
// src/lib/motor/ cambió en esta tarea). Si cambia, algo tocó las entradas de la versión.
const VERSION_FIJADA = '4caaa1ce87bb7423'
