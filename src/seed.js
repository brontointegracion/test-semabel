import { db, uid } from './db'
import { generarCalendario } from './lib/calendario'

// Datos de ejemplo: dos ligas reales de barrio en Panamá.
// Todo se genera relativo a hoy para que el prototipo siempre esté "en temporada".

const rng = (semilla) => () => {
  semilla |= 0; semilla = (semilla + 0x6d2b79f5) | 0
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const CANCHAS = [
  { nombre: 'Cancha Don Bosco', barrio: 'San Miguelito', ciudad: 'Panamá', lat: 9.0455, lng: -79.5133, techada: true },
  { nombre: 'Polideportivo El Chorrillo', barrio: 'El Chorrillo', ciudad: 'Panamá', lat: 8.9497, lng: -79.5449, techada: true },
  { nombre: 'Cancha La Locería', barrio: 'Bethania', ciudad: 'Panamá', lat: 9.0031, lng: -79.5182, techada: false },
]

const EQUIPOS_BALON = [
  { nombre: 'Halcones', corto: 'HAL', color: '#C9452B' },
  { nombre: 'Titanes del Norte', corto: 'TIT', color: '#2A5C86' },
  { nombre: 'Leones de Calidonia', corto: 'LEO', color: '#D89B1C' },
  { nombre: 'Tiburones', corto: 'TIB', color: '#1E7F8C' },
  { nombre: 'Águilas de Betania', corto: 'AGU', color: '#6B4E9B' },
  { nombre: 'Guerreros 24 de Diciembre', corto: 'GUE', color: '#0D6B55' },
]

const EQUIPOS_FUTSAL = [
  { nombre: 'Barraza FC', corto: 'BAR', color: '#C9452B' },
  { nombre: 'Santa Ana', corto: 'SAN', color: '#2A5C86' },
  { nombre: 'Marañón', corto: 'MAR', color: '#D89B1C' },
  { nombre: 'Boca La Caja', corto: 'BOC', color: '#0D6B55' },
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

const diaISO = (d) => new Date(d).toISOString()

export async function sembrarSiHaceFalta() {
  const yaHay = await db.ligas.count()
  if (yaHay > 0) return

  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const inicioTemporada = new Date(hoy); inicioTemporada.setDate(hoy.getDate() - 12)
  const finTemporada = new Date(hoy); finTemporada.setDate(hoy.getDate() + 45)

  const canchas = CANCHAS.map((c) => ({ id: uid(), ...c }))
  await db.canchas.bulkAdd(canchas)

  await db.cuenta.add({
    id: 'yo',
    nombre: 'Miguel Robles',
    rol: 'organizador',
    saldo: 7,
    plan: 'gratis',
    pais: 'PA',
    moneda: 'USD',
  })

  let nombreIdx = 0
  const tomarNombre = () => NOMBRES[nombreIdx++ % NOMBRES.length]

  async function crearLiga({ nombre, deporte, plantillas, canchaIds, diasSemana, franjas, dorsalMax }) {
    const liga = {
      id: uid(),
      nombre,
      deporte,
      codigo: String(1000 + Math.floor(Math.random() * 8999)),
      canchaIds,
      diasSemana,
      franjas,
      desde: diaISO(inicioTemporada),
      hasta: diaISO(finTemporada),
      estado: 'publicada',
      pagada: true,
      organizador: 'Miguel Robles',
    }
    await db.ligas.add(liga)

    const equipos = plantillas.map((p) => ({ id: uid(), ligaId: liga.id, ...p }))
    await db.equipos.bulkAdd(equipos)

    const jugadores = []
    for (const eq of equipos) {
      const dorsales = new Set()
      for (let i = 0; i < 8; i++) {
        let d
        do { d = 1 + Math.floor(Math.random() * dorsalMax) } while (dorsales.has(d))
        dorsales.add(d)
        jugadores.push({
          id: uid(),
          ligaId: liga.id,
          equipoId: eq.id,
          nombre: tomarNombre(),
          dorsal: d,
          reclamado: false,
        })
      }
    }
    // Un jugador ya reclamó su perfil: sirve para mostrar los dos estados.
    jugadores[3].reclamado = true
    await db.jugadores.bulkAdd(jugadores)

    const { partidos } = generarCalendario({
      equipoIds: equipos.map((e) => e.id),
      desde: inicioTemporada,
      hasta: finTemporada,
      diasSemana,
      canchaIds,
      franjas,
    })

    const filas = partidos.map((p) => ({
      id: uid(),
      ligaId: liga.id,
      codigo: String(1000 + Math.floor(Math.random() * 8999)),
      estado: 'programado',
      ...p,
    }))
    await db.partidos.bulkAdd(filas)

    return { liga, equipos, jugadores, partidos: filas }
  }

  const balon = await crearLiga({
    nombre: 'Liga Barrial San Miguelito',
    deporte: 'baloncesto',
    plantillas: EQUIPOS_BALON,
    canchaIds: [canchas[0].id, canchas[2].id],
    diasSemana: [3, 5], // miércoles y viernes
    franjas: ['19:00', '20:30'],
    dorsalMax: 30,
  })

  const futsal = await crearLiga({
    nombre: 'Copa Chorrillo Fútbol Sala',
    deporte: 'futsal',
    plantillas: EQUIPOS_FUTSAL,
    canchaIds: [canchas[1].id],
    diasSemana: [2, 6], // martes y sábado
    franjas: ['19:30'],
    dorsalMax: 20,
  })

  await simular(balon, 'baloncesto')
  await simular(futsal, 'futsal')
}

/** Juega los partidos que ya pasaron, generando eventos reales (no marcadores). */
async function simular({ liga, equipos, jugadores, partidos }, deporte) {
  const ahora = Date.now()
  const al = rng(liga.nombre.length * 977)
  const eventos = []
  const cambios = []

  const jugados = partidos.filter((p) => new Date(p.inicio).getTime() < ahora)
  // El último que ya empezó queda EN VIVO, para que el marcador tenga qué mostrar.
  const enVivoIdx = jugados.length - 1

  jugados.forEach((partido, idx) => {
    const enVivo = idx === enVivoIdx
    const periodos = deporte === 'baloncesto' ? 4 : 2
    const periodosJugados = enVivo ? (deporte === 'baloncesto' ? 3 : 1) : periodos
    let seq = 0

    for (const equipoId of [partido.localId, partido.visitaId]) {
      const plantel = jugadores.filter((j) => j.equipoId === equipoId)
      const anotaciones = deporte === 'baloncesto'
        ? 18 + Math.floor(al() * 14)
        : 1 + Math.floor(al() * 5)

      const porPeriodo = Math.ceil(anotaciones / periodos)
      for (let p = 1; p <= periodosJugados; p++) {
        for (let k = 0; k < porPeriodo; k++) {
          if (deporte === 'baloncesto' && seq > 200) break
          const j = plantel[Math.floor(al() * plantel.length)]
          const r = al()
          const puntos = deporte === 'futsal' ? 1 : r < 0.12 ? 3 : r < 0.78 ? 2 : 1
          eventos.push({
            id: uid(),
            partidoId: partido.id,
            seq: ++seq,
            tipo: 'punto',
            equipoId,
            jugadorId: j.id,
            puntos,
            periodo: p,
            anulado: false,
            creadoEn: new Date(partido.inicio).getTime() + seq * 20000,
          })
        }
      }
    }

    // Un par de correcciones reales, para que el registro no se vea de laboratorio.
    if (eventos.length > 4 && al() < 0.6) {
      const cand = eventos[eventos.length - 2 - Math.floor(al() * 3)]
      if (cand && cand.partidoId === partido.id) {
        cand.anulado = true
        cand.anuladoEn = cand.creadoEn + 9000
        cand.rehacerBloqueado = true
      }
    }

    if (enVivo) {
      const arranque = new Date(ahora - 41 * 60 * 1000).toISOString()
      cambios.push({ ...partido, estado: 'vivo', inicio: arranque, periodo: periodosJugados })
    } else {
      cambios.push({ ...partido, estado: 'final' })
    }
  })

  if (eventos.length) await db.eventos.bulkAdd(eventos)
  if (cambios.length) await db.partidos.bulkPut(cambios)
}
