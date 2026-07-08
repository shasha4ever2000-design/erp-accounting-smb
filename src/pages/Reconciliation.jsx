import { useState, useMemo, useRef } from 'react'
import { useT, tr } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Select, Input, Btn, Modal } from '../components/UI'
import { parseCSV, detectStatementColumns } from '../utils/csv'
import { CheckCircle2, Circle, Landmark, Upload, AlertCircle } from 'lucide-react'

export default function Reconciliation() {
  const t = useT()
  const { bankAccounts, journalEntries, reconciliations, toggleReconciled, getAccountBalance, settings } = useStore()
  const sym = settings.company.currencySymbol

  const [accId, setAccId] = useState(bankAccounts[0]?.accountId || '')
  const [stmtBalance, setStmtBalance] = useState('')
  const fileRef = useRef(null)
  const [importResult, setImportResult] = useState(null) // { matched:[], unmatched:[], error? }

  const movements = useMemo(() => {
    const rows = []
    journalEntries.forEach((je) => {
      const delta = je.lines.filter((l) => l.accountId === accId).reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0)
      if (delta !== 0) rows.push({ id: je.id, date: je.date, desc: je.description, ref: je.number, amount: delta })
    })
    return rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  }, [journalEntries, accId])

  const isRec = (jeId) => reconciliations.includes(`${accId}::${jeId}`)

  // ─── CSV statement import + auto-match ─────────────────────────────
  const parseAmount = (s) => parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')) || 0
  const normalizeDate = (s) => {
    const v = String(s || '').trim()
    let m = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    m = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/) // dd/mm/yyyy
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` }
    return v
  }

  const handleImportFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const { headers, rows } = parseCSV(ev.target.result)
        const col = detectStatementColumns(headers)
        if (col.date < 0 || (col.amount < 0 && col.debit < 0 && col.credit < 0)) {
          setImportResult({ error: t('Could not detect Date and Amount columns. Expected headers like Date, Description, Amount (or Debit/Credit).') })
          return
        }
        const stmtLines = rows.map((r) => {
          const amount = col.amount >= 0 ? parseAmount(r[col.amount]) : parseAmount(r[col.credit]) - parseAmount(r[col.debit])
          return { date: normalizeDate(r[col.date]), desc: (col.description >= 0 ? r[col.description] : '').trim(), amount }
        }).filter((l) => l.amount !== 0 || l.desc)

        // Auto-match each statement line to an unreconciled ledger movement
        // (same amount within 0.01, date within ±5 days), each used once.
        const used = new Set()
        const matched = []
        const unmatched = []
        stmtLines.forEach((sl) => {
          const hit = movements.find((m) => !used.has(m.id) && !isRec(m.id)
            && Math.abs(m.amount - sl.amount) < 0.01
            && Math.abs((new Date(m.date) - new Date(sl.date)) / 86400000) <= 5)
          if (hit) { used.add(hit.id); matched.push({ ...sl, jeId: hit.id }) }
          else unmatched.push(sl)
        })
        setImportResult({ matched, unmatched })
      } catch (err) {
        setImportResult({ error: t('Could not read this file.') + ' ' + err.message })
      }
    }
    reader.readAsText(file)
  }

  const clearMatched = () => {
    importResult.matched.forEach((m) => { if (!isRec(m.jeId)) toggleReconciled(accId, m.jeId) })
    setImportResult(null)
  }
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
          <div className="ml-auto">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportFile} />
            <Btn variant="secondary" onClick={() => fileRef.current?.click()}><Upload size={15} /> {t('Import Statement (CSV)')}</Btn>
          </div>
        </div>
        <p className="text-xs text-gray-400 dark:text-slate-500 mt-2">{t('Upload a bank statement CSV to auto-match and clear transactions. Expected columns: Date, Description, Amount (or Debit/Credit).')}</p>
      </Card>

      <Modal open={!!importResult} onClose={() => setImportResult(null)} title={t('Import Bank Statement')} width="max-w-2xl">
        {importResult?.error ? (
          <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle size={18} className="flex-shrink-0 mt-0.5" /><span>{importResult.error}</span>
          </div>
        ) : importResult && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-3">
                <p className="text-2xl font-bold text-green-700 dark:text-green-300">{importResult.matched.length}</p>
                <p className="text-xs text-green-600 dark:text-green-400">{t('matched to your ledger')}</p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/30 rounded-lg p-3">
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{importResult.unmatched.length}</p>
                <p className="text-xs text-amber-600 dark:text-amber-400">{t('not found in your books')}</p>
              </div>
            </div>

            {importResult.unmatched.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase mb-1.5">{t('Unmatched statement lines')}</p>
                <div className="max-h-48 overflow-y-auto border border-gray-100 dark:border-slate-700 rounded-lg divide-y divide-gray-50 dark:divide-slate-700/50">
                  {importResult.unmatched.map((u, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-gray-500 dark:text-slate-400">{fmtDate(u.date)}</span>
                      <span className="flex-1 px-3 truncate text-gray-700 dark:text-slate-200">{u.desc || '—'}</span>
                      <span className={u.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>{u.amount >= 0 ? '+' : '−'}{fmtMoney(Math.abs(u.amount), sym)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-1.5">{t('Record these in the Banking module, then re-import to clear them.')}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Btn variant="secondary" onClick={() => setImportResult(null)}>{t('Cancel')}</Btn>
              <Btn onClick={clearMatched} disabled={importResult.matched.length === 0}>
                <CheckCircle2 size={15} /> {t('Clear matched transactions')}
              </Btn>
            </div>
          </div>
        )}
      </Modal>

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
          <h3 className="font-semibold text-sm text-gray-700 dark:text-slate-200">{t('Transactions — tick each one that appears on your bank statement')}</h3>
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
      <p className="text-[11px] uppercase text-gray-400 dark:text-slate-500">{typeof label === 'string' ? tr(label) : label}</p>
      <p className="text-lg font-bold text-gray-800 dark:text-slate-100">{value}</p>
    </div>
  )
}
