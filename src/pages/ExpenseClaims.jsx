import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import { Plus, Trash2, CheckCircle, DollarSign, Clock, AlertCircle } from 'lucide-react'

const EXPENSE_CATEGORIES = [
  'Travel & Transport', 'Meals & Entertainment', 'Office Supplies',
  'Accommodation', 'Communication', 'Training & Development', 'Other',
]

export default function ExpenseClaims() {
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

  const [payDate,      setPayDate]    = useState(today())
  const [payBankAccId, setPayBankAccId] = useState(bankOpts[0]?.id || 'acc-bank1')

  const pickEmployee = (id) => {
    const emp = employees.find((e) => e.id === id)
    setField('employeeId', id)
    setField('employeeName', emp ? `${emp.firstName} ${emp.lastName}` : '')
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

  const STATUS_CLR   = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700' }
  const STATUS_ICONS = { pending: <Clock size={10} />, approved: <AlertCircle size={10} />, paid: <CheckCircle size={10} /> }

  return (
    <div>
      <PageHeader
        title="Expense Claims"
        subtitle="Employee expense reimbursements — submit, approve, and pay"
        action={<Btn onClick={() => setModal(true)}><Plus size={15} /> New Claim</Btn>}
      />

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Pending Approval" value={fmtMoney(pendingAmt, sym)}  color="amber"  icon={<Clock size={18} />}        sub={`${pending.length} claims`} />
        <StatCard label="Approved (To Pay)" value={fmtMoney(approvedAmt, sym)} color="blue"   icon={<AlertCircle size={18} />}  sub={`${approved.length} claims`} />
        <StatCard label="Total Claims"       value={expenseClaims.length}        color="green"  icon={<DollarSign size={18} />}   sub="all time" />
      </div>

      <div className="flex gap-2 mb-4">
        {[['pending','Pending'],['approved','Approved'],['paid','Paid'],['all','All']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${filter === val ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
            {label} ({val === 'all' ? expenseClaims.length : expenseClaims.filter(c => c.status === val).length})
          </button>
        ))}
      </div>

      <Card>
        {expenseClaims.length === 0 ? (
          <EmptyState icon="🧾" title="No expense claims" desc="Employees can submit travel, meals, office supplies and other business expense claims for reimbursement."
            action={<Btn onClick={() => setModal(true)}><Plus size={14} /> New Claim</Btn>} />
        ) : sorted.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No {filter} claims</div>
        ) : (
          <Table headers={['Number', 'Employee', 'Date', 'Category', 'Description', { label: 'Amount', right: true }, 'Status', { label: 'Actions', right: true }]}>
            {sorted.map((claim) => (
              <Tr key={claim.id}>
                <Td><span className="font-mono text-xs text-gray-500">{claim.number}</span></Td>
                <Td className="font-medium text-gray-800">{claim.employeeName}</Td>
                <Td className="text-gray-500 text-sm">{fmtDate(claim.date)}</Td>
                <Td className="text-gray-500 text-sm">{claim.category}</Td>
                <Td>
                  <p className="text-gray-700 text-sm truncate max-w-[160px]">{claim.description}</p>
                  {claim.receiptRef && <p className="text-xs text-gray-400">Ref: {claim.receiptRef}</p>}
                </Td>
                <Td right className="font-semibold text-gray-800">{fmtMoney(claim.amount, sym)}</Td>
                <Td>
                  <Badge className={`${STATUS_CLR[claim.status]} inline-flex items-center gap-1`}>
                    {STATUS_ICONS[claim.status]} {claim.status}
                  </Badge>
                </Td>
                <Td right>
                  <div className="flex justify-end gap-1">
                    {claim.status === 'pending' && (
                      <Btn size="sm" variant="secondary"
                        onClick={() => { if (confirm(`Approve claim ${claim.number} for ${claim.employeeName}?`)) approveExpenseClaim(claim.id) }}>
                        <CheckCircle size={12} /> Approve
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
          <div className="grid grid-cols-2 gap-3">
            {employees.length > 0 ? (
              <Select label="Employee" value={form.employeeId} onChange={(e) => pickEmployee(e.target.value)}>
                <option value="">— Select employee —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>
                ))}
              </Select>
            ) : (
              <Input label="Employee Name *" value={form.employeeName} onChange={(e) => setField('employeeName', e.target.value)} placeholder="Full name" />
            )}
            <Input label="Date *" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Category" value={form.category} onChange={(e) => setField('category', e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Input label={`Amount (${sym}) *`} type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setField('amount', e.target.value)} />
          </div>
          <Input label="Description *" value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="Brief description of expense" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Receipt / Ref No." value={form.receiptRef} onChange={(e) => setField('receiptRef', e.target.value)} placeholder="Receipt number or ref" />
            <Select label="Expense Account" value={form.expenseAccountId} onChange={(e) => setField('expenseAccountId', e.target.value)}>
              {expAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <Textarea label="Notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={2} placeholder="Additional details..." />
          <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-700">
            On approval: Dr {expAccounts.find(a => a.id === form.expenseAccountId)?.name || 'Expense'} → Cr Employee Expense Claims
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setModal(false)}>Cancel</Btn>
            <Btn onClick={handleAdd}>Submit Claim</Btn>
          </div>
        </div>
      </Modal>

      {/* Pay Modal */}
      <Modal open={!!payModal} onClose={() => setPayModal(null)} title={`Pay Claim – ${payModal?.number}`}>
        <div className="space-y-4">
          <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
            <p>Employee: <strong>{payModal?.employeeName}</strong></p>
            <p>Amount: <strong>{fmtMoney(payModal?.amount || 0, sym)}</strong></p>
            <p className="text-xs mt-0.5 text-blue-500">Posts: Dr Employee Expense Claims → Cr Bank</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Payment Date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            <Select label="Pay From" value={payBankAccId} onChange={(e) => setPayBankAccId(e.target.value)}>
              {bankOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setPayModal(null)}>Cancel</Btn>
            <Btn onClick={() => { payExpenseClaim(payModal.id, payBankAccId, payDate); setPayModal(null) }}>Confirm Payment</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
