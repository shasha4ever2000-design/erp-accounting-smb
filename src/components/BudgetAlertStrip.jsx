import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { useT } from '../i18n'
import { fmtMoney } from '../utils/formatters'
import { budgetAlerts } from '../utils/budgetAlerts'
import { AlertTriangle, TrendingDown, ArrowRight } from 'lucide-react'

const TONE = {
  over:   { bar: 'bg-red-500',    chip: 'bg-red-50 text-red-700 dark:bg-red-900/25 dark:text-red-300',       label: 'Over budget' },
  warn:   { bar: 'bg-amber-500',  chip: 'bg-amber-50 text-amber-700 dark:bg-amber-900/25 dark:text-amber-300', label: 'Spending fast' },
  behind: { bar: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 dark:bg-violet-900/25 dark:text-violet-300', label: 'Behind target' },
}

/**
 * Dashboard budget warnings. Renders nothing at all when everything is on
 * pace — an alert strip that is always visible stops being an alert.
 */
export default function BudgetAlertStrip({ year, max = 4 }) {
  const t = useT()
  const navigate = useNavigate()
  const { accounts, budgets, journalEntries, getAccountBalance, settings } = useStore()
  const sym = settings.company.currencySymbol
  const yr = year || new Date().toISOString().slice(0, 4)

  const alerts = useMemo(
    () => budgetAlerts({
      accounts, budgets, year: yr,
      getActual: (id) => getAccountBalance(id, `${yr}-01-01`, `${yr}-12-31`),
    }),
    // journalEntries drives actuals through getAccountBalance
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, budgets, journalEntries, yr]
  )

  if (alerts.length === 0) return null

  return (
    <div className="mb-6 rounded-2xl bg-white dark:bg-surface-850 ring-1 ring-black/5 dark:ring-white/10 shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={15} className="text-amber-500" />
          <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-100">
            {t('Budget alerts')} <span className="text-gray-400 dark:text-slate-500 font-normal">({alerts.length})</span>
          </h2>
        </div>
        <button onClick={() => navigate('/budgets')} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline">
          {t('Budgets')} <ArrowRight size={12} className="rtl:rotate-180" />
        </button>
      </div>
      <div className="divide-y divide-gray-50 dark:divide-slate-800/60">
        {alerts.slice(0, max).map((a) => {
          const tone = TONE[a.severity]
          const width = Math.min(100, Math.max(0, a.pct))
          return (
            <div key={a.id} className="px-5 py-3">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className="flex items-center gap-2 min-w-0">
                  {a.severity === 'behind'
                    ? <TrendingDown size={13} className="text-violet-500 flex-shrink-0" />
                    : <AlertTriangle size={13} className={a.severity === 'over' ? 'text-red-500 flex-shrink-0' : 'text-amber-500 flex-shrink-0'} />}
                  <span className="text-sm font-medium text-gray-800 dark:text-slate-100 truncate">{a.name}</span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${tone.chip}`}>{t(tone.label)}</span>
                </span>
                <span className="text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
                  {fmtMoney(a.actual, sym)} / {fmtMoney(a.budget, sym)}
                </span>
              </div>
              {/* Actual vs the pace marker — the tick shows where the calendar is. */}
              <div className="relative h-1.5 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                <div className={`h-full ${tone.bar} transition-all`} style={{ width: `${width}%` }} />
              </div>
              <div className="relative h-2">
                <div className="absolute top-0 w-px h-1.5 bg-gray-400 dark:bg-slate-500" style={{ insetInlineStart: `${Math.min(100, a.elapsed)}%` }} />
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 -mt-0.5">{a.message}</p>
            </div>
          )
        })}
        {alerts.length > max && (
          <button onClick={() => navigate('/budgets')} className="w-full px-5 py-2 text-xs font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-50/50 dark:hover:bg-brand-500/[0.07] transition-colors text-start">
            {t('+{n} more').replace('{n}', alerts.length - max)}
          </button>
        )}
      </div>
    </div>
  )
}
