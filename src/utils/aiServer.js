// Calling the company's AI server function (supabase/functions/ai-chat).
//
// A cloud-linked company can switch this on in Settings → AI Assistant, and
// then nobody needs an API key in their browser: the chat assistant and
// receipt scanning both go through the function, which holds the key.

import { useAuth } from '../auth'

/** The current company's cloud id, or '' when it is local-only. */
export function cloudCompanyId() {
  const s = useAuth.getState()
  return s.companies.find((c) => c.id === s.currentCompanyId)?.cloudCompanyId || ''
}

/**
 * A function that sends one request body to the server, or null when the
 * server path is not in use (switched off, or the company is not in the
 * cloud). The returned function resolves the function's JSON reply, or
 * `{ error }` with a message a person can read.
 */
export function aiServerInvoker(settings) {
  const companyId = cloudCompanyId()
  if (!settings?.ai?.useServer || !companyId) return null
  return async (body) => {
    const { getSupabase } = await import('../lib/supabase')
    const { data, error } = await getSupabase().functions.invoke('ai-chat', { body: { companyId, ...body } })
    if (error) {
      let msg = error.message
      try { msg = (await error.context?.json())?.error || msg } catch { /* keep the generic message */ }
      return { error: msg }
    }
    return data
  }
}
