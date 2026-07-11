import { useState } from 'react'
import { useT } from '../i18n'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import ConvertModal from '../components/ConvertModal'
import { Modal } from '../components/UI'
import { docFulfillment, lineRemaining, poMatch } from '../utils/fulfillment'
import { Plus, Trash2, ArrowRight, PackageCheck, GitCompareArrows } from 'lucide-react'

const MATCH_BADGE = {
  matched:     'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300',
  variance:    'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300',
  in_progress: 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300',
}

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
  const { purchaseOrders, settings, deletePurchaseOrder, updatePurchaseOrder, receiveGoods, billReceivedPO } = useStore()
  const sym = settings.company.currencySymbol
  const taxEnabled = settings.tax?.enabled !== false
  const [filter, setFilter] = useState('all')
  const [receiveDoc, setReceiveDoc] = useState(null)
  const [billDoc, setBillDoc] = useState(null)
  const [matchDoc, setMatchDoc] = useState(null)

  const filtered = filter === 'all' ? purchaseOrders : purchaseOrders.filter((p) => p.status === filter)
  const sorted   = [...filtered].sort((a, b) => b.date.localeCompare(a.date))

  // A line is billable up to what has been received but not yet billed.
  const billRemaining = (l) => Math.max(0, (Number(l.receivedQty) || 0) - (Number(l.billedQty) || 0))
  const canReceive = (po) => (po.items || []).some((l) => lineRemaining(l, 'receivedQty') > 1e-6)
  const canBill = (po) => (po.items || []).some((l) => billRemaining(l) > 1e-6)

  const doReceive = (selections) => { receiveGoods(receiveDoc.id, selections); setReceiveDoc(null) }
  const doBill = (selections) => {
    const bill = billReceivedPO(billDoc.id, selections)
    setBillDoc(null)
    if (bill) navigate('/purchases')
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
                    <Btn size="sm" variant="ghost" title={t('3-way match')} onClick={() => setMatchDoc(po)}>
                      <GitCompareArrows size={13} className="text-brand-500" />
                    </Btn>
                    {po.status !== 'cancelled' && po.status !== 'void' && canReceive(po) && (
                      <Btn size="sm" variant="ghost" onClick={() => setReceiveDoc(po)} title={t('Receive goods')}>
                        <PackageCheck size={13} className="text-green-600" /> {t('Receive')}
                      </Btn>
                    )}
                    {po.status !== 'cancelled' && po.status !== 'void' && canBill(po) && (
                      <Btn size="sm" variant="secondary" onClick={() => setBillDoc(po)} title={t('Bill received goods')}>
                        <ArrowRight size={13} /> {t('Bill')}
                      </Btn>
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

      {/* Step 1: Goods Receipt (GRN) — stock in, accrue GRNI */}
      <ConvertModal
        open={!!receiveDoc}
        onClose={() => setReceiveDoc(null)}
        doc={receiveDoc}
        docKey="receivedQty"
        sym={sym}
        taxEnabled={taxEnabled}
        title={t('Receive goods (GRN)')}
        confirmLabel={t('Confirm Receipt')}
        onConfirm={doReceive}
      />

      {/* Step 2: Bill received goods — clears GRNI into Accounts Payable */}
      <ConvertModal
        open={!!billDoc}
        onClose={() => setBillDoc(null)}
        doc={billDoc}
        docKey="billedQty"
        remainingOf={billRemaining}
        sym={sym}
        taxEnabled={taxEnabled}
        title={t('Bill received goods')}
        confirmLabel={t('Create Bill')}
        onConfirm={doBill}
      />

      {/* 3-way match: Ordered vs Received vs Billed */}
      <Modal open={!!matchDoc} onClose={() => setMatchDoc(null)} title={`${t('3-way match')} — ${matchDoc?.number || ''}`} width="max-w-2xl">
        {matchDoc && (() => {
          const m = poMatch(matchDoc)
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold px-2 py-1 rounded-md ${MATCH_BADGE[m.status]}`}>
                  {m.status === 'matched' ? t('Fully matched') : m.status === 'variance' ? t('Variance — review') : t('In progress')}
                </span>
                <span className="text-xs text-gray-400 dark:text-slate-500">{t('Purchase order → goods receipt → vendor bill')}</span>
              </div>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm min-w-[480px]">
                  <thead>
                    <tr className="text-xs text-gray-400 dark:text-slate-500 uppercase border-b border-gray-100 dark:border-surface-700">
                      <th className="text-start py-2 font-medium">{t('Description')}</th>
                      <th className="text-end py-2 font-medium px-2">{t('Ordered')}</th>
                      <th className="text-end py-2 font-medium px-2">{t('Received')}</th>
                      <th className="text-end py-2 font-medium px-2">{t('Billed')}</th>
                      <th className="text-end py-2 font-medium ps-2">{t('Status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.lines.map((l) => {
                      const flag = l.overReceived || l.overBilled
                      const ok = Math.abs(l.ordered - l.received) < 1e-6 && Math.abs(l.received - l.billed) < 1e-6
                      return (
                        <tr key={l.id} className="border-b border-gray-50 dark:border-surface-700/50">
                          <td className="py-2 text-gray-700 dark:text-slate-200">{l.description || '—'}</td>
                          <td className="py-2 text-end px-2 tabular-nums text-gray-600 dark:text-slate-300">{l.ordered}</td>
                          <td className="py-2 text-end px-2 tabular-nums text-gray-600 dark:text-slate-300">{l.received}</td>
                          <td className="py-2 text-end px-2 tabular-nums text-gray-600 dark:text-slate-300">{l.billed}</td>
                          <td className="py-2 text-end ps-2 text-xs font-medium">
                            {flag ? <span className="text-danger-600 dark:text-danger-400">{l.overReceived ? t('Over-received') : t('Over-billed')}</span>
                              : ok ? <span className="text-success-600 dark:text-success-400">✓ {t('Matched')}</span>
                              : <span className="text-warning-600 dark:text-warning-400">{l.awaitingReceipt > 0 ? `${l.awaitingReceipt} ${t('to receive')}` : `${l.awaitingBill} ${t('to bill')}`}</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
