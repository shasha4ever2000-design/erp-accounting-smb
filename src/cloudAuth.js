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

export async function cloudSignUp({ email, password, name }) {
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

/** Subscribe to auth state changes. Returns an unsubscribe function. */
export function onCloudAuthChange(callback) {
  const { data } = getSupabase().auth.onAuthStateChange((_event, session) => callback(session))
  return () => data.subscription.unsubscribe()
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
