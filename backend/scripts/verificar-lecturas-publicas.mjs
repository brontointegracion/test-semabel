#!/usr/bin/env node
// Contrasta OFFLINE un paquete portable ya verificado con las lecturas publicas que el propietario guardo con GET (sin credenciales). Sin red. Imprime solo codigos, conteos e ids deportivos.
//   node scripts/verificar-lecturas-publicas.mjs --paquete CARPETA --lectura-liga ARCHIVO.json --lectura-jugadores ARCHIVO.json
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { compararLecturasPublicas } from './lib/lecturas-publicas.mjs'
import { verificarPaquete } from './lib/lector-portable.mjs'

const ENTIDADES = ['leagues', 'teams', 'games', 'game_scores', 'player_game_totals']
function main() {
  const av = process.argv.slice(2); const o = {}
  for (let i = 0; i < av.length; i += 2) {
    if (!['--paquete', '--lectura-liga', '--lectura-jugadores'].includes(av[i]) || typeof av[i + 1] !== 'string' || av[i + 1].startsWith('--') || av[i] in o) { console.error('uso: --paquete CARPETA --lectura-liga ARCHIVO --lectura-jugadores ARCHIVO'); return 2 }
    o[av[i]] = av[i + 1]
  }
  if (!o['--paquete'] || !o['--lectura-liga'] || !o['--lectura-jugadores']) { console.error('uso: --paquete CARPETA --lectura-liga ARCHIVO --lectura-jugadores ARCHIVO'); return 2 }
  const v = verificarPaquete(o['--paquete'])
  if (!v.ok) { console.error(`paquete: NO VERIFICA ${v.problemas.slice(0, 5).join(' ')}`); return 1 }
  let paquete; let lecturaLiga; let lecturaJugadores
  try {
    paquete = Object.fromEntries(ENTIDADES.map((e) => [e, JSON.parse(readFileSync(join(o['--paquete'], `${e}.json`), 'utf8')).rows]))
    for (const f of [o['--lectura-liga'], o['--lectura-jugadores']]) if (statSync(f).size > 8 * 1024 * 1024) throw new Error('grande')
    lecturaLiga = JSON.parse(readFileSync(o['--lectura-liga'], 'utf8')); lecturaJugadores = JSON.parse(readFileSync(o['--lectura-jugadores'], 'utf8'))
  } catch { console.error('lecturas: ILEGIBLES'); return 1 }
  const r = compararLecturasPublicas({ paquete, lecturaLiga, lecturaJugadores })
  console.log(`contraste con lecturas publicas: ${r.ok ? 'COINCIDE' : 'HAY DIFERENCIAS'} (${r.comprobaciones} comprobaciones, ${r.desacuerdos} diferencias)`)
  for (const [c, n] of Object.entries(r.porCodigo)) console.log(`  ${c}: ${n}`)
  for (const d of r.detalle.slice(0, 40)) console.log(`  - ${d.code}${d.gameId ? ` partido=${d.gameId}` : ''}${d.entityId ? ` id=${d.entityId}` : ''}`)
  return r.ok ? 0 : 1
}
process.exitCode = main()
