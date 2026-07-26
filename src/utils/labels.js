// Printable asset and inventory labels.
//
// The point of an asset tag is the annual count. Someone walks the building
// with a phone, scans the sticker on each machine, and the system says which
// asset that is, what it cost and where it is meant to be. Without tags that
// walk is done from a printed list and a lot of guessing, which is why fixed
// asset registers drift away from reality within a year or two.
//
// So a label carries three things: something a scanner can read, something a
// human can read when the scan fails, and enough context to be useful when the
// sticker is found on a shelf with no system to hand.
//
// What goes in the code is deliberately the record's own id, not its name or
// its number. Names get edited and numbers get re-sequenced; the id is the one
// thing that will still resolve in five years. It is prefixed so a scanner app
// can tell an asset tag from a stock label without guessing.

/** Physical label presets, in millimetres, with how many fit an A4 sheet. */
export const LABEL_PRESETS = {
  small:  { id: 'small',  label: 'Small',  width: 38, height: 21, cols: 5, rows: 13, note: 'Cable and tool tags' },
  medium: { id: 'medium', label: 'Medium', width: 63, height: 38, cols: 3, rows: 7,  note: 'Most equipment' },
  large:  { id: 'large',  label: 'Large',  width: 99, height: 57, cols: 2, rows: 5,  note: 'Machines and vehicles' },
}

export const KINDS = {
  fixedAssets: { id: 'fixedAssets', label: 'Fixed assets', prefix: 'FA', slice: 'fixedAssets' },
  inventoryItems: { id: 'inventoryItems', label: 'Inventory items', prefix: 'IT', slice: 'inventoryItems' },
}

export function presetFor(id) {
  return LABEL_PRESETS[id] || LABEL_PRESETS.medium
}

export function perPage(presetId) {
  const p = presetFor(presetId)
  return p.cols * p.rows
}

/**
 * The string encoded in the scannable code.
 *
 * `ERP:FA:<id>` rather than a bare id, so a scanner can tell what it is
 * looking at, and so a stray number typed into a search box cannot be mistaken
 * for an asset tag.
 */
export function labelPayload(kind, record) {
  const prefix = KINDS[kind]?.prefix || 'XX'
  return `ERP:${prefix}:${record?.id || ''}`
}

/** Read a scanned payload back. Returns null for anything that is not ours. */
export function parsePayload(text) {
  const m = /^ERP:(FA|IT):(.+)$/.exec(String(text || '').trim())
  if (!m) return null
  const kind = m[1] === 'FA' ? 'fixedAssets' : 'inventoryItems'
  return { kind, id: m[2] }
}

const clean = (v) => String(v == null ? '' : v).trim()

/**
 * Turn a record into the lines printed on its label.
 *
 * Fields differ by kind because what identifies a lathe is not what identifies
 * a box of bearings: an asset wants its own tag number and where it lives, an
 * item wants its stock code and unit.
 */
export function buildLabel(kind, record, { company = '', fmtMoney = null } = {}) {
  if (!record) return null
  const isAsset = kind === 'fixedAssets'
  const code = isAsset
    ? clean(record.number) || clean(record.code) || clean(record.id).slice(0, 8)
    : clean(record.code) || clean(record.barcode) || clean(record.id).slice(0, 8)

  const detail = []
  if (isAsset) {
    if (clean(record.location)) detail.push(clean(record.location))
    if (clean(record.serialNumber)) detail.push(`S/N ${clean(record.serialNumber)}`)
    if (record.purchaseDate) detail.push(clean(record.purchaseDate))
    if (fmtMoney && Number(record.cost)) detail.push(fmtMoney(Number(record.cost)))
  } else {
    if (clean(record.category)) detail.push(clean(record.category))
    if (clean(record.unit)) detail.push(clean(record.unit))
    if (clean(record.barcode) && clean(record.barcode) !== code) detail.push(clean(record.barcode))
  }

  return {
    id: record.id,
    kind,
    code,
    title: clean(record.name) || clean(record.description) || code,
    detail,
    company: clean(company),
    payload: labelPayload(kind, record),
  }
}

export function buildLabels(kind, records = [], opts = {}) {
  return records.map((r) => buildLabel(kind, r, opts)).filter(Boolean)
}

/**
 * Repeat each label by its copy count, then chunk into printable pages.
 *
 * Copies matter in practice: a machine usually wants one tag, but a rack of
 * forty identical tools wants forty, and reprinting a single damaged sticker
 * should not mean printing a whole sheet.
 */
export function expandCopies(labels = [], copies = {}) {
  const out = []
  labels.forEach((l) => {
    const n = Math.max(0, Math.floor(Number(copies[l.id] ?? 1) || 0))
    for (let k = 0; k < n; k++) out.push({ ...l, copy: k + 1, key: `${l.id}:${k}` })
  })
  return out
}

export function paginate(labels = [], presetId = 'medium') {
  const size = perPage(presetId)
  const pages = []
  for (let k = 0; k < labels.length; k += size) pages.push(labels.slice(k, k + size))
  return pages
}

/**
 * A blank offset lets someone reuse a part-used sheet: skip the labels already
 * peeled off rather than wasting the rest of the sheet.
 */
export function withOffset(labels = [], offset = 0, presetId = 'medium') {
  const n = Math.min(Math.max(0, Math.floor(Number(offset) || 0)), perPage(presetId) - 1)
  const blanks = Array.from({ length: n }, (_, i) => ({ blank: true, key: `blank:${i}` }))
  return [...blanks, ...labels]
}

/** Everything the print view needs, in one call. */
export function buildSheet(kind, records, { copies = {}, presetId = 'medium', offset = 0, company = '', fmtMoney = null } = {}) {
  const labels = buildLabels(kind, records, { company, fmtMoney })
  const expanded = expandCopies(labels, copies)
  const withBlanks = withOffset(expanded, offset, presetId)
  return {
    preset: presetFor(presetId),
    pages: paginate(withBlanks, presetId),
    total: expanded.length,
  }
}
