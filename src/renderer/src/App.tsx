import { useCallback, useEffect, useState } from 'react'
import type { AppConfig } from '../../shared/types'
import FirstRun from './views/FirstRun'
import LibraryView from './views/LibraryView'
import SearchView from './views/SearchView'
import SettingsView from './views/SettingsView'

type Tab = 'search' | 'library' | 'settings'

export default function App(): JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [tab, setTab] = useState<Tab>('search')
  const [docCount, setDocCount] = useState(0)
  /** Creste la fiecare descarcare reusita, ca sa reimprospatez libraria. */
  const [libraryVersion, setLibraryVersion] = useState(0)

  useEffect(() => {
    window.api.config.get().then(setConfig)
  }, [])

  const refreshCount = useCallback(() => {
    window.api.library
      .stats()
      .then((s) => setDocCount(s.total))
      .catch(() => setDocCount(0))
  }, [])

  useEffect(() => {
    if (config?.libraryPath) refreshCount()
  }, [config?.libraryPath, libraryVersion, refreshCount])

  const onLibraryChanged = useCallback(() => setLibraryVersion((v) => v + 1), [])

  if (!config) {
    return <div className="empty">Se incarca...</div>
  }

  // prima pornire: fara librarie configurata nu are ce sa faca aplicatia
  if (!config.libraryPath) {
    return <FirstRun onDone={setConfig} />
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          PartsVault
          <span>datasheet-uri &amp; scheme, local</span>
        </div>

        <button
          className={`nav-item ${tab === 'search' ? 'active' : ''}`}
          onClick={() => setTab('search')}
        >
          Cautare
        </button>
        <button
          className={`nav-item ${tab === 'library' ? 'active' : ''}`}
          onClick={() => setTab('library')}
        >
          Libraria
          <span className="nav-count">{docCount}</span>
        </button>
        <button
          className={`nav-item ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
        >
          Setari
        </button>

        <div className="sidebar-foot">
          <button className="ghost" onClick={() => window.api.library.openRoot()}>
            Deschide folderul
          </button>
        </div>
      </nav>

      <main className="main">
        {tab === 'search' && <SearchView onLibraryChanged={onLibraryChanged} />}
        {tab === 'library' && <LibraryView version={libraryVersion} onChanged={onLibraryChanged} />}
        {tab === 'settings' && <SettingsView config={config} onConfigChanged={setConfig} />}
      </main>
    </div>
  )
}
