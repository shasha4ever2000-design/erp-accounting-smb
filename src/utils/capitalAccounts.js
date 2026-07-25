// Capital accounts — a subledger for the owners of the business.
//
// A sole trader needs one equity account and nothing more. The moment there are
// two partners, "Owner's Capital" stops being useful: each partner puts money
// in, draws money out, and takes a share of profit, and every one of those has
// to be attributable to a named person. Handing them a single lump figure is
// how partnerships end up in arguments their books cannot settle.
//
// The shape mirrors receivables, because it is the same problem. One control
// account sits in equity and carries the total; the detail lives per partner,
// split across subaccounts (funds contributed, drawings, share of profit). The
// balance sheet shows the control total, and the capital accounts report shows
// who it belongs to.
//
// The invariant that matters: the sum of the subledger must equal the control
// account balance, always. A journal line that hits the control account
// without naming a partner would break it silently — the balance sheet would
// still balance while the partner report quietly disagreed with it. The store
// refuses such a line outright, and `reconcile` below re-checks the whole
// ledger so pre-existing data cannot hide a break either.

/** The single equity account every capital account posts through. */
export const CAPITAL_CONTROL = 'acc-capital-ctl'

/**
 * Movements are split by kind, not lumped together, because "what did this
 * partner put in" and "what has this partner taken out" are different
 * questions and a net figure answers neither.
 */
export const DEFAULT_SUBACCOUNTS = [
  { id: 'cap-sub-funds',  name: 'Funds contributed', sort: 10, isSystem: true },
  { id: 'cap-sub-draw',   name: 'Drawings',          sort: 20, isSystem: true },
  { id: 'cap-sub-profit', name: 'Share of profit',   sort: 30, isSystem: true },
]

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const num = (v) => Number(v) || 0

/**
 * Every ledger line that touches the capital control account, flattened with
 * its entry's date and reference so the caller can filter and display.
 */
export function capitalLines(journalEntries = [], { start, end } = {}) {
  const out = []
  journalEntries.forEach((je) => {
    if (!je || je.void) return
    const date = String(je.date || '')
    if (start && date < String(start)) return
    if (end && date > String(end)) return
    ;(je.lines || []).forEach((l, i) => {
      if (l?.accountId !== CAPITAL_CONTROL) return
      out.push({
        key: `${je.id}:${i}`,
        entryId: je.id,
        number: je.number || '',
        date,
        description: l.description || je.description || '',
        capitalAccountId: l.capitalAccountId || '',
        subaccountId: l.subaccountId || '',
        debit: num(l.debit),
        credit: num(l.credit),
        // Equity is credit-positive: money the business owes its owners.
        amount: round2(num(l.credit) - num(l.debit)),
      })
    })
  })
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
}

/** Net balance for one partner, optionally within one subaccount. */
export function balanceFor(lines = [], capitalAccountId, subaccountId = null) {
  return round2(lines.reduce((s, l) => {
    if (l.capitalAccountId !== capitalAccountId) return s
    if (subaccountId && l.subaccountId !== subaccountId) return s
    return s + l.amount
  }, 0))
}

/**
 * The capital accounts report: one row per partner, one column per subaccount,
 * plus row and column totals.
 *
 * Lines that name no partner are collected into an `unallocated` row rather
 * than dropped. They should never exist — the store refuses to post one — but
 * data imported or hand-edited from elsewhere might contain them, and a
 * report that hides them would make the subledger disagree with the balance
 * sheet for no visible reason.
 */
export function buildSummary(accounts = [], subaccounts = [], lines = []) {
  const subs = subaccounts.slice().sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999))
  const subIds = subs.map((s) => s.id)

  const rowFor = (id, name, extra = {}) => {
    const cells = {}
    subIds.forEach((sid) => { cells[sid] = balanceFor(lines, id, sid) })
    // A line naming a partner but no subaccount still belongs to that partner.
    const uncategorised = round2(lines.reduce(
      (s, l) => (l.capitalAccountId === id && !subIds.includes(l.subaccountId) ? s + l.amount : s), 0
    ))
    const total = round2(subIds.reduce((s, sid) => s + cells[sid], 0) + uncategorised)
    return { id, name, cells, uncategorised, total, ...extra }
  }

  const rows = accounts.map((a) => rowFor(a.id, a.name, { code: a.code || '', share: num(a.share) }))

  const known = new Set(accounts.map((a) => a.id))
  const orphanLines = lines.filter((l) => !l.capitalAccountId || !known.has(l.capitalAccountId))
  const unallocated = orphanLines.length
    ? (() => {
        const cells = {}
        subIds.forEach((sid) => {
          cells[sid] = round2(orphanLines.reduce((s, l) => (l.subaccountId === sid ? s + l.amount : s), 0))
        })
        const uncategorised = round2(orphanLines.reduce(
          (s, l) => (subIds.includes(l.subaccountId) ? s : s + l.amount), 0
        ))
        return {
          id: '__unallocated', name: 'Unallocated', cells, uncategorised,
          total: round2(orphanLines.reduce((s, l) => s + l.amount, 0)),
        }
      })()
    : null

  const all = unallocated ? [...rows, unallocated] : rows
  const columnTotals = {}
  subIds.forEach((sid) => { columnTotals[sid] = round2(all.reduce((s, r) => s + r.cells[sid], 0)) })
  const uncategorisedTotal = round2(all.reduce((s, r) => s + r.uncategorised, 0))
  const grandTotal = round2(all.reduce((s, r) => s + r.total, 0))

  return { subaccounts: subs, rows, unallocated, columnTotals, uncategorisedTotal, grandTotal }
}

/**
 * Does the subledger agree with the general ledger?
 *
 * `controlBalance` is the capital control account's balance from the trial
 * balance. They must match to the cent; anything else means a line escaped the
 * subledger and the partner report is lying.
 */
export function reconcile(summary, controlBalance) {
  const difference = round2(num(controlBalance) - summary.grandTotal)
  return {
    ok: Math.abs(difference) < 0.005,
    subledger: summary.grandTotal,
    control: round2(controlBalance),
    difference,
  }
}

/**
 * Split a profit between partners by their share percentage.
 *
 * Returns amounts summing EXACTLY to `profit` — the rounding remainder is
 * folded into the largest share, so repeated allocations cannot leak cents
 * into an account nobody is watching.
 */
export function allocateProfit(profit, accounts = []) {
  const total = round2(profit)
  const active = accounts.filter((a) => a && a.active !== false)
  if (!active.length || total === 0) return active.map((a) => ({ capitalAccountId: a.id, amount: 0 }))

  let weights = active.map((a) => Math.max(0, num(a.share)))
  let sum = weights.reduce((s, w) => s + w, 0)
  // No shares set is the common case for a two-person company that never got
  // round to it. An equal split is the sane reading, not a refusal.
  if (sum <= 0) { weights = active.map(() => 1); sum = active.length }

  const out = active.map((a, i) => ({
    capitalAccountId: a.id,
    name: a.name,
    amount: round2((total * weights[i]) / sum),
  }))

  const allocated = round2(out.reduce((s, o) => s + o.amount, 0))
  if (allocated !== total) {
    let biggest = 0
    weights.forEach((w, i) => { if (w > weights[biggest]) biggest = i })
    out[biggest].amount = round2(out[biggest].amount + (total - allocated))
  }
  return out
}

/**
 * Journal lines for a profit allocation.
 *
 * Debits retained earnings and credits each partner's share-of-profit
 * subaccount, which moves profit from "kept in the business" to "owed to a
 * named owner" without changing total equity by a cent.
 */
export function profitAllocationLines(allocation = [], { retainedAccountId = 'acc-retained', subaccountId = 'cap-sub-profit', label = 'Share of profit' } = {}) {
  const rows = allocation.filter((a) => round2(a.amount) !== 0)
  if (!rows.length) return []
  const total = round2(rows.reduce((s, a) => s + a.amount, 0))

  const partnerLines = rows.map((a) => ({
    accountId: CAPITAL_CONTROL,
    capitalAccountId: a.capitalAccountId,
    subaccountId,
    debit: a.amount < 0 ? round2(-a.amount) : 0,
    credit: a.amount > 0 ? round2(a.amount) : 0,
    description: `${label}${a.name ? ` — ${a.name}` : ''}`,
  }))

  return [
    {
      accountId: retainedAccountId,
      debit: total > 0 ? total : 0,
      credit: total < 0 ? round2(-total) : 0,
      description: label,
    },
    ...partnerLines,
  ]
}

/**
 * Journal lines for a contribution or a drawing.
 *
 * `kind` is 'contribution' (partner pays money in) or 'drawing' (partner takes
 * money out); `assetAccountId` is the bank or cash account on the other side.
 */
export function movementLines(kind, { capitalAccountId, assetAccountId, amount, name = '', description = '' }) {
  const value = round2(amount)
  if (!(value > 0)) throw new Error('CAPITAL_AMOUNT_INVALID')
  if (!capitalAccountId) throw new Error('CAPITAL_ACCOUNT_REQUIRED')
  if (!assetAccountId) throw new Error('CAPITAL_ASSET_REQUIRED')

  const isIn = kind === 'contribution'
  const subaccountId = isIn ? 'cap-sub-funds' : 'cap-sub-draw'
  const text = description || `${isIn ? 'Funds contributed' : 'Drawings'}${name ? ` — ${name}` : ''}`

  return isIn
    ? [
        { accountId: assetAccountId, debit: value, credit: 0, description: text },
        { accountId: CAPITAL_CONTROL, capitalAccountId, subaccountId, debit: 0, credit: value, description: text },
      ]
    : [
        { accountId: CAPITAL_CONTROL, capitalAccountId, subaccountId, debit: value, credit: 0, description: text },
        { accountId: assetAccountId, debit: 0, credit: value, description: text },
      ]
}

/** Check a capital account before it is saved. */
export function validateCapitalAccount(patch, existing = [], { id = null } = {}) {
  const errors = []
  const name = String(patch?.name || '').trim()
  if (!name) errors.push('Give the capital account a name.')

  const clash = existing.find(
    (a) => a.id !== id && String(a.name || '').trim().toLowerCase() === name.toLowerCase()
  )
  if (clash) errors.push('Another capital account already has that name.')

  const share = patch?.share
  if (share !== '' && share != null && (Number.isNaN(Number(share)) || Number(share) < 0))
    errors.push('A profit share cannot be negative.')

  return errors.length ? { ok: false, errors } : { ok: true }
}

/**
 * Total of the profit shares. Surfaced so the UI can warn when it is not 100 —
 * which is legal (the split is by ratio, not percent) but is usually a typo.
 */
export function shareTotal(accounts = []) {
  return round2(accounts.filter((a) => a.active !== false).reduce((s, a) => s + num(a.share), 0))
}
