import { useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Table, Tr, Td, Badge, EmptyState, StatCard } from '../components/UI'
import { alertIfLocked } from '../utils/periodLock'
import { Plus, Trash2, Repeat, Play, CalendarClock, Pencil, Pause, Receipt } from 'lucide-react'

const FREQ = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']
const emptyForm = () => ({
  name: '', supplierId: '', frequency: 'monthly', nextDate: today(), endDate: '',
  amount: '', taxRate: '', expenseAccountId: '', notes: '',
})

export default function RecurringExpenses() {
  const t = useT()
  const {
    recurringExpenses, suppliers, accounts, settings,
    addRecurringExpense, updateRecurringExpense, deleteRecurringExpense,
    postRecurringExpense, generateDueRecurringExpenses,
  } = useStore()
  const sym = settings.company.currencySymbol
  const todayStr = today()
  const expenseAccounts = accounts.filter((a) => a.type === 'expense')
  const defaultTax = settings.tax?.enabled ? (settings.tax.rate ?? 0) : 0

  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openNew = () => {
    setEditing(null)
    setForm({ ...emptyForm(), taxRate: String(defaultTax), expenseAccountId: expenseAccounts[0]?.id || '' })
    setModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      name: r.name, supplierId: r.supplierId || '', frequency: r.frequency,
      nextDate: r.nextDate, endDate: r.endDate || '',
      amount: String(r.amount ?? ''), taxRate: String(r.taxRate ?? ''),
      expenseAccountId: r.expenseAccountId || '', notes: r.notes || '',
    })
    setModal(true)
  }

  const amountNum = parseFloat(form.amount) || 0
  const taxNum = parseFloat(form.taxRate) || 0
  const previewTax = Math.round(amountNum * (taxNum / 100) * 100) / 100
  const previewTotal = Math.round((amountNum + previewTax) * 100) / 100

  const save = () => {
    if (!form.name.trim()) return alert(t('Enter a name for this recurring expense.'))
    if (amountNum <= 0) return alert(t('Enter an amount greater than zero.'))
    if (!form.expenseAccountId) return alert(t('Choose an expense account.'))
    if (!form.nextDate) return alert(t('Choose the next due date.'))
    const supplier = suppliers.find((s) => s.id === form.supplierId)
    const payload = {
      ...form,
      amount: amountNum, taxRate: taxNum,
      supplierName: supplier?.name || '',
    }
    if (editing) updateRecurringExpense(editing.id, payload)
    else addRecurringExpense(payload)
    setModal(false)
  }

  const postNow = (r) => {
    if (!confirm(t('Post "{name}" now as a supplier bill?').replace('{name}', r.name))) return
    try { postRecurringExpense(r.id) }
    catch (e) { if (alertIfLocked(e, t)) return; alert(t('Could not post this expense') + ': ' + e.message) }
  }

  const runDue = () => {
    try {
      const n = generateDueRecurringExpenses()
      alert(n > 0 ? t('Posted {n} due bill(s).').replace('{n}', n) : t('Nothing is due right now.'))
    } catch (e) { if (!alertIfLocked(e, t)) alert(e.message) }
  }

  const toggle = (r) => updateRecurringExpense(r.id, { status: r.status === 'active' ? 'paused' : 'active' })

  const remove = (r) => { if (confirm(t('Delete the "{name}" schedule? Bills already posted are kept.').replace('{name}', r.name))) deleteRecurringExpense(r.id) }

  const active = recurringExpenses.filter((r) => r.status === 'active')
  const dueNow = active.filter((r) => r.nextDate <= todayStr)
  // Normalise every schedule to a monthly figure so the total is comparable.
  const monthly = active.reduce((s, r) => {
    const per = { weekly: 4.333, biweekly: 2.167, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[r.frequency] || 1
    return s + (Number(r.amount) || 0) * per
  }, 0)

  const STATUS = {
    active: 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300',
    paused: 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400',
    ended: 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400',
  }

  return (
    <div>
      <PageHeader
        title="Recurring Expenses"
        subtitle="Rent, utilities and subscriptions — posted automatically as supplier bills"
        action={
          <div className="flex gap-2">
            {dueNow.length > 0 && <Btn variant="secondary" onClick={runDue}><CalendarClock size={15} /> {t('Post {n} due').replace('{n}', dueNow.length)}</Btn>}
            <Btn onClick={openNew}><Plus size={15} /> {t('New Recurring Expense')}</Btn>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Active schedules" value={String(active.length)} color="blue" icon={<Repeat size={18} />} />
        <StatCard label="Due now" value={String(dueNow.length)} color={dueNow.length ? 'orange' : 'green'} icon={<CalendarClock size={18} />} sub={dueNow.length ? 'Ready to post' : 'Nothing outstanding'} />
        <StatCard label="Committed per month" value={fmtMoney(monthly, sym)} color="purple" icon={<Receipt size={18} />} sub="Normalised across frequencies" />
      </div>

      <Card className="overflow-hidden">
        {recurringExpenses.length === 0 ? (
          <EmptyState icon="🔁" title="No recurring expenses"
            desc="Set up rent, utilities, insurance or software subscriptions once and they post themselves as supplier bills on schedule."
            action={<Btn onClick={openNew}><Plus size={14} /> {t('New Recurring Expense')}</Btn>} />
        ) : (
          <Table headers={['Name', 'Supplier', 'Frequency', 'Next due', { label: 'Amount', right: true }, 'Status', { label: 'Actions', right: true }]}>
            {[...recurringExpenses].sort((a, b) => (a.nextDate || '').localeCompare(b.nextDate || '')).map((r) => {
              const overdue = r.status === 'active' && r.nextDate <= todayStr
              return (
                <Tr key={r.id}>
                  <Td className="font-medium text-gray-900 dark:text-slate-100">
                    {r.name}
                    {r.generatedCount > 0 && <span className="block text-xs text-gray-400 dark:text-slate-500">{t('{n} posted').replace('{n}', r.generatedCount)}</span>}
                  </Td>
                  <Td className="text-gray-500 dark:text-slate-400">{r.supplierName || '—'}</Td>
                  <Td className="capitalize text-gray-500 dark:text-slate-400">{t(r.frequency)}</Td>
                  <Td className={overdue ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-500 dark:text-slate-400'}>
                    {fmtDate(r.nextDate)}{overdue && <span className="block text-xs">{t('due')}</span>}
                  </Td>
                  <Td right className="tabular-nums">{fmtMoney(r.amount, sym)}</Td>
                  <Td><Badge className={STATUS[r.status] || STATUS.paused}>{t(r.status)}</Badge></Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      {r.status !== 'ended' && (
                        <button onClick={() => postNow(r)} title={t('Post now')} className="p-1.5 rounded-lg text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/15 transition-colors"><Play size={14} /></button>
                      )}
                      {r.status !== 'ended' && (
                        <button onClick={() => toggle(r)} title={r.status === 'active' ? t('Pause') : t('Resume')} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
                          {r.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                      )}
                      <button onClick={() => openEdit(r)} title={t('Edit')} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => remove(r)} title={t('Delete')} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Recurring Expense' : 'New Recurring Expense'} width="max-w-xl">
        <div className="space-y-4">
          <Input label="Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Office rent" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select label={t('Supplier')} value={form.supplierId} onChange={(e) => setField('supplierId', e.target.value)}>
              <option value="">{t('— None —')}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Select label={t('Expense account')} value={form.expenseAccountId} onChange={(e) => setField('expenseAccountId', e.target.value)}>
              <option value="">{t('— Select —')}</option>
              {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Amount (excl. tax) *" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setField('amount', e.target.value)} placeholder="0.00" />
            <Input label={`${settings.tax?.name || 'Tax'} %`} type="number" min="0" step="0.1" value={form.taxRate} onChange={(e) => setField('taxRate', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select label={t('Frequency')} value={form.frequency} onChange={(e) => setField('frequency', e.target.value)}>
              {FREQ.map((f) => <option key={f} value={f}>{t(f)}</option>)}
            </Select>
            <Input label="Next due *" type="date" value={form.nextDate} onChange={(e) => setField('nextDate', e.target.value)} />
            <Input label="End date" type="date" value={form.endDate} onChange={(e) => setField('endDate', e.target.value)} />
          </div>
          <Input label={t('Notes')} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder={t('Optional')} />

          {amountNum > 0 && (
            <div className="rounded-lg bg-brand-50/70 dark:bg-brand-500/[0.08] px-4 py-3 text-sm">
              <div className="flex justify-between text-gray-600 dark:text-slate-300"><span>{t('Subtotal')}</span><span className="tabular-nums">{fmtMoney(amountNum, sym)}</span></div>
              {taxNum > 0 && <div className="flex justify-between text-gray-600 dark:text-slate-300"><span>{settings.tax?.name || t('Tax')} {taxNum}%</span><span className="tabular-nums">{fmtMoney(previewTax, sym)}</span></div>}
              <div className="flex justify-between font-bold text-gray-900 dark:text-slate-100 border-t border-brand-200/60 dark:border-brand-500/20 mt-1.5 pt-1.5"><span>{t('Each bill')}</span><span className="tabular-nums">{fmtMoney(previewTotal, sym)}</span></div>
            </div>
          )}

          <p className="text-xs text-gray-400 dark:text-slate-500">
            {t('Each posting creates a real supplier bill in Purchases, so it appears in Accounts Payable and can be paid normally.')}
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={save}>{editing ? t('Save Changes') : t('Create Schedule')}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
