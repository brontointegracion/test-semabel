import { db, uid } from './db'
import { generarCalendario } from './lib/calendario'
import { restanteMs } from './lib/reloj-calculo'

// Datos de ejemplo. Todo se genera relativo a hoy para que el prototipo
// siempre esté "en temporada", con un partido en vivo que abrir.
//
// Sube SEMILLA cuando cambie la forma de los datos: el prototipo se
// resiembra solo en vez de quedar a medias.
const SEMILLA = 8

// Códigos cortos: los que se leen en la dirección y se escriben en el televisor.
// Únicos entre sí para que nunca dos cosas respondan al mismo número.
const usados = new Set()
const codigoUnico = () => {
  let c
  do { c = String(1000 + Math.floor(Math.random() * 8999)) } while (usados.has(c))
  usados.add(c)
  return c
}

const rng = (s) => () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const CANCHAS = [
  { clave: 'donbosco', nombre: 'Cancha Don Bosco', barrio: 'San Miguelito', provincia: 'Panamá', pais: 'PA', lat: 9.0455, lng: -79.5133, techada: true },
  { clave: 'chorrillo', nombre: 'Polideportivo El Chorrillo', barrio: 'El Chorrillo', provincia: 'Panamá', pais: 'PA', lat: 8.9497, lng: -79.5449, techada: true },
  { clave: 'loceria', nombre: 'Cancha La Locería', barrio: 'Bethania', provincia: 'Panamá', pais: 'PA', lat: 9.0031, lng: -79.5182, techada: false },
  { clave: 'david', nombre: 'Gimnasio Ernesto Sánchez', barrio: 'David', provincia: 'Chiriquí', pais: 'PA', lat: 8.4272, lng: -82.4316, techada: true },
  { clave: 'bocas', nombre: 'Cancha Isla Colón', barrio: 'Bocas del Toro', provincia: 'Bocas del Toro', pais: 'PA', lat: 9.3405, lng: -82.2419, techada: false },
  { clave: 'darien', nombre: 'Polideportivo La Palma', barrio: 'La Palma', provincia: 'Darién', pais: 'PA', lat: 8.4064, lng: -78.1425, techada: false },
  { clave: 'envigado', nombre: 'Placa Envigado Centro', barrio: 'Envigado', provincia: 'Antioquia', pais: 'CO', lat: 6.1697, lng: -75.5828, techada: false },
]

const PALETA = ['#C9452B', '#2A5C86', '#D89B1C', '#1E7F8C', '#6B4E9B', '#0D6B55', '#8C3B63', '#3F6B22']

const nombresEquipo = (lista) =>
  lista.map((n, i) => ({
    nombre: n,
    corto: n.replace(/[^A-Za-zÁÉÍÓÚÑ ]/g, '').split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase(),
    color: PALETA[i % PALETA.length],
  }))

const LIGAS = [
  {
    nombre: 'Liga Barrial San Miguelito', deporte: 'baloncesto', mia: true,
    canchas: ['donbosco', 'loceria'], dias: [3, 5], franjas: ['19:00', '20:30'],
    equipos: nombresEquipo(['Halcones', 'Titanes del Norte', 'Leones de Calidonia', 'Tiburones', 'Águilas de Betania', 'Guerreros 24 de Diciembre']),
  },
  {
    nombre: 'Copa Chorrillo Fútbol Sala', deporte: 'futsal', mia: true,
    canchas: ['chorrillo'], dias: [2, 6], franjas: ['19:30'],
    equipos: nombresEquipo(['Barraza FC', 'Santa Ana', 'Marañón', 'Boca La Caja']),
  },
  {
    nombre: 'Liga Chiricana de Baloncesto', deporte: 'baloncesto', organizador: 'Ana Quiel',
    canchas: ['david'], dias: [4, 6], franjas: ['19:00'],
    equipos: nombresEquipo(['Toros de David', 'Cafeteros de Boquete', 'Bravos de Dolega', 'Puma Chiricano']),
  },
  {
    nombre: 'Torneo Isla Colón', deporte: 'futsal', organizador: 'Delroy Smith',
    canchas: ['bocas'], dias: [0, 4], franjas: ['18:00'],
    equipos: nombresEquipo(['Isla Verde', 'Old Bank', 'Bastimentos', 'Salt Creek']),
  },
  {
    nombre: 'Liga Darién Fútbol Sala', deporte: 'futsal', organizador: 'Ovidio Cabrera',
    canchas: ['darien'], dias: [6], franjas: ['17:00', '18:30'],
    equipos: nombresEquipo(['La Palma', 'Yaviza', 'Metetí', 'Sambú']),
  },
  {
    nombre: 'Liga Antioqueña de Barrio', deporte: 'baloncesto', organizador: 'Sara Betancur',
    canchas: ['envigado'], dias: [3, 6], franjas: ['19:00'],
    equipos: nombresEquipo(['Envigado', 'Poblado', 'Belén', 'Robledo']),
  },
]

const NOMBRES = [
  'Luis Carrasco', 'Javier Mendoza', 'Ernesto Batista', 'Kevin Ortega', 'Ariel Domínguez',
  'Rubén Santamaría', 'Óscar Villalobos', 'Iván Peralta', 'Gabriel Núñez', 'Manuel Cedeño',
  'Ricardo Almanza', 'Jorge Bethancourt', 'Danilo Espino', 'Abdiel Quintero', 'Yorlando Ruiz',
  'César Barría', 'Emilio Guerra', 'Rafael Icaza', 'Omar Tejeira', 'Néstor Aparicio',
  'Isaac Moreno', 'Julián Pinzón', 'Andrés Sáez', 'Marcos Delgado', 'Fabián Ríos',
  'Elías Camargo', 'Adolfo Serrano', 'Vicente Lasso', 'Hugo Bermúdez', 'Pedro Arauz',
  'Samuel Chavarría', 'Braulio Vega', 'Enrique Salas', 'Tomás Grimaldo', 'Alonso Frías',
  'Wilfredo Castro', 'Genaro Ávila', 'Damián Correa', 'Saúl Montero', 'Leonel Pardo',
  'Héctor Zamora', 'Lucio Bernal', 'Mateo Riquelme', 'Alfonso Vergara', 'Rodrigo Alfaro',
  'Simón Castillero', 'Bruno Alvarado', 'Nicolás Herrera', 'Teodoro Lezcano', 'Gustavo Prado',
  'Camilo Barsallo', 'Feliciano Ureña', 'Amado Solís', 'Ismael Rangel', 'Bernardo Ruíz',
  'Diego Espinosa', 'Ramiro Vallarino', 'Alexis Domingo', 'Ángel Caballero', 'Sergio Atencio',
]

const NOTICIAS = [
  {
    titulo: 'El barrio que aprendió a llevar sus números',
    etiqueta: 'Crónica',
    entrada: 'San Miguelito lleva doce jornadas anotando cada canasta. Lo que empezó como una libreta hoy es una tabla que nadie discute.',
    hace: 1, premium: false,
  },
  {
    titulo: 'Guerreros 24 de Diciembre gana el clásico y se mete arriba',
    etiqueta: 'Resultados',
    entrada: 'Ganó por seis en la Don Bosco, con un cuarto final de nueve puntos sin respuesta.',
    hace: 2, premium: false,
  },
  {
    titulo: 'Chiriquí estrena su liga con cuatro equipos y una sola cancha',
    etiqueta: 'Ligas',
    entrada: 'El Gimnasio Ernesto Sánchez concentra todo el torneo: un solo local, dos noches por semana.',
    hace: 4, premium: false,
  },
  {
    titulo: 'Los diez jugadores más buscados del barrio panameño',
    etiqueta: 'Análisis',
    entrada: 'Promedios, minutos y faltas de los que están rindiendo por encima de su liga esta temporada.',
    hace: 6, premium: true,
  },
  {
    titulo: 'Cómo se arma un calendario que aguante la lluvia',
    etiqueta: 'Guía',
    entrada: 'Dejar franjas libres no es perder dinero: es lo que permite reprogramar sin mover toda la temporada.',
    hace: 9, premium: false,
  },
]

const CUERPO = [
  'La primera jornada se anotó en una libreta de espiral que alguien dejó bajo la mesa de la mesa de control. Para la tercera, la libreta ya no aparecía, y con ella se fueron los puntos de dos partidos completos.',
  'Hoy el marcador lo lleva el árbitro desde el teléfono. Cada canasta queda como un evento con su hora, su jugador y su período, y la tabla se calcula sola. Nadie discute el resultado porque el resultado se puede explicar jugada por jugada.',
  'El cambio no fue tecnológico sino social: cuando los números existen, empiezan a importar. Los jugadores preguntan por su promedio. Los equipos reclaman una falta mal cargada. La liga, de pronto, tiene memoria.',
  'Queda la parte difícil, que es sostenerlo cuando llueve, cuando el árbitro no llega, cuando el teléfono se queda sin batería a mitad del tercer cuarto. Para eso está el papel: anotar el resultado a mano siempre es gratis.',
]

const diaISO = (d) => new Date(d).toISOString()

export async function sembrarSiHaceFalta() {
  const marca = await db.meta.get('semilla').catch(() => null)
  if (marca?.version === SEMILLA) return

  await Promise.all(
    ['canchas', 'ligas', 'equipos', 'jugadores', 'partidos', 'eventos', 'cuenta', 'noticias']
      .map((t) => db.table(t).clear()),
  )

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const desde = new Date(hoy); desde.setDate(hoy.getDate() - 12)
  const hasta = new Date(hoy); hasta.setDate(hoy.getDate() + 45)

  const canchas = CANCHAS.map((c) => ({ id: uid(), codigo: codigoUnico(), ...c }))
  await db.canchas.bulkAdd(canchas)
  const porClave = Object.fromEntries(canchas.map((c) => [c.clave, c]))

  await db.cuenta.add({
    id: 'yo', nombre: 'Miguel Robles', rol: 'organizador',
    saldo: 7, plan: 'gratis', pais: 'PA', provincia: 'Panamá', moneda: 'USD',
  })

  let idx = 0
  const tomarNombre = () => NOMBRES[idx++ % NOMBRES.length]

  for (const def of LIGAS) {
    const suyas = def.canchas.map((k) => porClave[k])
    const liga = {
      id: uid(),
      nombre: def.nombre,
      deporte: def.deporte,
      codigo: codigoUnico(),
      canchaIds: suyas.map((c) => c.id),
      pais: suyas[0].pais,
      provincia: suyas[0].provincia,
      diasSemana: def.dias,
      franjas: def.franjas,
      minutosPorPeriodo: def.deporte === 'baloncesto' ? 10 : 20,
      desde: diaISO(desde),
      hasta: diaISO(hasta),
      estado: 'publicada',
      pagada: true,
      organizador: def.organizador || 'Miguel Robles',
      // Quién manda en esta liga. Solo esta persona ve la consola y el saldo.
      organizadorId: def.mia ? 'yo' : `otro-${def.organizador.split(' ')[0].toLowerCase()}`,
    }
    await db.ligas.add(liga)

    const equipos = def.equipos.map((e) => ({ id: uid(), codigo: codigoUnico(), ligaId: liga.id, ...e }))
    await db.equipos.bulkAdd(equipos)

    const jugadores = []
    for (const eq of equipos) {
      const dorsales = new Set()
      for (let i = 0; i < 8; i++) {
        let d
        do { d = 1 + Math.floor(Math.random() * 30) } while (dorsales.has(d))
        dorsales.add(d)
        jugadores.push({
          id: uid(), codigo: codigoUnico(), ligaId: liga.id, equipoId: eq.id,
          nombre: tomarNombre(), dorsal: d, reclamado: false,
        })
      }
    }
    jugadores[3].reclamado = true
    await db.jugadores.bulkAdd(jugadores)

    const { partidos } = generarCalendario({
      equipoIds: equipos.map((e) => e.id),
      desde, hasta,
      diasSemana: def.dias,
      canchaIds: liga.canchaIds,
      franjas: def.franjas,
    })

    const filas = partidos.map((p) => ({
      id: uid(), ligaId: liga.id,
      codigo: codigoUnico(),
      estado: 'programado', ...p,
    }))
    await db.partidos.bulkAdd(filas)

    await simular({ liga, jugadores, partidos: filas })
  }

  const ligas = await db.ligas.toArray()
  await db.noticias.bulkAdd(
    NOTICIAS.map((n, i) => {
      const cuando = new Date(); cuando.setDate(cuando.getDate() - n.hace)
      return {
        id: uid(),
        codigo: codigoUnico(),
        ...n,
        ligaId: ligas[i % ligas.length].id,
        pais: ligas[i % ligas.length].pais,
        publicada: cuando.toISOString(),
        cuerpo: CUERPO,
      }
    }),
  )

  await db.meta.put({ id: 'semilla', version: SEMILLA, sembradoEn: new Date().toISOString() })
}

/**
 * Solo para el prototipo: el partido de ejemplo tiene que estar siempre en juego.
 *
 * El reloj de la semilla empieza a correr cuando se crean los datos, así que a
 * los pocos minutos llegaba a cero y el "partido en vivo" quedaba congelado.
 * Esto lo vuelve a poner en marcha cuando se acaba, avanzando de período como
 * lo haría un partido de verdad.
 *
 * Si alguien lo detuvo a mano desde la consola y todavía queda tiempo, se
 * respeta: eso es una decisión del árbitro, no un reloj agotado.
 */
let mantenimientoPausado = false

/** Mientras el árbitro tiene la consola abierta, el reloj es suyo y nadie más lo toca. */
export const pausarMantenimiento = (v) => { mantenimientoPausado = v }

/**
 * El partido de ejemplo empieza su período con el tiempo completo y corre hacia
 * abajo. Nunca se muestra en pausa: un partido en juego tiene el reloj andando.
 *
 * Se vuelve a cargar al abrir la app y cada vez que llega a cero, para que la
 * demostración no dependa de cuándo se sembraron los datos.
 */
export async function mantenerPartidoEnVivo() {
  if (mantenimientoPausado) return

  const vivos = await db.partidos.where('estado').equals('vivo').toArray()
  for (const partido of vivos) {
    const liga = await db.ligas.get(partido.ligaId)
    if (restanteMs(partido, liga) > 0 && partido.relojEstado === 'corriendo') continue

    await db.partidos.update(partido.id, {
      relojEstado: 'corriendo',
      relojRestante: minutosDe(liga) * 60 * 1000,
      relojDesde: Date.now(),
    })
  }
}

const minutosDe = (liga) =>
  liga?.minutosPorPeriodo ?? (liga?.deporte === 'baloncesto' ? 10 : 20)

/** Juega los partidos que ya pasaron generando eventos reales: puntos y faltas. */
async function simular({ liga, jugadores, partidos }) {
  const ahora = Date.now()
  const al = rng(liga.nombre.length * 977 + liga.nombre.charCodeAt(0))
  const baloncesto = liga.deporte === 'baloncesto'
  const eventos = []
  const cambios = []

  const jugados = partidos.filter((p) => new Date(p.inicio).getTime() < ahora)
  const enVivoIdx = jugados.length - 1

  jugados.forEach((partido, idx) => {
    const enVivo = idx === enVivoIdx
    const periodos = baloncesto ? 4 : 2
    // En el partido en vivo solo se anota lo de los períodos ya terminados: el
    // que está en juego arranca con su tiempo completo y todavía sin puntos.
    const periodosJugados = enVivo ? Math.max(1, periodos - 2) : periodos
    let seq = 0

    for (const equipoId of [partido.localId, partido.visitaId]) {
      const plantel = jugadores.filter((j) => j.equipoId === equipoId)
      const anotaciones = baloncesto ? 18 + Math.floor(al() * 14) : 1 + Math.floor(al() * 5)
      const faltas = baloncesto ? 8 + Math.floor(al() * 8) : 3 + Math.floor(al() * 5)
      const porPeriodo = Math.ceil(anotaciones / periodos)

      for (let p = 1; p <= periodosJugados; p++) {
        for (let k = 0; k < porPeriodo; k++) {
          const j = plantel[Math.floor(al() * plantel.length)]
          const r = al()
          eventos.push({
            id: uid(), partidoId: partido.id, seq: ++seq, tipo: 'punto',
            equipoId, jugadorId: j.id,
            puntos: baloncesto ? (r < 0.12 ? 3 : r < 0.78 ? 2 : 1) : 1,
            periodo: p, anulado: false,
            creadoEn: new Date(partido.inicio).getTime() + seq * 20000,
          })
        }
      }

      const faltasReales = Math.round((faltas * periodosJugados) / periodos)
      for (let k = 0; k < faltasReales; k++) {
        const j = plantel[Math.floor(al() * plantel.length)]
        eventos.push({
          id: uid(), partidoId: partido.id, seq: ++seq, tipo: 'falta',
          equipoId, jugadorId: j.id, puntos: 0,
          periodo: 1 + Math.floor(al() * periodosJugados), anulado: false,
          creadoEn: new Date(partido.inicio).getTime() + seq * 20000,
        })
      }
    }

    // Períodos ya cerrados: sin estos eventos el marcador no sabe en cuál va.
    const cerrados = enVivo ? periodosJugados : periodos
    for (let p = 1; p <= cerrados; p++) {
      eventos.push({
        id: uid(), partidoId: partido.id, seq: ++seq, tipo: 'periodo',
        periodo: p, anulado: false,
        creadoEn: new Date(partido.inicio).getTime() + seq * 20000,
      })
    }

    // Una corrección de verdad, para que el registro no se vea de laboratorio.
    if (al() < 0.6) {
      const delPartido = eventos.filter((e) => e.partidoId === partido.id)
      const cand = delPartido[delPartido.length - 2 - Math.floor(al() * 3)]
      if (cand) {
        cand.anulado = true
        cand.anuladoEn = cand.creadoEn + 9000
        cand.rehacerBloqueado = true
      }
    }

    if (enVivo) {
      // El período en curso empieza con su tiempo completo, y el reloj andando.
      cambios.push({
        ...partido,
        estado: 'vivo',
        inicio: new Date(ahora - 41 * 60 * 1000).toISOString(),
        relojEstado: 'corriendo',
        relojRestante: minutosDe(liga) * 60 * 1000,
        relojDesde: ahora,
      })
    } else {
      cambios.push({
        ...partido,
        estado: 'final',
        relojEstado: 'detenido',
        relojRestante: 0,
        relojDesde: null,
      })
    }
  })

  if (eventos.length) await db.eventos.bulkAdd(eventos)
  if (cambios.length) await db.partidos.bulkPut(cambios)
}
