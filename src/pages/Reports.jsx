import { useState, useMemo } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { vatBreakdown } from '../utils/vat'
import { buildVatReturn, yearQuarters } from '../utils/vatReturn'
import { buildSalesTaxReturn } from '../utils/salesTaxReturn'
import { priorPeriod, variancePct, varianceTone } from '../utils/priorPeriod'
import { buildTree, withTotals, pruneEmpty, flattenRows, findByRole, withoutNode, COST_OF_SALES, OTHER_INCOME } from '../utils/accountTree'
import { PageHeader, Card, Btn, Select, Input, Table, Tr, Td } from '../components/UI'
import { useT } from '../i18n'
import ExportMenu from '../components/ExportMenu'
import CustomReport from '../components/CustomReport'
import AccountLedgerModal from '../components/AccountLedgerModal'
import { ChevronRight } from 'lucide-react'
import { format, startOfYear, endOfYear } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts'
import { narrate } from '../utils/jeNarration'
import { marginByCustomer, marginByItem, marginSummary } from '../utils/margin'
import { buildEquityStatement } from '../utils/equityStatement'
import { BUCKETS as ECL_BUCKETS } from '../utils/ecl'

const REPORTS = [
  { id: 'pl', label: 'Income Statement (P&L)', group: 'Financial Statements' },
  { id: 'bs', label: 'Balance Sheet', group: 'Financial Statements' },
  { id: 'cf', label: 'Cash Flow Statement', group: 'Financial Statements' },
  { id: 'soce', label: 'Statement of Changes in Equity', group: 'Financial Statements' },
  { id: 'vat', label: 'VAT Return (ZATCA)', group: 'Financial Statements' },
  { id: 'tb', label: 'Trial Balance', group: 'Ledgers' },
  { id: 'gl', label: 'General Ledger', group: 'Ledgers' },
  { id: 'ar', label: 'Accounts Receivable Aging', group: 'Ledgers' },
  { id: 'ap', label: 'Accounts Payable Aging', group: 'Ledgers' },
  { id: 'ecl', label: 'Expected Credit Losses (IFRS 9)', group: 'Ledgers' },
  { id: 'deferred-tax', label: 'Deferred Tax (IAS 12)', group: 'Financial Statements' },
  { id: 'sales-cust', label: 'Sales by Customer', group: 'Sales & Purchases' },
  { id: 'sales-item', label: 'Sales by Item', group: 'Sales & Purchases' },
  { id: 'purch-supp', label: 'Purchases by Supplier', group: 'Sales & Purchases' },
  { id: 'exp-cat', label: 'Expenses by Category', group: 'Sales & Purchases' },
  { id: 'margin-cust', label: 'Margin by Customer', group: 'Profitability' },
  { id: 'margin-item', label: 'Margin by Item', group: 'Profitability' },
  { id: 'budget-var', label: 'Budget vs Actual', group: 'Performance' },
  { id: 'pl-comp', label: 'Comparative P&L', group: 'Performance' },
  { id: 'dept-pl', label: 'Departmental P&L', group: 'Performance' },
  { id: 'custom', label: 'Custom Report Builder', group: 'Advanced' },
]

export default function Reports() {
  const { accounts, accountGroups = [], journalEntries, invoices, purchases, creditNotes, debitNotes, bankAccounts, customers, suppliers, inventoryItems, budgets, departments, getAllBalances, settleVat, settings, eclAssessment, postEclProvision, deferredTaxAssessment, postDeferredTax, taxRateReconciliation } = useStore()
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
  // Prior-period comparison for the P&L: off by default so the plain report
  // stays uncluttered, then adds a comparative + variance column on demand.
  const [compareBasis, setCompareBasis] = useState('none') // 'none' | 'previous' | 'lastYear'
  const openDrill = (accountId, mode) => setDrill({ accountId, mode })
  const drillAccount = drill ? accounts.find((a) => a.id === drill.accountId) : null

  // One clickable Balance-Sheet / P&L line → drills into that ledger's Statement
  // of Account. Non-real (aggregate) rows like Retained Earnings pass clickable=false.
  const LedgerLine = ({ account, mode, clickable = true, indent = false, prior = null }) => {
    const body = (
      <>
        <span className={`flex items-center gap-2 text-gray-600 dark:text-slate-300 ${indent ? 'ps-3' : ''}`}>
          {account.code && <span className="font-mono text-[11px] text-gray-400 dark:text-slate-500">{account.code}</span>}
          <span className="group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">{account.name}</span>
          {clickable && <ChevronRight size={13} className="opacity-0 group-hover:opacity-100 -ms-1 text-brand-400 transition-opacity print:hidden" />}
        </span>
        <span className="flex items-center gap-4 flex-shrink-0">
          {prior != null && <VarianceCells value={account.balance} prior={prior} type={account.type} />}
          <span className="w-32 text-end font-medium text-gray-800 dark:text-slate-100 tabular-nums">{fmtMoney(account.balance, sym)}</span>
        </span>
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

  // The tax report's label/id in the picker follows the company's configured
  // tax system — ZATCA-styled for Saudi VAT filers, generic VAT/GST return
  // elsewhere, or a Sales Tax Report for US-style non-recoverable sales tax.
  const taxSystem = settings.tax?.system || 'vat'
  const taxCountry = settings.tax?.country || ''
  const taxReportLabel = !settings.tax?.enabled ? null
    : taxSystem === 'sales_tax' ? 'Sales Tax Report'
    : taxCountry === 'SA' ? 'VAT Return (ZATCA)'
    : 'VAT / GST Return'
  const REPORTS_LIST = useMemo(
    () => REPORTS.filter((r) => r.id !== 'vat' || taxReportLabel).map((r) => (r.id === 'vat' ? { ...r, label: taxReportLabel } : r)),
    [taxReportLabel]
  )

  const balances = useMemo(() => getAllBalances(startDate, endDate), [getAllBalances, startDate, endDate, journalEntries])
  const allBalances = useMemo(() => getAllBalances(), [getAllBalances, journalEntries])
  // cumulative balances as at the report end date — the correct basis for a
  // balance sheet (assets, liabilities, equity and retained earnings to date)
  const balancesToEnd = useMemo(() => getAllBalances(undefined, endDate), [getAllBalances, endDate, journalEntries])

  const priorRange = useMemo(
    () => (compareBasis === 'none' ? null : priorPeriod(startDate, endDate, compareBasis)),
    [compareBasis, startDate, endDate]
  )
  const priorBalances = useMemo(
    () => (priorRange ? getAllBalances(priorRange.start, priorRange.end) : null),
    [getAllBalances, priorRange, journalEntries]
  )
  // Balance sheet comparatives are cumulative-to-date, so the comparison point
  // is "as at the prior period's end date", not "movements within it".
  const priorBalancesToEnd = useMemo(
    () => (priorRange ? getAllBalances(undefined, priorRange.end) : null),
    [getAllBalances, priorRange, journalEntries]
  )
  const compareLabel = compareBasis === 'lastYear' ? t('Last year') : t('Prior period')

  // The prior value + variance % pair, shared by every comparative row so the
  // columns line up and the colour rule is applied in exactly one place.
  const VarianceCells = ({ value, prior, type }) => {
    const pct = variancePct(value, prior)
    // Tone follows the *displayed* percentage, not the raw delta: a 20-riyal
    // move on a 44,000 balance rounds to 0% and colouring that red reads as a
    // bug, not a signal.
    const tone = pct === null || pct === 0 ? 'flat' : varianceTone(value - prior, type)
    const cls = tone === 'good' ? 'text-success-600 dark:text-success-400'
      : tone === 'bad' ? 'text-rose-600 dark:text-rose-400'
      : 'text-gray-400 dark:text-slate-500'
    return (
      <>
        <span className="w-28 text-end text-gray-400 dark:text-slate-500 tabular-nums text-sm">{fmtMoney(prior, sym)}</span>
        <span className={`w-24 text-end tabular-nums text-xs ${cls}`}>{pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct}%`}</span>
      </>
    )
  }

  const accountBalance = (id, bals) => {
    const b = bals[id]
    if (!b) return 0
    const acc = accounts.find((a) => a.id === id)
    if (!acc) return 0
    return ['asset', 'expense'].includes(acc.type) ? b.dr - b.cr : b.cr - b.dr
  }

  // Header strip naming the comparison columns, so "1,200 / +14%" is readable.
  const CompareHead = ({ label = '', compare = compareLabel, current = t('This period') }) => (
    <div className="flex items-center justify-between px-3 pb-1 text-[10px] uppercase tracking-wider text-gray-400 dark:text-slate-500">
      <span>{label}</span>
      <span className="flex items-center gap-4 flex-shrink-0">
        <span className="w-28 text-end">{compare}</span>
        <span className="w-24 text-end">{t('Var')}</span>
        <span className="w-32 text-end">{current}</span>
      </span>
    </div>
  )

  // A bolded subtotal that carries the same prior / variance columns as the
  // lines above it, so the eye can run straight down each column.
  const TotalRow = ({ label, value, prior, type, className = '', valueClass = '' }) => (
    <div className={`flex items-center justify-between ${className}`}>
      <span className={`font-bold text-sm ${valueClass || 'text-gray-800 dark:text-slate-100'}`}>{label}</span>
      <span className="flex items-center gap-4 flex-shrink-0">
        {prior != null && <VarianceCells value={value} prior={prior} type={type} />}
        <span className={`w-32 text-end font-bold tabular-nums ${valueClass || 'text-gray-800 dark:text-slate-100'}`}>{fmtMoney(value, sym)}</span>
      </span>
    </div>
  )

  // ─── Grouped statement rendering ───────────────────────────────────
  // The chart of accounts is a tree, so a statement is built once here and
  // rendered as a flat row list carrying a depth number. Nested JSX for an
  // arbitrarily deep tree means recursive components and indentation that
  // drifts; a flat list keeps every column aligned no matter how deep it goes.

  /**
   * Decorated, pruned tree for one account type.
   * `bals` is the current-period balance map; `priorBals` the comparative one.
   */
  const treeFor = (type, bals, priorBals) => {
    const keys = priorBals ? ['balance', 'prior'] : ['balance']
    const decorated = withTotals(
      buildTree(accountGroups, accounts, type),
      (a) => (priorBals
        ? { balance: accountBalance(a.id, bals), prior: accountBalance(a.id, priorBals) }
        : { balance: accountBalance(a.id, bals) }),
      keys
    )
    return { tree: pruneEmpty(decorated, keys), keys }
  }

  const INDENT = ['ps-0', 'ps-4', 'ps-8', 'ps-12', 'ps-16', 'ps-20']
  const pad = (d) => INDENT[Math.min(d, INDENT.length - 1)]

  /** One group header: the name on the left, the rolled-up total on the right. */
  const GroupHead = ({ row, showTotal }) => (
    <div className={`flex items-center justify-between px-3 pt-3 pb-1 ${pad(row.depth)}`}>
      <span className={`font-semibold tracking-tight ${row.depth === 0
        ? 'text-gray-800 dark:text-slate-100 text-sm'
        : 'text-gray-600 dark:text-slate-300 text-[13px]'}`}>{t(row.name)}</span>
      {showTotal && (
        <span className="flex items-center gap-4 flex-shrink-0">
          {row.totals.prior != null && <span className="w-28" />}
          {row.totals.prior != null && <span className="w-24" />}
          <span className="w-32 text-end font-semibold tabular-nums text-gray-500 dark:text-slate-400 text-sm">
            {fmtMoney(row.totals.balance, sym)}
          </span>
        </span>
      )}
    </div>
  )

  /** A group's rolled-up subtotal, ruled off from the lines above it. */
  const SubTotal = ({ row, type, compare }) => (
    <div className={`flex items-center justify-between px-3 py-1.5 mt-0.5 border-t border-gray-100 dark:border-surface-750 ${pad(row.depth)}`}>
      <span className="text-[13px] font-semibold text-gray-600 dark:text-slate-300">
        {t('Total')} {t(row.name)}
      </span>
      <span className="flex items-center gap-4 flex-shrink-0">
        {compare && <VarianceCells value={row.totals.balance} prior={row.totals.prior || 0} type={type} />}
        <span className="w-32 text-end font-semibold tabular-nums text-gray-700 dark:text-slate-200">
          {fmtMoney(row.totals.balance, sym)}
        </span>
      </span>
    </div>
  )

  /**
   * Render a decorated tree. `mode` is passed through to the account drill-down.
   *
   * A group header shows its total only when the group is collapsed-looking —
   * i.e. it has subgroups. For a plain list of accounts the subtotal below is
   * enough, and showing both reads as the figure being counted twice.
   */
  const GroupedRows = ({ tree, mode, type, compare, skipRoot = false }) => (
    <>
      {(() => {
        const rows = flattenRows(tree)
        if (!skipRoot) return rows
        // The section heading above already names this group (cost of sales),
        // and its total is printed below as the section total. Repeating both
        // reads as the same figure counted twice, so drop the group's own
        // header and subtotal and pull everything up a level.
        return rows
          .filter((r) => !(r.depth === 0 && (r.kind === 'group' || r.kind === 'subtotal')))
          .map((r) => ({ ...r, depth: Math.max(0, r.depth - 1) }))
      })().map((row) => {
        if (row.kind === 'group') return <GroupHead key={row.id} row={row} showTotal={false} />
        if (row.kind === 'ungrouped')
          return (
            <div key={row.id} className={`flex items-center px-3 pt-3 pb-1 ${pad(row.depth)}`}>
              <span className="font-semibold text-gray-500 dark:text-slate-400 text-[13px]">{t('Ungrouped')}</span>
              <span className="ms-2 text-[10px] uppercase tracking-wider text-warning-600 dark:text-warning-400">
                {t('not in a group')}
              </span>
            </div>
          )
        if (row.kind === 'subtotal') return <SubTotal key={row.id} row={row} type={type} compare={compare} />
        return (
          <div key={row.id} className={pad(row.depth)}>
            <LedgerLine account={row.account} mode={mode} prior={compare ? (row.account.prior || 0) : null} />
          </div>
        )
      })}
    </>
  )

  // ─── P&L ───────────────────────────────────────────────────────────
  const PLReport = () => {
    // A line worth showing is one with a balance in either period — an account
    // that ran to zero this month is exactly what a comparative should reveal,
    // which is why pruning looks at both keys rather than the current one.
    const { tree: revTree } = treeFor('revenue', balances, priorBalances)
    const { tree: expTree } = treeFor('expense', balances, priorBalances)

    // Cost of sales is lifted out of expenses so the statement can show gross
    // profit, the way every published income statement does. `withoutNode`
    // deducts it from the expense total too, so nothing is counted twice.
    const cosNode = findByRole(expTree, COST_OF_SALES)
    const opexTree = cosNode ? withoutNode(expTree, cosNode.id) : expTree

    // Other income is lifted out of revenue for the same reason, in the other
    // direction: gross profit is trading revenue less cost of sales, and an FX
    // movement or a gain on selling a van is not trading. Left in, it inflates
    // the margin — and an FX *loss*, being a debit to a revenue-typed account,
    // silently reduces reported sales. Net profit is unaffected either way,
    // since the total is added back below.
    const oiNode = findByRole(revTree, OTHER_INCOME)
    const salesTree = oiNode ? withoutNode(revTree, oiNode.id) : revTree

    const operatingRevenue = salesTree.totals.balance
    const otherIncome = oiNode?.totals.balance || 0
    const totalRevenue = revTree.totals.balance
    const totalCos = cosNode?.totals.balance || 0
    const totalOpex = opexTree.totals.balance
    const totalExpenses = totalCos + totalOpex
    const grossProfit = operatingRevenue - totalCos
    const netProfit = totalRevenue - totalExpenses

    const priorOperating = priorBalances ? salesTree.totals.prior : null
    const priorOther = priorBalances ? (oiNode?.totals.prior || 0) : null
    const priorRevenue = priorBalances ? revTree.totals.prior : null
    const priorCos = priorBalances ? (cosNode?.totals.prior || 0) : null
    const priorOpex = priorBalances ? opexTree.totals.prior : null
    const priorExpenses = priorBalances ? priorCos + priorOpex : null
    const priorGross = priorBalances ? priorOperating - priorCos : null
    const priorNet = priorBalances ? priorRevenue - priorExpenses : null

    // Gross profit only means something when cost of sales carries a figure;
    // a services company with an empty cost-of-sales group should see the
    // simpler revenue-less-expenses statement, not a gross profit line equal
    // to revenue.
    const showGross = !!cosNode && (totalCos !== 0 || (priorCos || 0) !== 0)
    const showOther = !!oiNode && (otherIncome !== 0 || (priorOther || 0) !== 0)
    const hasRevenue = salesTree.groups.length > 0 || salesTree.ungrouped.length > 0
    const hasOpex = opexTree.groups.length > 0 || opexTree.ungrouped.length > 0

    return (
      <div className="space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-success-50 dark:bg-success-500/10 ring-1 ring-inset ring-success-600/10 dark:ring-success-400/15 rounded-xl p-4"><p className="text-sm text-success-600 dark:text-success-400">{t('Total Revenue')}</p><p className="text-2xl font-bold tracking-tightest tabular text-success-700 dark:text-success-300">{fmtMoney(operatingRevenue, sym)}</p></div>
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
              {priorRange && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{t('Compared with')} {fmtDate(priorRange.start)} — {fmtDate(priorRange.end)}</p>}
            </div>
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-surface-800 rounded-full px-2.5 py-1 print:hidden">
              <ChevronRight size={12} /> {t('Click any line for its ledger')}
            </span>
          </div>
          <div className="p-6">
            {/* Revenue */}
            <div className="flex items-center gap-2 mb-1"><span className="w-1.5 h-1.5 rounded-full bg-success-500" /><h4 className="font-bold text-success-700 dark:text-success-400 text-xs uppercase tracking-wider">{t('Revenue')}</h4></div>
            {!hasRevenue ? <p className="text-gray-400 dark:text-slate-500 text-sm mb-4 ps-3.5">{t('No revenue for this period')}</p> : (
              <div className="mb-2">
                {priorBalances && <CompareHead label={t('Account')} />}
                <GroupedRows tree={salesTree} mode="period" type="revenue" compare={!!priorBalances} />
                <TotalRow label={t('Total Revenue')} value={operatingRevenue} prior={priorOperating} type="revenue"
                  className="mt-1 rounded-lg bg-success-50/60 dark:bg-success-500/[0.08] px-3 py-2"
                  valueClass="text-success-800 dark:text-success-300" />
              </div>
            )}

            {/* Cost of sales, then gross profit — the shape of a published
                income statement, available now that groups carry a role. */}
            {showGross && (
              <>
                <div className="flex items-center gap-2 mb-1 mt-6"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /><h4 className="font-bold text-amber-700 dark:text-amber-400 text-xs uppercase tracking-wider">{t('Cost of Sales')}</h4></div>
                <div className="mb-2">
                  {priorBalances && <CompareHead label={t('Account')} />}
                  <GroupedRows tree={{ ...expTree, groups: [cosNode], ungrouped: [] }} mode="period" type="expense" compare={!!priorBalances} skipRoot />
                  <TotalRow label={t('Total Cost of Sales')} value={totalCos} prior={priorCos} type="expense"
                    className="mt-1 rounded-lg bg-amber-50/60 dark:bg-amber-500/[0.08] px-3 py-2"
                    valueClass="text-amber-800 dark:text-amber-300" />
                </div>
                <div className="border-t border-gray-200 dark:border-surface-700 mt-3 pt-3">
                  <TotalRow label={t('Gross Profit')} value={grossProfit} prior={priorGross} type="revenue"
                    className="rounded-lg bg-brand-50/60 dark:bg-brand-500/[0.08] px-3 py-2"
                    valueClass="text-brand-800 dark:text-brand-300" />
                  {operatingRevenue !== 0 && (
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-1 px-3">
                      {t('Gross margin')} {Math.round((grossProfit / operatingRevenue) * 1000) / 10}%
                    </p>
                  )}
                </div>
              </>
            )}

            {/* Other income sits below gross profit, not inside revenue: it is
                income, so it belongs in net profit, but it is not trading, so
                it must not flatter the margin above. */}
            {showOther && (
              <>
                <div className="flex items-center gap-2 mb-1 mt-6"><span className="w-1.5 h-1.5 rounded-full bg-teal-500" /><h4 className="font-bold text-teal-700 dark:text-teal-400 text-xs uppercase tracking-wider">{t('Other Income')}</h4></div>
                <div className="mb-2">
                  {priorBalances && <CompareHead label={t('Account')} />}
                  <GroupedRows tree={{ ...revTree, groups: [oiNode], ungrouped: [] }} mode="period" type="revenue" compare={!!priorBalances} skipRoot />
                  <TotalRow label={t('Total Other Income')} value={otherIncome} prior={priorOther} type="revenue"
                    className="mt-1 rounded-lg bg-teal-50/60 dark:bg-teal-500/[0.08] px-3 py-2"
                    valueClass="text-teal-800 dark:text-teal-300" />
                </div>
              </>
            )}

            {/* Expenses */}
            <div className="flex items-center gap-2 mb-1 mt-6"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" /><h4 className="font-bold text-rose-700 dark:text-rose-400 text-xs uppercase tracking-wider">{showGross ? t('Operating & Other Expenses') : t('Expenses')}</h4></div>
            {!hasOpex ? <p className="text-gray-400 dark:text-slate-500 text-sm mb-4 ps-3.5">{t('No expenses for this period')}</p> : (
              <div className="mb-2">
                {priorBalances && <CompareHead label={t('Account')} />}
                <GroupedRows tree={opexTree} mode="period" type="expense" compare={!!priorBalances} />
                <TotalRow label={showGross ? t('Total Operating & Other Expenses') : t('Total Expenses')}
                  value={showGross ? totalOpex : totalExpenses} prior={showGross ? priorOpex : priorExpenses} type="expense"
                  className="mt-1 rounded-lg bg-rose-50/60 dark:bg-rose-500/[0.08] px-3 py-2"
                  valueClass="text-rose-800 dark:text-rose-300" />
              </div>
            )}

            {/* Net */}
            <div className="border-t-2 border-gray-200 dark:border-surface-700 mt-5 pt-4 flex justify-between items-center">
              <span className="text-lg font-black text-gray-900 dark:text-slate-100 tracking-tight">{t('Net')} {netProfit >= 0 ? t('Profit') : t('Loss')}</span>
              <span className="flex items-center gap-4 flex-shrink-0">
                {priorNet != null && <VarianceCells value={netProfit} prior={priorNet} type="revenue" />}
                <span className={`w-32 text-end text-2xl font-black tabular-nums tracking-tight ${netProfit >= 0 ? 'text-success-600 dark:text-success-400' : 'text-rose-600 dark:text-rose-400'}`}>{fmtMoney(Math.abs(netProfit), sym)}</span>
              </span>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  // ─── Balance Sheet ──────────────────────────────────────────────
  const BSReport = () => {
    // as at the end date, cumulative from inception (not the selected period)
    const { tree: assetTree } = treeFor('asset', balancesToEnd, priorBalancesToEnd)
    const { tree: liabTree } = treeFor('liability', balancesToEnd, priorBalancesToEnd)
    const { tree: equityTree } = treeFor('equity', balancesToEnd, priorBalancesToEnd)

    const totalAssets = assetTree.totals.balance
    const totalLiabs = liabTree.totals.balance
    const totalEquity = equityTree.totals.balance

    // Retained earnings = all net income from inception through the end date, so
    // Assets = Liabilities + Equity + Retained Earnings always holds.
    const netAt = (bals) => accounts.filter((a) => a.type === 'revenue').reduce((s, a) => s + accountBalance(a.id, bals), 0)
                           - accounts.filter((a) => a.type === 'expense').reduce((s, a) => s + accountBalance(a.id, bals), 0)
    const netProfit = netAt(balancesToEnd)
    const priorNetProfit = priorBalancesToEnd ? netAt(priorBalancesToEnd) : null
    const totalEquityAndProfit = totalEquity + netProfit

    /**
     * One statement section. `extra` carries lines that belong on the face of
     * the balance sheet but are not accounts — retained earnings is computed,
     * not posted, so it has no place in the tree.
     */
    const Section = ({ title, tree, total, prior, type, dot, extra = [] }) => {
      const empty = tree.groups.length === 0 && tree.ungrouped.length === 0 && extra.length === 0
      return (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1.5"><span className={`w-1.5 h-1.5 rounded-full ${dot}`} /><h4 className="font-bold text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400">{title}</h4></div>
          {priorBalancesToEnd && !empty && <CompareHead compare={fmtDate(priorRange.end)} current={fmtDate(endDate)} />}
          {empty && <p className="py-1.5 ps-3 text-gray-400 dark:text-slate-500 text-sm">—</p>}
          <GroupedRows tree={tree} mode="todate" type={type} compare={!!priorBalancesToEnd} />
          {extra.map((a) => (
            <LedgerLine key={a.id} account={a} mode="todate" clickable={false} indent
              prior={priorBalancesToEnd ? (a.prior || 0) : null} />
          ))}
          <TotalRow label={`${t('Total')} ${title}`} value={total} prior={prior} type={type}
            className="border-t border-gray-200 dark:border-surface-700 mt-1.5 pt-2 px-3" />
        </div>
      )
    }

    return (
      <Card className="overflow-hidden">
        <div className="p-6 border-b border-gray-100 dark:border-surface-750 flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg tracking-tight">{company.name}</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400">{t('Balance Sheet')} · {t('As at')} {fmtDate(endDate)}</p>
            {priorRange && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{t('Compared with')} {fmtDate(priorRange.end)}</p>}
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
            <Section title="Assets" tree={assetTree} total={totalAssets} type="asset" dot="bg-brand-500"
              prior={priorBalancesToEnd ? assetTree.totals.prior : null} />
          </div>
          <div>
            <div className={`flex items-center justify-between rounded-xl px-4 py-3 mb-4 ${Math.abs(totalAssets - (totalLiabs + totalEquityAndProfit)) < 0.01 ? 'bg-success-50/60 dark:bg-success-500/[0.08]' : 'bg-rose-50/60 dark:bg-rose-500/[0.08]'}`}>
              <span className={`text-sm font-bold uppercase tracking-wide ${Math.abs(totalAssets - (totalLiabs + totalEquityAndProfit)) < 0.01 ? 'text-success-700 dark:text-success-300' : 'text-rose-700 dark:text-rose-300'}`}>{t('Liabilities + Equity')}</span>
              <span className={`text-lg font-black tabular-nums ${Math.abs(totalAssets - (totalLiabs + totalEquityAndProfit)) < 0.01 ? 'text-success-700 dark:text-success-300' : 'text-rose-600 dark:text-rose-400'}`}>{fmtMoney(totalLiabs + totalEquityAndProfit, sym)}</span>
            </div>
            <Section title="Liabilities" tree={liabTree} total={totalLiabs} type="liability" dot="bg-orange-500"
              prior={priorBalancesToEnd ? liabTree.totals.prior : null} />
            <Section title="Equity" dot="bg-violet-500" type="equity" tree={equityTree}
              extra={[(netProfit !== 0 || priorNetProfit) && { id: 'net', code: '', name: t('Retained Earnings (to date)'), type: 'equity', balance: netProfit, prior: priorNetProfit }].filter(Boolean)}
              total={totalEquityAndProfit}
              prior={priorBalancesToEnd ? equityTree.totals.prior + priorNetProfit : null} />
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
        <div className="p-6 border-b border-gray-100 dark:border-surface-750 flex items-start justify-between gap-4">
          <div>
            <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg tracking-tight">{company.name}</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400">{t('Trial Balance')} · {t('As at')} {fmtDate(endDate)}</p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-surface-800 rounded-full px-2.5 py-1 print:hidden">
            <ChevronRight size={12} /> {t('Click any line for its ledger')}
          </span>
        </div>
        <div className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 dark:bg-surface-900/40">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Code</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Account')}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Debit')}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">{t('Credit')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => openDrill(r.id, 'todate')}
                  className="group border-b border-gray-50 dark:border-surface-800 cursor-pointer hover:bg-brand-50/50 dark:hover:bg-brand-500/[0.07] transition-colors">
                  <td className="px-6 py-2 font-mono text-gray-500 dark:text-slate-400 text-xs">{r.code}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-slate-200">
                    <span className="inline-flex items-center gap-1.5 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                      {r.name}
                      <ChevronRight size={13} className="opacity-0 group-hover:opacity-100 text-brand-400 transition-opacity print:hidden" />
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-gray-800 dark:text-slate-100">{r.netDr > 0 ? fmtMoney(r.netDr, sym) : ''}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-gray-800 dark:text-slate-100">{r.netCr > 0 ? fmtMoney(r.netCr, sym) : ''}</td>
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
        lines.push({ date: je.date, desc: narrate(je.description, t), ref: je.number, dr, cr, running })
      })
    })

    return (
      <Card>
        <div className="p-6 border-b border-gray-100 dark:border-surface-750 flex items-center gap-4 flex-wrap">
          <div>
            <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg tracking-tight">{company.name} — {t('General Ledger')}</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400">{fmtDate(startDate)} — {fmtDate(endDate)}</p>
          </div>
          <div className="ml-auto flex items-end gap-2">
            <div className="w-72">
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
            <Btn variant="secondary" onClick={() => selectedAcc && openDrill(selectedAcc, 'period')} className="print:hidden whitespace-nowrap">
              <ChevronRight size={14} /> {t('Statement of Account')}
            </Btn>
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
              <tr key={i} onClick={() => openDrill(selectedAcc, 'period')}
                className="group border-b border-gray-50 dark:border-surface-800 cursor-pointer hover:bg-brand-50/50 dark:hover:bg-brand-500/[0.07] transition-colors">
                <td className="px-6 py-2 text-gray-500 dark:text-slate-400">{fmtDate(l.date)}</td>
                <td className="px-4 py-2 text-gray-700 dark:text-slate-200">{l.desc}</td>
                <td className="px-4 py-2 text-gray-400 dark:text-slate-500 text-xs font-mono">{l.ref}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-gray-700 dark:text-slate-200">{l.dr > 0 ? fmtMoney(l.dr, sym) : ''}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-gray-700 dark:text-slate-200">{l.cr > 0 ? fmtMoney(l.cr, sym) : ''}</td>
                <td className={`px-4 py-2 text-right font-mono tabular-nums font-semibold ${l.running >= 0 ? 'text-gray-800 dark:text-slate-100' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(l.running, sym)}</td>
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
      cats[classify(je)].push({ date: je.date, desc: narrate(je.description, t), ref: je.number, amount: delta })
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
  // Filing-grade layout mirroring the ZATCA portal form: three columns
  // (Amount | Adjustment | VAT) with credit / debit notes in the adjustment
  // column, a ledger reconciliation check, and one-click settlement posting.
  const VATReport = () => {
    const ret = buildVatReturn({ invoices, creditNotes, purchases, debitNotes }, { from: startDate, to: endDate })
    // Bilingual ZATCA-styled boxes only make sense for Saudi filers — every
    // other VAT/GST country gets the same box logic in plain English.
    const bilingual = taxCountry === 'SA'
    const taxName = settings.tax?.name || 'VAT'

    // Ledger cross-check: the return is built from documents; the ledgers were
    // posted by the same documents. Any difference means a manual JE touched
    // the VAT accounts and deserves a look before filing.
    let outMove = 0, inMove = 0
    journalEntries.forEach((je) => {
      if (je.type === 'vat_settlement') return
      if (je.date < startDate || je.date > endDate) return
      je.lines.forEach((l) => {
        if (l.accountId === 'acc-vatout') outMove += (l.credit || 0) - (l.debit || 0)
        if (l.accountId === 'acc-vatin') inMove += (l.debit || 0) - (l.credit || 0)
      })
    })
    const outDiff = Math.round((outMove - ret.outputVat) * 100) / 100
    const inDiff = Math.round((inMove - ret.inputVat) * 100) / 100
    const reconciled = Math.abs(outDiff) < 0.02 && Math.abs(inDiff) < 0.02

    const settlement = journalEntries.find((je) => je.type === 'vat_settlement' && je.reference === `VAT ${startDate}..${endDate}`)

    const quarters = yearQuarters(Number(endDate.slice(0, 4)) || new Date().getFullYear())

    const cell = 'px-3 py-2.5 text-right font-mono tabular-nums'
    const Row = ({ n, label, ar, line, bold, strong, na }) => (
      <tr className={`border-b border-gray-100 dark:border-slate-700/50 ${strong ? 'bg-gray-50 dark:bg-slate-800/60' : ''}`}>
        <td className="px-4 py-2.5 text-gray-400 dark:text-slate-500 text-xs w-10">{n}</td>
        <td className={`px-2 py-2.5 ${bold ? 'font-bold text-gray-900 dark:text-slate-100' : 'text-gray-700 dark:text-slate-200'}`}>
          {label}{bilingual && <span className="block text-xs text-gray-400 dark:text-slate-500" dir="rtl">{ar}</span>}
        </td>
        {na ? (
          <td colSpan={3} className={`${cell} text-gray-300 dark:text-slate-600`}>—</td>
        ) : (
          <>
            <td className={`${cell} ${bold ? 'font-bold text-gray-900 dark:text-slate-100' : 'text-gray-700 dark:text-slate-200'}`}>{fmtMoney(line.amount, sym)}</td>
            <td className={`${cell} ${line.adjustment ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-slate-500'}`}>{line.adjustment ? fmtMoney(line.adjustment, sym) : '—'}</td>
            <td className={`${cell} ${bold ? 'font-bold text-gray-900 dark:text-slate-100' : 'text-gray-700 dark:text-slate-200'}`}>{line.vat ? fmtMoney(line.vat, sym) : '—'}</td>
          </>
        )}
      </tr>
    )
    const SectionHead = ({ label, ar }) => (
      <tr className="bg-brand-50/60 dark:bg-brand-500/[0.08]">
        <td colSpan={5} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
          {label} {bilingual && <span className="font-normal text-brand-400 dark:text-brand-500 ms-2" dir="rtl">{ar}</span>}
        </td>
      </tr>
    )

    const [settleOpen, setSettleOpen] = useState(false)
    const [settleDate, setSettleDate] = useState(new Date().toISOString().slice(0, 10))
    const [settleBank, setSettleBank] = useState(bankAccounts.find((b) => b.isDefault)?.accountId || bankAccounts[0]?.accountId || 'acc-bank1')
    const doSettle = () => {
      try {
        settleVat({ date: settleDate, from: startDate, to: endDate, bankAccountId: settleBank, outputVat: ret.outputVat, inputVat: ret.inputVat })
        setSettleOpen(false)
      } catch (e) {
        alert(e.message === 'VAT_NOTHING_TO_SETTLE' ? t('There is no VAT to settle in this period.') : e.message)
      }
    }

    return (
      <Card>
        <div className="p-6 border-b border-gray-100 dark:border-slate-700 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name}</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {taxName} {t('Return')}{bilingual && <> · <span dir="rtl">إقرار ضريبة القيمة المضافة</span></>} — <span dir="ltr" className="inline-block">{fmtDate(startDate)} {t('to')} {fmtDate(endDate)}</span>
            </p>
            <div className="flex gap-1.5 mt-3 print:hidden">
              {quarters.map((q) => {
                const activeQ = startDate === q.from && endDate === q.to
                return (
                  <button key={q.id} onClick={() => { setStartDate(q.from); setEndDate(q.to) }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${activeQ ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'}`}>
                    {q.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="text-right text-xs text-gray-400 dark:text-slate-500">
            {bilingual && settings.zatca?.vatNumber && <p className="font-mono">{t('VAT No')}: {settings.zatca.vatNumber}</p>}
            {!bilingual && settings.company.taxId && <p className="font-mono">{t('Tax Registration Number')}: {settings.company.taxId}</p>}
            <p>{t('Standard rate')}: {settings.tax?.rate ?? 15}%</p>
            {settlement && (
              <p className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300 font-semibold">
                {t('Settled')} · {fmtDate(settlement.date)}
              </p>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-gray-50 dark:bg-slate-800/60">
              <tr className="text-xs text-gray-400 dark:text-slate-500 uppercase">
                <th className="px-4 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">{t('Description')}</th>
                <th className="px-3 py-2 text-right">{t('Amount')} ({sym})</th>
                <th className="px-3 py-2 text-right">{t('Adjustment')}</th>
                <th className="px-3 py-2 text-right">{taxName} ({sym})</th>
              </tr>
            </thead>
            <tbody>
              <SectionHead label={`${taxName} on Sales`} ar="ضريبة القيمة المضافة على المبيعات" />
              <Row n="1" label="Standard rated sales" ar="المبيعات الخاضعة للنسبة الأساسية" line={ret.sales.standard} />
              <Row n="2" label="Zero-rated domestic sales" ar="المبيعات المحلية الخاضعة لنسبة الصفر" line={ret.sales.zero} />
              <Row n="3" label="Exports" ar="الصادرات" na />
              <Row n="4" label="Exempt sales" ar="المبيعات المعفاة" line={ret.sales.exempt} />
              <Row n="5" label="Total sales" ar="إجمالي المبيعات" line={ret.sales.total} bold strong />
              <SectionHead label={`${taxName} on Purchases`} ar="ضريبة القيمة المضافة على المشتريات" />
              <Row n="6" label="Standard rated domestic purchases" ar="المشتريات المحلية الخاضعة للنسبة الأساسية" line={ret.purchases.standard} />
              <Row n="7" label={`Imports subject to ${taxName} (paid at customs)`} ar="الاستيرادات الخاضعة للضريبة المدفوعة في الجمارك" na />
              <Row n="8" label="Imports subject to reverse charge" ar="الاستيرادات الخاضعة لآلية الاحتساب العكسي" na />
              <Row n="9" label="Zero-rated purchases" ar="المشتريات الخاضعة لنسبة الصفر" line={ret.purchases.zero} />
              <Row n="10" label="Exempt purchases" ar="المشتريات المعفاة" line={ret.purchases.exempt} />
              <Row n="11" label="Total purchases" ar="إجمالي المشتريات" line={ret.purchases.total} bold strong />
              <SectionHead label="Summary" ar="الملخص" />
              <Row n="12" label={`Total ${taxName} due for current period`} ar="إجمالي الضريبة المستحقة عن الفترة الحالية" line={{ amount: ret.outputVat, adjustment: 0, vat: 0 }} bold />
              <Row n="13" label={`Recoverable input ${taxName}`} ar="ضريبة المدخلات القابلة للخصم" line={{ amount: ret.inputVat, adjustment: 0, vat: 0 }} bold />
              <Row n="14" label={`Net ${taxName} due / (reclaimable)`} ar="صافي الضريبة المستحقة (أو القابلة للاسترداد)" line={{ amount: ret.netVat, adjustment: 0, vat: 0 }} bold strong />
            </tbody>
          </table>
        </div>

        {/* Ledger reconciliation check */}
        <div className={`mx-6 my-4 px-4 py-3 rounded-xl text-sm flex items-start gap-2.5 ${reconciled ? 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'}`}>
          <span className="font-bold">{reconciled ? '✓' : '⚠'}</span>
          <span>
            {reconciled
              ? t('Ledger check passed — the VAT control accounts agree with this return.')
              : <>{t('Ledger check: the VAT control accounts differ from this return')} (
                  {outDiff !== 0 && <>Output {fmtMoney(outDiff, sym)}</>}{outDiff !== 0 && inDiff !== 0 && ' · '}{inDiff !== 0 && <>Input {fmtMoney(inDiff, sym)}</>}
                ). {t('A manual journal probably touched the VAT accounts — review before filing.')}</>}
          </span>
        </div>

        <div className={`p-5 flex flex-wrap items-center justify-between gap-3 ${ret.netVat >= 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-green-50 dark:bg-green-900/20'}`}>
          <div>
            <span className="font-bold text-gray-800 dark:text-slate-100">
              {bilingual
                ? (ret.netVat >= 0 ? t('VAT Payable to ZATCA') : t('VAT Reclaimable from ZATCA'))
                : (ret.netVat >= 0 ? `${taxName} ${t('Payable')}` : `${taxName} ${t('Reclaimable')}`)}
            </span>
            <span className={`block sm:inline sm:ms-4 text-xl font-black ${ret.netVat >= 0 ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}>{fmtMoney(Math.abs(ret.netVat), sym)}</span>
          </div>
          {!settlement && (ret.outputVat !== 0 || ret.inputVat !== 0) && (
            settleOpen ? (
              <div className="flex flex-wrap items-end gap-2 print:hidden">
                <Input label={t('Settlement date')} type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} className="w-40" />
                <Select label={t('Bank account')} value={settleBank} onChange={(e) => setSettleBank(e.target.value)} className="w-48">
                  {bankAccounts.map((b) => <option key={b.id} value={b.accountId}>{b.name}</option>)}
                </Select>
                <Btn onClick={doSettle}>{t('Post settlement')}</Btn>
                <Btn variant="secondary" onClick={() => setSettleOpen(false)}>{t('Cancel')}</Btn>
              </div>
            ) : (
              <Btn variant="secondary" className="print:hidden" onClick={() => setSettleOpen(true)}>{t('Record settlement')}</Btn>
            )
          )}
        </div>
      </Card>
    )
  }

  // ─── Sales Tax Report (US-style: collected on sales, no input recovery) ──
  const SalesTaxReport = () => {
    const ret = buildSalesTaxReturn({ invoices, creditNotes }, { from: startDate, to: endDate })
    const taxName = settings.tax?.name || 'Sales Tax'
    const settlement = journalEntries.find((je) => je.type === 'vat_settlement' && je.reference === `VAT ${startDate}..${endDate}`)
    const [settleOpen, setSettleOpen] = useState(false)
    const [settleDate, setSettleDate] = useState(new Date().toISOString().slice(0, 10))
    const [settleBank, setSettleBank] = useState(bankAccounts.find((b) => b.isDefault)?.accountId || bankAccounts[0]?.accountId || 'acc-bank1')
    const doSettle = () => {
      try {
        settleVat({ date: settleDate, from: startDate, to: endDate, bankAccountId: settleBank, outputVat: ret.collected, inputVat: 0 })
        setSettleOpen(false)
      } catch (e) {
        alert(e.message === 'VAT_NOTHING_TO_SETTLE' ? t('There is no tax to settle in this period.') : e.message)
      }
    }
    const Row = ({ label, value, bold }) => (
      <div className={`flex items-center justify-between py-2.5 ${bold ? 'border-t-2 border-gray-300 dark:border-slate-600 mt-1 pt-3' : 'border-b border-gray-100 dark:border-slate-700/60'}`}>
        <span className={bold ? 'font-bold text-gray-900 dark:text-slate-100' : 'text-gray-600 dark:text-slate-300'}>{label}</span>
        <span className={`font-mono tabular-nums ${bold ? 'font-bold text-lg' : 'font-medium'} text-gray-800 dark:text-slate-100`}>{fmtMoney(value, sym)}</span>
      </div>
    )
    return (
      <Card>
        <div className="p-6 border-b border-gray-100 dark:border-slate-700">
          <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name}</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">{taxName} {t('Report')} — {fmtDate(startDate)} {t('to')} {fmtDate(endDate)}</p>
        </div>
        <div className="p-6">
          <Row label={t('Taxable sales')} value={ret.taxable} />
          <Row label={t('Exempt / zero-rated sales')} value={ret.exempt} />
          <Row label={t('Total sales')} value={ret.totalSales} bold />
          <div className="mt-5 rounded-xl bg-amber-50/70 dark:bg-amber-500/[0.08] p-4">
            <Row label={`${taxName} ${t('collected')}`} value={ret.collected} bold />
          </div>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-4">
            {t('Sales-tax model: tax collected on sales only — this app does not track input-tax recovery on purchases under this system, unlike VAT/GST.')}
          </p>
        </div>
        <div className="p-5 flex flex-wrap items-center justify-between gap-3 bg-red-50 dark:bg-red-900/20">
          <div>
            <span className="font-bold text-gray-800 dark:text-slate-100">{taxName} {t('due to remit')}</span>
            <span className="block sm:inline sm:ms-4 text-xl font-black text-red-700 dark:text-red-300">{fmtMoney(ret.collected, sym)}</span>
          </div>
          {settlement ? (
            <p className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300 font-semibold text-sm">
              {t('Settled')} · {fmtDate(settlement.date)}
            </p>
          ) : ret.collected !== 0 && (
            settleOpen ? (
              <div className="flex flex-wrap items-end gap-2 print:hidden">
                <Input label={t('Settlement date')} type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} className="w-40" />
                <Select label={t('Bank account')} value={settleBank} onChange={(e) => setSettleBank(e.target.value)} className="w-48">
                  {bankAccounts.map((b) => <option key={b.id} value={b.accountId}>{b.name}</option>)}
                </Select>
                <Btn onClick={doSettle}>{t('Post settlement')}</Btn>
                <Btn variant="secondary" onClick={() => setSettleOpen(false)}>{t('Cancel')}</Btn>
              </div>
            ) : (
              <Btn variant="secondary" className="print:hidden" onClick={() => setSettleOpen(true)}>{t('Record settlement')}</Btn>
            )
          )}
        </div>
      </Card>
    )
  }

  // ─── Analytical reports (Sales/Purchases/Expenses) ───────────────
  const inRange = (d) => (!startDate || d >= startDate) && (!endDate || d <= endDate)

  // ── Profitability ──
  // Margin needs the cost of each sale, which lives on the document (recorded
  // when it posted) or, for older documents, on its COGS journal entry.
  const marginData = useMemo(
    () => ({ invoices, creditNotes, journalEntries, inventoryItems }),
    [invoices, creditNotes, journalEntries, inventoryItems])

  const marginCust = useMemo(
    () => marginByCustomer(marginData, { from: startDate, to: endDate }),
    [marginData, startDate, endDate])

  const marginItem = useMemo(
    () => marginByItem(marginData, { from: startDate, to: endDate }),
    [marginData, startDate, endDate])

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

  // Margin reports rank by gross profit rather than revenue, and say plainly
  // when a figure leans on an apportioned cost rather than a recorded one.
  const fmtPct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`)

  const MarginNotice = ({ rows }) => {
    const s = marginSummary(rows)
    if (!rows.length) return null
    return (
      <div className="px-6 pt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-gray-500 dark:text-slate-400">
        <span>{t('Gross profit')}: <strong className="text-gray-800 dark:text-slate-100">{fmtMoney(s.profit, sym)}</strong> ({fmtPct(s.pct)})</span>
        {s.top5Share !== null && (
          <span>{t('Top 5 produce')} <strong className="text-gray-800 dark:text-slate-100">{fmtPct(s.top5Share)}</strong> {t('of gross profit')}</span>
        )}
        {s.lossMakers.length > 0 && (
          <span className="text-danger-600 dark:text-danger-400">
            {s.lossMakers.length} {s.lossMakers.length === 1 ? t('row loses money') : t('rows lose money')}
          </span>
        )}
        {s.estimatedRows > 0 && (
          <span className="text-warning-600 dark:text-warning-400">
            {s.estimatedRows} {t('row(s) use an apportioned cost — marked ~')}
          </span>
        )}
      </div>
    )
  }

  const marginRow = (r, first) => [
    r.estimated ? `~ ${first}` : first,
    fmtMoney(r.revenue, sym),
    fmtMoney(r.cost, sym),
    fmtMoney(r.profit, sym),
    fmtPct(r.pct),
  ]

  const MarginByCustomerReport = () => (
    <>
      <MarginNotice rows={marginCust} />
      <AnalyticalReport title="Margin by Customer"
        headers={['Customer', 'Revenue', 'Cost of Sales', 'Gross Profit', 'Margin %']}
        chartData={marginCust.filter((r) => r.profit > 0).map((r) => ({ name: r.label, value: r.profit }))}
        rows={marginCust.map((r) => marginRow(r, r.label))}
        totalsRow={['Total',
          fmtMoney(marginCust.reduce((s, r) => s + r.revenue, 0), sym),
          fmtMoney(marginCust.reduce((s, r) => s + r.cost, 0), sym),
          fmtMoney(marginCust.reduce((s, r) => s + r.profit, 0), sym),
          fmtPct(marginSummary(marginCust).pct)]} />
    </>
  )

  const MarginByItemReport = () => (
    <>
      <MarginNotice rows={marginItem} />
      <AnalyticalReport title="Margin by Item"
        headers={['Item', 'Qty', 'Revenue', 'Cost of Sales', 'Gross Profit', 'Margin %']}
        chartData={marginItem.filter((r) => r.profit > 0).map((r) => ({ name: r.label, value: r.profit }))}
        rows={marginItem.map((r) => [
          r.estimated ? `~ ${r.label}` : r.label,
          r.qty,
          fmtMoney(r.revenue, sym), fmtMoney(r.cost, sym), fmtMoney(r.profit, sym), fmtPct(r.pct),
        ])}
        totalsRow={['Total',
          marginItem.reduce((s, r) => s + r.qty, 0),
          fmtMoney(marginItem.reduce((s, r) => s + r.revenue, 0), sym),
          fmtMoney(marginItem.reduce((s, r) => s + r.cost, 0), sym),
          fmtMoney(marginItem.reduce((s, r) => s + r.profit, 0), sym),
          fmtPct(marginSummary(marginItem).pct)]} />
    </>
  )

  // ── Statement of Changes in Equity ──
  // Explains why equity moved, which a balance sheet cannot: it shows capital
  // at two dates and leaves the reader to guess whether the difference was
  // profit, an injection, or the owner taking money out.
  const EquityStatementReport = () => {
    const st = useMemo(() => buildEquityStatement(
      { accounts, journalEntries, balancesFor: getAllBalances },
      { start: startDate, end: endDate },
    ), [accounts, journalEntries, getAllBalances, startDate, endDate])

    const cols = useMemo(() => {
      const seen = []
      st.rows.forEach((r) => r.movements.forEach((m) => { if (!seen.includes(m.label)) seen.push(m.label) }))
      return seen
    }, [st])

    const amountFor = (row, label) => {
      const m = row.movements.find((x) => x.label === label)
      return m ? fmtMoney(m.amount, sym) : '—'
    }

    return (
      <Card>
        <div className="p-6 border-b border-gray-100 dark:border-slate-700">
          <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name}</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {t('Statement of Changes in Equity')} · {fmtDate(startDate)} — {fmtDate(endDate)}
          </p>
        </div>
        <Table headers={[t('Component'), { label: t('Opening'), right: true },
          ...cols.map((c) => ({ label: t(c), right: true })), { label: t('Closing'), right: true }]}>
          {st.rows.map((r) => (
            <Tr key={r.id}>
              <Td>
                <span className="font-medium text-gray-800 dark:text-slate-100">{t(r.name)}</span>
                <span className="text-xs text-gray-400 dark:text-slate-500 ms-2">{r.code}</span>
              </Td>
              <Td right className="tabular-nums">{fmtMoney(r.opening, sym)}</Td>
              {cols.map((c) => <Td key={c} right className="tabular-nums">{amountFor(r, c)}</Td>)}
              <Td right className="tabular-nums font-semibold">{fmtMoney(r.closing, sym)}</Td>
            </Tr>
          ))}
          <Tr className="font-bold bg-slate-50 dark:bg-surface-900/40">
            <Td>{t('Total equity')}</Td>
            <Td right className="tabular-nums">{fmtMoney(st.totals.opening, sym)}</Td>
            {cols.map((c) => (
              <Td key={c} right className="tabular-nums">
                {fmtMoney(st.rows.reduce((a, r) => a + (r.movements.find((m) => m.label === c)?.amount || 0), 0), sym)}
              </Td>
            ))}
            <Td right className="tabular-nums">{fmtMoney(st.totals.closing, sym)}</Td>
          </Tr>
        </Table>
        <div className={`px-6 py-3 text-xs ${st.reconciles
          ? 'text-gray-400 dark:text-slate-500'
          : 'text-danger-600 dark:text-danger-400 bg-danger-50/60 dark:bg-danger-500/[0.07]'}`}>
          {st.reconciles
            ? `${t('Agrees with equity on the balance sheet')}: ${fmtMoney(st.balanceSheetEquity, sym)}`
            : `${t('Does not agree with the balance sheet — difference')}: ${fmtMoney(st.difference, sym)}`}
        </div>
      </Card>
    )
  }

  // ── IFRS 9 expected credit losses ──
  const EclReport = () => {
    const a = useMemo(() => eclAssessment(endDate), [eclAssessment, endDate, journalEntries, invoices])
    return (
      <Card>
        <div className="p-6 border-b border-gray-100 dark:border-slate-700 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name}</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {t('Expected Credit Losses (IFRS 9)')} · {t('as at')} {fmtDate(endDate)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 dark:text-slate-400">{t('Allowance required')}</p>
            <p className="text-xl font-semibold tabular-nums text-gray-900 dark:text-slate-100">{fmtMoney(a.required, sym)}</p>
          </div>
        </div>

        <Table headers={[t('Ageing bucket'), { label: t('Exposure'), right: true },
          { label: t('Loss rate'), right: true }, { label: t('Expected loss'), right: true }]}>
          {a.ecl.rows.map((r) => (
            <Tr key={r.key}>
              <Td className="text-gray-700 dark:text-slate-200">{t(r.label)}</Td>
              <Td right className="tabular-nums">{fmtMoney(r.exposure, sym)}</Td>
              <Td right className="tabular-nums text-gray-500 dark:text-slate-400">{r.rate}%</Td>
              <Td right className="tabular-nums font-medium">{fmtMoney(r.loss, sym)}</Td>
            </Tr>
          ))}
          <Tr className="font-bold bg-slate-50 dark:bg-surface-900/40">
            <Td>{t('Total')}</Td>
            <Td right className="tabular-nums">{fmtMoney(a.aged.grandTotal, sym)}</Td>
            <Td right>—</Td>
            <Td right className="tabular-nums">{fmtMoney(a.required, sym)}</Td>
          </Tr>
        </Table>

        <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-700 flex items-center justify-between gap-4 flex-wrap">
          <div className="text-xs text-gray-500 dark:text-slate-400 space-y-0.5">
            <p>{t('Already provided')}: <strong className="text-gray-800 dark:text-slate-100">{fmtMoney(a.existing, sym)}</strong></p>
            <p>{t('Movement to post')}: <strong className={a.movement >= 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-700 dark:text-success-400'}>{fmtMoney(a.movement, sym)}</strong></p>
            <p className="pt-1 max-w-lg">{t('Rates come from Settings and should reflect your own collection history, as IFRS 9 requires. Only the movement is posted, never the whole allowance.')}</p>
          </div>
          {a.movement !== 0 && (
            <Btn onClick={() => {
              try { postEclProvision({ asOf: endDate }) }
              catch (e) { alert(t('Could not post the provision: ') + e.message) }
            }}>{t('Post provision')}</Btn>
          )}
        </div>
      </Card>
    )
  }

  const DeferredTaxReport = () => {
    const a = useMemo(() => deferredTaxAssessment(endDate),
      [deferredTaxAssessment, endDate, journalEntries])
    const etr = useMemo(() => taxRateReconciliation(startDate, endDate),
      [taxRateReconciliation, startDate, endDate, journalEntries])
    const cfg = settings.deferredTax || {}

    // A temporary difference only carries deferred tax once there is a rate to
    // apply to it, and the rate is a fact about the jurisdiction that this
    // application cannot infer from the books.
    if (!cfg.ratePct) {
      return (
        <Card className="p-6">
          <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{t('Deferred Tax (IAS 12)')}</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-2 max-w-xl">
            {t('Set your tax rate and capital allowance rate in Settings first. Until then there is nothing to measure — a temporary difference only carries deferred tax once there is a rate to apply to it.')}
          </p>
        </Card>
      )
    }

    return (
      <Card>
        <div className="p-6 border-b border-gray-100 dark:border-slate-700 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-bold text-gray-800 dark:text-slate-100 text-lg">{company.name}</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {t('Deferred Tax (IAS 12)')} · {t('as at')} {fmtDate(endDate)} · {cfg.ratePct}%
            </p>
          </div>
          <div className="text-end">
            <p className="text-xs text-gray-500 dark:text-slate-400">
              {a.net >= 0 ? t('Net deferred tax liability') : t('Net deferred tax asset')}
            </p>
            <p className="text-xl font-semibold tabular-nums text-gray-900 dark:text-slate-100">
              {fmtMoney(Math.abs(a.net), sym)}
            </p>
          </div>
        </div>

        <Table headers={[t('Temporary difference'), { label: t('Carrying amount'), right: true },
          { label: t('Tax base'), right: true }, { label: t('Difference'), right: true },
          { label: t('Deferred tax'), right: true }]}>
          {a.rows.map((r, i) => (
            <Tr key={`${r.source}-${i}`}>
              <Td className="text-gray-700 dark:text-slate-200">
                {t(r.label)}
                {r.detail && <span className="text-xs text-gray-400 dark:text-slate-500 ms-2">{r.detail}</span>}
              </Td>
              <Td right className="tabular-nums">{fmtMoney(r.carrying, sym)}</Td>
              <Td right className="tabular-nums">{fmtMoney(r.taxBase, sym)}</Td>
              {/* Labelled, not merely signed. "Taxable" and "deductible" are
                  the standard's own words and the only reliable way a reader
                  tells an asset from a liability at a glance. */}
              <Td right className="tabular-nums">
                {fmtMoney(Math.abs(r.difference), sym)}
                <span className="text-xs text-gray-400 dark:text-slate-500 ms-1">
                  {r.type === 'taxable' ? t('taxable') : r.type === 'deductible' ? t('deductible') : ''}
                </span>
              </Td>
              <Td right className={`tabular-nums font-medium ${r.deferredTax > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-700 dark:text-success-400'}`}>
                {fmtMoney(Math.abs(r.deferredTax), sym)}
              </Td>
            </Tr>
          ))}
          <Tr className="font-bold bg-slate-50 dark:bg-surface-900/40">
            <Td>{t('Gross deferred tax liability')}</Td>
            <Td right>—</Td><Td right>—</Td><Td right>—</Td>
            <Td right className="tabular-nums">{fmtMoney(a.grossLiability, sym)}</Td>
          </Tr>
          <Tr className="font-bold bg-slate-50 dark:bg-surface-900/40">
            <Td>{t('Gross deferred tax asset')}</Td>
            <Td right>—</Td><Td right>—</Td><Td right>—</Td>
            <Td right className="tabular-nums">{fmtMoney(a.grossAsset, sym)}</Td>
          </Tr>
        </Table>

        <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-700 flex items-start justify-between gap-4 flex-wrap">
          <div className="text-xs text-gray-500 dark:text-slate-400 space-y-0.5 max-w-xl">
            {a.unrecognisedAsset > 0 && (
              <p className="text-amber-700 dark:text-amber-400">
                {t('Deferred tax asset not recognised')}: <strong>{fmtMoney(a.unrecognisedAsset, sym)}</strong>
                {' — '}{t('recognised only so far as future taxable profit is probable (IAS 12.24).')}
              </p>
            )}
            <p>{t('On the balance sheet')}: {a.presented.liability > 0
              ? `${t('liability')} ${fmtMoney(a.presented.liability, sym)}`
              : a.presented.asset > 0 ? `${t('asset')} ${fmtMoney(a.presented.asset, sym)}` : fmtMoney(0, sym)}
              {a.presented.offset ? ` · ${t('offset (IAS 12.74)')}` : ` · ${t('shown gross')}`}</p>
            <p>{t('Already recognised')}: <strong className="text-gray-800 dark:text-slate-100">
              {fmtMoney(a.existing.liability - a.existing.asset, sym)}</strong></p>
            <p>{t('Movement to post')}: <strong className={a.charge >= 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-700 dark:text-success-400'}>
              {fmtMoney(a.charge, sym)}</strong></p>
            <p className="pt-1">{t('Only the movement is posted, never the whole position. Deferred tax is not discounted (IAS 12.53).')}</p>
          </div>
          {a.charge !== 0 && (
            <Btn onClick={() => {
              try { postDeferredTax({ asOf: endDate }) }
              catch (e) { alert(t('Could not post deferred tax: ') + e.message) }
            }}>{t('Post deferred tax')}</Btn>
          )}
        </div>

        {/* IAS 12.81(c) — the disclosure an auditor turns to first, because it
            is where anything unusual in the tax charge has to be explained
            rather than buried inside a single line. */}
        <div className="border-t border-gray-100 dark:border-slate-700">
          <div className="px-6 pt-5 pb-2">
            <h4 className="font-semibold text-gray-800 dark:text-slate-100">{t('Reconciliation of the tax charge')}</h4>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              {t('Accounting profit')} {fmtMoney(etr.accountingProfit, sym)} · {t('effective rate')} {etr.effectiveRate}%
            </p>
          </div>
          <Table headers={[t('Explanation'), { label: t('Amount'), right: true }]}>
            {etr.lines.map((l, i) => (
              <Tr key={i}>
                <Td className="text-gray-700 dark:text-slate-200">{t(l.label)}</Td>
                <Td right className="tabular-nums">{fmtMoney(l.amount, sym)}</Td>
              </Tr>
            ))}
            <Tr className="font-bold bg-slate-50 dark:bg-surface-900/40">
              <Td>{t('Total tax charge')}</Td>
              <Td right className="tabular-nums">{fmtMoney(etr.totalTax, sym)}</Td>
            </Tr>
          </Table>
          {!etr.reconciles && (
            <p className="px-6 py-3 text-xs text-amber-700 dark:text-amber-400">
              {t('Part of the charge could not be explained. It is shown as an unexplained difference rather than absorbed into another line — a reconciliation that always closes proves nothing.')}
            </p>
          )}
        </div>
      </Card>
    )
  }

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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
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

  const reportTitle = REPORTS_LIST.find((r) => r.id === report)?.label || 'Report'
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
              {[...new Set(REPORTS_LIST.map((r) => r.group || 'Reports'))].map((g) => (
                <optgroup key={g} label={t(g)}>
                  {REPORTS_LIST.filter((r) => (r.group || 'Reports') === g).map((r) => (
                    <option key={r.id} value={r.id}>{t(r.label)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <Input label="From" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
          <Input label="To" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
          {(report === 'pl' || report === 'bs') && (
            <div className="print:hidden">
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">{t('Compare with')}</label>
              <select className="border border-slate-300/90 dark:border-surface-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 shadow-input dark:shadow-none focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 cursor-pointer transition-all duration-150"
                value={compareBasis} onChange={(e) => setCompareBasis(e.target.value)}>
                <option value="none">{t('No comparison')}</option>
                <option value="previous">{t('Previous period')}</option>
                <option value="lastYear">{t('Same period last year')}</option>
              </select>
            </div>
          )}
          {rx && <ExportMenu filename={rx.filename} title={t(reportTitle)} subtitle={`${fmtDate(startDate)} — ${fmtDate(endDate)}`} rows={rx.rows} columns={rx.columns} />}
          <Btn variant="secondary" onClick={() => window.print()}>{t('Print / Export')}</Btn>
        </div>
      </Card>

      <div className="print:pt-0">
        {report === 'pl' && <PLReport />}
        {report === 'bs' && <BSReport />}
        {report === 'cf' && <CFReport />}
        {report === 'vat' && (taxSystem === 'sales_tax' ? <SalesTaxReport /> : <VATReport />)}
        {report === 'tb' && <TBReport />}
        {report === 'gl' && <GLReport />}
        {report === 'ar' && <ARReport />}
        {report === 'ecl' && <EclReport />}
        {report === 'deferred-tax' && <DeferredTaxReport />}
        {report === 'soce' && <EquityStatementReport />}
        {report === 'ap' && <APReport />}
        {report === 'sales-cust' && <SalesByCustomerReport />}
        {report === 'sales-item' && <SalesByItemReport />}
        {report === 'purch-supp' && <PurchasesBySupplierReport />}
        {report === 'exp-cat' && <ExpenseByCategoryReport />}
        {report === 'margin-cust' && <MarginByCustomerReport />}
        {report === 'margin-item' && <MarginByItemReport />}
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
