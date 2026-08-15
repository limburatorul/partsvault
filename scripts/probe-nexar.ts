import { app } from 'electron'
import { httpFetch } from '../src/main/http'

/**
 * Diagnostic brut pentru Nexar: vreau codurile de raspuns si corpul erorii,
 * nu esecul elegant din `searchSuppliers`.
 */

const QUERY = process.env.PROBE_ARG || 'LM358N'
const CLIENT_ID = process.env.NEXAR_ID ?? ''
const CLIENT_SECRET = process.env.NEXAR_SECRET ?? ''

/** Incerc mai multe scope-uri: documentatia Nexar le-a schimbat in timp. */
const SCOPES = ['supply.domain', 'supply', 'design.domain', '']

async function tryToken(scope: string): Promise<string | null> {
  const params: Record<string, string> = {
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET
  }
  if (scope) params.scope = scope

  const res = await httpFetch('https://identity.nexar.com/connect/token', {
    method: 'POST',
    body: new URLSearchParams(params).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeoutMs: 20_000,
    retries: 0
  })
  const text = await res.text()
  const label = scope || '(fara scope)'

  if (!res.ok) {
    console.log(`   scope ${label.padEnd(16)} HTTP ${res.status}  ${text.slice(0, 160)}`)
    return null
  }
  const token = (JSON.parse(text) as { access_token?: string }).access_token ?? null
  console.log(`   scope ${label.padEnd(16)} OK, token de ${token?.length ?? 0} caractere`)
  return token
}

const GQL = `
query Search($q: String!) {
  supSearchMpn(q: $q, limit: 3) {
    results {
      part {
        mpn
        manufacturer { name }
        sellers(authorizedOnly: true) {
          company { name }
          offers { inventoryLevel moq clickUrl prices { quantity price currency } }
        }
      }
    }
  }
}`

async function main(): Promise<void> {
  await app.whenReady()
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log('lipsesc NEXAR_ID / NEXAR_SECRET')
    app.quit()
    return
  }

  console.log('=== 1. Token ===')
  let token: string | null = null
  for (const scope of SCOPES) {
    try {
      token = await tryToken(scope)
      if (token) break
    } catch (err) {
      console.log(`   scope ${scope || '(fara)'}: exceptie ${err instanceof Error ? err.message : err}`)
    }
  }

  if (!token) {
    console.log('\nNu am obtinut token. Restul testului nu are sens.')
    app.quit()
    return
  }

  console.log('\n=== 2. Interogare GraphQL ===')
  const res = await httpFetch('https://api.nexar.com/graphql', {
    method: 'POST',
    body: { query: GQL, variables: { q: QUERY } },
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30_000,
    retries: 0
  })
  const text = await res.text()
  console.log(`   HTTP ${res.status}`)

  let parsed: {
    data?: { supSearchMpn?: { results?: unknown[] } }
    errors?: Array<{ message?: string }>
  }
  try {
    parsed = JSON.parse(text)
  } catch {
    console.log(`   raspuns non-JSON: ${text.slice(0, 300)}`)
    app.quit()
    return
  }

  if (parsed.errors?.length) {
    console.log('   erori GraphQL:')
    for (const e of parsed.errors.slice(0, 4)) console.log(`     - ${e.message}`)
  }

  const results = parsed.data?.supSearchMpn?.results ?? []
  console.log(`   rezultate: ${results.length}`)
  if (results.length) {
    console.log(`\n   structura primului rezultat:`)
    console.log(JSON.stringify(results[0], null, 2).split('\n').slice(0, 40).join('\n'))
  }

  // Verific ca motivul esecului ajunge pana in tabel, nu se pierde pe drum
  console.log('\n=== 3. Cum se vede in aplicatie ===')
  const os = await import('node:os')
  const path = await import('node:path')
  const { saveConfig } = await import('../src/main/config')
  const { searchSuppliers } = await import('../src/main/suppliers')

  await saveConfig({
    libraryPath: path.join(os.tmpdir(), 'partsvault-probe', 'nexar-test'),
    supplierApiKeys: { nexar: CLIENT_ID },
    supplierApiSecrets: { nexar: CLIENT_SECRET }
  })
  try {
    for (const row of await searchSuppliers(QUERY)) {
      const state = row.error ? `EROARE: ${row.error.slice(0, 80)}` : row.linkOnly ? 'doar link' : 'date reale'
      console.log(`   ${row.supplierLabel.padEnd(20)} ${state}`)
    }
  } finally {
    await saveConfig({ supplierApiKeys: {}, supplierApiSecrets: {} })
    console.log('\n(credentialele au fost sterse din configurare)')
  }

  app.quit()
}

main().catch((err) => {
  console.error('probe esuat:', err)
  app.quit()
})
