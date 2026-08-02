// Capitalising a lease, through the store.
//
// ifrs16.test.js proves the measurement. This proves the wiring: that
// recognition actually reaches the ledger, that the right-of-use asset and
// lease liability land on the accounts the balance sheet reads, and — the part
// that matters most — that turning IFRS 16 on for one lease cannot disturb a
// lease that was already being expensed.
//
// The guards against double-posting are tested deliberately. Recognising twice
// or posting a period twice produces a *balanced* entry, so nothing downstream
// would flag it; the only thing standing between a user and a silently doubled
// balance sheet is the refusal itself.
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { leaseSchedule } from '../src/utils/ifrs16.js'
import { fmtMoney } from '../src/utils/formatters.js'

const g = () => useStore.getState()
const net = (id) => {
  const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }
  return Math.round((b.dr - b.cr) * 100) / 100
}
const balanced = (je) => {
  const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
  const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
  return Math.abs(dr - cr) < 0.005
}

const TERMS = {
  name: 'Head office', startDate: '2026-01-01',
  monthlyRent: 1000, termMonths: 36, discountRate: 6, paymentTiming: 'advance',
}

beforeEach(() => {
  useStore.setState({ journalEntries: [], leases: [] })
})

describe('recognising a lease', () => {
  it('puts a right-of-use asset and a lease liability on the balance sheet', () => {
    const lease = g().addLease(TERMS)
    const je = g().recogniseLease(lease.id)

    expect(balanced(je)).toBe(true)
    expect(net('acc-rou')).toBeGreaterThan(32000)
    expect(net('acc-leasepay')).toBeLessThan(0)          // liability sits as a credit
    expect(net('acc-rou')).toBeCloseTo(-net('acc-leasepay'), 2)
  })

  it('records what it measured on the lease', () => {
    const lease = g().addLease(TERMS)
    g().recogniseLease(lease.id)
    const after = g().leases.find((l) => l.id === lease.id)
    expect(after.treatment).toBe('ifrs16')
    expect(after.initialLiability).toBeGreaterThan(0)
    expect(after.initialRouAsset).toBe(after.initialLiability)
    expect(after.recognitionJournalEntryId).toBeTruthy()
  })

  it('refuses to recognise the same lease twice', () => {
    // Both entries would balance, so nothing else would ever catch this.
    const lease = g().addLease(TERMS)
    g().recogniseLease(lease.id)
    expect(() => g().recogniseLease(lease.id)).toThrow(/ALREADY_RECOGNISED/)
    expect(g().journalEntries.filter((j) => j.type === 'lease_recognition')).toHaveLength(1)
  })

  it('needs a term and a payment before it will measure anything', () => {
    const noTerm = g().addLease({ ...TERMS, termMonths: 0 })
    expect(() => g().recogniseLease(noTerm.id)).toThrow(/TERM_REQUIRED/)
    const noPay = g().addLease({ ...TERMS, monthlyRent: 0 })
    expect(() => g().recogniseLease(noPay.id)).toThrow(/PAYMENT_REQUIRED/)
    expect(g().journalEntries).toHaveLength(0)
  })
})

describe('posting a period', () => {
  it('books interest, the payment and depreciation', () => {
    const lease = g().addLease(TERMS)
    g().recogniseLease(lease.id)
    const je = g().postLeasePeriod(lease.id, 1, { date: '2026-01-31' })

    expect(balanced(je)).toBe(true)
    expect(net('acc-interest')).toBeGreaterThan(0)
    expect(net('acc-depexp')).toBeGreaterThan(0)
    expect(net('acc-roudepr')).toBeLessThan(0)   // contra-asset, sits as a credit
  })

  it('refuses to post the same period twice', () => {
    const lease = g().addLease(TERMS)
    g().recogniseLease(lease.id)
    g().postLeasePeriod(lease.id, 1)
    expect(() => g().postLeasePeriod(lease.id, 1)).toThrow(/ALREADY_POSTED/)
    expect(g().journalEntries.filter((j) => j.type === 'lease_period')).toHaveLength(1)
  })

  it('refuses a period beyond the lease term', () => {
    const lease = g().addLease(TERMS)
    g().recogniseLease(lease.id)
    expect(() => g().postLeasePeriod(lease.id, 37)).toThrow(/OUT_OF_TERM/)
  })

  it('will not post a period for a lease that was never capitalised', () => {
    const lease = g().addLease(TERMS)
    expect(() => g().postLeasePeriod(lease.id, 1)).toThrow(/NOT_RECOGNISED/)
  })

  it('clears the liability and the asset exactly over the full term', () => {
    // The end state is the real proof: after every period, the right-of-use
    // asset must be fully depreciated and nothing may be left owing.
    const lease = g().addLease(TERMS)
    g().recogniseLease(lease.id)
    for (let p = 1; p <= 36; p++) g().postLeasePeriod(lease.id, p, { date: '2026-01-31' })

    // Money summed from dozens of postings carries float dust, so these are
    // compared to the cent rather than by identity.
    expect(net('acc-leasepay')).toBeCloseTo(0, 2)
    expect(net('acc-rou') + net('acc-roudepr')).toBeCloseTo(0, 2)
  })

  it('expenses exactly the cash paid, no more and no less', () => {
    const lease = g().addLease(TERMS)
    g().recogniseLease(lease.id)
    for (let p = 1; p <= 36; p++) g().postLeasePeriod(lease.id, p)

    const totalExpense = Math.round((net('acc-interest') + net('acc-depexp')) * 100) / 100
    expect(totalExpense).toBeCloseTo(36 * 1000, 1)
  })

  it('front-loads the charge relative to straight-line rent', () => {
    const lease = g().addLease(TERMS)
    g().recogniseLease(lease.id)
    const { rows } = leaseSchedule(g().leaseTerms(g().leases[0]))
    expect(rows[0].periodExpense).toBeGreaterThan(1000)
    expect(rows[35].periodExpense).toBeLessThan(1000)
  })

  it('keeps a record of each period it posted', () => {
    const lease = g().addLease(TERMS)
    g().recogniseLease(lease.id)
    g().postLeasePeriod(lease.id, 1, { date: '2026-01-31' })
    g().postLeasePeriod(lease.id, 2, { date: '2026-02-28' })
    const posted = g().leases.find((l) => l.id === lease.id).postedPeriods
    expect(posted.map((p) => p.period)).toEqual([1, 2])
    expect(posted[0].interest).toBeGreaterThan(0)
  })
})

describe('leaving existing leases alone', () => {
  it('an un-capitalised lease still posts rent exactly as before', () => {
    const lease = g().addLease({ ...TERMS, expenseAccountId: 'acc-rent' })
    g().recordLeasePayment(lease.id, { date: '2026-01-05', amount: 1000 })

    expect(net('acc-rent')).toBe(1000)
    expect(net('acc-rou')).toBe(0)
    expect(net('acc-leasepay')).toBe(0)
  })

  it('refuses to book rent on a lease that has been capitalised', () => {
    // The payment is already split into interest and principal by the period
    // posting; booking it as rent too would expense the same cash twice.
    const lease = g().addLease(TERMS)
    g().recogniseLease(lease.id)
    expect(() => g().recordLeasePayment(lease.id, { date: '2026-01-05', amount: 1000 }))
      .toThrow(/CAPITALISED/)
    expect(net('acc-rent')).toBe(0)
  })

  it('capitalising one lease does not touch another', () => {
    const capitalised = g().addLease({ ...TERMS, name: 'Capitalised' })
    const expensed = g().addLease({ ...TERMS, name: 'Expensed' })
    g().recogniseLease(capitalised.id)
    g().recordLeasePayment(expensed.id, { date: '2026-01-05', amount: 1000 })

    const other = g().leases.find((l) => l.id === expensed.id)
    expect(other.treatment).toBeUndefined()
    expect(other.payments).toHaveLength(1)
    expect(net('acc-rent')).toBe(1000)
  })
})

describe('the ledger stays sound', () => {
  it('every entry the lease produces balances', () => {
    const lease = g().addLease(TERMS)
    g().recogniseLease(lease.id)
    for (let p = 1; p <= 12; p++) g().postLeasePeriod(lease.id, p)
    expect(g().journalEntries.every(balanced)).toBe(true)
  })

  it('the whole ledger nets to zero after a full lease life', () => {
    const lease = g().addLease(TERMS)
    g().recogniseLease(lease.id)
    for (let p = 1; p <= 36; p++) g().postLeasePeriod(lease.id, p)
    const total = Object.values(g().getAllBalances()).reduce((s, b) => s + (b.dr - b.cr), 0)
    expect(total).toBeCloseTo(0, 2)
  })

  it('a settled liability does not display as a negative zero', () => {
    // Summing 36 postings leaves the balance a hair below zero. Rendering that
    // as "-$0.00" on a balance sheet makes a cleared account look wrong.
    const lease = g().addLease(TERMS)
    g().recogniseLease(lease.id)
    for (let p = 1; p <= 36; p++) g().postLeasePeriod(lease.id, p)
    expect(fmtMoney(net('acc-leasepay'), '$')).toBe('$0.00')
  })
})
