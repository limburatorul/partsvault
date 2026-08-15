import os from 'node:os'
import path from 'node:path'
import { saveConfig } from '../src/main/config'
import {
  addField,
  adjustQuantity,
  exportCsv,
  getSchema,
  inventoryStats,
  listComponents,
  removeField,
  upsertComponent
} from '../src/main/inventory'
import { listSuppliers, searchSuppliers } from '../src/main/suppliers'

/** Verific inventarul si cautarea la furnizori fara sa deschid interfata. */

async function main(): Promise<void> {
  const libraryPath = path.join(os.tmpdir(), 'partsvault-probe', 'inventar-test')
  await saveConfig({ libraryPath })
  console.log(`inventar de test: ${libraryPath}\n`)

  const schema = await getSchema()
  console.log(`=== 1. Schema implicita ===`)
  console.log(`   categorii: ${schema.categories.length}`)
  console.log(`   campuri: ${schema.fields.map((f) => f.label).join(', ')}\n`)

  console.log(`=== 2. Camp definit de utilizator ===`)
  const field = await addField({ label: 'Tensiune inversă', type: 'number', unit: 'V' })
  console.log(`   creat: id="${field.id}" (dedus din eticheta, cu diacritice scoase)\n`)

  console.log(`=== 3. Componente ===`)
  await upsertComponent({
    partNumber: 'LM358N',
    category: 'Circuite integrate',
    type: 'amplificator operational dublu',
    quantity: 12,
    minQuantity: 5,
    location: { storage: 'cutie A', row: '3', column: '7' },
    values: { capsula: 'DIP-8', montaj: 'THT' }
  })
  const scarce = await upsertComponent({
    partNumber: '1N4148',
    category: 'Diode',
    type: 'dioda semnal',
    quantity: 4,
    minQuantity: 10,
    location: { storage: 'cutie B', row: '1', column: '2' },
    values: { [field.id]: 100 }
  })
  await upsertComponent({
    partNumber: '',
    category: 'Rezistoare',
    type: 'rezistor 10k',
    quantity: 200,
    location: { storage: 'cutie C', row: '5', column: '1' },
    values: { valoare: '10k', toleranta: '1', montaj: 'SMD' }
  })

  const all = await listComponents()
  for (const c of all) {
    const loc = [c.location.storage, `R${c.location.row}`, `C${c.location.column}`].join(' ')
    console.log(`   ${(c.partNumber || c.type).padEnd(24)} ${String(c.quantity).padStart(4)} buc  ${loc}`)
  }

  console.log(`\n=== 4. Filtre ===`)
  console.log(`   cautare "10k":       ${(await listComponents({ text: '10k' })).length} rezultate`)
  console.log(`   cautare "cutie A":   ${(await listComponents({ text: 'cutie A' })).length} rezultate`)
  console.log(`   categoria Diode:     ${(await listComponents({ category: 'Diode' })).length} rezultate`)
  console.log(`   pe terminate:        ${(await listComponents({ lowStockOnly: true })).length} rezultate`)

  console.log(`\n=== 5. Ajustare stoc ===`)
  const after = await adjustQuantity(scarce.id, -10)
  console.log(`   1N4148: 4 - 10 => ${after?.quantity} (nu coboara sub zero)`)

  const stats = await inventoryStats()
  console.log(`\n=== 6. Statistici ===`)
  console.log(`   ${stats.total} tipuri, ${stats.totalPieces} bucati, ${stats.lowStock} pe terminate`)

  console.log(`\n=== 7. Export CSV (primele 2 randuri) ===`)
  for (const line of (await exportCsv()).split('\r\n').slice(0, 2)) {
    console.log(`   ${line.slice(0, 130)}`)
  }

  console.log(`\n=== 8. Stergerea unui camp curata si valorile ===`)
  await removeField(field.id)
  const diode = (await listComponents({ category: 'Diode' }))[0]
  console.log(`   valori ramase pe 1N4148: ${JSON.stringify(diode.values)}`)

  console.log(`\n=== 9. Furnizori ===`)
  for (const s of await listSuppliers()) {
    console.log(
      `   ${s.label.padEnd(18)} ${s.region.padEnd(14)} api=${s.supportsApi} cheie=${s.apiConfigured}`
    )
  }

  console.log(`\n   cautare "LM358N" (fara chei API, deci doar link-uri):`)
  for (const r of await searchSuppliers('LM358N')) {
    console.log(`   ${r.supplierLabel.padEnd(18)} ${r.url.slice(0, 92)}`)
  }
}

main().catch((err) => {
  console.error('probe esuat:', err)
  process.exit(1)
})
