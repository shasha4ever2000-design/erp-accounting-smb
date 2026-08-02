import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, EmptyState, Table, Tr, Td, Badge } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import { Plus, Ban, Eye, Pencil, Search, Trash2 } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { narrate } from '../utils/jeNarration'

const emptyLine = () => ({ id: uuid(), accountId: '', debit: '', credit: '', description: '' })
const blankForm = () => ({ date: today(), description: '', reference: '', departmentId: '', lines: [emptyLine(), emptyLine()] })

// Why an entry is read-only. Auto-posted entries mirror a document and are
// corrected there; reversals and reversed entries are settled history.
// Entry types are stored as codes; these are the words for them.
const JE_TYPE_LABEL = {
  manual: 'Manual', invoice: 'Invoice', receipt: 'Receipt', purchase: 'Purchase',
  payment_out: 'Payment', money_in: 'Money in', money_out: 'Money out',
  cogs: 'Cost of sales', credit_note: 'Credit note', debit_note: 'Debit note',
  reversal: 'Reversal', stock_adj: 'Stock adjustment', stock_count: 'Stock count',
  payroll: 'Payroll', depreciation: 'Depreciation', opening: 'Opening balances',
  work_order_issue: 'Work order', work_order_complete: 'Work order',
}

const JE_BLOCK_MESSAGE = {
  auto: 'This entry was posted automatically by a document. Edit the invoice, bill or receipt it came from and the entry will be re-posted with it.',
  voided: 'This entry has already been voided.',
  reversal: 'This is a reversal entry and cannot be changed.',
  locked: 'This entry falls in a closed accounting period. Post a correcting entry in an open period instead.',
  missing: 'This entry no longer exists.',
}

export default function JournalEntries() {
  const t = useT()
  const navigate = useNavigate()
  const { journalEntries, accounts, departments, addJournalEntry, updateJournalEntry, journalEditBlock, voidJournalEntry, settings } = useStore()
  const sym = settings.company.currencySymbol
  const [modal, setModal] = useState(false)
  // The id being edited, or null when the modal is raising a new entry. The two
  // share one form because they are the same entry either way — only where it
  // lands at the end differs.
  const [editId, setEditId] = useState(null)
  const [viewEntry, setViewEntry] = useState(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(blankForm())
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openNew = () => { setEditId(null); setForm(blankForm()); setModal(true) }

  const openEdit = (je) => {
    const block = journalEditBlock(je.id)
    if (block) return alert(t(JE_BLOCK_MESSAGE[block] || 'This entry cannot be edited.'))
    setEditId(je.id)
    setForm({
      date: je.date, description: je.description || '', reference: je.reference || '',
      departmentId: je.departmentId || '',
      lines: (je.lines || []).map((l) => ({
        id: l.id || uuid(), accountId: l.accountId || '',
        debit: l.debit ? String(l.debit) : '', credit: l.credit ? String(l.credit) : '',
        description: l.description || '',
      })),
    })
    setViewEntry(null)
    setModal(true)
  }

  const updateLine = (lineId, key, value) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) => l.id === lineId ? { ...l, [key]: value } : l),
    }))
  }
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))
  const removeLine = (id) => setForm((f) => ({ ...f, lines: f.lines.filter((l) => l.id !== id) }))

  // Only lines that will actually be posted count toward the balance. A line
  // carrying an amount but no account is dropped on save, so including it here
  // would light up "Post Entry" for an entry the ledger then rejects.
  const postable = form.lines.filter((l) => l.accountId && (parseFloat(l.debit) || parseFloat(l.credit)))
  const totalDr = postable.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0)
  const totalCr = postable.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0)
  const balanced = Math.abs(totalDr - totalCr) < 0.001 && totalDr > 0
  // Amount typed but account still blank — surfaced so the line isn't silently dropped.
  const orphanLines = form.lines.filter((l) => !l.accountId && (parseFloat(l.debit) || parseFloat(l.credit))).length

  const lockDate = settings?.accounting?.lockDate
  const dateLocked = !!(lockDate && form.date && String(form.date) <= String(lockDate))

  const handleSave = () => {
    if (!form.description.trim()) return alert('Enter a description.')
    if (!balanced) return alert('Debits must equal credits.')
    if (dateLocked) return alert(t('This date falls in a closed accounting period (locked through {d}). Choose a later date.').replace('{d}', lockDate))
    const lines = form.lines
      .filter((l) => l.accountId && (parseFloat(l.debit) || parseFloat(l.credit)))
      .map((l) => ({ ...l, debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0 }))
    let res
    try {
      res = editId
        ? updateJournalEntry(editId, { date: form.date, description: form.description, reference: form.reference, departmentId: form.departmentId || null, lines })
        : addJournalEntry({ ...form, lines, type: 'manual' })
    } catch (e) {
      const msg = String(e.message || '')
      if (msg.startsWith('PERIOD_LOCKED')) return alert(t('This date falls in a closed accounting period (locked through {d}). Choose a later date.').replace('{d}', lockDate))
      // Never let a posting rejection escape as an uncaught error — that leaves
      // the modal open with no feedback at all.
      if (msg.startsWith('JE_UNBALANCED')) return alert(t('Debits must equal credits.'))
      if (msg.startsWith('JE_NOT_MANUAL')) return alert(t(JE_BLOCK_MESSAGE.auto))
      if (msg.startsWith('JE_IMMUTABLE')) return alert(t(JE_BLOCK_MESSAGE.reversal))
      alert(t('Could not post this entry') + ': ' + msg)
      return
    }
    setModal(false)
    setEditId(null)
    setForm(blankForm())
    if (res?.pendingApproval) {
      alert(t('This entry is over the approval threshold and has been sent for approval. It will post to the ledger once approved.'))
      navigate('/approvals')
    }
  }

  // Entries are never deleted — they are voided by posting a reversal (immutable ledger).
  const handleVoid = (je) => {
    if (je.type !== 'manual') return alert(t('Auto-generated entries are voided from their source document.'))
    if (je.reversedBy) return alert(t('This entry has already been voided.'))
    if (je.reverses) return alert(t('This is a reversal entry and cannot be voided.'))
    const reason = window.prompt(t('Reason for voiding {n}? A reversing entry will be posted.').replace('{n}', je.number))
    if (reason === null) return
    try { voidJournalEntry(je.id, { reason }) }
    catch (e) { if (String(e.message).startsWith('PERIOD_LOCKED')) return alert(t('This date falls in a closed accounting period. Choose a later date.')); throw e }
  }

  const typeColors = {
    manual: 'bg-accent-50 text-accent-700 dark:bg-accent-500/10 dark:text-accent-300',
    invoice: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
    receipt: 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300',
    purchase: 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300',
    payment_out: 'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300',
    money_in: 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300',
    money_out: 'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300',
  }

  const sorted = [...journalEntries]
    .filter((je) => !search || je.number.toLowerCase().includes(search.toLowerCase()) || (je.description || '').toLowerCase().includes(search.toLowerCase()) || narrate(je.description, t).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.createdAt?.localeCompare(a.createdAt))

  const accName = (id) => accounts.find((a) => a.id === id)?.name || id

  return (
    <div>
      <PageHeader
        title="Journal Entries"
        subtitle={`${journalEntries.length} ${t('entries')}`}
        action={<Btn onClick={openNew}><Plus size={15} /> {t('Manual Entry')}</Btn>}
      />

      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 pointer-events-none" />
        <input className="w-full ps-9 pe-3 py-2 text-sm bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 shadow-input dark:shadow-none transition-all duration-150 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:focus:ring-brand-400/20"
          placeholder={t('Search entries...')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        {journalEntries.length === 0 ? (
          <EmptyState icon="📋" title="No journal entries" desc="Journal entries are created automatically when you record transactions, or you can add manual entries." />
        ) : (
          <Table headers={['#', 'Date', 'Description', 'Reference', 'Type', { label: 'Debit', right: true }, { label: 'Credit', right: true }, { label: '', right: true }]}>
            {sorted.map((je) => {
              const dr = je.lines?.reduce((s, l) => s + (l.debit || 0), 0) || 0
              const cr = je.lines?.reduce((s, l) => s + (l.credit || 0), 0) || 0
              return (
                <Tr key={je.id}>
                  <Td className="font-mono text-gray-600 dark:text-slate-300 text-xs">{je.number}</Td>
                  <Td className="text-gray-500 dark:text-slate-400">{fmtDate(je.date)}</Td>
                  <Td className="font-medium text-gray-800 dark:text-slate-100">
                    {narrate(je.description, t)}
                    {je.reversedBy && <Badge className="ms-2 bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300">{t('Voided')}</Badge>}
                    {je.reverses && <Badge className="ms-2 bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300">{t('Reversal')}</Badge>}
                  </Td>
                  <Td className="text-gray-400 dark:text-slate-500 text-xs">{je.reference || '—'}</Td>
                  <Td><Badge className={typeColors[je.type] || 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300'}>{t(JE_TYPE_LABEL[je.type] || (je.type || '').replace(/_/g, ' '))}</Badge></Td>
                  <Td right className="font-mono text-gray-700 dark:text-slate-200">{fmtMoney(dr, sym)}</Td>
                  <Td right className="font-mono text-gray-700 dark:text-slate-200">{fmtMoney(cr, sym)}</Td>
                  <Td right>
                    <div className="flex justify-end items-center gap-1">
                      <AttachmentButton entityType="journal" entityId={je.id} />
                      <Btn size="sm" variant="ghost" onClick={() => setViewEntry(je)} title={t('View')}><Eye size={13} /></Btn>
                      {je.type === 'manual' && !je.reversedBy && !je.reverses && (
                        <>
                          <Btn size="sm" variant="ghost" onClick={() => openEdit(je)} title={t('Edit')}><Pencil size={13} className="text-brand-500" /></Btn>
                          <Btn size="sm" variant="ghost" onClick={() => handleVoid(je)} title={t('Void')}><Ban size={13} className="text-rose-400" /></Btn>
                        </>
                      )}
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      {/* Manual entry — raising a new one, or correcting one already posted */}
      <Modal
        open={modal}
        onClose={() => { setModal(false); setEditId(null) }}
        title={editId ? `${t('Edit Journal Entry')} ${journalEntries.find((j) => j.id === editId)?.number || ''}` : t('New Journal Entry')}
        width="max-w-2xl"
      >
        <div className="space-y-4">
          {editId && (
            <p className="text-xs rounded-lg px-3 py-2 bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-500/20">
              {t('Saving replaces this entry in the ledger, keeping its number. The change is recorded in the audit log.')}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
            <Input label="Reference" value={form.reference} onChange={(e) => setField('reference', e.target.value)} placeholder="e.g. ADJ-001" />
          </div>
          {dateLocked && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <span>🔒</span>
              <span>{t('This date falls in a closed accounting period (locked through {d}). Choose a later date.').replace('{d}', lockDate)}</span>
            </div>
          )}
          <Input label="Description *" value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="Purpose of this entry..." />
          {departments.length > 0 && (
            <Select label={t('Department / Cost Center')} value={form.departmentId} onChange={(e) => setField('departmentId', e.target.value)}>
              <option value="">{t('— Unassigned —')}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          )}

          <div className="border border-slate-200 dark:border-surface-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 dark:bg-surface-900/40">
                <tr>
                  <th className="text-start px-3 py-2 text-xs font-semibold text-gray-500 dark:text-slate-400">{t('Account')}</th>
                  <th className="text-end px-3 py-2 text-xs font-semibold text-gray-500 dark:text-slate-400">{t('Debit')}</th>
                  <th className="text-end px-3 py-2 text-xs font-semibold text-gray-500 dark:text-slate-400">{t('Credit')}</th>
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {form.lines.map((line) => (
                  <tr key={line.id} className="border-t border-gray-100 dark:border-surface-750">
                    <td className="px-2 py-1.5">
                      <Select value={line.accountId} onChange={(e) => updateLine(line.id, 'accountId', e.target.value)}>
                        <option value="">Select account…</option>
                        {['asset', 'liability', 'equity', 'revenue', 'expense'].map((type) => (
                          <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>
                            {accounts.filter((a) => a.type === type).map((a) => (
                              <option key={a.id} value={a.id}>{a.code} – {a.name}</option>
                            ))}
                          </optgroup>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="0.01" value={line.debit}
                        onChange={(e) => updateLine(line.id, 'debit', e.target.value)}
                        className="w-full border border-gray-300 dark:border-surface-600 rounded px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="0.00" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="0.01" value={line.credit}
                        onChange={(e) => updateLine(line.id, 'credit', e.target.value)}
                        className="w-full border border-gray-300 dark:border-surface-600 rounded px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="0.00" />
                    </td>
                    <td className="px-1 py-1.5">
                      <button onClick={() => removeLine(line.id)} className="text-red-400 hover:text-red-600 dark:hover:text-danger-400">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200 dark:border-surface-700 bg-gray-50 dark:bg-surface-800/60 font-semibold">
                  <td className="px-3 py-2 text-xs text-gray-600 dark:text-slate-300">Totals</td>
                  <td className={`px-3 py-2 text-right text-sm ${balanced ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(totalDr, sym)}</td>
                  <td className={`px-3 py-2 text-right text-sm ${balanced ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(totalCr, sym)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          {orphanLines > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {orphanLines === 1
                ? t('One line has an amount but no account selected — it will not be posted.')
                : t('{n} lines have an amount but no account selected — they will not be posted.').replace('{n}', orphanLines)}
            </p>
          )}
          {!balanced && totalDr > 0 && (
            <p className="text-xs text-red-600 dark:text-red-400">{t('Debits and credits must be equal.')} {t('Difference')}: {fmtMoney(Math.abs(totalDr - totalCr), sym)}</p>
          )}
          <Btn variant="ghost" size="sm" onClick={addLine}><Plus size={14} /> {t('Add Line')}</Btn>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => { setModal(false); setEditId(null) }}>{t('Cancel')}</Btn>
            <Btn disabled={!balanced} onClick={handleSave}>{editId ? t('Save Changes') : t('Post Entry')}</Btn>
          </div>
        </div>
      </Modal>

      {/* View Entry Modal */}
      <Modal open={!!viewEntry} onClose={() => setViewEntry(null)} title={`${t('Journal Entry')} ${viewEntry?.number || ''}`} width="max-w-xl">
        {viewEntry && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div><p className="text-gray-400 dark:text-slate-500">{t('Date')}</p><p className="font-medium">{fmtDate(viewEntry.date)}</p></div>
              <div><p className="text-gray-400 dark:text-slate-500">{t('Reference')}</p><p className="font-medium">{viewEntry.reference || '—'}</p></div>
              <div className="col-span-2"><p className="text-gray-400 dark:text-slate-500">{t('Description')}</p><p className="font-medium">{narrate(viewEntry.description, t)}</p></div>
            </div>
            <table className="w-full text-sm border border-slate-200 dark:border-surface-700 rounded-lg overflow-hidden">
              <thead className="bg-slate-50/80 dark:bg-surface-900/40">
                <tr>
                  <th className="text-start px-3 py-2 text-xs font-semibold text-gray-500 dark:text-slate-400">{t('Account')}</th>
                  <th className="text-end px-3 py-2 text-xs font-semibold text-gray-500 dark:text-slate-400">{t('Debit')}</th>
                  <th className="text-end px-3 py-2 text-xs font-semibold text-gray-500 dark:text-slate-400">{t('Credit')}</th>
                </tr>
              </thead>
              <tbody>
                {viewEntry.lines?.map((line, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-surface-750">
                    <td className="px-3 py-2 text-gray-700 dark:text-slate-200">{accName(line.accountId)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-slate-200">{line.debit > 0 ? fmtMoney(line.debit, sym) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-slate-200">{line.credit > 0 ? fmtMoney(line.credit, sym) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end gap-2">
              {!journalEditBlock(viewEntry.id) && (
                <Btn variant="secondary" size="sm" onClick={() => openEdit(viewEntry)}><Pencil size={13} /> {t('Edit')}</Btn>
              )}
              {/* 'Close' is taken by the year-end close and translates as
                  "إقفال"; dismissing a read-only view is 'Done'. */}
              <Btn variant="secondary" size="sm" onClick={() => setViewEntry(null)}>{t('Done')}</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
