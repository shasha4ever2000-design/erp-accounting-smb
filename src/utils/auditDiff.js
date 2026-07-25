// Field-level change tracking for the audit trail.
//
// "Invoice updated" tells an auditor nothing. "unitPrice 250 → 400, dueDate
// 2026-07-01 → 2026-09-01" tells them everything. This diffs a record before
// and after an edit into a compact, human-readable change list.
//
// Two hard constraints, because the trail is append-only and lives in the same
// browser storage as the books:
//   * never let a huge value (a base64 logo, an attachment blob) into the log —
//     one edit could otherwise add hundreds of KB;
//   * never log noisy machine fields nobody audits (ids, timestamps).

const MAX_VALUE_CHARS = 120

// Fields that change on every save and carry no audit meaning.
const IGNORED = new Set(['id', 'createdAt', 'updatedAt', 'lastModified', 'journalEntryId', '_rev'])

// Fields whose contents are large or binary — record that they changed, never what to.
const OPAQUE = /^(logo|image|thumbnail|data|base64|attachment|file|signature|qr)/i

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Render a value compactly for the log, never exceeding MAX_VALUE_CHARS. */
export function summarise(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `${value.length} item(s)`
  if (isPlainObject(value)) return '{…}'
  const s = String(value)
  // A data URL or anything oversized is summarised by size, not content.
  if (s.startsWith('data:') || s.length > MAX_VALUE_CHARS) return `(${s.length} chars)`
  return s
}

/**
 * Diff two versions of a record.
 * @returns [{ field, from, to }] — only fields that actually changed.
 */
export function diffRecord(before, after, opts = {}) {
  const { ignore = [] } = opts
  const skip = new Set([...IGNORED, ...ignore])
  const a = before || {}
  const b = after || {}
  const fields = new Set([...Object.keys(a), ...Object.keys(b)])
  const changes = []

  fields.forEach((field) => {
    if (skip.has(field)) return
    const av = a[field]
    const bv = b[field]
    // Treat null / undefined / '' as the same "empty". Edit forms routinely
    // coerce a missing field to '' on load, which would otherwise log a
    // meaningless "— → —" change on every save.
    const empty = (v) => v === null || v === undefined || v === ''
    if (empty(av) && empty(bv)) return
    // Deep-compare via JSON: values here are plain data, and this catches
    // nested edits (line items) that === would miss.
    if (JSON.stringify(av) === JSON.stringify(bv)) return
    if (OPAQUE.test(field)) {
      changes.push({ field, from: '(changed)', to: '(changed)', opaque: true })
      return
    }
    changes.push({ field, from: summarise(av), to: summarise(bv) })
  })

  return changes
}

/** One-line human summary of a change list, for compact display. */
export function describeChanges(changes, max = 3) {
  if (!changes || changes.length === 0) return 'No field changes'
  const shown = changes.slice(0, max).map((c) => `${c.field}: ${c.from} → ${c.to}`)
  const rest = changes.length - shown.length
  return shown.join(' · ') + (rest > 0 ? ` · +${rest} more` : '')
}

/** Severity drives colour/filtering in the UI. */
export function severityFor(action) {
  const a = String(action || '').toLowerCase()
  if (/delete|void|reset|erase|remove|unlock|reopen/.test(a)) return 'critical'
  if (/update|edit|change|approve|reject|lock|close|settle|restore/.test(a)) return 'notable'
  return 'routine'
}
