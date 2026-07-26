// Recycle bin — undo an accidental delete.
//
// The boundary here is deliberate and worth stating, because it is the whole
// design: the bin covers records whose deletion is *pure data loss*, and
// refuses the ones whose deletion moved the ledger.
//
// An invoice, a journal entry or a bill is never really deleted in a correct
// accounting system — it is VOIDED, with a reversing entry, because the ledger
// is immutable and an auditor must be able to see that the document existed
// and was cancelled. Putting those in a recycle bin would be actively wrong:
// restoring one whose entries had already been reversed would post the
// transaction twice. Those documents keep their existing void path.
//
// What the bin protects is everything else — a customer deleted by mistake, a
// supplier, an item, a price list, a recurring template. Losing those is
// annoying and irreversible today; nothing about restoring them touches a
// balance.

/**
 * Entities the bin covers, mapped to the store slice they live in.
 * `label` pulls a human name out of the record for the list.
 */
export const RECYCLABLE = {
  customers:         { slice: 'customers',         label: 'Customer',           name: (r) => r.name },
  suppliers:         { slice: 'suppliers',         label: 'Supplier',           name: (r) => r.name },
  inventoryItems:    { slice: 'inventoryItems',    label: 'Inventory item',     name: (r) => [r.code, r.name].filter(Boolean).join(' — ') },
  accounts:          { slice: 'accounts',          label: 'Account',            name: (r) => [r.code, r.name].filter(Boolean).join(' — ') },
  departments:       { slice: 'departments',       label: 'Department',         name: (r) => r.name },
  employees:         { slice: 'employees',         label: 'Employee',           name: (r) => r.name },
  warehouses:        { slice: 'warehouses',        label: 'Warehouse',          name: (r) => r.name },
  leads:             { slice: 'leads',             label: 'Lead',               name: (r) => r.company || r.name },
  projects:          { slice: 'projects',          label: 'Project',            name: (r) => r.name },
  currencies:        { slice: 'currencies',        label: 'Currency',           name: (r) => `${r.code} — ${r.name}` },
  matchRules:        { slice: 'matchRules',        label: 'Bank rule',          name: (r) => r.contains || r.name },
  budgets:           { slice: 'budgets',           label: 'Budget',             name: (r) => r.name },
  billsOfMaterials:  { slice: 'billsOfMaterials',  label: 'Bill of materials',  name: (r) => r.name || r.productName },
  recurringInvoices: { slice: 'recurringInvoices', label: 'Recurring invoice',  name: (r) => r.customerName || r.name },
  recurringJournals: { slice: 'recurringJournals', label: 'Recurring journal',  name: (r) => r.description },
  recurringExpenses: { slice: 'recurringExpenses', label: 'Recurring expense',  name: (r) => r.supplierName || r.description },
  quotations:        { slice: 'quotations',        label: 'Quotation',          name: (r) => `${r.number || ''} ${r.customerName || ''}`.trim() },
  purchaseOrders:    { slice: 'purchaseOrders',    label: 'Purchase order',     name: (r) => `${r.number || ''} ${r.supplierName || ''}`.trim() },
  requisitions:      { slice: 'requisitions',      label: 'Requisition',        name: (r) => r.number || r.description },
  deliveryNotes:     { slice: 'deliveryNotes',     label: 'Delivery note',      name: (r) => `${r.number || ''} ${r.customerName || ''}`.trim() },
  timeEntries:       { slice: 'timeEntries',       label: 'Time entry',         name: (r) => r.description || r.projectName },
  scheduledTransfers:{ slice: 'scheduledTransfers',label: 'Scheduled transfer', name: (r) => r.description || r.name },
  capitalAccounts:   { slice: 'capitalAccounts',   label: 'Capital account',    name: (r) => r.name },
  salesOrders:       { slice: 'salesOrders',       label: 'Sales order',        name: (r) => `${r.number || ''} ${r.customerName || ''}`.trim() },
  purchaseQuotes:    { slice: 'purchaseQuotes',    label: 'Purchase quote',     name: (r) => `${r.number || ''} ${r.supplierName || ''}`.trim() },
  stockCounts:       { slice: 'stockCounts',       label: 'Stock count',        name: (r) => `${r.number || ''}`.trim() },
}

/**
 * Documents that post to the ledger. Deleting these is not undo-able by
 * putting the row back — they are voided with a reversing entry instead.
 */
export const VOID_INSTEAD = new Set([
  'invoices', 'purchases', 'journalEntries', 'creditNotes', 'debitNotes',
  'payrollRuns', 'fixedAssets', 'stockAdjustments', 'prepaidExpenses',
  'leases', 'expenseClaims', 'workOrders', 'bankTransactions',
  'bankTransfers', 'stockTransfers', 'bankAccounts',
])

export function isRecyclable(entity) {
  return Object.prototype.hasOwnProperty.call(RECYCLABLE, entity)
}

/** Human label for a binned row. */
export function describe(item) {
  if (!item) return ''
  const cfg = RECYCLABLE[item.entity]
  if (!cfg) return item.entity || ''
  try {
    return String(cfg.name(item.record || {}) || '').trim() || `(${cfg.label})`
  } catch {
    return `(${cfg.label})`
  }
}

export function entityLabel(entity) {
  return RECYCLABLE[entity]?.label || entity
}

/**
 * Build the bin entry. Kept pure so the shape is testable without a store.
 */
export function makeEntry(entity, record, { user, now } = {}) {
  return {
    id: `${entity}:${record?.id}:${now || new Date().toISOString()}`,
    entity,
    recordId: record?.id,
    record,
    deletedAt: now || new Date().toISOString(),
    deletedBy: user?.id || '',
    deletedByName: user?.name || 'Unknown',
  }
}

/**
 * Can this entry go back?
 *
 * The one blocking case is an id that already exists in the slice — a record
 * deleted, re-created by hand under the same id, and then restored would
 * otherwise appear twice.
 *
 * @returns { ok } | { ok: false, reason }
 */
export function canRestore(entry, currentSlice = []) {
  if (!entry) return { ok: false, reason: 'Nothing to restore' }
  if (!isRecyclable(entry.entity)) return { ok: false, reason: 'This type cannot be restored' }
  if (currentSlice.some((r) => r.id === entry.recordId))
    return { ok: false, reason: 'A record with this id already exists' }
  return { ok: true }
}

const DAY = 86400000

/** Days a row has been in the bin. */
export function ageInDays(entry, now = Date.now()) {
  const t = Date.parse(entry?.deletedAt || '')
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((now - t) / DAY))
}

/**
 * Entries older than the retention window. Returned rather than deleted, so
 * the caller decides — an automatic purge that surprises someone is worse
 * than a bin that grew.
 */
export function expiredEntries(entries = [], retentionDays = 90, now = Date.now()) {
  if (!retentionDays) return []
  return entries.filter((e) => ageInDays(e, now) >= retentionDays)
}

/** Counts per entity, for the filter chips. */
export function countByEntity(entries = []) {
  const out = {}
  entries.forEach((e) => { out[e.entity] = (out[e.entity] || 0) + 1 })
  return out
}
