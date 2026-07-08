import { useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { useAuth } from '../auth'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import { Plus, Trash2, TrendingUp, TrendingDown, Check, X, ShieldCheck, Clock } from 'lucide-react'

const emptyForm = () => ({
  date: today(), type: 'increase', itemId: '', itemName: '', quantity: '', unitCost: '', reason: '', inventoryAccountId: 'acc-inv',
})

const stat = (adj) => adj.status || 'approved' // legacy rows are already posted

export default function StockAdjustments() {
  const t = useT()
  const { stockAdjustments, inventoryItems, settings, addStockAdjustment, approveStockAdjustment, rejectStockAdjustment, deleteStockAdjustment } = useStore()
  const sym = settings.company.currencySymbol
  const me = useAuth((s) => s.currentUser())
  const users = useAuth((s) => s.users)
  const isManager = useAuth((s) => s.isManager())

  const managers = users.filter((u) => ['owner', 'admin'].includes(u.role))
  const otherManagerExists = managers.some((u) => u.id !== me?.id)

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
    addStockAdjustment({ ...form, quantity, unitCost, totalAmount, createdBy: me?.id || null, createdByName: me?.name || '' })
    setModal(false)
    setForm(emptyForm())
  }

  // Can the current user approve this pending adjustment? (Segregation of duties)
  const canApprove = (adj) => isManager && (adj.createdBy !== me?.id || !otherManagerExists)

  const handleApprove = (adj) => {
    if (!canApprove(adj)) return alert('Segregation of duties: a different manager must approve this adjustment.')
    if (confirm(`Approve adjustment ${adj.number}? This posts the journal entry and updates stock.`)) approveStockAdjustment(adj.id, me)
  }
  const handleReject = (adj) => {
    const reason = prompt('Reason for rejection (optional):') ?? ''
    rejectStockAdjustment(adj.id, me, reason)
  }

  const sorted = [...stockAdjustments].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const posted = stockAdjustments.filter((a) => stat(a) === 'approved')
  const totalIncrease = posted.filter((a) => a.type === 'increase').reduce((s, a) => s + a.totalAmount, 0)
  const totalDecrease = posted.filter((a) => a.type === 'decrease').reduce((s, a) => s + a.totalAmount, 0)
  const pendingCount = stockAdjustments.filter((a) => stat(a) === 'pending').length

  return (
    <div>
      <PageHeader
        title="Stock Adjustments"
        subtitle="Record inventory increases, decreases, and write-offs — approved by a second manager"
        action={<Btn onClick={() => setModal(true)}><Plus size={15} /> {t('New Adjustment')}</Btn>}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Increases"  value={fmtMoney(totalIncrease, sym)} color="green"  icon={<TrendingUp size={18} />}   sub={t('approved only')} />
        <StatCard label="Total Decreases"  value={fmtMoney(totalDecrease, sym)} color="red"    icon={<TrendingDown size={18} />}  sub={t('approved only')} />
        <StatCard label="Pending Approval" value={pendingCount}                 color={pendingCount ? 'orange' : 'blue'} icon={<Clock size={18} />} sub={t('awaiting a second manager')} />
      </div>

      <Card>
        {stockAdjustments.length === 0 ? (
          <EmptyState icon="📊" title="No stock adjustments" desc="Record stock counts, damaged goods write-offs, or inventory corrections. Each adjustment posts a journal entry once approved."
            action={<Btn onClick={() => setModal(true)}><Plus size={14} /> {t('New Adjustment')}</Btn>} />
        ) : (
          <Table headers={['Number', 'Date', 'Item', 'Type', { label: 'Qty', right: true }, { label: 'Total', right: true }, 'Status', { label: 'Actions', right: true }]}>
            {sorted.map((adj) => {
              const st = stat(adj)
              return (
              <Tr key={adj.id}>
                <Td><span className="font-mono text-xs text-gray-500">{adj.number}</span></Td>
                <Td className="text-gray-500 text-sm">{fmtDate(adj.date)}</Td>
                <Td className="font-medium text-gray-800 dark:text-slate-100">{adj.itemName || '—'}
                  {adj.createdByName && <span className="block text-[11px] text-gray-400">{t('by')} {adj.createdByName}</span>}
                </Td>
                <Td>
                  {adj.type === 'increase'
                    ? <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 inline-flex items-center gap-1"><TrendingUp size={10} /> Increase</Badge>
                    : <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 inline-flex items-center gap-1"><TrendingDown size={10} /> Decrease</Badge>}
                </Td>
                <Td right className="text-gray-700 dark:text-slate-200">{adj.quantity}</Td>
                <Td right>
                  <span className={`font-semibold ${adj.type === 'increase' ? 'text-green-600' : 'text-red-600'}`}>
                    {adj.type === 'increase' ? '+' : '-'}{fmtMoney(adj.totalAmount, sym)}
                  </span>
                </Td>
                <Td>
                  {st === 'approved' && <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 inline-flex items-center gap-1"><ShieldCheck size={10} /> {t('Approved')}{adj.approvedByName ? ` · ${adj.approvedByName}` : ''}</Badge>}
                  {st === 'pending'  && <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 inline-flex items-center gap-1"><Clock size={10} /> {t('Pending')}</Badge>}
                  {st === 'rejected' && <Badge className="bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400">{t('Rejected')}</Badge>}
                </Td>
                <Td right>
                  <div className="flex items-center justify-end gap-1">
                    <AttachmentButton entityType="stockadj" entityId={adj.id} />
                    {st === 'pending' && (
                      <>
                        <Btn size="sm" variant={canApprove(adj) ? 'success' : 'ghost'} onClick={() => handleApprove(adj)}
                          title={canApprove(adj) ? t('Approve') : t('A different manager must approve (segregation of duties)')} disabled={!canApprove(adj)}>
                          <Check size={13} />
                        </Btn>
                        {isManager && <Btn size="sm" variant="ghost" onClick={() => handleReject(adj)} title={t('Reject')}><X size={13} className="text-amber-500" /></Btn>}
                      </>
                    )}
                    <Btn size="sm" variant="ghost" onClick={() => { if (confirm(`Delete adjustment ${adj.number}?${st === 'approved' ? ' This will reverse the quantity change.' : ''}`)) deleteStockAdjustment(adj.id) }}>
                      <Trash2 size={13} className="text-red-400" />
                    </Btn>
                  </div>
                </Td>
              </Tr>
            )})}
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
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('Total Amount')}</label>
              <p className="py-2 px-3 text-sm font-semibold text-gray-800 dark:text-slate-100 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700/40">{sym}{totalAmount.toFixed(2)}</p>
            </div>
          </div>

          <Textarea label="Reason / Notes" value={form.reason} onChange={(e) => setField('reason', e.target.value)} rows={2} placeholder="e.g. Stock count discrepancy, damaged goods, found items" />

          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
            <ShieldCheck size={14} className="flex-shrink-0 mt-0.5" />
            <span>{t('Saved as Pending. Stock and the ledger only change once a different manager approves it.')}</span>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={handleSave}>{t('Submit for Approval')}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
