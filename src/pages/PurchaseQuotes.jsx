import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td, Modal, Input, Select } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import ConvertModal from '../components/ConvertModal'
import { Plus, Trash2, FileQuestion, ArrowRight, Scale, AlertTriangle } from 'lucide-react'

const STATUS_COLORS = {
  open:    'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
  partial: 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300',
  ordered: 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300',
}

const today = () => new Date().toISOString().slice(0, 10)
const emptyLine = () => ({ id: `l${Math.random().toString(16).slice(2)}`, description: '', quantity: 1, unitPrice: 0, taxRate: 0 })
const emptyForm = () => ({ supplierId: '', date: today(), validUntil: '', reference: '', notes: '', items: [emptyLine()] })

export default function PurchaseQuotes() {
  const t = useT()
  const navigate = useNavigate()
  const {
    purchaseQuotes = [], suppliers, settings,
    addPurchaseQuote, deletePurchaseQuote, convertPurchaseQuoteToOrder,
  } = useStore()
  const sym = settings.company.currencySymbol
  const taxEnabled = settings.tax?.enabled !== false

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [error, setError] = useState('')
  const [convertDoc, setConvertDoc] = useState(null)
  const [compare, setCompare] = useState(false)

  const sorted = useMemo(
    () => [...purchaseQuotes].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [purchaseQuotes]
  )

  // The point of collecting quotes is putting them side by side, so the same
  // thing quoted by three suppliers can actually be compared.
  const comparison = useMemo(() => {
    const map = {}
    purchaseQuotes.forEach((q) => {
      ;(q.items || []).forEach((l) => {
        const key = String(l.description || '').trim().toLowerCase()
        if (!key) return
        if (!map[key]) map[key] = { description: l.description, offers: [] }
        map[key].offers.push({
          quoteId: q.id, number: q.number, supplier: q.supplierName,
          unitPrice: Number(l.unitPrice) || 0, quantity: Number(l.quantity) || 0,
        })
      })
    })
    return Object.values(map)
      .filter((r) => r.offers.length > 1)
      .map((r) => {
        const sortedOffers = [...r.offers].sort((a, b) => a.unitPrice - b.unitPrice)
        return { ...r, offers: sortedOffers, best: sortedOffers[0] }
      })
  }, [purchaseQuotes])

  const setLine = (idx, patch) =>
    setForm((f) => ({ ...f, items: f.items.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }))

  const totals = useMemo(() => {
    const subtotal = form.items.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0)
    const taxAmount = taxEnabled
      ? form.items.reduce((s, l) => s + ((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * (Number(l.taxRate) || 0)) / 100, 0)
      : 0
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      taxAmount: Math.round(taxAmount * 100) / 100,
      total: Math.round((subtotal + taxAmount) * 100) / 100,
    }
  }, [form.items, taxEnabled])

  const save = () => {
    const supplier = suppliers.find((s) => s.id === form.supplierId)
    if (!supplier) return setError(t('Choose which supplier quoted.'))
    const items = form.items
      .filter((l) => String(l.description || '').trim() && (Number(l.quantity) || 0) > 0)
      .map((l) => ({
        ...l,
        quantity: Number(l.quantity) || 0,
        unitPrice: Number(l.unitPrice) || 0,
        taxRate: Number(l.taxRate) || 0,
        subtotal: Math.round((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * 100) / 100,
      }))
    if (!items.length) return setError(t('Add at least one line with a description and a quantity.'))

    addPurchaseQuote({
      supplierId: supplier.id, supplierName: supplier.name,
      date: form.date, validUntil: form.validUntil, reference: form.reference, notes: form.notes,
      items, ...totals,
    })
    setModal(false)
    setForm(emptyForm())
    setError('')
  }

  const doConvert = (selections) => {
    const po = convertPurchaseQuoteToOrder(convertDoc.id, selections)
    setConvertDoc(null)
    if (po) navigate('/purchase-orders')
  }

  const handleDelete = (q) => {
    if (confirm(t('Delete purchase quote {n}?').replace('{n}', q.number))) deletePurchaseQuote(q.id)
  }

  return (
    <div>
      <PageHeader
        title="Purchase Quotes"
        subtitle="What suppliers say they will charge, before anything is committed"
        action={
          <>
            {comparison.length > 0 && (
              <Btn variant="secondary" onClick={() => setCompare((c) => !c)}>
                <Scale size={15} /> {compare ? t('Hide comparison') : t('Compare prices')}
              </Btn>
            )}
            <Btn onClick={() => { setForm(emptyForm()); setError(''); setModal(true) }}>
              <Plus size={15} /> {t('New Quote')}
            </Btn>
          </>
        }
      />

      <Card className="p-4 mb-6 text-sm text-gray-600 dark:text-slate-300">
        {t('Asking three suppliers for a price creates no liability, so a quote posts nothing. Only the one you turn into a purchase order commits you — and even that is a commitment, not a liability, until the bill arrives.')}
      </Card>

      {compare && comparison.length > 0 && (
        <Card className="overflow-hidden mb-6">
          <div className="p-4 border-b border-gray-100 dark:border-surface-750">
            <h3 className="font-semibold text-gray-800 dark:text-slate-100">{t('Same item, different suppliers')}</h3>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              {t('Matched on the line description, cheapest first.')}
            </p>
          </div>
          <Table headers={['Item', 'Supplier', 'Unit price', 'Difference']}>
            {comparison.flatMap((row) =>
              row.offers.map((o, i) => (
                <Tr key={`${row.description}:${o.quoteId}`}>
                  <Td className="text-gray-700 dark:text-slate-200">{i === 0 ? row.description : ''}</Td>
                  <Td>
                    {o.supplier}
                    {i === 0 && (
                      <Badge className="ms-2 bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300">
                        {t('cheapest')}
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-end tabular-nums">{fmtMoney(o.unitPrice, sym)}</Td>
                  <Td className="text-end tabular-nums text-gray-500 dark:text-slate-400">
                    {i === 0 ? '—' : `+${fmtMoney(o.unitPrice - row.best.unitPrice, sym)}`}
                  </Td>
                </Tr>
              ))
            )}
          </Table>
        </Card>
      )}

      <Card className="overflow-hidden">
        {sorted.length === 0 ? (
          <EmptyState
            icon={<FileQuestion size={28} className="text-slate-400 dark:text-slate-500" />}
            title="No purchase quotes"
            desc="Record what each supplier offered, compare them side by side, then turn the one you want into a purchase order."
            action={<Btn onClick={() => { setForm(emptyForm()); setModal(true) }}><Plus size={14} /> {t('New Quote')}</Btn>}
          />
        ) : (
          <Table headers={['Number', 'Supplier', 'Date', 'Valid until', 'Status', 'Total', '']}>
            {sorted.map((q) => (
              <Tr key={q.id}>
                <Td className="font-mono font-semibold text-gray-800 dark:text-slate-100">{q.number}</Td>
                <Td className="text-gray-700 dark:text-slate-200">{q.supplierName}</Td>
                <Td className="text-gray-500 dark:text-slate-400 whitespace-nowrap">{fmtDate(q.date)}</Td>
                <Td className="text-gray-500 dark:text-slate-400 whitespace-nowrap">{q.validUntil ? fmtDate(q.validUntil) : '—'}</Td>
                <Td><Badge className={STATUS_COLORS[q.status] || STATUS_COLORS.open}>{t(q.status)}</Badge></Td>
                <Td className="text-end tabular-nums font-medium text-gray-800 dark:text-slate-100">{fmtMoney(q.total, sym)}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <AttachmentButton entityType="purchaseQuote" entityId={q.id} />
                    {q.status !== 'ordered' && (
                      <Btn size="sm" variant="secondary" onClick={() => setConvertDoc(q)}>
                        {t('Order')} <ArrowRight size={13} />
                      </Btn>
                    )}
                    <Btn size="sm" variant="ghost" onClick={() => handleDelete(q)}>
                      <Trash2 size={13} className="text-red-400" />
                    </Btn>
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {/* New quote */}
      <Modal open={modal} onClose={() => setModal(false)} title="New Purchase Quote" width="max-w-3xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select label={t('Supplier *')} value={form.supplierId} onChange={(e) => { setForm((f) => ({ ...f, supplierId: e.target.value })); setError('') }}>
              <option value="">{t('— Choose —')}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Input label={t('Their reference')} value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
            <Input label={t('Date')} type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            <Input label={t('Valid until')} type="date" value={form.validUntil} onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))} />
          </div>

          <div>
            <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300 mb-2">{t('What they quoted')}</p>
            <div className="space-y-2">
              {form.items.map((l, idx) => (
                <div key={l.id} className="flex items-center gap-2">
                  <input value={l.description} placeholder={t('Description')}
                    onChange={(e) => setLine(idx, { description: e.target.value })}
                    className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300/90 dark:border-surface-600" />
                  <input type="number" min="0" step="any" value={l.quantity} title={t('Quantity')}
                    onChange={(e) => setLine(idx, { quantity: e.target.value })}
                    className="w-20 border rounded-lg px-2 py-2 text-sm text-end tabular-nums bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300/90 dark:border-surface-600" />
                  <input type="number" min="0" step="any" value={l.unitPrice} title={t('Unit price')}
                    onChange={(e) => setLine(idx, { unitPrice: e.target.value })}
                    className="w-28 border rounded-lg px-2 py-2 text-sm text-end tabular-nums bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300/90 dark:border-surface-600" />
                  {taxEnabled && (
                    <input type="number" min="0" step="any" value={l.taxRate} title={t('Tax %')}
                      onChange={(e) => setLine(idx, { taxRate: e.target.value })}
                      className="w-16 border rounded-lg px-2 py-2 text-sm text-end tabular-nums bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300/90 dark:border-surface-600" />
                  )}
                  <button type="button" title={t('Remove')}
                    onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">×</button>
                </div>
              ))}
            </div>
            <Btn size="sm" variant="secondary" className="mt-2"
              onClick={() => setForm((f) => ({ ...f, items: [...f.items, emptyLine()] }))}>
              + {t('Add line')}
            </Btn>
          </div>

          <div className="flex justify-end gap-6 text-sm border-t border-gray-100 dark:border-surface-750 pt-3">
            <span className="text-gray-500 dark:text-slate-400">{t('Subtotal')} <span className="font-medium text-gray-800 dark:text-slate-100 tabular-nums">{fmtMoney(totals.subtotal, sym)}</span></span>
            {taxEnabled && <span className="text-gray-500 dark:text-slate-400">{t('Tax')} <span className="font-medium text-gray-800 dark:text-slate-100 tabular-nums">{fmtMoney(totals.taxAmount, sym)}</span></span>}
            <span className="font-semibold text-gray-800 dark:text-slate-100">{t('Total')} <span className="tabular-nums">{fmtMoney(totals.total, sym)}</span></span>
          </div>

          {error && (
            <p className="text-sm text-rose-600 dark:text-rose-400 flex items-start gap-2">
              <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={save}>{t('Save Quote')}</Btn>
          </div>
        </div>
      </Modal>

      <ConvertModal
        open={!!convertDoc} onClose={() => setConvertDoc(null)} doc={convertDoc}
        docKey="orderedQty" sym={sym} taxEnabled={taxEnabled}
        title={t('Turn this quote into a purchase order')} confirmLabel={t('Create Purchase Order')} onConfirm={doConvert}
      />
    </div>
  )
}
