import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Select, EmptyState } from '../components/UI'
import { BellRing, Copy, Printer, Clock } from 'lucide-react'

// Payment reminders: surfaces overdue customer invoices, groups them by customer,
// and generates a ready-to-send reminder message with an aging breakdown.
export default function PaymentReminders() {
  const t = useT()
  const { invoices, customers, settings } = useStore()
  const sym = settings.company.currencySymbol
  const company = settings.company
  const todayStr = today()

  const [minDays, setMinDays] = useState('1')
  const [copied, setCopied] = useState('')

  const groups = useMemo(() => {
    const overdue = invoices.filter((i) => {
      if (i.status === 'paid' || i.status === 'cancelled' || i.status === 'void') return false
      const bal = (i.total || 0) - (i.amountPaid || 0)
      if (bal <= 0.005) return false
      const due = i.dueDate || i.date
      const days = Math.floor((new Date(todayStr) - new Date(due)) / 86400000)
      return days >= (parseInt(minDays) || 0)
    }).map((i) => {
      const due = i.dueDate || i.date
      const days = Math.floor((new Date(todayStr) - new Date(due)) / 86400000)
      return { ...i, balance: (i.total || 0) - (i.amountPaid || 0), daysOverdue: days, due }
    })
    const byCust = {}
    overdue.forEach((i) => {
      const key = i.customerId || i.customerName || 'unknown'
      const g = byCust[key] || (byCust[key] = { name: i.customerName || t('Customer'), customerId: i.customerId, invoices: [], total: 0, maxDays: 0 })
      g.invoices.push(i); g.total += i.balance; g.maxDays = Math.max(g.maxDays, i.daysOverdue)
    })
    return Object.values(byCust).sort((a, b) => b.total - a.total)
  }, [invoices, minDays, todayStr, t])

  const grandTotal = groups.reduce((s, g) => s + g.total, 0)

  const buildMessage = (g) => {
    const cust = customers.find((c) => c.id === g.customerId)
    const lines = []
    lines.push(`${t('Dear')} ${g.name},`)
    lines.push('')
    lines.push(t('Our records show the following invoice(s) are past due. We would appreciate your prompt settlement.'))
    lines.push('')
    g.invoices.slice().sort((a, b) => b.daysOverdue - a.daysOverdue).forEach((i) => {
      lines.push(`• ${i.number} — ${fmtMoney(i.balance, sym)} — ${t('due')} ${fmtDate(i.due)} (${i.daysOverdue} ${t('days overdue')})`)
    })
    lines.push('')
    lines.push(`${t('Total outstanding')}: ${fmtMoney(g.total, sym)}`)
    lines.push('')
    if (settings.invoice?.bankDetails) { lines.push(t('Payment details:')); lines.push(settings.invoice.bankDetails); lines.push('') }
    lines.push(t('If you have already made this payment, please disregard this notice.'))
    lines.push('')
    lines.push(`${t('Regards')},`)
    lines.push(company.name)
    if (cust?.email) lines.push('') // spacer
    return lines.join('\n')
  }

  const copyMsg = async (g) => {
    const msg = buildMessage(g)
    try { await navigator.clipboard.writeText(msg); setCopied(g.customerId || g.name); setTimeout(() => setCopied(''), 1500) }
    catch { window.prompt(t('Copy the reminder message:'), msg) }
  }

  const printMsg = (g) => {
    const w = window.open('', '_blank')
    if (!w) return
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    w.document.write(`<pre style="font-family:system-ui,Arial,sans-serif;font-size:14px;white-space:pre-wrap;padding:32px;line-height:1.6">${esc(buildMessage(g))}</pre>`)
    w.document.close(); w.focus(); w.print()
  }

  return (
    <div>
      <PageHeader title="Payment Reminders" subtitle="Chase overdue customer invoices with a ready-to-send reminder" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-amber-50 dark:bg-amber-900/30 rounded-xl p-4">
          <p className="text-xs text-amber-600 dark:text-amber-300">{t('Customers with overdue')}</p>
          <p className="text-2xl font-bold text-amber-700 dark:text-amber-200">{groups.length}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-4">
          <p className="text-xs text-red-600 dark:text-red-300">{t('Total overdue')}</p>
          <p className="text-2xl font-bold text-red-700 dark:text-red-200">{fmtMoney(grandTotal, sym)}</p>
        </div>
        <Card className="p-4 flex items-end">
          <Select label={t('Minimum days overdue')} value={minDays} onChange={(e) => setMinDays(e.target.value)} className="w-full">
            <option value="1">1+ {t('days')}</option>
            <option value="8">8+ {t('days')}</option>
            <option value="31">31+ {t('days')}</option>
            <option value="61">61+ {t('days')}</option>
          </Select>
        </Card>
      </div>

      {groups.length === 0 ? (
        <EmptyState icon="✅" title={t('Nothing overdue')} desc={t('No customer invoices match this overdue filter.')} />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.customerId || g.name} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-gray-100 dark:border-slate-700">
                <div>
                  <h3 className="font-semibold text-gray-800 dark:text-slate-100">{g.name}</h3>
                  <p className="text-xs text-gray-400 dark:text-slate-500 flex items-center gap-1"><Clock size={11} /> {t('up to')} {g.maxDays} {t('days overdue')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-red-600 dark:text-red-400">{fmtMoney(g.total, sym)}</span>
                  <Btn size="sm" variant="secondary" onClick={() => copyMsg(g)}><Copy size={13} /> {copied === (g.customerId || g.name) ? t('Copied!') : t('Copy reminder')}</Btn>
                  <Btn size="sm" variant="secondary" onClick={() => printMsg(g)}><Printer size={13} /> {t('Print')}</Btn>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-400 dark:text-slate-500 uppercase">
                  <tr><th className="text-start px-5 py-2 font-medium">{t('Invoice #')}</th><th className="text-start px-3 py-2 font-medium">{t('Due')}</th><th className="text-end px-3 py-2 font-medium">{t('Days Overdue')}</th><th className="text-end px-5 py-2 font-medium">{t('Balance')}</th></tr>
                </thead>
                <tbody>
                  {g.invoices.slice().sort((a, b) => b.daysOverdue - a.daysOverdue).map((i) => (
                    <tr key={i.id} className="border-t border-gray-50 dark:border-slate-700/50">
                      <td className="px-5 py-2 text-gray-700 dark:text-slate-200">{i.number}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{fmtDate(i.due)}</td>
                      <td className={`px-3 py-2 text-end font-medium ${i.daysOverdue > 60 ? 'text-red-600' : i.daysOverdue > 30 ? 'text-amber-600' : 'text-gray-600 dark:text-slate-300'}`}>{i.daysOverdue}</td>
                      <td className="px-5 py-2 text-end font-medium text-gray-800 dark:text-slate-100">{fmtMoney(i.balance, sym)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
