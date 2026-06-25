import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { today, addDays, fmtMoney } from '../utils/formatters'
import { PageHeader, Card, Btn, Input, Select, Textarea } from '../components/UI'
import { Plus, Trash2, ArrowLeft } from 'lucide-react'
import { v4 as uuid } from 'uuid'

const EXPENSE_TYPES = ['asset', 'expense']
const emptyLine = () => ({ id: uuid(), description: '', quantity: 1, unitPrice: 0, taxRate: 0, accountId: 'acc-admin', subtotal: 0, taxAmount: 0, total: 0 })

export default function PurchaseForm() {
  const navigate = useNavigate()
  const { suppliers, accounts, settings, addPurchase } = useStore()
  const sym = settings.company.currencySymbol
  const taxEnabled = settings.tax.enabled

  const expenseAccounts = accounts.filter((a) => EXPENSE_TYPES.includes(a.type) && !['acc-ar', 'acc-vatin'].includes(a.id))

  const [form, setForm] = useState({
    supplierId: '',
    supplierName: '',
    supplierRef: '',
    date: today(),
    dueDate: addDays(today(), 30),
    notes: '',
    items: [emptyLine()],
  })

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const setSupplier = (id) => {
    const s = suppliers.find((s) => s.id === id)
    setField('supplierId', id)
    setField('supplierName', s?.name || '')
  }

  const updateLine = (lineId, key, value) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((line) => {
        if (line.id !== lineId) return line
        const updated = { ...line, [key]: value }
        const qty = parseFloat(updated.quantity) || 0
        const price = parseFloat(updated.unitPrice) || 0
        const tax = parseFloat(updated.taxRate) || 0
        updated.subtotal = qty * price
        updated.taxAmount = updated.subtotal * tax / 100
        updated.total = updated.subtotal + updated.taxAmount
        return updated
      }),
    }))
  }

  const addLine = () => setForm((f) => ({ ...f, items: [...f.items, emptyLine()] }))
  const removeLine = (id) => setForm((f) => ({ ...f, items: f.items.filter((l) => l.id !== id) }))

  const subtotal = form.items.reduce((s, l) => s + (l.subtotal || 0), 0)
  const taxTotal = form.items.reduce((s, l) => s + (l.taxAmount || 0), 0)
  const total = subtotal + taxTotal

  const handleSave = () => {
    if (!form.supplierId) return alert('Please select a supplier.')
    if (form.items.length === 0 || form.items.some((l) => !l.description)) return alert('All line items must have a description.')
    addPurchase({ ...form, subtotal, taxAmount: taxTotal, total })
    navigate('/purchases')
  }

  return (
    <div>
      <button onClick={() => navigate('/purchases')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={15} /> Back to Purchases
      </button>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Purchase Invoice</h1>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-5">
          <Card className="p-6">
            <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-4">Purchase Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <Select label="Supplier *" value={form.supplierId} onChange={(e) => setSupplier(e.target.value)}>
                <option value="">Select supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <Input label="Supplier Invoice Ref" value={form.supplierRef} onChange={(e) => setField('supplierRef', e.target.value)} placeholder="Supplier's invoice number" />
              <Input label="Invoice Date" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
              <Input label="Due Date" type="date" value={form.dueDate} onChange={(e) => setField('dueDate', e.target.value)} />
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-4">Line Items</h2>
            <div className="space-y-3">
              <div className={`grid gap-2 text-xs font-semibold text-gray-400 uppercase ${taxEnabled ? 'grid-cols-[2fr_80px_100px_80px_80px_32px]' : 'grid-cols-[2fr_80px_100px_80px_32px]'}`}>
                <span>Description</span>
                <span>Qty</span>
                <span>Unit Cost</span>
                {taxEnabled && <span>Tax %</span>}
                <span className="text-right">Amount</span>
                <span />
              </div>
              {form.items.map((line) => (
                <div key={line.id} className={`grid gap-2 items-start ${taxEnabled ? 'grid-cols-[2fr_80px_100px_80px_80px_32px]' : 'grid-cols-[2fr_80px_100px_80px_32px]'}`}>
                  <div className="space-y-1">
                    <Input value={line.description} onChange={(e) => updateLine(line.id, 'description', e.target.value)} placeholder="Item or expense description" />
                    <Select value={line.accountId} onChange={(e) => updateLine(line.id, 'accountId', e.target.value)}>
                      {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
                    </Select>
                  </div>
                  <Input type="number" min="0" step="0.01" value={line.quantity} onChange={(e) => updateLine(line.id, 'quantity', e.target.value)} />
                  <Input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => updateLine(line.id, 'unitPrice', e.target.value)} />
                  {taxEnabled && <Input type="number" min="0" step="0.1" value={line.taxRate} onChange={(e) => updateLine(line.id, 'taxRate', e.target.value)} />}
                  <div className="text-sm font-medium text-gray-800 text-right pt-2">{fmtMoney(line.subtotal, sym)}</div>
                  <button onClick={() => removeLine(line.id)} className="mt-2 text-red-400 hover:text-red-600"><Trash2 size={15} /></button>
                </div>
              ))}
              <Btn variant="ghost" onClick={addLine} size="sm"><Plus size={14} /> Add Line</Btn>
            </div>

            <div className="border-t border-gray-100 mt-6 pt-4 space-y-2 text-sm">
              <div className="flex justify-between text-gray-600"><span>Subtotal</span><span className="font-medium">{fmtMoney(subtotal, sym)}</span></div>
              {taxEnabled && taxTotal > 0 && <div className="flex justify-between text-gray-600"><span>{settings.tax.name}</span><span>{fmtMoney(taxTotal, sym)}</span></div>}
              <div className="flex justify-between font-bold text-gray-900 text-base border-t pt-2"><span>Total</span><span>{fmtMoney(total, sym)}</span></div>
            </div>
          </Card>

          <Card className="p-6">
            <Textarea label="Notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={3} placeholder="Any notes about this purchase..." />
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="font-medium">{fmtMoney(subtotal, sym)}</span></div>
              {taxEnabled && <div className="flex justify-between"><span className="text-gray-500">{settings.tax.name}</span><span>{fmtMoney(taxTotal, sym)}</span></div>}
              <div className="flex justify-between font-bold text-lg border-t pt-2 mt-2"><span>Total</span><span className="text-orange-600">{fmtMoney(total, sym)}</span></div>
            </div>
            <div className="mt-5 space-y-2">
              <Btn className="w-full justify-center" onClick={handleSave}>Save Purchase Invoice</Btn>
              <Btn variant="secondary" className="w-full justify-center" onClick={() => navigate('/purchases')}>Cancel</Btn>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
