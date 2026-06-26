import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import { Plus, Trash2, CreditCard, Home, XCircle } from 'lucide-react'

export default function Leases() {
  const { leases, bankAccounts, settings, addLease, recordLeasePayment, terminateLease, deleteLease } = useStore()
  const sym = settings.company.currencySymbol

  const bankOpts = bankAccounts.map((b) => ({ id: b.accountId, name: b.name }))

  const [addModal,  setAddModal]  = useState(false)
  const [payModal,  setPayModal]  = useState(null)
  const [filter,    setFilter]    = useState('active')

  const emptyForm = () => ({
    name: '', landlord: '', leaseType: 'operating',
    startDate: today(), endDate: '', monthlyRent: '',
    bankAccountId: bankOpts[0]?.id || 'acc-bank1',
    expenseAccountId: 'acc-rent', notes: '',
  })
  const [form, setForm] = useState(emptyForm())
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const [payForm, setPayForm] = useState({ date: today(), amount: '', period: '', bankAccountId: bankOpts[0]?.id || 'acc-bank1' })

  const filtered = filter === 'all' ? leases : leases.filter((l) => l.status === filter)
  const sorted   = [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const activeLeases   = leases.filter((l) => l.status === 'active')
  const monthlyTotal   = activeLeases.reduce((s, l) => s + (parseFloat(l.monthlyRent) || 0), 0)
  const totalPayments  = leases.reduce((s, l) => s + (l.payments || []).reduce((a, p) => a + p.amount, 0), 0)

  const handleAdd = () => {
    if (!form.name.trim())    return alert('Lease name is required.')
    if (!form.startDate)      return alert('Start date is required.')
    if (!form.monthlyRent || parseFloat(form.monthlyRent) <= 0) return alert('Enter a valid monthly rent.')
    addLease({ ...form, monthlyRent: parseFloat(form.monthlyRent) })
    setAddModal(false)
    setForm(emptyForm())
  }

  const openPay = (lease) => {
    setPayModal(lease)
    setPayForm({ date: today(), amount: String(lease.monthlyRent || ''), period: '', bankAccountId: lease.bankAccountId || bankOpts[0]?.id })
  }

  const handlePay = () => {
    const amt = parseFloat(payForm.amount)
    if (!amt || amt <= 0)           return alert('Enter a valid payment amount.')
    if (!payForm.period.trim())     return alert('Enter the period (e.g. June 2026).')
    recordLeasePayment(payModal.id, {
      date: payForm.date, amount: amt, period: payForm.period,
      bankAccountId: payForm.bankAccountId,
      expenseAccountId: payModal.expenseAccountId || 'acc-rent',
    })
    setPayModal(null)
  }

  const STATUS_CLR = { active: 'bg-green-100 text-green-700', terminated: 'bg-gray-100 text-gray-500', expired: 'bg-amber-100 text-amber-700' }

  const leaseStatus = (lease) => {
    if (lease.status === 'terminated') return 'terminated'
    if (lease.endDate && today() > lease.endDate) return 'expired'
    return 'active'
  }

  return (
    <div>
      <PageHeader
        title="Leases & Rent"
        subtitle="Track operating leases, office rent, and other recurring rental obligations"
        action={<Btn onClick={() => setAddModal(true)}><Plus size={15} /> Add Lease</Btn>}
      />

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Active Leases"     value={activeLeases.length}         color="blue"   icon={<Home size={18} />}       sub="current obligations" />
        <StatCard label="Monthly Commitment" value={fmtMoney(monthlyTotal, sym)} color="orange" icon={<CreditCard size={18} />}  sub="total monthly rent" />
        <StatCard label="Total Paid"         value={fmtMoney(totalPayments, sym)} color="green"  icon={<CreditCard size={18} />}  sub="all time payments" />
      </div>

      <div className="flex gap-2 mb-4">
        {[['active','Active'],['terminated','Terminated'],['all','All']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${filter === val ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
            {label} ({val === 'all' ? leases.length : leases.filter(l => l.status === val).length})
          </button>
        ))}
      </div>

      <Card>
        {leases.length === 0 ? (
          <EmptyState icon="🏢" title="No leases recorded" desc="Add office space, equipment, or vehicle leases. Each rent payment automatically posts a journal entry (Dr Rent Expense / Cr Bank)."
            action={<Btn onClick={() => setAddModal(true)}><Plus size={14} /> Add Lease</Btn>} />
        ) : sorted.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No {filter} leases</div>
        ) : (
          <Table headers={['Number', 'Name', 'Landlord', 'Type', 'Start', 'End', { label: 'Monthly Rent', right: true }, { label: 'Total Paid', right: true }, 'Payments', 'Status', { label: 'Actions', right: true }]}>
            {sorted.map((lease) => {
              const totalPaid  = (lease.payments || []).reduce((s, p) => s + p.amount, 0)
              const status     = leaseStatus(lease)
              return (
                <Tr key={lease.id}>
                  <Td><span className="font-mono text-xs text-gray-500">{lease.number}</span></Td>
                  <Td>
                    <p className="font-medium text-gray-800">{lease.name}</p>
                    {lease.notes && <p className="text-xs text-gray-400 truncate max-w-[120px]">{lease.notes}</p>}
                  </Td>
                  <Td className="text-gray-500 text-sm">{lease.landlord || '—'}</Td>
                  <Td className="text-gray-500 text-sm capitalize">{lease.leaseType}</Td>
                  <Td className="text-gray-500 text-sm">{fmtDate(lease.startDate)}</Td>
                  <Td className="text-gray-500 text-sm">{lease.endDate ? fmtDate(lease.endDate) : 'Open'}</Td>
                  <Td right className="font-medium text-gray-700">{fmtMoney(lease.monthlyRent, sym)}</Td>
                  <Td right className="text-gray-700">{fmtMoney(totalPaid, sym)}</Td>
                  <Td className="text-gray-500 text-sm">{(lease.payments || []).length} payment{(lease.payments || []).length !== 1 ? 's' : ''}</Td>
                  <Td><Badge className={STATUS_CLR[status] || 'bg-gray-100 text-gray-500'}>{status}</Badge></Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      {status === 'active' && (
                        <>
                          <Btn size="sm" variant="secondary" onClick={() => openPay(lease)}>
                            <CreditCard size={12} /> Pay
                          </Btn>
                          <Btn size="sm" variant="ghost" title="Terminate"
                            onClick={() => { if (confirm(`Terminate lease "${lease.name}"?`)) terminateLease(lease.id, today()) }}>
                            <XCircle size={13} className="text-amber-500" />
                          </Btn>
                        </>
                      )}
                      <Btn size="sm" variant="ghost" onClick={() => { if (confirm(`Delete lease "${lease.name}"? Payment journal entries will remain.`)) deleteLease(lease.id) }}>
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

      {/* Add Lease Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Add Lease" width="max-w-lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Lease Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Office – Level 3, Suite A" />
            <Input label="Landlord / Lessor" value={form.landlord} onChange={(e) => setField('landlord', e.target.value)} placeholder="Company or person name" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Select label="Lease Type" value={form.leaseType} onChange={(e) => setField('leaseType', e.target.value)}>
              <option value="operating">Operating Lease</option>
              <option value="finance">Finance Lease</option>
            </Select>
            <Input label="Start Date *" type="date" value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} />
            <Input label="End Date" type="date" value={form.endDate} onChange={(e) => setField('endDate', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={`Monthly Rent (${sym}) *`} type="number" min="0" step="0.01" value={form.monthlyRent} onChange={(e) => setField('monthlyRent', e.target.value)} />
            <Select label="Default Pay From" value={form.bankAccountId} onChange={(e) => setField('bankAccountId', e.target.value)}>
              {bankOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
          <Textarea label="Notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={2} placeholder="Property address, lease reference, contact details..." />
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setAddModal(false)}>Cancel</Btn>
            <Btn onClick={handleAdd}>Save Lease</Btn>
          </div>
        </div>
      </Modal>

      {/* Pay Modal */}
      <Modal open={!!payModal} onClose={() => setPayModal(null)} title={`Record Payment – ${payModal?.name}`}>
        <div className="space-y-4">
          <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
            <p>Monthly rent: <strong>{fmtMoney(payModal?.monthlyRent || 0, sym)}</strong></p>
            <p className="text-xs mt-0.5 text-blue-500">Posts: Dr Rent Expense → Cr Bank</p>
          </div>
          <Input label="Period *" value={payForm.period} onChange={(e) => setPayForm((f) => ({ ...f, period: e.target.value }))} placeholder="e.g. June 2026" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Payment Date" type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} />
            <Input label={`Amount (${sym}) *`} type="number" min="0" step="0.01" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} />
          </div>
          <Select label="Pay From" value={payForm.bankAccountId} onChange={(e) => setPayForm((f) => ({ ...f, bankAccountId: e.target.value }))}>
            {bankOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setPayModal(null)}>Cancel</Btn>
            <Btn onClick={handlePay}>Record Payment</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
