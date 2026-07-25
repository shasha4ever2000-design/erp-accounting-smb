// Shared handler for the PERIOD_LOCKED error thrown by the store when a posting
// (or delete) would touch a closed accounting period. Returns true if it handled
// the error (showing a friendly alert) so callers can `return` instead of letting
// a raw exception bubble up. Usage:
//   try { ...post... } catch (e) { if (alertIfLocked(e, t)) return; throw e }
export function alertIfLocked(e, t) {
  const msg = String(e?.message || '')
  if (!msg.startsWith('PERIOD_LOCKED')) return false
  const lock = msg.split(':')[1] || ''
  const base = t
    ? t('This date falls in a closed accounting period. Choose a later date.')
    : 'This date falls in a closed accounting period. Choose a later date.'
  alert(base + (lock ? ` (${lock})` : ''))
  return true
}
