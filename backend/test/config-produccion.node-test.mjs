// Configuración de PRODUCCIÓN y admisión de ligas (REPORT_186). Node, sin workerd, sin red: `node --test test/config-produccion.node-test.mjs`.
// Lee wrangler.jsonc (JSON con comentarios) y comprueba SOLO lo que el archivo declara. No dice nada de lo que hay desplegado.
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { ligaAdmitida, ligasAdmitidas } from '../src/admision.js'

const texto = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
// Quita comentarios de línea y de bloque respetando las cadenas (las URL de las cadenas contienen «//»).
function sinComentarios(t) {
  let salida = ''; let i = 0; let enCadena = false
  while (i < t.length) {
    const c = t[i]; const d = t[i + 1]
    if (enCadena) { salida += c; if (c === '\\') { salida += d; i += 2; continue } if (c === '"') enCadena = false; i += 1; continue }
    if (c === '"') { enCadena = true; salida += c; i += 1; continue }
    if (c === '/' && d === '/') { while (i < t.length && t[i] !== '\n') i += 1; continue }
    if (c === '/' && d === '*') { i += 2; while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i += 1; i += 2; continue }
    salida += c; i += 1
  }
  return salida.replace(/,(\s*[}\]])/g, '$1')
}
const config = JSON.parse(sinComentarios(texto))
const prod = config.env.production
const REALES = ['PLATINIUM-U10', 'PLATINIUM-U12']
const SIMULACRO = 'SIMULACRO-PILOTO'

describe('producción: lista explícita de ligas admitidas', () => {
  const env = { LIGAS_ADMITIDAS: prod.vars.LIGAS_ADMITIDAS }
  it('son exactamente las dos reales y el Simulacro, en ese orden', () => {
    assert.equal(prod.vars.LIGAS_ADMITIDAS, `${REALES.join(',')},${SIMULACRO}`)
    assert.deepEqual([...ligasAdmitidas(env)], [...REALES, SIMULACRO])
  })
  it('admite las tres y NO admite ninguna otra: mayúsculas, prefijos, subcadenas, sufijos, espacios y comodines', () => {
    for (const id of [...REALES, SIMULACRO]) assert.equal(ligaAdmitida(env, id), true, id)
    for (const id of ['simulacro-piloto', 'SIMULACRO', 'SIMULACRO-PILOTO2', 'SIMULACRO-PILOTO-2', 'XSIMULACRO-PILOTO', 'PLATINIUM', 'PLATINIUM-U1', 'PLATINIUM-U10X', 'PLATINIUM-U14',
      'platinium-u10', 'SIMULACRO-PILOTO ', ' SIMULACRO-PILOTO', '*', 'SIMULACRO-*', '', 'OTRA-LIGA', 'SIMULACRO-PILOTO,OTRA', 'SIMULACRO-PILOTO/x']) assert.equal(ligaAdmitida(env, id), false, JSON.stringify(id))
    assert.equal(ligaAdmitida(env, undefined), false)
    assert.equal(ligaAdmitida(env, null), false)
  })
  it('una lista mal formada se descarta ENTERA (no se admite «lo válido»): falla cerrada', () => {
    for (const crudo of [`${prod.vars.LIGAS_ADMITIDAS},`, `${prod.vars.LIGAS_ADMITIDAS},mala liga`, '', undefined, 5]) {
      assert.equal(ligasAdmitidas({ LIGAS_ADMITIDAS: crudo }), null)
      assert.equal(ligaAdmitida({ LIGAS_ADMITIDAS: crudo }, SIMULACRO), false)
    }
  })
})

describe('producción: lo demás no cambió', () => {
  it('puerta del operador cerrada, siembra apagada, nombre y origen estables; sin secretos en el archivo', () => {
    assert.equal(prod.vars.ACCESO_ADMIN_HABILITADO, '0')
    assert.equal(prod.vars.PERMITIR_SEMILLA, '0')
    assert.equal(prod.vars.ENTORNO, 'produccion')
    assert.equal(prod.vars.ACCESO_ORIGEN, 'https://semabel.com')
    assert.equal(prod.name, 'semabel-production')
    assert.deepEqual(Object.keys(prod.vars).sort(), ['ACCESO_ADMIN_HABILITADO', 'ACCESO_ORIGEN', 'ENTORNO', 'LIGAS_ADMITIDAS', 'PERMITIR_SEMILLA'])
    assert.equal(/ACCESO_ADMIN_TOKEN|SEMILLA_TOKEN/.test(JSON.stringify(prod)), false)
  })
  it('migraciones y entorno staging sin cambios: staging sigue sin ligas admitidas y sin Simulacro', () => {
    assert.deepEqual(config.migrations.map((m) => m.tag), ['v1', 'v2'])
    assert.equal(prod.migrations, undefined)
    assert.equal(config.env.staging.vars.LIGAS_ADMITIDAS, '')
    assert.equal(config.vars.LIGAS_ADMITIDAS, '')
    assert.equal(texto.split(SIMULACRO).length - 1, 2) // la lista de producción y el comentario que la explica; ningún otro lugar
  })
})
