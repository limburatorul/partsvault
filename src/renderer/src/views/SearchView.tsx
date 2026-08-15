import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  DocKind,
  DownloadProgress,
  PartAnalysis,
  SearchHit,
  SearchProgress
} from '../../../shared/types'

const KIND_OPTIONS: Array<{ value: DocKind; label: string }> = [
  { value: 'datasheet', label: 'Datasheet' },
  { value: 'schematic', label: 'Schema' },
  { value: 'appnote', label: 'Nota aplicatie' },
  { value: 'manual', label: 'Manual' },
  { value: 'errata', label: 'Errata' },
  { value: 'reference-design', label: 'Reference design' }
]

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function scoreClass(score: number): string {
  if (score >= 0.75) return 'high'
  if (score >= 0.45) return 'mid'
  return 'low'
}

export default function SearchView({
  onLibraryChanged
}: {
  onLibraryChanged: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [deep, setDeep] = useState(false)
  const [equivalents, setEquivalents] = useState(true)
  const [kinds, setKinds] = useState<DocKind[]>(['datasheet'])

  const [analysis, setAnalysis] = useState<PartAnalysis | null>(null)
  /** Cat timp e false, pot ajusta automat tipurile dupa felul interogarii. */
  const [kindsTouched, setKindsTouched] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [log, setLog] = useState<Array<{ text: string; error?: boolean }>>([])
  const [searching, setSearching] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({})

  /** Query-ul cu care a pornit cautarea curenta -- verificarea se face fata de el. */
  const activeQuery = useRef('')
  const logRef = useRef<HTMLDivElement>(null)

  // analiza part number-ului se actualizeaza in timp ce omul tasteaza
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setAnalysis(null)
      return
    }
    const timer = setTimeout(() => {
      window.api.search.explain(trimmed).then(setAnalysis).catch(() => setAnalysis(null))
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const off = window.api.search.onProgress((p: SearchProgress) => {
      if (p.phase === 'hit' && p.hits?.length) {
        // rezultatele apar pe masura ce sursele raspund, nu la final
        setHits((prev) => {
          const seen = new Set(prev.map((h) => h.url))
          const fresh = p.hits!.filter((h) => !seen.has(h.url))
          return [...prev, ...fresh].sort((a, b) => b.score - a.score)
        })
        return
      }
      if (p.message) {
        setLog((prev) => [...prev, { text: p.message!, error: p.phase === 'error' }])
      }
      if (p.phase === 'done') setRunId(null)
    })
    return off
  }, [])

  useEffect(() => {
    const off = window.api.download.onProgress((p: DownloadProgress) => {
      setDownloads((prev) => ({ ...prev, [p.hitId]: p }))
      if (p.phase === 'done') onLibraryChanged()
    })
    return off
  }, [onLibraryChanged])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log])

  async function search(): Promise<void> {
    const q = query.trim()
    if (!q || searching) return
    activeQuery.current = q
    setSearching(true)
    setHits([])
    setLog([])
    setDownloads({})
    try {
      const result = await window.api.search.run({
        query: q,
        deepSearch: deep,
        expandEquivalents: equivalents,
        kinds
      })
      setRunId(result.runId)
      setHits(result.hits)
    } catch (err) {
      setLog((prev) => [
        ...prev,
        { text: err instanceof Error ? err.message : 'eroare la cautare', error: true }
      ])
    } finally {
      setSearching(false)
      setRunId(null)
    }
  }

  function download(hit: SearchHit): void {
    window.api.download.start(hit, activeQuery.current || query.trim()).catch(() => undefined)
  }

  /** Descarca automat rezultatele bune care nu sunt deja in librarie. */
  async function downloadBest(): Promise<void> {
    const best = hits.filter((h) => h.score >= 0.7 && !h.alreadyInLibrary && !h.gated).slice(0, 5)
    for (const hit of best) {
      await window.api.download.start(hit, activeQuery.current || query.trim()).catch(() => undefined)
    }
  }

  const goodCount = useMemo(
    () => hits.filter((h) => h.score >= 0.7 && !h.alreadyInLibrary && !h.gated).length,
    [hits]
  )

  function toggleKind(kind: DocKind): void {
    setKindsTouched(true)
    setKinds((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]))
  }

  // Cand omul scrie un nume de aparat, nu cauta fisa tehnica a unui integrat --
  // vrea schema sau manualul de service. Comut filtrele, dar doar cat timp nu
  // le-a atins el; daca a ales explicit, ii respect alegerea.
  useEffect(() => {
    if (!analysis || kindsTouched) return
    const wanted: DocKind[] =
      analysis.queryType === 'device' ? ['schematic', 'manual'] : ['datasheet']
    setKinds((prev) =>
      prev.length === wanted.length && wanted.every((k) => prev.includes(k)) ? prev : wanted
    )
  }, [analysis, kindsTouched])

  return (
    <>
      <h2 className="page-title">Cautare</h2>
      <p className="page-sub">
        Scrie codul integratului &mdash; merge si cu marcajul de pe capsula (C945), si cu coduri
        est-europene (CDB400, K155LA3, MMC4011). Sau scrie numele unui aparat (Logitech Z5500,
        Pioneer VSX-921) si iti caut schema si manualul de service.
      </p>

      <div className="search-bar">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="ex: LM358, K155LA3, STM32F103C8T6, Logitech Z5500..."
          autoFocus
        />
        <button className="primary" onClick={search} disabled={searching || !query.trim()}>
          {searching ? 'Caut...' : 'Cauta'}
        </button>
        {searching && runId && (
          <button onClick={() => window.api.search.cancel(runId)}>Opreste</button>
        )}
      </div>

      <div className="search-opts">
        <label className="check">
          <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
          Cautare profunda
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={equivalents}
            onChange={(e) => setEquivalents(e.target.checked)}
          />
          Include echivalente
        </label>
        <div className="kind-chips">
          {KIND_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`chip ${kinds.includes(opt.value) ? 'on' : ''}`}
              onClick={() => toggleKind(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {analysis && (
        <div className="analysis">
          <div className="analysis-row">
            <span className="analysis-label">
              {analysis.queryType === 'device' ? 'Caut ca aparat:' : 'Voi cauta:'}
            </span>
            <span>
              {analysis.variants.map((v) => (
                <span key={v} className="tag">
                  {v}
                </span>
              ))}
              {analysis.queryType === 'device' && (
                <span style={{ color: 'var(--text-faint)', marginLeft: 4 }}>
                  schema si manual de service, nu fisa tehnica de integrat
                </span>
              )}
            </span>
          </div>
          {analysis.likelyManufacturers.length > 0 && (
            <div className="analysis-row">
              <span className="analysis-label">Probabil de la:</span>
              <span>{analysis.likelyManufacturers.join(', ')}</span>
            </div>
          )}
          {equivalents && analysis.equivalents.length > 0 && (
            <div className="analysis-row">
              <span className="analysis-label">Echivalente:</span>
              <span>
                {analysis.equivalents.slice(0, 10).map((e) => (
                  <span key={e} className="tag eq">
                    {e}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}

      {log.length > 0 && (
        <div className="progress-log" ref={logRef}>
          {log.map((entry, i) => (
            <div key={i} className={entry.error ? 'err' : undefined}>
              {entry.text}
            </div>
          ))}
        </div>
      )}

      {hits.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            {hits.length} rezultate
          </span>
          <button onClick={downloadBest} disabled={goodCount === 0}>
            Descarca cele bune ({goodCount})
          </button>
        </div>
      )}

      {hits.map((hit) => {
        const dl = downloads[hit.id]
        return (
          <div className="result" key={hit.id}>
            <div className={`score ${scoreClass(hit.score)}`}>{Math.round(hit.score * 100)}</div>

            <div className="result-body">
              <div className="result-title">{hit.title}</div>
              <div className="result-url" onClick={() => window.api.openExternal(hit.url)}>
                {hit.url}
              </div>
              <div className="result-meta">
                <span className={`badge tier-${hit.tier}`}>{hit.sourceLabel}</span>
                {hit.manufacturer && <span className="badge">{hit.manufacturer}</span>}
                {hit.kind !== 'unknown' && <span className="badge">{hit.kind}</span>}
                {hit.sizeBytes ? <span>{formatSize(hit.sizeBytes)}</span> : null}
                {hit.alreadyInLibrary && <span style={{ color: 'var(--good)' }}>deja in librarie</span>}
                {hit.reason && <span style={{ color: 'var(--text-faint)' }}>{hit.reason}</span>}
              </div>
            </div>

            <div className="result-actions">
              {hit.gated ? (
                // sursa cere trecerea prin pagina ei; nu incerc sa o ocolesc
                <>
                  <button onClick={() => window.api.openExternal(hit.url)}>Deschide pagina</button>
                  <button
                    className="ghost"
                    title="Dupa ce ai descarcat din browser, adauga fisierul in librarie"
                    onClick={async () => {
                      const res = await window.api.library.import(activeQuery.current || query.trim())
                      if (res.some((r) => r.ok)) onLibraryChanged()
                    }}
                  >
                    Importa fisierul
                  </button>
                </>
              ) : (
                <button
                  onClick={() => download(hit)}
                  disabled={
                    dl?.phase === 'downloading' || dl?.phase === 'verifying' || dl?.phase === 'done'
                  }
                >
                  {dl?.phase === 'done' ? 'Salvat' : 'Descarca'}
                </button>
              )}

              {dl && (
                <div
                  className={`dl-status ${dl.phase === 'done' || dl.phase === 'duplicate' ? 'ok' : ''} ${
                    dl.phase === 'error' ? 'err' : ''
                  }`}
                >
                  {dl.phase === 'downloading' &&
                    (dl.totalBytes
                      ? `${Math.round(((dl.receivedBytes ?? 0) / dl.totalBytes) * 100)}%`
                      : formatSize(dl.receivedBytes))}
                  {dl.phase === 'verifying' && 'verific...'}
                  {dl.phase === 'done' && 'salvat'}
                  {dl.phase === 'duplicate' && 'il ai deja'}
                  {dl.phase === 'error' && dl.message}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {!searching && hits.length === 0 && log.length > 0 && (
        <div className="empty">
          Nimic gasit. Incearca bifa &quot;cautare profunda&quot; -- adauga agregatoarele si arhivele
          vintage, dureaza mai mult dar sapa mult mai adanc.
        </div>
      )}
    </>
  )
}
