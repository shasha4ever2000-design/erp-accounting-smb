import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, StatCard, Badge, Select, Input, Table, Tr, Td } from '../components/UI'
import ExportMenu from '../components/ExportMenu'
import { Boxes, AlertTriangle, PackageX, Layers, ShoppingCart, BarChart3, ScrollText, Wallet } from 'lucide-react'

const TABS = [
  { id: 'status',  label: 'Stock Status',        icon: Boxes },
  { id: 'reorder', label: 'Reorder Suggestions',  icon: ShoppingCart },
  { id: 'abc',     label: 'ABC Analysis',         icon: BarChart3 },
  { id: 'card',    label: 'Item Stock Card',      icon: ScrollText },
]

const MOVE_LABELS = { sale: 'Sale', adjustment: 'Adjustment', production: 'Production', consumption: 'Consumption', transfer: 'Transfer' }

export default function InventoryControl() {
  const t = useT()
  const { inventoryItems, stockMovements, stockAdjustments, settings } = useStore()
  const sym = settings.company.currencySymbol

  const [tab, setTab] = useState('status')
  const [search, setSearch] = useState('')
  const [cardItemId, setCardItemId] = useState(inventoryItems[0]?.id || '')

  const value = (i) => (i.quantity || 0) * (i.costPrice || 0)
  const statusOf = (i) => {
    const q = i.quantity || 0
    if (q <= 0) return 'out'
    if ((i.reorderLevel || 0) > 0 && q <= i.reorderLevel) return 'low'
    if ((i.maxLevel || 0) > 0 && q > i.maxLevel) return 'over'
    return 'ok'
  }

  const totalValue = inventoryItems.reduce((s, i) => s + value(i), 0)
  const lowCount = inventoryItems.filter((i) => statusOf(i) === 'low').length
  const outCount = inventoryItems.filter((i) => statusOf(i) === 'out').length
  const pendingAdj = stockAdjustments.filter((a) => (a.status || 'approved') === 'pending').length

  const filtered = inventoryItems.filter((i) =>
    !search || i.name.toLowerCase().includes(search.toLowerCase()) || (i.code || '').toLowerCase().includes(search.toLowerCase()) || (i.category || '').toLowerCase().includes(search.toLowerCase())
  )

  // ─── Reorder suggestions ───────────────────────────────────────
  const suggestions = inventoryItems
    .filter((i) => (i.reorderLevel || 0) > 0 && (i.quantity || 0) <= i.reorderLevel)
    .map((i) => {
      const target = (i.maxLevel || 0) > 0 ? i.maxLevel : i.reorderLevel * 2
      const orderQty = Math.max(0, Math.ceil(target - (i.quantity || 0)))
      return { ...i, orderQty, orderCost: orderQty * (i.costPrice || 0) }
    })
    .filter((i) => i.orderQty > 0)
    .sort((a, b) => b.orderCost - a.orderCost)
  const reorderTotal = suggestions.reduce((s, i) => s + i.orderCost, 0)

  // ─── ABC analysis (by stock value, Pareto 80/15/5) ─────────────
  const abc = useMemo(() => {
    const ranked = [...inventoryItems].map((i) => ({ ...i, val: value(i) })).filter((i) => i.val > 0).sort((a, b) => b.val - a.val)
    const total = ranked.reduce((s, i) => s + i.val, 0) || 1
    let cum = 0
    return ranked.map((i) => {
      cum += i.val
      const pct = (cum / total) * 100
      const cls = pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C'
      return { ...i, cumPct: pct, cls }
    })
  }, [inventoryItems])
  const abcCounts = { A: abc.filter((i) => i.cls === 'A').length, B: abc.filter((i) => i.cls === 'B').length, C: abc.filter((i) => i.cls === 'C').length }

  // ─── Item stock card ───────────────────────────────────────────
  const cardItem = inventoryItems.find((i) => i.id === cardItemId)
  const cardRows = useMemo(() => {
    if (!cardItem) return []
    const moves = stockMovements.filter((m) => m.itemId === cardItemId).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''))
    const totalChange = moves.reduce((s, m) => s + (m.qtyChange || 0), 0)
    let running = (cardItem.quantity || 0) - totalChange // opening balance reconciles to current on-hand
    return moves.map((m) => { running += (m.qtyChange || 0); return { ...m, balance: running } })
  }, [stockMovements, cardItemId, cardItem])
  const cardOpening = cardItem ? (cardItem.quantity || 0) - stockMovements.filter((m) => m.itemId === cardItemId).reduce((s, m) => s + (m.qtyChange || 0), 0) : 0

  const statusBadge = (st) => ({
    out:  <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">{t('Out of stock')}</Badge>,
    low:  <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{t('Low')}</Badge>,
    over: <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">{t('Overstock')}</Badge>,
    ok:   <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">{t('OK')}</Badge>,
  })[st]

  const statusExportCols = [
    { key: 'code', label: t('Code') },
    { key: 'name', label: t('Item Name') },
    { key: 'category', label: t('Category') },
    { key: 'quantity', label: t('Qty on Hand'), right: true, map: (v) => v || 0 },
    { key: 'reorderLevel', label: t('Reorder Level'), right: true, map: (v) => v || 0 },
    { key: 'maxLevel', label: t('Max Level'), right: true, map: (v) => v || 0 },
    { key: 'val', label: t('Stock Value'), right: true, map: (_, i) => value(i).toFixed(2) },
    { key: 'st', label: t('Status'), map: (_, i) => statusOf(i) },
  ]

  return (
    <div>
      <PageHeader title={t('Inventory Control')} subtitle={t('Valuation, stock health, reorder planning and movement history')} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label={t('Inventory Value')} value={fmtMoney(totalValue, sym)} color="blue" icon={<Wallet size={18} />} sub={`${inventoryItems.length} ${t('items')}`} />
        <StatCard label={t('Low Stock')} value={lowCount} color={lowCount ? 'orange' : 'green'} icon={<AlertTriangle size={18} />} sub={t('at/below reorder')} />
        <StatCard label={t('Out of Stock')} value={outCount} color={outCount ? 'red' : 'green'} icon={<PackageX size={18} />} sub={t('need replenishment')} />
        <StatCard label={t('Pending Adjustments')} value={pendingAdj} color={pendingAdj ? 'orange' : 'blue'} icon={<Layers size={18} />} sub={t('awaiting approval')} />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {TABS.map((tb) => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all inline-flex items-center gap-1.5 ${tab === tb.id ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-blue-300'}`}>
            <tb.icon size={14} /> {t(tb.label)}
          </button>
        ))}
      </div>

      {/* ─── Stock Status ─── */}
      {tab === 'status' && (
        <Card>
          <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between gap-3 flex-wrap">
            <div className="relative max-w-xs flex-1">
              <input className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t('Search items...')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <ExportMenu size="sm" filename="stock-status" title={t('Stock Status')} rows={filtered} columns={statusExportCols} />
          </div>
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-gray-400 text-sm">{t('No items match your search')}</div>
          ) : (
            <Table headers={[t('Code'), t('Item Name'), t('Category'), { label: t('On Hand'), right: true }, { label: t('Reorder'), right: true }, { label: t('Max'), right: true }, { label: t('Stock Value'), right: true }, t('Status')]}>
              {filtered.map((i) => (
                <Tr key={i.id}>
                  <Td className="font-mono text-xs text-gray-500">{i.code || '—'}</Td>
                  <Td className="font-medium text-gray-800 dark:text-slate-100">{i.name}</Td>
                  <Td className="text-gray-500 dark:text-slate-400 text-sm">{i.category || '—'}</Td>
                  <Td right className="font-medium">{i.quantity || 0} {i.unit}</Td>
                  <Td right className="text-gray-500">{i.reorderLevel || '—'}</Td>
                  <Td right className="text-gray-500">{i.maxLevel || '—'}</Td>
                  <Td right className="text-gray-700 dark:text-slate-200">{fmtMoney(value(i), sym)}</Td>
                  <Td>{statusBadge(statusOf(i))}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* ─── Reorder Suggestions ─── */}
      {tab === 'reorder' && (
        <Card>
          <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-slate-400">{suggestions.length} {t('items need reordering')} · <span className="font-semibold text-gray-800 dark:text-slate-100">{fmtMoney(reorderTotal, sym)}</span> {t('est. cost')}</p>
            {suggestions.length > 0 && <ExportMenu size="sm" filename="reorder-suggestions" title={t('Reorder Suggestions')} rows={suggestions} columns={[
              { key: 'code', label: t('Code') }, { key: 'name', label: t('Item Name') },
              { key: 'quantity', label: t('On Hand'), right: true, map: (v) => v || 0 },
              { key: 'reorderLevel', label: t('Reorder'), right: true },
              { key: 'orderQty', label: t('Suggested Order'), right: true },
              { key: 'orderCost', label: t('Est. Cost'), right: true, map: (v) => v.toFixed(2) },
            ]} />}
          </div>
          {suggestions.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">✅ {t('All items are above their reorder level.')}</div>
          ) : (
            <Table headers={[t('Code'), t('Item Name'), { label: t('On Hand'), right: true }, { label: t('Reorder'), right: true }, { label: t('Max'), right: true }, { label: t('Suggested Order'), right: true }, { label: t('Est. Cost'), right: true }]}>
              {suggestions.map((i) => (
                <Tr key={i.id}>
                  <Td className="font-mono text-xs text-gray-500">{i.code || '—'}</Td>
                  <Td className="font-medium text-gray-800 dark:text-slate-100">{i.name}</Td>
                  <Td right className={`font-medium ${(i.quantity || 0) <= 0 ? 'text-red-600' : 'text-amber-600'}`}>{i.quantity || 0} {i.unit}</Td>
                  <Td right className="text-gray-500">{i.reorderLevel}</Td>
                  <Td right className="text-gray-500">{i.maxLevel || '—'}</Td>
                  <Td right className="font-bold text-blue-600 dark:text-blue-400">{i.orderQty} {i.unit}</Td>
                  <Td right className="text-gray-700 dark:text-slate-200">{fmtMoney(i.orderCost, sym)}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* ─── ABC Analysis ─── */}
      {tab === 'abc' && (
        <>
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4"><p className="text-xs font-semibold text-green-700 dark:text-green-300">{t('Class A')} · {t('top ~80% of value')}</p><p className="text-2xl font-bold text-green-700 dark:text-green-300">{abcCounts.A}</p></div>
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4"><p className="text-xs font-semibold text-amber-700 dark:text-amber-300">{t('Class B')} · {t('next ~15%')}</p><p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{abcCounts.B}</p></div>
            <div className="bg-gray-50 dark:bg-slate-800 rounded-xl p-4"><p className="text-xs font-semibold text-gray-600 dark:text-slate-300">{t('Class C')} · {t('remaining ~5%')}</p><p className="text-2xl font-bold text-gray-600 dark:text-slate-300">{abcCounts.C}</p></div>
          </div>
          <Card>
            <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-end">
              <ExportMenu size="sm" filename="abc-analysis" title={t('ABC Analysis')} rows={abc} columns={[
                { key: 'cls', label: t('Class') }, { key: 'code', label: t('Code') }, { key: 'name', label: t('Item Name') },
                { key: 'val', label: t('Stock Value'), right: true, map: (v) => v.toFixed(2) },
                { key: 'cumPct', label: t('Cumulative %'), right: true, map: (v) => v.toFixed(1) },
              ]} />
            </div>
            {abc.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">{t('No valued inventory yet.')}</div>
            ) : (
              <Table headers={[t('Class'), t('Code'), t('Item Name'), { label: t('Stock Value'), right: true }, { label: t('Cumulative %'), right: true }]}>
                {abc.map((i) => (
                  <Tr key={i.id}>
                    <Td><Badge className={i.cls === 'A' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : i.cls === 'B' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400'}>{i.cls}</Badge></Td>
                    <Td className="font-mono text-xs text-gray-500">{i.code || '—'}</Td>
                    <Td className="font-medium text-gray-800 dark:text-slate-100">{i.name}</Td>
                    <Td right className="text-gray-700 dark:text-slate-200">{fmtMoney(i.val, sym)}</Td>
                    <Td right className="text-gray-500">{i.cumPct.toFixed(1)}%</Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}

      {/* ─── Item Stock Card ─── */}
      {tab === 'card' && (
        <Card>
          <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between gap-3 flex-wrap">
            <Select value={cardItemId} onChange={(e) => setCardItemId(e.target.value)} className="w-72">
              <option value="">— {t('Select item')} —</option>
              {inventoryItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </Select>
            {cardItem && <div className="text-sm text-gray-500 dark:text-slate-400">{t('On hand')}: <span className="font-bold text-gray-800 dark:text-slate-100">{cardItem.quantity || 0} {cardItem.unit}</span></div>}
            {cardItem && cardRows.length > 0 && <ExportMenu size="sm" filename={`stock-card-${cardItem.code || cardItem.name}`} title={`${t('Stock Card')} · ${cardItem.name}`} rows={cardRows} columns={[
              { key: 'date', label: t('Date') }, { key: 'type', label: t('Type'), map: (v) => t(MOVE_LABELS[v] || v) },
              { key: 'ref', label: t('Ref') }, { key: 'qtyChange', label: t('Change'), right: true },
              { key: 'balance', label: t('Balance'), right: true },
            ]} />}
          </div>
          {!cardItem ? (
            <div className="py-12 text-center text-gray-400 text-sm">{t('Select an item to view its movement history.')}</div>
          ) : (
            <Table headers={[t('Date'), t('Type'), t('Reference'), t('Note'), { label: t('Change'), right: true }, { label: t('Balance'), right: true }]}>
              <Tr>
                <Td className="text-gray-400 text-sm" colSpan={4}>{t('Opening balance')}</Td>
                <Td right className="text-gray-400">—</Td>
                <Td right className="font-semibold text-gray-500">{cardOpening}</Td>
              </Tr>
              {cardRows.map((m) => (
                <Tr key={m.id}>
                  <Td className="text-gray-500 dark:text-slate-400">{fmtDate(m.date)}</Td>
                  <Td><Badge className="bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">{t(MOVE_LABELS[m.type] || m.type)}</Badge></Td>
                  <Td className="font-mono text-xs text-gray-400">{m.ref || '—'}</Td>
                  <Td className="text-gray-500 dark:text-slate-400 text-sm max-w-[160px] truncate">{m.note || '—'}</Td>
                  <Td right className={`font-medium ${m.qtyChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>{m.qtyChange >= 0 ? '+' : ''}{m.qtyChange}</Td>
                  <Td right className="font-semibold text-gray-800 dark:text-slate-100">{m.balance}</Td>
                </Tr>
              ))}
              {cardRows.length === 0 && (
                <Tr><Td colSpan={6} className="py-8 text-center text-gray-400 text-sm">{t('No recorded movements yet for this item.')}</Td></Tr>
              )}
            </Table>
          )}
        </Card>
      )}
    </div>
  )
}
