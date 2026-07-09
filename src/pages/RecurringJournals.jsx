import { useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Table, Tr, Td, Badge, EmptyState } from '../components/UI'
import { Plus, Trash2, Repeat, Play, CalendarClock, Pencil } from 'lucide-react'

const FREQ = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']
const emptyLine = () => ({ accountId: '', debit: '', credit: '', description: '' })
const emptyForm = () => ({ name: '', frequency: 'monthly', nextDate: today(), lines: [emptyLine(), emptyLine()] })

export default function RecurringJournals() {
  const t = useT()
  const { recurringJournals, accounts, addRecurringJournal, updateRecurringJournal, deleteRecurringJournal,
    postRecurringJournal, generateDueRecurringJournals, settings } = useStore()
  const sym = settings.company.currencySymbol
  const todayStr = today()

  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setLine = (i, k, v) => setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)) }))
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))
  const removeLine = (i) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }))

  const totalDr = form.lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0)
  const totalCr = form.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0)
  const balanced = Math.abs(totalDr - totalCr) < 0.01 && totalDr > 0

  const openNew = () => { setEditing(null); setForm(emptyForm()); setModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({ name: r.name, frequency: r.frequency, nextDate: r.nextDate,
      lines: r.lines.length ? r.lines.map((l) => ({ ...l, debit: l.debit || '', credit: l.credit || '' })) : [emptyLine(), emptyLine()] })
    setModal(true)
  }

  const save = () => {
    if (!form.name.trim()) return alert(t('Enter a name for this recurring entry.'))
    if (!balanced) return alert(t('Debits must equal credits (and be greater than zero).'))
    const lines = form.lines
      .filter((l) => l.accountId && (parseFloat(l.debit) || parseFloat(l.credit)))
      .map((l) => ({ accountId: l.accountId, debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0, description: l.description || '' }))
    if (editing) updateRecurringJournal(editing.id, { name: form.name, frequency: form.frequency, nextDate: form.nextDate, lines })
    else addRecurringJournal({ name: form.name, frequency: form.frequency, nextDate: form.nextDate, lines })
    setModal(false)
  }

  const postNow = (r) => {
    try { postRecurringJournal(r.id); }
    catch (e) {
      if (String(e.message).startsWith('PERIOD_LOCKED')) return alert(t('This date falls in a closed accounting period. Choose a later date.'))
      throw e
    }
  }
  const postAllDue = () => {
    const n = generateDueRecurringJournals()
    alert(n > 0 ? t('{n} recurring entries posted.').replace('{n}', n) : t('No recurring entries are due.'))
  }

  const dueCount = recurringJournals.filter((r) => r.status === 'active' && r.nextDate <= todayStr).length

  return (
    <div>
      <PageHeader title="Recurring Journals" subtitle="Templated journal entries that post automatically on a schedule"
        action={
          <div className="flex gap-2">
            {dueCount > 0 && <Btn variant="secondary" onClick={postAllDue}><CalendarClock size={15} /> {t('Post all due')} ({dueCount})</Btn>}
            <Btn onClick={openNew}><Plus size={15} /> {t('New Recurring Entry')}</Btn>
          </div>
        } />

      {recurringJournals.length === 0 ? (
        <EmptyState icon="🔁" title={t('No recurring journals yet')} desc={t('Create a template for entries you post every period, like rent accruals or amortization.')}
          action={<Btn onClick={openNew}><Plus size={14} />{t('New Recurring Entry')}</Btn>} />
      ) : (
        <Card>
          <Table headers={[{ label: 'Name' }, { label: 'Frequency' }, { label: 'Next Date' }, { label: 'Amount', right: true }, { label: 'Posted', right: true }, { label: '', right: true }]}>
            {recurringJournals.map((r) => {
              const amt = r.lines.reduce((s, l) => s + (l.debit || 0), 0)
              const due = r.status === 'active' && r.nextDate <= todayStr
              return (
                <Tr key={r.id}>
                  <Td><span className="font-medium text-gray-800 dark:text-slate-100">{r.name}</span></Td>
                  <Td className="capitalize text-gray-500">{t(r.frequency)}</Td>
                  <Td>
                    <span className={due ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-600 dark:text-slate-300'}>{fmtDate(r.nextDate)}</span>
                    {due && <Badge className="ms-2 bg-amber-100 text-amber-700">{t('Due')}</Badge>}
                  </Td>
                  <Td right className="font-medium text-gray-800 dark:text-slate-100">{fmtMoney(amt, sym)}</Td>
                  <Td right className="text-gray-500">{r.postedCount || 0}</Td>
                  <Td right>
                    <div className="flex items-center justify-end gap-1">
                      <Btn size="sm" variant="ghost" onClick={() => postNow(r)} title={t('Post now')}><Play size={13} className="text-green-500" /></Btn>
                      <Btn size="sm" variant="ghost" onClick={() => openEdit(r)} title={t('Edit')}><Pencil size={13} /></Btn>
                      <Btn size="sm" variant="ghost" onClick={() => { if (confirm(t('Delete this recurring entry?'))) deleteRecurringJournal(r.id) }} title={t('Delete')}><Trash2 size={13} className="text-red-400" /></Btn>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? t('Edit Recurring Entry') : t('New Recurring Entry')} width="max-w-2xl">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Input label={t('Name')} value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder={t('e.g. Monthly rent accrual')} />
            <Select label={t('Frequency')} value={form.frequency} onChange={(e) => setField('frequency', e.target.value)}>
              {FREQ.map((f) => <option key={f} value={f}>{t(f)}</option>)}
            </Select>
            <Input label={t('Next Date')} type="date" value={form.nextDate} onChange={(e) => setField('nextDate', e.target.value)} />
          </div>

          <div className="border rounded-lg overflow-hidden border-gray-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/60 text-xs text-gray-400 uppercase">
                <tr><th className="text-start px-3 py-2">{t('Account')}</th><th className="text-end px-2 py-2 w-28">{t('Debit')}</th><th className="text-end px-2 py-2 w-28">{t('Credit')}</th><th className="w-8"></th></tr>
              </thead>
              <tbody>
                {form.lines.map((l, i) => (
                  <tr key={i} className="border-t border-gray-50 dark:border-slate-700/50">
                    <td className="px-3 py-1.5">
                      <select value={l.accountId} onChange={(e) => setLine(i, 'accountId', e.target.value)}
                        className="w-full border border-gray-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                        <option value="">{t('Select account…')}</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5"><input type="number" step="0.01" value={l.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} className="w-full text-end border border-gray-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-2 py-1 text-sm" /></td>
                    <td className="px-2 py-1.5"><input type="number" step="0.01" value={l.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} className="w-full text-end border border-gray-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded px-2 py-1 text-sm" /></td>
                    <td className="px-1">{form.lines.length > 2 && <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 dark:border-slate-600 bg-gray-50/60 dark:bg-slate-800/40 font-semibold text-sm">
                  <td className="px-3 py-2 text-end text-gray-500">{t('Totals')}</td>
                  <td className={`px-2 py-2 text-end ${balanced ? 'text-gray-800 dark:text-slate-100' : 'text-red-500'}`}>{fmtMoney(totalDr, sym)}</td>
                  <td className={`px-2 py-2 text-end ${balanced ? 'text-gray-800 dark:text-slate-100' : 'text-red-500'}`}>{fmtMoney(totalCr, sym)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <Btn size="sm" variant="secondary" onClick={addLine}><Plus size={13} /> {t('Add line')}</Btn>
            <span className={`text-xs font-medium ${balanced ? 'text-green-600' : 'text-red-500'}`}>{balanced ? t('Balanced') : t('Out of balance')}</span>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={save} disabled={!balanced}>{editing ? t('Save Changes') : t('Create')}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
