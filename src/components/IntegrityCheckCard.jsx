import { useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { Card, Btn } from './UI'
import { runIntegrityCheck } from '../utils/integrityCheck'
import { ShieldCheck, ShieldAlert, CheckCircle2, XCircle, RefreshCw, Activity } from 'lucide-react'

export default function IntegrityCheckCard() {
  const t = useT()
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  const run = () => {
    setBusy(true)
    // Defer a frame so the spinner paints before the (synchronous) sweep runs.
    setTimeout(() => {
      try { setResult(runIntegrityCheck(useStore.getState())) }
      finally { setBusy(false) }
    }, 30)
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
          <Activity size={14} className="text-white" />
        </div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Data Integrity Check')}</h2>
      </div>

      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
        {t('Verifies your books obey double-entry: every entry balances, the trial balance nets to zero, and the balance sheet equation holds. Read-only — it never changes your data.')}
      </p>

      {result && (
        <div className={`mb-4 rounded-xl px-4 py-3.5 flex items-start gap-3 ${result.ok
          ? 'bg-success-50 dark:bg-success-500/10'
          : 'bg-red-50 dark:bg-red-900/20'}`}>
          {result.ok
            ? <ShieldCheck size={20} className="text-success-600 dark:text-success-400 flex-shrink-0 mt-0.5" />
            : <ShieldAlert size={20} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <p className={`font-bold ${result.ok ? 'text-success-700 dark:text-success-300' : 'text-red-700 dark:text-red-300'}`}>
              {result.ok ? t('Books verified — all checks passed') : t('{n} issue(s) need attention').replace('{n}', result.failed)}
            </p>
            <p className={`text-xs mt-0.5 ${result.ok ? 'text-success-600 dark:text-success-400' : 'text-red-600 dark:text-red-400'}`}>
              {t('{p} of {total} checks passed').replace('{p}', result.passed).replace('{total}', result.checks.length)} · {new Date(result.ranAt).toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-1.5 mb-4">
          {result.checks.map((c) => (
            <div key={c.id} className={`rounded-lg px-3 py-2.5 ${c.ok ? 'bg-gray-50/70 dark:bg-slate-800/50' : 'bg-red-50/70 dark:bg-red-900/15'}`}>
              <div className="flex items-start justify-between gap-3 text-sm">
                <span className="flex items-start gap-2.5 min-w-0">
                  {c.ok
                    ? <CheckCircle2 size={15} className="text-success-500 flex-shrink-0 mt-0.5" />
                    : <XCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />}
                  <span className={c.ok ? 'text-gray-600 dark:text-slate-300' : 'text-gray-800 dark:text-slate-100 font-medium'}>{t(c.label)}</span>
                </span>
                <span className={`text-xs whitespace-nowrap ${c.ok ? 'text-gray-400 dark:text-slate-500' : 'text-red-600 dark:text-red-400 font-semibold'}`}>{c.detail}</span>
              </div>
              {/* On failure, name the offending records so it's actionable. */}
              {!c.ok && c.items.length > 0 && (
                <ul className="mt-2 ms-6 space-y-0.5">
                  {c.items.slice(0, 8).map((it, i) => (
                    <li key={i} className="text-xs text-red-600/90 dark:text-red-400/90 font-mono">
                      {it.ref}{it.date ? ` · ${it.date}` : ''} — {it.detail}
                    </li>
                  ))}
                  {c.items.length > 8 && (
                    <li className="text-xs text-red-500/70 dark:text-red-400/70">
                      {t('…and {n} more').replace('{n}', c.items.length - 8)}
                    </li>
                  )}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Btn onClick={run} disabled={busy}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> {busy ? t('Checking…') : result ? t('Run again') : t('Run check')}
        </Btn>
        {!result && <span className="text-xs text-gray-400 dark:text-slate-500">{t('Takes a second — safe to run anytime.')}</span>}
      </div>
    </Card>
  )
}
