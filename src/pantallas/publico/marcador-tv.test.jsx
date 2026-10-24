/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AppCompartida from '../../AppCompartida'
import { partidoLiga, reloj, respuestaJuego, respuestaLiga, SERVIDOR_MS } from '../../lib/publico/datos-prueba.js'
import { olvidarMedios } from '../../lib/publico/medios.js'
import { VistaEntrePartidos } from './MarcadorTv.jsx'

// MARCADOR GRANDE (REPORT_191): medios del piloto, patrocinio, reconocimiento de canastas, vistas. Servidor falso; datos sintéticos.

const JSON_H = { 'content-type': 'application/json' }
const respuesta = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: JSON_H })
let llamadas
function servidor(rutas) {
  llamadas = []
  const fn = vi.fn(async (ruta, init) => {
    llamadas.push({ ruta, init })
    const h = rutas[ruta]
    if (h === undefined) return respuesta({ error: 'no-encontrado' }, 404)
    const r = typeof h === 'function' ? h(llamadas.filter((x) => x.ruta === ruta).length) : h
    return r instanceof Response ? r : respuesta(r)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const LIGA = '/v1/ligas/LIGAPUB1/publico'
const JUEGO = '/v1/ligas/LIGAPUB1/partidos/G1'
const MEDIOS = '/medios/manifest.json'
const liga = () => respuestaLiga({ partidos: [partidoLiga({ gameId: 'G1' })] })
const montar = (ruta = '/liga/LIGAPUB1/partido/G1') => render(<MemoryRouter initialEntries={[ruta]}><AppCompartida /></MemoryRouter>)
const FALSOS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance']
const avanzar = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  olvidarMedios()
  vi.stubEnv('VITE_MODO_COMPARTIDO', '1')
  vi.stubEnv('VITE_LIGAS_PUBLICAS', 'LIGAPUB1')
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); olvidarMedios() })

describe('medios del piloto y patrocinio', () => {
  it('sin manifiesto: promoción de Semabel en la banda, sin imágenes y SIN patrocinadores de ejemplo', async () => {
    servidor({ [LIGA]: liga(), [JUEGO]: respuestaJuego() })
    montar()
    await screen.findByLabelText('Puntos de Alfa Norte')
    expect(document.querySelectorAll('.sb-tv img').length).toBe(0)
    expect(screen.getAllByText('semabel.com').length).toBeGreaterThan(1) // marca + tarjetas de Semabel de la banda
    expect(document.querySelectorAll('.sb-band [data-origen="semabel"]').length).toBe(1) // sin patrocinadores: la diapositiva dedicada, UNA tarjeta a todo el ancho
    expect(document.querySelectorAll('.sb-band [data-patrocinador="semabel-banda"]').length).toBe(1)
    expect(document.querySelectorAll('.sb-band .sb-sponsor').length).toBe(1)
    for (const falso of ['El Puente', 'La Espiga', 'Cristalina', 'Visión Clara', 'Taller Ruiz', 'Vida Sana']) expect(screen.queryByText(falso)).toBeNull()
    expect(llamadas.some((l) => l.ruta.startsWith('http'))).toBe(false) // nada externo
  })

  it('con manifiesto de la liga: logos de equipo y del organizador, dos patrocinadores a la vez; las imágenes rotas caen a texto o a iniciales', async () => {
    servidor({
      [LIGA]: liga(), [JUEGO]: respuestaJuego(),
      [MEDIOS]: { version: 1, ligas: { LIGAPUB1: {
        organizador: { logo: 'L/org.png' }, equipos: { E1: { logo: 'L/e1.png' }, E2: { color: '#6A1B9A' } },
        patrocinadores: [{ id: 'a', nombre: 'Agua Pura', imagen: 'L/a.png' }, { id: 'b', nombre: 'Panadería', imagen: 'L/b.png' }, { id: 'c', imagen: 'L/c.png' }],
      } } },
    })
    montar()
    await screen.findByLabelText('Puntos de Alfa Norte')
    await act(async () => { await Promise.resolve() })
    const imgs = [...document.querySelectorAll('.sb-tv img')].map((i) => i.getAttribute('src'))
    expect(imgs).toEqual(expect.arrayContaining(['/medios/L/org.png', '/medios/L/e1.png', '/medios/L/a.png', '/medios/L/b.png', '/medios/L/c.png']))
    expect(document.querySelectorAll('.sb-band [data-formato="arte"]').length).toBe(3) // entradas del REPORT_191 (con imagen) = arte terminado
    const diapositivas = [...document.querySelectorAll('.sb-band .sb-rotator__slide')]
    expect(diapositivas.length).toBe(3) // (a, b), (c, Semabel espectador) y la diapositiva dedicada de Semabel
    expect(diapositivas.slice(0, -1).every((d) => d.querySelectorAll('.sb-sponsor').length === 2)).toBe(true)
    expect(diapositivas[2].querySelectorAll('.sb-sponsor').length).toBe(1) // la dedicada de Semabel: una tarjeta
    expect(document.querySelector('.sb-team[data-side="away"]').style.getPropertyValue('--team-color')).toBe('#6A1B9A') // color por equipo configurado
    // imagen de patrocinador rota con nombre: queda el nombre; sin nombre: la promoción de Semabel; logo de equipo roto: iniciales
    fireEvent.error(document.querySelector('img[src="/medios/L/a.png"]'))
    expect(screen.getByText('Agua Pura', { selector: '.sb-sponsor__name' })).toBeTruthy() // con nombre: tarjeta estructurada
    fireEvent.error(document.querySelector('img[src="/medios/L/c.png"]'))
    expect(document.querySelector('[data-patrocinador="c"]')).toBeNull() // sin nombre: toma su lugar la promoción de Semabel
    expect(document.querySelector('.sb-band [data-patrocinador="semabel-organizador"]')).not.toBeNull()
    fireEvent.error(document.querySelector('img[src="/medios/L/e1.png"]'))
    expect(document.querySelector('img[src="/medios/L/e1.png"]')).toBeNull()
    expect(document.querySelector('.sb-team[data-side="home"] .sb-crest').textContent).toBe('AN') // iniciales de «Alfa Norte»
    expect(document.querySelectorAll('.sb-crest--img').length).toBe(0)
  })

  it('un manifiesto roto, de otra liga o con rutas externas no muestra ni pide nada ajeno', async () => {
    servidor({ [LIGA]: liga(), [JUEGO]: respuestaJuego(), [MEDIOS]: { version: 1, ligas: { OTRA: { patrocinadores: [{ id: 'x', nombre: 'Ajeno' }] }, LIGAPUB1: { organizador: { logo: 'https://x.com/o.png' }, equipos: { E1: { logo: '//x.com/e.png' } }, patrocinadores: [{ id: 'y', imagen: 'http://x.com/a.png' }] } } } })
    montar()
    await screen.findByLabelText('Puntos de Alfa Norte')
    await act(async () => { await Promise.resolve() })
    expect(document.querySelectorAll('.sb-tv img').length).toBe(0)
    expect(screen.queryByText('Ajeno')).toBeNull()
  })

  it('la banda rota cada 12 s, de dos en dos, y no cambia sus medidas lógicas', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    servidor({ [LIGA]: liga(), [JUEGO]: respuestaJuego(), [MEDIOS]: { version: 1, ligas: { LIGAPUB1: { patrocinadores: ['a', 'b', 'c', 'd'].map((id) => ({ id, nombre: `Patrocinador ${id}` })) } } } })
    montar()
    await avanzar(50)
    const activa = () => [...document.querySelectorAll('.sb-band .sb-rotator__slide')].findIndex((d) => d.dataset.active === 'true')
    expect(document.querySelectorAll('.sb-band .sb-rotator__slide').length).toBe(3) // (a, b), (c, d) y la dedicada de Semabel
    expect(activa()).toBe(0)
    await avanzar(11_000)
    expect(activa()).toBe(0)
    await avanzar(1_100)
    expect(activa()).toBe(1)
    await avanzar(12_000)
    expect(activa()).toBe(2) // la diapositiva de Semabel
    await avanzar(12_000)
    expect(activa()).toBe(0) // y el ciclo vuelve a empezar
  })

  it('la lectura de medios es una sola y de mismo origen; el CSS respeta prefers-reduced-motion', async () => {
    servidor({ [LIGA]: liga(), [JUEGO]: respuestaJuego() })
    montar()
    await screen.findByLabelText('Puntos de Alfa Norte')
    expect(llamadas.filter((l) => l.ruta === MEDIOS).length).toBe(1)
    expect(llamadas.find((l) => l.ruta === MEDIOS).init.credentials).toBe('omit')
    const css = readFileSync(join(import.meta.dirname, 'marcador-tv.css'), 'utf8')
    const bloque = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(bloque).toMatch(/\.sb-rotator__slide[\s\S]*transition: none/)
    expect(bloque).toMatch(/\.sb-notice[\s\S]*animation: none/)
    expect(css).not.toMatch(/https?:\/\//) // sin fuentes ni imágenes externas
  })
})

describe('reconocimiento de canastas confirmadas', () => {
  const an = (seq, nombre = 'Ana Prueba', puntos = 2, lado = 'local') => ({ seq, lado, puntos, jugador: { nombre, dorsalActual: 5 } })
  const lecturas = (lista) => { let n = 0; return () => { const l = lista[Math.min(n, lista.length - 1)]; n += 1; return respuesta(l instanceof Response ? l : respuestaJuego({ reloj: reloj('corriendo', 300000, SERVIDOR_MS), ...l })) } }
  const aviso = () => document.querySelector('.sb-notice')

  it('línea base sin aviso; canasta nueva con jugador, puntos y equipo; se desvanece a los 4 s; sondeos repetidos no la repiten', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    servidor({ [LIGA]: liga(), [JUEGO]: lecturas([{ anotaciones: [an(1, 'Saúl Montero', 3, 'visita')] }, { anotaciones: [an(1, 'Saúl Montero', 3, 'visita')] }, { anotaciones: [an(2), an(1, 'Saúl Montero', 3, 'visita')], local: { id: 'E1', nombre: 'Alfa Norte', puntos: 14, faltas: 3 } }]) })
    montar()
    await avanzar(50)
    expect(aviso()).toBeNull() // lo que ya existía al abrir no se anuncia
    await avanzar(5_000)
    expect(aviso()).toBeNull()
    await avanzar(5_000) // llega la canasta nueva
    expect(aviso().textContent).toBe('#5 Ana Prueba · +2 puntos · Alfa Norte')
    expect(aviso().dataset.visible).toBe('true')
    await avanzar(4_100)
    expect(aviso().dataset.visible).toBe('false') // desvanece
    await avanzar(1_000)
    expect(aviso()).toBeNull()
    await avanzar(15_000) // sondeos repetidos con la misma lista
    expect(aviso()).toBeNull()
  })

  it('no mueve el marcador: el número, el reloj y la banda siguen en el DOM con y sin aviso', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    servidor({ [LIGA]: liga(), [JUEGO]: lecturas([{ anotaciones: [] }, { anotaciones: [an(1)], local: { id: 'E1', nombre: 'Alfa Norte', puntos: 14, faltas: 3 } }]) })
    montar()
    await avanzar(50)
    const forma = () => [...document.querySelectorAll('.sb-team, .sb-center, .sb-band')].map((e) => e.tagName + e.className)
    const sin = forma()
    await avanzar(5_100)
    expect(aviso()).not.toBeNull()
    expect(forma()).toEqual(sin)
    expect(screen.getByLabelText('Puntos de Alfa Norte').textContent).toBe('14')
  })

  it('deshacer retira el aviso visible; rehacer no lo repite; dos canastas en un sondeo: la más nueva', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    servidor({ [LIGA]: liga(), [JUEGO]: lecturas([{ anotaciones: [] }, { anotaciones: [an(3, 'Eva Visita', 3, 'visita'), an(2, 'Ana Prueba'), an(1, 'Luz Mar')] }, { anotaciones: [an(2, 'Ana Prueba'), an(1, 'Luz Mar')] }, { anotaciones: [an(3, 'Eva Visita', 3, 'visita'), an(2, 'Ana Prueba'), an(1, 'Luz Mar')] }]) })
    montar()
    await avanzar(50)
    await avanzar(5_100)
    expect(aviso().textContent).toBe('#5 Eva Visita · +3 puntos · Beta Sur') // la más nueva; la visita lleva el nombre de su equipo
    await avanzar(5_000) // deshacer: la 3 desaparece (el aviso ya se había desvanecido, no queda nada)
    expect(aviso()).toBeNull()
    await avanzar(5_000) // rehacer: mismo seq, ya anunciado
    expect(aviso()).toBeNull()
  })

  it('deshacer ANTES de que se desvanezca lo retira de inmediato', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    servidor({ [LIGA]: liga(), [JUEGO]: lecturas([{ anotaciones: [] }, { anotaciones: [an(1)] }, { anotaciones: [] }]) })
    montar()
    await avanzar(50)
    await avanzar(5_100)
    expect(aviso()).not.toBeNull()
    await avanzar(5_000) // el siguiente sondeo ya no trae la canasta (deshacer)
    expect(aviso()).toBeNull()
  })

  it('un fallo de lectura entre sondeos: lo ocurrido mientras tanto NO se anuncia', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    let n = 0
    servidor({ [LIGA]: liga(), [JUEGO]: () => {
      n += 1
      if (n === 2) throw new TypeError('sin red')
      return respuesta(respuestaJuego({ reloj: reloj('corriendo', 300000, SERVIDOR_MS), anotaciones: n === 1 ? [an(1)] : [an(2), an(1)] }))
    } })
    montar()
    await avanzar(50)
    for (let i = 0; i < 6; i += 1) await avanzar(10_000)
    expect(n).toBeGreaterThan(2)
    expect(aviso()).toBeNull() // la canasta 2 ocurrió durante el fallo: se ve en el marcador, no como aviso
  })

  it('sin anotaciones en la respuesta (servidor anterior) o malformadas: el marcador funciona sin avisos', async () => {
    servidor({ [LIGA]: liga(), [JUEGO]: respuestaJuego({ anotaciones: 'roto' }) })
    montar()
    expect(await screen.findByLabelText('Puntos de Alfa Norte')).toBeTruthy()
    expect(aviso()).toBeNull()
  })

  it('un partido que no está en juego nunca muestra avisos', async () => {
    servidor({ [LIGA]: liga(), [JUEGO]: respuestaJuego({ estado: 'final', reloj: reloj('detenido', 0), anotaciones: [an(9)] }) })
    montar()
    await screen.findByText('Resultado final')
    expect(aviso()).toBeNull()
  })
})

describe('vistas: entre partidos, nombres largos y tres dígitos', () => {
  it('final: resultado de ESE partido en la misma dirección, tarjeta honesta de calendario (no promete un próximo partido), promoción del espectador', async () => {
    servidor({ [LIGA]: liga(), [JUEGO]: respuestaJuego({ estado: 'final', reloj: reloj('detenido', 0), local: { id: 'E1', nombre: 'Alfa Norte', puntos: 71, faltas: 3 }, visita: { id: 'E2', nombre: 'Beta Sur', puntos: 64, faltas: 4 } }) })
    montar()
    expect(await screen.findByText('Resultado final')).toBeTruthy()
    expect(screen.getByLabelText('Puntos de Alfa Norte').textContent).toBe('71')
    expect(document.querySelector('[data-winner="true"]').textContent).toContain('Alfa Norte')
    expect(screen.queryByText('Próximo partido')).toBeNull()
    expect(document.querySelector('[data-sin-proximo="true"]')).not.toBeNull()
    expect(screen.getByText('La emoción está en la cancha. La historia sigue aquí.')).toBeTruthy()
    expect(screen.getByText('Sigue los marcadores, descubre a los protagonistas y comparte tu equipo.')).toBeTruthy()
    expect(screen.getByText('semabel.com · Sin cuenta para mirar.')).toBeTruthy()
    expect(screen.queryByLabelText('Reloj del partido')).toBeNull()
  })

  it('empate: ningún lado se marca como ganador', async () => {
    servidor({ [LIGA]: liga(), [JUEGO]: respuestaJuego({ estado: 'final', reloj: reloj('detenido', 0), local: { id: 'E1', nombre: 'Alfa Norte', puntos: 50, faltas: 3 }, visita: { id: 'E2', nombre: 'Beta Sur', puntos: 50, faltas: 4 } }) })
    montar()
    await screen.findByText('Resultado final')
    expect(document.querySelectorAll('[data-winner="true"]').length).toBe(0)
  })

  it('descanso: promoción del organizador del v0, con equipos y marcador a la vista', async () => {
    servidor({ [LIGA]: liga(), [JUEGO]: respuestaJuego({ reloj: reloj('detenido', 0), periodo: 2 }) })
    montar()
    expect(await screen.findByText('Descanso entre períodos')).toBeTruthy()
    expect(screen.getByText('Tu torneo merece quedar en la historia.')).toBeTruthy()
    expect(screen.getByText('Organiza el calendario, lleva el marcador desde tu teléfono y comparte cada partido.')).toBeTruthy()
    expect(screen.getByText('Alfa Norte', { selector: '.sb-compact__name' })).toBeTruthy()
    expect(screen.getByLabelText('Puntos de Beta Sur').textContent).toBe('9')
  })

  it('el cambio de vista sale SOLO del estado confirmado: pausa → juego; 00:00 confirmado → descanso; período nuevo → juego', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    const pasos = [
      respuestaJuego({ reloj: reloj('detenido', 250000) }),
      respuestaJuego({ reloj: reloj('detenido', 0), periodo: 2 }),
      respuestaJuego({ reloj: reloj('detenido', 600000), periodo: 3 }),
    ]
    let n = 0
    servidor({ [LIGA]: liga(), [JUEGO]: () => respuesta(pasos[Math.min(n++, pasos.length - 1)]) })
    montar()
    await avanzar(50)
    const vista = () => document.querySelector('.sb-app').dataset.vista
    expect(vista()).toBe('juego')
    await avanzar(5_100)
    expect(vista()).toBe('fin-periodo')
    await avanzar(5_100)
    expect(vista()).toBe('juego')
    expect(screen.getByText('3.er cuarto')).toBeTruthy()
  })

  it('un reloj que el dispositivo cuenta hasta 00:00 NO cambia a descanso: «Esperando confirmación»', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    const t0 = performance.now()
    servidor({ [LIGA]: liga(), [JUEGO]: () => {
      const servidorAhoraMs = SERVIDOR_MS + Math.round(performance.now() - t0)
      return respuesta(respuestaJuego({ servidorAhoraMs, reloj: reloj('corriendo', 4000, servidorAhoraMs) }))
    } })
    montar()
    await avanzar(50)
    expect(document.querySelector('.sb-app').dataset.vista).toBe('juego')
    await avanzar(4_200)
    expect(screen.getByLabelText('Reloj del partido').textContent).toBe('00:00')
    expect(document.querySelector('.sb-app').dataset.vista).toBe('juego') // el servidor aún no confirmó
    expect(document.querySelector('.sb-clock-status').textContent).toContain('Esperando confirmación')
    expect(screen.queryByText('Descanso entre períodos')).toBeNull()
  })

  it('nombres largos, tres dígitos y 100+ en cualquiera de los lados: el número recibe los dígitos y los nombres se parten, no se pierden', async () => {
    servidor({ [LIGA]: liga(), [JUEGO]: respuestaJuego({ local: { id: 'E1', nombre: 'Club Atlético Halcones de San Miguelito', puntos: 104, faltas: 3 }, visita: { id: 'E2', nombre: 'Deportivo Unión Juventud del Norte', puntos: 98, faltas: 4 } }) })
    montar()
    await screen.findByLabelText('Puntos de Club Atlético Halcones de San Miguelito')
    expect(screen.getByLabelText('Puntos de Club Atlético Halcones de San Miguelito').textContent).toBe('104')
    expect(document.querySelector('.sb-team').style.getPropertyValue('--d')).toBe('3')
    expect(document.querySelector('.sb-team[data-side="away"]').style.getPropertyValue('--d')).toBe('3') // el mayor manda para AMBOS
    expect(screen.getByText('Deportivo Unión Juventud del Norte', { selector: 'h2 a' })).toBeTruthy()
    expect(document.querySelector('.sb-team__name[data-long="true"]')).not.toBeNull()
  })

  it('«fin-tiempo» del último periodo no se presenta como resultado final', async () => {
    servidor({ [LIGA]: liga(), [JUEGO]: respuestaJuego({ reloj: reloj('detenido', 0), periodo: 4 }) })
    montar()
    expect(await screen.findByText('Resultado por confirmar')).toBeTruthy()
    expect(screen.queryByText('Resultado final')).toBeNull()
    expect(screen.queryByText('Descanso entre períodos')).toBeNull()
  })

  it('sin conexión: el aviso «Sin actualizar» se ve en el encabezado y la vista no cambia sola', async () => {
    vi.useFakeTimers({ toFake: FALSOS })
    let caida = false
    const t0 = performance.now()
    servidor({ [LIGA]: liga(), [JUEGO]: () => {
      if (caida) throw new TypeError('sin red')
      const servidorAhoraMs = SERVIDOR_MS + Math.round(performance.now() - t0)
      return respuesta(respuestaJuego({ servidorAhoraMs, reloj: reloj('corriendo', 300000, servidorAhoraMs) }))
    } })
    montar()
    await avanzar(50)
    caida = true
    await avanzar(130_000)
    expect(document.querySelector('.sb-stale').textContent).toMatch(/^Sin actualizar/)
    expect(document.querySelector('.sb-app').dataset.vista).toBe('juego')
  })
})

describe('VistaEntrePartidos con próximo partido determinado', () => {
  it('muestra el próximo partido solo cuando quien monta el marcador lo entrega ya resuelto', () => {
    const d = respuestaJuego({ estado: 'final', reloj: reloj('detenido', 0) })
    const ctx = { vista: 'final', medios: { equipos: {}, patrocinadores: [], organizador: { logo: null } }, color: { local: '#111', visita: '#222' } }
    const cab = { marca: 'Liga', categoria: null, fecha: null, sede: null, logo: null, sinActualizar: null }
    const { rerender } = render(<VistaEntrePartidos cab={cab} d={d} ctx={ctx} categoria="Categoría Adulto" proximo={{ local: 'Gama', visita: 'Delta', hora: '7:30 p. m.', categoria: 'Categoría Adulto' }} />)
    expect(screen.getByText('Próximo partido')).toBeTruthy()
    expect(screen.getByText('7:30 p. m.')).toBeTruthy()
    expect(document.querySelector('.sb-next__aprox')).toBeNull() // sin la marca del que lo resuelve, nada se añade
    rerender(<VistaEntrePartidos cab={cab} d={d} ctx={ctx} categoria="Categoría Adulto" proximo={{ local: 'Gama', visita: 'Delta', hora: '7:30 p. m.', aprox: true, categoria: 'Categoría Adulto' }} />)
    expect(document.querySelector('.sb-next__time + .sb-next__aprox').textContent).toBe('aprox.') // REPORT_228: también en la página pública del partido
    rerender(<VistaEntrePartidos cab={cab} d={d} ctx={ctx} categoria="Categoría Adulto" proximo={null} />)
    expect(screen.queryByText('Próximo partido')).toBeNull()
    expect(document.querySelector('[data-sin-proximo="true"]')).not.toBeNull()
  })
})

describe('CSS del marcador grande: acotado a su propia pantalla', () => {
  const css = readFileSync(join(import.meta.dirname, 'marcador-tv.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  // Selectores de cada regla (también dentro de @media); los de @keyframes no son selectores.
  const reglas = []
  const leer = (texto) => {
    let i = 0
    while (i < texto.length) {
      const j = texto.indexOf('{', i)
      if (j < 0) break
      const cabecera = texto.slice(i, j).trim()
      let hondo = 1; let k = j + 1
      while (hondo) { if (texto[k] === '{') hondo += 1; else if (texto[k] === '}') hondo -= 1; k += 1 }
      const cuerpo = texto.slice(j + 1, k - 1)
      if (cabecera.startsWith('@media')) leer(cuerpo)
      else if (!cabecera.startsWith('@keyframes')) reglas.push(cabecera)
      i = k
    }
  }
  leer(css)
  it('toda regla cuelga de clases «sb-» (o de la fila de la página del marcador): no toca Inicio, organizador, consola ni prototipo', () => {
    expect(reglas.length).toBeGreaterThan(100)
    const sueltas = reglas.flatMap((r) => r.split(',').map((s) => s.trim())).filter((s) => !/\.sb-/.test(s) && !s.startsWith('.app:has(.board-pagina.sb-app)'))
    expect(sueltas).toEqual([])
  })
  it('las reglas globales no modifican body, html, *, ni las clases de la app (.btn, .card, .board…)', () => {
    const todo = reglas.join('\n')
    expect(todo).not.toMatch(/(^|[\s,])(body|html|\*|:root)\b/m)
    for (const clase of ['.btn {', '.card', '.board {', '.publico {', '.tv-', '.hm-']) expect(reglas.some((r) => r.trim() === clase.trim())).toBe(false)
  })
})


describe('patrocinio: tarjeta estructurada y arte terminado (REPORT_192)', () => {
  const servir = (patrocinadores, juego = respuestaJuego()) => servidor({ [LIGA]: liga(), [JUEGO]: juego, [MEDIOS]: { version: 1, ligas: { LIGAPUB1: { patrocinadores } } } })
  const banda = () => [...document.querySelectorAll('.sb-band .sb-sponsor')]
  const pintar = async (juego) => { montar(); await screen.findByLabelText('Puntos de Alfa Norte'); await act(async () => { await Promise.resolve() }); return juego }

  it('tarjeta con logo: rubro en el color de acento, nombre grande, logo con su proporción y los colores de la marca', async () => {
    servir([{ id: 'p', formato: 'tarjeta', nombre: 'El Puente', descriptor: 'Ferretería', logo: 'L/logo.png', fondo: '#1C2B3A', texto: '#FFFFFF', acento: '#F2B33D', borde: false }])
    await pintar()
    const t = document.querySelector('.sb-band [data-patrocinador="p"]')
    expect(t.dataset.formato).toBe('tarjeta')
    expect(t.style.backgroundColor).toBe('rgb(28, 43, 58)')
    expect(t.style.color).toBe('rgb(255, 255, 255)')
    expect(t.querySelector('.sb-sponsor__descriptor').textContent).toBe('Ferretería')
    expect(t.querySelector('.sb-sponsor__descriptor').style.color).toBe('rgb(242, 179, 61)')
    expect(t.querySelector('.sb-sponsor__name').textContent).toBe('El Puente')
    expect(t.querySelector('.sb-sponsor__name').dataset.largo).toBe('corto')
    expect(t.querySelector('img.sb-sponsor__logo').getAttribute('src')).toBe('/medios/L/logo.png')
    expect(t.classList.contains('sb-sponsor--bordered')).toBe(false)
  })

  it('tarjeta sin logo: sin hueco de marca; con logo roto: la marca desaparece y el resto sigue; borde solo si se pide', async () => {
    servir([{ id: 'a', formato: 'tarjeta', nombre: 'Sin Logo', fondo: '#FFFFFF', borde: true }, { id: 'b', formato: 'tarjeta', nombre: 'Logo Roto', logo: 'L/roto.png' }])
    await pintar()
    const a = document.querySelector('[data-patrocinador="a"]')
    expect(a.querySelector('.sb-sponsor__mark')).toBeNull()
    expect(a.querySelector('.sb-sponsor__descriptor')).toBeNull()
    expect(a.classList.contains('sb-sponsor--bordered')).toBe(true)
    fireEvent.error(document.querySelector('img[src="/medios/L/roto.png"]'))
    const b = document.querySelector('[data-patrocinador="b"]')
    expect(b.querySelector('img')).toBeNull()
    expect(b.querySelector('.sb-sponsor__name').textContent).toBe('Logo Roto')
  })

  it('el nombre largo se reduce por longitud y siempre está completo en el DOM', async () => {
    const largo = 'Ferretería y Materiales de Construcción El Puente Grande'
    servir([{ id: 'a', formato: 'tarjeta', nombre: 'Casa Ejemplo Uno' }, { id: 'b', formato: 'tarjeta', nombre: 'Panadería La Espiga Real' }, { id: 'c', formato: 'tarjeta', nombre: largo }, { id: 'd', formato: 'tarjeta', nombre: 'El Puente' }])
    await pintar()
    const clase = (id) => document.querySelector(`[data-patrocinador="${id}"] .sb-sponsor__name`)
    expect([clase('d').dataset.largo, clase('a').dataset.largo, clase('b').dataset.largo, clase('c').dataset.largo]).toEqual(['corto', 'medio', 'largo', 'xl'])
    expect(clase('c').textContent).toBe(largo)
  })

  it('contraste: un texto ilegible sobre el fondo se corrige; un texto con HTML se escribe como texto', async () => {
    servir([{ id: 'a', formato: 'tarjeta', nombre: '<img src=x onerror=alert(1)>', fondo: '#FFFFFF', texto: '#FFFFFE' }])
    await pintar()
    const t = document.querySelector('[data-patrocinador="a"]')
    expect(t.style.color).toBe('rgb(18, 21, 28)')
    expect(t.querySelector('.sb-sponsor__name').textContent).toBe('<img src=x onerror=alert(1)>')
    expect(t.querySelector('.sb-sponsor__name img')).toBeNull()
  })

  it('arte terminado: la imagen se muestra entera sobre su fondo, sin texto añadido; en la banda usa «imagen» y en los descansos y el final «imagenGrande»', async () => {
    servir([{ id: 'a', formato: 'arte', nombre: 'Arte', imagen: 'L/banda.png', imagenGrande: 'L/grande.png', fondo: '#1C2B3A' }, { id: 'b', formato: 'arte', imagen: 'L/solo.png' }])
    await pintar()
    const a = document.querySelector('.sb-band [data-patrocinador="a"]')
    expect(a.dataset.formato).toBe('arte')
    expect(a.style.backgroundColor).toBe('rgb(28, 43, 58)')
    expect(a.querySelector('img').getAttribute('src')).toBe('/medios/L/banda.png')
    expect(a.querySelector('.sb-sponsor__name')).toBeNull() // el arte no lleva texto de Semabel encima
    expect(document.querySelector('.sb-band [data-patrocinador="b"]').style.backgroundColor).toBe('rgb(255, 255, 255)')
    cleanup()
    olvidarMedios()
    servir([{ id: 'a', formato: 'arte', imagen: 'L/banda.png', imagenGrande: 'L/grande.png' }], respuestaJuego({ estado: 'final', reloj: reloj('detenido', 0) }))
    montar()
    await screen.findByText('Resultado final')
    await act(async () => { await Promise.resolve() })
    const g = document.querySelector('.sb-stage [data-patrocinador="a"] img')
    expect(g.getAttribute('src')).toBe('/medios/L/grande.png')
  })

  it('arte que falla: prueba la siguiente imagen y, si todas fallan, la tarjeta con su nombre o la promoción de Semabel', async () => {
    servir([{ id: 'a', formato: 'arte', nombre: 'Con Nombre', descriptor: 'Rubro', imagen: 'L/a.png', fondo: '#232323', texto: '#FFD23F', acento: '#FFD23F' }, { id: 'b', formato: 'arte', imagen: 'L/b.png' }])
    await pintar()
    fireEvent.error(document.querySelector('img[src="/medios/L/a.png"]'))
    const a = document.querySelector('.sb-band [data-patrocinador="a"]')
    expect(a.dataset.formato).toBe('tarjeta')
    expect(a.querySelector('.sb-sponsor__name').textContent).toBe('Con Nombre')
    expect(a.style.backgroundColor).toBe('rgb(35, 35, 35)')
    fireEvent.error(document.querySelector('img[src="/medios/L/b.png"]'))
    expect(document.querySelector('.sb-band [data-patrocinador="b"]')).toBeNull()
    expect(document.querySelector('.sb-band [data-origen="semabel"]')).not.toBeNull()
  })

  it('en un teléfono el arte usa «imagenGrande» (la banda es casi 2:1) y en el televisor «imagen»', async () => {
    const original = window.matchMedia
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }))
    try {
      servir([{ id: 'a', formato: 'arte', imagen: 'L/banda.png', imagenGrande: 'L/grande.png' }])
      await pintar()
      expect(document.querySelector('.sb-band [data-patrocinador="a"] img').getAttribute('src')).toBe('/medios/L/grande.png')
    } finally { window.matchMedia = original }
  })

  it('organizador y Semabel usan el MISMO componente: la misma estructura de tarjeta con sus colores', async () => {
    servir([{ id: 'a', formato: 'tarjeta', nombre: 'Casa Ejemplo', descriptor: 'Rubro' }, { id: 'b', formato: 'tarjeta', nombre: 'Otra Casa' }, { id: 'c', formato: 'tarjeta', nombre: 'Tercera' }])
    await pintar()
    const forma = (e) => [...e.querySelectorAll('*')].map((n) => n.className).join('|').replace(/sb-sponsor__mark/g, '').replace(/\|+/g, '|')
    const propio = document.querySelector('.sb-band [data-patrocinador="c"]')
    const semabel = document.querySelector('.sb-band [data-patrocinador="semabel-espectador"]') // la tarjeta que acompaña al último patrocinador (impar)
    expect(semabel.className).toBe(propio.className.replace('sb-sponsor--bordered', '').trim() + ' sb-sponsor--bordered')
    expect(semabel.querySelector('.sb-sponsor__descriptor').textContent).toBe('semabel.com')
    expect(semabel.querySelector('.sb-sponsor__name').textContent).toBe('La emoción está en la cancha. La historia sigue aquí.')
    expect(forma(semabel)).toContain('sb-sponsor__text')
  })
})


describe('tarjeta con el logo como protagonista (REPORT_194)', () => {
  const parm = { id: 'parm', formato: 'tarjeta', disposicion: 'logo', nombre: 'La Parmigiana', descriptor: 'Restaurante italiano', logo: 'PARM/parmigiana.jpeg', fondo: '#000000', texto: '#FFFFFF', acento: '#FFFFFF' }
  const servir = (patrocinadores, juego = respuestaJuego()) => servidor({ [LIGA]: liga(), [JUEGO]: juego, [MEDIOS]: { version: 1, ligas: { LIGAPUB1: { patrocinadores } } } })
  const pintar = async () => { montar(); await screen.findByLabelText('Puntos de Alfa Norte'); await act(async () => { await Promise.resolve() }) }

  it('el logo completo (sin repetir el nombre como título), el rubro como texto pintado, negro con texto blanco, nombre accesible', async () => {
    servir([parm])
    await pintar()
    const t = document.querySelector('.sb-band [data-patrocinador="parm"]')
    expect(t.dataset.disposicion).toBe('logo')
    expect(t.style.backgroundColor).toBe('rgb(0, 0, 0)')
    expect(t.style.color).toBe('rgb(255, 255, 255)')
    const img = t.querySelector('img.sb-sponsor__logo-grande')
    expect(img.getAttribute('src')).toBe('/medios/PARM/parmigiana.jpeg')
    expect(img.getAttribute('alt')).toBe('La Parmigiana') // el nombre existe como texto accesible
    expect(t.getAttribute('aria-label')).toBe('La Parmigiana')
    expect(t.querySelector('.sb-sponsor__name')).toBeNull() // no se repite como título
    expect(t.querySelector('.sb-sponsor__mark')).toBeNull() // ni se encaja en el hueco del icono
    expect(t.querySelector('.sb-sponsor__descriptor').textContent).toBe('Restaurante italiano')
    expect(t.querySelector('.sb-sponsor__descriptor').style.color).toBe('rgb(255, 255, 255)')
  })

  it('el mismo diseño en los descansos y el final (espacio grande)', async () => {
    servir([parm], respuestaJuego({ estado: 'final', reloj: reloj('detenido', 0) }))
    montar()
    await screen.findByText('Resultado final')
    await act(async () => { await Promise.resolve() })
    const t = document.querySelector('.sb-stage .sb-sponsor--large[data-patrocinador="parm"]')
    expect(t.dataset.disposicion).toBe('logo')
    expect(t.querySelector('.sb-sponsor__descriptor').textContent).toBe('Restaurante italiano')
    expect(t.querySelector('img').getAttribute('alt')).toBe('La Parmigiana')
  })

  it('si el logo falla se cae a la tarjeta normal con el nombre visible; sin la disposición la tarjeta es la de siempre', async () => {
    servir([parm, { ...parm, id: 'otra', disposicion: undefined, nombre: 'Tarjeta Normal', logo: 'PARM/otra.png' }])
    await pintar()
    const normal = document.querySelector('[data-patrocinador="otra"]')
    expect(normal.dataset.disposicion).toBeUndefined()
    expect(normal.querySelector('.sb-sponsor__name').textContent).toBe('Tarjeta Normal')
    fireEvent.error(document.querySelector('img[src="/medios/PARM/parmigiana.jpeg"]'))
    const t = document.querySelector('.sb-band [data-patrocinador="parm"]')
    expect(t.dataset.disposicion).toBeUndefined()
    expect(t.querySelector('.sb-sponsor__name').textContent).toBe('La Parmigiana')
    expect(t.querySelector('.sb-sponsor__descriptor').textContent).toBe('Restaurante italiano')
  })

  it('el logo se muestra entero: object-fit contain y sin límites que lo recorten (CSS)', () => {
    const css = readFileSync(join(import.meta.dirname, 'marcador-tv.css'), 'utf8')
    const regla = css.slice(css.indexOf('.sb-sponsor__logo-grande {'), css.indexOf('}', css.indexOf('.sb-sponsor__logo-grande {')))
    expect(regla).toMatch(/object-fit: contain/)
    expect(regla).not.toMatch(/object-fit: (cover|fill)/)
  })
})


describe('banda en vivo: rotación con 0, 1, 2, 5 y 6 patrocinadores (REPORT_196)', () => {
  const servir = (n) => servidor({ [LIGA]: liga(), [JUEGO]: respuestaJuego(), [MEDIOS]: { version: 1, ligas: { LIGAPUB1: { patrocinadores: Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, formato: 'tarjeta', nombre: `Marca ${i + 1}` })) } } } })
  const secuencia = () => [...document.querySelectorAll('.sb-band .sb-rotator__slide')].map((d) => [...d.querySelectorAll('.sb-sponsor')].map((t) => t.dataset.patrocinador))
  const activa = () => [...document.querySelectorAll('.sb-band .sb-rotator__slide')].findIndex((d) => d.dataset.active === 'true')
  const abrir = async (n) => { olvidarMedios(); vi.useFakeTimers({ toFake: FALSOS }); servir(n); montar(); await avanzar(50) }

  for (const [n, esperado] of [
    [0, [['semabel-banda']]],
    [1, [['s1', 'semabel-espectador'], ['semabel-banda']]],
    [2, [['s1', 's2'], ['semabel-banda']]],
    [5, [['s1', 's2'], ['s3', 's4'], ['s5', 'semabel-espectador'], ['semabel-banda']]],
    [6, [['s1', 's2'], ['s3', 's4'], ['s5', 's6'], ['semabel-banda']]],
  ]) {
    it(`${n} patrocinadores: ${esperado.length} diapositiva(s), sin perder ninguno, con la diapositiva dedicada de Semabel al final`, async () => {
      await abrir(n)
      expect(secuencia()).toEqual(esperado)
      const propios = secuencia().flat().filter((id) => id.startsWith('s') && !id.startsWith('semabel'))
      expect(propios).toEqual(Array.from({ length: n }, (_, i) => `s${i + 1}`)) // todos, en su orden, una sola vez
      expect(secuencia()[secuencia().length - 1]).toEqual(['semabel-banda']) // la dedicada: una sola tarjeta de todo el ancho
    })
  }

  it('el ciclo avanza cada 12 s por todas las diapositivas (5 patrocinadores: 4 diapositivas) y vuelve a empezar; con 0 no hay temporizador', async () => {
    await abrir(5)
    const vistas = []
    for (let i = 0; i < 5; i += 1) { vistas.push(activa()); await avanzar(12_000) }
    expect(vistas).toEqual([0, 1, 2, 3, 0])
    cleanup()
    await abrir(0)
    expect(document.querySelectorAll('.sb-band .sb-rotator__slide').length).toBe(1)
    await avanzar(60_000)
    expect(activa()).toBe(0)
  })

  it('6 patrocinadores: cada diapositiva normal muestra exactamente dos tarjetas y la última es la tarjeta única de Semabel', async () => {
    await abrir(6)
    expect(secuencia().slice(0, -1).every((par) => par.length === 2)).toBe(true)
    expect(secuencia()[3].length).toBe(1)
    const vistas = []
    for (let i = 0; i < 5; i += 1) { vistas.push(activa()); await avanzar(12_000) }
    expect(vistas).toEqual([0, 1, 2, 3, 0])
  })
})

describe('logo real de Semabel en las promociones (REPORT_196)', () => {
  const LOGO = '/medios/SMB/semabel-logo.png'
  const servir = (juego = respuestaJuego(), manifiesto = { version: 1, semabel: { logo: 'SMB/semabel-logo.png' }, ligas: { LIGAPUB1: { patrocinadores: [{ id: 'a', formato: 'tarjeta', nombre: 'Casa Ejemplo' }] } } }) => servidor({ [LIGA]: liga(), [JUEGO]: juego, [MEDIOS]: manifiesto })

  it('en la banda el logo sustituye al punto rojo, completo, y la dirección no se repite junto a él (tarjeta del espectador y tarjeta dedicada)', async () => {
    servir()
    montar()
    await screen.findByLabelText('Puntos de Alfa Norte')
    await act(async () => { await Promise.resolve() })
    const tarjetas = [...document.querySelectorAll('.sb-band [data-origen="semabel"]')]
    expect(tarjetas.length).toBe(2) // un patrocinador (impar): su pareja del espectador + la tarjeta dedicada
    for (const t of tarjetas) {
      const img = t.querySelector('img')
      expect(img.getAttribute('src')).toBe(LOGO)
      expect(img.getAttribute('alt')).toBe('Semabel · semabel.com')
      expect(t.querySelector('.sb-brand__dot')).toBeNull()
      expect(t.querySelector('.sb-sponsor__descriptor')).toBeNull() // «semabel.com» ya está en la imagen
      expect(t.textContent).not.toMatch(/semabel\.com/) // ni como texto visible junto al logo
    }
    expect(tarjetas.filter((t) => t.querySelector('.sb-semabel-banda__logo')).length).toBe(1)
    expect(document.querySelectorAll('.sb-band [data-patrocinador="semabel-banda"] img').length).toBe(1) // un solo logo en la diapositiva dedicada
  })

  it('la diapositiva dedicada: UNA tarjeta con el logo, el titular y el texto aprobados', async () => {
    servir()
    montar()
    await screen.findByLabelText('Puntos de Alfa Norte')
    await act(async () => { await Promise.resolve() })
    const t = document.querySelector('.sb-band [data-patrocinador="semabel-banda"]')
    expect(t.closest('.sb-sponsor-pair').classList.contains('sb-sponsor-pair--completa')).toBe(true)
    expect(t.closest('.sb-sponsor-pair').querySelectorAll('.sb-sponsor').length).toBe(1)
    expect(t.querySelector('.sb-semabel-banda__titular').textContent).toBe('La emoción está en la cancha. La historia sigue aquí.')
    expect(t.querySelector('.sb-semabel-banda__cuerpo').textContent).toBe('Sigue los marcadores, descubre a los protagonistas y comparte tu equipo.')
    const hijos = [...t.children].map((n) => n.className)
    expect(hijos[0]).toBe('sb-semabel-banda__logo') // logo a la izquierda, texto a la derecha
    expect(hijos[1]).toBe('sb-semabel-banda__texto')
  })

  it('en la promoción grande (descansos y final) el logo ocupa el lugar del punto; los mensajes aprobados siguen y el pie no repite la dirección', async () => {
    servir(respuestaJuego({ estado: 'final', reloj: reloj('detenido', 0) }))
    montar()
    await screen.findByText('Resultado final')
    await act(async () => { await Promise.resolve() })
    const marca = document.querySelector('.sb-promo__mark--logo img.sb-promo__logo')
    expect(marca.getAttribute('src')).toBe(LOGO)
    expect(screen.getByText('La emoción está en la cancha. La historia sigue aquí.', { selector: '.sb-promo__headline' })).toBeTruthy()
    expect(screen.getByText('Sigue los marcadores, descubre a los protagonistas y comparte tu equipo.')).toBeTruthy()
    expect(document.querySelector('.sb-promo__footer').textContent).toBe('Sin cuenta para mirar.')
    expect(document.querySelector('.sb-promo .sb-brand__dot')).toBeNull()
  })

  it('el pie del organizador (solo «semabel.com») desaparece con el logo, que ya lo trae; con descanso se ve el mensaje del organizador', async () => {
    servir(respuestaJuego({ reloj: reloj('detenido', 0), periodo: 2 }))
    montar()
    await screen.findByText('Descanso entre períodos')
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('Organiza el calendario, lleva el marcador desde tu teléfono y comparte cada partido.')).toBeTruthy()
    expect(document.querySelector('.sb-promo__footer')).toBeNull()
  })

  it('sin logo configurado, o si la imagen falla, queda la presentación de antes (punto rojo, rubro y pie completos)', async () => {
    servir(respuestaJuego(), { version: 1, ligas: { LIGAPUB1: { patrocinadores: [{ id: 'a', formato: 'tarjeta', nombre: 'Casa Ejemplo' }] } } }) // sin logo de Semabel
    montar()
    await screen.findByLabelText('Puntos de Alfa Norte')
    await act(async () => { await Promise.resolve() })
    let t = document.querySelector('.sb-band [data-origen="semabel"]:not([data-patrocinador="semabel-banda"])')
    expect(t.querySelector('.sb-brand__dot')).not.toBeNull()
    expect(t.querySelector('.sb-sponsor__descriptor').textContent).toBe('semabel.com')
    let d = document.querySelector('.sb-band [data-patrocinador="semabel-banda"]')
    expect(d.querySelector('img')).toBeNull()
    expect(d.querySelector('.sb-semabel-banda__marca').textContent).toBe('semabel.com')
    expect(d.querySelector('.sb-semabel-banda__titular').textContent).toBe('La emoción está en la cancha. La historia sigue aquí.')
    cleanup(); olvidarMedios()
    servir()
    montar()
    await screen.findByLabelText('Puntos de Alfa Norte')
    await act(async () => { await Promise.resolve() })
    for (const img of document.querySelectorAll('.sb-band img[src="/medios/SMB/semabel-logo.png"]')) fireEvent.error(img)
    t = document.querySelector('.sb-band [data-origen="semabel"]:not([data-patrocinador="semabel-banda"])')
    expect(t.querySelector('img')).toBeNull()
    expect(t.querySelector('.sb-brand__dot')).not.toBeNull()
    expect(t.querySelector('.sb-sponsor__descriptor').textContent).toBe('semabel.com')
    d = document.querySelector('.sb-band [data-patrocinador="semabel-banda"]')
    expect(d.querySelector('img')).toBeNull()
    expect(d.querySelector('.sb-semabel-banda__marca')).not.toBeNull()
    cleanup(); olvidarMedios()
    servir(respuestaJuego({ estado: 'final', reloj: reloj('detenido', 0) }))
    montar()
    await screen.findByText('Resultado final')
    await act(async () => { await Promise.resolve() })
    fireEvent.error(document.querySelector('img.sb-promo__logo'))
    expect(document.querySelector('.sb-promo__logo')).toBeNull()
    expect(document.querySelector('.sb-promo .sb-brand__dot')).not.toBeNull()
    expect(document.querySelector('.sb-promo__footer').textContent).toBe('semabel.com · Sin cuenta para mirar.')
  })

  it('el CSS muestra el logo entero (contain) y no lo recorta', () => {
    const css = readFileSync(join(import.meta.dirname, 'marcador-tv.css'), 'utf8')
    for (const clase of ['.sb-sponsor__logo-semabel {', '.sb-promo__logo {', '.sb-semabel-banda__logo {']) {
      const i = css.indexOf(clase)
      expect(css.slice(i, css.indexOf('}', i))).toMatch(/object-fit: contain/)
    }
  })
})

describe('marcas del encabezado: logo de Semabel y emblema del organizador (REPORT_200)', () => {
  const SMB = '/medios/SMB/semabel-logo.png'
  const ORG = '/medios/PLATINIUM/platinium-logo.png'
  const manifiesto = (extra = {}) => ({ version: 1, semabel: { logo: 'SMB/semabel-logo.png' }, ligas: { LIGAPUB1: { organizador: { logo: 'PLATINIUM/platinium-logo.png' }, patrocinadores: [{ id: 'a', formato: 'tarjeta', nombre: 'Casa Ejemplo' }], ...extra } } })
  const VISTAS = [
    ['programado', respuestaJuego({ estado: 'programado', inicio: null, inicioReal: null, periodo: 1, reloj: { estado: null, restanteMs: null, desdeMs: null }, local: { id: 'E1', nombre: 'Alfa Norte', puntos: 0, faltas: 0 }, visita: { id: 'E2', nombre: 'Beta Sur', puntos: 0, faltas: 0 } })],
    ['juego', respuestaJuego()],
    ['fin-periodo', respuestaJuego({ reloj: reloj('detenido', 0), periodo: 2 })],
    ['final', respuestaJuego({ estado: 'final', reloj: reloj('detenido', 0), periodo: 4 })],
  ]
  const abrir = async (juego, man = manifiesto()) => {
    servidor({ [LIGA]: liga(), [JUEGO]: juego, [MEDIOS]: man })
    montar()
    await act(async () => { await vi.waitFor(() => { if (!document.querySelector('.sb-header')) throw new Error('aún no') }) })
    await act(async () => { await Promise.resolve() })
  }

  for (const [vista, juego] of VISTAS) {
    it(`${vista}: el logo de Semabel (completo, con nombre accesible, sin dirección visible) y el emblema del organizador junto al nombre de la liga`, async () => {
      await abrir(juego)
      expect(document.querySelector('.sb-app').dataset.vista).toBe(vista === 'juego' || vista === 'programado' ? vista : (vista === 'final' ? 'final' : 'fin-periodo'))
      const marca = document.querySelector('.sb-header__brand')
      const logo = marca.querySelector('img.sb-header__logo')
      expect(logo.getAttribute('src')).toBe(SMB)
      expect(logo.getAttribute('alt')).toBe('Semabel · semabel.com')
      expect(marca.querySelector('.sb-brand__dot')).toBeNull() // sin el punto rojo
      expect(marca.textContent).not.toMatch(/semabel\.com/) // ni la dirección como texto visible
      expect(document.querySelectorAll('.sb-header img[src="/medios/SMB/semabel-logo.png"]').length).toBe(1) // un solo logo en el encabezado
      const emblema = document.querySelector('.sb-header__org .sb-org-mark img.sb-org-mark__img')
      expect(emblema.getAttribute('src')).toBe(ORG)
      fireEvent.load(emblema)
      expect(document.querySelector('.sb-org-mark').classList.contains('sb-org-mark--img')).toBe(true)
      expect(document.querySelector('.sb-header__org-name').textContent).toBe('Liga sintética uno') // la identificación de la liga sigue visible
    })
  }

  it('sin emblema configurado, o si falla, quedan las iniciales de la liga', async () => {
    await abrir(respuestaJuego(), manifiesto({ organizador: undefined }))
    let marca = document.querySelector('.sb-org-mark')
    expect(marca.querySelector('img')).toBeNull()
    expect(marca.textContent).toBe('LS')
    expect(marca.classList.contains('sb-org-mark--img')).toBe(false)
    cleanup(); olvidarMedios()
    await abrir(respuestaJuego())
    fireEvent.error(document.querySelector('.sb-org-mark img'))
    marca = document.querySelector('.sb-org-mark')
    expect(marca.querySelector('img')).toBeNull()
    expect(marca.textContent).toBe('LS')
    expect(marca.classList.contains('sb-org-mark--img')).toBe(false)
  })

  it('sin logo de Semabel configurado, o si la imagen falla, vuelve el punto rojo con «semabel.com» y un solo fallo cubre todas las tarjetas', async () => {
    await abrir(respuestaJuego(), { version: 1, ligas: { LIGAPUB1: { patrocinadores: [{ id: 'a', formato: 'tarjeta', nombre: 'Casa Ejemplo' }] } } })
    let marca = document.querySelector('.sb-header__brand')
    expect(marca.querySelector('img')).toBeNull()
    expect(marca.querySelector('.sb-brand__dot')).not.toBeNull()
    expect(marca.querySelector('.sb-brand').textContent).toBe('semabel.com')
    cleanup(); olvidarMedios()
    await abrir(respuestaJuego())
    fireEvent.error(document.querySelector('.sb-header__logo'))
    marca = document.querySelector('.sb-header__brand')
    expect(marca.querySelector('img')).toBeNull()
    expect(marca.querySelector('.sb-brand').textContent).toBe('semabel.com')
    expect(document.querySelectorAll('img[src="/medios/SMB/semabel-logo.png"]').length).toBe(0)
  })

  it('el aviso «Sin actualizar» sigue bajo la marca de Semabel', async () => {
    await abrir(respuestaJuego())
    expect(document.querySelector('.sb-header__brand .sb-header__logo')).not.toBeNull()
  })

  it('las promociones aprobadas no cambian: la tarjeta dedicada y el patrocinador siguen intactos', async () => {
    await abrir(respuestaJuego())
    const d = document.querySelector('.sb-band [data-patrocinador="semabel-banda"]')
    expect(d.querySelectorAll('img').length).toBe(1)
    expect(d.querySelector('.sb-semabel-banda__titular').textContent).toBe('La emoción está en la cancha. La historia sigue aquí.')
    expect(d.querySelector('.sb-semabel-banda__cuerpo').textContent).toBe('Sigue los marcadores, descubre a los protagonistas y comparte tu equipo.')
    expect(document.querySelector('.sb-band [data-patrocinador="a"]')).not.toBeNull()
  })

  it('los dos logos se muestran enteros: object-fit contain en el CSS', () => {
    const css = readFileSync(join(import.meta.dirname, 'marcador-tv.css'), 'utf8')
    for (const sel of ['.sb-header__logo {', '.sb-org-mark__img {']) {
      const i = css.indexOf(`\n${sel}`)
      const regla = css.slice(i, css.indexOf('}', i))
      expect(regla).toMatch(/object-fit: contain/)
    }
  })
})

describe('«nombreEnBanda»: nombre grande junto al logo SOLO en la banda en vivo (REPORT_211)', () => {
  const rod = { id: 'rodsan', formato: 'tarjeta', disposicion: 'logo', nombreEnBanda: true, nombre: 'Casa de campo RODSAN', logo: 'RODSAN/rodsan-logo-recorte-v2.jpeg', fondo: '#303435', texto: '#FFFFFF', acento: '#FFFFFF' }
  const parm = { id: 'parm', formato: 'tarjeta', disposicion: 'logo', nombre: 'La Parmigiana', descriptor: 'Restaurante italiano', logo: 'PARM/parmigiana.jpeg', fondo: '#000000', texto: '#FFFFFF', acento: '#FFFFFF' }
  const servir = (patrocinadores, juego = respuestaJuego()) => servidor({ [LIGA]: liga(), [JUEGO]: juego, [MEDIOS]: { version: 1, ligas: { LIGAPUB1: { patrocinadores } } } })

  it('banda en vivo: logo completo + el nombre como texto grande (oculto a lectores: el grupo ya lo dice) y sin título repetido', async () => {
    servir([rod])
    montar(); await screen.findByLabelText('Puntos de Alfa Norte'); await act(async () => { await Promise.resolve() })
    const t = document.querySelector('.sb-band [data-patrocinador="rodsan"]')
    expect(t.classList.contains('sb-sponsor--nombre-en-banda')).toBe(true)
    expect(t.getAttribute('aria-label')).toBe('Casa de campo RODSAN')
    expect(t.querySelector('img.sb-sponsor__logo-grande').getAttribute('src')).toBe('/medios/RODSAN/rodsan-logo-recorte-v2.jpeg')
    const texto = t.querySelector('.sb-sponsor__nombre-en-banda')
    expect(texto.textContent).toBe('Casa de campo RODSAN')
    expect(texto.getAttribute('aria-hidden')).toBe('true')
    expect(texto.style.color).toBe('rgb(255, 255, 255)')
    expect(t.querySelector('.sb-sponsor__name')).toBeNull()
    expect(t.querySelector('.sb-sponsor__descriptor')).toBeNull()
  })

  it('descansos y final: el logo grande y centrado SIN el texto del nombre (no se repite ni se reduce el logo para hacerle sitio)', async () => {
    servir([rod], respuestaJuego({ estado: 'final', reloj: reloj('detenido', 0) }))
    montar(); await screen.findByText('Resultado final'); await act(async () => { await Promise.resolve() })
    const t = document.querySelector('.sb-stage .sb-sponsor--large[data-patrocinador="rodsan"]')
    expect(t.dataset.disposicion).toBe('logo')
    expect(t.classList.contains('sb-sponsor--nombre-en-banda')).toBe(false)
    expect(t.querySelector('.sb-sponsor__nombre-en-banda')).toBeNull()
    expect(t.querySelector('.sb-sponsor__descriptor')).toBeNull()
    expect(t.querySelector('img').getAttribute('alt')).toBe('Casa de campo RODSAN')
  })

  it('los demás patrocinadores no cambian (sin la opción no hay clase ni texto nuevo) y, si el logo falla, cae a la tarjeta normal con el nombre', async () => {
    servir([parm, rod])
    montar(); await screen.findByLabelText('Puntos de Alfa Norte'); await act(async () => { await Promise.resolve() })
    const p = document.querySelector('.sb-band [data-patrocinador="parm"]')
    expect(p.classList.contains('sb-sponsor--nombre-en-banda')).toBe(false)
    expect(p.querySelector('.sb-sponsor__nombre-en-banda')).toBeNull()
    expect(p.querySelector('.sb-sponsor__descriptor').textContent).toBe('Restaurante italiano')
    fireEvent.error(document.querySelector('img[src="/medios/RODSAN/rodsan-logo-recorte-v2.jpeg"]'))
    const r = document.querySelector('.sb-band [data-patrocinador="rodsan"]')
    expect(r.dataset.disposicion).toBeUndefined()
    expect(r.querySelector('.sb-sponsor__name').textContent).toBe('Casa de campo RODSAN')
    expect(r.querySelector('.sb-sponsor__nombre-en-banda')).toBeNull()
  })

  it('CSS: la regla del texto solo existe para la banda; en el teléfono el texto se oculta y el logo queda completo; no hay reglas por id', () => {
    const css = readFileSync(join(import.meta.dirname, 'marcador-tv.css'), 'utf8')
    const bloque = css.slice(css.indexOf('«nombreEnBanda» (REPORT_211)'), css.indexOf('Logo real de Semabel en las tarjetas'))
    expect(bloque).toMatch(/\.sb-sponsor--logo\.sb-sponsor--band\.sb-sponsor--nombre-en-banda/)
    expect(bloque).not.toMatch(/sb-sponsor--large/) // ningún cambio para los descansos y el final
    expect(bloque).toMatch(/max-width: 640px\) \{[^}]*\.sb-sponsor__nombre-en-banda \{ display: none; \}/s)
    expect(bloque).not.toMatch(/rodsan|data-patrocinador/i)
  })
})

describe('logos de equipo compartidos entre equipos distintos (REPORT_216)', () => {
  const servirEquipos = (equipos) => servidor({ [LIGA]: liga(), [JUEGO]: respuestaJuego(), [MEDIOS]: { version: 1, ligas: { LIGAPUB1: { equipos } } } })

  it('dos equipos distintos pueden apuntar al MISMO archivo: cada uno lleva su propio escudo, sus iniciales de respaldo y su marcador (nada se fusiona)', async () => {
    servirEquipos({ E1: { logo: 'EQUIPOS/compartido.jpg' }, E2: { logo: 'EQUIPOS/compartido.jpg' } })
    montar()
    await screen.findByLabelText('Puntos de Alfa Norte')
    await act(async () => { await Promise.resolve() })
    const casa = document.querySelector('.sb-team[data-side="home"]'); const visita = document.querySelector('.sb-team[data-side="away"]')
    expect(casa.querySelector('.sb-crest__img').getAttribute('src')).toBe('/medios/EQUIPOS/compartido.jpg')
    expect(visita.querySelector('.sb-crest__img').getAttribute('src')).toBe('/medios/EQUIPOS/compartido.jpg')
    expect(casa.querySelector('.sb-crest').textContent).toBe('AN') // iniciales propias de cada equipo
    expect(visita.querySelector('.sb-crest').textContent).toBe('BS')
    expect(screen.getByLabelText('Puntos de Alfa Norte')).toBeTruthy()
    expect(screen.getByLabelText('Puntos de Beta Sur')).toBeTruthy()
  })

  it('si el archivo compartido falta o está roto, cada equipo cae a sus propias iniciales; un equipo sin registro no se ve afectado', async () => {
    servirEquipos({ E1: { logo: 'EQUIPOS/compartido.jpg' }, E2: { logo: 'EQUIPOS/compartido.jpg' } })
    montar()
    await screen.findByLabelText('Puntos de Alfa Norte')
    await act(async () => { await Promise.resolve() })
    for (const img of [...document.querySelectorAll('.sb-team .sb-crest__img')]) fireEvent.error(img)
    expect(document.querySelectorAll('.sb-crest--img').length).toBe(0)
    expect(document.querySelector('.sb-team[data-side="home"] .sb-crest').textContent).toBe('AN')
    expect(document.querySelector('.sb-team[data-side="away"] .sb-crest').textContent).toBe('BS')
    expect(document.querySelector('.sb-team img')).toBeNull() // nunca un icono roto
  })

  it('CSS: el escudo con imagen la muestra entera (object-fit: contain), sin límites que la recorten', () => {
    const css = readFileSync(join(import.meta.dirname, 'marcador-tv.css'), 'utf8')
    expect(css).toMatch(/\.sb-crest__img \{[^}]*object-fit: contain/)
    expect(css).not.toMatch(/\.sb-crest__img \{[^}]*object-fit: (cover|fill)/)
  })
})
