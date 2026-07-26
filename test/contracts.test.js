import { describe, it, expect } from 'vitest'
import {
  emptyContract, grossOf, contributoryWage, probationEnd, serviceYears, describeService,
  contractStatus, contractFor, historyFor, serviceStart, analyseSalary, employerCost,
  dailyRate, hourlyRate, validateContract, attentionList, noticeEnd, addMonths,
} from '../src/utils/contracts.js'

const c = (patch = {}) => emptyContract({
  employeeId: 'e1', startDate: '2024-01-01',
  basic: 6000, housing: 1500, transport: 500, other: 0,
  ...patch,
})

describe('the wage', () => {
  it('adds every component into gross', () => {
    expect(grossOf(c())).toBe(8000)
  })

  it('uses basic plus housing for statutory purposes, not the whole gross', () => {
    // Computing on basic alone understates the award; on gross it overstates.
    expect(contributoryWage(c())).toBe(7500)
  })

  it('survives a contract with nothing in it', () => {
    expect(grossOf(null)).toBe(0)
    expect(contributoryWage({})).toBe(0)
  })
})

describe('dates', () => {
  it('ends probation the right number of months out', () => {
    expect(probationEnd(c({ startDate: '2024-01-15', probationMonths: 3 }))).toBe('2024-04-15')
  })

  it('clamps a month-end start rather than rolling into the next month', () => {
    // 31 January plus one month is 29 February in a leap year, not 2 March.
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
  })

  it('has no probation end when there is no probation', () => {
    expect(probationEnd(c({ probationMonths: 0 }))).toBe('')
  })

  it('measures service in fractional years', () => {
    expect(serviceYears('2024-01-01', '2026-01-01')).toBeCloseTo(2, 1)
    expect(serviceYears('2026-01-01', '2024-01-01')).toBe(0)
  })

  it('describes service the way a person would say it', () => {
    expect(describeService('2024-01-01', '2027-03-05')).toMatch(/3 years/)
    expect(describeService('2026-07-01', '2026-07-10')).toBe('9 days')
  })

  it('counts a notice period from the day notice was given', () => {
    expect(noticeEnd(c({ noticeDays: 30 }), '2026-07-01')).toBe('2026-07-31')
  })
})

describe('contractStatus', () => {
  it('is draft before it starts', () => {
    expect(contractStatus(c({ startDate: '2026-09-01' }), { asAt: '2026-07-01' })).toBe('draft')
  })

  it('is probation inside the probation window', () => {
    expect(contractStatus(c({ startDate: '2026-06-01', probationMonths: 3 }), { asAt: '2026-07-01' })).toBe('probation')
  })

  it('is active once probation has passed', () => {
    expect(contractStatus(c({ startDate: '2024-01-01' }), { asAt: '2026-07-01' })).toBe('active')
  })

  it('warns before a fixed term lapses, not after', () => {
    // Knowing a contract expired last week is not useful.
    expect(contractStatus(c({ type: 'fixed', endDate: '2026-08-15' }), { asAt: '2026-07-01' })).toBe('expiring')
    expect(contractStatus(c({ type: 'fixed', endDate: '2027-08-15' }), { asAt: '2026-07-01' })).toBe('active')
  })

  it('is expired past the end date', () => {
    expect(contractStatus(c({ type: 'fixed', endDate: '2026-06-01' }), { asAt: '2026-07-01' })).toBe('expired')
  })

  it('is terminated whatever the dates say', () => {
    expect(contractStatus(c({ status: 'terminated' }), { asAt: '2026-07-01' })).toBe('terminated')
  })
})

describe('which contract applies', () => {
  const first = { id: 'k1', employeeId: 'e1', startDate: '2024-01-01', endDate: '2025-12-31', basic: 5000 }
  const second = { id: 'k2', employeeId: 'e1', startDate: '2026-01-01', basic: 7000 }
  const other = { id: 'k3', employeeId: 'e2', startDate: '2024-01-01', basic: 4000 }
  const all = [first, second, other]

  it('picks the one in force on the day', () => {
    expect(contractFor('e1', all, '2026-07-01').id).toBe('k2')
    expect(contractFor('e1', all, '2025-06-01').id).toBe('k1')
  })

  it('answers nothing for a date before anyone was hired', () => {
    expect(contractFor('e1', all, '2020-01-01')).toBeNull()
  })

  it('keeps employees apart', () => {
    expect(contractFor('e2', all, '2026-07-01').id).toBe('k3')
  })

  it('lists the history newest first', () => {
    expect(historyFor('e1', all).map((x) => x.id)).toEqual(['k2', 'k1'])
  })

  it('dates service from the first contract, not the current one', () => {
    // A renewal does not reset somebody's service — that would wipe out years
    // of accrued end-of-service every time a contract was re-signed.
    expect(serviceStart('e1', all)).toBe('2024-01-01')
  })
})

describe('analyseSalary', () => {
  it('splits the wage into percentages', () => {
    const a = analyseSalary(c())
    expect(a.gross).toBe(8000)
    expect(a.components.find((x) => x.id === 'basic').pct).toBe(75)
    expect(a.contributoryPct).toBe(93.8)
  })

  it('objects when basic is a small slice of the package', () => {
    const a = analyseSalary(c({ basic: 2000, housing: 500, transport: 0, other: 5500 }))
    expect(a.findings.some((f) => f.level === 'warning' && /Basic is only/.test(f.text))).toBe(true)
  })

  it('objects loudly when there is no basic at all', () => {
    const a = analyseSalary(c({ basic: 0, housing: 0, transport: 0, other: 8000 }))
    expect(a.findings.some((f) => f.level === 'error')).toBe(true)
  })

  it('is quiet about a conventional structure', () => {
    const a = analyseSalary(c({ basic: 6000, housing: 1500, transport: 500, other: 0 }))
    expect(a.findings.filter((f) => f.level !== 'info')).toEqual([])
  })

  it('mentions a thin housing allowance without calling it wrong', () => {
    const a = analyseSalary(c({ basic: 6000, housing: 300, transport: 0, other: 0 }))
    expect(a.findings.some((f) => f.level === 'info' && /Housing is/.test(f.text))).toBe(true)
  })

  it('says something useful about an empty contract', () => {
    const a = analyseSalary(emptyContract())
    expect(a.findings[0].level).toBe('error')
  })
})

describe('costs and rates', () => {
  it('adds the employer contribution to the cost of employing someone', () => {
    const e = employerCost(c({ gosiApplicable: true, gosiEmployerRate: 11 }))
    expect(e.gross).toBe(8000)
    expect(e.gosiEmployer).toBe(825)      // 11% of 7,500
    expect(e.total).toBe(8825)
  })

  it('charges nothing extra when social insurance does not apply', () => {
    expect(employerCost(c()).total).toBe(8000)
  })

  it('divides the month for a daily rate', () => {
    expect(dailyRate(c(), { daysInMonth: 30 })).toBe(266.67)
    expect(dailyRate(c(), { daysInMonth: 31 })).toBe(258.06)
  })

  it('derives the hourly rate from the working week on the contract', () => {
    // 5 days × 8 hours ≈ 171.4 hours a month on a 30-day month.
    expect(hourlyRate(c({ workDaysPerWeek: 5, dailyHours: 8 }), { daysInMonth: 30 })).toBeCloseTo(46.67, 1)
  })
})

describe('validateContract', () => {
  it('accepts an ordinary contract', () => {
    expect(validateContract(c(), []).ok).toBe(true)
  })

  it('needs an employee and a start date', () => {
    expect(validateContract(emptyContract({ basic: 100 }), []).ok).toBe(false)
  })

  it('needs an end date on a fixed term', () => {
    expect(validateContract(c({ type: 'fixed' }), []).ok).toBe(false)
    expect(validateContract(c({ type: 'fixed', endDate: '2027-01-01' }), []).ok).toBe(true)
  })

  it('refuses an end date before the start', () => {
    const r = validateContract(c({ type: 'fixed', endDate: '2023-01-01' }), [])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/before the start/)
  })

  it('refuses probation that outlives the contract', () => {
    const r = validateContract(c({ type: 'fixed', endDate: '2024-02-01', probationMonths: 6 }), [])
    expect(r.errors.join(' ')).toMatch(/past the end/)
  })

  it('refuses a contract with no pay', () => {
    expect(validateContract(emptyContract({ employeeId: 'e1', startDate: '2026-01-01' }), []).ok).toBe(false)
  })

  it('refuses two live contracts covering the same day', () => {
    // Otherwise "what are they paid" has two answers and payroll picks one.
    const existing = [{ id: 'k1', employeeId: 'e1', startDate: '2024-01-01', endDate: '' }]
    const r = validateContract(c({ startDate: '2026-01-01' }), existing)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/overlaps/)
  })

  it('allows a new contract once the previous one has ended', () => {
    const existing = [{ id: 'k1', employeeId: 'e1', startDate: '2024-01-01', endDate: '2025-12-31' }]
    expect(validateContract(c({ startDate: '2026-01-01' }), existing).ok).toBe(true)
  })

  it('lets a contract be edited without overlapping itself', () => {
    const existing = [{ id: 'k1', employeeId: 'e1', startDate: '2024-01-01', endDate: '' }]
    expect(validateContract(c({ startDate: '2024-01-01' }), existing, { id: 'k1' }).ok).toBe(true)
  })

  it('ignores a terminated contract when checking overlap', () => {
    const existing = [{ id: 'k1', employeeId: 'e1', startDate: '2024-01-01', endDate: '', status: 'terminated' }]
    expect(validateContract(c({ startDate: '2025-01-01' }), existing).ok).toBe(true)
  })
})

describe('attentionList', () => {
  const employees = [{ id: 'e1', name: 'Sara' }, { id: 'e2', name: 'Omar' }]

  it('surfaces expiring, expired and ending probation', () => {
    const contracts = [
      { id: 'k1', employeeId: 'e1', type: 'fixed', startDate: '2024-01-01', endDate: '2026-08-01', probationMonths: 0 },
      { id: 'k2', employeeId: 'e2', startDate: '2026-05-01', probationMonths: 3 },
    ]
    const list = attentionList(contracts, employees, { asAt: '2026-07-15' })
    expect(list.map((r) => r.kind)).toContain('expiring')
    expect(list.map((r) => r.kind)).toContain('probation')
    expect(list.find((r) => r.kind === 'expiring').employeeName).toBe('Sara')
  })

  it('puts what has already lapsed above what is merely coming', () => {
    const contracts = [
      { id: 'k1', employeeId: 'e1', type: 'fixed', startDate: '2024-01-01', endDate: '2026-08-01', probationMonths: 0 },
      { id: 'k2', employeeId: 'e2', type: 'fixed', startDate: '2024-01-01', endDate: '2026-06-01', probationMonths: 0 },
    ]
    expect(attentionList(contracts, employees, { asAt: '2026-07-15' })[0].kind).toBe('expired')
  })

  it('says nothing about an open-ended contract running normally', () => {
    const contracts = [{ id: 'k1', employeeId: 'e1', startDate: '2020-01-01', probationMonths: 3 }]
    expect(attentionList(contracts, employees, { asAt: '2026-07-15' })).toEqual([])
  })

  it('does not chase a terminated contract', () => {
    const contracts = [{ id: 'k1', employeeId: 'e1', type: 'fixed', startDate: '2024-01-01', endDate: '2026-06-01', status: 'terminated' }]
    expect(attentionList(contracts, employees, { asAt: '2026-07-15' })).toEqual([])
  })
})
