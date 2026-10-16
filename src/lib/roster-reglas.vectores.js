// Vectores compartidos de las reglas de plantilla: los usan la prueba de la raíz (reglas puras) y las pruebas del
// backend (mismas entradas por HTTP). Si las dos definiciones se separaran, una de las dos suites fallaría.
// Solo datos sintéticos. Las fechas están lejos del presente para no depender del reloj.

const MSG = {
  obligatorioNombre: 'Este campo es obligatorio.',
  digitos: 'No puede contener números.',
  sinLetra: 'Debe contener al menos una letra.',
  largo50: 'Máximo 50 caracteres.',
  largo20: 'Máximo 20 caracteres.',
  fechaInvalida: 'Fecha inválida.',
  fechaFutura: 'La fecha no puede ser futura.',
  numeroObligatorio: 'El número es obligatorio.',
  numeroInvalido: 'El número debe ser un entero entre 0 y 99.',
  pendiente: 'En el piloto cada jugador necesita un número del 0 al 99; no se puede dejar pendiente.',
}
export const MENSAJES = MSG

/** Plantilla del equipo E1 tal como la siembran las pruebas del backend (forma local). */
export const FICHAS_E1 = [
  { id: 'J1', equipoId: 'E1', nombrePila: 'Ana', apellido1: 'Prueba', apellido2: '', nombre: 'Ana Prueba', dorsal: 0, nombreCamiseta: 'ANA', activo: true },
  { id: 'J2', equipoId: 'E1', nombrePila: 'Beto', apellido1: 'Muestra', apellido2: '', nombre: 'Beto Muestra', dorsal: 7, fechaNacimiento: '2015-03-12', activo: true },
  { id: 'JX', equipoId: 'E1', nombrePila: 'Dario', apellido1: 'Inactivo', apellido2: '', nombre: 'Dario Inactivo', dorsal: 9, activo: false },
]

const base = { nombrePila: 'Carla', apellido1: 'Nueva', dorsal: 12 }
const mal = (errores) => ({ tipo: 'invalido', errores })

/** Altas: `campos` → válido (`ok`) o los errores exactos. */
export const ALTAS = [
  { n: 'mínimo válido', campos: base, ok: true },
  { n: 'todo informado', campos: { ...base, apellido2: 'Segundo', nombreCamiseta: 'Cami', fechaNacimiento: '2014-05-01' }, ok: true },
  { n: 'espacios y mayúsculas se aceptan', campos: { nombrePila: '  María  José ', apellido1: ' DE  la Cruz', dorsal: ' 05 ' }, ok: true },
  { n: 'dorsal 0', campos: { ...base, dorsal: 0 }, ok: true },
  { n: 'sin nombre', campos: { ...base, nombrePila: '' }, esperado: mal({ nombrePila: MSG.obligatorioNombre }) },
  { n: 'nombre nulo', campos: { ...base, nombrePila: null }, esperado: mal({ nombrePila: MSG.obligatorioNombre }) },
  { n: 'apellido con dígito', campos: { ...base, apellido1: 'Nueva2' }, esperado: mal({ apellido1: MSG.digitos }) },
  { n: 'nombre sin letra', campos: { ...base, nombrePila: '--' }, esperado: mal({ nombrePila: MSG.sinLetra }) },
  { n: 'nombre de 51 caracteres', campos: { ...base, nombrePila: 'a'.repeat(51) }, esperado: mal({ nombrePila: MSG.largo50 }) },
  { n: 'apellido2 con dígito', campos: { ...base, apellido2: '2da' }, esperado: mal({ apellido2: MSG.digitos }) },
  { n: 'nombre en camiseta de 21', campos: { ...base, nombreCamiseta: 'x'.repeat(21) }, esperado: mal({ nombreCamiseta: MSG.largo20 }) },
  { n: 'fecha inválida', campos: { ...base, fechaNacimiento: 'no-es-fecha' }, esperado: mal({ fechaNacimiento: MSG.fechaInvalida }) },
  { n: 'fecha futura', campos: { ...base, fechaNacimiento: '2999-01-01' }, esperado: mal({ fechaNacimiento: MSG.fechaFutura }) },
  { n: 'sin dorsal', campos: { nombrePila: 'Carla', apellido1: 'Nueva' }, esperado: mal({ dorsal: MSG.numeroObligatorio }) },
  { n: 'dorsal vacío', campos: { ...base, dorsal: '   ' }, esperado: mal({ dorsal: MSG.numeroObligatorio }) },
  { n: 'dorsal fuera de rango', campos: { ...base, dorsal: 100 }, esperado: mal({ dorsal: MSG.numeroInvalido }) },
  { n: 'dorsal con fracción', campos: { ...base, dorsal: 1.5 }, esperado: mal({ dorsal: MSG.numeroInvalido }) },
  { n: 'dorsal con letras', campos: { ...base, dorsal: '7a' }, esperado: mal({ dorsal: MSG.numeroInvalido }) },
  { n: 'pendiente verdadero', campos: { ...base, numeroPendiente: true }, esperado: mal({ numeroPendiente: MSG.pendiente }) },
  { n: 'pendiente verdadero y sin número', campos: { nombrePila: 'Carla', apellido1: 'Nueva', numeroPendiente: true }, esperado: mal({ dorsal: MSG.numeroObligatorio, numeroPendiente: MSG.pendiente }) },
  { n: 'pendiente falso se tolera', campos: { ...base, numeroPendiente: false }, ok: true },
]

/** Ediciones sobre J2 (E1: J1 #0 activo, J2 #7 activo, JX #9 inactivo). */
export const EDICIONES = [
  { n: 'sin cambios', campos: {}, ok: true },
  { n: 'mismo número', campos: { dorsal: 7 }, ok: true },
  { n: 'número de un inactivo', campos: { dorsal: 9 }, ok: true },
  { n: 'nombre en camiseta', campos: { nombreCamiseta: 'BETO' }, ok: true },
  { n: 'borrar la fecha', campos: { fechaNacimiento: null }, ok: true },
  { n: 'número ocupado por un activo', campos: { dorsal: 0 }, esperado: { tipo: 'conflicto-numero' } },
  { n: 'nombre vacío', campos: { nombrePila: '' }, esperado: mal({ nombrePila: MSG.obligatorioNombre }) },
  { n: 'número vacío', campos: { dorsal: '' }, esperado: mal({ dorsal: MSG.numeroObligatorio }) },
  { n: 'número nulo', campos: { dorsal: null }, esperado: mal({ dorsal: MSG.numeroObligatorio }) },
  { n: 'número fuera de rango', campos: { dorsal: 100 }, esperado: mal({ dorsal: MSG.numeroInvalido }) },
  { n: 'pendiente verdadero', campos: { numeroPendiente: true }, esperado: mal({ numeroPendiente: MSG.pendiente }) },
  { n: 'pendiente verdadero con número válido', campos: { dorsal: 8, numeroPendiente: true }, esperado: mal({ numeroPendiente: MSG.pendiente }) },
  { n: 'fecha futura', campos: { fechaNacimiento: '2999-01-01' }, esperado: mal({ fechaNacimiento: MSG.fechaFutura }) },
  { n: 'camiseta de 21', campos: { nombreCamiseta: 'x'.repeat(21) }, esperado: mal({ nombreCamiseta: MSG.largo20 }) },
]

/** Reactivaciones de JX (inactivo, #9) con J1 #0 y J2 #7 activos. */
export const REACTIVACIONES = [
  { n: 'recupera el número anterior', entrada: {}, ok: true },
  { n: 'número nuevo', entrada: { nuevoDorsal: 20 }, ok: true },
  { n: 'número nuevo como texto', entrada: { nuevoDorsal: '020' }, ok: true },
  { n: 'número ocupado', entrada: { nuevoDorsal: 7 }, esperado: { tipo: 'conflicto-numero' } },
  { n: 'número vacío', entrada: { nuevoDorsal: '' }, esperado: mal({ dorsal: MSG.numeroObligatorio }) },
  { n: 'número nulo', entrada: { nuevoDorsal: null }, esperado: mal({ dorsal: MSG.numeroObligatorio }) },
  { n: 'número fuera de rango', entrada: { nuevoDorsal: 100 }, esperado: mal({ dorsal: MSG.numeroInvalido }) },
  { n: 'pendiente verdadero', entrada: { numeroPendiente: true }, esperado: mal({ numeroPendiente: MSG.pendiente }) },
  { n: 'pendiente falso se tolera', entrada: { numeroPendiente: false }, ok: true },
]
