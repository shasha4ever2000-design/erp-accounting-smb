import { useMemo, useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Input, Select, Table, Tr, Td, EmptyState, Badge } from '../components/UI'
import { allocateLandedCost } from '../utils/landedCost'
import { Ship, Plus, Trash2, Layers } from 'lucide-react'

const today = () => new Date().toISOString().slice(0, 10)

export default function LandedCosts() {
  const t = useT()
  const { inventoryItems, accounts, landedCosts, postLandedCost, settings } = useStore()
  const sym = settings.company.currencySymbol
  const money = (v) => fmtMoney(v, sym)

  // Only items with stock on hand can absorb landed cost into their unit value.
  const stocked = useMemo(() => inventoryItems.filter((i) => (i.quantity || 0) > 0), [inventoryItems])
  // Funding side: liabilities (AP/accruals) + cash/bank assets.
  const fundingAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'liability' || (a.type === 'asset' && /cash|bank/i.test(a.name || ''))),
    [accounts]
  )

  const [date, setDate] = useState(today())
  const [reference, setReference] = useState('')
  const [method, setMethod] = useState('value')
  const [amount, setAmount] = useState('')
  const [creditAccountId, setCreditAccountId] = useState('acc-ap')
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState([]) // itemIds

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const lines = useMemo(
    () => picked.map((id) => { const it = stocked.find((i) => i.id === id); return { itemId: id, qty: it?.quantity || 0, unitCost: it?.costPrice || 0, name: it?.name } }).filter((l) => l.qty > 0),
    [picked, stocked]
  )

  const preview = useMemo(() => {
    const amt = Number(amount) || 0
    if (amt <= 0 || lines.length === 0) return []
    const alloc = allocateLandedCost(amt, lines, method)
    const map = Object.fromEntries(alloc.map((a) => [a.itemId, a.allocated]))
    return lines.map((l) => ({ ...l, allocated: map[l.itemId] || 0, newCost: l.qty > 0 ? l.unitCost + (map[l.itemId] || 0) / l.qty : l.unitCost }))
  }, [amount, lines, method])

  const canPost = Number(amount) > 0 && lines.length > 0 && creditAccountId

  const handlePost = () => {
    if (!canPost) return
    try {
      postLandedCost({ date, reference, note, method, amount: Number(amount), creditAccountId, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) })
      setAmount(''); setReference(''); setNote(''); setPicked([])
    } catch (e) { alert(t('Could not post landed cost') + ': ' + e.message) }
  }

  const accName = (id) => accounts.find((a) => a.id === id)?.name || id

  return (
    <div>
      <PageHeader title={t('Landed Costs')} subtitle={t('Capitalise freight, duty and handling into inventory value')} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Entry */}
        <div className="xl:col-span-2 space-y-6">
          <Card className="p-6">
            <h2 className="text-sm font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-4">{t('New Landed Cost')}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Input label={t('Date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <Input label={t('Reference')} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('e.g. Freight bill #')} />
              <Input label={`${t('Total Cost')} (${sym})`} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              <Select label={t('Allocation method')} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="value">{t('By value')}</option>
                <option value="quantity">{t('By quantity')}</option>
              </Select>
              <Select label={t('Funded by')} value={creditAccountId} onChange={(e) => setCreditAccountId(e.target.value)}>
                {fundingAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </Select>
              <Input label={t('Note')} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Optional')} />
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-sm font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-4">{t('Select items to cost')}</h2>
            {stocked.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-slate-500 py-4">{t('No items with stock on hand to allocate cost onto.')}</p>
            ) : (
              <div className="max-h-72 overflow-y-auto -mx-2 px-2 space-y-1">
                {stocked.map((it) => (
                  <label key={it.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-surface-800 cursor-pointer">
                    <input type="checkbox" checked={picked.includes(it.id)} onChange={() => toggle(it.id)}
                      className="rounded border-gray-300 text-brand-600 focus:ring-brand-500/40" />
                    <span className="flex-1 text-sm text-gray-800 dark:text-slate-100">{it.name}</span>
                    <span className="text-xs text-gray-400 dark:text-slate-500 tabular-nums">{it.quantity} {it.unit || ''} @ {money(it.costPrice || 0)}</span>
                  </label>
                ))}
              </div>
            )}
          </Card>

          {preview.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="px-6 pt-5 pb-3 flex items-center gap-2"><Layers size={16} className="text-brand-500" /><h2 className="text-sm font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide">{t('Allocation preview')}</h2></div>
              <Table headers={[t('Item'), { label: t('On hand'), right: true }, { label: t('Old Cost'), right: true }, { label: t('Allocated'), right: true }, { label: t('New Cost'), right: true }]}>
                {preview.map((p) => (
                  <Tr key={p.itemId}>
                    <Td className="text-gray-800 dark:text-slate-100">{p.name}</Td>
                    <Td right className="tabular-nums text-gray-500 dark:text-slate-400">{p.qty}</Td>
                    <Td right className="tabular-nums text-gray-500 dark:text-slate-400">{money(p.unitCost)}</Td>
                    <Td right className="tabular-nums font-medium text-brand-600 dark:text-brand-400">{money(p.allocated)}</Td>
                    <Td right className="tabular-nums font-semibold text-gray-900 dark:text-slate-100">{money(p.newCost)}</Td>
                  </Tr>
                ))}
              </Table>
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-surface-750">
                <span className="text-sm text-gray-500 dark:text-slate-400">{t('Dr Inventory')} {money(Number(amount) || 0)} · {t('Cr')} {accName(creditAccountId)}</span>
                <Btn onClick={handlePost} disabled={!canPost}><Plus size={15} /> {t('Post Landed Cost')}</Btn>
              </div>
            </Card>
          )}
        </div>

        {/* History */}
        <div>
          <Card className="p-0 overflow-hidden">
            <div className="px-5 pt-5 pb-3 flex items-center gap-2"><Ship size={16} className="text-gray-400" /><h2 className="text-sm font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide">{t('History')}</h2></div>
            {(!landedCosts || landedCosts.length === 0) ? (
              <div className="px-5 pb-6"><EmptyState icon="🚢" title={t('No landed costs yet')} desc={t('Capitalised freight and duty will appear here.')} /></div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-surface-800">
                {[...landedCosts].reverse().map((lc) => (
                  <div key={lc.id} className="px-5 py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-800 dark:text-slate-100 text-sm">{lc.reference || t('Landed cost')}</span>
                      <span className="font-semibold text-brand-600 dark:text-brand-400 tabular-nums">{money(lc.amount)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400 dark:text-slate-500">{fmtDate(lc.date)}</span>
                      <Badge className="bg-gray-100 dark:bg-surface-700 text-gray-600 dark:text-slate-300">{lc.lines.length} {t('items')}</Badge>
                      <span className="text-xs text-gray-400 dark:text-slate-500">{lc.method === 'quantity' ? t('By quantity') : t('By value')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
