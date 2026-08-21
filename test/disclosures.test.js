// Notes to the financial statements.
//
// The property that decides whether a note is worth printing is whether it
// ties back to the face of the statements. A property note whose closing
// carrying amount disagrees with the balance sheet is worse than no note: it
// looks authoritative and it is wrong, and whichever figure the reader
// believes, one of them has misled them.
//
// So most of what follows is reconciliation — including the cases where it
// *should* fail, because a check that cannot fail is not a check.
import { describe, it, expect } from 'vitest'
import {
  accountMovement, reconcile, ppeNote, leaseNote, leaseMaturity,
  receivablesNote, inventoryNote, provisionsNote, revenueNote, maturityNote, paymentsMade,
  policiesNote, buildNotes, dayBefore,
} from '../src/utils/disclosures.js'

const je = (date, type, lines) => ({ id: date + type, date, type, number: 'JE', lines })

// Prior year: a machine bought for 100,000, 10,000 depreciated.
// Current year: another for 40,000, 15,000 depreciated, nothing sold.
const PPE_ENTRIES = [
  je('2025-03-01', 'fixed_asset', [
    { accountId: 'acc-fixed', debit: 100000, credit: 0 },
    { accountId: 'acc-bank1', debit: 0, credit: 100000 },
  ]),
  je('2025-12-31', 'depreciation', [
    { accountId: 'acc-depexp', debit: 10000, credit: 0 },
    { accountId: 'acc-depr', debit: 0, credit: 10000 },
  ]),
  je('2026-04-01', 'fixed_asset', [
    { accountId: 'acc-fixed', debit: 40000, credit: 0 },
    { accountId: 'acc-bank1', debit: 0, credit: 40000 },
  ]),
  je('2026-12-31', 'depreciation', [
    { accountId: 'acc-depexp', debit: 15000, credit: 0 },
    { accountId: 'acc-depr', debit: 0, credit: 15000 },
  ]),
]

/** Stand-in for the store's getAllBalances, summing over a window. */
const balancer = (entries) => (start, end) => {
  const out = {}
  entries.forEach((e) => {
    if (start && e.date < start) return
    if (end && e.date > end) return
    e.lines.forEach((l) => {
      const b = out[l.accountId] || (out[l.accountId] = { dr: 0, cr: 0 })
      b.dr += l.debit || 0
      b.cr += l.credit || 0
    })
  })
  return out
}

const ctxFor = (entries, start, end) => {
  const cumulative = balancer(entries)(undefined, end)
  return {
    start, end,
    periodBalances: balancer(entries)(start, end),
    balance: (id, sign = 1) => {
      const b = cumulative[id] || { dr: 0, cr: 0 }
      return Math.round((b.dr - b.cr) * sign * 100) / 100
    },
  }
}

describe('splitting a movement by what caused it', () => {
  const m = () => accountMovement(PPE_ENTRIES, {
    accountIds: ['acc-fixed'], start: '2026-01-01', end: '2026-12-31',
    classify: (x) => ({ fixed_asset: 'Additions', asset_disposal: 'Disposals' }[x.type] || 'Other'),
  })

  it('carries the prior year in as the opening balance', () => {
    expect(m().opening).toBe(100000)
  })

  it('reports this year’s movements separately', () => {
    expect(m().movements).toEqual([{ label: 'Additions', amount: 40000 }])
  })

  it('closes at opening plus movements', () => {
    expect(m().closing).toBe(140000)
  })

  it('ignores anything after the period', () => {
    const later = [...PPE_ENTRIES, je('2027-01-01', 'fixed_asset', [
      { accountId: 'acc-fixed', debit: 999999, credit: 0 },
      { accountId: 'acc-bank1', debit: 0, credit: 999999 },
    ])]
    const s = accountMovement(later, { accountIds: ['acc-fixed'], start: '2026-01-01', end: '2026-12-31' })
    expect(s.closing).toBe(140000)
  })

  it('ignores accounts the note does not cover', () => {
    const s = accountMovement(PPE_ENTRIES, { accountIds: ['acc-fixed'], start: '', end: '2026-12-31' })
    expect(s.closing).toBe(140000)   // bank movements are not in it
  })

  it('signs a credit-natural account so its balance reads positive', () => {
    const s = accountMovement(PPE_ENTRIES, { accountIds: ['acc-depr'], start: '2026-01-01', end: '2026-12-31', sign: -1 })
    expect(s.opening).toBe(10000)
    expect(s.closing).toBe(25000)
  })

  it('drops movement lines that net to nothing', () => {
    const cancelling = [
      je('2026-05-01', 'x', [{ accountId: 'acc-fixed', debit: 500, credit: 0 }, { accountId: 'acc-bank1', debit: 0, credit: 500 }]),
      je('2026-05-02', 'x', [{ accountId: 'acc-fixed', debit: 0, credit: 500 }, { accountId: 'acc-bank1', debit: 500, credit: 0 }]),
    ]
    expect(accountMovement(cancelling, { accountIds: ['acc-fixed'], start: '2026-01-01', end: '2026-12-31' }).movements).toEqual([])
  })

  it('treats an empty period as an empty period, not an error', () => {
    const s = accountMovement([], { accountIds: ['acc-fixed'], start: '2026-01-01', end: '2026-12-31' })
    expect(s).toMatchObject({ opening: 0, closing: 0, movements: [] })
  })
})

describe('reconciliation', () => {
  it('passes when the schedule agrees with the ledger', () => {
    expect(reconcile({ closing: 140000 }, 140000)).toMatchObject({ reconciles: true, difference: 0 })
  })

  it('fails, and says by how much, when it does not', () => {
    // The point of the check. A note that cannot fail proves nothing.
    expect(reconcile({ closing: 140000 }, 130000)).toMatchObject({ reconciles: false, difference: 10000 })
  })

  it('tolerates rounding but not a real difference', () => {
    expect(reconcile({ closing: 100 }, 100.01).reconciles).toBe(true)
    expect(reconcile({ closing: 100 }, 100.5).reconciles).toBe(false)
  })
})

describe('the property, plant and equipment note', () => {
  const state = { journalEntries: PPE_ENTRIES, fixedAssets: [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }] }
  const note = () => ppeNote(state, ctxFor(PPE_ENTRIES, '2026-01-01', '2026-12-31'))

  it('ties back to the balance sheet — the test that makes it worth printing', () => {
    expect(note().reconciles).toBe(true)
    expect(note().cost.difference).toBe(0)
    expect(note().depreciation.difference).toBe(0)
  })

  it('shows cost and depreciation separately, as the standard asks', () => {
    // A carrying amount of 115,000 means something different for assets that
    // cost 140,000 than for assets that cost 500,000.
    const n = note()
    expect(n.cost).toMatchObject({ opening: 100000, closing: 140000 })
    expect(n.depreciation).toMatchObject({ opening: 10000, closing: 25000 })
    expect(n.carrying).toBe(115000)
    expect(n.carryingOpening).toBe(90000)
  })

  it('names the additions rather than lumping everything together', () => {
    expect(note().cost.movements).toEqual([{ label: 'Additions', amount: 40000 }])
    expect(note().depreciation.movements).toEqual([{ label: 'Depreciation charge', amount: 15000 }])
  })

  it('shows a disposal as a reduction in both cost and depreciation', () => {
    const withDisposal = [...PPE_ENTRIES, je('2026-06-01', 'asset_disposal', [
      { accountId: 'acc-fixed', debit: 0, credit: 100000 },
      { accountId: 'acc-depr', debit: 25000, credit: 0 },
      { accountId: 'acc-bank1', debit: 75000, credit: 0 },
    ])]
    const n = ppeNote({ journalEntries: withDisposal, fixedAssets: [] }, ctxFor(withDisposal, '2026-01-01', '2026-12-31'))
    expect(n.cost.movements).toContainEqual({ label: 'Disposals', amount: -100000 })
    expect(n.depreciation.movements).toContainEqual({ label: 'Disposals', amount: -25000 })
    expect(n.reconciles).toBe(true)
  })

  it('labels a movement it does not recognise rather than dropping it', () => {
    // A posting routine using a tag nobody told this module about must still
    // appear in the schedule, or the note stops footing.
    const odd = [...PPE_ENTRIES, je('2026-08-01', 'revaluation_nobody_told_us_about', [
      { accountId: 'acc-fixed', debit: 5000, credit: 0 },
      { accountId: 'acc-capital', debit: 0, credit: 5000 },
    ])]
    const n = ppeNote({ journalEntries: odd, fixedAssets: [] }, ctxFor(odd, '2026-01-01', '2026-12-31'))
    expect(n.cost.movements).toContainEqual({ label: 'Other movements', amount: 5000 })
    expect(n.reconciles).toBe(true)
  })
})

describe('the lease note', () => {
  const LEASES = [
    je('2026-01-01', 'lease_recognition', [
      { accountId: 'acc-rou', debit: 90000, credit: 0 },
      { accountId: 'acc-leasepay', debit: 0, credit: 90000 },
    ]),
    je('2026-12-31', 'lease_period', [
      { accountId: 'acc-depexp', debit: 18000, credit: 0 },
      { accountId: 'acc-roudepr', debit: 0, credit: 18000 },
    ]),
  ]
  const state = {
    journalEntries: LEASES,
    leases: [{ id: 'l1', treatment: 'ifrs16', payment: 2000, termMonths: 60, startDate: '2026-01-01' },
      { id: 'l2', treatment: 'expense' }],
  }

  it('reconciles both the asset and the liability', () => {
    const n = leaseNote(state, ctxFor(LEASES, '2026-01-01', '2026-12-31'))
    expect(n.reconciles).toBe(true)
    expect(n.rightOfUse.carrying).toBe(72000)
    expect(n.liability.closing).toBe(90000)
  })

  it('counts capitalised and expensed leases apart', () => {
    const n = leaseNote(state, ctxFor(LEASES, '2026-01-01', '2026-12-31'))
    expect(n.leaseCount).toBe(1)
    expect(n.expensed).toBe(1)
  })

  it('buckets the remaining payments by when they fall due', () => {
    // 60 months at 2,000 from 1 January. By 31 December twelve payments have
    // fallen due, leaving 48: twelve in the coming year and thirty-six after.
    const m = leaseMaturity([{ payment: 2000, termMonths: 60, startDate: '2026-01-01' }], '2026-12-31')
    expect(m.buckets[0].amount).toBe(24000)
    expect(m.buckets[1].amount).toBe(72000)
    expect(m.buckets[2].amount).toBe(0)
    expect(m.total).toBe(96000)
  })

  it('counts the payments that have actually fallen due, not the month boundaries', () => {
    // Off by one here overstates the first-year commitment by a whole payment.
    expect(paymentsMade({ termMonths: 60, startDate: '2026-01-01', timing: 'advance' }, '2026-12-31')).toBe(12)
    expect(paymentsMade({ termMonths: 60, startDate: '2026-01-01', timing: 'arrears' }, '2026-12-31')).toBe(11)
    expect(paymentsMade({ termMonths: 60, startDate: '2026-01-01' }, '2026-01-01')).toBe(1)
    expect(paymentsMade({ termMonths: 60, startDate: '2026-01-15' }, '2026-02-14')).toBe(1)
    expect(paymentsMade({ termMonths: 60, startDate: '2026-01-15' }, '2026-02-15')).toBe(2)
  })

  it('never counts more payments than the lease has', () => {
    expect(paymentsMade({ termMonths: 12, startDate: '2020-01-01' }, '2026-12-31')).toBe(12)
  })

  it('counts nothing before the lease starts', () => {
    expect(paymentsMade({ termMonths: 60, startDate: '2027-01-01' }, '2026-12-31')).toBe(0)
  })

  it('reaches beyond five years when the term does', () => {
    // 120 months, one payment already made on day one → 119 left: 12, then 48,
    // then 59 beyond five years.
    const m = leaseMaturity([{ payment: 1000, termMonths: 120, startDate: '2026-01-01' }], '2026-01-01')
    expect(m.buckets[2].amount).toBe(59000)
    expect(m.total).toBe(119000)
  })

  it('says the maturity figures are undiscounted', () => {
    // They will not add up to the liability on the balance sheet, and a reader
    // comparing the two deserves to know why rather than assuming an error.
    expect(leaseMaturity([], '2026-12-31').undiscounted).toBe(true)
  })

  it('has nothing to say about a lease with no payment or term', () => {
    expect(leaseMaturity([{ payment: 0, termMonths: 0 }], '2026-12-31').total).toBe(0)
  })
})

describe('the receivables note', () => {
  const ENTRIES = [
    je('2026-02-01', 'invoice', [
      { accountId: 'acc-ar', debit: 50000, credit: 0 },
      { accountId: 'acc-sales', debit: 0, credit: 50000 },
    ]),
    je('2026-12-31', 'ecl', [
      { accountId: 'acc-baddebt', debit: 3000, credit: 0 },
      { accountId: 'acc-ecl', debit: 0, credit: 3000 },
    ]),
  ]

  it('shows gross, allowance and net', () => {
    const n = receivablesNote({}, { ...ctxFor(ENTRIES, '2026-01-01', '2026-12-31'), ageing: null })
    expect(n).toMatchObject({ gross: 50000, allowance: 3000, net: 47000 })
  })

  it('says the allowance never touches what the customer owes', () => {
    const n = receivablesNote({}, { ...ctxFor(ENTRIES, '2026-01-01', '2026-12-31') })
    expect(n.note).toMatch(/unchanged/)
  })
})

describe('the inventory note', () => {
  const ENTRIES = [je('2026-02-01', 'purchase', [
    { accountId: 'acc-inv', debit: 12000, credit: 0 },
    { accountId: 'acc-ap', debit: 0, credit: 12000 },
  ])]

  it('reconciles the ledger to the stock subledger', () => {
    const state = {
      inventoryItems: [{ id: 'i1', quantity: 100, costPrice: 120 }],
      settings: { inventory: { costingMethod: 'wac' } },
    }
    const n = inventoryNote(state, ctxFor(ENTRIES, '2026-01-01', '2026-12-31'))
    expect(n).toMatchObject({ carrying: 12000, subledger: 12000, reconciles: true })
  })

  it('reports a disagreement rather than presenting the ledger figure alone', () => {
    const state = {
      inventoryItems: [{ id: 'i1', quantity: 90, costPrice: 120 }],
      settings: { inventory: { costingMethod: 'wac' } },
    }
    const n = inventoryNote(state, ctxFor(ENTRIES, '2026-01-01', '2026-12-31'))
    expect(n.reconciles).toBe(false)
    expect(n.difference).toBe(1200)
  })

  it('names the cost formula actually in force', () => {
    // Not boilerplate: a note claiming FIFO while the engine runs weighted
    // average is a misstatement.
    const fifo = inventoryNote({ inventoryItems: [], settings: { inventory: { costingMethod: 'fifo' } } },
      ctxFor([], '2026-01-01', '2026-12-31'))
    expect(fifo.costFormula).toMatch(/first-in/i)
  })
})

describe('the provisions note', () => {
  const ENTRIES = [
    je('2025-12-31', 'manual', [
      { accountId: 'acc-eosb-exp', debit: 20000, credit: 0 },
      { accountId: 'acc-eosb-prov', debit: 0, credit: 20000 },
    ]),
    je('2026-12-31', 'manual', [
      { accountId: 'acc-eosb-exp', debit: 8000, credit: 0 },
      { accountId: 'acc-eosb-prov', debit: 0, credit: 8000 },
    ]),
    je('2026-06-30', 'payroll', [
      { accountId: 'acc-eosb-prov', debit: 5000, credit: 0 },
      { accountId: 'acc-bank1', debit: 0, credit: 5000 },
    ]),
  ]

  it('separates what was charged from what was paid out', () => {
    const n = provisionsNote({ journalEntries: ENTRIES }, ctxFor(ENTRIES, '2026-01-01', '2026-12-31'))
    expect(n.eosb.opening).toBe(20000)
    expect(n.eosb.movements).toContainEqual({ label: 'Charged to profit or loss', amount: 8000 })
    expect(n.eosb.movements).toContainEqual({ label: 'Amounts used', amount: -5000 })
    expect(n.eosb.closing).toBe(23000)
    expect(n.reconciles).toBe(true)
  })
})

describe('the revenue note', () => {
  it('disaggregates by the split the business itself keeps', () => {
    const state = {
      accounts: [
        { id: 'acc-sales', code: '4001', name: 'Sales', type: 'revenue' },
        { id: 'acc-service', code: '4002', name: 'Services', type: 'revenue' },
        { id: 'acc-idle', code: '4003', name: 'Unused', type: 'revenue' },
        { id: 'acc-bank1', code: '1001', name: 'Bank', type: 'asset' },
      ],
    }
    const n = revenueNote(state, {
      periodBalances: { 'acc-sales': { dr: 0, cr: 30000 }, 'acc-service': { dr: 0, cr: 70000 } },
    })
    expect(n.rows.map((r) => r.label)).toEqual(['Services', 'Sales'])   // largest first
    expect(n.total).toBe(100000)
  })

  it('leaves out accounts with nothing in them', () => {
    const n = revenueNote({ accounts: [{ id: 'a', name: 'Idle', type: 'revenue' }] }, { periodBalances: {} })
    expect(n.rows).toEqual([])
  })
})

describe('the maturity note', () => {
  it('puts payables in the first year and leases where the contracts say', () => {
    const ENTRIES = [je('2026-02-01', 'purchase', [
      { accountId: 'acc-inv', debit: 12000, credit: 0 },
      { accountId: 'acc-ap', debit: 0, credit: 12000 },
    ])]
    const n = maturityNote({}, {
      ...ctxFor(ENTRIES, '2026-01-01', '2026-12-31'),
      leaseMaturity: { buckets: [{ amount: 24000 }, { amount: 72000 }, { amount: 0 }] },
    })
    expect(n.totals).toMatchObject({ y1: 36000, y2to5: 72000, over5: 0 })
  })

  it('marks the borrowings line as an assumption rather than analysis', () => {
    // A loan's repayment profile is not held anywhere in the books, and
    // splitting it across periods would be a guess dressed up as analysis.
    const ENTRIES = [je('2026-01-01', 'manual', [
      { accountId: 'acc-bank1', debit: 50000, credit: 0 },
      { accountId: 'acc-loan', debit: 0, credit: 50000 },
    ])]
    const n = maturityNote({}, { ...ctxFor(ENTRIES, '2026-01-01', '2026-12-31'), leaseMaturity: null })
    expect(n.rows.find((r) => /Borrowings/.test(r.label)).assumed).toBe(true)
  })
})

describe('the accounting policies note', () => {
  it('describes the policy actually in force, not a boilerplate list', () => {
    const wac = policiesNote({ settings: { inventory: { costingMethod: 'wac' }, company: { currency: 'SAR' } } })
    expect(wac.policies.find((p) => p.label === 'Inventories').text).toMatch(/weighted average/i)
    const fifo = policiesNote({ settings: { inventory: { costingMethod: 'fifo' } } })
    expect(fifo.policies.find((p) => p.label === 'Inventories').text).toMatch(/first-in/i)
  })

  it('says nothing about standards the business does not apply', () => {
    // Claiming a leasing policy with no capitalised leases, or a deferred tax
    // policy with deferred tax switched off, would be describing someone
    // else's accounts.
    const plain = policiesNote({ settings: {}, leases: [] })
    expect(plain.policies.map((p) => p.label)).not.toContain('Leases')
    expect(plain.policies.map((p) => p.label)).not.toContain('Expected credit losses')
    expect(plain.policies.map((p) => p.label)).not.toContain('Income tax')
  })

  it('adds them once they are', () => {
    const full = policiesNote({
      settings: { ecl: { enabled: true }, deferredTax: { enabled: true, ratePct: 20 }, tax: { enabled: true, name: 'VAT' } },
      leases: [{ treatment: 'ifrs16' }],
    })
    const labels = full.policies.map((p) => p.label)
    expect(labels).toContain('Leases')
    expect(labels).toContain('Expected credit losses')
    expect(labels).toContain('Income tax')
    expect(full.policies.find((p) => p.label === 'Income tax').text).toMatch(/20%/)
  })
})

describe('the whole pack', () => {
  const state = {
    journalEntries: PPE_ENTRIES,
    fixedAssets: [{ id: 'a', status: 'active' }],
    inventoryItems: [],
    leases: [],
    accounts: [{ id: 'acc-sales', name: 'Sales', type: 'revenue' }],
    settings: { inventory: { costingMethod: 'wac' }, company: { currency: 'USD' } },
  }
  const pack = () => buildNotes(state, {
    start: '2026-01-01', end: '2026-12-31', getAllBalances: balancer(PPE_ENTRIES),
  })

  it('gives a single verdict on whether everything ties back', () => {
    expect(pack().reconciles).toBe(true)
    expect(pack().failing).toEqual([])
  })

  it('names the notes that do not, rather than reporting a clean pack', () => {
    const broken = {
      ...state,
      inventoryItems: [{ id: 'i', quantity: 5, costPrice: 100 }],   // subledger with no ledger behind it
    }
    const p = buildNotes(broken, { start: '2026-01-01', end: '2026-12-31', getAllBalances: balancer(PPE_ENTRIES) })
    expect(p.reconciles).toBe(false)
    expect(p.failing).toContain('Inventories')
  })

  it('includes the tax note only when deferred tax is recognised', () => {
    expect(pack().notes.find((n) => n.id === 'tax')).toBeUndefined()
    const withTax = buildNotes(state, {
      start: '2026-01-01', end: '2026-12-31', getAllBalances: balancer(PPE_ENTRIES),
      taxNote: { effectiveRate: 20, lines: [] },
    })
    expect(withTax.notes.find((n) => n.id === 'tax')).toBeTruthy()
  })

  it('survives a business with no transactions at all', () => {
    const empty = buildNotes({ settings: {} }, { start: '2026-01-01', end: '2026-12-31', getAllBalances: () => ({}) })
    expect(empty.reconciles).toBe(true)
    expect(empty.notes.length).toBeGreaterThan(0)
  })
})

describe('small helpers', () => {
  it('steps back one day, including across a month boundary', () => {
    expect(dayBefore('2026-03-01')).toBe('2026-02-28')
    expect(dayBefore('2026-01-01')).toBe('2025-12-31')
  })

  it('returns nothing for a missing or invalid date', () => {
    expect(dayBefore('')).toBe('')
    expect(dayBefore('not a date')).toBe('')
  })
})
