import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Trash2 } from 'lucide-react'

const emptyForm = () => ({
  customerId: '', customerName: '', date: today(),
  invoiceRef: '', reason: '', subtotal: '', taxAmount: '', total: '',
})

export default function CreditNotes() {
  const { creditNotes, customers, invoices, settings, addCreditNote, deleteCreditNote } = useStore()
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
  const taxAmt    = taxEnabled ? subtotal * (taxRate / 100) : (parseFloat(form.taxAmount) || 0)
  const total     = subtotal + taxAmt

  const handleSave = () => {
    if (!form.customerName.trim())  return alert('Customer is required.')
    if (!subtotal || subtotal <= 0) return alert('Enter a valid subtotal amount.')
    addCreditNote({ ...form, subtotal, taxAmount: taxAmt, total })
    setModal(false)
    setForm(emptyForm())
  }

  const sorted = [...creditNotes].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div>
      <PageHeader
        title="Credit Notes"
        subtitle="Sales returns and credit adjustments to customers"
        action={<Btn onClick={() => setModal(true)}><Plus size={15} /> New Credit Note</Btn>}
      />

      <Card>
        {creditNotes.length === 0 ? (
          <EmptyState icon="📄" title="No credit notes" desc="Issue credit notes for sales returns, overpayments, or price adjustments."
            action={<Btn onClick={() => setModal(true)}><Plus size={14} /> Issue Credit Note</Btn>} />
        ) : (
          <Table headers={['Number', 'Customer', 'Date', 'Invoice Ref', 'Reason', { label: 'Amount', right: true }, { label: '', right: true }]}>
            {sorted.map((cn) => (
              <Tr key={cn.id}>
                <Td><span className="font-mono text-sm font-medium text-purple-600">{cn.number}</span></Td>
                <Td className="font-medium text-gray-800">{cn.customerName}</Td>
                <Td className="text-gray-500 text-sm">{fmtDate(cn.date)}</Td>
                <Td className="text-gray-500 text-sm font-mono">{cn.invoiceRef || '—'}</Td>
                <Td className="text-gray-600 text-sm max-w-[200px] truncate">{cn.reason || '—'}</Td>
                <Td right>
                  <span className="font-semibold text-red-600">({fmtMoney(cn.total, sym)})</span>
                </Td>
                <Td right>
                  <Btn size="sm" variant="ghost" onClick={() => { if (confirm(`Delete ${cn.number}?`)) deleteCreditNote(cn.id) }}>
                    <Trash2 size={13} className="text-red-400" />
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
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
            <Input label="Related Invoice #" value={form.invoiceRef} onChange={(e) => setField('invoiceRef', e.target.value)} placeholder="INV-0001" />
          </div>
          <Input label="Reason" value={form.reason} onChange={(e) => setField('reason', e.target.value)} placeholder="e.g. Returned goods, overcharge, quality issue" />
          <div className="grid grid-cols-2 gap-3">
            <Input label={`Subtotal (${sym}) *`} type="number" min="0" step="0.01" value={form.subtotal} onChange={(e) => setField('subtotal', e.target.value)} />
            {!taxEnabled && (
              <Input label={`Tax Amount (${sym})`} type="number" min="0" step="0.01" value={form.taxAmount} onChange={(e) => setField('taxAmount', e.target.value)} />
            )}
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <div className="flex justify-between text-gray-600"><span>Subtotal:</span><span>{fmtMoney(subtotal, sym)}</span></div>
            {taxEnabled && <div className="flex justify-between text-gray-600"><span>Tax ({taxRate}%):</span><span>{fmtMoney(taxAmt, sym)}</span></div>}
            <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 mt-1 pt-1"><span>Total Credit:</span><span>{fmtMoney(total, sym)}</span></div>
          </div>
          <p className="text-xs text-blue-600 bg-blue-50 rounded p-2">
            Journal Entry: Dr Sales Returns ({fmtMoney(subtotal, sym)}){taxEnabled ? ` + Dr Tax Payable (${fmtMoney(taxAmt, sym)})` : ''} → Cr Accounts Receivable ({fmtMoney(total, sym)})
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>Cancel</Btn>
            <Btn onClick={handleSave}>Issue Credit Note</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
