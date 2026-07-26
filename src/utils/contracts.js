// Employment contracts.
//
// Until now an employee record carried a salary and that was the whole story.
// That works right up to the first pay rise, at which point the old figure is
// gone and nobody can answer what someone was paid last March, what their
// contract actually promised, or when it runs out.
//
// A contract is therefore a dated record in its own right. An employee has a
// history of them, and exactly one is in force on any given day. Changing pay
// means signing a new contract, not overwriting the old one — which is also
// what makes an end-of-service calculation defensible, since it depends on the
// wage in force at the end and the date service began.
//
// The salary breakdown is not decoration. Across the GCC, statutory social
// insurance and end-of-service both compute on particular components rather
// than on total pay, so an employer who loads everything into "other
// allowances" quietly understates both. `analyseSalary` is there to say so.

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const num = (v) => Number(v) || 0
const iso = (d) => String(d || '').slice(0, 10)

export const CONTRACT_TYPES = [
  { id: 'unlimited', label: 'Unlimited term' },
  { id: 'fixed',     label: 'Fixed term' },
]

export const CONTRACT_STATUS = {
  draft:      'Draft',
  probation:  'In probation',
  active:     'Active',
  expiring:   'Expiring soon',
  expired:    'Expired',
  terminated: 'Terminated',
}

/** The components a wage is built from, in payslip order. */
export const PAY_COMPONENTS = [
  { id: 'basic',     label: 'Basic salary' },
  { id: 'housing',   label: 'Housing allowance' },
  { id: 'transport', label: 'Transport allowance' },
  { id: 'other',     label: 'Other allowances' },
]

export function emptyContract(patch = {}) {
  return {
    employeeId: '',
    type: 'unlimited',
    startDate: '',
    endDate: '',
    probationMonths: 3,
    noticeDays: 30,
    workDaysPerWeek: 5,
    dailyHours: 8,
    annualLeaveDays: 21,
    basic: '', housing: '', transport: '', other: '',
    gosiApplicable: false, gosiEmployeeRate: 9, gosiEmployerRate: 11,
    taxApplicable: false, taxRate: 0,
    overtimeMultiplier: 1.5,
    status: 'active',
    endReason: '',
    notes: '',
    ...patch,
  }
}

const addMonths = (isoDate, months) => {
  const d = new Date(`${iso(isoDate)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + Math.floor(Number(months) || 0))
  // Clamp to the last day of the target month: a probation starting 31 January
  // does not end on 31 February.
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.toISOString().slice(0, 10)
}

const addDays = (isoDate, days) => {
  const d = new Date(`${iso(isoDate)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + Math.floor(Number(days) || 0))
  return d.toISOString().slice(0, 10)
}

const daysBetween = (from, to) => {
  const a = new Date(`${iso(from)}T00:00:00Z`), b = new Date(`${iso(to)}T00:00:00Z`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0
  return Math.round((b - a) / 86400000)
}

/** Gross monthly wage — the sum of every pay component. */
export function grossOf(contract) {
  return round2(PAY_COMPONENTS.reduce((s, c) => s + num(contract?.[c.id]), 0))
}

/**
 * The wage end-of-service and social insurance are computed on.
 *
 * Basic plus housing, which is the GCC convention and the one that matters:
 * computing on basic alone understates the award, computing on the full gross
 * overstates it. Both are wrong in a way somebody eventually notices.
 */
export function contributoryWage(contract) {
  return round2(num(contract?.basic) + num(contract?.housing))
}

export function probationEnd(contract) {
  if (!contract?.startDate || !(num(contract.probationMonths) > 0)) return ''
  return addMonths(contract.startDate, contract.probationMonths)
}

/** Years of service, as a fraction, from the start date to a given day. */
export function serviceYears(startDate, asAt) {
  if (!startDate || !asAt) return 0
  const days = daysBetween(startDate, asAt)
  return days <= 0 ? 0 : days / 365.25
}

/** Readable service length: "3 years, 2 months". */
export function describeService(startDate, asAt) {
  const days = daysBetween(startDate, asAt)
  if (days <= 0) return '—'
  const years = Math.floor(days / 365.25)
  const months = Math.floor((days - years * 365.25) / 30.44)
  const parts = []
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`)
  if (months) parts.push(`${months} month${months === 1 ? '' : 's'}`)
  if (!parts.length) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  return parts.join(', ')
}

/**
 * Where a contract stands on a given day.
 *
 * `expiring` is a warning, not a state change — the contract is still fully in
 * force. It exists so the list can surface a fixed-term contract before it
 * lapses rather than after, which is the only useful time to know.
 */
export function contractStatus(contract, { asAt, expiringDays = 60 } = {}) {
  if (!contract) return 'draft'
  if (contract.status === 'terminated') return 'terminated'
  const at = iso(asAt) || iso(new Date().toISOString())
  if (!contract.startDate) return 'draft'
  if (at < iso(contract.startDate)) return 'draft'
  if (contract.endDate && at > iso(contract.endDate)) return 'expired'

  const prob = probationEnd(contract)
  if (prob && at <= prob) return 'probation'
  if (contract.endDate && daysBetween(at, contract.endDate) <= expiringDays) return 'expiring'
  return 'active'
}

/** The contract in force for an employee on a date — the latest that covers it. */
export function contractFor(employeeId, contracts = [], asAt) {
  const at = iso(asAt) || iso(new Date().toISOString())
  const mine = contracts
    .filter((c) => c.employeeId === employeeId && c.startDate && iso(c.startDate) <= at)
    .filter((c) => !c.endDate || iso(c.endDate) >= at || c.status === 'terminated')
    .sort((a, b) => iso(b.startDate).localeCompare(iso(a.startDate)))
  // A terminated contract still answers "what were they on" for a past date,
  // but must not be treated as current.
  const live = mine.find((c) => c.status !== 'terminated' && (!c.endDate || iso(c.endDate) >= at))
  return live || mine[0] || null
}

/** Every contract for an employee, newest first. */
export function historyFor(employeeId, contracts = []) {
  return contracts
    .filter((c) => c.employeeId === employeeId)
    .sort((a, b) => iso(b.startDate).localeCompare(iso(a.startDate)))
}

/**
 * The date service began, for end-of-service purposes.
 *
 * Not the current contract's start date — a renewal does not reset an
 * employee's service. It is the earliest unbroken contract start.
 */
export function serviceStart(employeeId, contracts = []) {
  const mine = historyFor(employeeId, contracts)
  if (!mine.length) return ''
  return mine.reduce((min, c) => (!min || iso(c.startDate) < min ? iso(c.startDate) : min), '')
}

/**
 * What the salary structure implies, and what looks wrong about it.
 *
 * Findings are advisory. The thresholds below are the GCC norms most companies
 * are measured against; a business with a good reason to sit outside them
 * should be able to, so nothing here blocks a save.
 */
export function analyseSalary(contract) {
  const gross = grossOf(contract)
  const basic = num(contract?.basic)
  const housing = num(contract?.housing)
  const contributory = contributoryWage(contract)
  const pct = (v) => (gross > 0 ? Math.round((v / gross) * 1000) / 10 : 0)

  const findings = []
  if (gross <= 0) {
    findings.push({ level: 'error', text: 'This contract has no pay in it.' })
  } else {
    if (basic <= 0) {
      findings.push({ level: 'error', text: 'There is no basic salary. End-of-service and social insurance are both computed on basic pay, so leaving it at zero understates them to nil.' })
    } else if (pct(basic) < 50) {
      findings.push({
        level: 'warning',
        text: `Basic is only ${pct(basic)}% of gross. End-of-service and social insurance are computed on basic plus housing, so a low basic quietly reduces both — most GCC employers keep basic at or above 50%.`,
      })
    }
    if (basic > 0 && housing > 0) {
      const housingOfBasic = Math.round((housing / basic) * 1000) / 10
      if (housingOfBasic < 20)
        findings.push({ level: 'info', text: `Housing is ${housingOfBasic}% of basic. The customary figure is 25% — three months' basic a year.` })
    }
    if (basic > 0 && housing === 0)
      findings.push({ level: 'info', text: 'No housing allowance. That is allowed, but it also means end-of-service is computed on basic alone.' })
  }

  return {
    gross,
    contributory,
    components: PAY_COMPONENTS.map((c) => ({
      id: c.id, label: c.label, amount: round2(num(contract?.[c.id])), pct: pct(num(contract?.[c.id])),
    })),
    contributoryPct: pct(contributory),
    findings,
  }
}

/** Employer cost per month: gross plus the employer's own contributions. */
export function employerCost(contract) {
  const gross = grossOf(contract)
  const gosi = contract?.gosiApplicable
    ? round2((contributoryWage(contract) * num(contract.gosiEmployerRate)) / 100)
    : 0
  return { gross, gosiEmployer: gosi, total: round2(gross + gosi) }
}

/** The daily rate a day's absence or a day's leave is worth. */
export function dailyRate(contract, { basis = 'gross', daysInMonth = 30 } = {}) {
  const wage = basis === 'contributory' ? contributoryWage(contract) : grossOf(contract)
  const days = num(daysInMonth) || 30
  return round2(wage / days)
}

/** The hourly rate, from the contract's own working pattern. */
export function hourlyRate(contract, { daysInMonth = 30 } = {}) {
  const perWeek = num(contract?.workDaysPerWeek) || 5
  const hours = num(contract?.dailyHours) || 8
  // Average working days a month, from the contract's own week.
  const workingDays = (perWeek * (num(daysInMonth) || 30)) / 7
  const monthlyHours = workingDays * hours
  return monthlyHours > 0 ? round2(grossOf(contract) / monthlyHours) : 0
}

export function validateContract(contract, existing = [], { id = null } = {}) {
  const errors = []
  if (!contract?.employeeId) errors.push('Pick an employee.')
  if (!contract?.startDate) errors.push('A contract needs a start date.')
  if (contract?.type === 'fixed' && !contract?.endDate) errors.push('A fixed-term contract needs an end date.')
  if (contract?.endDate && contract?.startDate && iso(contract.endDate) < iso(contract.startDate))
    errors.push('The end date falls before the start date.')
  if (num(contract?.probationMonths) < 0 || num(contract?.probationMonths) > 12)
    errors.push('Probation must be between 0 and 12 months.')
  if (contract?.endDate && contract?.startDate) {
    const prob = probationEnd(contract)
    if (prob && prob > iso(contract.endDate))
      errors.push('Probation runs past the end of the contract.')
  }
  if (num(contract?.workDaysPerWeek) < 1 || num(contract?.workDaysPerWeek) > 7)
    errors.push('Working days a week must be between 1 and 7.')
  if (num(contract?.dailyHours) <= 0 || num(contract?.dailyHours) > 24)
    errors.push('Daily hours must be between 0 and 24.')
  if (num(contract?.annualLeaveDays) < 0 || num(contract?.annualLeaveDays) > 60)
    errors.push('Annual leave must be between 0 and 60 days.')
  if (grossOf(contract) <= 0) errors.push('The contract has no pay in it.')

  // Two live contracts covering the same day would make "what are they paid"
  // ambiguous, and payroll would silently pick one.
  const overlap = existing.find((c) => {
    if (c.id === id || c.employeeId !== contract?.employeeId) return false
    if (c.status === 'terminated') return false
    const aStart = iso(contract.startDate), aEnd = iso(contract.endDate) || '9999-12-31'
    const bStart = iso(c.startDate), bEnd = iso(c.endDate) || '9999-12-31'
    return aStart <= bEnd && bStart <= aEnd
  })
  if (overlap) errors.push('This overlaps an existing contract for the same employee. End the previous one first.')

  return errors.length ? { ok: false, errors } : { ok: true }
}

/** Contracts that need attention on a given day, worst first. */
export function attentionList(contracts = [], employees = [], { asAt, expiringDays = 60 } = {}) {
  const at = iso(asAt) || iso(new Date().toISOString())
  const nameOf = (id) => employees.find((e) => e.id === id)?.name || '—'
  const out = []
  contracts.forEach((c) => {
    const status = contractStatus(c, { asAt: at, expiringDays })
    if (status === 'expired' && c.status !== 'terminated')
      out.push({ contract: c, employeeName: nameOf(c.employeeId), kind: 'expired', days: daysBetween(c.endDate, at), text: 'Contract has expired' })
    else if (status === 'expiring')
      out.push({ contract: c, employeeName: nameOf(c.employeeId), kind: 'expiring', days: daysBetween(at, c.endDate), text: 'Contract expires soon' })
    const prob = probationEnd(c)
    if (prob && c.status !== 'terminated' && at <= prob && daysBetween(at, prob) <= 30)
      out.push({ contract: c, employeeName: nameOf(c.employeeId), kind: 'probation', days: daysBetween(at, prob), text: 'Probation ends soon' })
  })
  const rank = { expired: 0, probation: 1, expiring: 2 }
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.days - b.days)
}

/** Notice period end, from a given notice date. */
export function noticeEnd(contract, from) {
  return addDays(from, num(contract?.noticeDays) || 0)
}

export { addMonths, addDays, daysBetween }
