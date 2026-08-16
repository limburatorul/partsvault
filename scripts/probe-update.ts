import { app } from 'electron'
import { httpFetch } from '../src/main/http'
import { checkForUpdate } from '../src/main/updater'

/**
 * Verifica logica de actualizare fara sa astept o versiune noua:
 * ce vede la GitHub, ce activ potriveste, si cum compara versiunile.
 */

const ASSET_PATTERN = /^PartsVault-(\d+\.\d+\.\d+)-portabil\.exe$/i

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return 0
}

async function main(): Promise<void> {
  await app.whenReady()

  console.log('=== 1. Comparatia de versiuni ===')
  const cases: Array<[string, string]> = [
    ['0.4.4', '0.4.4'],
    ['0.4.5', '0.4.4'],
    ['0.10.0', '0.9.9'],
    ['1.0.0', '0.99.99'],
    ['0.4.4', '0.4.10']
  ]
  for (const [a, b] of cases) {
    const r = compareVersions(a, b)
    const verdict = r > 0 ? `${a} > ${b}` : r < 0 ? `${a} < ${b}` : `${a} = ${b}`
    console.log(`   ${verdict}`)
  }

  console.log('\n=== 2. Ce publica GitHub ===')
  const res = await httpFetch(
    'https://api.github.com/repos/limburatorul/partsvault/releases/latest',
    { headers: { Accept: 'application/vnd.github+json' }, timeoutMs: 15_000 }
  )
  console.log(`   HTTP ${res.status}`)
  const release = (await res.json()) as {
    tag_name?: string
    draft?: boolean
    prerelease?: boolean
    assets?: Array<{ name?: string; size?: number; browser_download_url?: string }>
  }
  console.log(`   tag: ${release.tag_name}  draft=${release.draft} prerelease=${release.prerelease}`)
  for (const a of release.assets ?? []) {
    const matches = a.name ? ASSET_PATTERN.test(a.name) : false
    console.log(
      `   asset: ${a.name}  ${Math.round((a.size ?? 0) / 1024 / 1024)} MB  potriveste=${matches}`
    )
  }

  console.log('\n=== 3. Ce ar decide aplicatia, pe versiuni simulate ===')
  const latest = (release.tag_name ?? '').replace(/^v/i, '')
  for (const fake of ['0.4.0', '0.4.4', '0.9.0']) {
    const wouldUpdate = compareVersions(latest, fake) > 0
    console.log(`   daca rulez ${fake.padEnd(7)} si ultima e ${latest} -> ${wouldUpdate ? 'ACTUALIZEAZA' : 'nimic de facut'}`)
  }

  console.log('\n=== 4. checkForUpdate() real ===')
  const info = await checkForUpdate()
  console.log(`   versiune curenta: ${info.currentVersion}`)
  console.log(`   ultima:           ${info.latestVersion ?? '—'}`)
  console.log(`   disponibila:      ${info.available}`)
  if (info.error) console.log(`   eroare:           ${info.error}`)
  if (info.downloadUrl) console.log(`   link:             ${info.downloadUrl.slice(0, 90)}`)

  app.quit()
}

main().catch((err) => {
  console.error('probe esuat:', err)
  app.quit()
})
