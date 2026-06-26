import { useState } from 'react'
import { useStore } from '../store'
import { fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Badge, EmptyState } from '../components/UI'
import { Plus, Pencil, Trash2, Warehouse, ArrowLeftRight, MapPin } from 'lucide-react'

const emptyWh = { name: '', location: '' }
const emptyTransfer = { itemId: '', fromWarehouseId: '', toWarehouseId: '', quantity: '', date: today(), notes: '' }

export default function Warehouses() {
  const {
    warehouses, inventoryItems, stockTransfers, getItemStock,
    addWarehouse, updateWarehouse, deleteWarehouse, addStockTransfer, deleteStockTransfer,
  } = useStore()

  const [whModal, setWhModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [whForm, setWhForm] = useState(emptyWh)
  const [trModal, setTrModal] = useState(false)
  const [trForm, setTrForm] = useState(emptyTransfer)

  const setW = (k, v) => setWhForm((f) => ({ ...f, [k]: v }))
  const setT = (k, v) => setTrForm((f) => ({ ...f, [k]: v }))

  const openNewWh = () => { setEditing(null); setWhForm(emptyWh); setWhModal(true) }
  const openEditWh = (w) => { setEditing(w); setWhForm({ name: w.name, location: w.location || '' }); setWhModal(true) }

  const saveWh = () => {
    if (!whForm.name.trim()) return alert('Warehouse name is required.')
    if (editing) updateWarehouse(editing.id, whForm)
    else addWarehouse(whForm)
    setWhModal(false)
  }

  const openTransfer = () => {
    if (inventoryItems.length === 0) return alert('Add inventory items first.')
    if (warehouses.length < 2) return alert('Create at least two warehouses to transfer stock.')
    setTrForm({ ...emptyTransfer, itemId: inventoryItems[0]?.id || '', fromWarehouseId: warehouses[0]?.id || '', toWarehouseId: warehouses[1]?.id || '' })
    setTrModal(true)
  }

  const saveTransfer = () => {
    const qty = parseFloat(trForm.quantity) || 0
    if (qty <= 0) return alert('Enter a quantity.')
    if (trForm.fromWarehouseId === trForm.toWarehouseId) return alert('Source and destination must differ.')
    const item = inventoryItems.find((i) => i.id === trForm.itemId)
    const available = getItemStock(item, trForm.fromWarehouseId)
    if (qty > available) return alert(`Only ${available} ${item?.unit || 'units'} available in the source warehouse.`)
    addStockTransfer({ ...trForm, quantity: qty })
    setTrModal(false)
  }

  const whName = (id) => warehouses.find((w) => w.id === id)?.name || '—'
  const itemName = (id) => inventoryItems.find((i) => i.id === id)?.name || '—'

  return (
    <div>
      <PageHeader
        title="Warehouses & Stock Locations"
        subtitle={`${warehouses.length} location${warehouses.length !== 1 ? 's' : ''} · ${inventoryItems.length} items tracked`}
        action={
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={openTransfer}><ArrowLeftRight size={15} /> Transfer Stock</Btn>
            <Btn onClick={openNewWh}><Plus size={15} /> New Warehouse</Btn>
          </div>
        }
      />

      {/* Warehouse cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {warehouses.map((w) => {
          const itemsHere = inventoryItems.filter((i) => getItemStock(i, w.id) > 0).length
          const value = inventoryItems.reduce((s, i) => s + getItemStock(i, w.id) * (i.costPrice || 0), 0)
          return (
            <Card key={w.id} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-sky-50 dark:bg-sky-900/40 flex items-center justify-center">
                    <Warehouse size={18} className="text-sky-600 dark:text-sky-300" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-800 dark:text-slate-100">{w.name}</p>
                      {w.isDefault && <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">default</Badge>}
                    </div>
                    {w.location && <p className="text-xs text-gray-400 dark:text-slate-500 flex items-center gap-1"><MapPin size={11} /> {w.location}</p>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Btn size="sm" variant="ghost" onClick={() => openEditWh(w)}><Pencil size={13} /></Btn>
                  {!w.isDefault && <Btn size="sm" variant="ghost" onClick={() => { if (confirm(`Delete warehouse "${w.name}"?`)) deleteWarehouse(w.id) }}><Trash2 size={13} className="text-red-400" /></Btn>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-gray-50 dark:border-slate-700">
                <div><p className="text-[11px] text-gray-400 dark:text-slate-500 uppercase">Items</p><p className="text-lg font-bold text-gray-800 dark:text-slate-100">{itemsHere}</p></div>
                <div><p className="text-[11px] text-gray-400 dark:text-slate-500 uppercase">Stock Value</p><p className="text-lg font-bold text-gray-800 dark:text-slate-100">{value.toLocaleString()}</p></div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Stock matrix */}
      <Card className="overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700">
          <h3 className="font-semibold text-sm text-gray-700 dark:text-slate-200">Stock by Location</h3>
        </div>
        {inventoryItems.length === 0 ? (
          <EmptyState icon="📦" title="No inventory items" desc="Add items in the Inventory module to track them across warehouses." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/60">
                <tr className="text-xs text-gray-400 dark:text-slate-500 uppercase">
                  <th className="text-left px-5 py-2 font-medium">Item</th>
                  {warehouses.map((w) => <th key={w.id} className="text-right px-4 py-2 font-medium">{w.name}</th>)}
                  <th className="text-right px-5 py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {inventoryItems.map((it) => {
                  const total = warehouses.reduce((s, w) => s + getItemStock(it, w.id), 0)
                  return (
                    <tr key={it.id} className="border-b border-gray-50 dark:border-slate-700/50">
                      <td className="px-5 py-2 text-gray-700 dark:text-slate-200">{it.name}<span className="text-gray-400 dark:text-slate-500 text-xs ml-2">{it.unit}</span></td>
                      {warehouses.map((w) => {
                        const q = getItemStock(it, w.id)
                        return <td key={w.id} className={`px-4 py-2 text-right ${q > 0 ? 'text-gray-800 dark:text-slate-100 font-medium' : 'text-gray-300 dark:text-slate-600'}`}>{q}</td>
                      })}
                      <td className="px-5 py-2 text-right font-bold text-gray-900 dark:text-slate-100">{total}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Recent transfers */}
      {stockTransfers.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700">
            <h3 className="font-semibold text-sm text-gray-700 dark:text-slate-200">Recent Transfers</h3>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-slate-700/50">
            {stockTransfers.slice().reverse().slice(0, 15).map((tr) => (
              <div key={tr.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 dark:text-slate-500 text-xs w-20">{fmtDate(tr.date)}</span>
                  <span className="text-gray-700 dark:text-slate-200 font-medium">{tr.quantity} × {itemName(tr.itemId)}</span>
                  <span className="text-gray-400 dark:text-slate-500 flex items-center gap-1.5 text-xs">{whName(tr.fromWarehouseId)} <ArrowLeftRight size={11} /> {whName(tr.toWarehouseId)}</span>
                </div>
                <button onClick={() => deleteStockTransfer(tr.id)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Warehouse modal */}
      <Modal open={whModal} onClose={() => setWhModal(false)} title={editing ? 'Edit Warehouse' : 'New Warehouse'}>
        <div className="space-y-4">
          <Input label="Warehouse Name *" value={whForm.name} onChange={(e) => setW('name', e.target.value)} placeholder="e.g. North Depot" />
          <Input label="Location / Address" value={whForm.location} onChange={(e) => setW('location', e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={() => setWhModal(false)}>Cancel</Btn>
            <Btn onClick={saveWh}>{editing ? 'Save Changes' : 'Add Warehouse'}</Btn>
          </div>
        </div>
      </Modal>

      {/* Transfer modal */}
      <Modal open={trModal} onClose={() => setTrModal(false)} title="Transfer Stock">
        <div className="space-y-4">
          <Select label="Item" value={trForm.itemId} onChange={(e) => setT('itemId', e.target.value)}>
            {inventoryItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Select label="From" value={trForm.fromWarehouseId} onChange={(e) => setT('fromWarehouseId', e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Select label="To" value={trForm.toWarehouseId} onChange={(e) => setT('toWarehouseId', e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </div>
          {trForm.itemId && trForm.fromWarehouseId && (
            <p className="text-xs text-gray-400 dark:text-slate-500">
              Available in source: {getItemStock(inventoryItems.find((i) => i.id === trForm.itemId), trForm.fromWarehouseId)}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Quantity *" type="number" min="0" step="0.01" value={trForm.quantity} onChange={(e) => setT('quantity', e.target.value)} />
            <Input label="Date" type="date" value={trForm.date} onChange={(e) => setT('date', e.target.value)} />
          </div>
          <Input label="Notes" value={trForm.notes} onChange={(e) => setT('notes', e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={() => setTrModal(false)}>Cancel</Btn>
            <Btn onClick={saveTransfer}>Transfer</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
