import { useState, useMemo } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Select, Input, Table, Tr, Td } from '../components/UI'
import { useT } from '../i18n'
import ExportMenu from '../components/ExportMenu'
import { format, startOfYear, endOfYear } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts'

const REPORTS = [
  { id: 'pl', label: 'Income Statement (P&L)' },
  { id: 'bs', label: 'Balance Sheet' },
  { id: 'cf', label: 'Cash Flow Statement' },
  { id: 'vat', label: 'VAT Return (ZATCA)' },
  { id: 'tb', label: 'Trial Balance' },
  { id: 'gl', label: 'General Ledger' },
  { id: 'ar', label: 'Accounts Receivable Aging' },
  { id: 'ap', label: 'Accounts Payable Aging' },
]

export default function Reports() {
  const { accounts, journalEntries, invoices, purchases, bankAccounts, getAllBalances, settings } = useStore()
  const t = useT()
  const sym = settings.company.currencySymbol
  const company = settings.company

  const thisYear = format(new Date(), 'yyyy')
  const [report, setReport] = useState('pl')
  const [startDate, setStartDate] = useState(`${thisYear}-01-01`)
  const [endDate, setEndDate] = useState(`${thisYear}-12-31`)

  const balances = useMemo(() => getAllBalances(startDate, endDate), [getAllBalances, startDate, endDate])
  const allBalances = useMemo(() => getAllBalances(), [getAllBalances])

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
          <div className="bg-green-50 rounded-xl p-4"><p className="text-sm text-green-600">{t('Total Revenue')}</p><p className="text-2xl font-bold text-green-700">{fmtMoney(totalRevenue, sym)}</p></div>
          <div className="bg-red-50 rounded-xl p-4"><p className="text-sm text-red-600">{t('Total Expenses')}</p><p className="text-2xl font-bold text-red-700">{fmtMoney(totalExpenses, sym)}</p></div>
          <div className={`${netProfit >= 0 ? 'bg-blue-50' : 'bg-orange-50'} rounded-xl p-4`}>
            <p className={`text-sm ${netProfit >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>Net {netProfit >= 0 ? 'Profit' : 'Loss'}</p>
            <p className={`text-2xl font-bold ${netProfit >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>{fmtMoney(Math.abs(netProfit), sym)}</p>
          </div>
        </div>

        <Card>
          <div className="p-6 border-b border-gray-100">
            <h3 className="font-bold text-gray-800 text-lg">{company.name}</h3>
            <p className="text-sm text-gray-500">Income Statement for the period {fmtDate(startDate)} to {fmtDate(endDate)}</p>
          </div>
          <div className="p-6">
            {/* Revenue */}
            <h4 className="font-bold text-green-700 text-sm uppercase tracking-wide mb-3">{t('Revenue')}</h4>
            {revenueAccs.length === 0 ? <p className="text-gray-400 text-sm mb-4">{t('No revenue for this period')}</p> : (
              <table className="w-full text-sm mb-4">
                <tbody>
                  {revenueAccs.map((a) => (
                    <tr key={a.id} className="border-b border-gray-50">
                      <td className="py-1.5 text-gray-600">{a.code} – {a.name}</td>
                      <td className="py-1.5 text-right font-medium text-gray-800">{fmtMoney(a.balance, sym)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-green-200 bg-green-50/50">
                    <td className="py-2 font-bold text-green-800">{t('Total Revenue')}</td>
                    <td className="py-2 text-right font-bold text-green-800">{fmtMoney(totalRevenue, sym)}</td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* Expenses */}
            <h4 className="font-bold text-red-700 text-sm uppercase tracking-wide mb-3 mt-6">{t('Expenses')}</h4>
            {expenseAccs.length === 0 ? <p className="text-gray-400 text-sm mb-4">{t('No expenses for this period')}</p> : (
              <table className="w-full text-sm mb-4">
                <tbody>
                  {expenseAccs.map((a) => (
                    <tr key={a.id} className="border-b border-gray-50">
                      <td className="py-1.5 text-gray-600">{a.code} – {a.name}</td>
                      <td className="py-1.5 text-right font-medium text-gray-800">{fmtMoney(a.balance, sym)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-red-200 bg-red-50/50">
                    <td className="py-2 font-bold text-red-800">{t('Total Expenses')}</td>
                    <td className="py-2 text-right font-bold text-red-800">{fmtMoney(totalExpenses, sym)}</td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* Net */}
            <div className={`border-t-4 border-gray-300 mt-4 pt-3 flex justify-between items-center`}>
              <span className="text-xl font-black text-gray-900">Net {netProfit >= 0 ? 'Profit' : 'Loss'}</span>
              <span className={`text-xl font-black ${netProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmtMoney(Math.abs(netProfit), sym)}</span>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  // ─── Balance Sheet ──────────────────────────────────────────────
  const BSReport = () => {
    const assetAccs = accounts.filter((a) => a.type === 'asset').map((a) => ({ ...a, balance: accountBalance(a.id, allBalances) })).filter((a) => a.balance !== 0)
    const liabAccs = accounts.filter((a) => a.type === 'liability').map((a) => ({ ...a, balance: accountBalance(a.id, allBalances) })).filter((a) => a.balance !== 0)
    const equityAccs = accounts.filter((a) => a.type === 'equity').map((a) => ({ ...a, balance: accountBalance(a.id, allBalances) })).filter((a) => a.balance !== 0)

    const totalAssets = assetAccs.reduce((s, a) => s + a.balance, 0)
    const totalLiabs = liabAccs.reduce((s, a) => s + a.balance, 0)
    const totalEquity = equityAccs.reduce((s, a) => s + a.balance, 0)

    // Net profit goes to retained earnings
    const revBals = getAllBalances(startDate, endDate)
    const netProfit = accounts.filter((a) => a.type === 'revenue').reduce((s, a) => s + accountBalance(a.id, revBals), 0)
                    - accounts.filter((a) => a.type === 'expense').reduce((s, a) => s + accountBalance(a.id, revBals), 0)
    const totalEquityAndProfit = totalEquity + netProfit

    const Section = ({ title, items, total, color }) => (
      <div className="mb-6">
        <h4 className={`font-bold text-sm uppercase tracking-wide mb-3 ${color}`}>{title}</h4>
        <table className="w-full text-sm">
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b border-gray-50">
                <td className="py-1.5 pl-3 text-gray-600">{a.code} – {a.name}</td>
                <td className="py-1.5 text-right font-medium text-gray-800">{fmtMoney(a.balance, sym)}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={2} className="py-2 pl-3 text-gray-400 text-sm">—</td></tr>}
            <tr className="border-t-2 border-gray-200">
              <td className="py-2 pl-3 font-bold text-gray-800">Total {title}</td>
              <td className="py-2 text-right font-bold text-gray-800">{fmtMoney(total, sym)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    )

    return (
      <Card>
        <div className="p-6 border-b border-gray-100">
          <h3 className="font-bold text-gray-800 text-lg">{company.name}</h3>
          <p className="text-sm text-gray-500">Balance Sheet as at {fmtDate(endDate)}</p>
        </div>
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <Section title="Assets" items={assetAccs} total={totalAssets} color="text-blue-700" />
          </div>
          <div>
            <Section title="Liabilities" items={liabAccs} total={totalLiabs} color="text-orange-700" />
            <Section title="Equity" items={[...equityAccs, netProfit !== 0 && { id: 'net', code: '', name: `Net ${netProfit >= 0 ? 'Profit' : 'Loss'} (Current Period)`, balance: netProfit }].filter(Boolean)} total={totalEquityAndProfit} color="text-purple-700" />
            <div className="border-t-4 border-gray-800 pt-3 flex justify-between">
              <span className="font-black text-gray-900">Total Liabilities + Equity</span>
              <span className={`font-black ${Math.abs(totalAssets - (totalLiabs + totalEquityAndProfit)) < 0.01 ? 'text-green-700' : 'text-red-600'}`}>
                {fmtMoney(totalLiabs + totalEquityAndProfit, sym)}
              </span>
            </div>
            {Math.abs(totalAssets - (totalLiabs + totalEquityAndProfit)) > 0.01 && (
              <p className="text-xs text-red-500 mt-1">⚠ Balance sheet is out of balance by {fmtMoney(Math.abs(totalAssets - (totalLiabs + totalEquityAndProfit)), sym)}</p>
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
        <div className="p-6 border-b border-gray-100">
          <h3 className="font-bold text-gray-800 text-lg">{company.name}</h3>
          <p className="text-sm text-gray-500">Trial Balance as at {fmtDate(endDate)}</p>
        </div>
        <div className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Code</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Account</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Debit</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Credit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-50">
                  <td className="px-6 py-2 font-mono text-gray-500 text-xs">{r.code}</td>
                  <td className="px-4 py-2 text-gray-700">{r.name}</td>
                  <td className="px-4 py-2 text-right font-mono text-gray-800">{r.netDr > 0 ? fmtMoney(r.netDr, sym) : ''}</td>
                  <td className="px-4 py-2 text-right font-mono text-gray-800">{r.netCr > 0 ? fmtMoney(r.netCr, sym) : ''}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                <td className="px-6 py-3" colSpan={2}>TOTALS</td>
                <td className={`px-4 py-3 text-right font-mono ${Math.abs(totalNetDr - totalNetCr) < 0.01 ? 'text-green-700' : 'text-red-600'}`}>{fmtMoney(totalNetDr, sym)}</td>
                <td className={`px-4 py-3 text-right font-mono ${Math.abs(totalNetDr - totalNetCr) < 0.01 ? 'text-green-700' : 'text-red-600'}`}>{fmtMoney(totalNetCr, sym)}</td>
              </tr>
            </tbody>
          </table>
          {Math.abs(totalNetDr - totalNetCr) < 0.01 && (
            <p className="px-6 py-3 text-xs text-green-600 font-medium">✓ Trial balance is balanced</p>
          )}
        </div>
      </Card>
    )
  }

  // ─── General Ledger ───────────────────────────────────────────
  const GLReport = () => {
    const [selectedAcc, setSelectedAcc] = useState(accounts[0]?.id || '')
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
        <div className="p-6 border-b border-gray-100 flex items-center gap-4">
          <div>
            <h3 className="font-bold text-gray-800 text-lg">{company.name} — General Ledger</h3>
            <p className="text-sm text-gray-500">{fmtDate(startDate)} to {fmtDate(endDate)}</p>
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
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">{t('Description')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Ref</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Debit</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Credit</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">{t('Balance')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400 text-sm">{t('No transactions for this account in the selected period')}</td></tr>}
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="px-6 py-2 text-gray-500">{fmtDate(l.date)}</td>
                <td className="px-4 py-2 text-gray-700">{l.desc}</td>
                <td className="px-4 py-2 text-gray-400 text-xs font-mono">{l.ref}</td>
                <td className="px-4 py-2 text-right font-mono text-gray-700">{l.dr > 0 ? fmtMoney(l.dr, sym) : ''}</td>
                <td className="px-4 py-2 text-right font-mono text-gray-700">{l.cr > 0 ? fmtMoney(l.cr, sym) : ''}</td>
                <td className={`px-4 py-2 text-right font-mono font-semibold ${l.running >= 0 ? 'text-gray-800' : 'text-red-600'}`}>{fmtMoney(l.running, sym)}</td>
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
    const unpaid = invoices.filter((i) => i.status !== 'paid' && i.status !== 'cancelled' && i.amountPaid < i.total)

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
            <div key={inv.id} className="flex justify-between items-center text-sm py-1.5 border-b border-gray-50">
              <div className="flex gap-4">
                <span className="font-mono text-gray-400 text-xs w-20">{inv.number}</span>
                <span className="text-gray-700">{inv.customerName}</span>
                <span className="text-gray-400 text-xs">{fmtDate(inv.dueDate)}</span>
              </div>
              <span className={`font-semibold ${color}`}>{fmtMoney(inv.amt, sym)}</span>
            </div>
          ))}
        </div>
      )
    )

    return (
      <Card>
        <div className="p-6 border-b border-gray-100">
          <h3 className="font-bold text-gray-800 text-lg">{company.name}</h3>
          <p className="text-sm text-gray-500">Accounts Receivable Aging as at {fmtDate(todayStr)}</p>
        </div>
        {/* Summary bar */}
        <div className="grid grid-cols-5 divide-x divide-gray-100 border-b border-gray-100">
          {[
            { label: 'Current', val: bucketTotals.current, color: 'text-green-600' },
            { label: '1–30 Days', val: bucketTotals.days30, color: 'text-yellow-600' },
            { label: '31–60 Days', val: bucketTotals.days60, color: 'text-orange-600' },
            { label: '61–90 Days', val: bucketTotals.days90, color: 'text-red-600' },
            { label: '90+ Days', val: bucketTotals.over90, color: 'text-red-800' },
          ].map((b) => (
            <div key={b.label} className="p-4 text-center">
              <p className="text-xs text-gray-400">{b.label}</p>
              <p className={`font-bold text-base ${b.color}`}>{fmtMoney(b.val, sym)}</p>
            </div>
          ))}
        </div>
        <div className="p-6">
          {unpaid.length === 0 ? <p className="text-gray-400 text-center py-8">All invoices are paid!</p> : (
            <>
              <BucketSection label="Current (not yet due)" items={buckets.current} color="text-green-700" />
              <BucketSection label="1–30 Days Overdue" items={buckets.days30} color="text-yellow-700" />
              <BucketSection label="31–60 Days Overdue" items={buckets.days60} color="text-orange-700" />
              <BucketSection label="61–90 Days Overdue" items={buckets.days90} color="text-red-600" />
              <BucketSection label="90+ Days Overdue" items={buckets.over90} color="text-red-800" />
              <div className="flex justify-between font-bold text-base border-t-2 border-gray-300 pt-3 mt-4">
                <span>{t('Total Outstanding')}</span>
                <span className="text-gray-900">{fmtMoney(grandTotal, sym)}</span>
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
    const unpaid = purchases.filter((p) => p.status !== 'paid' && p.status !== 'cancelled' && p.amountPaid < p.total)

    const rows = unpaid.map((p) => {
      const due = p.dueDate || p.date
      const days = Math.floor((new Date(todayStr) - new Date(due)) / 86400000)
      return { ...p, days, amt: p.total - p.amountPaid }
    }).sort((a, b) => b.days - a.days)

    const total = rows.reduce((s, r) => s + r.amt, 0)

    return (
      <Card>
        <div className="p-6 border-b border-gray-100">
          <h3 className="font-bold text-gray-800 text-lg">{company.name}</h3>
          <p className="text-sm text-gray-500">Accounts Payable Aging as at {fmtDate(todayStr)}</p>
        </div>
        <div className="p-6">
          {rows.length === 0 ? <p className="text-gray-400 text-center py-8">No outstanding payables!</p> : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-semibold text-gray-400 uppercase border-b border-gray-100">
                    <th className="text-left pb-2">Purchase #</th>
                    <th className="text-left pb-2">{t('Supplier')}</th>
                    <th className="text-left pb-2">{t('Due Date')}</th>
                    <th className="text-right pb-2">{t('Days Overdue')}</th>
                    <th className="text-right pb-2">{t('Balance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-b border-gray-50">
                      <td className="py-2 font-mono text-orange-600 text-xs">{p.number}</td>
                      <td className="py-2 text-gray-700">{p.supplierName}</td>
                      <td className="py-2 text-gray-500">{fmtDate(p.dueDate)}</td>
                      <td className="py-2 text-right">
                        <span className={p.days > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
                          {p.days > 0 ? `${p.days} days` : 'Not due'}
                        </span>
                      </td>
                      <td className="py-2 text-right font-semibold text-gray-800">{fmtMoney(p.amt, sym)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-between font-bold text-base border-t-2 border-gray-300 pt-3 mt-4">
                <span>{t('Total Payable')}</span>
                <span className="text-gray-900">{fmtMoney(total, sym)}</span>
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
    const typeCat = (t) => {
      if (['fixed_asset', 'asset_disposal'].includes(t)) return 'investing'
      if (['loan', 'capital', 'drawings', 'financing'].includes(t)) return 'financing'
      return 'operating'
    }
    let opening = 0
    const cats = { operating: [], investing: [], financing: [] }
    journalEntries.forEach((je) => {
      const delta = je.lines.filter((l) => cashAccIds.has(l.accountId)).reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0)
      if (delta === 0) return
      if (je.date < startDate) { opening += delta; return }
      if (je.date > endDate) return
      cats[typeCat(je.type)].push({ date: je.date, desc: je.description, ref: je.number, amount: delta })
    })
    const catTotal = (c) => cats[c].reduce((s, x) => s + x.amount, 0)
    const net = catTotal('operating') + catTotal('investing') + catTotal('financing')
    const closing = opening + net

    const Group = ({ title, items, total, color }) => (
      <div className="mb-5">
        <h4 className={`font-bold text-sm uppercase tracking-wide mb-2 ${color}`}>{title}</h4>
        <table className="w-full text-sm">
          <tbody>
            {items.length === 0 && <tr><td className="py-1.5 pl-3 text-gray-400 text-sm">{t('No activity')}</td></tr>}
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
    const taxableSales = invoices.filter((i) => i.status !== 'cancelled' && inRange(i.date) && (i.taxAmount || 0) > 0).reduce((s, i) => s + (i.subtotal || 0), 0)
    const zeroExemptSales = invoices.filter((i) => i.status !== 'cancelled' && inRange(i.date) && !(i.taxAmount > 0)).reduce((s, i) => s + (i.subtotal || 0), 0)
    const outputVat = accountBalance('acc-vatout', balances)
    const taxablePurch = purchases.filter((p) => p.status !== 'cancelled' && inRange(p.date) && (p.taxAmount || 0) > 0).reduce((s, p) => s + (p.subtotal || 0), 0)
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
            <Row n="1" label="Standard rated sales" ar="المبيعات الخاضعة للنسبة الأساسية" amount={taxableSales} />
            <Row n="2" label="Output VAT" ar="ضريبة المخرجات" amount={outputVat} bold />
            <Row n="3" label="Zero-rated / exempt sales" ar="مبيعات معفاة / صفرية" amount={zeroExemptSales} />
            <Row n="4" label="Standard rated purchases" ar="المشتريات الخاضعة للضريبة" amount={taxablePurch} />
            <Row n="5" label="Input VAT (recoverable)" ar="ضريبة المدخلات" amount={inputVat} bold />
            <Row n="6" label="Net VAT due / (reclaimable)" ar="صافي الضريبة المستحقة" amount={netVat} bold strong />
          </tbody>
        </table>
        <div className={`p-5 flex items-center justify-between ${netVat >= 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-green-50 dark:bg-green-900/20'}`}>
          <span className="font-bold text-gray-800 dark:text-slate-100">{netVat >= 0 ? 'VAT Payable to ZATCA' : 'VAT Reclaimable from ZATCA'}</span>
          <span className={`text-xl font-black ${netVat >= 0 ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}>{fmtMoney(Math.abs(netVat), sym)}</span>
        </div>
      </Card>
    )
  }

  const canExport = ['pl', 'bs', 'tb', 'ar', 'ap'].includes(report)

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
    // ar / ap aging
    const src = report === 'ar'
      ? invoices.filter((i) => i.status !== 'paid' && i.status !== 'cancelled')
      : purchases.filter((p) => p.status !== 'paid')
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
            <label className="block text-xs font-medium text-gray-500 mb-1">{t('Report')}</label>
            <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={report} onChange={(e) => setReport(e.target.value)}>
              {REPORTS.map((r) => <option key={r.id} value={r.id}>{t(r.label)}</option>)}
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
      </div>
    </div>
  )
}
