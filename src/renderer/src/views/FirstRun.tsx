import { useEffect, useState } from 'react'
import type { AppConfig } from '../../../shared/types'

/**
 * Ecranul de prima pornire: singurul lucru obligatoriu e sa aflu unde tin
 * fisierele. Propun o cale implicita ca sa poata da Enter si sa treaca mai
 * departe, dar o poate schimba oricand din Setari.
 */
export default function FirstRun({ onDone }: { onDone: (cfg: AppConfig) => void }): JSX.Element {
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.config.suggestPath().then(setPath)
  }, [])

  async function pick(): Promise<void> {
    const chosen = await window.api.config.pickFolder()
    if (chosen) {
      setPath(chosen)
      setError(null)
    }
  }

  async function confirm(): Promise<void> {
    if (!path.trim()) return
    setBusy(true)
    setError(null)
    const check = await window.api.config.validatePath(path.trim())
    if (!check.ok) {
      setError(`Nu pot scrie acolo: ${check.error}`)
      setBusy(false)
      return
    }
    const cfg = await window.api.config.set({ libraryPath: path.trim() })
    setBusy(false)
    onDone(cfg)
  }

  return (
    <div className="firstrun">
      <div className="firstrun-inner">
        <h1>Unde tinem librăria?</h1>
        <p>
          Tot ce gaseste aplicatia se descarca aici, organizat pe tip, producator si part number.
          Fisierele raman PDF-uri obisnuite -- le poti deschide si din Explorer, fara aplicatie.
        </p>

        <div className="card">
          <div className="field">
            <input
              type="text"
              value={path}
              onChange={(e) => {
                setPath(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && confirm()}
              placeholder="D:\Datasheets"
              style={{ flex: 1 }}
            />
            <button onClick={pick}>Rasfoieste...</button>
          </div>

          {error && <div className="error-msg">{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="primary" onClick={confirm} disabled={busy || !path.trim()}>
              {busy ? 'Verific...' : 'Continua'}
            </button>
          </div>
        </div>

        <p style={{ fontSize: 12 }}>
          Folderul se creeaza automat daca nu exista. Poti sa-l muti mai tarziu din Setari.
        </p>
      </div>
    </div>
  )
}
