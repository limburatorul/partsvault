import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  Component,
  FieldDef,
  InventoryData,
  InventoryQuery,
  InventorySchema
} from '../shared/inventory'
import { libraryRoot } from './library'

/**
 * Stocarea inventarului: `inventar.json` langa librarie de documente.
 *
 * Acelasi model ca la librarie -- JSON, fara dependinte native, citibil si
 * editabil din afara aplicatiei. Un sertar de componente are sute-mii de
 * intrari, nu milioane, deci nu justifica o baza de date.
 */

const DATA_VERSION = 1
const FILE = 'inventar.json'

/**
 * Schema initiala. Pornim de la "blank" in sensul cerut -- campurile de
 * caracteristici sunt propunerea mea, nu o structura impusa: pot fi sterse sau
 * inlocuite in intregime din interfata.
 */
const DEFAULT_SCHEMA: InventorySchema = {
  version: DATA_VERSION,
  categories: [
    'Rezistoare',
    'Condensatoare',
    'Bobine',
    'Diode',
    'Tranzistoare',
    'Circuite integrate',
    'Microcontrolere',
    'Conectoare',
    'Comutatoare',
    'Relee',
    'Cristale si oscilatoare',
    'Module',
    'Altele'
  ],
  fields: [
    { id: 'valoare', label: 'Valoare', type: 'text', showInTable: true },
    { id: 'toleranta', label: 'Toleranta', type: 'text', unit: '%' },
    { id: 'tensiune', label: 'Tensiune max.', type: 'text', unit: 'V' },
    { id: 'putere', label: 'Putere', type: 'text', unit: 'W' },
    { id: 'capsula', label: 'Capsula', type: 'text', showInTable: true },
    { id: 'montaj', label: 'Montaj', type: 'select', options: ['THT', 'SMD'], showInTable: true }
  ]
}

let cache: InventoryData | null = null
let cacheRoot: string | null = null
let writeChain: Promise<unknown> = Promise.resolve()

async function filePath(): Promise<string> {
  return path.join(await libraryRoot(), FILE)
}

async function load(): Promise<InventoryData> {
  const root = await libraryRoot()
  if (cache && cacheRoot === root) return cache
  try {
    const raw = await fs.readFile(await filePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<InventoryData>
    cache = {
      version: parsed.version ?? DATA_VERSION,
      schema: parsed.schema ?? DEFAULT_SCHEMA,
      components: parsed.components ?? []
    }
  } catch {
    cache = { version: DATA_VERSION, schema: DEFAULT_SCHEMA, components: [] }
  }
  cacheRoot = root
  return cache
}

async function persist(): Promise<void> {
  const target = await filePath()
  const tmp = `${target}.tmp`
  const data = cache ?? { version: DATA_VERSION, schema: DEFAULT_SCHEMA, components: [] }
  await fs.mkdir(path.dirname(target), { recursive: true })
  // scriere atomica: inventarul e munca manuala, nu vreau sa-l pierd la o pana de curent
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, target)
}

function mutate<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn)
  writeChain = next.then(
    () => undefined,
    () => undefined
  )
  return next
}

export function resetInventoryCache(): void {
  cache = null
  cacheRoot = null
}

export async function getSchema(): Promise<InventorySchema> {
  return (await load()).schema
}

export async function saveSchema(schema: InventorySchema): Promise<InventorySchema> {
  return mutate(async () => {
    const data = await load()
    data.schema = { ...schema, version: DATA_VERSION }
    await persist()
    return data.schema
  })
}

/** Adauga un camp de caracteristici. Id-ul se deduce din eticheta. */
export async function addField(field: Omit<FieldDef, 'id'> & { id?: string }): Promise<FieldDef> {
  return mutate(async () => {
    const data = await load()
    const base =
      field.id ??
      field.label
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
    // id unic: doua campuri cu acelasi nume ar suprascrie valorile componentelor
    let id = base || `camp_${data.schema.fields.length + 1}`
    let n = 2
    while (data.schema.fields.some((f) => f.id === id)) id = `${base}_${n++}`

    const created: FieldDef = { ...field, id }
    data.schema.fields.push(created)
    await persist()
    return created
  })
}

export async function removeField(id: string): Promise<boolean> {
  return mutate(async () => {
    const data = await load()
    const before = data.schema.fields.length
    data.schema.fields = data.schema.fields.filter((f) => f.id !== id)
    // sterg si valorile, altfel raman orfane in fisier
    for (const c of data.components) delete c.values[id]
    await persist()
    return data.schema.fields.length < before
  })
}

function matchesQuery(c: Component, query: InventoryQuery): boolean {
  if (query.category && c.category !== query.category) return false
  if (query.lowStockOnly && !(c.minQuantity !== undefined && c.quantity <= c.minQuantity)) {
    return false
  }
  if (query.text) {
    const terms = query.text.toLowerCase().split(/\s+/).filter(Boolean)
    const hay = [
      c.partNumber,
      c.category,
      c.type,
      c.manufacturer ?? '',
      c.notes ?? '',
      c.location.storage ?? '',
      c.location.row ?? '',
      c.location.column ?? '',
      ...c.tags,
      ...Object.values(c.values).map(String)
    ]
      .join(' ')
      .toLowerCase()
    if (!terms.every((t) => hay.includes(t))) return false
  }
  return true
}

export async function listComponents(query: InventoryQuery = {}): Promise<Component[]> {
  const data = await load()
  return data.components
    .filter((c) => matchesQuery(c, query))
    .sort((a, b) => a.category.localeCompare(b.category) || a.partNumber.localeCompare(b.partNumber))
}

export async function upsertComponent(
  input: Partial<Component> & { id?: string }
): Promise<Component> {
  return mutate(async () => {
    const data = await load()
    const now = new Date().toISOString()

    if (input.id) {
      const existing = data.components.find((c) => c.id === input.id)
      if (existing) {
        Object.assign(existing, input, { id: existing.id, updatedAt: now })
        await persist()
        return existing
      }
    }

    const created: Component = {
      id: randomUUID(),
      partNumber: input.partNumber ?? '',
      category: input.category ?? 'Altele',
      type: input.type ?? '',
      quantity: input.quantity ?? 0,
      minQuantity: input.minQuantity,
      location: input.location ?? {},
      values: input.values ?? {},
      manufacturer: input.manufacturer,
      unitPrice: input.unitPrice,
      currency: input.currency,
      notes: input.notes,
      tags: input.tags ?? [],
      addedAt: now,
      updatedAt: now
    }
    data.components.push(created)
    await persist()
    return created
  })
}

export async function removeComponent(id: string): Promise<boolean> {
  return mutate(async () => {
    const data = await load()
    const before = data.components.length
    data.components = data.components.filter((c) => c.id !== id)
    await persist()
    return data.components.length < before
  })
}

/** Modifica stocul cu `delta`, fara sa coboare sub zero. */
export async function adjustQuantity(id: string, delta: number): Promise<Component | null> {
  return mutate(async () => {
    const data = await load()
    const c = data.components.find((x) => x.id === id)
    if (!c) return null
    c.quantity = Math.max(0, c.quantity + delta)
    c.updatedAt = new Date().toISOString()
    await persist()
    return c
  })
}

export async function inventoryStats(): Promise<{
  total: number
  totalPieces: number
  lowStock: number
  byCategory: Record<string, number>
}> {
  const data = await load()
  const byCategory: Record<string, number> = {}
  let totalPieces = 0
  let lowStock = 0
  for (const c of data.components) {
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1
    totalPieces += c.quantity
    if (c.minQuantity !== undefined && c.quantity <= c.minQuantity) lowStock++
  }
  return { total: data.components.length, totalPieces, lowStock, byCategory }
}

/** Export CSV, ca inventarul sa poata fi dus si in Excel. */
export async function exportCsv(): Promise<string> {
  const data = await load()
  const fields = data.schema.fields
  const header = [
    'Part number',
    'Categorie',
    'Tip',
    'Cantitate',
    'Minim',
    'Depozitare',
    'Rand',
    'Coloana',
    'Producator',
    ...fields.map((f) => f.label),
    'Note'
  ]

  const escape = (v: unknown): string => {
    const s = v === undefined || v === null ? '' : String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const rows = data.components.map((c) =>
    [
      c.partNumber,
      c.category,
      c.type,
      c.quantity,
      c.minQuantity ?? '',
      c.location.storage ?? '',
      c.location.row ?? '',
      c.location.column ?? '',
      c.manufacturer ?? '',
      ...fields.map((f) => c.values[f.id] ?? ''),
      c.notes ?? ''
    ]
      .map(escape)
      .join(',')
  )

  return [header.map(escape).join(','), ...rows].join('\r\n')
}
