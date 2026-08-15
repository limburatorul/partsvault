/**
 * Ruleaza un script de diagnostic *in interiorul* Electron.
 *
 *   node scripts/run-electron.mjs probe-suppliers "LM358N"
 *
 * Necesar pentru orice atinge randarea de pagini: `browser.ts` are nevoie de un
 * Chromium adevarat, deci nu poate fi testat cu stub-ul din harness-ul obisnuit.
 */
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const [name = 'probe-suppliers', arg] = process.argv.slice(2)

const outFile = path.join(root, 'node_modules', '.cache', `${name}.electron.cjs`)

await build({
  entryPoints: [path.join(here, `${name}.ts`)],
  bundle: true,
  platform: 'node',
  target: 'node20',
  // CJS: Electron incarca scriptul principal ca CommonJS
  format: 'cjs',
  outfile: outFile,
  external: ['electron', 'unpdf', 'cheerio'],
  logLevel: 'warning'
})

const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, [outFile], {
  stdio: 'inherit',
  env: { ...process.env, PROBE_ARG: arg ?? '', ELECTRON_ENABLE_LOGGING: '0' }
})

child.on('exit', (code) => process.exit(code ?? 0))
