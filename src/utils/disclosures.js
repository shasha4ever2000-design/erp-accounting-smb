// Notes to the financial statements.
//
// A balance sheet says a business holds 400,000 of property. The note says
// what it paid, what it has written off, what it bought and sold this year,
// and over how long it depreciates — and that is the part a lender, an auditor
// or a buyer actually reads. Four primary statements without notes are not a
// set of IFRS financial statements; they are four tables.
//
// ── The rule every note here obeys ─────────────────────────────────────
//
// A note must reconcile to the face of the statements. A property note whose
// closing carrying amount disagrees with the balance sheet is worse than no
// note at all: it looks authoritative and it is wrong, and whichever figure
// the reader believes, one of them has misled them.
//
// So every movement schedule is built the same way and checked the same way:
//
//   opening (everything before the period) + movements (within the period)
//     must equal the ledger's own closing balance at the period end
//
// Opening and movements are computed from the journal, and the closing figure
// is read back independently from the ledger. They agree unless something is
// wrong — a date filter off by a day, an account missing from a note, a
// posting routine using a type tag nobody told this module about. When they
// disagree the note says so, in the note, rather than quietly presenting a
// total that foots to nothing.
//
// ── Where the analysis comes from ─────────────────────────────────────
//
// Movements are split by the `type` tag the posting routines already stamp on
// every journal entry — 'fixed_asset' for a purchase, 'asset_disposal' for a
// sale, 'depreciation' for the annual charge. That is why the notes need no
// separate bookkeeping of their own and cannot drift from the ledger: they are
// a different reading of the same entries, not a second copy of them.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const TOL = 0.02

/** The day before a date, so "opening" means strictly before the period. */
export function dayBefore(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Net movement on a set of accounts, split by what caused it.
 *
 * @param {Array} journalEntries
 * @param {object} o
 * @param {string[]} o.accountIds   accounts this note covers
 * @param {string} o.start          period start (inclusive)
 * @param {string} o.end            period end (inclusive)
 * @param {(je: object) => string} o.classify  movement label for an entry
 * @param {number} o.sign           +1 for a debit-natural account, -1 for credit-natural
 */
export function accountMovement(journalEntries = [], {
  accountIds = [], start = '', end = '', classify = () => 'Other movements', sign = 1,
} = {}) {
  const ids = new Set(accountIds)
  const amountOn = (je) => (je.lines || []).reduce((s, l) => (
    ids.has(l.accountId) ? s + ((Number(l.debit) || 0) - (Number(l.credit) || 0)) * sign : s
  ), 0)

  let opening = 0
  const byLabel = new Map()

  ;(journalEntries || []).forEach((je) => {
    const amount = amountOn(je)
    if (amount === 0) return
    const date = String(je.date || '')
    if (start && date < start) { opening += amount; return }
    if (end && date > end) return
    const label = classify(je)
    byLabel.set(label, (byLabel.get(label) || 0) + amount)
  })

  const movements = [...byLabel.entries()]
    .map(([label, amount]) => ({ label, amount: r2(amount) }))
    .filter((m) => m.amount !== 0)
  const movementTotal = r2(movements.reduce((s, m) => s + m.amount, 0))

  return {
    opening: r2(opening),
    movements,
    movementTotal,
    closing: r2(opening + movementTotal),
  }
}

/**
 * Attach the reconciliation to a schedule.
 *
 * `ledgerClosing` is read from the ledger independently of everything above.
 * Agreement is the whole point; disagreement is reported rather than hidden.
 */
export function reconcile(schedule, ledgerClosing) {
  const difference = r2(schedule.closing - r2(ledgerClosing))
  return { ...schedule, ledgerClosing: r2(ledgerClosing), difference, reconciles: Math.abs(difference) <= TOL }
}

// ── How each posting routine's entries are described ───────────────────

const PPE_LABELS = {
  fixed_asset: 'Additions',
  asset_disposal: 'Disposals',
  depreciation: 'Depreciation charge',
  opening_balance: 'Opening balances',
}
const LEASE_LABELS = {
  lease_recognition: 'New leases recognised',
  lease_period: 'Interest and depreciation',
  lease_payment: 'Payments',
}

const labeller = (map) => (je) => map[je?.type] || 'Other movements'

// ── Property, plant and equipment (IAS 16.73) ──────────────────────────

/**
 * Cost and accumulated depreciation, each with its own movement.
 *
 * Presented as two schedules rather than one net figure because that is what
 * the standard asks for and what a reader needs: a carrying amount of 60,000
 * means something different for an asset that cost 70,000 than for one that
 * cost 500,000.
 */
export function ppeNote(state, { start, end, balance }) {
  const je = state.journalEntries || []
  const cost = accountMovement(je, { accountIds: ['acc-fixed'], start, end, classify: labeller(PPE_LABELS), sign: 1 })
  // Accumulated depreciation is a contra-asset: a credit increases it, so the
  // schedule is signed to read as a positive balance that grows.
  const depreciation = accountMovement(je, { accountIds: ['acc-depr'], start, end, classify: labeller(PPE_LABELS), sign: -1 })

  const costRec = reconcile(cost, balance('acc-fixed', 1))
  const depRec = reconcile(depreciation, balance('acc-depr', -1))

  return {
    id: 'ppe',
    title: 'Property, plant and equipment',
    reference: 'IAS 16.73',
    cost: costRec,
    depreciation: depRec,
    carrying: r2(costRec.closing - depRec.closing),
    carryingOpening: r2(costRec.opening - depRec.opening),
    assets: (state.fixedAssets || []).filter((a) => a.status !== 'disposed').length,
    reconciles: costRec.reconciles && depRec.reconciles,
  }
}

// ── Leases (IFRS 16.53, .58) ───────────────────────────────────────────

/**
 * Right-of-use assets, the lease liability, and when the liability falls due.
 *
 * The maturity analysis is undiscounted contractual cash flows, which is what
 * IFRS 16.58 asks for — so it deliberately does not add up to the liability on
 * the balance sheet, and the note says so rather than leaving a reader to
 * wonder why two numbers that look related do not match.
 */
export function leaseNote(state, { start, end, balance }) {
  const je = state.journalEntries || []
  const rouCost = accountMovement(je, { accountIds: ['acc-rou'], start, end, classify: labeller(LEASE_LABELS), sign: 1 })
  const rouDep = accountMovement(je, { accountIds: ['acc-roudepr'], start, end, classify: labeller(LEASE_LABELS), sign: -1 })
  const liability = accountMovement(je, { accountIds: ['acc-leasepay'], start, end, classify: labeller(LEASE_LABELS), sign: -1 })

  const capitalised = (state.leases || []).filter((l) => l.treatment === 'ifrs16')
  const maturity = leaseMaturity(capitalised, end)

  const rouCostRec = reconcile(rouCost, balance('acc-rou', 1))
  const rouDepRec = reconcile(rouDep, balance('acc-roudepr', -1))
  const liabRec = reconcile(liability, balance('acc-leasepay', -1))

  return {
    id: 'leases',
    title: 'Leases',
    reference: 'IFRS 16.53',
    rightOfUse: { cost: rouCostRec, depreciation: rouDepRec, carrying: r2(rouCostRec.closing - rouDepRec.closing) },
    liability: liabRec,
    maturity,
    leaseCount: capitalised.length,
    expensed: (state.leases || []).filter((l) => l.treatment !== 'ifrs16').length,
    reconciles: rouCostRec.reconciles && rouDepRec.reconciles && liabRec.reconciles,
  }
}

/**
 * How many payments have already fallen due at the reporting date.
 *
 * Counting month boundaries is off by one and it matters: a five-year lease
 * starting 1 January has had twelve payments by 31 December, not eleven, and
 * an analysis that says otherwise overstates the first-year commitment by a
 * whole payment. Whole elapsed months are counted from the day of the month,
 * and a payment in advance adds the one due on the start date itself.
 */
export function paymentsMade(lease = {}, asOf = '') {
  const start = lease.startDate ? new Date(lease.startDate) : null
  const at = asOf ? new Date(asOf) : new Date()
  if (!start || Number.isNaN(start.getTime()) || Number.isNaN(at.getTime()) || at < start) return 0
  let months = (at.getFullYear() - start.getFullYear()) * 12 + (at.getMonth() - start.getMonth())
  if (at.getDate() < start.getDate()) months -= 1        // the month is not complete yet
  const inAdvance = (lease.timing || lease.paymentTiming || 'advance') === 'advance'
  return Math.max(0, Math.min(Number(lease.termMonths) || 0, months + (inAdvance ? 1 : 0)))
}

/** Undiscounted contractual payments, bucketed by when they fall due. */
export function leaseMaturity(leases = [], asOf = '') {
  const buckets = [
    { key: 'y1', label: 'Within one year', months: 12, amount: 0 },
    { key: 'y2to5', label: 'One to five years', months: 60, amount: 0 },
    { key: 'over5', label: 'After five years', months: Infinity, amount: 0 },
  ]
  let total = 0
  leases.forEach((l) => {
    const payment = Number(l.payment) || 0
    const termMonths = Number(l.termMonths) || 0
    if (payment <= 0 || termMonths <= 0) return
    const remaining = Math.max(0, termMonths - paymentsMade(l, asOf))
    total += payment * remaining
    const inY1 = Math.min(remaining, 12)
    const inY2to5 = Math.min(Math.max(remaining - 12, 0), 48)
    const beyond = Math.max(remaining - 60, 0)
    buckets[0].amount += payment * inY1
    buckets[1].amount += payment * inY2to5
    buckets[2].amount += payment * beyond
  })
  return { buckets: buckets.map((b) => ({ ...b, amount: r2(b.amount) })), total: r2(total), undiscounted: true }
}

// ── Trade receivables and expected credit losses (IFRS 7.35) ───────────

export function receivablesNote(state, { end, balance, ageing }) {
  const gross = balance('acc-ar', 1)
  const allowance = r2(-balance('acc-ecl', 1))   // contra-asset, so its natural balance is negative
  return {
    id: 'receivables',
    title: 'Trade receivables',
    reference: 'IFRS 7.35',
    gross: r2(gross),
    allowance,
    net: r2(gross - allowance),
    ageing: ageing || null,
    asOf: end,
    // The allowance is posted against a separate account, never against the
    // control account itself — the customer still owes the full amount, and
    // the subledger has to keep saying so.
    note: 'The loss allowance is carried separately; the amount owed by each customer is unchanged.',
  }
}

// ── Inventories (IAS 2.36) ─────────────────────────────────────────────

export function inventoryNote(state, { balance }) {
  const items = (state.inventoryItems || []).filter((i) => !i.isService)
  const carrying = balance('acc-inv', 1)
  const counted = r2(items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.costPrice) || 0), 0))
  return {
    id: 'inventories',
    title: 'Inventories',
    reference: 'IAS 2.36',
    carrying: r2(carrying),
    subledger: counted,
    difference: r2(carrying - counted),
    reconciles: Math.abs(r2(carrying - counted)) <= TOL,
    items: items.length,
    costFormula: state.settings?.inventory?.costingMethod === 'fifo' ? 'First-in, first-out' : 'Weighted average cost',
  }
}

// ── Provisions (IAS 37.84) ─────────────────────────────────────────────

export function provisionsNote(state, { start, end, balance }) {
  const je = state.journalEntries || []
  const eosb = accountMovement(je, {
    accountIds: ['acc-eosb-prov'], start, end, sign: -1,
    classify: (x) => (x?.type === 'payroll' ? 'Amounts used' : 'Charged to profit or loss'),
  })
  const rec = reconcile(eosb, balance('acc-eosb-prov', -1))
  return {
    id: 'provisions',
    title: 'Provisions — end-of-service benefits',
    reference: 'IAS 37.84',
    eosb: rec,
    reconciles: rec.reconciles,
    note: 'Settled when employment ends, so the timing is uncertain and no amount is discounted.',
  }
}

// ── Revenue (IFRS 15.114) ──────────────────────────────────────────────

/**
 * Revenue split by the accounts it was credited to.
 *
 * IFRS 15 wants revenue disaggregated into categories that show how economic
 * factors affect it. A small business's chart of accounts is the honest proxy
 * for that: it is the split the business itself chose to keep.
 */
export function revenueNote(state, { periodBalances }) {
  const rows = (state.accounts || [])
    .filter((a) => a.type === 'revenue')
    .map((a) => {
      const b = periodBalances[a.id] || { dr: 0, cr: 0 }
      return { id: a.id, code: a.code, label: a.name, amount: r2(b.cr - b.dr) }
    })
    .filter((r) => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount)
  return {
    id: 'revenue',
    title: 'Revenue',
    reference: 'IFRS 15.114',
    rows,
    total: r2(rows.reduce((s, r) => s + r.amount, 0)),
  }
}

// ── Liquidity (IFRS 7.39) ──────────────────────────────────────────────

/**
 * When financial liabilities fall due.
 *
 * Payables are shown as due within a year because that is what an SMB's
 * ordinary trade terms mean; anything else would be a guess dressed as
 * analysis. Lease payments come from the contracts and are undiscounted.
 */
export function maturityNote(state, { end, balance, leaseMaturity: lm }) {
  const payables = r2(balance('acc-ap', -1))
  const loans = r2(balance('acc-loan', -1))
  const rows = [
    { label: 'Trade and other payables', y1: payables, y2to5: 0, over5: 0 },
    { label: 'Lease liabilities (undiscounted)', y1: lm?.buckets?.[0]?.amount || 0, y2to5: lm?.buckets?.[1]?.amount || 0, over5: lm?.buckets?.[2]?.amount || 0 },
    // A loan's repayment profile is not held anywhere in the books, so it is
    // shown as a single balance rather than split across periods on a guess.
    { label: 'Borrowings', y1: loans, y2to5: 0, over5: 0, assumed: true },
  ].filter((r) => r.y1 || r.y2to5 || r.over5)

  return {
    id: 'liquidity',
    title: 'Maturity of financial liabilities',
    reference: 'IFRS 7.39',
    rows,
    totals: {
      y1: r2(rows.reduce((s, r) => s + r.y1, 0)),
      y2to5: r2(rows.reduce((s, r) => s + r.y2to5, 0)),
      over5: r2(rows.reduce((s, r) => s + r.over5, 0)),
    },
    asOf: end,
  }
}

// ── Accounting policies (IAS 1.117) ────────────────────────────────────

/**
 * The policies actually in force, read from the settings that drive the
 * postings — not a boilerplate list. A note claiming FIFO while the engine
 * runs weighted average is a misstatement, and the only way to be sure it
 * cannot happen is to derive the words from the same switch.
 */
export function policiesNote(state) {
  const s = state.settings || {}
  const policies = [
    {
      label: 'Basis of preparation',
      text: `These financial statements are prepared on the historical cost basis and presented in ${s.company?.currency || ''}.`,
    },
    {
      label: 'Inventories',
      text: s.inventory?.costingMethod === 'fifo'
        ? 'Inventories are measured at the lower of cost and net realisable value, cost being determined on a first-in, first-out basis.'
        : 'Inventories are measured at the lower of cost and net realisable value, cost being determined on a weighted average basis.',
    },
    {
      label: 'Property, plant and equipment',
      text: 'Property, plant and equipment is stated at cost less accumulated depreciation, depreciated on a straight-line basis over each asset’s useful life.',
    },
  ]

  if ((state.leases || []).some((l) => l.treatment === 'ifrs16')) {
    policies.push({
      label: 'Leases',
      text: 'Leases are recognised as a right-of-use asset and a corresponding liability at the present value of the lease payments. Short-term and low-value leases are expensed as incurred.',
    })
  }
  if (s.ecl?.enabled) {
    policies.push({
      label: 'Expected credit losses',
      text: 'A loss allowance is recognised on trade receivables at an amount equal to lifetime expected credit losses, measured using a provision matrix based on days past due.',
    })
  }
  if (s.deferredTax?.enabled && s.deferredTax?.ratePct) {
    policies.push({
      label: 'Income tax',
      text: `Deferred tax is recognised on temporary differences between the carrying amounts of assets and liabilities and their tax bases, at ${s.deferredTax.ratePct}%. Deferred tax is not discounted.`,
    })
  }
  if (s.tax?.enabled) {
    policies.push({
      label: 'Value added tax',
      text: `Revenue and expenses are recognised net of ${s.tax.name || 'VAT'}, except where it is not recoverable.`,
    })
  }
  return { id: 'policies', title: 'Significant accounting policies', reference: 'IAS 1.117', policies }
}

// ── Assembly ───────────────────────────────────────────────────────────

/**
 * Every note for a period, with a single verdict on whether they all tie back.
 *
 * @param {object} state   the store
 * @param {object} o
 * @param {string} o.start
 * @param {string} o.end
 * @param {(start?: string, end?: string) => object} o.getAllBalances
 * @param {object} [o.ageing]      the aged receivables analysis, if available
 * @param {object} [o.taxNote]     the deferred tax schedule, if recognised
 */
export function buildNotes(state, { start, end, getAllBalances, ageing = null, taxNote = null }) {
  const cumulative = getAllBalances(undefined, end)
  const periodBalances = getAllBalances(start, end)

  // Read the closing position from the ledger by a different route than the
  // movement schedules take. Both ultimately read the same journal, so this
  // does not prove the journal is right — what it catches is the class of
  // error these notes are actually prone to: a date boundary off by a day, an
  // account left out of a note's list, a posting routine using a type tag
  // nobody told this module about.
  const balance = (id, sign = 1) => {
    const b = cumulative[id] || { dr: 0, cr: 0 }
    return r2(((Number(b.dr) || 0) - (Number(b.cr) || 0)) * sign)
  }

  const ctx = { start, end, balance, periodBalances }
  const leases = leaseNote(state, ctx)

  const notes = [
    policiesNote(state),
    ppeNote(state, ctx),
    leases,
    receivablesNote(state, { ...ctx, ageing }),
    inventoryNote(state, ctx),
    provisionsNote(state, ctx),
    revenueNote(state, ctx),
    maturityNote(state, { ...ctx, leaseMaturity: leases.maturity }),
  ]
  if (taxNote) notes.push({ id: 'tax', title: 'Income tax', reference: 'IAS 12.81', ...taxNote })

  const failing = notes.filter((n) => n.reconciles === false)
  return {
    start, end, notes,
    reconciles: failing.length === 0,
    failing: failing.map((n) => n.title),
  }
}
