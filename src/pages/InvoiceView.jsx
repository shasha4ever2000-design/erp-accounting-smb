import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { alertIfLocked } from '../utils/periodLock'
import { useStore } from '../store'
import { fmtMoney, fmtDate, statusColor, today } from '../utils/formatters'
import { zatcaTlvBase64, invoiceTimestamp } from '../utils/zatca'
import { numberToWords } from '../utils/numberToWords'
import { DocumentHeader, DocumentFooter } from '../components/DocumentBrand'
import { Card, Btn, Badge, Modal, Input, Select } from '../components/UI'
import ConvertModal from '../components/ConvertModal'
import { lineRemaining } from '../utils/fulfillment'
import AttachmentButton from '../components/Attachments'
import { useT } from '../i18n'
import { ArrowLeft, DollarSign, Printer, Ban, RotateCcw } from 'lucide-react'

export default function InvoiceView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { settlementOffer, postSettlementDiscount, invoices, customers, accounts, deleteInvoice, voidInvoice, createSalesReturn, recordInvoicePayment, settings } = useStore()
  const t = useT()
  const sym = settings.company.currencySymbol
  const company = settings.company

  const invoice = invoices.find((i) => i.id === id)
  const [payModal, setPayModal] = useState(false)
  const [payForm, setPayForm] = useState({ date: today(), amount: '', bankAccountId: 'acc-cash', notes: '' })
  const [returnOpen, setReturnOpen] = useState(false)
  const [qrUrl, setQrUrl] = useState('')

  const zatca = settings.zatca || {}
  const zatcaOn = zatca.enabled && zatca.showQr

  useEffect(() => {
    if (!invoice || !zatcaOn) { setQrUrl(''); return }
    const payload = zatcaTlvBase64({
      sellerName: company.arabicName || company.name,
      vatNumber: zatca.vatNumber,
      timestamp: invoiceTimestamp(invoice),
      total: invoice.total,
      vatTotal: invoice.taxAmount || 0,
    })
    QRCode.toDataURL(payload, { margin: 1, width: 220 }).then(setQrUrl).catch(() => setQrUrl(''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, zatcaOn, zatca.vatNumber])

  if (!invoice) return (
    <div className="text-center py-20">
      <p className="text-gray-500 dark:text-slate-400 mb-4">{t('Invoice not found.')}</p>
      <Btn variant="secondary" onClick={() => navigate('/invoices')}>{t('Back to Invoices')}</Btn>
    </div>
  )

  const customer = customers.find((c) => c.id === invoice.customerId)
  const bankAccounts = accounts.filter((a) => a.type === 'asset' && (a.id === 'acc-cash' || a.id === 'acc-bank1' || a.subtype === 'current'))
  const amountDue = invoice.total - invoice.amountPaid
  // Foreign-currency invoice: amounts show in the invoice currency; the receipt can
  // settle at a different rate, producing a realized FX gain/loss in the base ledger.
  const baseSym = settings.company.currencySymbol
  const invIsFC = invoice.currency && invoice.currency !== settings.company.currency
  const invSym = invIsFC ? `${invoice.currency} ` : baseSym
  const invRate = Number(invoice.exchangeRate) || 1
  // What the customer would pay if they settled on the chosen date, and what
  // the early-settlement discount is worth. Recomputed as the date changes,
  // because the whole point is that the offer expires.
  const offer = useMemo(
    () => (payModal ? settlementOffer(invoice.id, payForm.date) : null),
    [payModal, payForm.date, invoice.id, invoice.amountPaid, settlementOffer]
  )

  const takeDiscount = () => {
    try {
      const res = postSettlementDiscount(invoice.id, payForm.date)
      setPayForm((f) => ({ ...f, amount: String(res.amountToPay) }))
    } catch (e) {
      alert(String(e.message || e).replace('DISCOUNT_NOT_AVAILABLE:', t('No discount is available: ')))
    }
  }

  const openPay = () => { setPayForm({ date: today(), amount: '', bankAccountId: 'acc-cash', notes: '', exchangeRate: invRate }); setPayModal(true) }
  // Show the VAT column whenever any line carries VAT or a non-standard category
  // (zero-rated / exempt supplies must still be indicated on a ZATCA tax invoice).
  const showTaxCol = (invoice.taxAmount || 0) > 0 || (invoice.items || []).some((l) => l.taxCategory && l.taxCategory !== 'standard')
  const lineTaxLabel = (item) => item.taxCategory === 'zero' ? t('Zero-rated') : item.taxCategory === 'exempt' ? t('Exempt') : `${item.taxRate || 0}%`
  const anyDiscount = (invoice.items || []).some((l) => (Number(l.discount) || 0) > 0)
  const grossSubtotal = (invoice.items || []).reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0)
  const invDiscount = Math.round((grossSubtotal - (invoice.subtotal || 0)) * 100) / 100
  const canReturn = invoice.status !== 'void' && (invoice.items || []).some((l) => lineRemaining(l, 'returnedQty') > 1e-6)
  const doReturn = (selections) => {
    const reason = window.prompt(t('Reason for the return? (a credit note will be raised and stock restocked)')) || ''
    try { createSalesReturn(invoice.id, selections, { reason }) } catch (e) { if (alertIfLocked(e, t)) return; throw e }
    setReturnOpen(false)
  }

  const handleRecord = () => {
    const amount = parseFloat(payForm.amount)
    if (!amount || amount <= 0) return alert('Enter a valid amount.')
    if (amount > amountDue) return alert(`Amount exceeds balance due (${fmtMoney(amountDue, invSym)}).`)
    try { recordInvoicePayment(invoice.id, { ...payForm, amount }) }
    catch (e) { if (alertIfLocked(e, t)) return; throw e }
    setPayModal(false)
    setPayForm({ date: today(), amount: '', bankAccountId: 'acc-cash', notes: '' })
  }

  const handleVoid = () => {
    const reason = window.prompt(t('Reason for voiding this invoice? (posts reversing entries — the invoice is kept for the audit trail)'))
    if (reason === null) return
    try { voidInvoice(invoice.id, { reason }) }
    catch (e) { if (alertIfLocked(e, t)) return; throw e }
  }

  // Deleting is only for drafts with no financial history; issued invoices are voided.
  const handleDelete = () => {
    if (confirm('Delete this draft invoice and its journal entries?')) {
      try { deleteInvoice(invoice.id) }
      catch (e) { if (alertIfLocked(e, t)) return; throw e }
      navigate('/invoices')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 no-print">
        <button onClick={() => navigate('/invoices')} className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-100">
          <ArrowLeft size={15} /> {t('Back to Invoices')}
        </button>
        <div className="flex items-center gap-2">
          <AttachmentButton entityType="invoice" entityId={invoice.id} label="Attachments" />
          <Btn variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer size={14} /> {t('Download PDF')}
          </Btn>
          {invoice.status !== 'paid' && invoice.status !== 'void' && (
            <Btn size="sm" onClick={openPay}>
              <DollarSign size={14} /> {t('Record Payment')}
            </Btn>
          )}
          {canReturn && (
            <Btn variant="secondary" size="sm" onClick={() => setReturnOpen(true)} title={t('Return / refund')}>
              <RotateCcw size={14} /> {t('Return')}
            </Btn>
          )}
          {invoice.status !== 'void' && (
            <Btn variant="secondary" size="sm" onClick={handleVoid} title={t('Void')}>
              <Ban size={14} /> {t('Void')}
            </Btn>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto">
        <Card className="p-8 print:shadow-none">
          {/* Header — layout, logo and accent come from Settings › Branding */}
          <DocumentHeader
            docType="invoice"
            title="INVOICE"
            right={
              <div className="text-end">
                {zatca.enabled && (
                  <>
                    <p className="text-sm font-semibold text-gray-600 dark:text-slate-300" dir="rtl">فاتورة ضريبية مبسطة</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500">{t('Simplified Tax Invoice')}</p>
                  </>
                )}
                <p className="text-2xl font-bold text-gray-800 dark:text-slate-100 mt-1">{invoice.number}</p>
                <Badge className={`mt-2 ${statusColor(invoice.status)}`}>
                  {invoice.status.toUpperCase()}
                </Badge>
                {zatca.enabled && zatca.crNumber && (
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">CR · السجل التجاري: {zatca.crNumber}</p>
                )}
              </div>
            }
          />

          {/* Billing & Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-8">
            <div>
              <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-2">Bill To</p>
              <p className="font-semibold text-gray-800 dark:text-slate-100">{invoice.customerName}</p>
              {customer?.email && <p className="text-sm text-gray-500 dark:text-slate-400">{customer.email}</p>}
              {customer?.phone && <p className="text-sm text-gray-500 dark:text-slate-400">{customer.phone}</p>}
              {customer?.taxId && <p className="text-sm text-gray-500 dark:text-slate-400">Tax ID: {customer.taxId}</p>}
              {customer?.address && <p className="text-sm text-gray-400 dark:text-slate-500 mt-1 whitespace-pre-line">{customer.address}</p>}
            </div>
            <div className="text-right space-y-2">
              <div>
                <p className="text-xs text-gray-400 dark:text-slate-500">{t('Invoice Date')}</p>
                <p className="font-medium text-gray-800 dark:text-slate-100">{fmtDate(invoice.date)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-slate-500">{t('Due Date')}</p>
                <p className="font-medium text-gray-800 dark:text-slate-100">{fmtDate(invoice.dueDate)}</p>
              </div>
              {invoice.salesRepId && (settings.salesReps || []).find((r) => r.id === invoice.salesRepId) && (
                <div>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{t('Sales Rep')}</p>
                  <p className="font-medium text-gray-800 dark:text-slate-100">{(settings.salesReps || []).find((r) => r.id === invoice.salesRepId).name}</p>
                </div>
              )}
            </div>
          </div>

          {/* Items table */}
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b-2 border-gray-200 dark:border-surface-700">
                <th className="text-left py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Description')}</th>
                <th className="text-right py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Qty</th>
                <th className="text-right py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Unit Price')}</th>
                {anyDiscount && <th className="text-right py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Disc %')}</th>}
                {showTaxCol && <th className="text-right py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('VAT')}</th>}
                <th className="text-right py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Amount')}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id} className="border-b border-gray-100 dark:border-surface-750">
                  <td className="py-3 text-gray-700 dark:text-slate-200">{item.description}</td>
                  <td className="py-3 text-right text-gray-600 dark:text-slate-300">{item.quantity}</td>
                  <td className="py-3 text-right text-gray-600 dark:text-slate-300">{fmtMoney(item.unitPrice, invSym)}</td>
                  {anyDiscount && <td className="py-3 text-right text-gray-500 dark:text-slate-400">{(Number(item.discount) || 0) > 0 ? `${item.discount}%` : '—'}</td>}
                  {showTaxCol && <td className="py-3 text-right text-gray-400 dark:text-slate-500">{lineTaxLabel(item)}</td>}
                  <td className="py-3 text-right font-medium text-gray-800 dark:text-slate-100">{fmtMoney(item.subtotal, invSym)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-56 space-y-2 text-sm">
              {invDiscount > 0.005 && (
                <div className="flex justify-between text-gray-600 dark:text-slate-300">
                  <span>Subtotal</span>
                  <span>{fmtMoney(grossSubtotal, invSym)}</span>
                </div>
              )}
              {invDiscount > 0.005 && (
                <div className="flex justify-between text-green-600 dark:text-green-400">
                  <span>{t('Discount')}</span>
                  <span>− {fmtMoney(invDiscount, invSym)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-600 dark:text-slate-300">
                <span>{invDiscount > 0.005 ? t('Net Subtotal') : 'Subtotal'}</span>
                <span>{fmtMoney(invoice.subtotal, invSym)}</span>
              </div>
              {(invoice.docDiscountAmount || 0) > 0.005 && (
                <div className="flex justify-between text-green-600 dark:text-green-400">
                  <span>{t('Invoice discount')}{invoice.docDiscount ? ` (${invoice.docDiscount}%)` : ''}</span>
                  <span>− {fmtMoney(invoice.docDiscountAmount, invSym)}</span>
                </div>
              )}
              {(invoice.shipping || 0) > 0.005 && (
                <div className="flex justify-between text-gray-600 dark:text-slate-300">
                  <span>{t('Shipping')}</span>
                  <span>{fmtMoney(invoice.shipping, invSym)}</span>
                </div>
              )}
              {invoice.taxAmount > 0 && (
                <div className="flex justify-between text-gray-600 dark:text-slate-300">
                  <span>{settings.tax.name}</span>
                  <span>{fmtMoney(invoice.taxAmount, invSym)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base border-t border-slate-200 dark:border-surface-700 pt-2">
                <span>Total</span>
                <span>{fmtMoney(invoice.total, invSym)}</span>
              </div>
              {invoice.amountPaid > 0 && (
                <>
                  <div className="flex justify-between text-green-600 dark:text-green-400">
                    <span>{t('Amount Paid')}</span>
                    <span>({fmtMoney(invoice.amountPaid, invSym)})</span>
                  </div>
                  <div className="flex justify-between font-bold text-orange-600 dark:text-orange-400 border-t border-slate-200 dark:border-surface-700 pt-2">
                    <span>{t('Balance Due')}</span>
                    <span>{fmtMoney(amountDue, invSym)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Amount in words */}
          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-surface-750">
            <p className="text-xs text-gray-500 dark:text-slate-400">
              <span className="font-semibold">Amount in words:</span> {numberToWords(invoice.total)} {invoice.currency || company.currency} only
            </p>
          </div>

          {/* ZATCA QR code */}
          {zatcaOn && qrUrl && (
            <div className="mt-8 pt-6 border-t border-gray-100 dark:border-surface-750 flex items-center justify-between">
              <div className="text-sm">
                <p className="font-semibold text-gray-700 dark:text-slate-200">{t('ZATCA Compliant E-Invoice')}</p>
                <p className="text-gray-500 dark:text-slate-400" dir="rtl">فاتورة إلكترونية متوافقة مع هيئة الزكاة والضريبة والجمارك</p>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{t('Scan the QR code to verify this tax invoice.')}</p>
              </div>
              <img src={qrUrl} alt="ZATCA QR" className="w-28 h-28" />
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div className="mt-6 pt-6 border-t border-gray-100 dark:border-surface-750">
              <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase mb-1">Notes</p>
              <p className="text-sm text-gray-600 dark:text-slate-300">{invoice.notes}</p>
            </div>
          )}

          {/* Payment details, terms, signature and footer — all from Branding.
              Bank details still come from the invoice settings, since that is
              where they have always been kept. */}
          <DocumentFooter docType="invoice" bankDetails={settings.invoice?.bankDetails} />

          {/* Payment history */}
          {invoice.payments?.length > 0 && (
            <div className="mt-6 pt-6 border-t border-gray-100 dark:border-surface-750">
              <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase mb-3">{t('Payment History')}</p>
              <div className="space-y-2">
                {invoice.payments.map((p) => (
                  <div key={p.id} className="flex justify-between text-sm">
                    <span className="text-gray-500 dark:text-slate-400">{fmtDate(p.date)} — {p.number}</span>
                    <span className="font-medium text-green-600 dark:text-green-400">{fmtMoney(p.amount, invSym)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Payment Modal */}
      <Modal open={payModal} onClose={() => setPayModal(false)} title="Record Payment">
        <div className="space-y-4">
          <div className="bg-brand-50 dark:bg-brand-500/10 rounded-lg p-3 text-sm">
            <span className="text-blue-700 dark:text-blue-400 font-medium">Balance Due: {fmtMoney(amountDue, invSym)}</span>
          </div>
          <Input label="Payment Date" type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} />
          {offer?.eligible && (
            <div className="rounded-lg p-3.5 bg-success-50/70 dark:bg-success-500/[0.08] ring-1 ring-inset ring-success-500/25">
              <p className="text-sm font-semibold text-success-800 dark:text-success-200">
                {t('Early-settlement discount available until {d}').replace('{d}', fmtDate(offer.deadline))}
              </p>
              <div className="text-sm text-success-800/90 dark:text-success-200/90 mt-1.5 space-y-0.5">
                <p>{t('Discount')}: <span className="tabular-nums font-medium">{fmtMoney(offer.discountNet, invSym)}</span>
                  {offer.discountTax > 0 && <> + <span className="tabular-nums font-medium">{fmtMoney(offer.discountTax, invSym)}</span> {t('tax reversed')}</>}
                </p>
                <p>{t('They pay')}: <span className="tabular-nums font-semibold">{fmtMoney(offer.amountToPay, invSym)}</span></p>
              </div>
              <Btn size="sm" className="mt-2.5" onClick={takeDiscount}>{t('Allow the discount')}</Btn>
              <p className="text-xs text-success-700/80 dark:text-success-300/70 mt-1.5">
                {t('This writes the discount off and reduces the tax you owe on the supply, then fills in what is left to collect.')}
              </p>
            </div>
          )}
          <Input label={`Amount (${invSym.trim()})`} type="number" min="0.01" step="0.01" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} placeholder={`Max: ${fmtMoney(amountDue, invSym)}`} />
          {invIsFC && (
            <div className="space-y-1">
              <Input label={t('Exchange rate at payment (1 {c} = ? {b})').replace('{c}', invoice.currency).replace('{b}', settings.company.currency)}
                type="number" min="0" step="0.000001" value={payForm.exchangeRate ?? invRate}
                onChange={(e) => setPayForm((f) => ({ ...f, exchangeRate: e.target.value }))} />
              <p className="text-xs text-gray-400 dark:text-slate-500">
                ≈ {fmtMoney((parseFloat(payForm.amount) || 0) * (Number(payForm.exchangeRate) || invRate), baseSym)} {t('into bank')} · {t('booked at')} {invRate} → {t('difference is realized FX')}
              </p>
            </div>
          )}
          <Select label="Deposit To" value={payForm.bankAccountId} onChange={(e) => setPayForm((f) => ({ ...f, bankAccountId: e.target.value }))}>
            {bankAccounts.filter((a) => ['acc-cash', 'acc-bank1'].includes(a.id) || a.subtype === 'current').map((a) => (
              <option key={a.id} value={a.id}>{a.code} – {a.name}</option>
            ))}
          </Select>
          <Input label="Reference / Notes" value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Cheque #, transfer ref..." />
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setPayModal(false)}>{t('Cancel')}</Btn>
            <Btn variant="success" onClick={handleRecord}>{t('Record Payment')}</Btn>
          </div>
        </div>
      </Modal>

      <ConvertModal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        doc={invoice}
        docKey="returnedQty"
        sym={invSym}
        taxEnabled={(invoice.taxAmount || 0) > 0}
        title={t('Return items')}
        confirmLabel={t('Create Credit Note')}
        onConfirm={doReturn}
      />
    </div>
  )
}
