import { app } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { saveConfig } from '../src/main/config'
import { httpFetch } from '../src/main/http'
import { searchSuppliers } from '../src/main/suppliers'

/**
 * Testeaza integrarea Mouser pe date reale.
 *
 * Doua straturi: intai apelul brut, ca sa vad structura raspunsului si daca am
 * mapat corect campurile, apoi prin `searchSuppliers`, ca sa confirm ca ajunge
 * pana in tabel.
 *
 *   $env:MOUSER_KEY="..."
 *   node scripts/run-electron.mjs probe-mouser "LM358"
 */

const QUERY = process.env.PROBE_ARG || 'LM358'
const KEY = process.env.MOUSER_KEY ?? ''

async function rawCall(): Promise<void> {
  const res = await httpFetch(`https://api.mouser.com/api/v1/search/keyword?apiKey=${KEY}`, {
    method: 'POST',
    body: { SearchByKeywordRequest: { keyword: QUERY, records: 5, startingRecord: 0 } },
    timeoutMs: 25_000,
    retries: 0
  })
  const text = await res.text()
  console.log(`   HTTP ${res.status}`)

  let data: {
    Errors?: Array<{ Message?: string; Code?: string }>
    SearchResults?: { NumberOfResult?: number; Parts?: Array<Record<string, unknown>> }
  }
  try {
    data = JSON.parse(text)
  } catch {
    console.log(`   raspuns non-JSON: ${text.slice(0, 300)}`)
    return
  }

  if (data.Errors?.length) {
    console.log('   erori raportate de Mouser:')
    for (const e of data.Errors.slice(0, 4)) {
      console.log(`     - ${e.Code ?? ''} ${e.Message ?? JSON.stringify(e)}`)
    }
  }

  const parts = data.SearchResults?.Parts ?? []
  console.log(`   piese gasite: ${parts.length} (raportat: ${data.SearchResults?.NumberOfResult ?? '?'})`)

  if (parts.length) {
    const p = parts[0]
    console.log(`\n   campurile primei piese (verific maparea):`)
    for (const key of [
      'ManufacturerPartNumber',
      'Manufacturer',
      'Description',
      'Availability',
      'Min',
      'DataSheetUrl',
      'ProductDetailUrl'
    ]) {
      const value = p[key]
      console.log(`     ${key.padEnd(24)} ${String(value ?? '(lipseste)').slice(0, 70)}`)
    }
    const breaks = p.PriceBreaks as Array<Record<string, unknown>> | undefined
    console.log(`     PriceBreaks              ${breaks?.length ?? 0} praguri`)
    if (breaks?.length) console.log(`       primul: ${JSON.stringify(breaks[0])}`)
  }
}

async function main(): Promise<void> {
  await app.whenReady()
  if (!KEY) {
    console.log('lipseste MOUSER_KEY din mediu')
    app.quit()
    return
  }
  console.log(`cheie: ...${KEY.slice(-6)}\n`)

  console.log('=== 1. Apel brut catre API ===')
  try {
    await rawCall()
  } catch (err) {
    console.log(`   EROARE: ${err instanceof Error ? err.message : err}`)
  }

  console.log('\n=== 2. Cum ajunge in tabelul din aplicatie ===')
  await saveConfig({
    libraryPath: path.join(os.tmpdir(), 'partsvault-probe', 'mouser-test'),
    supplierApiKeys: { mouser: KEY },
    supplierApiSecrets: {}
  })
  try {
    const rows = await searchSuppliers(QUERY)
    for (const r of rows) {
      if (r.error) {
        console.log(`   ${r.supplierLabel.padEnd(20)} EROARE: ${r.error.slice(0, 70)}`)
        continue
      }
      if (r.linkOnly) {
        console.log(`   ${r.supplierLabel.padEnd(20)} doar link`)
        continue
      }
      const price = r.priceBreaks?.length
        ? (() => {
            const b = [...r.priceBreaks].sort((x, y) => x.price - y.price)[0]
            return `${b.price < 1 ? b.price.toFixed(4) : b.price.toFixed(2)} ${b.currency}`
          })()
        : '—'
      console.log(
        `   ${r.supplierLabel.padEnd(20)} ${(r.partNumber ?? '').padEnd(18)} ` +
          `stoc=${String(r.stock ?? '?').padStart(7)}  pret=${price.padStart(12)}  ${(r.manufacturer ?? '').slice(0, 20)}`
      )
    }
  } finally {
    await saveConfig({ supplierApiKeys: {}, supplierApiSecrets: {} })
    console.log('\n(cheia a fost stearsa din configurare)')
  }

  app.quit()
}

main().catch((err) => {
  console.error('probe esuat:', err)
  app.quit()
})
