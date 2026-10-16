/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Crear una liga: categoría y subcategoría.
//
// Recorre la pantalla real (NuevaLiga) hasta publicar, sobre una base IndexedDB falsa en memoria
// (fake-indexeddb): no toca ningún dato del navegador ni de un cliente. Solo se comprueba la
// clasificación y que el resto de la fila de la liga no cambia; no se define ninguna edad ni regla.
// ---------------------------------------------------------------------------

const NOMBRE_BD = 'sebel'

function borrarBd() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(NOMBRE_BD)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

async function cargar() {
  const dbMod = await import('../db.js')
  const pantalla = await import('./NuevaLiga.jsx')
  await dbMod.db.ligas.toArray()
  await dbMod.db.canchas.add({
    id: 'c1', nombre: 'Gimnasio de Prueba', barrio: 'Centro', ciudad: 'David', provincia: 'Chiriquí', pais: 'PA',
  })
  await dbMod.db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'yo' })
  return { db: dbMod.db, NuevaLiga: pantalla.default }
}

beforeEach(async () => {
  await borrarBd()
  vi.resetModules()
})

afterEach(async () => {
  cleanup()
  await borrarBd()
})

function montar(NuevaLiga) {
  render(
    <MemoryRouter initialEntries={['/nueva']}>
      <Routes>
        <Route path="/nueva" element={<NuevaLiga />} />
        <Route path="*" element={<div>Liga publicada</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const elegir = (user, etiqueta, valor) => user.selectOptions(screen.getByLabelText(etiqueta), valor)

/** Rellena todo lo que no es clasificación: nombre, seis equipos y una cancha. */
async function completarBase(user, nombre = 'Liga de Prueba') {
  await user.type(screen.getByLabelText('Nombre de la liga'), nombre)
  for (let i = 1; i <= 6; i += 1) {
    await user.type(screen.getByLabelText(`Nombre del equipo ${i}`), `Equipo ${i}`)
  }
  await user.click(await screen.findByRole('button', { name: 'Gimnasio de Prueba' }))
}

const botonGenerar = () => screen.getByRole('button', { name: 'Generar calendario' })

async function publicar(user) {
  await user.click(botonGenerar())
  await user.click(await screen.findByRole('button', { name: 'Publicar liga' }))
  await screen.findByText('Liga publicada')
}

const CLAVES_DE_LA_FILA = [
  'aceptaRetos', 'canchaIds', 'categoria', 'codigo', 'deporte', 'desde', 'diasSemana', 'estado', 'franjas', 'hasta', 'id',
  'minutosPorPeriodo', 'nombre', 'organizador', 'organizadorId', 'pagada', 'pais', 'provincia',
]

describe('NuevaLiga — categorías de baloncesto', () => {
  it('baloncesto ofrece solo las cinco categorías (más el aviso de elegir), sin las de antes', async () => {
    const { NuevaLiga } = await cargar()
    montar(NuevaLiga)
    const cat = screen.getByLabelText('Categoría')
    expect(within(cat).getAllByRole('option').map((o) => [o.value, o.textContent])).toEqual([
      ['', 'Elige una categoría'],
      ['baby', 'Baby baloncesto'],
      ['mini-basketball', 'Mini baloncesto'],
      ['intermediate', 'Intermedia'],
      ['adult', 'Adulto'],
      ['veterans', 'Veteranos'],
    ])
    expect(cat.value).toBe('')
    expect(screen.queryByLabelText('Subcategoría')).toBeNull()
  })

  it('Mini baloncesto + U10 (preset): se guarda la clave estable y { clave }, y el resto de la fila no cambia', async () => {
    const { db, NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await completarBase(user)
    expect(botonGenerar().disabled).toBe(true)

    await elegir(user, 'Categoría', 'mini-basketball')
    expect(botonGenerar().disabled).toBe(true) // falta la subcategoría
    const sub = screen.getByLabelText('Subcategoría')
    expect(within(sub).getAllByRole('option').map((o) => [o.value, o.textContent])).toEqual([
      ['', 'Elige una subcategoría'],
      ['u10', 'U10'],
      ['__personalizada', 'Otra (la escribo yo)'],
    ])
    await elegir(user, 'Subcategoría', 'u10')
    expect(botonGenerar().disabled).toBe(false)
    await publicar(user)

    const filas = await db.ligas.toArray()
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({
      deporte: 'baloncesto', categoria: 'mini-basketball', subcategoria: { clave: 'u10' }, minutosPorPeriodo: 10,
      aceptaRetos: true, estado: 'publicada', organizadorId: 'yo', nombre: 'Liga de Prueba',
    })
    expect(Object.keys(filas[0]).sort()).toEqual([...CLAVES_DE_LA_FILA, 'subcategoria'].sort())
    expect(await db.equipos.count()).toBe(6)
  })

  it('Intermedia + U12 (preset)', async () => {
    const { db, NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await completarBase(user)
    await elegir(user, 'Categoría', 'intermediate')
    expect(within(screen.getByLabelText('Subcategoría')).getAllByRole('option').map((o) => o.value)).toEqual(['', 'u12', '__personalizada'])
    await elegir(user, 'Subcategoría', 'u12')
    await publicar(user)
    const [liga] = await db.ligas.toArray()
    expect(liga).toMatchObject({ categoria: 'intermediate', subcategoria: { clave: 'u12' }, minutosPorPeriodo: 10 })
  })

  it.each([
    ['baby', 'Baby baloncesto'],
    ['mini-basketball', 'Mini baloncesto'],
    ['intermediate', 'Intermedia'],
    ['adult', 'Adulto'],
    ['veterans', 'Veteranos'],
  ])('texto personalizado bajo %s: obligatorio, normalizado y guardado como { texto }', async (clave) => {
    const { db, NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await completarBase(user)
    await elegir(user, 'Categoría', clave)
    await elegir(user, 'Subcategoría', '__personalizada')
    expect(botonGenerar().disabled).toBe(true) // texto vacío
    await user.type(screen.getByLabelText('Texto de la subcategoría'), '  Sub-13   Fém. ')
    expect(botonGenerar().disabled).toBe(false)
    await publicar(user)
    const [liga] = await db.ligas.toArray()
    expect(liga.categoria).toBe(clave)
    expect(liga.subcategoria).toEqual({ texto: 'Sub-13 Fém.' })
    expect(Object.keys(liga.subcategoria)).toEqual(['texto']) // nunca clave y texto a la vez
    expect(liga.minutosPorPeriodo).toBe(10)
  })

  it('un texto "U10" escrito a mano se queda como texto: no se convierte en el preset', async () => {
    const { db, NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await completarBase(user)
    await elegir(user, 'Categoría', 'mini-basketball')
    await elegir(user, 'Subcategoría', '__personalizada')
    await user.type(screen.getByLabelText('Texto de la subcategoría'), 'U10')
    expect(await screen.findByText(/¿Quisiste decir U10\?/)).toBeTruthy() // solo una sugerencia
    await publicar(user)
    const [liga] = await db.ligas.toArray()
    expect(liga.subcategoria).toEqual({ texto: 'U10' })
  })

  it('rechaza controles, saltos de línea y textos largos o vacíos: el botón no se habilita', async () => {
    const { NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await completarBase(user)
    await elegir(user, 'Categoría', 'veterans')
    await elegir(user, 'Subcategoría', '__personalizada')
    const caja = screen.getByLabelText('Texto de la subcategoría')
    // Un <input> de texto elimina los saltos de línea (\n, \r) al asignarlos: eso no llega a la lógica y los
    // cubre categorias.test.js sobre el texto crudo. Aquí van los que sí pueden llegar hasta la pantalla.
    for (const malo of ['Sub\t13', 'Sub\u2028 13', 'Sub\u200b13', '---', 'a'.repeat(31)]) {
      fireEvent.change(caja, { target: { value: malo } })
      expect(botonGenerar().disabled, JSON.stringify(malo)).toBe(true)
      expect(screen.getByText(/La subcategoría|Entre 1 y 30/, { selector: '.campo-error' })).toBeTruthy()
    }
    fireEvent.change(caja, { target: { value: 'a'.repeat(30) } })
    expect(botonGenerar().disabled).toBe(false)
  })
})

describe('NuevaLiga — cambios de deporte y de categoría', () => {
  it('cambiar de categoría borra la subcategoría y el texto elegidos', async () => {
    const { NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await completarBase(user)

    await elegir(user, 'Categoría', 'mini-basketball')
    await elegir(user, 'Subcategoría', 'u10')
    expect(botonGenerar().disabled).toBe(false)
    await elegir(user, 'Categoría', 'intermediate')
    expect(screen.getByLabelText('Subcategoría').value).toBe('') // U10 no se queda puesto en Intermedia
    expect(botonGenerar().disabled).toBe(true)

    await elegir(user, 'Subcategoría', '__personalizada')
    await user.type(screen.getByLabelText('Texto de la subcategoría'), 'Sub 12 Fém.')
    expect(botonGenerar().disabled).toBe(false)
    await elegir(user, 'Categoría', 'adult')
    expect(screen.getByLabelText('Subcategoría').value).toBe('')
    expect(screen.queryByLabelText('Texto de la subcategoría')).toBeNull()
    expect(botonGenerar().disabled).toBe(true)
    // Al volver a la personalizada, el texto anterior no reaparece.
    await elegir(user, 'Subcategoría', '__personalizada')
    expect(screen.getByLabelText('Texto de la subcategoría').value).toBe('')
  })

  it('fútbol sala conserva su lista, no pide subcategoría y no guarda esa propiedad', async () => {
    const { db, NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await completarBase(user)
    // Se deja puesta una clasificación de baloncesto y luego se cambia de deporte.
    await elegir(user, 'Categoría', 'mini-basketball')
    await elegir(user, 'Subcategoría', 'u10')
    await elegir(user, 'Deporte', 'futsal')

    const cat = screen.getByLabelText('Categoría')
    expect(cat.value).toBe('Libre')
    expect(within(cat).getAllByRole('option').map((o) => [o.value, o.textContent])).toEqual([
      ['Libre', 'Libre (cualquier edad)'],
      ['35+', 'Veteranos 35+'],
      ['40+', 'Veteranos 40+'],
      ['45+', 'Veteranos 45+'],
      ['50+', 'Veteranos 50+'],
    ])
    expect(screen.queryByLabelText('Subcategoría')).toBeNull()
    expect(botonGenerar().disabled).toBe(false)
    await elegir(user, 'Categoría', '40+')
    await publicar(user)

    const [liga] = await db.ligas.toArray()
    expect(liga).toMatchObject({ deporte: 'futsal', categoria: '40+', minutosPorPeriodo: 20 })
    expect('subcategoria' in liga).toBe(false)
    expect(Object.keys(liga).sort()).toEqual(CLAVES_DE_LA_FILA)
  })

  it('volver a baloncesto exige elegir de nuevo categoría y subcategoría', async () => {
    const { NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await completarBase(user)
    await elegir(user, 'Categoría', 'intermediate')
    await elegir(user, 'Subcategoría', 'u12')
    await elegir(user, 'Deporte', 'futsal')
    await elegir(user, 'Deporte', 'baloncesto')
    expect(screen.getByLabelText('Categoría').value).toBe('')
    expect(screen.queryByLabelText('Subcategoría')).toBeNull()
    expect(botonGenerar().disabled).toBe(true)
    await elegir(user, 'Categoría', 'intermediate')
    expect(screen.getByLabelText('Subcategoría').value).toBe('') // el U12 anterior no volvió
    expect(botonGenerar().disabled).toBe(true)
  })
})

describe('NuevaLiga — retos', () => {
  const casilla = () => screen.getByRole('checkbox', { name: /Aceptar retos de otras ligas/ })
  const sinRetos = () => {
    expect(casilla().checked).toBe(false)
    expect(casilla().disabled).toBe(true)
  }
  const conRetos = (marcada = true) => {
    expect(casilla().disabled).toBe(false)
    expect(casilla().checked).toBe(marcada)
  }
  const TEXTO_NO_DISPONIBLE = /Retos no disponibles/

  it('con un preset la ayuda usa la etiqueta de la categoría y explica la regla de subcategorías', async () => {
    const { NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await elegir(user, 'Categoría', 'mini-basketball')
    await elegir(user, 'Subcategoría', 'u10')
    const ayuda = screen.getByText(/Otras ligas de categoría Mini baloncesto/)
    expect(ayuda.textContent).toContain('solo se emparejan ligas con la misma subcategoría predefinida')
    expect(screen.queryByText(TEXTO_NO_DISPONIBLE)).toBeNull()
    conRetos(true)
  })

  it('sin subcategoría resuelta (nada elegido, solo categoría, o texto vacío) los retos no están disponibles', async () => {
    const { NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    sinRetos() // baloncesto sin categoría
    expect(screen.getByText(TEXTO_NO_DISPONIBLE)).toBeTruthy()

    await elegir(user, 'Categoría', 'intermediate')
    sinRetos() // categoría sin subcategoría
    await elegir(user, 'Subcategoría', '__personalizada')
    sinRetos() // personalizada todavía vacía
    expect(screen.getByText(TEXTO_NO_DISPONIBLE).textContent).toContain('no participan en retos por ahora')
  })

  it('preset → personalizada → preset: se desactiva y se limpia mientras es texto, y se recupera la elección del organizador', async () => {
    const { NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await elegir(user, 'Categoría', 'mini-basketball')
    await elegir(user, 'Subcategoría', 'u10')
    conRetos(true)

    await elegir(user, 'Subcategoría', '__personalizada')
    await user.type(screen.getByLabelText('Texto de la subcategoría'), 'Sub 9')
    sinRetos()
    expect(screen.getByText(TEXTO_NO_DISPONIBLE)).toBeTruthy()

    await elegir(user, 'Subcategoría', 'u10')
    conRetos(true) // la elección anterior (aceptar) vuelve
    expect(screen.queryByText(TEXTO_NO_DISPONIBLE)).toBeNull()

    // Si el organizador la había desmarcado con el preset, sigue desmarcada al volver.
    await user.click(casilla())
    conRetos(false)
    await elegir(user, 'Subcategoría', '__personalizada')
    sinRetos()
    await elegir(user, 'Subcategoría', 'u10')
    conRetos(false)
  })

  it('personalizada → preset: la casilla se habilita con la elección por defecto (marcada)', async () => {
    const { NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await elegir(user, 'Categoría', 'intermediate')
    await elegir(user, 'Subcategoría', '__personalizada')
    await user.type(screen.getByLabelText('Texto de la subcategoría'), 'Sub 11')
    sinRetos()
    await elegir(user, 'Subcategoría', 'u12')
    conRetos(true)
  })

  it('cambiar de categoría deja la subcategoría sin resolver y los retos otra vez no disponibles', async () => {
    const { NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await elegir(user, 'Categoría', 'mini-basketball')
    await elegir(user, 'Subcategoría', 'u10')
    conRetos(true)
    await elegir(user, 'Categoría', 'intermediate')
    sinRetos()
  })

  it('se guarda aceptaRetos: false con texto personalizado, aunque la casilla estuviera marcada antes', async () => {
    const { db, NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await completarBase(user)
    await elegir(user, 'Categoría', 'mini-basketball')
    await elegir(user, 'Subcategoría', 'u10')
    conRetos(true) // marcada con el preset...
    await elegir(user, 'Subcategoría', '__personalizada')
    await user.type(screen.getByLabelText('Texto de la subcategoría'), 'Sub 9')
    sinRetos() // ...y ya no
    await publicar(user)
    const [liga] = await db.ligas.toArray()
    expect(liga).toMatchObject({ categoria: 'mini-basketball', subcategoria: { texto: 'Sub 9' }, aceptaRetos: false })
  })

  it('con un preset se guarda la elección del organizador: marcada → true, desmarcada → false', async () => {
    const { db, NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await completarBase(user)
    await elegir(user, 'Categoría', 'intermediate')
    await elegir(user, 'Subcategoría', 'u12')
    await publicar(user)
    expect((await db.ligas.toArray())[0]).toMatchObject({ subcategoria: { clave: 'u12' }, aceptaRetos: true })
    cleanup()

    montar(NuevaLiga)
    await completarBase(user, 'Otra Liga')
    await elegir(user, 'Categoría', 'mini-basketball')
    await elegir(user, 'Subcategoría', 'u10')
    await user.click(casilla())
    conRetos(false)
    await publicar(user)
    const guardada = (await db.ligas.toArray()).find((l) => l.nombre === 'Otra Liga')
    expect(guardada).toMatchObject({ subcategoria: { clave: 'u10' }, aceptaRetos: false })
  })

  it('fútbol sala no cambia: casilla habilitada y marcada, y se guarda la elección', async () => {
    const { db, NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await completarBase(user)
    // Se parte de una subcategoría escrita a mano (retos no disponibles) y se cambia de deporte.
    await elegir(user, 'Categoría', 'veterans')
    await elegir(user, 'Subcategoría', '__personalizada')
    await user.type(screen.getByLabelText('Texto de la subcategoría'), 'Sub 40')
    sinRetos()
    await elegir(user, 'Deporte', 'futsal')
    conRetos(true)
    expect(screen.queryByText(TEXTO_NO_DISPONIBLE)).toBeNull()
    expect(screen.getByText(/Otras ligas de la misma categoría/)).toBeTruthy()
    // Con una categoría de antes el emparejamiento por categoría sigue igual.
    await elegir(user, 'Categoría', '40+')
    conRetos(true)
    await user.click(casilla())
    conRetos(false)
    await user.click(casilla())
    conRetos(true)
    await publicar(user)
    const [liga] = await db.ligas.toArray()
    expect(liga).toMatchObject({ deporte: 'futsal', categoria: '40+', aceptaRetos: true })
    expect('subcategoria' in liga).toBe(false)
  })

  it('fútbol sala desmarcado se guarda como false', async () => {
    const { db, NuevaLiga } = await cargar()
    const user = userEvent.setup()
    montar(NuevaLiga)
    await completarBase(user)
    await elegir(user, 'Deporte', 'futsal')
    await user.click(casilla())
    conRetos(false)
    await publicar(user)
    expect((await db.ligas.toArray())[0]).toMatchObject({ deporte: 'futsal', categoria: 'Libre', aceptaRetos: false })
  })
})

// ---------------------------------------------------------------------------
// Pantallas públicas y retos con ligas de antes y ligas nuevas (datos sintéticos, base falsa en memoria).
// ---------------------------------------------------------------------------

async function cargarPantallas() {
  const base = await cargar()
  const [Liga, Categoria, Retar, Reto, Inicio] = await Promise.all([
    import('./Liga.jsx'), import('./Categoria.jsx'), import('./Retar.jsx'), import('./Reto.jsx'), import('./Inicio.jsx'),
  ])
  return {
    ...base, Liga: Liga.default, Categoria: Categoria.default, Retar: Retar.default, Reto: Reto.default, Inicio: Inicio.default,
  }
}

const ligaBase = (id, extra) => ({
  id, codigo: `10${id.slice(-2)}`, nombre: `Liga ${id}`, deporte: 'baloncesto', categoria: 'Libre', canchaIds: ['c1'],
  aceptaRetos: true, estado: 'publicada', organizadorId: 'yo', organizador: 'Organizador de Prueba',
  pais: 'PA', provincia: 'Chiriquí', desde: '2030-01-01T00:00:00.000Z', hasta: '2030-03-01T00:00:00.000Z', ...extra,
})

function montarRuta(ruta, patron, Pantalla) {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path={patron} element={<Pantalla />} />
        <Route path="*" element={<div>Otra pantalla</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Pantallas públicas — etiquetas y compatibilidad con ligas de antes', () => {
  it('la página de la liga muestra la etiqueta de la categoría y la subcategoría; las de antes se ven como siempre', async () => {
    const { db, Liga } = await cargarPantallas()
    await db.ligas.bulkAdd([
      ligaBase('l01', { categoria: '40+' }),
      ligaBase('l02', { categoria: 'Libre' }),
      ligaBase('l03', { categoria: 'mini-basketball', subcategoria: { clave: 'u10' } }),
      ligaBase('l04', { categoria: 'veterans', subcategoria: { texto: 'Sub 40 Fém.' } }),
    ])

    montarRuta('/l/liga-1001', '/l/:slug', Liga)
    expect(await screen.findByText('Categoría 40+')).toBeTruthy()
    expect(document.querySelectorAll('.pill.acento')).toHaveLength(1) // sin pastilla de subcategoría
    cleanup()

    montarRuta('/l/liga-1002', '/l/:slug', Liga)
    await screen.findByRole('heading', { name: 'Liga l02' })
    expect(document.querySelectorAll('.pill.acento')).toHaveLength(0) // Libre no muestra categoría
    cleanup()

    montarRuta('/l/liga-1003', '/l/:slug', Liga)
    expect(await screen.findByText('Categoría Mini baloncesto')).toBeTruthy()
    expect(screen.getByText('U10')).toBeTruthy()
    cleanup()

    montarRuta('/l/liga-1004', '/l/:slug', Liga)
    expect(await screen.findByText('Categoría Veteranos')).toBeTruthy()
    expect(screen.getByText('Sub 40 Fém.')).toBeTruthy()
  })

  it('el centro de categoría sigue siendo amplio y la dirección de una categoría de antes no cambia', async () => {
    const { db, Categoria } = await cargarPantallas()
    await db.ligas.bulkAdd([
      ligaBase('l01', { categoria: '40+' }),
      ligaBase('l03', { categoria: 'mini-basketball', subcategoria: { clave: 'u10' } }),
      ligaBase('l05', { categoria: 'mini-basketball', subcategoria: { texto: 'Sub 9' } }),
      ligaBase('l06', { categoria: 'intermediate', subcategoria: { clave: 'u12' } }),
    ])

    // La dirección de siempre: el "+" viaja codificado y se sigue resolviendo.
    montarRuta('/cat/baloncesto/40%2B', '/cat/:deporte/:categoria', Categoria)
    expect(await screen.findByRole('heading', { name: 'Baloncesto 40+' })).toBeTruthy()
    expect(screen.getByText('Liga l01 →')).toBeTruthy()
    cleanup()

    // Una categoría nueva usa su clave en la dirección y muestra su etiqueta; ve todas las subcategorías.
    montarRuta('/cat/baloncesto/mini-basketball', '/cat/:deporte/:categoria', Categoria)
    expect(await screen.findByRole('heading', { name: 'Baloncesto Mini baloncesto' })).toBeTruthy()
    expect(screen.getByText('Liga l03 →')).toBeTruthy()
    expect(screen.getByText('Liga l05 →')).toBeTruthy()
    expect(screen.queryByText('Liga l06 →')).toBeNull() // otra categoría
  })
})

describe('Inicio — filtros por categoría', () => {
  it('las fichas de categoría muestran la etiqueta y filtran por el valor guardado; las de antes no cambian', async () => {
    const { db, Inicio } = await cargarPantallas()
    await db.meta.put({ id: 'region', pais: 'PA', provincia: 'todas', deporte: 'todos', categoria: 'todas' })
    await db.ligas.bulkAdd([
      ligaBase('l50', { categoria: '40+' }),
      ligaBase('l51', { categoria: 'mini-basketball', subcategoria: { clave: 'u10' } }),
      ligaBase('l52', { categoria: 'Libre' }),
    ])
    const user = userEvent.setup()
    montarRuta('/', '/', Inicio)

    const fichaVieja = await screen.findByRole('button', { name: '40+' })
    const fichaNueva = screen.getByRole('button', { name: 'Mini baloncesto' })
    expect(screen.queryByRole('button', { name: 'mini-basketball' })).toBeNull() // la clave no se muestra
    expect(screen.queryByRole('button', { name: 'Libre' })).toBeNull()

    await user.click(fichaNueva)
    expect((await db.meta.get('region')).categoria).toBe('mini-basketball') // filtra y recuerda la clave estable
    await user.click(fichaVieja)
    expect((await db.meta.get('region')).categoria).toBe('40+')
  })
})

describe('Retos — solo entre ligas compatibles', () => {
  async function abrirRetar(db, Retar, ligaId) {
    const liga = await db.ligas.get(ligaId)
    montarRuta(`/l/x-${liga.codigo}/retar`, '/l/:slug/retar', Retar)
  }

  it('entre presets iguales: solo aparece la liga con el mismo preset y el reto guarda una copia de la subcategoría', async () => {
    const { db, Retar } = await cargarPantallas()
    await db.ligas.bulkAdd([
      ligaBase('l10', { categoria: 'mini-basketball', subcategoria: { clave: 'u10' }, provincia: 'Chiriquí' }),
      ligaBase('l11', { categoria: 'mini-basketball', subcategoria: { clave: 'u10' }, provincia: 'Bocas' }),
      ligaBase('l12', { categoria: 'mini-basketball', subcategoria: { texto: 'U10' } }),
      ligaBase('l13', { categoria: 'mini-basketball', subcategoria: { clave: 'u12' } }),
      ligaBase('l14', { categoria: 'intermediate', subcategoria: { clave: 'u12' } }),
      ligaBase('l15', { categoria: 'mini-basketball' }),
      ligaBase('l16', { categoria: '40+' }),
    ])
    const user = userEvent.setup()
    await abrirRetar(db, Retar, 'l10')

    expect(await screen.findByRole('button', { name: /Liga l11/ })).toBeTruthy()
    for (const fuera of ['l12', 'l13', 'l14', 'l15', 'l16']) expect(screen.queryByRole('button', { name: new RegExp(`Liga ${fuera}`) })).toBeNull()
    expect(screen.getByText(/subcategorías escritas a mano no participan en retos por ahora/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Liga l11/ }))
    await user.click(screen.getByRole('button', { name: 'Enviar reto a Liga l11' }))
    await screen.findByText('Otra pantalla')

    const retos = await db.retos.toArray()
    expect(retos).toHaveLength(1)
    expect(retos[0]).toMatchObject({
      deporte: 'baloncesto', categoria: 'mini-basketball', subcategoria: { clave: 'u10' }, ligaAId: 'l10', ligaBId: 'l11',
      nombre: 'Reto Chiriquí – Bocas Mini baloncesto U10',
    })
    // La copia es independiente de la liga: cambiar la liga después no cambia el reto.
    await db.ligas.update('l10', { subcategoria: { clave: 'u12' } })
    expect((await db.retos.toArray())[0].subcategoria).toEqual({ clave: 'u10' })
  })

  it('una liga con subcategoría personalizada no encuentra rival, ni siquiera con el mismo texto', async () => {
    const { db, Retar } = await cargarPantallas()
    await db.ligas.bulkAdd([
      ligaBase('l20', { categoria: 'baby', subcategoria: { texto: 'Sub 7' } }),
      ligaBase('l21', { categoria: 'baby', subcategoria: { texto: 'Sub 7' } }),
    ])
    await abrirRetar(db, Retar, 'l20')
    expect(await screen.findByText(/Todavía no hay otra liga compatible/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Liga l21/ })).toBeNull()
  })

  it('ligas de antes: el emparejamiento por categoría sigue igual y el reto no lleva subcategoría', async () => {
    const { db, Retar } = await cargarPantallas()
    await db.ligas.bulkAdd([
      ligaBase('l30', { categoria: '40+', provincia: 'Chiriquí' }),
      ligaBase('l31', { categoria: '40+', provincia: 'Antioquia', pais: 'CO' }),
      ligaBase('l32', { categoria: '45+' }),
    ])
    const user = userEvent.setup()
    await abrirRetar(db, Retar, 'l30')
    await user.click(await screen.findByRole('button', { name: /Liga l31/ }))
    expect(screen.queryByRole('button', { name: /Liga l32/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Enviar reto a Liga l31' }))
    await screen.findByText('Otra pantalla')
    const [reto] = await db.retos.toArray()
    expect(reto.nombre).toBe('Reto Chiriquí – Antioquia 40+')
    expect(reto.categoria).toBe('40+')
    expect('subcategoria' in reto).toBe(false)
  })

  it('la página del reto muestra la etiqueta y la copia de la subcategoría; un reto de antes se ve igual', async () => {
    const { db, Reto } = await cargarPantallas()
    await db.ligas.bulkAdd([
      ligaBase('l40', { categoria: 'mini-basketball', subcategoria: { clave: 'u10' } }),
      ligaBase('l41', { categoria: 'mini-basketball', subcategoria: { clave: 'u10' } }),
      ligaBase('l42', { categoria: '40+' }),
      ligaBase('l43', { categoria: '40+' }),
    ])
    const ventana = { desde: '2030-01-01T00:00:00.000Z', hasta: '2030-01-08T00:00:00.000Z', estado: 'abierto', deporte: 'baloncesto' }
    await db.retos.bulkAdd([
      { id: 'r1', codigo: '6001', nombre: 'Reto nuevo', categoria: 'mini-basketball', subcategoria: { clave: 'u10' }, ligaAId: 'l40', ligaBId: 'l41', ...ventana },
      { id: 'r2', codigo: '6002', nombre: 'Reto viejo', categoria: '40+', ligaAId: 'l42', ligaBId: 'l43', ...ventana },
    ])

    montarRuta('/r/reto-nuevo-6001', '/r/:slug', Reto)
    expect(await screen.findByText('Mini baloncesto', { selector: '.pill.acento' })).toBeTruthy()
    expect(screen.getByText('U10', { selector: '.pill.acento' })).toBeTruthy()
    cleanup()

    montarRuta('/r/reto-viejo-6002', '/r/:slug', Reto)
    expect(await screen.findByText('40+', { selector: '.pill.acento' })).toBeTruthy()
    expect(document.querySelectorAll('.pill.acento')).toHaveLength(1)
  })
})
