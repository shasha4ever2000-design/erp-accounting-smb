// Create, copy and cancel a customer's portal link (see utils/portal.js).
import { useEffect, useState } from 'react'
import { Copy, Check, Link2, Ban, CloudOff } from 'lucide-react'
import { Modal, Btn } from './UI'
import { useT } from '../i18n'
import { fmtDate } from '../utils/formatters'
import { cloudCompanyId } from '../utils/aiServer'
import { listPortalLinks, getOrCreatePortalLink, revokePortalLink, portalUrl } from '../utils/portal'
import { ask } from './Dialogs'

export default function PortalLinkModal({ customer, onClose }) {
  const t = useT()
  const cloud = !!cloudCompanyId()
  const [links, setLinks] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const reload = async () => {
    try { setLinks(await listPortalLinks(customer.id)); setError('') }
    catch (e) { setError(e.message); setLinks([]) }
  }
  useEffect(() => { if (customer && cloud) reload() }, [customer?.id, cloud])

  const active = (links || []).find((l) => !l.revoked_at && (!l.expires_at || new Date(l.expires_at) > new Date()))
  const url = active ? portalUrl(active.token) : ''

  const create = async () => {
    setBusy(true)
    try { await getOrCreatePortalLink(customer); await reload() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const revoke = async () => {
    if (!await ask(t('Cancel this link? The customer will not be able to open it any more.'), { danger: true, confirmLabel: 'Cancel link' })) return
    setBusy(true)
    try { await revokePortalLink(active.token); await reload() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { window.prompt(t('Copy the link:'), url) }
  }

  return (
    <Modal open={!!customer} onClose={onClose} title={`${t('Customer portal')} — ${customer?.name || ''}`} width="max-w-lg">
      {!cloud ? (
        <div className="text-center py-4">
          <CloudOff size={28} className="mx-auto mb-3 text-slate-400" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('The customer portal needs this company to be linked to the cloud, so customers can reach their invoices. Turn on cloud sync in Settings first.')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('Anyone with this link can see this customer’s invoices, payments and balance — nothing else. Send it only to the customer. You can cancel it at any time.')}
          </p>
          {links === null ? (
            <p className="text-sm text-slate-500">{t('Loading…')}</p>
          ) : active ? (
            <>
              <div className="flex items-center gap-2">
                <input readOnly value={url} aria-label={t('Portal link')} onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 border rounded-lg px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-surface-800 border-slate-300 dark:border-surface-600" />
                <Btn size="sm" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('Copied') : t('Copy')}</Btn>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('Made')} {fmtDate(active.created_at?.slice(0, 10))}
                {active.last_opened_at ? ` · ${t('last opened')} ${fmtDate(active.last_opened_at.slice(0, 10))}` : ` · ${t('not opened yet')}`}
              </p>
              <div className="flex justify-between gap-2 pt-1">
                <Btn variant="secondary" size="sm" onClick={revoke} disabled={busy}><Ban size={14} /> {t('Cancel link')}</Btn>
                <a href={url} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-700 dark:text-brand-300 hover:underline self-center">{t('Preview')}</a>
              </div>
            </>
          ) : (
            <Btn onClick={create} disabled={busy}><Link2 size={14} /> {t('Create portal link')}</Btn>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('The portal shows what has synced to the cloud, so a new invoice appears after the next sync.')}</p>
          {error && <p className="text-sm text-danger-700 dark:text-danger-300">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
