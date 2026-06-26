import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Trash2, ArrowRight } from 'lucide-react'

const STATUS_COLORS = {
  sent:     'bg-blue-100 text-blue-700',
  received: 'bg-green-100 text-green-700',
  invoiced: 'bg-gray-100 text-gray-600',
  draft:    'bg-yellow-100 text-yellow-700',
  cancelled:'bg-red-100 text-red-700',
}

export default function PurchaseOrders() {
  const navigate = useNavigate()
  const { purchaseOrders, settings, deletePurchaseOrder, updatePurchaseOrder, convertPOToPurchase } = useStore()
  const sym = settings.company.currencySymbol
  const [filter, setFilter] = useState('all')

  const filtered = filter === 'all' ? purchaseOrders : purchaseOrders.filter((p) => p.status === filter)
  const sorted   = [...filtered].sort((a, b) => b.date.localeCompare(a.date))

  const handleConvert = (po) => {
    if (!confirm(`Convert ${po.number} to a Purchase Invoice?`)) return
    const purchase = convertPOToPurchase(po.id)
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
        subtitle={`${purchaseOrders.length} total purchase orders`}
        action={<Btn onClick={() => navigate('/purchase-orders/new')}><Plus size={15} /> New PO</Btn>}
      />

      <div className="flex gap-2 mb-4 flex-wrap">
        {[['all','All'],['sent','Sent'],['received','Received'],['invoiced','Invoiced']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${filter === val ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300'}`}>
            {label} ({counts[val] ?? 0})
          </button>
        ))}
      </div>

      <Card>
        {purchaseOrders.length === 0 ? (
          <EmptyState icon="📦" title="No purchase orders" desc="Create purchase orders for your suppliers. Convert them to purchase invoices when goods are received."
            action={<Btn onClick={() => navigate('/purchase-orders/new')}><Plus size={14} /> New PO</Btn>} />
        ) : sorted.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No POs with status "{filter}"</div>
        ) : (
          <Table headers={['PO Number', 'Supplier', 'Order Date', 'Delivery Date', 'Status', { label: 'Total', right: true }, { label: 'Actions', right: true }]}>
            {sorted.map((po) => (
              <Tr key={po.id}>
                <Td><span className="font-mono text-sm font-medium text-orange-600">{po.number}</span></Td>
                <Td>
                  <p className="font-medium text-gray-800">{po.supplierName}</p>
                  {po.supplierEmail && <p className="text-xs text-gray-400">{po.supplierEmail}</p>}
                </Td>
                <Td className="text-gray-500 text-sm">{fmtDate(po.date)}</Td>
                <Td className="text-gray-500 text-sm">{po.deliveryDate ? fmtDate(po.deliveryDate) : '—'}</Td>
                <Td>
                  <Badge className={STATUS_COLORS[po.status] || 'bg-gray-100 text-gray-600'}>
                    {po.status.charAt(0).toUpperCase() + po.status.slice(1)}
                  </Badge>
                </Td>
                <Td right><span className="font-semibold text-gray-800">{fmtMoney(po.total, sym)}</span></Td>
                <Td right>
                  <div className="flex justify-end gap-1">
                    {po.status !== 'invoiced' && po.status !== 'cancelled' && (
                      <>
                        <Btn size="sm" variant="ghost" title="Mark Received" onClick={() => updatePurchaseOrder(po.id, { status: 'received' })}>
                          ✓
                        </Btn>
                        <Btn size="sm" variant="secondary" onClick={() => handleConvert(po)} title="Convert to Invoice">
                          <ArrowRight size={13} /> Invoice
                        </Btn>
                      </>
                    )}
                    {po.status === 'invoiced' && <span className="text-xs text-gray-400 px-2">Invoiced</span>}
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
    </div>
  )
}
