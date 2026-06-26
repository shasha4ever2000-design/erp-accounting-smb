import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, EmptyState, Table, Tr, Td, Badge } from '../components/UI'
import { Plus, Trash2, Eye, Search } from 'lucide-react'
import { v4 as uuid } from 'uuid'

const emptyLine = () => ({ id: uuid(), accountId: '', debit: '', credit: '', description: '' })

export default function JournalEntries() {
  const { journalEntries, accounts, addJournalEntry, deleteJournalEntry, settings } = useStore()
  const sym = settings.company.currencySymbol
  const [modal, setModal] = useState(false)
  const [viewEntry, setViewEntry] = useState(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ date: today(), description: '', reference: '', lines: [emptyLine(), emptyLine()] })
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const updateLine = (lineId, key, value) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) => l.id === lineId ? { ...l, [key]: value } : l),
    }))
  }
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))
  const removeLine = (id) => setForm((f) => ({ ...f, lines: f.lines.filter((l) => l.id !== id) }))

  const totalDr = form.lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0)
  const totalCr = form.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0)
  const balanced = Math.abs(totalDr - totalCr) < 0.001 && totalDr > 0

  const handleSave = () => {
    if (!form.description.trim()) return alert('Enter a description.')
    if (!balanced) return alert('Debits must equal credits.')
    const lines = form.lines
      .filter((l) => l.accountId && (parseFloat(l.debit) || parseFloat(l.credit)))
      .map((l) => ({ ...l, debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0 }))
    addJournalEntry({ ...form, lines, type: 'manual' })
    setModal(false)
    setForm({ date: today(), description: '', reference: '', lines: [emptyLine(), emptyLine()] })
  }

  const handleDelete = (je) => {
    if (je.type !== 'manual') return alert('Auto-generated entries cannot be deleted here. Delete the source transaction instead.')
    if (confirm('Delete this journal entry?')) deleteJournalEntry(je.id)
  }

  const typeColors = {
    manual: 'bg-purple-100 text-purple-700',
    invoice: 'bg-blue-100 text-blue-700',
    receipt: 'bg-green-100 text-green-700',
    purchase: 'bg-orange-100 text-orange-700',
    payment_out: 'bg-red-100 text-red-700',
    money_in: 'bg-teal-100 text-teal-700',
    money_out: 'bg-rose-100 text-rose-700',
  }

  const sorted = [...journalEntries]
    .filter((je) => !search || je.number.toLowerCase().includes(search.toLowerCase()) || je.description.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.createdAt?.localeCompare(a.createdAt))

  const accName = (id) => accounts.find((a) => a.id === id)?.name || id

  return (
    <div>
      <PageHeader
        title="Journal Entries"
        subtitle={`${journalEntries.length} entries`}
        action={<Btn onClick={() => setModal(true)}><Plus size={15} /> Manual Entry</Btn>}
      />

      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
        <input className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search entries..." value={search} onChange={(e) => setSearch(e.target.value)} />
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
                  <Td className="font-mono text-gray-600 text-xs">{je.number}</Td>
                  <Td className="text-gray-500">{fmtDate(je.date)}</Td>
                  <Td className="font-medium text-gray-800">{je.description}</Td>
                  <Td className="text-gray-400 text-xs">{je.reference || '—'}</Td>
                  <Td><Badge className={typeColors[je.type] || 'bg-gray-100 text-gray-600'}>{je.type?.replace('_', ' ')}</Badge></Td>
                  <Td right className="font-mono text-gray-700">{fmtMoney(dr, sym)}</Td>
                  <Td right className="font-mono text-gray-700">{fmtMoney(cr, sym)}</Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      <Btn size="sm" variant="ghost" onClick={() => setViewEntry(je)}><Eye size={13} /></Btn>
                      {je.type === 'manual' && (
                        <Btn size="sm" variant="ghost" onClick={() => handleDelete(je)}><Trash2 size={13} className="text-red-400" /></Btn>
                      )}
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      {/* New Manual Entry Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="New Journal Entry" width="max-w-2xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
            <Input label="Reference" value={form.reference} onChange={(e) => setField('reference', e.target.value)} placeholder="e.g. ADJ-001" />
          </div>
          <Input label="Description *" value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="Purpose of this entry..." />

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Account</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Debit</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Credit</th>
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {form.lines.map((line) => (
                  <tr key={line.id} className="border-t border-gray-100">
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
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="0.00" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" step="0.01" value={line.credit}
                        onChange={(e) => updateLine(line.id, 'credit', e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="0.00" />
                    </td>
                    <td className="px-1 py-1.5">
                      <button onClick={() => removeLine(line.id)} className="text-red-400 hover:text-red-600">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-3 py-2 text-xs text-gray-600">Totals</td>
                  <td className={`px-3 py-2 text-right text-sm ${balanced ? 'text-green-700' : 'text-red-600'}`}>{fmtMoney(totalDr, sym)}</td>
                  <td className={`px-3 py-2 text-right text-sm ${balanced ? 'text-green-700' : 'text-red-600'}`}>{fmtMoney(totalCr, sym)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          {!balanced && totalDr > 0 && (
            <p className="text-xs text-red-600">Debits and credits must be equal. Difference: {fmtMoney(Math.abs(totalDr - totalCr), sym)}</p>
          )}
          <Btn variant="ghost" size="sm" onClick={addLine}><Plus size={14} /> Add Line</Btn>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>Cancel</Btn>
            <Btn disabled={!balanced} onClick={handleSave}>Post Entry</Btn>
          </div>
        </div>
      </Modal>

      {/* View Entry Modal */}
      <Modal open={!!viewEntry} onClose={() => setViewEntry(null)} title={`Journal Entry ${viewEntry?.number}`} width="max-w-xl">
        {viewEntry && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-gray-400">Date</p><p className="font-medium">{fmtDate(viewEntry.date)}</p></div>
              <div><p className="text-gray-400">Reference</p><p className="font-medium">{viewEntry.reference || '—'}</p></div>
              <div className="col-span-2"><p className="text-gray-400">Description</p><p className="font-medium">{viewEntry.description}</p></div>
            </div>
            <table className="w-full text-sm border rounded-lg overflow-hidden">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Account</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Debit</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Credit</th>
                </tr>
              </thead>
              <tbody>
                {viewEntry.lines?.map((line, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-700">{accName(line.accountId)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">{line.debit > 0 ? fmtMoney(line.debit, sym) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">{line.credit > 0 ? fmtMoney(line.credit, sym) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  )
}
