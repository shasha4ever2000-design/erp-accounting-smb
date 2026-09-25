// `const allowed = useCan()` then `allowed('sales', 'delete')`. See permissions.js.
// Kept apart from components/Access.jsx so the shared UI kit can use it
// without importing the screens that import the UI kit.
import { useAuth } from '../auth'
import { can } from './permissions'

export function useCan() {
  const role = useAuth((s) => s.users.find((u) => u.id === s.currentUserId)?.role || null)
  const overrides = useAuth((s) => s.rolePermissions)
  // Nobody signed in (first run, tests): nothing to restrict.
  return (area, action = 'view') => (role ? can(role, area, action, overrides) : true)
}
