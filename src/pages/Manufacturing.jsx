import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import { Plus, Trash2, Play, CheckCircle, Factory, ListOrdered, Edit3 } from 'lucide-react'

export default function Manufacturing() {
  const { billsOfMaterials, workOrders, inventoryItems, accounts, settings,
          addBOM, updateBOM, deleteBOM, addWorkOrder, startWorkOrder, completeWorkOrder, deleteWorkOrder } = useStore()
  const sym = settings.company.currencySymbol

  const [tab, setTab] = useState('bom')

  // ── BOM state
  const [bomModal, setBomModal]   = useState(false)
  const [editBOM,  setEditBOM]    = useState(null)
  const [bomForm,  setBomForm]    = useState({ name: '', description: '', outputItemId: '', outputQuantity: 1, components: [] })
  const setBomField = (k, v) => setBomForm((f) => ({ ...f, [k]: v }))

  const emptyComp = () => ({ id: crypto.randomUUID(), name: '', itemId: '', quantity: 1, unitCost: '', materialAccountId: 'acc-rawmat' })
  const addComp = () => setBomForm((f) => ({ ...f, components: [...f.components, emptyComp()] }))
  const updateComp = (idx, field, val) =>
    setBomForm((f) => ({ ...f, components: f.components.map((c, i) => i === idx ? { ...c, [field]: val } : c) }))
  const pickCompItem = (idx, itemId) => {
    const item = inventoryItems.find((i) => i.id === itemId)
    updateComp(idx, 'itemId', itemId)
    if (item) { updateComp(idx, 'name', item.name); updateComp(idx, 'unitCost', item.costPrice || '') }
  }
  const removeComp = (idx) => setBomForm((f) => ({ ...f, components: f.components.filter((_, i) => i !== idx) }))

  const bomTotalCost = (bom) =>
    (bom.components || []).reduce((s, c) => s + (parseFloat(c.quantity) || 0) * (parseFloat(c.unitCost) || 0), 0)

  const openBomEdit = (bom) => {
    setEditBOM(bom)
    setBomForm({ name: bom.name, description: bom.description || '', outputItemId: bom.outputItemId || '', outputQuantity: bom.outputQuantity || 1, components: bom.components || [] })
    setBomModal(true)
  }

  const handleSaveBOM = () => {
    if (!bomForm.name.trim())            return alert('BOM name is required.')
    if (bomForm.components.length === 0) return alert('Add at least one component.')
    if (editBOM) {
      updateBOM(editBOM.id, { ...bomForm })
    } else {
      addBOM(bomForm)
    }
    setBomModal(false)
    setEditBOM(null)
    setBomForm({ name: '', description: '', outputItemId: '', outputQuantity: 1, components: [] })
  }

  // ── Work Order state
  const [woModal,  setWoModal]  = useState(false)
  const [completeModal, setCompleteModal] = useState(null)
  const [completeDate,  setCompleteDate]  = useState(today())

  const emptyWO = () => ({
    bomId: '', outputName: '', outputItemId: '', outputQuantity: 1,
    targetQuantity: 1, components: [], wipAccountId: 'acc-wip', finGoodsAccountId: 'acc-fingoods',
    scheduledDate: today(), notes: '',
  })
  const [woForm, setWoForm] = useState(emptyWO())
  const setWoField = (k, v) => setWoForm((f) => ({ ...f, [k]: v }))

  const pickBOM = (bomId) => {
    const bom = billsOfMaterials.find((b) => b.id === bomId)
    if (!bom) { setWoField('bomId', ''); return }
    const outputItem = inventoryItems.find((i) => i.id === bom.outputItemId)
    setWoForm((f) => ({
      ...f, bomId, outputName: bom.name,
      outputItemId: bom.outputItemId || '',
      outputQuantity: bom.outputQuantity || 1,
      components: bom.components || [],
    }))
  }

  const handleSaveWO = () => {
    if (!woForm.outputName.trim())              return alert('Production item name is required.')
    if (!woForm.targetQuantity || woForm.targetQuantity <= 0) return alert('Enter a valid production quantity.')
    addWorkOrder(woForm)
    setWoModal(false)
    setWoForm(emptyWO())
  }

  const woSorted   = [...workOrders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const bomSorted  = [...billsOfMaterials].sort((a, b) => a.name.localeCompare(b.name))

  const STATUS_CLR = { draft: 'bg-gray-100 text-gray-600', in_progress: 'bg-amber-100 text-amber-700', completed: 'bg-green-100 text-green-700' }
  const activeWOs    = workOrders.filter((w) => w.status === 'in_progress').length
  const completedWOs = workOrders.filter((w) => w.status === 'completed').length
  const totalOutput  = workOrders.filter((w) => w.status === 'completed').reduce((s, w) => s + w.actualCost, 0)

  return (
    <div>
      <PageHeader
        title="Manufacturing"
        subtitle="Bills of Materials and Work Orders for production tracking"
        action={
          tab === 'bom'
            ? <Btn onClick={() => { setEditBOM(null); setBomForm({ name: '', description: '', outputItemId: '', outputQuantity: 1, components: [] }); setBomModal(true) }}><Plus size={15} /> New BOM</Btn>
            : <Btn onClick={() => { setWoForm(emptyWO()); setWoModal(true) }}><Plus size={15} /> New Work Order</Btn>
        }
      />

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Bills of Materials" value={billsOfMaterials.length} color="blue"   icon={<ListOrdered size={18} />} sub="production recipes" />
        <StatCard label="Active Work Orders"  value={activeWOs}               color="amber"  icon={<Factory size={18} />}    sub="in production" />
        <StatCard label="Completed Orders"    value={completedWOs}            color="green"  icon={<CheckCircle size={18} />} sub={`${fmtMoney(totalOutput, sym)} total cost`} />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('bom')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'bom' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
          Bills of Materials ({billsOfMaterials.length})
        </button>
        <button onClick={() => setTab('wo')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'wo' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
          Work Orders ({workOrders.length})
        </button>
      </div>

      {/* BOM Tab */}
      {tab === 'bom' && (
        <Card>
          {billsOfMaterials.length === 0 ? (
            <EmptyState icon="📐" title="No Bills of Materials" desc="Define the raw materials and components needed to produce each finished product."
              action={<Btn onClick={() => { setEditBOM(null); setBomForm({ name: '', description: '', outputItemId: '', outputQuantity: 1, components: [] }); setBomModal(true) }}><Plus size={14} /> New BOM</Btn>} />
          ) : (
            <Table headers={['Product Name', 'Description', 'Output Qty', 'Components', { label: 'Material Cost / Run', right: true }, { label: '', right: true }]}>
              {bomSorted.map((bom) => (
                <Tr key={bom.id}>
                  <Td className="font-medium text-gray-800">{bom.name}</Td>
                  <Td className="text-gray-500 text-sm truncate max-w-[150px]">{bom.description || '—'}</Td>
                  <Td className="text-gray-600 text-sm">{bom.outputQuantity} unit{bom.outputQuantity !== 1 ? 's' : ''}</Td>
                  <Td>
                    <div className="space-y-0.5">
                      {(bom.components || []).slice(0, 3).map((c, i) => (
                        <p key={i} className="text-xs text-gray-500">{c.name || 'Item'} × {c.quantity}</p>
                      ))}
                      {(bom.components || []).length > 3 && (
                        <p className="text-xs text-gray-400">+{bom.components.length - 3} more</p>
                      )}
                    </div>
                  </Td>
                  <Td right className="font-medium text-gray-700">{fmtMoney(bomTotalCost(bom), sym)}</Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      <Btn size="sm" variant="ghost" onClick={() => openBomEdit(bom)}><Edit3 size={13} /></Btn>
                      <Btn size="sm" variant="ghost" onClick={() => { if (confirm(`Delete BOM "${bom.name}"?`)) deleteBOM(bom.id) }}>
                        <Trash2 size={13} className="text-red-400" />
                      </Btn>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* Work Orders Tab */}
      {tab === 'wo' && (
        <Card>
          {workOrders.length === 0 ? (
            <EmptyState icon="🏭" title="No Work Orders" desc="Create work orders to produce goods. On completion, raw material costs are transferred to Finished Goods automatically."
              action={<Btn onClick={() => { setWoForm(emptyWO()); setWoModal(true) }}><Plus size={14} /> New Work Order</Btn>} />
          ) : (
            <Table headers={['Number', 'Product', 'Qty', 'Scheduled', { label: 'Material Cost', right: true }, 'Status', { label: 'Actions', right: true }]}>
              {woSorted.map((wo) => (
                <Tr key={wo.id}>
                  <Td><span className="font-mono text-xs text-gray-500">{wo.number}</span></Td>
                  <Td>
                    <p className="font-medium text-gray-800">{wo.outputName}</p>
                    {wo.notes && <p className="text-xs text-gray-400 truncate max-w-[120px]">{wo.notes}</p>}
                  </Td>
                  <Td className="text-gray-600 text-sm">{wo.targetQuantity}</Td>
                  <Td className="text-gray-500 text-sm">{wo.scheduledDate ? fmtDate(wo.scheduledDate) : '—'}</Td>
                  <Td right className="text-gray-700">
                    {wo.status === 'completed'
                      ? fmtMoney(wo.actualCost || 0, sym)
                      : fmtMoney((wo.components || []).reduce((s, c) => s + (c.quantity || 0) * (c.unitCost || 0), 0) * (wo.targetQuantity || 1), sym)
                    }
                  </Td>
                  <Td><Badge className={STATUS_CLR[wo.status] || 'bg-gray-100 text-gray-500'}>{wo.status.replace('_', ' ')}</Badge></Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      {wo.status === 'draft' && (
                        <Btn size="sm" variant="secondary" onClick={() => startWorkOrder(wo.id)}>
                          <Play size={12} /> Start
                        </Btn>
                      )}
                      {wo.status === 'in_progress' && (
                        <Btn size="sm" variant="secondary"
                          onClick={() => { setCompleteModal(wo); setCompleteDate(today()) }}>
                          <CheckCircle size={12} /> Complete
                        </Btn>
                      )}
                      {wo.status !== 'completed' && (
                        <Btn size="sm" variant="ghost" onClick={() => { if (confirm(`Delete work order ${wo.number}?`)) deleteWorkOrder(wo.id) }}>
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
      )}

      {/* BOM Modal */}
      <Modal open={bomModal} onClose={() => setBomModal(false)} title={editBOM ? `Edit BOM – ${editBOM.name}` : 'New Bill of Materials'} width="max-w-2xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Product Name *" value={bomForm.name} onChange={(e) => setBomField('name', e.target.value)} placeholder="e.g. Dining Chair – Oak" />
            <div className="grid grid-cols-2 gap-2">
              <Select label="Output Item" value={bomForm.outputItemId} onChange={(e) => setBomField('outputItemId', e.target.value)}>
                <option value="">— Select inventory item —</option>
                {inventoryItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
              <Input label="Output Qty" type="number" min="1" value={bomForm.outputQuantity} onChange={(e) => setBomField('outputQuantity', parseFloat(e.target.value) || 1)} />
            </div>
          </div>
          <Textarea label="Description" value={bomForm.description} onChange={(e) => setBomField('description', e.target.value)} rows={1} placeholder="Version, notes..." />

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Components / Raw Materials</label>
              <Btn size="sm" variant="secondary" onClick={addComp}><Plus size={13} /> Add Component</Btn>
            </div>
            {bomForm.components.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">No components yet — click Add Component</p>
            ) : (
              <div className="space-y-2">
                {bomForm.components.map((comp, idx) => (
                  <div key={comp.id} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-4">
                      <Select label={idx === 0 ? 'Inventory Item' : ''} value={comp.itemId} onChange={(e) => pickCompItem(idx, e.target.value)}>
                        <option value="">— Select or type name —</option>
                        {inventoryItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </Select>
                    </div>
                    {!comp.itemId && (
                      <div className="col-span-3">
                        <Input label={idx === 0 ? 'Name' : ''} value={comp.name} onChange={(e) => updateComp(idx, 'name', e.target.value)} placeholder="Material name" />
                      </div>
                    )}
                    <div className={`${comp.itemId ? 'col-span-2' : 'col-span-2'}`}>
                      <Input label={idx === 0 ? 'Qty' : ''} type="number" min="0" step="any" value={comp.quantity} onChange={(e) => updateComp(idx, 'quantity', e.target.value)} />
                    </div>
                    <div className="col-span-2">
                      <Input label={idx === 0 ? `Unit Cost (${sym})` : ''} type="number" min="0" step="0.01" value={comp.unitCost} onChange={(e) => updateComp(idx, 'unitCost', e.target.value)} />
                    </div>
                    <div className="col-span-2 pb-1">
                      <p className="text-sm font-medium text-right text-gray-700">
                        {sym}{((parseFloat(comp.quantity) || 0) * (parseFloat(comp.unitCost) || 0)).toFixed(2)}
                      </p>
                    </div>
                    <div className="col-span-1 pb-1">
                      <button onClick={() => removeComp(idx)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-end pt-1 border-t border-gray-100">
                  <p className="text-sm font-semibold text-gray-800">
                    Total per run: {fmtMoney(bomTotalCost(bomForm), sym)}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setBomModal(false)}>Cancel</Btn>
            <Btn onClick={handleSaveBOM}>{editBOM ? 'Update BOM' : 'Save BOM'}</Btn>
          </div>
        </div>
      </Modal>

      {/* Work Order Modal */}
      <Modal open={woModal} onClose={() => setWoModal(false)} title="New Work Order" width="max-w-lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select label="From BOM" value={woForm.bomId} onChange={(e) => pickBOM(e.target.value)}>
              <option value="">— Select BOM or enter manually —</option>
              {billsOfMaterials.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            {!woForm.bomId && (
              <Input label="Product Name *" value={woForm.outputName} onChange={(e) => setWoField('outputName', e.target.value)} placeholder="What are you producing?" />
            )}
            {woForm.bomId && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
                <p className="py-2 px-3 text-sm text-gray-800 border border-gray-200 rounded-lg bg-gray-50">{woForm.outputName}</p>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Production Quantity *" type="number" min="1" step="1" value={woForm.targetQuantity} onChange={(e) => setWoField('targetQuantity', parseFloat(e.target.value) || 1)} />
            <Input label="Scheduled Date" type="date" value={woForm.scheduledDate} onChange={(e) => setWoField('scheduledDate', e.target.value)} />
          </div>

          {woForm.components.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <p className="font-medium text-gray-700 mb-2">Materials required (× {woForm.targetQuantity} run{woForm.targetQuantity > 1 ? 's' : ''})</p>
              {woForm.components.map((c, i) => (
                <div key={i} className="flex justify-between text-gray-600 text-xs mb-1">
                  <span>{c.name} × {(c.quantity || 0) * woForm.targetQuantity}</span>
                  <span>{fmtMoney((c.quantity || 0) * (c.unitCost || 0) * woForm.targetQuantity, sym)}</span>
                </div>
              ))}
              <div className="border-t border-gray-200 mt-1.5 pt-1.5 flex justify-between font-semibold text-gray-800">
                <span>Est. Total Cost</span>
                <span>{fmtMoney(woForm.components.reduce((s, c) => s + (c.quantity || 0) * (c.unitCost || 0), 0) * woForm.targetQuantity, sym)}</span>
              </div>
            </div>
          )}

          <Textarea label="Notes" value={woForm.notes} onChange={(e) => setWoField('notes', e.target.value)} rows={2} placeholder="Production run notes..." />
          <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
            On complete: Dr WIP ← Cr Raw Materials → Dr Finished Goods ← Cr WIP
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setWoModal(false)}>Cancel</Btn>
            <Btn onClick={handleSaveWO}>Create Work Order</Btn>
          </div>
        </div>
      </Modal>

      {/* Complete Work Order Modal */}
      <Modal open={!!completeModal} onClose={() => setCompleteModal(null)} title={`Complete Work Order – ${completeModal?.number}`}>
        <div className="space-y-4">
          <div className="bg-green-50 rounded-lg p-3 text-sm text-green-700">
            <p>Product: <strong>{completeModal?.outputName}</strong></p>
            <p>Quantity: <strong>{completeModal?.targetQuantity}</strong></p>
            <p className="text-xs mt-1 text-green-600">This will post journal entries transferring materials through WIP to Finished Goods.</p>
          </div>
          <Input label="Completion Date" type="date" value={completeDate} onChange={(e) => setCompleteDate(e.target.value)} />
          {completeModal && (
            <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1">
              <p className="font-medium text-gray-700">Journal Entries:</p>
              <p>1. Dr Work-in-Progress → Cr Raw Materials ({fmtMoney((completeModal.components || []).reduce((s, c) => s + (c.quantity || 0) * (c.unitCost || 0), 0) * completeModal.targetQuantity, sym)})</p>
              <p>2. Dr Finished Goods → Cr Work-in-Progress (same amount)</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setCompleteModal(null)}>Cancel</Btn>
            <Btn onClick={() => { completeWorkOrder(completeModal.id, completeDate); setCompleteModal(null) }}>Complete & Post JE</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
