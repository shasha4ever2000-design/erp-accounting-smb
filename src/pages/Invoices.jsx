import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate, statusColor } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Search, FileText } from 'lucide-react'

export default function Invoices() {
  const { invoices, settings } = useStore()
  const navigate = useNavigate()
  const sym = settings.company.currencySymbol
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const today = new Date().toISOString().slice(0, 10)

  const enriched = invoices.map((inv) => ({
    ...inv,
    isOverdue: inv.status !== 'paid' && inv.status !== 'cancelled' && inv.dueDate && inv.dueDate < today,
  }))

  const filtered = enriched.filter((inv) => {
    const matchSearch = !search || inv.number.toLowerCase().includes(search.toLowerCase()) || inv.customerName?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || inv.status === statusFilter || (statusFilter === 'overdue' && inv.isOverdue)
    return matchSearch && matchStatus
  })

  const sorted = [...filtered].sort((a, b) => b.createdAt?.localeCompare(a.createdAt))

  const totals = {
    all: invoices.length,
    sent: invoices.filter((i) => i.status === 'sent').length,
    partial: invoices.filter((i) => i.status === 'partial').length,
    overdue: enriched.filter((i) => i.isOverdue).length,
    paid: invoices.filter((i) => i.status === 'paid').length,
  }

  return (
    <div>
      <PageHeader
        title="Sales Invoices"
        subtitle={`${invoices.length} invoice${invoices.length !== 1 ? 's' : ''} total`}
        action={
          <Btn onClick={() => navigate('/invoices/new')}>
            <Plus size={15} /> New Invoice
          </Btn>
        }
      />

      {/* Status tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {[
          { key: 'all', label: 'All' },
          { key: 'sent', label: 'Sent' },
          { key: 'partial', label: 'Partial' },
          { key: 'overdue', label: 'Overdue', red: true },
          { key: 'paid', label: 'Paid' },
        ].map((s) => (
          <button
            key={s.key}
            onClick={() => setStatusFilter(s.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === s.key
                ? s.red ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300'
            }`}
          >
            {s.label}
            {totals[s.key] > 0 && (
              <span className={`text-xs ${statusFilter === s.key ? 'opacity-75' : 'text-gray-400'}`}>
                {totals[s.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
        <input
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search invoices..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        {invoices.length === 0 ? (
          <EmptyState
            icon="📄"
            title="No invoices yet"
            desc="Create your first sales invoice to start tracking receivables."
            action={<Btn onClick={() => navigate('/invoices/new')}><Plus size={14} /> Create Invoice</Btn>}
          />
        ) : sorted.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No invoices match your filter</div>
        ) : (
          <Table headers={[
            { label: 'Invoice #' },
            { label: 'Customer' },
            { label: 'Date' },
            { label: 'Due' },
            { label: 'Total', right: true },
            { label: 'Paid', right: true },
            { label: 'Balance', right: true },
            { label: 'Status' },
          ]}>
            {sorted.map((inv) => {
              const status = inv.isOverdue && inv.status !== 'paid' ? 'overdue' : inv.status
              return (
                <Tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)}>
                  <Td className="font-mono font-semibold text-blue-600">{inv.number}</Td>
                  <Td className="font-medium text-gray-800">{inv.customerName}</Td>
                  <Td className="text-gray-500">{fmtDate(inv.date)}</Td>
                  <Td className={inv.isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'}>{fmtDate(inv.dueDate)}</Td>
                  <Td right className="font-semibold text-gray-800">{fmtMoney(inv.total, sym)}</Td>
                  <Td right className="text-green-600">{inv.amountPaid > 0 ? fmtMoney(inv.amountPaid, sym) : '—'}</Td>
                  <Td right className={inv.total - inv.amountPaid > 0 ? 'text-orange-600 font-semibold' : 'text-gray-400'}>
                    {fmtMoney(inv.total - inv.amountPaid, sym)}
                  </Td>
                  <Td>
                    <Badge className={statusColor(status)}>{status}</Badge>
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
