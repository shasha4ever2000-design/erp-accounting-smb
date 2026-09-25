// Emailing invoices, statements and payment reminders.
//
// A company linked to the cloud sends through the `send-email` server
// function (supabase/functions/send-email), which holds the email service's
// key. Everyone else — and anyone whose server isn't set up yet — gets the
// same message opened in their own email app instead (a mailto: link).
import { cloudCompanyId } from './aiServer'
import { mailtoLink } from './shareStatement'

/** Sends through the server; null when the company isn't in the cloud. */
export function emailServerInvoker() {
  const companyId = cloudCompanyId()
  if (!companyId) return null
  return async (body) => {
    const { getSupabase } = await import('../lib/supabase')
    const { data, error } = await getSupabase().functions.invoke('send-email', { body: { companyId, ...body } })
    if (error) {
      let msg = error.message
      let code = ''
      try { const j = await error.context?.json(); msg = j?.error || msg; code = j?.code || '' } catch { /* keep the generic message */ }
      return { error: msg, code }
    }
    return data
  }
}

/** Plain text of the whole email, for the mailto: fallback. */
export function mailtoFor({ to, subject, message, summary = [], link }) {
  const rows = summary.map((r) => `${r.label}: ${r.value}`).join('\n')
  const body = [message, rows, link ? `${link.label}: ${link.url}` : ''].filter(Boolean).join('\n\n')
  return mailtoLink({ email: [].concat(to || []).join(','), subject, body })
}

const tt = (t) => (typeof t === 'function' ? t : (s) => s)

/**
 * The email for one invoice.
 * @param {{ invoice, company, customerName, due, money:(n)=>string, date:(d)=>string, bankDetails, t }} o
 */
export function invoiceEmail({ invoice, company, customerName, due, money, date, bankDetails = '', t }) {
  t = tt(t)
  const lines = [
    `${t('Dear')} ${customerName || t('customer')},`,
    '',
    `${t('Please find invoice')} ${invoice.number} ${t('from')} ${company.name}.`,
  ]
  if (due > 0.005) {
    if (invoice.dueDate) lines.push(`${t('Payment is due by')} ${date(invoice.dueDate)}.`)
    if (bankDetails) lines.push('', `${t('Payment details')}:`, bankDetails)
  } else {
    lines.push(t('This invoice is fully paid — thank you.'))
  }
  lines.push('', `${t('Regards')},`, company.name)
  const summary = [
    { label: t('Invoice'), value: invoice.number },
    { label: t('Date'), value: date(invoice.date) },
    invoice.dueDate ? { label: t('Due date'), value: date(invoice.dueDate) } : null,
    { label: t('Total'), value: money(invoice.total) },
    due > 0.005 && due < invoice.total - 0.005 ? { label: t('Balance due'), value: money(due) } : null,
  ].filter(Boolean)
  return {
    subject: `${t('Invoice')} ${invoice.number} ${t('from')} ${company.name}`,
    message: lines.join('\n'),
    summary,
  }
}
