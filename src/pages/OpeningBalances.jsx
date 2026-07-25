import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Input, Select, Badge, Table, Tr, Td } from '../components/UI'
import {
  buildOpeningEntry, openingSummary, validateOpening, docDateWarnings,
  DERIVED_ACCOUNTS, OBE_ACCOUNT,
} from '../utils/openingBalances'
import { tone } from '../utils/formatters'
import { Plus, Trash2, Flag, RotateCcw, CheckCircle2, AlertTriangle, Info } from 'lucide-react'

const TABS = [
  { id: 'accounts',  label: 'Accounts' },
  { id: 'customers', label: 'Customers owing you' },
  { id: 'suppliers', label: 'Suppliers you owe' },
  { id: 'items',     label: 'Stock on hand' },
]

export default function OpeningBalances() {
  const t = useT()
  const {
    accounts, customers, suppliers, inventoryItems, settings, journalEntries,
    postOpeningBalances, reverseOpeningBalances,
  } = useStore()
  const sym = settings.company.currencySymbol
  const opening = settings.opening || {}
  const posted = !!opening.posted

  const [date, setDate] = useState(opening.date || `${new Date().getFullYear()}-01-01`)
  const [tab, setTab] = useState('accounts')
  const [glRows, setGlRows] = useState({})          // accountId -> typed amount
  const [custRows, setCustRows] = useState([])
  const [suppRows, setSuppRows] = useState([])
  const [itemRows, setItemRows] = useState([])

  // Control accounts are shown but locked — their opening balance comes from
  // the detail tabs, and typing one in as well would double-count it.
  const glAccounts = useMemo(
    () => accounts.filter((a) => a.type !== 'revenue' && a.type !== 'expense' && a.id !== OBE_ACCOUNT),
    [accounts]
  )

  const input = useMemo(() => ({
    date,
    accounts: glAccounts
      .filter((a) => !DERIVED_ACCOUNTS[a.id] && glRows[a.id])
      .map((a) => ({ accountId: a.id, type: a.type, amount: glRows[a.id] })),
    customers: custRows,
    suppliers: suppRows,
    items: itemRows,
  }), [date, glAccounts, glRows, custRows, suppRows, itemRows])

  const nameOf = (id) => accounts.find((a) => a.id === id)?.name || id
  const entry = useMemo(() => buildOpeningEntry(input, { accountName: nameOf }), [input])   // eslint-disable-line react-hooks/exhaustive-deps
  const summary = openingSummary(entry)
  const errors = validateOpening(input, { lockDate: settings.accounting?.lockDate })
  const dateWarnings = docDateWarnings(input)

  const postedJE = posted ? journalEntries.find((j) => j.id === opening.journalEntryId) : null

  const handlePost = () => {
    if (errors.length) return alert(errors.join('\n'))
    const msg = summary.balanced
      ? t('Post the opening balances as at {d}?').replace('{d}', date)
      : t('These balances do not balance. The difference will sit in Opening Balance Equity until you correct it. Post anyway?')
    if (!confirm(msg)) return
    try {
      postOpeningBalances(input)
    } catch (e) {
      const m = String(e.message || e)
      if (m.startsWith('OPENING_INVALID')) return alert(m.replace('OPENING_INVALID:', '').split(' | ').join('\n'))
      if (m.startsWith('OPENING_ALREADY_POSTED')) return alert(t('Opening balances have already been posted. Undo them first.'))
      return alert(m)
    }
  }

  const handleReverse = () => {
    if (!confirm(t('Undo the opening balances? The entry, the carried-in documents and the opening stock are all removed.'))) return
    try {
      reverseOpeningBalances()
      setGlRows({}); setCustRows([]); setSuppRows([]); setItemRows([])
    } catch (e) {
      const m = String(e.message || e)
      if (m.startsWith('OPENING_HAS_ACTIVITY'))
        return alert(t('{n} carried-in document(s) already have payments against them. Reverse those payments first.')
          .replace('{n}', m.split(':')[1]))
      if (m.startsWith('PERIOD_LOCKED'))
        return alert(t('The cutover date falls in a closed accounting period.'))
      return alert(m)
    }
  }

  // ── Row editors ─────────────────────────────────────────────────
  const addDoc = (setRows) => setRows((r) => [...r, { number: '', date: '', dueDate: '', amount: '' }])
  const setDoc = (setRows, i, k, v) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)))
  const delDoc = (setRows, i) => setRows((r) => r.filter((_, j) => j !== i))

  const DocTab = ({ rows, setRows, party, partyKey, nameKey, label }) => (
    <div className="space-y-3">
      <p className="text-sm text-gray-500 dark:text-slate-400">
        {t('Enter each unpaid document exactly as it appears in your old system — same number, same date. That is what makes aging reports and payment matching work afterwards.')}
      </p>
      {rows.length > 0 && (
        <Table headers={[label, 'Document no.', 'Date', 'Due date', { label: `Amount (${sym})`, right: true }, '']}>
          {rows.map((row, i) => (
            <Tr key={i}>
              <Td>
                <Select value={row[partyKey] || ''} onChange={(e) => {
                  const p = party.find((x) => x.id === e.target.value)
                  setRows((r) => r.map((x, j) => (j === i ? { ...x, [partyKey]: e.target.value, [nameKey]: p?.name || '' } : x)))
                }}>
                  <option value="">{t('— Select —')}</option>
                  {party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Td>
              <Td><Input value={row.number} onChange={(e) => setDoc(setRows, i, 'number', e.target.value)} placeholder="INV-1042" /></Td>
              <Td><Input type="date" value={row.date} onChange={(e) => setDoc(setRows, i, 'date', e.target.value)} /></Td>
              <Td><Input type="date" value={row.dueDate} onChange={(e) => setDoc(setRows, i, 'dueDate', e.target.value)} /></Td>
              <Td right><Input type="number" min="0" step="0.01" value={row.amount} onChange={(e) => setDoc(setRows, i, 'amount', e.target.value)} className="w-32" /></Td>
              <Td>
                <button onClick={() => delDoc(setRows, i)} className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                  <Trash2 size={14} />
                </button>
              </Td>
            </Tr>
          ))}
        </Table>
      )}
      <Btn variant="ghost" size="sm" onClick={() => addDoc(setRows)} disabled={posted}><Plus size={14} /> {t('Add row')}</Btn>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Opening Balances"
        subtitle="What your business was carrying on the day it moved onto this system"
        action={posted
          ? <Btn variant="secondary" onClick={handleReverse}><RotateCcw size={15} /> {t('Undo')}</Btn>
          : <Btn onClick={handlePost} disabled={errors.length > 0}><Flag size={15} /> {t('Post opening balances')}</Btn>}
      />

      {posted ? (
        <Card className="p-5 mb-6 bg-success-50/50 dark:bg-success-500/[0.07] ring-1 ring-inset ring-success-500/20">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="text-success-600 dark:text-success-400 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold text-success-800 dark:text-success-200">
                {t('Opening balances posted as at')} {fmtDate(opening.date)}
              </p>
              <p className="text-sm text-success-700/80 dark:text-success-300/80 mt-1">
                {postedJE && <>{t('Journal entry')} <span className="font-mono">{postedJE.number}</span> · </>}
                {opening.counts && t('{c} invoice(s), {s} bill(s), {i} stock line(s)')
                  .replace('{c}', opening.counts.customers).replace('{s}', opening.counts.suppliers).replace('{i}', opening.counts.items)}
              </p>
              <p className="text-xs text-success-700/70 dark:text-success-300/70 mt-2">
                {t('Everything dated after the cutover is a normal transaction. Enter it through the usual pages.')}
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-5 mb-6 flex items-start gap-3">
          <Info size={18} className="text-brand-600 dark:text-brand-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-gray-600 dark:text-slate-300">
            {t('Pick the date you are switching over, then enter what you were carrying at that moment. Receivables, payables and stock are built from the individual documents you list — not typed in as totals — so aging, statements and stock counts work from day one.')}
          </p>
        </Card>
      )}

      {/* Cutover date + running balance */}
      <Card className="p-5 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <Input label={t('Cutover date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" disabled={posted} />
          <div className="ms-auto text-end">
            <p className="text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wider">{t('Difference to allocate')}</p>
            <p className={`text-2xl font-bold tabular-nums ${summary.balanced ? 'text-success-600 dark:text-success-400' : 'text-warning-600 dark:text-warning-400'}`}>
              {fmtMoney(Math.abs(entry.plug), sym)}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-surface-750 text-sm">
          <div><p className="text-xs text-gray-400 dark:text-slate-500">{t('Total debits')}</p><p className="font-semibold tabular-nums text-gray-800 dark:text-slate-100">{fmtMoney(entry.debits, sym)}</p></div>
          <div><p className="text-xs text-gray-400 dark:text-slate-500">{t('Total credits')}</p><p className="font-semibold tabular-nums text-gray-800 dark:text-slate-100">{fmtMoney(entry.credits, sym)}</p></div>
          <div><p className="text-xs text-gray-400 dark:text-slate-500">{t('Receivables')}</p><p className="font-semibold tabular-nums text-gray-800 dark:text-slate-100">{fmtMoney(entry.ar, sym)}</p></div>
          <div><p className="text-xs text-gray-400 dark:text-slate-500">{t('Payables')}</p><p className="font-semibold tabular-nums text-gray-800 dark:text-slate-100">{fmtMoney(entry.ap, sym)}</p></div>
        </div>
        {!summary.balanced && !posted && (
          <p className="text-sm text-warning-700 dark:text-warning-300 mt-3 flex items-start gap-2">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {t(summary.message)}
          </p>
        )}
      </Card>

      {(errors.length > 0 || dateWarnings.length > 0) && !posted && (
        <Card className="p-4 mb-6 bg-rose-50/50 dark:bg-rose-500/[0.07] ring-1 ring-inset ring-rose-500/20">
          <ul className="text-sm text-rose-700 dark:text-rose-300 space-y-1">
            {errors.map((e, i) => <li key={`e${i}`}>• {e}</li>)}
            {dateWarnings.map((w, i) => <li key={`w${i}`} className="text-warning-700 dark:text-warning-300">• {w}</li>)}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-surface-750 flex flex-wrap gap-1.5">
          {TABS.map((x) => (
            <button key={x.id} onClick={() => setTab(x.id)}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === x.id ? 'bg-brand-600 text-white shadow-card' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-surface-750'
              }`}>
              {t(x.label)}
            </button>
          ))}
        </div>

        <div className={`p-5 ${posted ? 'opacity-60 pointer-events-none' : ''}`}>
          {tab === 'accounts' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {t('Balance-sheet accounts only — profit and loss starts from zero on the cutover date. Enter a negative figure for an overdrawn account.')}
              </p>
              <Table headers={['Account', 'Type', { label: `Opening balance (${sym})`, right: true }]}>
                {glAccounts.map((a) => {
                  const derived = DERIVED_ACCOUNTS[a.id]
                  const derivedValue = derived === 'customers' ? entry.ar : derived === 'suppliers' ? entry.ap : entry.inventory
                  return (
                    <Tr key={a.id}>
                      <Td>
                        <span className="font-mono text-[11px] text-gray-400 dark:text-slate-500 me-2">{a.code}</span>
                        {a.name}
                      </Td>
                      <Td><Badge className={tone.neutral}>{a.type}</Badge></Td>
                      <Td right>
                        {derived ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-xs text-gray-400 dark:text-slate-500">{t('from the {x} tab').replace('{x}', t(derived))}</span>
                            <span className="tabular-nums font-medium text-gray-700 dark:text-slate-200">{fmtMoney(derivedValue, sym)}</span>
                          </span>
                        ) : (
                          <Input type="number" step="0.01" className="w-40 inline-block" value={glRows[a.id] || ''}
                            onChange={(e) => setGlRows((r) => ({ ...r, [a.id]: e.target.value }))} placeholder="0.00" />
                        )}
                      </Td>
                    </Tr>
                  )
                })}
              </Table>
            </div>
          )}

          {tab === 'customers' && <DocTab rows={custRows} setRows={setCustRows} party={customers} partyKey="customerId" nameKey="customerName" label="Customer" />}
          {tab === 'suppliers' && <DocTab rows={suppRows} setRows={setSuppRows} party={suppliers} partyKey="supplierId" nameKey="supplierName" label="Supplier" />}

          {tab === 'items' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {t('Count what is physically on the shelf and the cost you are carrying it at — not its selling price.')}
              </p>
              {itemRows.length > 0 && (
                <Table headers={['Item', { label: 'Quantity', right: true }, { label: `Unit cost (${sym})`, right: true }, { label: 'Value', right: true }, '']}>
                  {itemRows.map((row, i) => (
                    <Tr key={i}>
                      <Td>
                        <Select value={row.itemId || ''} onChange={(e) => {
                          const it = inventoryItems.find((x) => x.id === e.target.value)
                          setItemRows((r) => r.map((x, j) => (j === i ? { ...x, itemId: e.target.value, itemName: it?.name || '' } : x)))
                        }}>
                          <option value="">{t('— Select —')}</option>
                          {inventoryItems.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                        </Select>
                      </Td>
                      <Td right><Input type="number" min="0" step="any" value={row.quantity || ''} onChange={(e) => setDoc(setItemRows, i, 'quantity', e.target.value)} className="w-28" /></Td>
                      <Td right><Input type="number" min="0" step="0.01" value={row.unitCost || ''} onChange={(e) => setDoc(setItemRows, i, 'unitCost', e.target.value)} className="w-32" /></Td>
                      <Td right className="tabular-nums">{fmtMoney((Number(row.quantity) || 0) * (Number(row.unitCost) || 0), sym)}</Td>
                      <Td>
                        <button onClick={() => delDoc(setItemRows, i)} className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                          <Trash2 size={14} />
                        </button>
                      </Td>
                    </Tr>
                  ))}
                </Table>
              )}
              <Btn variant="ghost" size="sm" onClick={() => setItemRows((r) => [...r, { itemId: '', itemName: '', quantity: '', unitCost: '' }])} disabled={posted}>
                <Plus size={14} /> {t('Add row')}
              </Btn>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
