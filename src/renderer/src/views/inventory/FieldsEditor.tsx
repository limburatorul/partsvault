import { useState } from 'react'
import type { FieldType, InventorySchema } from '../../../../shared/inventory'

/**
 * Editorul de schema: aici "baza de date blank" devine a utilizatorului.
 * Poate sterge campurile propuse implicit si sa-si defineasca altele, si poate
 * rescrie complet lista de categorii.
 */
export default function FieldsEditor({
  schema,
  onChanged,
  onClose
}: {
  schema: InventorySchema
  onChanged: () => void
  onClose: () => void
}): JSX.Element {
  const [label, setLabel] = useState('')
  const [type, setType] = useState<FieldType>('text')
  const [unit, setUnit] = useState('')
  const [options, setOptions] = useState('')
  const [showInTable, setShowInTable] = useState(false)
  const [newCategory, setNewCategory] = useState('')

  async function addField(): Promise<void> {
    if (!label.trim()) return
    await window.api.inventory.addField({
      label: label.trim(),
      type,
      unit: unit.trim() || undefined,
      options:
        type === 'select'
          ? options.split(',').map((o) => o.trim()).filter(Boolean)
          : undefined,
      showInTable
    })
    setLabel('')
    setUnit('')
    setOptions('')
    setShowInTable(false)
    onChanged()
  }

  async function removeField(id: string, fieldLabel: string): Promise<void> {
    if (!window.confirm(`Sterg campul "${fieldLabel}" si valorile lui din toate componentele?`)) {
      return
    }
    await window.api.inventory.removeField(id)
    onChanged()
  }

  async function saveCategories(categories: string[]): Promise<void> {
    await window.api.inventory.saveSchema({ ...schema, categories })
    onChanged()
  }

  async function addCategory(): Promise<void> {
    const name = newCategory.trim()
    if (!name || schema.categories.includes(name)) return
    await saveCategories([...schema.categories, name])
    setNewCategory('')
  }

  return (
    <div className="card panel">
      <h3>Campuri si categorii</h3>
      <p className="hint">
        Campurile de mai jos sunt doar o propunere de pornire. Sterge-le si defineste-ti ale tale --
        un condensator si un microcontroler n-au ce sa aiba in comun.
      </p>

      <h4 className="sub-head">Caracteristici</h4>
      {schema.fields.length === 0 && <p className="hint">Niciun camp definit.</p>}
      {schema.fields.map((f) => (
        <div className="source-row" key={f.id}>
          <div className="source-info">
            <div className="source-name">
              {f.label} <span className="badge">{f.type}</span>
              {f.unit && <span className="badge">{f.unit}</span>}
              {f.showInTable && <span className="badge">in tabel</span>}
            </div>
            {f.options?.length ? <div className="source-note">{f.options.join(', ')}</div> : null}
          </div>
          <button className="ghost danger" onClick={() => removeField(f.id, f.label)}>
            Sterge
          </button>
        </div>
      ))}

      <div className="form-grid" style={{ marginTop: 14 }}>
        <label>
          Camp nou
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ex: Tensiune inversa"
          />
        </label>
        <label>
          Tip
          <select value={type} onChange={(e) => setType(e.target.value as FieldType)}>
            <option value="text">text</option>
            <option value="number">numar</option>
            <option value="select">lista de optiuni</option>
            <option value="boolean">da / nu</option>
          </select>
        </label>
        <label>
          Unitate
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="V, µF, mA..."
          />
        </label>
        {type === 'select' && (
          <label>
            Optiuni (separate prin virgula)
            <input
              type="text"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              placeholder="THT, SMD"
            />
          </label>
        )}
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 10 }}>
        <label className="check">
          <input
            type="checkbox"
            checked={showInTable}
            onChange={(e) => setShowInTable(e.target.checked)}
          />
          Arata ca o coloana in tabel
        </label>
        <button onClick={addField} disabled={!label.trim()}>
          Adauga campul
        </button>
      </div>

      <h4 className="sub-head">Categorii</h4>
      <div className="chip-list">
        {schema.categories.map((c) => (
          <span className="chip on" key={c}>
            {c}
            <button
              className="chip-x"
              title="Sterge categoria"
              onClick={() => saveCategories(schema.categories.filter((x) => x !== c))}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 9, marginTop: 12 }}>
        <input
          type="text"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCategory()}
          placeholder="Categorie noua"
        />
        <button onClick={addCategory} disabled={!newCategory.trim()}>
          Adauga
        </button>
      </div>

      <div className="panel-actions">
        <button className="primary" onClick={onClose}>
          Gata
        </button>
      </div>
    </div>
  )
}
