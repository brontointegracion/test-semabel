/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Consola del árbitro — shell de interacción (panel global Puntos/Estadísticas/
// Defensa). Las estadísticas avanzadas y los dos relojes (posesión y cruce de
// medio campo) son PROTOTIPOS: estas pruebas verifican que NO guardan nada y
// no las tratan como funcionalidad terminada. jsdom no tiene layout: tamaños
// táctiles, scroll y scroll horizontal se validan a mano en Android.
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
  const consolaMod = await import('./Consola.jsx')
  await dbMod.db.jugadores.toArray()
  return { db: dbMod.db, Consola: consolaMod.default }
}

beforeEach(async () => {
  await borrarBd()
  navigator.vibrate = vi.fn()
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await borrarBd()
})

const jug = (id, equipoId, dorsal, nombre, extra = {}) => ({
  id, ligaId: 'liga1', equipoId, dorsal, nombre, codigo: `9${dorsal}${equipoId.length}`, personaId: `p-${id}`, ...extra,
})

async function sembrar(db, { deporte = 'baloncesto', restante = 600000 } = {}) {
  await db.cuenta.put({ id: 'yo', saldo: 5 })
  await db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'yo' })
  await db.canchas.add({ id: 'c1', nombre: 'Cancha', pais: 'EC', provincia: 'X', codigo: '111' })
  await db.ligas.add({
    id: 'liga1', codigo: '4821', nombre: 'Liga', deporte, organizadorId: 'yo', canchaIds: ['c1'],
  })
  await db.equipos.bulkAdd([
    { id: 'eL', ligaId: 'liga1', codigo: '1111', nombre: 'Halcones', corto: 'HAL', color: '#c00' },
    { id: 'eV', ligaId: 'liga1', codigo: '2222', nombre: 'Titanes', corto: 'TIT', color: '#06c' },
  ])
  await db.jugadores.bulkAdd([
    jug('l1', 'eL', 4, 'Ana Activa'),
    jug('l2', 'eL', 7, 'Beto Sinflag', { activo: undefined }),
    jug('l3', 'eL', 9, 'Carla Explicita', { activo: true }),
    jug('l4', 'eL', 11, 'Dario Inactivo', { activo: false }),
    jug('v1', 'eV', 5, 'Eva Visita'),
    jug('v2', 'eV', 6, 'Fede Visita'),
    jug('v3', 'eV', 8, 'Gus Inactivo', { activo: false }),
  ])
  await db.partidos.add({
    id: 'p1', codigo: '7531', ligaId: 'liga1', canchaId: 'c1', localId: 'eL', visitaId: 'eV',
    estado: 'vivo', inicio: '2026-10-18T10:00:00.000Z',
    relojEstado: 'detenido', relojRestante: restante, relojDesde: null,
  })
}

function renderConsola(Consola) {
  render(
    <MemoryRouter initialEntries={['/p/halcones-vs-titanes-7531/consola']}>
      <Routes>
        <Route path="/p/:slug/consola" element={<Consola />} />
        <Route path="/p/:slug" element={<div>detalle</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function abrir(opts) {
  const { db, Consola } = await cargar()
  await sembrar(db, opts)
  renderConsola(Consola)
  await screen.findByRole('heading', { name: 'Consola del árbitro' })
  return { db, user: userEvent.setup() }
}

const eventos = (db) => db.eventos.toArray()
const tab = (n) => screen.getByRole('tab', { name: n })
const filas = () => document.querySelectorAll('.jugador-fila')
const textosBotones = (fila) => [...fila.querySelectorAll('.anota button')].map((b) => b.textContent)
const instantanea = async (db) => ({
  eventos: await db.eventos.toArray(),
  partido: await db.partidos.get('p1'),
})

describe('Consola — panel global (prototipo para estadísticas y defensa)', () => {
  it('1. Puntos está seleccionado por defecto', async () => {
    await abrir()
    expect(tab('Puntos').getAttribute('aria-selected')).toBe('true')
    expect(tab('Estadísticas').getAttribute('aria-selected')).toBe('false')
    expect(tab('Defensa').getAttribute('aria-selected')).toBe('false')
  })

  it('2. el selector expone exactamente Puntos, Estadísticas y Defensa, en ese orden', async () => {
    await abrir()
    const lista = screen.getByRole('tablist', { name: 'Panel de acciones' })
    expect(within(lista).getAllByRole('tab').map((t) => t.textContent.replace('✓', '').trim()))
      .toEqual(['Puntos', 'Estadísticas', 'Defensa'])
  })

  it('3. cambiar de panel afecta a todas las filas a la vez', async () => {
    const { user } = await abrir()
    expect(filas().length).toBe(3)
    filas().forEach((f) => expect(textosBotones(f)).toEqual(['+1', '+2', '+3', 'F']))

    await user.click(tab('Estadísticas'))
    filas().forEach((f) => expect(textosBotones(f)).toEqual(['AST', 'RD', 'RO', 'TL-']))

    await user.click(tab('Defensa'))
    filas().forEach((f) => expect(textosBotones(f)).toEqual(['ROB', 'BLQ']))

    await user.click(tab('Puntos'))
    filas().forEach((f) => expect(textosBotones(f)).toEqual(['+1', '+2', '+3', 'F']))
  })

  it('4. el panel elegido sobrevive al cambio de equipo', async () => {
    const { user } = await abrir()
    await user.click(tab('Estadísticas'))
    await user.click(screen.getByRole('button', { name: /Titanes/ }))
    expect(tab('Estadísticas').getAttribute('aria-selected')).toBe('true')
    filas().forEach((f) => expect(textosBotones(f)).toEqual(['AST', 'RD', 'RO', 'TL-']))
    await user.click(screen.getByRole('button', { name: /Halcones/ }))
    expect(tab('Estadísticas').getAttribute('aria-selected')).toBe('true')
    filas().forEach((f) => expect(textosBotones(f)).toEqual(['AST', 'RD', 'RO', 'TL-']))
  })

  it('5. cambiar de panel no crea eventos ni cambia el marcador; el plantel no se remonta', async () => {
    const { db, user } = await abrir()
    const lista = document.querySelector('.plantel')
    const primeraFila = filas()[0]
    await user.click(tab('Estadísticas'))
    await user.click(tab('Defensa'))
    await user.click(tab('Puntos'))
    expect(await eventos(db)).toHaveLength(0)
    expect(document.querySelectorAll('.cabecera .puntos')[0].textContent).toBe('0')
    expect(document.querySelector('.plantel')).toBe(lista)
    expect(filas()[0]).toBe(primeraFila)
  })

  it('6. +1/+2/+3/F conservan su comportamiento funcional', async () => {
    const { db, user } = await abrir()
    await user.click(screen.getByRole('button', { name: 'Ana Activa más 2' }))
    await user.click(screen.getByRole('button', { name: 'Ana Activa más 3' }))
    await user.click(screen.getByRole('button', { name: 'Ana Activa más 1' }))
    await user.click(screen.getByRole('button', { name: 'Falta de Ana Activa' }))
    await waitFor(async () => expect(await eventos(db)).toHaveLength(4))

    const evs = (await eventos(db)).sort((a, b) => a.seq - b.seq)
    expect(evs.map((e) => [e.tipo, e.jugadorId, e.equipoId, e.puntos, e.periodo]))
      .toEqual([
        ['punto', 'l1', 'eL', 2, 1],
        ['punto', 'l1', 'eL', 3, 1],
        ['punto', 'l1', 'eL', 1, 1],
        ['falta', 'l1', 'eL', 0, 1],
      ])
    await waitFor(() => expect(document.querySelectorAll('.cabecera .puntos')[0].textContent).toBe('6'))
    // El marcador llega con los 3 puntos; la falta (último evento) llega un poco después.
    await waitFor(() => expect(filas()[0].textContent).toContain('1 falta'))
    const fila = filas()[0]
    expect(fila.textContent).toContain('6 pts')
    const reg = document.querySelector('.registro')
    expect(within(reg).getAllByText('Ana Activa')).toHaveLength(4)
    expect(navigator.vibrate).toHaveBeenCalledWith(12)
  })

  it('7. las acciones avanzadas (prototipo) no crean eventos ni cambian proyecciones', async () => {
    const { db, user } = await abrir()
    await user.click(screen.getByRole('button', { name: 'Ana Activa más 2' }))
    await waitFor(async () => expect(await eventos(db)).toHaveLength(1))
    // Esperar a que la interfaz refleje el evento antes de tomar la foto del DOM.
    await waitFor(() => expect(document.querySelectorAll('.cabecera .puntos')[0].textContent).toBe('2'))
    await waitFor(() => expect(filas()[0].textContent).toContain('2 pts'))
    const antes = await instantanea(db)
    const registroAntes = document.querySelector('.registro').innerHTML
    const filaAntes = filas()[0].textContent

    for (const [panel, nombres] of [
      ['Estadísticas', ['asistencia', 'rebote defensivo', 'rebote ofensivo', 'tiro libre fallado']],
      ['Defensa', ['robo', 'bloqueo']],
    ]) {
      for (const n of nombres) {
        await user.click(tab(panel))
        await user.click(screen.getByRole('button', { name: `Ana Activa: ${n} (prototipo, no guardado)` }))
      }
    }
    expect(await instantanea(db)).toEqual(antes)
    expect(document.querySelector('.registro').innerHTML).toBe(registroAntes)
    expect(document.querySelectorAll('.cabecera .puntos')[0].textContent).toBe('2')
    expect(filas()[0].textContent).toBe(filaAntes)
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('8. el aviso del prototipo dice explícitamente que no se guarda y vuelve a Puntos', async () => {
    const { user } = await abrir()
    await user.click(tab('Estadísticas'))
    await user.click(screen.getByRole('button', { name: 'Beto Sinflag: asistencia (prototipo, no guardado)' }))
    const avisos = screen.getAllByRole('status')
    const proto = avisos.find((a) => a.textContent.includes('Prototipo · no guardado'))
    expect(proto).toBeTruthy()
    expect(proto.textContent).toContain('Beto Sinflag AST')
    // Un toque de fila devuelve a Puntos (una acción, un regreso).
    expect(tab('Puntos').getAttribute('aria-selected')).toBe('true')
    filas().forEach((f) => expect(textosBotones(f)).toEqual(['+1', '+2', '+3', 'F']))
  })

  it('9. los relojes prototipo son independientes en ambos sentidos, también con reinicios repetidos', async () => {
    const { db, user } = await abrir()
    const posesion = screen.getByRole('group', { name: 'Reloj de posesión' })
    const cruce = screen.getByRole('group', { name: 'Reloj de cruce de medio campo' })
    expect(posesion).not.toBe(cruce)
    expect(within(posesion).getByText('Prototipo · no guardado')).toBeTruthy()
    expect(within(cruce).getByText('Prototipo · no guardado')).toBeTruthy()
    const valor = (g) => g.querySelector('.proto-reloj-valor b').textContent
    const reiniciarPosesion = () =>
      user.click(screen.getByRole('button', { name: 'Reiniciar reloj de posesión (prototipo, no guardado)' }))
    const reiniciarCruce = () =>
      user.click(screen.getByRole('button', { name: 'Reiniciar reloj de cruce de medio campo (prototipo, no guardado)' }))
    // No se asume ninguna duración concreta: solo que cada área cambia por su cuenta.
    const vals = () => [valor(posesion), valor(cruce)]

    expect(vals()).toEqual(['--', '--'])
    const antesBd = await instantanea(db)

    // Posesión primero: el cruce no se mueve.
    let [p0, c0] = vals()
    await reiniciarPosesion()
    let [p1, c1] = vals()
    expect(p1).not.toBe(p0)
    expect(c1).toBe(c0)

    // Cruce después: la posesión no se mueve.
    ;[p0, c0] = vals()
    await reiniciarCruce()
    ;[p1, c1] = vals()
    expect(c1).not.toBe(c0)
    expect(p1).toBe(p0)

    // Reinicios repetidos y alternados: cada uno deja intacto al otro.
    for (const reiniciar of [reiniciarPosesion, reiniciarPosesion, reiniciarCruce, reiniciarCruce,
      reiniciarPosesion, reiniciarCruce, reiniciarCruce, reiniciarPosesion]) {
      const antes = vals()
      await reiniciar()
      const despues = vals()
      const esPosesion = reiniciar === reiniciarPosesion
      expect(despues[esPosesion ? 1 : 0]).toBe(antes[esPosesion ? 1 : 0])
      expect(despues[esPosesion ? 0 : 1]).not.toBe('--')
      // Sin persistencia: ni eventos ni campos del partido cambian en ningún paso.
      expect(await instantanea(db)).toEqual(antesBd)
    }
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('10. los relojes prototipo nunca tocan el reloj del partido ni crean periodos', async () => {
    const { db, user } = await abrir()
    const antes = await db.partidos.get('p1')
    await user.click(screen.getByRole('button', { name: /Reiniciar reloj de posesión/ }))
    await user.click(screen.getByRole('button', { name: /Reiniciar reloj de cruce de medio campo/ }))
    await user.click(screen.getByRole('button', { name: /Reiniciar reloj de posesión/ }))
    const despues = await db.partidos.get('p1')
    expect([despues.relojEstado, despues.relojRestante, despues.relojDesde])
      .toEqual([antes.relojEstado, antes.relojRestante, antes.relojDesde])
    expect((await eventos(db)).filter((e) => e.tipo === 'periodo')).toHaveLength(0)
  })

  it('11. Deshacer, Rehacer y Anular siguen funcionando como antes', async () => {
    const { db, user } = await abrir()
    await user.click(screen.getByRole('button', { name: 'Ana Activa más 1' }))
    await waitFor(async () => expect(await eventos(db)).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Ana Activa más 2' }))
    await waitFor(async () => expect(await eventos(db)).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Ana Activa más 3' }))
    await waitFor(async () => expect(await eventos(db)).toHaveLength(3))

    // La interfaz debe reflejar los 3 eventos antes de deshacer.
    await waitFor(() => expect(document.querySelectorAll('.registro .ev')).toHaveLength(3))
    await user.click(screen.getByRole('button', { name: /Deshacer/ }))
    await waitFor(async () => {
      const e = (await eventos(db)).sort((a, b) => a.seq - b.seq)
      expect(e.map((x) => x.anulado)).toEqual([false, false, true])
    })
    await waitFor(() => expect(screen.getByRole('button', { name: /Rehacer/ }).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: /Rehacer/ }))
    await waitFor(async () => {
      expect((await eventos(db)).every((x) => !x.anulado)).toBe(true)
    })

    // Anular dirigido sobre un evento que no es el último (el +1, el más antiguo).
    await waitFor(() => expect(document.querySelectorAll('.registro .ev.anulado')).toHaveLength(0))
    const reg = document.querySelector('.registro')
    const pastillas = within(reg).getAllByRole('button', { name: 'anular' })
    await user.click(pastillas[pastillas.length - 1])
    await waitFor(async () => {
      const e = (await eventos(db)).sort((a, b) => a.seq - b.seq)
      expect(e.map((x) => x.anulado)).toEqual([true, false, false])
    })
  })

  it('12. Arrancar y Detener no dependen del panel elegido', async () => {
    const { db, user } = await abrir()
    for (const panel of ['Puntos', 'Estadísticas', 'Defensa']) {
      await user.click(tab(panel))
      await user.click(await screen.findByRole('button', { name: /Arrancar/ }))
      await waitFor(async () => expect((await db.partidos.get('p1')).relojEstado).toBe('corriendo'))
      await user.click(await screen.findByRole('button', { name: /Detener/ }))
      await waitFor(async () => expect((await db.partidos.get('p1')).relojEstado).toBe('detenido'))
      // Cambiar de panel no escribe campos del reloj.
      const antes = await db.partidos.get('p1')
      await user.click(tab(panel === 'Defensa' ? 'Puntos' : 'Defensa'))
      const despues = await db.partidos.get('p1')
      expect([despues.relojEstado, despues.relojRestante, despues.relojDesde])
        .toEqual([antes.relojEstado, antes.relojRestante, antes.relojDesde])
    }
  })

  // Cada panel con su propio fixture: el cambio de periodo no arrastra estado de otro caso.
  it.each(['Puntos', 'Estadísticas', 'Defensa'])(
    '12. terminar el 1º cuarto antes de tiempo con el panel %s: periodo, evento y reloj',
    async (panel) => {
      const { db, user } = await abrir({ restante: 123000 })
      const { duracionMs } = await import('../lib/reloj-calculo.js')
      const liga = await db.ligas.get('liga1')

      await user.click(tab(panel))
      // Con el reloj corriendo: el cambio de periodo debe dejarlo detenido y reiniciado.
      await user.click(await screen.findByRole('button', { name: /Arrancar/ }))
      await waitFor(async () => expect((await db.partidos.get('p1')).relojEstado).toBe('corriendo'))
      // El comando valida lo que la pantalla observó: hay que esperar a que ya muestre el reloj en marcha.
      await screen.findByRole('button', { name: /Detener/ })
      expect(document.body.textContent).toContain('1º cuarto')

      await user.click(screen.getByRole('button', { name: /Terminar el 1º cuarto antes de tiempo/ }))
      await waitFor(async () => expect((await eventos(db)).filter((e) => e.tipo === 'periodo')).toHaveLength(1))

      const evs = await eventos(db)
      expect(evs).toHaveLength(1)
      expect(evs[0]).toMatchObject({ tipo: 'periodo', periodo: 1, partidoId: 'p1', anulado: false })
      const p = await db.partidos.get('p1')
      expect(p.relojEstado).toBe('detenido')
      expect(p.relojDesde).toBeNull()
      expect(p.relojRestante).toBe(duracionMs(liga))
      // El periodo avanza a 2 y el reloj queda detenido en la duración completa.
      await waitFor(() => expect(document.querySelector('.periodo-etiqueta').textContent).toContain('2º cuarto'))
      // El evento y el reinicio del reloj son dos escrituras: la pantalla las refleja en pasos.
      await waitFor(() => expect(document.querySelector('.reloj-consola').className).not.toContain('anda'))
      // El evento de periodo no aparece en Últimas acciones.
      expect(document.querySelectorAll('.registro .ev')).toHaveLength(0)
    },
  )

  it('13. los jugadores inactivos no se pueden anotar en ningún panel y su historial se conserva', async () => {
    const { db, user } = await abrir()
    // Evento pasado de un inactivo: debe seguir contando y mostrando su nombre.
    await db.eventos.add({
      id: 'ev0', partidoId: 'p1', seq: 1, tipo: 'punto', equipoId: 'eL', jugadorId: 'l4',
      puntos: 3, periodo: 1, anulado: false, creadoEn: Date.now(),
    })
    await waitFor(() => expect(document.querySelectorAll('.cabecera .puntos')[0].textContent).toBe('3'))
    expect(within(document.querySelector('.registro')).getByText('Dario Inactivo')).toBeTruthy()

    const verificar = (lado) => {
      const nombres = [...filas()].map((f) => f.querySelector('.nombre').textContent)
      if (lado === 'local') {
        expect(nombres).toEqual(['Ana Activa', 'Beto Sinflag', 'Carla Explicita']) // activo undefined = activo
        expect(screen.queryByText('Dario Inactivo', { selector: '.nombre' })).toBeNull()
        expect(screen.queryByRole('button', { name: /Dario Inactivo/ })).toBeNull()
      } else {
        expect(nombres).toEqual(['Eva Visita', 'Fede Visita'])
        expect(screen.queryByRole('button', { name: /Gus Inactivo/ })).toBeNull()
      }
    }
    for (const panel of ['Puntos', 'Estadísticas', 'Defensa']) {
      await user.click(tab(panel))
      verificar('local')
      await user.click(screen.getByRole('button', { name: /Titanes/ }))
      verificar('visita')
      await user.click(screen.getByRole('button', { name: /Halcones/ }))
    }
    // El evento histórico sigue en la lista y en el marcador.
    expect(within(document.querySelector('.registro')).getByText('Dario Inactivo')).toBeTruthy()
    expect(document.querySelectorAll('.cabecera .puntos')[0].textContent).toBe('3')
  })

  it('14. selector y botones tienen nombres accesibles y estado seleccionado', async () => {
    const { user } = await abrir()
    for (const n of ['Puntos', 'Estadísticas', 'Defensa']) expect(tab(n)).toBeTruthy()
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('panel-tab-puntos')
    expect(screen.getByRole('button', { name: 'Ana Activa más 3' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Falta de Ana Activa' })).toBeTruthy()

    await user.click(tab('Defensa'))
    expect(tab('Defensa').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('panel-tab-defensa')
    expect(screen.getByRole('button', { name: 'Ana Activa: robo (prototipo, no guardado)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ana Activa: bloqueo (prototipo, no guardado)' })).toBeTruthy()
    // El equipo activo también se indica con aria-pressed.
    expect(screen.getByRole('button', { name: /Halcones/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /Titanes/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('15. el aviso persistente declara que todo lo avanzado es prototipo y no se guarda', async () => {
    const { user } = await abrir()
    const nota = screen.getByRole('note')
    expect(nota.textContent).toMatch(/prototipos/)
    expect(nota.textContent).toMatch(/No se guardan/)
    await user.click(tab('Estadísticas'))
    expect(screen.getByRole('note')).toBeTruthy() // persistente, sin cierre
    expect(within(nota).queryByRole('button')).toBeNull()
    expect(screen.getByText(/PROTOTIPO · prototipo · no guardado/i)).toBeTruthy()
  })

  it('la consola sigue deteniendo el reloj al llegar a cero, y nadie lo rellena ni lo reinicia', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    // Reloj corriendo que ya se agotó (venció hace 5 s).
    await db.partidos.update('p1', { relojEstado: 'corriendo', relojRestante: 1000, relojDesde: Date.now() - 6000 })
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })

    await waitFor(async () => {
      const p = await db.partidos.get('p1')
      expect([p.relojEstado, p.relojRestante, p.relojDesde]).toEqual(['detenido', 0, null])
    }, { timeout: 3000 })

    // Pasan varios ciclos de la consola: sigue detenido en cero, sin reinicio automático.
    await new Promise((r) => setTimeout(r, 1500))
    const p = await db.partidos.get('p1')
    expect([p.relojEstado, p.relojRestante, p.relojDesde]).toEqual(['detenido', 0, null])
    expect((await eventos(db)).filter((e) => e.tipo === 'periodo')).toHaveLength(0)
  })

  // ---- Slice B: frontera de periodo -------------------------------------------------

  // Escribe en IndexedDB sin pasar por Dexie, como lo haría otra pestaña: la
  // pantalla abierta no se entera y queda desactualizada.
  function escribirComoOtraPestana(tabla, fila) {
    return new Promise((resolve, reject) => {
      const abrir = indexedDB.open(NOMBRE_BD)
      abrir.onerror = () => reject(abrir.error)
      abrir.onsuccess = () => {
        const cx = abrir.result
        const tx = cx.transaction(tabla, 'readwrite')
        tx.objectStore(tabla).put(fila)
        tx.oncomplete = () => { cx.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
    })
  }
  const periodoMostrado = () => document.querySelector('.periodo-etiqueta').textContent
  const transicionFila = (seq, extra = {}) => ({
    id: `t${seq}`, partidoId: 'p1', seq, tipo: 'periodo', periodo: 1, anulado: false, creadoEn: 1, ...extra,
  })
  const puntoFila = (seq, extra = {}) => ({
    id: `x${seq}`, partidoId: 'p1', seq, tipo: 'punto', equipoId: 'eL', jugadorId: 'l1',
    puntos: 2, periodo: 1, anulado: false, creadoEn: 1, ...extra,
  })
  const alerta = () => screen.queryByRole('alert')
  const sinExitoDeAnotacion = () =>
    expect(screen.queryAllByRole('status').filter((n) => /\+\d|Falta de/.test(n.textContent))).toHaveLength(0)

  it('Deshacer se detiene en un cambio de periodo, avisa unos 4 s y no toca nada', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.eventos.bulkAdd([puntoFila(1), transicionFila(2)])
    const user = userEvent.setup()
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    await waitFor(() => expect(periodoMostrado()).toContain('2º cuarto'))
    const antes = await db.eventos.toArray()

    await user.click(screen.getByRole('button', { name: /Deshacer/ }))
    const msg = await screen.findByRole('alert')
    expect(msg.textContent).toMatch(/cambio de periodo/)
    expect(msg.textContent).toMatch(/anular/)
    expect(await db.eventos.toArray()).toEqual(antes) // ni la transición ni el punto anterior
    sinExitoDeAnotacion()
    await waitFor(() => expect(alerta()).toBeNull(), { timeout: 6000 }) // se va sola
  }, 12000)

  const valoresDeRelojes = () =>
    [...document.querySelectorAll('.proto-reloj-valor b')].map((b) => b.textContent)
  const reiniciarRelojesDePrueba = async (user) => {
    await user.click(screen.getByRole('button', { name: /Reiniciar reloj de posesión/ }))
    await user.click(screen.getByRole('button', { name: /Reiniciar reloj de cruce de medio campo/ }))
  }
  // Detecta si la consola llega a desaparecer del documento (parpadeo en blanco).
  function vigilarParpadeo() {
    const estado = { parpadeo: false }
    const obs = new MutationObserver(() => {
      if (!document.querySelector('.consola')) estado.parpadeo = true
    })
    obs.observe(document.body, { childList: true, subtree: true })
    estado.parar = () => obs.disconnect()
    return estado
  }

  it('una pantalla desactualizada no anota, avisa ~4 s y se vuelve a leer sola, sin perder equipo, panel ni relojes de prueba', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    // Un punto anulado: hay rehacer pendiente que el rechazo no debe bloquear.
    await db.eventos.add(puntoFila(1, { anulado: true, anuladoEn: 5 }))
    const user = userEvent.setup()
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    expect(periodoMostrado()).toContain('1º cuarto')

    // Estado de la pantalla que debe sobrevivir: equipo visitante y relojes de prueba.
    await user.click(screen.getByRole('button', { name: /Titanes/ }))
    await reiniciarRelojesDePrueba(user)
    const relojes = valoresDeRelojes()
    expect(relojes).not.toContain('--')

    // Otra pestaña cambia de periodo SIN avisar a Dexie: esta pantalla sigue vieja.
    await escribirComoOtraPestana('eventos', transicionFila(2))
    await new Promise((r) => setTimeout(r, 50))
    expect(periodoMostrado()).toContain('1º cuarto')

    const vigilancia = vigilarParpadeo()
    navigator.vibrate.mockClear()
    await user.click(screen.getByRole('button', { name: 'Eva Visita más 2' }))
    const inicio = Date.now()
    const msg = await screen.findByRole('alert')
    expect(msg.textContent).toMatch(/desactualizada/)
    expect(msg.textContent).toMatch(/no se guardó/)
    sinExitoDeAnotacion()
    expect(navigator.vibrate).not.toHaveBeenCalledWith(12)

    // Sin escrituras: solo el anulado y la transición de la otra pestaña, y el rehacer sigue libre.
    let evs = await db.eventos.toArray()
    expect(evs).toHaveLength(2)
    expect(evs.find((e) => e.id === 'x1').rehacerBloqueado).toBeUndefined()

    // La consola relee sola (sin ningún aviso de Dexie) y muestra el periodo real.
    await waitFor(() => expect(periodoMostrado()).toContain('2º cuarto'))
    // Sigue el mismo equipo, el mismo panel y los mismos valores de los relojes de prueba.
    expect(screen.getByRole('button', { name: /Titanes/ }).getAttribute('aria-pressed')).toBe('true')
    expect(tab('Puntos').getAttribute('aria-selected')).toBe('true')
    expect(valoresDeRelojes()).toEqual(relojes)
    expect([...filas()].map((f) => f.querySelector('.nombre').textContent)).toEqual(['Eva Visita', 'Fede Visita'])

    // El mensaje se mantiene unos 4 s desde el rechazo (no se corta con la relectura).
    expect(screen.getByRole('alert').textContent).toMatch(/desactualizada/)
    await waitFor(() => expect(alerta()).toBeNull(), { timeout: 6000 })
    const duracion = Date.now() - inicio
    expect(duracion).toBeGreaterThanOrEqual(3500)
    expect(duracion).toBeLessThan(5500)

    // No hubo reintento ni parpadeo en blanco; y ya anota en el periodo correcto.
    evs = await db.eventos.toArray()
    expect(evs).toHaveLength(2)
    expect(vigilancia.parpadeo).toBe(false)
    vigilancia.parar()
    await user.click(screen.getByRole('button', { name: 'Eva Visita más 3' }))
    await waitFor(async () => expect((await db.eventos.toArray()).find((e) => e.puntos === 3)?.periodo).toBe(2))
  }, 15000)

  it('una pantalla desactualizada tampoco cambia de periodo dos veces y conserva panel, equipo y relojes de prueba', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    const user = userEvent.setup()
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    await user.click(tab('Estadísticas'))
    await user.click(screen.getByRole('button', { name: /Titanes/ }))
    await reiniciarRelojesDePrueba(user)
    const relojes = valoresDeRelojes()

    await escribirComoOtraPestana('eventos', transicionFila(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(periodoMostrado()).toContain('1º cuarto')

    const vigilancia = vigilarParpadeo()
    await user.click(await screen.findByRole('button', { name: /Terminar el 1º cuarto antes de tiempo/ }))
    const msg = await screen.findByRole('alert')
    expect(msg.textContent).toMatch(/desactualizada/)
    expect(msg.textContent).toMatch(/No se cambió de periodo/)
    expect((await db.eventos.toArray()).filter((e) => e.tipo === 'periodo')).toHaveLength(1)

    await waitFor(() => expect(periodoMostrado()).toContain('2º cuarto'))
    // El panel elegido no cambia (esta acción no es de un jugador), ni el equipo, ni los relojes.
    expect(tab('Estadísticas').getAttribute('aria-selected')).toBe('true')
    filas().forEach((f) => expect(textosBotones(f)).toEqual(['AST', 'RD', 'RO', 'TL-']))
    expect(screen.getByRole('button', { name: /Titanes/ }).getAttribute('aria-pressed')).toBe('true')
    expect(valoresDeRelojes()).toEqual(relojes)
    expect((await db.eventos.toArray()).filter((e) => e.tipo === 'periodo')).toHaveLength(1)
    expect(vigilancia.parpadeo).toBe(false)
    vigilancia.parar()
  }, 15000)

  it.each([['programado', /todavía no ha comenzado/], ['final', /ya terminó/]])(
    'con el partido %s rechaza anotar con un mensaje claro y no escribe nada',
    async (estado, texto) => {
      const { Consola, db } = await cargar()
      await sembrar(db)
      await db.partidos.update('p1', { estado })
      const user = userEvent.setup()
      renderConsola(Consola)
      await screen.findByRole('heading', { name: 'Consola del árbitro' })
      navigator.vibrate.mockClear()

      await user.click(screen.getByRole('button', { name: 'Ana Activa más 1' }))
      await user.click(screen.getByRole('button', { name: 'Falta de Ana Activa' }))
      expect((await screen.findByRole('alert')).textContent).toMatch(texto)
      expect(await db.eventos.count()).toBe(0)
      sinExitoDeAnotacion()
      expect(navigator.vibrate).not.toHaveBeenCalledWith(12)
    },
  )

  it('Rehacer con un evento de otro periodo se detiene con un mensaje y no salta a otro', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.eventos.bulkAdd([
      puntoFila(1, { anulado: true, anuladoEn: 10 }),                       // válido, más antiguo
      transicionFila(2),
      puntoFila(3, { anulado: true, anuladoEn: 20, periodo: 1 }),           // dice periodo 1 pero está tras la transición
    ])
    const user = userEvent.setup()
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    const antes = await db.eventos.toArray()

    await user.click(screen.getByRole('button', { name: /Rehacer/ }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/otro periodo/)
    expect(await db.eventos.toArray()).toEqual(antes)
  })

  it('Rehacer no se ofrece por una transición anulada, y Anular de un punto anterior sigue funcionando', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.eventos.bulkAdd([
      puntoFila(1),
      transicionFila(2, { anulado: true, anuladoEn: 9 }), // dato antiguo
    ])
    const user = userEvent.setup()
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    expect(screen.getByRole('button', { name: /Rehacer/ }).disabled).toBe(true)
    await user.click(within(document.querySelector('.registro')).getByRole('button', { name: 'anular' }))
    await waitFor(async () => expect((await db.eventos.get('x1')).anulado).toBe(true))
  })

  it('con el partido terminado se puede deshacer, rehacer y anular', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.eventos.bulkAdd([puntoFila(1), puntoFila(2), puntoFila(3)])
    await db.partidos.update('p1', { estado: 'final' })
    const user = userEvent.setup()
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    await waitFor(() => expect(document.querySelectorAll('.registro .ev')).toHaveLength(3))

    await user.click(screen.getByRole('button', { name: /Deshacer/ }))
    await waitFor(async () => expect((await db.eventos.get('x3')).anulado).toBe(true))
    await waitFor(() => expect(screen.getByRole('button', { name: /Rehacer/ }).disabled).toBe(false))
    await user.click(screen.getByRole('button', { name: /Rehacer/ }))
    await waitFor(async () => expect((await db.eventos.get('x3')).anulado).toBe(false))
    const pastillas = within(document.querySelector('.registro')).getAllByRole('button', { name: 'anular' })
    await user.click(pastillas[pastillas.length - 1]) // el más antiguo (x1)
    await waitFor(async () => expect((await db.eventos.get('x1')).anulado).toBe(true))
    expect(alerta()).toBeNull()
  })

  // ---- Slice C: comandos del reloj auditados ----------------------------------------

  const registrosAuditoria = (db) => db.auditoriaReloj.toArray().then((r) => r.sort((a, b) => a.seq - b.seq))
  const esperarEnPantalla = async (nombre) => screen.findByRole('button', { name: nombre })

  it('Comenzar el partido: un solo comando auditado, también con doble toque', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.partidos.update('p1', { estado: 'programado', inicio: null, relojEstado: undefined, relojRestante: undefined, relojDesde: undefined })
    const user = userEvent.setup()
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })

    await user.dblClick(await screen.findByRole('button', { name: /Comenzar el partido/ }))
    await waitFor(async () => expect((await db.partidos.get('p1')).estado).toBe('vivo'))
    const rs = await registrosAuditoria(db)
    expect(rs.map((r) => r.comando)).toEqual(['inicio-partido'])
    expect(await db.partidos.get('p1')).toMatchObject({ relojEstado: 'detenido', relojDesde: null })
    expect(rs[0]).toMatchObject({ origen: 'consola', actorId: 'yo' })
  })

  it.each([
    ['un activo sin número', () => ({ l1: { dorsal: undefined } }), /Halcones tiene 1 jugador activo sin número/],
    ['números repetidos', () => ({ v2: { dorsal: 5 } }), /Titanes repite el número 5/],
  ])('Comenzar con la plantilla cambiada tras abrir la consola (%s): rechaza con mensaje, sin nombres, y no escribe', async (_n, cambios, texto) => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.partidos.update('p1', { estado: 'programado', inicio: null, relojEstado: undefined, relojRestante: undefined, relojDesde: undefined })
    const user = userEvent.setup()
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    const boton = await screen.findByRole('button', { name: /Comenzar el partido/ })
    // La pantalla ya se dibujó con una plantilla válida; la base cambia después.
    for (const [id, cambio] of Object.entries(cambios())) await db.jugadores.update(id, cambio)
    const antes = { partido: await db.partidos.get('p1'), registros: await registrosAuditoria(db), eventos: await db.eventos.count() }

    await user.click(boton)
    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toMatch(texto)
    expect(alerta.textContent).toMatch(/No se puede comenzar/)
    expect(alerta.textContent).not.toMatch(/Ana|Beto|Carla|Eva|Fede|Activa|Visita/)
    expect(await db.partidos.get('p1')).toEqual(antes.partido)
    expect(await registrosAuditoria(db)).toEqual(antes.registros)
    expect(await db.eventos.count()).toBe(antes.eventos)
  })

  it('Comenzar con el mismo equipo como local y visita rechaza con equipos-invalidos y no escribe', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.partidos.update('p1', { estado: 'programado', inicio: null, relojEstado: undefined, relojRestante: undefined, relojDesde: undefined })
    const user = userEvent.setup()
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    const boton = await screen.findByRole('button', { name: /Comenzar el partido/ })
    await db.partidos.update('p1', { visitaId: 'eL' }) // la pantalla sigue dibujable; el inicio lo rechaza
    await user.click(boton)
    expect((await screen.findByRole('alert')).textContent).toMatch(/no tiene dos equipos válidos/)
    expect((await db.partidos.get('p1')).estado).toBe('programado')
    expect(await registrosAuditoria(db)).toEqual([])
  })

  // ---- Equipo que falta: la consola no desreferencia ni inventa equipos ----
  const SIN_CONTROLES = () => {
    expect(screen.queryByRole('button', { name: /Comenzar el partido/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Ana Activa más/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Falta de/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Deshacer/ })).toBeNull()
  }
  const AVISO = /no se puede arbitrar: falta uno de sus equipos/

  it.each([['visita', 'eV'], ['local', 'eL']])(
    'si falta el equipo %s al abrir, muestra el aviso, sin controles ni marcador, y no escribe', async (_n, equipoId) => {
      const { Consola, db } = await cargar()
      await sembrar(db)
      await db.partidos.update('p1', { estado: 'programado', inicio: null, relojEstado: undefined, relojRestante: undefined, relojDesde: undefined })
      await db.equipos.delete(equipoId)
      const antes = { partido: await db.partidos.get('p1'), registros: await registrosAuditoria(db) }
      renderConsola(Consola)
      expect((await screen.findByRole('alert')).textContent).toMatch(AVISO)
      expect(screen.getByRole('heading', { name: 'Consola del árbitro' })).toBeTruthy()
      SIN_CONTROLES()
      expect(await db.partidos.get('p1')).toEqual(antes.partido)
      expect(await registrosAuditoria(db)).toEqual(antes.registros)
    })

  it.each([['visita', 'eV'], ['local', 'eL']])(
    'si el equipo %s desaparece con la consola ya dibujada (partido vivo), pasa al aviso y quita los controles', async (_n, equipoId) => {
      const { Consola, db } = await cargar()
      await sembrar(db)
      renderConsola(Consola)
      await screen.findByRole('button', { name: 'Ana Activa más 1' })
      await db.equipos.delete(equipoId)
      expect((await screen.findByRole('alert')).textContent).toMatch(AVISO)
      SIN_CONTROLES()
      expect(screen.queryByRole('button', { name: 'Detener' })).toBeNull()
      expect(await db.eventos.count()).toBe(0)
    })

  it('si un equipo desaparece con la consola de un partido programado ya dibujada, también', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.partidos.update('p1', { estado: 'programado', inicio: null, relojEstado: undefined, relojRestante: undefined, relojDesde: undefined })
    renderConsola(Consola)
    await screen.findByRole('button', { name: /Comenzar el partido/ })
    await db.equipos.delete('eV')
    expect((await screen.findByRole('alert')).textContent).toMatch(AVISO)
    SIN_CONTROLES()
    // Y la guardia autoritativa sigue ahí aunque la pantalla ya no pueda iniciar.
    const { iniciarPartido, observadoDe, ultimoSeqAuditoria } = await import('../lib/reloj.js')
    const p = await db.partidos.get('p1')
    expect(await iniciarPartido('p1', observadoDe(p, await ultimoSeqAuditoria('p1')))).toMatchObject({ ok: false, motivo: 'equipos-invalidos' })
    expect((await db.partidos.get('p1')).estado).toBe('programado')
  })

  it('un organizador ajeno con un equipo faltante sigue siendo redirigido al detalle', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.meta.put({ id: 'sesion', rol: 'organizador', cuentaId: 'otro' })
    await db.equipos.delete('eV')
    renderConsola(Consola)
    expect(await screen.findByText('detalle')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('un partido sin ligaId no rompe la consola: no hay dueño, así que redirige al detalle', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.partidos.update('p1', { ligaId: undefined })
    renderConsola(Consola)
    expect(await screen.findByText('detalle')).toBeTruthy()
  })

  it('con ambos equipos presentes la consola sigue siendo la de siempre', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    renderConsola(Consola)
    expect(await screen.findByRole('button', { name: 'Ana Activa más 1' })).toBeTruthy()
    expect(screen.queryByText(AVISO)).toBeNull()
  })

  it('Arrancar y Detener quedan auditados con la sesión como actor, y el doble toque es un solo comando', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    const user = userEvent.setup()
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })

    await user.dblClick(await esperarEnPantalla(/Arrancar/))
    await waitFor(async () => expect((await db.partidos.get('p1')).relojEstado).toBe('corriendo'))
    expect((await registrosAuditoria(db)).map((r) => r.comando)).toEqual(['arrancar'])

    await user.click(await esperarEnPantalla(/Detener/))
    await waitFor(async () => expect((await db.partidos.get('p1')).relojEstado).toBe('detenido'))
    const rs = await registrosAuditoria(db)
    expect(rs.map((r) => [r.comando, r.origen, r.actorId])).toEqual([['arrancar', 'consola', 'yo'], ['detener', 'consola', 'yo']])
    expect(rs[1].antes.relojEstado).toBe('corriendo')
    expect(await esperarEnPantalla(/Arrancar/)).toBeTruthy()
  })

  it('Cerrar el partido: confirma fuera de la transacción, detiene el reloj, no toca el saldo y vuelve al detalle', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.partidos.update('p1', { relojEstado: 'corriendo', relojRestante: 600000, relojDesde: Date.now() })
    const confirmar = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmar)
    const espiasCuenta = ['get', 'update', 'put', 'add'].map((m) => vi.spyOn(db.cuenta, m))
    const user = userEvent.setup()
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    await esperarEnPantalla(/Detener/)
    espiasCuenta.forEach((e) => e.mockClear()) // la consola ya no lee la cuenta

    await user.click(screen.getByRole('button', { name: /Cerrar el partido/ }))
    expect(confirmar).toHaveBeenCalledWith('¿Cerrar el partido? El reloj se detendrá.')
    expect(await screen.findByText('detalle')).toBeTruthy()
    const p = await db.partidos.get('p1')
    expect(p).toMatchObject({ estado: 'final', relojEstado: 'detenido', relojDesde: null })
    expect(p.relojRestante).toBeGreaterThan(0)
    expect((await registrosAuditoria(db)).map((r) => r.comando)).toEqual(['cierre-partido'])
    espiasCuenta.forEach((e) => expect(e).not.toHaveBeenCalled())
    expect((await db.cuenta.get('yo')).saldo).toBe(5)
  })

  it('Cerrar el partido funciona aunque no exista ninguna cuenta, y si se cancela no se escribe nada', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.cuenta.clear()
    const user = userEvent.setup()
    vi.stubGlobal('confirm', vi.fn(() => false))
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' }) // se muestra sin cuenta
    await user.click(screen.getByRole('button', { name: /Cerrar el partido/ }))
    expect((await db.partidos.get('p1')).estado).toBe('vivo')
    expect(await db.auditoriaReloj.count()).toBe(0)

    vi.stubGlobal('confirm', vi.fn(() => true))
    await user.click(screen.getByRole('button', { name: /Cerrar el partido/ }))
    expect(await screen.findByText('detalle')).toBeTruthy()
    expect((await db.partidos.get('p1')).estado).toBe('final')
    expect(await db.cuenta.count()).toBe(0)
  })

  it('la parada automática en cero queda auditada una sola vez (sistema, sin actor); un partido terminado no se toca', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.partidos.update('p1', { relojEstado: 'corriendo', relojRestante: 1000, relojDesde: Date.now() - 6000 })
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    await waitFor(async () => expect((await db.partidos.get('p1')).relojEstado).toBe('detenido'), { timeout: 3000 })
    await new Promise((r) => setTimeout(r, 1500)) // varios ticks más
    const rs = await registrosAuditoria(db)
    expect(rs).toHaveLength(1)
    expect(rs[0]).toMatchObject({ comando: 'parada-automatica', origen: 'sistema', actorId: null })
    expect((await db.eventos.toArray()).filter((e) => e.tipo === 'periodo')).toHaveLength(0)
  })

  it('un partido ya terminado con el reloj corriendo no se modifica al abrir la consola', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.partidos.update('p1', { estado: 'final', relojEstado: 'corriendo', relojRestante: 1000, relojDesde: Date.now() - 6000 })
    const antes = await db.partidos.get('p1')
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    await new Promise((r) => setTimeout(r, 1500))
    expect(await db.partidos.get('p1')).toEqual(antes)
    expect(await db.auditoriaReloj.count()).toBe(0)
  })

  it('los botones −10s/+10s ya no se muestran', async () => {
    await abrir()
    expect(screen.queryByText('−10s')).toBeNull()
    expect(screen.queryByText('+10s')).toBeNull()
    expect(screen.queryByRole('button', { name: /10s/ })).toBeNull()
  })

  it('un Detener de una pantalla vieja no detiene la corrida nueva y la consola se relee sin perder equipo, panel ni relojes de prueba', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.partidos.update('p1', { relojEstado: 'corriendo', relojRestante: 600000, relojDesde: Date.now() })
    const user = userEvent.setup()
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    await esperarEnPantalla(/Detener/)

    await user.click(tab('Estadísticas'))
    await user.click(screen.getByRole('button', { name: /Titanes/ }))
    await reiniciarRelojesDePrueba(user)
    const relojes = valoresDeRelojes()

    // Otra pestaña (sin avisar a Dexie): detuvo, y arrancó una corrida nueva, con su registro.
    const corridaNueva = Date.now() + 5
    // La corrida nueva trae un restante propio (5:00) para que, cuando la pantalla la lea, se vea en el reloj.
    await escribirComoOtraPestana('partidos', { ...(await db.partidos.get('p1')), relojDesde: corridaNueva, relojRestante: 300000 })
    await escribirComoOtraPestana('auditoriaReloj', {
      id: 'otra-pestana', partidoId: 'p1', seq: 1, reloj: 'juego', comando: 'arrancar', origen: 'consola', actorId: 'yo',
    })

    await user.click(screen.getByRole('button', { name: /Detener/ }))
    const msg = await screen.findByRole('alert')
    expect(msg.textContent).toMatch(/desactualizada/)
    expect(msg.textContent).toMatch(/reloj cambió/)

    // La corrida nueva sigue en marcha y no se escribió nada.
    expect(await db.partidos.get('p1')).toMatchObject({ relojEstado: 'corriendo', relojDesde: corridaNueva })
    expect((await registrosAuditoria(db)).map((r) => r.id)).toEqual(['otra-pestana'])

    // La consola se releyó sola y conserva lo local. La lectura nueva llega de forma asíncrona y, mientras
    // tanto, se sigue mostrando la anterior (con su estado observado viejo). El reloj que se ve y el estado
    // observado que usa Detener salen de la MISMA lectura, así que la corrida nueva (5:00 en vez de 10:00)
    // visible y el botón libre prueban que la pantalla ya consumió el estado autoritativo. Un botón
    // "Detener" presente no prueba nada: ya estaba en la pantalla vieja.
    await waitFor(() => {
      expect(document.querySelector('.reloj-consola').textContent).toMatch(/^0[0-5]:/)
      expect(screen.getByRole('button', { name: /Detener/ }).disabled).toBe(false)
    })
    expect(tab('Estadísticas').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: /Titanes/ }).getAttribute('aria-pressed')).toBe('true')
    expect(valoresDeRelojes()).toEqual(relojes)
    // Con la lectura nueva, Detener funciona (una decisión nueva del árbitro, no un reintento).
    await user.click(screen.getByRole('button', { name: /Detener/ }))
    await waitFor(async () => expect((await db.partidos.get('p1')).relojEstado).toBe('detenido'))
    expect((await registrosAuditoria(db)).map((r) => r.comando)).toEqual(['arrancar', 'detener'])
  }, 15000)

  it('un cierre de una pantalla vieja se rechaza y el partido sigue vivo', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    vi.stubGlobal('confirm', vi.fn(() => true))
    const user = userEvent.setup()
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    await escribirComoOtraPestana('auditoriaReloj', {
      id: 'otra-pestana', partidoId: 'p1', seq: 1, reloj: 'juego', comando: 'arrancar', origen: 'consola', actorId: 'yo',
    })
    await user.click(screen.getByRole('button', { name: /Cerrar el partido/ }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/reloj cambió/)
    expect(screen.queryByText('detalle')).toBeNull()
    expect((await db.partidos.get('p1')).estado).toBe('vivo')
    expect(await db.auditoriaReloj.count()).toBe(1)
  })

  it('futsal: +1 y F registran bien jugador, equipo, marcador y faltas, sin controles de prototipo', async () => {
    const { db, user } = await abrir({ deporte: 'futsal' })
    const sinPrototipos = () => {
      expect(screen.queryByRole('tablist')).toBeNull()
      expect(screen.queryByRole('tab')).toBeNull()
      expect(screen.queryByRole('note')).toBeNull()
      expect(screen.queryByRole('group', { name: 'Reloj de posesión' })).toBeNull()
      expect(screen.queryByRole('group', { name: 'Reloj de cruce de medio campo' })).toBeNull()
      expect(screen.queryByRole('button', { name: /prototipo/i })).toBeNull()
      expect(document.body.textContent).not.toMatch(/Prototipo|PROTOTIPO|AST|ROB|BLQ/)
    }
    sinPrototipos()
    filas().forEach((f) => expect(textosBotones(f)).toEqual(['+1', 'F']))

    // Local: Ana +1 dos veces, Beto falta.
    await user.click(screen.getByRole('button', { name: 'Ana Activa más 1' }))
    await waitFor(async () => expect(await eventos(db)).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Ana Activa más 1' }))
    await waitFor(async () => expect(await eventos(db)).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Falta de Beto Sinflag' }))
    await waitFor(async () => expect(await eventos(db)).toHaveLength(3))

    // Visita: Eva +1 y dos faltas de Fede.
    await user.click(screen.getByRole('button', { name: /Titanes/ }))
    await user.click(await screen.findByRole('button', { name: 'Eva Visita más 1' }))
    await waitFor(async () => expect(await eventos(db)).toHaveLength(4))
    await user.click(screen.getByRole('button', { name: 'Falta de Fede Visita' }))
    await waitFor(async () => expect(await eventos(db)).toHaveLength(5))
    await user.click(screen.getByRole('button', { name: 'Falta de Fede Visita' }))
    await waitFor(async () => expect(await eventos(db)).toHaveLength(6))

    const evs = (await eventos(db)).sort((a, b) => a.seq - b.seq)
    expect(evs.map((e) => [e.tipo, e.jugadorId, e.equipoId, e.puntos, e.periodo])).toEqual([
      ['punto', 'l1', 'eL', 1, 1],
      ['punto', 'l1', 'eL', 1, 1],
      ['falta', 'l2', 'eL', 0, 1],
      ['punto', 'v1', 'eV', 1, 1],
      ['falta', 'v2', 'eV', 0, 1],
      ['falta', 'v2', 'eV', 0, 1],
    ])

    // Marcador y faltas de equipo en la cabecera.
    const puntos = () => [...document.querySelectorAll('.cabecera .puntos')].map((n) => n.textContent)
    const cortos = () => [...document.querySelectorAll('.cabecera .corto')].map((n) => n.textContent)
    // Las faltas son los últimos eventos y la pantalla las refleja un instante después del marcador.
    await waitFor(() => expect(puntos()).toEqual(['2', '1']))
    await waitFor(() => {
      expect(cortos()[0]).toContain('1 faltas')
      expect(cortos()[1]).toContain('2 faltas')
    })

    // Totales por jugador (visita en pantalla ahora).
    const fila = (nombre) => [...filas()].find((f) => f.querySelector('.nombre').textContent === nombre)
    await waitFor(() => {
      expect(fila('Eva Visita').textContent).toContain('1 pts')
      expect(fila('Fede Visita').textContent).toContain('2 faltas')
    })
    await user.click(screen.getByRole('button', { name: /Halcones/ }))
    await waitFor(() => {
      expect(fila('Ana Activa').textContent).toContain('2 pts')
      expect(fila('Beto Sinflag').textContent).toContain('1 falta')
    })
    sinPrototipos()
  })
})

describe('Consola — nombre en camiseta e insignia de partido finalizado', () => {
  const sembrarCamisetas = (db) =>
    db.jugadores.bulkPut([
      jug('l1', 'eL', 4, 'Ana Activa', { nombreCamiseta: 'ANITA' }),
      jug('l2', 'eL', 7, 'Beto Sinflag', { nombreCamiseta: '   ' }),
      // l3 queda sin el campo: ficha anterior a esta función.
    ])
  const filaDe = (dorsal) => [...filas()].find((f) => f.querySelector('.dorsal')?.textContent === String(dorsal))

  it('la tarjeta, las etiquetas accesibles y el dorsal usan el nombre en camiseta, con respaldo al nombre', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await sembrarCamisetas(db)
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    await waitFor(() => expect(filaDe(4)).toBeTruthy())

    expect(filaDe(4).querySelector('.nombre').textContent).toBe('ANITA')
    expect(filaDe(4).querySelector('.dorsal').textContent).toBe('4')
    expect(screen.getByRole('button', { name: 'ANITA más 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Falta de ANITA' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Ana Activa/ })).toBeNull()

    expect(filaDe(7).querySelector('.nombre').textContent).toBe('Beto Sinflag')
    expect(screen.getByRole('button', { name: 'Beto Sinflag más 2' })).toBeTruthy()
    expect(filaDe(9).querySelector('.nombre').textContent).toBe('Carla Explicita')
    expect(screen.getByRole('button', { name: 'Falta de Carla Explicita' })).toBeTruthy()
  })

  it('los avisos y el historial usan el nombre visible y el evento sigue atribuido al mismo jugadorId', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await sembrarCamisetas(db)
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    const user = userEvent.setup()
    await waitFor(() => expect(filaDe(4)).toBeTruthy())

    await user.click(screen.getByRole('button', { name: 'ANITA más 2' }))
    expect(await screen.findByText('ANITA +2')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Falta de ANITA' }))
    expect(await screen.findByText('Falta de ANITA (1)')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Beto Sinflag más 3' }))
    expect(await screen.findByText('Beto Sinflag +3')).toBeTruthy()

    const guardados = (await db.eventos.toArray()).sort((a, b) => a.seq - b.seq)
    expect(guardados.map((e) => [e.tipo, e.jugadorId, e.equipoId])).toEqual([
      ['punto', 'l1', 'eL'], ['falta', 'l1', 'eL'], ['punto', 'l2', 'eL'],
    ])
    const nombresEnHistorial = () => [...document.querySelectorAll('.registro .ev .quien')].map((n) => n.textContent)
    await waitFor(() => expect(nombresEnHistorial()).toHaveLength(3))
    const quienes = nombresEnHistorial()
    expect(quienes).toEqual(expect.arrayContaining(['ANITA', 'Beto Sinflag']))
    expect(quienes).not.toContain('Ana Activa')
    const ficha = await db.jugadores.get('l1')
    expect(ficha.nombre).toBe('Ana Activa')
    expect(ficha.personaId).toBe('p-l1')
  })

  it('el historial de un jugador inactivo conserva su nombre visible', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.jugadores.update('l4', { nombreCamiseta: 'DARIO' })
    await db.eventos.add({
      id: 'h1', partidoId: 'p1', seq: 1, tipo: 'punto', equipoId: 'eL', jugadorId: 'l4',
      puntos: 2, periodo: 1, anulado: false, creadoEn: 1,
    })
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    await waitFor(() => expect(document.querySelectorAll('.registro .ev')).toHaveLength(1))
    expect(document.querySelector('.registro .ev .quien').textContent).toBe('DARIO')
  })

  it('un partido finalizado muestra la insignia persistente junto al marcador, y no impide corregir', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.partidos.update('p1', { estado: 'final' })
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })

    const insignia = await screen.findByText('Partido finalizado')
    expect(insignia.closest('.cabecera')).toBeTruthy()
    expect(insignia.textContent).toBe('Partido finalizado')
    expect(screen.queryByRole('button', { name: 'Cerrar el partido' })).toBeNull()
    // Sin controles del reloj, pero el reloj detenido sigue visible.
    expect(document.querySelector('.reloj-consola').textContent).toBe('10:00')
    expect(screen.getByRole('button', { name: /Deshacer/ })).toBeTruthy()
  })

  it('no aparece en un partido programado ni vivo', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    expect(screen.queryByText('Partido finalizado')).toBeNull()
    cleanup()
    await db.partidos.update('p1', { estado: 'programado' })
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    expect(screen.queryByText('Partido finalizado')).toBeNull()
  })

  it('un partido finalizado sigue rechazando anotar', async () => {
    const { Consola, db } = await cargar()
    await sembrar(db)
    await db.partidos.update('p1', { estado: 'final' })
    renderConsola(Consola)
    await screen.findByRole('heading', { name: 'Consola del árbitro' })
    const user = userEvent.setup()
    await waitFor(() => expect(filaDe(4)).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'Ana Activa más 2' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/ya terminó/)
    expect(await db.eventos.count()).toBe(0)
  })
})
