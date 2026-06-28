import { useAuth } from '../auth'
import { useT } from '../i18n'
import { PageHeader, Card, Select, Badge } from '../components/UI'
import { Users, ShieldAlert, Trash2, Crown } from 'lucide-react'

const ROLES = [
  { id: 'owner', label: 'Owner', desc: 'Full control, incl. companies & team' },
  { id: 'admin', label: 'Admin', desc: 'Manage settings, team & all data' },
  { id: 'accountant', label: 'Accountant', desc: 'Day-to-day bookkeeping' },
  { id: 'viewer', label: 'Viewer', desc: 'Read-only access' },
]
const ROLE_CLR = {
  owner: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  admin: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  accountant: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  viewer: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
}

export default function Team() {
  const t = useT()
  const { users, currentUserId, isManager, setUserRole, removeUser } = useAuth()
  const manager = isManager()

  if (!manager) {
    return (
      <div>
        <PageHeader title="Team & Roles" />
        <Card className="p-10 text-center">
          <ShieldAlert size={32} className="mx-auto mb-3 text-amber-500" />
          <p className="text-gray-600 dark:text-slate-300 font-medium">{t('Only Owners and Admins can manage the team.')}</p>
          <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">{t('Ask an administrator if you need different access.')}</p>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Team & Roles" subtitle={`${users.length} user${users.length !== 1 ? 's' : ''} on this device`} />

      <Card className="overflow-hidden mb-5">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-slate-800/60">
            <tr className="text-xs text-gray-400 dark:text-slate-500 uppercase">
              <th className="text-left px-5 py-2.5">User</th>
              <th className="text-left px-4 py-2.5">Email</th>
              <th className="text-left px-4 py-2.5 w-44">Role</th>
              <th className="text-right px-5 py-2.5">{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-gray-50 dark:border-slate-700/50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-bold flex items-center justify-center">
                      {(u.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-gray-800 dark:text-slate-100 flex items-center gap-1.5">
                        {u.name}{u.role === 'owner' && <Crown size={12} className="text-violet-500" />}
                        {u.id === currentUserId && <span className="text-xs text-gray-400">(you)</span>}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{u.email}</td>
                <td className="px-4 py-3">
                  <Select value={u.role || 'viewer'} onChange={(e) => setUserRole(u.id, e.target.value)}>
                    {ROLES.map((r) => <option key={r.id} value={r.id}>{t(r.label)}</option>)}
                  </Select>
                </td>
                <td className="px-5 py-3 text-right">
                  {u.id !== currentUserId && (
                    <button onClick={() => { if (confirm(`Remove ${u.name}'s account from this device?`)) removeUser(u.id) }} className="text-red-400 hover:text-red-600"><Trash2 size={15} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-3">{t('Role permissions')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ROLES.map((r) => (
            <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-slate-800/50">
              <Badge className={ROLE_CLR[r.id]}>{r.label}</Badge>
              <span className="text-sm text-gray-600 dark:text-slate-300">{t(r.desc)}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 dark:text-slate-500 mt-4 flex items-start gap-2">
          <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
          Roles organise access on this device. Server-enforced, tamper-proof permissions arrive with cloud sync.
        </p>
      </Card>
    </div>
  )
}
