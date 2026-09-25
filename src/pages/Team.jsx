import { useState } from 'react'
import { useAuth } from '../auth'
import { useT } from '../i18n'
import { PageHeader, Card, Select, Btn } from '../components/UI'
import { ShieldAlert, Trash2, Crown, Lock, RotateCcw } from 'lucide-react'
import { ask } from '../components/Dialogs'
import { ROLES, AREAS, ACTIONS, permissionsFor } from '../utils/permissions'

export default function Team() {
  const t = useT()
  const { users, currentUserId, isManager, setUserRole, removeUser, rolePermissions, setRolePermission, resetRolePermissions } = useAuth()
  const manager = isManager()
  const myRole = users.find((u) => u.id === currentUserId)?.role
  const [editRole, setEditRole] = useState('accountant')

  if (!manager) {
    return (
      <div>
        <PageHeader title="Team & roles" />
        <Card className="p-10 text-center">
          <ShieldAlert size={32} className="mx-auto mb-3 text-warning-700 dark:text-warning-400" />
          <p className="text-slate-600 dark:text-slate-300 font-medium">{t('Only Owners and Admins can manage the team.')}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('Ask an administrator if you need different access.')}</p>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Team & roles" subtitle={`${users.length} ${t('users on this device')}`} />

      <Card className="overflow-hidden mb-5">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr className="text-xs text-slate-500 dark:text-slate-400 uppercase">
              <th className="text-left px-5 py-2.5">User</th>
              <th className="text-left px-4 py-2.5">Email</th>
              <th className="text-left px-4 py-2.5 w-44">Role</th>
              <th className="text-right px-5 py-2.5">{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-50 dark:border-slate-700/50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-accent-600 text-white text-xs font-bold flex items-center justify-center">
                      {(u.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                        {u.name}{u.role === 'owner' && <Crown size={12} className="text-violet-500" />}
                        {u.id === currentUserId && <span className="text-xs text-slate-500 dark:text-slate-400">(you)</span>}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{u.email}</td>
                <td className="px-4 py-3">
                  <Select value={u.role || 'viewer'} onChange={(e) => setUserRole(u.id, e.target.value)}
                    aria-label={t('Role')} disabled={u.role === 'owner' && myRole !== 'owner'}>
                    {ROLES.filter((r) => r.id !== 'owner' || myRole === 'owner' || u.role === 'owner').map((r) => <option key={r.id} value={r.id}>{t(r.label)}</option>)}
                  </Select>
                </td>
                <td className="px-5 py-3 text-right">
                  {u.id !== currentUserId && (
                    <button onClick={async () => { if (await ask(`Remove ${u.name}'s account from this device?`)) removeUser(u.id) }} className="text-danger-600 dark:text-danger-400 hover:text-danger-600 dark:hover:text-danger-400"><Trash2 size={15} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <RoleMatrix role={editRole} setRole={setEditRole} overrides={rolePermissions}
        onToggle={setRolePermission} onReset={resetRolePermissions} />
    </div>
  )
}

function RoleMatrix({ role, setRole, overrides, onToggle, onReset }) {
  const t = useT()
  const def = ROLES.find((r) => r.id === role)
  const grants = permissionsFor(role, overrides)
  const changed = !!overrides?.[role]
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('What each role can do')}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('Tick what the role may do in each area. Changes apply straight away to everyone with that role.')}</p>
        </div>
        <div className="flex-1" />
        <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label={t('Role')} className="w-48">
          {ROLES.map((r) => <option key={r.id} value={r.id}>{t(r.label)}</option>)}
        </Select>
        {changed && !def?.locked && (
          <Btn variant="secondary" size="sm" onClick={() => onReset(role)}><RotateCcw size={13} /> {t('Reset to default')}</Btn>
        )}
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">{t(def?.desc || '')}</p>
      {def?.locked && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1.5">
          <Lock size={12} /> {t('Owners and admins always have full access, so nobody can be locked out of the books.')}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr className="text-xs text-slate-500 dark:text-slate-400">
              <th className="text-start px-4 py-2.5 font-semibold">{t('Area')}</th>
              {ACTIONS.map((a) => <th key={a.id} className="px-3 py-2.5 font-semibold text-center">{t(a.label)}</th>)}
            </tr>
          </thead>
          <tbody>
            {AREAS.map((area) => (
              <tr key={area.id} className="border-b border-slate-50 dark:border-slate-700/50">
                <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">{t(area.label)}</td>
                {ACTIONS.map((a) => {
                  const on = (grants[area.id] || []).includes(a.id)
                  return (
                    <td key={a.id} className="px-3 py-2.5 text-center">
                      <input type="checkbox" checked={on} disabled={def?.locked}
                        aria-label={`${t(area.label)}: ${t(a.label)}`}
                        onChange={(e) => onToggle(role, area.id, a.id, e.target.checked)}
                        className="w-4 h-4 rounded accent-brand-600 disabled:opacity-60" />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-4 flex items-start gap-2">
        <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
        {t('These rules are checked every time data changes, not just by hiding buttons. They apply to the people who sign in on this device; for a shared cloud company, each person also needs the matching cloud role.')}
      </p>
    </Card>
  )
}
