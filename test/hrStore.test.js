import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { EOSB_ACCOUNTS } from '../src/utils/endOfService.js'

const g = () => useStore.getState()
const migrate = useStore.persist.getOptions().migrate

const balanceOf = (accountId) => {
  let bal = 0
  g().journalEntries.forEach((j) => (j.lines || []).forEach((l) => {
    if (l.accountId === accountId) bal += (l.debit || 0) - (l.credit || 0)
  }))
  return Math.round(bal * 100) / 100
}

beforeEach(() => {
  useStore.setState((s) => ({
    employees: [], employmentContracts: [], eosbAccruals: [], attendance: [],
    journalEntries: [],
    settings: { ...s.settings, hr: { eosb: { rule: 'saudi', daysPerYear: 21, wageBasis: 'contributory' }, restDays: [5, 6], deductLate: false, lateGraceMinutes: 0 } },
  }))
})

const hire = (name = 'Sara') => g().addEmployee({ name, status: 'active' }) ||
  g().employees[g().employees.length - 1]

const contractFor = (employeeId, patch = {}) => g().addContract({
  employeeId, startDate: '2020-01-01', type: 'unlimited',
  basic: 6000, housing: 1500, transport: 500, other: 0,
  workDaysPerWeek: 5, dailyHours: 8, annualLeaveDays: 21, overtimeMultiplier: 1.5,
  ...patch,
})

describe('contracts', () => {
  it('records a contract and finds it by date', () => {
    hire()
    const e = g().employees[0]
    contractFor(e.id)
    expect(g().contractFor(e.id, '2026-07-01').basic).toBe(6000)
  })

  it('refuses two live contracts covering the same day', () => {
    hire()
    const e = g().employees[0]
    contractFor(e.id)
    expect(() => contractFor(e.id, { startDate: '2022-01-01' })).toThrow(/CONTRACT_INVALID/)
    expect(g().employmentContracts).toHaveLength(1)
  })

  it('lets a pay rise be a new contract once the old one is ended', () => {
    hire()
    const e = g().employees[0]
    const first = contractFor(e.id)
    g().updateContract(first.id, { endDate: '2025-12-31' })
    contractFor(e.id, { startDate: '2026-01-01', basic: 9000 })

    expect(g().contractFor(e.id, '2025-06-01').basic).toBe(6000)
    expect(g().contractFor(e.id, '2026-06-01').basic).toBe(9000)
  })

  it('dates service from the first contract, so a renewal does not reset it', () => {
    hire()
    const e = g().employees[0]
    const first = contractFor(e.id)
    g().updateContract(first.id, { endDate: '2025-12-31' })
    contractFor(e.id, { startDate: '2026-01-01', basic: 9000 })
    expect(g().serviceStartFor(e.id)).toBe('2020-01-01')
  })
})

describe('end-of-service', () => {
  it('computes an award on basic plus housing', () => {
    hire()
    const e = g().employees[0]
    contractFor(e.id)
    const a = g().eosbFor(e.id, { asAt: '2026-01-01' })
    expect(a.wage).toBe(7500)
    expect(a.award).toBeGreaterThan(26000)
  })

  it('returns nothing for someone with no contract', () => {
    hire()
    expect(g().eosbFor(g().employees[0].id)).toBeNull()
  })

  it('posts a balanced accrual into expense and provision', () => {
    hire()
    const e = g().employees[0]
    contractFor(e.id)
    const rec = g().postEosbAccrual('2026-01-01')

    expect(rec.total).toBeGreaterThan(0)
    expect(balanceOf(EOSB_ACCOUNTS.expense)).toBeCloseTo(rec.total, 2)
    expect(balanceOf(EOSB_ACCOUNTS.provision)).toBeCloseTo(-rec.total, 2)
  })

  it('posts only the top-up the second time, not the whole balance again', () => {
    hire()
    const e = g().employees[0]
    contractFor(e.id)
    const first = g().postEosbAccrual('2026-01-01')
    const second = g().postEosbAccrual('2026-07-01')

    expect(second.total).toBeGreaterThan(0)
    expect(second.total).toBeLessThan(first.total)
    expect(balanceOf(EOSB_ACCOUNTS.provision)).toBeCloseTo(-(first.total + second.total), 2)
  })

  it('refuses to post when the provision is already up to date', () => {
    hire()
    const e = g().employees[0]
    contractFor(e.id)
    g().postEosbAccrual('2026-01-01')
    expect(() => g().postEosbAccrual('2026-01-01')).toThrow(/EOSB_NOTHING_TO_POST/)
  })

  it('does nothing at all when the scheme is off', () => {
    useStore.setState((s) => ({ settings: { ...s.settings, hr: { ...s.settings.hr, eosb: { rule: 'none' } } } }))
    hire()
    contractFor(g().employees[0].id)
    expect(g().eosbSchedule('2026-01-01').total).toBe(0)
    expect(() => g().postEosbAccrual('2026-01-01')).toThrow(/EOSB_NOTHING_TO_POST/)
  })

  it('settles a leaver: releases the provision, pays the award, ends the contract', () => {
    hire()
    const e = g().employees[0]
    contractFor(e.id)
    const accrual = g().postEosbAccrual('2026-01-01')
    const res = g().settleEosb(e.id, { asAt: '2026-01-01', reason: 'termination' })

    expect(res.award.award).toBeCloseTo(accrual.total, 2)
    // Provision back to nil, and what is owed sits in salaries payable.
    expect(balanceOf(EOSB_ACCOUNTS.provision)).toBeCloseTo(0, 2)
    expect(balanceOf('acc-salpay')).toBeCloseTo(-res.award.award, 2)

    expect(g().employmentContracts[0].status).toBe('terminated')
    expect(g().employees[0].status).toBe('inactive')
  })

  it('releases the over-provision when somebody resigns early', () => {
    // Three years' service resigning takes a third; the other two thirds of
    // the provision has to come back rather than sit on the balance sheet.
    hire()
    const e = g().employees[0]
    contractFor(e.id, { startDate: '2023-01-01' })
    g().postEosbAccrual('2026-01-01')
    const before = balanceOf(EOSB_ACCOUNTS.expense)

    const res = g().settleEosb(e.id, { asAt: '2026-01-01', reason: 'resignation' })
    expect(res.award.factor).toBeCloseTo(1 / 3, 5)
    expect(balanceOf(EOSB_ACCOUNTS.provision)).toBeCloseTo(0, 2)
    expect(balanceOf(EOSB_ACCOUNTS.expense)).toBeLessThan(before)
  })

  it('leaves no provision behind for someone already settled', () => {
    hire()
    const e = g().employees[0]
    contractFor(e.id)
    g().postEosbAccrual('2026-01-01')
    g().settleEosb(e.id, { asAt: '2026-01-01' })
    expect(g().eosbProvidedFor(e.id)).toBeCloseTo(0, 2)
  })
})

describe('attendance', () => {
  it('gives a full month, with rest days pre-filled', () => {
    hire()
    const e = g().employees[0]
    const sheet = g().attendanceSheet(e.id, '2026-07')
    expect(sheet).toHaveLength(31)
    expect(sheet.find((d) => d.date === '2026-07-31').status).toBe('rest')   // a Friday
  })

  it('stores only the days that say something', () => {
    hire()
    const e = g().employees[0]
    const sheet = g().attendanceSheet(e.id, '2026-07')
    const n = g().saveAttendanceSheet(e.id, '2026-07', sheet.map((d) =>
      (d.date === '2026-07-06' ? { ...d, status: 'absent' } : d)))
    // Rest days count too — they were marked. Blank days are not stored.
    expect(n).toBeLessThan(31)
    expect(g().attendance.find((r) => r.date === '2026-07-06').status).toBe('absent')
  })

  it('replaces a month rather than piling records up', () => {
    hire()
    const e = g().employees[0]
    const sheet = g().attendanceSheet(e.id, '2026-07')
    g().saveAttendanceSheet(e.id, '2026-07', sheet)
    const first = g().attendance.length
    g().saveAttendanceSheet(e.id, '2026-07', sheet)
    expect(g().attendance.length).toBe(first)
  })

  it('refuses a day it cannot make sense of', () => {
    hire()
    expect(() => g().setAttendanceDay(g().employees[0].id, '2026-07-06', { status: 'teleported' }))
      .toThrow(/ATTENDANCE_INVALID/)
  })

  it('costs a month against the contract in force', () => {
    hire()
    const e = g().employees[0]
    contractFor(e.id)
    g().setAttendanceDay(e.id, '2026-07-06', { status: 'absent' })
    g().setAttendanceDay(e.id, '2026-07-07', { status: 'present', overtimeHours: 4 })

    const i = g().attendanceImpact(e.id, '2026-07')
    expect(i.absenceDeduction).toBeGreaterThan(0)
    expect(i.overtimePay).toBeGreaterThan(0)
    expect(i.summary.unpaidDays).toBe(1)
  })

  it('never deducts for a day nobody marked', () => {
    // The whole month is blank apart from the pre-filled rest days.
    hire()
    const e = g().employees[0]
    contractFor(e.id)
    const i = g().attendanceImpact(e.id, '2026-07')
    expect(i.absenceDeduction).toBe(0)
    expect(i.summary.unmarked).toBeGreaterThan(0)
  })

  it('says nothing about a month with no contract', () => {
    hire()
    expect(g().attendanceImpact(g().employees[0].id, '2026-07')).toBeNull()
  })
})

describe('the version 31 migration', () => {
  it('gives an upgrading company the new slices and accounts', () => {
    const out = migrate({ settings: {}, accounts: [] }, 30)
    expect(out.employmentContracts).toEqual([])
    expect(out.attendance).toEqual([])
    expect(out.settings.hr.eosb.rule).toBe('none')
    expect(out.accounts.some((a) => a.id === 'acc-eosb-prov')).toBe(true)
    expect(out.accounts.some((a) => a.id === 'acc-eosb-exp')).toBe(true)
  })

  it('leaves the salary on existing employee records alone', () => {
    // Payroll falls back to it, so an upgrading company is not forced to enter
    // every contract before it can pay anyone again.
    const out = migrate({
      settings: {}, accounts: [],
      employees: [{ id: 'e1', name: 'Sara', basicSalary: 5000, status: 'active' }],
    }, 30)
    expect(out.employees[0].basicSalary).toBe(5000)
  })

  it('ships the scheme switched off, so nobody silently gains a liability', () => {
    expect(migrate({ settings: {}, accounts: [] }, 30).settings.hr.eosb.rule).toBe('none')
  })
})

describe('payroll picks up overtime', () => {
  it('puts overtime into gross, so it lands in salary expense', () => {
    // Overtime is earnings. Netting it off somewhere quiet would understate
    // the wage bill and overstate margin.
    hire()
    const e = g().employees[0]
    const run = g().addPayrollRun({
      period: 'July 2026', payDate: '2026-07-31',
      lines: [{
        employeeId: e.id, employeeName: e.name,
        basic: 6000, housing: 1500, transport: 500, other: 0, overtime: 270.96,
        late: 0, absent: 516.12, penalty: 0, gosi: 0, gosiEmployer: 0, tax: 0,
        net: 6000 + 1500 + 500 + 270.96 - 516.12,
      }],
    })
    g().processPayrollRun(run.id)

    // Gross 8,270.96 less the 516.12 not worked = 7,754.84 of salary cost.
    expect(balanceOf('acc-salary')).toBeCloseTo(7754.84, 2)
    const je = g().journalEntries.find((j) => j.id === g().payrollRuns[0].journalEntryId)
    const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
    const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
    expect(Math.round(dr * 100)).toBe(Math.round(cr * 100))
  })
})
