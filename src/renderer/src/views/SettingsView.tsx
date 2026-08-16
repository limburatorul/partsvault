import { useEffect, useState } from 'react'
import type { SupplierInfo } from '../../../shared/inventory'
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
  const [suppliers, setSuppliers] = useState<SupplierInfo[]>([])
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [updateMessage, setUpdateMessage] = useState('')
  const [updateError, setUpdateError] = useState(false)

  useEffect(() => {
    window.api.update.version().then(setVersion).catch(() => setVersion(''))
  }, [])

  async function checkUpdate(): Promise<void> {
    setChecking(true)
    setUpdateMessage('')
    const info = await window.api.update.check()
    setChecking(false)
    setUpdateError(Boolean(info.error))
    if (info.error) setUpdateMessage(`Nu am putut verifica: ${info.error}`)
    else if (info.available) {
      // bannerul din capul paginii preia de aici, cu butonul de instalare
      setUpdateMessage(`Versiunea ${info.latestVersion} e disponibila.`)
    } else setUpdateMessage('Esti pe cea mai noua versiune.')
  }

  useEffect(() => {
    window.api.sources.list().then(setSources).catch(() => setSources([]))
  }, [config.disabledSources])

  useEffect(() => {
    window.api.suppliers.list().then(setSuppliers).catch(() => setSuppliers([]))
  }, [config.supplierApiKeys])

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
        <h3>Versiune si actualizari</h3>
        <p className="hint">
          Aplicatia verifica singura la fiecare pornire daca a aparut o versiune noua. Cand
          actualizezi, executabilul nou se descarca langa cel curent, porneste, iar cel vechi e
          sters automat la urmatoarea deschidere.
        </p>
        <div className="field">
          <label>Versiunea instalata</label>
          <div className="path-box" style={{ flex: 'none', minWidth: 90 }}>
            {version || '...'}
          </div>
          <button onClick={checkUpdate} disabled={checking}>
            {checking ? 'Verific...' : 'Verifica acum'}
          </button>
        </div>
        {updateMessage && (
          <div
            className="hint"
            style={{ marginBottom: 0, color: updateError ? 'var(--bad)' : 'var(--good)' }}
          >
            {updateMessage}
          </div>
        )}
      </div>

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
        <h3>Chei API furnizori</h3>
        <p className="hint">
          Fara chei, tabelul de furnizori arata doar link-uri catre cautarea fiecarui magazin. Cu
          cheie, vezi denumirea, stocul si pretul direct in aplicatie.
          <br />
          <b>Primele patru dau cheie gratuita</b> &mdash; iti faci cont, ceri cheia, o pui aici. Nu
          ai nevoie de toate: fiecare in parte umple tabelul cu randul lui. Incepe cu Mouser, e cel
          mai rapid de obtinut.
          <br />
          Nexar ar acoperi toti distribuitorii dintr-un singur apel, dar datele de stoc cer
          abonament platit &mdash; nu merita pentru cateva piese pe luna, cand fiecare distribuitor
          da acces gratuit la ale lui.
          <br />
          Cheile se tin local, in fisierul de configurare, si nu pleaca nicaieri altundeva.
        </p>
        {suppliers
          .filter((s) => s.supportsApi)
          .map((s) => (
            <div className="source-row" key={s.id}>
              <div className="source-info">
                <div className="source-name">
                  {s.label} <span className="badge">{s.region}</span>
                  {s.pricing === 'free' && (
                    <span className="badge" style={{ color: 'var(--good)' }}>
                      cheie gratuita
                    </span>
                  )}
                  {s.pricing === 'paid' && (
                    <span className="badge" style={{ color: 'var(--warn)' }}>
                      abonament platit
                    </span>
                  )}
                  {s.apiConfigured && (
                    <span className="badge" style={{ color: 'var(--good)' }}>
                      configurat
                    </span>
                  )}
                </div>
                <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                  <label style={{ minWidth: 90 }}>{s.keyLabel ?? 'API key'}</label>
                  <input
                    type="password"
                    value={config.supplierApiKeys?.[s.id] ?? ''}
                    onChange={(e) =>
                      patch({
                        supplierApiKeys: {
                          ...config.supplierApiKeys,
                          [s.id]: e.target.value.trim()
                        }
                      })
                    }
                    placeholder="lipseste"
                    style={{ flex: 1, fontFamily: 'Consolas, monospace' }}
                  />
                </div>
                {s.needsSecret && (
                  <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                    <label style={{ minWidth: 90 }}>{s.secretLabel ?? 'Secret'}</label>
                    <input
                      type="password"
                      value={config.supplierApiSecrets?.[s.id] ?? ''}
                      onChange={(e) =>
                        patch({
                          supplierApiSecrets: {
                            ...config.supplierApiSecrets,
                            [s.id]: e.target.value.trim()
                          }
                        })
                      }
                      placeholder="lipseste"
                      style={{ flex: 1, fontFamily: 'Consolas, monospace' }}
                    />
                  </div>
                )}
                {s.apiSignupUrl && (
                  <button
                    className="ghost"
                    style={{ marginTop: 6, paddingLeft: 0 }}
                    onClick={() => window.api.openExternal(s.apiSignupUrl as string)}
                  >
                    De unde iau cheia &rarr;
                  </button>
                )}
              </div>
            </div>
          ))}
        <p className="hint" style={{ marginTop: 14, marginBottom: 0 }}>
          RS, Optimus Digital si Cleste raman doar cautare in browser: n-au API public. Citirea
          automata a paginilor de magazin nu e o alternativa &mdash; toate cele mari stau in spatele
          unei verificari anti-bot, pe care aplicatia nu incearca sa o ocoleasca.
        </p>
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
