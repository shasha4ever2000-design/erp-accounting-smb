import { useState, useMemo } from 'react'
import { useStore } from '../store'
import { useAuth } from '../auth'
import { PageHeader, Card, Btn, Select } from '../components/UI'
import { useT } from '../i18n'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { fiscalYearBounds, listFiscalYears, preCloseChecks, yearSummary } from '../utils/yearClose'
import { CalendarCheck, CheckCircle2, AlertTriangle, Lock, Unlock, ArrowRight, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function YearEndClose() {
  const { settings, journalEntries, accounts, stockAdjustments, expenseClaims, payrollRuns, workOrders, closeFiscalYear, reopenFiscalYear } = useStore()
  const t = useT()
  const isManager = useAuth((s) => s.isManager())
  const sym = settings.company.currencySymbol
  const fyStart = settings.company.fiscalYearStart || '01'

  const fys = useMemo(() => listFiscalYears(journalEntries, fyStart), [journalEntries, fyStart])
  const closedYears = settings.accounting?.closedYears || []
  const isClosed = (label) => closedYears.find((c) => c.label === label)

  // Default to the earliest year with activity that is not yet closed.
  const defaultFy = fys.find((f) => !isClosed(f.label)) || fys[fys.length - 1] || fiscalYearBounds(fyStart, new Date().getFullYear())
  const [fyLabel, setFyLabel] = useState(defaultFy.label)
  const fy = fys.find((f) => f.label === fyLabel) || defaultFy
  const closed = isClosed(fy.label)

  const checks = useMemo(
    () => preCloseChecks({ journalEntries, stockAdjustments, expenseClaims, payrollRuns, workOrders }, fy),
    [journalEntries, stockAdjustments, expenseClaims, payrollRuns, workOrders, fy]
  )
  const warnings = checks.filter((c) => !c.ok).length
  const summary = useMemo(() => yearSummary(accounts, journalEntries, fy), [accounts, journalEntries, fy])

  const checkFix = {
    adjustments: '/stock-adjustments', claims: '/expense-claims', payroll: '/payroll',
    workorders: '/manufacturing', vat: '/reports', balanced: '/journals',
  }

  const doClose = () => {
    const msg = warnings > 0
      ? t('There are {n} open review items. Close {y} anyway? The books will be locked through {d}.')
          .replace('{n}', warnings).replace('{y}', fy.label).replace('{d}', fy.end)
      : t('Close {y}? The books will be locked through {d}.').replace('{y}', fy.label).replace('{d}', fy.end)
    if (!confirm(msg)) return
    closeFiscalYear({ ...fy, netIncome: summary.netIncome, by: useAuth.getState().currentUser()?.name || '' })
  }

  const doReopen = () => {
    if (!confirm(t('Reopen {y}? Entries in this year become editable again.').replace('{y}', fy.label))) return
    reopenFiscalYear(fy.label)
  }

  const StatRow = ({ label, value, strong, positive }) => (
    <div className={`flex items-center justify-between py-2.5 ${strong ? 'border-t-2 border-gray-300 dark:border-slate-600 mt-1 pt-3' : 'border-b border-gray-100 dark:border-slate-700/60'}`}>
      <span className={strong ? 'font-bold text-gray-900 dark:text-slate-100' : 'text-gray-600 dark:text-slate-300'}>{label}</span>
      <span className={`font-mono tabular-nums ${strong ? 'font-bold text-lg' : 'font-medium'} ${positive === undefined ? 'text-gray-800 dark:text-slate-100' : positive ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>{value}</span>
    </div>
  )

  return (
    <div>
      <PageHeader
        title={t('Year-End Close')}
        subtitle={t('Review the year, lock the books, and roll profit into equity — no closing entries needed.')}
        action={
          <Select value={fyLabel} onChange={(e) => setFyLabel(e.target.value)} className="w-40">
            {fys.map((f) => <option key={f.label} value={f.label}>{f.label}{isClosed(f.label) ? ' ✓' : ''}</option>)}
            {fys.length === 0 && <option value={defaultFy.label}>{defaultFy.label}</option>}
          </Select>
        }
      />

      {/* Status banner */}
      {closed ? (
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-success-500 to-emerald-600 text-white p-5 flex flex-wrap items-center justify-between gap-3 shadow-card">
          <div className="flex items-center gap-3">
            <CheckCircle2 size={22} />
            <div>
              <p className="font-bold">{fy.label} {t('is closed')}</p>
              <p className="text-white/85 text-sm">
                {t('Closed on')} {fmtDate(closed.closedAt?.slice(0, 10))}{closed.by ? ` · ${closed.by}` : ''} · {t('Net income')} {fmtMoney(closed.netIncome, sym)} · {t('Books locked through')} {fmtDate(fy.end)}
              </p>
            </div>
          </div>
          {isManager && (
            <Btn variant="secondary" className="!bg-white/15 !text-white hover:!bg-white/25 !ring-white/30" onClick={doReopen}>
              <Unlock size={14} /> {t('Reopen year')}
            </Btn>
          )}
        </div>
      ) : (
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-slate-800 to-slate-900 dark:from-slate-700 dark:to-slate-800 text-white p-5 flex items-center gap-3 shadow-card">
          <CalendarCheck size={22} className="text-brand-300" />
          <div>
            <p className="font-bold">{fy.label} · {fmtDate(fy.start)} — {fmtDate(fy.end)}</p>
            <p className="text-white/70 text-sm">{t('Work through the checks below, then close the year to lock it.')}</p>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Step 1 — pre-close checks */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">
              <span className="text-gray-400 dark:text-slate-500 me-2">1.</span>{t('Pre-close review')}
            </h2>
            <span className={`text-xs font-semibold px-2 py-1 rounded-md ${warnings === 0 ? 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'}`}>
              {warnings === 0 ? t('All clear') : `${warnings} ${t('to review')}`}
            </span>
          </div>
          <div className="space-y-1">
            {checks.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-gray-50/70 dark:bg-slate-800/50">
                <div className="flex items-center gap-2.5 text-sm">
                  {c.ok
                    ? <CheckCircle2 size={16} className="text-success-500 flex-shrink-0" />
                    : <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />}
                  <span className={c.ok ? 'text-gray-600 dark:text-slate-300' : 'text-gray-800 dark:text-slate-100 font-medium'}>{t(c.label)}</span>
                </div>
                {!c.ok && (
                  <Link to={checkFix[c.id] || '/reports'} className="flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline">
                    {c.id === 'vat' ? fmtMoney(c.count, sym) : c.count} <ArrowRight size={12} />
                  </Link>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-4">{t('These are review prompts, not blockers — you decide when the year is ready.')}</p>
        </Card>

        {/* Step 2 — year summary + roll-forward */}
        <Card className="p-6">
          <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100 mb-4">
            <span className="text-gray-400 dark:text-slate-500 me-2">2.</span>{t('Result & retained earnings')}
          </h2>
          <StatRow label={t('Total Revenue')} value={fmtMoney(summary.revenue, sym)} />
          <StatRow label={t('Total Expenses')} value={fmtMoney(summary.expenses, sym)} />
          <StatRow label={t('Net income for the year')} value={fmtMoney(summary.netIncome, sym)} strong positive={summary.netIncome >= 0} />
          <div className="mt-5 rounded-xl bg-violet-50/70 dark:bg-violet-500/[0.08] p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-violet-600 dark:text-violet-300 mb-2">{t('Retained earnings roll-forward')}</p>
            <div className="text-sm space-y-1.5">
              <div className="flex justify-between text-gray-600 dark:text-slate-300"><span>{t('Opening retained earnings')}</span><span className="font-mono tabular-nums">{fmtMoney(summary.openingRE, sym)}</span></div>
              <div className="flex justify-between text-gray-600 dark:text-slate-300"><span>+ {t('Net income for the year')}</span><span className="font-mono tabular-nums">{fmtMoney(summary.netIncome, sym)}</span></div>
              <div className="flex justify-between font-bold text-gray-900 dark:text-slate-100 border-t border-violet-200 dark:border-violet-500/30 pt-1.5"><span>{t('Closing retained earnings')}</span><span className="font-mono tabular-nums">{fmtMoney(summary.closingRE, sym)}</span></div>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-violet-500 dark:text-violet-400 mt-3">
              <Sparkles size={12} className="mt-0.5 flex-shrink-0" />
              {t('Profit rolls into equity automatically on the balance sheet — no closing journal is posted, so past P&L reports stay intact.')}
            </p>
          </div>
        </Card>
      </div>

      {/* Step 3 — close */}
      {!closed && (
        <Card className="p-6 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">
                <span className="text-gray-400 dark:text-slate-500 me-2">3.</span>{t('Close the year')}
              </h2>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                {t('Locks all entries through')} <strong>{fmtDate(fy.end)}</strong> {t('— nothing can be posted, edited or deleted in the closed year.')}
              </p>
            </div>
            {isManager
              ? <Btn onClick={doClose}><Lock size={15} /> {t('Close')} {fy.label}</Btn>
              : <span className="text-xs text-gray-400 dark:text-slate-500">{t('Owners / Admins only')}</span>}
          </div>
        </Card>
      )}
    </div>
  )
}
