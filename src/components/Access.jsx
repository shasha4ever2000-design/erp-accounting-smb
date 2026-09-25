// Screens' side of roles and permissions (see utils/permissions.js).
import { useLocation, Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../auth'
import { useT } from '../i18n'
import { areaForPath, actionForPath, roleLabel, areaLabel } from '../utils/permissions'
import { useCan } from '../utils/useCan'
import { Card } from './UI'

export { useCan }

/** Whether the current user may open `path` at all (used by the menu and search). */
export function useCanOpen() {
  const allowed = useCan()
  return (path) => {
    const area = areaForPath(path)
    return !area || allowed(area, actionForPath(path))
  }
}

/** Shows the page, or a plain "no access" notice when the role doesn't allow it. */
export function RouteGuard({ children }) {
  const { pathname } = useLocation()
  const canOpen = useCanOpen()
  const role = useAuth((s) => s.users.find((u) => u.id === s.currentUserId)?.role || null)
  const t = useT()
  if (canOpen(pathname)) return children
  const area = areaForPath(pathname)
  return (
    <Card className="p-10 text-center max-w-lg mx-auto mt-10">
      <ShieldAlert size={32} className="mx-auto mb-3 text-warning-700 dark:text-warning-400" />
      <p className="text-slate-700 dark:text-slate-200 font-medium">
        {t('Your role ({role}) does not have access to {area}.').replace('{role}', t(roleLabel(role))).replace('{area}', t(areaLabel(area)))}
      </p>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('Ask an owner or admin if you need this.')}</p>
      <Link to="/" className="inline-block mt-4 text-sm font-medium text-brand-700 dark:text-brand-300 hover:underline">{t('Back to dashboard')}</Link>
    </Card>
  )
}
