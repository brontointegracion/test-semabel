import { RespaldoNoSoportado, TABLAS_CONOCIDAS, citar, decodificar, leerBase, verificarSellos } from '../src/respaldo.js'

// ---------------------------------------------------------------------------
// IMPORTACIÓN SOLO PARA ENSAYO LOCAL (REPORT_246). Este archivo NO lo importa nada de `src/`: no forma parte del paquete de producción (hay una prueba y una verificación del
// paquete que lo comprueban). Restaura un respaldo `sebel-respaldo-sql` en un objeto NUEVO y VACÍO de la MISMA versión de código (mismo esquema, exacto):
//   1. verifica TODOS los sellos del archivo y que la clase coincida;
//   2. el esquema del objeto destino (tablas, índices, disparadores) debe ser idéntico, texto a texto;
//   3. el destino debe estar vacío salvo `meta` (la fila de versión que su constructor acaba de crear): cualquier otra fila lo rechaza;
//   4. en UNA transacción: reemplaza `meta`, inserta cada fila con su rowid y los valores exactos (REAL con CAST), y fija `sqlite_sequence`.
// Restauración EXACTA: sesiones y credenciales vuelven tal cual estaban. Invalidar sesiones o rotar credenciales después es un paso de recuperación APARTE y documentado.
// ---------------------------------------------------------------------------

export async function importarObjeto(storage, respaldo, { clase, tablasPermitidas } = {}) {
  const sellos = await verificarSellos(respaldo)
  if (!sellos.ok) return { estado: 'rechazado', motivo: 'sellos-invalidos', detalle: sellos.errores }
  if (respaldo.clase !== clase) return { estado: 'rechazado', motivo: 'clase-distinta' }
  let actual
  try {
    actual = leerBase(storage, { clase, objeto: respaldo.objeto, ahora: 0, tablasPermitidas: tablasPermitidas ?? TABLAS_CONOCIDAS[clase] })
  } catch (e) {
    if (e instanceof RespaldoNoSoportado) return { estado: 'rechazado', motivo: `destino-${e.codigo}` }
    throw e
  }
  if (JSON.stringify(actual.esquema) !== JSON.stringify(respaldo.esquema)) return { estado: 'rechazado', motivo: 'esquema-distinto' }
  for (const t of actual.tablas) if (t.nombre !== 'meta' && t.filas > 0) return { estado: 'rechazado', motivo: 'destino-no-vacio', detalle: t.nombre }
  const meta = actual.tablas.find((t) => t.nombre === 'meta')
  if (!meta || meta.filas > 1) return { estado: 'rechazado', motivo: 'destino-no-vacio', detalle: 'meta' }
  const nombres = new Map(actual.tablas.map((t) => [t.nombre, t.columnas.join('|')]))
  for (const t of respaldo.tablas) {
    if (t.nombre === 'sqlite_sequence') continue
    if (nombres.get(t.nombre) !== t.columnas.join('|')) return { estado: 'rechazado', motivo: 'columnas-distintas', detalle: t.nombre }
  }
  const cuentas = {}
  storage.transactionSync(() => {
    const sql = storage.sql
    sql.exec('DELETE FROM meta')
    for (const t of respaldo.tablas) {
      if (t.nombre === 'sqlite_sequence') continue
      const q = citar(t.nombre)
      const cols = t.columnas.map(citar).join(', ')
      for (const fila of t.datos) {
        const [rowid, ...valores] = fila
        const d = valores.map(decodificar)
        sql.exec(`INSERT INTO ${q} (rowid, ${cols}) VALUES (?, ${d.map((x) => x.marcador).join(', ')})`, rowid, ...d.map((x) => x.valor))
      }
      cuentas[t.nombre] = t.datos.length
    }
    const sec = respaldo.tablas.find((t) => t.nombre === 'sqlite_sequence')
    if (sec) {
      sql.exec('DELETE FROM sqlite_sequence')
      const iName = sec.columnas.indexOf('name')
      const iSeq = sec.columnas.indexOf('seq')
      if (iName < 0 || iSeq < 0) throw new Error('sqlite_sequence-columnas')
      for (const fila of sec.datos) { const [rowid, ...v] = fila; const nombre = decodificar(v[iName]); const seq = decodificar(v[iSeq]); sql.exec(`INSERT INTO sqlite_sequence (rowid, name, seq) VALUES (CAST(? AS INTEGER), ${nombre.marcador}, ${seq.marcador})`, rowid, nombre.valor, seq.valor) }
      cuentas.sqlite_sequence = sec.datos.length
    }
  })
  return { estado: 'ok', filas: cuentas }
}
