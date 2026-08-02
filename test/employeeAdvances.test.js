import { describe, it, expect } from 'vitest'
import {
  ADVANCE_ACCOUNT, advanceBalance, repaidTotal, isSettled, openFor, owedBy,
  totalOutstanding, validateAdvance, dueFromPayroll, runsRemaining,
  issueLines, repayLines, writeOffLines,
} from '../src/utils/employeeAdvances.js'

const adv = (over = {}) => ({
  id: 'a1', employeeId: 'e1', amount: 1000, date: '2026-01-10',
  instalment: 300, repayments: [], status: 'open', ...over,
})

const balanced = (lines) => {
  const dr = lines.reduce((s, l) => s + (l.debit || 0), 0)
  const cr = lines.reduce((s, l) => s + (l.credit || 0), 0)
  return Math.round((dr - cr) * 100) / 100 === 0
}

describe('what is still owed', () => {
  it('starts at the full amount', () => {
    expect(advanceBalance(adv())).toBe(1000)
  })

  it('falls as repayments land', () => {
    const a = adv({ repayments: [{ amount: 300 }, { amount: 300 }] })
    expect(repaidTotal(a)).toBe(600)
    expect(advanceBalance(a)).toBe(400)
  })

  it('is settled once fully repaid', () => {
    expect(isSettled(adv({ repayments: [{ amount: 1000 }] }))).toBe(true)
  })

  it('is settled when written off, whatever the balance', () => {
    expect(isSettled(adv({ status: 'written_off' }))).toBe(true)
  })

  it('totals only what is still open', () => {
    const rows = [adv(), adv({ id: 'a2', amount: 500, repayments: [{ amount: 500 }] })]
    expect(totalOutstanding(rows)).toBe(1000)
  })

  it('sums per employee and ignores everyone else', () => {
    const rows = [adv(), adv({ id: 'a2', employeeId: 'e2', amount: 900 })]
    expect(owedBy(rows, 'e1')).toBe(1000)
    expect(openFor(rows, 'e2')).toHaveLength(1)
  })

  it('tolerates missing input', () => {
    expect(advanceBalance()).toBe(0)
    expect(totalOutstanding()).toBe(0)
    expect(owedBy(undefined, 'e1')).toBe(0)
  })
})

describe('validation', () => {
  const good = { employeeId: 'e1', amount: 1000, date: '2026-01-10', bankAccountId: 'acc-bank1', instalment: 300 }

  it('accepts a complete advance', () => {
    expect(validateAdvance(good).ok).toBe(true)
  })

  it('allows no instalment — deducted in one go or by hand', () => {
    expect(validateAdvance({ ...good, instalment: '' }).ok).toBe(true)
  })

  it('refuses an instalment larger than the advance, and explains', () => {
    const r = validateAdvance({ ...good, instalment: 1500 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/larger than the advance/i)
  })

  it('refuses the obvious omissions', () => {
    expect(validateAdvance({ ...good, employeeId: '' }).ok).toBe(false)
    expect(validateAdvance({ ...good, amount: 0 }).ok).toBe(false)
    expect(validateAdvance({ ...good, date: '' }).ok).toBe(false)
    expect(validateAdvance({ ...good, bankAccountId: '' }).ok).toBe(false)
    expect(validateAdvance({ ...good, instalment: -5 }).ok).toBe(false)
  })
})

describe('what payroll deducts', () => {
  it('takes the instalment', () => {
    const r = dueFromPayroll([adv()], 'e1')
    expect(r.total).toBe(300)
    expect(r.parts).toEqual([{ advanceId: 'a1', amount: 300 }])
  })

  it('never overshoots — the last instalment is whatever is left', () => {
    // 1,000 at 300 a month: 300, 300, 300, then 100.
    const nearlyDone = adv({ repayments: [{ amount: 900 }] })
    expect(dueFromPayroll([nearlyDone], 'e1').total).toBe(100)
  })

  it('deducts the whole balance when there is no instalment', () => {
    expect(dueFromPayroll([adv({ instalment: 0 })], 'e1').total).toBe(1000)
  })

  it('clears the oldest advance first', () => {
    const rows = [
      adv({ id: 'newer', date: '2026-06-01', instalment: 100 }),
      adv({ id: 'older', date: '2026-01-01', instalment: 100 }),
    ]
    expect(dueFromPayroll(rows, 'e1').parts[0].advanceId).toBe('older')
  })

  it('spreads across advances but respects a cap', () => {
    const rows = [
      adv({ id: 'a', date: '2026-01-01', instalment: 300 }),
      adv({ id: 'b', date: '2026-02-01', instalment: 300 }),
    ]
    const r = dueFromPayroll(rows, 'e1', { cap: 400 })
    expect(r.total).toBe(400)
    expect(r.parts).toEqual([{ advanceId: 'a', amount: 300 }, { advanceId: 'b', amount: 100 }])
  })

  it('deducts nothing when the cap is nothing — pay cannot go negative', () => {
    expect(dueFromPayroll([adv()], 'e1', { cap: 0 }).total).toBe(0)
  })

  it('ignores settled and written-off advances', () => {
    const rows = [
      adv({ id: 'done', repayments: [{ amount: 1000 }] }),
      adv({ id: 'gone', status: 'written_off' }),
    ]
    expect(dueFromPayroll(rows, 'e1').total).toBe(0)
  })

  it('deducts nothing for an employee with no advances', () => {
    expect(dueFromPayroll([adv()], 'someone-else')).toEqual({ total: 0, parts: [] })
  })
})

describe('runsRemaining', () => {
  it('counts the instalments left, rounding up for the stub', () => {
    expect(runsRemaining(adv())).toBe(4)                                  // 1000 / 300
    expect(runsRemaining(adv({ repayments: [{ amount: 900 }] }))).toBe(1) // 100 left
  })

  it('is zero once settled', () => {
    expect(runsRemaining(adv({ repayments: [{ amount: 1000 }] }))).toBe(0)
  })

  it('is unknown without an instalment', () => {
    expect(runsRemaining(adv({ instalment: 0 }))).toBeNull()
  })
})

describe('the ledger', () => {
  it('paying one out is an asset, not an expense', () => {
    const lines = issueLines(1000, 'acc-bank1', 'Advance')
    expect(balanced(lines)).toBe(true)
    expect(lines.find((l) => l.debit).accountId).toBe(ADVANCE_ACCOUNT)
    expect(lines.some((l) => l.accountId === 'acc-salary')).toBe(false)
  })

  it('cash back reverses it', () => {
    const lines = repayLines(300, 'acc-bank1', 'Repayment')
    expect(balanced(lines)).toBe(true)
    expect(lines.find((l) => l.credit).accountId).toBe(ADVANCE_ACCOUNT)
  })

  it('writing one off is where it finally becomes a cost', () => {
    const lines = writeOffLines(400, 'acc-salary', 'Written off')
    expect(balanced(lines)).toBe(true)
    expect(lines.find((l) => l.debit).accountId).toBe('acc-salary')
  })

  it('posts nothing for a zero amount', () => {
    expect(issueLines(0, 'acc-bank1', 'x')).toEqual([])
    expect(repayLines(0, 'acc-bank1', 'x')).toEqual([])
    expect(writeOffLines(0, 'acc-salary', 'x')).toEqual([])
  })
})
