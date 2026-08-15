import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { LibraryDoc } from '../shared/types'
import { addDoc, findBySha, sanitizeSegment, targetPathFor } from './library'
import { analyzePart } from './partnumber'
import { sha256Of, verifyDocument } from './verify'

/**
 * Import de fisiere descarcate manual.
 *
 * Multe surse bune nu permit descarcare automata: Elektrotanya cere trecerea
 * printr-o pagina de asteptare, alte arhive cer cont. Nu ocolesc mecanismele
 * lor -- in schimb las omul sa descarce din browser si sa aduca fisierul aici,
 * unde trece prin exact aceeasi verificare si indexare ca orice descarcare
 * automata. Altfel libraria ar avea o gaura fix pe cele mai valoroase surse.
 */

export interface ImportResult {
  file: string
  ok: boolean
  doc?: LibraryDoc
  duplicateOf?: LibraryDoc
  error?: string
}

/**
 * `hint` e ce cauta omul cand a gasit fisierul (part number sau nume de aparat).
 * Cand lipseste, deduc din numele fisierului -- de obicei sursele il pastreaza
 * descriptiv, gen `logitech_z-5500_sch.pdf`.
 */
export async function importFile(filePath: string, hint?: string): Promise<ImportResult> {
  const fileName = path.basename(filePath)

  let buf: Uint8Array
  try {
    buf = await fs.readFile(filePath)
  } catch (err) {
    return { file: fileName, ok: false, error: `nu pot citi fisierul: ${err instanceof Error ? err.message : err}` }
  }

  const sha256 = sha256Of(buf)
  const duplicate = await findBySha(sha256)
  if (duplicate) return { file: fileName, ok: true, duplicateOf: duplicate, doc: duplicate }

  const query = hint?.trim() || fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ')
  const analysis = analyzePart(query)
  const verdict = await verifyDocument(buf, analysis, `${fileName} ${query}`)

  if (verdict.confidence === 'rejected') {
    return { file: fileName, ok: false, error: verdict.reason }
  }

  const partNumber = analysis.normalized
  const kind = verdict.kind !== 'unknown' ? verdict.kind : 'unknown'
  const { absPath, relPath } = await targetPathFor(
    partNumber,
    kind,
    verdict.manufacturer,
    sanitizeSegment(fileName.replace(/\.pdf$/i, ''), partNumber) + '.pdf'
  )

  try {
    await fs.mkdir(path.dirname(absPath), { recursive: true })
    // copiez, nu mut: fisierul original ramane unde l-a pus omul
    await fs.writeFile(absPath, buf)
  } catch (err) {
    return { file: fileName, ok: false, error: `nu pot scrie in librarie: ${err instanceof Error ? err.message : err}` }
  }

  const doc: LibraryDoc = {
    id: randomUUID(),
    partNumber,
    aliases: [...new Set([...verdict.aliases, analysis.normalized, analysis.root])],
    title: verdict.title ?? fileName.replace(/\.pdf$/i, ''),
    kind,
    manufacturer: verdict.manufacturer,
    relPath,
    sizeBytes: buf.byteLength,
    sha256,
    pageCount: verdict.pageCount,
    confidence: verdict.confidence,
    sourceId: 'import',
    sourceUrl: `file:///${filePath.replace(/\\/g, '/')}`,
    addedAt: new Date().toISOString(),
    textSnippet: verdict.textSnippet,
    notes: verdict.reason,
    tags: ['import-manual']
  }

  await addDoc(doc)
  return { file: fileName, ok: true, doc }
}

export async function importFiles(filePaths: string[], hint?: string): Promise<ImportResult[]> {
  const out: ImportResult[] = []
  for (const filePath of filePaths) out.push(await importFile(filePath, hint))
  return out
}
