import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Textarea, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Pencil, Trash2, Users, Search } from 'lucide-react'

const emptyForm = { name: '', email: '', phone: '', address: '', taxId: '', notes: '' }

export default function Customers() {
  const { customers, invoices, addCustomer, updateCustomer, deleteCustomer, settings } = useStore()
  const sym = settings.company.currencySymbol
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [search, setSearch] = useState('')

  const openNew = () => { setEditing(null); setForm(emptyForm); setModal(true) }
  const openEdit = (c) => { setEditing(c); setForm({ name: c.name, email: c.email || '', phone: c.phone || '', address: c.address || '', taxId: c.taxId || '', notes: c.notes || '' }); setModal(true) }
  const close = () => setModal(false)
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handleSave = () => {
    if (!form.name.trim()) return
    if (editing) updateCustomer(editing.id, form)
    else addCustomer(form)
    close()
  }

  const handleDelete = (c) => {
    if (confirm(`Delete customer "${c.name}"?`)) deleteCustomer(c.id)
  }

  const getBalance = (customerId) => {
    return invoices
      .filter((i) => i.customerId === customerId && i.status !== 'cancelled')
      .reduce((sum, i) => sum + (i.total - i.amountPaid), 0)
  }

  const filtered = customers.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.email || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} customer${customers.length !== 1 ? 's' : ''}`}
        action={<Btn onClick={openNew}><Plus size={15} /> New Customer</Btn>}
      />

      {/* Search */}
      <div className="relative mb-5 max-w-sm">
        <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
        <input
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search customers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        {filtered.length === 0 && customers.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No customers yet"
            desc="Add your first customer to start creating invoices."
            action={<Btn onClick={openNew}><Plus size={14} /> Add Customer</Btn>}
          />
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No customers match your search</div>
        ) : (
          <Table headers={['Customer', 'Contact', 'Tax ID', { label: 'Balance Due', right: true }, { label: 'Actions', right: true }]}>
            {filtered.map((c) => {
              const balance = getBalance(c.id)
              return (
                <Tr key={c.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold text-sm">
                        {c.name[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-800">{c.name}</p>
                        <p className="text-xs text-gray-400">Since {fmtDate(c.createdAt)}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    {c.email && <p className="text-sm text-gray-600">{c.email}</p>}
                    {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
                  </Td>
                  <Td className="text-gray-500 text-sm">{c.taxId || '—'}</Td>
                  <Td right>
                    <span className={`font-semibold ${balance > 0 ? 'text-orange-600' : 'text-gray-700'}`}>
                      {fmtMoney(balance, sym)}
                    </span>
                  </Td>
                  <Td right>
                    <div className="flex items-center justify-end gap-1">
                      <Btn size="sm" variant="ghost" onClick={() => openEdit(c)}><Pencil size={13} /></Btn>
                      <Btn size="sm" variant="ghost" onClick={() => handleDelete(c)}><Trash2 size={13} className="text-red-400" /></Btn>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={close} title={editing ? 'Edit Customer' : 'New Customer'}>
        <div className="space-y-4">
          <Input label="Customer Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Full name or company name" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="email@company.com" />
            <Input label="Phone" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+1 234 567 890" />
          </div>
          <Input label="Tax / VAT ID" value={form.taxId} onChange={(e) => setField('taxId', e.target.value)} placeholder="Tax registration number" />
          <Textarea label="Address" value={form.address} onChange={(e) => setField('address', e.target.value)} rows={2} placeholder="Street, City, Country" />
          <Textarea label="Notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={2} placeholder="Internal notes..." />
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={close}>Cancel</Btn>
            <Btn onClick={handleSave}>{editing ? 'Save Changes' : 'Add Customer'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
