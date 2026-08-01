import { describe, it, expect } from 'vitest'
import {
  CHEQUE_IN, CHEQUE_OUT, CHEQUE_ACCOUNTS, CHEQUE_STATUS,
  canTransition, nextStatuses, isTerminal, validateCheque,
  chequeBuckets, chequeTotal, chequeLines,
} from '../src/utils/cheques.js'

const balanced = (lines) => {
  const dr = lines.reduce((s, l) => s + (l.debit || 0), 0)
  const cr = lines.reduce((s, l) => s + (l.credit || 0), 0)
  return Math.round((dr - cr) * 100) / 100 === 0
}

describe('the status lifecycle', () => {
  it('lets a received cheque be deposited, then clear', () => {
    expect(canTransition(CHEQUE_IN, 'pending', 'deposited')).toBe(true)
    expect(canTransition(CHEQUE_IN, 'deposited', 'cleared')).toBe(true)
  })

  it('lets a received cheque bounce from either side of the bank', () => {
    expect(canTransition(CHEQUE_IN, 'pending', 'bounced')).toBe(true)
    expect(canTransition(CHEQUE_IN, 'deposited', 'bounced')).toBe(true)
  })

  it('never deposits a cheque you wrote yourself', () => {
    // The payee presents it; there is nothing for the drawer to deposit.
    expect(canTransition(CHEQUE_OUT, 'pending', 'deposited')).toBe(false)
    expect(nextStatuses(CHEQUE_OUT, 'pending')).not.toContain('deposited')
  })

  it('treats cleared, bounced and cancelled as final', () => {
    ;['cleared', 'bounced', 'cancelled'].forEach((s) => {
      expect(isTerminal(s)).toBe(true)
      expect(nextStatuses(CHEQUE_IN, s)).toEqual([])
      expect(nextStatuses(CHEQUE_OUT, s)).toEqual([])
    })
  })

  it('cannot un-clear a cheque', () => {
    expect(canTransition(CHEQUE_IN, 'cleared', 'pending')).toBe(false)
    expect(canTransition(CHEQUE_IN, 'cleared', 'bounced')).toBe(false)
  })

  it('rejects an unknown direction rather than guessing', () => {
    expect(canTransition('sideways', 'pending', 'cleared')).toBe(false)
    expect(nextStatuses('sideways', 'pending')).toEqual([])
  })

  it('lists every status the UI has to render', () => {
    expect(CHEQUE_STATUS).toEqual(['pending', 'deposited', 'cleared', 'bounced', 'cancelled'])
  })
})

describe('validation', () => {
  const good = { direction: CHEQUE_IN, number: '004512', partyId: 'c1', amount: 5000, issueDate: '2026-01-10', dueDate: '2026-04-10' }

  it('accepts a complete cheque', () => {
    expect(validateCheque(good).ok).toBe(true)
  })

  it('insists on a due date, which is the point of the register', () => {
    const r = validateCheque({ ...good, dueDate: '' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/date written on the cheque/i)
  })

  it('insists on a number', () => {
    expect(validateCheque({ ...good, number: '  ' }).ok).toBe(false)
  })

  it('insists on a party, and says which kind', () => {
    expect(validateCheque({ ...good, partyId: '' }).error).toMatch(/customer/i)
    expect(validateCheque({ ...good, direction: CHEQUE_OUT, partyId: '' }).error).toMatch(/supplier/i)
  })

  it('rejects a zero or negative amount', () => {
    expect(validateCheque({ ...good, amount: 0 }).ok).toBe(false)
    expect(validateCheque({ ...good, amount: -1 }).ok).toBe(false)
  })

  it('catches a cheque dated before it was written', () => {
    expect(validateCheque({ ...good, issueDate: '2026-04-10', dueDate: '2026-01-10' }).ok).toBe(false)
  })

  it('allows a same-day cheque — not every cheque is post-dated', () => {
    expect(validateCheque({ ...good, issueDate: '2026-01-10', dueDate: '2026-01-10' }).ok).toBe(true)
  })

  it('rejects a direction it does not understand', () => {
    expect(validateCheque({ ...good, direction: 'maybe' }).ok).toBe(false)
  })
})

describe('the ledger keeps a cheque out of the bank until it clears', () => {
  const base = { direction: CHEQUE_IN, amount: 5000, partyAccountId: 'acc-ar', bankAccountId: 'acc-bank1', number: '004512' }

  it('receipt moves the debt into cheques under collection, not the bank', () => {
    const lines = chequeLines('receive', base)
    expect(balanced(lines)).toBe(true)
    const dr = lines.find((l) => l.debit)
    expect(dr.accountId).toBe(CHEQUE_ACCOUNTS[CHEQUE_IN])
    expect(lines.find((l) => l.credit).accountId).toBe('acc-ar')
    expect(lines.some((l) => l.accountId === 'acc-bank1')).toBe(false)
  })

  it('clearing is the only event that touches the bank', () => {
    const lines = chequeLines('clear', base)
    expect(balanced(lines)).toBe(true)
    expect(lines.find((l) => l.debit).accountId).toBe('acc-bank1')
    expect(lines.find((l) => l.credit).accountId).toBe(CHEQUE_ACCOUNTS[CHEQUE_IN])
  })

  it('a bounce puts the receivable back, exactly reversing the receipt', () => {
    const recv = chequeLines('receive', base)
    const bounced = chequeLines('bounce', base)
    expect(balanced(bounced)).toBe(true)
    // Same accounts, opposite sides.
    expect(bounced.find((l) => l.debit).accountId).toBe(recv.find((l) => l.credit).accountId)
    expect(bounced.find((l) => l.credit).accountId).toBe(recv.find((l) => l.debit).accountId)
  })

  it('respects a custom control account instead of assuming acc-ar', () => {
    const lines = chequeLines('receive', { ...base, partyAccountId: 'acc-ar-export' })
    expect(lines.find((l) => l.credit).accountId).toBe('acc-ar-export')
  })
})

describe('an issued cheque is a liability until presented', () => {
  const base = { direction: CHEQUE_OUT, amount: 3200, partyAccountId: 'acc-ap', bankAccountId: 'acc-bank1', number: '77' }

  it('issuing clears the payable into cheques payable', () => {
    const lines = chequeLines('receive', base)
    expect(balanced(lines)).toBe(true)
    expect(lines.find((l) => l.debit).accountId).toBe('acc-ap')
    expect(lines.find((l) => l.credit).accountId).toBe(CHEQUE_ACCOUNTS[CHEQUE_OUT])
    expect(lines.some((l) => l.accountId === 'acc-bank1')).toBe(false)
  })

  it('presentation is what finally leaves the bank', () => {
    const lines = chequeLines('clear', base)
    expect(balanced(lines)).toBe(true)
    expect(lines.find((l) => l.credit).accountId).toBe('acc-bank1')
  })

  it('cancelling restores the payable', () => {
    const lines = chequeLines('cancel', base)
    expect(balanced(lines)).toBe(true)
    expect(lines.find((l) => l.credit).accountId).toBe('acc-ap')
  })

  it('posts nothing for a zero amount rather than an empty entry', () => {
    expect(chequeLines('receive', { ...base, amount: 0 })).toEqual([])
  })

  it('rounds to the fils, so an entry can never be a hundredth out', () => {
    const lines = chequeLines('receive', { ...base, amount: 100.005 })
    expect(lines[0].debit).toBe(100.01)
    expect(balanced(lines)).toBe(true)
  })
})

describe('the register tells you what is coming', () => {
  const asOf = '2026-06-15'
  const c = (id, dueDate, status = 'pending') => ({ id, dueDate, status, amount: 100 })

  it('separates overdue, due within a week, and later', () => {
    const b = chequeBuckets([
      c('a', '2026-06-01'), // overdue
      c('b', '2026-06-18'), // within 7 days
      c('c', '2026-09-01'), // later
    ], asOf)
    expect(b.overdue.map((x) => x.id)).toEqual(['a'])
    expect(b.dueSoon.map((x) => x.id)).toEqual(['b'])
    expect(b.later.map((x) => x.id)).toEqual(['c'])
  })

  it('never calls a settled cheque overdue, however old', () => {
    const b = chequeBuckets([c('old', '2020-01-01', 'cleared'), c('bad', '2020-01-01', 'bounced')], asOf)
    expect(b.overdue).toEqual([])
    expect(b.settled).toHaveLength(2)
  })

  it('counts a cheque due today as due soon, not overdue', () => {
    expect(chequeBuckets([c('t', asOf)], asOf).dueSoon).toHaveLength(1)
  })

  it('totals to the fils', () => {
    expect(chequeTotal([{ amount: 1000.005 }, { amount: 2000.004 }])).toBe(3000.01)
    expect(chequeTotal([])).toBe(0)
  })
})
