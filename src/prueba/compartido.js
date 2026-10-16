import { vi } from 'vitest'

// Ayudas de las pruebas del panel del organizador (modo compartido). Solo datos sintéticos. No forman parte de la aplicación.

export const json = (status, cuerpo, extra = {}) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json', ...extra } })

/** Web Locks de mentira, suficiente para probar `ifAvailable`, exclusión y espera. Se instala en `navigator.locks`. */
export function instalarCandados() {
  const tomados = new Set()
  const esperas = new Map()
  const candados = {
    async query() { return { held: [...tomados].map((name) => ({ name })), pending: [] } },
    async request(nombre, opciones, fn) {
      if (typeof opciones === 'function') { fn = opciones; opciones = {} }
      if (opciones?.ifAvailable) {
        if (tomados.has(nombre)) return fn(null)
      } else {
        while (tomados.has(nombre)) await new Promise((r) => { const l = esperas.get(nombre) ?? []; l.push(r); esperas.set(nombre, l) })
      }
      tomados.add(nombre)
      try {
        return await fn({ name: nombre })
      } finally {
        tomados.delete(nombre)
        for (const r of esperas.get(nombre) ?? []) r()
        esperas.delete(nombre)
      }
    },
  }
  Object.defineProperty(navigator, 'locks', { value: candados, configurable: true })
  return { tomados, quitar: () => Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }) }
}

export const sinConexion = () => Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
export const conConexion = () => Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })

export const YO = (ligas = ['LIGA-U10', 'LIGA-U12']) => ({ organizadorId: 'org-1', ligas, expiraIdle: Date.now() + 3_600_000, expiraAbs: Date.now() + 7_200_000 })

export const ficha = (id, equipoId, nombrePila, apellido1, dorsal, extra = {}) => ({
  id, ligaId: 'LIGA-U10', equipoId, personaId: `persona-${id}`, codigo: '1234', nombrePila, apellido1, apellido2: '',
  nombre: `${nombrePila} ${apellido1}`, dorsal, nombreCamiseta: null, fechaNacimiento: null, activo: true, desactivadoEn: null, reclamado: false, rev: 1, ...extra,
})

/**
 * Servidor de mentira para fetch. Responde las lecturas desde `estado` y las operaciones desde una cola de respuestas
 * programadas (si no hay, 500). Registra todo lo que se pide.
 */
export function servidorFalso({ yo = YO(), ligas = {}, plantillas = {} } = {}) {
  const estado = { yo, ligas, plantillas, sesion: true }
  const peticiones = []
  const posts = []
  const cola = []
  const respuesta = (r) => (typeof r === 'function' ? r(posts[posts.length - 1]) : r)
  const fetchFalso = vi.fn(async (url, opciones = {}) => {
    const metodo = opciones.method ?? 'GET'
    peticiones.push({ url, metodo, cuerpo: opciones.body })
    if (url === '/v1/acceso/organizador') { posts.length += 0; estado.sesion = true; return json(200, { ok: true }) }
    if (url === '/v1/organizador/salir') { estado.sesion = false; return json(200, { ok: true }) }
    if (url === '/v1/organizador/yo') return estado.sesion ? json(200, estado.yo) : json(401, { error: 'no-autorizado' })
    if (metodo === 'GET') {
      if (!estado.sesion) return json(401, { error: 'no-autorizado' })
      let m = /^\/v1\/organizador\/ligas\/([^/]+)$/.exec(url)
      if (m) {
        const l = estado.ligas[m[1]]
        if (!l) return json(404, { error: 'no-encontrado' })
        return json(200, { liga: { id: m[1], nombre: l.nombre, deporte: 'baloncesto' }, equipos: l.equipos.map((e) => ({ id: e.id, nombre: e.nombre, bloqueada: Boolean(estado.plantillas[`${m[1]}/${e.id}`]?.bloqueada), activos: (estado.plantillas[`${m[1]}/${e.id}`]?.activos ?? []).length, inactivos: (estado.plantillas[`${m[1]}/${e.id}`]?.inactivos ?? []).length })) })
      }
      m = /^\/v1\/organizador\/ligas\/([^/]+)\/equipos\/([^/]+)\/jugadores$/.exec(url)
      if (m) {
        const p = estado.plantillas[`${m[1]}/${m[2]}`]
        const eq = estado.ligas[m[1]]?.equipos.find((e) => e.id === m[2])
        if (!p || !eq) return json(404, { error: 'no-encontrado' })
        return json(200, { equipo: { id: eq.id, nombre: eq.nombre }, bloqueada: Boolean(p.bloqueada), activos: p.activos, inactivos: p.inactivos })
      }
    }
    if (metodo === 'POST') {
      posts.push({ url, cuerpo: opciones.body, json: JSON.parse(opciones.body) })
      if (!cola.length) return json(500, { error: 'sin respuesta programada' })
      const r = respuesta(cola.shift())
      if (r instanceof Error) throw r
      return r
    }
    return json(404, { error: 'no-encontrado' })
  })
  return { estado, peticiones, posts, cola, fetch: fetchFalso }
}

/** Escenario estándar: dos ligas, equipos E1 (con jugadores) y E2 en U10; E3 en U12. */
export function escenario() {
  const j1 = ficha('J1', 'E1', 'Ana', 'Prueba', 0, { nombreCamiseta: 'ANA' })
  const j2 = ficha('J2', 'E1', 'Beto', 'Muestra', 7, { rev: 3, fechaNacimiento: '2015-03-12' })
  const jx = ficha('JX', 'E1', 'Dario', 'Inactivo', 9, { activo: false, desactivadoEn: '2023-11-01T00:00:00.000Z' })
  const legado = { ...ficha('L1', 'E1', '', '', null), nombrePila: null, apellido1: null, nombre: 'Legado Sin Numero', dorsal: null, activo: false }
  const otra = ficha('K1', 'E3', 'Eva', 'Doce', 5, { ligaId: 'LIGA-U12', rev: 2, fechaNacimiento: '2014-06-01' })
  return servidorFalso({
    ligas: {
      'LIGA-U10': { nombre: 'Liga Sub-10', equipos: [{ id: 'E1', nombre: 'Alfa' }, { id: 'E2', nombre: 'Beta' }] },
      'LIGA-U12': { nombre: 'Liga Sub-12', equipos: [{ id: 'E3', nombre: 'Gama' }] },
    },
    plantillas: {
      'LIGA-U10/E1': { bloqueada: false, activos: [j1, j2], inactivos: [jx, legado] },
      'LIGA-U10/E2': { bloqueada: false, activos: [], inactivos: [] },
      'LIGA-U12/E3': { bloqueada: false, activos: [otra], inactivos: [] },
    },
  })
}

export const aplicado = (tipo, operacionId, ficha, reproducido = false) => json(200, { resultado: 'aplicado', tipo, operacionId, ficha, reproducido })
export const rechazado = (tipo, operacionId, extra = {}) => json(200, { resultado: 'rechazado', tipo, operacionId, reproducido: false, ...extra })
