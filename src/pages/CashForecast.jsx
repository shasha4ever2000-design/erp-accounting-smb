import { useMemo, useState, lazy, Suspense } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { buildForecast, bySource, SOURCES, ALL_SOURCES, CERTAINTY } from '../utils/cashForecast'
import { PageHeader, Card, Badge, Table, Tr, Td, EmptyState } from '../components/UI'
import ExportMenu from '../components/ExportMenu'
import {
  CalendarClock, TrendingDown, TrendingUp, AlertTriangle, ShieldCheck,
  Wallet, ChevronDown, ChevronRight, Info,
} from 'lucide-react'

// recharts is ~400 KB; it stays out of the entry bundle (see TrendChart.jsx)
const TrendChart = lazy(() => import('../components/TrendChart'))

// How firm a projected number is. Shown next to every figure, because the
// difference between "an invoice we have issued" and "our guess at payroll"
// is the difference between a decision you can make and one you cannot.
const CERTAINTY_CHIP = {
  [CERTAINTY.COMMITTED]: { label: 'Committed', cls: 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300' },
  [CERTAINTY.SCHEDULED]: { label: 'Scheduled', cls: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' },
  [CERTAINTY.ESTIMATED]: { label: 'Estimated', cls: 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300' },
}

export default function CashForecast() {
  const t = useT()
  const store = useStore()
  const {
    invoices, purchases, cheques = [], recurringInvoices = [], recurringExpenses = [],
    leases = [], employees = [], scheduledTransfers = [], accounts, bankAccounts,
    getAllBalances, settings,
  } = store
  const sym = settings.company.currencySymbol

  const [weeks, setWeeks]                 = useState(13)
  const [include, setInclude]             = useState(ALL_SOURCES)
  const [collectOverdue, setCollect]      = useState(false)
  const [openWeek, setOpenWeek]           = useState(null)

  // Opening position: every cash and bank account, at today's balance.
  const openingCash = useMemo(() => {
    const bals = getAllBalances()
    const natural = (a) => {
      const b = bals[a.id] || { dr: 0, cr: 0 }
      return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr
    }
    const bankIds = new Set(bankAccounts.map((b) => b.accountId))
    return accounts
      .filter((a) => a.type === 'asset' && (bankIds.has(a.id) || a.id === 'acc-cash'))
      .reduce((s, a) => s + natural(a), 0)
  }, [accounts, bankAccounts, getAllBalances])

  const forecast = useMemo(() => buildForecast(
    { invoices, purchases, cheques, recurringInvoices, recurringExpenses, leases, employees, scheduledTransfers, accounts, settings },
    { from: today(), weeks, openingCash, include, collectOverdue },
  ), [invoices, purchases, cheques, recurringInvoices, recurringExpenses, leases, employees,
      scheduledTransfers, accounts, settings, weeks, openingCash, include, collectOverdue])

  const contributions = useMemo(() => bySource(forecast), [forecast])

  const chartData = useMemo(() => forecast.weeks.map((w) => ({
    week: `W${w.index}`,
    closing: w.closing,
    inflows: w.inflows,
    outflows: -w.outflows,
  })), [forecast])

  const toggle = (key) => setInclude((cur) =>
    cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key])

  const exportRows = () => forecast.weeks.map((w) => ({
    Week: w.index, From: w.start, To: w.end,
    Opening: w.opening, Inflows: w.inflows, Outflows: w.outflows, Net: w.net, Closing: w.closing,
  }))

  const hasAnything = forecast.weeks.some((w) => w.events.length) || forecast.overdue.events.length

  // ── The headline: does the business run out of money, and when? ──
  const verdict = forecast.shortfall
    ? {
        tone: 'danger',
        icon: AlertTriangle,
        title: t('Projected shortfall'),
        line: `${t('Cash goes negative in week')} ${forecast.shortfall.week} (${fmtDate(forecast.shortfall.date)}), ${t('reaching')} ${fmtMoney(forecast.lowest.amount, sym)}.`,
        sub: forecast.runwayWeeks === 0
          ? t('You are short this week. Act now: chase overdue receipts or defer a payment.')
          : `${t('Runway:')} ${forecast.runwayWeeks} ${forecast.runwayWeeks === 1 ? t('week') : t('weeks')}.`,
      }
    : {
        tone: 'success',
        icon: ShieldCheck,
        title: t('No shortfall projected'),
        line: `${t('Cash stays positive for all')} ${weeks} ${t('weeks, with a low point of')} ${fmtMoney(forecast.lowest?.amount ?? 0, sym)}.`,
        sub: t('This covers only what the books already know — it is not a guarantee beyond the window.'),
      }

  const VerdictIcon = verdict.icon

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Cash Forecast')}
        subtitle={`${t('Projected cash position for the next')} ${weeks} ${t('weeks, from what is already in the books')}`}
        action={<ExportMenu rows={exportRows()} filename="cash-forecast" title={t('Cash Forecast')} />}
      />

      {!hasAnything ? (
        <EmptyState
          icon={CalendarClock}
          title={t('Nothing to forecast yet')}
          desc={t('Once you have unpaid invoices, supplier bills, cheques or recurring schedules, this page will project your cash position week by week.')}
        />
      ) : (
        <>
          {/* ── Verdict ── */}
          <Card className={`p-5 border-s-4 ${verdict.tone === 'danger'
            ? 'border-s-danger-500 bg-danger-50/50 dark:bg-danger-500/[0.07]'
            : 'border-s-success-500 bg-success-50/50 dark:bg-success-500/[0.07]'}`}>
            <div className="flex items-start gap-3">
              <VerdictIcon size={22} className={verdict.tone === 'danger' ? 'text-danger-600 dark:text-danger-400 mt-0.5' : 'text-success-600 dark:text-success-400 mt-0.5'} />
              <div className="min-w-0">
                <h2 className="font-semibold text-gray-900 dark:text-slate-100">{verdict.title}</h2>
                <p className="text-sm text-gray-700 dark:text-slate-300 mt-0.5">{verdict.line}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{verdict.sub}</p>
              </div>
            </div>
          </Card>

          {/* ── Position summary ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Summary label={t('Cash today')} value={fmtMoney(forecast.openingCash, sym)} icon={Wallet} tone="slate" />
            <Summary label={t('Expected in')} value={fmtMoney(forecast.totalIn, sym)} icon={TrendingUp} tone="success" />
            <Summary label={t('Expected out')} value={fmtMoney(forecast.totalOut, sym)} icon={TrendingDown} tone="danger" />
            <Summary
              label={`${t('Cash in')} ${weeks} ${t('weeks')}`}
              value={fmtMoney(forecast.closingCash, sym)}
              icon={CalendarClock}
              tone={forecast.closingCash < 0 ? 'danger' : 'brand'}
            />
          </div>

          {/* ── Overdue: real money, unknowable timing ── */}
          {forecast.overdue.events.length > 0 && (
            <Card className="p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-2.5 min-w-0">
                  <Info size={16} className="text-warning-600 dark:text-warning-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-slate-100">
                      {t('Past due and not yet settled')}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 max-w-xl">
                      {t('This money was due before today, so its timing is unknown. It is kept out of the weekly projection rather than assumed to arrive — turn it on only if you expect to collect it now.')}
                    </p>
                    <p className="text-sm mt-2 tabular-nums">
                      <span className="text-success-700 dark:text-success-400 font-medium">
                        +{fmtMoney(forecast.overdue.inflows, sym)}
                      </span>
                      <span className="text-gray-400 dark:text-slate-500 mx-2">·</span>
                      <span className="text-danger-600 dark:text-danger-400 font-medium">
                        −{fmtMoney(forecast.overdue.outflows, sym)}
                      </span>
                      <span className="text-gray-400 dark:text-slate-500 mx-2">·</span>
                      <span className="text-gray-700 dark:text-slate-200">
                        {t('net')} {fmtMoney(forecast.overdue.net, sym)}
                      </span>
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={collectOverdue}
                    onChange={(e) => setCollect(e.target.checked)}
                    className="rounded border-gray-300 dark:border-slate-600 text-brand-600 focus:ring-brand-500"
                  />
                  {t('Assume collected now')}
                </label>
              </div>
            </Card>
          )}

          {/* ── Chart ── */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-gray-800 dark:text-slate-100 text-sm">{t('Projected closing cash')}</h3>
              <div className="flex gap-1.5">
                {[4, 8, 13, 26].map((n) => (
                  <button
                    key={n}
                    onClick={() => { setWeeks(n); setOpenWeek(null) }}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      weeks === n
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white dark:bg-surface-800 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-surface-700 hover:border-brand-300'
                    }`}
                  >{n}{t('w')}</button>
                ))}
              </div>
            </div>
            <Suspense fallback={<div className="h-[220px] animate-pulse bg-slate-100 dark:bg-surface-800 rounded-lg" />}>
              <TrendChart
                data={chartData}
                xKey="week"
                height={220}
                series={[{ key: 'closing', stroke: forecast.shortfall ? '#e11d48' : '#2563eb', gradientId: 'cashClosing' }]}
                formatValue={(v) => fmtMoney(v, sym)}
                formatAxis={(v) => `${sym}${Math.round(v / 1000)}k`}
              />
            </Suspense>
          </Card>

          {/* ── What is being projected ── */}
          <Card className="p-4">
            <h3 className="font-semibold text-gray-800 dark:text-slate-100 text-sm mb-1">{t('What this includes')}</h3>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
              {t('Switch a source off to see the position without it.')}
            </p>
            <div className="flex flex-wrap gap-2">
              {SOURCES.map((s) => {
                const active = include.includes(s.key)
                const row = contributions.find((c) => c.source === s.key)
                const chip = CERTAINTY_CHIP[s.certainty]
                return (
                  <button
                    key={s.key}
                    onClick={() => toggle(s.key)}
                    aria-pressed={active}
                    className={`text-start px-3 py-2 rounded-xl border transition-all ${
                      active
                        ? 'bg-white dark:bg-surface-800 border-gray-200 dark:border-surface-700'
                        : 'bg-slate-50 dark:bg-surface-900 border-dashed border-gray-300 dark:border-surface-700 opacity-55'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${s.dir === 'in' ? 'bg-success-500' : 'bg-danger-500'}`} />
                      <span className="text-sm font-medium text-gray-800 dark:text-slate-100">{t(s.label)}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${chip.cls}`}>{t(chip.label)}</span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-slate-400 mt-1 tabular-nums ms-4">
                      {row
                        ? `${fmtMoney(row.inflow || row.outflow, sym)} · ${row.count} ${row.count === 1 ? t('item') : t('items')}`
                        : t('nothing due')}
                    </div>
                  </button>
                )
              })}
            </div>
          </Card>

          {/* ── Week by week ── */}
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-surface-750">
              <h3 className="font-semibold text-gray-800 dark:text-slate-100 text-sm">{t('Week by week')}</h3>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{t('Select a week to see every movement behind it.')}</p>
            </div>
            <Table headers={[t('Week'), t('Period'), t('Opening'), t('In'), t('Out'), t('Net'), t('Closing')]}>
              {forecast.weeks.map((w) => {
                const isOpen = openWeek === w.index
                const negative = w.closing < 0
                return [
                  <Tr key={w.index} onClick={() => setOpenWeek(isOpen ? null : w.index)}
                    className={negative ? 'bg-danger-50/60 dark:bg-danger-500/[0.07]' : ''}>
                    <Td>
                      <span className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-slate-200">
                        {w.events.length > 0
                          ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} className="rtl:-scale-x-100" />)
                          : <span className="w-[13px]" />}
                        {w.index}
                      </span>
                    </Td>
                    <Td className="text-gray-500 dark:text-slate-400 text-sm whitespace-nowrap">
                      {fmtDate(w.start)} – {fmtDate(w.end)}
                    </Td>
                    <Td right className="tabular-nums text-gray-500 dark:text-slate-400">{fmtMoney(w.opening, sym)}</Td>
                    <Td right className="tabular-nums text-success-700 dark:text-success-400">
                      {w.inflows ? fmtMoney(w.inflows, sym) : '—'}
                    </Td>
                    <Td right className="tabular-nums text-danger-600 dark:text-danger-400">
                      {w.outflows ? fmtMoney(w.outflows, sym) : '—'}
                    </Td>
                    <Td right className={`tabular-nums font-medium ${w.net >= 0 ? 'text-gray-700 dark:text-slate-200' : 'text-danger-600 dark:text-danger-400'}`}>
                      {fmtMoney(w.net, sym)}
                    </Td>
                    <Td right className={`tabular-nums font-semibold ${negative ? 'text-danger-600 dark:text-danger-400' : 'text-gray-900 dark:text-slate-100'}`}>
                      {fmtMoney(w.closing, sym)}
                    </Td>
                  </Tr>,
                  isOpen && w.events.length > 0 && (
                    <tr key={`${w.index}-detail`} className="bg-slate-50 dark:bg-surface-900/60">
                      <td colSpan={7} className="px-4 py-3">
                        <ul className="space-y-1.5">
                          {w.events.map((e, i) => {
                            const chip = CERTAINTY_CHIP[e.certainty]
                            return (
                              <li key={i} className="flex items-center gap-2 text-sm flex-wrap">
                                <span className="text-gray-400 dark:text-slate-500 text-xs w-20 flex-shrink-0 tabular-nums">{fmtDate(e.date)}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${chip.cls}`}>{t(chip.label)}</span>
                                <span className="text-gray-700 dark:text-slate-200 truncate">{e.label}</span>
                                {e.ref && <Badge className="bg-slate-100 dark:bg-surface-700 text-slate-500 dark:text-slate-400">{e.ref}</Badge>}
                                <span className={`ms-auto tabular-nums font-medium ${e.amount > 0 ? 'text-success-700 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
                                  {e.amount > 0 ? '+' : '−'}{fmtMoney(Math.abs(e.amount), sym)}
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </Table>
          </Card>

          <p className="text-xs text-gray-400 dark:text-slate-500 px-1">
            {t('Projected from unpaid invoices and bills, dated cheques, recurring schedules, lease commitments and active payroll. Transfers between your own bank accounts are excluded because they do not change total cash.')}
          </p>
        </>
      )}
    </div>
  )
}

function Summary({ label, value, icon: Icon, tone }) {
  const tones = {
    slate:   'text-slate-600 dark:text-slate-300',
    success: 'text-success-700 dark:text-success-400',
    danger:  'text-danger-600 dark:text-danger-400',
    brand:   'text-brand-700 dark:text-brand-400',
  }
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-gray-500 dark:text-slate-400 mb-1">
        <Icon size={14} />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={`text-xl font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
    </Card>
  )
}
