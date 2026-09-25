// Customer portal links (see supabase/functions/portal and the Portal page).
// A link is a random token the company hands to one customer; opening it
// shows that customer their own invoices and balance, with no sign-in.
import { cloudCompanyId } from './aiServer'

/** The address a customer opens. Uses the query string so it works on any host. */
export function portalUrl(token, origin = typeof window !== 'undefined' ? window.location.origin : '') {
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
  return `${origin}${base}?portal=${encodeURIComponent(token)}`
}

/** The token in the current address, or '' when this isn't a portal visit. */
export function portalTokenFromLocation(search = typeof window !== 'undefined' ? window.location.search : '') {
  const t = new URLSearchParams(search).get('portal') || ''
  return /^[0-9a-f-]{36}$/i.test(t) ? t : ''
}

const db = async () => (await import('../lib/supabase')).getSupabase()

/** Links for one customer, newest first (revoked ones included, so the history shows). */
export async function listPortalLinks(customerId) {
  const companyId = cloudCompanyId()
  if (!companyId) return []
  const { data, error } = await (await db()).from('portal_links').select('*')
    .eq('company_id', companyId).eq('customer_id', String(customerId)).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

/** The customer's current link, making one if there is none. */
export async function getOrCreatePortalLink(customer) {
  const companyId = cloudCompanyId()
  if (!companyId) throw new Error('NOT_CLOUD')
  const active = (await listPortalLinks(customer.id)).find((l) => !l.revoked_at && (!l.expires_at || new Date(l.expires_at) > new Date()))
  if (active) return active
  const { data, error } = await (await db()).from('portal_links')
    .insert({ company_id: companyId, customer_id: String(customer.id), customer_name: customer.name || '' })
    .select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function revokePortalLink(token) {
  const { error } = await (await db()).from('portal_links').update({ revoked_at: new Date().toISOString() }).eq('token', token)
  if (error) throw new Error(error.message)
}

/** Load the portal for a token (anonymous: customers have no account). */
export async function loadPortal(token) {
  const { data, error } = await (await db()).functions.invoke('portal', { body: { token } })
  if (error) {
    let msg = error.message
    try { msg = (await error.context?.json())?.error || msg } catch { /* keep it */ }
    return { error: msg }
  }
  return data
}
