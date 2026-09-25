import { useState, useMemo, useRef } from 'react'
import { useT, tr } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Select, Input, Btn, Modal } from '../components/UI'
import { parseStatement, matchToLedger, suggestDocument } from '../utils/bankStatement'
import { documentDue } from '../utils/partyBalance'
import { matchRule, suggestRules } from '../utils/bankRules'
import { CheckCircle2, Circle, Landmark, Upload, AlertCircle, Filter, Sparkles, Zap, Plus } from 'lucide-react'
import { todayISO } from '../utils/localDate'
import { ask } from '../components/Dialogs'

export default function Reconciliation() {
  const t = useT()
  const { bankAccounts, accounts, journalEntries, reconciliations, toggleReconciled, getAccountBalance,
    matchRules, addMatchRule, deleteMatchRule, addBankTransaction, bankTransactions, settings,
    invoices, purchases, customers, suppliers, creditNotes, debitNotes, recordInvoicePayment, recordPurchasePayment } = useStore()
  const sym = settings.company.currencySymbol

  const [accId, setAccId] = useState(bankAccounts[0]?.accountId || '')
  const [stmtBalance, setStmtBalance] = useState('')
  const fileRef = useRef(null)
  const [importResult, setImportResult] = useState(null) // { matched:[], unmatched:[], error? }
  const [newRule, setNewRule] = useState({ contains: '', accountId: '' })

  // category accounts to book statement lines against (exclude bank/cash accounts themselves)
  const bankAcctIds = new Set(bankAccounts.map((b) => b.accountId))
  const categoryAccounts = accounts.filter((a) => !bankAcctIds.has(a.id) && ['revenue', 'expense', 'liability', 'asset', 'equity'].includes(a.type))
  // Delegates to the shared engine so a rule's direction and amount bounds are
  // honoured (the previous inline matcher ignored the stored flow entirely) and
  // the most specific rule wins rather than merely the first declared.
  const ruleFor = (desc, amount = 0) => matchRule(matchRules, { description: desc, amount })

  // Rules mined from already-categorised bank history, so the app learns from
  // what has been booked before instead of relying only on hand-written rules.
  const suggestions = useMemo(
    () => suggestRules(bankTransactions, matchRules).slice(0, 5),
    [bankTransactions, matchRules]
  )
  const acctName = (id) => accounts.find((a) => a.id === id)?.name || id

  const movements = useMemo(() => {
    const rows = []
    journalEntries.forEach((je) => {
      const delta = je.lines.filter((l) => l.accountId === accId).reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0)
      if (delta !== 0) rows.push({ id: je.id, date: je.date, desc: je.description, ref: je.number, amount: delta })
    })
    return rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  }, [journalEntries, accId])

  const isRec = (jeId) => reconciliations.includes(`${accId}::${jeId}`)

  // ─── Statement import (OFX, CAMT.053, MT940 or CSV) + auto-match ───
  const due = (doc, kind) => kind === 'invoice' ? documentDue(doc, creditNotes, 'invoiceId') : documentDue(doc, debitNotes, 'purchaseId')
  const books = { invoices, purchases, customers, suppliers, due }

  const handleImportFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const stmt = parseStatement(ev.target.result, file.name)
        const { matched, unmatched } = matchToLedger(stmt.lines, movements, { isCleared: isRec })
        setImportResult({
          format: stmt.format,
          currency: stmt.currency,
          matched,
          unmatched: unmatched.map((sl) => ({
            ...sl,
            catAccountId: ruleFor(sl.desc, sl.amount)?.accountId || '',
            suggestion: suggestDocument(sl, books),
          })),
        })
        // The file already knows the closing balance; don't make the user retype it.
        if (stmt.closingBalance != null) setStmtBalance(String(stmt.closingBalance))
      } catch (err) {
        const msg = err.message === 'CSV_COLUMNS'
          ? t('Could not detect Date and Amount columns. Expected headers like Date, Description, Amount (or Debit/Credit).')
          : err.message === 'NO_LINES' ? t('No transactions were found in this file.')
            : t('Could not read this file.') + ' ' + err.message
        setImportResult({ error: msg })
      }
    }
    reader.readAsText(file)
  }

  // Record the statement line as a payment on the invoice or bill it pays,
  // then clear it — the receipt's journal entry is the bank movement.
  const recordSuggested = (u, idx) => {
    const s = u.suggestion
    try {
      const payment = { amount: s.amount, date: u.date || todayISO(), bankAccountId: accId, method: 'Bank transfer', reference: u.ref || '' }
      const res = s.kind === 'invoice' ? recordInvoicePayment(s.doc.id, payment) : recordPurchasePayment(s.doc.id, payment)
      if (res?.pendingApproval) {
        return alert(t('This payment needs approval first. It is waiting in Approvals.'))
      }
      const paid = useStore.getState()[s.kind === 'invoice' ? 'invoices' : 'purchases'].find((d) => d.id === s.doc.id)
      const last = paid?.payments?.[paid.payments.length - 1]
      if (last?.journalEntryId) toggleReconciled(accId, last.journalEntryId)
      setImportResult((r) => {
        const rest = r.unmatched.filter((_, i) => i !== idx)
        // What's left of a part-paid line still needs booking.
        const left = Math.round((Math.abs(u.amount) - s.amount) * 100) / 100
        if (left > 0.005) rest.splice(idx, 0, { ...u, amount: Math.sign(u.amount) * left, suggestion: null })
        return { ...r, unmatched: rest }
      })
    } catch (e) {
      if (String(e.message).startsWith('PERIOD_LOCKED')) return alert(t('This date falls in a closed accounting period. Choose a later date.'))
      throw e
    }
  }

  const clearMatched = () => {
    importResult.matched.forEach((m) => { if (!isRec(m.jeId)) toggleReconciled(accId, m.jeId) })
    setImportResult(null)
  }

  // set the chosen category for an unmatched line
  const setUnmatchedCat = (idx, catAccountId) =>
    setImportResult((r) => ({ ...r, unmatched: r.unmatched.map((u, i) => (i === idx ? { ...u, catAccountId } : u)) }))

  // book an unmatched statement line as a bank transaction, then mark it cleared
  const bookLine = (u, idx) => {
    if (!u.catAccountId) return alert(t('Choose a category account for this line first.'))
    try {
      const tx = addBankTransaction({
        type: u.amount >= 0 ? 'money_in' : 'money_out',
        bankAccountId: accId, accountId: u.catAccountId,
        amount: Math.abs(u.amount), date: u.date || todayISO(),
        description: u.desc || t('Bank statement line'), reference: 'STMT',
      })
      if (tx?.journalEntryId) toggleReconciled(accId, tx.journalEntryId)
      setImportResult((r) => ({ ...r, unmatched: r.unmatched.filter((_, i) => i !== idx) }))
    } catch (e) {
      if (String(e.message).startsWith('PERIOD_LOCKED')) return alert(t('This date falls in a closed accounting period. Choose a later date.'))
      throw e
    }
  }

  const saveRule = () => {
    if (!newRule.contains.trim() || !newRule.accountId) return alert(t('Enter a keyword and a category account.'))
    addMatchRule(newRule)
    setNewRule({ contains: '', accountId: '' })
  }

  const acceptSuggestion = (s) => addMatchRule({ contains: s.contains, accountId: s.accountId, flow: s.flow })

  // Book every unmatched line that already has a category, in one pass —
  // otherwise a 40-line statement means 40 individual clicks.
  const bookAllCategorised = async () => {
    const ready = (importResult?.unmatched || []).filter((u) => u.catAccountId)
    if (!ready.length) return
    if (!await ask(t('Book {n} categorised line(s) now?').replace('{n}', ready.length))) return
    let booked = 0, failed = 0
    const remaining = []
    ;(importResult.unmatched || []).forEach((u) => {
      if (!u.catAccountId) { remaining.push(u); return }
      try {
        const tx = addBankTransaction({
          type: u.amount >= 0 ? 'money_in' : 'money_out',
          bankAccountId: accId, accountId: u.catAccountId,
          amount: Math.abs(u.amount), date: u.date || todayISO(),
          description: u.desc || t('Bank statement line'), reference: 'STMT',
        })
        if (tx?.journalEntryId) toggleReconciled(accId, tx.journalEntryId)
        booked++
      } catch {
        // A locked period (or any other rejection) shouldn't lose the rest —
        // keep the line so the user can see and retry it.
        failed++; remaining.push(u)
      }
    })
    setImportResult((r) => ({ ...r, unmatched: remaining }))
    if (failed) alert(t('Booked {n}, but {f} could not be posted (check for a locked period).').replace('{n}', booked).replace('{f}', failed))
  }
  const clearedBalance = movements.filter((m) => isRec(m.id)).reduce((s, m) => s + m.amount, 0)
  const bookBalance = getAccountBalance(accId)
  const stmt = parseFloat(stmtBalance)
  const difference = isNaN(stmt) ? null : stmt - clearedBalance
  const reconciled = difference !== null && Math.abs(difference) < 0.01

  return (
    <div>
      <PageHeader title="Bank reconciliation" subtitle="Match your ledger to the bank statement and clear transactions" />

      <Card className="p-5 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <Select label="Bank / Cash Account" value={accId} onChange={(e) => setAccId(e.target.value)} className="w-64">
            {bankAccounts.map((b) => <option key={b.id} value={b.accountId}>{b.name}</option>)}
          </Select>
          <Input label="Statement Ending Balance" type="number" step="0.01" value={stmtBalance} onChange={(e) => setStmtBalance(e.target.value)} className="w-48" placeholder="From your bank" />
          <div className="ml-auto">
            <input ref={fileRef} type="file" accept=".csv,.ofx,.qfx,.xml,.sta,.mt940,.940,.txt,text/csv,text/xml,application/xml" className="hidden" onChange={handleImportFile} />
            <Btn variant="secondary" onClick={() => fileRef.current?.click()}><Upload size={15} /> {t('Import bank statement')}</Btn>
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{t('Upload the statement file from your bank: OFX/QFX, CAMT.053 (XML), MT940 or CSV. Lines are matched to your books, and payments that match an open invoice or bill can be recorded in one click.')}</p>
      </Card>

      {/* Matching rules: auto-categorize statement lines by keyword */}
      <Card className="p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={16} className="text-brand-600 dark:text-brand-400" />
          <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-200">{t('Auto-Match Rules')}</h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{t('When a statement line description contains a keyword, suggest this category so you can book it in one click.')}</p>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <Input label={t('If description contains')} value={newRule.contains} onChange={(e) => setNewRule((r) => ({ ...r, contains: e.target.value }))} placeholder={t('e.g. STC, Aramex, salary')} className="w-56" />
          <Select label={t('Categorize as')} value={newRule.accountId} onChange={(e) => setNewRule((r) => ({ ...r, accountId: e.target.value }))} className="w-56">
            <option value="">{t('Select account…')}</option>
            {categoryAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Btn onClick={saveRule}>{t('Add rule')}</Btn>
        </div>

        {/* Rules learned from how past bank lines were actually categorised. */}
        {suggestions.length > 0 && (
          <div className="mb-3 rounded-xl bg-violet-50/70 dark:bg-violet-500/[0.08] p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300 mb-2">
              <Sparkles size={12} /> {t('Suggested from your history')}
            </p>
            <div className="space-y-1.5">
              {suggestions.map((s) => (
                <div key={s.contains} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 text-slate-700 dark:text-slate-200 truncate">
                    "<span className="font-medium">{s.contains}</span>" → {acctName(s.accountId)}
                    <span className="text-xs text-slate-500 dark:text-slate-400 ms-1.5">
                      {t('seen {n}×').replace('{n}', s.occurrences)}{s.flow !== 'auto' ? ` · ${t(s.flow === 'in' ? 'money in' : 'money out')}` : ''}
                    </span>
                  </span>
                  <Btn size="sm" variant="secondary" onClick={() => acceptSuggestion(s)}><Plus size={12} /> {t('Add')}</Btn>
                </div>
              ))}
            </div>
          </div>
        )}
        {matchRules.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('No rules yet.')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {matchRules.map((r) => {
              const acc = accounts.find((a) => a.id === r.accountId)
              return (
                <span key={r.id} className="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-slate-700 rounded-full pl-3 pr-1.5 py-1 text-xs text-slate-600 dark:text-slate-300">
                  <span className="font-medium">"{r.contains}"</span> → {acc?.name || '—'}
                  <button onClick={() => deleteMatchRule(r.id)} className="w-4 h-4 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center justify-center text-slate-500 dark:text-slate-400">×</button>
                </span>
              )
            })}
          </div>
        )}
      </Card>

      <Modal open={!!importResult} onClose={() => setImportResult(null)} title={t('Import bank statement')} width="max-w-2xl">
        {importResult?.error ? (
          <div className="flex items-start gap-2 text-sm text-danger-600 dark:text-danger-400">
            <AlertCircle size={18} className="flex-shrink-0 mt-0.5" /><span>{importResult.error}</span>
          </div>
        ) : importResult && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-success-50 dark:bg-success-900/30 rounded-lg p-3">
                <p className="text-2xl font-bold text-success-700 dark:text-success-300">{importResult.matched.length}</p>
                <p className="text-xs text-success-700 dark:text-success-400">{t('matched to your ledger')}</p>
              </div>
              <div className="bg-warning-50 dark:bg-warning-900/30 rounded-lg p-3">
                <p className="text-2xl font-bold text-warning-700 dark:text-warning-300">{importResult.unmatched.length}</p>
                <p className="text-xs text-warning-700 dark:text-warning-400">{t('not found in your books')}</p>
              </div>
            </div>

            {importResult.unmatched.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">{t('Unmatched statement lines')}</p>
                  {importResult.unmatched.some((u) => u.catAccountId) && (
                    <Btn size="sm" variant="secondary" onClick={bookAllCategorised}>
                      <Zap size={13} /> {t('Book all {n} categorised').replace('{n}', importResult.unmatched.filter((u) => u.catAccountId).length)}
                    </Btn>
                  )}
                </div>
                <div className="max-h-64 overflow-y-auto border border-slate-100 dark:border-slate-700 rounded-lg divide-y divide-slate-50 dark:divide-slate-700/50">
                  {importResult.unmatched.map((u, i) => (
                    <div key={i} className="px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">{fmtDate(u.date)}</span>
                      <span className="flex-1 min-w-0 truncate text-slate-700 dark:text-slate-200" title={u.desc}>{u.desc || '—'}</span>
                      <span className={`whitespace-nowrap ${u.amount >= 0 ? 'text-success-700 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>{u.amount >= 0 ? '+' : '−'}{fmtMoney(Math.abs(u.amount), sym)}</span>
                      <select value={u.catAccountId || ''} onChange={(e) => setUnmatchedCat(i, e.target.value)}
                        className="text-xs border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-1.5 py-1 max-w-[120px] focus:outline-none focus:ring-1 focus:ring-brand-500">
                        <option value="">{t('Category…')}</option>
                        {categoryAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <Btn size="sm" onClick={() => bookLine(u, i)} title={t('Book & clear')}>{t('Book')}</Btn>
                    </div>
                    {u.suggestion && (
                      <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-brand-50 dark:bg-brand-500/10 px-2.5 py-1.5 text-xs text-brand-800 dark:text-brand-200">
                        <Sparkles size={12} className="flex-shrink-0" />
                        <span className="flex-1 min-w-0 truncate">
                          {t(u.suggestion.kind === 'invoice' ? 'Looks like payment for invoice' : 'Looks like payment of bill')}{' '}
                          <span className="font-semibold">{u.suggestion.doc.number}</span>
                          {u.suggestion.party?.name ? ` · ${u.suggestion.party.name}` : ''} · {fmtMoney(u.suggestion.amount, sym)}
                        </span>
                        <Btn size="sm" onClick={() => recordSuggested(u, i)}>{t('Record payment')}</Btn>
                      </div>
                    )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">{t('Record a suggested payment, or pick a category (auto-filled from your rules) and click Book to record and clear each line.')}</p>
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
        <div className={`rounded-xl p-4 ${reconciled ? 'bg-success-50 dark:bg-success-900/30' : difference === null ? 'bg-slate-50 dark:bg-slate-800' : 'bg-warning-50 dark:bg-warning-900/30'}`}>
          <p className="text-[11px] uppercase text-slate-500 dark:text-slate-400">Difference</p>
          <p className={`text-lg font-bold ${reconciled ? 'text-success-700 dark:text-success-300' : 'text-warning-700 dark:text-warning-300'}`}>
            {difference === null ? '—' : fmtMoney(difference, sym)}
          </p>
          {reconciled && <p className="text-[11px] text-success-700 dark:text-success-400">✓ Reconciled</p>}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
          <Landmark size={15} className="text-slate-500 dark:text-slate-400" />
          <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-200">{t('Transactions — tick each one that appears on your bank statement')}</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr className="text-xs text-slate-500 dark:text-slate-400 uppercase">
              <th className="px-4 py-2 text-left w-12">Clear</th>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">{t('Description')}</th>
              <th className="px-4 py-2 text-left">Ref</th>
              <th className="px-4 py-2 text-right">{t('Amount')}</th>
            </tr>
          </thead>
          <tbody>
            {movements.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">{t('No transactions for this account')}</td></tr>}
            {movements.map((m) => {
              const rec = isRec(m.id)
              return (
                <tr key={m.id} className={`border-b border-slate-50 dark:border-slate-700/50 cursor-pointer ${rec ? 'bg-success-50/40 dark:bg-success-900/10' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'}`}
                  onClick={() => toggleReconciled(accId, m.id)}>
                  <td className="px-4 py-2">{rec ? <CheckCircle2 size={17} className="text-success-700 dark:text-success-400" /> : <Circle size={17} className="text-slate-500 dark:text-slate-400" />}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{fmtDate(m.date)}</td>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{m.desc}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400 font-mono text-xs">{m.ref}</td>
                  <td className={`px-4 py-2 text-right font-medium ${m.amount >= 0 ? 'text-success-700 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
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
    <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
      <p className="text-[11px] uppercase text-slate-500 dark:text-slate-400">{typeof label === 'string' ? tr(label) : label}</p>
      <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  )
}
