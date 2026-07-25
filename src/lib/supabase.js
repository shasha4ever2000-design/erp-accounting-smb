// Supabase client for optional cloud sync. The app is local-first by design —
// this client is only ever touched when a company explicitly opts into cloud
// sync (see cloudAuth.js / cloudSync.js). Nothing here runs for local-only
// companies, and the app must keep working with this module entirely absent
// of a network connection.
//
// The URL and publishable ("anon") key below are meant to be public: they are
// only usable in combination with the row-level security policies defined in
// supabase/migrations/0001_init.sql, which restrict every row to members of
// the owning company. Never put the Supabase *secret* key in this codebase —
// it bypasses RLS entirely and this app has no backend to keep it hidden in.

import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://zkqvcmlotvkcisznaxka.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_AwOAbXH6SIdx5hKtZ61Hnw_1pz_BCFa'

let _client = null

/** Lazily create the Supabase client so importing this module has no side effects. */
export function getSupabase() {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  }
  return _client
}

/** True if the browser currently reports a network connection. Sync callers
 * should still handle request failures — this is just a cheap early-out. */
export function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}
