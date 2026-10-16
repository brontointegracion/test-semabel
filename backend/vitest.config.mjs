import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Las pruebas del backend corren dentro del runtime de Workers (workerd). Se llaman
// *.check.js a propósito: el `vitest run` de la raíz solo recoge *.test.* / *.spec.*,
// así que esta suite no se mezcla con la de la aplicación.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.test.jsonc' } })],
  test: { include: ['test/**/*.check.js'] },
})
