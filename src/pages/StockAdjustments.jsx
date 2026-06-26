import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import { Plus, Trash2, TrendingUp, TrendingDown } from 'lucide-react'

const emptyForm = () => ({
  date: today(), type: 'increase', itemId: '', itemName: '', quantity: '', unitCost: '', reason: '', inventoryAccountId: 'acc-inv',
})

export default function StockAdjustments() {
  const { stockAdjustments, inventoryItems, settings, addStockAdjustment, deleteStockAdjustment } = useStore()
  const sym = settings.company.currencySymbol

  const [modal, setModal] = useState(false)
  const [form, setForm]   = useState(emptyForm())
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const pickItem = (id) => {
    const item = inventoryItems.find((i) => i.id === id)
    if (item) setForm((f) => ({ ...f, itemId: item.id, itemName: item.name, unitCost: item.costPrice || '', inventoryAccountId: item.inventoryAccountId || 'acc-inv' }))
    else setForm((f) => ({ ...f, itemId: '', itemName: '' }))
  }

  const quantity    = parseFloat(form.quantity)  || 0
  const unitCost    = parseFloat(form.unitCost)  || 0
  const totalAmount = quantity * unitCost

  const handleSave = () => {
    if (!form.itemId && !form.itemName.trim()) return alert('Select or name an item.')
    if (!quantity || quantity <= 0)  return alert('Enter a valid quantity.')
    if (!unitCost || unitCost <= 0)  return alert('Enter a valid unit cost.')
    addStockAdjustment({ ...form, quantity, unitCost, totalAmount })
    setModal(false)
    setForm(emptyForm())
  }

  const sorted = [...stockAdjustments].sort((a, b) => b.date.localeCompare(a.date))

  const totalIncrease = stockAdjustments.filter(a=>a.type==='increase').reduce((s,a)=>s+a.totalAmount,0)
  const totalDecrease = stockAdjustments.filter(a=>a.type==='decrease').reduce((s,a)=>s+a.totalAmount,0)

  return (
    <div>
      <PageHeader
        title="Stock Adjustments"
        subtitle="Record inventory increases, decreases, and write-offs"
        action={<Btn onClick={() => setModal(true)}><Plus size={15} /> New Adjustment</Btn>}
      />

      <div className="grid grid-cols-2 gap-4 mb-6">
        <StatCard label="Total Increases"  value={fmtMoney(totalIncrease, sym)} color="green"  icon={<TrendingUp size={18} />}   sub={`${stockAdjustments.filter(a=>a.type==='increase').length} adjustments`} />
        <StatCard label="Total Decreases"  value={fmtMoney(totalDecrease, sym)} color="red"    icon={<TrendingDown size={18} />}  sub={`${stockAdjustments.filter(a=>a.type==='decrease').length} adjustments`} />
      </div>

      <Card>
        {stockAdjustments.length === 0 ? (
          <EmptyState icon="📊" title="No stock adjustments" desc="Record stock counts, damaged goods write-offs, or inventory corrections. Each adjustment posts a journal entry."
            action={<Btn onClick={() => setModal(true)}><Plus size={14} /> New Adjustment</Btn>} />
        ) : (
          <Table headers={['Number', 'Date', 'Item', 'Type', { label: 'Qty', right: true }, { label: 'Unit Cost', right: true }, { label: 'Total', right: true }, 'Reason', { label: '', right: true }]}>
            {sorted.map((adj) => (
              <Tr key={adj.id}>
                <Td><span className="font-mono text-xs text-gray-500">{adj.number}</span></Td>
                <Td className="text-gray-500 text-sm">{fmtDate(adj.date)}</Td>
                <Td className="font-medium text-gray-800">{adj.itemName || '—'}</Td>
                <Td>
                  {adj.type === 'increase'
                    ? <Badge className="bg-green-100 text-green-700 inline-flex items-center gap-1"><TrendingUp size={10} /> Increase</Badge>
                    : <Badge className="bg-red-100 text-red-700 inline-flex items-center gap-1"><TrendingDown size={10} /> Decrease</Badge>
                  }
                </Td>
                <Td right className="text-gray-700">{adj.quantity}</Td>
                <Td right className="text-gray-600">{fmtMoney(adj.unitCost, sym)}</Td>
                <Td right>
                  <span className={`font-semibold ${adj.type === 'increase' ? 'text-green-600' : 'text-red-600'}`}>
                    {adj.type === 'increase' ? '+' : '-'}{fmtMoney(adj.totalAmount, sym)}
                  </span>
                </Td>
                <Td className="text-gray-500 text-sm max-w-[150px] truncate">{adj.reason || '—'}</Td>
                <Td right>
                  <Btn size="sm" variant="ghost" onClick={() => { if (confirm(`Delete adjustment ${adj.number}? This will reverse the quantity change.`)) deleteStockAdjustment(adj.id) }}>
                    <Trash2 size={13} className="text-red-400" />
                  </Btn>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="New Stock Adjustment" width="max-w-lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
            <Select label="Adjustment Type" value={form.type} onChange={(e) => setField('type', e.target.value)}>
              <option value="increase">Increase (Stock In)</option>
              <option value="decrease">Decrease / Write-off</option>
            </Select>
          </div>

          <Select label="Inventory Item" value={form.itemId} onChange={(e) => pickItem(e.target.value)}>
            <option value="">— Select item —</option>
            {inventoryItems.map((i) => (
              <option key={i.id} value={i.id}>{i.name} (on hand: {i.quantity || 0})</option>
            ))}
          </Select>
          {!form.itemId && (
            <Input label="Or enter item name" value={form.itemName} onChange={(e) => setField('itemName', e.target.value)} placeholder="Item name" />
          )}

          <div className="grid grid-cols-3 gap-3">
            <Input label="Quantity *" type="number" min="0" step="any" value={form.quantity} onChange={(e) => setField('quantity', e.target.value)} />
            <Input label={`Unit Cost (${sym}) *`} type="number" min="0" step="0.01" value={form.unitCost} onChange={(e) => setField('unitCost', e.target.value)} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount</label>
              <p className="py-2 px-3 text-sm font-semibold text-gray-800 border border-gray-200 rounded-lg bg-gray-50">{sym}{totalAmount.toFixed(2)}</p>
            </div>
          </div>

          <Textarea label="Reason / Notes" value={form.reason} onChange={(e) => setField('reason', e.target.value)} rows={2} placeholder="e.g. Stock count discrepancy, damaged goods, found items" />

          <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
            {form.type === 'increase'
              ? `Posts: Dr Inventory (${sym}${totalAmount.toFixed(2)}) → Cr Inventory Adjustments`
              : `Posts: Dr Inventory Adjustments → Cr Inventory (${sym}${totalAmount.toFixed(2)})`
            }
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>Cancel</Btn>
            <Btn onClick={handleSave}>Save Adjustment</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
