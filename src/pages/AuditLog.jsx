import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { PageHeader, Card, Btn, Select, EmptyState } from '../components/UI'
import ExportMenu from '../components/ExportMenu'
import { Search, ShieldCheck, Lock, AlertTriangle, Pencil, Activity } from 'lucide-react'

const SEVERITY = {
  critical: { chip: 'bg-red-50 text-red-700 dark:bg-red-900/25 dark:text-red-300', icon: AlertTriangle, label: 'Critical' },
  notable:  { chip: 'bg-amber-50 text-amber-700 dark:bg-amber-900/25 dark:text-amber-300', icon: Pencil, label: 'Change' },
  routine:  { chip: 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400', icon: Activity, label: 'Routine' },
}

function fmtTs(ts) {
  try { return new Date(ts).toLocaleString() } catch { return ts }
}

export default function AuditLog() {
  const t = useT()
  const { auditLog } = useStore()
  const [search, setSearch] = useState('')
  const [severity, setSeverity] = useState('all')
  const [who, setWho] = useState('all')
  const [entity, setEntity] = useState('all')

  const users = useMemo(() => [...new Set((auditLog || []).map((e) => e.user).filter(Boolean))].sort(), [auditLog])
  const entities = useMemo(() => [...new Set((auditLog || []).map((e) => e.entity).filter(Boolean))].sort(), [auditLog])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = [...(auditLog || [])].reverse()
    if (severity !== 'all') list = list.filter((e) => (e.severity || 'routine') === severity)
    if (who !== 'all') list = list.filter((e) => e.user === who)
    if (entity !== 'all') list = list.filter((e) => e.entity === entity)
    if (q) list = list.filter((e) =>
      (e.action || '').toLowerCase().includes(q) ||
      (e.detail || '').toLowerCase().includes(q) ||
      (e.user || '').toLowerCase().includes(q) ||
      (e.entityRef || '').toLowerCase().includes(q)
    )
    return list
  }, [auditLog, search, severity, who, entity])

  const exportColumns = [
    { key: 'ts', label: t('When') }, { key: 'user', label: t('User') },
    { key: 'action', label: t('Action') }, { key: 'entityRef', label: t('Reference') },
    { key: 'severity', label: t('Severity') }, { key: 'detail', label: t('Details') },
  ]

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle={`${(auditLog || []).length} ${t('recorded activities · who did what, and when')}`}
        action={(auditLog || []).length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5">
            <Lock size={13} /> {t('Append-only')}
          </span>
        )}
      />

      {(auditLog || []).length === 0 ? (
        <Card>
          <EmptyState icon="🛡️" title="No activity yet"
            desc="As you post invoices, payments, purchases and other transactions, every action is recorded here with the user and timestamp." />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 pointer-events-none" />
            <input className="w-full ps-9 pe-3 py-2 text-sm bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 shadow-input dark:shadow-none transition-all duration-150 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:focus:ring-brand-400/20"
              placeholder="Search activity, user, reference…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select label={t('Severity')} value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-36">
              <option value="all">{t('All')}</option>
              <option value="critical">{t('Critical')}</option>
              <option value="notable">{t('Change')}</option>
              <option value="routine">{t('Routine')}</option>
            </Select>
            {users.length > 1 && (
              <Select label={t('User')} value={who} onChange={(e) => setWho(e.target.value)} className="w-40">
                <option value="all">{t('All')}</option>
                {users.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            )}
            {entities.length > 0 && (
              <Select label={t('Record type')} value={entity} onChange={(e) => setEntity(e.target.value)} className="w-40">
                <option value="all">{t('All')}</option>
                {entities.map((x) => <option key={x} value={x}>{t(x)}</option>)}
              </Select>
            )}
            <div className="ms-auto">
              <ExportMenu filename={`audit-log-${new Date().toISOString().slice(0, 10)}`} rows={rows} columns={exportColumns}
                title={t('Audit Log')} subtitle={`${rows.length} ${t('events')}`} size="sm" />
            </div>
          </div>
          <p className="text-xs text-gray-400 dark:text-slate-500 mb-3">{rows.length} {t('of')} {(auditLog || []).length} {t('events')}</p>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/60">
                <tr className="text-xs text-gray-400 dark:text-slate-500 uppercase">
                  <th className="text-left px-5 py-2.5 w-44">When</th>
                  <th className="text-left px-4 py-2.5 w-40">User</th>
                  <th className="text-left px-3 py-2.5 w-24">{t('Severity')}</th>
                  <th className="text-left px-4 py-2.5">Action</th>
                  <th className="text-left px-5 py-2.5">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-b border-gray-50 dark:border-slate-700/50">
                    <td className="px-5 py-2.5 text-gray-500 dark:text-slate-400 whitespace-nowrap">{fmtTs(e.ts)}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-gray-700 dark:text-slate-200">
                        <ShieldCheck size={13} className="text-green-500" /> {e.user}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {(() => { const sv = SEVERITY[e.severity] || SEVERITY.routine; const Ico = sv.icon
                        return <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${sv.chip}`}><Ico size={10} />{t(sv.label)}</span> })()}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-slate-100 capitalize">
                      {e.action}
                      {e.entityRef && <span className="block text-xs font-normal text-gray-400 dark:text-slate-500 font-mono">{e.entityRef}</span>}
                    </td>
                    <td className="px-5 py-2.5 text-gray-500 dark:text-slate-400">
                      {/* Field-level diff when we have one — "what changed", not just "changed". */}
                      {e.changes && e.changes.length > 0 ? (
                        <div className="space-y-0.5">
                          {e.changes.slice(0, 4).map((c, i) => (
                            <div key={i} className="text-xs">
                              <span className="text-gray-500 dark:text-slate-400">{c.field}</span>{' '}
                              <span className="text-red-500/80 dark:text-red-400/80 line-through">{c.from}</span>{' → '}
                              <span className="text-green-600 dark:text-green-400">{c.to}</span>
                            </div>
                          ))}
                          {e.changes.length > 4 && <div className="text-xs text-gray-400 dark:text-slate-500">+{e.changes.length - 4} {t('more')}</div>}
                        </div>
                      ) : e.detail}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400 dark:text-slate-500">{t('No matching activity')}</td></tr>}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}
