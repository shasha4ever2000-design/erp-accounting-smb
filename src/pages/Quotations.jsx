import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Trash2, FileText, ArrowRight } from 'lucide-react'

const STATUS_COLORS = {
  sent:     'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  invoiced: 'bg-gray-100 text-gray-600',
  draft:    'bg-yellow-100 text-yellow-700',
}

export default function Quotations() {
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
        subtitle={`${quotations.length} total quotations`}
        action={<Btn onClick={() => navigate('/quotations/new')}><Plus size={15} /> New Quotation</Btn>}
      />

      {/* Status tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[['all','All'], ['sent','Sent'], ['accepted','Accepted'], ['rejected','Rejected'], ['invoiced','Invoiced']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${filter === val ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300'}`}>
            {label} ({counts[val] ?? 0})
          </button>
        ))}
      </div>

      <Card>
        {quotations.length === 0 ? (
          <EmptyState icon="📋" title="No quotations yet" desc="Create quotations and estimates for your customers. Convert them to invoices with one click."
            action={<Btn onClick={() => navigate('/quotations/new')}><Plus size={14} /> New Quotation</Btn>} />
        ) : sorted.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No quotations with status "{filter}"</div>
        ) : (
          <Table headers={['Number', 'Customer', 'Date', 'Expiry', 'Status', { label: 'Total', right: true }, { label: 'Actions', right: true }]}>
            {sorted.map((q) => {
              const expired = q.expiryDate && q.expiryDate < new Date().toISOString().slice(0,10) && q.status === 'sent'
              return (
                <Tr key={q.id}>
                  <Td>
                    <span className="font-mono text-sm font-medium text-blue-600">{q.number}</span>
                  </Td>
                  <Td>
                    <p className="font-medium text-gray-800">{q.customerName}</p>
                    {q.customerEmail && <p className="text-xs text-gray-400">{q.customerEmail}</p>}
                  </Td>
                  <Td className="text-gray-500 text-sm">{fmtDate(q.date)}</Td>
                  <Td>
                    <span className={`text-sm ${expired ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
                      {q.expiryDate ? fmtDate(q.expiryDate) : '—'}
                      {expired && <span className="ml-1 text-[10px] bg-red-100 text-red-600 px-1 rounded">EXPIRED</span>}
                    </span>
                  </Td>
                  <Td>
                    <Badge className={STATUS_COLORS[q.status] || 'bg-gray-100 text-gray-600'}>
                      {q.status.charAt(0).toUpperCase() + q.status.slice(1)}
                    </Badge>
                  </Td>
                  <Td right>
                    <span className="font-semibold text-gray-800">{fmtMoney(q.total, sym)}</span>
                  </Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
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
                        <span className="text-xs text-gray-400 px-2">Converted</span>
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
