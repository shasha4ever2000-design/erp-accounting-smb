import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate, statusColor } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td, Money } from '../components/UI'
import { useT } from '../i18n'
import ExportMenu from '../components/ExportMenu'
import { Plus, Search, FileText } from 'lucide-react'
import { todayISO } from '../utils/localDate'
import { shortcutHint } from '../components/Shortcuts'
import { documentDue } from '../utils/partyBalance'

export default function Invoices() {
  const { invoices, creditNotes, settings } = useStore()
  const navigate = useNavigate()
  const sym = settings.company.currencySymbol
  // A foreign-currency document shows its own currency code, not the base symbol.
  const docSym = (d) => (d.currency && d.currency !== settings.company.currency ? `${d.currency} ` : sym)
  const t = useT()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const today = todayISO()

  const enriched = invoices.map((inv) => ({
    ...inv,
    // Net of payments and any returns raised against it (see partyBalance).
    due: documentDue(inv, creditNotes, 'invoiceId'),
    isOverdue: inv.status !== 'paid' && inv.status !== 'cancelled' && inv.status !== 'void' && inv.dueDate && inv.dueDate < today,
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

  const exportCols = [
    { key: 'number', label: t('Invoice #') },
    { key: 'customerName', label: t('Customer') },
    { key: 'date', label: t('Date') },
    { key: 'dueDate', label: t('Due') },
    { key: 'total', label: t('Total'), right: true },
    { key: 'amountPaid', label: t('Paid'), right: true },
    { key: 'balance', label: t('Balance'), right: true, map: (_, inv) => Number(inv.due ?? (inv.total - inv.amountPaid)).toFixed(2) },
    { key: 'status', label: t('Status') },
  ]

  return (
    <div>
      <PageHeader
        title={t('Sales Invoices')}
        subtitle={`${invoices.length} ${t('invoices')} ${t('total')}`}
        action={
          <div className="flex items-center gap-2">
            {invoices.length > 0 && <ExportMenu filename="sales-invoices" title={t('Sales Invoices')} rows={sorted} columns={exportCols} />}
            <Btn onClick={() => navigate('/invoices/new')} title={t('New Invoice') + shortcutHint('/invoices/new')}>
              <Plus size={15} /> {t('New Invoice')}
            </Btn>
          </div>
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
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900 ${
              statusFilter === s.key
                ? s.red ? 'bg-gradient-to-b from-danger-500 to-danger-600 text-white shadow-sm' : 'bg-gradient-to-b from-brand-600 to-brand-700 text-white shadow-btn-primary'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-brand-300 dark:hover:border-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {t(s.label)}
            {totals[s.key] > 0 && (
              <span className={`text-xs tabular-nums font-semibold px-1.5 py-px rounded-full ${statusFilter === s.key ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                {totals[s.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 pointer-events-none" />
        <input
          className="w-full ps-9 pe-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 shadow-input dark:shadow-none transition-all duration-150 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:focus:ring-brand-400/20"
          placeholder={t('Search invoices...')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        {invoices.length === 0 ? (
          <EmptyState
            icon="📄"
            title={t('No invoices yet')}
            desc={t('Create your first sales invoice to start tracking receivables.')}
            action={<Btn onClick={() => navigate('/invoices/new')}><Plus size={14} /> {t('Create Invoice')}</Btn>}
          />
        ) : sorted.length === 0 ? (
          <div className="py-12 text-center text-slate-500 dark:text-slate-400 text-sm">{t('No invoices match your filter')}</div>
        ) : (
          <Table headers={[
            { label: t('Invoice #') },
            { label: t('Customer') },
            { label: t('Date') },
            { label: t('Due') },
            { label: t('Total'), right: true },
            { label: t('Paid'), right: true },
            { label: t('Balance'), right: true },
            { label: t('Status') },
          ]}>
            {sorted.map((inv) => {
              const status = inv.isOverdue && inv.status !== 'paid' ? 'overdue' : inv.status
              return (
                <Tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)}>
                  <Td className="font-mono font-semibold text-brand-600 dark:text-brand-400">{inv.number}</Td>
                  <Td className="font-medium text-slate-900 dark:text-slate-100">{inv.customerName}</Td>
                  <Td className="text-slate-500 dark:text-slate-400 whitespace-nowrap">{fmtDate(inv.date)}</Td>
                  <Td className={`whitespace-nowrap ${inv.isOverdue ? 'text-danger-600 dark:text-danger-400 font-medium' : 'text-slate-500 dark:text-slate-400'}`}>{fmtDate(inv.dueDate)}</Td>
                  <Td right className="font-semibold text-slate-900 dark:text-slate-100"><Money amount={inv.total} symbol={docSym(inv)} /></Td>
                  <Td right className="text-success-700 dark:text-success-400">{inv.amountPaid > 0 ? <Money amount={inv.amountPaid} symbol={docSym(inv)} /> : '—'}</Td>
                  <Td right className={inv.due > 0 ? 'text-warning-700 dark:text-warning-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}>
                    <Money amount={inv.due} symbol={docSym(inv)} />
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
