import type { SupplierResult } from '../../../../shared/inventory'

/**
 * Rezultatele de la furnizori, intr-o singura lista.
 *
 * Randurile venite prin API au denumire, stoc si pret. Cele fara cheie
 * configurata apar pe acelasi tabel, cu un buton care deschide cautarea
 * magazinului -- ca lista sa fie mereu completa si sa se vada dintr-o privire
 * ce lipseste pentru a avea si acolo date.
 */
export default function SupplierPanel({
  query,
  results,
  onClose,
  onAddToInventory
}: {
  query: string
  results: SupplierResult[] | null
  onClose: () => void
  /** Trece piesa gasita in inventar, cu datele deja completate. */
  onAddToInventory: (partNumber: string, manufacturer?: string, description?: string) => void
}): JSX.Element {
  /** Cel mai mic pret unitar din pragurile de cantitate. */
  function priceOf(r: SupplierResult): string {
    if (!r.priceBreaks?.length) return '—'
    const cheapest = [...r.priceBreaks].sort((a, b) => a.price - b.price)[0]
    const price = cheapest.price < 1 ? cheapest.price.toFixed(3) : cheapest.price.toFixed(2)
    const from = cheapest.quantity > 1 ? ` (de la ${cheapest.quantity} buc)` : ''
    return `${price} ${cheapest.currency}${from}`
  }

  function stockOf(r: SupplierResult): JSX.Element {
    if (r.linkOnly) return <span style={{ color: 'var(--text-faint)' }}>—</span>
    if (r.stock === undefined) return <span style={{ color: 'var(--text-faint)' }}>necunoscut</span>
    if (r.stock > 0) {
      return (
        <span style={{ color: 'var(--good)' }}>
          da <span style={{ color: 'var(--text-dim)' }}>({r.stock})</span>
        </span>
      )
    }
    return <span style={{ color: 'var(--bad)' }}>nu</span>
  }

  // furnizorii cu date reale primii; link-urile simple raman la coada
  const rows = [...(results ?? [])].sort((a, b) => Number(a.linkOnly) - Number(b.linkOnly))
  const missingKeys = rows.filter((r) => r.linkOnly).length

  return (
    <div className="card panel">
      <h3>Furnizori pentru {query}</h3>

      {results === null && <p className="hint">Caut la furnizori...</p>}

      {results !== null && (
        <div className="table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th>Furnizor</th>
                <th>Denumire</th>
                <th>Producator</th>
                <th style={{ textAlign: 'center' }}>In stoc</th>
                <th>Pret</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.supplierId}-${i}`}>
                  <td>{r.supplierLabel}</td>
                  <td>
                    <div className="mono">{r.partNumber ?? '—'}</div>
                    {r.description && (
                      <div style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>
                        {r.description.slice(0, 70)}
                      </div>
                    )}
                    {r.linkOnly && (
                      <div style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>
                        fara cheie API &mdash; cauta in browser
                      </div>
                    )}
                  </td>
                  <td>{r.manufacturer ?? '—'}</td>
                  <td style={{ textAlign: 'center' }}>{stockOf(r)}</td>
                  <td className="mono">{r.linkOnly ? '—' : priceOf(r)}</td>
                  <td className="row-actions">
                    <button className="ghost" onClick={() => window.api.openExternal(r.url)}>
                      {r.linkOnly ? 'Cauta' : 'Deschide'}
                    </button>
                    {r.datasheetUrl && (
                      <button
                        className="ghost"
                        onClick={() => window.api.openExternal(r.datasheetUrl as string)}
                      >
                        Datasheet
                      </button>
                    )}
                    {!r.linkOnly && (
                      <button
                        className="ghost"
                        onClick={() =>
                          onAddToInventory(r.partNumber ?? query, r.manufacturer, r.description)
                        }
                      >
                        In inventar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results !== null && missingKeys > 0 && (
        <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
          {missingKeys} furnizori apar doar ca link: magazinele mari blocheaza citirea automata a
          paginilor, deci stocul si pretul se pot aduce doar prin API-ul lor oficial. Cheia e
          gratuita si se pune in Setari.
        </p>
      )}

      <div className="panel-actions">
        <button onClick={() => onAddToInventory(query)}>Adauga {query} in inventar</button>
        <button className="primary" onClick={onClose}>
          Inchide
        </button>
      </div>
    </div>
  )
}
