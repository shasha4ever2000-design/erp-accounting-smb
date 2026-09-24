import { useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import { Plus, Trash2, Ban } from 'lucide-react'
import { ask } from '../components/Dialogs'

const emptyForm = () => ({
  customerId: '', customerName: '', date: today(),
  invoiceRef: '', reason: '', subtotal: '', taxAmount: '', total: '',
})

export default function CreditNotes() {
  const t = useT()
  const { creditNotes, customers, invoices, settings, addCreditNote, deleteCreditNote, voidCreditNote } = useStore()
  const sym = settings.company.currencySymbol
  const taxEnabled = settings.tax.enabled
  const taxRate    = settings.tax.rate

  const [modal, setModal] = useState(false)
  const [form, setForm]   = useState(emptyForm())
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handleCustomer = (id) => {
    const c = customers.find((x) => x.id === id)
    setForm((f) => ({ ...f, customerId: c?.id || '', customerName: c?.name || '' }))
  }

  const subtotal  = parseFloat(form.subtotal)  || 0
  const taxAmt    = Math.round((taxEnabled ? subtotal * (taxRate / 100) : (parseFloat(form.taxAmount) || 0)) * 100) / 100
  const total     = Math.round((subtotal + taxAmt) * 100) / 100

  const handleSave = () => {
    if (!form.customerName.trim())  return alert('Customer is required.')
    if (!subtotal || subtotal <= 0) return alert('Enter a valid subtotal amount.')
    try { addCreditNote({ ...form, subtotal, taxAmount: taxAmt, total }) }
    catch (e) { return alert(String(e.message || e).startsWith('PERIOD_LOCKED') ? t('That date falls in a locked period.') : String(e.message || e)) }
    setModal(false)
    setForm(emptyForm())
  }

  const sorted = [...creditNotes].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div>
      <PageHeader
        title="Credit notes"
        subtitle="Sales returns and credit adjustments to customers"
        action={<Btn onClick={() => setModal(true)}><Plus size={15} /> {t('New Credit Note')}</Btn>}
      />

      <Card>
        {creditNotes.length === 0 ? (
          <EmptyState icon="📄" title="No credit notes" desc="Issue credit notes for sales returns, overpayments, or price adjustments."
            action={<Btn onClick={() => setModal(true)}><Plus size={14} /> {t('Issue Credit Note')}</Btn>} />
        ) : (
          <Table headers={['Number', 'Customer', 'Date', 'Invoice Ref', 'Reason', { label: 'Amount', right: true }, { label: '', right: true }]}>
            {sorted.map((cn) => (
              <Tr key={cn.id}>
                <Td><span className="font-mono text-sm font-medium text-purple-600 dark:text-purple-400">{cn.number}</span>{cn.status === 'void' && <Badge className="ms-2 bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300 line-through">Void</Badge>}</Td>
                <Td className="font-medium text-slate-800 dark:text-slate-100">{cn.customerName}</Td>
                <Td className="text-slate-500 dark:text-slate-400 text-sm">{fmtDate(cn.date)}</Td>
                <Td className="text-slate-500 dark:text-slate-400 text-sm font-mono">{cn.invoiceRef || cn.invoiceNumber || '—'}</Td>
                <Td className="text-slate-600 dark:text-slate-300 text-sm max-w-[200px] truncate">{cn.reason || '—'}</Td>
                <Td right>
                  <span className="font-semibold text-danger-600 dark:text-danger-400">({fmtMoney(cn.total, sym)})</span>
                </Td>
                <Td right>
                  <AttachmentButton entityType="creditnote" entityId={cn.id} />
                  {cn.status !== 'void' && (
                    <Btn size="sm" variant="ghost" title="Void credit note" onClick={async () => {
                      if (!await ask(`${t('Void credit note')} ${cn.number}?`)) return
                      try { voidCreditNote(cn.id, { date: today() }) } catch (e) { alert(String(e.message || e).startsWith('PERIOD_LOCKED') ? t('That date falls in a locked period.') : String(e.message || e)) }
                    }}>
                      <Ban size={13} className="text-slate-500" />
                    </Btn>
                  )}
                  <Btn size="sm" variant="ghost" onClick={async () => { if (!await ask(`Delete ${cn.number}?`)) return; try { deleteCreditNote(cn.id) } catch (e) { alert(String(e.message || e).startsWith('PERIOD_LOCKED') ? t('That date falls in a locked period.') : String(e.message || e)) } }}>
                    <Trash2 size={13} className="text-danger-600 dark:text-danger-400" />
                  </Btn>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="New Credit Note" width="max-w-lg">
        <div className="space-y-4">
          <Select label="Customer *" value={form.customerId} onChange={(e) => handleCustomer(e.target.value)}>
            <option value="">— Select customer —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          {!form.customerId && (
            <Input label="Or enter name manually" value={form.customerName} onChange={(e) => setField('customerName', e.target.value)} placeholder="Customer name" />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
            <Input label="Related Invoice #" value={form.invoiceRef} onChange={(e) => setField('invoiceRef', e.target.value)} placeholder="INV-0001" />
          </div>
          <Input label="Reason" value={form.reason} onChange={(e) => setField('reason', e.target.value)} placeholder="e.g. Returned goods, overcharge, quality issue" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label={`Subtotal (${sym}) *`} type="number" min="0" step="0.01" value={form.subtotal} onChange={(e) => setField('subtotal', e.target.value)} />
            {!taxEnabled && (
              <Input label={`Tax Amount (${sym})`} type="number" min="0" step="0.01" value={form.taxAmount} onChange={(e) => setField('taxAmount', e.target.value)} />
            )}
          </div>
          <div className="bg-slate-50 dark:bg-surface-800/60 rounded-lg p-3 text-sm">
            <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>Subtotal:</span><span>{fmtMoney(subtotal, sym)}</span></div>
            {taxEnabled && <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>Tax ({taxRate}%):</span><span>{fmtMoney(taxAmt, sym)}</span></div>}
            <div className="flex justify-between font-bold text-slate-900 dark:text-slate-100 border-t border-slate-200 dark:border-surface-700 mt-1 pt-1"><span>Total Credit:</span><span>{fmtMoney(total, sym)}</span></div>
          </div>
          <p className="text-xs bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300 rounded p-2">
            Journal Entry: Dr Sales Returns ({fmtMoney(subtotal, sym)}){taxEnabled ? ` + Dr Tax Payable (${fmtMoney(taxAmt, sym)})` : ''} → Cr Accounts Receivable ({fmtMoney(total, sym)})
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={handleSave}>{t('Issue Credit Note')}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
