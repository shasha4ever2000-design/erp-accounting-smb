import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { advanceBalance } from '../src/utils/employeeAdvances.js'

const g = () => useStore.getState()
const net = (id) => {
  const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }
  return Math.round((b.dr - b.cr) * 100) / 100
}
const balancedAll = () => g().journalEntries.every((je) => {
  const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
  const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
  return Math.round((dr - cr) * 100) / 100 === 0
})

let empId
beforeEach(() => {
  useStore.setState({ employeeAdvances: [], payrollRuns: [], journalEntries: [], auditLog: [], recycleBin: [] })
  g().addEmployee({ name: 'Yusuf Haddad', salary: 8000 })
  empId = g().employees[g().employees.length - 1].id
})

const issue = (over = {}) => g().issueEmployeeAdvance({
  employeeId: empId, employeeName: 'Yusuf Haddad', amount: 1200,
  date: '2026-01-10', bankAccountId: 'acc-bank1', instalment: 300, ...over,
})

// A payroll run carrying one line for our employee, with `loan` already
// deducted from net the way the form computes it.
const payroll = (loan, over = {}) => {
  const gross = 8000
  const run = g().addPayrollRun({
    period: 'Feb 2026', payDate: '2026-02-28',
    lines: [{ employeeId: empId, name: 'Yusuf Haddad', basic: gross, tax: 0, gosi: 0, loan, net: gross - loan }],
    ...over,
  })
  g().processPayrollRun(run.id)
  return run
}

describe('paying an advance out', () => {
  it('is an asset, not a payroll cost', () => {
    issue()
    expect(net('acc-empadv')).toBeCloseTo(1200, 2)
    expect(net('acc-bank1')).toBeCloseTo(-1200, 2)
    expect(net('acc-salary')).toBeCloseTo(0, 2)
  })

  it('starts with the whole amount owed', () => {
    const a = issue()
    expect(advanceBalance(a)).toBe(1200)
    expect(g().advanceOwedBy(empId)).toBe(1200)
    expect(g().totalEmployeeAdvances()).toBe(1200)
  })

  it('refuses an instalment bigger than the advance', () => {
    expect(() => issue({ instalment: 5000 })).toThrow(/EMPADV_INVALID/)
  })

  it('posts nothing when it refuses', () => {
    const before = g().journalEntries.length
    try { issue({ amount: 0 }) } catch { /* expected */ }
    expect(g().journalEntries).toHaveLength(before)
  })
})

describe('payroll recovers it', () => {
  it('credits the advance rather than the employee', () => {
    issue()
    const bankBefore = net('acc-bank1')
    payroll(300)

    expect(net('acc-empadv')).toBeCloseTo(900, 2)   // 1200 less 300
    expect(net('acc-salpay')).toBeCloseTo(-7700, 2) // net pay owed, 8000 less 300
    expect(net('acc-bank1')).toBeCloseTo(bankBefore, 2) // payroll does not pay cash here
  })

  it('does not touch salary expense — recovery is not a cost', () => {
    issue()
    payroll(300)
    expect(net('acc-salary')).toBeCloseTo(8000, 2) // full gross, undiminished
  })

  it('records the repayment against the advance', () => {
    const a = issue()
    payroll(300)
    const after = g().employeeAdvances.find((x) => x.id === a.id)
    expect(after.repayments).toHaveLength(1)
    expect(after.repayments[0]).toMatchObject({ amount: 300, source: 'payroll' })
    expect(advanceBalance(after)).toBe(900)
  })

  it('settles the advance once the last instalment lands', () => {
    const a = issue({ amount: 600, instalment: 300 })
    payroll(300)
    payroll(300)
    const after = g().employeeAdvances.find((x) => x.id === a.id)
    expect(advanceBalance(after)).toBe(0)
    expect(after.status).toBe('settled')
    expect(net('acc-empadv')).toBeCloseTo(0, 2)
  })

  it('never recovers more than is owed', () => {
    issue({ amount: 100, instalment: 100 })
    // The form would offer 100; even asked for 300 the register only credits
    // what the advance actually holds.
    expect(g().advanceDueFor(empId, 300).total).toBe(100)
  })

  it('leaves a run where nobody owes anything exactly as it was', () => {
    payroll(0)
    const je = g().journalEntries.find((e) => e.type === 'payroll')
    expect(je.lines.some((l) => l.accountId === 'acc-empadv')).toBe(false)
    expect(net('acc-salpay')).toBeCloseTo(-8000, 2)
  })

  it('keeps every entry balanced across issue and recovery', () => {
    issue()
    payroll(300)
    expect(balancedAll()).toBe(true)
  })
})

describe('cash repayment outside payroll', () => {
  it('returns the money and reduces what is owed', () => {
    const a = issue()
    g().repayEmployeeAdvance(a.id, { amount: 500, date: '2026-03-01' })
    expect(net('acc-empadv')).toBeCloseTo(700, 2)
    expect(net('acc-bank1')).toBeCloseTo(-700, 2)
  })

  it('caps at what is still owed', () => {
    const a = issue({ amount: 400 })
    const r = g().repayEmployeeAdvance(a.id, { amount: 9999 })
    expect(r.amount).toBe(400)
    expect(net('acc-empadv')).toBeCloseTo(0, 2)
  })

  it('refuses when nothing is owed', () => {
    const a = issue({ amount: 200, instalment: 200 })
    g().repayEmployeeAdvance(a.id, { amount: 200 })
    expect(() => g().repayEmployeeAdvance(a.id, { amount: 50 })).toThrow(/EMPADV_NOTHING_OWED/)
  })
})

describe('writing one off', () => {
  it('is the point at which it becomes a cost', () => {
    const a = issue({ amount: 500, instalment: 0 })
    g().writeOffEmployeeAdvance(a.id, { date: '2026-06-01', reason: 'Left without notice' })

    expect(net('acc-empadv')).toBeCloseTo(0, 2)
    expect(net('acc-salary')).toBeCloseTo(500, 2)
    const after = g().employeeAdvances.find((x) => x.id === a.id)
    expect(after.status).toBe('written_off')
    expect(after.writeOffReason).toBe('Left without notice')
  })

  it('drops out of what is outstanding', () => {
    const a = issue()
    g().writeOffEmployeeAdvance(a.id, {})
    expect(g().totalEmployeeAdvances()).toBe(0)
    expect(g().advanceDueFor(empId).total).toBe(0)
  })
})

describe('deleting', () => {
  it('recycles an untouched advance', () => {
    const a = issue()
    g().deleteEmployeeAdvance(a.id)
    expect(g().employeeAdvances).toHaveLength(0)
    expect(g().recycleBin.some((e) => e.recordId === a.id)).toBe(true)
  })

  it('refuses once payroll has recovered any of it', () => {
    const a = issue()
    payroll(300)
    expect(() => g().deleteEmployeeAdvance(a.id)).toThrow(/EMPADV_IN_USE/)
  })
})
