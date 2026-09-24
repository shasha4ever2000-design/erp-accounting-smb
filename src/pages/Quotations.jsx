import { useState } from 'react'
import { useT } from '../i18n'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate, statusColor } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import ConvertModal from '../components/ConvertModal'
import { docFulfillment } from '../utils/fulfillment'
import { Plus, Trash2, FileText, ArrowRight, ClipboardList } from 'lucide-react'
import { ask } from '../components/Dialogs'


export default function Quotations() {
  const t = useT()
  const navigate = useNavigate()
  const { quotations, settings, deleteQuotation, updateQuotation, convertQuotationToInvoice, convertQuotationToSalesOrder } = useStore()
  const sym = settings.company.currencySymbol
  const taxEnabled = settings.tax?.enabled !== false
  const [filter, setFilter] = useState('all')
  const [convertDoc, setConvertDoc] = useState(null)
  const [orderDoc, setOrderDoc] = useState(null)

  const filtered = filter === 'all' ? quotations : quotations.filter((q) => q.status === filter)
  const sorted   = [...filtered].sort((a, b) => b.date.localeCompare(a.date))

  const doConvert = (selections) => {
    const inv = convertQuotationToInvoice(convertDoc.id, selections)
    setConvertDoc(null)
    if (inv) navigate(`/invoices/${inv.id}`)
  }

  const doOrder = (selections) => {
    const so = convertQuotationToSalesOrder(orderDoc.id, selections)
    setOrderDoc(null)
    if (so) navigate('/sales-orders')
  }

  const handleDelete = async (q) => {
    if (await ask(`Delete quotation ${q.number}?`)) deleteQuotation(q.id)
  }

  const counts = { all: quotations.length }
  ;['sent','accepted','rejected','invoiced'].forEach((s) => {
    counts[s] = quotations.filter((q) => q.status === s).length
  })

  return (
    <div>
      <PageHeader
        title="Quotations / Estimates"
        subtitle={`${quotations.length} ${t('total quotations')}`}
        action={<Btn onClick={() => navigate('/quotations/new')}><Plus size={15} /> {t('New Quotation')}</Btn>}
      />

      {/* Status tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[['all','All'], ['sent','Sent'], ['accepted','Accepted'], ['rejected','Rejected'], ['invoiced','Invoiced']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900 ${filter === val ? 'bg-gradient-to-b from-brand-600 to-brand-700 text-white shadow-btn-primary' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-brand-300 dark:hover:border-slate-500 hover:text-slate-900 dark:hover:text-slate-100'}`}>
            {label}
            <span className={`text-xs tabular-nums font-semibold px-1.5 py-px rounded-full ${filter === val ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>{counts[val] ?? 0}</span>
          </button>
        ))}
      </div>

      <Card>
        {quotations.length === 0 ? (
          <EmptyState icon="📋" title="No quotations yet" desc="Create quotations and estimates for your customers. Convert them to invoices with one click."
            action={<Btn onClick={() => navigate('/quotations/new')}><Plus size={14} /> {t('New Quotation')}</Btn>} />
        ) : sorted.length === 0 ? (
          <div className="py-12 text-center text-slate-500 dark:text-slate-400 text-sm">No quotations with status "{filter}"</div>
        ) : (
          <Table headers={['Number', 'Customer', 'Date', 'Expiry', 'Status', { label: 'Total', right: true }, { label: 'Actions', right: true }]}>
            {sorted.map((q) => {
              const expired = q.expiryDate && q.expiryDate < new Date().toISOString().slice(0,10) && q.status === 'sent'
              return (
                <Tr key={q.id}>
                  <Td>
                    <span className="font-mono text-sm font-semibold text-brand-600 dark:text-brand-400">{q.number}</span>
                  </Td>
                  <Td>
                    <p className="font-medium text-slate-900 dark:text-slate-100">{q.customerName}</p>
                    {q.customerEmail && <p className="text-xs text-slate-500 dark:text-slate-400">{q.customerEmail}</p>}
                  </Td>
                  <Td className="text-slate-500 dark:text-slate-400 text-sm whitespace-nowrap">{fmtDate(q.date)}</Td>
                  <Td>
                    <span className={`text-sm whitespace-nowrap ${expired ? 'text-danger-600 dark:text-danger-400 font-medium' : 'text-slate-500 dark:text-slate-400'}`}>
                      {q.expiryDate ? fmtDate(q.expiryDate) : '—'}
                      {expired && <span className="ms-1.5 text-[10px] font-semibold bg-danger-100 dark:bg-danger-900/40 text-danger-600 dark:text-danger-300 px-1.5 py-px rounded-full uppercase tracking-wide">EXPIRED</span>}
                    </span>
                  </Td>
                  <Td>
                    <Badge className={statusColor(q.status)}>
                      {q.status.charAt(0).toUpperCase() + q.status.slice(1)}
                    </Badge>
                    {q.status === 'partial' && (() => { const f = docFulfillment(q.items || [], 'invoicedQty'); return <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{f.done} / {f.ordered} {t('invoiced')}</p> })()}
                  </Td>
                  <Td right>
                    <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{fmtMoney(q.total, sym)}</span>
                  </Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      <AttachmentButton entityType="quotation" entityId={q.id} />
                      {q.status !== 'invoiced' && q.status !== 'rejected' && (
                        <>
                          {q.status !== 'partial' && (
                            <Btn size="sm" variant="ghost" title="Mark Accepted" onClick={() => updateQuotation(q.id, { status: 'accepted' })}>
                              <FileText size={13} className="text-success-700 dark:text-success-400" />
                            </Btn>
                          )}
                          <Btn size="sm" variant="ghost" onClick={() => setOrderDoc(q)} title={t('Turn this quotation into a sales order')}>
                            <ClipboardList size={13} /> {t('Order')}
                          </Btn>
                          <Btn size="sm" variant="secondary" onClick={() => setConvertDoc(q)} title="Convert to Invoice">
                            <ArrowRight size={13} /> {q.status === 'partial' ? t('Invoice rest') : t('Invoice')}
                          </Btn>
                        </>
                      )}
                      {q.status === 'invoiced' && (
                        <span className="text-xs text-slate-500 dark:text-slate-400 px-2">{t('Converted')}</span>
                      )}
                      <Btn size="sm" variant="ghost" onClick={() => handleDelete(q)}>
                        <Trash2 size={13} className="text-danger-600 dark:text-danger-400" />
                      </Btn>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      <ConvertModal
        open={!!orderDoc}
        onClose={() => setOrderDoc(null)}
        doc={orderDoc}
        docKey="orderedQty"
        sym={sym}
        taxEnabled={taxEnabled}
        title={t('Turn this quotation into a sales order')}
        confirmLabel={t('Create Sales Order')}
        onConfirm={doOrder}
      />

      <ConvertModal
        open={!!convertDoc}
        onClose={() => setConvertDoc(null)}
        doc={convertDoc}
        docKey="invoicedQty"
        sym={sym}
        taxEnabled={taxEnabled}
        title={t('Convert quotation to invoice')}
        confirmLabel={t('Create Invoice')}
        onConfirm={doConvert}
      />
    </div>
  )
}
