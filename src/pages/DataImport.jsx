import { useState, useRef, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { PageHeader, Card, Btn, Select, Badge, Table, Tr, Td, EmptyState } from '../components/UI'
import { parseCSV, exportCSV } from '../utils/csv'
import { tone } from '../utils/formatters'
import {
  SCHEMAS, autoMap, planImport, applyPlan, exportColumns, templateRow, EXCLUDED_NOTE,
} from '../utils/dataImport'
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle, Info, Play, X } from 'lucide-react'

export default function DataImport() {
  const t = useT()
  const store = useStore()
  const fileRef = useRef(null)

  const [entity, setEntity] = useState('customers')
  const [file, setFile] = useState(null)          // { name, headers, rows }
  const [map, setMap] = useState({})
  const [updateExisting, setUpdateExisting] = useState(true)
  const [result, setResult] = useState(null)

  const schema = SCHEMAS[entity]
  const existing = store[schema.store.list] || []

  const plan = useMemo(
    () => (file ? planImport(entity, file.rows, map, existing) : null),
    [file, entity, map, existing]
  )

  const reset = () => { setFile(null); setMap({}); setResult(null) }

  const onEntityChange = (e) => { setEntity(e.target.value); reset() }

  const onFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setResult(null)
    try {
      const { headers, rows } = parseCSV(await f.text())
      if (!headers.length) return alert(t('That file has no header row.'))
      setFile({ name: f.name, headers, rows })
      setMap(autoMap(entity, headers))
    } catch {
      alert(t('Could not read that file. Save it as CSV and try again.'))
    }
  }

  const handleApply = () => {
    if (!plan) return
    const n = plan.counts.create + (updateExisting ? plan.counts.update : 0)
    if (!n) return alert(t('Nothing to import.'))
    if (!confirm(t('Import {n} record(s) into {e}?').replace('{n}', n).replace('{e}', t(schema.label)))) return

    const res = applyPlan(plan, {
      add: (rec) => store[schema.store.add](rec),
      update: (id, rec) => store[schema.store.update](id, rec),
    }, { updateExisting })

    setResult(res)
    setFile(null)
    setMap({})
  }

  const handleExport = () => {
    const cols = exportColumns(entity)
    const rows = existing.map((r) => {
      const o = {}
      cols.forEach((c) => { o[c.key] = r[c.key] ?? '' })
      return o
    })
    if (!rows.length) return alert(t('There is nothing to export yet.'))
    exportCSV(`${entity}-${new Date().toISOString().slice(0, 10)}.csv`, rows, cols)
  }

  const handleTemplate = () => {
    exportCSV(`${entity}-template.csv`, [templateRow(entity)], exportColumns(entity))
  }

  return (
    <div>
      <PageHeader
        title="Import & Export"
        subtitle="Move customers, suppliers, accounts and items in and out as CSV"
        action={
          <>
            <Btn variant="secondary" onClick={handleTemplate}><FileSpreadsheet size={15} /> {t('Template')}</Btn>
            <Btn variant="secondary" onClick={handleExport}><Download size={15} /> {t('Export')}</Btn>
          </>
        }
      />

      {/* Entity + file picker */}
      <Card className="p-5 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-56">
            <label className="block text-[13px] font-medium text-slate-600 dark:text-slate-300 mb-1.5">{t('What are you importing?')}</label>
            <Select value={entity} onChange={onEntityChange}>
              {Object.entries(SCHEMAS).map(([k, sc]) => <option key={k} value={k}>{t(sc.label)}</option>)}
            </Select>
          </div>
          <Btn onClick={() => fileRef.current?.click()}><Upload size={15} /> {t('Choose CSV file')}</Btn>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          {file && (
            <span className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300">
              <FileSpreadsheet size={15} className="text-brand-500" />
              {file.name} · {t('{n} row(s)').replace('{n}', file.rows.length)}
              <button onClick={reset} className="p-1 rounded text-gray-400 hover:text-rose-600"><X size={14} /></button>
            </span>
          )}
          <span className="ms-auto text-sm text-gray-500 dark:text-slate-400">
            {t('{n} on file').replace('{n}', existing.length)}
          </span>
        </div>
        {entity === 'inventoryItems' && (
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-3 flex items-start gap-2">
            <Info size={14} className="flex-shrink-0 mt-0.5" /> {t(EXCLUDED_NOTE)}
          </p>
        )}
      </Card>

      {/* Outcome of the last run */}
      {result && (
        <Card className="p-5 mb-6 bg-success-50/50 dark:bg-success-500/[0.07] ring-1 ring-inset ring-success-500/20">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="text-success-600 dark:text-success-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-success-800 dark:text-success-200">
                {t('Imported {c} new and updated {u}.').replace('{c}', result.created).replace('{u}', result.updated)}
              </p>
              {result.failed.length > 0 && (
                <ul className="text-sm text-rose-700 dark:text-rose-300 mt-2 space-y-0.5">
                  {result.failed.map((f, i) => <li key={i}>{t('Line')} {f.line}: {f.error}</li>)}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      {!file && !result && (
        <Card>
          <EmptyState
            icon={<Upload size={28} className="text-slate-400 dark:text-slate-500" />}
            title="Choose a file to begin"
            desc="Nothing is saved until you have seen exactly what will change. Export the template first if you want the expected column names."
          />
        </Card>
      )}

      {file && plan && (
        <>
          {/* Column mapping */}
          <Card className="p-5 mb-6">
            <h3 className="font-semibold text-gray-800 dark:text-slate-100 mb-1">{t('Column mapping')}</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              {t('Matched from your headers. Change any that guessed wrong.')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {schema.fields.map((f) => (
                <div key={f.name}>
                  <label className="block text-[13px] font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                    {t(f.label)} {f.required && <span className="text-rose-500">*</span>}
                    {f.key && <span className="ms-1.5 text-[10px] uppercase tracking-wider text-brand-600 dark:text-brand-400">{t('match key')}</span>}
                  </label>
                  <Select value={map[f.name] ?? -1} onChange={(e) => setMap((m) => ({ ...m, [f.name]: Number(e.target.value) }))}>
                    <option value={-1}>{t('— Not imported —')}</option>
                    {file.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </Select>
                </div>
              ))}
            </div>
          </Card>

          {/* Dry-run summary */}
          <Card className="p-5 mb-6">
            <div className="flex flex-wrap items-center gap-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1">
                {[
                  ['Create', plan.counts.create, 'text-success-600 dark:text-success-400'],
                  ['Update', plan.counts.update, 'text-brand-600 dark:text-brand-400'],
                  ['Unchanged', plan.counts.skip, 'text-gray-500 dark:text-slate-400'],
                  ['Errors', plan.counts.error, plan.counts.error ? 'text-rose-600 dark:text-rose-400' : 'text-gray-400 dark:text-slate-500'],
                ].map(([label, n, cls]) => (
                  <div key={label}>
                    <p className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-slate-500">{t(label)}</p>
                    <p className={`text-2xl font-bold tabular-nums ${cls}`}>{n}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 rounded border-gray-300 dark:border-slate-600"
                    checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
                  <span className="text-gray-700 dark:text-slate-200">{t('Update records that already exist')}</span>
                </label>
                <Btn onClick={handleApply} disabled={plan.counts.create + (updateExisting ? plan.counts.update : 0) === 0}>
                  <Play size={15} /> {t('Import')}
                </Btn>
              </div>
            </div>
          </Card>

          {/* Errors first — they are what the user must act on */}
          {plan.errors.length > 0 && (
            <Card className="overflow-hidden mb-6">
              <div className="p-4 border-b border-gray-100 dark:border-surface-750 flex items-center gap-2">
                <AlertTriangle size={16} className="text-rose-600 dark:text-rose-400" />
                <h3 className="font-semibold text-gray-800 dark:text-slate-100">
                  {t('{n} row(s) will be skipped').replace('{n}', plan.errors.length)}
                </h3>
              </div>
              <Table headers={['Line', 'Problem']}>
                {plan.errors.slice(0, 50).map((e) => (
                  <Tr key={e.line}>
                    <Td className="tabular-nums">{e.line}</Td>
                    <Td className="text-rose-700 dark:text-rose-300">{e.errors.join(' · ')}</Td>
                  </Tr>
                ))}
              </Table>
            </Card>
          )}

          {/* What will change */}
          {(plan.creates.length > 0 || plan.updates.length > 0) && (
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-gray-100 dark:border-surface-750">
                <h3 className="font-semibold text-gray-800 dark:text-slate-100">{t('Preview')}</h3>
              </div>
              <Table headers={['Line', 'Action', schema.fields.find((f) => f.key).label, 'Detail']}>
                {plan.creates.slice(0, 50).map((c) => (
                  <Tr key={`c${c.line}`}>
                    <Td className="tabular-nums">{c.line}</Td>
                    <Td><Badge className={tone.success}>{t('New')}</Badge></Td>
                    <Td>{c.record[schema.fields.find((f) => f.key).name]}</Td>
                    <Td className="text-gray-500 dark:text-slate-400 text-xs">
                      {Object.entries(c.record).filter(([k]) => !SCHEMAS[entity].fields.find((f) => f.key && f.name === k))
                        .map(([k, v]) => `${k}: ${v}`).slice(0, 4).join(' · ')}
                    </Td>
                  </Tr>
                ))}
                {plan.updates.slice(0, 50).map((u) => (
                  <Tr key={`u${u.line}`}>
                    <Td className="tabular-nums">{u.line}</Td>
                    <Td><Badge className={tone.brand}>{t('Update')}</Badge></Td>
                    <Td>{u.key}</Td>
                    <Td className="text-xs">
                      {u.changes.map((c) => (
                        <span key={c.field} className="inline-block me-3">
                          <span className="text-gray-500 dark:text-slate-400">{c.field}:</span>{' '}
                          <span className="text-gray-400 dark:text-slate-500 line-through">{String(c.from) || '—'}</span>{' '}
                          <span className="text-gray-800 dark:text-slate-100">{String(c.to)}</span>
                        </span>
                      ))}
                    </Td>
                  </Tr>
                ))}
              </Table>
              {plan.creates.length + plan.updates.length > 100 && (
                <p className="p-3 text-xs text-gray-400 dark:text-slate-500 text-center">
                  {t('Showing the first 100 — all {n} will be imported.').replace('{n}', plan.creates.length + plan.updates.length)}
                </p>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  )
}
