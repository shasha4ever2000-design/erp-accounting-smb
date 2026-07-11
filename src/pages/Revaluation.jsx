import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Input } from '../components/UI'
import { RefreshCw, TrendingUp, TrendingDown, Info } from 'lucide-react'

// Period-end foreign-currency revaluation. Accounts tagged with a non-base
// currency (Chart of Accounts) are restated to the closing rate; the unrealized
// difference posts to "Unrealized FX Gain/(Loss)".
export default function Revaluation() {
  const t = useT()
  const { accounts, currencies, settings, journalEntries, getAllBalances, postFxRevaluation, fxRevaluations } = useStore()
  const base = settings.company.currency
  const sym = settings.company.currencySymbol

  // depend on journalEntries so balances recompute after posting a revaluation
  // (getAllBalances is a stable reference and would otherwise never refresh)
  const balances = useMemo(() => getAllBalances(), [getAllBalances, journalEntries])
  const naturalBalance = (a) => {
    const b = balances[a.id]
    if (!b) return 0
    return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr
  }

  const fxAccounts = accounts.filter((a) => a.currency && a.currency !== base)
  const rateOf = (code) => currencies.find((c) => c.code === code)?.rate || 1

  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  // per-account editable { rate, fcBalance }
  const [rows, setRows] = useState(() => {
    const init = {}
    fxAccounts.forEach((a) => {
      const cur = naturalBalance(a)
      const r = rateOf(a.currency)
      init[a.id] = { rate: String(r), fcBalance: String(Math.round(cur * r * 100) / 100) }
    })
    return init
  })
  const setCell = (id, k, v) => setRows((s) => ({ ...s, [id]: { ...s[id], [k]: v } }))

  const computed = fxAccounts.map((a) => {
    const cur = naturalBalance(a)
    const rate = parseFloat(rows[a.id]?.rate) || 0
    const fc = parseFloat(rows[a.id]?.fcBalance) || 0
    const revalued = rate ? fc / rate : cur
    const delta = Math.round((revalued - cur) * 100) / 100
    // P&L impact: a debit-natured account (asset) gains when its base value rises;
    // a credit-natured account (liability) loses when its base value rises.
    const gl = ['asset', 'expense'].includes(a.type) ? delta : -delta
    return { acc: a, currentBase: cur, rate, fc, revaluedBase: Math.round(revalued * 100) / 100, delta, gl }
  })
  const totalDelta = computed.reduce((s, r) => s + r.gl, 0)
  const hasChanges = computed.some((r) => Math.abs(r.delta) >= 0.01)

  const post = () => {
    if (!hasChanges) return alert(t('No revaluation difference to post.'))
    if (!confirm(t('Post FX revaluation dated {d}?').replace('{d}', date))) return
    try {
      const rec = postFxRevaluation({
        date, note,
        entries: computed.map((r) => ({
          accountId: r.acc.id, currency: r.acc.currency, fcBalance: r.fc,
          rate: r.rate, currentBase: r.currentBase, revaluedBase: r.revaluedBase,
        })),
      })
      if (rec) alert(t('FX revaluation posted.'))
    } catch (e) {
      if (String(e.message).startsWith('PERIOD_LOCKED')) return alert(t('This date falls in a closed accounting period. Choose a later date.'))
      throw e
    }
  }

  return (
    <div>
      <PageHeader title="FX Revaluation" subtitle="Restate foreign-currency balances to the closing rate and post the unrealized gain / loss" />

      <Card className="p-4 mb-6 flex flex-wrap items-end gap-4">
        <Input label={t('Revaluation date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
        <Input label={t('Note (optional)')} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. December close')} className="w-56" />
        <div className="ms-auto text-end">
          <p className="text-xs text-gray-400 dark:text-slate-500">{t('Net unrealized')}</p>
          <p className={`text-lg font-bold ${totalDelta >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {totalDelta >= 0 ? '+' : ''}{fmtMoney(totalDelta, sym)}
          </p>
        </div>
        <Btn onClick={post} disabled={!hasChanges}><RefreshCw size={15} /> {t('Post Revaluation')}</Btn>
      </Card>

      {fxAccounts.length === 0 ? (
        <Card className="p-8 text-center text-gray-400 dark:text-slate-500">
          <Info size={26} className="mx-auto mb-3 opacity-50" />
          <p>{t('No foreign-currency accounts yet.')}</p>
          <p className="text-xs mt-1">{t('Tag an account with a foreign currency in the Chart of Accounts to revalue it here.')}</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 text-xs uppercase">
                <th className="py-2.5 px-3 text-start font-semibold">{t('Account')}</th>
                <th className="py-2.5 px-3 text-center font-semibold">{t('Currency')}</th>
                <th className="py-2.5 px-3 text-end font-semibold">{t('FC Balance')}</th>
                <th className="py-2.5 px-3 text-end font-semibold">{t('Closing Rate')}</th>
                <th className="py-2.5 px-3 text-end font-semibold">{t('Carrying')} ({base})</th>
                <th className="py-2.5 px-3 text-end font-semibold">{t('Revalued')} ({base})</th>
                <th className="py-2.5 px-3 text-end font-semibold">{t('Gain / (Loss)')}</th>
              </tr>
            </thead>
            <tbody>
              {computed.map((r) => (
                <tr key={r.acc.id} className="border-b border-gray-50 dark:border-slate-700/50">
                  <td className="py-2 px-3 text-gray-700 dark:text-slate-200"><span className="font-mono text-xs text-gray-400 me-2">{r.acc.code}</span>{r.acc.name}</td>
                  <td className="py-2 px-3 text-center"><span className="text-[10px] font-semibold bg-accent-50 text-accent-700 dark:bg-accent-500/10 dark:text-accent-300 px-1.5 py-0.5 rounded">{r.acc.currency}</span></td>
                  <td className="py-2 px-3 text-end">
                    <input type="number" step="0.01" value={rows[r.acc.id]?.fcBalance ?? ''} onChange={(e) => setCell(r.acc.id, 'fcBalance', e.target.value)}
                      className="w-28 text-end border border-gray-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </td>
                  <td className="py-2 px-3 text-end">
                    <input type="number" step="0.0001" value={rows[r.acc.id]?.rate ?? ''} onChange={(e) => setCell(r.acc.id, 'rate', e.target.value)}
                      className="w-24 text-end border border-gray-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </td>
                  <td className="py-2 px-3 text-end text-gray-600 dark:text-slate-300">{fmtMoney(r.currentBase, sym)}</td>
                  <td className="py-2 px-3 text-end font-medium text-gray-800 dark:text-slate-100">{fmtMoney(r.revaluedBase, sym)}</td>
                  <td className={`py-2 px-3 text-end font-semibold ${r.gl > 0 ? 'text-green-600 dark:text-green-400' : r.gl < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-slate-500'}`}>
                    <span className="inline-flex items-center gap-1 justify-end">
                      {r.gl > 0 && <TrendingUp size={12} />}{r.gl < 0 && <TrendingDown size={12} />}
                      {r.gl >= 0 ? '' : '('}{fmtMoney(Math.abs(r.gl), sym)}{r.gl >= 0 ? '' : ')'}
                    </span>
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300 dark:border-slate-500 bg-gray-50/60 dark:bg-slate-700/40 font-bold">
                <td className="py-2 px-3" colSpan={6}>{t('Net Unrealized FX Gain / (Loss)')}</td>
                <td className={`py-2 px-3 text-end ${totalDelta >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{totalDelta >= 0 ? '' : '('}{fmtMoney(Math.abs(totalDelta), sym)}{totalDelta >= 0 ? '' : ')'}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}

      {fxRevaluations.length > 0 && (
        <Card className="mt-6">
          <div className="p-4 border-b border-gray-100 dark:border-slate-700 font-semibold text-gray-700 dark:text-slate-200">{t('Revaluation History')}</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-700 text-gray-500 dark:text-slate-400 text-xs uppercase">
                <th className="py-2 px-3 text-start font-semibold">{t('Date')}</th>
                <th className="py-2 px-3 text-start font-semibold">{t('Note')}</th>
                <th className="py-2 px-3 text-end font-semibold">{t('Accounts')}</th>
                <th className="py-2 px-3 text-end font-semibold">{t('Gain / (Loss)')}</th>
              </tr>
            </thead>
            <tbody>
              {[...fxRevaluations].reverse().map((r) => (
                <tr key={r.id} className="border-b border-gray-50 dark:border-slate-700/50">
                  <td className="py-2 px-3 text-gray-600 dark:text-slate-300">{fmtDate(r.date)}</td>
                  <td className="py-2 px-3 text-gray-600 dark:text-slate-300">{r.note || '—'}</td>
                  <td className="py-2 px-3 text-end text-gray-600 dark:text-slate-300">{r.entries.length}</td>
                  <td className={`py-2 px-3 text-end font-semibold ${r.gainLoss >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{r.gainLoss >= 0 ? '' : '('}{fmtMoney(Math.abs(r.gainLoss), sym)}{r.gainLoss >= 0 ? '' : ')'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
