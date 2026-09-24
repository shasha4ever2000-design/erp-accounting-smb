// Employees, contracts, attendance, payroll, end-of-service and staff advances.
// One slice of the store — see src/store.js for how the slices combine.
import { v4 as uuid } from 'uuid'
import { ADVANCE_ACCOUNT as EMP_ADV_ACCOUNT, validateAdvance as validateEmpAdvance, advanceBalance as empAdvanceBalance, dueFromPayroll, owedBy, totalOutstanding, issueLines as empIssueLines, repayLines as empRepayLines, writeOffLines as empWriteOffLines } from '../utils/employeeAdvances'
import { emptyContract, contractFor as contractInForce, serviceStart as serviceStartOf, validateContract } from '../utils/contracts'
import { defaultEosbSettings, eosbAward, accrualSchedule, accrualLines as eosbAccrualLines, settlementLines as eosbSettlementLines } from '../utils/endOfService'
import { sheetFor, summarise as summariseAttendance, payrollImpact, validateDay, periodOf } from '../utils/attendance'
import { todayISO } from '../utils/localDate'
import { nextNum, keepEntries } from './shared'

export const createHrSlice = (set, get) => ({
  // ─── EMPLOYEE ADVANCES (salary advances / staff loans) ─────────
  //
  // The mirror of a customer advance: money handed over that has not been
  // worked off yet, so an asset rather than a liability. It winds down
  // through payroll — see the deduction in processPayrollRun, which is
  // what stops an advance being a journal entry somebody has to remember
  // every month. See utils/employeeAdvances.js.
  employeeAdvances: [],

  issueEmployeeAdvance: (input) => {
    const check = validateEmpAdvance(input)
    if (!check.ok) throw new Error(`EMPADV_INVALID:${check.error}`)
    const amount = Math.round((Number(input.amount) || 0) * 100) / 100
    const ref = `Advance to ${input.employeeName || ''}`.trim()

    const je = get().addJournalEntry({
      date: input.date, description: ref, type: 'employee_advance',
      lines: empIssueLines(amount, input.bankAccountId, ref),
    })
    const advance = {
      ...input, id: uuid(), amount,
      instalment: Math.round((Number(input.instalment) || 0) * 100) / 100,
      repayments: [], status: 'open',
      journalEntryId: je.id, createdAt: new Date().toISOString(),
    }
    set((s) => ({ employeeAdvances: [...s.employeeAdvances, advance] }))
    get().logActivity('Issued employee advance', `${input.employeeName || ''} · ${amount}`, {
      entity: 'employeeAdvance', entityId: advance.id,
    })
    return advance
  },

  /** Cash handed back outside payroll. */
  repayEmployeeAdvance: (id, { amount, date, bankAccountId } = {}) => {
    const adv = get().employeeAdvances.find((a) => a.id === id)
    if (!adv) return
    const owed = empAdvanceBalance(adv)
    const want = amount == null ? owed : Math.round((Number(amount) || 0) * 100) / 100
    const take = Math.min(owed, want)
    if (take <= 0.005) throw new Error('EMPADV_NOTHING_OWED')
    const bank = bankAccountId || adv.bankAccountId
    if (!bank) throw new Error('EMPADV_NO_BANK')

    const when = date || todayISO()
    const ref = `Advance repayment – ${adv.employeeName || ''}`.trim()
    const je = get().addJournalEntry({
      date: when, description: ref, type: 'employee_advance', lines: empRepayLines(take, bank, ref),
    })
    get()._recordAdvanceRepayments([{ advanceId: id, amount: take }], { date: when, source: 'cash', journalEntryId: je.id })
    return { amount: take, journalEntryId: je.id }
  },

  /** Give up on recovering one — the point at which it becomes a cost. */
  writeOffEmployeeAdvance: (id, { date, expenseAccountId, reason } = {}) => {
    const adv = get().employeeAdvances.find((a) => a.id === id)
    if (!adv) return
    const owed = empAdvanceBalance(adv)
    if (owed <= 0.005) throw new Error('EMPADV_NOTHING_OWED')
    const when = date || todayISO()
    const ref = `Advance written off – ${adv.employeeName || ''}${reason ? ` (${reason})` : ''}`
    const je = get().addJournalEntry({
      date: when, description: ref, type: 'employee_advance',
      lines: empWriteOffLines(owed, expenseAccountId, ref),
    })
    set((s) => ({
      employeeAdvances: s.employeeAdvances.map((a) => (a.id === id
        ? { ...a, status: 'written_off', writeOffJournalEntryId: je.id, writeOffReason: reason || '' } : a)),
    }))
    get().logActivity('Wrote off employee advance', `${adv.employeeName || ''} · ${owed}`, {
      entity: 'employeeAdvance', entityId: id, severity: 'warning',
    })
    return { amount: owed, journalEntryId: je.id }
  },

  /** Shared by the payroll deduction and cash repayment. Posts nothing. */
  _recordAdvanceRepayments: (parts, { date, source, payrollRunId, journalEntryId }) => {
    if (!parts?.length) return
    const by = Object.fromEntries(parts.map((p) => [p.advanceId, p.amount]))
    set((s) => ({
      employeeAdvances: s.employeeAdvances.map((a) => {
        const amt = by[a.id]
        if (!amt) return a
        const repayments = [...(a.repayments || []), { id: uuid(), amount: amt, date, source, payrollRunId, journalEntryId }]
        const settled = (Number(a.amount) || 0) - repayments.reduce((x, r) => x + r.amount, 0) <= 0.005
        return { ...a, repayments, status: settled ? 'settled' : a.status }
      }),
    }))
  },

  /** What payroll should take off one employee this run. */
  advanceDueFor: (employeeId, cap) => dueFromPayroll(get().employeeAdvances, employeeId, { cap }),

  /** What an employee still owes, for the payroll form and the register. */
  advanceOwedBy: (employeeId) => owedBy(get().employeeAdvances, employeeId),

  totalEmployeeAdvances: () => totalOutstanding(get().employeeAdvances),

  deleteEmployeeAdvance: (id) => {
    const adv = get().employeeAdvances.find((a) => a.id === id)
    if (!adv) return
    if ((adv.repayments || []).length > 0 || adv.status === 'written_off')
      throw new Error('EMPADV_IN_USE')
    get().recycleRecord('employeeAdvances', id)
    set((s) => ({ employeeAdvances: s.employeeAdvances.filter((a) => a.id !== id) }))
    get().logActivity('Deleted employee advance', `${adv.employeeName || ''}`, {
      entity: 'employeeAdvance', entityId: id, severity: 'warning',
    })
  },

  // ─── DEPARTMENTS ───────────────────────────────────────────────
  departments: [],

  addDepartment: (dept) =>
    set((s) => ({ departments: [...s.departments, { ...dept, id: uuid(), createdAt: new Date().toISOString() }] })),

  updateDepartment: (id, patch) =>
    set((s) => ({ departments: s.departments.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),

  deleteDepartment: (id) => {
    get().recycleRecord('departments', id)
    return set((s) => ({ departments: s.departments.filter((d) => d.id !== id) }))
  },

  // ─── EMPLOYEES ─────────────────────────────────────────────────
  employees: [],

  addEmployee: (emp) =>
    set((s) => ({ employees: [...s.employees, { ...emp, id: uuid(), createdAt: new Date().toISOString() }] })),

  updateEmployee: (id, patch) => {
    const before = get().employees.find((e) => e.id === id)
    set((s) => ({ employees: s.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
    get().logChange('Updated employee', before, get().employees.find((e) => e.id === id), { entity: 'employee' })
  },

  deleteEmployee: (id) => {
    get().recycleRecord('employees', id)
    const gone = get().employees.find((e) => e.id === id)
    set((s) => ({ employees: s.employees.filter((e) => e.id !== id) }))
    if (gone) get().logActivity('Deleted employee', gone.name || '', { entity: 'employee', entityId: id, entityRef: gone.name })
  },

  // ─── EMPLOYMENT CONTRACTS ──────────────────────────────────────
  //
  // An employee has a history of contracts and exactly one is in force on
  // any day. A pay rise is a new contract, not an edit — which is what
  // makes "what were they on last March" answerable, and what makes an
  // end-of-service figure defensible.
  employmentContracts: [],

  addContract: (data) => {
    const check = validateContract(data, get().employmentContracts)
    if (!check.ok) throw new Error(`CONTRACT_INVALID: ${check.errors.join(' ')}`)
    const c = { ...emptyContract(), ...data, id: uuid(), createdAt: new Date().toISOString() }
    set((s) => ({ employmentContracts: [...s.employmentContracts, c] }))
    get().logActivity('Added contract', `${get().employees.find((e) => e.id === c.employeeId)?.name || ''}`)
    return c
  },

  updateContract: (id, patch) => {
    const before = get().employmentContracts.find((c) => c.id === id)
    if (!before) return null
    const merged = { ...before, ...patch }
    const check = validateContract(merged, get().employmentContracts, { id })
    if (!check.ok) throw new Error(`CONTRACT_INVALID: ${check.errors.join(' ')}`)
    set((s) => ({ employmentContracts: s.employmentContracts.map((c) => (c.id === id ? merged : c)) }))
    get().logChange('Updated contract', before, merged, { entity: 'contract' })
    return merged
  },

  deleteContract: (id) => {
    const gone = get().employmentContracts.find((c) => c.id === id)
    set((s) => ({ employmentContracts: s.employmentContracts.filter((c) => c.id !== id) }))
    if (gone) get().logActivity('Deleted contract', gone.employeeId)
  },

  /** The contract in force for someone on a date (today by default). */
  contractFor: (employeeId, asAt) =>
    contractInForce(employeeId, get().employmentContracts, asAt || todayISO()),

  /** When service began — the earliest contract, not the current one. */
  serviceStartFor: (employeeId) => serviceStartOf(employeeId, get().employmentContracts),

  // ─── END-OF-SERVICE ────────────────────────────────────────────
  eosbAccruals: [],

  eosbSettings: () => ({ ...defaultEosbSettings(), ...(get().settings.hr?.eosb || {}) }),

  /** What is owed if this person left today (or on a given day). */
  eosbFor: (employeeId, { asAt, reason = 'termination' } = {}) => {
    const cfg = get().eosbSettings()
    const at = asAt || todayISO()
    const contract = get().contractFor(employeeId, at)
    if (!contract) return null
    return eosbAward(contract, {
      serviceStart: get().serviceStartFor(employeeId), asAt: at, reason,
      rule: cfg.rule, daysPerYear: cfg.daysPerYear, wageBasis: cfg.wageBasis,
    })
  },

  /** What has been provided for one employee so far, from posted accruals. */
  eosbProvidedFor: (employeeId) =>
    Math.round(get().eosbAccruals
      .filter((a) => a.status === 'posted')
      .reduce((s, a) => s + ((a.lines || []).find((l) => l.employeeId === employeeId)?.movement || 0), 0) * 100) / 100,

  /** The accrual due for a period, per employee — nothing is posted yet. */
  eosbSchedule: (asAt) => {
    const cfg = get().eosbSettings()
    const at = asAt || todayISO()
    if (cfg.rule === 'none') return { lines: [], total: 0, closing: 0 }
    const rows = get().employees
      .filter((e) => e.status === 'active')
      .map((e) => {
        const contract = get().contractFor(e.id, at)
        if (!contract) return null
        return {
          employeeId: e.id, employeeName: e.name, contract,
          serviceStart: get().serviceStartFor(e.id),
          alreadyProvided: get().eosbProvidedFor(e.id),
        }
      })
      .filter(Boolean)
    return accrualSchedule(rows, { to: at, rule: cfg.rule, daysPerYear: cfg.daysPerYear, wageBasis: cfg.wageBasis })
  },

  /** Post the accrual: Dr end-of-service expense, Cr the provision. */
  postEosbAccrual: (asAt, { period = '' } = {}) => {
    const at = asAt || todayISO()
    const schedule = get().eosbSchedule(at)
    if (!schedule.lines.length || Math.abs(schedule.total) < 0.005)
      throw new Error('EOSB_NOTHING_TO_POST')
    const label = period || at.slice(0, 7)
    const je = get().addJournalEntry({
      date: at,
      description: `End-of-service accrual — ${label}`,
      reference: label, type: 'eosb_accrual',
      lines: eosbAccrualLines(schedule.total, { reference: label }),
    })
    const record = {
      id: uuid(), date: at, period: label, status: 'posted',
      total: schedule.total, closing: schedule.closing,
      lines: schedule.lines, journalEntryId: je.id,
      createdAt: new Date().toISOString(),
    }
    set((s) => ({ eosbAccruals: [...s.eosbAccruals, record] }))
    get().logActivity('Posted end-of-service accrual', label)
    return record
  },

  deleteEosbAccrual: (id) =>
    set((s) => {
      const rec = s.eosbAccruals.find((a) => a.id === id)
      get().assertJEsUnlocked(rec?.journalEntryId)
      return {
        eosbAccruals: s.eosbAccruals.filter((a) => a.id !== id),
        journalEntries: keepEntries(s.journalEntries, (j) => j.id !== rec?.journalEntryId),
      }
    }),

  /**
   * Settle a leaver: release their provision, charge or credit the
   * difference, and put what they are owed into salaries payable.
   */
  settleEosb: (employeeId, { asAt, reason = 'termination', endContract = true } = {}) => {
    const at = asAt || todayISO()
    const award = get().eosbFor(employeeId, { asAt: at, reason })
    if (!award) throw new Error('EOSB_NO_CONTRACT')
    const provided = get().eosbProvidedFor(employeeId)
    const name = get().employees.find((e) => e.id === employeeId)?.name || ''
    const lines = eosbSettlementLines(award.award, provided, { reference: name })
    if (!lines.length) throw new Error('EOSB_NOTHING_TO_SETTLE')

    const je = get().addJournalEntry({
      date: at,
      description: `End-of-service settlement — ${name}`,
      reference: name, type: 'eosb_settlement', lines,
    })
    // The release is recorded as a negative movement so the provision this
    // person carries falls back to nil and cannot be double-counted.
    const record = {
      id: uuid(), date: at, period: at.slice(0, 7), status: 'posted',
      kind: 'settlement', employeeId, reason,
      total: -provided, closing: 0,
      award: award.award, provided,
      lines: [{ employeeId, employeeName: name, movement: -provided, opening: provided, closing: 0 }],
      journalEntryId: je.id, createdAt: new Date().toISOString(),
    }
    set((s) => ({ eosbAccruals: [...s.eosbAccruals, record] }))

    if (endContract) {
      const c = get().contractFor(employeeId, at)
      if (c) set((s) => ({
        employmentContracts: s.employmentContracts.map((x) =>
          x.id === c.id ? { ...x, status: 'terminated', endDate: x.endDate || at, endReason: reason } : x),
      }))
      get().updateEmployee(employeeId, { status: 'inactive' })
    }
    get().logActivity('Settled end-of-service', name)
    return { record, award, provided }
  },

  // ─── ATTENDANCE ────────────────────────────────────────────────
  //
  // One record per employee per day. A day with no record is not an
  // absence — it is a day nobody has said anything about, and it deducts
  // nothing. See utils/attendance.js.
  attendance: [],

  attendanceSheet: (employeeId, period) =>
    sheetFor(employeeId, period, get().attendance, { restDays: get().settings.hr?.restDays || [5, 6] }),

  setAttendanceDay: (employeeId, date, patch) => {
    const check = validateDay({ ...patch })
    if (!check.ok) throw new Error(`ATTENDANCE_INVALID: ${check.errors.join(' ')}`)
    const key = String(date).slice(0, 10)
    set((s) => {
      const at = s.attendance.findIndex((r) => r.employeeId === employeeId && String(r.date).slice(0, 10) === key)
      const next = [...s.attendance]
      if (at >= 0) next[at] = { ...next[at], ...patch }
      else next.push({ id: uuid(), employeeId, date: key, status: '', hours: '', overtimeHours: '', lateMinutes: '', note: '', ...patch })
      return { attendance: next }
    })
  },

  /** Save a whole month at once, replacing that employee's days in it. */
  saveAttendanceSheet: (employeeId, period, days = []) => {
    const keep = get().attendance.filter(
      (r) => !(r.employeeId === employeeId && periodOf(r.date) === period)
    )
    // Only days that say something are stored; a blank day is the absence
    // of a record, not a record saying "blank".
    const rows = days
      .filter((d) => d.status || d.hours || d.overtimeHours || d.lateMinutes || d.note)
      .map((d) => ({
        id: d.id || uuid(), employeeId, date: String(d.date).slice(0, 10),
        status: d.status || '', hours: d.hours ?? '', overtimeHours: d.overtimeHours ?? '',
        lateMinutes: d.lateMinutes ?? '', note: d.note || '',
      }))
    set(() => ({ attendance: [...keep, ...rows] }))
    get().logActivity('Saved attendance', `${get().employees.find((e) => e.id === employeeId)?.name || ''} · ${period}`)
    return rows.length
  },

  clearAttendanceMonth: (employeeId, period) =>
    set((s) => ({
      attendance: s.attendance.filter((r) => !(r.employeeId === employeeId && periodOf(r.date) === period)),
    })),

  /** What a month's attendance does to one person's pay. */
  attendanceImpact: (employeeId, period) => {
    const contract = get().contractFor(employeeId, `${period}-28`)
    if (!contract) return null
    const days = get().attendanceSheet(employeeId, period)
    const summary = summariseAttendance(days)
    const hr = get().settings.hr || {}
    return {
      summary,
      ...payrollImpact(summary, contract, {
        daysInMonth: days.length || 30,
        deductLate: !!hr.deductLate,
        lateGraceMinutes: hr.lateGraceMinutes || 0,
      }),
    }
  },

  updateHrSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, hr: {
      ...(s.settings.hr || {}), ...patch,
      eosb: { ...defaultEosbSettings(), ...(s.settings.hr?.eosb || {}), ...(patch.eosb || {}) },
    } } })),

  // ─── PAYROLL RUNS ──────────────────────────────────────────────
  payrollRuns: [],

  addPayrollRun: (run) => {
    const s = get()
    const { prefix, next } = s.settings.payroll
    const number = nextNum(prefix, next)
    const newRun = { ...run, id: uuid(), number, status: 'draft', createdAt: new Date().toISOString() }
    set((st) => ({
      payrollRuns: [...st.payrollRuns, newRun],
      settings: { ...st.settings, payroll: { ...st.settings.payroll, next: next + 1 } },
    }))
    return newRun
  },

  processPayrollRun: (runId) => {
    const run = get().payrollRuns.find((r) => r.id === runId)
    if (!run || run.status === 'processed') return
    const n = (l, f) => Number(l[f]) || 0
    // Earnings breakdown (basic + allowances) → gross; fall back to legacy `gross`.
    // Overtime is earnings, so it belongs in gross — and therefore in the
    // salary expense — rather than being netted off somewhere quiet.
    const grossOf = (l) => n(l, 'gross') || (n(l, 'basic') + n(l, 'housing') + n(l, 'transport') + n(l, 'other') + n(l, 'overtime'))
    const otherDedOf = (l) => n(l, 'late') + n(l, 'absent') + n(l, 'penalty')
    const gosiEmpOf = (l) => n(l, 'gosi') || n(l, 'socialSecurity') // employee GOSI (legacy: socialSecurity)
    const totalGross     = run.lines.reduce((a, l) => a + grossOf(l), 0)
    const totalTax       = run.lines.reduce((a, l) => a + n(l, 'tax'), 0)
    const totalGosiEmp   = run.lines.reduce((a, l) => a + gosiEmpOf(l), 0)
    const totalGosiEmployer = run.lines.reduce((a, l) => a + n(l, 'gosiEmployer'), 0)
    const totalOtherDed  = run.lines.reduce((a, l) => a + otherDedOf(l), 0)
    const totalNet       = run.lines.reduce((a, l) => a + n(l, 'net'), 0)
    // Salary-advance recovery. The line's `loan` field has already been
    // taken off its net pay by the payroll form, so the credit that would
    // have gone to the employee goes against the advance instead — the
    // entry balances by construction. A run where nobody owes anything
    // has totalLoan 0 and posts exactly as it did before.
    const totalLoan = Math.round(run.lines.reduce((a, l) => a + n(l, 'loan'), 0) * 100) / 100
    // Salary cost = earnings not withheld from unpaid deductions (late/absent/penalty
    // reduce the expense; tax & GOSI become payroll liabilities).
    const salaryExpense = totalGross - totalOtherDed
    const lines = [
      { accountId: 'acc-salary', debit: salaryExpense, credit: 0,        description: `Payroll ${run.number} – Salaries` },
      { accountId: 'acc-salpay', debit: 0,             credit: totalNet, description: `Payroll ${run.number} – Net Pay` },
    ]
    if (totalTax > 0)
      lines.push({ accountId: 'acc-paye',  debit: 0, credit: totalTax,     description: `Payroll ${run.number} – Income Tax` })
    if (totalGosiEmp > 0)
      lines.push({ accountId: 'acc-sspay', debit: 0, credit: totalGosiEmp, description: `Payroll ${run.number} – GOSI (employee)` })
    if (totalLoan > 0)
      lines.push({ accountId: EMP_ADV_ACCOUNT, debit: 0, credit: totalLoan, description: `Payroll ${run.number} – Advance recovery` })
    if (totalGosiEmployer > 0) {
      lines.push({ accountId: 'acc-gosiemp', debit: totalGosiEmployer, credit: 0,                   description: `Payroll ${run.number} – GOSI (employer)` })
      lines.push({ accountId: 'acc-sspay',   debit: 0,                  credit: totalGosiEmployer, description: `Payroll ${run.number} – GOSI (employer)` })
    }
    const je = get().addJournalEntry({
      date: run.payDate,
      description: `Payroll Run ${run.number} – ${run.period}`,
      reference: run.number, type: 'payroll', lines,
    })
    // Wind the advances down by what this run actually recovered, oldest
    // first, capped at each employee's own deduction so one person's
    // advance can never be repaid out of another's pay.
    if (totalLoan > 0) {
      run.lines.forEach((l) => {
        const take = n(l, 'loan')
        if (take <= 0.005 || !l.employeeId) return
        const { parts } = get().advanceDueFor(l.employeeId, take)
        get()._recordAdvanceRepayments(parts, {
          date: run.payDate, source: 'payroll', payrollRunId: runId, journalEntryId: je.id,
        })
      })
    }
    set((st) => ({
      payrollRuns: st.payrollRuns.map((r) =>
        r.id === runId ? { ...r, status: 'processed', journalEntryId: je.id } : r
      ),
    }))
  },

  payPayrollRun: (runId, bankAccountId, payDate) => {
    const run = get().payrollRuns.find((r) => r.id === runId)
    if (!run || run.status !== 'processed' || run.paid) return
    const totalNet = run.lines.reduce((a, l) => a + (l.net || 0), 0)
    const je = get().addJournalEntry({
      date: payDate || run.payDate,
      description: `Payroll Payment ${run.number}`,
      reference: run.number, type: 'payroll_payment',
      lines: [
        { accountId: 'acc-salpay',  debit: totalNet, credit: 0,       description: `Payroll Pmt ${run.number}` },
        { accountId: bankAccountId, debit: 0,        credit: totalNet, description: `Payroll Pmt ${run.number}` },
      ],
    })
    set((st) => ({
      payrollRuns: st.payrollRuns.map((r) =>
        r.id === runId ? { ...r, paid: true, paymentJEId: je.id, paymentDate: payDate } : r
      ),
    }))
  },

  deletePayrollRun: (id) =>
    set((s) => {
      const run = s.payrollRuns.find((r) => r.id === id)
      get().assertJEsUnlocked(run?.journalEntryId, run?.paymentJEId)
      return {
        payrollRuns: s.payrollRuns.filter((r) => r.id !== id),
        journalEntries: keepEntries(s.journalEntries, 
          (j) => j.id !== run?.journalEntryId && j.id !== run?.paymentJEId
        ),
      }
    }),

  // ─── EXPENSE CLAIMS ────────────────────────────────────────────
  expenseClaims: [],

  addExpenseClaim: (claim) => {
    const s = get()
    const { prefix, next } = s.settings.expenseClaim
    const number = nextNum(prefix, next)
    const newClaim = { ...claim, id: uuid(), number, status: 'pending', createdAt: new Date().toISOString() }
    set((st) => ({
      expenseClaims: [...st.expenseClaims, newClaim],
      settings: { ...st.settings, expenseClaim: { ...st.settings.expenseClaim, next: next + 1 } },
    }))
    return newClaim
  },

  approveExpenseClaim: (id) => {
    const claim = get().expenseClaims.find((c) => c.id === id)
    if (!claim || claim.status !== 'pending') return
    const expAccId = claim.expenseAccountId || 'acc-admin'
    const je = get().addJournalEntry({
      date: claim.date,
      description: `Expense Claim Approved: ${claim.number} – ${claim.employeeName}`,
      reference: claim.number, type: 'expense_claim',
      lines: [
        { accountId: expAccId,       debit: claim.amount, credit: 0,            description: claim.description },
        { accountId: 'acc-expclaim', debit: 0,            credit: claim.amount, description: claim.description },
      ],
    })
    set((st) => ({
      expenseClaims: st.expenseClaims.map((c) =>
        c.id === id ? { ...c, status: 'approved', approvalJEId: je.id } : c
      ),
    }))
  },

  payExpenseClaim: (id, bankAccountId, payDate) => {
    const claim = get().expenseClaims.find((c) => c.id === id)
    if (!claim || claim.status !== 'approved') return
    const bankAccId = bankAccountId || 'acc-bank1'
    const je = get().addJournalEntry({
      date: payDate || claim.date,
      description: `Expense Claim Paid: ${claim.number} – ${claim.employeeName}`,
      reference: claim.number, type: 'expense_claim_payment',
      lines: [
        { accountId: 'acc-expclaim', debit: claim.amount,  credit: 0,            description: claim.description },
        { accountId: bankAccId,      debit: 0,             credit: claim.amount, description: claim.description },
      ],
    })
    set((st) => ({
      expenseClaims: st.expenseClaims.map((c) =>
        c.id === id ? { ...c, status: 'paid', paymentJEId: je.id, paymentDate: payDate } : c
      ),
    }))
  },

  deleteExpenseClaim: (id) =>
    set((s) => {
      const claim = s.expenseClaims.find((c) => c.id === id)
      get().assertJEsUnlocked(claim?.approvalJEId, claim?.paymentJEId)
      return {
        expenseClaims: s.expenseClaims.filter((c) => c.id !== id),
        journalEntries: keepEntries(s.journalEntries, 
          (j) => j.id !== claim?.approvalJEId && j.id !== claim?.paymentJEId
        ),
      }
    }),
})
