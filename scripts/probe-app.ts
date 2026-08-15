import { app } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { saveConfig } from '../src/main/config'
import { analyzePart } from '../src/main/partnumber'
import { runSearch } from '../src/main/search/orchestrator'
import { listSuppliers, searchSuppliers } from '../src/main/suppliers'

/**
 * Cautarea completa, rulata in Electron adevarat.
 *
 * Harness-ul obisnuit foloseste un stub de Electron si nu poate randa pagini,
 * deci nu vede motorul care conteaza acum. Asta il vede.
 */

const QUERY = process.env.PROBE_ARG || 'Logitech Z5500'

async function main(): Promise<void> {
  await app.whenReady()
  await saveConfig({
    libraryPath: path.join(os.tmpdir(), 'partsvault-probe', 'app-test'),
    politenessDelayMs: 500
  })

  const analysis = analyzePart(QUERY)
  console.log(`\n=== "${QUERY}" (tip: ${analysis.queryType}) ===\n`)

  const started = Date.now()
  const run = await runSearch(
    {
      query: QUERY,
      deepSearch: true,
      expandEquivalents: true,
      kinds: analysis.queryType === 'device' ? ['schematic', 'manual'] : ['datasheet']
    },
    (p) => {
      if (p.phase === 'error') console.log(`   ! ${p.message}`)
      else if (p.message) console.log(`   . ${p.message}`)
    }
  )

  console.log(`\n   ${run.hits.length} rezultate in ${((Date.now() - started) / 1000).toFixed(1)}s\n`)
  for (const hit of run.hits.slice(0, 10)) {
    const mark = hit.gated ? 'pagina' : 'direct'
    console.log(
      `   [${String(Math.round(hit.score * 100)).padStart(3)}] ${hit.sourceId.padEnd(14)} ${mark}  ${hit.url.slice(0, 88)}`
    )
  }

  console.log(`\n=== Furnizori ===\n`)
  for (const s of await listSuppliers()) {
    console.log(
      `   ${s.label.padEnd(18)} api=${String(s.supportsApi).padEnd(5)} configurat=${String(s.apiConfigured).padEnd(5)} secret=${s.needsSecret ?? false}`
    )
  }
  const supplierRows = await searchSuppliers('LM358N')
  console.log(`\n   ${supplierRows.length} randuri pentru LM358N (fara chei => doar link-uri)`)

  app.quit()
}

main().catch((err) => {
  console.error('probe esuat:', err)
  app.quit()
})
