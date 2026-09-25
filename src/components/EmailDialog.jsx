// "Email" for an invoice, statement or reminder. Sends from the app when the
// company is in the cloud and the email server is set up; otherwise opens the
// same message in the user's own email app.
import { useEffect, useState } from 'react'
import { Send, Mail, Info } from 'lucide-react'
import { Modal, Input, Btn } from './UI'
import { useT, useI18n } from '../i18n'
import { useStore } from '../store'
import { emailServerInvoker, mailtoFor } from '../utils/email'
import { getOrCreatePortalLink, portalUrl } from '../utils/portal'

/**
 * @param draft { to, subject, message, summary, docKind, docRef, customer }
 * @param onSent (to) => void, after a successful send from the app
 */
export default function EmailDialog({ open, onClose, draft, onSent }) {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const company = useStore((s) => s.settings.company)
  const send = emailServerInvoker()
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [withPortal, setWithPortal] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null) // { ok } | { error, code }

  useEffect(() => {
    if (!open || !draft) return
    setTo([].concat(draft.to || []).join(', '))
    setSubject(draft.subject || '')
    setMessage(draft.message || '')
    setStatus(null)
  }, [open, draft])

  const recipients = to.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
  const canPortal = !!send && !!draft?.customer?.id

  const portalLink = async () => {
    if (!canPortal || !withPortal) return null
    const link = await getOrCreatePortalLink(draft.customer)
    return { url: portalUrl(link.token), label: t('View your account online') }
  }

  const sendNow = async () => {
    if (!recipients.length) return setStatus({ error: t('Add at least one email address to send to.') })
    setBusy(true)
    setStatus(null)
    try {
      let link = null
      try { link = await portalLink() } catch { link = null } // the email still goes without the link
      const res = await send({
        to: recipients, subject, message, summary: draft.summary || [], link,
        fromName: company.name, replyTo: company.email || undefined,
        docKind: draft.docKind || '', docRef: draft.docRef || '', lang,
      })
      if (res?.ok) { setStatus({ ok: true }); onSent?.(recipients) }
      else setStatus({ error: res?.error || t('The email could not be sent.'), code: res?.code })
    } catch (e) {
      setStatus({ error: e.message || t('The email could not be sent.') })
    } finally {
      setBusy(false)
    }
  }

  const openInMailApp = () => {
    window.location.href = mailtoFor({ to: recipients, subject, message, summary: draft?.summary || [] })
  }

  return (
    <Modal open={open} onClose={onClose} title={t('Send by email')} width="max-w-xl">
      {status?.ok ? (
        <div className="text-center py-6">
          <Send size={28} className="mx-auto mb-3 text-success-700 dark:text-success-400" />
          <p className="font-medium text-slate-800 dark:text-slate-100">{t('Email sent to {to}.').replace('{to}', recipients.join(', '))}</p>
          <Btn className="mt-5" onClick={onClose}>{t('Done')}</Btn>
        </div>
      ) : (
        <div className="space-y-3">
          <Input label="To" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />
          <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t('Message')}</span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={9}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300 dark:border-surface-600 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15" />
          </label>
          {draft?.summary?.length > 0 && (
            <div className="rounded-lg bg-slate-50 dark:bg-surface-900/40 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
              {draft.summary.map((r, i) => <div key={i} className="flex justify-between gap-3"><span>{r.label}</span><span className="font-semibold">{r.value}</span></div>)}
            </div>
          )}
          {canPortal && (
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" className="accent-brand-600" checked={withPortal} onChange={(e) => setWithPortal(e.target.checked)} />
              {t('Add a link where the customer can see their invoices online')}
            </label>
          )}
          {!send && (
            <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Info size={13} className="mt-0.5 flex-shrink-0" />
              {t('This opens the message in your own email app. To attach the invoice, use Download PDF and attach the file. Companies linked to the cloud can send straight from here.')}
            </p>
          )}
          {status?.error && (
            <p className="text-sm text-danger-700 dark:text-danger-300">
              {status.error}
              {status.code === 'NOT_CONFIGURED' && ' ' + t('You can still open it in your own email app.')}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={onClose}>{t('Cancel')}</Btn>
            <Btn variant={send ? 'secondary' : 'primary'} onClick={openInMailApp}><Mail size={14} /> {t('Open in my email app')}</Btn>
            {send && <Btn onClick={sendNow} disabled={busy}><Send size={14} /> {busy ? t('Sending…') : t('Send')}</Btn>}
          </div>
        </div>
      )}
    </Modal>
  )
}
