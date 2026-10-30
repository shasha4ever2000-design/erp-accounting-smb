// The customer portal: what a customer sees when they open the link the
// company sent them. No sign-in; the link itself is the key (see
// supabase/functions/portal). Customers can pay an invoice online when the
// company has set that up (supabase/functions/pay); otherwise it is read-only.
import { useEffect, useState } from 'react'
import { Printer, ChevronDown, ChevronUp, AlertTriangle, Languages, CreditCard, CheckCircle2, Clock } from 'lucide-react'
import { useT, useI18n } from '../i18n'
import { fmtMoney, fmtDate, statusColor } from '../utils/formatters'
import { loadPortal } from '../utils/portal'
import { startCheckout, confirmCheckout } from '../utils/onlinePayments'

const param = (name) => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get(name) || '' : '')

export default function Portal({ token }) {
  const t = useT()
  const toggleLang = useI18n((s) => s.toggle)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  // A link to one invoice (from the invoice email) opens with it expanded.
  const [openId, setOpenId] = useState(() => param('invoice') || null)
  // Back from the pay page: { state: 'checking' | 'paid' | 'pending' | 'failed', amount?, currency?, invoiceNumber? }
  const [payResult, setPayResult] = useState(() => (param('paid') ? { state: 'checking' } : null))
  const [paying, setPaying] = useState('')
  const [payError, setPayError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let live = true
    loadPortal(token)
      .then((res) => { if (!live) return; if (res?.error) setError(res.error); else setData(res) })
      .catch(() => live && setError(t('Could not load your account. Check your connection and try again.')))
    return () => { live = false }
  }, [token, t, reloadKey])

  // Ask the provider whether the payment went through, a few times, since
  // its confirmation can lag the redirect back by a few seconds.
  useEffect(() => {
    const paymentId = param('paid')
    if (!paymentId) return
    let live = true
    const check = async (tries) => {
      const res = await confirmCheckout(token, paymentId).catch(() => null)
      if (!live) return
      if (res?.status === 'paid') {
        setPayResult({ state: 'paid', amount: res.amount, currency: res.currency, invoiceNumber: res.invoiceNumber })
        setReloadKey((k) => k + 1)
      } else if (res?.status === 'pending' && tries > 0) {
        setTimeout(() => check(tries - 1), 3000)
      } else {
        setPayResult({ state: res?.status === 'pending' ? 'pending' : 'failed' })
      }
    }
    check(4)
    return () => { live = false }
  }, [token])

  const pay = async (invoiceId) => {
    setPaying(invoiceId)
    setPayError('')
    const res = await startCheckout(token, invoiceId).catch(() => null)
    if (res?.url) { window.location.href = res.url; return }
    setPaying('')
    setPayError(res?.error || t('The payment page could not be opened. Try again in a moment.'))
    if (res?.code === 'PAID') setReloadKey((k) => k + 1)
  }

  useEffect(() => {
    if (data?.company?.name) document.title = `${data.company.name} — ${t('Your account')}`
  }, [data, t])

  const shell = (children) => (
    <div className="min-h-screen bg-slate-50 dark:bg-surface-950 text-slate-800 dark:text-slate-100">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex justify-end mb-2 no-print">
          <button onClick={toggleLang} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100">
            <Languages size={14} /> {t('العربية / English')}
          </button>
        </div>
        {children}
      </div>
    </div>
  )

  if (error) {
    return shell(
      <div className="bg-white dark:bg-surface-900 rounded-2xl p-10 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <AlertTriangle size={30} className="mx-auto mb-3 text-warning-700 dark:text-warning-400" />
        <p className="font-medium">{t(error)}</p>
      </div>
    )
  }
  if (!data) {
    return shell(
      <div className="flex justify-center py-24">
        <div className="h-9 w-9 rounded-full border-2 border-slate-200 dark:border-slate-700 border-t-brand-500 animate-spin" />
      </div>
    )
  }

  const { company, customer, invoices = [], creditNotes = [], balance, canPayOnline } = data
  const sym = company.currencySymbol || company.currency || ''
  const symFor = (inv) => (inv.currency && inv.currency !== company.currency ? `${inv.currency} ` : sym)
  const open = invoices.filter((i) => i.due > 0.005)

  return shell(
    <>
      <header className="flex items-start gap-4 mb-6">
        {company.logo && <img src={company.logo} alt="" className="h-14 w-auto max-w-[140px] object-contain" />}
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{company.name}</h1>
          {company.address && <p className="text-sm text-slate-500 dark:text-slate-400 whitespace-pre-line">{company.address}</p>}
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {[company.phone, company.email, company.taxId && `${t('Tax number')}: ${company.taxId}`].filter(Boolean).join(' · ')}
          </p>
        </div>
      </header>

      {payResult && (
        <div role="status" className={`flex items-start gap-3 rounded-2xl p-4 mb-5 text-sm ${payResult.state === 'paid'
          ? 'bg-success-50 dark:bg-success-500/10 text-success-800 dark:text-success-200'
          : payResult.state === 'failed' ? 'bg-danger-50 dark:bg-danger-500/10 text-danger-800 dark:text-danger-200'
          : 'bg-slate-100 dark:bg-surface-800 text-slate-700 dark:text-slate-200'}`}>
          {payResult.state === 'paid' ? <CheckCircle2 size={18} className="flex-shrink-0" /> : <Clock size={18} className="flex-shrink-0" />}
          <p>
            {payResult.state === 'checking' && t('Confirming your payment…')}
            {payResult.state === 'paid' && t('Thank you — your payment of {amount} for {invoice} was received.')
              .replace('{amount}', fmtMoney(payResult.amount, `${payResult.currency} `)).replace('{invoice}', payResult.invoiceNumber || '')}
            {payResult.state === 'pending' && t('Your payment is still being confirmed. This page will show it as paid once it is; there is no need to pay again.')}
            {payResult.state === 'failed' && t('The payment did not go through and nothing was charged. You can try again below.')}
          </p>
        </div>
      )}

      <section className="bg-white dark:bg-surface-900 rounded-2xl p-6 shadow-sm ring-1 ring-black/5 dark:ring-white/10 mb-5">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('Account of')}</p>
        <p className="text-lg font-semibold">{customer.name}</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">{balance > 0.005 ? t('Balance due') : balance < -0.005 ? t('Credit balance') : t('Balance')}</p>
            <p className={`text-3xl font-bold ${balance > 0.005 ? 'text-danger-700 dark:text-danger-300' : 'text-success-700 dark:text-success-300'}`}>
              {fmtMoney(Math.abs(balance), sym)}
            </p>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {open.length ? t('{n} unpaid invoice(s)').replace('{n}', open.length) : t('Everything is paid — thank you.')}
          </p>
        </div>
        {balance > 0.005 && company.bankDetails && (
          <div className="mt-5 rounded-xl bg-slate-50 dark:bg-surface-800 p-4">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t('How to pay')}</p>
            <p className="text-sm whitespace-pre-line">{company.bankDetails}</p>
          </div>
        )}
      </section>

      <section className="bg-white dark:bg-surface-900 rounded-2xl shadow-sm ring-1 ring-black/5 dark:ring-white/10 overflow-hidden">
        <h2 className="px-6 py-4 font-semibold border-b border-slate-100 dark:border-surface-800">{t('Invoices')}</h2>
        {invoices.length === 0 && <p className="px-6 py-8 text-center text-sm text-slate-500 dark:text-slate-400">{t('No invoices yet.')}</p>}
        <ul className="divide-y divide-slate-100 dark:divide-surface-800">
          {invoices.map((inv) => {
            const expanded = openId === inv.id
            return (
              <li key={inv.id} className={openId && !expanded ? 'print:hidden' : ''}>
                <button onClick={() => setOpenId(expanded ? null : inv.id)} aria-expanded={expanded}
                  className="w-full flex items-center gap-3 px-6 py-3.5 text-start hover:bg-slate-50 dark:hover:bg-surface-800/60">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{inv.number}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {fmtDate(inv.date)}{inv.dueDate ? ` · ${t('due')} ${fmtDate(inv.dueDate)}` : ''}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${statusColor(inv.status)}`}>{t(inv.status)}</span>
                  <div className="text-end w-32">
                    <p className="font-semibold">{fmtMoney(inv.total, symFor(inv))}</p>
                    {inv.due > 0.005 && inv.due < inv.total - 0.005 && <p className="text-xs text-danger-700 dark:text-danger-300">{t('Due')}: {fmtMoney(inv.due, symFor(inv))}</p>}
                  </div>
                  {expanded ? <ChevronUp size={16} className="text-slate-400 no-print" /> : <ChevronDown size={16} className="text-slate-400 no-print" />}
                </button>
                {expanded && (
                  <InvoiceDetail inv={inv} sym={symFor(inv)}
                    onPay={canPayOnline && inv.due > 0.005 ? () => pay(inv.id) : null}
                    paying={paying === inv.id} payError={paying === '' && openId === inv.id ? payError : ''} />
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {creditNotes.length > 0 && (
        <section className="bg-white dark:bg-surface-900 rounded-2xl shadow-sm ring-1 ring-black/5 dark:ring-white/10 overflow-hidden mt-5 print:hidden">
          <h2 className="px-6 py-4 font-semibold border-b border-slate-100 dark:border-surface-800">{t('Credit notes')}</h2>
          <ul className="divide-y divide-slate-100 dark:divide-surface-800">
            {creditNotes.map((n) => (
              <li key={n.number} className="flex items-center justify-between px-6 py-3 text-sm">
                <span>{n.number} · {fmtDate(n.date)}{n.invoiceNumber ? ` · ${n.invoiceNumber}` : ''}</span>
                <span className="font-semibold">−{fmtMoney(n.total, sym)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-center text-slate-400 mt-8 no-print">{t('This page shows your account with {company}. Questions? Reply to the email that brought you here.').replace('{company}', company.name)}</p>
    </>
  )
}

function InvoiceDetail({ inv, sym, onPay, paying, payError }) {
  const t = useT()
  return (
    <div className="px-6 pb-5">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-surface-800">
            <th className="text-start py-2 font-medium">{t('Description')}</th>
            <th className="text-end py-2 font-medium">{t('Qty')}</th>
            <th className="text-end py-2 font-medium">{t('Price')}</th>
            <th className="text-end py-2 font-medium">{t('Amount')}</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((l, i) => (
            <tr key={i} className="border-b border-slate-50 dark:border-surface-800/60">
              <td className="py-2">{l.description}</td>
              <td className="py-2 text-end">{l.quantity}</td>
              <td className="py-2 text-end">{fmtMoney(l.unitPrice, sym)}</td>
              <td className="py-2 text-end">{fmtMoney(l.amount, sym)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-3 ms-auto w-full max-w-xs text-sm space-y-1">
        <Row label={t('Subtotal')} value={fmtMoney(inv.subtotal, sym)} />
        {inv.taxAmount > 0 && <Row label={t('Tax')} value={fmtMoney(inv.taxAmount, sym)} />}
        <Row label={t('Total')} value={fmtMoney(inv.total, sym)} bold />
        {inv.paid > 0 && <Row label={t('Paid')} value={`−${fmtMoney(inv.paid, sym)}`} />}
        {inv.credited > 0 && <Row label={t('Returns')} value={`−${fmtMoney(inv.credited, sym)}`} />}
        <Row label={t('Balance due')} value={fmtMoney(inv.due, sym)} bold />
      </dl>
      {inv.payments.length > 0 && (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {t('Payments received')}: {inv.payments.map((p) => `${fmtDate(p.date)} ${fmtMoney(p.amount, sym)}`).join(' · ')}
        </p>
      )}
      {inv.notes && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">{inv.notes}</p>}
      {onPay && (
        <div className="no-print mt-4">
          <button onClick={onPay} disabled={paying}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-semibold px-4 py-2 text-sm">
            <CreditCard size={15} /> {paying ? t('Opening the payment page…') : t('Pay {amount} now').replace('{amount}', fmtMoney(inv.due, sym))}
          </button>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t('You pay on a secure page run by our payment provider.')}</p>
          {payError && <p className="mt-1.5 text-sm text-danger-700 dark:text-danger-300">{payError}</p>}
        </div>
      )}
      <button onClick={() => window.print()} className="no-print mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 dark:text-brand-300 hover:underline">
        <Printer size={14} /> {t('Print or save as PDF')}
      </button>
    </div>
  )
}

function Row({ label, value, bold }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'font-semibold' : 'text-slate-600 dark:text-slate-300'}`}>
      <dt>{label}</dt><dd>{value}</dd>
    </div>
  )
}
