// Settings → Online payments: connect Moyasar or Stripe so customers can pay
// invoices by card from the portal and the invoice email, and choose the
// account the money is recorded in. The secret key goes straight to the
// server and is never stored in the app (see utils/onlinePayments.js).
import { useEffect, useState, useCallback } from 'react'
import { CreditCard, Copy, RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { Card, Btn, Input, Select, Badge } from './UI'
import { fmtMoney, fmtDate, statusColor } from '../utils/formatters'
import { cloudCompanyId } from '../utils/aiServer'
import {
  PROVIDER_LABELS, paymentStatus, configurePayments, listOnlinePayments, refreshPayments, onlinePaymentsAfterSync,
} from '../utils/onlinePayments'

export default function OnlinePaymentsCard() {
  const t = useT()
  const cfg = useStore((s) => s.settings.onlinePayments) || {}
  const bankAccounts = useStore((s) => s.bankAccounts)
  const updateOnlinePayments = useStore((s) => s.updateOnlinePayments)
  const linked = !!cloudCompanyId()

  const [status, setStatus] = useState(null)
  const [provider, setProvider] = useState('moyasar')
  const [secretKey, setSecretKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { ok?, error? }
  const [payments, setPayments] = useState([])

  const load = useCallback(async () => {
    if (!linked) return
    const st = await paymentStatus()
    setStatus(st)
    if (st?.provider) setProvider(st.provider)
    // Keep the synced flag in step with the server, so the email and the
    // invoice screens offer "pay online" only when it really works.
    if (st && !st.error && !!st.configured !== !!cfg.enabled) {
      try { updateOnlinePayments({ enabled: !!st.configured, provider: st.provider || '' }) } catch { /* a viewer can't; harmless */ }
    }
    try { setPayments(await listOnlinePayments()) } catch { setPayments([]) }
  }, [linked])

  useEffect(() => { load() }, [load])

  const save = async (which) => {
    setBusy(true); setMsg(null)
    const res = await configurePayments(which, which === 'off' ? '' : secretKey)
    setBusy(false)
    if (res?.error) return setMsg({ error: res.error === 'NOT_CLOUD' ? t('Link this company to the cloud first.') : res.error })
    setSecretKey('')
    updateOnlinePayments({ enabled: !!res.configured, provider: res.configured ? res.provider : '' })
    setMsg({ ok: res.configured
      ? (res.test ? t('Connected in test mode. Payments use test cards and nothing real is charged.') : t('Connected. Customers can now pay invoices online.'))
      : t('Online payments are switched off.') })
    load()
  }

  const checkNow = async () => {
    setBusy(true); setMsg(null)
    await refreshPayments()
    const res = await onlinePaymentsAfterSync(useStore.getState)
    setBusy(false)
    if (res?.reason === 'no-account') setMsg({ error: t('Choose the account payments go into, then check again.') })
    else setMsg({ ok: t('{n} payment(s) recorded.').replace('{n}', res?.applied || 0) })
    load()
  }

  const copy = (text) => { try { navigator.clipboard.writeText(text) } catch { /* the address is on screen */ } }
  const waiting = payments.filter((p) => p.status === 'paid' && !p.applied_at)

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
          <CreditCard size={14} className="text-white" />
        </div>
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('Online payments')}</h2>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        {t('Let customers pay invoices by card, mada, Apple Pay or STC Pay from the customer portal and the invoice email. Each payment is recorded against its invoice automatically.')}
      </p>

      {!linked ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('Online payments need the company to be linked to the cloud (Cloud sync, below), because the customer portal runs there.')}</p>
      ) : (
        <div className="space-y-4">
          {status?.configured && (
            <p className="text-sm">
              <Badge className="bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300">{t('Connected')}</Badge>{' '}
              {PROVIDER_LABELS[status.provider]} · <span className="font-mono text-xs">{status.keyHint}</span>
              {status.test && <span className="ms-2 text-warning-700 dark:text-warning-300">{t('Test mode')}</span>}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select label={t('Payment provider')} value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="moyasar">{t('Moyasar (Saudi Arabia: mada, cards, Apple Pay, STC Pay)')}</option>
              <option value="stripe">{t('Stripe (cards, most other countries)')}</option>
            </Select>
            <Input label={t('Secret key')} type="password" autoComplete="off" value={secretKey}
              placeholder={status?.configured ? t('Saved — enter a new key to replace it') : 'sk_live_…'}
              onChange={(e) => setSecretKey(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn need={['settings', 'edit']} disabled={busy || !secretKey.trim()} onClick={() => save(provider)}>
              {busy ? t('Checking…') : t('Save and test')}
            </Btn>
            {status?.configured && (
              <Btn need={['settings', 'edit']} variant="secondary" disabled={busy} onClick={() => save('off')}>{t('Switch off')}</Btn>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('Find the secret key in your provider\'s dashboard (Moyasar: Settings → API keys; Stripe: Developers → API keys). It is sent to your server and never stored in this app or shown again.')}
          </p>

          {status?.configured && (
            <>
              <Select label={t('Record payments in')} value={cfg.depositAccountId || ''}
                onChange={(e) => updateOnlinePayments({ depositAccountId: e.target.value })}>
                <option value="">{t('Choose an account…')}</option>
                {bankAccounts.map((b) => <option key={b.id} value={b.accountId}>{b.name}</option>)}
              </Select>
              <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2">
                {t('Tip: add a bank account named after the provider (e.g. "Moyasar balance"). Payments land there; when the provider pays out to your bank, record a transfer and book its fees.')}
              </p>

              {status.provider === 'stripe' && (
                <div className="rounded-lg bg-slate-50 dark:bg-surface-800 p-3 text-xs text-slate-600 dark:text-slate-300">
                  <p>{t('In Stripe, add a webhook for the event checkout.session.completed pointing to this address, so payments are picked up even if a customer closes the page:')}</p>
                  <p className="mt-1 flex items-center gap-2 font-mono break-all">
                    {status.callbackUrl}
                    <button onClick={() => copy(status.callbackUrl)} title={t('Copy')} className="text-brand-600 dark:text-brand-400"><Copy size={13} /></button>
                  </p>
                </div>
              )}

              {waiting.length > 0 && !cfg.depositAccountId && (
                <p className="text-sm text-warning-800 dark:text-warning-200">
                  {t('{n} paid online payment(s) are waiting to be recorded. Choose the account above.').replace('{n}', waiting.length)}
                </p>
              )}
            </>
          )}

          {msg?.error && <p className="text-sm text-danger-700 dark:text-danger-300">{msg.error}</p>}
          {msg?.ok && <p className="text-sm text-success-700 dark:text-success-300">{msg.ok}</p>}

          {payments.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('Recent online payments')}</h3>
                <Btn size="sm" variant="ghost" disabled={busy} onClick={checkNow}><RefreshCw size={13} /> {t('Check now')}</Btn>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100 dark:divide-surface-800">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-1.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{fmtDate(String(p.paid_at || p.created_at).slice(0, 10))}</td>
                        <td className="py-1.5 font-medium">{p.invoice_number}</td>
                        <td className="py-1.5 text-end whitespace-nowrap">{fmtMoney(Number(p.paid_amount ?? p.amount), `${p.currency} `)}</td>
                        <td className="py-1.5 text-end">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor(p.status)}`}>{t(p.status)}</span>
                        </td>
                        <td className="py-1.5 text-end text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {p.status === 'paid' ? (p.applied_at ? `${t('Recorded')} ${p.applied_ref || ''}` : t('Not recorded yet')) : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
