import { useState } from 'react'
import type { Component, FieldDef, InventorySchema } from '../../../../shared/inventory'

/**
 * Formularul de componenta: nucleul fix plus campurile definite de utilizator.
 * Campurile restranse la anumite categorii apar doar cand categoria se
 * potriveste -- altfel formularul unui rezistor ar cere si frecventa de ceas.
 */
export default function ComponentForm({
  schema,
  initial,
  onSave,
  onCancel
}: {
  schema: InventorySchema
  initial: Partial<Component>
  onSave: (values: Partial<Component>) => void
  onCancel: () => void
}): JSX.Element {
  const [form, setForm] = useState<Partial<Component>>({
    quantity: 0,
    location: {},
    values: {},
    tags: [],
    ...initial
  })

  function set<K extends keyof Component>(key: K, value: Component[K]): void {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function setLocation(key: 'storage' | 'row' | 'column', value: string): void {
    setForm((f) => ({ ...f, location: { ...f.location, [key]: value } }))
  }

  function setValue(fieldId: string, value: string | number | boolean): void {
    setForm((f) => ({ ...f, values: { ...f.values, [fieldId]: value } }))
  }

  const visibleFields = schema.fields.filter(
    (f) => !f.categories?.length || (form.category && f.categories.includes(form.category))
  )

  return (
    <div className="card panel">
      <h3>{initial.id ? 'Editeaza componenta' : 'Componenta noua'}</h3>

      <div className="form-grid">
        <label>
          Part number
          <input
            type="text"
            value={form.partNumber ?? ''}
            onChange={(e) => set('partNumber', e.target.value)}
            placeholder="ex: LM358N"
            autoFocus
          />
        </label>

        <label>
          Categorie
          <select value={form.category ?? ''} onChange={(e) => set('category', e.target.value)}>
            {schema.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label>
          Tip
          <input
            type="text"
            value={form.type ?? ''}
            onChange={(e) => set('type', e.target.value)}
            placeholder="ex: amplificator operational dublu"
          />
        </label>

        <label>
          Producator
          <input
            type="text"
            value={form.manufacturer ?? ''}
            onChange={(e) => set('manufacturer', e.target.value)}
          />
        </label>

        <label>
          Cantitate
          <input
            type="number"
            min={0}
            value={form.quantity ?? 0}
            onChange={(e) => set('quantity', Number(e.target.value))}
          />
        </label>

        <label>
          Alerta sub
          <input
            type="number"
            min={0}
            value={form.minQuantity ?? ''}
            onChange={(e) =>
              set('minQuantity', e.target.value === '' ? (undefined as never) : Number(e.target.value))
            }
            placeholder="gol = fara alerta"
          />
        </label>

        <label>
          Depozitare
          <input
            type="text"
            value={form.location?.storage ?? ''}
            onChange={(e) => setLocation('storage', e.target.value)}
            placeholder="ex: cutie A, sertar 2"
          />
        </label>

        <label>
          Rand
          <input
            type="text"
            value={form.location?.row ?? ''}
            onChange={(e) => setLocation('row', e.target.value)}
            placeholder="ex: 3"
          />
        </label>

        <label>
          Coloana
          <input
            type="text"
            value={form.location?.column ?? ''}
            onChange={(e) => setLocation('column', e.target.value)}
            placeholder="ex: 7"
          />
        </label>

        {visibleFields.map((field) => (
          <label key={field.id}>
            {field.label}
            {field.unit ? ` (${field.unit})` : ''}
            <FieldInput
              field={field}
              value={form.values?.[field.id]}
              onChange={(v) => setValue(field.id, v)}
            />
          </label>
        ))}
      </div>

      <label className="full">
        Note
        <input
          type="text"
          value={form.notes ?? ''}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="orice altceva merita retinut"
        />
      </label>

      <div className="panel-actions">
        <button onClick={onCancel}>Renunta</button>
        <button className="primary" onClick={() => onSave(form)}>
          Salveaza
        </button>
      </div>
    </div>
  )
}

function FieldInput({
  field,
  value,
  onChange
}: {
  field: FieldDef
  value: string | number | boolean | undefined
  onChange: (value: string | number | boolean) => void
}): JSX.Element {
  if (field.type === 'select') {
    return (
      <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(field.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    )
  }

  if (field.type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18 }}
      />
    )
  }

  return (
    <input
      type={field.type === 'number' ? 'number' : 'text'}
      value={value === undefined ? '' : String(value)}
      onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
    />
  )
}
