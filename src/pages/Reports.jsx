import { useState, useMemo } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { vatBreakdown } from '../utils/vat'
import { PageHeader, Card, Btn, Select, Input, Table, Tr, Td } from '../components/UI'
import { useT } from '../i18n'
import ExportMenu from '../components/ExportMenu'
import CustomReport from '../components/CustomReport'
import AccountLedgerModal from '../components/AccountLedgerModal'
import { ChevronRight } from 'lucide-react'
import { format, startOfYear, endOfYear } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts'

const REPORTS = [
  { id: 'pl', label: 'Income Statement (P&L)', group: 'Financial Statements' },
  { id: 'bs', label: 'Balance Sheet', group: 'Financial Statements' },
  { id: 'cf', label: 'Cash Flow Statement', group: 'Financial Statements' },
  { id: 'vat', label: 'VAT Return (ZATCA)', group: 'Financial Statements' },
  { id: 'tb', label: 'Trial Balance', group: 'Ledgers' },
  { id: 'gl', label: 'General Ledger', group: 'Ledgers' },
  { id: 'ar', label: 'Accounts Receivable Aging', group: 'Ledgers' },
  { id: 'ap', label: 'Accounts Payable Aging', group: 'Ledgers' },
  { id: 'sales-cust', label: 'Sales by Customer', group: 'Sales & Purchases' },
  { id: 'sales-item', label: 'Sales by Item', group: 'Sales & Purchases' },
  { id: 'purch-supp', label: 'Purchases by Supplier', group: 'Sales & Purchases' },
  { id: 'exp-cat', label: 'Expenses by Category', group: 'Sales & Purchases' },
  { id: 'budget-var', label: 'Budget vs Actual', group: 'Performance' },
  { id: 'pl-comp', label: 'Comparative P&L', group: 'Performance' },
  { id: 'dept-pl', label: 'Departmental P&L', group: 'Performance' },
  { id: 'custom', label: 'Custom Report Builder', group: 'Advanced' },
]

export default function Reports() {
  const { accounts, journalEntries, invoices, purchases, bankAccounts, customers, suppliers, inventoryItems, budgets, departments, getAllBalances, settings } = useStore()
  const t = useT()
  const sym = settings.company.currencySymbol
  const company = settings.company

  const thisYear = format(new Date(), 'yyyy')
  const [report, setReport] = useState('pl')
  const [startDate, setStartDate] = useState(`${thisYear}-01-01`)
  const [endDate, setEndDate] = useState(`${thisYear}-12-31`)
  // hoisted here (not inside GLReport) so it survives the parent's re-renders
  const [glAcc, setGlAcc] = useState('')
  // Drill-down: click any Balance Sheet / P&L line to open its Statement of Account.
  // mode 'period' → P&L (movements in the range); 'todate' → Balance Sheet (cumulative).
  const [drill, setDrill] = useState(null)
  const openDrill = (accountId, mode) => setDrill({ accountId, mode })
  const drillAccount = drill ? accounts.find((a) => a.id === drill.accountId) : null

  // One clickable Balance-Sheet / P&L line → drills into that ledger's Statement
  // of Account. Non-real (aggregate) rows like Retained Earnings pass clickable=false.
  const LedgerLine = ({ account, mode, clickable = true, indent = false }) => {
    const body = (
      <>
        <span className={`flex items-center gap-2 text-gray-600 dark:text-slate-300 ${indent ? 'ps-3' : ''}`}>
          {account.code && <span className="font-mono text-[11px] text-gray-400 dark:text-slate-500">{account.code}</span>}
          <span className="group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">{account.name}</span>
          {clickable && <ChevronRight size={13} className="opacity-0 group-hover:opacity-100 -ms-1 text-brand-400 transition-opacity print:hidden" />}
        </span>
        <span className="font-medium text-gray-800 dark:text-slate-100 tabular-nums">{fmtMoney(account.balance, sym)}</span>
      </>
    )
    if (!clickable)
      return <div className="group flex items-center justify-between px-3 py-1.5 rounded-lg text-sm">{body}</div>
    return (
      <button type="button" onClick={() => openDrill(account.id, mode)}
        className="group w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-sm text-start hover:bg-brand-50/50 dark:hover:bg-brand-500/[0.07] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40">
        {body}
      </button>
    )
  }

  const balances = useMemo(() => getAllBalances(startDate, endDate), [getAllBalances, startDate, endDate, journalEntries])
  const allBalances = useMemo(() => getAllBalances(), [getAllBalances, journalEntries])
  // cumulative balances as at the report end date — the correct basis for a
  // balance sheet (assets, liabilities, equity and retained earnings to date)
  const balancesToEnd = useMemo(() => getAllBalances(undefined, endDate), [getAllBalances, endDate, journalEntries])

  const accountBalance = (id, bals) => {
    const b = bals[id]
    if (!b) return 0
    const acc = accounts.find((a) => a.id === id)
    if (!acc) return 0
    return ['asset', 'expense'].includes(acc.type) ? b.dr - b.cr : b.cr - b.dr
  }

  // ─── P&L ───────────────────────────────────────────────────────────
  const PLReport = () => {
    const revenueAccs = accounts.filter((a) => a.type === 'revenue').map((a) => ({ ...a, balance: accountBalance(a.id, balances) })).filter((a) => a.balance !== 0)
    const expenseAccs = accounts.filter((a) => a.type === 'expense').map((a) => ({ ...a, balance: accountBalance(a.id, balances) })).filter((a) => a.balance !== 0)
    const totalRevenue = revenueAccs.reduce((s, a) => s + a.balance, 0)
    const totalExpenses = expenseAccs.reduce((s, a) => s + a.balance, 0)
    const netProfit = totalRevenue - totalExpenses

    return (
      <div className="space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-success-50 dark:bg-success-500/10 ring-1 ring-inset ring-success-600/10 dark:ring-success-400/15 rounded-xl p-4"><p className="text-sm text-success-600 dark:text-success-400">{t('Total Revenue')}</p><p className="text-2xl font-bold tracking-tightest tabular text-success-700 dark:text-success-300">{fmtMoney(totalRevenue, sym)}</p></div>
          <div className="bg-danger-50 dark:bg-danger-500/10 ring-1 ring-inset ring-danger-600/10 dark:ring-danger-400/15 rounded-xl p-4"><p className="text-sm text-danger-600 dark:text-danger-400">{t('Total Expenses')}</p><p className="text-2xl font-bold tracking-tightest tabular text-danger-700 dark:text-danger-300">{fmtMoney(totalExpenses, sym)}</p></div>
          <div className={`${netProfit >= 0 ? 'bg-brand-50 dark:bg-brand-500/10 ring-brand-600/10 dark:ring-brand-400/15' : 'bg-warning-50 dark:bg-warning-500/10 ring-warning-600/10 dark:ring-warning-400/15'} ring-1 ring-inset rounded-xl p-4`}>
            <p className={`text-sm ${netProfit >= 0 ? 'text-brand-600 dark:text-brand-400' : 'text-warning-600 dark:text-warning-400'}`}>Net {netProfit >= 0 ? 'Profit' : 'Loss'}</p>
            <p className={`text-2xl font-bold tracking-tightest tabular ${netProfit >= 0 ? 'text-brand-700 dark:text-brand-300' : 'text-warning-700 dark:text-warning-300'}`}>{fmtMoney(Math.abs(netProfit), sym)}</p>
          </div>
        </div>

        <Card className="overflow-hidden">
          <div className="p-6 border-b border-gray-100 dark:border-surface-750 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg tracking-tight">{company.name}</h3>
              <p className="text-sm text-gray-500 dark:text-slate-400">{t('Income Statement')} · {fmtDate(startDate)} — {fmtDate(endDate)}</p>
            </div>
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-surface-800 rounded-full px-2.5 py-1 print:hidden">
              <ChevronRight size={12} /> {t('Click any line for its ledger')}
            </span>
          </div>
          <div className="p-6">
            {/* Revenue */}
            <div className="flex items-center gap-2 mb-1"><span className="w-1.5 h-1.5 rounded-full bg-success-500" /><h4 className="font-bold text-success-700 dark:text-success-400 text-xs uppercase tracking-wider">{t('Revenue')}</h4></div>
            {revenueAccs.length === 0 ? <p className="text-gray-400 dark:text-slate-500 text-sm mb-4 ps-3.5">{t('No revenue for this period')}</p> : (
              <div className="mb-2">
                {revenueAccs.map((a) => <LedgerLine key={a.id} account={a} mode="period" />)}
                <div className="flex items-center justify-between mt-1 rounded-lg bg-success-50/60 dark:bg-success-500/[0.08] px-3 py-2">
                  <span className="font-bold text-success-800 dark:text-success-300 text-sm">{t('Total Revenue')}</span>
                  <span className="font-bold text-success-800 dark:text-success-300 tabular-nums">{fmtMoney(totalRevenue, sym)}</span>
                </div>
              </div>
            )}

            {/* Expenses */}
            <div className="flex items-center gap-2 mb-1 mt-6"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" /><h4 className="font-bold text-rose-700 dark:text-rose-400 text-xs uppercase tracking-wider">{t('Expenses')}</h4></div>
            {expenseAccs.length === 0 ? <p className="text-gray-400 dark:text-slate-500 text-sm mb-4 ps-3.5">{t('No expenses for this period')}</p> : (
              <div className="mb-2">
                {expenseAccs.map((a) => <LedgerLine key={a.id} account={a} mode="period" />)}
                <div className="flex items-center justify-between mt-1 rounded-lg bg-rose-50/60 dark:bg-rose-500/[0.08] px-3 py-2">
                  <span className="font-bold text-rose-800 dark:text-rose-300 text-sm">{t('Total Expenses')}</span>
                  <span className="font-bold text-rose-800 dark:text-rose-300 tabular-nums">{fmtMoney(totalExpenses, sym)}</span>
                </div>
              </div>
            )}

            {/* Net */}
            <div className="border-t-2 border-gray-200 dark:border-surface-700 mt-5 pt-4 flex justify-between items-center">
              <span className="text-lg font-black text-gray-900 dark:text-slate-100 tracking-tight">{t('Net')} {netProfit >= 0 ? t('Profit') : t('Loss')}</span>
              <span className={`text-2xl font-black tabular-nums tracking-tight ${netProfit >= 0 ? 'text-success-600 dark:text-success-400' : 'text-rose-600 dark:text-rose-400'}`}>{fmtMoney(Math.abs(netProfit), sym)}</span>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  // ─── Balance Sheet ──────────────────────────────────────────────
  const BSReport = () => {
    // as at the end date, cumulative from inception (not the selected period)
    const assetAccs = accounts.filter((a) => a.type === 'asset').map((a) => ({ ...a, balance: accountBalance(a.id, balancesToEnd) })).filter((a) => a.balance !== 0)
    const liabAccs = accounts.filter((a) => a.type === 'liability').map((a) => ({ ...a, balance: accountBalance(a.id, balancesToEnd) })).filter((a) => a.balance !== 0)
    const equityAccs = accounts.filter((a) => a.type === 'equity').map((a) => ({ ...a, balance: accountBalance(a.id, balancesToEnd) })).filter((a) => a.balance !== 0)

    const totalAssets = assetAccs.reduce((s, a) => s + a.balance, 0)
    const totalLiabs = liabAccs.reduce((s, a) => s + a.balance, 0)
    const totalEquity = equityAccs.reduce((s, a) => s + a.balance, 0)

    // Retained earnings = all net income from inception through the end date, so
    // Assets = Liabilities + Equity + Retained Earnings always holds.
    const netProfit = accounts.filter((a) => a.type === 'revenue').reduce((s, a) => s + accountBalance(a.id, balancesToEnd), 0)
                    - accounts.filter((a) => a.type === 'expense').reduce((s, a) => s + accountBalance(a.id, balancesToEnd), 0)
    const totalEquityAndProfit = totalEquity + netProfit

    const Section = ({ title, items, total, dot }) => (
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1.5"><span className={`w-1.5 h-1.5 rounded-full ${dot}`} /><h4 className="font-bold text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400">{title}</h4></div>
        {items.length === 0 && <p className="py-1.5 ps-3 text-gray-400 dark:text-slate-500 text-sm">—</p>}
        {items.map((a) => <LedgerLine key={a.id} account={a} mode="todate" clickable={a.id !== 'net'} indent />)}
        <div className="flex items-center justify-between border-t border-gray-200 dark:border-surface-700 mt-1.5 pt-2 px-3">
          <span className="font-bold text-gray-800 dark:text-slate-100 text-sm">{t('Total')} {title}</span>
          <span className="font-bold text-gray-800 dark:text-slate-100 tabular-nums">{fmtMoney(total, sym)}</span>
        </div>
      </div>
    )

    return (
      <Card className="overflow-hidden">
        <div className="p-6 border-b border-gray-100 dark:border-surface-750 flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg tracking-tight">{company.name}</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400">{t('Balance Sheet')} · {t('As at')} {fmtDate(endDate)}</p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-surface-800 rounded-full px-2.5 py-1 print:hidden">
            <ChevronRight size={12} /> {t('Click any line for its ledger')}
          </span>
        </div>
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-2">
          <div>
            <div className="flex items-center justify-between rounded-xl bg-brand-50/60 dark:bg-brand-500/[0.08] px-4 py-3 mb-4">
              <span className="text-sm font-bold text-brand-700 dark:text-brand-300 uppercase tracking-wide">{t('Total Assets')}</span>
              <span className="text-lg font-black text-brand-700 dark:text-brand-300 tabular-nums">{fmtMoney(totalAssets, sym)}</span>
            </div>
            <Section title="Assets" items={assetAccs} total={totalAssets} dot="bg-brand-500" />
          </div>
          <div>
            <div className={`flex items-center justify-between rounded-xl px-4 py-3 mb-4 ${Math.abs(totalAssets - (totalLiabs + totalEquityAndProfit)) < 0.01 ? 'bg-success-50/60 dark:bg-success-500/[0.08]' : 'bg-rose-50/60 dark:bg-rose-500/[0.08]'}`}>
              <span className={`text-sm font-bold uppercase tracking-wide ${Math.abs(totalAssets - (totalLiabs + totalEquityAndProfit)) < 0.01 ? 'text-success-700 dark:text-success-300' : 'text-rose-700 dark:text-rose-300'}`}>{t('Liabilities + Equity')}</span>
              <span className={`text-lg font-black tabular-nums ${Math.abs(totalAssets - (totalLiabs + totalEquityAndProfit)) < 0.01 ? 'text-success-700 dark:text-success-300' : 'text-rose-600 dark:text-rose-400'}`}>{fmtMoney(totalLiabs + totalEquityAndProfit, sym)}</span>
            </div>
            <Section title="Liabilities" items={liabAccs} total={totalLiabs} dot="bg-orange-500" />
            <Section title="Equity" items={[...equityAccs, netProfit !== 0 && { id: 'net', code: '', name: t('Retained Earnings (to date)'), balance: netProfit }].filter(Boolean)} total={totalEquityAndProfit} dot="bg-violet-500" />
            {Math.abs(totalAssets - (totalLiabs + totalEquityAndProfit)) > 0.01 && (
              <p className="text-xs text-rose-500 dark:text-rose-400 mt-1 flex items-center gap-1">⚠ {t('Balance sheet is out of balance by')} {fmtMoney(Math.abs(totalAssets - (totalLiabs + totalEquityAndProfit)), sym)}</p>
            )}
          </div>
        </div>
      </Card>
    )
  }

  // ─── Trial Balance ─────────────────────────────────────────────
  const TBReport = () => {
    const rows = accounts.map((a) => {
      const b = allBalances[a.id] || { dr: 0, cr: 0 }
      return { ...a, drRaw: b.dr, crRaw: b.cr, netDr: b.dr > b.cr ? b.dr - b.cr : 0, netCr: b.cr > b.dr ? b.cr - b.dr : 0 }
    }).filter((r) => r.drRaw > 0 || r.crRaw > 0)

    const totalNetDr = rows.reduce((s, r) => s + r.netDr, 0)
    const totalNetCr = rows.reduce((s, r) => s + r.netCr, 0)

    return (
      <Card>
        <div className="p-6 border-b border-gray-100 dark:border-surface-750">
          <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name}</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">Trial Balance as at {fmtDate(endDate)}</p>
        </div>
        <div className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 dark:bg-surface-900/40">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Code</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Account</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Debit</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Credit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 dark:border-surface-800">
                  <td className="px-6 py-2 font-mono text-gray-500 dark:text-slate-400 text-xs">{r.code}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-slate-200">{r.name}</td>
                  <td className="px-4 py-2 text-right font-mono text-gray-800 dark:text-slate-100">{r.netDr > 0 ? fmtMoney(r.netDr, sym) : ''}</td>
                  <td className="px-4 py-2 text-right font-mono text-gray-800 dark:text-slate-100">{r.netCr > 0 ? fmtMoney(r.netCr, sym) : ''}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300 dark:border-surface-600 bg-gray-50 dark:bg-surface-800/60 font-bold">
                <td className="px-6 py-3" colSpan={2}>TOTALS</td>
                <td className={`px-4 py-3 text-right font-mono ${Math.abs(totalNetDr - totalNetCr) < 0.01 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(totalNetDr, sym)}</td>
                <td className={`px-4 py-3 text-right font-mono ${Math.abs(totalNetDr - totalNetCr) < 0.01 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(totalNetCr, sym)}</td>
              </tr>
            </tbody>
          </table>
          {Math.abs(totalNetDr - totalNetCr) < 0.01 && (
            <p className="px-6 py-3 text-xs text-green-600 dark:text-green-400 font-medium">✓ Trial balance is balanced</p>
          )}
        </div>
      </Card>
    )
  }

  // ─── General Ledger ───────────────────────────────────────────
  const GLReport = () => {
    const selectedAcc = glAcc || accounts[0]?.id || ''
    const setSelectedAcc = setGlAcc
    const acc = accounts.find((a) => a.id === selectedAcc)

    const lines = []
    let running = 0
    const filtered = journalEntries
      .filter((je) => je.date >= startDate && je.date <= endDate && je.lines.some((l) => l.accountId === selectedAcc))
      .sort((a, b) => a.date.localeCompare(b.date))

    filtered.forEach((je) => {
      je.lines.filter((l) => l.accountId === selectedAcc).forEach((l) => {
        const dr = l.debit || 0
        const cr = l.credit || 0
        if (['asset', 'expense'].includes(acc?.type)) running += dr - cr
        else running += cr - dr
        lines.push({ date: je.date, desc: je.description, ref: je.number, dr, cr, running })
      })
    })

    return (
      <Card>
        <div className="p-6 border-b border-gray-100 dark:border-surface-750 flex items-center gap-4">
          <div>
            <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name} — General Ledger</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400">{fmtDate(startDate)} to {fmtDate(endDate)}</p>
          </div>
          <div className="ml-auto w-72">
            <Select value={selectedAcc} onChange={(e) => setSelectedAcc(e.target.value)}>
              {['asset', 'liability', 'equity', 'revenue', 'expense'].map((type) => (
                <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>
                  {accounts.filter((a) => a.type === type).map((a) => (
                    <option key={a.id} value={a.id}>{a.code} – {a.name}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 dark:bg-surface-900/40">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Date</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Description')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Ref</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Debit</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Credit</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Balance')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400 dark:text-slate-500 text-sm">{t('No transactions for this account in the selected period')}</td></tr>}
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-gray-50 dark:border-surface-800">
                <td className="px-6 py-2 text-gray-500 dark:text-slate-400">{fmtDate(l.date)}</td>
                <td className="px-4 py-2 text-gray-700 dark:text-slate-200">{l.desc}</td>
                <td className="px-4 py-2 text-gray-400 dark:text-slate-500 text-xs font-mono">{l.ref}</td>
                <td className="px-4 py-2 text-right font-mono text-gray-700 dark:text-slate-200">{l.dr > 0 ? fmtMoney(l.dr, sym) : ''}</td>
                <td className="px-4 py-2 text-right font-mono text-gray-700 dark:text-slate-200">{l.cr > 0 ? fmtMoney(l.cr, sym) : ''}</td>
                <td className={`px-4 py-2 text-right font-mono font-semibold ${l.running >= 0 ? 'text-gray-800 dark:text-slate-100' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(l.running, sym)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    )
  }

  // ─── AR Aging ─────────────────────────────────────────────────
  const ARReport = () => {
    const todayStr = new Date().toISOString().slice(0, 10)
    const unpaid = invoices.filter((i) => i.status !== 'paid' && i.status !== 'cancelled' && i.status !== 'void' && i.amountPaid < i.total)

    const buckets = { current: [], days30: [], days60: [], days90: [], over90: [] }
    unpaid.forEach((inv) => {
      const due = inv.dueDate || inv.date
      const days = Math.floor((new Date(todayStr) - new Date(due)) / 86400000)
      const amt = inv.total - inv.amountPaid
      if (days <= 0) buckets.current.push({ ...inv, days, amt })
      else if (days <= 30) buckets.days30.push({ ...inv, days, amt })
      else if (days <= 60) buckets.days60.push({ ...inv, days, amt })
      else if (days <= 90) buckets.days90.push({ ...inv, days, amt })
      else buckets.over90.push({ ...inv, days, amt })
    })

    const bucketTotals = {
      current: buckets.current.reduce((s, i) => s + i.amt, 0),
      days30: buckets.days30.reduce((s, i) => s + i.amt, 0),
      days60: buckets.days60.reduce((s, i) => s + i.amt, 0),
      days90: buckets.days90.reduce((s, i) => s + i.amt, 0),
      over90: buckets.over90.reduce((s, i) => s + i.amt, 0),
    }
    const grandTotal = Object.values(bucketTotals).reduce((s, v) => s + v, 0)

    const BucketSection = ({ label, items, color }) => (
      items.length > 0 && (
        <div className="mb-4">
          <h4 className={`font-semibold text-sm mb-2 ${color}`}>{label}</h4>
          {items.map((inv) => (
            <div key={inv.id} className="flex justify-between items-center text-sm py-1.5 border-b border-gray-50 dark:border-surface-800">
              <div className="flex gap-4">
                <span className="font-mono text-gray-400 dark:text-slate-500 text-xs w-20">{inv.number}</span>
                <span className="text-gray-700 dark:text-slate-200">{inv.customerName}</span>
                <span className="text-gray-400 dark:text-slate-500 text-xs">{fmtDate(inv.dueDate)}</span>
              </div>
              <span className={`font-semibold ${color}`}>{fmtMoney(inv.amt, sym)}</span>
            </div>
          ))}
        </div>
      )
    )

    return (
      <Card>
        <div className="p-6 border-b border-gray-100 dark:border-surface-750">
          <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name}</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">Accounts Receivable Aging as at {fmtDate(todayStr)}</p>
        </div>
        {/* Summary bar */}
        <div className="grid grid-cols-5 divide-x divide-gray-100 dark:divide-surface-800 border-b border-gray-100 dark:border-surface-750">
          {[
            { label: 'Current', val: bucketTotals.current, color: 'text-green-600' },
            { label: '1–30 Days', val: bucketTotals.days30, color: 'text-yellow-600' },
            { label: '31–60 Days', val: bucketTotals.days60, color: 'text-orange-600' },
            { label: '61–90 Days', val: bucketTotals.days90, color: 'text-red-600' },
            { label: '90+ Days', val: bucketTotals.over90, color: 'text-red-800' },
          ].map((b) => (
            <div key={b.label} className="p-4 text-center">
              <p className="text-xs text-gray-400 dark:text-slate-500">{b.label}</p>
              <p className={`font-bold text-base ${b.color}`}>{fmtMoney(b.val, sym)}</p>
            </div>
          ))}
        </div>
        <div className="p-6">
          {unpaid.length === 0 ? <p className="text-gray-400 dark:text-slate-500 text-center py-8">All invoices are paid!</p> : (
            <>
              <BucketSection label="Current (not yet due)" items={buckets.current} color="text-green-700" />
              <BucketSection label="1–30 Days Overdue" items={buckets.days30} color="text-yellow-700" />
              <BucketSection label="31–60 Days Overdue" items={buckets.days60} color="text-orange-700" />
              <BucketSection label="61–90 Days Overdue" items={buckets.days90} color="text-red-600" />
              <BucketSection label="90+ Days Overdue" items={buckets.over90} color="text-red-800" />
              <div className="flex justify-between font-bold text-base border-t-2 border-gray-300 dark:border-surface-600 pt-3 mt-4">
                <span>{t('Total Outstanding')}</span>
                <span className="text-gray-900 dark:text-slate-100">{fmtMoney(grandTotal, sym)}</span>
              </div>
            </>
          )}
        </div>
      </Card>
    )
  }

  // ─── AP Aging ─────────────────────────────────────────────────
  const APReport = () => {
    const todayStr = new Date().toISOString().slice(0, 10)
    const unpaid = purchases.filter((p) => p.status !== 'paid' && p.status !== 'cancelled' && p.status !== 'void' && p.amountPaid < p.total)

    const rows = unpaid.map((p) => {
      const due = p.dueDate || p.date
      const days = Math.floor((new Date(todayStr) - new Date(due)) / 86400000)
      return { ...p, days, amt: p.total - p.amountPaid }
    }).sort((a, b) => b.days - a.days)

    const total = rows.reduce((s, r) => s + r.amt, 0)

    return (
      <Card>
        <div className="p-6 border-b border-gray-100 dark:border-surface-750">
          <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name}</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">Accounts Payable Aging as at {fmtDate(todayStr)}</p>
        </div>
        <div className="p-6">
          {rows.length === 0 ? <p className="text-gray-400 dark:text-slate-500 text-center py-8">No outstanding payables!</p> : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase border-b border-gray-100 dark:border-surface-750">
                    <th className="text-left pb-2">Purchase #</th>
                    <th className="text-left pb-2">{t('Supplier')}</th>
                    <th className="text-left pb-2">{t('Due Date')}</th>
                    <th className="text-right pb-2">{t('Days Overdue')}</th>
                    <th className="text-right pb-2">{t('Balance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-b border-gray-50 dark:border-surface-800">
                      <td className="py-2 font-mono text-orange-600 dark:text-orange-400 text-xs">{p.number}</td>
                      <td className="py-2 text-gray-700 dark:text-slate-200">{p.supplierName}</td>
                      <td className="py-2 text-gray-500 dark:text-slate-400">{fmtDate(p.dueDate)}</td>
                      <td className="py-2 text-right">
                        <span className={p.days > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-green-600 dark:text-green-400'}>
                          {p.days > 0 ? `${p.days} days` : 'Not due'}
                        </span>
                      </td>
                      <td className="py-2 text-right font-semibold text-gray-800 dark:text-slate-100">{fmtMoney(p.amt, sym)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-between font-bold text-base border-t-2 border-gray-300 dark:border-surface-600 pt-3 mt-4">
                <span>{t('Total Payable')}</span>
                <span className="text-gray-900 dark:text-slate-100">{fmtMoney(total, sym)}</span>
              </div>
            </>
          )}
        </div>
      </Card>
    )
  }

  // ─── Cash Flow Statement (direct, ledger-accurate) ────────────
  const CFReport = () => {
    const cashAccIds = new Set(bankAccounts.map((b) => b.accountId))
    const accById = Object.fromEntries(accounts.map((a) => [a.id, a]))
    // Classify each cash movement by its counter-accounts (investing = long-term
    // assets, financing = equity / long-term debt, otherwise operating).
    const classify = (je) => {
      if (['fixed_asset', 'asset_disposal'].includes(je.type)) return 'investing'
      if (['loan', 'capital', 'drawings', 'financing'].includes(je.type)) return 'financing'
      let investing = false, financing = false
      je.lines.filter((l) => !cashAccIds.has(l.accountId)).forEach((l) => {
        const a = accById[l.accountId]
        if (!a) return
        if (a.type === 'equity') financing = true
        else if (a.type === 'liability' && a.subtype === 'non_current') financing = true
        else if (a.id === 'acc-fixed' || (a.type === 'asset' && a.subtype === 'non_current')) investing = true
      })
      return financing ? 'financing' : investing ? 'investing' : 'operating'
    }
    let opening = 0
    const cats = { operating: [], investing: [], financing: [] }
    journalEntries.forEach((je) => {
      const delta = je.lines.filter((l) => cashAccIds.has(l.accountId)).reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0)
      if (delta === 0) return
      if (je.date < startDate) { opening += delta; return }
      if (je.date > endDate) return
      cats[classify(je)].push({ date: je.date, desc: je.description, ref: je.number, amount: delta })
    })
    const catTotal = (c) => cats[c].reduce((s, x) => s + x.amount, 0)
    const net = catTotal('operating') + catTotal('investing') + catTotal('financing')
    const closing = opening + net

    const Group = ({ title, items, total, color }) => (
      <div className="mb-5">
        <h4 className={`font-bold text-sm uppercase tracking-wide mb-2 ${color}`}>{title}</h4>
        <table className="w-full text-sm">
          <tbody>
            {items.length === 0 && <tr><td className="py-1.5 pl-3 text-gray-400 dark:text-slate-500 text-sm">{t('No activity')}</td></tr>}
            {items.map((x, i) => (
              <tr key={i} className="border-b border-gray-50 dark:border-slate-700/50">
                <td className="py-1.5 pl-3 text-gray-500 dark:text-slate-400 text-xs w-24">{fmtDate(x.date)}</td>
                <td className="py-1.5 text-gray-600 dark:text-slate-300">{x.desc}</td>
                <td className={`py-1.5 text-right font-medium ${x.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{fmtMoney(x.amount, sym)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 dark:border-slate-600">
              <td colSpan={2} className="py-2 pl-3 font-bold text-gray-800 dark:text-slate-100">Net Cash from {title}</td>
              <td className={`py-2 text-right font-bold ${total >= 0 ? 'text-gray-800 dark:text-slate-100' : 'text-red-600'}`}>{fmtMoney(total, sym)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    )

    return (
      <Card>
        <div className="p-6 border-b border-gray-100 dark:border-slate-700">
          <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name}</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">Cash Flow Statement for {fmtDate(startDate)} to {fmtDate(endDate)}</p>
        </div>
        <div className="p-6">
          <div className="flex justify-between text-sm mb-4 pb-3 border-b border-gray-100 dark:border-slate-700">
            <span className="font-semibold text-gray-700 dark:text-slate-200">Opening Cash &amp; Bank Balance</span>
            <span className="font-bold text-gray-800 dark:text-slate-100">{fmtMoney(opening, sym)}</span>
          </div>
          <Group title="Operating Activities" items={cats.operating} total={catTotal('operating')} color="text-blue-700 dark:text-blue-400" />
          <Group title="Investing Activities" items={cats.investing} total={catTotal('investing')} color="text-purple-700 dark:text-purple-400" />
          <Group title="Financing Activities" items={cats.financing} total={catTotal('financing')} color="text-orange-700 dark:text-orange-400" />
          <div className="flex justify-between text-base border-t-2 border-gray-300 dark:border-slate-600 pt-3 mt-2">
            <span className="font-bold text-gray-900 dark:text-slate-100">{t('Net Change in Cash')}</span>
            <span className={`font-bold ${net >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600'}`}>{fmtMoney(net, sym)}</span>
          </div>
          <div className="flex justify-between text-base border-t-4 border-gray-800 dark:border-slate-400 pt-3 mt-3">
            <span className="font-black text-gray-900 dark:text-slate-100">Closing Cash &amp; Bank Balance</span>
            <span className="font-black text-gray-900 dark:text-slate-100">{fmtMoney(closing, sym)}</span>
          </div>
        </div>
      </Card>
    )
  }

  // ─── VAT Return (ZATCA / KSA) ─────────────────────────────────
  const VATReport = () => {
    const inRange = (d) => d && d >= startDate && d <= endDate
    const salesDocs = invoices.filter((i) => i.status !== 'cancelled' && i.status !== 'void' && inRange(i.date))
    const purchDocs = purchases.filter((p) => p.status !== 'cancelled' && p.status !== 'void' && inRange(p.date))
    const sales = vatBreakdown(salesDocs)
    const purch = vatBreakdown(purchDocs)
    const outputVat = accountBalance('acc-vatout', balances)
    const inputVat = accountBalance('acc-vatin', balances)
    const netVat = outputVat - inputVat

    const Row = ({ n, label, ar, amount, bold, strong }) => (
      <tr className={`border-b border-gray-100 dark:border-slate-700/50 ${strong ? 'bg-gray-50 dark:bg-slate-800/60' : ''}`}>
        <td className="px-4 py-2.5 text-gray-400 dark:text-slate-500 text-xs w-10">{n}</td>
        <td className={`px-2 py-2.5 ${bold ? 'font-bold text-gray-900 dark:text-slate-100' : 'text-gray-700 dark:text-slate-200'}`}>
          {label}<span className="block text-xs text-gray-400 dark:text-slate-500" dir="rtl">{ar}</span>
        </td>
        <td className={`px-4 py-2.5 text-right font-mono ${bold ? 'font-bold text-gray-900 dark:text-slate-100' : 'text-gray-700 dark:text-slate-200'}`}>{fmtMoney(amount, sym)}</td>
      </tr>
    )

    return (
      <Card>
        <div className="p-6 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name}</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400">VAT Return · إقرار ضريبة القيمة المضافة — {fmtDate(startDate)} to {fmtDate(endDate)}</p>
          </div>
          <div className="text-right text-xs text-gray-400 dark:text-slate-500">
            {settings.zatca?.vatNumber && <p>VAT No: {settings.zatca.vatNumber}</p>}
            <p>Rate: {settings.tax?.rate ?? 15}%</p>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-800/60">
            <tr className="text-xs text-gray-400 dark:text-slate-500 uppercase">
              <th className="px-4 py-2 text-left">#</th>
              <th className="px-2 py-2 text-left">{t('Description')}</th>
              <th className="px-4 py-2 text-right">Amount ({sym})</th>
            </tr>
          </thead>
          <tbody>
            <Row n="1" label="Standard rated sales" ar="المبيعات الخاضعة للنسبة الأساسية" amount={sales.standard} />
            <Row n="2" label="Output VAT" ar="ضريبة المخرجات" amount={outputVat} bold />
            <Row n="3" label="Zero-rated sales" ar="مبيعات خاضعة لنسبة صفرية" amount={sales.zero} />
            <Row n="4" label="Exempt sales" ar="مبيعات معفاة" amount={sales.exempt} />
            <Row n="5" label="Standard rated purchases" ar="المشتريات الخاضعة للضريبة" amount={purch.standard} />
            <Row n="6" label="Input VAT (recoverable)" ar="ضريبة المدخلات" amount={inputVat} bold />
            <Row n="7" label="Net VAT due / (reclaimable)" ar="صافي الضريبة المستحقة" amount={netVat} bold strong />
          </tbody>
        </table>
        <div className={`p-5 flex items-center justify-between ${netVat >= 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-green-50 dark:bg-green-900/20'}`}>
          <span className="font-bold text-gray-800 dark:text-slate-100">{netVat >= 0 ? 'VAT Payable to ZATCA' : 'VAT Reclaimable from ZATCA'}</span>
          <span className={`text-xl font-black ${netVat >= 0 ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}>{fmtMoney(Math.abs(netVat), sym)}</span>
        </div>
      </Card>
    )
  }

  // ─── Analytical reports (Sales/Purchases/Expenses) ───────────────
  const inRange = (d) => (!startDate || d >= startDate) && (!endDate || d <= endDate)

  const salesByCustomer = useMemo(() => {
    const map = {}
    invoices.filter((i) => i.status !== 'cancelled' && i.status !== 'void' && inRange(i.date)).forEach((i) => {
      const key = i.customerName || 'Walk-in Customer'
      const m = map[key] || (map[key] = { customer: key, count: 0, subtotal: 0, tax: 0, total: 0, paid: 0, balance: 0 })
      m.count += 1; m.subtotal += i.subtotal || 0; m.tax += i.taxAmount || 0
      m.total += i.total || 0; m.paid += i.amountPaid || 0; m.balance += (i.total || 0) - (i.amountPaid || 0)
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [invoices, startDate, endDate])

  const salesByItem = useMemo(() => {
    const map = {}
    invoices.filter((i) => i.status !== 'cancelled' && i.status !== 'void' && inRange(i.date)).forEach((i) => {
      (i.items || []).forEach((it) => {
        const key = it.itemId || it.description || 'Item'
        const name = it.description || (inventoryItems.find((x) => x.id === it.itemId)?.name) || 'Item'
        const m = map[key] || (map[key] = { item: name, qty: 0, revenue: 0 })
        m.qty += parseFloat(it.quantity) || 0
        m.revenue += it.subtotal != null ? it.subtotal : (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0)
      })
    })
    return Object.values(map).sort((a, b) => b.revenue - a.revenue)
  }, [invoices, inventoryItems, startDate, endDate])

  const purchasesBySupplier = useMemo(() => {
    const map = {}
    purchases.filter((p) => p.status !== 'cancelled' && p.status !== 'void' && inRange(p.date)).forEach((p) => {
      const key = p.supplierName || 'Unknown Supplier'
      const m = map[key] || (map[key] = { supplier: key, count: 0, total: 0, paid: 0, balance: 0 })
      m.count += 1; m.total += p.total || 0; m.paid += p.amountPaid || 0; m.balance += (p.total || 0) - (p.amountPaid || 0)
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [purchases, startDate, endDate])

  const expenseByCategory = useMemo(() => {
    const rows = accounts.filter((a) => a.type === 'expense')
      .map((a) => ({ category: `${a.code} – ${a.name}`, amount: accountBalance(a.id, balances) }))
      .filter((r) => Math.abs(r.amount) > 0.001)
      .sort((a, b) => b.amount - a.amount)
    const total = rows.reduce((s, r) => s + r.amount, 0)
    return { rows, total }
  }, [accounts, balances])

  const AnalyticalReport = ({ title, headers, rows, totalsRow, chartData }) => (
    <Card>
      <div className="p-6 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name}</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">{t(title)} · {fmtDate(startDate)} — {fmtDate(endDate)}</p>
        </div>
      </div>
      {chartData && chartData.length > 0 && (
        <div className="p-6 pb-0" style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData.slice(0, 10)} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => fmtMoney(v, sym)} />
              <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="p-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400">
              {headers.map((h, i) => <th key={i} className={`py-2 ${i === 0 ? 'text-start' : 'text-end'} font-semibold`}>{t(h)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={headers.length} className="py-6 text-center text-gray-400 dark:text-slate-500">{t('No data for this period')}</td></tr>}
            {rows.map((r, ri) => (
              <tr key={ri} className="border-b border-gray-50 dark:border-slate-700/50">
                {r.map((c, ci) => <td key={ci} className={`py-1.5 ${ci === 0 ? 'text-start text-gray-700 dark:text-slate-200' : 'text-end font-medium text-gray-800 dark:text-slate-100'}`}>{c}</td>)}
              </tr>
            ))}
            {totalsRow && (
              <tr className="border-t-2 border-gray-300 dark:border-slate-500 bg-gray-50/60 dark:bg-slate-700/40 font-bold">
                {totalsRow.map((c, ci) => <td key={ci} className={`py-2 ${ci === 0 ? 'text-start' : 'text-end'} text-gray-900 dark:text-slate-100`}>{c}</td>)}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )

  const SalesByCustomerReport = () => (
    <AnalyticalReport title="Sales by Customer"
      headers={['Customer', 'Invoices', 'Subtotal', 'Tax', 'Total', 'Paid', 'Outstanding']}
      chartData={salesByCustomer.map((r) => ({ name: r.customer, value: r.total }))}
      rows={salesByCustomer.map((r) => [r.customer, r.count, fmtMoney(r.subtotal, sym), fmtMoney(r.tax, sym), fmtMoney(r.total, sym), fmtMoney(r.paid, sym), fmtMoney(r.balance, sym)])}
      totalsRow={['Total', salesByCustomer.reduce((s, r) => s + r.count, 0),
        fmtMoney(salesByCustomer.reduce((s, r) => s + r.subtotal, 0), sym),
        fmtMoney(salesByCustomer.reduce((s, r) => s + r.tax, 0), sym),
        fmtMoney(salesByCustomer.reduce((s, r) => s + r.total, 0), sym),
        fmtMoney(salesByCustomer.reduce((s, r) => s + r.paid, 0), sym),
        fmtMoney(salesByCustomer.reduce((s, r) => s + r.balance, 0), sym)]} />
  )

  const SalesByItemReport = () => (
    <AnalyticalReport title="Sales by Item"
      headers={['Item', 'Qty Sold', 'Revenue']}
      chartData={salesByItem.map((r) => ({ name: r.item, value: r.revenue }))}
      rows={salesByItem.map((r) => [r.item, r.qty, fmtMoney(r.revenue, sym)])}
      totalsRow={['Total', salesByItem.reduce((s, r) => s + r.qty, 0), fmtMoney(salesByItem.reduce((s, r) => s + r.revenue, 0), sym)]} />
  )

  const PurchasesBySupplierReport = () => (
    <AnalyticalReport title="Purchases by Supplier"
      headers={['Supplier', 'Bills', 'Total', 'Paid', 'Outstanding']}
      chartData={purchasesBySupplier.map((r) => ({ name: r.supplier, value: r.total }))}
      rows={purchasesBySupplier.map((r) => [r.supplier, r.count, fmtMoney(r.total, sym), fmtMoney(r.paid, sym), fmtMoney(r.balance, sym)])}
      totalsRow={['Total', purchasesBySupplier.reduce((s, r) => s + r.count, 0),
        fmtMoney(purchasesBySupplier.reduce((s, r) => s + r.total, 0), sym),
        fmtMoney(purchasesBySupplier.reduce((s, r) => s + r.paid, 0), sym),
        fmtMoney(purchasesBySupplier.reduce((s, r) => s + r.balance, 0), sym)]} />
  )

  const ExpenseByCategoryReport = () => (
    <AnalyticalReport title="Expenses by Category"
      headers={['Category', 'Amount', '% of Total']}
      chartData={expenseByCategory.rows.map((r) => ({ name: r.category.split(' – ')[1] || r.category, value: r.amount }))}
      rows={expenseByCategory.rows.map((r) => [r.category, fmtMoney(r.amount, sym), expenseByCategory.total ? `${(r.amount / expenseByCategory.total * 100).toFixed(1)}%` : '—'])}
      totalsRow={['Total Expenses', fmtMoney(expenseByCategory.total, sym), '100%']} />
  )

  // ─── Budget vs Actual (annual budget pro-rated to the period) ────
  const budgetVar = useMemo(() => {
    const yr = (endDate || `${thisYear}-12-31`).slice(0, 4)
    const yStart = new Date(`${yr}-01-01`), yEnd = new Date(`${yr}-12-31`)
    const clampedStart = startDate && startDate > `${yr}-01-01` ? startDate : `${yr}-01-01`
    const clampedEnd = endDate && endDate < `${yr}-12-31` ? endDate : `${yr}-12-31`
    const yearDays = (yEnd - yStart) / 86400000 + 1
    const periodDays = Math.max(0, (new Date(clampedEnd) - new Date(clampedStart)) / 86400000 + 1)
    const fraction = Math.min(1, periodDays / yearDays)
    const budgetOf = (id) => (budgets.find((b) => b.accountId === id && b.year === yr)?.amount || 0) * fraction

    const build = (type) => accounts.filter((a) => a.type === type).map((a) => {
      const budget = Math.round(budgetOf(a.id) * 100) / 100
      const actual = accountBalance(a.id, balances)
      // favorable: revenue over budget, or expense under budget
      const variance = type === 'revenue' ? actual - budget : budget - actual
      return { id: a.id, code: a.code, name: a.name, type, budget, actual, variance, pct: budget ? (actual / budget) * 100 : 0 }
    }).filter((r) => r.budget || Math.abs(r.actual) > 0.001)

    const revenue = build('revenue'), expense = build('expense')
    const sum = (arr, k) => arr.reduce((s, r) => s + r[k], 0)
    return { fraction, revenue, expense,
      totals: { budRev: sum(revenue, 'budget'), actRev: sum(revenue, 'actual'),
                budExp: sum(expense, 'budget'), actExp: sum(expense, 'actual') } }
  }, [accounts, budgets, balances, startDate, endDate, thisYear])

  const BudgetVarReport = () => {
    const { revenue, expense, totals, fraction } = budgetVar
    const netBudget = totals.budRev - totals.budExp
    const netActual = totals.actRev - totals.actExp
    const Section = ({ title, data, favHigh }) => (
      <div className="mb-6">
        <h4 className="font-bold text-sm uppercase tracking-wide mb-2 text-gray-600 dark:text-slate-300">{t(title)}</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-slate-600 text-gray-400 dark:text-slate-500 text-xs uppercase">
              <th className="py-1.5 text-start font-semibold">{t('Account')}</th>
              <th className="py-1.5 text-end font-semibold">{t('Budget')}</th>
              <th className="py-1.5 text-end font-semibold">{t('Actual')}</th>
              <th className="py-1.5 text-end font-semibold">{t('Variance')}</th>
              <th className="py-1.5 text-end font-semibold">%</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && <tr><td colSpan={5} className="py-3 text-center text-gray-400 dark:text-slate-500">{t('No data for this period')}</td></tr>}
            {data.map((r) => (
              <tr key={r.id} className="border-b border-gray-50 dark:border-slate-700/50">
                <td className="py-1.5 text-gray-700 dark:text-slate-200"><span className="font-mono text-xs text-gray-400 me-2">{r.code}</span>{r.name}</td>
                <td className="py-1.5 text-end text-gray-600 dark:text-slate-300">{fmtMoney(r.budget, sym)}</td>
                <td className="py-1.5 text-end font-medium text-gray-800 dark:text-slate-100">{fmtMoney(r.actual, sym)}</td>
                <td className={`py-1.5 text-end font-semibold ${r.variance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{r.variance >= 0 ? '' : '('}{fmtMoney(Math.abs(r.variance), sym)}{r.variance >= 0 ? '' : ')'}</td>
                <td className="py-1.5 text-end text-gray-500 dark:text-slate-400">{r.budget ? `${r.pct.toFixed(0)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
    return (
      <Card>
        <div className="p-6 border-b border-gray-100 dark:border-slate-700">
          <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name}</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">{t('Budget vs Actual')} · {fmtDate(startDate)} — {fmtDate(endDate)}
            {fraction < 0.999 && <span className="ms-1 text-xs">({t('budget pro-rated to')} {(fraction * 100).toFixed(0)}%)</span>}
          </p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-xl p-4"><p className="text-xs text-indigo-600 dark:text-indigo-300">{t('Net Budgeted')}</p><p className="text-xl font-bold text-indigo-700 dark:text-indigo-200">{fmtMoney(netBudget, sym)}</p></div>
            <div className={`${netActual >= 0 ? 'bg-green-50 dark:bg-green-900/30' : 'bg-red-50 dark:bg-red-900/30'} rounded-xl p-4`}><p className="text-xs text-gray-500 dark:text-slate-400">{t('Net Actual')}</p><p className={`text-xl font-bold ${netActual >= 0 ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>{fmtMoney(netActual, sym)}</p></div>
            <div className={`${(netActual - netBudget) >= 0 ? 'bg-green-50 dark:bg-green-900/30' : 'bg-amber-50 dark:bg-amber-900/30'} rounded-xl p-4`}><p className="text-xs text-gray-500 dark:text-slate-400">{t('Net Variance')}</p><p className={`text-xl font-bold ${(netActual - netBudget) >= 0 ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>{fmtMoney(netActual - netBudget, sym)}</p></div>
          </div>
          <Section title="Revenue" data={revenue} favHigh />
          <Section title="Expenses" data={expense} />
        </div>
      </Card>
    )
  }

  // ─── Comparative P&L (current period vs the preceding equal period) ──
  const plComparative = useMemo(() => {
    const s = new Date(startDate), e = new Date(endDate)
    const lenDays = Math.max(1, Math.round((e - s) / 86400000) + 1)
    const priorEnd = new Date(s.getTime() - 86400000)
    const priorStart = new Date(priorEnd.getTime() - (lenDays - 1) * 86400000)
    const iso = (d) => d.toISOString().slice(0, 10)
    const priorBals = getAllBalances(iso(priorStart), iso(priorEnd))
    const build = (type) => accounts.filter((a) => a.type === type).map((a) => {
      const cur = accountBalance(a.id, balances)
      const prev = accountBalance(a.id, priorBals)
      return { id: a.id, name: `${a.code} ${a.name}`, cur, prev, delta: cur - prev, pct: prev ? ((cur - prev) / Math.abs(prev)) * 100 : null }
    }).filter((r) => Math.abs(r.cur) > 0.001 || Math.abs(r.prev) > 0.001)
    return { priorLabel: `${iso(priorStart)} — ${iso(priorEnd)}`, revenue: build('revenue'), expense: build('expense') }
  }, [accounts, balances, startDate, endDate])

  const ComparativePLReport = () => {
    const { revenue, expense, priorLabel } = plComparative
    const sum = (arr, k) => arr.reduce((s, r) => s + r[k], 0)
    const totRevC = sum(revenue, 'cur'), totRevP = sum(revenue, 'prev')
    const totExpC = sum(expense, 'cur'), totExpP = sum(expense, 'prev')
    const netC = totRevC - totExpC, netP = totRevP - totExpP
    const Row = ({ r, favHigh }) => {
      const good = favHigh ? r.delta >= 0 : r.delta <= 0
      return (
        <tr className="border-b border-gray-50 dark:border-slate-700/50">
          <td className="py-1.5 text-gray-700 dark:text-slate-200">{r.name}</td>
          <td className="py-1.5 text-end font-medium text-gray-800 dark:text-slate-100">{fmtMoney(r.cur, sym)}</td>
          <td className="py-1.5 text-end text-gray-500 dark:text-slate-400">{fmtMoney(r.prev, sym)}</td>
          <td className={`py-1.5 text-end font-medium ${good ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{r.delta >= 0 ? '+' : ''}{fmtMoney(r.delta, sym)}</td>
          <td className="py-1.5 text-end text-gray-500 dark:text-slate-400">{r.pct == null ? '—' : `${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(0)}%`}</td>
        </tr>
      )
    }
    const Section = ({ title, data, favHigh }) => (
      <div className="mb-6">
        <h4 className="font-bold text-sm uppercase tracking-wide mb-2 text-gray-600 dark:text-slate-300">{t(title)}</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-slate-600 text-gray-400 dark:text-slate-500 text-xs uppercase">
              <th className="py-1.5 text-start font-semibold">{t('Account')}</th>
              <th className="py-1.5 text-end font-semibold">{t('Current')}</th>
              <th className="py-1.5 text-end font-semibold">{t('Prior')}</th>
              <th className="py-1.5 text-end font-semibold">{t('Change')}</th>
              <th className="py-1.5 text-end font-semibold">%</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && <tr><td colSpan={5} className="py-3 text-center text-gray-400 dark:text-slate-500">{t('No data for this period')}</td></tr>}
            {data.map((r) => <Row key={r.id} r={r} favHigh={favHigh} />)}
          </tbody>
        </table>
      </div>
    )
    return (
      <Card>
        <div className="p-6 border-b border-gray-100 dark:border-slate-700">
          <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name}</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">{t('Comparative P&L')} · {fmtDate(startDate)} — {fmtDate(endDate)} <span className="text-xs">{t('vs')} {priorLabel}</span></p>
        </div>
        <div className="p-6">
          <Section title="Revenue" data={revenue} favHigh />
          <Section title="Expenses" data={expense} />
          <div className="border-t-4 border-gray-300 dark:border-slate-500 mt-2 pt-3 flex items-center text-sm font-black">
            <span className="flex-1 text-gray-900 dark:text-slate-100">{t('Net')} {netC >= 0 ? t('Profit') : t('Loss')}</span>
            <span className="w-32 text-end text-gray-900 dark:text-slate-100">{fmtMoney(netC, sym)}</span>
            <span className="w-32 text-end text-gray-500 dark:text-slate-400">{fmtMoney(netP, sym)}</span>
            <span className={`w-32 text-end ${(netC - netP) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{(netC - netP) >= 0 ? '+' : ''}{fmtMoney(netC - netP, sym)}</span>
            <span className="w-16" />
          </div>
        </div>
      </Card>
    )
  }

  // ─── Departmental P&L (cost centers) ────────────────────────────
  const deptPL = useMemo(() => {
    const typeOf = Object.fromEntries(accounts.map((a) => [a.id, a.type]))
    const map = {} // deptId -> { revenue, expense }
    const bucket = (id) => (map[id] || (map[id] = { revenue: 0, expense: 0 }))
    journalEntries.forEach((je) => {
      if (startDate && je.date < startDate) return
      if (endDate && je.date > endDate) return
      const key = je.departmentId || '__none__'
      let touched = false
      ;(je.lines || []).forEach((l) => {
        const tp = typeOf[l.accountId]
        if (tp === 'revenue') { bucket(key).revenue += (l.credit || 0) - (l.debit || 0); touched = true }
        else if (tp === 'expense') { bucket(key).expense += (l.debit || 0) - (l.credit || 0); touched = true }
      })
      return touched
    })
    const rows = Object.entries(map).map(([id, v]) => ({
      id,
      name: id === '__none__' ? t('Unassigned') : (departments.find((d) => d.id === id)?.name || t('Unknown')),
      revenue: v.revenue, expense: v.expense, net: v.revenue - v.expense,
    })).filter((r) => Math.abs(r.revenue) > 0.005 || Math.abs(r.expense) > 0.005)
      .sort((a, b) => b.net - a.net)
    const totals = rows.reduce((s, r) => ({ revenue: s.revenue + r.revenue, expense: s.expense + r.expense, net: s.net + r.net }), { revenue: 0, expense: 0, net: 0 })
    return { rows, totals }
  }, [journalEntries, accounts, departments, startDate, endDate, t])

  const DeptPLReport = () => (
    <Card className="overflow-x-auto">
      <div className="p-6 border-b border-gray-100 dark:border-slate-700">
        <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name}</h3>
        <p className="text-sm text-gray-500 dark:text-slate-400">{t('Departmental P&L')} · {fmtDate(startDate)} — {fmtDate(endDate)}</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 text-xs uppercase">
            <th className="py-2.5 px-5 text-start font-semibold">{t('Department')}</th>
            <th className="py-2.5 px-4 text-end font-semibold">{t('Revenue')}</th>
            <th className="py-2.5 px-4 text-end font-semibold">{t('Expenses')}</th>
            <th className="py-2.5 px-5 text-end font-semibold">{t('Net')}</th>
          </tr>
        </thead>
        <tbody>
          {deptPL.rows.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-gray-400 dark:text-slate-500">{t('No data for this period')}</td></tr>}
          {deptPL.rows.map((r) => (
            <tr key={r.id} className="border-b border-gray-50 dark:border-slate-700/50">
              <td className="py-2 px-5 font-medium text-gray-800 dark:text-slate-100">{r.name}</td>
              <td className="py-2 px-4 text-end text-gray-700 dark:text-slate-200">{fmtMoney(r.revenue, sym)}</td>
              <td className="py-2 px-4 text-end text-gray-700 dark:text-slate-200">{fmtMoney(r.expense, sym)}</td>
              <td className={`py-2 px-5 text-end font-semibold ${r.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{fmtMoney(r.net, sym)}</td>
            </tr>
          ))}
          {deptPL.rows.length > 0 && (
            <tr className="border-t-2 border-gray-300 dark:border-slate-500 bg-gray-50/60 dark:bg-slate-700/40 font-bold">
              <td className="py-2.5 px-5 text-gray-900 dark:text-slate-100">{t('Total')}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(deptPL.totals.revenue, sym)}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(deptPL.totals.expense, sym)}</td>
              <td className={`py-2.5 px-5 text-end ${deptPL.totals.net >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(deptPL.totals.net, sym)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="px-5 py-3 text-xs text-gray-400 dark:text-slate-500">{t('Tag invoices, purchases, bank transactions and journals with a department to attribute their P&L here.')}</p>
    </Card>
  )

  const CustomReportView = () => (
    <CustomReport
      startDate={startDate} endDate={endDate} sym={sym}
      data={{ invoices, purchases, journalEntries, customers, suppliers, inventoryItems, accounts }} />
  )

  const canExport = ['pl', 'bs', 'tb', 'ar', 'ap', 'sales-cust', 'sales-item', 'purch-supp', 'exp-cat', 'budget-var', 'pl-comp', 'dept-pl'].includes(report)

  const reportTitle = REPORTS.find((r) => r.id === report)?.label || 'Report'
  const buildReportExport = () => {
    if (report === 'tb') {
      const rows = accounts.map((a) => {
        const b = allBalances[a.id] || { dr: 0, cr: 0 }
        return { code: a.code, name: a.name, netDr: b.dr > b.cr ? b.dr - b.cr : 0, netCr: b.cr > b.dr ? b.cr - b.dr : 0 }
      }).filter((r) => r.netDr || r.netCr)
      return { filename: `trial-balance-${endDate}`, rows, columns: [
        { key: 'code', label: t('Code') }, { key: 'name', label: t('Account') },
        { key: 'netDr', label: t('Debit'), right: true, map: (v) => v ? Number(v).toFixed(2) : '' },
        { key: 'netCr', label: t('Credit'), right: true, map: (v) => v ? Number(v).toFixed(2) : '' },
      ] }
    }
    if (report === 'pl') {
      const mk = (type, lbl) => accounts.filter((a) => a.type === type).map((a) => ({ type: lbl, name: a.name, balance: accountBalance(a.id, balances) })).filter((a) => a.balance)
      const rows = [...mk('revenue', t('Revenue')), ...mk('expense', t('Expense'))]
      return { filename: `income-statement-${startDate}_${endDate}`, rows, columns: [
        { key: 'type', label: t('Type') }, { key: 'name', label: t('Account') },
        { key: 'balance', label: t('Amount'), right: true, map: (v) => Number(v).toFixed(2) },
      ] }
    }
    if (report === 'bs') {
      const mk = (type, lbl) => accounts.filter((a) => a.type === type).map((a) => ({ section: lbl, name: a.name, balance: accountBalance(a.id, allBalances) })).filter((a) => a.balance)
      const rows = [...mk('asset', t('Assets')), ...mk('liability', t('Liabilities')), ...mk('equity', t('Equity'))]
      return { filename: `balance-sheet-${endDate}`, rows, columns: [
        { key: 'section', label: t('Section') }, { key: 'name', label: t('Account') },
        { key: 'balance', label: t('Amount'), right: true, map: (v) => Number(v).toFixed(2) },
      ] }
    }
    if (report === 'sales-cust') {
      return { filename: `sales-by-customer-${startDate}_${endDate}`, rows: salesByCustomer, columns: [
        { key: 'customer', label: t('Customer') }, { key: 'count', label: t('Invoices'), right: true },
        { key: 'subtotal', label: t('Subtotal'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'tax', label: t('Tax'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'total', label: t('Total'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'paid', label: t('Paid'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'balance', label: t('Outstanding'), right: true, map: (v) => Number(v).toFixed(2) },
      ] }
    }
    if (report === 'sales-item') {
      return { filename: `sales-by-item-${startDate}_${endDate}`, rows: salesByItem, columns: [
        { key: 'item', label: t('Item') }, { key: 'qty', label: t('Qty Sold'), right: true },
        { key: 'revenue', label: t('Revenue'), right: true, map: (v) => Number(v).toFixed(2) },
      ] }
    }
    if (report === 'purch-supp') {
      return { filename: `purchases-by-supplier-${startDate}_${endDate}`, rows: purchasesBySupplier, columns: [
        { key: 'supplier', label: t('Supplier') }, { key: 'count', label: t('Bills'), right: true },
        { key: 'total', label: t('Total'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'paid', label: t('Paid'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'balance', label: t('Outstanding'), right: true, map: (v) => Number(v).toFixed(2) },
      ] }
    }
    if (report === 'exp-cat') {
      return { filename: `expenses-by-category-${startDate}_${endDate}`, rows: expenseByCategory.rows.map((r) => ({
        ...r, pct: expenseByCategory.total ? (r.amount / expenseByCategory.total * 100).toFixed(1) : '0',
      })), columns: [
        { key: 'category', label: t('Category') },
        { key: 'amount', label: t('Amount'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'pct', label: t('% of Total'), right: true, map: (v) => `${v}%` },
      ] }
    }
    if (report === 'dept-pl') {
      return { filename: `departmental-pl-${startDate}_${endDate}`, rows: deptPL.rows, columns: [
        { key: 'name', label: t('Department') },
        { key: 'revenue', label: t('Revenue'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'expense', label: t('Expenses'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'net', label: t('Net'), right: true, map: (v) => Number(v).toFixed(2) },
      ] }
    }
    if (report === 'pl-comp') {
      const mk = (arr, lbl) => arr.map((r) => ({ section: lbl, name: r.name, cur: r.cur, prev: r.prev, delta: r.delta, pct: r.pct == null ? '' : r.pct.toFixed(0) }))
      return { filename: `comparative-pl-${startDate}_${endDate}`, rows: [...mk(plComparative.revenue, t('Revenue')), ...mk(plComparative.expense, t('Expenses'))], columns: [
        { key: 'section', label: t('Section') }, { key: 'name', label: t('Account') },
        { key: 'cur', label: t('Current'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'prev', label: t('Prior'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'delta', label: t('Change'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'pct', label: '%', right: true, map: (v) => v === '' ? '' : `${v}%` },
      ] }
    }
    if (report === 'budget-var') {
      const mk = (arr, lbl) => arr.map((r) => ({ section: lbl, name: `${r.code} ${r.name}`, budget: r.budget, actual: r.actual, variance: r.variance, pct: r.budget ? r.pct.toFixed(0) : '' }))
      return { filename: `budget-vs-actual-${startDate}_${endDate}`, rows: [...mk(budgetVar.revenue, t('Revenue')), ...mk(budgetVar.expense, t('Expenses'))], columns: [
        { key: 'section', label: t('Section') }, { key: 'name', label: t('Account') },
        { key: 'budget', label: t('Budget'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'actual', label: t('Actual'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'variance', label: t('Variance'), right: true, map: (v) => Number(v).toFixed(2) },
        { key: 'pct', label: '%', right: true, map: (v) => v ? `${v}%` : '' },
      ] }
    }
    // ar / ap aging
    const src = report === 'ar'
      ? invoices.filter((i) => i.status !== 'paid' && i.status !== 'cancelled' && i.status !== 'void')
      : purchases.filter((p) => p.status !== 'paid' && p.status !== 'void' && p.status !== 'cancelled')
    const todayStr = new Date().toISOString().slice(0, 10)
    const rows = src.map((d) => {
      const due = d.dueDate || d.date
      const days = Math.floor((new Date(todayStr) - new Date(due)) / 86400000)
      return { number: d.number, party: report === 'ar' ? d.customerName : d.supplierName, due, days: days > 0 ? days : 0, amt: d.total - d.amountPaid }
    }).sort((a, b) => b.days - a.days)
    return { filename: `${report}-aging-${todayStr}`, rows, columns: [
      { key: 'number', label: t('Invoice #') },
      { key: 'party', label: report === 'ar' ? t('Customer') : t('Supplier') },
      { key: 'due', label: t('Due') },
      { key: 'days', label: t('Days Overdue'), right: true },
      { key: 'amt', label: t('Balance'), right: true, map: (v) => Number(v).toFixed(2) },
    ] }
  }
  const rx = canExport ? buildReportExport() : null

  return (
    <div>
      <PageHeader title="Financial Reports" subtitle="Powered by double-entry bookkeeping" />

      <Card className="p-5 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">{t('Report')}</label>
            <select className="border border-slate-300/90 dark:border-surface-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 shadow-input dark:shadow-none focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 cursor-pointer transition-all duration-150"
              value={report} onChange={(e) => setReport(e.target.value)}>
              {[...new Set(REPORTS.map((r) => r.group || 'Reports'))].map((g) => (
                <optgroup key={g} label={t(g)}>
                  {REPORTS.filter((r) => (r.group || 'Reports') === g).map((r) => (
                    <option key={r.id} value={r.id}>{t(r.label)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <Input label="From" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
          <Input label="To" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
          {rx && <ExportMenu filename={rx.filename} title={t(reportTitle)} subtitle={`${fmtDate(startDate)} — ${fmtDate(endDate)}`} rows={rx.rows} columns={rx.columns} />}
          <Btn variant="secondary" onClick={() => window.print()}>{t('Print / Export')}</Btn>
        </div>
      </Card>

      <div className="print:pt-0">
        {report === 'pl' && <PLReport />}
        {report === 'bs' && <BSReport />}
        {report === 'cf' && <CFReport />}
        {report === 'vat' && <VATReport />}
        {report === 'tb' && <TBReport />}
        {report === 'gl' && <GLReport />}
        {report === 'ar' && <ARReport />}
        {report === 'ap' && <APReport />}
        {report === 'sales-cust' && <SalesByCustomerReport />}
        {report === 'sales-item' && <SalesByItemReport />}
        {report === 'purch-supp' && <PurchasesBySupplierReport />}
        {report === 'exp-cat' && <ExpenseByCategoryReport />}
        {report === 'budget-var' && <BudgetVarReport />}
        {report === 'pl-comp' && <ComparativePLReport />}
        {report === 'dept-pl' && <DeptPLReport />}
        {report === 'custom' && <CustomReportView />}
      </div>

      <AccountLedgerModal
        open={!!drill}
        onClose={() => setDrill(null)}
        account={drillAccount}
        accounts={accounts}
        journalEntries={journalEntries}
        sym={sym}
        startDate={startDate}
        endDate={endDate}
        mode={drill?.mode || 'period'}
        companyName={company.name}
        onOpenAccount={(id) => setDrill((d) => ({ accountId: id, mode: d?.mode || 'period' }))}
      />
    </div>
  )
}
