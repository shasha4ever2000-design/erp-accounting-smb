import { useState } from 'react'
import { useT } from '../i18n'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import { Plus, Trash2, FileText, ArrowRight } from 'lucide-react'

const STATUS_COLORS = {
  sent:     'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
  accepted: 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300',
  rejected: 'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300',
  invoiced: 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300',
  draft:    'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300',
}

export default function Quotations() {
  const t = useT()
  const navigate = useNavigate()
  const { quotations, settings, deleteQuotation, updateQuotation, convertQuotationToInvoice } = useStore()
  const sym = settings.company.currencySymbol
  const [filter, setFilter] = useState('all')

  const filtered = filter === 'all' ? quotations : quotations.filter((q) => q.status === filter)
  const sorted   = [...filtered].sort((a, b) => b.date.localeCompare(a.date))

  const handleConvert = (q) => {
    if (!confirm(`Convert ${q.number} to a Sales Invoice?`)) return
    const inv = convertQuotationToInvoice(q.id)
    if (inv) navigate(`/invoices/${inv.id}`)
  }

  const handleDelete = (q) => {
    if (confirm(`Delete quotation ${q.number}?`)) deleteQuotation(q.id)
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
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900 ${filter === val ? 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-btn-primary' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-slate-500 hover:text-gray-900 dark:hover:text-slate-100'}`}>
            {label}
            <span className={`text-xs tabular-nums font-semibold px-1.5 py-px rounded-full ${filter === val ? 'bg-white/20' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'}`}>{counts[val] ?? 0}</span>
          </button>
        ))}
      </div>

      <Card>
        {quotations.length === 0 ? (
          <EmptyState icon="📋" title="No quotations yet" desc="Create quotations and estimates for your customers. Convert them to invoices with one click."
            action={<Btn onClick={() => navigate('/quotations/new')}><Plus size={14} /> {t('New Quotation')}</Btn>} />
        ) : sorted.length === 0 ? (
          <div className="py-12 text-center text-gray-400 dark:text-slate-500 text-sm">No quotations with status "{filter}"</div>
        ) : (
          <Table headers={['Number', 'Customer', 'Date', 'Expiry', 'Status', { label: 'Total', right: true }, { label: 'Actions', right: true }]}>
            {sorted.map((q) => {
              const expired = q.expiryDate && q.expiryDate < new Date().toISOString().slice(0,10) && q.status === 'sent'
              return (
                <Tr key={q.id}>
                  <Td>
                    <span className="font-mono text-sm font-semibold text-blue-600 dark:text-blue-400">{q.number}</span>
                  </Td>
                  <Td>
                    <p className="font-medium text-gray-900 dark:text-slate-100">{q.customerName}</p>
                    {q.customerEmail && <p className="text-xs text-gray-400 dark:text-slate-500">{q.customerEmail}</p>}
                  </Td>
                  <Td className="text-gray-500 dark:text-slate-400 text-sm whitespace-nowrap">{fmtDate(q.date)}</Td>
                  <Td>
                    <span className={`text-sm whitespace-nowrap ${expired ? 'text-red-500 dark:text-red-400 font-medium' : 'text-gray-500 dark:text-slate-400'}`}>
                      {q.expiryDate ? fmtDate(q.expiryDate) : '—'}
                      {expired && <span className="ms-1.5 text-[10px] font-semibold bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 px-1.5 py-px rounded-full uppercase tracking-wide">EXPIRED</span>}
                    </span>
                  </Td>
                  <Td>
                    <Badge className={STATUS_COLORS[q.status] || 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300'}>
                      {q.status.charAt(0).toUpperCase() + q.status.slice(1)}
                    </Badge>
                  </Td>
                  <Td right>
                    <span className="font-semibold text-gray-900 dark:text-slate-100 tabular-nums">{fmtMoney(q.total, sym)}</span>
                  </Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      <AttachmentButton entityType="quotation" entityId={q.id} />
                      {q.status !== 'invoiced' && q.status !== 'rejected' && (
                        <>
                          <Btn size="sm" variant="ghost" title="Mark Accepted" onClick={() => updateQuotation(q.id, { status: 'accepted' })}>
                            <FileText size={13} className="text-green-500" />
                          </Btn>
                          <Btn size="sm" variant="secondary" onClick={() => handleConvert(q)} title="Convert to Invoice">
                            <ArrowRight size={13} /> Invoice
                          </Btn>
                        </>
                      )}
                      {q.status === 'invoiced' && (
                        <span className="text-xs text-gray-400 dark:text-slate-500 px-2">Converted</span>
                      )}
                      <Btn size="sm" variant="ghost" onClick={() => handleDelete(q)}>
                        <Trash2 size={13} className="text-red-400" />
                      </Btn>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>
    </div>
  )
}
