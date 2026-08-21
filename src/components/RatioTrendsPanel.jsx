import { useMemo, useState, lazy, Suspense } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { Card, Btn } from './UI'
import { fmtMoney } from '../utils/formatters'
import { computeFinancialHealth, healthInputs } from '../utils/financialHealth'
import { groupIdsWithRole, OTHER_INCOME } from '../utils/accountTree'
import { periodEnds, buildTrends, IMPROVING, WORSENING } from '../utils/ratioTrends'
import { TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2 } from 'lucide-react'

const TrendChart = lazy(() => import('./TrendChart'))

// Ratios over time.
//
// The chart is the obvious half. The half that changes a decision is the
// signals list above it — a metric still rated healthy that has fallen every
// period measured is exactly what the snapshot page cannot show, and it is
// the reason somebody would open this at all.

const STEPS = [
  { key: 'month', label: 'Monthly', count: 6 },
  { key: 'quarter', label: 'Quarterly', count: 6 },
  { key: 'year', label: 'Yearly', count: 4 },
]

const Arrow = ({ direction }) => {
  if (direction === IMPROVING) return <TrendingUp size={13} className="text-success-600 dark:text-success-400" />
  if (direction === WORSENING) return <TrendingDown size={13} className="text-danger-600 dark:text-danger-400" />
  return <Minus size={13} className="text-gray-400 dark:text-slate-500" />
}

export default function RatioTrendsPanel() {
  const t = useT()
  const { accounts, accountGroups = [], getAllBalances, settings } = useStore()
  const sym = settings.company.currencySymbol
  const [step, setStep] = useState('month')

  const trends = useMemo(() => {
    const cfg = STEPS.find((s) => s.key === step) || STEPS[0]
    const dates = periodEnds(new Date().toISOString().slice(0, 10), cfg.count, cfg.key)
    return buildTrends(
      dates,
      (d) => healthInputs({ accounts, accountGroups, getAllBalances }, d, groupIdsWithRole, OTHER_INCOME),
      computeFinancialHealth,
    )
  }, [accounts, accountGroups, getAllBalances, step])

  const scoreData = trends.scores
    .filter((s) => s.score != null)
    .map((s) => ({ label: s.asOf.slice(0, 7), score: s.score }))

  const grouped = trends.rows.reduce((acc, r) => {
    ;(acc[r.group] = acc[r.group] || []).push(r)
    return acc
  }, {})

  return (
    <Card className="p-6 mt-6">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('How the ratios are moving')}</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5 max-w-2xl">
            {t('A ratio on its own is a single frame. The same 1.4 means a business spending its buffer or one climbing out of trouble, and only the direction tells you which.')}
          </p>
        </div>
        <div className="flex gap-1.5">
          {STEPS.map((s) => (
            <Btn key={s.key} size="sm" variant={step === s.key ? 'primary' : 'secondary'}
              onClick={() => setStep(s.key)}>{t(s.label)}</Btn>
          ))}
        </div>
      </div>

      {/* The findings, before the chart — this is what a reader came for. */}
      {trends.signals.length > 0 ? (
        <div className="space-y-2 mb-5">
          {trends.signals.slice(0, 5).map((s, i) => (
            <div key={i} className={`flex items-start gap-2.5 rounded-lg px-3 py-2 text-sm ${
              s.severity === 'high' ? 'bg-danger-50 dark:bg-danger-500/10 text-danger-700 dark:text-danger-300'
                : s.severity === 'medium' ? 'bg-warning-50 dark:bg-warning-500/10 text-warning-800 dark:text-warning-300'
                  : 'bg-success-50 dark:bg-success-500/10 text-success-700 dark:text-success-300'}`}>
              {s.severity === 'good'
                ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
              <span>
                {s.kind === 'sliding'
                  ? (s.stillHealthy
                    ? t('{metric} is still healthy but has worsened for {n} periods running.')
                      .replace('{metric}', t(s.label)).replace('{n}', s.periods)
                    : t('{metric} has worsened for {n} periods running.')
                      .replace('{metric}', t(s.label)).replace('{n}', s.periods))
                  : t(s.kind === 'dropped'
                    ? '{metric} has fallen from {from} to {to} this period.'
                    : '{metric} has recovered from {from} to {to} this period.')
                    .replace('{metric}', t(s.label))
                    .replace('{from}', t(s.from)).replace('{to}', t(s.to))}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400 dark:text-slate-500 mb-5">
          {t('Nothing has changed band or moved consistently over these periods.')}
        </p>
      )}

      {scoreData.length > 1 && (
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">{t('Overall score')}</p>
          <Suspense fallback={<div className="h-[160px] animate-pulse bg-slate-100 dark:bg-surface-800 rounded-lg" />}>
            <TrendChart
              data={scoreData} xKey="label" height={160}
              series={[{ key: 'score', stroke: '#2563eb', gradientId: 'ratioScore' }]}
              formatValue={(v) => `${v}`} formatAxis={(v) => `${v}`}
            />
          </Suspense>
        </div>
      )}

      {Object.entries(grouped).map(([group, rows]) => (
        <div key={group} className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">{t(group)}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-gray-400 dark:text-slate-500">
                  <th className="text-start py-1.5 font-semibold">{t('Metric')}</th>
                  {trends.dates.map((d) => (
                    <th key={d} className="text-end py-1.5 font-semibold whitespace-nowrap px-2">{d.slice(0, 7)}</th>
                  ))}
                  <th className="text-end py-1.5 font-semibold">{t('Trend')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-gray-100 dark:border-slate-700">
                    <td className="py-1.5 text-gray-700 dark:text-slate-200" title={t(r.hint)}>{t(r.label)}</td>
                    {r.series.map((s, i) => (
                      <td key={i} className={`py-1.5 px-2 text-end tabular-nums whitespace-nowrap ${
                        s.rating === 'risk' ? 'text-danger-600 dark:text-danger-400'
                          : s.rating === 'watch' ? 'text-warning-700 dark:text-warning-400'
                            : 'text-gray-600 dark:text-slate-300'}`}>
                        {s.value == null ? '—' : (r.isMoney ? fmtMoney(s.value, sym) : s.display)}
                      </td>
                    ))}
                    <td className="py-1.5 text-end">
                      <span className="inline-flex items-center gap-1 justify-end">
                        <Arrow direction={r.sinceStart.direction} />
                        <span className="text-xs text-gray-400 dark:text-slate-500 tabular-nums">
                          {r.sinceStart.pct == null ? '' : `${r.sinceStart.pct > 0 ? '+' : ''}${Math.round(r.sinceStart.pct * 100)}%`}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Said once, plainly: an empty column is an empty period, not a zero. */}
      <p className="text-xs text-gray-400 dark:text-slate-500">
        {t('Each period is measured on its own terms — balances as at that date, profit and loss for the twelve months ending there. A dash means the business had no activity to measure, not a result of zero.')}
      </p>
    </Card>
  )
}
