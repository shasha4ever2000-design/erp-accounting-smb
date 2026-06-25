import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Trash2 } from 'lucide-react'

const emptyForm = () => ({
  supplierId: '', supplierName: '', date: today(),
  purchaseRef: '', reason: '', subtotal: '', taxAmount: '',
})

export default function DebitNotes() {
  const { debitNotes, suppliers, settings, addDebitNote, deleteDebitNote } = useStore()
  const sym = settings.company.currencySymbol
  const taxEnabled = settings.tax.enabled
  const taxRate    = settings.tax.rate

  const [modal, setModal] = useState(false)
  const [form, setForm]   = useState(emptyForm())
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handleSupplier = (id) => {
    const s = suppliers.find((x) => x.id === id)
    setForm((f) => ({ ...f, supplierId: s?.id || '', supplierName: s?.name || '' }))
  }

  const subtotal = parseFloat(form.subtotal)  || 0
  const taxAmt   = taxEnabled ? subtotal * (taxRate / 100) : (parseFloat(form.taxAmount) || 0)
  const total    = subtotal + taxAmt

  const handleSave = () => {
    if (!form.supplierName.trim()) return alert('Supplier is required.')
    if (!subtotal || subtotal <= 0) return alert('Enter a valid subtotal amount.')
    addDebitNote({ ...form, subtotal, taxAmount: taxAmt, total })
    setModal(false)
    setForm(emptyForm())
  }

  const sorted = [...debitNotes].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div>
      <PageHeader
        title="Debit Notes"
        subtitle="Purchase returns and debit adjustments to suppliers"
        action={<Btn onClick={() => setModal(true)}><Plus size={15} /> New Debit Note</Btn>}
      />

      <Card>
        {debitNotes.length === 0 ? (
          <EmptyState icon="📑" title="No debit notes" desc="Issue debit notes when returning goods to suppliers or claiming credit for overcharges."
            action={<Btn onClick={() => setModal(true)}><Plus size={14} /> Issue Debit Note</Btn>} />
        ) : (
          <Table headers={['Number', 'Supplier', 'Date', 'Purchase Ref', 'Reason', { label: 'Amount', right: true }, { label: '', right: true }]}>
            {sorted.map((dn) => (
              <Tr key={dn.id}>
                <Td><span className="font-mono text-sm font-medium text-orange-600">{dn.number}</span></Td>
                <Td className="font-medium text-gray-800">{dn.supplierName}</Td>
                <Td className="text-gray-500 text-sm">{fmtDate(dn.date)}</Td>
                <Td className="text-gray-500 text-sm font-mono">{dn.purchaseRef || '—'}</Td>
                <Td className="text-gray-600 text-sm max-w-[200px] truncate">{dn.reason || '—'}</Td>
                <Td right>
                  <span className="font-semibold text-green-600">{fmtMoney(dn.total, sym)}</span>
                </Td>
                <Td right>
                  <Btn size="sm" variant="ghost" onClick={() => { if (confirm(`Delete ${dn.number}?`)) deleteDebitNote(dn.id) }}>
                    <Trash2 size={13} className="text-red-400" />
                  </Btn>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="New Debit Note" width="max-w-lg">
        <div className="space-y-4">
          <Select label="Supplier *" value={form.supplierId} onChange={(e) => handleSupplier(e.target.value)}>
            <option value="">— Select supplier —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          {!form.supplierId && (
            <Input label="Or enter name manually" value={form.supplierName} onChange={(e) => setField('supplierName', e.target.value)} placeholder="Supplier name" />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
            <Input label="Related Purchase #" value={form.purchaseRef} onChange={(e) => setField('purchaseRef', e.target.value)} placeholder="PUR-0001" />
          </div>
          <Input label="Reason" value={form.reason} onChange={(e) => setField('reason', e.target.value)} placeholder="e.g. Returned damaged goods, overcharge correction" />
          <div className="grid grid-cols-2 gap-3">
            <Input label={`Subtotal (${sym}) *`} type="number" min="0" step="0.01" value={form.subtotal} onChange={(e) => setField('subtotal', e.target.value)} />
            {!taxEnabled && (
              <Input label={`Tax Amount (${sym})`} type="number" min="0" step="0.01" value={form.taxAmount} onChange={(e) => setField('taxAmount', e.target.value)} />
            )}
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <div className="flex justify-between text-gray-600"><span>Subtotal:</span><span>{fmtMoney(subtotal, sym)}</span></div>
            {taxEnabled && <div className="flex justify-between text-gray-600"><span>Tax ({taxRate}%):</span><span>{fmtMoney(taxAmt, sym)}</span></div>}
            <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 mt-1 pt-1"><span>Total Debit:</span><span>{fmtMoney(total, sym)}</span></div>
          </div>
          <p className="text-xs text-blue-600 bg-blue-50 rounded p-2">
            Journal Entry: Dr Accounts Payable ({fmtMoney(total, sym)}) → Cr Purchase Returns ({fmtMoney(subtotal, sym)}){taxEnabled ? ` + Cr Input Tax (${fmtMoney(taxAmt, sym)})` : ''}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>Cancel</Btn>
            <Btn onClick={handleSave}>Issue Debit Note</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
