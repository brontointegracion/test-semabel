// Archivos privados de las herramientas de carga (SOLO Node): diario con escritura atómica, secretos leídos de archivo 0600 y salida del
// código emitido. Nada de esto se imprime ni se versiona; las rutas deben estar fuera de cualquier repositorio Git.
import { closeSync, existsSync, fstatSync, fsyncSync, openSync, readFileSync, renameSync, statSync, writeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export function rutaPrivada(ruta) {
  const r = resolve(ruta)
  for (let d = dirname(r); ; d = dirname(d)) {
    if (existsSync(`${d}/.git`)) throw new Error('dentro-de-un-repositorio')
    if (dirname(d) === d) break
  }
  if (!existsSync(dirname(r))) throw new Error('carpeta-inexistente')
  return r
}

export function almacenDeDiario(ruta) {
  const r = rutaPrivada(ruta)
  return {
    async leer() { return existsSync(r) ? readFileSync(r, 'utf8') : null },
    async escribir(texto) {
      const tmp = `${r}.tmp`
      const fd = openSync(tmp, 'w', 0o600)
      try { writeSync(fd, texto); fsyncSync(fd); if ((fstatSync(fd).mode & 0o077) !== 0) throw new Error('permisos') } finally { closeSync(fd) }
      renameSync(tmp, r)
    },
  }
}

/** Lee un secreto de un archivo de permisos 0600 (sin acceso para grupo ni otros). */
export function leerSecretoDeArchivo(ruta) {
  const modo = statSync(ruta).mode & 0o777
  if (modo & 0o077) throw new Error('permisos-abiertos')
  return readFileSync(ruta, 'utf8').trim()
}

/** Salida del código emitido: se CREA antes de enviar (0600, sin sobrescribir nada con contenido) y se rellena al recibirlo. */
export function salidaDeCodigoPrivada(ruta) {
  const r = rutaPrivada(ruta)
  return {
    async preparar() {
      if (!existsSync(r)) { closeSync(openSync(r, 'wx', 0o600)); return }
      const s = statSync(r)
      if ((s.mode & 0o077) !== 0 || s.size > 0) throw new Error('salida-no-utilizable') // nunca se pisa un código ya guardado
    },
    async guardar(codigo) {
      const fd = openSync(r, 'r+')
      try {
        if ((fstatSync(fd).mode & 0o077) !== 0) throw new Error('permisos')
        writeSync(fd, `${codigo}\n`); fsyncSync(fd)
      } finally { closeSync(fd) }
    },
  }
}
