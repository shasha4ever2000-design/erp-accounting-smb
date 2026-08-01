import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td, StatCard, Modal, Input, Select } from '../components/UI'
import { advanceBalance, repaidTotal, runsRemaining, owedBy } from '../utils/employeeAdvances'
import { HandCoins, Plus, Trash2, Undo2, XCircle, Users } from 'lucide-react'

const today = () => new Date().toISOString().slice(0, 10)

const STATUS_CLASS = {
  open: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
  settled: 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300',
  written_off: 'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300',
}
const STATUS_LABEL = { open: 'Repaying', settled: 'Settled', written_off: 'Written off' }

const emptyForm = () => ({
  employeeId: '', employeeName: '', amount: '', instalment: '',
  date: today(), bankAccountId: '', notes: '',
})

export default function EmployeeAdvances() {
  const t = useT()
  const {
    employeeAdvances = [], employees = [], bankAccounts = [], accounts = [], settings,
    issueEmployeeAdvance, repayEmployeeAdvance, writeOffEmployeeAdvance, deleteEmployeeAdvance,
  } = useStore()
  const sym = settings.company.currencySymbol

  const [form, setForm] = useState(emptyForm())
  const [modal, setModal] = useState(false)
  const [error, setError] = useState('')
  const [repayFor, setRepayFor] = useState(null)
  const [repayForm, setRepayForm] = useState({ amount: '', date: today(), bankAccountId: '' })
  const [writeOffFor, setWriteOffFor] = useState(null)
  const [writeOffForm, setWriteOffForm] = useState({ date: today(), expenseAccountId: 'acc-salary', reason: '' })

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const rows = useMemo(
    () => [...employeeAdvances].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [employeeAdvances]
  )
  const outstanding = useMemo(
    () => rows.filter((a) => a.status !== 'written_off').reduce((s, a) => s + advanceBalance(a), 0),
    [rows]
  )
  const staffOwing = useMemo(
    () => new Set(rows.filter((a) => a.status === 'open' && advanceBalance(a) > 0.005).map((a) => a.employeeId)).size,
    [rows]
  )
  const expenseAccounts = accounts.filter((a) => a.type === 'expense')

  const save = () => {
    setError('')
    const emp = employees.find((e) => e.id === form.employeeId)
    try {
      issueEmployeeAdvance({
        ...form,
        amount: Number(form.amount) || 0,
        instalment: Number(form.instalment) || 0,
        employeeName: emp?.name || '',
      })
      setModal(false); setForm(emptyForm())
    } catch (e) {
      const msg = String(e.message || e)
      setError(msg.startsWith('EMPADV_INVALID:') ? msg.slice('EMPADV_INVALID:'.length) : msg)
    }
  }

  const doRepay = () => {
    setError('')
    try {
      repayEmployeeAdvance(repayFor.id, { ...repayForm, amount: Number(repayForm.amount) || 0 })
      setRepayFor(null)
    } catch (e) {
      const msg = String(e.message || e)
      setError(msg.startsWith('EMPADV_NOTHING_OWED') ? t('This advance is already fully repaid.')
        : msg.startsWith('EMPADV_NO_BANK') ? t('Choose the account the money was paid into.')
        : msg)
    }
  }

  const doWriteOff = () => {
    setError('')
    try {
      writeOffEmployeeAdvance(writeOffFor.id, writeOffForm)
      setWriteOffFor(null)
    } catch (e) { setError(String(e.message || e)) }
  }

  const remove = (adv) => {
    if (!confirm(t('Delete this advance? Its journal entry goes to the recycle bin.'))) return
    try { deleteEmployeeAdvance(adv.id) } catch (e) {
      if (String(e.message).startsWith('EMPADV_IN_USE'))
        return alert(t('Some of this advance has already been repaid, so it stays on the record.'))
      throw e
    }
  }

  return (
    <div>
      <PageHeader
        title={t('Employee Advances')}
        subtitle={t('Salary advances and staff loans — recovered automatically from payroll')}
        action={<Btn onClick={() => { setForm(emptyForm()); setError(''); setModal(true) }}><Plus size={15} /> {t('Issue advance')}</Btn>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <StatCard label={t('Outstanding')} value={fmtMoney(outstanding, sym)} sub={t('owed back by staff')} icon={<HandCoins size={18} />} color="amber" />
        <StatCard label={t('Staff repaying')} value={String(staffOwing)} icon={<Users size={18} />} color="blue" />
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<HandCoins size={28} className="text-slate-400 dark:text-slate-500" />}
            title={t('No advances yet')}
            desc={t('An advance is money lent to an employee, not a cost. It is held as an asset and comes back through payroll a bit at a time, so nobody has to remember the deduction each month.')}
          />
        ) : (
          <Table headers={[t('Date'), t('Employee'), t('Advanced'), t('Repaid'), t('Outstanding'), t('Per payroll'), t('Status'), '']}>
            {rows.map((a) => {
              const left = advanceBalance(a)
              const runs = runsRemaining(a)
              return (
                <Tr key={a.id}>
                  <Td>{fmtDate(a.date)}</Td>
                  <Td>
                    {a.employeeName || '—'}
                    {a.notes && <span className="block text-[11px] text-gray-400 dark:text-slate-500">{a.notes}</span>}
                  </Td>
                  <Td className="tabular">{fmtMoney(a.amount, sym)}</Td>
                  <Td className="tabular text-gray-500 dark:text-slate-400">{fmtMoney(repaidTotal(a), sym)}</Td>
                  <Td className="tabular font-semibold">{a.status === 'written_off' ? '—' : fmtMoney(left, sym)}</Td>
                  <Td className="tabular text-gray-500 dark:text-slate-400">
                    {a.instalment > 0 ? fmtMoney(a.instalment, sym) : t('whole balance')}
                    {runs != null && runs > 0 && (
                      <span className="block text-[11px]">{runs} {runs === 1 ? t('run left') : t('runs left')}</span>
                    )}
                  </Td>
                  <Td><Badge className={STATUS_CLASS[a.status] || ''}>{t(STATUS_LABEL[a.status] || a.status)}</Badge></Td>
                  <Td className="text-end whitespace-nowrap">
                    {a.status === 'open' && left > 0.005 && (
                      <>
                        <button onClick={() => { setRepayForm({ amount: String(left), date: today(), bankAccountId: a.bankAccountId || '' }); setError(''); setRepayFor(a) }}
                          className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400 ms-2 inline-flex items-center gap-1">
                          <Undo2 size={12} /> {t('Repay')}
                        </button>
                        <button onClick={() => { setWriteOffForm({ date: today(), expenseAccountId: 'acc-salary', reason: '' }); setError(''); setWriteOffFor(a) }}
                          className="text-xs font-semibold text-gray-500 hover:text-danger-600 dark:text-slate-400 ms-3 inline-flex items-center gap-1">
                          <XCircle size={12} /> {t('Write off')}
                        </button>
                      </>
                    )}
                    {(a.repayments || []).length === 0 && a.status === 'open' && (
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

      {/* Issue */}
      <Modal open={modal} onClose={() => setModal(false)} title={t('Issue advance')}>
        <div className="space-y-3">
          <Select label={t('Employee')} value={form.employeeId} onChange={(e) => setField('employeeId', e.target.value)}>
            <option value="">{t('Select…')}</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('Amount')} type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setField('amount', e.target.value)} />
            <Input label={t('Date paid out')} type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('Deduct per payroll')} type="number" min="0" step="0.01" value={form.instalment} onChange={(e) => setField('instalment', e.target.value)} placeholder={t('Whole amount')} />
            <Select label={t('Paid from')} value={form.bankAccountId} onChange={(e) => setField('bankAccountId', e.target.value)}>
              <option value="">{t('Select…')}</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.accountId}>{b.name}</option>)}
            </Select>
          </div>
          <Input label={t('Note')} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder={t('Advance against salary')} />
          {form.employeeId && owedBy(employeeAdvances, form.employeeId) > 0 && (
            <p className="text-xs text-warning-600 dark:text-warning-400">
              {t('This employee already owes {amt}.').replace('{amt}', fmtMoney(owedBy(employeeAdvances, form.employeeId), sym))}
            </p>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <p className="text-xs text-gray-400 dark:text-slate-500">
            {t('Recorded as an asset, not a payroll cost — the money is still yours until it is worked off. Payroll deducts the instalment automatically.')}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={save}>{t('Issue advance')}</Btn>
          </div>
        </div>
      </Modal>

      {/* Cash repayment */}
      <Modal open={!!repayFor} onClose={() => setRepayFor(null)} title={t('Repay in cash')}>
        {repayFor && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {t('{name} · {amt} outstanding').replace('{name}', repayFor.employeeName || '').replace('{amt}', fmtMoney(advanceBalance(repayFor), sym))}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('Amount')} type="number" min="0" step="0.01" value={repayForm.amount} onChange={(e) => setRepayForm((f) => ({ ...f, amount: e.target.value }))} />
              <Input label={t('Date')} type="date" value={repayForm.date} onChange={(e) => setRepayForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <Select label={t('Paid into')} value={repayForm.bankAccountId} onChange={(e) => setRepayForm((f) => ({ ...f, bankAccountId: e.target.value }))}>
              <option value="">{t('Select…')}</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.accountId}>{b.name}</option>)}
            </Select>
            <p className="text-xs text-gray-400 dark:text-slate-500">{t('For money handed back outside payroll. Payroll deductions are recorded automatically.')}</p>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Btn variant="secondary" onClick={() => setRepayFor(null)}>{t('Cancel')}</Btn>
              <Btn onClick={doRepay}>{t('Record repayment')}</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Write off */}
      <Modal open={!!writeOffFor} onClose={() => setWriteOffFor(null)} title={t('Write off advance')}>
        {writeOffFor && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {t('{name} · {amt} outstanding').replace('{name}', writeOffFor.employeeName || '').replace('{amt}', fmtMoney(advanceBalance(writeOffFor), sym))}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('Date')} type="date" value={writeOffForm.date} onChange={(e) => setWriteOffForm((f) => ({ ...f, date: e.target.value }))} />
              <Select label={t('Charge to')} value={writeOffForm.expenseAccountId} onChange={(e) => setWriteOffForm((f) => ({ ...f, expenseAccountId: e.target.value }))}>
                {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
              </Select>
            </div>
            <Input label={t('Reason')} value={writeOffForm.reason} onChange={(e) => setWriteOffForm((f) => ({ ...f, reason: e.target.value }))} placeholder={t('Left without notice')} />
            <p className="text-xs text-warning-600 dark:text-warning-400">
              {t('This is the point the advance becomes a cost. It cannot be undone from here — the entry would have to be reversed manually.')}
            </p>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Btn variant="secondary" onClick={() => setWriteOffFor(null)}>{t('Cancel')}</Btn>
              <Btn onClick={doWriteOff}>{t('Write off')}</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
