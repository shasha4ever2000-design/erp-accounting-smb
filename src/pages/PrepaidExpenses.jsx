import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import { Plus, Trash2, RefreshCw, Clock, CheckCircle } from 'lucide-react'

const CATEGORIES = ['Prepaid Insurance', 'Prepaid Rent', 'Prepaid Subscription', 'Prepaid Maintenance', 'Other Prepaid']

export default function PrepaidExpenses() {
  const { prepaidExpenses, accounts, bankAccounts, settings,
          addPrepaidExpense, amortizePrepaid, deletePrepaidExpense } = useStore()
  const sym = settings.company.currencySymbol

  const expAccounts = accounts.filter((a) => a.type === 'expense')
  const bankOpts    = bankAccounts.map((b) => ({ id: b.accountId, name: b.name }))

  const [addModal,   setAddModal]   = useState(false)
  const [amortModal, setAmortModal] = useState(null)

  const [form, setForm] = useState({
    name: '', category: 'Prepaid Insurance', amount: '',
    startDate: today(), endDate: '', bankAccountId: bankOpts[0]?.id || 'acc-bank1',
    expenseAccountId: expAccounts[0]?.id || 'acc-admin', notes: '',
  })
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const [amortForm, setAmortForm] = useState({ date: today(), amount: '', period: '' })

  const totalPrepaid   = prepaidExpenses.reduce((s, p) => s + p.remaining, 0)
  const totalAmortized = prepaidExpenses.reduce((s, p) => s + p.amortized, 0)
  const activeCount    = prepaidExpenses.filter((p) => p.remaining > 0).length

  const handleAdd = () => {
    const amt = parseFloat(form.amount)
    if (!form.name.trim()) return alert('Name is required.')
    if (!amt || amt <= 0)  return alert('Enter a valid amount.')
    if (!form.startDate)   return alert('Start date is required.')
    addPrepaidExpense({ ...form, amount: amt })
    setAddModal(false)
    setForm({ name: '', category: 'Prepaid Insurance', amount: '', startDate: today(), endDate: '', bankAccountId: bankOpts[0]?.id || 'acc-bank1', expenseAccountId: expAccounts[0]?.id || 'acc-admin', notes: '' })
  }

  const handleAmortize = () => {
    const amt = parseFloat(amortForm.amount)
    if (!amt || amt <= 0)               return alert('Enter a valid amount.')
    if (!amortForm.period.trim())        return alert('Enter the period (e.g. June 2026).')
    if (amt > amortModal.remaining + 0.01) return alert('Amount exceeds remaining prepaid balance.')
    amortizePrepaid(amortModal.id, { date: amortForm.date, amount: amt, period: amortForm.period })
    setAmortModal(null)
  }

  const monthlyAmt = (pre) => {
    if (!pre.endDate || !pre.startDate) return null
    const months = Math.max(1, Math.round(
      (new Date(pre.endDate) - new Date(pre.startDate)) / (1000 * 60 * 60 * 24 * 30)
    ))
    return pre.amount / months
  }

  const sorted = [...prepaidExpenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div>
      <PageHeader
        title="Prepaid Expenses"
        subtitle="Track insurance, rent, subscriptions and other prepaid costs"
        action={<Btn onClick={() => setAddModal(true)}><Plus size={15} /> Add Prepaid</Btn>}
      />

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Remaining Prepaid Balance" value={fmtMoney(totalPrepaid, sym)}   color="blue"   icon={<Clock size={18} />}       sub={`${activeCount} active`} />
        <StatCard label="Total Amortized"            value={fmtMoney(totalAmortized, sym)} color="green"  icon={<CheckCircle size={18} />}  sub="recognized as expense" />
        <StatCard label="Total Records"              value={prepaidExpenses.length}         color="purple" icon={<RefreshCw size={18} />}   sub="prepaid items" />
      </div>

      <Card>
        {prepaidExpenses.length === 0 ? (
          <EmptyState icon="📋" title="No prepaid expenses" desc="Record insurance premiums, advance rent, or subscriptions paid upfront. Monthly amortization reduces the prepaid balance and recognizes the expense."
            action={<Btn onClick={() => setAddModal(true)}><Plus size={14} /> Add Prepaid</Btn>} />
        ) : (
          <Table headers={['Number', 'Name', 'Category', 'Start', 'End', { label: 'Total Paid', right: true }, { label: 'Amortized', right: true }, { label: 'Remaining', right: true }, 'Status', { label: '', right: true }]}>
            {sorted.map((pre) => {
              const pct = pre.amount > 0 ? (pre.amortized / pre.amount) * 100 : 0
              return (
                <Tr key={pre.id}>
                  <Td><span className="font-mono text-xs text-gray-500">{pre.number}</span></Td>
                  <Td>
                    <p className="font-medium text-gray-800">{pre.name}</p>
                    {pre.notes && <p className="text-xs text-gray-400 truncate max-w-[140px]">{pre.notes}</p>}
                  </Td>
                  <Td className="text-gray-500 text-sm">{pre.category}</Td>
                  <Td className="text-gray-500 text-sm">{fmtDate(pre.startDate)}</Td>
                  <Td className="text-gray-500 text-sm">{pre.endDate ? fmtDate(pre.endDate) : '—'}</Td>
                  <Td right className="text-gray-700">{fmtMoney(pre.amount, sym)}</Td>
                  <Td right className="text-green-600">{fmtMoney(pre.amortized, sym)}</Td>
                  <Td right className="font-semibold text-blue-700">{fmtMoney(pre.remaining, sym)}</Td>
                  <Td>
                    {pre.remaining <= 0
                      ? <Badge className="bg-gray-100 text-gray-500">Fully Amortized</Badge>
                      : <Badge className="bg-blue-100 text-blue-700">{pct.toFixed(0)}% Used</Badge>
                    }
                  </Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      {pre.remaining > 0 && (
                        <Btn size="sm" variant="secondary"
                          onClick={() => { setAmortModal(pre); setAmortForm({ date: today(), amount: monthlyAmt(pre)?.toFixed(2) || '', period: '' }) }}>
                          <RefreshCw size={12} /> Amortize
                        </Btn>
                      )}
                      <Btn size="sm" variant="ghost" onClick={() => { if (confirm(`Delete prepaid "${pre.name}"? The original payment JE will be removed.`)) deletePrepaidExpense(pre.id) }}>
                        <Trash2 size={13} className="text-red-400" />
                      </Btn>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      {/* Add Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Add Prepaid Expense" width="max-w-lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Annual Insurance Premium" />
            <Select label="Category" value={form.category} onChange={(e) => setField('category', e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label={`Total Amount (${sym}) *`} type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setField('amount', e.target.value)} />
            <Input label="Start Date *" type="date" value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} />
            <Input label="End Date" type="date" value={form.endDate} onChange={(e) => setField('endDate', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Paid From (Bank)" value={form.bankAccountId} onChange={(e) => setField('bankAccountId', e.target.value)}>
              {bankOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Select label="Expense Account" value={form.expenseAccountId} onChange={(e) => setField('expenseAccountId', e.target.value)}>
              {expAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <Textarea label="Notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={2} placeholder="Policy number, provider, coverage details..." />
          <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
            Posts: Dr Prepaid Expenses → Cr {bankOpts.find(b => b.id === form.bankAccountId)?.name || 'Bank'}
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setAddModal(false)}>Cancel</Btn>
            <Btn onClick={handleAdd}>Save Prepaid</Btn>
          </div>
        </div>
      </Modal>

      {/* Amortize Modal */}
      <Modal open={!!amortModal} onClose={() => setAmortModal(null)} title={`Amortize – ${amortModal?.name}`}>
        <div className="space-y-4">
          <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
            <p>Remaining balance: <strong>{fmtMoney(amortModal?.remaining || 0, sym)}</strong></p>
            {amortModal && monthlyAmt(amortModal) && (
              <p className="text-xs mt-0.5 text-blue-500">Monthly amount: {fmtMoney(monthlyAmt(amortModal), sym)}</p>
            )}
          </div>
          <Input label="Period *" value={amortForm.period} onChange={(e) => setAmortForm((f) => ({ ...f, period: e.target.value }))} placeholder="e.g. June 2026, Q2 2026" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={amortForm.date} onChange={(e) => setAmortForm((f) => ({ ...f, date: e.target.value }))} />
            <Input label={`Amount (${sym}) *`} type="number" min="0" step="0.01" value={amortForm.amount} onChange={(e) => setAmortForm((f) => ({ ...f, amount: e.target.value }))} />
          </div>
          <p className="text-xs text-blue-600 bg-blue-50 rounded p-2">
            Posts: Dr {accounts.find(a => a.id === amortModal?.expenseAccountId)?.name || 'Expense Account'} → Cr Prepaid Expenses
          </p>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setAmortModal(null)}>Cancel</Btn>
            <Btn onClick={handleAmortize}>Record Amortization</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
