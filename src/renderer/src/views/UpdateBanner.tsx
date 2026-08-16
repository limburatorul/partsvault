import { useEffect, useState } from 'react'
import type { UpdateInfo, UpdateProgress } from '../../../shared/types'

/**
 * Bannerul de actualizare.
 *
 * Apare doar cand chiar exista o versiune mai noua -- verificarea de la pornire
 * e tacuta altfel, ca sa nu deranjeze la fiecare deschidere.
 */
export default function UpdateBanner(): JSX.Element | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => window.api.update.onAvailable(setInfo), [])
  useEffect(() => window.api.update.onProgress(setProgress), [])

  if (!info?.available || dismissed) return null

  const busy = progress !== null && progress.phase !== 'error'
  const percent =
    progress?.phase === 'downloading' && progress.totalBytes
      ? Math.round(((progress.receivedBytes ?? 0) / progress.totalBytes) * 100)
      : null

  return (
    <div className="update-banner">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          Versiunea {info.latestVersion} e disponibila{' '}
          <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>
            (ai {info.currentVersion})
          </span>
        </div>
        {progress?.phase === 'downloading' && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Se descarca... {percent !== null ? `${percent}%` : ''}
          </div>
        )}
        {progress?.phase === 'verifying' && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{progress.message}</div>
        )}
        {progress?.phase === 'restarting' && (
          <div style={{ fontSize: 12, color: 'var(--good)' }}>{progress.message}</div>
        )}
        {progress?.phase === 'error' && (
          <div style={{ fontSize: 12, color: 'var(--bad)' }}>{progress.message}</div>
        )}
      </div>

      {info.notes && !busy && (
        <button
          className="ghost"
          onClick={() =>
            window.api.openExternal(
              `https://github.com/limburatorul/partsvault/releases/tag/v${info.latestVersion}`
            )
          }
        >
          Ce s-a schimbat
        </button>
      )}

      <button
        className="primary"
        disabled={busy}
        onClick={() => {
          setProgress({ phase: 'downloading', receivedBytes: 0, totalBytes: info.sizeBytes })
          window.api.update.download(info)
        }}
      >
        {busy ? 'Se instaleaza...' : 'Actualizeaza si reporneste'}
      </button>

      {!busy && (
        <button className="ghost" onClick={() => setDismissed(true)} title="Mai tarziu">
          ✕
        </button>
      )}
    </div>
  )
}
