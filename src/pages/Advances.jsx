import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td, StatCard, Modal, Input, Select } from '../components/UI'
import { advanceBalance, appliedTotal, applicableAmount, customerCredit } from '../utils/advances'
import { Wallet, Plus, Trash2, Undo2, Link2, Users } from 'lucide-react'

const today = () => new Date().toISOString().slice(0, 10)

const emptyForm = () => ({
  customerId: '', customerName: '', amount: '', date: today(),
  bankAccountId: '', notes: '',
})

export default function Advances() {
  const t = useT()
  const {
    customerAdvances = [], customers = [], invoices = [], bankAccounts = [], settings,
    receiveAdvance, applyAdvance, refundAdvance, deleteAdvance,
  } = useStore()
  const sym = settings.company.currencySymbol

  const [form, setForm] = useState(emptyForm())
  const [modal, setModal] = useState(false)
  const [error, setError] = useState('')
  const [applyFor, setApplyFor] = useState(null)   // advance
  const [applyForm, setApplyForm] = useState({ invoiceId: '', amount: '', date: today() })
  const [refundFor, setRefundFor] = useState(null) // advance
  const [refundForm, setRefundForm] = useState({ amount: '', date: today(), bankAccountId: '' })

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const rows = useMemo(
    () => [...customerAdvances].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [customerAdvances]
  )
  const totalHeld = useMemo(
    () => rows.reduce((s, a) => s + advanceBalance(a), 0),
    [rows]
  )
  const withCredit = useMemo(
    () => new Set(rows.filter((a) => advanceBalance(a) > 0.005).map((a) => a.customerId)).size,
    [rows]
  )

  // Invoices this advance could go against: same customer, still owing.
  const openInvoicesFor = (advance) => invoices.filter(
    (i) => i.customerId === advance.customerId
      && i.status !== 'void' && i.status !== 'cancelled'
      && (i.total || 0) - (i.amountPaid || 0) > 0.005
  )

  const save = () => {
    setError('')
    const c = customers.find((x) => x.id === form.customerId)
    try {
      receiveAdvance({ ...form, amount: Number(form.amount) || 0, customerName: c?.name || '' })
      setModal(false)
      setForm(emptyForm())
    } catch (e) {
      const msg = String(e.message || e)
      setError(msg.startsWith('ADVANCE_INVALID:') ? msg.slice('ADVANCE_INVALID:'.length) : msg)
    }
  }

  const openApply = (advance) => {
    const open = openInvoicesFor(advance)
    setApplyForm({ invoiceId: open[0]?.id || '', amount: '', date: today() })
    setError('')
    setApplyFor(advance)
  }

  const doApply = () => {
    setError('')
    try {
      const res = applyAdvance(applyFor.id, applyForm.invoiceId, {
        amount: applyForm.amount === '' ? null : Number(applyForm.amount),
        date: applyForm.date,
      })
      if (!res) return setError(t('Nothing could be applied — check the invoice still has a balance.'))
      setApplyFor(null)
    } catch (e) {
      const msg = String(e.message || e)
      setError(msg.startsWith('ADVANCE_WRONG_CUSTOMER')
        ? t('That invoice belongs to a different customer.')
        : msg)
    }
  }

  const openRefund = (advance) => {
    setRefundForm({ amount: String(advanceBalance(advance)), date: today(), bankAccountId: advance.bankAccountId || '' })
    setError('')
    setRefundFor(advance)
  }

  const doRefund = () => {
    setError('')
    try {
      refundAdvance(refundFor.id, { ...refundForm, amount: Number(refundForm.amount) || 0 })
      setRefundFor(null)
    } catch (e) {
      const msg = String(e.message || e)
      setError(msg.startsWith('ADVANCE_NOTHING_TO_REFUND') ? t('There is nothing left on this advance.')
        : msg.startsWith('ADVANCE_NO_BANK') ? t('Choose the account to refund from.')
        : msg)
    }
  }

  const remove = (advance) => {
    if (!confirm(t('Delete this advance? Its journal entry goes to the recycle bin.'))) return
    try { deleteAdvance(advance.id) } catch (e) {
      if (String(e.message).startsWith('ADVANCE_IN_USE'))
        return alert(t('Some of this advance has already been applied or refunded, so it stays on the record.'))
      throw e
    }
  }

  const selectedInvoice = applyFor ? invoices.find((i) => i.id === applyForm.invoiceId) : null
  const maxApply = applyFor && selectedInvoice ? applicableAmount(applyFor, selectedInvoice) : 0

  return (
    <div>
      <PageHeader
        title={t('Customer Advances')}
        subtitle={t('Deposits and money on account — held as a liability until you invoice against them')}
        action={<Btn onClick={() => { setForm(emptyForm()); setError(''); setModal(true) }}><Plus size={15} /> {t('Receive advance')}</Btn>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <StatCard label={t('Held on account')} value={fmtMoney(totalHeld, sym)} sub={t('owed back or to be invoiced')} icon={<Wallet size={18} />} color="amber" />
        <StatCard label={t('Customers in credit')} value={String(withCredit)} icon={<Users size={18} />} color="blue" />
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Wallet size={28} className="text-slate-400 dark:text-slate-500" />}
            title={t('No advances yet')}
            desc={t('Record a deposit here when a customer pays before you invoice. It is held as a liability, not revenue, until you apply it to an invoice or refund it.')}
          />
        ) : (
          <Table headers={[t('Date'), t('Customer'), t('Received'), t('Applied'), t('Available'), '']}>
            {rows.map((a) => {
              const left = advanceBalance(a)
              const used = appliedTotal(a)
              return (
                <Tr key={a.id}>
                  <Td>{fmtDate(a.date)}</Td>
                  <Td>
                    {a.customerName || '—'}
                    {a.notes && <span className="block text-[11px] text-gray-400 dark:text-slate-500">{a.notes}</span>}
                  </Td>
                  <Td className="tabular">{fmtMoney(a.amount, sym)}</Td>
                  <Td className="tabular text-gray-500 dark:text-slate-400">
                    {fmtMoney(used, sym)}
                    {a.refunded > 0 && <span className="block text-[11px]">{t('refunded')} {fmtMoney(a.refunded, sym)}</span>}
                  </Td>
                  <Td className="tabular font-semibold">
                    {left > 0.005
                      ? fmtMoney(left, sym)
                      : <Badge className="bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400">{t('Settled')}</Badge>}
                  </Td>
                  <Td className="text-end whitespace-nowrap">
                    {left > 0.005 && (
                      <>
                        <button onClick={() => openApply(a)} className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400 ms-2 inline-flex items-center gap-1">
                          <Link2 size={12} /> {t('Apply')}
                        </button>
                        <button onClick={() => openRefund(a)} className="text-xs font-semibold text-gray-500 hover:text-gray-700 dark:text-slate-400 ms-3 inline-flex items-center gap-1">
                          <Undo2 size={12} /> {t('Refund')}
                        </button>
                      </>
                    )}
                    {used === 0 && !(a.refunded > 0) && (
                      <button onClick={() => remove(a)} title={t('Delete')} className="text-gray-300 hover:text-red-500 ms-3 align-middle">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      {/* Receive */}
      <Modal open={modal} onClose={() => setModal(false)} title={t('Receive advance')}>
        <div className="space-y-3">
          <Select label={t('Customer')} value={form.customerId} onChange={(e) => setField('customerId', e.target.value)}>
            <option value="">{t('Select…')}</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('Amount')} type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setField('amount', e.target.value)} />
            <Input label={t('Date received')} type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
          </div>
          <Select label={t('Paid into')} value={form.bankAccountId} onChange={(e) => setField('bankAccountId', e.target.value)}>
            <option value="">{t('Select…')}</option>
            {bankAccounts.map((b) => <option key={b.id} value={b.accountId}>{b.name}</option>)}
          </Select>
          <Input label={t('Note')} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder={t('50% deposit on order')} />
          {form.customerId && (
            <p className="text-xs text-gray-400 dark:text-slate-500">
              {t('This customer already holds {amt} on account.').replace('{amt}', fmtMoney(customerCredit(customerAdvances, form.customerId), sym))}
            </p>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <p className="text-xs text-gray-400 dark:text-slate-500">
            {t('Recorded as a liability, not revenue — the cash is yours to hold, but the work is not done yet.')}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={save}>{t('Record advance')}</Btn>
          </div>
        </div>
      </Modal>

      {/* Apply */}
      <Modal open={!!applyFor} onClose={() => setApplyFor(null)} title={t('Apply to invoice')}>
        {applyFor && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {t('{name} · {amt} available').replace('{name}', applyFor.customerName || '').replace('{amt}', fmtMoney(advanceBalance(applyFor), sym))}
            </p>
            {openInvoicesFor(applyFor).length === 0 ? (
              <p className="text-sm bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300 rounded-lg px-3 py-2.5">
                {t('This customer has no unpaid invoices to apply it to yet.')}
              </p>
            ) : (
              <>
                <Select label={t('Invoice')} value={applyForm.invoiceId} onChange={(e) => setApplyForm((f) => ({ ...f, invoiceId: e.target.value }))}>
                  {openInvoicesFor(applyFor).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.number} — {fmtMoney((i.total || 0) - (i.amountPaid || 0), sym)} {t('outstanding')}
                    </option>
                  ))}
                </Select>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={t('Amount')} type="number" min="0" step="0.01"
                    value={applyForm.amount}
                    onChange={(e) => setApplyForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder={String(maxApply)}
                  />
                  <Input label={t('Date')} type="date" value={applyForm.date} onChange={(e) => setApplyForm((f) => ({ ...f, date: e.target.value }))} />
                </div>
                <p className="text-xs text-gray-400 dark:text-slate-500">
                  {t('Leave the amount blank to apply the most this invoice can take ({amt}).').replace('{amt}', fmtMoney(maxApply, sym))}
                </p>
              </>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Btn variant="secondary" onClick={() => setApplyFor(null)}>{t('Cancel')}</Btn>
              <Btn onClick={doApply} disabled={!applyForm.invoiceId}>{t('Apply')}</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Refund */}
      <Modal open={!!refundFor} onClose={() => setRefundFor(null)} title={t('Refund advance')}>
        {refundFor && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('Amount')} type="number" min="0" step="0.01" value={refundForm.amount} onChange={(e) => setRefundForm((f) => ({ ...f, amount: e.target.value }))} />
              <Input label={t('Date')} type="date" value={refundForm.date} onChange={(e) => setRefundForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <Select label={t('Refund from')} value={refundForm.bankAccountId} onChange={(e) => setRefundForm((f) => ({ ...f, bankAccountId: e.target.value }))}>
              <option value="">{t('Select…')}</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.accountId}>{b.name}</option>)}
            </Select>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Btn variant="secondary" onClick={() => setRefundFor(null)}>{t('Cancel')}</Btn>
              <Btn onClick={doRefund}>{t('Refund')}</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
