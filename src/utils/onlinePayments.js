// Online payments: customers pay an invoice by card from the portal or the
// invoice email (supabase/functions/pay), and the money is recorded in the
// books here, on the next sync.
//
// The server only knows a checkout was paid. Turning that into a receipt —
// receipt number, journal entry, invoice status — happens in the app through
// recordInvoicePayment, the same path as a receipt typed in by hand, so the
// two can never disagree about what a payment does to the books.
import { cloudCompanyId } from './aiServer'
import { currentActor, can } from './permissions'
import { asSystem } from '../store/guard'

export const PROVIDER_LABELS = { moyasar: 'Moyasar', stripe: 'Stripe' }

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const db = async () => (await import('../lib/supabase')).getSupabase()

async function invoke(body) {
  const { data, error } = await (await db()).functions.invoke('pay', { body })
  if (error) {
    let msg = error.message
    let code = ''
    try { const j = await error.context?.json(); msg = j?.error || msg; code = j?.code || '' } catch { /* keep the generic message */ }
    return { error: msg, code }
  }
  return data
}

const withCompany = (body) => {
  const companyId = cloudCompanyId()
  if (!companyId) return Promise.resolve({ error: 'NOT_CLOUD' })
  return invoke({ companyId, ...body })
}

/** Is a provider set up for this company? { configured, provider, keyHint, test, callbackUrl } */
export const paymentStatus = () => withCompany({ action: 'status' })
/** Test and save a provider's secret key; provider 'off' removes it. */
export const configurePayments = (provider, secretKey) => withCompany({ action: 'configure', provider, secretKey })
/** Ask the providers about this company's open checkouts. */
export const refreshPayments = () => withCompany({ action: 'refresh' })

/** The company's recent online payments, newest first. */
export async function listOnlinePayments(limit = 25) {
  const companyId = cloudCompanyId()
  if (!companyId) return []
  const { data, error } = await (await db()).from('online_payments').select('*')
    .eq('company_id', companyId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return data || []
}

/** Where the customer comes back to after paying: this app's own address. */
export function returnUrl() {
  if (typeof window === 'undefined') return ''
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
  return `${window.location.origin}${base}`
}

/** From the portal: a pay page for what is still due on one invoice. */
export const startCheckout = (token, invoiceId) => invoke({ action: 'checkout', token, invoiceId, returnUrl: returnUrl() })
/** From the portal, back from the pay page: did it go through? */
export const confirmCheckout = (token, paymentId) => invoke({ action: 'confirm', token, paymentId })

/** The portal address for one invoice, which opens it with its Pay button. */
export const invoicePayUrl = (portalLink, invoiceId) => `${portalLink}&invoice=${encodeURIComponent(invoiceId)}`

/**
 * Record every paid, not-yet-recorded online payment in the books.
 *
 * Each row is claimed on the server first (applied_at set where it is still
 * empty), so when two devices sync at once only one of them records it. If
 * recording then fails — a locked period, say — the claim is handed back and
 * the next sync tries again.
 *
 * Money beyond what the invoice still owes (it was also paid by bank
 * transfer, say) is kept as a customer advance rather than lost.
 *
 * @returns {{ applied, waiting, reason? }} `waiting` counts paid rows that
 *   could not be recorded yet because no deposit account is chosen.
 */
export async function applyOnlinePayments({ client, companyId, get, userId = null, now = () => new Date().toISOString() }) {
  const s = get()
  const cfg = s.settings.onlinePayments || {}
  const actor = currentActor()
  // A device that can't record receipts (or push them) leaves the row for one that can.
  if (actor && !can(actor.role, 'sales', 'create', actor.overrides)) return { applied: 0, waiting: 0, reason: 'role' }

  const { data: rows, error } = await client.from('online_payments').select('*')
    .eq('company_id', companyId).eq('status', 'paid').is('applied_at', null)
    .order('paid_at', { ascending: true }).limit(50)
  if (error) return { applied: 0, waiting: 0, reason: error.message }
  if (!rows?.length) return { applied: 0, waiting: 0 }

  const deposit = cfg.depositAccountId
  if (!deposit || !s.accounts.some((a) => a.id === deposit)) return { applied: 0, waiting: rows.length, reason: 'no-account' }

  const mark = (id, patch) => client.from('online_payments').update(patch).eq('id', id)
  let applied = 0
  for (const row of rows) {
    const invoice = get().invoices.find((i) => i.id === row.invoice_id)
    if (!invoice) continue // not on this device yet; a later sync brings it

    const { data: claimed } = await client.from('online_payments')
      .update({ applied_at: now(), applied_by: userId, applied_ref: 'recording' })
      .eq('id', row.id).is('applied_at', null).select('id')
    if (!claimed?.length) continue // another device got there first

    // Already recorded here (a claim lost after recording, on a crash): just say so.
    const existing = (invoice.payments || []).find((p) => p.onlinePaymentId === row.id)
    if (existing) { await mark(row.id, { applied_ref: existing.number || 'recorded' }); applied++; continue }

    const provider = PROVIDER_LABELS[row.provider] || row.provider
    const date = String(row.paid_at || now()).slice(0, 10)
    const paid = r2(row.paid_amount ?? row.amount)
    try {
      const res = asSystem(() => get().recordInvoicePayment(invoice.id, {
        date, amount: paid, bankAccountId: deposit, method: 'online',
        reference: `${provider} ${row.provider_ref || ''}`.trim(), onlinePaymentId: row.id,
      }))
      const extra = r2(paid - (res?.amount || 0))
      let advance = null
      if (extra > 0.005) {
        advance = asSystem(() => get().receiveAdvance({
          customerId: invoice.customerId, customerName: invoice.customerName, date,
          amount: r2(extra * (Number(invoice.exchangeRate) || 1)), bankAccountId: deposit,
          reference: `${provider} ${row.provider_ref || ''} — paid online for ${invoice.number}`.trim(),
          notes: `More than ${invoice.number} still owed; kept on account.`,
        }))
      }
      get().logActivity?.('Online payment recorded', `${invoice.number} · ${paid} ${row.currency} via ${provider}`, { entity: 'invoice', entityId: invoice.id })
      await mark(row.id, { applied_ref: res?.number || (advance ? 'advance' : 'recorded') })
      applied++
    } catch (e) {
      await mark(row.id, { applied_at: null, applied_by: null, applied_ref: String(e?.message || e).slice(0, 200) })
    }
  }
  return { applied, waiting: 0 }
}

// Open checkouts are re-checked with the provider at most this often, so a
// customer who paid and closed the tab is still picked up even when no
// provider notification arrives.
const REFRESH_EVERY_MS = 10 * 60 * 1000
let lastRefresh = 0

/** The sync cycle's hook: re-check open checkouts now and then, then record what was paid. */
export async function onlinePaymentsAfterSync(get) {
  const companyId = cloudCompanyId()
  if (!companyId || !get().settings.onlinePayments?.enabled) return null
  const client = await db()
  if (Date.now() - lastRefresh > REFRESH_EVERY_MS) {
    lastRefresh = Date.now()
    const since = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data: open } = await client.from('online_payments').select('id')
      .eq('company_id', companyId).eq('status', 'pending').gte('created_at', since).limit(1)
    if (open?.length) await refreshPayments()
  }
  const { data } = await client.auth.getSession()
  return applyOnlinePayments({ client, companyId, get, userId: data?.session?.user?.id ?? null })
}
