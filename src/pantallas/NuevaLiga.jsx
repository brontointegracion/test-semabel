import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, uid } from '../db'
import { useCanchas, useSesion, useCuenta } from '../datos'
import { generarCalendario, DIAS } from '../lib/calendario'
import { Topbar, Escudo, fechaCorta, hora, mismoDia } from '../ui'
import { urlLiga } from '../lib/enlaces'

const COLORES = ['#C9452B', '#2A5C86', '#D89B1C', '#1E7F8C', '#6B4E9B', '#0D6B55', '#8C3B63', '#3F6B22']
const FRANJAS = ['18:00', '19:00', '20:00', '21:00']

const enISO = (d) => new Date(d).toISOString().slice(0, 10)

// Mismo criterio que ya usa la semilla en seed.js: iniciales de las palabras
// del nombre, hasta tres letras. Si el nombre no tiene letras (un caso raro,
// pero el campo no obliga a que las tenga), se cae a las primeras letras/
// símbolos tal cual, para que el escudo nunca se quede sin iniciales.
const abreviarEquipo = (nombre) => {
  const soloLetras = nombre
    .replace(/[^A-Za-zÁÉÍÓÚÑ ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase()
  return soloLetras || nombre.trim().slice(0, 3).toUpperCase()
}

const normalizarNombreEquipo = (n) => n.trim().toLowerCase()

export default function NuevaLiga() {
  const canchas = useCanchas()
  const sesion = useSesion()
  const cuenta = useCuenta()
  const nav = useNavigate()

  const hoy = new Date()
  const en8 = new Date(); en8.setDate(hoy.getDate() + 56)

  const [nombre, setNombre] = useState('')
  const [deporte, setDeporte] = useState('baloncesto')
  const [nEquipos, setNEquipos] = useState(6)
  const [nombresEquipos, setNombresEquipos] = useState(() => Array.from({ length: 6 }, () => ''))
  const [canchaIds, setCanchaIds] = useState([])
  const [dias, setDias] = useState([3, 5])
  const [franjas, setFranjas] = useState(['19:00', '20:30'])
  const [desde, setDesde] = useState(enISO(hoy))
  const [hasta, setHasta] = useState(enISO(en8))
  const [categoria, setCategoria] = useState('Libre')
  const [aceptaRetos, setAceptaRetos] = useState(true)
  const [paso, setPaso] = useState(1)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // Al mover el control de cuántos equipos, los nombres que ya se habían
  // escrito se quedan donde están: solo se agregan casillas vacías al final
  // (al subir) o se recortan las de más (al bajar). Nunca se reordena nada.
  const cambiarNEquipos = (n) => {
    setNEquipos(n)
    setNombresEquipos((prev) => (
      n > prev.length
        ? [...prev, ...Array.from({ length: n - prev.length }, () => '')]
        : prev.slice(0, n)
    ))
  }

  const cambiarNombreEquipo = (i, valor) =>
    setNombresEquipos((prev) => prev.map((n, idx) => (idx === i ? valor : n)))

  const equiposDemo = useMemo(
    () => nombresEquipos.map((n, i) => {
      const nombreEq = n.trim()
      return {
        id: `tmp-${i}`,
        nombre: nombreEq,
        corto: nombreEq ? abreviarEquipo(nombreEq) : '',
        color: COLORES[i % COLORES.length],
      }
    }),
    [nombresEquipos],
  )

  const nombresEquiposTrim = useMemo(() => nombresEquipos.map((n) => n.trim()), [nombresEquipos])
  const faltaNombreEquipo = nombresEquiposTrim.some((n) => !n)
  const nombresEquiposDuplicados = useMemo(() => {
    const vistos = new Set()
    const repetidos = new Set()
    for (const n of nombresEquiposTrim) {
      if (!n) continue
      const clave = normalizarNombreEquipo(n)
      if (vistos.has(clave)) repetidos.add(clave)
      vistos.add(clave)
    }
    return repetidos
  }, [nombresEquiposTrim])
  const hayNombresDuplicados = nombresEquiposDuplicados.size > 0

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
    && !faltaNombreEquipo && !hayNombresDuplicados
  const precio = (nEquipos * 1.5 + propuesta.partidos.length * 0.4).toFixed(2)

  const alternar = (lista, set, v) =>
    set(lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v].sort())

  const publicar = async () => {
    setGuardando(true)
    setError(null)
    const ligaId = uid()
    const codigoLiga = String(1000 + Math.floor(Math.random() * 8999))

    try {
      await db.transaction('rw', db.ligas, db.equipos, db.partidos, async () => {
        await db.ligas.add({
          id: ligaId,
          nombre: nombre.trim(),
          deporte,
          codigo: codigoLiga,
          canchaIds,
          diasSemana: dias,
          franjas,
          minutosPorPeriodo: deporte === 'baloncesto' ? 10 : 20,
          categoria,
          aceptaRetos,
          desde: new Date(`${desde}T00:00:00`).toISOString(),
          hasta: new Date(`${hasta}T23:59:59`).toISOString(),
          pais: (canchas || []).find((c) => c.id === canchaIds[0])?.pais,
          provincia: (canchas || []).find((c) => c.id === canchaIds[0])?.provincia,
          estado: 'publicada',
          pagada: true,
          organizador: cuenta?.nombre || 'Organizador',
          organizadorId: sesion?.cuentaId,
        })

        const equipos = equiposDemo.map((e) => ({
          ...e,
          id: uid(),
          codigo: String(1000 + Math.floor(Math.random() * 8999)),
          ligaId,
        }))
        await db.equipos.bulkAdd(equipos)

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
      })

      nav(urlLiga({ nombre: nombre.trim(), codigo: codigoLiga }), { replace: true })
    } catch (e) {
      // La transacción no dejó nada a medias: si algo falló, no hay liga, ni
      // equipos, ni partidos guardados. El organizador puede volver a intentar.
      console.error('No se pudo publicar la liga:', e)
      setGuardando(false)
      setError('No se pudo publicar la liga. No se guardó nada a medias — puedes volver a intentarlo.')
    }
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

        {error && (
          <div className="aviso alerta" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        <div className="btn-fila" style={{ marginTop: 18 }}>
          <button className="btn fantasma" onClick={() => { setPaso(1); setError(null) }}>Ajustar</button>
          <button className="btn" onClick={publicar} disabled={guardando || !propuesta.partidos.length}>
            {guardando ? 'Publicando…' : 'Publicar liga'}
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
        <label htmlFor="cat">Categoría</label>
        <select id="cat" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="Libre">Libre (cualquier edad)</option>
          <option value="35+">Veteranos 35+</option>
          <option value="40+">Veteranos 40+</option>
          <option value="45+">Veteranos 45+</option>
          <option value="50+">Veteranos 50+</option>
        </select>
      </div>

      <label className="casilla">
        <input
          type="checkbox"
          checked={aceptaRetos}
          onChange={(e) => setAceptaRetos(e.target.checked)}
        />
        <span>
          <strong>Aceptar retos de otras ligas</strong>
          <span className="sub">
            Otras ligas de {categoria === 'Libre' ? 'la misma categoría' : `categoría ${categoria}`} y
            del mismo deporte podrán retarte. Cada una juega lo suyo en su cancha y se comparan los
            promedios de la semana. Nadie viaja.
          </span>
        </span>
      </label>

      <div className="campo" style={{ marginTop: 16 }}>
        <label>Equipos</label>
        <div className="btn-fila" style={{ alignItems: 'center' }}>
          <button
            type="button"
            className="btn fantasma"
            onClick={() => cambiarNEquipos(Math.max(4, nEquipos - 2))}
            disabled={nEquipos <= 4}
            aria-label="Menos equipos"
          >
            −
          </button>
          <span style={{ fontWeight: 800, minWidth: 24, textAlign: 'center' }}>{nEquipos}</span>
          <button
            type="button"
            className="btn fantasma"
            onClick={() => cambiarNEquipos(Math.min(12, nEquipos + 2))}
            disabled={nEquipos >= 12}
            aria-label="Más equipos"
          >
            +
          </button>
        </div>
      </div>

      <div className="campo">
        <label>Nombres de los equipos</label>
        {nombresEquipos.map((n, i) => {
          const repetido = n.trim() && nombresEquiposDuplicados.has(normalizarNombreEquipo(n))
          return (
            <input
              key={i}
              value={n}
              onChange={(e) => cambiarNombreEquipo(i, e.target.value)}
              placeholder="Nombre del equipo"
              aria-label={`Nombre del equipo ${i + 1}`}
              style={{
                marginTop: i > 0 ? 8 : 0,
                borderColor: repetido ? 'var(--acento)' : undefined,
              }}
            />
          )
        })}
        {hayNombresDuplicados && (
          <p className="sub" style={{ color: 'var(--acento-ink)', marginTop: 8 }}>
            Hay nombres repetidos. Cada equipo necesita un nombre distinto dentro de esta liga.
          </p>
        )}
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
          Falta el nombre de la liga, un nombre para cada equipo sin repetir, al menos una
          cancha, un día y una hora.
        </p>
      )}
    </>
  )
}
