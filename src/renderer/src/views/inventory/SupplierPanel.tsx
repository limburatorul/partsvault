import type { SupplierResult } from '../../../../shared/inventory'

/**
 * Rezultatele de la furnizori.
 *
 * Randurile `linkOnly` sunt furnizorii fara cheie API configurata: nu am pret
 * si stoc, dar butonul duce direct la cautarea lor, cu codul deja completat.
 * Asa lista e mereu completa, indiferent daca omul si-a pus vreo cheie.
 */
export default function SupplierPanel({
  query,
  results,
  onClose
}: {
  query: string
  results: SupplierResult[] | null
  onClose: () => void
}): JSX.Element {
  const withData = (results ?? []).filter((r) => !r.linkOnly)
  const linksOnly = (results ?? []).filter((r) => r.linkOnly)

  function bestPrice(r: SupplierResult): string {
    if (!r.priceBreaks?.length) return '—'
    const cheapest = [...r.priceBreaks].sort((a, b) => a.price - b.price)[0]
    return `${cheapest.price.toFixed(3)} ${cheapest.currency} / buc (de la ${cheapest.quantity})`
  }

  return (
    <div className="card panel">
      <h3>Furnizori pentru {query}</h3>

      {results === null && <p className="hint">Caut la furnizori...</p>}

      {results !== null && withData.length > 0 && (
        <>
          <h4 className="sub-head">Rezultate cu pret si stoc</h4>
          <div className="table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Furnizor</th>
                  <th>Part number</th>
                  <th>Producator</th>
                  <th>Stoc</th>
                  <th>Pret</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {withData.map((r, i) => (
                  <tr key={`${r.supplierId}-${i}`}>
                    <td>{r.supplierLabel}</td>
                    <td className="mono">{r.partNumber ?? '—'}</td>
                    <td>{r.manufacturer ?? '—'}</td>
                    <td>{r.stock !== undefined ? r.stock : '—'}</td>
                    <td>{bestPrice(r)}</td>
                    <td className="row-actions">
                      <button className="ghost" onClick={() => window.api.openExternal(r.url)}>
                        Deschide
                      </button>
                      {r.datasheetUrl && (
                        <button
                          className="ghost"
                          onClick={() => window.api.openExternal(r.datasheetUrl as string)}
                        >
                          Datasheet
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {results !== null && linksOnly.length > 0 && (
        <>
          <h4 className="sub-head">Cauta in browser</h4>
          <p className="hint">
            Fara cheie API nu pot aduce pret si stoc in aplicatie, dar butoanele deschid cautarea cu
            codul completat. Cheile se pun in Setari.
          </p>
          <div className="chip-list">
            {linksOnly.map((r) => (
              <button
                key={r.supplierId}
                className="chip"
                title={r.description}
                onClick={() => window.api.openExternal(r.url)}
              >
                {r.supplierLabel}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="panel-actions">
        <button className="primary" onClick={onClose}>
          Inchide
        </button>
      </div>
    </div>
  )
}
