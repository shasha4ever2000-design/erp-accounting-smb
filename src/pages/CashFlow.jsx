import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { exportCSV } from '../utils/csv'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, StatCard, EmptyState, Table, Tr, Td, Badge } from '../components/UI'
import { ArrowLeftRight, ArrowRight, Trash2, Landmark, Download, TrendingUp, TrendingDown, Wallet, CalendarClock, Play, Pause, CreditCard } from 'lucide-react'

const FREQ_LABELS = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' }

export default function CashFlow() {
  const t = useT()
  const {
    bankAccounts, accounts, journalEntries, bankTransfers, getAllBalances, addBankTransfer, deleteBankTransfer,
    scheduledTransfers, addScheduledTransfer, updateScheduledTransfer, deleteScheduledTransfer, postScheduledTransfer, settings,
  } = useStore()
  const sym = settings.company.currencySymbol
  const todayStr = today()

  const bankAccIds = bankAccounts.map((b) => b.accountId)
  // Liability accounts that can be a transfer endpoint (credit cards, loans, overdrafts)
  const liabilityXfer = accounts.filter((a) => a.type === 'liability' && (['acc-creditcard', 'acc-loan'].includes(a.id) || /credit card|loan|overdraft|line of credit/i.test(a.name)))
  const balances = getAllBalances()
  const getBalance = (accId) => {
    const b = balances[accId]
    if (!b) return 0
    const acc = accounts.find((a) => a.id === accId)
    if (!acc) return 0
    return ['asset', 'expense'].includes(acc.type) ? b.dr - b.cr : b.cr - b.dr
  }
  const accName = (id) => accounts.find((a) => a.id === id)?.name || id
  const totalCash = bankAccIds.reduce((s, id) => s + getBalance(id), 0)

  // ─── Period filter ─────────────────────────────────────────────
  const monthStart = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` })()
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today())

  // Cash movements = every journal line that hits a bank/cash account in range
  const movements = useMemo(() => {
    const rows = []
    journalEntries.forEach((je) => {
      if ((je.date || '') < from || (je.date || '') > to) return
      je.lines.forEach((l, idx) => {
        if (!bankAccIds.includes(l.accountId)) return
        const delta = (l.debit || 0) - (l.credit || 0)
        if (delta === 0) return
        rows.push({ key: `${je.id}-${idx}`, date: je.date, desc: je.description, ref: je.number, account: accName(l.accountId), amount: delta, type: je.type })
      })
    })
    return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }, [journalEntries, from, to, bankAccIds.join(',')])

  const cashIn = movements.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0)
  const cashOut = movements.filter((m) => m.amount < 0).reduce((s, m) => s + Math.abs(m.amount), 0)

  // ─── Transfer modal ────────────────────────────────────────────
  const expenseAccounts = accounts.filter((a) => a.type === 'expense')
  const defaultFee = accounts.some((a) => a.id === 'acc-bankchg') ? 'acc-bankchg' : 'acc-misc'
  const emptyTf = () => ({ date: today(), fromAccountId: bankAccIds[0] || '', toAccountId: bankAccIds[1] || bankAccIds[0] || '', amount: '', fee: '', feeAccountId: defaultFee, reference: '', notes: '' })
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(emptyTf())
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openTransfer = () => { setForm(emptyTf()); setModal(true) }

  const handleTransfer = () => {
    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) return alert('Enter a valid amount.')
    if (form.fromAccountId === form.toAccountId) return alert('Source and destination must differ.')
    const fee = parseFloat(form.fee) || 0
    addBankTransfer({ ...form, amount, fee })
    setModal(false)
    setForm(emptyTf())
  }

  const handleDelete = (tf) => { if (confirm('Delete this transfer?')) deleteBankTransfer(tf.id) }

  const sortedTransfers = [...bankTransfers].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''))

  // Endpoint <option>s grouped into Cash & Bank and Credit Cards & Loans.
  const accountOptions = (
    <>
      <optgroup label={t('Cash & Bank')}>
        {bankAccounts.map((b) => <option key={b.id} value={b.accountId}>{b.name}</option>)}
      </optgroup>
      {liabilityXfer.length > 0 && (
        <optgroup label={t('Credit Cards & Loans')}>
          {liabilityXfer.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </optgroup>
      )}
    </>
  )

  // ─── Scheduled transfers ───────────────────────────────────────
  const emptySched = () => ({ fromAccountId: bankAccIds[0] || '', toAccountId: bankAccIds[1] || bankAccIds[0] || '', amount: '', fee: '', feeAccountId: defaultFee, frequency: 'monthly', nextDate: todayStr, reference: '', notes: '' })
  const [schedModal, setSchedModal] = useState(false)
  const [schedForm, setSchedForm] = useState(emptySched())
  const setSched = (k, v) => setSchedForm((f) => ({ ...f, [k]: v }))

  const handleSaveSchedule = () => {
    const amount = parseFloat(schedForm.amount)
    if (!amount || amount <= 0) return alert('Enter a valid amount.')
    if (schedForm.fromAccountId === schedForm.toAccountId) return alert('Source and destination must differ.')
    addScheduledTransfer({ ...schedForm, amount, fee: parseFloat(schedForm.fee) || 0 })
    setSchedModal(false)
    setSchedForm(emptySched())
  }
  const handleDeleteSchedule = (sc) => { if (confirm('Delete this scheduled transfer?')) deleteScheduledTransfer(sc.id) }
  const sortedSchedules = [...scheduledTransfers].sort((a, b) => (a.nextDate || '').localeCompare(b.nextDate || ''))

  const exportMovements = () => exportCSV(`cash-movements-${from}_${to}`, movements, [
    { key: 'date', label: t('Date') },
    { key: 'desc', label: t('Description') },
    { key: 'account', label: t('Account') },
    { key: 'ref', label: t('Ref') },
    { key: 'in', label: t('Money In'), map: (_, m) => (m.amount > 0 ? m.amount.toFixed(2) : '') },
    { key: 'out', label: t('Money Out'), map: (_, m) => (m.amount < 0 ? Math.abs(m.amount).toFixed(2) : '') },
  ])

  const fromBal = getBalance(form.fromAccountId)

  return (
    <div>
      <PageHeader
        title={t('Cash Flow')}
        subtitle={t('Cash position, internal transfers and money movements')}
        action={<Btn onClick={openTransfer}><ArrowLeftRight size={15} /> {t('Transfer Funds')}</Btn>}
      />

      {/* Cash position */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label={t('Total Cash')} value={fmtMoney(totalCash, sym)} color={totalCash >= 0 ? 'green' : 'red'} icon={<Wallet size={18} />} />
        {bankAccounts.map((b) => (
          <StatCard key={b.id} label={b.name} value={fmtMoney(getBalance(b.accountId), sym)} color={getBalance(b.accountId) >= 0 ? 'blue' : 'red'} icon={<Landmark size={18} />} />
        ))}
      </div>

      {/* Period + flow summary */}
      <Card className="p-5 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <Input label={t('From')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          <Input label={t('To')} type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          <div className="ml-auto grid grid-cols-3 gap-4">
            <div className="text-right">
              <p className="text-[11px] uppercase text-gray-400 dark:text-slate-500">{t('Cash In')}</p>
              <p className="text-lg font-bold text-green-600 dark:text-green-400 flex items-center gap-1 justify-end"><TrendingUp size={15} /> {fmtMoney(cashIn, sym)}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase text-gray-400 dark:text-slate-500">{t('Cash Out')}</p>
              <p className="text-lg font-bold text-red-500 dark:text-red-400 flex items-center gap-1 justify-end"><TrendingDown size={15} /> {fmtMoney(cashOut, sym)}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase text-gray-400 dark:text-slate-500">{t('Net Movement')}</p>
              <p className={`text-lg font-bold ${cashIn - cashOut >= 0 ? 'text-gray-800 dark:text-slate-100' : 'text-red-600'}`}>{fmtMoney(cashIn - cashOut, sym)}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Internal transfers */}
      <Card className="mb-6">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-semibold text-sm text-gray-700 dark:text-slate-200 flex items-center gap-2"><ArrowLeftRight size={15} className="text-gray-400" /> {t('Internal Transfers')}</h3>
          <Btn size="sm" variant="secondary" onClick={openTransfer}><ArrowLeftRight size={13} /> {t('New Transfer')}</Btn>
        </div>
        {sortedTransfers.length === 0 ? (
          <EmptyState icon="🔄" title={t('No transfers yet')} desc={t('Move money between your own bank and cash accounts.')} action={<Btn onClick={openTransfer}><ArrowLeftRight size={14} /> {t('Transfer Funds')}</Btn>} />
        ) : (
          <Table headers={[t('Date'), t('From'), '', t('To'), { label: t('Amount'), right: true }, { label: t('Fee'), right: true }, t('Ref'), { label: '', right: true }]}>
            {sortedTransfers.map((tf) => (
              <Tr key={tf.id}>
                <Td className="text-gray-500 dark:text-slate-400">{fmtDate(tf.date)}</Td>
                <Td className="font-medium text-gray-800 dark:text-slate-100">{accName(tf.fromAccountId)}</Td>
                <Td className="text-gray-300 dark:text-slate-600"><ArrowRight size={14} /></Td>
                <Td className="font-medium text-gray-800 dark:text-slate-100">{accName(tf.toAccountId)}</Td>
                <Td right className="font-semibold text-gray-800 dark:text-slate-100">{fmtMoney(tf.amount, sym)}</Td>
                <Td right className="text-gray-400">{tf.fee > 0 ? fmtMoney(tf.fee, sym) : '—'}</Td>
                <Td className="text-gray-400 text-xs font-mono">{tf.reference || '—'}</Td>
                <Td right><Btn size="sm" variant="ghost" onClick={() => handleDelete(tf)}><Trash2 size={13} className="text-red-400" /></Btn></Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Scheduled transfers */}
      <Card className="mb-6">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-semibold text-sm text-gray-700 dark:text-slate-200 flex items-center gap-2"><CalendarClock size={15} className="text-gray-400" /> {t('Scheduled Transfers')}</h3>
          <Btn size="sm" variant="secondary" onClick={() => { setSchedForm(emptySched()); setSchedModal(true) }}><CalendarClock size={13} /> {t('New Scheduled Transfer')}</Btn>
        </div>
        {sortedSchedules.length === 0 ? (
          <EmptyState icon="📅" title={t('No scheduled transfers')} desc={t('Automate recurring sweeps — e.g. a monthly transfer to savings or a card payment.')} action={<Btn onClick={() => { setSchedForm(emptySched()); setSchedModal(true) }}><CalendarClock size={14} /> {t('New Scheduled Transfer')}</Btn>} />
        ) : (
          <Table headers={[t('From'), '', t('To'), { label: t('Amount'), right: true }, t('Frequency'), t('Next Date'), { label: '', right: true }]}>
            {sortedSchedules.map((sc) => {
              const due = sc.active && sc.nextDate <= todayStr
              return (
                <Tr key={sc.id} className={!sc.active ? 'opacity-50' : ''}>
                  <Td className="font-medium text-gray-800 dark:text-slate-100">{accName(sc.fromAccountId)}</Td>
                  <Td className="text-gray-300 dark:text-slate-600"><ArrowRight size={14} /></Td>
                  <Td className="font-medium text-gray-800 dark:text-slate-100">{accName(sc.toAccountId)}</Td>
                  <Td right className="font-semibold text-gray-800 dark:text-slate-100">{fmtMoney(sc.amount, sym)}{sc.fee > 0 ? <span className="text-xs text-gray-400"> +{fmtMoney(sc.fee, sym)}</span> : null}</Td>
                  <Td className="text-gray-500 dark:text-slate-400 text-sm">{t(FREQ_LABELS[sc.frequency] || sc.frequency)}</Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      <span className={due ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500 dark:text-slate-400'}>{fmtDate(sc.nextDate)}</span>
                      {due && <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">{t('Due')}</Badge>}
                      {!sc.active && <Badge className="bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400">{t('Paused')}</Badge>}
                    </span>
                  </Td>
                  <Td right>
                    <div className="flex items-center justify-end gap-1">
                      {sc.active && (
                        <Btn size="sm" variant={due ? 'success' : 'ghost'} onClick={() => postScheduledTransfer(sc.id)} title={t('Post now')}>
                          <Play size={13} /> {due ? t('Post now') : ''}
                        </Btn>
                      )}
                      <Btn size="sm" variant="ghost" onClick={() => updateScheduledTransfer(sc.id, { active: !sc.active })} title={sc.active ? t('Pause') : t('Resume')}>
                        {sc.active ? <Pause size={13} className="text-amber-500" /> : <Play size={13} className="text-green-600" />}
                      </Btn>
                      <Btn size="sm" variant="ghost" onClick={() => handleDeleteSchedule(sc)}><Trash2 size={13} className="text-red-400" /></Btn>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      {/* Cash movements ledger */}
      <Card>
        <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-semibold text-sm text-gray-700 dark:text-slate-200 flex items-center gap-2"><Landmark size={15} className="text-gray-400" /> {t('Cash Movements')}</h3>
          {movements.length > 0 && <Btn size="sm" variant="secondary" onClick={exportMovements}><Download size={13} /> {t('Export CSV')}</Btn>}
        </div>
        {movements.length === 0 ? (
          <div className="py-10 text-center text-gray-400 dark:text-slate-500 text-sm">{t('No cash movements in this period')}</div>
        ) : (
          <Table headers={[t('Date'), t('Description'), t('Account'), t('Ref'), { label: t('Money In'), right: true }, { label: t('Money Out'), right: true }]}>
            {movements.map((m) => (
              <Tr key={m.key}>
                <Td className="text-gray-500 dark:text-slate-400">{fmtDate(m.date)}</Td>
                <Td className="text-gray-800 dark:text-slate-200">{m.desc}</Td>
                <Td className="text-gray-500 dark:text-slate-400 text-sm">{m.account}</Td>
                <Td className="text-gray-400 text-xs font-mono">{m.ref || '—'}</Td>
                <Td right className="font-medium text-green-600 dark:text-green-400">{m.amount > 0 ? fmtMoney(m.amount, sym) : ''}</Td>
                <Td right className="font-medium text-red-500 dark:text-red-400">{m.amount < 0 ? fmtMoney(Math.abs(m.amount), sym) : ''}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Transfer modal */}
      <Modal open={modal} onClose={() => setModal(false)} title={t('Transfer Between Accounts')}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('From Account')} value={form.fromAccountId} onChange={(e) => setField('fromAccountId', e.target.value)}>
              {accountOptions}
            </Select>
            <Select label={t('To Account')} value={form.toAccountId} onChange={(e) => setField('toAccountId', e.target.value)}>
              {accountOptions}
            </Select>
          </div>
          <div className="bg-gray-50 dark:bg-slate-700/40 rounded-lg p-2.5 text-sm text-gray-600 dark:text-slate-300 flex justify-between">
            <span>{t('Available in source')}</span>
            <strong className={fromBal >= 0 ? '' : 'text-red-600'}>{fmtMoney(fromBal, sym)}</strong>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={`${t('Amount')} (${sym})`} type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setField('amount', e.target.value)} />
            <Input label={t('Date')} type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={`${t('Bank Fee')} (${sym})`} type="number" min="0" step="0.01" value={form.fee} onChange={(e) => setField('fee', e.target.value)} placeholder="0.00" />
            {parseFloat(form.fee) > 0 && (
              <Select label={t('Fee Account')} value={form.feeAccountId} onChange={(e) => setField('feeAccountId', e.target.value)}>
                {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            )}
          </div>
          <Input label={t('Reference')} value={form.reference} onChange={(e) => setField('reference', e.target.value)} placeholder={t('Transfer ref, cheque #...')} />
          <Textarea label={t('Notes')} value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={2} placeholder={t('Optional note for this transfer')} />
          {form.amount && parseFloat(form.amount) > 0 && (
            <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3 text-sm text-blue-700 dark:text-blue-300">
              {accName(form.fromAccountId)} <ArrowRight size={13} className="inline" /> {accName(form.toAccountId)} :
              <strong className="ml-1">{fmtMoney(parseFloat(form.amount) || 0, sym)}</strong>
              {parseFloat(form.fee) > 0 && <span className="text-xs"> (+ {fmtMoney(parseFloat(form.fee), sym)} {t('fee')})</span>}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={handleTransfer}><ArrowLeftRight size={15} /> {t('Transfer Funds')}</Btn>
          </div>
        </div>
      </Modal>

      {/* Scheduled transfer modal */}
      <Modal open={schedModal} onClose={() => setSchedModal(false)} title={t('New Scheduled Transfer')}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('From Account')} value={schedForm.fromAccountId} onChange={(e) => setSched('fromAccountId', e.target.value)}>
              {accountOptions}
            </Select>
            <Select label={t('To Account')} value={schedForm.toAccountId} onChange={(e) => setSched('toAccountId', e.target.value)}>
              {accountOptions}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={`${t('Amount')} (${sym})`} type="number" min="0.01" step="0.01" value={schedForm.amount} onChange={(e) => setSched('amount', e.target.value)} />
            <Input label={`${t('Bank Fee')} (${sym})`} type="number" min="0" step="0.01" value={schedForm.fee} onChange={(e) => setSched('fee', e.target.value)} placeholder="0.00" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('Frequency')} value={schedForm.frequency} onChange={(e) => setSched('frequency', e.target.value)}>
              {Object.entries(FREQ_LABELS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </Select>
            <Input label={t('Next Date')} type="date" value={schedForm.nextDate} onChange={(e) => setSched('nextDate', e.target.value)} />
          </div>
          <Input label={t('Reference')} value={schedForm.reference} onChange={(e) => setSched('reference', e.target.value)} placeholder={t('Transfer ref, cheque #...')} />
          <Textarea label={t('Notes')} value={schedForm.notes} onChange={(e) => setSched('notes', e.target.value)} rows={2} placeholder={t('Optional note for this transfer')} />
          <p className="text-xs text-gray-400 dark:text-slate-500">{t('Nothing posts automatically — due transfers appear here with a “Post now” button.')}</p>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setSchedModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={handleSaveSchedule}><CalendarClock size={15} /> {t('Save Schedule')}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
