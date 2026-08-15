import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DownloadProgress, LibraryDoc, SearchHit } from '../shared/types'
import { loadConfig } from './config'
import { httpFetch } from './http'
import { addDoc, findBySha, sanitizeSegment, targetPathFor } from './library'
import { analyzePart } from './partnumber'
import { sha256Of, verifyDocument } from './verify'

/**
 * Descarcarea si arhivarea unui rezultat.
 *
 * Fluxul e: descarc in memorie -> verific ca e PDF real si ca priveste piesa
 * ceruta -> caut duplicat dupa hash -> scriu pe disc -> indexez. Nimic nu
 * ajunge pe disc inainte de verificare, ca sa nu se umple libraria de gunoi.
 */

type ProgressFn = (p: DownloadProgress) => void

/** Numele fisierului din URL, daca e unul rezonabil. */
function fileNameFromUrl(url: string): string | null {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
    if (/\.pdf$/i.test(base) && base.length > 4 && base.length < 90) return base
  } catch {
    /* URL malformat: cad pe numele generat */
  }
  return null
}

function buildFileName(hit: SearchHit, partNumber: string, manufacturer?: string): string {
  const fromUrl = fileNameFromUrl(hit.url)
  if (fromUrl) return sanitizeSegment(fromUrl.replace(/\.pdf$/i, ''), partNumber) + '.pdf'
  const parts = [partNumber, hit.kind !== 'unknown' ? hit.kind : null, manufacturer]
    .filter(Boolean)
    .join('_')
  return `${sanitizeSegment(parts, partNumber)}.pdf`
}

/** Citeste corpul raspunsului cu progres si oprire la depasirea limitei. */
async function readWithProgress(
  res: Response,
  hitId: string,
  maxBytes: number,
  onProgress: ProgressFn
): Promise<Uint8Array> {
  const totalHeader = res.headers.get('content-length')
  const totalBytes = totalHeader ? Number(totalHeader) : undefined

  if (totalBytes && totalBytes > maxBytes) {
    throw new Error(
      `fisierul are ${Math.round(totalBytes / 1024 / 1024)} MB, peste limita de ${Math.round(maxBytes / 1024 / 1024)} MB`
    )
  }
  if (!res.body) throw new Error('raspuns fara continut')

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error(`fisierul depaseste limita de ${Math.round(maxBytes / 1024 / 1024)} MB`)
    }
    onProgress({ hitId, phase: 'downloading', receivedBytes: received, totalBytes })
  }

  const out = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export interface DownloadResult {
  ok: boolean
  doc?: LibraryDoc
  /** Setat cand fisierul exista deja in librarie. */
  duplicateOf?: LibraryDoc
  error?: string
}

/**
 * Descarca un rezultat, il verifica si il adauga in librarie.
 * `queryForVerification` e ce a cautat utilizatorul, nu ce a returnat sursa --
 * verificarea trebuie facuta fata de intentia originala.
 */
export async function downloadHit(
  hit: SearchHit,
  queryForVerification: string,
  onProgress: ProgressFn,
  signal?: AbortSignal
): Promise<DownloadResult> {
  const cfg = await loadConfig()
  const maxBytes = cfg.maxFileSizeMb * 1024 * 1024
  const analysis = analyzePart(queryForVerification)

  onProgress({ hitId: hit.id, phase: 'queued' })

  let buf: Uint8Array
  try {
    onProgress({ hitId: hit.id, phase: 'downloading', receivedBytes: 0 })
    const res = await httpFetch(hit.url, {
      // multe site-uri servesc PDF-ul doar daca vii de pe pagina lor
      referer: hit.pageUrl ?? new URL(hit.url).origin,
      timeoutMs: 90_000,
      retries: 1,
      signal
    })
    if (!res.ok) throw new Error(`serverul a raspuns ${res.status}`)
    buf = await readWithProgress(res, hit.id, maxBytes, onProgress)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    onProgress({ hitId: hit.id, phase: 'error', message })
    return { ok: false, error: message }
  }

  onProgress({ hitId: hit.id, phase: 'verifying', message: 'Verific continutul...' })

  const sha256 = sha256Of(buf)
  const duplicate = await findBySha(sha256)
  if (duplicate) {
    onProgress({
      hitId: hit.id,
      phase: 'duplicate',
      message: `Il ai deja: ${duplicate.partNumber} (${duplicate.relPath})`,
      doc: duplicate
    })
    return { ok: true, duplicateOf: duplicate, doc: duplicate }
  }

  const verdict = await verifyDocument(buf, analysis, `${hit.title} ${hit.url}`)
  if (verdict.confidence === 'rejected') {
    onProgress({ hitId: hit.id, phase: 'error', message: verdict.reason })
    return { ok: false, error: verdict.reason }
  }

  const manufacturer = verdict.manufacturer ?? hit.manufacturer
  const kind = verdict.kind !== 'unknown' ? verdict.kind : hit.kind
  const partNumber = analysis.normalized
  const fileName = buildFileName(hit, partNumber, manufacturer)
  const { absPath, relPath } = await targetPathFor(partNumber, kind, manufacturer, fileName)

  try {
    await fs.mkdir(path.dirname(absPath), { recursive: true })
    await fs.writeFile(absPath, buf)
  } catch (err) {
    const message = `nu am putut scrie fisierul: ${err instanceof Error ? err.message : err}`
    onProgress({ hitId: hit.id, phase: 'error', message })
    return { ok: false, error: message }
  }

  const doc: LibraryDoc = {
    id: randomUUID(),
    partNumber,
    // pastrez si ce a tastat omul, ca sa regaseasca documentul dupa acelasi termen
    aliases: [...new Set([...verdict.aliases, analysis.normalized, analysis.root])],
    title: verdict.title ?? hit.title,
    kind,
    manufacturer,
    relPath,
    sizeBytes: buf.byteLength,
    sha256,
    pageCount: verdict.pageCount,
    confidence: verdict.confidence,
    sourceId: hit.sourceId,
    sourceUrl: hit.url,
    addedAt: new Date().toISOString(),
    textSnippet: verdict.textSnippet,
    notes: verdict.reason,
    tags: []
  }

  await addDoc(doc)
  onProgress({ hitId: hit.id, phase: 'done', doc, message: verdict.reason })
  return { ok: true, doc }
}
