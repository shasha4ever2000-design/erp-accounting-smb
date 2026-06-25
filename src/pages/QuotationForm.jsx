import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { today, addDays } from '../utils/formatters'
import { PageHeader, Card, Btn, Input, Select, Textarea } from '../components/UI'
import { Plus, Trash2 } from 'lucide-react'

const emptyLine = () => ({ id: crypto.randomUUID(), description: '', quantity: 1, unitPrice: 0, subtotal: 0, taxRate: 0, accountId: 'acc-sales' })

export default function QuotationForm() {
  const navigate = useNavigate()
  const { customers, accounts, inventoryItems, settings, addQuotation } = useStore()
  const sym = settings.company.currencySymbol
  const taxEnabled = settings.tax.enabled
  const taxRate = settings.tax.rate

  const [form, setForm] = useState({
    customerId: '', customerName: '', customerEmail: '', customerAddress: '',
    date: today(), expiryDate: addDays(today(), 30), notes: settings.invoice.notes || '',
  })
  const [lines, setLines] = useState([emptyLine()])
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handleCustomer = (id) => {
    const c = customers.find((x) => x.id === id)
    if (c) setForm((f) => ({ ...f, customerId: c.id, customerName: c.name, customerEmail: c.email || '', customerAddress: c.address || '' }))
    else setForm((f) => ({ ...f, customerId: '', customerName: '', customerEmail: '', customerAddress: '' }))
  }

  const setLine = (id, k, v) => {
    setLines((ls) => ls.map((l) => {
      if (l.id !== id) return l
      const updated = { ...l, [k]: v }
      if (k === 'quantity' || k === 'unitPrice') {
        const qty = parseFloat(k === 'quantity' ? v : updated.quantity) || 0
        const price = parseFloat(k === 'unitPrice' ? v : updated.unitPrice) || 0
        updated.subtotal = qty * price
      }
      return updated
    }))
  }

  const pickItem = (lineId, itemId) => {
    const item = inventoryItems.find((i) => i.id === itemId)
    if (!item) return
    setLines((ls) => ls.map((l) => {
      if (l.id !== lineId) return l
      const qty = parseFloat(l.quantity) || 1
      return { ...l, description: item.name, unitPrice: item.salePrice || 0, subtotal: qty * (item.salePrice || 0), accountId: item.revenueAccountId || 'acc-sales', taxRate: item.taxRate || 0 }
    }))
  }

  const addLine   = () => setLines((ls) => [...ls, emptyLine()])
  const removeLine = (id) => setLines((ls) => ls.filter((l) => l.id !== id))

  const subtotal  = lines.reduce((s, l) => s + (parseFloat(l.subtotal) || 0), 0)
  const taxAmount = taxEnabled ? lines.reduce((s, l) => {
    const rate = parseFloat(l.taxRate) ?? taxRate
    return s + (parseFloat(l.subtotal) || 0) * (rate / 100)
  }, 0) : 0
  const total = subtotal + taxAmount

  const revenueAccounts = accounts.filter((a) => a.type === 'revenue')

  const handleSave = () => {
    if (!form.customerName.trim()) return alert('Customer name is required.')
    if (lines.every((l) => !l.description.trim())) return alert('Add at least one line item.')
    const q = addQuotation({
      ...form,
      items: lines.map((l) => ({ ...l, quantity: parseFloat(l.quantity) || 1, unitPrice: parseFloat(l.unitPrice) || 0, subtotal: parseFloat(l.subtotal) || 0 })),
      subtotal, taxAmount, total,
    })
    navigate('/quotations')
  }

  return (
    <div>
      <PageHeader title="New Quotation / Estimate" subtitle="Create a price quote for your customer" />

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Form */}
        <div className="col-span-2 space-y-5">
          <Card className="p-5 space-y-4">
            <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Customer</h3>
            <Select label="Select Customer" value={form.customerId} onChange={(e) => handleCustomer(e.target.value)}>
              <option value="">— Enter manually below —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Customer Name *" value={form.customerName} onChange={(e) => setField('customerName', e.target.value)} />
              <Input label="Customer Email" type="email" value={form.customerEmail} onChange={(e) => setField('customerEmail', e.target.value)} />
            </div>
            <Textarea label="Customer Address" value={form.customerAddress} onChange={(e) => setField('customerAddress', e.target.value)} rows={2} />
          </Card>

          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Line Items</h3>
              <Btn size="sm" variant="secondary" onClick={addLine}><Plus size={13} /> Add Line</Btn>
            </div>
            <div className="space-y-3">
              {lines.map((line) => (
                <div key={line.id} className="border border-gray-100 rounded-xl p-3 space-y-2 bg-gray-50">
                  <div className="grid grid-cols-4 gap-2">
                    <div className="col-span-2">
                      <Select label="Product (optional)" value="" onChange={(e) => pickItem(line.id, e.target.value)}>
                        <option value="">Pick from inventory...</option>
                        {inventoryItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Select label="Revenue Account" value={line.accountId} onChange={(e) => setLine(line.id, 'accountId', e.target.value)}>
                        {revenueAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </Select>
                    </div>
                  </div>
                  <Input label="Description *" value={line.description} onChange={(e) => setLine(line.id, 'description', e.target.value)} placeholder="Item / service description" />
                  <div className="grid grid-cols-4 gap-2 items-end">
                    <Input label="Qty" type="number" min="0" step="any" value={line.quantity} onChange={(e) => setLine(line.id, 'quantity', e.target.value)} />
                    <Input label={`Unit Price (${sym})`} type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => setLine(line.id, 'unitPrice', e.target.value)} />
                    {taxEnabled && <Input label={`Tax %`} type="number" min="0" max="100" value={line.taxRate ?? taxRate} onChange={(e) => setLine(line.id, 'taxRate', e.target.value)} />}
                    <div className={`flex items-end gap-2 ${taxEnabled ? '' : 'col-span-2'}`}>
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Subtotal</label>
                        <p className="py-2 px-3 text-sm font-medium text-gray-800">{sym}{(parseFloat(line.subtotal) || 0).toFixed(2)}</p>
                      </div>
                      <Btn size="sm" variant="ghost" onClick={() => removeLine(line.id)} className="mb-0.5"><Trash2 size={13} className="text-red-400" /></Btn>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <Textarea label="Notes / Terms" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={3} placeholder="Payment terms, validity period, etc." />
          </Card>
        </div>

        {/* Right: Summary */}
        <div className="space-y-4">
          <Card className="p-5 space-y-3">
            <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Quotation Details</h3>
            <Input label="Date" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
            <Input label="Expiry Date" type="date" value={form.expiryDate} onChange={(e) => setField('expiryDate', e.target.value)} />
          </Card>

          <Card className="p-5 space-y-2">
            <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide mb-3">Summary</h3>
            <div className="flex justify-between text-sm text-gray-600">
              <span>Subtotal</span><span>{sym}{subtotal.toFixed(2)}</span>
            </div>
            {taxEnabled && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>Tax</span><span>{sym}{taxAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="border-t border-gray-100 pt-2 flex justify-between font-bold text-gray-900">
              <span>Total</span><span>{sym}{total.toFixed(2)}</span>
            </div>
          </Card>

          <Btn className="w-full justify-center" onClick={handleSave}>Save Quotation</Btn>
          <Btn variant="secondary" className="w-full justify-center" onClick={() => navigate('/quotations')}>Cancel</Btn>
        </div>
      </div>
    </div>
  )
}
