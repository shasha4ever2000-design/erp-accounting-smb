import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate, statusColor } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, Modal, Input, Select, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Search, DollarSign, Trash2 } from 'lucide-react'
import { today } from '../utils/formatters'

export default function Purchases() {
  const { purchases, suppliers, accounts, deletePurchase, recordPurchasePayment, settings } = useStore()
  const navigate = useNavigate()
  const sym = settings.company.currencySymbol

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [payModal, setPayModal] = useState(null) // holds the purchase
  const [payForm, setPayForm] = useState({ date: today(), amount: '', bankAccountId: 'acc-cash', notes: '' })

  const bankAccounts = accounts.filter((a) => ['acc-cash', 'acc-bank1'].includes(a.id))

  const todayStr = new Date().toISOString().slice(0, 10)
  const enriched = purchases.map((p) => ({
    ...p,
    isOverdue: p.status !== 'paid' && p.dueDate && p.dueDate < todayStr,
  }))

  const filtered = enriched.filter((p) => {
    const matchSearch = !search || p.number.toLowerCase().includes(search.toLowerCase()) || p.supplierName?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || p.status === statusFilter || (statusFilter === 'overdue' && p.isOverdue)
    return matchSearch && matchStatus
  })
  const sorted = [...filtered].sort((a, b) => b.createdAt?.localeCompare(a.createdAt))

  const openPay = (p) => {
    setPayModal(p)
    setPayForm({ date: today(), amount: String(p.total - p.amountPaid), bankAccountId: 'acc-cash', notes: '' })
  }

  const handleRecord = () => {
    const amount = parseFloat(payForm.amount)
    if (!amount || amount <= 0) return
    const due = payModal.total - payModal.amountPaid
    if (amount > due) return alert(`Exceeds balance due (${fmtMoney(due, sym)})`)
    recordPurchasePayment(payModal.id, { ...payForm, amount })
    setPayModal(null)
  }

  const handleDelete = (p) => {
    if (confirm(`Delete purchase invoice ${p.number}?`)) deletePurchase(p.id)
  }

  const totals = {
    all: purchases.length,
    received: purchases.filter((p) => p.status === 'received').length,
    partial: purchases.filter((p) => p.status === 'partial').length,
    paid: purchases.filter((p) => p.status === 'paid').length,
  }

  return (
    <div>
      <PageHeader
        title="Purchase Invoices"
        subtitle={`${purchases.length} purchase invoice${purchases.length !== 1 ? 's' : ''}`}
        action={<Btn onClick={() => navigate('/purchases/new')}><Plus size={15} /> New Purchase</Btn>}
      />

      <div className="flex gap-2 mb-5 flex-wrap">
        {[
          { key: 'all', label: 'All' },
          { key: 'received', label: 'Received' },
          { key: 'partial', label: 'Partial' },
          { key: 'overdue', label: 'Overdue', red: true },
          { key: 'paid', label: 'Paid' },
        ].map((s) => (
          <button key={s.key} onClick={() => setStatusFilter(s.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
              statusFilter === s.key
                ? s.red ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300'
            }`}
          >
            {s.label} {totals[s.key] > 0 && <span className="text-xs opacity-60 ml-1">{totals[s.key]}</span>}
          </button>
        ))}
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
        <input className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search purchases..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        {purchases.length === 0 ? (
          <EmptyState icon="🛒" title="No purchase invoices yet" desc="Record your first purchase to track payables."
            action={<Btn onClick={() => navigate('/purchases/new')}><Plus size={14} /> New Purchase</Btn>} />
        ) : sorted.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No purchases match your filter</div>
        ) : (
          <Table headers={['Invoice #', 'Supplier', 'Ref', 'Date', 'Due', { label: 'Total', right: true }, { label: 'Balance', right: true }, 'Status', { label: 'Actions', right: true }]}>
            {sorted.map((p) => {
              const status = p.isOverdue && p.status !== 'paid' ? 'overdue' : p.status
              const balance = p.total - p.amountPaid
              return (
                <Tr key={p.id}>
                  <Td className="font-mono font-semibold text-orange-600">{p.number}</Td>
                  <Td className="font-medium text-gray-800">{p.supplierName}</Td>
                  <Td className="text-gray-400 text-xs">{p.supplierRef || '—'}</Td>
                  <Td className="text-gray-500">{fmtDate(p.date)}</Td>
                  <Td className={p.isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'}>{fmtDate(p.dueDate)}</Td>
                  <Td right className="font-semibold text-gray-800">{fmtMoney(p.total, sym)}</Td>
                  <Td right className={balance > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}>{fmtMoney(balance, sym)}</Td>
                  <Td><Badge className={statusColor(status)}>{status}</Badge></Td>
                  <Td right>
                    <div className="flex items-center justify-end gap-1">
                      {p.status !== 'paid' && (
                        <Btn size="sm" variant="ghost" onClick={() => openPay(p)} title="Record Payment">
                          <DollarSign size={13} className="text-green-600" />
                        </Btn>
                      )}
                      <Btn size="sm" variant="ghost" onClick={() => handleDelete(p)}>
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

      <Modal open={!!payModal} onClose={() => setPayModal(null)} title="Record Payment to Supplier">
        {payModal && (
          <div className="space-y-4">
            <div className="bg-orange-50 rounded-lg p-3 text-sm text-orange-700">
              Balance Due: <strong>{fmtMoney(payModal.total - payModal.amountPaid, sym)}</strong>
            </div>
            <Input label="Payment Date" type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} />
            <Input label={`Amount (${sym})`} type="number" min="0.01" step="0.01" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} />
            <Select label="Pay From" value={payForm.bankAccountId} onChange={(e) => setPayForm((f) => ({ ...f, bankAccountId: e.target.value }))}>
              {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
            </Select>
            <Input label="Reference / Notes" value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Cheque #, transfer ref..." />
            <div className="flex justify-end gap-2 pt-1">
              <Btn variant="secondary" onClick={() => setPayModal(null)}>Cancel</Btn>
              <Btn onClick={handleRecord}>Record Payment</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
