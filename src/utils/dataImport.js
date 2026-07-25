// CSV import/export for master data.
//
// The other half of the onboarding problem. Opening balances say what the
// business was carrying; this says who its customers are, what it sells, and
// what its chart of accounts looks like — without retyping a thousand rows.
//
// Three rules shape this file:
//
//   * Nothing is written until the user has seen exactly what will happen.
//     `planImport` produces a full plan — creates, updates with field-level
//     diffs, skips, and errors — and touches nothing. `applyPlan` is a
//     separate call.
//   * Import goes through the ordinary store actions, never around them. A
//     row imported is a row created, with the same validation and the same
//     audit-trail entry as one typed by hand.
//   * A row that cannot be trusted is reported, not guessed at. A bad number
//     or a missing required field fails that row and leaves the rest alone —
//     a partial import you can see beats a whole one you can't.

const s = (v) => String(v ?? '').trim()
const lower = (v) => s(v).toLowerCase()

/** Numeric parse that tolerates thousands separators and currency symbols. */
export function parseNumber(v) {
  const raw = s(v)
  if (!raw) return null
  // Strip anything that is not a digit, sign, or decimal point — spreadsheets
  // export "1,234.50", "$1234.50" and "1 234,50" with equal enthusiasm.
  let t = raw.replace(/[^\d.,\-+]/g, '')
  const lastComma = t.lastIndexOf(',')
  const lastDot = t.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal point.
    t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  } else if (lastComma > -1) {
    // A lone comma is a decimal point only when it looks like one (1,50).
    t = /,\d{1,2}$/.test(t) ? t.replace(',', '.') : t.replace(/,/g, '')
  }
  // Stripping "abc" leaves an empty string, and Number('') is 0 — which would
  // turn an unreadable price into a free product. Guard before coercing.
  if (!/\d/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function parseBool(v) {
  const t = lower(v)
  if (!t) return null
  if (['1', 'true', 'yes', 'y', 'نعم'].includes(t)) return true
  if (['0', 'false', 'no', 'n', 'لا'].includes(t)) return false
  return null
}

/**
 * Field definitions per entity.
 *
 * `aliases` are matched case-insensitively against the CSV headers so an
 * export from another system usually maps itself. `key: true` marks the field
 * used to decide create-vs-update.
 */
export const SCHEMAS = {
  customers: {
    label: 'Customers',
    store: { add: 'addCustomer', update: 'updateCustomer', list: 'customers' },
    fields: [
      { name: 'name', label: 'Name', required: true, key: true, aliases: ['name', 'customer', 'customer name', 'client', 'الاسم', 'العميل'] },
      { name: 'email', label: 'Email', type: 'email', aliases: ['email', 'e-mail', 'البريد'] },
      { name: 'phone', label: 'Phone', aliases: ['phone', 'mobile', 'tel', 'telephone', 'الهاتف', 'الجوال'] },
      { name: 'taxNumber', label: 'Tax number', aliases: ['tax number', 'vat number', 'vat', 'trn', 'الرقم الضريبي'] },
      { name: 'address', label: 'Address', aliases: ['address', 'billing address', 'العنوان'] },
      { name: 'creditLimit', label: 'Credit limit', type: 'number', aliases: ['credit limit', 'حد الائتمان'] },
      { name: 'paymentTerms', label: 'Payment terms (days)', type: 'number', aliases: ['payment terms', 'terms', 'days', 'شروط الدفع'] },
      { name: 'notes', label: 'Notes', aliases: ['notes', 'note', 'ملاحظات'] },
    ],
  },
  suppliers: {
    label: 'Suppliers',
    store: { add: 'addSupplier', update: 'updateSupplier', list: 'suppliers' },
    fields: [
      { name: 'name', label: 'Name', required: true, key: true, aliases: ['name', 'supplier', 'supplier name', 'vendor', 'الاسم', 'المورد'] },
      { name: 'email', label: 'Email', type: 'email', aliases: ['email', 'e-mail', 'البريد'] },
      { name: 'phone', label: 'Phone', aliases: ['phone', 'mobile', 'tel', 'telephone', 'الهاتف', 'الجوال'] },
      { name: 'taxNumber', label: 'Tax number', aliases: ['tax number', 'vat number', 'vat', 'trn', 'الرقم الضريبي'] },
      { name: 'address', label: 'Address', aliases: ['address', 'العنوان'] },
      { name: 'paymentTerms', label: 'Payment terms (days)', type: 'number', aliases: ['payment terms', 'terms', 'days', 'شروط الدفع'] },
      { name: 'notes', label: 'Notes', aliases: ['notes', 'note', 'ملاحظات'] },
    ],
  },
  accounts: {
    label: 'Chart of accounts',
    store: { add: 'addAccount', update: 'updateAccount', list: 'accounts' },
    fields: [
      { name: 'code', label: 'Code', required: true, key: true, aliases: ['code', 'account code', 'number', 'account no', 'رقم الحساب', 'الرمز'] },
      { name: 'name', label: 'Name', required: true, aliases: ['name', 'account name', 'description', 'اسم الحساب'] },
      { name: 'type', label: 'Type', required: true, type: 'enum', options: ['asset', 'liability', 'equity', 'revenue', 'expense'], aliases: ['type', 'account type', 'النوع'] },
      { name: 'subtype', label: 'Subtype', aliases: ['subtype', 'sub type', 'category', 'group', 'التصنيف'] },
    ],
  },
  inventoryItems: {
    label: 'Inventory items',
    store: { add: 'addInventoryItem', update: 'updateInventoryItem', list: 'inventoryItems' },
    fields: [
      { name: 'code', label: 'Code / SKU', required: true, key: true, aliases: ['code', 'sku', 'item code', 'product code', 'barcode', 'رمز الصنف'] },
      { name: 'name', label: 'Name', required: true, aliases: ['name', 'item', 'description', 'product', 'اسم الصنف'] },
      { name: 'unit', label: 'Unit', aliases: ['unit', 'uom', 'الوحدة'] },
      { name: 'costPrice', label: 'Cost price', type: 'number', aliases: ['cost', 'cost price', 'purchase price', 'التكلفة'] },
      { name: 'salePrice', label: 'Sale price', type: 'number', aliases: ['price', 'sale price', 'selling price', 'unit price', 'سعر البيع'] },
      { name: 'reorderLevel', label: 'Reorder level', type: 'number', aliases: ['reorder level', 'min level', 'minimum', 'حد إعادة الطلب'] },
      { name: 'category', label: 'Category', aliases: ['category', 'group', 'الفئة'] },
      { name: 'taxRate', label: 'Tax rate %', type: 'number', aliases: ['tax rate', 'vat rate', 'tax', 'نسبة الضريبة'] },
    ],
  },
}

// Quantity and cost move through trading, not through a spreadsheet. Letting
// an import set stock on hand would post no journal entry and silently break
// the inventory account — opening stock belongs in Opening Balances.
export const EXCLUDED_NOTE = 'Stock on hand is not imported here — use Opening Balances, which posts the matching journal entry.'

/**
 * Guess which CSV column feeds which field.
 * @returns { [fieldName]: columnIndex } — -1 when nothing matched
 */
const normHeader = (h) => lower(h).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

export function autoMap(entity, headers = []) {
  const schema = SCHEMAS[entity]
  if (!schema) return {}
  // Headers and aliases go through the same normaliser, or "e-mail" never
  // matches the alias "e-mail" once one side has had its hyphen replaced.
  const norm = headers.map(normHeader)
  const used = new Set()
  const map = {}
  schema.fields.forEach((f) => {
    const aliases = f.aliases.map(normHeader)
    // Aliases are listed most-canonical first, so when a file has both "Name"
    // and "Customer Name" the plain one wins — rank by alias position, not by
    // column position.
    let idx = -1; let best = Infinity
    norm.forEach((h, i) => {
      if (used.has(i)) return
      const rank = aliases.indexOf(h)
      if (rank > -1 && rank < best) { best = rank; idx = i }
    })
    if (idx === -1) idx = norm.findIndex((h, i) => !used.has(i) && aliases.some((a) => h.includes(a)))
    map[f.name] = idx
    if (idx > -1) used.add(idx)
  })
  return map
}

/** Coerce and validate one cell. @returns { value } | { error } */
function coerce(field, raw) {
  const text = s(raw)
  if (!text) {
    if (field.required) return { error: `${field.label} is required` }
    return { value: undefined }
  }
  if (field.type === 'number') {
    const n = parseNumber(text)
    if (n === null) return { error: `${field.label} is not a number ("${text}")` }
    if (n < 0) return { error: `${field.label} cannot be negative` }
    return { value: n }
  }
  if (field.type === 'enum') {
    const v = lower(text)
    if (!field.options.includes(v)) return { error: `${field.label} must be one of: ${field.options.join(', ')} (got "${text}")` }
    return { value: v }
  }
  if (field.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) {
    return { error: `${field.label} is not a valid email ("${text}")` }
  }
  return { value: text }
}

/**
 * Work out exactly what an import would do, without doing any of it.
 *
 * @param entity   key into SCHEMAS
 * @param rows     string[][] from parseCSV
 * @param map      { field: columnIndex } from autoMap or the UI
 * @param existing current records from the store
 * @returns { creates, updates, skips, errors, counts }
 */
export function planImport(entity, rows = [], map = {}, existing = []) {
  const schema = SCHEMAS[entity]
  if (!schema) return { creates: [], updates: [], skips: [], errors: [], counts: { create: 0, update: 0, skip: 0, error: 0 } }

  const keyField = schema.fields.find((f) => f.key)
  const byKey = new Map()
  existing.forEach((r) => {
    const k = lower(r[keyField.name])
    if (k && !byKey.has(k)) byKey.set(k, r)
  })

  const creates = []; const updates = []; const skips = []; const errors = []
  const seenInFile = new Map()

  rows.forEach((cells, i) => {
    const lineNo = i + 2   // +1 for the header, +1 because humans count from 1
    if (cells.every((c) => !s(c))) return   // blank line

    const record = {}
    const rowErrors = []
    schema.fields.forEach((f) => {
      const col = map[f.name]
      const raw = col > -1 ? cells[col] : ''
      const out = coerce(f, raw)
      if (out.error) rowErrors.push(out.error)
      else if (out.value !== undefined) record[f.name] = out.value
    })

    if (rowErrors.length) { errors.push({ line: lineNo, errors: rowErrors, raw: cells }); return }

    const key = lower(record[keyField.name])
    // A file that lists the same key twice would create one record and then
    // silently overwrite it — surface it instead.
    if (seenInFile.has(key)) {
      errors.push({ line: lineNo, errors: [`Duplicate ${keyField.label} "${record[keyField.name]}" — also on line ${seenInFile.get(key)}`], raw: cells })
      return
    }
    seenInFile.set(key, lineNo)

    const match = byKey.get(key)
    if (!match) { creates.push({ line: lineNo, record }); return }

    // Only fields that actually differ count as an update, so a re-import of
    // an unchanged file reports "nothing to do" rather than churning every row
    // and filling the audit log with noise.
    const changes = []
    Object.entries(record).forEach(([k, v]) => {
      const before = match[k]
      const same = (before === undefined || before === null || before === '')
        ? (v === undefined || v === null || v === '')
        : String(before) === String(v)
      if (!same) changes.push({ field: k, from: before ?? '', to: v })
    })
    if (changes.length === 0) skips.push({ line: lineNo, id: match.id, key: record[keyField.name], reason: 'No change' })
    else updates.push({ line: lineNo, id: match.id, key: record[keyField.name], record, changes })
  })

  return {
    creates, updates, skips, errors,
    counts: { create: creates.length, update: updates.length, skip: skips.length, error: errors.length },
  }
}

/**
 * Execute a plan through the store's own actions.
 *
 * `actions` is { add, update } — the real store functions, so imported records
 * get the same validation and the same audit entry as hand-typed ones.
 *
 * @param opts.updateExisting when false, matched records are left untouched
 * @returns { created, updated, failed }
 */
export function applyPlan(plan, actions, { updateExisting = true } = {}) {
  let created = 0; let updated = 0; const failed = []

  plan.creates.forEach((c) => {
    try { actions.add(c.record); created++ }
    catch (e) { failed.push({ line: c.line, error: String(e.message || e) }) }
  })

  if (updateExisting) {
    plan.updates.forEach((u) => {
      try { actions.update(u.id, u.record); updated++ }
      catch (e) { failed.push({ line: u.line, error: String(e.message || e) }) }
    })
  }

  return { created, updated, failed }
}

/** Column set for exporting an entity — the same shape the importer reads. */
export function exportColumns(entity) {
  const schema = SCHEMAS[entity]
  if (!schema) return []
  return schema.fields.map((f) => ({ key: f.name, label: f.label }))
}

/** A one-row template so a user can see the expected shape before filling it. */
export function templateRow(entity) {
  const schema = SCHEMAS[entity]
  if (!schema) return {}
  const sample = {
    customers: { name: 'Al-Noor Trading Est.', email: 'ap@alnoor.example', phone: '+966500000000', taxNumber: '300000000000003', address: 'Riyadh', creditLimit: 50000, paymentTerms: 30, notes: '' },
    suppliers: { name: 'Riyadh Supplies Co', email: 'sales@supplies.example', phone: '+966510000000', taxNumber: '310000000000003', address: 'Riyadh', paymentTerms: 30, notes: '' },
    accounts: { code: '5100', name: 'Marketing Expense', type: 'expense', subtype: 'expense' },
    inventoryItems: { code: 'SKU-001', name: 'A4 Paper Ream', unit: 'ream', costPrice: 12.5, salePrice: 18, reorderLevel: 20, category: 'Stationery', taxRate: 15 },
  }[entity] || {}
  const row = {}
  schema.fields.forEach((f) => { row[f.name] = sample[f.name] ?? '' })
  return row
}
