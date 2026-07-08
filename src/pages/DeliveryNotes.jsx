import { useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import { Plus, Trash2, Truck, Printer, X, ArrowLeft, Check } from 'lucide-react'

const blankLine = () => ({ id: crypto.randomUUID(), description: '', quantity: 1 })
const emptyForm = { customerId: '', customerName: '', date: today(), reference: '', address: '', notes: '', lines: [blankLine()] }

const STATUS = {
  pending:   'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  delivered: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

export default function DeliveryNotes() {
  const t = useT()
  const { deliveryNotes, customers, settings, addDeliveryNote, updateDeliveryNote, deleteDeliveryNote } = useStore()
  const company = settings.company

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [viewing, setViewing] = useState(null)
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setLine = (id, k, v) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.id === id ? { ...l, [k]: v } : l)) }))
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))
  const removeLine = (id) => setForm((f) => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((l) => l.id !== id) : f.lines }))

  const openNew = () => { setForm(emptyForm); setModal(true) }

  const save = () => {
    const items = form.lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description, quantity: Number(l.quantity) || 0 }))
    if (items.length === 0) return alert('Add at least one item.')
    const customer = customers.find((c) => c.id === form.customerId)
    addDeliveryNote({
      customerId: form.customerId || null,
      customerName: customer?.name || form.customerName || 'Customer',
      date: form.date, reference: form.reference,
      address: form.address || customer?.address || '',
      notes: form.notes, items,
    })
    setModal(false)
  }

  if (viewing) {
    const dn = deliveryNotes.find((d) => d.id === viewing)
    if (!dn) { setViewing(null); return null }
    return (
      <div>
        <div className="flex items-center justify-between mb-6 no-print">
          <button onClick={() => setViewing(null)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 dark:text-slate-400"><ArrowLeft size={15} /> {t('Back')}</button>
          <div className="flex items-center gap-2">
            <AttachmentButton entityType="deliverynote" entityId={dn.id} />
            {dn.status !== 'delivered' && <Btn size="sm" variant="success" onClick={() => updateDeliveryNote(dn.id, { status: 'delivered' })}><Check size={14} /> {t('Mark Delivered')}</Btn>}
            <Btn size="sm" variant="secondary" onClick={() => window.print()}><Printer size={14} /> {t('Download PDF')}</Btn>
          </div>
        </div>
        <div className="max-w-3xl mx-auto">
          <Card className="p-8 print:shadow-none">
            <div className="flex justify-between items-start mb-8">
              <div className="flex items-center gap-3">
                {company.logo && <img src={company.logo} alt="logo" className="h-12 w-auto object-contain" />}
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{company.name}</h1>
                  {company.arabicName && <p className="text-lg font-bold text-gray-700 dark:text-slate-200" dir="rtl">{company.arabicName}</p>}
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black" style={{ color: company.accentColor || '#2563eb' }}>{t('DELIVERY NOTE')}</p>
                <p className="text-sm font-semibold text-gray-600 dark:text-slate-300" dir="rtl">سند تسليم</p>
                <p className="text-lg font-bold text-gray-800 dark:text-slate-100 mt-1">{dn.number}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-8 mb-8">
              <div>
                <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase mb-1">{t('Deliver To')}</p>
                <p className="font-semibold text-gray-800 dark:text-slate-100">{dn.customerName}</p>
                {dn.address && <p className="text-sm text-gray-500 dark:text-slate-400 whitespace-pre-line">{dn.address}</p>}
              </div>
              <div className="text-right space-y-1">
                <p className="text-xs text-gray-400">Date</p><p className="font-medium text-gray-800 dark:text-slate-100">{fmtDate(dn.date)}</p>
                {dn.reference && <><p className="text-xs text-gray-400 mt-2">{t('Reference')}</p><p className="font-medium text-gray-800 dark:text-slate-100">{dn.reference}</p></>}
              </div>
            </div>
            <table className="w-full text-sm mb-6">
              <thead><tr className="border-b-2 border-gray-200 dark:border-slate-600 text-xs text-gray-500 dark:text-slate-400 uppercase">
                <th className="text-left py-2">#</th><th className="text-left py-2">Description · الوصف</th><th className="text-right py-2">Qty · الكمية</th>
              </tr></thead>
              <tbody>
                {dn.items.map((it, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-slate-700/50">
                    <td className="py-3 text-gray-400">{i + 1}</td>
                    <td className="py-3 text-gray-700 dark:text-slate-200">{it.description}</td>
                    <td className="py-3 text-right font-medium text-gray-800 dark:text-slate-100">{it.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dn.notes && <p className="text-sm text-gray-600 dark:text-slate-300 border-t border-gray-100 dark:border-slate-700 pt-4">{dn.notes}</p>}
            <div className="grid grid-cols-2 gap-8 mt-12 text-sm">
              <div className="border-t border-gray-300 dark:border-slate-600 pt-2 text-gray-500 dark:text-slate-400">Received by · المستلم</div>
              <div className="border-t border-gray-300 dark:border-slate-600 pt-2 text-gray-500 dark:text-slate-400 text-right">Authorized signature · التوقيع</div>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Delivery Notes"
        subtitle="Bilingual delivery / dispatch notes (سند تسليم)"
        action={<Btn onClick={openNew}><Plus size={15} /> {t('New Delivery Note')}</Btn>}
      />
      <Card>
        {deliveryNotes.length === 0 ? (
          <EmptyState icon="🚚" title="No delivery notes" desc="Create a delivery note to accompany goods you dispatch to customers."
            action={<Btn onClick={openNew}><Plus size={14} /> {t('New Delivery Note')}</Btn>} />
        ) : (
          <Table headers={['Number', 'Customer', 'Date', 'Items', 'Reference', 'Status', { label: 'Actions', right: true }]}>
            {deliveryNotes.slice().reverse().map((dn) => (
              <Tr key={dn.id} onClick={() => setViewing(dn.id)}>
                <Td className="font-mono text-xs">{dn.number}</Td>
                <Td className="font-medium text-gray-800 dark:text-slate-100">{dn.customerName}</Td>
                <Td className="text-gray-500 dark:text-slate-400">{fmtDate(dn.date)}</Td>
                <Td>{dn.items.length}</Td>
                <Td className="text-gray-400 dark:text-slate-500">{dn.reference || '—'}</Td>
                <Td><Badge className={STATUS[dn.status] || STATUS.pending}>{dn.status}</Badge></Td>
                <Td right>
                  <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete this delivery note?')) deleteDeliveryNote(dn.id) }} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="New Delivery Note" width="max-w-xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Customer" value={form.customerId} onChange={(e) => setF('customerId', e.target.value)}>
              <option value="">— Select / walk-in —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Input label="Date" type="date" value={form.date} onChange={(e) => setF('date', e.target.value)} />
          </div>
          <Input label="Reference (PO / Invoice no.)" value={form.reference} onChange={(e) => setF('reference', e.target.value)} />
          <Textarea label="Delivery Address" rows={2} value={form.address} onChange={(e) => setF('address', e.target.value)} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Items</label>
            <div className="space-y-2">
              {form.lines.map((l) => (
                <div key={l.id} className="flex gap-2">
                  <input className="flex-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-2 py-1.5 text-sm" placeholder="Item description"
                    value={l.description} onChange={(e) => setLine(l.id, 'description', e.target.value)} />
                  <input className="w-20 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-2 py-1.5 text-sm" type="number" min="0" placeholder="Qty"
                    value={l.quantity} onChange={(e) => setLine(l.id, 'quantity', e.target.value)} />
                  <button onClick={() => removeLine(l.id)} className="text-gray-400 hover:text-red-500 mt-1.5"><X size={15} /></button>
                </div>
              ))}
            </div>
            <button onClick={addLine} className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"><Plus size={13} /> {t('Add item')}</button>
          </div>
          <Textarea label="Notes" rows={2} value={form.notes} onChange={(e) => setF('notes', e.target.value)} />
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={save}><Truck size={15} /> {t('Create')}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
