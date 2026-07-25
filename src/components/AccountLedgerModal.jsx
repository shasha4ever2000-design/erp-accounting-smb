import { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { useT } from '../i18n'
import { Input } from './UI'
import ExportMenu from './ExportMenu'
import { X, ArrowUpRight, ArrowDownRight, ArrowRight } from 'lucide-react'

// Per-account-type accent, so the drawer reads at a glance which side of the
// books you are looking at (assets blue, liabilities orange, and so on).
const ACCENT = {
  asset:     { text: 'text-brand-600 dark:text-brand-400',   dot: 'bg-brand-500',   soft: 'from-brand-500/10' },
  liability: { text: 'text-orange-600 dark:text-orange-400', dot: 'bg-orange-500',  soft: 'from-orange-500/10' },
  equity:    { text: 'text-violet-600 dark:text-violet-400', dot: 'bg-violet-500',  soft: 'from-violet-500/10' },
  revenue:   { text: 'text-success-600 dark:text-success-400', dot: 'bg-success-500', soft: 'from-success-500/10' },
  expense:   { text: 'text-rose-600 dark:text-rose-400',     dot: 'bg-rose-500',    soft: 'from-rose-500/10' },
}

const isDebitNormal = (type) => type === 'asset' || type === 'expense'

/**
 * Statement of Account (SOA) for one ledger — Manager-style drill-down.
 *
 * The date range is always user-editable inside the drawer via Start/End
 * Date fields. `mode` only picks the initial default when it first opens:
 * 'period' → the caller's startDate; 'todate' → the ledger's earliest
 * activity (i.e. "since inception"). Clicking a contra account pivots the
 * drawer to that ledger while keeping whatever range is currently set.
 */
export default function AccountLedgerModal({ open, onClose, account, accounts, journalEntries, sym, startDate, endDate, mode = 'period', companyName, onOpenAccount }) {
  const t = useT()
  const accById = useMemo(() => Object.fromEntries((accounts || []).map((a) => [a.id, a])), [accounts])

  // The earliest date with any activity at all — used as the "since inception"
  // default for a 'todate' drill-down, so the Start Date field shows a real,
  // meaningful date instead of an arbitrary sentinel.
  const earliestDate = useMemo(() => {
    if (!journalEntries || !journalEntries.length) return startDate
    return journalEntries.reduce((min, je) => (je.date < min ? je.date : min), journalEntries[0].date)
  }, [journalEntries, startDate])

  // The date range is editable in-place. It resets to the caller's defaults
  // whenever the drawer freshly opens, but persists while pivoting between
  // accounts via the contra-account chips (so comparing several ledgers over
  // the same custom period doesn't require re-picking dates each time).
  const [localStart, setLocalStart] = useState(startDate)
  const [localEnd, setLocalEnd] = useState(endDate)
  useEffect(() => {
    if (open) { setLocalStart(mode === 'todate' ? earliestDate : startDate); setLocalEnd(endDate) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startDate, endDate, mode])

  const data = useMemo(() => {
    if (!account) return null
    const sign = isDebitNormal(account.type) ? 1 : -1
    const rangeStart = localStart
    const rangeEnd = localEnd
    // A tile like "Cash & Bank" aggregates several ledgers: pass memberIds and the
    // drawer shows their combined statement, with contra = accounts outside the group.
    const memberIds = account.memberIds && account.memberIds.length ? account.memberIds : [account.id]
    const inGroup = (id) => memberIds.includes(id)

    let opening = 0
    const rows = []
    const sorted = [...(journalEntries || [])].sort((a, b) => (a.date === b.date ? String(a.number).localeCompare(String(b.number)) : a.date.localeCompare(b.date)))

    sorted.forEach((je) => {
      // Net the group's movement on this voucher into a single line.
      let dr = 0, cr = 0, descPick = ''
      je.lines.forEach((l) => { if (inGroup(l.accountId)) { dr += +l.debit || 0; cr += +l.credit || 0; if (!descPick) descPick = l.description } })
      if (dr === 0 && cr === 0) return
      const move = sign * (dr - cr)
      if (je.date < rangeStart) { opening += move; return }
      if (je.date > rangeEnd) return
      const contra = je.lines.filter((x) => !inGroup(x.accountId)).map((x) => accById[x.accountId]).filter(Boolean)
      rows.push({ id: je.id, date: je.date, ref: je.number, type: je.type, desc: descPick || je.description, dr, cr, move, contra })
    })

    let running = opening
    rows.forEach((r) => { running += r.move; r.balance = running })
    const totalDr = rows.reduce((s, r) => s + r.dr, 0)
    const totalCr = rows.reduce((s, r) => s + r.cr, 0)
    return { opening, rows, totalDr, totalCr, closing: running, net: running - opening }
  }, [account, journalEntries, accById, localStart, localEnd])

  const exportRows = useMemo(() => {
    if (!data) return []
    return [
      { date: fmtDate(localStart), ref: '', desc: t('Opening balance'), dr: '', cr: '', balance: data.opening },
      ...data.rows.map((r) => ({ date: fmtDate(r.date), ref: r.ref, desc: r.desc, dr: r.dr || '', cr: r.cr || '', balance: r.balance })),
      { date: '', ref: '', desc: t('Closing balance'), dr: data.totalDr, cr: data.totalCr, balance: data.closing },
    ]
  }, [data, localStart, t])

  const exportColumns = [
    { key: 'date', label: t('Date') },
    { key: 'ref', label: t('Reference') },
    { key: 'desc', label: t('Details') },
    { key: 'dr', label: t('Debit'), right: true, map: (v) => (v === '' ? '' : Number(v).toFixed(2)) },
    { key: 'cr', label: t('Credit'), right: true, map: (v) => (v === '' ? '' : Number(v).toFixed(2)) },
    { key: 'balance', label: t('Balance'), right: true, map: (v) => Number(v).toFixed(2) },
  ]

  if (!open || !account) return null
  const accent = ACCENT[account.type] || ACCENT.asset
  const safeName = (account.name || 'account').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-')
  const exportFilename = `SOA-${safeName}-${localStart}_to_${localEnd}`

  const Chip = ({ label, value, strong }) => (
    <div className="flex-1 min-w-[120px] rounded-xl bg-slate-50 dark:bg-surface-800/70 ring-1 ring-inset ring-black/[0.03] dark:ring-white/[0.05] px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <p className={`mt-0.5 tabular-nums ${strong ? 'text-lg font-bold' : 'text-base font-semibold'} ${strong ? accent.text : 'text-slate-800 dark:text-slate-100'}`}>{fmtMoney(value, sym)}</p>
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface-950/55 backdrop-blur-[3px] animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-white dark:bg-surface-850 rounded-2xl shadow-modal ring-1 ring-black/5 dark:ring-white/10 flex flex-col animate-scale-in overflow-hidden">
        {/* Header */}
        <div className={`relative bg-gradient-to-b ${accent.soft} to-transparent border-b border-slate-100 dark:border-surface-750`}>
          <div className="flex items-start justify-between ps-6 pe-4 pt-5 pb-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${accent.dot}`} />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t('Statement of Account')}</span>
              </div>
              <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 truncate">
                {account.code ? <span className="font-mono text-slate-400 dark:text-slate-500 text-base me-2">{account.code}</span> : null}
                {account.name}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{companyName}</p>
            </div>
            <button onClick={onClose} aria-label={t('Close')} className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-100 dark:hover:bg-white/[0.07] transition-colors">
              <X size={18} />
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3 px-6 pb-4">
            <Input label={t('Start Date')} type="date" value={localStart} onChange={(e) => setLocalStart(e.target.value)} className="w-40" />
            <Input label={t('End Date')} type="date" value={localEnd} onChange={(e) => setLocalEnd(e.target.value)} className="w-40" />
            <div className="ms-auto">
              <ExportMenu
                filename={exportFilename}
                rows={exportRows}
                columns={exportColumns}
                title={`${t('Statement of Account')} — ${account.name}`}
                subtitle={`${companyName} · ${fmtDate(localStart)} — ${fmtDate(localEnd)}`}
                size="sm"
              />
            </div>
          </div>
          <div className="flex gap-3 px-6 pb-5">
            <Chip label={t('Opening')} value={data.opening} />
            <Chip label={t('Movement')} value={data.net} />
            <Chip label={t('Closing')} value={data.closing} strong />
          </div>
        </div>

        {/* Ledger */}
        <div className="flex-1 overflow-y-auto">
          {data.rows.length === 0 ? (
            <div className="py-16 text-center text-slate-400 dark:text-slate-500 text-sm">{t('No transactions for this account in the selected period')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white/95 dark:bg-surface-850/95 backdrop-blur border-b border-slate-100 dark:border-surface-750">
                <tr className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                  <th className="text-start ps-6 pe-2 py-2.5">{t('Date')}</th>
                  <th className="text-start px-2 py-2.5">{t('Details')}</th>
                  <th className="text-end px-2 py-2.5">{t('Debit')}</th>
                  <th className="text-end px-2 py-2.5">{t('Credit')}</th>
                  <th className="text-end ps-2 pe-6 py-2.5">{t('Balance')}</th>
                </tr>
              </thead>
              <tbody>
                {/* Opening balance line */}
                <tr className="border-b border-slate-50 dark:border-surface-800/60 text-slate-400 dark:text-slate-500">
                  <td className="ps-6 pe-2 py-2 whitespace-nowrap">{fmtDate(localStart)}</td>
                  <td className="px-2 py-2 italic">{t('Opening balance')}</td>
                  <td className="px-2 py-2"></td>
                  <td className="px-2 py-2"></td>
                  <td className="ps-2 pe-6 py-2 text-end font-mono tabular-nums">{fmtMoney(data.opening, sym)}</td>
                </tr>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 dark:border-surface-800/60 hover:bg-slate-50/70 dark:hover:bg-surface-800/40 transition-colors">
                    <td className="ps-6 pe-2 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400 align-top">{fmtDate(r.date)}</td>
                    <td className="px-2 py-2 align-top">
                      <div className="text-slate-700 dark:text-slate-200">{r.desc}</div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {r.ref && <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{r.ref}</span>}
                        {r.contra.slice(0, 3).map((c) => (
                          <button key={c.id} onClick={() => onOpenAccount && onOpenAccount(c.id)}
                            className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-surface-700/70 text-slate-500 dark:text-slate-300 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-500/15 dark:hover:text-brand-300 transition-colors">
                            {c.name}<ArrowRight size={10} />
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300 align-top">{r.dr > 0 ? fmtMoney(r.dr, sym) : ''}</td>
                    <td className="px-2 py-2 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300 align-top">{r.cr > 0 ? fmtMoney(r.cr, sym) : ''}</td>
                    <td className={`ps-2 pe-6 py-2 text-end font-mono tabular-nums font-semibold align-top ${r.balance >= 0 ? 'text-slate-800 dark:text-slate-100' : 'text-rose-600 dark:text-rose-400'}`}>{fmtMoney(r.balance, sym)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer totals */}
        <div className="border-t border-slate-100 dark:border-surface-750 bg-slate-50/70 dark:bg-surface-900/40 px-6 py-3.5 flex items-center justify-between">
          <div className="flex gap-6 text-sm">
            <span className="text-slate-400 dark:text-slate-500">{t('Total Debit')} <span className="font-mono tabular-nums text-slate-700 dark:text-slate-200 ms-1">{fmtMoney(data.totalDr, sym)}</span></span>
            <span className="text-slate-400 dark:text-slate-500">{t('Total Credit')} <span className="font-mono tabular-nums text-slate-700 dark:text-slate-200 ms-1">{fmtMoney(data.totalCr, sym)}</span></span>
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400">{t('Closing')} <span className={`font-mono tabular-nums font-bold ms-1 ${accent.text}`}>{fmtMoney(data.closing, sym)}</span></div>
        </div>
      </div>
    </div>,
    document.body
  )
}
