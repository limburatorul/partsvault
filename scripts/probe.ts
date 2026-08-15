import os from 'node:os'
import path from 'node:path'
import { saveConfig } from '../src/main/config'
import { downloadHit } from '../src/main/download'
import { analyzePart } from '../src/main/partnumber'
import { runSearch } from '../src/main/search/orchestrator'
import type { SearchHit } from '../src/shared/types'

/**
 * Harness de verificare a motorului, rulat in afara Electron.
 * Scopul e sa vad pe date reale ce gaseste si ce nu -- nu se poate valida
 * un cautator de datasheet-uri fara sa-l pui sa caute.
 */

const HARD_PARTS = [
  'LM358',              // banal, trebuie gasit instant de la producator
  'TDA2030A',           // audio clasic, multe surse
  'STM32F103C8T6',      // cod de comanda lung, testeaza extragerea radacinii
  'CDB400E',            // Microelectronica Bucuresti -> trebuie sa deduca SN7400
  'K155LA3',            // sovietic -> SN7400
  'C945',               // marcaj JIS pe capsula -> 2SC945
  'MMC4011'             // CMOS romanesc -> CD4011
]

function line(): void {
  console.log('-'.repeat(78))
}

function testAnalysis(): void {
  console.log('\n=== 1. Analiza part number ===\n')
  for (const raw of HARD_PARTS) {
    const a = analyzePart(raw)
    console.log(`${raw.padEnd(16)} variante: ${a.variants.join(', ')}`)
    if (a.equivalents.length) {
      console.log(`${' '.repeat(16)} echivalente: ${a.equivalents.slice(0, 6).join(', ')}`)
    }
    if (a.likelyManufacturers.length) {
      console.log(`${' '.repeat(16)} producator: ${a.likelyManufacturers.join(', ')}`)
    }
  }
}

async function testSearch(query: string, deep: boolean): Promise<SearchHit[]> {
  line()
  console.log(`\n=== Cautare: ${query} ${deep ? '(profunda)' : '(rapida)'} ===\n`)
  const started = Date.now()

  const kinds: SearchHit['kind'][] = analyzePart(query).queryType === 'device'
    ? ['schematic', 'manual']
    : ['datasheet']

  const run = await runSearch(
    { query, deepSearch: deep, expandEquivalents: true, kinds },
    (p) => {
      if (p.phase === 'error') console.log(`   ! ${p.message}`)
      else if (p.message) console.log(`   . ${p.message}`)
    }
  )

  const secs = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\n   ${run.hits.length} rezultate in ${secs}s`)
  for (const hit of run.hits.slice(0, 6)) {
    console.log(
      `   [${String(Math.round(hit.score * 100)).padStart(3)}] ${hit.sourceId.padEnd(16)} ${hit.url.slice(0, 96)}`
    )
  }
  return run.hits
}

async function testDownload(hits: SearchHit[], query: string): Promise<void> {
  const candidate = hits.find((h) => h.score >= 0.6 && !h.alreadyInLibrary)
  if (!candidate) {
    console.log('   (niciun candidat bun de descarcat)')
    return
  }
  console.log(`\n   Descarc: ${candidate.url.slice(0, 90)}`)
  const result = await downloadHit(candidate, query, (p) => {
    if (p.phase === 'verifying' || p.phase === 'error' || p.phase === 'done' || p.phase === 'duplicate') {
      console.log(`   -> ${p.phase}${p.message ? ': ' + p.message : ''}`)
    }
  })
  if (result.doc) {
    const d = result.doc
    console.log(
      `   OK  ${d.partNumber} | ${d.kind} | ${d.manufacturer ?? 'producator necunoscut'} | ` +
        `${d.pageCount ?? '?'} pag | ${Math.round(d.sizeBytes / 1024)} KB | ${d.confidence}`
    )
    console.log(`   fisier: ${d.relPath}`)
  } else if (result.error) {
    console.log(`   ESEC: ${result.error}`)
  }
}

async function main(): Promise<void> {
  const libraryPath = path.join(os.tmpdir(), 'partsvault-probe', 'library')
  await saveConfig({ libraryPath, politenessDelayMs: 700 })
  console.log(`Librarie de test: ${libraryPath}`)

  testAnalysis()

  const only = process.env.PROBE_ARG
  const queries = only ? [only] : ['LM358', 'CDB400E', 'Logitech Z5500']

  for (const q of queries) {
    const hits = await testSearch(q, q !== 'LM358')
    await testDownload(hits, q)
  }

  line()
  console.log('\nGata.')
}

main().catch((err) => {
  console.error('Harness-ul a crapat:', err)
  process.exit(1)
})
