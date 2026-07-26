import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { today, addDays, fmtMoney } from '../utils/formatters'
import { PageHeader, Card, Btn, Input, Select, Textarea } from '../components/UI'
import { CustomFieldInputs } from '../components/CustomFields'
import { validateValues } from '../utils/customFields'
import { useT } from '../i18n'
import { Plus, Trash2, ArrowLeft } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { VAT_CATEGORIES, vatCatRate } from '../utils/vat'
import { creditStatus } from '../utils/credit'
import { computeLine, invoiceTotals } from '../utils/lineMath'

const emptyLine = () => ({ id: uuid(), itemId: '', description: '', quantity: 1, unitPrice: 0, discount: 0, taxCategory: 'standard', taxRate: 0, accountId: 'acc-sales', subtotal: 0, taxAmount: 0, total: 0 })

// Field labels exist only on the stacked mobile layout — from lg up the grid's
// column headers do that job and repeating them would double the row height.
const MOBILE_LABEL = 'lg:[&>label]:hidden'

export default function InvoiceForm() {
  const navigate = useNavigate()
  const { customers, invoices, accounts, inventoryItems, departments, currencies, settings, addInvoice, customFieldsFor } = useStore()
  const t = useT()
  const baseCurrency = settings.company.currency
  const salesReps = settings.salesReps || []
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
    salesRepId: '',
    docDiscount: 0,
    shipping: 0,
    shippingTaxable: false,
    currency: baseCurrency,
    exchangeRate: 1,
    customFields: {},
    items: [emptyLine()],
  })

  // Foreign-currency invoicing: the selected currency drives the symbol shown on
  // totals; exchangeRate is base-currency units per 1 unit of the invoice currency.
  const isFC = form.currency && form.currency !== baseCurrency
  const sym = isFC ? `${form.currency} ` : settings.company.currencySymbol
  const setCurrency = (code) => {
    if (code === baseCurrency) return setForm((f) => ({ ...f, currency: code, exchangeRate: 1 }))
    const cur = currencies.find((c) => c.code === code)
    const rate = cur && cur.rate ? Math.round((1 / cur.rate) * 1e6) / 1e6 : 1 // stored rate is FC-per-base
    setForm((f) => ({ ...f, currency: code, exchangeRate: rate }))
  }

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
            if (!parseFloat(updated.unitPrice)) {
              // Apply the customer's price level (a % adjustment off the standard sale price).
              const pct = Number(customers.find((c) => c.id === f.customerId)?.priceListPct) || 0
              updated.unitPrice = Math.round((it.salePrice || 0) * (1 + pct / 100) * 100) / 100
            }
          }
        }
        // The VAT category drives the rate: standard → configured rate, zero-rated/exempt → 0%.
        updated.taxRate = taxEnabled ? vatCatRate(updated.taxCategory, defaultTaxRate) : 0
        const c = computeLine(updated, { taxEnabled })
        updated.subtotal = c.subtotal   // net of discount — this is what posts as revenue
        updated.taxAmount = c.taxAmount
        updated.total = c.total
        return updated
      }),
    }))
  }

  const addLine = () => setForm((f) => ({ ...f, items: [...f.items, emptyLine()] }))
  const removeLine = (id) => setForm((f) => ({ ...f, items: f.items.filter((l) => l.id !== id) }))

  const totals = invoiceTotals(form.items, { taxEnabled, docDiscountPct: form.docDiscount, shipping: form.shipping, shippingTaxRate: form.shippingTaxable ? defaultTaxRate : 0 })
  const grossSubtotal = totals.grossSubtotal
  const discountTotal = totals.lineDiscount
  const subtotal = totals.netSubtotal
  const taxTotal = totals.taxAmount
  const total = totals.total

  // Live credit check for the selected customer (this invoice's base value included).
  const selectedCustomer = customers.find((c) => c.id === form.customerId)
  const newBase = total * (Number(form.exchangeRate) || 1)
  const credit = creditStatus(selectedCustomer, invoices, newBase)

  const handleSave = () => {
    if (!form.customerId) return alert('Please select a customer.')
    if (form.items.length === 0) return alert('Add at least one line item.')
    if (form.items.some((l) => !l.description)) return alert('All line items must have a description.')
    const cf = validateValues(customFieldsFor('invoice'), form.customFields)
    if (!cf.ok) return alert(cf.errors.join('\n'))

    if (credit.willExceed) {
      const msg = t('This invoice puts {name} over their credit limit.\n\nLimit: {limit}\nOutstanding now: {exp}\nAfter this invoice: {proj}\n\nCreate it anyway?')
        .replace('{name}', selectedCustomer?.name || '')
        .replace('{limit}', fmtMoney(credit.limit, settings.company.currencySymbol))
        .replace('{exp}', fmtMoney(credit.exposure, settings.company.currencySymbol))
        .replace('{proj}', fmtMoney(credit.projected, settings.company.currencySymbol))
      if (!confirm(msg)) return
    }

    const lock = settings?.accounting?.lockDate
    if (lock && form.date && String(form.date) <= String(lock)) return alert(t('This date falls in a closed accounting period (locked through {d}). Choose a later date.').replace('{d}', lock))
    try {
      addInvoice({ ...form, subtotal, taxAmount: taxTotal, total, docDiscount: Number(form.docDiscount) || 0, docDiscountAmount: totals.docDiscountAmount, shipping: totals.shipping })
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              {salesReps.length > 0 && (
                <Select label={t('Sales Rep')} value={form.salesRepId} onChange={(e) => setField('salesRepId', e.target.value)}>
                  <option value="">{t('— Unassigned —')}</option>
                  {salesReps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              )}
              <Input label="Invoice Date" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
              <Input label="Due Date" type="date" value={form.dueDate} onChange={(e) => setField('dueDate', e.target.value)} />
              {currencies.length > 0 && (
                <>
                  <Select label={t('Currency')} value={form.currency} onChange={(e) => setCurrency(e.target.value)}>
                    <option value={baseCurrency}>{baseCurrency} ({t('base')})</option>
                    {currencies.map((c) => <option key={c.id} value={c.code}>{c.code} — {c.name}</option>)}
                  </Select>
                  {isFC && (
                    <Input label={t('Exchange rate (1 {c} = ? {b})').replace('{c}', form.currency).replace('{b}', baseCurrency)}
                      type="number" min="0" step="0.000001" value={form.exchangeRate}
                      onChange={(e) => setField('exchangeRate', e.target.value)} />
                  )}
                </>
              )}
            </div>
          </Card>

          {/* Line Items */}
          <Card className="p-6">
            <h2 className="text-sm font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-4">{t('Line Items')}</h2>
            <div className="space-y-3">
              {/* Headers */}
              {/* Column headers belong to the desktop grid; on a phone each field
                  carries its own label instead. */}
              <div className={`hidden lg:grid gap-2 text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase px-0 ${taxEnabled ? 'grid-cols-[2fr_58px_84px_60px_120px_88px_26px]' : 'grid-cols-[2fr_70px_90px_66px_90px_30px]'}`}>
                <span>{t('Description')}</span>
                <span>Qty</span>
                <span>{t('Unit Price')}</span>
                <span>{t('Disc %')}</span>
                {taxEnabled && <span>{t('VAT')}</span>}
                <span className="text-right">{t('Amount')}</span>
                <span />
              </div>

              {form.items.map((line) => (
                <div key={line.id} className={`grid gap-2 items-start grid-cols-2 rounded-xl border border-slate-200/70 dark:border-surface-700 bg-slate-50/60 dark:bg-surface-800/40 p-3 lg:border-0 lg:bg-transparent lg:dark:bg-transparent lg:p-0 lg:rounded-none ${taxEnabled ? 'lg:grid-cols-[2fr_58px_84px_60px_120px_88px_26px]' : 'lg:grid-cols-[2fr_70px_90px_66px_90px_30px]'}`}>
                  <div className="col-span-2 lg:col-span-1 space-y-1">
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
                    label="Qty" className={MOBILE_LABEL}
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.id, 'quantity', e.target.value)}
                  />
                  <Input
                    label="Unit Price" className={MOBILE_LABEL}
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(line.id, 'unitPrice', e.target.value)}
                  />
                  <Input
                    label="Disc %" className={MOBILE_LABEL}
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={line.discount}
                    onChange={(e) => updateLine(line.id, 'discount', e.target.value)}
                  />
                  {taxEnabled && (
                    <Select
                      label="VAT" className={`col-span-2 lg:col-span-1 ${MOBILE_LABEL}`}
                      value={line.taxCategory || 'standard'}
                      onChange={(e) => updateLine(line.id, 'taxCategory', e.target.value)}
                    >
                      {VAT_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>{t(c.label)}{c.id === 'standard' ? ` ${defaultTaxRate}%` : ''}</option>
                      ))}
                    </Select>
                  )}
                  <div className="text-sm font-medium text-gray-800 dark:text-slate-100 text-right pt-2 self-center lg:self-start">
                    <span className="lg:hidden text-xs font-normal text-gray-400 dark:text-slate-500 me-2">{t('Amount')}</span>
                    {fmtMoney(line.subtotal, sym)}
                  </div>
                  <button onClick={() => removeLine(line.id)} aria-label={t('Remove line')}
                    className="mt-2 justify-self-end self-center lg:self-start text-red-400 hover:text-red-600 dark:hover:text-danger-400 flex-shrink-0">
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
              {discountTotal > 0 && (
                <div className="flex justify-between text-gray-600 dark:text-slate-300">
                  <span>Subtotal</span>
                  <span>{fmtMoney(grossSubtotal, sym)}</span>
                </div>
              )}
              {discountTotal > 0 && (
                <div className="flex justify-between text-success-600 dark:text-success-400">
                  <span>{t('Discount')}</span>
                  <span>− {fmtMoney(discountTotal, sym)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-600 dark:text-slate-300">
                <span>{discountTotal > 0 ? t('Net Subtotal') : 'Subtotal'}</span>
                <span className="font-medium">{fmtMoney(subtotal, sym)}</span>
              </div>
              {/* Whole-invoice discount + shipping */}
              <div className="flex items-center justify-between gap-2 text-gray-600 dark:text-slate-300">
                <span className="flex items-center gap-1.5">{t('Invoice discount')}
                  <input type="number" min="0" max="100" step="0.1" value={form.docDiscount}
                    onChange={(e) => setField('docDiscount', e.target.value)}
                    className="w-16 text-end border border-gray-300 dark:border-surface-600 bg-white dark:bg-surface-800 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-brand-500" /> %
                </span>
                <span className="text-success-600 dark:text-success-400">{totals.docDiscountAmount > 0 ? `− ${fmtMoney(totals.docDiscountAmount, sym)}` : '—'}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-gray-600 dark:text-slate-300">
                <span className="flex items-center gap-1.5">{t('Shipping')}
                  <input type="number" min="0" step="0.01" value={form.shipping}
                    onChange={(e) => setField('shipping', e.target.value)}
                    className="w-20 text-end border border-gray-300 dark:border-surface-600 bg-white dark:bg-surface-800 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-brand-500" />
                  {taxEnabled && (
                    <label className="inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-slate-500">
                      <input type="checkbox" checked={form.shippingTaxable} onChange={(e) => setField('shippingTaxable', e.target.checked)} /> {t('taxable')}
                    </label>
                  )}
                </span>
                <span>{totals.shipping > 0 ? fmtMoney(totals.shipping, sym) : '—'}</span>
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
              {isFC && (
                <div className="flex justify-between text-xs text-gray-400 dark:text-slate-500">
                  <span>≈ {t('in')} {baseCurrency}</span>
                  <span>{fmtMoney(total * (Number(form.exchangeRate) || 1), settings.company.currencySymbol)}</span>
                </div>
              )}
            </div>
          </Card>

          {/* Notes */}
          <Card className="p-6">
            <Textarea label="Notes / Terms" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={3} placeholder="Payment terms, thank you note, etc." />
            <CustomFieldInputs
              entityId="invoice"
              values={form.customFields}
              onChange={(id, v) => setForm((f) => ({ ...f, customFields: { ...(f.customFields || {}), [id]: v } }))}
              className="mt-4"
            />
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
              {credit.hasLimit && (
                <div className={`mt-3 pt-3 border-t text-xs space-y-1 ${credit.willExceed ? 'border-danger-200 dark:border-danger-500/30' : 'border-gray-100 dark:border-surface-700'}`}>
                  <div className="flex justify-between text-gray-500 dark:text-slate-400"><span>{t('Credit limit')}</span><span className="tabular">{fmtMoney(credit.limit, settings.company.currencySymbol)}</span></div>
                  <div className="flex justify-between text-gray-500 dark:text-slate-400"><span>{t('Outstanding')}</span><span className="tabular">{fmtMoney(credit.exposure, settings.company.currencySymbol)}</span></div>
                  <div className={`flex justify-between font-semibold ${credit.willExceed ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                    <span>{credit.willExceed ? t('Over limit by') : t('Available')}</span>
                    <span className="tabular">{fmtMoney(Math.abs(credit.willExceed ? credit.projected - credit.limit : credit.limit - credit.projected), settings.company.currencySymbol)}</span>
                  </div>
                  {credit.willExceed && <p className="text-[11px] text-danger-600 dark:text-danger-400">{t('This invoice would exceed the limit — you’ll be asked to confirm.')}</p>}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
