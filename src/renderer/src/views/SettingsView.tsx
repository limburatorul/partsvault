import { useEffect, useState } from 'react'
import type { AppConfig, SourceInfo } from '../../../shared/types'

const TIER_LABEL: Record<string, string> = {
  local: 'Local',
  manufacturer: 'Producator',
  websearch: 'Web',
  aggregator: 'Agregator',
  archive: 'Arhiva'
}

export default function SettingsView({
  config,
  onConfigChanged
}: {
  config: AppConfig
  onConfigChanged: (cfg: AppConfig) => void
}): JSX.Element {
  const [sources, setSources] = useState<SourceInfo[]>([])

  useEffect(() => {
    window.api.sources.list().then(setSources).catch(() => setSources([]))
  }, [config.disabledSources])

  async function patch(next: Partial<AppConfig>): Promise<void> {
    onConfigChanged(await window.api.config.set(next))
  }

  async function changeFolder(): Promise<void> {
    const chosen = await window.api.config.pickFolder()
    if (!chosen) return
    const check = await window.api.config.validatePath(chosen)
    if (!check.ok) {
      window.alert(`Nu pot scrie acolo: ${check.error}`)
      return
    }
    await patch({ libraryPath: chosen })
  }

  function toggleSource(id: string, enabled: boolean): void {
    const disabled = new Set(config.disabledSources)
    if (enabled) disabled.delete(id)
    else disabled.add(id)
    patch({ disabledSources: [...disabled] })
  }

  return (
    <>
      <h2 className="page-title">Setari</h2>
      <p className="page-sub">Unde salvez, de unde caut si cat de agresiv.</p>

      <div className="card">
        <h3>Folderul librariei</h3>
        <p className="hint">
          Daca schimbi calea, documentele deja descarcate raman unde sunt -- aplicatia va porni cu o
          librarie goala pe calea noua.
        </p>
        <div className="field">
          <div className="path-box">{config.libraryPath}</div>
          <button onClick={changeFolder}>Schimba</button>
          <button onClick={() => window.api.library.openRoot()}>Deschide</button>
        </div>
      </div>

      <div className="card">
        <h3>Surse de cautare</h3>
        <p className="hint">
          Se interogheaza in ordinea de mai jos, de la cele oficiale catre arhive. Cele marcate
          &quot;lent&quot; pornesc doar la cautare profunda.
        </p>
        {sources.map((source) => (
          <div className="source-row" key={source.id}>
            <label className="check" style={{ paddingTop: 2 }}>
              <input
                type="checkbox"
                checked={source.enabled}
                onChange={(e) => toggleSource(source.id, e.target.checked)}
              />
            </label>
            <div className="source-info">
              <div className="source-name">
                {source.label}{' '}
                <span className="badge" style={{ fontWeight: 400, fontSize: 11 }}>
                  {TIER_LABEL[source.tier] ?? source.tier}
                </span>
              </div>
              {source.note && <div className="source-note">{source.note}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Comportament</h3>
        <p className="hint">
          Pauza intre cereri tine site-urile linistite. Sub 500 ms risti sa fii blocat temporar de
          agregatoare.
        </p>

        <div className="field">
          <label>Pauza intre cereri (ms)</label>
          <input
            type="number"
            min={0}
            max={5000}
            step={100}
            value={config.politenessDelayMs}
            onChange={(e) => patch({ politenessDelayMs: Number(e.target.value) })}
            style={{ width: 110 }}
          />
        </div>

        <div className="field">
          <label>Marime maxima fisier (MB)</label>
          <input
            type="number"
            min={1}
            max={500}
            value={config.maxFileSizeMb}
            onChange={(e) => patch({ maxFileSizeMb: Number(e.target.value) })}
            style={{ width: 110 }}
          />
        </div>

        <div className="field">
          <label>Descarcari simultane</label>
          <input
            type="number"
            min={1}
            max={8}
            value={config.maxConcurrentDownloads}
            onChange={(e) => patch({ maxConcurrentDownloads: Number(e.target.value) })}
            style={{ width: 110 }}
          />
        </div>
      </div>
    </>
  )
}
