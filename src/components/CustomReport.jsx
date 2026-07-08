import { useState, useMemo, Fragment } from 'react'
import { useT } from '../i18n'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { Card, Btn, Select } from './UI'
import ExportMenu from './ExportMenu'
import { Sliders, GripVertical } from 'lucide-react'

/**
 * Custom Report Builder — pick a data source, choose the columns you need,
 * filter by the report date range, optionally group & subtotal, then export
 * to CSV / Excel / PDF. Everything runs locally on the store data.
 *
 * Props: data { invoices, purchases, journalEntries, customers, suppliers,
 *               inventoryItems, accounts }, startDate, endDate, sym
 */
export default function CustomReport({ data, startDate, endDate, sym }) {
  const t = useT()

  // ── Field catalogue per data source ───────────────────────────────
  const SOURCES = useMemo(() => ({
    invoices: {
      label: 'Sales Invoices', dateKey: 'date',
      rows: data.invoices || [],
      fields: [
        { key: 'number', label: 'Invoice #', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'dueDate', label: 'Due Date', type: 'date' },
        { key: 'customerName', label: 'Customer', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'subtotal', label: 'Subtotal', type: 'money' },
        { key: 'taxAmount', label: 'Tax', type: 'money' },
        { key: 'total', label: 'Total', type: 'money' },
        { key: 'amountPaid', label: 'Paid', type: 'money' },
        { key: 'balance', label: 'Outstanding', type: 'money', get: (r) => (r.total || 0) - (r.amountPaid || 0) },
      ],
    },
    purchases: {
      label: 'Purchase Bills', dateKey: 'date',
      rows: data.purchases || [],
      fields: [
        { key: 'number', label: 'Bill #', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'dueDate', label: 'Due Date', type: 'date' },
        { key: 'supplierName', label: 'Supplier', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'total', label: 'Total', type: 'money' },
        { key: 'amountPaid', label: 'Paid', type: 'money' },
        { key: 'balance', label: 'Outstanding', type: 'money', get: (r) => (r.total || 0) - (r.amountPaid || 0) },
      ],
    },
    journalEntries: {
      label: 'Journal Entries', dateKey: 'date',
      rows: data.journalEntries || [],
      fields: [
        { key: 'reference', label: 'Reference', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'debit', label: 'Debit', type: 'money', get: (r) => (r.lines || []).reduce((s, l) => s + (l.debit || 0), 0) },
        { key: 'lineCount', label: 'Lines', type: 'number', get: (r) => (r.lines || []).length },
      ],
    },
    customers: {
      label: 'Customers', dateKey: null,
      rows: data.customers || [],
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'email', label: 'Email', type: 'text' },
        { key: 'phone', label: 'Phone', type: 'text' },
        { key: 'taxNumber', label: 'Tax Number', type: 'text' },
        { key: 'city', label: 'City', type: 'text' },
      ],
    },
    suppliers: {
      label: 'Suppliers', dateKey: null,
      rows: data.suppliers || [],
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'email', label: 'Email', type: 'text' },
        { key: 'phone', label: 'Phone', type: 'text' },
        { key: 'taxNumber', label: 'Tax Number', type: 'text' },
        { key: 'city', label: 'City', type: 'text' },
      ],
    },
    inventoryItems: {
      label: 'Inventory Items', dateKey: null,
      rows: data.inventoryItems || [],
      fields: [
        { key: 'code', label: 'Code', type: 'text' },
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'category', label: 'Category', type: 'text' },
        { key: 'quantity', label: 'Qty on Hand', type: 'number' },
        { key: 'costPrice', label: 'Unit Cost', type: 'money' },
        { key: 'salePrice', label: 'Sale Price', type: 'money' },
        { key: 'stockValue', label: 'Stock Value', type: 'money', get: (r) => (r.quantity || 0) * (r.costPrice || 0) },
        { key: 'reorderLevel', label: 'Reorder Level', type: 'number' },
      ],
    },
    accounts: {
      label: 'Chart of Accounts', dateKey: null,
      rows: data.accounts || [],
      fields: [
        { key: 'code', label: 'Code', type: 'text' },
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'subtype', label: 'Subtype', type: 'text' },
      ],
    },
  }), [data])

  const [source, setSource] = useState('invoices')
  const src = SOURCES[source]
  const [selected, setSelected] = useState(SOURCES.invoices.fields.slice(0, 5).map((f) => f.key))
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState('')
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState('asc')

  const changeSource = (id) => {
    setSource(id)
    setSelected(SOURCES[id].fields.slice(0, 5).map((f) => f.key))
    setGroupBy(''); setSortKey(''); setSearch('')
  }

  const toggleField = (key) => setSelected((s) => s.includes(key) ? s.filter((k) => k !== key) : [...s, key])

  const fieldOf = (key) => src.fields.find((f) => f.key === key)
  const valueOf = (row, f) => (f.get ? f.get(row) : row[f.key])

  // ── Build the working rows ────────────────────────────────────────
  const chosen = selected.map(fieldOf).filter(Boolean)

  const working = useMemo(() => {
    let rows = [...src.rows]
    // date-range filter
    if (src.dateKey) rows = rows.filter((r) => {
      const d = r[src.dateKey]
      return !d || ((!startDate || d >= startDate) && (!endDate || d <= endDate))
    })
    // free-text search across chosen text columns
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter((r) => chosen.some((f) => String(valueOf(r, f) ?? '').toLowerCase().includes(q)))
    }
    // sort
    if (sortKey) {
      const f = fieldOf(sortKey)
      if (f) rows.sort((a, b) => {
        const av = valueOf(a, f), bv = valueOf(b, f)
        const cmp = (f.type === 'money' || f.type === 'number')
          ? (Number(av) || 0) - (Number(bv) || 0)
          : String(av ?? '').localeCompare(String(bv ?? ''))
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, selected, search, sortKey, sortDir, startDate, endDate])

  const fmtCell = (row, f) => {
    const v = valueOf(row, f)
    if (f.type === 'money') return fmtMoney(Number(v) || 0, sym)
    if (f.type === 'date') return v ? fmtDate(v) : '—'
    return v ?? '—'
  }

  // numeric columns get column totals
  const numericFields = chosen.filter((f) => f.type === 'money' || f.type === 'number')
  const columnTotal = (f) => working.reduce((s, r) => s + (Number(valueOf(r, f)) || 0), 0)

  // grouping
  const grouped = useMemo(() => {
    if (!groupBy) return null
    const gf = fieldOf(groupBy)
    if (!gf) return null
    const map = {}
    working.forEach((r) => {
      const key = String(valueOf(r, gf) ?? '—')
      ;(map[key] || (map[key] = [])).push(r)
    })
    return Object.entries(map).map(([key, rows]) => ({ key, rows }))
      .sort((a, b) => a.key.localeCompare(b.key))
  }, [working, groupBy])

  // ── Export config ─────────────────────────────────────────────────
  const exportColumns = chosen.map((f) => ({
    key: f.key, label: t(f.label), right: f.type === 'money' || f.type === 'number',
    map: f.type === 'money' ? (v) => Number(v || 0).toFixed(2) : undefined,
  }))
  const exportRows = working.map((r) => {
    const o = {}
    chosen.forEach((f) => { o[f.key] = valueOf(r, f) })
    return o
  })

  const Th = ({ f }) => (
    <th
      onClick={() => { setSortKey(f.key); setSortDir((d) => (sortKey === f.key && d === 'asc') ? 'desc' : 'asc') }}
      className={`py-2 px-2 font-semibold cursor-pointer select-none whitespace-nowrap ${(f.type === 'money' || f.type === 'number') ? 'text-end' : 'text-start'}`}
      title={t('Click to sort')}
    >
      {t(f.label)}{sortKey === f.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )

  return (
    <div className="space-y-5">
      {/* Builder controls */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Sliders size={17} className="text-blue-500" />
          <h3 className="font-bold text-gray-800 dark:text-slate-100">{t('Custom Report Builder')}</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <Select label={t('Data Source')} value={source} onChange={(e) => changeSource(e.target.value)}>
            {Object.entries(SOURCES).map(([id, s]) => <option key={id} value={id}>{t(s.label)}</option>)}
          </Select>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">{t('Search')}</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Filter rows…')}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <Select label={t('Group By')} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="">{t('— None —')}</option>
            {chosen.filter((f) => f.type === 'text').map((f) => <option key={f.key} value={f.key}>{t(f.label)}</option>)}
          </Select>
          <div className="flex items-end">
            <ExportMenu filename={`custom-${source}`} title={`${t('Custom Report')} · ${t(src.label)}`}
              subtitle={src.dateKey ? `${fmtDate(startDate)} — ${fmtDate(endDate)}` : ''}
              rows={exportRows} columns={exportColumns} disabled={chosen.length === 0} />
          </div>
        </div>

        {/* Column picker */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-2">{t('Columns')}</label>
          <div className="flex flex-wrap gap-2">
            {src.fields.map((f) => {
              const on = selected.includes(f.key)
              return (
                <button key={f.key} type="button" onClick={() => toggleField(f.key)}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:border-blue-400'}`}>
                  <GripVertical size={11} className={on ? 'opacity-80' : 'opacity-30'} />{t(f.label)}
                </button>
              )
            })}
          </div>
        </div>
      </Card>

      {/* Result table */}
      <Card className="overflow-x-auto">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {working.length} {t('rows')}{groupBy ? ` · ${grouped?.length || 0} ${t('groups')}` : ''}
          </p>
        </div>
        {chosen.length === 0 ? (
          <p className="p-8 text-center text-gray-400">{t('Select at least one column.')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400">
                {chosen.map((f) => <Th key={f.key} f={f} />)}
              </tr>
            </thead>
            <tbody>
              {working.length === 0 && <tr><td colSpan={chosen.length} className="py-8 text-center text-gray-400">{t('No data for this period')}</td></tr>}

              {!groupBy && working.map((r, ri) => (
                <tr key={ri} className="border-b border-gray-50 dark:border-slate-700/50">
                  {chosen.map((f) => (
                    <td key={f.key} className={`py-1.5 px-2 whitespace-nowrap ${(f.type === 'money' || f.type === 'number') ? 'text-end font-medium text-gray-800 dark:text-slate-100' : 'text-start text-gray-700 dark:text-slate-200'}`}>
                      {fmtCell(r, f)}
                    </td>
                  ))}
                </tr>
              ))}

              {groupBy && grouped && grouped.map((g) => (
                <Fragment key={g.key}>
                  <tr className="bg-gray-50 dark:bg-slate-700/40">
                    <td colSpan={chosen.length} className="py-2 px-2 font-bold text-gray-700 dark:text-slate-200">
                      {g.key} <span className="text-xs font-normal text-gray-400">({g.rows.length})</span>
                    </td>
                  </tr>
                  {g.rows.map((r, ri) => (
                    <tr key={ri} className="border-b border-gray-50 dark:border-slate-700/50">
                      {chosen.map((f) => (
                        <td key={f.key} className={`py-1.5 px-2 whitespace-nowrap ${(f.type === 'money' || f.type === 'number') ? 'text-end font-medium text-gray-800 dark:text-slate-100' : 'text-start text-gray-700 dark:text-slate-200'}`}>
                          {fmtCell(r, f)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {numericFields.length > 0 && (
                    <tr className="border-b border-gray-100 dark:border-slate-700 text-gray-600 dark:text-slate-300">
                      {chosen.map((f, i) => (
                        <td key={f.key} className={`py-1 px-2 text-xs ${(f.type === 'money' || f.type === 'number') ? 'text-end font-semibold' : 'text-start italic'}`}>
                          {i === 0 ? t('Subtotal') : (f.type === 'money' || f.type === 'number') ? fmtCell({ [f.key]: g.rows.reduce((s, r) => s + (Number(valueOf(r, f)) || 0), 0) }, { ...f, get: null }) : ''}
                        </td>
                      ))}
                    </tr>
                  )}
                </Fragment>
              ))}

              {numericFields.length > 0 && working.length > 0 && (
                <tr className="border-t-2 border-gray-300 dark:border-slate-500 bg-gray-50/60 dark:bg-slate-700/40 font-bold">
                  {chosen.map((f, i) => (
                    <td key={f.key} className={`py-2 px-2 ${(f.type === 'money' || f.type === 'number') ? 'text-end text-gray-900 dark:text-slate-100' : 'text-start'}`}>
                      {i === 0 ? t('Grand Total') : (f.type === 'money' ? fmtMoney(columnTotal(f), sym) : f.type === 'number' ? columnTotal(f) : '')}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
