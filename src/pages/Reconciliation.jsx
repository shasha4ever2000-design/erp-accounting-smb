import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Select, Input } from '../components/UI'
import { CheckCircle2, Circle, Landmark } from 'lucide-react'

export default function Reconciliation() {
  const t = useT()
  const { bankAccounts, journalEntries, reconciliations, toggleReconciled, getAccountBalance, settings } = useStore()
  const sym = settings.company.currencySymbol

  const [accId, setAccId] = useState(bankAccounts[0]?.accountId || '')
  const [stmtBalance, setStmtBalance] = useState('')

  const movements = useMemo(() => {
    const rows = []
    journalEntries.forEach((je) => {
      const delta = je.lines.filter((l) => l.accountId === accId).reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0)
      if (delta !== 0) rows.push({ id: je.id, date: je.date, desc: je.description, ref: je.number, amount: delta })
    })
    return rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  }, [journalEntries, accId])

  const isRec = (jeId) => reconciliations.includes(`${accId}::${jeId}`)
  const clearedBalance = movements.filter((m) => isRec(m.id)).reduce((s, m) => s + m.amount, 0)
  const bookBalance = getAccountBalance(accId)
  const stmt = parseFloat(stmtBalance)
  const difference = isNaN(stmt) ? null : stmt - clearedBalance
  const reconciled = difference !== null && Math.abs(difference) < 0.01

  return (
    <div>
      <PageHeader title="Bank Reconciliation" subtitle="Match your ledger to the bank statement and clear transactions" />

      <Card className="p-5 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <Select label="Bank / Cash Account" value={accId} onChange={(e) => setAccId(e.target.value)} className="w-64">
            {bankAccounts.map((b) => <option key={b.id} value={b.accountId}>{b.name}</option>)}
          </Select>
          <Input label="Statement Ending Balance" type="number" step="0.01" value={stmtBalance} onChange={(e) => setStmtBalance(e.target.value)} className="w-48" placeholder="From your bank" />
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Kpi label="Book Balance" value={fmtMoney(bookBalance, sym)} />
        <Kpi label="Cleared Balance" value={fmtMoney(clearedBalance, sym)} />
        <Kpi label="Uncleared" value={fmtMoney(bookBalance - clearedBalance, sym)} />
        <div className={`rounded-xl p-4 ${reconciled ? 'bg-green-50 dark:bg-green-900/30' : difference === null ? 'bg-gray-50 dark:bg-slate-800' : 'bg-amber-50 dark:bg-amber-900/30'}`}>
          <p className="text-[11px] uppercase text-gray-400 dark:text-slate-500">Difference</p>
          <p className={`text-lg font-bold ${reconciled ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
            {difference === null ? '—' : fmtMoney(difference, sym)}
          </p>
          {reconciled && <p className="text-[11px] text-green-600 dark:text-green-400">✓ Reconciled</p>}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2">
          <Landmark size={15} className="text-gray-400" />
          <h3 className="font-semibold text-sm text-gray-700 dark:text-slate-200">Transactions — tick each one that appears on your bank statement</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-800/60">
            <tr className="text-xs text-gray-400 dark:text-slate-500 uppercase">
              <th className="px-4 py-2 text-left w-12">Clear</th>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">{t('Description')}</th>
              <th className="px-4 py-2 text-left">Ref</th>
              <th className="px-4 py-2 text-right">{t('Amount')}</th>
            </tr>
          </thead>
          <tbody>
            {movements.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 dark:text-slate-500">{t('No transactions for this account')}</td></tr>}
            {movements.map((m) => {
              const rec = isRec(m.id)
              return (
                <tr key={m.id} className={`border-b border-gray-50 dark:border-slate-700/50 cursor-pointer ${rec ? 'bg-green-50/40 dark:bg-green-900/10' : 'hover:bg-gray-50 dark:hover:bg-slate-700/30'}`}
                  onClick={() => toggleReconciled(accId, m.id)}>
                  <td className="px-4 py-2">{rec ? <CheckCircle2 size={17} className="text-green-500" /> : <Circle size={17} className="text-gray-300 dark:text-slate-600" />}</td>
                  <td className="px-4 py-2 text-gray-500 dark:text-slate-400">{fmtDate(m.date)}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-slate-200">{m.desc}</td>
                  <td className="px-4 py-2 text-gray-400 dark:text-slate-500 font-mono text-xs">{m.ref}</td>
                  <td className={`px-4 py-2 text-right font-medium ${m.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                    {m.amount >= 0 ? '+' : '−'}{fmtMoney(Math.abs(m.amount), sym)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function Kpi({ label, value }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-gray-100 dark:border-slate-700">
      <p className="text-[11px] uppercase text-gray-400 dark:text-slate-500">{label}</p>
      <p className="text-lg font-bold text-gray-800 dark:text-slate-100">{value}</p>
    </div>
  )
}
