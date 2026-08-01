import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { advanceBalance, customerCredit, applicableAmount, coverageFor } from '../src/utils/advances.js'

const g = () => useStore.getState()
const net = (accId) => {
  const b = g().getAllBalances()[accId] || { dr: 0, cr: 0 }
  return Math.round((b.dr - b.cr) * 100) / 100
}

// Before this the app refused money beyond an invoice's balance, because a
// deposit had nowhere to go. An advance is a liability until the work is done.

let customerId
beforeEach(() => {
  useStore.setState({ customerAdvances: [], invoices: [], journalEntries: [], auditLog: [], recycleBin: [] })
  customerId = g().addCustomer({ name: 'Gulf Star LLC' }).id
})

const advance = (over = {}) => g().receiveAdvance({
  customerId, customerName: 'Gulf Star LLC', amount: 10000,
  date: '2026-02-01', bankAccountId: 'acc-bank1', notes: '50% up front', ...over,
})

const invoice = (total = 6000) => {
  const inv = g().addInvoice({
    customerId, customerName: 'Gulf Star LLC', date: '2026-03-01',
    items: [{ id: 'l1', description: 'Work', quantity: 1, unitPrice: total, discount: 0, taxRate: 0, subtotal: total }],
    subtotal: total, taxAmount: 0, total,
  })
  return inv
}

describe('taking money on account', () => {
  it('puts cash in the bank and a liability on the books — not revenue', () => {
    advance()
    expect(net('acc-bank1')).toBeCloseTo(10000, 2)
    expect(net('acc-custadv')).toBeCloseTo(-10000, 2) // liability, credit-natured
    expect(net('acc-sales')).toBeCloseTo(0, 2)
  })

  it('does not touch accounts receivable', () => {
    advance()
    expect(net('acc-ar')).toBeCloseTo(0, 2)
  })

  it('starts with the whole amount available', () => {
    const a = advance()
    expect(advanceBalance(a)).toBeCloseTo(10000, 2)
    expect(g().customerCreditBalance(customerId)).toBeCloseTo(10000, 2)
  })

  it('refuses an advance with no customer, amount, date or account', () => {
    expect(() => advance({ customerId: '' })).toThrow(/ADVANCE_INVALID/)
    expect(() => advance({ amount: 0 })).toThrow(/ADVANCE_INVALID/)
    expect(() => advance({ date: '' })).toThrow(/ADVANCE_INVALID/)
    expect(() => advance({ bankAccountId: '' })).toThrow(/ADVANCE_INVALID/)
  })

  it('posts nothing when it refuses', () => {
    const before = g().journalEntries.length
    try { advance({ amount: -5 }) } catch { /* expected */ }
    expect(g().journalEntries).toHaveLength(before)
  })
})

describe('applying an advance to an invoice', () => {
  it('settles the receivable out of the deposit, not the bank', () => {
    const a = advance()
    const inv = invoice(6000)
    const bankBefore = net('acc-bank1')

    g().applyAdvance(a.id, inv.id, { date: '2026-03-02' })

    expect(net('acc-bank1')).toBeCloseTo(bankBefore, 2)   // no new cash moved
    expect(net('acc-custadv')).toBeCloseTo(-4000, 2)      // 10,000 less 6,000
    expect(net('acc-ar')).toBeCloseTo(0, 2)               // invoice settled
  })

  it('marks the invoice paid, with a real receipt number', () => {
    const a = advance()
    const inv = invoice(6000)
    g().applyAdvance(a.id, inv.id)

    const after = g().invoices.find((i) => i.id === inv.id)
    expect(after.status).toBe('paid')
    expect(after.amountPaid).toBeCloseTo(6000, 2)
    expect(after.payments[0].number).toBeTruthy()
    expect(after.payments[0].source).toBe('advance')
  })

  it('leaves the rest of the advance available', () => {
    const a = advance()
    g().applyAdvance(a.id, invoice(6000).id)
    expect(g().customerCreditBalance(customerId)).toBeCloseTo(4000, 2)
  })

  it('never applies more than the invoice owes', () => {
    const a = advance()          // 10,000 available
    const inv = invoice(2500)
    g().applyAdvance(a.id, inv.id, { amount: 9999 })
    expect(g().invoices.find((i) => i.id === inv.id).amountPaid).toBeCloseTo(2500, 2)
    expect(g().customerCreditBalance(customerId)).toBeCloseTo(7500, 2)
  })

  it('never applies more than the advance holds', () => {
    const a = advance({ amount: 1000 })
    const inv = invoice(6000)
    g().applyAdvance(a.id, inv.id, { amount: 6000 })
    expect(g().invoices.find((i) => i.id === inv.id).amountPaid).toBeCloseTo(1000, 2)
    expect(g().customerCreditBalance(customerId)).toBeCloseTo(0, 2)
  })

  it('can be applied in instalments across several invoices', () => {
    const a = advance()
    g().applyAdvance(a.id, invoice(3000).id)
    g().applyAdvance(a.id, invoice(2000).id)
    const after = g().customerAdvances.find((x) => x.id === a.id)
    expect(after.applications).toHaveLength(2)
    expect(advanceBalance(after)).toBeCloseTo(5000, 2)
  })

  it('refuses another customer’s invoice', () => {
    const a = advance()
    const other = g().addCustomer({ name: 'Someone Else' })
    const inv = g().addInvoice({
      customerId: other.id, customerName: 'Someone Else', date: '2026-03-01',
      items: [{ id: 'l1', description: 'x', quantity: 1, unitPrice: 100, discount: 0, taxRate: 0, subtotal: 100 }],
      subtotal: 100, taxAmount: 0, total: 100,
    })
    expect(() => g().applyAdvance(a.id, inv.id)).toThrow(/ADVANCE_WRONG_CUSTOMER/)
  })

  it('does nothing when the advance is exhausted', () => {
    const a = advance({ amount: 500 })
    g().applyAdvance(a.id, invoice(500).id)
    const next = invoice(500)               // created before measuring: it posts its own entry
    const entries = g().journalEntries.length
    g().applyAdvance(a.id, next.id)
    expect(g().journalEntries).toHaveLength(entries)
  })
})

describe('refunding', () => {
  it('returns the money and clears the liability', () => {
    const a = advance()
    g().refundAdvance(a.id, { amount: 10000, date: '2026-05-01' })
    expect(net('acc-bank1')).toBeCloseTo(0, 2)
    expect(net('acc-custadv')).toBeCloseTo(0, 2)
  })

  it('refunds only what is left after applications', () => {
    const a = advance()
    g().applyAdvance(a.id, invoice(6000).id)
    const res = g().refundAdvance(a.id, { amount: 99999 })
    expect(res.amount).toBeCloseTo(4000, 2)
    expect(net('acc-custadv')).toBeCloseTo(0, 2)
  })

  it('refuses when there is nothing left', () => {
    const a = advance({ amount: 1000 })
    g().applyAdvance(a.id, invoice(1000).id)
    expect(() => g().refundAdvance(a.id, { amount: 100 })).toThrow(/ADVANCE_NOTHING_TO_REFUND/)
  })
})

describe('deleting', () => {
  it('recycles an untouched advance', () => {
    const a = advance()
    g().deleteAdvance(a.id)
    expect(g().customerAdvances).toHaveLength(0)
    expect(g().recycleBin.some((e) => e.recordId === a.id)).toBe(true)
  })

  it('refuses once any of it has been applied', () => {
    const a = advance()
    g().applyAdvance(a.id, invoice(1000).id)
    expect(() => g().deleteAdvance(a.id)).toThrow(/ADVANCE_IN_USE/)
  })

  it('refuses once any of it has been refunded', () => {
    const a = advance()
    g().refundAdvance(a.id, { amount: 100 })
    expect(() => g().deleteAdvance(a.id)).toThrow(/ADVANCE_IN_USE/)
  })
})

describe('the pure helpers', () => {
  it('applicableAmount respects both sides', () => {
    expect(applicableAmount({ amount: 500 }, { total: 900, amountPaid: 0 })).toBeCloseTo(500, 2)
    expect(applicableAmount({ amount: 900 }, { total: 500, amountPaid: 0 })).toBeCloseTo(500, 2)
    expect(applicableAmount({ amount: 900 }, { total: 500, amountPaid: 500 })).toBe(0)
  })

  it('customerCredit ignores other customers and settled advances', () => {
    const rows = [
      { customerId: 'a', amount: 100 },
      { customerId: 'a', amount: 50, refunded: 50 },
      { customerId: 'b', amount: 999 },
    ]
    expect(customerCredit(rows, 'a')).toBeCloseTo(100, 2)
  })

  it('coverageFor caps at whichever side runs out first', () => {
    const rows = [{ customerId: 'a', amount: 300 }]
    expect(coverageFor(rows, { customerId: 'a', total: 1000, amountPaid: 0 })).toBeCloseTo(300, 2)
    expect(coverageFor(rows, { customerId: 'a', total: 200, amountPaid: 0 })).toBeCloseTo(200, 2)
    expect(coverageFor(rows, null)).toBe(0)
  })
})

describe('every advance entry balances', () => {
  it('across receive, apply and refund', () => {
    const a = advance()
    g().applyAdvance(a.id, invoice(6000).id)
    g().refundAdvance(a.id, { amount: 1000 })
    g().journalEntries.forEach((je) => {
      const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
      const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
      expect(Math.round((dr - cr) * 100) / 100, `entry ${je.number}`).toBe(0)
    })
  })
})
