// Company settings, the period lock and year-end close.
// One slice of the store — see src/store.js for how the slices combine.
import { ETA_DEFAULT_TAX_SUBTYPES } from '../utils/etaEinvoice'
import { WAC } from '../utils/fifo'
import { defaultApprovalSettings } from '../utils/approvals'
import { newField as newCustomField, normaliseField as normaliseCustomField, fieldsFor as customFieldsFor, coerceValues as coerceCustomValues, validateField as validateCustomField } from '../utils/customFields'
import { DEFAULT_SETTINGS } from './shared'

export const createSettingsSlice = (set, get) => ({
  // ─── SETTINGS ──────────────────────────────────────────────────
  settings: DEFAULT_SETTINGS,

  updateSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ...patch } })),

  updateCompany: (patch) =>
    set((s) => ({ settings: { ...s.settings, company: { ...s.settings.company, ...patch } } })),

  /** 'wac' or 'fifo' — how an issue of stock is costed. */
  costingMethod: () => get().settings?.inventory?.costingMethod || WAC,

  updateInventorySettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, inventory: { ...(s.settings.inventory || { costingMethod: WAC }), ...patch } } })),

  updateTax: (patch) =>
    set((s) => ({ settings: { ...s.settings, tax: { ...s.settings.tax, ...patch } } })),

  updateInvoiceSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, invoice: { ...s.settings.invoice, ...patch } } })),

  updateAiSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ai: { ...(s.settings.ai || {}), ...patch } } })),

  updateZatca: (patch) =>
    set((s) => ({ settings: { ...s.settings, zatca: { ...(s.settings.zatca || {}), ...patch } } })),

  // The nested address and tax-code maps are merged a level deeper, so
  // setting one field of an address does not wipe the rest of it.
  /** 'done' or 'skipped' — either way, stop asking. */
  markSetupDone: (state = 'done') =>
    set((s) => ({ settings: { ...s.settings, setup: { state, at: new Date().toISOString() } } })),

  /** Let Settings offer the wizard again once it has been dismissed. */
  reopenSetup: () =>
    set((s) => ({ settings: { ...s.settings, setup: { state: 'pending', at: '' } } })),

  updateEta: (patch) =>
    set((s) => {
      const cur = s.settings.eta || {}
      return { settings: { ...s.settings, eta: {
        ...cur, ...patch,
        address: { ...(cur.address || {}), ...(patch.address || {}) },
        taxSubTypes: { ...ETA_DEFAULT_TAX_SUBTYPES, ...(cur.taxSubTypes || {}), ...(patch.taxSubTypes || {}) },
      } } }
    }),

  updateCustomFields: (patch) =>
    set((s) => ({ settings: { ...s.settings, customFields: { ...(s.settings.customFields || {}), ...patch } } })),

  // Custom field definitions, one list per form.
  //
  // Deliberately no "delete all values" step on removal: the definition
  // goes, the values stay in the records. If the field was removed by
  // mistake — and it will be — recreating it is a rename away from
  // restoring the data, whereas a cascading delete is unrecoverable in a
  // local-first app with no server-side backup.
  customFieldsFor: (entityId) => customFieldsFor(get().settings, entityId),

  addCustomField: (entityId, patch) => {
    const list = customFieldsFor(get().settings, entityId)
    const check = validateCustomField(patch, list)
    if (!check.ok) throw new Error(`CUSTOM_FIELD_INVALID: ${check.errors.join(' ')}`)
    const field = normaliseCustomField({ ...newCustomField(), ...patch, sort: (list.length + 1) * 10 })
    set((s) => ({ settings: { ...s.settings, customFields: {
      ...(s.settings.customFields || {}),
      [entityId]: [...(s.settings.customFields?.[entityId] || []), field],
    } } }))
    get().logActivity('Added custom field', `${field.name} · ${entityId}`)
    return field
  },

  updateCustomField: (entityId, id, patch) => {
    const list = customFieldsFor(get().settings, entityId)
    const current = list.find((f) => f.id === id)
    if (!current) return null
    const merged = { ...current, ...patch, id }
    const check = validateCustomField(merged, list, { id })
    if (!check.ok) throw new Error(`CUSTOM_FIELD_INVALID: ${check.errors.join(' ')}`)
    const field = normaliseCustomField(merged)
    set((s) => ({ settings: { ...s.settings, customFields: {
      ...(s.settings.customFields || {}),
      [entityId]: (s.settings.customFields?.[entityId] || []).map((f) => (f.id === id ? field : f)),
    } } }))
    return field
  },

  deleteCustomField: (entityId, id) => {
    set((s) => ({ settings: { ...s.settings, customFields: {
      ...(s.settings.customFields || {}),
      [entityId]: (s.settings.customFields?.[entityId] || []).filter((f) => f.id !== id),
    } } }))
    get().logActivity('Removed custom field', entityId)
  },

  moveCustomField: (entityId, id, delta) => {
    const list = customFieldsFor(get().settings, entityId)
    const at = list.findIndex((f) => f.id === id)
    const to = at + (delta < 0 ? -1 : 1)
    if (at < 0 || to < 0 || to >= list.length) return
    const next = [...list]
    next.splice(to, 0, next.splice(at, 1)[0])
    set((s) => ({ settings: { ...s.settings, customFields: {
      ...(s.settings.customFields || {}),
      [entityId]: next.map((f, i) => ({ ...f, sort: (i + 1) * 10 })),
    } } }))
  },

  /** Clean a form's custom-field bag against the current definitions. */
  cleanCustomValues: (entityId, values) =>
    coerceCustomValues(customFieldsFor(get().settings, entityId), values),

  updateWht: (patch) =>
    set((s) => ({ settings: { ...s.settings, wht: { ...(s.settings.wht || { enabled: false, rate: 5, name: 'Withholding Tax' }), ...patch } } })),

  updateApprovals: (patch) =>
    set((s) => ({ settings: { ...s.settings, approvals: {
      ...defaultApprovalSettings(), ...(s.settings.approvals || {}), ...patch,
      thresholds: { ...defaultApprovalSettings().thresholds, ...(s.settings.approvals?.thresholds || {}), ...(patch.thresholds || {}) },
    } } })),

  // ─── PERIOD CLOSE / POSTING-DATE LOCK ──────────────────────────
  // A locked period bars any journal posting dated on or before lockDate,
  // preserving the integrity of already-reported/closed periods.
  setPeriodLock: ({ lockDate, lockedBy }) =>
    set((s) => ({ settings: { ...s.settings, accounting: {
      ...(s.settings.accounting || {}), lockDate: lockDate || '',
      lockedBy: lockDate ? (lockedBy || '') : '', lockedAt: lockDate ? new Date().toISOString() : '',
    } } })),

  // ─── YEAR-END CLOSE ────────────────────────────────────────────
  // Record a fiscal year as closed and lock the books through its end.
  // No closing journal is posted: retained earnings is computed on the
  // balance sheet, so profit rolls forward automatically.
  closeFiscalYear: ({ label, start, end, netIncome, by }) =>
    set((s) => {
      const acc = s.settings.accounting || {}
      const closedYears = (acc.closedYears || []).filter((c) => c.label !== label)
      closedYears.push({ label, start, end, netIncome, closedAt: new Date().toISOString(), by: by || '' })
      closedYears.sort((a, b) => a.end.localeCompare(b.end))
      const lockDate = !acc.lockDate || acc.lockDate < end ? end : acc.lockDate
      return { settings: { ...s.settings, accounting: {
        ...acc, closedYears, lockDate, lockedBy: by || acc.lockedBy || '', lockedAt: new Date().toISOString(),
      } } }
    }),

  reopenFiscalYear: (label) =>
    set((s) => {
      const acc = s.settings.accounting || {}
      const target = (acc.closedYears || []).find((c) => c.label === label)
      const closedYears = (acc.closedYears || []).filter((c) => c.label !== label)
      // If the lock sat exactly at this year's end, fall back to the latest
      // remaining closed year (or clear it).
      let lockDate = acc.lockDate
      if (target && acc.lockDate === target.end) {
        lockDate = closedYears.length ? closedYears[closedYears.length - 1].end : ''
      }
      return { settings: { ...s.settings, accounting: { ...acc, closedYears, lockDate } } }
    }),

  // Toggle the boot-time auto-posting of due recurring invoices/journals.
  setAutoPostRecurring: (enabled) =>
    set((s) => ({ settings: { ...s.settings, accounting: {
      ...(s.settings.accounting || {}), autoPostRecurring: !!enabled,
    } } })),

  // true when `date` (YYYY-MM-DD) falls in a closed period
  isDateLocked: (date) => {
    const lock = get().settings?.accounting?.lockDate
    return !!(lock && date && String(date) <= String(lock))
  },

  // ─── THEME ─────────────────────────────────────────────────────
  setTheme: (theme) =>
    set((s) => ({ settings: { ...s.settings, theme } })),

  // 'comfortable' (default) or 'compact' — tighter tables for people who
  // live in long lists. Applied as a class on <html> by App.
  setDensity: (density) =>
    set((s) => ({ settings: { ...s.settings, density: density === 'compact' ? 'compact' : 'comfortable' } })),
})
