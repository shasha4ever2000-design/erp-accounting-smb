// Attendance: who was in, who was not, and what that costs.
//
// The one decision everything else follows from: **a day with no record is not
// an absence.** It is a day nobody has said anything about yet. Treating
// silence as absence would dock the pay of every employee for every day the
// office forgot to mark the sheet, which is how attendance systems earn their
// reputation. Unmarked days are counted and reported as unmarked, and they
// deduct nothing.
//
// The second: only *unpaid* statuses reduce pay. Annual leave, sick leave and
// public holidays are paid days — they belong on the sheet because they
// explain the gap and draw down a leave balance, not because they cost money.

import { grossOf, dailyRate, hourlyRate } from './contracts'

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const num = (v) => Number(v) || 0
const iso = (d) => String(d || '').slice(0, 10)

/**
 * `paid`   — the day is paid in full.
 * `works`  — the day counts as time actually worked.
 * `leave`  — the day draws down the annual leave balance.
 */
export const DAY_STATUSES = [
  { id: 'present',  label: 'Present',        paid: true,  works: true,  leave: false, color: 'emerald' },
  { id: 'remote',   label: 'Remote',         paid: true,  works: true,  leave: false, color: 'teal' },
  { id: 'annual',   label: 'Annual leave',   paid: true,  works: false, leave: true,  color: 'blue' },
  { id: 'sick',     label: 'Sick leave',     paid: true,  works: false, leave: false, color: 'amber' },
  { id: 'holiday',  label: 'Public holiday', paid: true,  works: false, leave: false, color: 'violet' },
  { id: 'rest',     label: 'Rest day',       paid: true,  works: false, leave: false, color: 'slate' },
  { id: 'unpaid',   label: 'Unpaid leave',   paid: false, works: false, leave: false, color: 'orange' },
  { id: 'absent',   label: 'Absent',         paid: false, works: false, leave: false, color: 'red' },
]

export const statusMeta = (id) => DAY_STATUSES.find((s) => s.id === id) || null
export const isPaidStatus = (id) => !!statusMeta(id)?.paid
export const isWorkedStatus = (id) => !!statusMeta(id)?.works

/** Every day in a month, as ISO dates. */
export function monthDays(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''))
  if (!m) return []
  const year = Number(m[1]), month = Number(m[2])
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: last }, (_, i) => `${m[1]}-${m[2]}-${String(i + 1).padStart(2, '0')}`)
}

/** 0 = Sunday … 6 = Saturday, in UTC so it does not drift with the browser. */
export function weekdayOf(date) {
  const d = new Date(`${iso(date)}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? -1 : d.getUTCDay()
}

export function periodOf(date) { return iso(date).slice(0, 7) }

/**
 * A blank sheet for one employee for one month.
 *
 * Weekly rest days are pre-filled because they are known in advance and
 * marking them by hand every month is the fastest way to stop using a sheet at
 * all. Everything else starts unmarked.
 */
export function blankSheet(employeeId, period, { restDays = [5, 6] } = {}) {
  return monthDays(period).map((date) => ({
    employeeId,
    date,
    status: restDays.includes(weekdayOf(date)) ? 'rest' : '',
    hours: '',
    overtimeHours: '',
    lateMinutes: '',
    note: '',
  }))
}

/** Index existing records by date for one employee and month. */
export function sheetFor(employeeId, period, records = [], { restDays = [5, 6] } = {}) {
  const mine = {}
  records.forEach((r) => {
    if (r.employeeId === employeeId && periodOf(r.date) === period) mine[iso(r.date)] = r
  })
  return blankSheet(employeeId, period, { restDays }).map((d) => ({ ...d, ...(mine[d.date] || {}) }))
}

/**
 * Add up a sheet.
 *
 * `unmarked` is reported rather than assumed either way — see the header.
 */
export function summarise(days = []) {
  const counts = {}
  DAY_STATUSES.forEach((s) => { counts[s.id] = 0 })
  let unmarked = 0, hours = 0, overtimeHours = 0, lateMinutes = 0

  days.forEach((d) => {
    const st = d?.status
    if (!st) { unmarked += 1; return }
    if (counts[st] === undefined) { unmarked += 1; return }
    counts[st] += 1
    hours += num(d.hours)
    overtimeHours += num(d.overtimeHours)
    lateMinutes += num(d.lateMinutes)
  })

  const worked = DAY_STATUSES.filter((s) => s.works).reduce((s, m) => s + counts[m.id], 0)
  const unpaidDays = DAY_STATUSES.filter((s) => !s.paid).reduce((s, m) => s + counts[m.id], 0)
  const leaveDays = DAY_STATUSES.filter((s) => s.leave).reduce((s, m) => s + counts[m.id], 0)

  return {
    total: days.length,
    counts,
    unmarked,
    workedDays: worked,
    unpaidDays,
    leaveDays,
    paidDays: days.length - unmarked - unpaidDays,
    hours: round2(hours),
    overtimeHours: round2(overtimeHours),
    lateMinutes: Math.round(lateMinutes),
  }
}

/**
 * What a month's attendance does to one person's pay.
 *
 * Absence is charged at the daily rate on the calendar month — a 30-day month
 * and a 31-day month both divide the same monthly salary, so a day off costs
 * marginally less in a long month. That is the standard treatment and it is
 * the one payroll software everywhere uses.
 *
 * Late minutes are reported but never deducted automatically. Docking pay by
 * the minute is a policy decision with legal limits in most places, and a
 * system that does it silently will be wrong somewhere.
 */
export function payrollImpact(summary, contract, { daysInMonth = 30, deductLate = false, lateGraceMinutes = 0 } = {}) {
  const rate = dailyRate(contract, { daysInMonth })
  const hourly = hourlyRate(contract, { daysInMonth })
  const otMultiplier = num(contract?.overtimeMultiplier) || 1.5

  const absenceDeduction = round2(rate * num(summary?.unpaidDays))
  const overtimePay = round2(hourly * otMultiplier * num(summary?.overtimeHours))

  const chargeableLate = Math.max(0, num(summary?.lateMinutes) - num(lateGraceMinutes))
  const lateDeduction = deductLate
    ? round2((hourly * chargeableLate) / 60)
    : 0

  return {
    dailyRate: rate,
    hourlyRate: hourly,
    absenceDeduction,
    overtimePay,
    lateMinutes: Math.round(num(summary?.lateMinutes)),
    chargeableLate,
    lateDeduction,
    net: round2(overtimePay - absenceDeduction - lateDeduction),
  }
}

/**
 * Annual leave: earned, taken, remaining.
 *
 * Leave accrues over the year in force, pro rata to days elapsed, so somebody
 * three months in has a quarter of the entitlement rather than all of it.
 */
export function leaveBalance(contract, records = [], { asAt, employeeId } = {}) {
  const entitlement = num(contract?.annualLeaveDays)
  const start = iso(contract?.startDate)
  const at = iso(asAt)
  if (!start || !at || at < start) return { entitlement, accrued: 0, taken: 0, remaining: 0 }

  const days = Math.max(0, Math.round((new Date(`${at}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000))
  // Only the current leave year counts; anything before is assumed settled.
  const intoYear = days % 365
  const accrued = Math.round((entitlement * intoYear) / 365 * 10) / 10

  const yearStartOffset = days - intoYear
  const yearStart = new Date(new Date(`${start}T00:00:00Z`).getTime() + yearStartOffset * 86400000).toISOString().slice(0, 10)

  const taken = records.filter((r) =>
    (!employeeId || r.employeeId === employeeId) &&
    r.status === 'annual' && iso(r.date) >= yearStart && iso(r.date) <= at
  ).length

  return {
    entitlement,
    yearStart,
    accrued,
    taken,
    remaining: Math.round((accrued - taken) * 10) / 10,
  }
}

export function validateDay(day) {
  const errors = []
  if (day?.status && !statusMeta(day.status)) errors.push('That is not a status this sheet knows.')
  if (num(day?.hours) < 0 || num(day?.hours) > 24) errors.push('Hours must be between 0 and 24.')
  if (num(day?.overtimeHours) < 0 || num(day?.overtimeHours) > 24) errors.push('Overtime must be between 0 and 24 hours.')
  if (num(day?.lateMinutes) < 0 || num(day?.lateMinutes) > 1440) errors.push('Late minutes must be between 0 and 1440.')
  if (day?.status && !isWorkedStatus(day.status) && num(day?.overtimeHours) > 0)
    errors.push('Overtime cannot be recorded on a day that was not worked.')
  return errors.length ? { ok: false, errors } : { ok: true }
}

/** A whole company's month, one row per employee. */
export function monthOverview(employees = [], records = [], period, { restDays = [5, 6] } = {}) {
  return employees.map((e) => {
    const days = sheetFor(e.id, period, records, { restDays })
    return { employee: e, summary: summarise(days) }
  })
}
