import { useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { useAuth } from '../auth'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Check, X, Trash2, ShoppingCart, ClipboardList } from 'lucide-react'

const blankLine = () => ({ id: crypto.randomUUID(), description: '', quantity: 1, estPrice: '' })
const emptyForm = { requestedBy: '', department: '', supplierName: '', date: today(), neededBy: '', notes: '', lines: [blankLine()] }

const STATUS = {
  pending:  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  ordered:  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
}
const TABS = ['all', 'pending', 'approved', 'ordered', 'rejected']

export default function Requisitions() {
  const t = useT()
  const { requisitions, addRequisition, approveRequisition, rejectRequisition, deleteRequisition, convertRequisitionToPO, settings } = useStore()
  const { currentUser, isManager } = useAuth()
  const manager = isManager()
  const me = currentUser()
  const sym = settings.company.currencySymbol

  const [tab, setTab] = useState('all')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setLine = (id, k, v) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.id === id ? { ...l, [k]: v } : l)) }))
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))
  const removeLine = (id) => setForm((f) => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((l) => l.id !== id) : f.lines }))

  const openNew = () => { setForm({ ...emptyForm, requestedBy: me?.name || '', lines: [blankLine()] }); setModal(true) }

  const save = () => {
    const items = form.lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description, quantity: Number(l.quantity) || 0, estPrice: parseFloat(l.estPrice) || 0 }))
    if (items.length === 0) return alert('Add at least one item.')
    const total = items.reduce((s, i) => s + i.quantity * i.estPrice, 0)
    addRequisition({ ...form, items, total })
    setModal(false)
  }

  const convert = (r) => {
    const po = convertRequisitionToPO(r.id)
    if (po) alert(`Created Purchase Order ${po.number} from ${r.number}.`)
  }

  const filtered = requisitions.slice().reverse().filter((r) => tab === 'all' || r.status === tab)
  const pendingCount = requisitions.filter((r) => r.status === 'pending').length

  return (
    <div>
      <PageHeader
        title="Purchase Requisitions"
        subtitle={`${pendingCount} awaiting approval${manager ? '' : ' · approvals need an Admin/Owner'}`}
        action={<Btn onClick={openNew}><Plus size={15} /> {t('New Requisition')}</Btn>}
      />

      <div className="flex gap-2 mb-4 flex-wrap">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-sm capitalize ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300'}`}>
            {t}{t === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        ))}
      </div>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState icon="📝" title="No requisitions" desc="Staff request items they need; an Admin or Owner approves, then it becomes a Purchase Order."
            action={<Btn onClick={openNew}><Plus size={14} /> {t('New Requisition')}</Btn>} />
        ) : (
          <Table headers={['Number', 'Requested By', 'Dept', 'Needed By', { label: 'Est. Total', right: true }, 'Status', { label: 'Actions', right: true }]}>
            {filtered.map((r) => (
              <Tr key={r.id}>
                <Td className="font-mono text-xs">{r.number}</Td>
                <Td className="font-medium text-gray-800 dark:text-slate-100">{r.requestedBy || '—'}</Td>
                <Td className="text-gray-500 dark:text-slate-400">{r.department || '—'}</Td>
                <Td className="text-gray-500 dark:text-slate-400">{r.neededBy ? fmtDate(r.neededBy) : '—'}</Td>
                <Td right className="font-medium">{fmtMoney(r.total || 0, sym)}</Td>
                <Td><Badge className={STATUS[r.status]}>{r.status}</Badge></Td>
                <Td right>
                  <div className="flex justify-end gap-1">
                    {r.status === 'pending' && manager && (
                      <>
                        <Btn size="sm" variant="success" onClick={() => approveRequisition(r.id, me?.name)}><Check size={13} /></Btn>
                        <Btn size="sm" variant="ghost" onClick={() => rejectRequisition(r.id, me?.name, '')}><X size={13} className="text-red-400" /></Btn>
                      </>
                    )}
                    {r.status === 'approved' && <Btn size="sm" onClick={() => convert(r)}><ShoppingCart size={13} /> To PO</Btn>}
                    <Btn size="sm" variant="ghost" onClick={() => { if (confirm('Delete this requisition?')) deleteRequisition(r.id) }}><Trash2 size={13} className="text-red-400" /></Btn>
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="New Purchase Requisition" width="max-w-xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Requested By" value={form.requestedBy} onChange={(e) => setF('requestedBy', e.target.value)} />
            <Input label="Department" value={form.department} onChange={(e) => setF('department', e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Preferred Supplier" value={form.supplierName} onChange={(e) => setF('supplierName', e.target.value)} />
            <Input label="Date" type="date" value={form.date} onChange={(e) => setF('date', e.target.value)} />
            <Input label="Needed By" type="date" value={form.neededBy} onChange={(e) => setF('neededBy', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Items</label>
            <div className="space-y-2">
              {form.lines.map((l) => (
                <div key={l.id} className="flex gap-2">
                  <input className="flex-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-2 py-1.5 text-sm" placeholder="What's needed" value={l.description} onChange={(e) => setLine(l.id, 'description', e.target.value)} />
                  <input className="w-16 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-2 py-1.5 text-sm" type="number" min="0" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(l.id, 'quantity', e.target.value)} />
                  <input className="w-24 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-2 py-1.5 text-sm" type="number" min="0" step="0.01" placeholder="Est. price" value={l.estPrice} onChange={(e) => setLine(l.id, 'estPrice', e.target.value)} />
                  <button onClick={() => removeLine(l.id)} className="text-gray-400 hover:text-red-500 mt-1.5"><X size={15} /></button>
                </div>
              ))}
            </div>
            <button onClick={addLine} className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"><Plus size={13} /> {t('Add item')}</button>
          </div>
          <Textarea label="Justification / Notes" rows={2} value={form.notes} onChange={(e) => setF('notes', e.target.value)} />
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={save}><ClipboardList size={15} /> {t('Submit Requisition')}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
