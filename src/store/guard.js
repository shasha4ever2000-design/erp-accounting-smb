// Permission check around every store action. See utils/permissions.js.
//
// Only the outermost call is checked. Recording an invoice payment posts a
// journal entry internally; a sales clerk may record the payment without
// holding "create journal entries" in Accounting, because the entry is part
// of what they were allowed to do, not a separate thing they chose to do.
import { ACTION_PERMISSIONS, UNGUARDED, currentActor, can, PermissionError } from '../utils/permissions'

let depth = 0

/** Run `fn` as the app itself (schedulers, sync), not as the signed-in user. */
export function asSystem(fn) {
  depth++
  try { return fn() } finally { depth-- }
}

export function checkPermission(name) {
  if (depth > 0) return
  const rule = ACTION_PERMISSIONS[name]
  if (!rule) return
  const actor = currentActor()
  if (!actor) return
  const [area, action] = rule
  if (!can(actor.role, area, action, actor.overrides)) throw new PermissionError(area, action, actor.role)
}

/**
 * Wrap each function in `state` with the check, keeping everything else as is.
 * The app's own background jobs (UNGUARDED: schedulers, sync) run as the
 * system, so whatever they post on the user's behalf isn't refused halfway.
 */
export function guardActions(state) {
  const out = {}
  for (const [name, value] of Object.entries(state)) {
    const guarded = !!ACTION_PERMISSIONS[name]
    if (typeof value !== 'function' || (!guarded && !UNGUARDED.has(name))) { out[name] = value; continue }
    out[name] = function wrapped(...args) {
      if (guarded) checkPermission(name)
      depth++
      try { return value.apply(this, args) } finally { depth-- }
    }
  }
  return out
}
