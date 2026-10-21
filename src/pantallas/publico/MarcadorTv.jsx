import { createContext, useContext, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { iniciales } from '../../lib/publico/vista-reloj.js'
import { diapositivasDeBanda, parejasDePatrocinio, tintasDe } from '../../lib/publico/medios.js'
import { etiquetaPeriodo } from '../../lib/publico/vista-marcador.js'
import './marcador-tv.css'

// ---------------------------------------------------------------------------
// Marcador grande (REPORT_191): las vistas del diseño v0 aprobado (partido en juego, entre períodos, entre partidos) como presentación
// pura. No lee nada ni calcula el reloj: recibe lo que PartidoPublico ya derivó de la lectura pública del servidor. Los textos de
// Semabel son los aprobados en el v0. Sin patrocinadores propios de la liga se muestra la promoción de Semabel (nunca patrocinadores de
// ejemplo). Adaptado de components/scoreboard/{live-view,break-views,parts,rotator,semabel-panel}.tsx.
// ---------------------------------------------------------------------------

export const ROTACION_PATROCINIO_MS = 12000

export const PROMO_ORGANIZADOR = Object.freeze({
  titular: 'Tu torneo merece quedar en la historia.',
  cuerpo: 'Organiza el calendario, lleva el marcador desde tu teléfono y comparte cada partido.',
  pie: 'semabel.com',
})
export const PROMO_ESPECTADOR = Object.freeze({
  titular: 'La emoción está en la cancha. La historia sigue aquí.',
  cuerpo: 'Sigue los marcadores, descubre a los protagonistas y comparte tu equipo.',
  pie: 'semabel.com · Sin cuenta para mirar.',
})
// La promoción de Semabel es una tarjeta estructurada más: la pinta el MISMO componente que a los patrocinadores del organizador.
const tarjetaSemabel = (id, nombre) => ({ id, formato: 'tarjeta', marca: true, nombre, descriptor: 'semabel.com', logo: null, imagen: null, imagenGrande: null, fondo: '#FFFFFF', texto: '#12151C', acento: '#C21F2E', borde: true })
const SEMABEL = tarjetaSemabel('semabel-organizador', PROMO_ORGANIZADOR.titular)
const SEMABEL_ESPECTADOR = tarjetaSemabel('semabel-espectador', PROMO_ESPECTADOR.titular)

// REPORT_196: el logo real de Semabel (manifiesto raíz `semabel.logo`) para sus tarjetas de promoción. Sin él (o si falla) queda el punto rojo de antes.
const LogoSemabelCtx = createContext({ url: null, alFallar: () => {} })
/** El logo de Semabel que se puede mostrar ({ url | null, alFallar }). El estado de fallo es UNO para todas las tarjetas: si la imagen falla, todas vuelven al punto rojo y al rubro. */
const useLogoSemabel = () => useContext(LogoSemabelCtx)
function ConLogoSemabel({ url, children }) {
  const [falla, setFalla] = useState(false)
  useEffect(() => { setFalla(false) }, [url])
  const valor = { url: url && !falla ? url : null, alFallar: () => setFalla(true) }
  return <LogoSemabelCtx.Provider value={valor}>{children}</LogoSemabelCtx.Provider>
}

/** Gira entre `largo` diapositivas cada `cadaMs`. Con una sola no hay temporizador. */
export function useRotacion(largo, cadaMs = ROTACION_PATROCINIO_MS) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (largo <= 1) return undefined
    const id = window.setInterval(() => setI((c) => (c + 1) % largo), cadaMs)
    return () => window.clearInterval(id)
  }, [largo, cadaMs])
  return i % Math.max(largo, 1)
}

function Rotador({ clase, etiqueta, activo, diapositivas }) {
  return (
    <div className={`sb-rotator ${clase}`} role="region" aria-label={etiqueta} aria-live="off">
      {diapositivas.map((d, i) => (
        <div key={i} className="sb-rotator__slide" data-active={i === activo} aria-hidden={i !== activo}>{d}</div>
      ))}
    </div>
  )
}

/** Imagen local que, si falla o no existe, deja el lugar a su alternativa (nunca un icono roto). */
function Imagen({ src, clase, alternativa = null }) {
  const [falla, setFalla] = useState(false)
  useEffect(() => { setFalla(false) }, [src])
  if (!src || falla) return alternativa
  return <img className={clase} src={src} alt="" draggable="false" onError={() => setFalla(true)} />
}

function Escudo({ nombre, logo, color, size = 'md' }) {
  const [cargado, setCargado] = useState(false)
  useEffect(() => { setCargado(false) }, [logo])
  return (
    <span className={`sb-crest sb-crest--${size}${logo && cargado ? ' sb-crest--img' : ''}`} style={{ backgroundColor: color }} aria-hidden="true">
      {iniciales(nombre)}
      {logo && <LogoCarga src={logo} alCargar={() => setCargado(true)} />}
    </span>
  )
}
function LogoCarga({ src, alCargar }) {
  const [falla, setFalla] = useState(false)
  useEffect(() => { setFalla(false) }, [src])
  if (falla) return null
  return <img className="sb-crest__img" src={src} alt="" draggable="false" onLoad={alCargar} onError={() => setFalla(true)} style={{ visibility: 'visible' }} />
}

/** Emblema del organizador (manifiesto `organizador.logo`). Sin imagen, o si falla, quedan las iniciales; con la imagen cargada se muestra entera sobre fondo claro. */
function MarcaOrganizador({ nombre, logo }) {
  const [cargado, setCargado] = useState(false)
  const [falla, setFalla] = useState(false)
  useEffect(() => { setCargado(false); setFalla(false) }, [logo])
  return (
    <span className={`sb-org-mark${logo && cargado && !falla ? ' sb-org-mark--img' : ''}`} aria-hidden="true">
      {iniciales(nombre)}
      {logo && !falla && <img className="sb-org-mark__img" src={logo} alt="" draggable="false" onLoad={() => setCargado(true)} onError={() => setFalla(true)} />}
    </span>
  )
}

/** Marca de Semabel arriba a la derecha (REPORT_200): el logo real (manifiesto raíz `semabel.logo`), entero y sin repetir la dirección; sin él, o si falla, el punto rojo y «semabel.com». */
function MarcaSemabel() {
  const logo = useLogoSemabel()
  if (logo.url) return <img className="sb-header__logo" src={logo.url} alt="Semabel · semabel.com" draggable="false" onError={logo.alFallar} />
  return <p className="sb-brand"><span className="sb-brand__dot" aria-hidden="true" />semabel.com</p>
}

/** Encabezado del v0: organizador (aquí, la liga y su categoría), fecha y sede, marca semabel.com y el aviso de conexión. */
function Encabezado({ marca, categoria, fecha, sede, logo, sinActualizar }) {
  return (
    <header className="sb-header">
      <div className="sb-header__org">
        <MarcaOrganizador nombre={marca} logo={logo} />
        <div className="sb-header__org-text">
          <p className="sb-header__org-name">{marca}</p>
          {categoria && <p className="sb-header__category">{categoria}</p>}
        </div>
      </div>
      <div className="sb-header__meta">
        {fecha && <p className="sb-header__day">{fecha}</p>}
        {sede && <p className="sb-header__venue">{sede}</p>}
      </div>
      <div className="sb-header__brand">
        <MarcaSemabel />
        {sinActualizar && <p className="sb-stale" role="status">{sinActualizar}</p>}
      </div>
    </header>
  )
}

function Promocion({ promo }) {
  const logo = useLogoSemabel()
  // Con el logo (que ya trae «semabel.com») no se repite la dirección junto a él: el pie conserva solo lo que el logo no dice.
  const pie = logo.url ? promo.pie.replace(/^semabel\.com\s*·?\s*/, '') : promo.pie
  return (
    <div className="sb-promo">
      <div className="sb-promo__copy">
        <p className="sb-promo__headline">{promo.titular}</p>
        <p className="sb-promo__body">{promo.cuerpo}</p>
        {pie && <p className="sb-promo__footer">{pie}</p>}
      </div>
      {logo.url
        ? <p className="sb-promo__mark sb-promo__mark--logo"><img className="sb-promo__logo" src={logo.url} alt="Semabel · semabel.com" draggable="false" onError={logo.alFallar} /></p>
        : <p className="sb-promo__mark" aria-hidden="true"><span className="sb-brand__dot" />semabel</p>}
    </div>
  )
}

/** Marca de una tarjeta: el punto de Semabel, el logo suministrado (con su proporción) o nada. Un logo que falla desaparece sin dejar hueco. */
function MarcaTarjeta({ p }) {
  const logo = useLogoSemabel()
  if (p.marca && logo.url) return <span className="sb-sponsor__mark sb-sponsor__mark--semabel"><img className="sb-sponsor__logo-semabel" src={logo.url} alt="Semabel · semabel.com" draggable="false" onError={logo.alFallar} /></span>
  if (p.marca) return <span className="sb-sponsor__mark" aria-hidden="true"><span className="sb-brand__dot" /></span>
  if (!p.logo) return null
  return <span className="sb-sponsor__mark sb-sponsor__mark--logo" aria-hidden="true"><Imagen src={p.logo} clase="sb-sponsor__logo" /></span>
}

/**
 * Variante «logo protagonista» (`disposicion: "logo"`, REPORT_194): el logo COMPLETO (con su nombre, colores y proporción) ocupa el lado grande de la tarjeta, sin
 * encajarlo en el hueco del icono; el nombre de la empresa queda como texto accesible (no se repite como título) y el rubro es texto pintado. Si el logo falla,
 * se cae a la tarjeta normal con el nombre visible.
 */
function TarjetaLogo({ p, size }) {
  const t = tintasDe(p)
  const [falla, setFalla] = useState(false)
  useEffect(() => { setFalla(false) }, [p.logo])
  if (falla) return <TarjetaPatrocinio p={{ ...p, disposicion: null }} size={size} />
  return (
    <div
      className={`sb-sponsor sb-sponsor--${size} sb-sponsor--card sb-sponsor--logo${p.borde ? ' sb-sponsor--bordered' : ''}`}
      style={{ backgroundColor: t.fondo, color: t.texto }} role="group" aria-label={p.nombre}
      data-formato="tarjeta" data-disposicion="logo" data-patrocinador={p.id}
    >
      <img className="sb-sponsor__logo-grande" src={p.logo} alt={p.nombre} draggable="false" onError={() => setFalla(true)} />
      {p.descriptor && <span className="sb-sponsor__descriptor" style={{ color: t.acento }}>{p.descriptor}</span>}
    </div>
  )
}

/** Tarjeta estructurada (formato A, el diseño v0): rubro corto en el color de acento, nombre grande, logo opcional, colores de la marca. */
function TarjetaPatrocinio({ p, size }) {
  const logoSemabel = useLogoSemabel()
  if (p.disposicion === 'logo' && p.logo) return <TarjetaLogo p={p} size={size} />
  const t = tintasDe(p)
  const sinRubro = p.marca && logoSemabel.url // el logo ya lleva «semabel.com»: no se repite como rubro a su lado
  const largo = p.nombre.length > 40 ? 'xl' : p.nombre.length > 20 ? 'largo' : p.nombre.length > 12 ? 'medio' : 'corto'
  return (
    <div
      className={`sb-sponsor sb-sponsor--${size} sb-sponsor--card${p.borde ? ' sb-sponsor--bordered' : ''}${sinRubro ? ' sb-sponsor--semabel-logo' : ''}`}
      style={{ backgroundColor: t.fondo, color: t.texto }} data-formato="tarjeta" data-patrocinador={p.id} data-origen={p.marca ? 'semabel' : undefined}
    >
      <MarcaTarjeta p={p} />
      <span className="sb-sponsor__text">
        {p.descriptor && !sinRubro && <span className="sb-sponsor__descriptor" style={{ color: t.acento }}>{p.descriptor}</span>}
        <span className="sb-sponsor__name" data-largo={largo}>{p.nombre}</span>
      </span>
    </div>
  )
}

/**
 * Arte terminado (formato B): la imagen local se muestra entera, sin deformarla ni recortarla, centrada sobre su propio fondo. En el espacio
 * grande (descansos y final) y en teléfonos se prefiere `imagenGrande`; si una imagen falla se prueba la siguiente y, si todas fallan, la tarjeta con su nombre
 * (o la promoción de Semabel si no tiene nombre).
 */
/** ¿Pantalla de teléfono (≤ 640 px, la misma regla del CSS)? Allí la banda es casi 2:1, mucho más cuadrada que en el televisor (≈ 4,2:1). */
function useTelefono() {
  const consulta = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 640px)') : null
  const [si, setSi] = useState(() => Boolean(consulta?.matches))
  useEffect(() => {
    if (!consulta) return undefined
    const alCambiar = () => setSi(consulta.matches)
    consulta.addEventListener?.('change', alCambiar)
    return () => consulta.removeEventListener?.('change', alCambiar)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return si
}

function ArtePatrocinio({ p, size }) {
  const telefono = useTelefono()
  // Espacio grande o teléfono: se prefiere el arte de proporción cercana a 8:5 (`imagenGrande`); en la banda del televisor, `imagen` (≈ 25:6).
  const cadena = (size === 'large' || telefono ? [p.imagenGrande, p.imagen] : [p.imagen]).filter(Boolean)
  const [fallos, setFallos] = useState(0)
  useEffect(() => { setFallos(0) }, [cadena.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const src = cadena[fallos]
  if (!src) return <TarjetaPatrocinio p={p.nombre ? { ...p, formato: 'tarjeta' } : SEMABEL} size={size} />
  return (
    <div className={`sb-sponsor sb-sponsor--${size} sb-sponsor--art`} style={{ backgroundColor: p.fondo ?? '#FFFFFF' }} data-formato="arte" data-patrocinador={p.id}>
      <img className="sb-sponsor__art" src={src} alt={p.nombre ?? ''} draggable="false" onError={() => setFallos((n) => n + 1)} />
    </div>
  )
}

function Patrocinador({ p, size }) {
  return p.formato === 'arte' ? <ArtePatrocinio p={p} size={size} /> : <TarjetaPatrocinio p={p} size={size} />
}

function Pareja({ pareja, size }) {
  const nombres = pareja.map((p) => (p.marca ? 'Semabel' : p.nombre ?? p.id)).join(' y ')
  return (
    <div className="sb-sponsor-pair" aria-label={`Patrocinadores: ${nombres}`}>
      <Patrocinador p={pareja[0]} size={size} />
      <Patrocinador p={pareja[1]} size={size} />
    </div>
  )
}

/**
 * Diapositiva dedicada de Semabel en la banda en vivo (REPORT_197): UNA sola tarjeta que ocupa toda la banda (misma altura y mismo ancho que las dos tarjetas de una
 * pareja juntas): logo real a la izquierda, mensaje aprobado a la derecha. El logo ya trae «semabel.com», así que la dirección no se repite. Sin logo (o si falla),
 * el punto rojo con «semabel.com» ocupa su lugar.
 */
function SemabelBanda() {
  const logo = useLogoSemabel()
  return (
    <div className="sb-sponsor-pair sb-sponsor-pair--completa" aria-label="Semabel">
      <div className="sb-sponsor sb-sponsor--band sb-sponsor--card sb-sponsor--bordered sb-sponsor--semabel-banda" data-formato="tarjeta" data-origen="semabel" data-patrocinador="semabel-banda" style={{ backgroundColor: '#FFFFFF', color: '#12151C' }}>
        {logo.url
          ? <img className="sb-semabel-banda__logo" src={logo.url} alt="Semabel · semabel.com" draggable="false" onError={logo.alFallar} />
          : <span className="sb-semabel-banda__marca"><span className="sb-brand__dot" aria-hidden="true" />semabel.com</span>}
        <span className="sb-semabel-banda__texto">
          <span className="sb-semabel-banda__titular">{PROMO_ESPECTADOR.titular}</span>
          <span className="sb-semabel-banda__cuerpo">{PROMO_ESPECTADOR.cuerpo}</span>
        </span>
      </div>
    </div>
  )
}

/**
 * Banda permanente de patrocinio durante el juego, cada diapositiva ≈ 12 s. Los patrocinadores en su orden, de dos en dos (con un número impar, el último se acompaña de la
 * tarjeta del espectador), y SIEMPRE una diapositiva dedicada de Semabel al final de cada ciclo (ver diapositivasDeBanda): una tarjeta a todo el ancho de la banda.
 */
function BandaPatrocinio({ patrocinadores }) {
  const diapositivas = diapositivasDeBanda(patrocinadores, SEMABEL, SEMABEL_ESPECTADOR)
  const activo = useRotacion(diapositivas.length)
  const dedicada = (p) => p[0] === SEMABEL && p[1] === SEMABEL_ESPECTADOR
  return <Rotador clase="sb-band" etiqueta="Patrocinadores" activo={activo % diapositivas.length} diapositivas={diapositivas.map((p, i) => (dedicada(p) ? <SemabelBanda key={i} /> : <Pareja key={i} pareja={p} size="band" />))} />
}

/** Escenario grande de los descansos y del final: patrocinadores grandes alternando con la promoción de Semabel (v0 `promoSlides`). */
function Escenario({ patrocinadores, promo }) {
  const parejas = parejasDePatrocinio(patrocinadores, SEMABEL)
  const diapositivas = patrocinadores.length === 0
    ? [<div key="p" className="sb-promo-wrap"><Promocion promo={promo} /></div>]
    : parejas.flatMap((p, i) => [<Pareja key={`s${i}`} pareja={p} size="large" />, <div key={`p${i}`} className="sb-promo-wrap"><Promocion promo={promo} /></div>])
  const activo = useRotacion(diapositivas.length)
  return <Rotador clase="sb-stage" etiqueta="Patrocinadores y mensajes" activo={activo % diapositivas.length} diapositivas={diapositivas} />
}

function PanelEquipo({ equipo, lado, logo, color, mostrarFaltas, etiquetaFaltas, faltas, digitos, enlace }) {
  const nombre = equipo.nombre
  return (
    <article className="sb-team" data-side={lado} style={{ '--team-color': color, '--d': digitos }} aria-label={`${nombre}: ${equipo.puntos} puntos`}>
      <div className="sb-team__id">
        <Escudo nombre={nombre} logo={logo} color={color} />
        <h2 className="sb-team__name" data-long={nombre.length > 22}>{enlace ? <Link to={enlace}>{nombre}</Link> : nombre}</h2>
      </div>
      <p className="sb-score" aria-label={`Puntos de ${nombre}`}>{equipo.puntos}</p>
      {mostrarFaltas && (
        <p className="sb-fouls">
          <span className="sb-fouls__label">{etiquetaFaltas}</span>
          <span className="sb-fouls__value">{faltas}</span>
        </p>
      )}
    </article>
  )
}

/** Partido en juego (y programado): marcador grande, reloj, periodo, faltas según la categoría, aviso de canasta y banda de patrocinio. */
function VistaJuegoInterna({ cab, d, ctx, centro, aviso }) {
  const periodo = d.faltasEquipo === 'periodo'
  const mostrarFaltas = d.faltasEquipo === 'periodo' || d.faltasEquipo === 'partido'
  const etiquetaFaltas = periodo ? 'Faltas del período' : 'Faltas del partido'
  const lado = (eq, s) => (
    <PanelEquipo
      equipo={eq} lado={s === 'local' ? 'home' : 'away'} logo={ctx.medios.equipos[eq.id]?.logo ?? null} color={ctx.medios.equipos[eq.id]?.color ?? ctx.color[s]}
      mostrarFaltas={mostrarFaltas} etiquetaFaltas={etiquetaFaltas} faltas={periodo ? eq.faltasPeriodo : eq.faltas} digitos={ctx.digitos} enlace={ctx.enlaceEquipo(eq)}
    />
  )
  return (
    <div className="sb-layout sb-layout--live" data-vista={ctx.vista}>
      <Encabezado {...cab} />
      <section className="sb-game" aria-label="Marcador">
        {lado(d.local, 'local')}
        <div className="sb-center">{centro}</div>
        {lado(d.visita, 'visita')}
      </section>
      <div className="sb-notice-line" aria-live="polite">
        {aviso && (
          <p className="sb-notice" data-visible={aviso.visible} key={aviso.seq}>
            <span className="sb-notice__mark" aria-hidden="true" />
            {aviso.texto}
          </p>
        )}
        {d.faltasEquipo === 'no-disponible' && !aviso && <p className="sb-fouls-off" data-alcance="no-disponible">Faltas de equipo no disponibles</p>}
      </div>
      <BandaPatrocinio patrocinadores={ctx.medios.patrocinadores} />
    </div>
  )
}

function Compacto({ equipo, lado, logo, color, digitos }) {
  return (
    <div className="sb-compact" data-side={lado} style={{ '--team-color': color, '--d': digitos }} aria-label={`${equipo.nombre}: ${equipo.puntos} puntos`}>
      <div className="sb-compact__id">
        <Escudo nombre={equipo.nombre} logo={logo} color={color} size="sm" />
        <p className="sb-compact__name">{equipo.nombre}</p>
      </div>
      <p className="sb-compact__score" aria-label={`Puntos de ${equipo.nombre}`}>{equipo.puntos}</p>
    </div>
  )
}

/** Fin de período (descanso) o fin del último período (resultado todavía no confirmado). Equipos, marcador y período siguen visibles. */
function VistaDescansoInterna({ cab, d, ctx, deporte }) {
  const ultimo = ctx.vista === 'fin-tiempo'
  const lado = (eq, s) => <Compacto equipo={eq} lado={s === 'local' ? 'home' : 'away'} logo={ctx.medios.equipos[eq.id]?.logo ?? null} color={ctx.medios.equipos[eq.id]?.color ?? ctx.color[s]} digitos={ctx.digitos} />
  return (
    <div className="sb-layout sb-layout--break" data-vista={ctx.vista}>
      <Encabezado {...cab} />
      <section className="sb-strip" aria-label={ultimo ? 'Marcador al terminar el tiempo' : 'Marcador durante el descanso'}>
        {lado(d.local, 'local')}
        <div className="sb-strip__center">
          <p className="sb-period">Final del {etiquetaPeriodo(deporte, d.periodo)}</p>
          <p className="sb-strip__title">{ultimo ? 'Resultado por confirmar' : 'Descanso entre períodos'}</p>
        </div>
        {lado(d.visita, 'visita')}
      </section>
      <Escenario patrocinadores={ctx.medios.patrocinadores} promo={PROMO_ORGANIZADOR} />
    </div>
  )
}

function FilaResultado({ equipo, ganador, logo, color }) {
  return (
    <div className="sb-result" data-winner={ganador}>
      <p className="sb-result__team"><Escudo nombre={equipo.nombre} logo={logo} color={color} size="sm" /><span data-largo={equipo.nombre.length > 22}>{equipo.nombre}</span></p>
      <p className="sb-result__score" aria-label={`Puntos de ${equipo.nombre}`}>{equipo.puntos}</p>
    </div>
  )
}

/**
 * Entre partidos: resultado final de ESTE partido y, si `proximo` se pudo determinar sin ambigüedad, el próximo. Si no, una tarjeta honesta
 * que no promete ningún partido. `proximo`: { local, visita, hora, fecha?, categoria } ya resuelto por quien muestra el marcador, o null.
 */
function VistaEntrePartidosInterna({ cab, d, ctx, categoria, proximo, sinProximo = null }) {
  const empate = d.local.puntos === d.visita.puntos
  const gana = (a, b) => !empate && a > b
  const lado = (eq, s) => ({ logo: ctx.medios.equipos[eq.id]?.logo ?? null, color: ctx.medios.equipos[eq.id]?.color ?? ctx.color[s] })
  const l = lado(d.local, 'local')
  const v = lado(d.visita, 'visita')
  return (
    <div className="sb-layout sb-layout--between" data-vista="final">
      <Encabezado {...cab} />
      <section className="sb-cards" aria-label="Resultado final y próximo partido">
        <article className="sb-card">
          <p className="sb-card__label">Resultado final</p>
          <FilaResultado equipo={d.local} ganador={gana(d.local.puntos, d.visita.puntos)} {...l} />
          <FilaResultado equipo={d.visita} ganador={gana(d.visita.puntos, d.local.puntos)} {...v} />
          {categoria && <p className="sb-card__meta">{categoria}</p>}
        </article>
        <article className="sb-card sb-card--next">
          {proximo ? (
            <>
              <p className="sb-card__label sb-card__label--accent">Próximo partido</p>
              <div className="sb-next">
                <div className="sb-next__teams">
                  <p className="sb-next__team"><Escudo nombre={proximo.local} color={ctx.color.local} size="sm" /><span data-largo={proximo.local.length > 22}>{proximo.local}</span></p>
                  <p className="sb-next__vs">vs</p>
                  <p className="sb-next__team"><Escudo nombre={proximo.visita} color={ctx.color.visita} size="sm" /><span data-largo={proximo.visita.length > 22}>{proximo.visita}</span></p>
                </div>
                <div className="sb-next__when">
                  {proximo.fecha && <p className="sb-next__date">{proximo.fecha}</p>}
                  <p className="sb-next__time">{proximo.hora}</p>
                </div>
              </div>
              {proximo.categoria && <p className="sb-card__meta">{proximo.categoria}</p>}
            </>
          ) : (
            <>
              <p className="sb-card__label sb-card__label--accent">{sinProximo?.etiqueta ?? 'Calendario'}</p>
              <p className="sb-card__note" data-sin-proximo="true">{sinProximo?.nota ?? 'Consulta los próximos partidos de la liga en semabel.com'}</p>
            </>
          )}
        </article>
      </section>
      <Escenario patrocinadores={ctx.medios.patrocinadores} promo={PROMO_ESPECTADOR} />
    </div>
  )
}

// Las tres vistas se envuelven para dar a sus tarjetas de Semabel el logo configurado (ctx.medios.semabelLogo); sin él, nada cambia.
const conLogo = (ctx, hijo) => <ConLogoSemabel url={ctx.medios.semabelLogo ?? null}>{hijo}</ConLogoSemabel>
export const VistaJuego = (props) => conLogo(props.ctx, <VistaJuegoInterna {...props} />)
export const VistaDescanso = (props) => conLogo(props.ctx, <VistaDescansoInterna {...props} />)
export const VistaEntrePartidos = (props) => conLogo(props.ctx, <VistaEntrePartidosInterna {...props} />)
