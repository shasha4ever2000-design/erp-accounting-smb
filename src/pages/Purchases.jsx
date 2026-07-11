import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate, statusColor } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, Modal, Input, Select, EmptyState, Table, Tr, Td } from '../components/UI'
import { useT } from '../i18n'
import { alertIfLocked } from '../utils/periodLock'
import ExportMenu from '../components/ExportMenu'
import AttachmentButton from '../components/Attachments'
import ConvertModal from '../components/ConvertModal'
import { lineRemaining } from '../utils/fulfillment'
import { Plus, Search, DollarSign, Ban, RotateCcw } from 'lucide-react'
import { today } from '../utils/formatters'

export default function Purchases() {
  const { purchases, suppliers, accounts, voidPurchase, createPurchaseReturn, recordPurchasePayment, settings } = useStore()
  const navigate = useNavigate()
  const sym = settings.company.currencySymbol
  const whtCfg = settings.wht || { enabled: false, rate: 5, name: 'Withholding Tax' }
  const t = useT()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [payModal, setPayModal] = useState(null) // holds the purchase
  const [payForm, setPayForm] = useState({ date: today(), amount: '', bankAccountId: 'acc-cash', notes: '', wht: '' })
  const [returnDoc, setReturnDoc] = useState(null)

  const canReturn = (p) => p.status !== 'void' && (p.items || []).some((l) => lineRemaining(l, 'returnedQty') > 1e-6)
  const doReturn = (selections) => {
    const reason = window.prompt(t('Reason for the return? (a debit note will be raised and stock removed)')) || ''
    try { createPurchaseReturn(returnDoc.id, selections, { reason }) } catch (e) { if (alertIfLocked(e, t)) return; throw e }
    setReturnDoc(null)
  }

  const bankAccounts = accounts.filter((a) => ['acc-cash', 'acc-bank1'].includes(a.id))

  const todayStr = new Date().toISOString().slice(0, 10)
  const enriched = purchases.map((p) => ({
    ...p,
    isOverdue: p.status !== 'paid' && p.dueDate && p.dueDate < todayStr,
  }))

  const filtered = enriched.filter((p) => {
    const matchSearch = !search || p.number.toLowerCase().includes(search.toLowerCase()) || p.supplierName?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || p.status === statusFilter || (statusFilter === 'overdue' && p.isOverdue)
    return matchSearch && matchStatus
  })
  const sorted = [...filtered].sort((a, b) => b.createdAt?.localeCompare(a.createdAt))

  const baseCurrency = settings.company.currency
  const payIsFC = payModal && payModal.currency && payModal.currency !== baseCurrency
  const paySym = payIsFC ? `${payModal.currency} ` : sym

  const openPay = (p) => {
    setPayModal(p)
    const amt = p.total - p.amountPaid
    setPayForm({ date: today(), amount: String(amt), bankAccountId: 'acc-cash', notes: '', wht: whtCfg.enabled ? (amt * whtCfg.rate / 100).toFixed(2) : '', exchangeRate: Number(p.exchangeRate) || 1 })
  }

  const handleRecord = () => {
    const amount = parseFloat(payForm.amount)
    if (!amount || amount <= 0) return
    const due = payModal.total - payModal.amountPaid
    if (amount > due) return alert(`Exceeds balance due (${fmtMoney(due, paySym)})`)
    const wht = parseFloat(payForm.wht) || 0
    if (wht > amount) return alert('Withholding tax cannot exceed the payment amount.')
    try { recordPurchasePayment(payModal.id, { ...payForm, amount, wht }) }
    catch (e) { if (alertIfLocked(e, t)) return; throw e }
    setPayModal(null)
  }

  const handleVoid = (p) => {
    if (p.status === 'void') return
    const reason = window.prompt(t('Reason for voiding bill {n}? (posts reversing entries — the bill is kept for the audit trail)').replace('{n}', p.number))
    if (reason === null) return
    try { voidPurchase(p.id, { reason }) } catch (e) { if (alertIfLocked(e, t)) return; throw e }
  }

  const totals = {
    all: purchases.length,
    received: purchases.filter((p) => p.status === 'received').length,
    partial: purchases.filter((p) => p.status === 'partial').length,
    paid: purchases.filter((p) => p.status === 'paid').length,
  }

  const exportCols = [
    { key: 'number', label: t('Invoice #') },
    { key: 'supplierName', label: t('Supplier') },
    { key: 'supplierRef', label: t('Ref') },
    { key: 'date', label: t('Date') },
    { key: 'dueDate', label: t('Due') },
    { key: 'total', label: t('Total'), right: true },
    { key: 'balance', label: t('Balance'), right: true, map: (_, p) => (p.total - p.amountPaid).toFixed(2) },
    { key: 'status', label: t('Status') },
  ]

  return (
    <div>
      <PageHeader
        title={t('Purchase Invoices')}
        subtitle={`${purchases.length} ${t('purchase invoices')}`}
        action={
          <div className="flex items-center gap-2">
            {purchases.length > 0 && <ExportMenu filename="purchase-invoices" title={t('Purchase Invoices')} rows={sorted} columns={exportCols} />}
            <Btn onClick={() => navigate('/purchases/new')}><Plus size={15} /> {t('New Purchase')}</Btn>
          </div>
        }
      />

      <div className="flex gap-2 mb-5 flex-wrap">
        {[
          { key: 'all', label: 'All' },
          { key: 'received', label: 'Received' },
          { key: 'partial', label: 'Partial' },
          { key: 'overdue', label: 'Overdue', red: true },
          { key: 'paid', label: 'Paid' },
        ].map((s) => (
          <button key={s.key} onClick={() => setStatusFilter(s.key)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900 ${
              statusFilter === s.key
                ? s.red ? 'bg-gradient-to-b from-danger-500 to-danger-600 text-white shadow-sm' : 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-btn-primary'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-slate-500 hover:text-gray-900 dark:hover:text-slate-100'
            }`}
          >
            {t(s.label)}
            {totals[s.key] > 0 && (
              <span className={`text-xs tabular-nums font-semibold px-1.5 py-px rounded-full ${statusFilter === s.key ? 'bg-white/20' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'}`}>{totals[s.key]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 pointer-events-none" />
        <input className="w-full ps-9 pe-3 py-2 text-sm bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 shadow-input dark:shadow-none transition-all duration-150 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:focus:ring-brand-400/20"
          placeholder={t('Search purchases...')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        {purchases.length === 0 ? (
          <EmptyState icon="🛒" title={t('No purchase invoices yet')} desc={t('Record your first purchase to track payables.')}
            action={<Btn onClick={() => navigate('/purchases/new')}><Plus size={14} /> {t('New Purchase')}</Btn>} />
        ) : sorted.length === 0 ? (
          <div className="py-12 text-center text-gray-400 dark:text-slate-500 text-sm">{t('No purchases match your filter')}</div>
        ) : (
          <Table headers={[t('Invoice #'), t('Supplier'), t('Ref'), t('Date'), t('Due'), { label: t('Total'), right: true }, { label: t('Balance'), right: true }, t('Status'), { label: t('Actions'), right: true }]}>
            {sorted.map((p) => {
              const status = p.isOverdue && p.status !== 'paid' ? 'overdue' : p.status
              const balance = p.total - p.amountPaid
              return (
                <Tr key={p.id}>
                  <Td className="font-mono font-semibold text-orange-600 dark:text-orange-400">{p.number}</Td>
                  <Td className="font-medium text-gray-900 dark:text-slate-100">{p.supplierName}</Td>
                  <Td className="text-gray-400 dark:text-slate-500 text-xs">{p.supplierRef || '—'}</Td>
                  <Td className="text-gray-500 dark:text-slate-400 whitespace-nowrap">{fmtDate(p.date)}</Td>
                  <Td className={`whitespace-nowrap ${p.isOverdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500 dark:text-slate-400'}`}>{fmtDate(p.dueDate)}</Td>
                  <Td right className="font-semibold text-gray-900 dark:text-slate-100 tabular-nums">{fmtMoney(p.total, sym)}</Td>
                  <Td right className={`tabular-nums ${balance > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-400 dark:text-slate-500'}`}>{fmtMoney(balance, sym)}</Td>
                  <Td><Badge className={statusColor(status)}>{status}</Badge></Td>
                  <Td right>
                    <div className="flex items-center justify-end gap-1">
                      <AttachmentButton entityType="purchase" entityId={p.id} />
                      {p.status !== 'paid' && p.status !== 'void' && (
                        <Btn size="sm" variant="ghost" onClick={() => openPay(p)} title="Record Payment">
                          <DollarSign size={13} className="text-green-600 dark:text-green-400" />
                        </Btn>
                      )}
                      {canReturn(p) && (
                        <Btn size="sm" variant="ghost" onClick={() => setReturnDoc(p)} title={t('Return to supplier')}>
                          <RotateCcw size={13} className="text-amber-500" />
                        </Btn>
                      )}
                      {p.status !== 'void' && (
                        <Btn size="sm" variant="ghost" onClick={() => handleVoid(p)} title={t('Void')}>
                          <Ban size={13} className="text-rose-400" />
                        </Btn>
                      )}
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      <Modal open={!!payModal} onClose={() => setPayModal(null)} title="Record Payment to Supplier">
        {payModal && (
          <div className="space-y-4">
            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800/50 rounded-lg p-3 text-sm text-orange-700 dark:text-orange-300">
              Balance Due: <strong className="tabular-nums">{fmtMoney(payModal.total - payModal.amountPaid, paySym)}</strong>
            </div>
            <Input label="Payment Date" type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} />
            <Input label={`Amount (${paySym.trim()})`} type="number" min="0.01" step="0.01" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} />
            {payIsFC && (
              <div className="space-y-1">
                <Input label={t('Exchange rate at payment (1 {c} = ? {b})').replace('{c}', payModal.currency).replace('{b}', baseCurrency)}
                  type="number" min="0" step="0.000001" value={payForm.exchangeRate} onChange={(e) => setPayForm((f) => ({ ...f, exchangeRate: e.target.value }))} />
                <p className="text-xs text-gray-400 dark:text-slate-500">
                  ≈ {fmtMoney(((parseFloat(payForm.amount) || 0) - (parseFloat(payForm.wht) || 0)) * (Number(payForm.exchangeRate) || 1), sym)} {t('from bank')} · {t('bill booked at')} {Number(payModal.exchangeRate) || 1} → {t('difference is realized FX')}
                </p>
              </div>
            )}
            {whtCfg.enabled && (
              <>
                <Input label={`${whtCfg.name} withheld (${sym})`} type="number" min="0" step="0.01" value={payForm.wht} onChange={(e) => setPayForm((f) => ({ ...f, wht: e.target.value }))} />
                <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-2.5 text-sm text-gray-600 dark:text-slate-300 flex justify-between">
                  <span>{t('Net cash to supplier')}</span>
                  <strong className="tabular-nums">{fmtMoney((parseFloat(payForm.amount) || 0) - (parseFloat(payForm.wht) || 0), sym)}</strong>
                </div>
              </>
            )}
            <Select label="Pay From" value={payForm.bankAccountId} onChange={(e) => setPayForm((f) => ({ ...f, bankAccountId: e.target.value }))}>
              {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
            </Select>
            <Input label="Reference / Notes" value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Cheque #, transfer ref..." />
            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-slate-700">
              <Btn variant="secondary" onClick={() => setPayModal(null)}>{t('Cancel')}</Btn>
              <Btn onClick={handleRecord}>{t('Record Payment')}</Btn>
            </div>
          </div>
        )}
      </Modal>

      <ConvertModal
        open={!!returnDoc}
        onClose={() => setReturnDoc(null)}
        doc={returnDoc}
        docKey="returnedQty"
        sym={returnDoc && returnDoc.currency && returnDoc.currency !== settings.company.currency ? `${returnDoc.currency} ` : sym}
        taxEnabled={returnDoc ? (returnDoc.taxAmount || 0) > 0 : true}
        title={t('Return to supplier')}
        confirmLabel={t('Create Debit Note')}
        onConfirm={doReturn}
      />
    </div>
  )
}
