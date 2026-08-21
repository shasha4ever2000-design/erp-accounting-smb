import { useState, useMemo, lazy, Suspense } from 'react'
import { useT } from '../i18n'
import { Card, Btn, Input } from './UI'
import { fmtMoney } from '../utils/formatters'
import { buildForecast } from '../utils/cashForecast'
import {
  LEVERS, PRESETS, emptyScenario, isActive, runScenario, compareForecasts, verdictOf,
} from '../utils/scenarios'
import { SlidersHorizontal, Plus, X, RotateCcw, ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react'

const TrendChart = lazy(() => import('./TrendChart'))

// "What if" against the cash forecast.
//
// The presets are phrased as the question an owner actually asks, because a
// row of sliders labelled with variable names invites fiddling rather than
// deciding. The verdict answers the question in one line before any chart,
// for the same reason.

const VERDICT_STYLE = {
  safe: { Icon: ShieldCheck, box: 'bg-success-50 dark:bg-success-500/10 border-success-200 dark:border-success-900', text: 'text-success-700 dark:text-success-300' },
  tight: { Icon: ShieldQuestion, box: 'bg-warning-50 dark:bg-warning-500/10 border-warning-200 dark:border-warning-900', text: 'text-warning-800 dark:text-warning-300' },
  breaks: { Icon: ShieldAlert, box: 'bg-danger-50 dark:bg-danger-500/10 border-danger-200 dark:border-danger-900', text: 'text-danger-700 dark:text-danger-300' },
}

export default function ScenarioPanel({ data, opts, base, sym }) {
  const t = useT()
  const [scenario, setScenario] = useState(emptyScenario())
  const [open, setOpen] = useState(false)

  const set = (k, v) => setScenario((s) => ({ ...s, [k]: v }))
  const active = isActive(scenario)

  const result = useMemo(() => {
    if (!active) return null
    const forecast = runScenario(buildForecast, data, opts, scenario)
    return { forecast, comparison: compareForecasts(base, forecast), verdict: verdictOf(forecast) }
  }, [active, scenario, data, opts, base])

  const chartData = useMemo(() => (base?.weeks || []).map((w, i) => ({
    week: `W${w.index}`,
    expected: w.closing,
    scenario: result ? result.forecast.weeks[i]?.closing ?? null : null,
  })), [base, result])

  const addOneOff = () => setScenario((s) => ({
    ...s,
    oneOffs: [...s.oneOffs, { label: '', amount: '', date: opts.from, recurring: false, months: 12 }],
  }))
  const setOneOff = (i, k, v) => setScenario((s) => ({
    ...s, oneOffs: s.oneOffs.map((o, j) => (j === i ? { ...o, [k]: v } : o)),
  }))
  const removeOneOff = (i) => setScenario((s) => ({ ...s, oneOffs: s.oneOffs.filter((_, j) => j !== i) }))

  const style = result?.verdict ? VERDICT_STYLE[result.verdict.key] : null
  const Icon = style?.Icon

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <SlidersHorizontal size={15} className="text-brand-500" /> {t('What if?')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5 max-w-2xl">
            {t('The forecast above is what happens if things go as expected. These are the other questions — the ones a decision actually turns on.')}
          </p>
        </div>
        {active && (
          <Btn size="sm" variant="secondary" onClick={() => setScenario(emptyScenario())}>
            <RotateCcw size={13} /> {t('Clear')}
          </Btn>
        )}
      </div>

      {/* Phrased as the question, not as the variable. */}
      <div className="flex flex-wrap gap-2 mb-4">
        {PRESETS.map((p) => (
          <button key={p.key}
            onClick={() => setScenario({ ...emptyScenario(), ...p.patch, name: p.name })}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-surface-800 transition-colors">
            {t(p.name)}
          </button>
        ))}
        <button onClick={() => setOpen((o) => !o)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline">
          {open ? t('Hide the dials') : t('Set your own')}
        </button>
      </div>

      {open && (
        <div className="grid gap-4 sm:grid-cols-2 mb-4">
          {LEVERS.map((l) => {
            const value = scenario[l.key] == null ? (l.key === 'overdueRecoveryPct' ? 100 : 0) : scenario[l.key]
            return (
              <div key={l.key}>
                <div className="flex items-baseline justify-between">
                  <label className="text-sm font-medium text-gray-700 dark:text-slate-200">{t(l.label)}</label>
                  <span className="text-sm tabular-nums text-gray-600 dark:text-slate-300">
                    {value > 0 && l.unit === '%' && l.key !== 'overdueRecoveryPct' ? '+' : ''}{value}{l.unit === '%' ? '%' : ` ${t('days')}`}
                  </span>
                </div>
                <input type="range" min={l.min} max={l.max} step={l.step} value={value}
                  onChange={(e) => set(l.key, Number(e.target.value))}
                  className="w-full mt-1 accent-brand-600" />
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{t(l.hint)}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* One-offs: the hire, the machine, the loan. */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-slate-200">{t('One-off decisions')}</span>
          <Btn size="sm" variant="secondary" onClick={addOneOff}><Plus size={13} /> {t('Add')}</Btn>
        </div>
        {scenario.oneOffs.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-slate-500">{t('A hire, a machine, a loan — anything that would change the cash but is not in the books yet.')}</p>
        )}
        {scenario.oneOffs.map((o, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr,120px,150px,auto] items-end mb-2">
            <Input label={i === 0 ? t('What') : ''} value={o.label} placeholder={t('e.g. New salesperson')}
              onChange={(e) => setOneOff(i, 'label', e.target.value)} />
            <Input label={i === 0 ? t('Amount') : ''} type="number" step="0.01" value={o.amount}
              placeholder="-8000" onChange={(e) => setOneOff(i, 'amount', e.target.value)} />
            <Input label={i === 0 ? t('Starting') : ''} type="date" value={o.date}
              onChange={(e) => setOneOff(i, 'date', e.target.value)} />
            <div className="flex items-center gap-2 pb-2">
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-300 cursor-pointer whitespace-nowrap">
                <input type="checkbox" checked={!!o.recurring} onChange={(e) => setOneOff(i, 'recurring', e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 dark:border-slate-600" />
                {t('every month')}
              </label>
              <button onClick={() => removeOneOff(i)} className="text-gray-400 hover:text-danger-500 p-1"><X size={14} /></button>
            </div>
          </div>
        ))}
        <p className="text-xs text-gray-400 dark:text-slate-500">{t('Use a negative amount for money going out.')}</p>
      </div>

      {result && (
        <>
          <div className={`rounded-xl border p-4 mb-4 ${style.box}`}>
            <div className="flex items-start gap-3">
              <Icon size={18} className={`${style.text} mt-0.5 shrink-0`} />
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${style.text}`}>
                  {result.verdict.key === 'breaks'
                    ? t('This scenario runs out of cash in week {n}.').replace('{n}', result.verdict.week)
                    : result.verdict.key === 'tight'
                      ? t('This scenario survives, but the buffer gets thin.')
                      : t('This scenario stays in cash throughout.')}
                </p>
                <p className={`text-xs mt-1 ${style.text} opacity-90`}>
                  {t('Lowest point')}: {fmtMoney(result.comparison.scenarioLowest, sym)}
                  {' · '}{t('was')} {fmtMoney(result.comparison.baseLowest, sym)}
                  {' · '}{t('cash at the end')} {fmtMoney(result.forecast.closingCash, sym)}
                  {' ('}{result.comparison.closingChange >= 0 ? '+' : ''}{fmtMoney(result.comparison.closingChange, sym)}{')'}
                </p>
              </div>
            </div>
          </div>

          <Suspense fallback={<div className="h-[220px] animate-pulse bg-slate-100 dark:bg-surface-800 rounded-lg" />}>
            <TrendChart
              data={chartData} xKey="week" height={220}
              series={[
                { key: 'expected', stroke: '#94a3b8', gradientId: 'scBase', fillOpacity: 0.08 },
                { key: 'scenario', stroke: result.forecast.shortfall ? '#e11d48' : '#2563eb', gradientId: 'scAlt' },
              ]}
              formatValue={(v) => fmtMoney(v, sym)}
              formatAxis={(v) => `${sym}${Math.round(v / 1000)}k`}
            />
          </Suspense>
        </>
      )}

      {/* Stated once, plainly. A number this easy to produce is easy to believe. */}
      <p className="text-xs text-gray-400 dark:text-slate-500 mt-3">
        {t('A scenario is a projection of a projection: it inherits every assumption the forecast makes and adds more. It shows which decisions are survivable, not what will happen.')}
      </p>
      <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
        {t('A change in sales moves future work only — invoices already raised are money owed, not sales still to win.')}
      </p>
    </Card>
  )
}
