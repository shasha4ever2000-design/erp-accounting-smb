import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, EmptyState, Table, Tr, Td } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import { useT } from '../i18n'
import ExportMenu from '../components/ExportMenu'
import { Plus, Pencil, Trash2, Search, Package } from 'lucide-react'

const emptyForm = {
  name: '', code: '', description: '', unit: 'pcs', category: '', barcode: '',
  costPrice: '', salePrice: '', quantity: '', reorderLevel: '', maxLevel: '',
  inventoryAccountId: 'acc-inv', cogsAccountId: 'acc-cogs', revenueAccountId: 'acc-sales',
  taxRate: 0,
}

export default function Inventory() {
  const { inventoryItems, accounts, addInventoryItem, updateInventoryItem, deleteInventoryItem, settings } = useStore()
  const sym = settings.company.currencySymbol
  const t = useT()
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
      maxLevel: parseFloat(form.maxLevel) || 0,
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
    || (i.barcode || '').toLowerCase().includes(search.toLowerCase()) || (i.category || '').toLowerCase().includes(search.toLowerCase())
  )

  const totalValue = inventoryItems.reduce((s, i) => s + (i.quantity || 0) * (i.costPrice || 0), 0)
  const lowStock = inventoryItems.filter((i) => (i.reorderLevel || 0) > 0 && (i.quantity || 0) <= (i.reorderLevel || 0))

  const exportCols = [
    { key: 'code', label: t('Code') },
    { key: 'name', label: t('Item Name') },
    { key: 'unit', label: t('Unit') },
    { key: 'costPrice', label: t('Cost Price'), right: true },
    { key: 'salePrice', label: t('Sale Price'), right: true },
    { key: 'quantity', label: t('Qty on Hand'), right: true },
    { key: 'stockValue', label: t('Stock Value'), right: true, map: (_, i) => ((i.quantity || 0) * (i.costPrice || 0)).toFixed(2) },
  ]

  return (
    <div>
      <PageHeader
        title={t('Inventory Items')}
        subtitle={`${inventoryItems.length} ${t('items')} • ${fmtMoney(totalValue, sym)} ${t('total value')}`}
        action={
          <div className="flex items-center gap-2">
            {inventoryItems.length > 0 && <ExportMenu filename="inventory" title={t('Inventory Items')} rows={inventoryItems} columns={exportCols} />}
            <Btn onClick={openNew}><Plus size={15} /> {t('New Item')}</Btn>
          </div>
        }
      />

      {lowStock.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4 mb-5 flex items-start gap-3">
          <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex-shrink-0">
            <Package size={16} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-amber-800 dark:text-amber-300 text-sm">{t('Low Stock Alert')}</p>
            <p className="text-amber-700 dark:text-amber-400/90 text-sm mt-0.5">{lowStock.map((i) => i.name).join(', ')} {lowStock.length === 1 ? 'is' : 'are'} at or below reorder level.</p>
          </div>
        </div>
      )}

      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 pointer-events-none" />
        <input className="w-full ps-9 pe-3 py-2 text-sm bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 shadow-input dark:shadow-none transition-all duration-150 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:focus:ring-brand-400/20"
          placeholder={t('Search items...')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        {inventoryItems.length === 0 ? (
          <EmptyState icon="📦" title={t('No inventory items')} desc={t('Add products or services to your inventory.')} action={<Btn onClick={openNew}><Plus size={14} /> {t('Add Item')}</Btn>} />
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-gray-400 dark:text-slate-500 text-sm">{t('No items match your search')}</div>
        ) : (
          <Table headers={[t('Code'), t('Item Name'), t('Unit'), { label: t('Cost Price'), right: true }, { label: t('Sale Price'), right: true }, { label: t('Qty on Hand'), right: true }, { label: t('Stock Value'), right: true }, { label: t('Actions'), right: true }]}>
            {filtered.map((item) => {
              const stockValue = (item.quantity || 0) * (item.costPrice || 0)
              const isLow = (item.reorderLevel || 0) > 0 && (item.quantity || 0) <= (item.reorderLevel || 0)
              return (
                <Tr key={item.id}>
                  <Td className="font-mono text-gray-500 dark:text-slate-400 text-xs">{item.code || '—'}</Td>
                  <Td>
                    <p className="font-medium text-gray-900 dark:text-slate-100">{item.name}</p>
                    {item.description && <p className="text-xs text-gray-400 dark:text-slate-500 truncate max-w-xs">{item.description}</p>}
                  </Td>
                  <Td className="text-gray-500 dark:text-slate-400">{item.unit}</Td>
                  <Td right className="tabular-nums text-gray-600 dark:text-slate-400">{fmtMoney(item.costPrice || 0, sym)}</Td>
                  <Td right className="font-medium tabular-nums text-gray-900 dark:text-slate-100">{fmtMoney(item.salePrice || 0, sym)}</Td>
                  <Td right>
                    <span className={`tabular-nums ${isLow ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-800 dark:text-slate-200'}`}>
                      {item.quantity || 0} {item.unit}
                      {isLow && <span className="ms-1.5 text-[10px] font-semibold bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 px-1.5 py-px rounded-full uppercase tracking-wide">LOW</span>}
                    </span>
                  </Td>
                  <Td right className="text-gray-600 dark:text-slate-400 tabular-nums">{fmtMoney(stockValue, sym)}</Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      <AttachmentButton entityType="inventory" entityId={item.id} />
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Item Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Product or service name" />
            <Input label="Item Code / SKU" value={form.code} onChange={(e) => setField('code', e.target.value)} placeholder="e.g. SKU-001" />
          </div>
          <Textarea label="Description" value={form.description} onChange={(e) => setField('description', e.target.value)} rows={2} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Category" value={form.category} onChange={(e) => setField('category', e.target.value)} placeholder="e.g. Raw Materials, Finished Goods" />
            <Input label="Barcode" value={form.barcode} onChange={(e) => setField('barcode', e.target.value)} placeholder="EAN / UPC / scan" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label="Unit" value={form.unit} onChange={(e) => setField('unit', e.target.value)} placeholder="pcs, kg, hr..." />
            <Input label="Cost Price" type="number" min="0" step="0.01" value={form.costPrice} onChange={(e) => setField('costPrice', e.target.value)} />
            <Input label="Sale Price" type="number" min="0" step="0.01" value={form.salePrice} onChange={(e) => setField('salePrice', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label="Qty on Hand" type="number" min="0" step="0.01" value={form.quantity} onChange={(e) => setField('quantity', e.target.value)} />
            <Input label="Reorder Level" type="number" min="0" step="0.01" value={form.reorderLevel} onChange={(e) => setField('reorderLevel', e.target.value)} />
            <Input label="Max Level" type="number" min="0" step="0.01" value={form.maxLevel} onChange={(e) => setField('maxLevel', e.target.value)} placeholder="optional" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-slate-700">
            <Btn variant="secondary" onClick={close}>{t('Cancel')}</Btn>
            <Btn onClick={handleSave}>{editing ? 'Save Changes' : 'Add Item'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
