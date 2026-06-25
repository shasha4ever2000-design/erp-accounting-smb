import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Textarea, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'

const emptyForm = { name: '', email: '', phone: '', address: '', taxId: '', notes: '' }

export default function Suppliers() {
  const { suppliers, purchases, addSupplier, updateSupplier, deleteSupplier, settings } = useStore()
  const sym = settings.company.currencySymbol
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [search, setSearch] = useState('')

  const openNew = () => { setEditing(null); setForm(emptyForm); setModal(true) }
  const openEdit = (s) => { setEditing(s); setForm({ name: s.name, email: s.email || '', phone: s.phone || '', address: s.address || '', taxId: s.taxId || '', notes: s.notes || '' }); setModal(true) }
  const close = () => setModal(false)
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handleSave = () => {
    if (!form.name.trim()) return
    if (editing) updateSupplier(editing.id, form)
    else addSupplier(form)
    close()
  }

  const handleDelete = (s) => {
    if (confirm(`Delete supplier "${s.name}"?`)) deleteSupplier(s.id)
  }

  const getBalance = (supplierId) => {
    return purchases
      .filter((p) => p.supplierId === supplierId && p.status !== 'cancelled')
      .reduce((sum, p) => sum + (p.total - p.amountPaid), 0)
  }

  const filtered = suppliers.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || (s.email || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle={`${suppliers.length} supplier${suppliers.length !== 1 ? 's' : ''}`}
        action={<Btn onClick={openNew}><Plus size={15} /> New Supplier</Btn>}
      />

      <div className="relative mb-5 max-w-sm">
        <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
        <input
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search suppliers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        {filtered.length === 0 && suppliers.length === 0 ? (
          <EmptyState
            icon="🏭"
            title="No suppliers yet"
            desc="Add your first supplier to start creating purchase invoices."
            action={<Btn onClick={openNew}><Plus size={14} /> Add Supplier</Btn>}
          />
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No suppliers match your search</div>
        ) : (
          <Table headers={['Supplier', 'Contact', 'Tax ID', { label: 'Amount Owed', right: true }, { label: 'Actions', right: true }]}>
            {filtered.map((s) => {
              const balance = getBalance(s.id)
              return (
                <Tr key={s.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 font-semibold text-sm">
                        {s.name[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-800">{s.name}</p>
                        <p className="text-xs text-gray-400">Since {fmtDate(s.createdAt)}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    {s.email && <p className="text-sm text-gray-600">{s.email}</p>}
                    {s.phone && <p className="text-xs text-gray-400">{s.phone}</p>}
                  </Td>
                  <Td className="text-gray-500 text-sm">{s.taxId || '—'}</Td>
                  <Td right>
                    <span className={`font-semibold ${balance > 0 ? 'text-red-600' : 'text-gray-700'}`}>
                      {fmtMoney(balance, sym)}
                    </span>
                  </Td>
                  <Td right>
                    <div className="flex items-center justify-end gap-1">
                      <Btn size="sm" variant="ghost" onClick={() => openEdit(s)}><Pencil size={13} /></Btn>
                      <Btn size="sm" variant="ghost" onClick={() => handleDelete(s)}><Trash2 size={13} className="text-red-400" /></Btn>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={close} title={editing ? 'Edit Supplier' : 'New Supplier'}>
        <div className="space-y-4">
          <Input label="Supplier Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Supplier company name" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
            <Input label="Phone" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
          </div>
          <Input label="Tax / VAT ID" value={form.taxId} onChange={(e) => setField('taxId', e.target.value)} />
          <Textarea label="Address" value={form.address} onChange={(e) => setField('address', e.target.value)} rows={2} />
          <Textarea label="Notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={2} />
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={close}>Cancel</Btn>
            <Btn onClick={handleSave}>{editing ? 'Save Changes' : 'Add Supplier'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
