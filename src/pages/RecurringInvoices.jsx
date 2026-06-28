import { useState, useEffect } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Trash2, RefreshCw, Pause, Play, Repeat, X } from 'lucide-react'

const FREQ = { weekly: 'Weekly', biweekly: 'Bi-weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' }

const blankLine = () => ({ id: crypto.randomUUID(), description: '', quantity: 1, price: '', accountId: '' })

export default function RecurringInvoices() {
  const t = useT()
  const {
    recurringInvoices, customers, accounts, settings,
    addRecurringInvoice, updateRecurringInvoice, deleteRecurringInvoice, generateDueRecurring,
  } = useStore()
  const sym = settings.company.currencySymbol
  const revenueAccs = accounts.filter((a) => a.type === 'revenue')

  const [modal, setModal] = useState(false)
  const [toast, setToast] = useState('')
  const [form, setForm] = useState({
    customerId: '', frequency: 'monthly', nextDate: today(), endDate: '', notes: '',
    lines: [blankLine()],
  })

  // Auto-generate any due invoices when the page opens
  useEffect(() => {
    const n = generateDueRecurring()
    if (n > 0) { setToast(`${n} invoice${n > 1 ? 's' : ''} generated from active subscriptions`); setTimeout(() => setToast(''), 4000) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setLine = (id, k, v) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.id === id ? { ...l, [k]: v } : l)) }))
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))
  const removeLine = (id) => setForm((f) => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((l) => l.id !== id) : f.lines }))

  const calc = (lines) => {
    const items = lines.map((l) => {
      const qty = parseFloat(l.quantity) || 0
      const price = parseFloat(l.price) || 0
      const subtotal = qty * price
      return { description: l.description, quantity: qty, price, subtotal, accountId: l.accountId || revenueAccs[0]?.id || 'acc-sales' }
    })
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0)
    const taxAmount = settings.tax.enabled ? subtotal * (settings.tax.rate / 100) : 0
    return { items, subtotal, taxAmount, total: subtotal + taxAmount }
  }

  const openNew = () => {
    setForm({ customerId: customers[0]?.id || '', frequency: 'monthly', nextDate: today(), endDate: '', notes: '', lines: [blankLine()] })
    setModal(true)
  }

  const save = () => {
    if (!form.customerId) return alert('Select a customer.')
    const customer = customers.find((c) => c.id === form.customerId)
    const { items, subtotal, taxAmount, total } = calc(form.lines)
    if (total <= 0) return alert('Add at least one line with an amount.')
    addRecurringInvoice({
      customerId: form.customerId, customerName: customer?.name || '',
      frequency: form.frequency, nextDate: form.nextDate, endDate: form.endDate || null,
      notes: form.notes, items, subtotal, taxAmount, total,
    })
    // immediately materialise if the first date is already due
    const n = generateDueRecurring()
    setModal(false)
    if (n > 0) { setToast(`${n} invoice${n > 1 ? 's' : ''} generated`); setTimeout(() => setToast(''), 4000) }
  }

  const runNow = () => {
    const n = generateDueRecurring()
    setToast(n > 0 ? `${n} invoice${n > 1 ? 's' : ''} generated` : 'No subscriptions are due right now')
    setTimeout(() => setToast(''), 4000)
  }

  const preview = calc(form.lines)
  const activeCount = recurringInvoices.filter((r) => r.status === 'active').length
  const mrr = recurringInvoices.filter((r) => r.status === 'active' && r.frequency === 'monthly').reduce((s, r) => s + (r.total || 0), 0)

  return (
    <div>
      <PageHeader
        title="Recurring & Subscription Invoices"
        subtitle={`${activeCount} active · ${fmtMoney(mrr, sym)} monthly recurring`}
        action={
          <div className="flex gap-2">
            <Btn variant="secondary" onClick={runNow}><RefreshCw size={15} /> {t('Generate Due')}</Btn>
            <Btn onClick={openNew}><Plus size={15} /> {t('New Subscription')}</Btn>
          </div>
        }
      />

      <Card>
        {recurringInvoices.length === 0 ? (
          <EmptyState icon="🔁" title="No subscriptions yet"
            desc="Set up a schedule once and invoices are generated automatically each cycle — perfect for retainers, memberships and rent."
            action={<Btn onClick={openNew}><Plus size={14} /> {t('Create Subscription')}</Btn>} />
        ) : (
          <Table headers={['Ref', 'Customer', 'Amount', 'Frequency', 'Next Invoice', 'Generated', 'Status', { label: 'Actions', right: true }]}>
            {recurringInvoices.map((r) => (
              <Tr key={r.id}>
                <Td className="font-mono text-xs text-gray-400 dark:text-slate-500">{r.number}</Td>
                <Td className="font-medium text-gray-800 dark:text-slate-100">{r.customerName}</Td>
                <Td className="font-semibold">{fmtMoney(r.total, sym)}</Td>
                <Td><span className="text-xs text-gray-600 dark:text-slate-300">{FREQ[r.frequency]}</span></Td>
                <Td className="text-gray-500 dark:text-slate-400">{r.status === 'active' ? fmtDate(r.nextDate) : '—'}</Td>
                <Td><span className="text-gray-600 dark:text-slate-300">{r.generatedCount || 0}×</span></Td>
                <Td>
                  <Badge className={
                    r.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    : r.status === 'paused' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400'
                  }>{r.status}</Badge>
                </Td>
                <Td right>
                  <div className="flex justify-end gap-1">
                    {r.status === 'active' && <Btn size="sm" variant="ghost" onClick={() => updateRecurringInvoice(r.id, { status: 'paused' })} title="Pause"><Pause size={13} /></Btn>}
                    {r.status === 'paused' && <Btn size="sm" variant="ghost" onClick={() => updateRecurringInvoice(r.id, { status: 'active' })} title="Resume"><Play size={13} /></Btn>}
                    <Btn size="sm" variant="ghost" onClick={() => { if (confirm('Delete this subscription? Already-generated invoices are kept.')) deleteRecurringInvoice(r.id) }}><Trash2 size={13} className="text-red-400" /></Btn>
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="New Subscription" width="max-w-2xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Customer *" value={form.customerId} onChange={(e) => setField('customerId', e.target.value)}>
              <option value="">— Select customer —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select label="Frequency" value={form.frequency} onChange={(e) => setField('frequency', e.target.value)}>
              {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="First Invoice Date" type="date" value={form.nextDate} onChange={(e) => setField('nextDate', e.target.value)} />
            <Input label="End Date (optional)" type="date" value={form.endDate} onChange={(e) => setField('endDate', e.target.value)} />
          </div>

          {/* Line items */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('Line Items')}</label>
            <div className="space-y-2">
              {form.lines.map((l) => (
                <div key={l.id} className="flex gap-2 items-start">
                  <input className="flex-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-2 py-1.5 text-sm" placeholder="Description"
                    value={l.description} onChange={(e) => setLine(l.id, 'description', e.target.value)} />
                  <input className="w-16 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-2 py-1.5 text-sm" type="number" min="0" placeholder="Qty"
                    value={l.quantity} onChange={(e) => setLine(l.id, 'quantity', e.target.value)} />
                  <input className="w-24 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-2 py-1.5 text-sm" type="number" min="0" step="0.01" placeholder="Price"
                    value={l.price} onChange={(e) => setLine(l.id, 'price', e.target.value)} />
                  <select className="w-32 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-2 py-1.5 text-sm"
                    value={l.accountId} onChange={(e) => setLine(l.id, 'accountId', e.target.value)}>
                    <option value="">Revenue…</option>
                    {revenueAccs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <button onClick={() => removeLine(l.id)} className="text-gray-400 hover:text-red-500 mt-1.5"><X size={15} /></button>
                </div>
              ))}
            </div>
            <button onClick={addLine} className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"><Plus size={13} /> {t('Add line')}</button>
          </div>

          <Input label="Notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} />

          <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between text-gray-600 dark:text-slate-300"><span>Subtotal</span><span>{fmtMoney(preview.subtotal, sym)}</span></div>
            {settings.tax.enabled && <div className="flex justify-between text-gray-600 dark:text-slate-300"><span>{settings.tax.name} ({settings.tax.rate}%)</span><span>{fmtMoney(preview.taxAmount, sym)}</span></div>}
            <div className="flex justify-between font-bold text-gray-900 dark:text-slate-100 pt-1 border-t border-gray-200 dark:border-slate-600"><span>{t('Total per invoice')}</span><span>{fmtMoney(preview.total, sym)}</span></div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={save}><Repeat size={15} /> {t('Create Subscription')}</Btn>
          </div>
        </div>
      </Modal>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
