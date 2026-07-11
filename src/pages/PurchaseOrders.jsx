import { useState } from 'react'
import { useT } from '../i18n'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import ConvertModal from '../components/ConvertModal'
import { docFulfillment } from '../utils/fulfillment'
import { Plus, Trash2, ArrowRight } from 'lucide-react'

const STATUS_COLORS = {
  sent:     'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
  received: 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300',
  partial:  'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300',
  invoiced: 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300',
  draft:    'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300',
  cancelled:'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300',
}

export default function PurchaseOrders() {
  const t = useT()
  const navigate = useNavigate()
  const { purchaseOrders, settings, deletePurchaseOrder, updatePurchaseOrder, convertPOToPurchase } = useStore()
  const sym = settings.company.currencySymbol
  const taxEnabled = settings.tax?.enabled !== false
  const [filter, setFilter] = useState('all')
  const [convertDoc, setConvertDoc] = useState(null)

  const filtered = filter === 'all' ? purchaseOrders : purchaseOrders.filter((p) => p.status === filter)
  const sorted   = [...filtered].sort((a, b) => b.date.localeCompare(a.date))

  const doConvert = (selections) => {
    const purchase = convertPOToPurchase(convertDoc.id, selections)
    setConvertDoc(null)
    if (purchase) navigate('/purchases')
  }

  const handleDelete = (po) => {
    if (confirm(`Delete PO ${po.number}?`)) deletePurchaseOrder(po.id)
  }

  const counts = { all: purchaseOrders.length }
  ;['sent','received','invoiced','cancelled'].forEach((s) => {
    counts[s] = purchaseOrders.filter((p) => p.status === s).length
  })

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle={`${purchaseOrders.length} ${t('total purchase orders')}`}
        action={<Btn onClick={() => navigate('/purchase-orders/new')}><Plus size={15} /> New PO</Btn>}
      />

      <div className="flex gap-2 mb-4 flex-wrap">
        {[['all','All'],['sent','Sent'],['received','Received'],['invoiced','Invoiced']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900 ${filter === val ? 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-btn-primary' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-slate-500 hover:text-gray-900 dark:hover:text-slate-100'}`}>
            {label}
            <span className={`text-xs tabular-nums font-semibold px-1.5 py-px rounded-full ${filter === val ? 'bg-white/20' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'}`}>{counts[val] ?? 0}</span>
          </button>
        ))}
      </div>

      <Card>
        {purchaseOrders.length === 0 ? (
          <EmptyState icon="📦" title="No purchase orders" desc="Create purchase orders for your suppliers. Convert them to purchase invoices when goods are received."
            action={<Btn onClick={() => navigate('/purchase-orders/new')}><Plus size={14} /> New PO</Btn>} />
        ) : sorted.length === 0 ? (
          <div className="py-12 text-center text-gray-400 dark:text-slate-500 text-sm">No POs with status "{filter}"</div>
        ) : (
          <Table headers={['PO Number', 'Supplier', 'Order Date', 'Delivery Date', 'Status', { label: 'Total', right: true }, { label: 'Actions', right: true }]}>
            {sorted.map((po) => (
              <Tr key={po.id}>
                <Td><span className="font-mono text-sm font-semibold text-orange-600 dark:text-orange-400">{po.number}</span></Td>
                <Td>
                  <p className="font-medium text-gray-900 dark:text-slate-100">{po.supplierName}</p>
                  {po.supplierEmail && <p className="text-xs text-gray-400 dark:text-slate-500">{po.supplierEmail}</p>}
                </Td>
                <Td className="text-gray-500 dark:text-slate-400 text-sm whitespace-nowrap">{fmtDate(po.date)}</Td>
                <Td className="text-gray-500 dark:text-slate-400 text-sm whitespace-nowrap">{po.deliveryDate ? fmtDate(po.deliveryDate) : '—'}</Td>
                <Td>
                  <Badge className={STATUS_COLORS[po.status] || 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300'}>
                    {po.status.charAt(0).toUpperCase() + po.status.slice(1)}
                  </Badge>
                  {po.status === 'partial' && (() => { const f = docFulfillment(po.items || [], 'receivedQty'); return <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">{f.done} / {f.ordered} {t('received')}</p> })()}
                </Td>
                <Td right><span className="font-semibold text-gray-900 dark:text-slate-100 tabular-nums">{fmtMoney(po.total, sym)}</span></Td>
                <Td right>
                  <div className="flex justify-end gap-1">
                      <AttachmentButton entityType="purchaseorder" entityId={po.id} />
                    {po.status !== 'invoiced' && po.status !== 'cancelled' && po.status !== 'void' && (
                      <>
                        {po.status !== 'partial' && (
                          <Btn size="sm" variant="ghost" title="Mark Received" onClick={() => updatePurchaseOrder(po.id, { status: 'received' })}>
                            ✓
                          </Btn>
                        )}
                        <Btn size="sm" variant="secondary" onClick={() => setConvertDoc(po)} title="Convert to Bill">
                          <ArrowRight size={13} /> {po.status === 'partial' ? t('Bill rest') : t('Bill')}
                        </Btn>
                      </>
                    )}
                    {po.status === 'invoiced' && <span className="text-xs text-gray-400 dark:text-slate-500 px-2">{t('Billed')}</span>}
                    <Btn size="sm" variant="ghost" onClick={() => handleDelete(po)}>
                      <Trash2 size={13} className="text-red-400" />
                    </Btn>
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <ConvertModal
        open={!!convertDoc}
        onClose={() => setConvertDoc(null)}
        doc={convertDoc}
        docKey="receivedQty"
        sym={sym}
        taxEnabled={taxEnabled}
        title={t('Receive / bill purchase order')}
        confirmLabel={t('Create Bill')}
        onConfirm={doConvert}
      />
    </div>
  )
}
