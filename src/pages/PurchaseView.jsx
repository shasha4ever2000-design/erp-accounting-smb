import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate, statusColor, today } from '../utils/formatters'
import { alertIfLocked } from '../utils/periodLock'
import { EDIT_BLOCK_MESSAGE } from '../utils/docEdit'
import { CustomFieldValues } from '../components/CustomFields'
import { Card, Btn, Badge, Modal, Input, Select } from '../components/UI'
import ConvertModal from '../components/ConvertModal'
import { lineRemaining } from '../utils/fulfillment'
import AttachmentButton from '../components/Attachments'
import { useT } from '../i18n'
import { ArrowLeft, DollarSign, Printer, Ban, Pencil, RotateCcw, BookOpen } from 'lucide-react'

// A supplier bill is a document you received rather than one you issue, so this
// is a working view rather than a printable customer-facing one: what was
// bought, which account each line landed in, what has been paid, and the
// journal entry it posted. Everything the Purchases list could do is here too,
// so a bill can be opened and dealt with in one place.
export default function PurchaseView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const t = useT()
  const {
    purchases, suppliers, accounts, journalEntries, settings,
    voidPurchase, createPurchaseReturn, recordPurchasePayment, purchaseEditBlock,
  } = useStore()

  const purchase = purchases.find((p) => p.id === id)
  const [payModal, setPayModal] = useState(false)
  const [payForm, setPayForm] = useState({ date: today(), amount: '', bankAccountId: 'acc-cash', notes: '', wht: '' })
  const [returnOpen, setReturnOpen] = useState(false)

  if (!purchase) return (
    <div className="text-center py-20">
      <p className="text-gray-500 dark:text-slate-400 mb-4">{t('Purchase invoice not found.')}</p>
      <Btn variant="secondary" onClick={() => navigate('/purchases')}>{t('Back to Purchases')}</Btn>
    </div>
  )

  const sym = settings.company.currencySymbol
  const baseCurrency = settings.company.currency
  const isFC = purchase.currency && purchase.currency !== baseCurrency
  const purSym = isFC ? `${purchase.currency} ` : sym
  const purRate = Number(purchase.exchangeRate) || 1
  const whtCfg = settings.wht || { enabled: false, rate: 5, name: 'Withholding Tax' }

  const supplier = suppliers.find((s) => s.id === purchase.supplierId)
  const je = journalEntries.find((j) => j.id === purchase.journalEntryId)
  const editBlocked = purchaseEditBlock(purchase.id)
  const amountDue = purchase.total - purchase.amountPaid
  const accName = (accId) => accounts.find((a) => a.id === accId)?.name || accId || '—'

  const anyDiscount = (purchase.items || []).some((l) => (Number(l.discount) || 0) > 0)
  const showTaxCol = (purchase.taxAmount || 0) > 0
  const grossSubtotal = (purchase.items || []).reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0)
  const lineDiscount = Math.round((grossSubtotal - (purchase.subtotal || 0)) * 100) / 100

  const bankAccounts = accounts.filter((a) => ['acc-cash', 'acc-bank1'].includes(a.id))
  const canReturn = purchase.status !== 'void' && (purchase.items || []).some((l) => lineRemaining(l, 'returnedQty') > 1e-6)

  const openPay = () => {
    const amt = amountDue
    setPayForm({ date: today(), amount: String(amt), bankAccountId: 'acc-cash', notes: '', wht: whtCfg.enabled ? (amt * whtCfg.rate / 100).toFixed(2) : '', exchangeRate: purRate })
    setPayModal(true)
  }

  const handleRecord = () => {
    const amount = parseFloat(payForm.amount)
    if (!amount || amount <= 0) return
    if (amount > amountDue) return alert(`${t('Exceeds balance due')} (${fmtMoney(amountDue, purSym)})`)
    const wht = parseFloat(payForm.wht) || 0
    if (wht > amount) return alert(t('Withholding tax cannot exceed the payment amount.'))
    let res
    try { res = recordPurchasePayment(purchase.id, { ...payForm, amount, wht }) }
    catch (e) { if (alertIfLocked(e, t)) return; throw e }
    setPayModal(false)
    if (res?.pendingApproval)
      alert(t('This payment is over the approval threshold and has been sent for approval. Nothing has left the bank yet.'))
  }

  const doReturn = (selections) => {
    const reason = window.prompt(t('Reason for the return? (a debit note will be raised and stock removed)')) || ''
    try { createPurchaseReturn(purchase.id, selections, { reason }) } catch (e) { if (alertIfLocked(e, t)) return; throw e }
    setReturnOpen(false)
  }

  const handleVoid = () => {
    const reason = window.prompt(t('Reason for voiding bill {n}? (posts reversing entries — the bill is kept for the audit trail)').replace('{n}', purchase.number))
    if (reason === null) return
    try { voidPurchase(purchase.id, { reason }) } catch (e) { if (alertIfLocked(e, t)) return; throw e }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 no-print flex-wrap gap-3">
        <button onClick={() => navigate('/purchases')} className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-100">
          <ArrowLeft size={15} /> {t('Back to Purchases')}
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <AttachmentButton entityType="purchase" entityId={purchase.id} label={t('Attachments')} />
          <Btn variant="secondary" size="sm" onClick={() => window.print()}><Printer size={14} /> {t('Print')}</Btn>
          {/* Editing re-posts the bill, so it is offered only while nothing has
              been hung off it — the store decides, and says why not. */}
          {!editBlocked && (
            <Btn variant="secondary" size="sm" onClick={() => navigate(`/purchases/${purchase.id}/edit`)}>
              <Pencil size={14} /> {t('Edit')}
            </Btn>
          )}
          {purchase.status !== 'paid' && purchase.status !== 'void' && (
            <Btn size="sm" onClick={openPay}><DollarSign size={14} /> {t('Record Payment')}</Btn>
          )}
          {canReturn && (
            <Btn variant="secondary" size="sm" onClick={() => setReturnOpen(true)}><RotateCcw size={14} /> {t('Return')}</Btn>
          )}
          {purchase.status !== 'void' && (
            <Btn variant="secondary" size="sm" onClick={handleVoid}><Ban size={14} /> {t('Void')}</Btn>
          )}
        </div>
      </div>

      {/* Why the Edit button is missing, rather than leaving the user to guess. */}
      {editBlocked && editBlocked !== 'missing' && (
        <div className="max-w-3xl mx-auto mb-4 no-print text-xs rounded-lg px-3 py-2 bg-slate-50 dark:bg-surface-800/60 text-gray-500 dark:text-slate-400 border border-slate-200 dark:border-surface-700">
          {t(EDIT_BLOCK_MESSAGE[editBlocked])}
        </div>
      )}

      <div className="max-w-3xl mx-auto">
        <Card className="p-8 print:shadow-none">
          <div className="flex items-start justify-between mb-8 gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide">{t('Purchase Invoice')}</p>
              <p className="text-2xl font-bold text-gray-800 dark:text-slate-100 mt-1">{purchase.number}</p>
              {purchase.supplierRef && (
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{t('Supplier ref')}: {purchase.supplierRef}</p>
              )}
            </div>
            <div className="text-end">
              <Badge className={statusColor(purchase.status)}>{purchase.status.toUpperCase()}</Badge>
              {purchase.revision > 0 && (
                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5">
                  {t('Edited')} · {t('revision {n}').replace('{n}', purchase.revision)}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-8">
            <div>
              <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-2">{t('Supplier')}</p>
              <p className="font-semibold text-gray-800 dark:text-slate-100">{purchase.supplierName}</p>
              {supplier?.email && <p className="text-sm text-gray-500 dark:text-slate-400">{supplier.email}</p>}
              {supplier?.phone && <p className="text-sm text-gray-500 dark:text-slate-400">{supplier.phone}</p>}
              {supplier?.taxId && <p className="text-sm text-gray-500 dark:text-slate-400">{t('Tax ID')}: {supplier.taxId}</p>}
              {supplier?.address && <p className="text-sm text-gray-400 dark:text-slate-500 mt-1 whitespace-pre-line">{supplier.address}</p>}
            </div>
            <div className="text-end space-y-2">
              <div>
                <p className="text-xs text-gray-400 dark:text-slate-500">{t('Invoice Date')}</p>
                <p className="font-medium text-gray-800 dark:text-slate-100">{fmtDate(purchase.date)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 dark:text-slate-500">{t('Due Date')}</p>
                <p className="font-medium text-gray-800 dark:text-slate-100">{fmtDate(purchase.dueDate)}</p>
              </div>
              {isFC && (
                <div>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{t('Exchange rate')}</p>
                  <p className="font-medium text-gray-800 dark:text-slate-100">1 {purchase.currency} = {purRate} {baseCurrency}</p>
                </div>
              )}
            </div>
          </div>

          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm mb-6 min-w-[540px]">
              <thead>
                <tr className="border-b-2 border-gray-200 dark:border-surface-700">
                  <th className="text-start py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Description')}</th>
                  <th className="text-start py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Posts to')}</th>
                  <th className="text-end py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Qty')}</th>
                  <th className="text-end py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Unit Cost')}</th>
                  {anyDiscount && <th className="text-end py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Disc %')}</th>}
                  {showTaxCol && <th className="text-end py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('VAT')}</th>}
                  <th className="text-end py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Amount')}</th>
                </tr>
              </thead>
              <tbody>
                {(purchase.items || []).map((item) => (
                  <tr key={item.id} className="border-b border-gray-100 dark:border-surface-750">
                    <td className="py-3 text-gray-700 dark:text-slate-200">{item.description}</td>
                    {/* A stock line and an expense line look identical on the
                        document but land in completely different places, so the
                        bill says which this was. */}
                    <td className="py-3 text-xs text-gray-500 dark:text-slate-400">
                      {item.itemId
                        ? <span className="text-blue-600 dark:text-blue-400">📦 {t('Stock')}</span>
                        : accName(item.accountId)}
                    </td>
                    <td className="py-3 text-end text-gray-600 dark:text-slate-300">{item.quantity}</td>
                    <td className="py-3 text-end text-gray-600 dark:text-slate-300">{fmtMoney(item.unitPrice, purSym)}</td>
                    {anyDiscount && <td className="py-3 text-end text-gray-500 dark:text-slate-400">{(Number(item.discount) || 0) > 0 ? `${item.discount}%` : '—'}</td>}
                    {showTaxCol && <td className="py-3 text-end text-gray-400 dark:text-slate-500">{item.taxRate || 0}%</td>}
                    <td className="py-3 text-end font-medium text-gray-800 dark:text-slate-100">{fmtMoney(item.subtotal, purSym)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <div className="w-60 space-y-2 text-sm">
              {lineDiscount > 0.005 && (
                <>
                  <div className="flex justify-between text-gray-600 dark:text-slate-300"><span>{t('Subtotal')}</span><span>{fmtMoney(grossSubtotal, purSym)}</span></div>
                  <div className="flex justify-between text-green-600 dark:text-green-400"><span>{t('Discount')}</span><span>− {fmtMoney(lineDiscount, purSym)}</span></div>
                </>
              )}
              <div className="flex justify-between text-gray-600 dark:text-slate-300">
                <span>{lineDiscount > 0.005 ? t('Net Subtotal') : t('Subtotal')}</span>
                <span>{fmtMoney(purchase.subtotal, purSym)}</span>
              </div>
              {(purchase.docDiscountAmount || 0) > 0.005 && (
                <div className="flex justify-between text-green-600 dark:text-green-400">
                  <span>{t('Bill discount')}{purchase.docDiscount ? ` (${purchase.docDiscount}%)` : ''}</span>
                  <span>− {fmtMoney(purchase.docDiscountAmount, purSym)}</span>
                </div>
              )}
              {(purchase.shipping || 0) > 0.005 && (
                <div className="flex justify-between text-gray-600 dark:text-slate-300"><span>{t('Freight')}</span><span>{fmtMoney(purchase.shipping, purSym)}</span></div>
              )}
              {purchase.taxAmount > 0 && (
                <div className="flex justify-between text-gray-600 dark:text-slate-300"><span>{settings.tax.name}</span><span>{fmtMoney(purchase.taxAmount, purSym)}</span></div>
              )}
              <div className="flex justify-between font-bold text-base border-t border-slate-200 dark:border-surface-700 pt-2">
                <span>{t('Total')}</span><span>{fmtMoney(purchase.total, purSym)}</span>
              </div>
              {isFC && (
                <div className="flex justify-between text-xs text-gray-400 dark:text-slate-500">
                  <span>≈ {t('in')} {baseCurrency}</span><span>{fmtMoney(purchase.baseTotal ?? purchase.total * purRate, sym)}</span>
                </div>
              )}
              {purchase.amountPaid > 0 && (
                <>
                  <div className="flex justify-between text-green-600 dark:text-green-400"><span>{t('Amount Paid')}</span><span>({fmtMoney(purchase.amountPaid, purSym)})</span></div>
                  <div className="flex justify-between font-bold text-orange-600 dark:text-orange-400 border-t border-slate-200 dark:border-surface-700 pt-2">
                    <span>{t('Balance Due')}</span><span>{fmtMoney(amountDue, purSym)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <CustomFieldValues entityId="purchase" values={purchase.customFields} className="mt-6 no-print" />

          {purchase.notes && (
            <div className="mt-6 pt-6 border-t border-gray-100 dark:border-surface-750">
              <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase mb-1">{t('Notes')}</p>
              <p className="text-sm text-gray-600 dark:text-slate-300 whitespace-pre-line">{purchase.notes}</p>
            </div>
          )}

          {/* The entry this bill posted — the quickest way to check a bill did
              what you expected it to do. */}
          {je && (
            <div className="mt-6 pt-6 border-t border-gray-100 dark:border-surface-750 no-print">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase">{t('Journal Entry')} {je.number}</p>
                <Btn variant="ghost" size="sm" onClick={() => navigate('/journals')}><BookOpen size={13} /> {t('Journal Entries')}</Btn>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 dark:text-slate-500 uppercase border-b border-gray-100 dark:border-surface-700">
                    <th className="text-start py-1.5 font-medium">{t('Account')}</th>
                    <th className="text-end py-1.5 font-medium">{t('Debit')}</th>
                    <th className="text-end py-1.5 font-medium">{t('Credit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(je.lines || []).map((l, i) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-surface-750">
                      <td className="py-2 text-gray-700 dark:text-slate-200">{accName(l.accountId)}</td>
                      <td className="py-2 text-end font-mono text-gray-700 dark:text-slate-200">{l.debit > 0 ? fmtMoney(l.debit, sym) : '—'}</td>
                      <td className="py-2 text-end font-mono text-gray-700 dark:text-slate-200">{l.credit > 0 ? fmtMoney(l.credit, sym) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {purchase.payments?.length > 0 && (
            <div className="mt-6 pt-6 border-t border-gray-100 dark:border-surface-750 no-print">
              <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase mb-3">{t('Payments')}</p>
              {purchase.payments.map((p) => (
                <div key={p.id} className="flex justify-between text-sm py-1.5 border-b border-gray-50 dark:border-surface-750 last:border-0">
                  <span className="text-gray-600 dark:text-slate-300">{fmtDate(p.date)} · {p.number}{p.notes ? ` · ${p.notes}` : ''}</span>
                  <span className="font-medium text-gray-800 dark:text-slate-100 tabular-nums">{fmtMoney(p.amount, purSym)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal open={payModal} onClose={() => setPayModal(false)} title={t('Record Payment to Supplier')}>
        <div className="space-y-4">
          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800/50 rounded-lg p-3 text-sm text-orange-700 dark:text-orange-300">
            {t('Balance Due')}: <strong className="tabular-nums">{fmtMoney(amountDue, purSym)}</strong>
          </div>
          <Input label={t('Payment Date')} type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} />
          <Input label={`${t('Amount')} (${purSym.trim()})`} type="number" min="0.01" step="0.01" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} />
          {isFC && (
            <Input label={t('Exchange rate at payment (1 {c} = ? {b})').replace('{c}', purchase.currency).replace('{b}', baseCurrency)}
              type="number" min="0" step="0.000001" value={payForm.exchangeRate} onChange={(e) => setPayForm((f) => ({ ...f, exchangeRate: e.target.value }))} />
          )}
          {whtCfg.enabled && (
            <>
              <Input label={`${whtCfg.name} (${sym})`} type="number" min="0" step="0.01" value={payForm.wht} onChange={(e) => setPayForm((f) => ({ ...f, wht: e.target.value }))} />
              <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-2.5 text-sm text-gray-600 dark:text-slate-300 flex justify-between">
                <span>{t('Net cash to supplier')}</span>
                <strong className="tabular-nums">{fmtMoney((parseFloat(payForm.amount) || 0) - (parseFloat(payForm.wht) || 0), purSym)}</strong>
              </div>
            </>
          )}
          <Select label={t('Pay From')} value={payForm.bankAccountId} onChange={(e) => setPayForm((f) => ({ ...f, bankAccountId: e.target.value }))}>
            {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
          </Select>
          <Input label={t('Reference / Notes')} value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-slate-700">
            <Btn variant="secondary" onClick={() => setPayModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={handleRecord}>{t('Record Payment')}</Btn>
          </div>
        </div>
      </Modal>

      <ConvertModal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        doc={returnOpen ? purchase : null}
        docKey="returnedQty"
        sym={purSym}
        taxEnabled={(purchase.taxAmount || 0) > 0}
        title={t('Return to supplier')}
        confirmLabel={t('Create Debit Note')}
        onConfirm={doReturn}
      />
    </div>
  )
}
