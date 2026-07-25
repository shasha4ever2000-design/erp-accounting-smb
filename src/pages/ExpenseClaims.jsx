import { useState, useRef } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import { Plus, Trash2, CheckCircle, DollarSign, Clock, AlertCircle, ScanLine, Loader2 } from 'lucide-react'
import { scanReceipt, applyToForm, currencyWarning, downscaleImage, fileToDataUrl } from '../utils/receiptOcr'

const EXPENSE_CATEGORIES = [
  'Travel & Transport', 'Meals & Entertainment', 'Office Supplies',
  'Accommodation', 'Communication', 'Training & Development', 'Other',
]

export default function ExpenseClaims() {
  const t = useT()
  const { expenseClaims, employees, accounts, bankAccounts, settings,
          addExpenseClaim, approveExpenseClaim, payExpenseClaim, deleteExpenseClaim } = useStore()
  const sym = settings.company.currencySymbol

  const expAccounts = accounts.filter((a) => a.type === 'expense')
  const bankOpts    = bankAccounts.map((b) => ({ id: b.accountId, name: b.name }))

  const [modal,     setModal]    = useState(false)
  const [payModal,  setPayModal] = useState(null)
  const [filter,    setFilter]   = useState('pending')

  const emptyForm = () => ({
    employeeId: '', employeeName: '', date: today(),
    description: '', category: 'Travel & Transport',
    amount: '', expenseAccountId: expAccounts[0]?.id || 'acc-admin',
    receiptRef: '', notes: '',
  })
  const [form, setForm] = useState(emptyForm())
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Receipt OCR: reads a photo into the blank fields of the form above.
  const receiptRef = useRef(null)
  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState(null)   // { tone, text }

  const handleReceipt = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''                            // let the same file be re-picked
    if (!file) return
    setScanning(true); setScanNote(null)
    try {
      const small = await downscaleImage(await fileToDataUrl(file))
      const res = await scanReceipt(small, {
        apiKey: settings.ai?.apiKey || '',
        model: settings.ai?.model || 'claude-haiku-4-5',
        todayISO: today(),
        currency: settings.company.currency,
      })
      if (!res.ok) { setScanNote({ tone: 'bad', text: res.reason }); return }

      // A field still holding its opening default (today's date, the first
      // category) was never typed by anyone, so OCR may fill it.
      const { form: next, filled } = applyToForm(form, res.fields, { defaults: emptyForm() })
      setForm(next)

      const fx = currencyWarning(res.fields, settings.company.currency)
      const parts = []
      parts.push(filled.length
        ? t('Filled {n} field(s) from the receipt — check them before submitting.').replace('{n}', filled.length)
        : t('Nothing to fill — every field already had a value.'))
      // A foreign-currency receipt posts at face value into base-currency
      // books, so the amount needs converting by hand.
      if (fx) parts.push(t('This receipt is in {c} — convert the amount to {b} before submitting.')
        .replace('{c}', fx).replace('{b}', settings.company.currency || ''))
      setScanNote({ tone: fx ? 'warn' : filled.length ? 'good' : 'warn', text: parts.join(' ') })
    } catch {
      setScanNote({ tone: 'bad', text: t('Could not read that file.') })
    } finally {
      setScanning(false)
    }
  }

  const openModal = () => { setScanNote(null); setForm(emptyForm()); setModal(true) }

  const [payDate,      setPayDate]    = useState(today())
  const [payBankAccId, setPayBankAccId] = useState(bankOpts[0]?.id || 'acc-bank1')

  const pickEmployee = (id) => {
    const emp = employees.find((e) => e.id === id)
    setField('employeeId', id)
    setField('employeeName', emp ? emp.name : '')
  }

  const filtered = filter === 'all' ? expenseClaims : expenseClaims.filter((c) => c.status === filter)
  const sorted   = [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const pending  = expenseClaims.filter((c) => c.status === 'pending')
  const approved = expenseClaims.filter((c) => c.status === 'approved')
  const pendingAmt  = pending.reduce((s, c) => s + c.amount, 0)
  const approvedAmt = approved.reduce((s, c) => s + c.amount, 0)

  const handleAdd = () => {
    if (!form.employeeName.trim()) return alert('Employee name is required.')
    if (!form.description.trim())  return alert('Description is required.')
    const amt = parseFloat(form.amount)
    if (!amt || amt <= 0)          return alert('Enter a valid amount.')
    addExpenseClaim({ ...form, amount: amt })
    setModal(false)
    setForm(emptyForm())
  }

  const STATUS_CLR   = { pending: 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300', approved: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300', paid: 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300' }
  const STATUS_ICONS = { pending: <Clock size={10} />, approved: <AlertCircle size={10} />, paid: <CheckCircle size={10} /> }

  return (
    <div>
      <PageHeader
        title="Expense Claims"
        subtitle="Employee expense reimbursements — submit, approve, and pay"
        action={<Btn onClick={openModal}><Plus size={15} /> {t('New Claim')}</Btn>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Pending Approval" value={fmtMoney(pendingAmt, sym)}  color="orange" icon={<Clock size={18} />}        sub={`${pending.length} claims`} />
        <StatCard label="Approved (To Pay)" value={fmtMoney(approvedAmt, sym)} color="blue"   icon={<AlertCircle size={18} />}  sub={`${approved.length} claims`} />
        <StatCard label="Total Claims"       value={expenseClaims.length}        color="green"  icon={<DollarSign size={18} />}   sub="all time" />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {[['pending','Pending'],['approved','Approved'],['paid','Paid'],['all','All']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900 ${filter === val ? 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-btn-primary' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-slate-500 hover:text-gray-900 dark:hover:text-slate-100'}`}>
            {label}
            <span className={`text-xs tabular-nums font-semibold px-1.5 py-px rounded-full ${filter === val ? 'bg-white/20' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'}`}>{val === 'all' ? expenseClaims.length : expenseClaims.filter(c => c.status === val).length}</span>
          </button>
        ))}
      </div>

      <Card>
        {expenseClaims.length === 0 ? (
          <EmptyState icon="🧾" title="No expense claims" desc="Employees can submit travel, meals, office supplies and other business expense claims for reimbursement."
            action={<Btn onClick={openModal}><Plus size={14} /> {t('New Claim')}</Btn>} />
        ) : sorted.length === 0 ? (
          <div className="py-12 text-center text-gray-400 dark:text-slate-500 text-sm">No {filter} claims</div>
        ) : (
          <Table headers={['Number', 'Employee', 'Date', 'Category', 'Description', { label: 'Amount', right: true }, 'Status', { label: 'Actions', right: true }]}>
            {sorted.map((claim) => (
              <Tr key={claim.id}>
                <Td><span className="font-mono text-xs text-gray-500 dark:text-slate-400">{claim.number}</span></Td>
                <Td className="font-medium text-gray-900 dark:text-slate-100">{claim.employeeName}</Td>
                <Td className="text-gray-500 dark:text-slate-400 text-sm whitespace-nowrap">{fmtDate(claim.date)}</Td>
                <Td className="text-gray-500 dark:text-slate-400 text-sm">{claim.category}</Td>
                <Td>
                  <p className="text-gray-700 dark:text-slate-300 text-sm truncate max-w-[160px]">{claim.description}</p>
                  {claim.receiptRef && <p className="text-xs text-gray-400 dark:text-slate-500">Ref: {claim.receiptRef}</p>}
                </Td>
                <Td right className="font-semibold text-gray-900 dark:text-slate-100 tabular-nums">{fmtMoney(claim.amount, sym)}</Td>
                <Td>
                  <Badge className={`${STATUS_CLR[claim.status]} inline-flex items-center gap-1`}>
                    {STATUS_ICONS[claim.status]} {claim.status}
                  </Badge>
                </Td>
                <Td right>
                  <div className="flex justify-end gap-1">
                      <AttachmentButton entityType="expenseclaim" entityId={claim.id} />
                    {claim.status === 'pending' && (
                      <Btn size="sm" variant="secondary"
                        onClick={() => { if (confirm(`Approve claim ${claim.number} for ${claim.employeeName}?`)) approveExpenseClaim(claim.id) }}>
                        <CheckCircle size={12} /> {t('Approve')}
                      </Btn>
                    )}
                    {claim.status === 'approved' && (
                      <Btn size="sm" variant="secondary"
                        onClick={() => { setPayModal(claim); setPayDate(today()); setPayBankAccId(bankOpts[0]?.id || 'acc-bank1') }}>
                        <DollarSign size={12} /> Pay
                      </Btn>
                    )}
                    {claim.status === 'pending' && (
                      <Btn size="sm" variant="ghost" onClick={() => { if (confirm(`Delete claim ${claim.number}?`)) deleteExpenseClaim(claim.id) }}>
                        <Trash2 size={13} className="text-red-400" />
                      </Btn>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {/* New Claim Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="New Expense Claim" width="max-w-lg">
        <div className="space-y-4">
          {/* Receipt OCR — fills the blanks below, never overwrites what you typed. */}
          <div className="rounded-xl border border-dashed border-brand-300/70 dark:border-brand-500/30 bg-brand-50/40 dark:bg-brand-500/[0.06] p-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-800 dark:text-brand-200">{t('Scan a receipt')}</p>
                <p className="text-xs text-brand-700/70 dark:text-brand-300/70 mt-0.5">
                  {t('Photograph or upload a receipt and the blank fields below are filled in for you.')}
                </p>
              </div>
              <Btn size="sm" variant="secondary" disabled={scanning} onClick={() => receiptRef.current?.click()}>
                {scanning
                  ? <><Loader2 size={14} className="animate-spin" /> {t('Reading…')}</>
                  : <><ScanLine size={14} /> {t('Scan receipt')}</>}
              </Btn>
              {/* capture= opens the camera directly on a phone */}
              <input ref={receiptRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleReceipt} />
            </div>
            {scanNote && (
              <p className={`text-xs mt-2 ${
                scanNote.tone === 'bad' ? 'text-rose-600 dark:text-rose-400'
                : scanNote.tone === 'warn' ? 'text-warning-700 dark:text-warning-300'
                : 'text-success-700 dark:text-success-400'}`}>
                {scanNote.text}
              </p>
            )}
            {!settings.ai?.apiKey && (
              <p className="text-xs mt-2 text-gray-500 dark:text-slate-400">
                {t('Needs a Claude API key — add one in Settings → AI Assistant.')}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {employees.length > 0 ? (
              <Select label="Employee" value={form.employeeId} onChange={(e) => pickEmployee(e.target.value)}>
                <option value="">— Select employee —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </Select>
            ) : (
              <Input label="Employee Name *" value={form.employeeName} onChange={(e) => setField('employeeName', e.target.value)} placeholder="Full name" />
            )}
            <Input label="Date *" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select label="Category" value={form.category} onChange={(e) => setField('category', e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Input label={`Amount (${sym}) *`} type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setField('amount', e.target.value)} />
          </div>
          <Input label="Description *" value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="Brief description of expense" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Receipt / Ref No." value={form.receiptRef} onChange={(e) => setField('receiptRef', e.target.value)} placeholder="Receipt number or ref" />
            <Select label="Expense Account" value={form.expenseAccountId} onChange={(e) => setField('expenseAccountId', e.target.value)}>
              {expAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <Textarea label="Notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={2} placeholder="Additional details..." />
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/50 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300">
            On approval: Dr {expAccounts.find(a => a.id === form.expenseAccountId)?.name || 'Expense'} → Cr Employee Expense Claims
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-slate-700">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={handleAdd}>{t('Submit Claim')}</Btn>
          </div>
        </div>
      </Modal>

      {/* Pay Modal */}
      <Modal open={!!payModal} onClose={() => setPayModal(null)} title={`Pay Claim – ${payModal?.number}`}>
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 rounded-lg p-3 text-sm text-blue-700 dark:text-blue-300">
            <p>Employee: <strong>{payModal?.employeeName}</strong></p>
            <p>Amount: <strong className="tabular-nums">{fmtMoney(payModal?.amount || 0, sym)}</strong></p>
            <p className="text-xs mt-0.5 text-blue-500 dark:text-blue-400">Posts: Dr Employee Expense Claims → Cr Bank</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Payment Date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            <Select label="Pay From" value={payBankAccId} onChange={(e) => setPayBankAccId(e.target.value)}>
              {bankOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-slate-700">
            <Btn variant="secondary" onClick={() => setPayModal(null)}>{t('Cancel')}</Btn>
            <Btn onClick={() => { payExpenseClaim(payModal.id, payBankAccId, payDate); setPayModal(null) }}>{t('Confirm Payment')}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
