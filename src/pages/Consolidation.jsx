import { useState, useEffect, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { useAuth } from '../auth'
import { idbKvStorage } from '../utils/idbKvStorage'
import { fmtMoney } from '../utils/formatters'
import { PageHeader, Card, Badge, Btn } from '../components/UI'
import ExportMenu from '../components/ExportMenu'
import { Layers, Info, Link2, AlertTriangle, Scissors, Check, X } from 'lucide-react'
import { consolidate, suggestMappings, LIMITATION_TEXT, FINDING_TEXT } from '../utils/consolidation'

// Group consolidation: reads each company's saved snapshot, combines them, and
// then takes out what the group sells and owes to itself.
//
// The elimination is only as good as the mapping behind it, and the mapping
// cannot be inferred — the app has no way to know that "Sub Trading LLC" in the
// parent's customer list is the sister company two rows down. So names are
// matched to *suggest* the link, a person confirms it, and until they do the
// page says plainly that it is showing a sum rather than a consolidation.
// See utils/consolidation.js for what this deliberately does not attempt.

// Everything the consolidation needs out of a company's persisted state.
const SLICE = ['accounts', 'journalEntries', 'settings', 'customers', 'suppliers', 'invoices', 'purchases', 'creditNotes', 'debitNotes']
const sliceOf = (state) => (state ? Object.fromEntries(SLICE.map((k) => [k, state[k]])) : null)

const fill = (tpl, p) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => p[k] ?? `{${k}}`)

export default function Consolidation() {
  const t = useT()
  const companies = useAuth((s) => s.companies)
  const groupMappings = useAuth((s) => s.groupMappings)
  const mapGroupParty = useAuth((s) => s.mapGroupParty)
  const unmapGroupParty = useAuth((s) => s.unmapGroupParty)
  const liveSettings = useStore((s) => s.settings)
  const currentCompanyId = useAuth((s) => s.currentCompanyId)
  const sym = liveSettings.company.currencySymbol

  const [statesByCompany, setStates] = useState(null)
  const [eliminate, setEliminate] = useState(true)
  const [showMapping, setShowMapping] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const out = {}
      for (const c of companies) {
        if (c.id === currentCompanyId) {
          // The live store for the active company, so the page never shows a
          // figure older than what the user just posted.
          out[c.id] = sliceOf(useStore.getState())
        } else {
          try {
            const raw = await idbKvStorage.getItem(`erp-co-${c.id}`)
            out[c.id] = raw ? sliceOf(JSON.parse(raw).state) : null
          } catch { out[c.id] = null }
        }
      }
      if (alive) setStates(out)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, currentCompanyId])

  const data = useMemo(() => {
    if (!statesByCompany) return null
    return consolidate({ companies, statesByCompany, mappings: groupMappings, eliminate })
  }, [statesByCompany, companies, groupMappings, eliminate])

  // Suggestions, minus anything already confirmed or already answered by a
  // different confirmed mapping for the same party.
  const suggestions = useMemo(() => {
    if (!statesByCompany) return []
    const done = new Set(groupMappings.map((m) => `${m.companyId}|${m.partyId}`))
    return suggestMappings(companies, statesByCompany).filter((s) => !done.has(`${s.companyId}|${s.partyId}`))
  }, [statesByCompany, companies, groupMappings])

  // The consolidated P&L stays a *combined* view: an invoice's subtotal can
  // span several revenue accounts, so there is no honest way to push an
  // elimination down to a specific account line. Saying that is better than
  // spreading it and calling the result consolidated.
  const pl = useMemo(() => {
    if (!statesByCompany) return []
    const natural = (acc, b) => (['asset', 'expense'].includes(acc.type) ? b.dr - b.cr : b.cr - b.dr)
    const map = {}
    companies.forEach((c) => {
      const state = statesByCompany[c.id]
      if (!state) return
      const bal = {}
      ;(state.journalEntries || []).forEach((je) => (je.lines || []).forEach((l) => {
        const b = bal[l.accountId] || (bal[l.accountId] = { dr: 0, cr: 0 })
        b.dr += l.debit || 0; b.cr += l.credit || 0
      }))
      ;(state.accounts || []).filter((a) => a.type === 'revenue' || a.type === 'expense').forEach((a) => {
        const v = natural(a, bal[a.id] || { dr: 0, cr: 0 })
        if (Math.abs(v) < 0.005) return
        const key = a.code || a.name
        const row = map[key] || (map[key] = { name: `${a.code || ''} ${a.name}`.trim(), type: a.type, total: 0 })
        row.total += v
      })
    })
    return Object.values(map).sort((a, b) => (a.type === b.type ? b.total - a.total : a.type === 'revenue' ? -1 : 1))
  }, [statesByCompany, companies])

  if (!data) return <div className="py-24 text-center text-gray-400 dark:text-slate-500">{t('Loading…')}</div>

  const { combined, group, eliminations, companyRows, pairs, findings, hasMappings } = data
  const eliminating = hasMappings && eliminate && (eliminations.revenue > 0 || eliminations.receivables > 0)
  const nameOf = (id) => companies.find((c) => c.id === id)?.name || id

  const exportRows = companyRows.filter((r) => !r.missing).map((r) => ({
    company: r.name, revenue: r.revenue, expense: r.expenses, net: r.net, assets: r.assets, liabilities: r.liabilities, equity: r.equity,
  }))
  exportRows.push({ company: t('Combined'), revenue: combined.revenue, expense: combined.expenses, net: combined.net, assets: combined.assets, liabilities: combined.liabilities, equity: combined.equity })
  exportRows.push({ company: t('Eliminations'), revenue: -eliminations.revenue, expense: -eliminations.expenses, net: 0, assets: -eliminations.receivables, liabilities: -eliminations.payables, equity: 0 })
  exportRows.push({ company: t('Group'), revenue: group.revenue, expense: group.expenses, net: group.net, assets: group.assets, liabilities: group.liabilities, equity: group.equity })
  const exportCols = [
    { key: 'company', label: t('Company') },
    { key: 'revenue', label: t('Revenue'), right: true, map: (v) => Number(v).toFixed(2) },
    { key: 'expense', label: t('Expenses'), right: true, map: (v) => Number(v).toFixed(2) },
    { key: 'net', label: t('Net Profit'), right: true, map: (v) => Number(v).toFixed(2) },
    { key: 'assets', label: t('Assets'), right: true, map: (v) => Number(v).toFixed(2) },
    { key: 'liabilities', label: t('Liabilities'), right: true, map: (v) => Number(v).toFixed(2) },
    { key: 'equity', label: t('Equity'), right: true, map: (v) => Number(v).toFixed(2) },
  ]

  const kpis = [
    { label: 'Group Revenue', gross: combined.revenue, elim: eliminations.revenue, value: group.revenue, tone: 'from-emerald-500 to-green-600' },
    { label: 'Group Expenses', gross: combined.expenses, elim: eliminations.expenses, value: group.expenses, tone: 'from-rose-500 to-red-600' },
    { label: 'Group Net Profit', gross: combined.net, elim: 0, value: group.net, tone: 'from-brand-500 to-accent-600' },
    { label: 'Group Assets', gross: combined.assets, elim: eliminations.receivables, value: group.assets, tone: 'from-violet-500 to-purple-600' },
  ]

  return (
    <div>
      <PageHeader title="Group Consolidation" subtitle="Combined performance and position across all your companies, less what the group trades with itself"
        action={<ExportMenu filename="consolidation" title={t('Group Consolidation')} rows={exportRows} columns={exportCols} />} />

      {/* The headline honesty statement. Without a mapping this page is a sum,
          and it says so rather than letting "Group Revenue" imply otherwise. */}
      {!hasMappings ? (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 mb-5 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{t('These figures are a sum, not a consolidation.')}</p>
            <p className="mt-0.5">{t('Nothing has been marked as trade between your own companies, so any sale from one to another is counted in group revenue and again in group expenses, and money the group owes itself is in both assets and liabilities.')}</p>
            <Btn size="sm" variant="secondary" className="mt-2" onClick={() => setShowMapping(true)}>{t('Set up intercompany mapping')}</Btn>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-2.5 mb-5 text-sm text-blue-800 dark:text-blue-300">
          <span className="flex items-center gap-2">
            <Scissors size={16} className="flex-shrink-0" />
            {eliminating
              ? t('Intercompany trade and balances are eliminated from the group figures.')
              : t('No intercompany trade or balances were found to eliminate.')}
          </span>
          <span className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={eliminate} onChange={(e) => setEliminate(e.target.checked)} className="rounded" />
              {t('Eliminate')}
            </label>
            <Btn size="sm" variant="secondary" onClick={() => setShowMapping((v) => !v)}>{t('Mapping')}</Btn>
          </span>
        </div>
      )}

      {findings.length > 0 && (
        <Card className="p-4 mb-5 border-s-4 border-s-amber-400">
          <h3 className="font-semibold text-gray-800 dark:text-slate-100 flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-500" />{t('Needs attention')}
          </h3>
          <ul className="space-y-1.5 text-sm text-gray-600 dark:text-slate-300">
            {findings.map((f, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">•</span>
                <span>
                  {/* Translate the template, then fill it: filling first
                      produces a string with the company names baked in, which
                      is never going to be a dictionary key. */}
                  {fill(t(FINDING_TEXT[f.code]), { a: f.aName, b: f.bName })}
                  {f.code === 'PAIR_DISAGREES' && (
                    <span className="text-gray-500 dark:text-slate-400">
                      {' '}({t('difference')} {fmtMoney(Math.abs(f.receivableGap) > 0.02 ? f.receivableGap : f.payableGap, sym)})
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {showMapping && (
        <MappingPanel
          t={t} companies={companies} suggestions={suggestions} mappings={groupMappings}
          onConfirm={mapGroupParty} onRemove={unmapGroupParty} nameOf={nameOf}
          onClose={() => setShowMapping(false)}
        />
      )}

      {/* Group KPIs — each shows what was taken out, so the difference between
          the sum and the group figure is never silent. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpis.map((k) => (
          <Card key={k.label} className="p-5">
            <div className={`inline-flex text-white text-xs font-semibold px-2 py-0.5 rounded-md bg-gradient-to-br ${k.tone} mb-2`}>{t('Group')}</div>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 font-semibold">{t(k.label)}</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1 tabular">{fmtMoney(k.value, sym)}</p>
            {k.elim > 0.005 && (
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 tabular">
                {fmtMoney(k.gross, sym)} {t('less')} {fmtMoney(k.elim, sym)} {t('intercompany')}
              </p>
            )}
          </Card>
        ))}
      </div>

      {/* Per-company summary, with the elimination shown as its own line the
          way a consolidation worksheet has always done it. */}
      <Card className="overflow-x-auto mb-6">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2">
          <Layers size={16} className="text-blue-500" /><h3 className="font-semibold text-gray-700 dark:text-slate-200">{t('By Company')}</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 text-xs uppercase">
              <th className="py-2.5 px-4 text-start font-semibold">{t('Company')}</th>
              <th className="py-2.5 px-4 text-end font-semibold">{t('Revenue')}</th>
              <th className="py-2.5 px-4 text-end font-semibold">{t('Expenses')}</th>
              <th className="py-2.5 px-4 text-end font-semibold">{t('Net Profit')}</th>
              <th className="py-2.5 px-4 text-end font-semibold">{t('Assets')}</th>
              <th className="py-2.5 px-4 text-end font-semibold">{t('Equity')}</th>
            </tr>
          </thead>
          <tbody>
            {companyRows.map((r, i) => r.missing ? (
              <tr key={i} className="border-b border-gray-50 dark:border-slate-700/50 text-gray-400">
                <td className="py-2 px-4">{r.name}</td>
                <td className="py-2 px-4 text-end" colSpan={5}>{t('No saved data yet')}</td>
              </tr>
            ) : (
              <tr key={r.id} className="border-b border-gray-50 dark:border-slate-700/50">
                <td className="py-2 px-4 font-medium text-gray-800 dark:text-slate-100">{r.name}{r.id === currentCompanyId && <Badge className="ms-2 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{t('Active')}</Badge>}</td>
                <td className="py-2 px-4 text-end text-gray-700 dark:text-slate-200">{fmtMoney(r.revenue, sym)}</td>
                <td className="py-2 px-4 text-end text-gray-700 dark:text-slate-200">{fmtMoney(r.expenses, sym)}</td>
                <td className={`py-2 px-4 text-end font-semibold ${r.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{fmtMoney(r.net, sym)}</td>
                <td className="py-2 px-4 text-end text-gray-700 dark:text-slate-200">{fmtMoney(r.assets, sym)}</td>
                <td className="py-2 px-4 text-end text-gray-700 dark:text-slate-200">{fmtMoney(r.equity, sym)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-300 dark:border-slate-500 bg-gray-50/60 dark:bg-slate-700/40 font-semibold">
              <td className="py-2.5 px-4 text-gray-800 dark:text-slate-100">{t('Combined')}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(combined.revenue, sym)}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(combined.expenses, sym)}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(combined.net, sym)}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(combined.assets, sym)}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(combined.equity, sym)}</td>
            </tr>
            <tr className="border-b border-gray-100 dark:border-slate-700 text-gray-500 dark:text-slate-400 italic">
              <td className="py-2 px-4">{t('Eliminations')}</td>
              <td className="py-2 px-4 text-end">{eliminations.revenue ? `(${fmtMoney(eliminations.revenue, sym)})` : '—'}</td>
              <td className="py-2 px-4 text-end">{eliminations.expenses ? `(${fmtMoney(eliminations.expenses, sym)})` : '—'}</td>
              <td className="py-2 px-4 text-end">—</td>
              <td className="py-2 px-4 text-end">{eliminations.receivables ? `(${fmtMoney(eliminations.receivables, sym)})` : '—'}</td>
              <td className="py-2 px-4 text-end">—</td>
            </tr>
            <tr className="border-t-2 border-gray-300 dark:border-slate-500 bg-gray-50/60 dark:bg-slate-700/40 font-bold">
              <td className="py-2.5 px-4 text-gray-900 dark:text-slate-100">{t('Group Total')}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(group.revenue, sym)}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(group.expenses, sym)}</td>
              <td className={`py-2.5 px-4 text-end ${group.net >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(group.net, sym)}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(group.assets, sym)}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(group.equity, sym)}</td>
            </tr>
          </tbody>
        </table>
        {eliminating && (
          <p className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400 border-t border-gray-100 dark:border-slate-700">
            {t('Net profit is unchanged by elimination: an intercompany sale adds the same amount to revenue and to expenses, so it never affected the bottom line — only the figures above it.')}
          </p>
        )}
      </Card>

      {/* Intercompany balances, side by side */}
      {pairs.length > 0 && (
        <Card className="overflow-x-auto mb-6">
          <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2">
            <Link2 size={16} className="text-blue-500" /><h3 className="font-semibold text-gray-700 dark:text-slate-200">{t('Intercompany Balances')}</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 text-xs uppercase">
                <th className="py-2.5 px-4 text-start font-semibold">{t('Pair')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t('Owed to first')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t('Confirmed by second')}</th>
                <th className="py-2.5 px-4 text-end font-semibold">{t('Difference')}</th>
                <th className="py-2.5 px-4 text-center font-semibold">{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-slate-700/50">
                  <td className="py-2 px-4 text-gray-700 dark:text-slate-200">{p.aName} → {p.bName}</td>
                  <td className="py-2 px-4 text-end tabular">{fmtMoney(p.aReceivable, sym)}</td>
                  <td className="py-2 px-4 text-end tabular">{fmtMoney(p.bPayable, sym)}</td>
                  <td className={`py-2 px-4 text-end tabular ${Math.abs(p.receivableGap) > 0.02 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-gray-400'}`}>{fmtMoney(p.receivableGap, sym)}</td>
                  <td className="py-2 px-4 text-center">
                    {!p.mappedBothWays
                      ? <Badge className="bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300">{t('One-sided')}</Badge>
                      : p.agrees && p.tradeAgrees
                        ? <Badge className="bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300">{t('Agrees')}</Badge>
                        : <Badge className="bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{t('Disagrees')}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Combined P&L by account */}
      <Card className="overflow-x-auto mb-6">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700">
          <div className="font-semibold text-gray-700 dark:text-slate-200">{t('Combined P&L by Account')}</div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            {t('Before eliminations. An invoice can span several revenue accounts, so an elimination cannot be attributed to one account line honestly.')}
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 text-xs uppercase">
              <th className="py-2.5 px-4 text-start font-semibold">{t('Account')}</th>
              <th className="py-2.5 px-4 text-start font-semibold">{t('Type')}</th>
              <th className="py-2.5 px-4 text-end font-semibold">{t('Combined')}</th>
            </tr>
          </thead>
          <tbody>
            {pl.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-gray-400 dark:text-slate-500">{t('No data for this period')}</td></tr>}
            {pl.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 dark:border-slate-700/50">
                <td className="py-2 px-4 text-gray-700 dark:text-slate-200">{r.name}</td>
                <td className="py-2 px-4"><Badge className={r.type === 'revenue' ? 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300' : 'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300'}>{t(r.type === 'revenue' ? 'Revenue' : 'Expense')}</Badge></td>
                <td className="py-2 px-4 text-end font-medium text-gray-800 dark:text-slate-100">{fmtMoney(r.total, sym)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* What this is not. Stated on the page, not buried in a comment. */}
      <Card className="p-4">
        <h3 className="font-semibold text-gray-700 dark:text-slate-200 flex items-center gap-2 mb-2">
          <Info size={16} className="text-gray-400" />{t('What this consolidation does not do')}
        </h3>
        <ul className="space-y-1.5 text-sm text-gray-600 dark:text-slate-300 list-disc list-inside">
          {data.limitations.map((code) => <li key={code}>{t(LIMITATION_TEXT[code])}</li>)}
        </ul>
      </Card>
    </div>
  )
}

/** Confirming which party is which company. Suggestions above, decisions below. */
function MappingPanel({ t, companies, suggestions, mappings, onConfirm, onRemove, nameOf, onClose }) {
  return (
    <Card className="p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-700 dark:text-slate-200 flex items-center gap-2">
          <Link2 size={16} className="text-blue-500" />{t('Intercompany Mapping')}
        </h3>
        <Btn size="sm" variant="ghost" onClick={onClose}>{t('Close')}</Btn>
      </div>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
        {t('Tell the group which customer or supplier in each company is another company you own. Nothing is eliminated until you confirm it here.')}
      </p>

      {suggestions.length > 0 && (
        <>
          <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-2">{t('Suggested by name')}</p>
          <ul className="space-y-2 mb-5">
            {suggestions.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2">
                <span className="text-sm text-gray-700 dark:text-slate-200">
                  <span className="font-medium">{s.partyName}</span>
                  <span className="text-gray-500 dark:text-slate-400"> ({t(s.partyType === 'customer' ? 'customer' : 'supplier')} {t('of')} {s.companyName})</span>
                  <span className="text-gray-500 dark:text-slate-400"> → {s.representsCompanyName}</span>
                  {s.confidence === 'partial' && <Badge className="ms-2 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{t('Partial match')}</Badge>}
                </span>
                <Btn size="sm" onClick={() => onConfirm(s)}>
                  <Check size={14} />{t('Confirm')}
                </Btn>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-2">{t('Confirmed')}</p>
      {mappings.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">{t('Nothing mapped yet.')}</p>
      ) : (
        <ul className="space-y-2">
          {mappings.map((m, i) => (
            <li key={i} className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2">
              <span className="text-sm text-gray-700 dark:text-slate-200">
                <span className="font-medium">{m.partyName || m.partyId}</span>
                <span className="text-gray-500 dark:text-slate-400"> ({t(m.partyType === 'customer' ? 'customer' : 'supplier')} {t('of')} {nameOf(m.companyId)})</span>
                <span className="text-gray-500 dark:text-slate-400"> → {nameOf(m.representsCompanyId)}</span>
              </span>
              <Btn size="sm" variant="ghost" onClick={() => onRemove(m.companyId, m.partyId)}>
                <X size={14} />{t('Remove')}
              </Btn>
            </li>
          ))}
        </ul>
      )}
      {companies.length < 2 && (
        <p className="text-sm text-gray-400 dark:text-slate-500 mt-3">{t('Add a second company before mapping intercompany trade.')}</p>
      )}
    </Card>
  )
}
