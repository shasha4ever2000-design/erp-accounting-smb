// Custom control accounts.
//
// Out of the box every customer posts to one "Accounts Receivable" account.
// That is right for most companies and wrong for plenty: a business selling
// both locally and for export usually has to show those receivables separately
// on the balance sheet, because they are collected differently, aged
// differently, and often reported to a regulator differently. The same is true
// of payables — trade suppliers and intercompany balances do not belong on one
// line — and of inventory held in different forms.
//
// So: any account can be nominated as a control account for customers,
// suppliers or inventory items, and each record can be pointed at one. The
// balance sheet then shows one line per control account, each with its own
// subledger underneath it.
//
// The rule that keeps this safe is resolution, not storage. Nothing posts to
// `record.controlAccountId` directly. Everything goes through `resolveControl`,
// which hands back the default whenever the stored account has been deleted, is
// no longer a control account, or was never a control account for this kind of
// record. Posting a receivable into whatever account an id happens to point at
// is how a balance sheet ends up with sales sitting in an expense account.

export const CONTROL_KINDS = {
  customers: {
    default: 'acc-ar',
    label: 'Receivables',
    noun: 'customer',
    slice: 'customers',
    accountType: 'asset',
  },
  suppliers: {
    default: 'acc-ap',
    label: 'Payables',
    noun: 'supplier',
    slice: 'suppliers',
    accountType: 'liability',
  },
  inventoryItems: {
    default: 'acc-inv',
    label: 'Inventory',
    noun: 'item',
    slice: 'inventoryItems',
    accountType: 'asset',
    // Items carried their own account long before control accounts existed.
    field: 'inventoryAccountId',
  },
}

export const KIND_LIST = Object.keys(CONTROL_KINDS)

/** Which field on the record holds the pointer. */
export function fieldFor(kind) {
  return CONTROL_KINDS[kind]?.field || 'controlAccountId'
}

export function defaultFor(kind) {
  return CONTROL_KINDS[kind]?.default || ''
}

/** True when this account may hold balances for this kind of record. */
export function isControlAccount(account, kind) {
  if (!account) return false
  if (account.id === defaultFor(kind)) return true
  return account.controlFor === kind
}

/**
 * Every account usable as a control account for `kind`, default listed first
 * so a picker opens on the answer most people want.
 */
export function controlAccountsFor(accounts = [], kind) {
  const def = defaultFor(kind)
  const rows = accounts.filter((a) => isControlAccount(a, kind))
  return rows.sort((a, b) => {
    if (a.id === def) return -1
    if (b.id === def) return 1
    return String(a.code || '').localeCompare(String(b.code || ''))
  })
}

/**
 * The account a record's balances actually post to.
 *
 * Falls back to the default whenever the stored pointer cannot be trusted, so
 * a deleted or re-purposed account can never redirect a receivable somewhere
 * meaningless.
 */
export function resolveControl(record, kind, accounts = []) {
  const def = defaultFor(kind)
  const id = record?.[fieldFor(kind)]
  if (!id || id === def) return def
  const account = accounts.find((a) => a.id === id)
  if (!account) return def
  if (!isControlAccount(account, kind)) return def
  if (account.type !== CONTROL_KINDS[kind].accountType) return def
  return account.id
}

/** True when the stored pointer was ignored — the UI should say so. */
export function isStale(record, kind, accounts = []) {
  const id = record?.[fieldFor(kind)]
  if (!id) return false
  return resolveControl(record, kind, accounts) !== id
}

/**
 * Check an account before it is nominated as a control account.
 *
 * The type has to match — receivables are assets, payables are liabilities —
 * because the balance sheet decides which side of the statement a line lands
 * on by account type alone.
 */
export function validateControlAccount(account, kind) {
  const errors = []
  const cfg = CONTROL_KINDS[kind]
  if (!cfg) return { ok: false, errors: ['That is not a kind of control account.'] }
  if (!account) return { ok: false, errors: ['Choose an account.'] }
  if (account.type !== cfg.accountType)
    errors.push(`A ${cfg.label.toLowerCase()} control account must be ${cfg.accountType === 'asset' ? 'an asset' : 'a liability'}.`)
  if (account.controlFor && account.controlFor !== kind)
    errors.push('That account is already a control account for something else.')
  return errors.length ? { ok: false, errors } : { ok: true }
}

/** How many records point at this control account. */
export function usageOf(records = [], kind, accountId, accounts = []) {
  return records.filter((r) => resolveControl(r, kind, accounts) === accountId).length
}

/**
 * One row per control account in use, for the balance sheet breakdown and the
 * settings screen.
 */
export function breakdown(accounts = [], records = [], kind) {
  return controlAccountsFor(accounts, kind).map((a) => ({
    id: a.id,
    code: a.code || '',
    name: a.name,
    isDefault: a.id === defaultFor(kind),
    count: usageOf(records, kind, a.id, accounts),
  }))
}

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100

/**
 * Journal lines that move an outstanding balance from one control account to
 * another.
 *
 * Moving a customer between control accounts while they still owe money would
 * otherwise leave the debt sitting in the old account for ever while their new
 * receipts credit the new one — both accounts wrong, and the customer's own
 * statement continuous across a gap that does not reconcile to either. So the
 * move posts a reclassification instead of editing history.
 */
export function reclassLines(kind, { fromAccountId, toAccountId, amount, name = '' }) {
  const value = round2(amount)
  if (!fromAccountId || !toAccountId) throw new Error('CONTROL_ACCOUNTS_REQUIRED')
  if (fromAccountId === toAccountId) throw new Error('CONTROL_ACCOUNTS_SAME')
  if (value === 0) return []

  const text = `Reclassified ${CONTROL_KINDS[kind]?.noun || 'balance'}${name ? ` — ${name}` : ''}`
  // A receivable sits as a debit, a payable as a credit; moving either means
  // reversing it where it was and re-raising it where it now belongs.
  const positiveIsDebit = CONTROL_KINDS[kind]?.accountType === 'asset'
  const magnitude = Math.abs(value)
  const toDebit = positiveIsDebit ? value > 0 : value < 0

  return [
    {
      accountId: toAccountId,
      debit: toDebit ? magnitude : 0,
      credit: toDebit ? 0 : magnitude,
      description: text,
    },
    {
      accountId: fromAccountId,
      debit: toDebit ? 0 : magnitude,
      credit: toDebit ? magnitude : 0,
      description: text,
    },
  ]
}
