import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Pencil, Trash2, Search, Package } from 'lucide-react'

const emptyForm = {
  name: '', code: '', description: '', unit: 'pcs',
  costPrice: '', salePrice: '', quantity: '', reorderLevel: '',
  inventoryAccountId: 'acc-inv', cogsAccountId: 'acc-cogs', revenueAccountId: 'acc-sales',
  taxRate: 0,
}

export default function Inventory() {
  const { inventoryItems, accounts, addInventoryItem, updateInventoryItem, deleteInventoryItem, settings } = useStore()
  const sym = settings.company.currencySymbol
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [search, setSearch] = useState('')

  const openNew = () => { setEditing(null); setForm(emptyForm); setModal(true) }
  const openEdit = (item) => { setEditing(item); setForm({ ...emptyForm, ...item }); setModal(true) }
  const close = () => setModal(false)
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handleSave = () => {
    if (!form.name.trim()) return alert('Item name is required.')
    const data = {
      ...form,
      costPrice: parseFloat(form.costPrice) || 0,
      salePrice: parseFloat(form.salePrice) || 0,
      quantity: parseFloat(form.quantity) || 0,
      reorderLevel: parseFloat(form.reorderLevel) || 0,
      taxRate: parseFloat(form.taxRate) || 0,
    }
    if (editing) updateInventoryItem(editing.id, data)
    else addInventoryItem(data)
    close()
  }

  const handleDelete = (item) => {
    if (confirm(`Delete "${item.name}"?`)) deleteInventoryItem(item.id)
  }

  const revenueAccounts = accounts.filter((a) => a.type === 'revenue')
  const expenseAccounts = accounts.filter((a) => a.type === 'expense')
  const assetAccounts = accounts.filter((a) => a.type === 'asset' && a.subtype === 'current')

  const filtered = inventoryItems.filter((i) =>
    !search || i.name.toLowerCase().includes(search.toLowerCase()) || (i.code || '').toLowerCase().includes(search.toLowerCase())
  )

  const totalValue = inventoryItems.reduce((s, i) => s + (i.quantity || 0) * (i.costPrice || 0), 0)
  const lowStock = inventoryItems.filter((i) => (i.reorderLevel || 0) > 0 && (i.quantity || 0) <= (i.reorderLevel || 0))

  return (
    <div>
      <PageHeader
        title="Inventory Items"
        subtitle={`${inventoryItems.length} items • ${fmtMoney(totalValue, sym)} total value`}
        action={<Btn onClick={openNew}><Plus size={15} /> New Item</Btn>}
      />

      {lowStock.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 flex items-start gap-3">
          <Package size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-amber-800 text-sm">Low Stock Alert</p>
            <p className="text-amber-700 text-sm">{lowStock.map((i) => i.name).join(', ')} {lowStock.length === 1 ? 'is' : 'are'} at or below reorder level.</p>
          </div>
        </div>
      )}

      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
        <input className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        {inventoryItems.length === 0 ? (
          <EmptyState icon="📦" title="No inventory items" desc="Add products or services to your inventory." action={<Btn onClick={openNew}><Plus size={14} /> Add Item</Btn>} />
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No items match your search</div>
        ) : (
          <Table headers={['Code', 'Item Name', 'Unit', { label: 'Cost Price', right: true }, { label: 'Sale Price', right: true }, { label: 'Qty on Hand', right: true }, { label: 'Stock Value', right: true }, { label: 'Actions', right: true }]}>
            {filtered.map((item) => {
              const stockValue = (item.quantity || 0) * (item.costPrice || 0)
              const isLow = (item.reorderLevel || 0) > 0 && (item.quantity || 0) <= (item.reorderLevel || 0)
              return (
                <Tr key={item.id}>
                  <Td className="font-mono text-gray-500 text-xs">{item.code || '—'}</Td>
                  <Td>
                    <p className="font-medium text-gray-800">{item.name}</p>
                    {item.description && <p className="text-xs text-gray-400">{item.description}</p>}
                  </Td>
                  <Td className="text-gray-500">{item.unit}</Td>
                  <Td right>{fmtMoney(item.costPrice || 0, sym)}</Td>
                  <Td right className="font-medium">{fmtMoney(item.salePrice || 0, sym)}</Td>
                  <Td right>
                    <span className={isLow ? 'text-red-600 font-semibold' : 'text-gray-800'}>
                      {item.quantity || 0} {item.unit}
                      {isLow && <span className="ml-1 text-[10px] bg-red-100 text-red-600 px-1 rounded">LOW</span>}
                    </span>
                  </Td>
                  <Td right className="text-gray-600">{fmtMoney(stockValue, sym)}</Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      <Btn size="sm" variant="ghost" onClick={() => openEdit(item)}><Pencil size={13} /></Btn>
                      <Btn size="sm" variant="ghost" onClick={() => handleDelete(item)}><Trash2 size={13} className="text-red-400" /></Btn>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={close} title={editing ? 'Edit Item' : 'New Inventory Item'} width="max-w-2xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Item Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Product or service name" />
            <Input label="Item Code / SKU" value={form.code} onChange={(e) => setField('code', e.target.value)} placeholder="e.g. SKU-001" />
          </div>
          <Textarea label="Description" value={form.description} onChange={(e) => setField('description', e.target.value)} rows={2} />
          <div className="grid grid-cols-3 gap-3">
            <Input label="Unit" value={form.unit} onChange={(e) => setField('unit', e.target.value)} placeholder="pcs, kg, hr..." />
            <Input label="Cost Price" type="number" min="0" step="0.01" value={form.costPrice} onChange={(e) => setField('costPrice', e.target.value)} />
            <Input label="Sale Price" type="number" min="0" step="0.01" value={form.salePrice} onChange={(e) => setField('salePrice', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Qty on Hand" type="number" min="0" step="0.01" value={form.quantity} onChange={(e) => setField('quantity', e.target.value)} />
            <Input label="Reorder Level" type="number" min="0" step="0.01" value={form.reorderLevel} onChange={(e) => setField('reorderLevel', e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Select label="Inventory Account" value={form.inventoryAccountId} onChange={(e) => setField('inventoryAccountId', e.target.value)}>
              {assetAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Select label="COGS Account" value={form.cogsAccountId} onChange={(e) => setField('cogsAccountId', e.target.value)}>
              {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Select label="Revenue Account" value={form.revenueAccountId} onChange={(e) => setField('revenueAccountId', e.target.value)}>
              {revenueAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={close}>Cancel</Btn>
            <Btn onClick={handleSave}>{editing ? 'Save Changes' : 'Add Item'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
