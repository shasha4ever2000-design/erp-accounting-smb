import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { useStore } from '../store'
import { fmtMoney, fmtDate, statusColor, today } from '../utils/formatters'
import { zatcaTlvBase64, invoiceTimestamp } from '../utils/zatca'
import { Card, Btn, Badge, Modal, Input, Select } from '../components/UI'
import { ArrowLeft, DollarSign, Printer, Trash2 } from 'lucide-react'

export default function InvoiceView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { invoices, customers, accounts, deleteInvoice, recordInvoicePayment, settings } = useStore()
  const sym = settings.company.currencySymbol
  const company = settings.company

  const invoice = invoices.find((i) => i.id === id)
  const [payModal, setPayModal] = useState(false)
  const [payForm, setPayForm] = useState({ date: today(), amount: '', bankAccountId: 'acc-cash', notes: '' })
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
      <p className="text-gray-500 mb-4">Invoice not found.</p>
      <Btn variant="secondary" onClick={() => navigate('/invoices')}>Back to Invoices</Btn>
    </div>
  )

  const customer = customers.find((c) => c.id === invoice.customerId)
  const bankAccounts = accounts.filter((a) => a.type === 'asset' && (a.id === 'acc-cash' || a.id === 'acc-bank1' || a.subtype === 'current'))
  const amountDue = invoice.total - invoice.amountPaid

  const handleRecord = () => {
    const amount = parseFloat(payForm.amount)
    if (!amount || amount <= 0) return alert('Enter a valid amount.')
    if (amount > amountDue) return alert(`Amount exceeds balance due (${fmtMoney(amountDue, sym)}).`)
    recordInvoicePayment(invoice.id, { ...payForm, amount })
    setPayModal(false)
    setPayForm({ date: today(), amount: '', bankAccountId: 'acc-cash', notes: '' })
  }

  const handleDelete = () => {
    if (confirm('Delete this invoice and its journal entries?')) {
      deleteInvoice(invoice.id)
      navigate('/invoices')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate('/invoices')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft size={15} /> Back to Invoices
        </button>
        <div className="flex items-center gap-2">
          <Btn variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </Btn>
          {invoice.status !== 'paid' && (
            <Btn size="sm" onClick={() => setPayModal(true)}>
              <DollarSign size={14} /> Record Payment
            </Btn>
          )}
          <Btn variant="danger" size="sm" onClick={handleDelete}>
            <Trash2 size={14} />
          </Btn>
        </div>
      </div>

      <div className="max-w-3xl mx-auto">
        <Card className="p-8 print:shadow-none">
          {/* Header */}
          <div className="flex justify-between items-start mb-8">
            <div className="flex items-start gap-4">
              {company.logo && <img src={company.logo} alt="logo" className="h-16 w-auto object-contain" />}
              <div>
              <h1 className="text-3xl font-bold text-gray-900">{company.name}</h1>
              {company.arabicName && <p className="text-xl font-bold text-gray-800" dir="rtl">{company.arabicName}</p>}
              {company.address && <p className="text-gray-500 text-sm mt-1 whitespace-pre-line">{company.address}</p>}
              {company.phone && <p className="text-gray-400 text-sm">{company.phone}</p>}
              {company.email && <p className="text-gray-400 text-sm">{company.email}</p>}
              {zatca.enabled && zatca.vatNumber
                ? <p className="text-gray-600 text-sm font-medium mt-1">VAT No · الرقم الضريبي: {zatca.vatNumber}</p>
                : company.taxId && <p className="text-gray-400 text-sm">Tax ID: {company.taxId}</p>}
              {zatca.enabled && zatca.crNumber && <p className="text-gray-400 text-sm">CR · السجل التجاري: {zatca.crNumber}</p>}
              </div>
            </div>
            <div className="text-right">
              <p className="text-4xl font-black" style={{ color: company.accentColor || '#2563eb' }}>INVOICE</p>
              {zatca.enabled
                ? <p className="text-sm font-semibold text-gray-600" dir="rtl">فاتورة ضريبية مبسطة</p>
                : null}
              {zatca.enabled && <p className="text-xs text-gray-400">Simplified Tax Invoice</p>}
              <p className="text-2xl font-bold text-gray-800 mt-1">{invoice.number}</p>
              <Badge className={`mt-2 ${statusColor(invoice.status)}`}>
                {invoice.status.toUpperCase()}
              </Badge>
            </div>
          </div>

          {/* Billing & Dates */}
          <div className="grid grid-cols-2 gap-8 mb-8">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Bill To</p>
              <p className="font-semibold text-gray-800">{invoice.customerName}</p>
              {customer?.email && <p className="text-sm text-gray-500">{customer.email}</p>}
              {customer?.phone && <p className="text-sm text-gray-500">{customer.phone}</p>}
              {customer?.taxId && <p className="text-sm text-gray-500">Tax ID: {customer.taxId}</p>}
              {customer?.address && <p className="text-sm text-gray-400 mt-1 whitespace-pre-line">{customer.address}</p>}
            </div>
            <div className="text-right space-y-2">
              <div>
                <p className="text-xs text-gray-400">Invoice Date</p>
                <p className="font-medium text-gray-800">{fmtDate(invoice.date)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Due Date</p>
                <p className="font-medium text-gray-800">{fmtDate(invoice.dueDate)}</p>
              </div>
            </div>
          </div>

          {/* Items table */}
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase">Description</th>
                <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase">Qty</th>
                <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase">Unit Price</th>
                {invoice.taxAmount > 0 && <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase">Tax</th>}
                <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="py-3 text-gray-700">{item.description}</td>
                  <td className="py-3 text-right text-gray-600">{item.quantity}</td>
                  <td className="py-3 text-right text-gray-600">{fmtMoney(item.unitPrice, sym)}</td>
                  {invoice.taxAmount > 0 && <td className="py-3 text-right text-gray-400">{item.taxRate}%</td>}
                  <td className="py-3 text-right font-medium text-gray-800">{fmtMoney(item.subtotal, sym)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-56 space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{fmtMoney(invoice.subtotal, sym)}</span>
              </div>
              {invoice.taxAmount > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>{settings.tax.name}</span>
                  <span>{fmtMoney(invoice.taxAmount, sym)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base border-t pt-2">
                <span>Total</span>
                <span>{fmtMoney(invoice.total, sym)}</span>
              </div>
              {invoice.amountPaid > 0 && (
                <>
                  <div className="flex justify-between text-green-600">
                    <span>Amount Paid</span>
                    <span>({fmtMoney(invoice.amountPaid, sym)})</span>
                  </div>
                  <div className="flex justify-between font-bold text-orange-600 border-t pt-2">
                    <span>Balance Due</span>
                    <span>{fmtMoney(amountDue, sym)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ZATCA QR code */}
          {zatcaOn && qrUrl && (
            <div className="mt-8 pt-6 border-t border-gray-100 flex items-center justify-between">
              <div className="text-sm">
                <p className="font-semibold text-gray-700">ZATCA Compliant E-Invoice</p>
                <p className="text-gray-500" dir="rtl">فاتورة إلكترونية متوافقة مع هيئة الزكاة والضريبة والجمارك</p>
                <p className="text-xs text-gray-400 mt-1">Scan the QR code to verify this tax invoice.</p>
              </div>
              <img src={qrUrl} alt="ZATCA QR" className="w-28 h-28" />
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Notes</p>
              <p className="text-sm text-gray-600">{invoice.notes}</p>
            </div>
          )}

          {/* Payment history */}
          {invoice.payments?.length > 0 && (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-3">Payment History</p>
              <div className="space-y-2">
                {invoice.payments.map((p) => (
                  <div key={p.id} className="flex justify-between text-sm">
                    <span className="text-gray-500">{fmtDate(p.date)} — {p.number}</span>
                    <span className="font-medium text-green-600">{fmtMoney(p.amount, sym)}</span>
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
          <div className="bg-blue-50 rounded-lg p-3 text-sm">
            <span className="text-blue-700 font-medium">Balance Due: {fmtMoney(amountDue, sym)}</span>
          </div>
          <Input label="Payment Date" type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} />
          <Input label={`Amount (${sym})`} type="number" min="0.01" step="0.01" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} placeholder={`Max: ${fmtMoney(amountDue, sym)}`} />
          <Select label="Deposit To" value={payForm.bankAccountId} onChange={(e) => setPayForm((f) => ({ ...f, bankAccountId: e.target.value }))}>
            {bankAccounts.filter((a) => ['acc-cash', 'acc-bank1'].includes(a.id) || a.subtype === 'current').map((a) => (
              <option key={a.id} value={a.id}>{a.code} – {a.name}</option>
            ))}
          </Select>
          <Input label="Reference / Notes" value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Cheque #, transfer ref..." />
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setPayModal(false)}>Cancel</Btn>
            <Btn variant="success" onClick={handleRecord}>Record Payment</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
