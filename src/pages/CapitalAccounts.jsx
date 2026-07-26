import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Badge, EmptyState, StatCard, Table, Tr, Td } from '../components/UI'
import {
  CAPITAL_CONTROL, capitalLines, buildSummary, reconcile, allocateProfit, shareTotal,
} from '../utils/capitalAccounts'
import {
  Users, Plus, Pencil, Trash2, ArrowDownLeft, ArrowUpRight, PieChart, AlertTriangle, Wallet,
} from 'lucide-react'

const today = () => new Date().toISOString().slice(0, 10)
const emptyPartner = { name: '', code: '', share: '', notes: '', active: true }
const emptyMove = { kind: 'contribution', capitalAccountId: '', assetAccountId: '', amount: '', date: today(), description: '' }

export default function CapitalAccounts() {
  const t = useT()
  const store = useStore()
  const {
    capitalAccounts = [], capitalSubaccounts = [], journalEntries, accounts, bankAccounts = [], settings,
    addCapitalAccount, updateCapitalAccount, deleteCapitalAccount,
    recordCapitalMovement, allocateProfitToPartners, getAllBalances,
  } = store
  const sym = settings.company.currencySymbol

  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyPartner)
  const [error, setError] = useState('')

  const [moveModal, setMoveModal] = useState(false)
  const [move, setMove] = useState(emptyMove)
  const [moveError, setMoveError] = useState('')

  const [allocModal, setAllocModal] = useState(false)
  const [alloc, setAlloc] = useState({ date: today(), amount: '', description: '' })
  const [allocError, setAllocError] = useState('')

  const [detail, setDetail] = useState(null)

  const lines = useMemo(() => capitalLines(journalEntries), [journalEntries])
  const summary = useMemo(
    () => buildSummary(capitalAccounts, capitalSubaccounts, lines),
    [capitalAccounts, capitalSubaccounts, lines]
  )

  // The control account straight from the trial balance — the figure the
  // balance sheet prints. If the report disagrees with it, the report is wrong.
  const controlBalance = useMemo(() => {
    const b = getAllBalances()[CAPITAL_CONTROL] || { dr: 0, cr: 0 }
    return b.cr - b.dr
  }, [getAllBalances, journalEntries])
  const check = useMemo(() => reconcile(summary, controlBalance), [summary, controlBalance])

  const shares = shareTotal(capitalAccounts)
  const cashAccounts = accounts.filter((a) => a.type === 'asset' && a.subtype === 'current')

  // ─── Partner CRUD ────────────────────────────────────────────────
  const openNew = () => { setEditing(null); setForm(emptyPartner); setError(''); setModal(true) }
  const openEdit = (a) => {
    setEditing(a)
    setForm({ name: a.name, code: a.code || '', share: a.share ?? '', notes: a.notes || '', active: a.active !== false })
    setError('')
    setModal(true)
  }
  const savePartner = () => {
    try {
      if (editing) updateCapitalAccount(editing.id, form)
      else addCapitalAccount(form)
      setModal(false)
    } catch (e) {
      setError(String(e.message || e).replace('CAPITAL_INVALID:', '').trim())
    }
  }
  const removePartner = (a) => {
    try {
      if (!confirm(t('Delete the capital account "{n}"?').replace('{n}', a.name))) return
      deleteCapitalAccount(a.id)
    } catch (e) {
      if (String(e.message).includes('HAS_ACTIVITY')) {
        alert(t('This capital account has transactions, so it cannot be deleted — its ledger entries would point at nothing. Set it to inactive instead: the history stays readable and it drops out of new entries and profit splits.'))
      } else alert(String(e.message || e))
    }
  }

  // ─── Movements ───────────────────────────────────────────────────
  const openMove = (kind, capitalAccountId = '') => {
    setMove({ ...emptyMove, kind, capitalAccountId, assetAccountId: bankAccounts[0]?.accountId || cashAccounts[0]?.id || '' })
    setMoveError('')
    setMoveModal(true)
  }
  const saveMove = () => {
    try {
      recordCapitalMovement(move.kind, { ...move, amount: Number(move.amount) })
      setMoveModal(false)
    } catch (e) {
      const m = String(e.message || e)
      setMoveError(
        m.includes('AMOUNT_INVALID') ? t('Enter an amount greater than zero.')
        : m.includes('ACCOUNT_REQUIRED') ? t('Choose whose capital account this is.')
        : m.includes('ASSET_REQUIRED') ? t('Choose the bank or cash account.')
        : m.includes('PERIOD_LOCKED') ? t('That date falls in a locked period.')
        : m
      )
    }
  }

  // ─── Profit allocation ───────────────────────────────────────────
  // What is actually left to share out: profit earned since inception, less
  // whatever has already been pushed into the owners' accounts. Distributing
  // more than this is legal — owners routinely draw against future profit —
  // so this informs rather than blocks.
  const availableProfit = useMemo(() => {
    const bals = getAllBalances()
    const netOf = (type) => accounts.filter((a) => a.type === type).reduce((s, a) => {
      const b = bals[a.id] || { dr: 0, cr: 0 }
      return s + (type === 'revenue' ? b.cr - b.dr : b.dr - b.cr)
    }, 0)
    const earned = netOf('revenue') - netOf('expense')
    const r = bals['acc-retained'] || { dr: 0, cr: 0 }
    return Math.round((earned + (r.cr - r.dr)) * 100) / 100
  }, [getAllBalances, accounts, journalEntries])

  const preview = useMemo(
    () => (alloc.amount === '' ? [] : allocateProfit(Number(alloc.amount), capitalAccounts.filter((a) => a.active !== false))),
    [alloc.amount, capitalAccounts]
  )
  const saveAlloc = () => {
    try {
      allocateProfitToPartners({ ...alloc, amount: Number(alloc.amount) })
      setAllocModal(false)
      setAlloc({ date: today(), amount: '', description: '' })
    } catch (e) {
      const m = String(e.message || e)
      setAllocError(
        m.includes('NO_ACCOUNTS') ? t('Add a capital account first.')
        : m.includes('NOTHING_TO_ALLOCATE') ? t('Enter an amount to allocate.')
        : m.includes('PERIOD_LOCKED') ? t('That date falls in a locked period.')
        : m
      )
    }
  }

  const detailLines = useMemo(
    () => (detail ? lines.filter((l) => l.capitalAccountId === detail.id) : []),
    [detail, lines]
  )
  const subName = (id) => capitalSubaccounts.find((s) => s.id === id)?.name || t('Unassigned')

  return (
    <div>
      <PageHeader
        title="Capital Accounts"
        subtitle="What each owner has put in, taken out, and earned"
        action={
          capitalAccounts.length > 0 ? (
            <>
              <Btn variant="secondary" onClick={() => openMove('contribution')}><ArrowDownLeft size={15} /> {t('Funds in')}</Btn>
              <Btn variant="secondary" onClick={() => openMove('drawing')}><ArrowUpRight size={15} /> {t('Drawings')}</Btn>
              <Btn variant="secondary" onClick={() => { setAllocError(''); setAllocModal(true) }}><PieChart size={15} /> {t('Allocate profit')}</Btn>
              <Btn onClick={openNew}><Plus size={15} /> {t('New')}</Btn>
            </>
          ) : <Btn onClick={openNew}><Plus size={15} /> {t('New capital account')}</Btn>
        }
      />

      {capitalAccounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users size={28} className="text-slate-400 dark:text-slate-500" />}
            title="No capital accounts yet"
            desc="A sole trader does not need these — Owner's Capital and Owner's Drawings are enough. Add one per person once the business has partners, members or shareholders, and every contribution, drawing and share of profit becomes attributable by name."
            action={<Btn onClick={openNew}><Plus size={14} /> {t('New capital account')}</Btn>}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatCard label="Total owners' capital" value={fmtMoney(summary.grandTotal, sym)} icon={<Wallet size={18} />} color="blue" />
            <StatCard label="Capital accounts" value={String(capitalAccounts.filter((a) => a.active !== false).length)} icon={<Users size={18} />} color="purple" />
            <StatCard label="Profit shares" value={shares ? `${shares}%` : '—'} icon={<PieChart size={18} />}
              color={shares && shares !== 100 ? 'orange' : 'green'} />
          </div>

          {/* The subledger must equal the control account. If it ever doesn't,
              say so loudly — the balance sheet would look fine regardless. */}
          {!check.ok && (
            <Card className="p-4 mb-6 bg-rose-50/60 dark:bg-rose-500/[0.08] ring-1 ring-inset ring-rose-500/20 flex items-start gap-3">
              <AlertTriangle size={18} className="text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-rose-800 dark:text-rose-200">{t('These accounts do not add up to the ledger')}</p>
                <p className="text-rose-700 dark:text-rose-300 mt-0.5">
                  {t('The Capital Accounts control account holds {c}, but the accounts below total {s} — a difference of {d}. Some entry posted to capital without naming an owner.')
                    .replace('{c}', fmtMoney(check.control, sym))
                    .replace('{s}', fmtMoney(check.subledger, sym))
                    .replace('{d}', fmtMoney(Math.abs(check.difference), sym))}
                </p>
              </div>
            </Card>
          )}

          {shares > 0 && shares !== 100 && (
            <Card className="p-3.5 mb-6 bg-warning-50/60 dark:bg-warning-500/[0.07] ring-1 ring-inset ring-warning-500/20 flex items-start gap-3">
              <AlertTriangle size={16} className="text-warning-600 dark:text-warning-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-warning-800 dark:text-warning-200">
                {t('Profit shares add up to {n}%, not 100%. That is allowed — profit is split by ratio — but it is usually a typo.').replace('{n}', shares)}
              </p>
            </Card>
          )}

          {/* Summary matrix: a row per owner, a column per movement type */}
          <Card className="overflow-hidden mb-6">
            <div className="p-4 border-b border-gray-100 dark:border-surface-750">
              <h3 className="font-semibold text-gray-800 dark:text-slate-100">{t('Summary')}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-surface-750">
                    <th className="text-start font-medium px-4 py-2.5">{t('Owner')}</th>
                    {summary.subaccounts.map((s) => (
                      <th key={s.id} className="text-end font-medium px-4 py-2.5">{t(s.name)}</th>
                    ))}
                    {summary.uncategorisedTotal !== 0 && <th className="text-end font-medium px-4 py-2.5">{t('Other')}</th>}
                    <th className="text-end font-medium px-4 py-2.5">{t('Balance')}</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((r) => {
                    const acc = capitalAccounts.find((a) => a.id === r.id)
                    return (
                      <tr key={r.id} className="border-b border-gray-50 dark:border-surface-800 hover:bg-gray-50/70 dark:hover:bg-surface-800/50">
                        <td className="px-4 py-2.5">
                          <button onClick={() => setDetail(acc)} className="font-medium text-gray-800 dark:text-slate-100 hover:text-brand-600 dark:hover:text-brand-400">
                            {r.name}
                          </button>
                          {acc?.active === false && <Badge className="ms-2 bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">{t('inactive')}</Badge>}
                          {r.share > 0 && <span className="ms-2 text-xs text-gray-400 dark:text-slate-500">{r.share}%</span>}
                        </td>
                        {summary.subaccounts.map((s) => (
                          <td key={s.id} className="px-4 py-2.5 text-end tabular-nums text-gray-600 dark:text-slate-300">
                            {r.cells[s.id] ? fmtMoney(r.cells[s.id], sym) : '—'}
                          </td>
                        ))}
                        {summary.uncategorisedTotal !== 0 && (
                          <td className="px-4 py-2.5 text-end tabular-nums text-gray-600 dark:text-slate-300">
                            {r.uncategorised ? fmtMoney(r.uncategorised, sym) : '—'}
                          </td>
                        )}
                        <td className="px-4 py-2.5 text-end tabular-nums font-semibold text-gray-800 dark:text-slate-100">
                          {fmtMoney(r.total, sym)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1 justify-end">
                            <button onClick={() => openMove('contribution', r.id)} title={t('Funds in')}
                              className="p-1 rounded text-gray-400 hover:text-success-600 hover:bg-success-50 dark:hover:bg-success-500/10"><ArrowDownLeft size={14} /></button>
                            <button onClick={() => openMove('drawing', r.id)} title={t('Drawings')}
                              className="p-1 rounded text-gray-400 hover:text-warning-600 hover:bg-warning-50 dark:hover:bg-warning-500/10"><ArrowUpRight size={14} /></button>
                            <button onClick={() => openEdit(acc)} title={t('Edit')}
                              className="p-1 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10"><Pencil size={14} /></button>
                            <button onClick={() => removePartner(acc)} title={t('Delete')}
                              className="p-1 rounded text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}

                  {summary.unallocated && (
                    <tr className="border-b border-gray-50 dark:border-surface-800 bg-warning-50/50 dark:bg-warning-500/[0.06]">
                      <td className="px-4 py-2.5 font-medium text-warning-800 dark:text-warning-300">
                        <AlertTriangle size={13} className="inline me-1.5 -mt-0.5" />{t('Unallocated')}
                      </td>
                      {summary.subaccounts.map((s) => (
                        <td key={s.id} className="px-4 py-2.5 text-end tabular-nums text-warning-800 dark:text-warning-300">
                          {summary.unallocated.cells[s.id] ? fmtMoney(summary.unallocated.cells[s.id], sym) : '—'}
                        </td>
                      ))}
                      {summary.uncategorisedTotal !== 0 && (
                        <td className="px-4 py-2.5 text-end tabular-nums text-warning-800 dark:text-warning-300">
                          {summary.unallocated.uncategorised ? fmtMoney(summary.unallocated.uncategorised, sym) : '—'}
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-end tabular-nums font-semibold text-warning-800 dark:text-warning-300">
                        {fmtMoney(summary.unallocated.total, sym)}
                      </td>
                      <td></td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50/80 dark:bg-surface-800/60 font-semibold text-gray-800 dark:text-slate-100">
                    <td className="px-4 py-3">{t('Total')}</td>
                    {summary.subaccounts.map((s) => (
                      <td key={s.id} className="px-4 py-3 text-end tabular-nums">{fmtMoney(summary.columnTotals[s.id], sym)}</td>
                    ))}
                    {summary.uncategorisedTotal !== 0 && (
                      <td className="px-4 py-3 text-end tabular-nums">{fmtMoney(summary.uncategorisedTotal, sym)}</td>
                    )}
                    <td className="px-4 py-3 text-end tabular-nums">{fmtMoney(summary.grandTotal, sym)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Partner modal */}
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Capital Account' : 'New Capital Account'}>
        <div className="space-y-4">
          <Input label="Name *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('e.g. Ahmed Al-Rashid')} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Reference (optional)" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. P-01" />
            <Input label="Profit share %" type="number" value={form.share} onChange={(e) => setForm((f) => ({ ...f, share: e.target.value }))} placeholder="e.g. 60" />
          </div>
          <p className="text-xs text-gray-400 dark:text-slate-500 -mt-2">
            {t('Leave the share blank to split profit equally between everyone.')}
          </p>
          <Input label="Notes (optional)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="h-4 w-4 rounded border-gray-300 dark:border-slate-600"
              checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            <span className="text-gray-700 dark:text-slate-200">{t('Active — include in new entries and profit splits')}</span>
          </label>
          {error && <p className="text-sm text-rose-600 dark:text-rose-400 flex items-start gap-2"><AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={savePartner}>{editing ? 'Save Changes' : 'Create'}</Btn>
          </div>
        </div>
      </Modal>

      {/* Movement modal */}
      <Modal open={moveModal} onClose={() => setMoveModal(false)}
        title={move.kind === 'contribution' ? 'Record Funds Contributed' : 'Record Drawings'}>
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {move.kind === 'contribution'
              ? t('Money an owner has put into the business.')
              : t('Money an owner has taken out of the business.')}
          </p>
          <Select label={t('Owner')} value={move.capitalAccountId} onChange={(e) => setMove((m) => ({ ...m, capitalAccountId: e.target.value }))}>
            <option value="">{t('— Choose —')}</option>
            {capitalAccounts.filter((a) => a.active !== false).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Select label={move.kind === 'contribution' ? t('Received into') : t('Paid from')}
            value={move.assetAccountId} onChange={(e) => setMove((m) => ({ ...m, assetAccountId: e.target.value }))}>
            <option value="">{t('— Choose —')}</option>
            {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </Select>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Amount *" type="number" value={move.amount} onChange={(e) => setMove((m) => ({ ...m, amount: e.target.value }))} />
            <Input label="Date *" type="date" value={move.date} onChange={(e) => setMove((m) => ({ ...m, date: e.target.value }))} />
          </div>
          <Input label="Description (optional)" value={move.description} onChange={(e) => setMove((m) => ({ ...m, description: e.target.value }))} />
          {moveError && <p className="text-sm text-rose-600 dark:text-rose-400 flex items-start gap-2"><AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {moveError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={() => setMoveModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={saveMove}>{t('Post')}</Btn>
          </div>
        </div>
      </Modal>

      {/* Profit allocation modal */}
      <Modal open={allocModal} onClose={() => setAllocModal(false)} title="Allocate Profit to Owners">
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {t('This moves profit out of retained earnings and into each owner\'s account. Total equity does not change — the profit simply stops being "kept in the business" and becomes "owed to a named owner".')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Profit to allocate *" type="number" value={alloc.amount} onChange={(e) => setAlloc((a) => ({ ...a, amount: e.target.value }))} />
            <Input label="Date *" type="date" value={alloc.date} onChange={(e) => setAlloc((a) => ({ ...a, date: e.target.value }))} />
          </div>
          <Input label="Description (optional)" value={alloc.description} onChange={(e) => setAlloc((a) => ({ ...a, description: e.target.value }))} placeholder={t('e.g. Allocation of 2026 profit')} />

          <div className="flex items-center justify-between text-sm rounded-lg bg-gray-50 dark:bg-surface-800 px-3 py-2">
            <span className="text-gray-500 dark:text-slate-400">{t('Undistributed profit to date')}</span>
            <span className={`tabular-nums font-semibold ${availableProfit < 0 ? 'text-warning-700 dark:text-warning-400' : 'text-gray-800 dark:text-slate-100'}`}>
              {fmtMoney(availableProfit, sym)}
            </span>
          </div>
          {alloc.amount !== '' && Number(alloc.amount) > availableProfit && (
            <p className="text-xs text-warning-700 dark:text-warning-400 flex items-start gap-2 -mt-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              {t('This is more than the business has earned, so retained earnings will go negative. That is allowed — owners often draw against future profit — but check it is what you meant.')}
            </p>
          )}

          {preview.length > 0 && (
            <div className="rounded-lg border border-gray-100 dark:border-surface-750 overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 dark:bg-surface-800 text-[11px] uppercase tracking-wider text-gray-400 dark:text-slate-500">{t('Each owner receives')}</div>
              {preview.map((p) => (
                <div key={p.capitalAccountId} className="flex justify-between px-3 py-1.5 text-sm border-t border-gray-50 dark:border-surface-800">
                  <span className="text-gray-700 dark:text-slate-200">{p.name}</span>
                  <span className="tabular-nums font-medium text-gray-800 dark:text-slate-100">{fmtMoney(p.amount, sym)}</span>
                </div>
              ))}
            </div>
          )}
          {allocError && <p className="text-sm text-rose-600 dark:text-rose-400 flex items-start gap-2"><AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {allocError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={() => setAllocModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={saveAlloc}>{t('Post allocation')}</Btn>
          </div>
        </div>
      </Modal>

      {/* Per-owner statement */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.name} — ${t('Statement')}` : ''} width="max-w-3xl">
        {detail && (
          <div>
            <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-gray-100 dark:border-surface-750">
              <span className="text-sm text-gray-500 dark:text-slate-400">{t('Balance')}</span>
              <span className="text-2xl font-bold tabular-nums text-gray-800 dark:text-slate-100">
                {fmtMoney(summary.rows.find((r) => r.id === detail.id)?.total || 0, sym)}
              </span>
            </div>
            {detailLines.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-slate-500 py-6 text-center">{t('No movements yet.')}</p>
            ) : (
              <Table headers={['Date', 'Reference', 'Type', 'Description', 'Amount']}>
                {detailLines.map((l) => (
                  <Tr key={l.key}>
                    <Td className="whitespace-nowrap">{fmtDate(l.date)}</Td>
                    <Td className="text-gray-500 dark:text-slate-400">{l.number}</Td>
                    <Td><Badge className="bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">{t(subName(l.subaccountId))}</Badge></Td>
                    <Td className="text-gray-600 dark:text-slate-300">{l.description}</Td>
                    <Td className={`text-end tabular-nums font-medium ${l.amount < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-800 dark:text-slate-100'}`}>
                      {fmtMoney(l.amount, sym)}
                    </Td>
                  </Tr>
                ))}
              </Table>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
