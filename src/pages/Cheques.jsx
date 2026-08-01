import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td, StatCard, Modal, Input, Select } from '../components/UI'
import {
  CHEQUE_IN, CHEQUE_OUT, STATUS_LABEL, nextStatuses, isTerminal,
  chequeBuckets, chequeTotal,
} from '../utils/cheques'
import { Landmark, Plus, Trash2, AlertTriangle, CalendarClock, Banknote, Undo2 } from 'lucide-react'

const today = () => new Date().toISOString().slice(0, 10)

// Badge takes classes, not a tone name (see components/UI.jsx).
const STATUS_CLASS = {
  pending:   'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',
  deposited: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
  cleared:   'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300',
  bounced:   'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400',
}

const emptyForm = (direction) => ({
  direction, number: '', partyId: '', partyName: '', bankName: '',
  amount: '', issueDate: today(), dueDate: '', bankAccountId: '', notes: '',
})

export default function Cheques() {
  const t = useT()
  const {
    cheques = [], customers = [], suppliers = [], bankAccounts = [], settings,
    addCheque, setChequeStatus, deleteCheque,
  } = useStore()
  const sym = settings.company.currencySymbol

  const [direction, setDirection] = useState(CHEQUE_IN)
  const [form, setForm] = useState(emptyForm(CHEQUE_IN))
  const [modal, setModal] = useState(false)
  const [error, setError] = useState('')
  const [statusModal, setStatusModal] = useState(null) // { cheque, to }
  const [statusForm, setStatusForm] = useState({ date: today(), bankAccountId: '', reason: '' })

  const parties = direction === CHEQUE_IN ? customers : suppliers
  const mine = useMemo(
    () => cheques.filter((c) => c.direction === direction)
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))),
    [cheques, direction]
  )
  const buckets = useMemo(() => chequeBuckets(mine), [mine])

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openNew = () => { setForm(emptyForm(direction)); setError(''); setModal(true) }

  const save = () => {
    setError('')
    const party = parties.find((p) => p.id === form.partyId)
    try {
      addCheque({ ...form, amount: Number(form.amount) || 0, partyName: party?.name || '' })
      setModal(false)
    } catch (e) {
      const msg = String(e.message || e)
      setError(msg.startsWith('CHEQUE_INVALID:') ? msg.slice('CHEQUE_INVALID:'.length) : msg)
    }
  }

  const openStatus = (cheque, to) => {
    setStatusForm({ date: today(), bankAccountId: cheque.bankAccountId || bankAccounts[0]?.accountId || '', reason: '' })
    setError('')
    setStatusModal({ cheque, to })
  }

  const applyStatus = () => {
    const { cheque, to } = statusModal
    try {
      setChequeStatus(cheque.id, to, statusForm)
      setStatusModal(null)
    } catch (e) {
      const msg = String(e.message || e)
      setError(msg.startsWith('CHEQUE_NO_BANK')
        ? t('Choose the bank account this cheque clears through.')
        : msg)
    }
  }

  const remove = (cheque) => {
    if (!confirm(t('Delete cheque {n}? Its journal entry is reversed into the recycle bin.').replace('{n}', cheque.number))) return
    try { deleteCheque(cheque.id) } catch (e) {
      if (String(e.message).startsWith('CHEQUE_SETTLED'))
        return alert(t('This cheque has already cleared, bounced or been cancelled. Settled cheques stay on the record.'))
      throw e
    }
  }

  const inLabel = direction === CHEQUE_IN
  const overdueTotal = chequeTotal(buckets.overdue)
  const soonTotal = chequeTotal(buckets.dueSoon)
  const laterTotal = chequeTotal(buckets.later)

  return (
    <div>
      <PageHeader
        title={t('Cheque Register')}
        subtitle={t('Post-dated cheques stay out of your bank balance until they actually clear')}
        action={<Btn onClick={openNew}><Plus size={15} /> {inLabel ? t('Record cheque received') : t('Record cheque issued')}</Btn>}
      />

      {/* Received / issued */}
      <div className="flex gap-1.5 mb-5">
        {[CHEQUE_IN, CHEQUE_OUT].map((d) => (
          <button
            key={d}
            onClick={() => { setDirection(d); setForm(emptyForm(d)) }}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              direction === d ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}`}
          >
            {d === CHEQUE_IN ? t('Received') : t('Issued')}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label={t('Overdue')} value={fmtMoney(overdueTotal, sym)} sub={`${buckets.overdue.length} ${t('cheques')}`} icon={<AlertTriangle size={18} />} color={buckets.overdue.length ? 'red' : 'blue'} />
        <StatCard label={t('Due within 7 days')} value={fmtMoney(soonTotal, sym)} sub={`${buckets.dueSoon.length} ${t('cheques')}`} icon={<CalendarClock size={18} />} color={buckets.dueSoon.length ? 'amber' : 'blue'} />
        <StatCard label={t('Later')} value={fmtMoney(laterTotal, sym)} sub={`${buckets.later.length} ${t('cheques')}`} icon={<Banknote size={18} />} color="blue" />
      </div>

      <Card>
        {mine.length === 0 ? (
          <EmptyState
            icon={<Landmark size={28} className="text-slate-400 dark:text-slate-500" />}
            title={inLabel ? t('No cheques received yet') : t('No cheques issued yet')}
            desc={t('A cheque recorded here is held out of your bank balance until it clears, so a drawer of post-dated cheques never overstates your cash.')}
          />
        ) : (
          <Table headers={[t('Cheque #'), inLabel ? t('From') : t('To'), t('Bank'), t('Due'), t('Amount'), t('Status'), '']}>
            {mine.map((c) => {
              const overdue = !isTerminal(c.status) && c.dueDate && c.dueDate < today()
              return (
                <Tr key={c.id}>
                  <Td className="font-mono text-xs">{c.number}</Td>
                  <Td>{c.partyName || '—'}</Td>
                  <Td className="text-gray-500 dark:text-slate-400">{c.bankName || '—'}</Td>
                  <Td className={overdue ? 'text-danger-600 dark:text-danger-400 font-semibold' : ''}>
                    {c.dueDate ? fmtDate(c.dueDate) : '—'}
                  </Td>
                  <Td className="tabular font-semibold">{fmtMoney(c.amount, sym)}</Td>
                  <Td>
                    <Badge className={STATUS_CLASS[c.status] || ''}>{t(STATUS_LABEL[c.status] || c.status)}</Badge>
                    {c.status === 'bounced' && c.bounceReason && (
                      <span className="block text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{c.bounceReason}</span>
                    )}
                  </Td>
                  <Td className="text-end whitespace-nowrap">
                    {nextStatuses(c.direction, c.status).map((to) => (
                      <button
                        key={to}
                        onClick={() => openStatus(c, to)}
                        className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400 ms-2"
                      >
                        {t(STATUS_LABEL[to])}
                      </button>
                    ))}
                    {!isTerminal(c.status) && (
                      <button onClick={() => remove(c)} title={t('Delete')} className="text-gray-300 hover:text-red-500 ms-3 align-middle">
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

      {/* New cheque */}
      <Modal open={modal} onClose={() => setModal(false)} title={inLabel ? t('Cheque received') : t('Cheque issued')}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('Cheque number')} value={form.number} onChange={(e) => setField('number', e.target.value)} placeholder="004512" />
            <Input label={t('Amount')} type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setField('amount', e.target.value)} />
          </div>
          <Select label={inLabel ? t('From customer') : t('To supplier')} value={form.partyId} onChange={(e) => setField('partyId', e.target.value)}>
            <option value="">{t('Select…')}</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('Written on')} type="date" value={form.issueDate} onChange={(e) => setField('issueDate', e.target.value)} />
            <Input label={t('Dated (due)')} type="date" value={form.dueDate} onChange={(e) => setField('dueDate', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('Drawn on bank')} value={form.bankName} onChange={(e) => setField('bankName', e.target.value)} placeholder={t('Riyad Bank')} />
            <Select label={t('Clears through')} value={form.bankAccountId} onChange={(e) => setField('bankAccountId', e.target.value)}>
              <option value="">{t('Choose later')}</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.accountId}>{b.name}</option>)}
            </Select>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <p className="text-xs text-gray-400 dark:text-slate-500">
            {inLabel
              ? t('This posts to Cheques Under Collection, not your bank — the balance moves only when the cheque clears.')
              : t('This posts to Cheques Payable, not your bank — the balance moves only when the cheque is presented.')}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={save}>{t('Record cheque')}</Btn>
          </div>
        </div>
      </Modal>

      {/* Status change */}
      <Modal open={!!statusModal} onClose={() => setStatusModal(null)} title={statusModal ? t(STATUS_LABEL[statusModal.to]) : ''}>
        {statusModal && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {t('Cheque {n} · {amt}').replace('{n}', statusModal.cheque.number).replace('{amt}', fmtMoney(statusModal.cheque.amount, sym))}
            </p>
            <Input label={t('Date')} type="date" value={statusForm.date} onChange={(e) => setStatusForm((f) => ({ ...f, date: e.target.value }))} />
            {statusModal.to === 'cleared' && (
              <Select label={t('Clears through')} value={statusForm.bankAccountId} onChange={(e) => setStatusForm((f) => ({ ...f, bankAccountId: e.target.value }))}>
                <option value="">{t('Select…')}</option>
                {bankAccounts.map((b) => <option key={b.id} value={b.accountId}>{b.name}</option>)}
              </Select>
            )}
            {(statusModal.to === 'bounced' || statusModal.to === 'cancelled') && (
              <>
                <Input label={t('Reason')} value={statusForm.reason} onChange={(e) => setStatusForm((f) => ({ ...f, reason: e.target.value }))} placeholder={t('Insufficient funds')} />
                <p className="text-xs text-gray-400 dark:text-slate-500 inline-flex items-start gap-1.5">
                  <Undo2 size={13} className="mt-0.5 flex-shrink-0" />
                  {statusModal.cheque.direction === CHEQUE_IN
                    ? t('The amount goes back onto the customer’s account, and the cheque stays on record.')
                    : t('The amount goes back onto the supplier’s account, and the cheque stays on record.')}
                </p>
              </>
            )}
            {statusModal.to === 'deposited' && (
              <p className="text-xs text-gray-400 dark:text-slate-500">
                {t('Nothing is posted — the cheque has left your drawer but has not cleared.')}
              </p>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Btn variant="secondary" onClick={() => setStatusModal(null)}>{t('Cancel')}</Btn>
              <Btn onClick={applyStatus}>{t('Confirm')}</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
