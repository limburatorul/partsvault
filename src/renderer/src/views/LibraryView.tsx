import { useEffect, useState } from 'react'
import type { LibraryDoc } from '../../../shared/types'

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function LibraryView({
  version,
  onChanged
}: {
  version: number
  onChanged: () => void
}): JSX.Element {
  const [docs, setDocs] = useState<LibraryDoc[]>([])
  const [filter, setFilter] = useState('')
  const [stats, setStats] = useState<{ total: number; totalBytes: number } | null>(null)

  useEffect(() => {
    // filtrarea se face in main, ca sa caute si in textul extras din PDF-uri
    const timer = setTimeout(() => {
      const load = filter.trim() ? window.api.library.search(filter.trim()) : window.api.library.list()
      load.then(setDocs).catch(() => setDocs([]))
    }, 180)
    return () => clearTimeout(timer)
  }, [filter, version])

  useEffect(() => {
    window.api.library.stats().then(setStats).catch(() => setStats(null))
  }, [version])

  /** Pentru fisierele descarcate manual de pe surse care nu permit automatizare. */
  async function importPdfs(): Promise<void> {
    const results = await window.api.library.import()
    if (!results.length) return
    const ok = results.filter((r) => r.ok).length
    const failed = results.filter((r) => !r.ok)
    onChanged()
    setFilter((f) => f)
    if (failed.length) {
      window.alert(
        `${ok} importate.\n\nNu au trecut verificarea:\n` +
          failed.map((r) => `- ${r.file}: ${r.error}`).join('\n')
      )
    }
  }

  async function remove(doc: LibraryDoc): Promise<void> {
    const ok = window.confirm(
      `Sterg "${doc.partNumber}" din librarie si fisierul de pe disc?\n\n${doc.relPath}`
    )
    if (!ok) return
    await window.api.library.remove(doc.id, true)
    onChanged()
    setDocs((prev) => prev.filter((d) => d.id !== doc.id))
  }

  return (
    <>
      <h2 className="page-title">Libraria</h2>
      <p className="page-sub">Tot ce ai descarcat, cu tot cu textul extras din PDF-uri.</p>

      {stats && (
        <div className="stats">
          <div>
            <b>{stats.total}</b>
            documente
          </div>
          <div>
            <b>{formatSize(stats.totalBytes)}</b>
            pe disc
          </div>
        </div>
      )}

      <div className="search-bar">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtreaza dupa part number, producator sau text din document..."
        />
        <button onClick={importPdfs}>Importa PDF-uri...</button>
      </div>

      {docs.length === 0 && (
        <div className="empty">
          {filter ? 'Nimic care sa se potriveasca.' : 'Libraria e goala. Cauta ceva si descarca.'}
        </div>
      )}

      {docs.map((doc) => (
        <div className="doc" key={doc.id}>
          <div className="doc-part">{doc.partNumber}</div>
          <div className="doc-body">
            <div className="doc-title" title={doc.title}>
              {doc.title}
            </div>
            <div className="doc-meta">
              {[
                doc.manufacturer,
                doc.kind,
                doc.pageCount ? `${doc.pageCount} pag.` : null,
                formatSize(doc.sizeBytes),
                new Date(doc.addedAt).toLocaleDateString('ro-RO')
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <span className={`conf ${doc.confidence}`} title={doc.notes}>
            {doc.confidence === 'verified'
              ? 'verificat'
              : doc.confidence === 'likely'
                ? 'probabil'
                : 'nesigur'}
          </span>
          <button className="ghost" onClick={() => window.api.library.open(doc)}>
            Deschide
          </button>
          <button className="ghost" onClick={() => window.api.library.reveal(doc)}>
            In folder
          </button>
          <button className="ghost danger" onClick={() => remove(doc)}>
            Sterge
          </button>
        </div>
      ))}
    </>
  )
}
