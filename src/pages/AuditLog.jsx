import { useState, useMemo } from 'react'
import { useStore } from '../store'
import { PageHeader, Card, Btn, EmptyState } from '../components/UI'
import { Search, ShieldCheck, Trash2 } from 'lucide-react'

function fmtTs(ts) {
  try { return new Date(ts).toLocaleString() } catch { return ts }
}

export default function AuditLog() {
  const { auditLog, clearAuditLog } = useStore()
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = [...(auditLog || [])].reverse()
    if (!q) return list
    return list.filter((e) =>
      (e.action || '').toLowerCase().includes(q) ||
      (e.detail || '').toLowerCase().includes(q) ||
      (e.user || '').toLowerCase().includes(q)
    )
  }, [auditLog, search])

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle={`${(auditLog || []).length} recorded activities · who did what, and when`}
        action={(auditLog || []).length > 0 && (
          <Btn variant="secondary" onClick={() => { if (confirm('Clear the activity log for this company? This cannot be undone.')) clearAuditLog() }}>
            <Trash2 size={14} /> Clear log
          </Btn>
        )}
      />

      {(auditLog || []).length === 0 ? (
        <Card>
          <EmptyState icon="🛡️" title="No activity yet"
            desc="As you post invoices, payments, purchases and other transactions, every action is recorded here with the user and timestamp." />
        </Card>
      ) : (
        <>
          <div className="relative mb-4 max-w-sm">
            <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
            <input className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search activity, user, reference…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/60">
                <tr className="text-xs text-gray-400 dark:text-slate-500 uppercase">
                  <th className="text-left px-5 py-2.5 w-44">When</th>
                  <th className="text-left px-4 py-2.5 w-40">User</th>
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
                    <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-slate-100 capitalize">{e.action}</td>
                    <td className="px-5 py-2.5 text-gray-500 dark:text-slate-400">{e.detail}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-400">No matching activity</td></tr>}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}
