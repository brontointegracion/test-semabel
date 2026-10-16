import { AccesoDO as AccesoDOReal } from '../src/acceso/acceso-do.js'
import { LigaDO as LigaDOReal } from '../src/liga-do.js'
import worker from '../src/worker.js'

// Variante SOLO de pruebas: hora controlable y una pausa entre leer y confirmar para forzar
// el entrelazado de otra petición. El código de producción no sabe nada de esto.
// Se comparte por globalThis: la prueba y el Worker pueden cargar el módulo por separado.
export const control = (globalThis.__controlPrueba ??= { ahoraMs: null, pausa: null, pausaAut: null, trasConfirmar: null, desfasesAcceso: null, limitesEstado: null, pausaEstado: null, limitesPublicos: null, limitesReparacion: null, limitesEquipo: null })

export class LigaDO extends LigaDOReal {
  ahora() { return control.ahoraMs ?? Date.now() }
  async pausaTrasLeer(sobre) { if (control.pausa) await control.pausa(sobre) }
  async pausaTrasAutorizar(info) { if (control.pausaAut) await control.pausaAut(info) }
  async trasConfirmar(info) { if (control.trasConfirmar) await control.trasConfirmar(info) }
  limitesEstadoControl() { return control.limitesEstado ?? super.limitesEstadoControl() }
  limitesReparacion() { return control.limitesReparacion ?? super.limitesReparacion() }
  limitesEquipoPublico() { return control.limitesEquipo ?? super.limitesEquipoPublico() }
  limitesLecturaPublica() { return control.limitesPublicos ?? super.limitesLecturaPublica() }
  async pausaTrasResumirEstado() { if (control.pausaEstado) await control.pausaEstado() }
}

// El objeto de acceso comparte el reloj de prueba con el de liga, para ordenar sus eventos de forma determinista.
// `desfasesAcceso` ([ms, …]) adelanta o atrasa el reloj del objeto de acceso en sus próximas lecturas, una por llamada,
// para simular el desfase entre los relojes de dos objetos.
export class AccesoDO extends AccesoDOReal {
  ahora() {
    const desfase = control.desfasesAcceso?.length ? control.desfasesAcceso.shift() : 0
    return (control.ahoraMs ?? Date.now()) + desfase
  }
}

export default worker
