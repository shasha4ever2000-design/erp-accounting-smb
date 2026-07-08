import { useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Btn, Modal, Input, Select, Textarea } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import { Plus, Pencil, Trash2, UserPlus, ChevronLeft, ChevronRight, Phone, Mail } from 'lucide-react'

const STAGES = [
  { id: 'new',       label: 'New Lead',   color: 'border-t-slate-400' },
  { id: 'contacted', label: 'Contacted',  color: 'border-t-blue-400' },
  { id: 'proposal',  label: 'Proposal',   color: 'border-t-amber-400' },
  { id: 'won',       label: 'Won',        color: 'border-t-green-500' },
  { id: 'lost',      label: 'Lost',       color: 'border-t-red-400' },
]
const ORDER = STAGES.map((s) => s.id)
const empty = { name: '', company: '', email: '', phone: '', value: '', source: '', stage: 'new', expectedClose: today(), notes: '' }

export default function Pipeline() {
  const t = useT()
  const { leads, addLead, updateLead, deleteLead, convertLeadToCustomer, settings } = useStore()
  const sym = settings.company.currencySymbol

  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(empty)
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openNew = () => { setEditing(null); setForm(empty); setModal(true) }
  const openEdit = (l) => { setEditing(l); setForm({ ...empty, ...l, value: l.value || '' }); setModal(true) }

  const save = () => {
    if (!form.name.trim()) return alert('Lead name is required.')
    const data = { ...form, value: parseFloat(form.value) || 0 }
    if (editing) updateLead(editing.id, data)
    else addLead(data)
    setModal(false)
  }

  const move = (lead, dir) => {
    const idx = ORDER.indexOf(lead.stage)
    const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, idx + dir))]
    updateLead(lead.id, { stage: next })
  }

  const convert = (lead) => {
    if (confirm(`Convert "${lead.name}" to a customer?`)) {
      convertLeadToCustomer(lead.id)
      alert('Lead converted to a customer (Sales → Customers).')
    }
  }

  const openValue = leads.filter((l) => !['won', 'lost'].includes(l.stage)).reduce((s, l) => s + (l.value || 0), 0)
  const wonValue = leads.filter((l) => l.stage === 'won').reduce((s, l) => s + (l.value || 0), 0)

  return (
    <div>
      <PageHeader
        title="Sales Pipeline · CRM"
        subtitle={`${leads.filter((l) => !['won','lost'].includes(l.stage)).length} ${t('open')} · ${fmtMoney(openValue, sym)} ${t('weighted')} · ${fmtMoney(wonValue, sym)} ${t('won')}`}
        action={<Btn onClick={openNew}><Plus size={15} /> {t('New Lead')}</Btn>}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {STAGES.map((stage) => {
          const items = leads.filter((l) => l.stage === stage.id)
          const total = items.reduce((s, l) => s + (l.value || 0), 0)
          return (
            <div key={stage.id} className={`bg-gray-50 dark:bg-slate-800/50 rounded-xl border-t-4 ${stage.color} p-3`}>
              <div className="flex items-center justify-between mb-3 px-1">
                <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">{t(stage.label)}</p>
                <span className="text-xs text-gray-400 dark:text-slate-500">{items.length}</span>
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 px-1 mb-2">{fmtMoney(total, sym)}</p>
              <div className="space-y-2 min-h-[40px]">
                {items.map((l) => (
                  <div key={l.id} className="bg-white dark:bg-slate-800 rounded-lg border border-gray-100 dark:border-slate-700 p-3 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800 dark:text-slate-100 text-sm truncate">{l.name}</p>
                        {l.company && <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{l.company}</p>}
                      </div>
                      <span className="text-xs font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">{fmtMoney(l.value || 0, sym)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-gray-400 dark:text-slate-500">
                      {l.phone && <Phone size={11} />}
                      {l.email && <Mail size={11} />}
                      {l.expectedClose && <span className="text-[10px]">{fmtDate(l.expectedClose)}</span>}
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50 dark:border-slate-700/50">
                      <div className="flex gap-1">
                        <button onClick={() => move(l, -1)} disabled={l.stage === 'new'} className="text-gray-400 hover:text-blue-600 disabled:opacity-30"><ChevronLeft size={14} /></button>
                        <button onClick={() => move(l, 1)} disabled={l.stage === 'lost'} className="text-gray-400 hover:text-blue-600 disabled:opacity-30"><ChevronRight size={14} /></button>
                      </div>
                      <div className="flex gap-1 items-center">
                        <AttachmentButton entityType="lead" entityId={l.id} />
                        {l.stage !== 'won' && <button onClick={() => convert(l)} title="Convert to customer" className="text-gray-400 hover:text-green-600"><UserPlus size={13} /></button>}
                        <button onClick={() => openEdit(l)} className="text-gray-400 hover:text-blue-600"><Pencil size={12} /></button>
                        <button onClick={() => { if (confirm('Delete this lead?')) deleteLead(l.id) }} className="text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  </div>
                ))}
                {items.length === 0 && <p className="text-xs text-gray-300 dark:text-slate-600 text-center py-3">—</p>}
              </div>
            </div>
          )
        })}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Lead' : 'New Lead'} width="max-w-lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Contact Name *" value={form.name} onChange={(e) => setF('name', e.target.value)} />
            <Input label="Company" value={form.company} onChange={(e) => setF('company', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Email" type="email" value={form.email} onChange={(e) => setF('email', e.target.value)} />
            <Input label="Phone" value={form.phone} onChange={(e) => setF('phone', e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label={`Deal Value (${sym})`} type="number" min="0" value={form.value} onChange={(e) => setF('value', e.target.value)} />
            <Input label="Source" value={form.source} onChange={(e) => setF('source', e.target.value)} placeholder="Referral, web…" />
            <Select label="Stage" value={form.stage} onChange={(e) => setF('stage', e.target.value)}>
              {STAGES.map((s) => <option key={s.id} value={s.id}>{t(s.label)}</option>)}
            </Select>
          </div>
          <Input label="Expected Close" type="date" value={form.expectedClose} onChange={(e) => setF('expectedClose', e.target.value)} />
          <Textarea label="Notes" rows={2} value={form.notes} onChange={(e) => setF('notes', e.target.value)} />
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={save}>{editing ? 'Save Changes' : 'Add Lead'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
