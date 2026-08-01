// Thin wrapper over Supabase Auth + the company/membership RPCs. Kept
// deliberately simple — the actual sync logic (the part with real risk of
// data-corruption bugs) lives in cloudSync.js, which has full unit coverage
// against a fake client. This module is mostly one-line passthroughs that
// are easy to eyeball-verify and cheap to fix if the real API differs.
//
// Cloud sync is opt-in and layered on top of the existing local-only
// company/auth model in auth.js — nothing here runs unless a company is
// explicitly linked to a cloud company (see auth.js: cloudCompanyId).

import { getSupabase } from './lib/supabase'
import { validatePassword } from './utils/password'

export async function cloudSignUp({ email, password, name }) {
  // The same floor as a local account. Supabase can screen against the
  // HaveIBeenPwned corpus, but only on a paid plan — this project is on the
  // free tier, so the check has to be ours either way.
  const pwCheck = validatePassword(password, { name, email })
  if (!pwCheck.ok) return { error: pwCheck.error }

  const { data, error } = await getSupabase().auth.signUp({
    email: (email || '').trim().toLowerCase(),
    password,
    options: { data: { name: (name || '').trim() } },
  })
  if (error) return { error: error.message }
  return { ok: true, user: data.user, needsEmailConfirm: !data.session }
}

export async function cloudSignIn({ email, password }) {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email: (email || '').trim().toLowerCase(), password })
  if (error) return { error: error.message }
  return { ok: true, user: data.user }
}

export async function cloudSignOut() {
  await getSupabase().auth.signOut()
}

export async function getCloudSession() {
  const { data } = await getSupabase().auth.getSession()
  return data.session
}

/**
 * Subscribe to auth state changes. `callback` receives (session, event) —
 * most callers only need the session, but the event distinguishes an
 * ordinary sign-in from Supabase landing the user back on the app with a
 * one-time PASSWORD_RECOVERY session after they clicked the email link from
 * cloudResetPassword. Returns an unsubscribe function.
 */
export function onCloudAuthChange(callback) {
  const { data } = getSupabase().auth.onAuthStateChange((event, session) => callback(session, event))
  return () => data.subscription.unsubscribe()
}

// The email link from resetPasswordForEmail has to send the browser
// somewhere that will actually load the SPA and run detectSessionInUrl. On
// the web that's wherever the app is currently hosted; the desktop build has
// no https origin of its own (file:// / app://), so its recovery emails
// point at the hosted web app instead — same Supabase project, so signing
// in there updates the same account the desktop app uses.
const HOSTED_WEB_APP_URL = 'https://shasha4ever2000-design.github.io/erp-accounting-smb/'

function resetRedirectUrl() {
  if (typeof window === 'undefined') return HOSTED_WEB_APP_URL
  const { protocol, origin, pathname } = window.location
  if (protocol !== 'http:' && protocol !== 'https:') return HOSTED_WEB_APP_URL
  return origin + pathname
}

/** Send a password-reset email. Supabase reports success here even for an unregistered email, by design, so this can't be used to probe which addresses have accounts. */
export async function cloudResetPassword(email) {
  const { error } = await getSupabase().auth.resetPasswordForEmail((email || '').trim().toLowerCase(), {
    redirectTo: resetRedirectUrl(),
  })
  if (error) return { error: error.message }
  return { ok: true }
}

/** Set a new password for the currently-signed-in session (used right after the PASSWORD_RECOVERY redirect). */
export async function cloudUpdatePassword(password) {
  const { data: { session } } = await getSupabase().auth.getSession()
  const pwCheck = validatePassword(password, { email: session?.user?.email })
  if (!pwCheck.ok) return { error: pwCheck.error }

  const { error } = await getSupabase().auth.updateUser({ password })
  if (error) return { error: error.message }
  return { ok: true }
}

// ── Companies & membership ────────────────────────────────────────────

export async function createCloudCompany(name) {
  const { data, error } = await getSupabase().rpc('create_company', { company_name: name })
  if (error) return { error: error.message }
  return { ok: true, company: data }
}

export async function listMyCloudCompanies() {
  const { data, error } = await getSupabase().from('companies').select('id, name, created_at').order('created_at', { ascending: true })
  if (error) return { error: error.message }
  return { ok: true, companies: data || [] }
}

export async function listCompanyMembers(companyId) {
  const client = getSupabase()
  const { data: members, error } = await client.from('company_members').select('user_id, role, created_at').eq('company_id', companyId)
  if (error) return { error: error.message }
  const ids = (members || []).map((m) => m.user_id)
  if (!ids.length) return { ok: true, members: [] }
  const { data: profiles } = await client.from('profiles').select('id, name, email').in('id', ids)
  const byId = Object.fromEntries((profiles || []).map((p) => [p.id, p]))
  return { ok: true, members: members.map((m) => ({ ...m, name: byId[m.user_id]?.name || '', email: byId[m.user_id]?.email || '' })) }
}

export async function updateMemberRole(companyId, userId, role) {
  const { error } = await getSupabase().from('company_members').update({ role }).eq('company_id', companyId).eq('user_id', userId)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function removeMember(companyId, userId) {
  const { error } = await getSupabase().from('company_members').delete().eq('company_id', companyId).eq('user_id', userId)
  if (error) return { error: error.message }
  return { ok: true }
}

// ── Invites ─────────────────────────────────────────────────────────────

export async function inviteMember(companyId, email, role = 'member') {
  const { error } = await getSupabase().from('company_invites').insert({ company_id: companyId, email: (email || '').trim().toLowerCase(), role })
  if (error) return { error: error.message.includes('duplicate') ? 'An invite is already pending for this email.' : error.message }
  return { ok: true }
}

export async function listPendingInvites(companyId) {
  const { data, error } = await getSupabase().from('company_invites').select('id, email, role, created_at').eq('company_id', companyId).is('accepted_at', null)
  if (error) return { error: error.message }
  return { ok: true, invites: data || [] }
}

export async function cancelInvite(inviteId) {
  const { error } = await getSupabase().from('company_invites').delete().eq('id', inviteId)
  if (error) return { error: error.message }
  return { ok: true }
}

/** Invites addressed to the signed-in user's own email, across all companies. */
export async function myPendingInvites() {
  const { data, error } = await getSupabase().from('company_invites').select('id, token, role, created_at, companies(name)').is('accepted_at', null)
  if (error) return { error: error.message }
  return { ok: true, invites: data || [] }
}

export async function acceptInvite(token) {
  const { data, error } = await getSupabase().rpc('accept_company_invite', { invite_token: token })
  if (error) return { error: error.message === 'INVITE_NOT_FOUND_OR_EXPIRED' ? 'This invite is no longer valid.' : error.message }
  return { ok: true, company: data }
}
