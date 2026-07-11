import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { today, addDays, fmtMoney } from '../utils/formatters'
import { PageHeader, Card, Btn, Input, Select, Textarea } from '../components/UI'
import { useT } from '../i18n'
import { Plus, Trash2, ArrowLeft } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { VAT_CATEGORIES, vatCatRate } from '../utils/vat'

const emptyLine = () => ({ id: uuid(), itemId: '', description: '', quantity: 1, unitPrice: 0, taxCategory: 'standard', taxRate: 0, accountId: 'acc-sales', subtotal: 0, taxAmount: 0, total: 0 })

export default function InvoiceForm() {
  const navigate = useNavigate()
  const { customers, accounts, inventoryItems, departments, settings, addInvoice } = useStore()
  const t = useT()
  const sym = settings.company.currencySymbol
  const taxEnabled = settings.tax.enabled
  const defaultTaxRate = settings.tax.rate

  const revenueAccounts = accounts.filter((a) => a.type === 'revenue')

  const [form, setForm] = useState({
    customerId: '',
    customerName: '',
    date: today(),
    dueDate: addDays(today(), settings.invoice.dueDays || 30),
    notes: settings.invoice.notes || '',
    departmentId: '',
    items: [emptyLine()],
  })

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const setCustomer = (id) => {
    const c = customers.find((c) => c.id === id)
    setField('customerId', id)
    setField('customerName', c?.name || '')
  }

  const updateLine = (lineId, key, value) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((line) => {
        if (line.id !== lineId) return line
        const updated = { ...line, [key]: value }
        if (key === 'itemId' && value) {
          const it = inventoryItems.find((i) => i.id === value)
          if (it) {
            if (!updated.description) updated.description = it.name
            if (!parseFloat(updated.unitPrice)) updated.unitPrice = it.salePrice || 0
          }
        }
        // The VAT category drives the rate: standard → configured rate, zero-rated/exempt → 0%.
        updated.taxRate = taxEnabled ? vatCatRate(updated.taxCategory, defaultTaxRate) : 0
        // Recalc
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
    if (!form.customerId) return alert('Please select a customer.')
    if (form.items.length === 0) return alert('Add at least one line item.')
    if (form.items.some((l) => !l.description)) return alert('All line items must have a description.')

    const lock = settings?.accounting?.lockDate
    if (lock && form.date && String(form.date) <= String(lock)) return alert(t('This date falls in a closed accounting period (locked through {d}). Choose a later date.').replace('{d}', lock))
    try {
      addInvoice({ ...form, subtotal, taxAmount: taxTotal, total })
    } catch (e) {
      if (String(e.message).startsWith('PERIOD_LOCKED')) return alert(t('This date falls in a closed accounting period (locked through {d}). Choose a later date.').replace('{d}', lock))
      throw e
    }
    navigate('/invoices')
  }

  return (
    <div>
      <div className="mb-6">
        <button onClick={() => navigate('/invoices')} className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-100 mb-4">
          <ArrowLeft size={15} /> {t('Back to Invoices')}
        </button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{t('New Sales Invoice')}</h1>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Main form */}
        <div className="xl:col-span-2 space-y-5">
          {/* Header */}
          <Card className="p-6">
            <h2 className="text-sm font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-4">{t('Invoice Details')}</h2>
            <div className="grid grid-cols-2 gap-4">
              <Select label="Customer *" value={form.customerId} onChange={(e) => setCustomer(e.target.value)}>
                <option value="">Select customer…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              {departments.length > 0 ? (
                <Select label={t('Department / Cost Center')} value={form.departmentId} onChange={(e) => setField('departmentId', e.target.value)}>
                  <option value="">{t('— Unassigned —')}</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              ) : <div />}
              <Input label="Invoice Date" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
              <Input label="Due Date" type="date" value={form.dueDate} onChange={(e) => setField('dueDate', e.target.value)} />
            </div>
          </Card>

          {/* Line Items */}
          <Card className="p-6">
            <h2 className="text-sm font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-4">{t('Line Items')}</h2>
            <div className="space-y-3">
              {/* Headers */}
              <div className={`grid gap-2 text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase px-0 ${taxEnabled ? 'grid-cols-[2fr_70px_90px_130px_90px_32px]' : 'grid-cols-[2fr_80px_100px_80px_32px]'}`}>
                <span>{t('Description')}</span>
                <span>Qty</span>
                <span>{t('Unit Price')}</span>
                {taxEnabled && <span>{t('VAT')}</span>}
                <span className="text-right">{t('Amount')}</span>
                <span />
              </div>

              {form.items.map((line) => (
                <div key={line.id} className={`grid gap-2 items-start ${taxEnabled ? 'grid-cols-[2fr_70px_90px_130px_90px_32px]' : 'grid-cols-[2fr_80px_100px_80px_32px]'}`}>
                  <div className="space-y-1">
                    <Input
                      value={line.description}
                      onChange={(e) => updateLine(line.id, 'description', e.target.value)}
                      placeholder="Item or service description"
                    />
                    {inventoryItems.length > 0 && (
                      <Select value={line.itemId} onChange={(e) => updateLine(line.id, 'itemId', e.target.value)}>
                        <option value="">{t('— Service / non-stock —')}</option>
                        {inventoryItems.map((i) => <option key={i.id} value={i.id}>📦 {i.name} ({i.quantity || 0})</option>)}
                      </Select>
                    )}
                    <Select
                      value={line.accountId}
                      onChange={(e) => updateLine(line.id, 'accountId', e.target.value)}
                    >
                      {revenueAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                    {line.itemId && <p className="text-[11px] text-blue-600 dark:text-blue-400 px-1">{t('Issues stock & posts COGS at average cost')}</p>}
                  </div>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.id, 'quantity', e.target.value)}
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(line.id, 'unitPrice', e.target.value)}
                  />
                  {taxEnabled && (
                    <Select
                      value={line.taxCategory || 'standard'}
                      onChange={(e) => updateLine(line.id, 'taxCategory', e.target.value)}
                    >
                      {VAT_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>{t(c.label)}{c.id === 'standard' ? ` ${defaultTaxRate}%` : ''}</option>
                      ))}
                    </Select>
                  )}
                  <div className="text-sm font-medium text-gray-800 dark:text-slate-100 text-right pt-2">
                    {fmtMoney(line.subtotal, sym)}
                  </div>
                  <button onClick={() => removeLine(line.id)} className="mt-2 text-red-400 hover:text-red-600 dark:hover:text-danger-400 flex-shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}

              <Btn variant="ghost" onClick={addLine} size="sm">
                <Plus size={14} /> {t('Add Line')}
              </Btn>
            </div>

            {/* Totals */}
            <div className="border-t border-gray-100 dark:border-surface-750 mt-6 pt-4 space-y-2 text-sm">
              <div className="flex justify-between text-gray-600 dark:text-slate-300">
                <span>Subtotal</span>
                <span className="font-medium">{fmtMoney(subtotal, sym)}</span>
              </div>
              {taxEnabled && taxTotal > 0 && (
                <div className="flex justify-between text-gray-600 dark:text-slate-300">
                  <span>{settings.tax.name}</span>
                  <span>{fmtMoney(taxTotal, sym)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 dark:text-slate-100 text-base border-t border-gray-200 dark:border-surface-700 pt-2 mt-2">
                <span>Total</span>
                <span>{fmtMoney(total, sym)}</span>
              </div>
            </div>
          </Card>

          {/* Notes */}
          <Card className="p-6">
            <Textarea label="Notes / Terms" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={3} placeholder="Payment terms, thank you note, etc." />
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-4">Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-slate-400">Subtotal</span>
                <span className="font-medium">{fmtMoney(subtotal, sym)}</span>
              </div>
              {taxEnabled && (
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-slate-400">{settings.tax.name} ({settings.tax.rate}%)</span>
                  <span>{fmtMoney(taxTotal, sym)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg border-t border-slate-200 dark:border-surface-700 pt-2 mt-2">
                <span>Total</span>
                <span className="text-blue-600 dark:text-blue-400">{fmtMoney(total, sym)}</span>
              </div>
            </div>
            <div className="mt-5 space-y-2">
              <Btn className="w-full justify-center" onClick={handleSave}>
                {t('Save Invoice')}
              </Btn>
              <Btn variant="secondary" className="w-full justify-center" onClick={() => navigate('/invoices')}>
                {t('Cancel')}
              </Btn>
            </div>
          </Card>

          {form.customerId && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-3">{t('Customer')}</h2>
              {(() => {
                const c = customers.find((c) => c.id === form.customerId)
                if (!c) return null
                return (
                  <div className="text-sm space-y-1">
                    <p className="font-medium text-gray-800 dark:text-slate-100">{c.name}</p>
                    {c.email && <p className="text-gray-500 dark:text-slate-400">{c.email}</p>}
                    {c.phone && <p className="text-gray-500 dark:text-slate-400">{c.phone}</p>}
                    {c.address && <p className="text-gray-400 dark:text-slate-500 text-xs mt-1">{c.address}</p>}
                  </div>
                )
              })()}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
