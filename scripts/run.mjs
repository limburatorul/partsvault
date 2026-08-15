/**
 * Ruleaza un script de diagnostic din `scripts/` in afara Electron.
 *
 *   node scripts/run.mjs probe LM358     -- cautare cap-coada pe o piesa
 *   node scripts/run.mjs probe-sources   -- verifica ce surse mai raspund
 *
 * Bundle-uieste cu esbuild si inlocuieste `electron` cu un stub, fiindca
 * motorul atinge Electron doar pentru calea folderului de date.
 */
import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const [name = 'probe', arg] = process.argv.slice(2)

if (arg) process.env.PROBE_ARG = arg

// bundle-ul trebuie sa stea in proiect, altfel Node nu rezolva `cheerio`/`unpdf`
const outFile = path.join(here, '..', 'node_modules', '.cache', `${name}.bundle.mjs`)

const electronStubPlugin = {
  name: 'electron-stub',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^electron$/ }, () => ({
      path: path.join(here, 'electron-stub.mjs')
    }))
  }
}

await build({
  entryPoints: [path.join(here, `${name}.ts`)],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: outFile,
  plugins: [electronStubPlugin],
  // deja instalate, nu au nevoie de bundling
  external: ['unpdf', 'cheerio'],
  logLevel: 'warning'
})

await import(pathToFileURL(outFile).href)
