// Attendance: mark a month, see what it costs.
//
// The grid is the whole point. Marking thirty days one modal at a time is why
// attendance sheets get abandoned, so a month is one screen, keyboard-first,
// with a click-to-cycle cell and a fill-the-rest button.

import { useState, useMemo, useEffect } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import {
  DAY_STATUSES, statusMeta, summarise, payrollImpact, leaveBalance,
  monthDays, weekdayOf, periodOf,
} from '../utils/attendance'
import { describeService, serviceStart } from '../utils/contracts'
import { PageHeader, Card, Btn, Select, Input, EmptyState, StatCard, Badge } from '../components/UI'
import ExportMenu from '../components/ExportMenu'
import { CalendarCheck, Save, Users, Clock, TrendingDown, Eraser, ChevronLeft, ChevronRight } from 'lucide-react'

const WEEKDAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// Tailwind needs whole class names, so the palette is spelled out rather than
// interpolated — a computed `bg-${color}-100` compiles to nothing.
const CELL_CLR = {
  present: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  remote:  'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-200',
  annual:  'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200',
  sick:    'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  holiday: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
  rest:    'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400',
  unpaid:  'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200',
  absent:  'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200',
  '':      'bg-white dark:bg-surface-850 text-slate-300 dark:text-slate-600 border-dashed',
}
const LETTER = { present: 'P', remote: 'R', annual: 'A', sick: 'S', holiday: 'H', rest: '·', unpaid: 'U', absent: 'X', '': '' }

const thisMonth = () => new Date().toISOString().slice(0, 7)
const shiftMonth = (m, by) => {
  const p = /^(\d{4})-(\d{2})$/.exec(String(m || ''))
  if (!p) return m
  const d = new Date(Date.UTC(Number(p[1]), Number(p[2]) - 1 + by, 1))
  return d.toISOString().slice(0, 7)
}

export default function Attendance() {
  const t = useT()
  const {
    employees, attendance, settings, employmentContracts,
    attendanceSheet, saveAttendanceSheet, clearAttendanceMonth,
    attendanceImpact, contractFor,
  } = useStore()
  const sym = settings.company.currencySymbol

  const activeEmps = useMemo(() => employees.filter((e) => e.status === 'active'), [employees])
  const [period, setPeriod] = useState(thisMonth())
  const [employeeId, setEmployeeId] = useState('')
  const [days, setDays] = useState([])
  const [dirty, setDirty] = useState(false)
  const [paint, setPaint] = useState('present')

  useEffect(() => {
    if (!employeeId && activeEmps.length) setEmployeeId(activeEmps[0].id)
  }, [activeEmps, employeeId])

  useEffect(() => {
    if (!employeeId) { setDays([]); return }
    setDays(attendanceSheet(employeeId, period))
    setDirty(false)
  }, [employeeId, period, attendance])

  const contract = employeeId ? contractFor(employeeId, `${period}-28`) : null
  const summary = useMemo(() => summarise(days), [days])
  const impact = useMemo(() => (contract ? payrollImpact(summary, contract, {
    daysInMonth: days.length || 30,
    deductLate: !!settings.hr?.deductLate,
    lateGraceMinutes: settings.hr?.lateGraceMinutes || 0,
  }) : null), [summary, contract, days.length, settings.hr])
  const leave = useMemo(
    () => (contract ? leaveBalance(contract, attendance, { asAt: today(), employeeId }) : null),
    [contract, attendance, employeeId],
  )

  const setDay = (date, patch) => {
    setDays((ds) => ds.map((d) => (d.date === date ? { ...d, ...patch } : d)))
    setDirty(true)
  }

  // Click paints the selected status; clicking a cell that already has it
  // clears it back to unmarked, so a mis-click is one more click to undo.
  const clickDay = (d) => setDay(d.date, { status: d.status === paint ? '' : paint })

  const fillUnmarked = () => {
    setDays((ds) => ds.map((d) => (d.status ? d : { ...d, status: paint })))
    setDirty(true)
  }

  const save = () => {
    const n = saveAttendanceSheet(employeeId, period, days)
    setDirty(false)
    alert(t('Saved {n} days for {m}.').replace('{n}', n).replace('{m}', period))
  }

  const clearMonth = () => {
    if (!confirm(t('Clear every mark for this employee in {m}?').replace('{m}', period))) return
    clearAttendanceMonth(employeeId, period)
    setDirty(false)
  }

  // Company-wide roll-up for the month.
  const overview = useMemo(() => activeEmps.map((e) => {
    const i = attendanceImpact(e.id, period)
    const s = summarise(attendanceSheet(e.id, period))
    return { employee: e, summary: s, impact: i }
  }), [activeEmps, period, attendance, employmentContracts])

  const exportCols = [
    { key: 'name', label: t('Employee'), map: (_, r) => r.employee.name },
    { key: 'present', label: t('Present'), right: true, map: (_, r) => r.summary.counts.present },
    { key: 'annual', label: t('Annual leave'), right: true, map: (_, r) => r.summary.counts.annual },
    { key: 'sick', label: t('Sick leave'), right: true, map: (_, r) => r.summary.counts.sick },
    { key: 'absent', label: t('Absent'), right: true, map: (_, r) => r.summary.counts.absent },
    { key: 'unpaid', label: t('Unpaid leave'), right: true, map: (_, r) => r.summary.counts.unpaid },
    { key: 'unmarked', label: t('Unmarked'), right: true, map: (_, r) => r.summary.unmarked },
    { key: 'overtimeHours', label: t('Overtime hours'), right: true, map: (_, r) => r.summary.overtimeHours },
    { key: 'lateMinutes', label: t('Late minutes'), right: true, map: (_, r) => r.summary.lateMinutes },
    { key: 'deduction', label: t('Absence deduction'), right: true, map: (_, r) => (r.impact?.absenceDeduction ?? 0).toFixed(2) },
    { key: 'overtimePay', label: t('Overtime pay'), right: true, map: (_, r) => (r.impact?.overtimePay ?? 0).toFixed(2) },
  ]

  if (activeEmps.length === 0) {
    return (
      <div>
        <PageHeader title="Attendance" subtitle={t('Presence, absence and leave, month by month')} />
        <Card>
          <EmptyState icon={<Users size={20} />} title={t('No active employees')} desc={t('Add employees in the HR section first — the sheet is built from them.')} />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle={t('Presence, absence and leave — feeding straight into payroll')}
        action={
          <>
            <ExportMenu filename={`attendance-${period}`} title={`${t('Attendance')} ${period}`} rows={overview} columns={exportCols} size="sm" />
            <Btn onClick={save} disabled={!dirty}><Save size={15} /> {t('Save sheet')}</Btn>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Days present" value={summary.counts.present + summary.counts.remote} color="green" icon={<CalendarCheck size={18} />} />
        <StatCard label="Unpaid days" value={summary.unpaidDays} color={summary.unpaidDays ? 'red' : 'blue'} icon={<TrendingDown size={18} />} />
        <StatCard label="Overtime hours" value={summary.overtimeHours} color="purple" icon={<Clock size={18} />} />
        <StatCard
          label="Effect on pay"
          value={impact ? fmtMoney(impact.net, sym) : '—'}
          sub={impact ? `${t('absence')} ${fmtMoney(impact.absenceDeduction, sym)} · ${t('overtime')} ${fmtMoney(impact.overtimePay, sym)}` : t('No contract for this month')}
          color={impact && impact.net < 0 ? 'orange' : 'blue'}
        />
      </div>

      <Card className="p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-end gap-1">
            <Btn size="sm" variant="ghost" onClick={() => setPeriod(shiftMonth(period, -1))} title={t('Previous month')}><ChevronLeft size={15} /></Btn>
            <Input label={t('Month')} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-40" />
            <Btn size="sm" variant="ghost" onClick={() => setPeriod(shiftMonth(period, 1))} title={t('Next month')}><ChevronRight size={15} /></Btn>
          </div>
          <Select label={t('Employee')} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="min-w-[12rem]">
            {activeEmps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
          <div className="flex-1 min-w-[16rem]">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('Click a day to mark it as')}</label>
            <div className="flex flex-wrap gap-1">
              {DAY_STATUSES.map((s) => (
                <button key={s.id} onClick={() => setPaint(s.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${CELL_CLR[s.id]} ${paint === s.id ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-surface-900' : 'opacity-70 hover:opacity-100'}`}>
                  {LETTER[s.id]} {t(s.label)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Btn size="sm" variant="secondary" onClick={fillUnmarked}>{t('Fill the blanks')}</Btn>
            <Btn size="sm" variant="ghost" onClick={clearMonth}><Eraser size={14} /> {t('Clear month')}</Btn>
          </div>
        </div>
        {!contract && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
            {t('No employment contract covers this month, so nothing can be costed. The sheet still records who was in.')}
          </p>
        )}
      </Card>

      {/* ── The month ── */}
      <Card className="p-4 mb-6">
        <div className="grid grid-cols-7 gap-1.5 mb-2">
          {WEEKDAY_SHORT.map((w) => (
            <div key={w} className="text-center text-[11px] font-semibold uppercase text-slate-400 dark:text-slate-500">{t(w)}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {/* Lead the first row in so the 1st sits under its weekday. */}
          {Array.from({ length: days.length ? weekdayOf(days[0].date) : 0 }).map((_, i) => <div key={`pad${i}`} />)}
          {days.map((d) => (
            <button
              key={d.date}
              onClick={() => clickDay(d)}
              title={`${fmtDate(d.date)} — ${t(statusMeta(d.status)?.label || 'Unmarked')}`}
              className={`aspect-square rounded-lg border border-slate-200 dark:border-surface-750 flex flex-col items-center justify-center transition-colors hover:ring-2 hover:ring-blue-400 ${CELL_CLR[d.status] || CELL_CLR['']}`}
            >
              <span className="text-[11px] opacity-70">{Number(d.date.slice(8))}</span>
              <span className="text-sm font-bold">{LETTER[d.status] ?? ''}</span>
              {(Number(d.overtimeHours) > 0 || Number(d.lateMinutes) > 0) && (
                <span className="text-[9px] leading-none mt-0.5 opacity-80">
                  {Number(d.overtimeHours) > 0 ? `+${d.overtimeHours}h` : ''}
                  {Number(d.lateMinutes) > 0 ? ` ${d.lateMinutes}m` : ''}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{t('Unmarked')}: <strong className="text-slate-700 dark:text-slate-200">{summary.unmarked}</strong> {t('days — these deduct nothing')}</span>
          {leave && <span>{t('Annual leave')}: <strong className="text-slate-700 dark:text-slate-200">{leave.taken}</strong> {t('taken of')} {leave.accrued} {t('accrued')} ({leave.entitlement} {t('a year')})</span>}
          {contract && <span>{t('Service')}: <strong className="text-slate-700 dark:text-slate-200">{describeService(serviceStart(employeeId, employmentContracts), today())}</strong></span>}
        </div>
      </Card>

      {/* ── Hours and lateness, only where they were worked ── */}
      <Card className="p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-100 mb-3">{t('Overtime and lateness')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[32rem]">
            <thead className="text-xs uppercase text-gray-500 dark:text-slate-400">
              <tr>
                <th className="text-start py-1.5">{t('Day')}</th>
                <th className="text-start py-1.5">{t('Status')}</th>
                <th className="text-end py-1.5">{t('Hours')}</th>
                <th className="text-end py-1.5">{t('Overtime')}</th>
                <th className="text-end py-1.5">{t('Late (min)')}</th>
                <th className="text-start py-1.5 ps-3">{t('Note')}</th>
              </tr>
            </thead>
            <tbody>
              {days.filter((d) => statusMeta(d.status)?.works).map((d) => (
                <tr key={d.date} className="border-t border-gray-50 dark:border-slate-700/50">
                  <td className="py-1 text-slate-600 dark:text-slate-300">{fmtDate(d.date)}</td>
                  <td className="py-1"><Badge className={CELL_CLR[d.status]}>{t(statusMeta(d.status)?.label)}</Badge></td>
                  <td className="py-1 text-end"><Num v={d.hours} onChange={(v) => setDay(d.date, { hours: v })} /></td>
                  <td className="py-1 text-end"><Num v={d.overtimeHours} onChange={(v) => setDay(d.date, { overtimeHours: v })} /></td>
                  <td className="py-1 text-end"><Num v={d.lateMinutes} onChange={(v) => setDay(d.date, { lateMinutes: v })} /></td>
                  <td className="py-1 ps-3">
                    <input value={d.note || ''} onChange={(e) => setDay(d.date, { note: e.target.value })}
                      className="w-full px-2 py-1 text-xs rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </td>
                </tr>
              ))}
              {days.filter((d) => statusMeta(d.status)?.works).length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-slate-400 dark:text-slate-500">{t('Mark some days as worked to record hours against them.')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {impact && (
          <p className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded p-2 mt-3">
            {t('At this contract: a day is worth')} {fmtMoney(impact.dailyRate, sym)}, {t('an hour')} {fmtMoney(impact.hourlyRate, sym)}.
            {' '}{summary.unpaidDays > 0 && t('{n} unpaid days deduct {a}.').replace('{n}', summary.unpaidDays).replace('{a}', fmtMoney(impact.absenceDeduction, sym))}
            {' '}{summary.overtimeHours > 0 && t('{h} overtime hours add {a}.').replace('{h}', summary.overtimeHours).replace('{a}', fmtMoney(impact.overtimePay, sym))}
            {' '}{impact.lateMinutes > 0 && (settings.hr?.deductLate
              ? t('{m} late minutes deduct {a}.').replace('{m}', impact.lateMinutes).replace('{a}', fmtMoney(impact.lateDeduction, sym))
              : t('{m} late minutes are recorded but not deducted — turn that on in Settings if you want it.').replace('{m}', impact.lateMinutes))}
          </p>
        )}
      </Card>

      {/* ── Everyone, this month ── */}
      <Card>
        <div className="p-4 pb-0">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-100">{t('Everyone this month')}</h2>
        </div>
        <div className="overflow-x-auto p-4">
          <table className="w-full text-sm min-w-[42rem]">
            <thead className="text-xs uppercase text-gray-500 dark:text-slate-400">
              <tr>
                <th className="text-start py-2">{t('Employee')}</th>
                <th className="text-end py-2">{t('Present')}</th>
                <th className="text-end py-2">{t('Leave')}</th>
                <th className="text-end py-2">{t('Absent')}</th>
                <th className="text-end py-2">{t('Unmarked')}</th>
                <th className="text-end py-2">{t('Overtime')}</th>
                <th className="text-end py-2">{t('Effect on pay')}</th>
              </tr>
            </thead>
            <tbody>
              {overview.map((r) => (
                <tr key={r.employee.id} className="border-t border-gray-50 dark:border-slate-700/50 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                  onClick={() => setEmployeeId(r.employee.id)}>
                  <td className="py-1.5 font-medium text-slate-800 dark:text-slate-100">{r.employee.name}</td>
                  <td className="py-1.5 text-end text-slate-600 dark:text-slate-300">{r.summary.counts.present + r.summary.counts.remote}</td>
                  <td className="py-1.5 text-end text-slate-600 dark:text-slate-300">{r.summary.counts.annual + r.summary.counts.sick}</td>
                  <td className={`py-1.5 text-end ${r.summary.unpaidDays ? 'text-red-600 dark:text-red-400 font-medium' : 'text-slate-400'}`}>{r.summary.unpaidDays}</td>
                  <td className="py-1.5 text-end text-slate-400 dark:text-slate-500">{r.summary.unmarked}</td>
                  <td className="py-1.5 text-end text-slate-600 dark:text-slate-300">{r.summary.overtimeHours || '—'}</td>
                  <td className={`py-1.5 text-end font-medium ${r.impact && r.impact.net < 0 ? 'text-red-600 dark:text-red-400' : r.impact && r.impact.net > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                    {r.impact ? fmtMoney(r.impact.net, sym) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function Num({ v, onChange }) {
  return (
    <input type="number" step="0.5" min="0" value={v ?? ''} onChange={(e) => onChange(e.target.value)}
      className="w-20 text-end px-1.5 py-1 text-xs rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
  )
}
