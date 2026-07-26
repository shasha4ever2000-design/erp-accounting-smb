import { useState, useMemo, useRef } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td, StatCard, Modal, Input, Select } from '../components/UI'
import Scanner from '../components/Scanner'
import { resolveScan } from '../utils/scanning'
import {
  isCounted, variance, varianceValue, summarise, applyCount, clearCount,
  validateCount, COUNT_STATUS,
} from '../utils/stockCount'
import {
  ClipboardCheck, Play, Check, Trash2, AlertTriangle, ScanLine, Undo2, PackageSearch, Repeat,
} from 'lucide-react'

const today = () => new Date().toISOString().slice(0, 10)

export default function StockCounts() {
  const t = useT()
  const {
    stockCounts = [], inventoryItems, fixedAssets = [], warehouses = [], settings,
    startStockCount, updateStockCount, deleteStockCount, postStockCount,
    startCycleCount, cycleCountBatch,
  } = useStore()
  const sym = settings.company.currencySymbol

  const [openId, setOpenId] = useState(null)
  const [newModal, setNewModal] = useState(false)
  const [form, setForm] = useState({ date: today(), warehouseId: '', notes: '' })
  const [feedback, setFeedback] = useState(null)   // { tone, text }
  const [filter, setFilter] = useState('')
  const [postError, setPostError] = useState('')

  const count = stockCounts.find((c) => c.id === openId) || null
  const sorted = useMemo(
    () => [...stockCounts].sort((a, b) => String(b.startedAt || b.date).localeCompare(String(a.startedAt || a.date))),
    [stockCounts]
  )

  const summary = useMemo(() => (count ? summarise(count.lines || []) : null), [count])

  const visibleLines = useMemo(() => {
    if (!count) return []
    const q = filter.trim().toLowerCase()
    const rows = q
      ? count.lines.filter((l) => `${l.code} ${l.name}`.toLowerCase().includes(q))
      : count.lines
    // Counted lines drop to the bottom: what is left to do should be what you
    // are looking at.
    return [...rows].sort((a, b) => Number(isCounted(a)) - Number(isCounted(b)))
  }, [count, filter])

  const say = (tone, text) => {
    setFeedback({ tone, text })
    setTimeout(() => setFeedback(null), 3500)
  }

  // What a cycle count would pick up right now — shown on the button so the
  // size of the job is visible before committing to it.
  const cycleDue = useMemo(() => {
    try { return cycleCountBatch({}) } catch { return { itemIds: [], dueCount: 0, value: 0 } }
  }, [cycleCountBatch, inventoryItems, stockCounts])

  const startCycle = () => {
    try {
      const c = startCycleCount({ date: today() })
      setOpenId(c.id)
    } catch (e) {
      alert(String(e.message).includes('NOTHING_DUE')
        ? t('Nothing is due a count yet. Class A items come round every 30 days, C every year.')
        : String(e.message || e))
    }
  }

  const startNew = () => {
    try {
      const c = startStockCount(form)
      setNewModal(false)
      setOpenId(c.id)
      setForm({ date: today(), warehouseId: '', notes: '' })
    } catch (e) {
      alert(String(e.message).includes('NO_ITEMS')
        ? t('There are no stocked items to count.')
        : String(e.message || e))
    }
  }

  const setLines = (lines) => updateStockCount(count.id, { lines })

  const handleScan = (code) => {
    const hit = resolveScan(code, { inventoryItems, fixedAssets })
    if (!hit) return say('bad', t('“{c}” is not a code we know.').replace('{c}', code))
    if (hit.ambiguous) return say('warn', t('“{c}” matches more than one record — type the stock code instead.').replace('{c}', code))
    if (hit.stale) return say('warn', t('That label points at a record that has been deleted.'))
    if (hit.kind !== 'inventoryItems') return say('warn', t('That is a fixed asset, not a stock item.'))

    const line = count.lines.find((l) => l.itemId === hit.record.id)
    if (!line) return say('warn', t('{n} is not on this count sheet.').replace('{n}', hit.record.name))

    setLines(applyCount(count.lines, hit.record.id, 1, { mode: 'add', scanned: true }))
    say('good', `${hit.record.name} — ${t('now')} ${(Number(line.counted) || 0) + 1}`)
  }

  const doPost = () => {
    const check = validateCount(count, { lockDate: settings?.accounting?.lockDate })
    if (!check.ok) return setPostError(check.errors.join(' '))
    const lines = [
      t('Post this count?'),
      '',
      t('{n} counted, {u} never counted.').replace('{n}', summary.counted).replace('{u}', summary.uncounted),
      summary.uncounted > 0 ? t('Uncounted lines are left exactly as they are — they are not set to zero.') : '',
      t('Net value change: {v}').replace('{v}', fmtMoney(summary.netValue, sym)),
    ].filter(Boolean).join('\n')
    if (!confirm(lines)) return
    try {
      const res = postStockCount(count.id)
      setPostError('')
      say('good', t('Posted. {n} item(s) adjusted.').replace('{n}', res.adjusted))
    } catch (e) {
      setPostError(String(e.message || e).replace('COUNT_INVALID:', '').trim())
    }
  }

  const posted = count?.status === COUNT_STATUS.posted

  // ─── List view ───────────────────────────────────────────────────
  if (!count) {
    return (
      <div>
        <PageHeader
          title="Stock Counts"
          subtitle="Make the books agree with the shelves"
          action={
            <>
              <Btn variant="secondary" onClick={startCycle} title={t('Count only what is due')}>
                <Repeat size={15} /> {t('Cycle count')}{cycleDue.dueCount ? ` (${Math.min(cycleDue.dueCount, cycleDue.itemIds.length || cycleDue.dueCount)})` : ''}
              </Btn>
              <Btn onClick={() => setNewModal(true)}><Play size={15} /> {t('Start a count')}</Btn>
            </>
          }
        />

        <Card className="p-4 mb-6 text-sm text-gray-600 dark:text-slate-300 flex items-start gap-3">
          <ScanLine size={18} className="text-brand-600 dark:text-brand-400 flex-shrink-0 mt-0.5" />
          <p>
            {t('Starting a count freezes what the books say, so stock that legitimately moves while you are counting does not show up as a shortage. Scan or type each item, then post once — anything you never counted is left exactly as it is.')}
            {cycleDue.dueCount > 0 && (
              <span className="block mt-2 text-gray-500 dark:text-slate-400">
                {t('{n} item(s) worth {v} are due a cycle count — the valuable stock comes round monthly, the long tail once a year.')
                  .replace('{n}', cycleDue.dueCount).replace('{v}', fmtMoney(cycleDue.value, sym))}
              </span>
            )}
          </p>
        </Card>

        <Card className="overflow-hidden">
          {sorted.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck size={28} className="text-slate-400 dark:text-slate-500" />}
              title="No stock counts yet"
              desc="Start one, walk the shelves with a phone or a barcode gun, and post the difference in a single entry."
              action={<Btn onClick={() => setNewModal(true)}><Play size={14} /> {t('Start a count')}</Btn>}
            />
          ) : (
            <Table headers={['Number', 'Date', 'Where', 'Progress', 'Value change', '']}>
              {sorted.map((c) => {
                const s = c.summary || summarise(c.lines || [])
                const wh = warehouses.find((w) => w.id === c.warehouseId)
                return (
                  <Tr key={c.id}>
                    <Td className="font-mono font-semibold text-gray-800 dark:text-slate-100">{c.number}</Td>
                    <Td className="text-gray-500 dark:text-slate-400 whitespace-nowrap">{fmtDate(c.date)}</Td>
                    <Td className="text-gray-500 dark:text-slate-400">{wh?.name || t('All warehouses')}</Td>
                    <Td>
                      <Badge className={c.status === 'posted'
                        ? 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300'
                        : 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'}>
                        {c.status === 'posted' ? t('posted') : `${s.counted}/${s.total}`}
                      </Badge>
                    </Td>
                    <Td className={`text-end tabular-nums ${s.netValue < 0 ? 'text-rose-600 dark:text-rose-400' : s.netValue > 0 ? 'text-success-600 dark:text-success-400' : 'text-gray-400'}`}>
                      {s.netValue ? fmtMoney(s.netValue, sym) : '—'}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <Btn size="sm" variant="secondary" onClick={() => { setOpenId(c.id); setPostError('') }}>
                          {c.status === 'posted' ? t('View') : t('Continue')}
                        </Btn>
                        {c.status !== 'posted' && (
                          <Btn size="sm" variant="ghost" onClick={() => {
                            if (confirm(t('Abandon count {n}? Nothing will be adjusted.').replace('{n}', c.number))) deleteStockCount(c.id)
                          }}>
                            <Trash2 size={13} className="text-red-400" />
                          </Btn>
                        )}
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </Table>
          )}
        </Card>

        <Modal open={newModal} onClose={() => setNewModal(false)} title="Start a Stock Count">
          <div className="space-y-4">
            <Input label={t('Count date')} type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            <Select label={t('Warehouse')} value={form.warehouseId} onChange={(e) => setForm((f) => ({ ...f, warehouseId: e.target.value }))}>
              <option value="">{t('All warehouses')}</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Input label={t('Notes (optional)')} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <p className="text-xs text-gray-400 dark:text-slate-500">
              {t('The books are frozen at this moment. Kits are left out — they hold no stock of their own.')}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Btn variant="secondary" onClick={() => setNewModal(false)}>{t('Cancel')}</Btn>
              <Btn onClick={startNew}>{t('Start')}</Btn>
            </div>
          </div>
        </Modal>
      </div>
    )
  }

  // ─── Counting view ───────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title={`${t('Stock Count')} ${count.number}`}
        subtitle={posted ? t('Posted — this is a record of what was found') : t('Scan or type each item you find')}
        action={
          <>
            <Btn variant="secondary" onClick={() => setOpenId(null)}>{t('Back')}</Btn>
            {!posted && <Btn onClick={doPost}><Check size={15} /> {t('Post count')}</Btn>}
          </>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Counted" value={`${summary.counted}/${summary.total}`} icon={<ClipboardCheck size={18} />} color="blue" />
        <StatCard label="Match the books" value={String(summary.matching)} icon={<Check size={18} />} color="green" />
        <StatCard label="Differences" value={String(summary.gains + summary.losses)} icon={<AlertTriangle size={18} />} color={summary.gains + summary.losses ? 'orange' : 'blue'} />
        <StatCard label="Value change" value={fmtMoney(summary.netValue, sym)} icon={<PackageSearch size={18} />} color={summary.netValue < 0 ? 'red' : 'green'} />
      </div>

      {!posted && (
        <Card className="p-4 mb-6">
          <Scanner onScan={handleScan} placeholder={t('Scan a label, or type a stock code and press Enter')} />
          {feedback && (
            <p className={`text-sm mt-2 font-medium ${
              feedback.tone === 'good' ? 'text-success-700 dark:text-success-400'
              : feedback.tone === 'warn' ? 'text-warning-700 dark:text-warning-400'
              : 'text-rose-600 dark:text-rose-400'}`}>
              {feedback.text}
            </p>
          )}
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-2">
            {t('Each scan adds one. Type a total in the row instead if you counted a whole shelf at once.')}
          </p>
        </Card>
      )}

      {summary.uncounted > 0 && !posted && (
        <Card className="p-3.5 mb-6 bg-warning-50/60 dark:bg-warning-500/[0.07] ring-1 ring-inset ring-warning-500/20 flex items-start gap-3">
          <AlertTriangle size={16} className="text-warning-600 dark:text-warning-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-warning-800 dark:text-warning-200">
            {t('{n} line(s) have not been counted. Posting will leave them exactly as they are — it will not set them to zero.').replace('{n}', summary.uncounted)}
          </p>
        </Card>
      )}

      {postError && (
        <Card className="p-3.5 mb-6 bg-rose-50/60 dark:bg-rose-500/[0.08] ring-1 ring-inset ring-rose-500/20 flex items-start gap-3">
          <AlertTriangle size={16} className="text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-rose-800 dark:text-rose-200">{postError}</p>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-surface-750">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('Filter by code or name…')}
            className="w-full sm:w-72 border rounded-lg px-3 py-2 text-sm bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300/90 dark:border-surface-600" />
        </div>
        <Table headers={['Code', 'Item', 'Expected', 'Counted', 'Difference', 'Value', '']}>
          {visibleLines.map((l) => {
            const v = variance(l)
            const done = isCounted(l)
            return (
              <Tr key={l.itemId} className={done && v !== 0 ? 'bg-warning-50/40 dark:bg-warning-500/[0.05]' : ''}>
                <Td className="font-mono text-xs text-gray-500 dark:text-slate-400">{l.code}</Td>
                <Td className="text-gray-800 dark:text-slate-100">
                  {l.name}
                  {l.scanned && <Badge className="ms-2 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{t('scanned')}</Badge>}
                </Td>
                <Td className="text-end tabular-nums text-gray-500 dark:text-slate-400">{l.expected}</Td>
                <Td className="text-end">
                  {posted ? (
                    <span className="tabular-nums">{done ? l.counted : '—'}</span>
                  ) : (
                    <input type="number" step="any" value={l.counted ?? ''} placeholder="—"
                      onChange={(e) => setLines(e.target.value === ''
                        ? clearCount(count.lines, l.itemId)
                        : applyCount(count.lines, l.itemId, e.target.value))}
                      className="w-24 border rounded px-2 py-1 text-sm text-end tabular-nums bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300/90 dark:border-surface-600" />
                  )}
                </Td>
                <Td className={`text-end tabular-nums font-medium ${v == null ? 'text-gray-300 dark:text-slate-600' : v === 0 ? 'text-gray-400' : v > 0 ? 'text-success-600 dark:text-success-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {v == null ? '—' : v > 0 ? `+${v}` : v}
                </Td>
                <Td className="text-end tabular-nums text-gray-500 dark:text-slate-400">
                  {v == null || v === 0 ? '—' : fmtMoney(varianceValue(l), sym)}
                </Td>
                <Td>
                  {!posted && done && (
                    <button onClick={() => setLines(clearCount(count.lines, l.itemId))} title={t('Clear this count')}
                      className="p-1 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10">
                      <Undo2 size={13} />
                    </button>
                  )}
                </Td>
              </Tr>
            )
          })}
        </Table>
      </Card>
    </div>
  )
}
