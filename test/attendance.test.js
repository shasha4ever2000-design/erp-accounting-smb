import { describe, it, expect } from 'vitest'
import {
  DAY_STATUSES, statusMeta, isPaidStatus, isWorkedStatus,
  monthDays, weekdayOf, periodOf, blankSheet, sheetFor,
  summarise, payrollImpact, leaveBalance, validateDay, monthOverview,
} from '../src/utils/attendance.js'

const contract = (patch = {}) => ({
  basic: 6000, housing: 1500, transport: 500, other: 0,
  startDate: '2024-01-01', workDaysPerWeek: 5, dailyHours: 8,
  annualLeaveDays: 21, overtimeMultiplier: 1.5, ...patch,
})

describe('the status list', () => {
  it('knows which days are paid', () => {
    expect(isPaidStatus('annual')).toBe(true)
    expect(isPaidStatus('sick')).toBe(true)
    expect(isPaidStatus('absent')).toBe(false)
    expect(isPaidStatus('unpaid')).toBe(false)
  })

  it('knows which days are actually worked', () => {
    expect(isWorkedStatus('present')).toBe(true)
    expect(isWorkedStatus('remote')).toBe(true)
    expect(isWorkedStatus('annual')).toBe(false)
  })

  it('only draws annual leave down from annual leave', () => {
    expect(DAY_STATUSES.filter((s) => s.leave).map((s) => s.id)).toEqual(['annual'])
  })

  it('says nothing about a status it does not know', () => {
    expect(statusMeta('teleported')).toBeNull()
  })
})

describe('the calendar', () => {
  it('gives every day of a month', () => {
    expect(monthDays('2026-02')).toHaveLength(28)
    expect(monthDays('2024-02')).toHaveLength(29)     // leap year
    expect(monthDays('2026-07')).toHaveLength(31)
    expect(monthDays('2026-07')[0]).toBe('2026-07-01')
  })

  it('returns nothing for rubbish', () => {
    expect(monthDays('July')).toEqual([])
    expect(monthDays(null)).toEqual([])
  })

  it('reads the weekday in UTC so it does not drift with the browser', () => {
    expect(weekdayOf('2026-07-26')).toBe(0)          // a Sunday
    expect(weekdayOf('2026-07-31')).toBe(5)          // a Friday
  })

  it('reads the period off a date', () => {
    expect(periodOf('2026-07-26')).toBe('2026-07')
  })
})

describe('blankSheet', () => {
  it('pre-fills the weekly rest days and leaves the rest unmarked', () => {
    // Marking eight rest days by hand every month is how a sheet stops
    // being used at all.
    const sheet = blankSheet('e1', '2026-07', { restDays: [5, 6] })
    const fri = sheet.find((d) => d.date === '2026-07-31')
    const mon = sheet.find((d) => d.date === '2026-07-27')
    expect(fri.status).toBe('rest')
    expect(mon.status).toBe('')
  })

  it('takes a different working week', () => {
    const sheet = blankSheet('e1', '2026-07', { restDays: [0] })
    expect(sheet.find((d) => d.date === '2026-07-26').status).toBe('rest')
    expect(sheet.find((d) => d.date === '2026-07-31').status).toBe('')
  })
})

describe('sheetFor', () => {
  it('lays existing records over the blank month', () => {
    const records = [{ employeeId: 'e1', date: '2026-07-06', status: 'absent' }]
    const sheet = sheetFor('e1', '2026-07', records)
    expect(sheet.find((d) => d.date === '2026-07-06').status).toBe('absent')
    expect(sheet).toHaveLength(31)
  })

  it('ignores another employee and another month', () => {
    const records = [
      { employeeId: 'e2', date: '2026-07-06', status: 'absent' },
      { employeeId: 'e1', date: '2026-06-06', status: 'absent' },
    ]
    expect(sheetFor('e1', '2026-07', records).every((d) => d.status !== 'absent')).toBe(true)
  })
})

describe('summarise — an unmarked day is not an absence', () => {
  const days = [
    { status: 'present', hours: 8 },
    { status: 'present', hours: 8, overtimeHours: 2, lateMinutes: 15 },
    { status: 'absent' },
    { status: 'annual' },
    { status: 'rest' },
    { status: '' },
    { status: '' },
  ]

  it('counts unmarked days as unmarked, and docks nothing for them', () => {
    // Otherwise every day the office forgot the sheet costs someone a day's pay.
    const s = summarise(days)
    expect(s.unmarked).toBe(2)
    expect(s.unpaidDays).toBe(1)
  })

  it('counts only real absence as unpaid', () => {
    const s = summarise(days)
    expect(s.counts.absent).toBe(1)
    expect(s.counts.annual).toBe(1)
    expect(s.unpaidDays).toBe(1)          // annual leave is paid
  })

  it('adds up hours, overtime and lateness', () => {
    const s = summarise(days)
    expect(s.hours).toBe(16)
    expect(s.overtimeHours).toBe(2)
    expect(s.lateMinutes).toBe(15)
  })

  it('counts worked days', () => {
    expect(summarise(days).workedDays).toBe(2)
  })

  it('treats an unrecognised status as unmarked rather than guessing', () => {
    expect(summarise([{ status: 'teleported' }]).unmarked).toBe(1)
  })

  it('handles an empty sheet', () => {
    const s = summarise([])
    expect(s.total).toBe(0)
    expect(s.unpaidDays).toBe(0)
  })
})

describe('payrollImpact', () => {
  const s = summarise([
    { status: 'absent' }, { status: 'absent' },
    { status: 'present', hours: 8, overtimeHours: 4, lateMinutes: 90 },
  ])

  it('docks absence at the daily rate', () => {
    const i = payrollImpact(s, contract(), { daysInMonth: 30 })
    expect(i.dailyRate).toBe(266.67)
    expect(i.absenceDeduction).toBe(533.34)
  })

  it('pays overtime at the contract multiplier', () => {
    const i = payrollImpact(s, contract(), { daysInMonth: 30 })
    expect(i.hourlyRate).toBeCloseTo(46.67, 1)
    expect(i.overtimePay).toBeCloseTo(280, 0)     // 4 h × 46.67 × 1.5
  })

  it('reports lateness but never docks it unasked', () => {
    // Docking by the minute is a policy decision with legal limits, so it
    // cannot be the default.
    const i = payrollImpact(s, contract(), { daysInMonth: 30 })
    expect(i.lateMinutes).toBe(90)
    expect(i.lateDeduction).toBe(0)
  })

  it('docks lateness when the company turns it on, past the grace period', () => {
    const i = payrollImpact(s, contract(), { daysInMonth: 30, deductLate: true, lateGraceMinutes: 30 })
    expect(i.chargeableLate).toBe(60)
    expect(i.lateDeduction).toBeCloseTo(46.67, 1)
  })

  it('charges a day off marginally less in a longer month', () => {
    const short = payrollImpact(s, contract(), { daysInMonth: 30 }).absenceDeduction
    const long = payrollImpact(s, contract(), { daysInMonth: 31 }).absenceDeduction
    expect(long).toBeLessThan(short)
  })

  it('costs nothing on a clean month', () => {
    const clean = summarise([{ status: 'present', hours: 8 }, { status: 'rest' }])
    const i = payrollImpact(clean, contract(), { daysInMonth: 30 })
    expect(i.absenceDeduction).toBe(0)
    expect(i.net).toBe(0)
  })
})

describe('leaveBalance', () => {
  it('accrues leave over the year rather than granting it all on day one', () => {
    const b = leaveBalance(contract({ startDate: '2026-01-01', annualLeaveDays: 21 }), [], { asAt: '2026-07-01' })
    expect(b.accrued).toBeGreaterThan(9)
    expect(b.accrued).toBeLessThan(12)
    expect(b.entitlement).toBe(21)
  })

  it('deducts the days already taken this leave year', () => {
    const records = [
      { employeeId: 'e1', date: '2026-03-02', status: 'annual' },
      { employeeId: 'e1', date: '2026-03-03', status: 'annual' },
      { employeeId: 'e1', date: '2026-03-04', status: 'sick' },   // not annual leave
    ]
    const b = leaveBalance(contract({ startDate: '2026-01-01' }), records, { asAt: '2026-07-01', employeeId: 'e1' })
    expect(b.taken).toBe(2)
    expect(b.remaining).toBe(Math.round((b.accrued - 2) * 10) / 10)
  })

  it('starts a fresh leave year on the anniversary', () => {
    const b = leaveBalance(contract({ startDate: '2024-03-01' }), [], { asAt: '2026-04-01' })
    expect(b.yearStart >= '2026-02-01').toBe(true)
  })

  it('ignores the leave of another employee', () => {
    const records = [{ employeeId: 'e2', date: '2026-03-02', status: 'annual' }]
    expect(leaveBalance(contract({ startDate: '2026-01-01' }), records, { asAt: '2026-07-01', employeeId: 'e1' }).taken).toBe(0)
  })

  it('is nil before someone starts', () => {
    expect(leaveBalance(contract({ startDate: '2027-01-01' }), [], { asAt: '2026-07-01' }).accrued).toBe(0)
  })
})

describe('validateDay', () => {
  it('accepts an ordinary day', () => {
    expect(validateDay({ status: 'present', hours: 8, overtimeHours: 2 }).ok).toBe(true)
  })
  it('refuses a status it does not know', () => {
    expect(validateDay({ status: 'teleported' }).ok).toBe(false)
  })
  it('refuses impossible hours', () => {
    expect(validateDay({ status: 'present', hours: 30 }).ok).toBe(false)
    expect(validateDay({ status: 'present', lateMinutes: -5 }).ok).toBe(false)
  })
  it('refuses overtime on a day nobody worked', () => {
    const r = validateDay({ status: 'annual', overtimeHours: 3 })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/not worked/)
  })
  it('accepts a blank day', () => {
    expect(validateDay({ status: '' }).ok).toBe(true)
  })
})

describe('monthOverview', () => {
  it('gives one row per employee', () => {
    const employees = [{ id: 'e1', name: 'Sara' }, { id: 'e2', name: 'Omar' }]
    const records = [{ employeeId: 'e1', date: '2026-07-06', status: 'absent' }]
    const rows = monthOverview(employees, records, '2026-07')
    expect(rows).toHaveLength(2)
    expect(rows[0].summary.unpaidDays).toBe(1)
    expect(rows[1].summary.unpaidDays).toBe(0)
  })
})
