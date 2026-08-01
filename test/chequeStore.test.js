import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { CHEQUE_IN, CHEQUE_OUT } from '../src/utils/cheques.js'

const g = () => useStore.getState()

// The point of the register: a post-dated cheque must not touch the bank
// balance until it clears, and a bounce must put the debt back.

const bal = (accId) => {
  const b = g().getAllBalances()[accId] || { dr: 0, cr: 0 }
  return { dr: Math.round(b.dr * 100) / 100, cr: Math.round(b.cr * 100) / 100 }
}
const net = (accId) => { const b = bal(accId); return Math.round((b.dr - b.cr) * 100) / 100 }

let customerId, supplierId
beforeEach(() => {
  useStore.setState({ cheques: [], journalEntries: [], auditLog: [], recycleBin: [] })
  const c = g().addCustomer({ name: 'Gulf Star LLC' })
  g().addSupplier({ name: 'Al-Noor Supplies' }) // returns nothing, unlike addCustomer
  customerId = c.id
  supplierId = g().suppliers[g().suppliers.length - 1].id
})

const received = (over = {}) => g().addCheque({
  direction: CHEQUE_IN, number: '004512', partyId: customerId, partyName: 'Gulf Star LLC',
  bankName: 'Riyad Bank', amount: 5000, issueDate: '2026-01-10', dueDate: '2026-04-10',
  bankAccountId: 'acc-bank1', ...over,
})

const issued = (over = {}) => g().addCheque({
  direction: CHEQUE_OUT, number: '77001', partyId: supplierId, partyName: 'Al-Noor Supplies',
  amount: 3200, issueDate: '2026-01-15', dueDate: '2026-03-15',
  bankAccountId: 'acc-bank1', ...over,
})

describe('receiving a post-dated cheque', () => {
  it('does not touch the bank', () => {
    const before = net('acc-bank1')
    received()
    expect(net('acc-bank1')).toBeCloseTo(before, 2)
  })

  it('parks it in Cheques Under Collection and clears the receivable', () => {
    received()
    expect(net('acc-chq-in')).toBeCloseTo(5000, 2)
    expect(net('acc-ar')).toBeCloseTo(-5000, 2)
  })

  it('starts on hand and records the opening event', () => {
    const c = received()
    expect(c.status).toBe('pending')
    expect(c.events).toHaveLength(1)
    expect(c.journalEntryId).toBeTruthy()
  })

  it('refuses a cheque with no due date, and says why', () => {
    expect(() => received({ dueDate: '' })).toThrow(/CHEQUE_INVALID/)
  })

  it('posts nothing at all when it refuses one', () => {
    const before = g().journalEntries.length
    try { received({ amount: 0 }) } catch { /* expected */ }
    expect(g().journalEntries).toHaveLength(before)
  })
})

describe('clearing', () => {
  it('is the moment the money reaches the bank', () => {
    const c = received()
    const bankBefore = net('acc-bank1')
    g().setChequeStatus(c.id, 'cleared', { date: '2026-04-10', bankAccountId: 'acc-bank1' })

    expect(net('acc-bank1')).toBeCloseTo(bankBefore + 5000, 2)
    expect(net('acc-chq-in')).toBeCloseTo(0, 2)   // holding account emptied
    expect(net('acc-ar')).toBeCloseTo(-5000, 2)   // receivable stays settled
  })

  it('records the clearing date', () => {
    const c = received()
    g().setChequeStatus(c.id, 'cleared', { date: '2026-04-10' })
    expect(g().cheques.find((x) => x.id === c.id).clearedDate).toBe('2026-04-10')
  })

  it('can go through the bank first without posting anything', () => {
    const c = received()
    const entries = g().journalEntries.length
    g().setChequeStatus(c.id, 'deposited', { date: '2026-04-08' })

    // Deposited is a location, not a transaction — nothing has settled yet.
    expect(g().journalEntries).toHaveLength(entries)
    expect(net('acc-chq-in')).toBeCloseTo(5000, 2)
    expect(net('acc-bank1')).toBeCloseTo(0, 2)
  })
})

describe('bouncing', () => {
  it('puts the receivable back and empties the holding account', () => {
    const c = received()
    g().setChequeStatus(c.id, 'bounced', { date: '2026-04-11', reason: 'Insufficient funds' })

    expect(net('acc-ar')).toBeCloseTo(0, 2)        // debt restored
    expect(net('acc-chq-in')).toBeCloseTo(0, 2)
    expect(net('acc-bank1')).toBeCloseTo(0, 2)     // never reached the bank
  })

  it('keeps the cheque and its reason rather than deleting the evidence', () => {
    const c = received()
    g().setChequeStatus(c.id, 'bounced', { reason: 'Insufficient funds' })
    const after = g().cheques.find((x) => x.id === c.id)
    expect(after.status).toBe('bounced')
    expect(after.bounceReason).toBe('Insufficient funds')
    expect(after.events.map((e) => e.status)).toEqual(['pending', 'bounced'])
  })

  it('can bounce after being deposited too', () => {
    const c = received()
    g().setChequeStatus(c.id, 'deposited')
    g().setChequeStatus(c.id, 'bounced', { reason: 'Returned' })
    expect(net('acc-ar')).toBeCloseTo(0, 2)
  })
})

describe('issued cheques', () => {
  it('move the payable into Cheques Payable without leaving the bank', () => {
    issued()
    expect(net('acc-chq-out')).toBeCloseTo(-3200, 2) // liability, credit-natured
    expect(net('acc-ap')).toBeCloseTo(3200, 2)
    expect(net('acc-bank1')).toBeCloseTo(0, 2)
  })

  it('leave the bank only when presented', () => {
    const c = issued()
    g().setChequeStatus(c.id, 'cleared', { date: '2026-03-15', bankAccountId: 'acc-bank1' })
    expect(net('acc-bank1')).toBeCloseTo(-3200, 2)
    expect(net('acc-chq-out')).toBeCloseTo(0, 2)
  })

  it('restore the payable when cancelled', () => {
    const c = issued()
    g().setChequeStatus(c.id, 'cancelled', { reason: 'Lost in the post' })
    expect(net('acc-ap')).toBeCloseTo(0, 2)
    expect(net('acc-chq-out')).toBeCloseTo(0, 2)
  })

  it('cannot be deposited — the payee presents it', () => {
    const c = issued()
    expect(() => g().setChequeStatus(c.id, 'deposited')).toThrow(/CHEQUE_BAD_TRANSITION/)
  })
})

describe('the register refuses impossible moves', () => {
  it('will not re-clear a cleared cheque', () => {
    const c = received()
    g().setChequeStatus(c.id, 'cleared', { bankAccountId: 'acc-bank1' })
    expect(() => g().setChequeStatus(c.id, 'cleared', { bankAccountId: 'acc-bank1' })).toThrow(/CHEQUE_BAD_TRANSITION/)
  })

  it('will not un-bounce', () => {
    const c = received()
    g().setChequeStatus(c.id, 'bounced')
    expect(() => g().setChequeStatus(c.id, 'cleared')).toThrow(/CHEQUE_BAD_TRANSITION/)
  })

  it('posts nothing when it refuses', () => {
    const c = received()
    g().setChequeStatus(c.id, 'cleared', { bankAccountId: 'acc-bank1' })
    const entries = g().journalEntries.length
    try { g().setChequeStatus(c.id, 'bounced') } catch { /* expected */ }
    expect(g().journalEntries).toHaveLength(entries)
  })

  it('will not clear without a bank account to clear into', () => {
    const c = received({ bankAccountId: '' })
    expect(() => g().setChequeStatus(c.id, 'cleared')).toThrow(/CHEQUE_NO_BANK/)
  })
})

describe('deleting', () => {
  it('recycles a cheque still in motion', () => {
    const c = received()
    g().deleteCheque(c.id)
    expect(g().cheques).toHaveLength(0)
    expect(g().recycleBin.some((e) => e.recordId === c.id)).toBe(true)
  })

  it('refuses to delete a settled one, whose entries the ledger relies on', () => {
    const c = received()
    g().setChequeStatus(c.id, 'cleared', { bankAccountId: 'acc-bank1' })
    expect(() => g().deleteCheque(c.id)).toThrow(/CHEQUE_SETTLED/)
    expect(g().cheques).toHaveLength(1)
  })
})

describe('outstandingCheques', () => {
  it('lists only what is still in motion', () => {
    const a = received()
    received({ number: '004513' })
    g().setChequeStatus(a.id, 'cleared', { bankAccountId: 'acc-bank1' })
    expect(g().outstandingCheques()).toHaveLength(1)
  })

  it('filters by direction', () => {
    received(); issued()
    expect(g().outstandingCheques(CHEQUE_IN)).toHaveLength(1)
    expect(g().outstandingCheques(CHEQUE_OUT)).toHaveLength(1)
    expect(g().outstandingCheques()).toHaveLength(2)
  })
})

describe('every cheque entry balances', () => {
  it('across a full receive → deposit → clear, and a bounce', () => {
    const a = received()
    g().setChequeStatus(a.id, 'deposited')
    g().setChequeStatus(a.id, 'cleared', { bankAccountId: 'acc-bank1' })
    const b = received({ number: '004599' })
    g().setChequeStatus(b.id, 'bounced', { reason: 'NSF' })
    const c = issued()
    g().setChequeStatus(c.id, 'cleared', { bankAccountId: 'acc-bank1' })

    g().journalEntries.forEach((je) => {
      const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
      const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
      expect(Math.round((dr - cr) * 100) / 100, `entry ${je.number} unbalanced`).toBe(0)
    })
  })
})
