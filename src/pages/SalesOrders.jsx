import { useState } from 'react'
import { useT } from '../i18n'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import ConvertModal from '../components/ConvertModal'
import { docFulfillment } from '../utils/fulfillment'
import { Trash2, ClipboardList, ArrowRight, Truck, FileText } from 'lucide-react'

const STATUS_COLORS = {
  open:     'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
  partial:  'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300',
  invoiced: 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300',
  cancelled:'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300',
}

export default function SalesOrders() {
  const t = useT()
  const navigate = useNavigate()
  const {
    salesOrders = [], settings, deleteSalesOrder,
    convertSalesOrderToInvoice, convertSalesOrderToDeliveryNote,
  } = useStore()
  const sym = settings.company.currencySymbol
  const taxEnabled = settings.tax?.enabled !== false

  const [filter, setFilter] = useState('all')
  const [invoiceDoc, setInvoiceDoc] = useState(null)
  const [deliverDoc, setDeliverDoc] = useState(null)

  const filtered = filter === 'all' ? salesOrders : salesOrders.filter((o) => o.status === filter)
  const sorted = [...filtered].sort((a, b) => String(b.date).localeCompare(String(a.date)))

  // What is committed but not yet billed — the number a sales manager is
  // actually watching, and the reason this document exists at all.
  const openValue = salesOrders
    .filter((o) => o.status !== 'invoiced' && o.status !== 'cancelled')
    .reduce((s, o) => {
      const billed = (o.items || []).reduce((t, l) => t + (Number(l.invoicedQty) || 0) * (Number(l.unitPrice) || 0), 0)
      return s + Math.max(0, (Number(o.total) || 0) - billed)
    }, 0)

  const doInvoice = (selections) => {
    const inv = convertSalesOrderToInvoice(invoiceDoc.id, selections)
    setInvoiceDoc(null)
    if (inv) navigate(`/invoices/${inv.id}`)
  }
  const doDeliver = (selections) => {
    convertSalesOrderToDeliveryNote(deliverDoc.id, selections)
    setDeliverDoc(null)
    navigate('/delivery-notes')
  }

  const handleDelete = (o) => {
    if (confirm(t('Delete sales order {n}?').replace('{n}', o.number))) deleteSalesOrder(o.id)
  }

  const counts = { all: salesOrders.length }
  ;['open', 'partial', 'invoiced'].forEach((s) => {
    counts[s] = salesOrders.filter((o) => o.status === s).length
  })

  return (
    <div>
      <PageHeader
        title="Sales Orders"
        subtitle="Confirmed orders that have not been delivered or billed yet"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Open orders" value={String(counts.open + counts.partial)} icon={<ClipboardList size={18} />} color="blue" />
        <StatCard label="Yet to be billed" value={fmtMoney(openValue, sym)} icon={<FileText size={18} />} color="orange" />
        <StatCard label="Total orders" value={String(salesOrders.length)} icon={<ArrowRight size={18} />} color="purple" />
      </div>

      <Card className="p-4 mb-6 text-sm text-gray-600 dark:text-slate-300">
        {t('A sales order records what a customer has committed to buy. It posts nothing to the ledger — revenue is earned when the goods go out or the invoice is raised, not when the order is taken. Create one from an accepted quotation.')}
      </Card>

      <div className="flex gap-2 mb-4 flex-wrap">
        {[['all', 'All'], ['open', 'Open'], ['partial', 'Partly billed'], ['invoiced', 'Billed']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 ${filter === val ? 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-btn-primary' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-slate-500'}`}>
            {t(label)} <span className="opacity-70 text-xs">{counts[val] ?? 0}</span>
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {sorted.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={28} className="text-slate-400 dark:text-slate-500" />}
            title="No sales orders"
            desc="Accept a quotation and turn it into an order — the order then keeps track of what is still to ship and what is left to bill."
            action={<Btn onClick={() => navigate('/quotations')}>{t('Go to quotations')}</Btn>}
          />
        ) : (
          <Table headers={['Number', 'Customer', 'Date', 'Delivered', 'Billed', 'Total', '']}>
            {sorted.map((o) => {
              const shipped = docFulfillment(o.items || [], 'deliveredQty')
              const billed = docFulfillment(o.items || [], 'invoicedQty')
              const done = billed.status === 'complete'
              return (
                <Tr key={o.id}>
                  <Td className="font-mono font-semibold text-gray-800 dark:text-slate-100">{o.number}</Td>
                  <Td className="text-gray-700 dark:text-slate-200">{o.customerName}</Td>
                  <Td className="text-gray-500 dark:text-slate-400 whitespace-nowrap">{fmtDate(o.date)}</Td>
                  <Td className="text-xs text-gray-500 dark:text-slate-400">{Math.round(shipped.pct || 0)}%</Td>
                  <Td>
                    <Badge className={STATUS_COLORS[o.status] || STATUS_COLORS.open}>
                      {Math.round(billed.pct || 0)}% · {t(o.status)}
                    </Badge>
                  </Td>
                  <Td className="text-end tabular-nums font-medium text-gray-800 dark:text-slate-100">{fmtMoney(o.total, sym)}</Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <AttachmentButton entityType="salesOrder" entityId={o.id} />
                      {shipped.status !== 'complete' && (
                        <Btn size="sm" variant="ghost" title={t('Create delivery note')} onClick={() => setDeliverDoc(o)}>
                          <Truck size={13} />
                        </Btn>
                      )}
                      {!done && (
                        <Btn size="sm" variant="secondary" onClick={() => setInvoiceDoc(o)}>
                          {t('Invoice')} <ArrowRight size={13} />
                        </Btn>
                      )}
                      <Btn size="sm" variant="ghost" onClick={() => handleDelete(o)}>
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

      <ConvertModal
        open={!!invoiceDoc} onClose={() => setInvoiceDoc(null)} doc={invoiceDoc}
        docKey="invoicedQty" sym={sym} taxEnabled={taxEnabled}
        title={t('Invoice this order')} confirmLabel={t('Create Invoice')} onConfirm={doInvoice}
      />
      <ConvertModal
        open={!!deliverDoc} onClose={() => setDeliverDoc(null)} doc={deliverDoc}
        docKey="deliveredQty" sym={sym} taxEnabled={false}
        title={t('Deliver from this order')} confirmLabel={t('Create Delivery Note')} onConfirm={doDeliver}
      />
    </div>
  )
}
