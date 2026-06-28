import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney } from '../utils/formatters'
import { PageHeader, Card, Btn, Select } from '../components/UI'
import { format } from 'date-fns'
import { Target, Save } from 'lucide-react'

export default function Budgets() {
  const t = useT()
  const { accounts, budgets, setBudget, getAccountBalance, settings } = useStore()
  const sym = settings.company.currencySymbol

  const thisYear = format(new Date(), 'yyyy')
  const years = [String(+thisYear - 1), thisYear, String(+thisYear + 1)]
  const [year, setYear] = useState(thisYear)
  const [drafts, setDrafts] = useState({})
  const [saved, setSaved] = useState(false)

  const start = `${year}-01-01`
  const end = `${year}-12-31`

  const budgetFor = (accId) => {
    if (drafts[accId] !== undefined) return drafts[accId]
    const b = budgets.find((x) => x.accountId === accId && x.year === year)
    return b ? String(b.amount) : ''
  }

  const revenue = accounts.filter((a) => a.type === 'revenue')
  const expense = accounts.filter((a) => a.type === 'expense')

  const rows = useMemo(() => {
    const build = (accs) => accs.map((a) => {
      const actual = getAccountBalance(a.id, start, end)
      const budget = parseFloat(budgetFor(a.id)) || 0
      return { ...a, actual, budget, variance: budget - actual, pct: budget ? (actual / budget) * 100 : 0 }
    })
    return { revenue: build(revenue), expense: build(expense) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, budgets, drafts, year])

  const totals = useMemo(() => {
    const sum = (arr, k) => arr.reduce((s, r) => s + r[k], 0)
    return {
      budRev: sum(rows.revenue, 'budget'), actRev: sum(rows.revenue, 'actual'),
      budExp: sum(rows.expense, 'budget'), actExp: sum(rows.expense, 'actual'),
    }
  }, [rows])

  const handleSave = () => {
    Object.entries(drafts).forEach(([accId, val]) => setBudget(accId, year, parseFloat(val) || 0))
    setDrafts({})
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const Section = ({ title, data, color }) => (
    <Card className="overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
        <h3 className={`font-semibold text-sm uppercase tracking-wide ${color}`}>{title}</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-slate-800/60">
          <tr className="text-xs text-gray-400 dark:text-slate-500 uppercase">
            <th className="text-left px-5 py-2 font-medium">Account</th>
            <th className="text-right px-3 py-2 font-medium w-36">{t('Annual Budget')}</th>
            <th className="text-right px-3 py-2 font-medium">Actual</th>
            <th className="text-right px-3 py-2 font-medium">Variance</th>
            <th className="text-left px-5 py-2 font-medium w-40">Used</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id} className="border-b border-gray-50 dark:border-slate-700/50">
              <td className="px-5 py-2 text-gray-700 dark:text-slate-200"><span className="font-mono text-xs text-gray-400 dark:text-slate-500 mr-2">{r.code}</span>{r.name}</td>
              <td className="px-3 py-1.5 text-right">
                <input type="number" min="0" step="0.01"
                  value={budgetFor(r.id)}
                  onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                  placeholder="0"
                  className="w-28 text-right border border-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </td>
              <td className="px-3 py-2 text-right font-medium text-gray-800 dark:text-slate-100">{fmtMoney(r.actual, sym)}</td>
              <td className={`px-3 py-2 text-right font-medium ${r.variance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{fmtMoney(r.variance, sym)}</td>
              <td className="px-5 py-2">
                {r.budget > 0 ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden">
                      <div className={`h-full ${r.pct > 100 ? 'bg-red-500' : r.pct > 85 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, r.pct)}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 dark:text-slate-500 w-9 text-right">{r.pct.toFixed(0)}%</span>
                  </div>
                ) : <span className="text-xs text-gray-300 dark:text-slate-600">—</span>}
              </td>
            </tr>
          ))}
          {data.length === 0 && <tr><td colSpan={5} className="px-5 py-4 text-center text-gray-400 text-sm">{t('No accounts')}</td></tr>}
        </tbody>
      </table>
    </Card>
  )

  const netBudget = totals.budRev - totals.budExp
  const netActual = totals.actRev - totals.actExp

  return (
    <div>
      <PageHeader
        title="Budgets vs Actuals"
        subtitle="Plan revenue & expenses, then track performance against the live ledger"
        action={
          <div className="flex gap-2 items-center">
            <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-32">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            <Btn onClick={handleSave}><Save size={15} /> {saved ? 'Saved!' : 'Save Budget'}</Btn>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <SummaryCard label="Net Budgeted" value={fmtMoney(netBudget, sym)} icon={<Target size={18} />} tone="indigo" />
        <SummaryCard label="Net Actual" value={fmtMoney(netActual, sym)} tone={netActual >= 0 ? 'green' : 'red'} />
        <SummaryCard label="Net Variance" value={fmtMoney(netBudget - netActual, sym)} tone={(netBudget - netActual) >= 0 ? 'green' : 'red'} />
      </div>

      <div className="space-y-6">
        <Section title="Revenue" data={rows.revenue} color="text-green-700 dark:text-green-400" />
        <Section title="Expenses" data={rows.expense} color="text-red-700 dark:text-red-400" />
      </div>
    </div>
  )
}

function SummaryCard({ label, value, icon, tone }) {
  const tones = {
    indigo: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
    green:  'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    red:    'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  }
  return (
    <div className={`rounded-xl p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2 mb-1">{icon}<p className="text-sm opacity-80">{label}</p></div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )
}
