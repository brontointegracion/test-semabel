// Empaqueta el paquete del organizador en un ZIP NUEVO fuera de Git y lo VERIFICA: lo extrae a una carpeta temporal privada y le pasa el lector independiente.
// Solo entran los archivos aprobados (lista cerrada del lector). Nada mas: ni respaldos, ni el informe tecnico, ni credenciales.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { ARCHIVOS_PERMITIDOS, verificarPaquete } from './lector-portable.mjs'
import { crearZip, escribirArchivoNuevo, leerZip } from './zip-portable.mjs'

export const CARPETA_EN_ZIP = 'datos-deportivos'
export class ErrorEmpaquetado extends Error { constructor(codigo, detalle) { super(codigo); this.name = 'ErrorEmpaquetado'; this.codigo = codigo; this.detalle = detalle ?? null } }
const falla = (c, d) => { throw new ErrorEmpaquetado(c, d) }
const sha = (b) => createHash('sha256').update(b).digest('hex')

export function empaquetar({ paquete, zip }) {
  const origen = resolve(paquete)
  const destino = resolve(zip)
  if (!/\.zip$/i.test(destino)) falla('zip-sin-extension')
  const previo = verificarPaquete(origen)
  if (!previo.ok) falla('paquete-no-verificado', previo.problemas.slice(0, 5).join(' '))
  const presentes = readdirSync(origen).sort()
  if (JSON.stringify(presentes) !== JSON.stringify(ARCHIVOS_PERMITIDOS)) falla('contenido-no-aprobado')
  for (let d = dirname(destino); ; d = dirname(d)) {
    if (existsSync(`${d}/.git`)) falla('zip-dentro-de-un-repositorio')
    if (dirname(d) === d) break
  }
  if (!existsSync(dirname(destino))) falla('zip-sin-carpeta-padre')
  if (existsSync(destino)) falla('zip-ya-existe')
  if (destino === origen || destino.startsWith(`${origen}/`)) falla('zip-dentro-del-paquete')

  const manifiesto = JSON.parse(readFileSync(join(origen, 'MANIFEST.json'), 'utf8'))
  const entradas = ARCHIVOS_PERMITIDOS.map((n) => ({ nombre: `${CARPETA_EN_ZIP}/${n}`, datos: readFileSync(join(origen, n)) }))
  const bytes = crearZip(entradas, { fechaIso: manifiesto.generatedAt })
  escribirArchivoNuevo(destino, bytes)

  // Verificacion: leer el ZIP tal como quedo en disco, extraer a una carpeta temporal privada (0700; archivos 0600) y pasar el lector independiente.
  const temporal = mkdtempSync(join(tmpdir(), 'sebel-zip-verificacion-'))
  try {
    const leidas = leerZip(readFileSync(destino))
    const esperados = ARCHIVOS_PERMITIDOS.map((n) => `${CARPETA_EN_ZIP}/${n}`)
    if (JSON.stringify(leidas.map((e) => e.nombre).sort()) !== JSON.stringify(esperados)) falla('zip-contenido-inesperado')
    const extraido = join(temporal, CARPETA_EN_ZIP)
    mkdirSync(extraido, { mode: 0o700 })
    for (const e of leidas) writeFileSync(join(temporal, e.nombre), e.datos, { mode: 0o600, flag: 'wx' })
    const lectura = verificarPaquete(extraido)
    if (!lectura.ok) falla('zip-no-verificado', lectura.problemas.slice(0, 5).join(' '))
    for (const e of entradas) if (!leidas.find((x) => x.nombre === e.nombre).datos.equals(e.datos)) falla('zip-distinto-del-paquete')
    return { zip: destino, bytes: bytes.length, sha256: sha(bytes), archivos: entradas.map((e) => ({ nombre: e.nombre, bytes: e.datos.length })), verificado: true, conteos: lectura.counts }
  } catch (e) {
    try { unlinkSync(destino) } catch { /* ya no existe */ } // un ZIP que no verifica no se deja en disco
    throw e
  } finally {
    rmSync(temporal, { recursive: true, force: true })
  }
}
