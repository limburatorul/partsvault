import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  Component,
  FieldDef,
  InventorySchema,
  SupplierResult
} from '../../../shared/inventory'
import ComponentForm from './inventory/ComponentForm'
import FieldsEditor from './inventory/FieldsEditor'
import SupplierPanel from './inventory/SupplierPanel'

type Panel = { kind: 'none' } | { kind: 'edit'; component: Partial<Component> } | { kind: 'fields' }

export default function InventoryView(): JSX.Element {
  const [schema, setSchema] = useState<InventorySchema | null>(null)
  const [components, setComponents] = useState<Component[]>([])
  const [filter, setFilter] = useState('')
  const [category, setCategory] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [panel, setPanel] = useState<Panel>({ kind: 'none' })
  const [stats, setStats] = useState<{ total: number; totalPieces: number; lowStock: number } | null>(
    null
  )

  /** Componenta pentru care s-a cerut cautare la furnizori. */
  const [supplierQuery, setSupplierQuery] = useState<string | null>(null)
  const [supplierResults, setSupplierResults] = useState<SupplierResult[] | null>(null)

  const reload = useCallback(async () => {
    const [list, s] = await Promise.all([
      window.api.inventory.list({
        text: filter.trim() || undefined,
        category: category || undefined,
        lowStockOnly
      }),
      window.api.inventory.stats()
    ])
    setComponents(list)
    setStats(s)
  }, [filter, category, lowStockOnly])

  useEffect(() => {
    window.api.inventory.schema().then(setSchema)
  }, [])

  useEffect(() => {
    const timer = setTimeout(reload, 150)
    return () => clearTimeout(timer)
  }, [reload])

  const tableFields = useMemo(
    () => (schema?.fields ?? []).filter((f) => f.showInTable),
    [schema]
  )

  async function adjust(component: Component, delta: number): Promise<void> {
    await window.api.inventory.adjust(component.id, delta)
    reload()
  }

  async function remove(component: Component): Promise<void> {
    const label = component.partNumber || component.type || 'componenta'
    if (!window.confirm(`Sterg "${label}" din inventar?`)) return
    await window.api.inventory.remove(component.id)
    reload()
  }

  async function saveComponent(values: Partial<Component>): Promise<void> {
    await window.api.inventory.upsert(values)
    setPanel({ kind: 'none' })
    reload()
  }

  /** Cauta la furnizori orice text, fara sa existe componenta in inventar. */
  async function searchSuppliersFor(query: string): Promise<void> {
    const trimmed = query.trim()
    if (!trimmed) return
    setSupplierQuery(trimmed)
    setSupplierResults(null)
    setSupplierResults(await window.api.suppliers.search(trimmed))
  }

  async function searchSuppliersForComponent(component: Component): Promise<void> {
    const query = component.partNumber || component.type
    if (!query) {
      window.alert('Componenta n-are part number sau tip dupa care sa caut.')
      return
    }
    await searchSuppliersFor(query)
  }

  /**
   * Din rezultatul unui furnizor direct in inventar: dupa ce ai comandat piesa,
   * o adaugi cu datele deja completate, fara sa le retastezi.
   */
  function addFromSupplier(partNumber: string, manufacturer?: string, description?: string): void {
    setSupplierQuery(null)
    setSupplierResults(null)
    setPanel({
      kind: 'edit',
      component: {
        partNumber,
        manufacturer,
        type: description ?? '',
        category: schema?.categories[0],
        quantity: 0
      }
    })
  }

  async function refreshSchema(): Promise<void> {
    setSchema(await window.api.inventory.schema())
    reload()
  }

  async function exportCsv(): Promise<void> {
    const res = await window.api.inventory.exportCsv()
    if (res.ok && res.path) window.alert(`Inventar exportat:\n${res.path}`)
  }

  if (!schema) return <div className="empty">Se incarca inventarul...</div>

  function locationOf(c: Component): string {
    const parts = [
      c.location.storage,
      c.location.row ? `R${c.location.row}` : null,
      c.location.column ? `C${c.location.column}` : null
    ].filter(Boolean)
    return parts.length ? parts.join(' · ') : '—'
  }

  return (
    <>
      <h2 className="page-title">Componente</h2>
      <p className="page-sub">
        Ce ai in sertare, unde e si cat a mai ramas. Scrie un cod in campul de cautare: daca nu il
        ai, apesi Enter si il cauti direct la furnizori.
      </p>

      {stats && (
        <div className="stats">
          <div>
            <b>{stats.total}</b>
            tipuri
          </div>
          <div>
            <b>{stats.totalPieces}</b>
            bucati
          </div>
          <div>
            <b style={{ color: stats.lowStock ? 'var(--warn)' : undefined }}>{stats.lowStock}</b>
            pe terminate
          </div>
        </div>
      )}

      <div className="search-bar">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            // Enter cauta la furnizori: filtrarea inventarului se face oricum
            // in timp ce tastezi, deci tasta e libera pentru pasul urmator.
            if (e.key === 'Enter') searchSuppliersFor(filter)
          }}
          placeholder="Cauta in sertare dupa cod, tip, valoare, locatie..."
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Toate categoriile</option>
          {schema.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          onClick={() => searchSuppliersFor(filter)}
          disabled={!filter.trim()}
          title="Cauta codul din campul de mai sus la Mouser, Farnell, TME, DigiKey si restul"
        >
          Cauta la furnizori
        </button>
        <button
          className="primary"
          onClick={() => setPanel({ kind: 'edit', component: { category: schema.categories[0] } })}
        >
          Adauga
        </button>
      </div>

      <div className="search-opts">
        <label className="check">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => setLowStockOnly(e.target.checked)}
          />
          Doar ce e pe terminate
        </label>
        <button className="ghost" onClick={() => setPanel({ kind: 'fields' })}>
          Campuri si categorii...
        </button>
        <button className="ghost" onClick={exportCsv}>
          Exporta CSV
        </button>
      </div>

      {panel.kind === 'fields' && (
        <FieldsEditor
          schema={schema}
          onClose={() => setPanel({ kind: 'none' })}
          onChanged={refreshSchema}
        />
      )}

      {panel.kind === 'edit' && (
        <ComponentForm
          schema={schema}
          initial={panel.component}
          onCancel={() => setPanel({ kind: 'none' })}
          onSave={saveComponent}
        />
      )}

      {supplierQuery && (
        <SupplierPanel
          query={supplierQuery}
          results={supplierResults}
          onAddToInventory={addFromSupplier}
          onClose={() => {
            setSupplierQuery(null)
            setSupplierResults(null)
          }}
        />
      )}

      {components.length === 0 && (
        <div className="empty">
          {filter.trim() ? (
            // fix cazul cerut: nu am piesa in sertare, deci de aici pornesc catre furnizori
            <>
              <p style={{ marginBottom: 4 }}>
                Nu ai <b className="mono">{filter.trim()}</b> in inventar.
              </p>
              <p style={{ marginTop: 0, marginBottom: 18 }}>Cauta la furnizori sau adaug-o manual.</p>
              <div style={{ display: 'flex', gap: 9, justifyContent: 'center' }}>
                <button className="primary" onClick={() => searchSuppliersFor(filter)}>
                  Cauta la furnizori
                </button>
                <button
                  onClick={() =>
                    setPanel({
                      kind: 'edit',
                      component: { partNumber: filter.trim(), category: schema.categories[0] }
                    })
                  }
                >
                  Adauga in inventar
                </button>
              </div>
            </>
          ) : category || lowStockOnly ? (
            'Nicio componenta care sa se potriveasca.'
          ) : (
            'Inventarul e gol. Apasa "Adauga" pentru prima componenta.'
          )}
        </div>
      )}

      {components.length > 0 && (
        <div className="table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th>Part number</th>
                <th>Categorie</th>
                <th>Tip</th>
                {tableFields.map((f) => (
                  <th key={f.id}>{f.label}</th>
                ))}
                <th>Locatie</th>
                <th style={{ textAlign: 'center' }}>Cantitate</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {components.map((c) => {
                const low = c.minQuantity !== undefined && c.quantity <= c.minQuantity
                return (
                  <tr key={c.id} className={low ? 'low' : undefined}>
                    <td className="mono">{c.partNumber || '—'}</td>
                    <td>{c.category}</td>
                    <td>{c.type || '—'}</td>
                    {tableFields.map((f) => (
                      <td key={f.id}>
                        {formatValue(c.values[f.id], f)}
                      </td>
                    ))}
                    <td className="mono">{locationOf(c)}</td>
                    <td className="qty-cell">
                      <button className="ghost" onClick={() => adjust(c, -1)} title="Scade">
                        −
                      </button>
                      <span className={low ? 'qty low' : 'qty'}>{c.quantity}</span>
                      <button className="ghost" onClick={() => adjust(c, 1)} title="Adauga">
                        +
                      </button>
                    </td>
                    <td className="row-actions">
                      <button
                        className="ghost"
                        onClick={() => setPanel({ kind: 'edit', component: c })}
                      >
                        Editeaza
                      </button>
                      <button className="ghost" onClick={() => searchSuppliersForComponent(c)}>
                        Furnizori
                      </button>
                      <button className="ghost danger" onClick={() => remove(c)}>
                        Sterge
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function formatValue(value: string | number | boolean | undefined, field: FieldDef): string {
  if (value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'da' : 'nu'
  return field.unit ? `${value} ${field.unit}` : String(value)
}
