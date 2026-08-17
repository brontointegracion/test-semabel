import { cabeceraDePartido, textosDePartido } from '../src/lib/cabecera.js'

let fallos = 0
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FALLA '}${msg}`); if (!ok) fallos++ }

const base = {
  liga: { nombre: 'Liga Chiricana de Baloncesto 40+', categoria: '40+' },
  cancha: { nombre: 'Gimnasio Ernesto Sánchez' },
  local: { nombre: 'Toros de David' },
  visita: { nombre: 'Bravos de Dolega' },
  golesLocal: 78,
  golesVisita: 71,
}

console.log('lo que se lee en la tarjeta de WhatsApp\n')

for (const estado of ['final', 'vivo', 'programado']) {
  const t = textosDePartido({ ...base, partido: { estado, inicio: '2026-08-14T19:00:00.000Z' } })
  console.log(`  ${estado.toUpperCase()}`)
  console.log(`    ${t.titulo}`)
  console.log(`    ${t.descripcion}\n`)
}

const final = textosDePartido({ ...base, partido: { estado: 'final', inicio: '2026-08-14T19:00:00.000Z' } })
check(final.titulo.includes('78-71'), 'un partido terminado lleva el marcador en el título')
check(final.titulo.includes('Toros de David'), 'y los dos equipos')
check(final.descripcion.includes('40+'), 'la categoría aparece en la descripción')

const vivo = textosDePartido({ ...base, partido: { estado: 'vivo', inicio: '2026-08-14T19:00:00.000Z' } })
check(vivo.titulo.startsWith('EN VIVO'), 'uno en juego se anuncia como tal')

const prog = textosDePartido({ ...base, partido: { estado: 'programado', inicio: '2026-08-14T19:00:00.000Z' } })
check(!prog.titulo.includes('78'), 'uno por jugar no inventa un marcador')
check(prog.descripcion.includes('Gimnasio'), 'y dice dónde es')

console.log('\netiquetas')
const html = cabeceraDePartido({
  ...base,
  partido: { estado: 'final', inicio: '2026-08-14T19:00:00.000Z' },
  url: 'https://sebel.com/p/toros-de-david-vs-bravos-de-dolega-2026-08-14-7139',
  imagen: 'https://sebel.com/img/p/7139.png',
})
for (const t of ['og:title', 'og:description', 'og:url', 'og:image', 'twitter:card', 'canonical']) {
  check(html.includes(t), t)
}
check(html.includes('summary_large_image'), 'con imagen, la tarjeta es grande')

const sinImagen = cabeceraDePartido({
  ...base,
  partido: { estado: 'final', inicio: '2026-08-14T19:00:00.000Z' },
  url: 'https://sebel.com/p/x-7139',
})
check(!sinImagen.includes('og:image'), 'sin imagen no se emite og:image vacío')

const conComillas = cabeceraDePartido({
  ...base,
  local: { nombre: 'Los "Bravos" & Cía' },
  partido: { estado: 'final', inicio: '2026-08-14T19:00:00.000Z' },
  url: 'https://sebel.com/p/x-7139',
})
check(!/content="[^"]*"[^"]*"/.test(conComillas.split('\n').find((l) => l.includes('og:title'))),
      'las comillas de un nombre no rompen la etiqueta')

console.log('\n--- cabecera completa ---')
console.log(html)

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo correcto')
process.exit(fallos ? 1 : 0)
