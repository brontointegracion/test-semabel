import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import './GuiaArbitro.css'

// ---------------------------------------------------------------------------
// «Guía de puntuación» (REPORT_206): guía breve, en español, para quien puntúa desde un teléfono en la cancha del piloto.
// Es CONTENIDO ESTÁTICO: no lee ni escribe nada (ni red, ni almacenamiento, ni credenciales), no lleva códigos ni datos de sesión y no
// toca el ciclo de vida de los comandos. Los nombres de botones son los de las pantallas reales (ControlActivar, ControlPartido,
// ConsolaPiezas, PartidoOrganizador); si cambian allí, hay que cambiarlos aquí (la prueba GuiaArbitro.test.jsx lo comprueba).
//
// Dos presentaciones del MISMO contenido:
//   · /ayuda/arbitro            página pública de solo lectura (GuiaArbitro, export por defecto).
//   · <GuiaEnLinea />           panel desplegable DENTRO de la pantalla de activación, de la consola y del acceso del organizador.
//     Se abre y se cierra sin cambiar de ruta: la consola no se desmonta (desmontarla cierra su controlador) y la pantalla de
//     activación y la del organizador conservan lo que tengan escrito o emitido.
// ---------------------------------------------------------------------------

export const TITULO_GUIA = 'Guía de puntuación'

export const SECCIONES = [
  {
    id: 'antes',
    titulo: '1. Antes del partido',
    puntos: [
      'Confirma qué equipos juegan y qué teléfono y qué navegador van a puntuar.',
      'Carga el teléfono y ten a mano un cargador o una batería externa.',
      'Para este piloto, alarga el tiempo de apagado de la pantalla o desactiva el bloqueo automático, si el teléfono lo permite.',
      'Deja disponible el navegador con el que activaste el teléfono y úsalo todo el partido.',
      'El código de acceso del organizador y el código de activación del partido son distintos. Para puntuar solo se usa el código del partido; no lo compartas.',
    ],
  },
  {
    id: 'activar',
    titulo: '2. Activar el teléfono',
    puntos: [
      'Recibes un enlace de activación y, por separado, el código del partido.',
      'Abre el enlace en el navegador normal que vas a usar, escribe el código en «Código del partido» y pulsa «Activar este teléfono».',
      '«Teléfono activado» no inicia el partido: después pulsa «Abrir control».',
      'Si es el teléfono equivocado, el organizador puede usar «Retirar acceso del teléfono» ANTES de que el partido comience, y generar un código nuevo para otro teléfono.',
      'El software actual no permite pasar el control a otro teléfono con el partido ya en marcha.',
    ],
  },
  {
    id: 'operar',
    titulo: '3. Comenzar y puntuar',
    puntos: [
      'Antes de pulsar «Comenzar el partido», confirma que es el partido correcto; después pulsa «Confirmar inicio». Hace falta internet y, hasta que el servidor confirme el inicio, no se puede anotar.',
      'Con el inicio confirmado, mira el reloj del periodo. En este piloto los partidos U10 son de 8 minutos por periodo (08:00) y los U12 de 10 minutos (10:00). Son ajustes de este piloto, no reglas universales del deporte. Si el reloj marca otra duración, avisa al organizador antes de seguir.',
      'El reloj se maneja con «▶ Arrancar» y «❚❚ Detener».',
      'Arriba elige el equipo, busca al jugador por su número y toca «+1», «+2» o «+3» para sus puntos, o «F» para una falta personal. Revisa que sea el jugador correcto antes de tocar.',
      'Un toque basta. Mira el aviso que aparece y la lista «Últimas acciones», donde cada acción se marca «Pendiente» o «Confirmado». No repitas el toque.',
      'La TV puede tardar unos segundos en mostrar el cambio.',
      'Pausa y fin de periodo no son lo mismo: «Detener» solo para el reloj y el periodo sigue. El fin de periodo se confirma cuando el reloj llega a 00:00; entonces el botón dice, por ejemplo, «Empezar el 2º cuarto». «Terminar el 1º cuarto antes de tiempo» cierra el periodo con tiempo en el reloj; úsalo solo si la mesa lo indica.',
      'Para corregir un error: «↺ Deshacer» anula la última acción y «↻ Rehacer» la recupera. En «Últimas acciones», «anular» anula una acción concreta de las 10 más recientes. Nada se borra: lo anulado queda registrado.',
      'Para corregir el reloj, deténlo primero. En «Corregir reloj (mm:ss)» escribe los números, por ejemplo 845 o 0845 (también vale 08:45), y toca fuera del campo: queda como 08:45. Dar formato al tiempo no envía nada: revisa que se vea bien y pulsa «Corregir». Los segundos van de 00 a 59 y el tiempo no puede superar la duración del periodo. Con uno o dos números solos (por ejemplo 8) la pantalla no adivina: escribe 08:00 o 800. Si el tiempo no es válido, la pantalla avisa y no cambia nada.',
    ],
  },
  {
    id: 'bloqueo',
    titulo: '4. Si el teléfono se bloquea o falla la conexión',
    puntos: [
      'Problema conocido del piloto: tras desbloquear el teléfono, los controles pueden seguir sin responder un momento. Espera a que vuelvan los controles y el estado actual del partido.',
      'Antes de repetir una acción, revisa el marcador, las faltas, el texto «Guardado aquí, pendiente de enviar / Confirmado por el servidor» y «Últimas acciones». Una acción que figura «Pendiente» ya fue guardada: no la repitas.',
      'Recargar la página no es siempre el primer paso: puede haber acciones pendientes o de resultado incierto. Si el estado no está claro, avisa al organizador o al soporte del piloto que te dio el acceso, sin recargar ni cambiar nada.',
      'No borres los datos del sitio, no cambies de navegador y no actives otro teléfono como forma normal de recuperarte en pleno partido.',
      'Esta guía no promete que se pueda seguir puntuando sin internet: no está verificado en esta versión.',
      'Si la pantalla digital queda interrumpida, lleva el registro en papel y un reloj independiente, según el procedimiento de la mesa. Cuando todo funcione otra vez, compara con calma el papel con la pantalla antes de corregir nada.',
    ],
  },
  {
    id: 'final',
    titulo: '5. Periodos y resultado final',
    puntos: [
      'Pasa al periodo siguiente una sola vez, cuando hayas confirmado que el anterior terminó.',
      'En la configuración mini de este piloto, las faltas de equipo se cuentan por periodo y vuelven a cero en el siguiente; las faltas personales de cada jugador siguen acumulándose todo el partido. Guíate por la etiqueta del marcador: «faltas del periodo» o «faltas» (partido completo).',
      'Antes de «Cerrar el partido», confirma el marcador final con el árbitro y la mesa. Después pulsa «Confirmar cierre»: el reloj se detiene.',
      'El partido siguiente necesita su propia activación, aunque uses el mismo teléfono.',
      'La TV se queda en /tv/cancha y sigue el partido configurado cuando este comienza; no hace falta tocarla.',
    ],
  },
]

/** El contenido. `plegable`: cada sección es un bloque que se abre y se cierra (panel dentro de la consola); si no, todo visible. */
export function ContenidoGuia({ plegable = false }) {
  return (
    <div className="guia-secciones">
      {SECCIONES.map((s) => plegable ? (
        <details key={s.id} className="guia-seccion">
          <summary>{s.titulo}</summary>
          <ul>{s.puntos.map((p) => <li key={p}>{p}</li>)}</ul>
        </details>
      ) : (
        <section key={s.id} className="guia-seccion" aria-labelledby={`guia-${s.id}`}>
          <h2 id={`guia-${s.id}`}>{s.titulo}</h2>
          <ul>{s.puntos.map((p) => <li key={p}>{p}</li>)}</ul>
        </section>
      ))}
    </div>
  )
}

/** Botón «Guía de puntuación» + panel en la misma página. No navega, no pide nada y no desmonta a quien lo contiene. */
export function GuiaEnLinea() {
  const [abierta, setAbierta] = useState(false)
  const id = useId()
  return (
    <div className="guia-en-linea">
      <button type="button" className="btn fantasma guia-boton" aria-expanded={abierta} aria-controls={id} onClick={() => setAbierta((a) => !a)}>
        {TITULO_GUIA}
      </button>
      {abierta && (
        <section id={id} className="guia-panel" aria-label={TITULO_GUIA}>
          <p className="sub">Ayuda de solo lectura: no cambia nada del partido.</p>
          <ContenidoGuia plegable />
          <button type="button" className="btn fantasma" onClick={() => setAbierta(false)}>Cerrar la guía</button>
        </section>
      )}
    </div>
  )
}

/** /ayuda/arbitro — página pública de solo lectura. */
export default function GuiaArbitro() {
  return (
    <main className="guia-pagina">
      <p className="guia-volver"><Link className="volver" to="/">‹ Inicio</Link></p>
      <h1>{TITULO_GUIA}</h1>
      <p className="sub">Para quien puntúa el partido desde un teléfono en la cancha. Pensada para el piloto del 24 y 25 de octubre.</p>
      <ContenidoGuia />
    </main>
  )
}
