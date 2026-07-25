import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtDate } from '../utils/formatters'
import { tone } from '../utils/formatters'
import { PageHeader, Card, Btn, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import { describe as describeEntry, entityLabel, countByEntity, ageInDays, canRestore, RECYCLABLE } from '../utils/recycleBin'
import { Trash2, Undo2, AlertTriangle, Clock, Archive, Info } from 'lucide-react'

export default function RecycleBin() {
  const t = useT()
  const store = useStore()
  const { recycleBin = [], restoreFromBin, purgeFromBin, emptyRecycleBin } = store

  const [filter, setFilter] = useState('all')

  const rows = useMemo(
    () => recycleBin
      .filter((e) => filter === 'all' || e.entity === filter)
      .slice()
      .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))),
    [recycleBin, filter]
  )
  const counts = useMemo(() => countByEntity(recycleBin), [recycleBin])
  const oldest = recycleBin.reduce((m, e) => Math.max(m, ageInDays(e)), 0)

  const handleRestore = (entry) => {
    try {
      restoreFromBin(entry.id)
    } catch (e) {
      alert(t('Could not restore') + ': ' + String(e.message || e).replace('RESTORE_DENIED:', ''))
    }
  }

  const handlePurge = (entry) => {
    if (!confirm(t('Delete "{n}" for good? This cannot be undone.').replace('{n}', describeEntry(entry)))) return
    purgeFromBin(entry.id)
  }

  const handleEmpty = () => {
    if (!recycleBin.length) return
    if (!confirm(t('Permanently delete all {n} item(s)? This cannot be undone.').replace('{n}', recycleBin.length))) return
    emptyRecycleBin()
  }

  return (
    <div>
      <PageHeader
        title="Recycle Bin"
        subtitle="Records you deleted, kept so a mistake is not final"
        action={recycleBin.length > 0
          ? <Btn variant="secondary" onClick={handleEmpty}><Trash2 size={15} /> {t('Empty bin')}</Btn>
          : null}
      />

      <Card className="p-4 mb-6 flex items-start gap-3">
        <Info size={18} className="text-brand-600 dark:text-brand-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-gray-600 dark:text-slate-300">
          {t('Holds customers, suppliers, items, accounts and templates. Invoices, bills and journal entries are never here — those are voided with a reversing entry so the ledger stays complete and auditable.')}
        </p>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="In the bin" value={String(recycleBin.length)} icon={<Archive size={18} />} color="blue" />
        <StatCard label="Types" value={String(Object.keys(counts).length)} icon={<Trash2 size={18} />} color="purple" />
        <StatCard label="Oldest" value={oldest ? t('{n} days').replace('{n}', oldest) : '—'} icon={<Clock size={18} />} color={oldest > 90 ? 'orange' : 'blue'} />
      </div>

      {recycleBin.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Archive size={28} className="text-slate-400 dark:text-slate-500" />}
            title="The bin is empty"
            desc="Anything you delete from customers, suppliers, items, accounts or templates lands here first."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-gray-100 dark:border-surface-750 flex flex-wrap gap-1.5">
            <button onClick={() => setFilter('all')}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === 'all' ? 'bg-brand-600 text-white shadow-card' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-surface-750'}`}>
              {t('All')} <span className="opacity-70 text-xs">{recycleBin.length}</span>
            </button>
            {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([entity, n]) => (
              <button key={entity} onClick={() => setFilter(entity)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === entity ? 'bg-brand-600 text-white shadow-card' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-surface-750'}`}>
                {t(entityLabel(entity))} <span className="opacity-70 text-xs">{n}</span>
              </button>
            ))}
          </div>

          <Table headers={['Deleted', 'Type', 'Record', 'Deleted by', '']}>
            {rows.map((e) => {
              const slice = store[RECYCLABLE[e.entity]?.slice] || []
              const allowed = canRestore(e, slice)
              const age = ageInDays(e)
              return (
                <Tr key={e.id}>
                  <Td>
                    {fmtDate(e.deletedAt)}
                    <span className="ms-2 text-xs text-gray-400 dark:text-slate-500">
                      {age === 0 ? t('today') : t('{n}d ago').replace('{n}', age)}
                    </span>
                  </Td>
                  <Td><Badge className={tone.neutral}>{t(entityLabel(e.entity))}</Badge></Td>
                  <Td className="text-gray-800 dark:text-slate-100">{describeEntry(e)}</Td>
                  <Td className="text-gray-500 dark:text-slate-400">{e.deletedByName}</Td>
                  <Td>
                    <div className="flex items-center gap-1.5 justify-end">
                      {allowed.ok ? (
                        <Btn size="sm" variant="secondary" onClick={() => handleRestore(e)}>
                          <Undo2 size={14} /> {t('Restore')}
                        </Btn>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-warning-600 dark:text-warning-400">
                          <AlertTriangle size={13} /> {t(allowed.reason)}
                        </span>
                      )}
                      <button onClick={() => handlePurge(e)} title={t('Delete for good')}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        </Card>
      )}
    </div>
  )
}
