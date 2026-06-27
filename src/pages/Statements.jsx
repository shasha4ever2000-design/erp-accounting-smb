import { useState, useMemo } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Select, Input } from '../components/UI'
import { format } from 'date-fns'
import { Printer, FileText } from 'lucide-react'

export default function Statements() {
  const { customers, suppliers, invoices, purchases, creditNotes, debitNotes, settings } = useStore()
  const sym = settings.company.currencySymbol
  const company = settings.company

  const thisYear = format(new Date(), 'yyyy')
  const [type, setType] = useState('customer')
  const [entityId, setEntityId] = useState('')
  const [startDate, setStartDate] = useState(`${thisYear}-01-01`)
  const [endDate, setEndDate] = useState(today())

  const list = type === 'customer' ? customers : suppliers
  const entity = list.find((e) => e.id === entityId)

  const allTxns = useMemo(() => {
    if (!entityId) return []
    const txns = []
    if (type === 'customer') {
      invoices.filter((i) => i.customerId === entityId && i.status !== 'cancelled').forEach((inv) => {
        txns.push({ date: inv.date, type: 'Sales Invoice', ref: inv.number, debit: inv.total, credit: 0 })
        ;(inv.payments || []).forEach((p) => txns.push({ date: p.date, type: 'Payment Received', ref: p.number, debit: 0, credit: p.amount }))
      })
      creditNotes.filter((c) => c.customerId === entityId).forEach((cn) => txns.push({ date: cn.date, type: 'Credit Note', ref: cn.number, debit: 0, credit: cn.total }))
    } else {
      purchases.filter((p) => p.supplierId === entityId && p.status !== 'cancelled').forEach((pur) => {
        txns.push({ date: pur.date, type: 'Purchase Invoice', ref: pur.number, debit: 0, credit: pur.total })
        ;(pur.payments || []).forEach((p) => txns.push({ date: p.date, type: 'Payment Made', ref: p.number, debit: p.amount, credit: 0 }))
      })
      debitNotes.filter((d) => d.supplierId === entityId).forEach((dn) => txns.push({ date: dn.date, type: 'Debit Note', ref: dn.number, debit: dn.total, credit: 0 }))
    }
    return txns.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  }, [entityId, type, invoices, purchases, creditNotes, debitNotes])

  const opening = allTxns.filter((t) => t.date < startDate).reduce((s, t) => s + t.debit - t.credit, 0)
  const rows = []
  let running = opening
  allTxns.filter((t) => t.date >= startDate && t.date <= endDate).forEach((t) => {
    running += t.debit - t.credit
    rows.push({ ...t, balance: running })
  })
  const closing = running
  const label = type === 'customer' ? 'owed by customer' : 'owed to supplier'

  return (
    <div>
      <PageHeader
        title="Statements of Account"
        subtitle="Printable customer & supplier account statements"
        action={entity && <Btn variant="secondary" onClick={() => window.print()}><Printer size={14} /> Print / PDF</Btn>}
      />

      <Card className="p-5 mb-6 no-print">
        <div className="flex flex-wrap gap-4 items-end">
          <Select label="Type" value={type} onChange={(e) => { setType(e.target.value); setEntityId('') }} className="w-40">
            <option value="customer">Customer</option>
            <option value="supplier">Supplier</option>
          </Select>
          <Select label={type === 'customer' ? 'Customer' : 'Supplier'} value={entityId} onChange={(e) => setEntityId(e.target.value)} className="w-64">
            <option value="">— Select —</option>
            {list.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
          <Input label="From" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
          <Input label="To" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
        </div>
      </Card>

      {!entity ? (
        <Card className="p-12 text-center text-gray-400 dark:text-slate-500">
          <FileText size={32} className="mx-auto mb-3 opacity-40" />
          Select a {type} to generate a statement of account.
        </Card>
      ) : (
        <Card className="p-8 max-w-4xl mx-auto print:shadow-none">
          <div className="flex justify-between items-start mb-8">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{company.name}</h1>
              {company.arabicName && <p className="text-lg font-bold text-gray-700 dark:text-slate-200" dir="rtl">{company.arabicName}</p>}
              {company.address && <p className="text-sm text-gray-500 dark:text-slate-400 whitespace-pre-line">{company.address}</p>}
            </div>
            <div className="text-right">
              <p className="text-2xl font-black text-blue-600">STATEMENT</p>
              <p className="text-sm text-gray-500 dark:text-slate-400">{fmtDate(startDate)} → {fmtDate(endDate)}</p>
            </div>
          </div>

          <div className="mb-6">
            <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase mb-1">{type === 'customer' ? 'Customer' : 'Supplier'}</p>
            <p className="font-semibold text-gray-800 dark:text-slate-100">{entity.name}</p>
            {entity.email && <p className="text-sm text-gray-500 dark:text-slate-400">{entity.email}</p>}
            {entity.taxId && <p className="text-sm text-gray-500 dark:text-slate-400">VAT/Tax: {entity.taxId}</p>}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200 dark:border-slate-600 text-xs text-gray-500 dark:text-slate-400 uppercase">
                <th className="text-left py-2">Date</th>
                <th className="text-left py-2">Transaction</th>
                <th className="text-left py-2">Ref</th>
                <th className="text-right py-2">Debit</th>
                <th className="text-right py-2">Credit</th>
                <th className="text-right py-2">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100 dark:border-slate-700/50 bg-gray-50 dark:bg-slate-800/60">
                <td className="py-2 text-gray-500 dark:text-slate-400" colSpan={5}>Opening Balance</td>
                <td className="py-2 text-right font-semibold text-gray-800 dark:text-slate-100">{fmtMoney(opening, sym)}</td>
              </tr>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 dark:border-slate-700/50">
                  <td className="py-2 text-gray-500 dark:text-slate-400">{fmtDate(r.date)}</td>
                  <td className="py-2 text-gray-700 dark:text-slate-200">{r.type}</td>
                  <td className="py-2 text-gray-400 dark:text-slate-500 font-mono text-xs">{r.ref}</td>
                  <td className="py-2 text-right text-gray-700 dark:text-slate-200">{r.debit ? fmtMoney(r.debit, sym) : ''}</td>
                  <td className="py-2 text-right text-gray-700 dark:text-slate-200">{r.credit ? fmtMoney(r.credit, sym) : ''}</td>
                  <td className="py-2 text-right font-medium text-gray-800 dark:text-slate-100">{fmtMoney(r.balance, sym)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-gray-400 dark:text-slate-500">No transactions in this period</td></tr>
              )}
            </tbody>
          </table>

          <div className="flex justify-end mt-6">
            <div className="w-64 bg-gray-50 dark:bg-slate-800/60 rounded-lg p-4">
              <div className="flex justify-between font-bold text-base">
                <span className="text-gray-800 dark:text-slate-100">Closing Balance</span>
                <span className={closing >= 0 ? 'text-gray-900 dark:text-slate-100' : 'text-green-600'}>{fmtMoney(Math.abs(closing), sym)}</span>
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1 text-right">{closing >= 0 ? label : 'in credit'}</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
