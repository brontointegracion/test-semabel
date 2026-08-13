import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, uid } from '../db'
import { useCanchas } from '../datos'
import { generarCalendario, DIAS } from '../lib/calendario'
import { Topbar, Escudo, fechaCorta, hora, mismoDia } from '../ui'

const COLORES = ['#C9452B', '#2A5C86', '#D89B1C', '#1E7F8C', '#6B4E9B', '#0D6B55', '#8C3B63', '#3F6B22']
const FRANJAS = ['18:00', '19:00', '20:00', '21:00']

const enISO = (d) => new Date(d).toISOString().slice(0, 10)

export default function NuevaLiga() {
  const canchas = useCanchas()
  const nav = useNavigate()

  const hoy = new Date()
  const en8 = new Date(); en8.setDate(hoy.getDate() + 56)

  const [nombre, setNombre] = useState('')
  const [deporte, setDeporte] = useState('baloncesto')
  const [nEquipos, setNEquipos] = useState(6)
  const [canchaIds, setCanchaIds] = useState([])
  const [dias, setDias] = useState([3, 5])
  const [franjas, setFranjas] = useState(['19:00', '20:30'])
  const [desde, setDesde] = useState(enISO(hoy))
  const [hasta, setHasta] = useState(enISO(en8))
  const [paso, setPaso] = useState(1)
  const [guardando, setGuardando] = useState(false)

  const equiposDemo = useMemo(
    () => Array.from({ length: nEquipos }, (_, i) => ({
      id: `tmp-${i}`,
      nombre: `Equipo ${i + 1}`,
      corto: `E${i + 1}`,
      color: COLORES[i % COLORES.length],
    })),
    [nEquipos],
  )

  const propuesta = useMemo(() => {
    if (!canchaIds.length || !dias.length || !franjas.length) return { partidos: [], sinEspacio: false }
    return generarCalendario({
      equipoIds: equiposDemo.map((e) => e.id),
      desde: new Date(`${desde}T00:00:00`),
      hasta: new Date(`${hasta}T23:59:59`),
      diasSemana: dias,
      canchaIds,
      franjas,
    })
  }, [equiposDemo, desde, hasta, dias, franjas, canchaIds])

  const listo = nombre.trim() && canchaIds.length && dias.length && franjas.length
  const precio = (nEquipos * 1.5 + propuesta.partidos.length * 0.4).toFixed(2)

  const alternar = (lista, set, v) =>
    set(lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v].sort())

  const publicar = async () => {
    setGuardando(true)
    const ligaId = uid()
    await db.ligas.add({
      id: ligaId,
      nombre: nombre.trim(),
      deporte,
      codigo: String(1000 + Math.floor(Math.random() * 8999)),
      canchaIds,
      diasSemana: dias,
      franjas,
      desde: new Date(`${desde}T00:00:00`).toISOString(),
      hasta: new Date(`${hasta}T23:59:59`).toISOString(),
      estado: 'publicada',
      pagada: true,
      organizador: 'Miguel Robles',
    })

    const equipos = equiposDemo.map((e) => ({ ...e, id: uid(), ligaId }))
    await db.equipos.bulkAdd(equipos)

    const jugadores = equipos.flatMap((eq, ei) =>
      Array.from({ length: 6 }, (_, i) => ({
        id: uid(),
        ligaId,
        equipoId: eq.id,
        nombre: `Jugador ${ei + 1}-${i + 1}`,
        dorsal: i + 4,
        reclamado: false,
      })),
    )
    await db.jugadores.bulkAdd(jugadores)

    const mapa = Object.fromEntries(equiposDemo.map((e, i) => [e.id, equipos[i].id]))
    await db.partidos.bulkAdd(
      propuesta.partidos.map((p) => ({
        id: uid(),
        ligaId,
        codigo: String(1000 + Math.floor(Math.random() * 8999)),
        estado: 'programado',
        localId: mapa[p.localId],
        visitaId: mapa[p.visitaId],
        canchaId: p.canchaId,
        inicio: p.inicio,
      })),
    )

    nav(`/liga/${ligaId}`, { replace: true })
  }

  if (paso === 2) {
    let ultimoDia = null
    return (
      <>
        <Topbar titulo="Calendario propuesto" />

        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700 }}>{propuesta.partidos.length} partidos</div>
          <p className="sub" style={{ marginTop: 6 }}>
            Todos contra todos, repartidos en {dias.map((d) => DIAS[d]).join(' y ')}, sin que
            ningún equipo juegue dos veces el mismo día y sin ocupar dos veces la misma franja.
          </p>
          {propuesta.sinEspacio && (
            <div className="aviso alerta" style={{ marginTop: 12 }}>
              No alcanzan las fechas para todos los partidos. Alarga la temporada, agrega otro
              día o suma una franja.
            </div>
          )}
          <div className="aviso" style={{ marginTop: 12 }}>
            <div>
              Publicar esta liga cuesta <strong>${precio}</strong> por la temporada. El marcador
              en vivo se paga aparte, con saldo.
            </div>
          </div>
        </div>

        <h2 className="seccion">Revisa antes de publicar</h2>
        {propuesta.partidos.slice(0, 40).map((p, i) => {
          const nuevoDia = !ultimoDia || !mismoDia(ultimoDia, p.inicio)
          ultimoDia = p.inicio
          const local = equiposDemo.find((e) => e.id === p.localId)
          const visita = equiposDemo.find((e) => e.id === p.visitaId)
          const cancha = (canchas || []).find((c) => c.id === p.canchaId)
          return (
            <div key={i}>
              {nuevoDia && <div className="dia-sep">{fechaCorta(p.inicio)}</div>}
              <div className="partido" style={{ marginBottom: 8, cursor: 'default' }}>
                <div className="cuando">
                  <div className="hora">{hora(p.inicio)}</div>
                  <div className="dia">{cancha?.barrio}</div>
                </div>
                <div className="enfrenta">
                  <div className="lado">
                    <Escudo equipo={local} size="sm" />
                    <span className="nombre">{local?.nombre}</span>
                  </div>
                  <div className="lado">
                    <Escudo equipo={visita} size="sm" />
                    <span className="nombre">{visita?.nombre}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        <div className="btn-fila" style={{ marginTop: 18 }}>
          <button className="btn fantasma" onClick={() => setPaso(1)}>Ajustar</button>
          <button className="btn" onClick={publicar} disabled={guardando || !propuesta.partidos.length}>
            Publicar liga
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <Topbar titulo="Nueva liga" />

      <p className="sub" style={{ marginTop: 14 }}>
        Dinos las condiciones. El calendario lo propone Sebel y tú lo ajustas.
      </p>

      <div className="campo" style={{ marginTop: 18 }}>
        <label htmlFor="n">Nombre de la liga</label>
        <input id="n" value={nombre} onChange={(e) => setNombre(e.target.value)}
          placeholder="Liga Barrial Río Abajo" />
      </div>

      <div className="campo">
        <label htmlFor="dep">Deporte</label>
        <select id="dep" value={deporte} onChange={(e) => setDeporte(e.target.value)}>
          <option value="baloncesto">Baloncesto</option>
          <option value="futsal">Fútbol sala</option>
        </select>
      </div>

      <div className="campo">
        <label htmlFor="eq">Equipos: {nEquipos}</label>
        <input id="eq" type="range" min="4" max="12" step="2" value={nEquipos}
          onChange={(e) => setNEquipos(Number(e.target.value))} />
      </div>

      <div className="campo">
        <label>Canchas</label>
        <div className="chips">
          {(canchas || []).map((c) => (
            <button key={c.id}
              className={`chip ${canchaIds.includes(c.id) ? 'on' : ''}`}
              onClick={() => alternar(canchaIds, setCanchaIds, c.id)}>
              {c.nombre}
            </button>
          ))}
        </div>
      </div>

      <div className="campo">
        <label>Días de juego</label>
        <div className="chips">
          {DIAS.map((d, i) => (
            <button key={d} className={`chip ${dias.includes(i) ? 'on' : ''}`}
              onClick={() => alternar(dias, setDias, i)}>
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="campo">
        <label>Horas disponibles</label>
        <div className="chips">
          {[...FRANJAS, '19:00', '20:30'].filter((v, i, a) => a.indexOf(v) === i).map((f) => (
            <button key={f} className={`chip ${franjas.includes(f) ? 'on' : ''}`}
              onClick={() => alternar(franjas, setFranjas, f)}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div className="campo" style={{ flex: 1 }}>
          <label htmlFor="d1">Desde</label>
          <input id="d1" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="campo" style={{ flex: 1 }}>
          <label htmlFor="d2">Hasta</label>
          <input id="d2" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </div>

      <button className="btn" disabled={!listo} onClick={() => setPaso(2)}>
        Generar calendario
      </button>
      {!listo && (
        <p className="sub" style={{ marginTop: 10, textAlign: 'center' }}>
          Falta el nombre, al menos una cancha, un día y una hora.
        </p>
      )}
    </>
  )
}
