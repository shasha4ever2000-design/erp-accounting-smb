// Custom fields.
//
// Every business has one field the software didn't think of: a contract
// number, a vehicle plate, a CR number, a site code, a warranty end date. The
// question is never whether to allow one but how to store it.
//
// Two decisions carry the whole design:
//
// 1. **Values are keyed by field id, never by label.** The version this
//    replaces keyed them by the label the user typed, so renaming "Contract #"
//    to "Contract number" silently detached the value from every record that
//    had one. The data was still in the file and no longer reachable, which is
//    the worst of both. An id is generated once and never changes.
//
// 2. **A field has a type.** A date that is really a string sorts wrong,
//    exports wrong, and cannot be filtered. A dropdown that is really free text
//    accumulates "Riyadh", "riyadh" and "Riyad" within a month.
//
// Fields are defined per entity (customer, supplier, item, invoice, ...) and
// can be marked to appear on the printed document, which is the reason most
// people want them in the first place.

const uid = () => `cf-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`

/** The entities that can carry custom fields, in the order Settings shows them. */
export const CF_ENTITIES = [
  { id: 'customer',   label: 'Customers',        printable: false },
  { id: 'supplier',   label: 'Suppliers',        printable: false },
  { id: 'item',       label: 'Inventory items',  printable: false },
  { id: 'invoice',    label: 'Sales invoices',   printable: true  },
  { id: 'quotation',  label: 'Quotations',       printable: true  },
  { id: 'purchase',   label: 'Purchases',        printable: true  },
  { id: 'fixedAsset', label: 'Fixed assets',     printable: false },
  { id: 'employee',   label: 'Employees',        printable: false },
]

export const CF_TYPES = [
  { id: 'text',      label: 'Text' },
  { id: 'textarea',  label: 'Paragraph' },
  { id: 'number',    label: 'Number' },
  { id: 'date',      label: 'Date' },
  { id: 'select',    label: 'Dropdown' },
  { id: 'checkbox',  label: 'Yes / no' },
]

export function isEntity(id) { return CF_ENTITIES.some((e) => e.id === id) }
export function entityMeta(id) { return CF_ENTITIES.find((e) => e.id === id) || null }
export function isPrintable(entityId) { return !!entityMeta(entityId)?.printable }

/** A blank definition, ready for the form. */
export function newField(patch = {}) {
  return {
    id: uid(),
    name: '',
    type: 'text',
    options: [],
    required: false,
    showOnPrint: false,
    sort: 0,
    ...patch,
  }
}

/**
 * Normalise whatever is stored into a usable definition.
 *
 * Anything unrecognised degrades to text rather than disappearing — a field
 * the user can still read and edit beats a field that vanished.
 */
export function normaliseField(def, index = 0) {
  if (!def) return null
  if (typeof def === 'string') return { ...newField({ name: def, sort: index }) }
  const type = CF_TYPES.some((t) => t.id === def.type) ? def.type : 'text'
  return {
    id: String(def.id || uid()),
    name: String(def.name ?? def.label ?? '').trim(),
    type,
    options: type === 'select'
      ? (Array.isArray(def.options) ? def.options.map((o) => String(o).trim()).filter(Boolean) : [])
      : [],
    required: !!def.required,
    showOnPrint: !!def.showOnPrint,
    sort: Number.isFinite(Number(def.sort)) ? Number(def.sort) : index,
  }
}

/** All definitions for one entity, cleaned and in display order. */
export function fieldsFor(settings, entityId) {
  const raw = settings?.customFields?.[entityId]
  if (!Array.isArray(raw)) return []
  return raw
    .map((d, i) => normaliseField(d, i))
    .filter((d) => d && d.name)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
}

/** Only the fields that should appear on the printed document. */
export function printableFields(settings, entityId) {
  if (!isPrintable(entityId)) return []
  return fieldsFor(settings, entityId).filter((f) => f.showOnPrint)
}

/**
 * Coerce a raw input value into what the type promises.
 *
 * A number stays a number so it sorts and totals; a checkbox stays a boolean
 * so `false` is distinguishable from unanswered; a blank stays `''` rather
 * than becoming `0` or `false`, because "not filled in" is real information.
 */
export function coerceValue(def, raw) {
  const type = def?.type || 'text'
  if (type === 'checkbox') return raw === true || raw === 'true'
  if (raw == null || raw === '') return ''
  if (type === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : ''
  }
  if (type === 'date') {
    const s = String(raw).slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
  }
  if (type === 'select') {
    const s = String(raw)
    return (def.options || []).includes(s) ? s : ''
  }
  return String(raw)
}

/** Clean a whole `custom` bag against the current definitions. */
export function coerceValues(defs = [], values = {}) {
  const out = {}
  defs.forEach((d) => {
    const v = coerceValue(d, values?.[d.id])
    if (v !== '' && v !== false) out[d.id] = v
    else if (d.type === 'checkbox' && v === false && values?.[d.id] != null) out[d.id] = false
  })
  return out
}

const isBlank = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))

/** Required fields must be answered. A checkbox counts as answered either way. */
export function validateValues(defs = [], values = {}) {
  const errors = []
  defs.forEach((d) => {
    if (!d.required) return
    if (d.type === 'checkbox') return
    if (isBlank(values?.[d.id])) errors.push(`${d.name} is required.`)
  })
  return errors.length ? { ok: false, errors } : { ok: true }
}

/** Check a definition before it is saved. */
export function validateField(def, existing = [], { id = null } = {}) {
  const errors = []
  const name = String(def?.name || '').trim()
  if (!name) errors.push('Give the field a name.')
  if (name.length > 60) errors.push('The name is too long — keep it under 60 characters.')
  const clash = existing.some((f) => f.id !== id && String(f.name || '').trim().toLowerCase() === name.toLowerCase())
  if (name && clash) errors.push('Another field on this form already has that name.')
  if (!CF_TYPES.some((t) => t.id === def?.type)) errors.push('Pick a field type.')
  if (def?.type === 'select') {
    const opts = (def.options || []).map((o) => String(o).trim()).filter(Boolean)
    if (opts.length < 2) errors.push('A dropdown needs at least two choices.')
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) errors.push('The dropdown has the same choice twice.')
  }
  return errors.length ? { ok: false, errors } : { ok: true }
}

/** Human-readable value, for tables, printed documents and exports. */
export function displayValue(def, value, { fmtDate = null } = {}) {
  const type = def?.type || 'text'
  if (type === 'checkbox') return value ? 'Yes' : 'No'
  if (isBlank(value)) return ''
  if (type === 'date') return fmtDate ? fmtDate(value) : String(value)
  if (type === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? String(n) : ''
  }
  return String(value)
}

/** `[{ field, value, text }]` for every field that has something to show. */
export function filledValues(defs = [], values = {}, opts = {}) {
  return defs
    .map((f) => ({ field: f, value: values?.[f.id], text: displayValue(f, values?.[f.id], opts) }))
    .filter((r) => r.text !== '')
}

/**
 * Move the old shape forward without losing a single value.
 *
 * The old settings held `{ customer: ['Contract #'], supplier: [] }` — plain
 * labels — and records held `customFields: { 'Contract #': 'ABC-1' }`, keyed
 * by the same label. Both halves have to move together: the label becomes a
 * generated id, and every record's bag is rekeyed to match. A value whose
 * label no longer has a definition is kept under its original key rather than
 * dropped, so nothing a user typed disappears in an upgrade.
 *
 * @returns { customFields, rekey } — `rekey(entityId, bag)` converts a record.
 */
export function migrateLegacy(customFields) {
  const src = customFields && typeof customFields === 'object' ? customFields : {}
  const out = {}
  const maps = {}

  CF_ENTITIES.forEach(({ id }) => {
    const raw = Array.isArray(src[id]) ? src[id] : []
    const map = {}
    out[id] = raw.map((d, i) => {
      const def = normaliseField(d, i * 10)
      if (typeof d === 'string') map[d] = def.id
      return def
    }).filter((d) => d.name)
    maps[id] = map
  })

  const rekey = (entityId, bag) => {
    if (!bag || typeof bag !== 'object') return {}
    const map = maps[entityId] || {}
    const res = {}
    Object.entries(bag).forEach(([k, v]) => { res[map[k] || k] = v })
    return res
  }

  return { customFields: out, rekey }
}

/**
 * Export columns for the CSV / Excel / PDF menu.
 *
 * The key is namespaced so a field called "Name" cannot collide with the
 * built-in Name column, and the value is read through `map` because the real
 * value lives one level down in the record's `customFields` bag.
 */
export function exportColumns(defs = [], opts = {}) {
  return defs.map((f) => ({
    key: `custom.${f.id}`,
    label: f.name,
    right: f.type === 'number',
    map: (_, row) => displayValue(f, row?.customFields?.[f.id], opts),
  }))
}
