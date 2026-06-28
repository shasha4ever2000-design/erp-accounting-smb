import { useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Pencil, Trash2, Briefcase, TrendingUp, TrendingDown, Clock, ChevronDown, ChevronRight } from 'lucide-react'

const emptyProject = { name: '', client: '', budget: '', startDate: today(), status: 'active', notes: '' }
const emptyTx      = { type: 'money_out', amount: '', date: today(), accountId: '', bankAccountId: '', description: '' }
const emptyTime    = { employeeName: '', date: today(), hours: '', rate: '', billable: true, description: '' }

const STATUS_CLR = {
  active:    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  on_hold:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  completed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400',
}

export default function Projects() {
  const t = useT()
  const {
    projects, bankTransactions, timeEntries, accounts, bankAccounts, settings,
    addProject, updateProject, deleteProject, recordProjectTransaction, addTimeEntry, deleteTimeEntry,
  } = useStore()
  const sym = settings.company.currencySymbol

  const [expanded, setExpanded] = useState(null)
  const [projModal, setProjModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [pForm, setPForm] = useState(emptyProject)
  const [txModal, setTxModal] = useState(null) // projectId
  const [txForm, setTxForm] = useState(emptyTx)
  const [timeModal, setTimeModal] = useState(null) // projectId
  const [tForm, setTForm] = useState(emptyTime)

  const setP = (k, v) => setPForm((f) => ({ ...f, [k]: v }))
  const setT = (k, v) => setTxForm((f) => ({ ...f, [k]: v }))
  const setTime = (k, v) => setTForm((f) => ({ ...f, [k]: v }))

  const incomeAccs  = accounts.filter((a) => a.type === 'revenue')
  const expenseAccs = accounts.filter((a) => ['expense', 'asset'].includes(a.type))

  const stats = (pid) => {
    const txns   = bankTransactions.filter((t) => t.projectId === pid)
    const income = txns.filter((t) => t.type === 'money_in').reduce((s, t) => s + (t.amount || 0), 0)
    const cost   = txns.filter((t) => t.type === 'money_out').reduce((s, t) => s + (t.amount || 0), 0)
    const profit = income - cost
    const hours  = timeEntries.filter((t) => t.projectId === pid).reduce((s, t) => s + (Number(t.hours) || 0), 0)
    const billable = timeEntries.filter((t) => t.projectId === pid && t.billable).reduce((s, t) => s + (Number(t.hours) || 0) * (Number(t.rate) || 0), 0)
    return { income, cost, profit, margin: income ? profit / income : 0, txns, hours, billable }
  }

  const openNew  = () => { setEditing(null); setPForm(emptyProject); setProjModal(true) }
  const openEdit = (p) => { setEditing(p); setPForm({ name: p.name, client: p.client || '', budget: p.budget || '', startDate: p.startDate || today(), status: p.status, notes: p.notes || '' }); setProjModal(true) }

  const saveProject = () => {
    if (!pForm.name.trim()) return alert('Project name is required.')
    const data = { ...pForm, budget: parseFloat(pForm.budget) || 0 }
    if (editing) updateProject(editing.id, data)
    else addProject(data)
    setProjModal(false)
  }

  const openTx = (pid, type) => {
    setTxForm({ ...emptyTx, type, accountId: type === 'money_in' ? (incomeAccs[0]?.id || '') : (expenseAccs.find(a => a.type === 'expense')?.id || ''), bankAccountId: bankAccounts.find(b => b.isDefault)?.accountId || bankAccounts[0]?.accountId || '' })
    setTxModal(pid)
  }

  const saveTx = () => {
    const amount = parseFloat(txForm.amount) || 0
    if (amount <= 0) return alert('Enter a valid amount.')
    if (!txForm.accountId || !txForm.bankAccountId) return alert('Select accounts.')
    recordProjectTransaction(txModal, {
      type: txForm.type, amount, date: txForm.date,
      accountId: txForm.accountId, bankAccountId: txForm.bankAccountId,
      description: txForm.description || `Project ${txForm.type === 'money_in' ? 'income' : 'cost'}`,
    })
    setTxModal(null)
  }

  const saveTime = () => {
    const hours = parseFloat(tForm.hours) || 0
    if (hours <= 0) return alert('Enter hours worked.')
    addTimeEntry({ ...tForm, projectId: timeModal, hours, rate: parseFloat(tForm.rate) || 0 })
    setTimeModal(null)
  }

  const totals = projects.reduce((acc, p) => {
    const s = stats(p.id); acc.income += s.income; acc.cost += s.cost; return acc
  }, { income: 0, cost: 0 })

  return (
    <div>
      <PageHeader
        title="Projects & Job Costing"
        subtitle={`${projects.filter(p => p.status === 'active').length} active · Net ${fmtMoney(totals.income - totals.cost, sym)}`}
        action={<Btn onClick={openNew}><Plus size={15} /> {t('New Project')}</Btn>}
      />

      <Card>
        {projects.length === 0 ? (
          <EmptyState icon="📁" title="No projects yet"
            desc="Track income, costs and billable time per project or job, and see profitability instantly."
            action={<Btn onClick={openNew}><Plus size={14} /> {t('Create Project')}</Btn>} />
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {projects.map((p) => {
              const s = stats(p.id)
              const open = expanded === p.id
              const budgetUsed = p.budget ? Math.min(100, (s.cost / p.budget) * 100) : 0
              return (
                <div key={p.id}>
                  <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => setExpanded(open ? null : p.id)}>
                    <button className="text-gray-400">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
                    <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0">
                      <Briefcase size={16} className="text-indigo-600 dark:text-indigo-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-800 dark:text-slate-100 truncate">{p.name}</p>
                        <Badge className={STATUS_CLR[p.status]}>{p.status.replace('_', ' ')}</Badge>
                      </div>
                      <p className="text-xs text-gray-400 dark:text-slate-500 font-mono">{p.number}{p.client ? ` · ${p.client}` : ''}</p>
                    </div>
                    <div className="hidden md:flex items-center gap-6 text-right">
                      <div><p className="text-[11px] text-gray-400 dark:text-slate-500 uppercase">{t('Income')}</p><p className="text-sm font-semibold text-green-600 dark:text-green-400">{fmtMoney(s.income, sym)}</p></div>
                      <div><p className="text-[11px] text-gray-400 dark:text-slate-500 uppercase">Cost</p><p className="text-sm font-semibold text-red-500 dark:text-red-400">{fmtMoney(s.cost, sym)}</p></div>
                      <div><p className="text-[11px] text-gray-400 dark:text-slate-500 uppercase">Profit</p><p className={`text-sm font-bold ${s.profit >= 0 ? 'text-gray-800 dark:text-slate-100' : 'text-red-600'}`}>{fmtMoney(s.profit, sym)}</p></div>
                    </div>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Btn size="sm" variant="ghost" onClick={() => openEdit(p)}><Pencil size={13} /></Btn>
                      <Btn size="sm" variant="ghost" onClick={() => { if (confirm(`Delete project "${p.name}"? Ledger entries are kept.`)) deleteProject(p.id) }}><Trash2 size={13} className="text-red-400" /></Btn>
                    </div>
                  </div>

                  {open && (
                    <div className="px-5 pb-5 pt-1 bg-gray-50/60 dark:bg-slate-800/30">
                      {/* KPI row */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                        <Kpi label="Income"  value={fmtMoney(s.income, sym)} color="text-green-600 dark:text-green-400" />
                        <Kpi label="Cost"    value={fmtMoney(s.cost, sym)}   color="text-red-500 dark:text-red-400" />
                        <Kpi label="Margin"  value={`${(s.margin * 100).toFixed(0)}%`} color="text-indigo-600 dark:text-indigo-300" />
                        <Kpi label="Billable Time" value={fmtMoney(s.billable, sym)} sub={`${s.hours} hrs`} color="text-gray-800 dark:text-slate-100" />
                      </div>

                      {p.budget > 0 && (
                        <div className="mb-4">
                          <div className="flex justify-between text-xs text-gray-500 dark:text-slate-400 mb-1">
                            <span>{t('Budget used')}</span><span>{fmtMoney(s.cost, sym)} / {fmtMoney(p.budget, sym)}</span>
                          </div>
                          <div className="h-2 rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden">
                            <div className={`h-full ${budgetUsed >= 100 ? 'bg-red-500' : budgetUsed > 80 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${budgetUsed}%` }} />
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2 mb-4">
                        <Btn size="sm" onClick={() => openTx(p.id, 'money_in')}><TrendingUp size={13} /> {t('Add Income')}</Btn>
                        <Btn size="sm" variant="secondary" onClick={() => openTx(p.id, 'money_out')}><TrendingDown size={13} /> {t('Add Cost')}</Btn>
                        <Btn size="sm" variant="secondary" onClick={() => { setTForm(emptyTime); setTimeModal(p.id) }}><Clock size={13} /> {t('Log Time')}</Btn>
                      </div>

                      {/* Transactions */}
                      {s.txns.length > 0 && (
                        <div className="mb-4">
                          <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase mb-1">Transactions</p>
                          <div className="rounded-lg border border-gray-100 dark:border-slate-700 overflow-hidden">
                            {s.txns.slice().reverse().map((t) => (
                              <div key={t.id} className="flex items-center justify-between px-3 py-2 text-sm border-b last:border-0 border-gray-50 dark:border-slate-700/50 bg-white dark:bg-slate-800">
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400 dark:text-slate-500 text-xs w-20">{fmtDate(t.date)}</span>
                                  <span className="text-gray-700 dark:text-slate-200">{t.description}</span>
                                </div>
                                <span className={`font-semibold ${t.type === 'money_in' ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                                  {t.type === 'money_in' ? '+' : '−'}{fmtMoney(t.amount, sym)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Time entries */}
                      {timeEntries.filter((t) => t.projectId === p.id).length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase mb-1">{t('Time Log')}</p>
                          <div className="rounded-lg border border-gray-100 dark:border-slate-700 overflow-hidden">
                            {timeEntries.filter((t) => t.projectId === p.id).slice().reverse().map((t) => (
                              <div key={t.id} className="flex items-center justify-between px-3 py-2 text-sm border-b last:border-0 border-gray-50 dark:border-slate-700/50 bg-white dark:bg-slate-800">
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400 dark:text-slate-500 text-xs w-20">{fmtDate(t.date)}</span>
                                  <span className="text-gray-700 dark:text-slate-200">{t.employeeName || 'Staff'} — {t.description || 'work'}</span>
                                  {t.billable && <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">billable</Badge>}
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-gray-600 dark:text-slate-300">{t.hours} hrs{t.rate ? ` @ ${fmtMoney(t.rate, sym)}` : ''}</span>
                                  <button onClick={() => deleteTimeEntry(t.id)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Project modal */}
      <Modal open={projModal} onClose={() => setProjModal(false)} title={editing ? 'Edit Project' : 'New Project'}>
        <div className="space-y-4">
          <Input label="Project Name *" value={pForm.name} onChange={(e) => setP('name', e.target.value)} placeholder="e.g. Website Redesign" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Client / Customer" value={pForm.client} onChange={(e) => setP('client', e.target.value)} />
            <Input label="Budget" type="number" min="0" step="0.01" value={pForm.budget} onChange={(e) => setP('budget', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start Date" type="date" value={pForm.startDate} onChange={(e) => setP('startDate', e.target.value)} />
            <Select label="Status" value={pForm.status} onChange={(e) => setP('status', e.target.value)}>
              <option value="active">{t('Active')}</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>
          <Textarea label="Notes" rows={2} value={pForm.notes} onChange={(e) => setP('notes', e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={() => setProjModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={saveProject}>{editing ? 'Save Changes' : 'Create Project'}</Btn>
          </div>
        </div>
      </Modal>

      {/* Transaction modal */}
      <Modal open={!!txModal} onClose={() => setTxModal(null)} title={txForm.type === 'money_in' ? 'Record Project Income' : 'Record Project Cost'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Amount *" type="number" min="0" step="0.01" value={txForm.amount} onChange={(e) => setT('amount', e.target.value)} />
            <Input label="Date" type="date" value={txForm.date} onChange={(e) => setT('date', e.target.value)} />
          </div>
          <Select label={txForm.type === 'money_in' ? 'Income Account' : 'Expense / Asset Account'} value={txForm.accountId} onChange={(e) => setT('accountId', e.target.value)}>
            <option value="">— Select —</option>
            {(txForm.type === 'money_in' ? incomeAccs : expenseAccs).map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
          </Select>
          <Select label="Paid to / from (Bank/Cash)" value={txForm.bankAccountId} onChange={(e) => setT('bankAccountId', e.target.value)}>
            <option value="">— Select —</option>
            {bankAccounts.map((b) => <option key={b.id} value={b.accountId}>{b.name}</option>)}
          </Select>
          <Input label="Description" value={txForm.description} onChange={(e) => setT('description', e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={() => setTxModal(null)}>{t('Cancel')}</Btn>
            <Btn onClick={saveTx}>{t('Record')}</Btn>
          </div>
        </div>
      </Modal>

      {/* Time modal */}
      <Modal open={!!timeModal} onClose={() => setTimeModal(null)} title="Log Billable Time">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Employee / Staff" value={tForm.employeeName} onChange={(e) => setTime('employeeName', e.target.value)} />
            <Input label="Date" type="date" value={tForm.date} onChange={(e) => setTime('date', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Hours *" type="number" min="0" step="0.25" value={tForm.hours} onChange={(e) => setTime('hours', e.target.value)} />
            <Input label="Rate / hour" type="number" min="0" step="0.01" value={tForm.rate} onChange={(e) => setTime('rate', e.target.value)} />
          </div>
          <Input label="Description" value={tForm.description} onChange={(e) => setTime('description', e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
            <input type="checkbox" checked={tForm.billable} onChange={(e) => setTime('billable', e.target.checked)} className="w-4 h-4 rounded text-blue-600" />
            Billable
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={() => setTimeModal(null)}>{t('Cancel')}</Btn>
            <Btn onClick={saveTime}>{t('Log Time')}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Kpi({ label, value, sub, color }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-gray-100 dark:border-slate-700">
      <p className="text-[11px] text-gray-400 dark:text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 dark:text-slate-500">{sub}</p>}
    </div>
  )
}
