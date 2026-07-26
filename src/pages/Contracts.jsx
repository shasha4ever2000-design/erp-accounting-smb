// Employment contracts: what people are on, what it costs, and what they have
// accrued in end-of-service.

import { useState, useMemo } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { alertIfLocked } from '../utils/periodLock'
import {
  emptyContract, CONTRACT_TYPES, CONTRACT_STATUS, PAY_COMPONENTS,
  contractStatus, historyFor, serviceStart, describeService,
  analyseSalary, employerCost, grossOf, contributoryWage, probationEnd, attentionList,
} from '../utils/contracts'
import { LEAVE_REASONS, explainAward } from '../utils/endOfService'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import { CustomFieldInputs } from '../components/CustomFields'
import ExportMenu from '../components/ExportMenu'
import {
  Plus, Pencil, Trash2, FileSignature, AlertTriangle, Clock,
  TrendingUp, Wallet, LogOut, Info,
} from 'lucide-react'

const STATUS_CLR = {
  active:     'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300',
  probation:  'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
  expiring:   'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300',
  expired:    'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
  terminated: 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400',
  draft:      'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400',
}
const FINDING_CLR = {
  error:   'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info:    'text-slate-500 dark:text-slate-400',
}

export default function Contracts() {
  const t = useT()
  const {
    employees, employmentContracts, settings, accounts,
    addContract, updateContract, deleteContract,
    eosbFor, eosbProvidedFor, eosbSchedule, postEosbAccrual, settleEosb,
    customFieldsFor,
  } = useStore()
  const sym = settings.company.currencySymbol
  const at = today()
  const eosbRule = settings.hr?.eosb?.rule || 'none'

  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyContract())
  const [leaver, setLeaver] = useState(null)
  const [leaveReason, setLeaveReason] = useState('termination')
  const [leaveDate, setLeaveDate] = useState(at)
  const [accrueModal, setAccrueModal] = useState(false)
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const nameOf = (id) => employees.find((e) => e.id === id)?.name || '—'
  const attention = useMemo(
    () => attentionList(employmentContracts, employees, { asAt: at }),
    [employmentContracts, employees, at],
  )
  const schedule = useMemo(() => eosbSchedule(at), [employmentContracts, settings.hr, at])

  const rows = useMemo(() => [...employmentContracts].sort((a, b) => {
    const s = String(nameOf(a.employeeId)).localeCompare(String(nameOf(b.employeeId)))
    return s || String(b.startDate || '').localeCompare(String(a.startDate || ''))
  }), [employmentContracts, employees])

  const analysis = analyseSalary(form)
  const cost = employerCost(form)

  const openNew = () => { setEditing(null); setForm(emptyContract({ startDate: at })); setModal(true) }
  const openEdit = (c) => { setEditing(c); setForm({ ...emptyContract(), ...c }); setModal(true) }

  const save = () => {
    const payload = {
      ...form,
      basic: parseFloat(form.basic) || 0,
      housing: parseFloat(form.housing) || 0,
      transport: parseFloat(form.transport) || 0,
      other: parseFloat(form.other) || 0,
    }
    try {
      if (editing) updateContract(editing.id, payload)
      else addContract(payload)
      setModal(false)
    } catch (err) {
      alert(String(err.message || err).replace('CONTRACT_INVALID:', '').trim())
    }
  }

  const remove = (c) => {
    if (confirm(t('Delete this contract for {n}? Their pay history loses this period.').replace('{n}', nameOf(c.employeeId))))
      deleteContract(c.id)
  }

  const doAccrue = () => {
    try {
      const rec = postEosbAccrual(at)
      setAccrueModal(false)
      alert(t('Posted {a} to the end-of-service provision.').replace('{a}', fmtMoney(rec.total, sym)))
    } catch (err) {
      if (alertIfLocked(err, t)) return
      const m = String(err.message || err)
      if (m.includes('EOSB_NOTHING_TO_POST')) return alert(t('The provision is already up to date — there is nothing to post.'))
      alert(m)
    }
  }

  const doSettle = () => {
    try {
      const res = settleEosb(leaver.id, { asAt: leaveDate, reason: leaveReason })
      setLeaver(null)
      alert(t('Settled {a}. Their contract is ended and the provision released.').replace('{a}', fmtMoney(res.award.award, sym)))
    } catch (err) {
      if (alertIfLocked(err, t)) return
      alert(String(err.message || err))
    }
  }

  const leaverAward = leaver ? eosbFor(leaver.id, { asAt: leaveDate, reason: leaveReason }) : null
  const leaverProvided = leaver ? eosbProvidedFor(leaver.id) : 0

  const exportCols = [
    { key: 'employeeId', label: t('Employee'), map: (v) => nameOf(v) },
    { key: 'type', label: t('Type') },
    { key: 'startDate', label: t('Start'), map: (v) => fmtDate(v) },
    { key: 'endDate', label: t('End'), map: (v) => (v ? fmtDate(v) : '') },
    { key: 'basic', label: t('Basic'), right: true },
    { key: 'housing', label: t('Housing'), right: true },
    { key: 'transport', label: t('Transport'), right: true },
    { key: 'other', label: t('Other'), right: true },
    { key: 'gross', label: t('Gross'), right: true, map: (_, c) => grossOf(c).toFixed(2) },
    { key: 'status', label: t('Status'), map: (_, c) => contractStatus(c, { asAt: at }) },
  ]

  const activeRows = rows.filter((c) => !['terminated', 'expired'].includes(contractStatus(c, { asAt: at })))
  const monthlyCost = activeRows.reduce((s, c) => s + employerCost(c).total, 0)

  return (
    <div>
      <PageHeader
        title="Employment Contracts"
        subtitle={t('Salary structure, service, and end-of-service — one contract in force per person per day')}
        action={
          <>
            {employmentContracts.length > 0 && <ExportMenu filename="contracts" title={t('Employment Contracts')} rows={rows} columns={exportCols} size="sm" />}
            <Btn onClick={openNew}><Plus size={15} /> {t('New Contract')}</Btn>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Live Contracts" value={activeRows.length} color="blue" icon={<FileSignature size={18} />} />
        <StatCard label="Monthly Employer Cost" value={fmtMoney(monthlyCost, sym)} color="purple" icon={<Wallet size={18} />} />
        <StatCard label="End-of-Service Owed" value={fmtMoney(schedule.closing, sym)} sub={eosbRule === 'none' ? t('Scheme is off') : undefined} color="orange" icon={<TrendingUp size={18} />} />
        <StatCard label="Needs Attention" value={attention.length} color={attention.length ? 'red' : 'green'} icon={<AlertTriangle size={18} />} />
      </div>

      {attention.length > 0 && (
        <Card className="p-4 mb-6 border-l-4 border-l-amber-400">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-100 mb-2 flex items-center gap-2">
            <Clock size={15} className="text-amber-500" /> {t('Coming up')}
          </h2>
          <ul className="space-y-1.5">
            {attention.map((a, i) => (
              <li key={i} className="text-sm flex items-center justify-between gap-3 flex-wrap">
                <span className="text-slate-700 dark:text-slate-200">
                  <span className="font-medium">{a.employeeName}</span> — {t(a.text)}
                </span>
                <span className={a.kind === 'expired' ? 'text-red-600 dark:text-red-400 text-xs' : 'text-slate-500 dark:text-slate-400 text-xs'}>
                  {a.kind === 'expired'
                    ? t('{d} days ago').replace('{d}', a.days)
                    : t('in {d} days').replace('{d}', a.days)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {eosbRule !== 'none' && (
        <Card className="p-4 mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-100 mb-1">{t('End-of-service provision')}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('Owed if everyone left today')}: <span className="font-semibold text-slate-800 dark:text-slate-100">{fmtMoney(schedule.closing, sym)}</span>
                {' · '}
                {t('not yet provided')}: <span className={schedule.total > 0.005 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'font-semibold text-emerald-600 dark:text-emerald-400'}>{fmtMoney(schedule.total, sym)}</span>
              </p>
            </div>
            <Btn size="sm" variant="secondary" onClick={() => setAccrueModal(true)} disabled={Math.abs(schedule.total) < 0.005}>
              {t('Post accrual')}
            </Btn>
          </div>
        </Card>
      )}

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<FileSignature size={20} />}
            title={t('No contracts yet')}
            desc={t('A contract records what someone is paid and from when. A pay rise is a new contract, not an edit — which is what lets you answer what somebody was on last year.')}
            action={<Btn onClick={openNew}><Plus size={14} /> {t('New Contract')}</Btn>}
          />
        ) : (
          <Table headers={[
            t('Employee'), t('Type'), t('From'), t('To'), t('Service'),
            { label: t('Gross'), right: true }, { label: t('Employer cost'), right: true },
            { label: t('End-of-service'), right: true }, t('Status'), { label: t('Actions'), right: true },
          ]}>
            {rows.map((c) => {
              const status = contractStatus(c, { asAt: at })
              const award = eosbFor(c.employeeId, { asAt: at })
              const emp = employees.find((e) => e.id === c.employeeId)
              return (
                <Tr key={c.id}>
                  <Td>
                    <p className="font-medium text-gray-800 dark:text-slate-100">{nameOf(c.employeeId)}</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500">{emp?.position || ''}</p>
                  </Td>
                  <Td className="text-sm text-gray-600 dark:text-slate-300">{t(CONTRACT_TYPES.find((x) => x.id === c.type)?.label || '—')}</Td>
                  <Td className="text-sm text-gray-500 dark:text-slate-400">{fmtDate(c.startDate)}</Td>
                  <Td className="text-sm text-gray-500 dark:text-slate-400">{c.endDate ? fmtDate(c.endDate) : <span className="text-gray-300 dark:text-slate-600">{t('open')}</span>}</Td>
                  <Td className="text-sm text-gray-600 dark:text-slate-300">{describeService(serviceStart(c.employeeId, employmentContracts), at)}</Td>
                  <Td right className="font-medium">{fmtMoney(grossOf(c), sym)}</Td>
                  <Td right className="text-gray-600 dark:text-slate-300">{fmtMoney(employerCost(c).total, sym)}</Td>
                  <Td right className="text-gray-600 dark:text-slate-300">{award && award.gross > 0 ? fmtMoney(award.gross, sym) : <span className="text-gray-300 dark:text-slate-600">—</span>}</Td>
                  <Td><Badge className={STATUS_CLR[status]}>{t(CONTRACT_STATUS[status] || status)}</Badge></Td>
                  <Td right>
                    <div className="flex justify-end items-center gap-1">
                      {status !== 'terminated' && (
                        <button onClick={() => { setLeaver(emp); setLeaveReason('termination'); setLeaveDate(at) }} title={t('End employment')} className="text-slate-400 hover:text-amber-600 p-1"><LogOut size={14} /></button>
                      )}
                      <button onClick={() => openEdit(c)} title={t('Edit')} className="text-slate-400 hover:text-blue-600 p-1"><Pencil size={14} /></button>
                      <button onClick={() => remove(c)} title={t('Delete')} className="text-slate-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      {/* ── Contract form, with the salary analysis alongside ── */}
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? t('Edit contract') : t('New contract')} width="max-w-4xl">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select label={`${t('Employee')} *`} value={form.employeeId} onChange={(e) => setField('employeeId', e.target.value)} disabled={!!editing}>
                <option value="">{t('— Select —')}</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
              <Select label={t('Contract type')} value={form.type} onChange={(e) => setField('type', e.target.value)}>
                {CONTRACT_TYPES.map((x) => <option key={x.id} value={x.id}>{t(x.label)}</option>)}
              </Select>
              <Input label={`${t('Start date')} *`} type="date" value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} />
              <Input label={form.type === 'fixed' ? `${t('End date')} *` : t('End date')} type="date" value={form.endDate} onChange={(e) => setField('endDate', e.target.value)} />
              <Input label={t('Probation (months)')} type="number" min="0" max="12" value={form.probationMonths} onChange={(e) => setField('probationMonths', e.target.value)} />
              <Input label={t('Notice period (days)')} type="number" min="0" value={form.noticeDays} onChange={(e) => setField('noticeDays', e.target.value)} />
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase mb-2">{t('Salary breakdown')}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {PAY_COMPONENTS.map((c) => (
                  <Input key={c.id} label={`${t(c.label)} (${sym})`} type="number" min="0" step="0.01"
                    value={form[c.id]} onChange={(e) => setField(c.id, e.target.value)} />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Input label={t('Days a week')} type="number" min="1" max="7" value={form.workDaysPerWeek} onChange={(e) => setField('workDaysPerWeek', e.target.value)} />
              <Input label={t('Hours a day')} type="number" min="1" max="24" step="0.5" value={form.dailyHours} onChange={(e) => setField('dailyHours', e.target.value)} />
              <Input label={t('Annual leave (days)')} type="number" min="0" max="60" value={form.annualLeaveDays} onChange={(e) => setField('annualLeaveDays', e.target.value)} />
              <Input label={t('Overtime multiplier')} type="number" min="1" step="0.05" value={form.overtimeMultiplier} onChange={(e) => setField('overtimeMultiplier', e.target.value)} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={!!form.gosiApplicable} onChange={(e) => setField('gosiApplicable', e.target.checked)}
                    className="rounded border-slate-300 dark:border-surface-700 text-blue-600 focus:ring-blue-500" />
                  {t('Social insurance (GOSI) applies')}
                </label>
                {form.gosiApplicable && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input label={`${t('Employee')} %`} type="number" step="0.5" value={form.gosiEmployeeRate} onChange={(e) => setField('gosiEmployeeRate', e.target.value)} />
                    <Input label={`${t('Employer')} %`} type="number" step="0.5" value={form.gosiEmployerRate} onChange={(e) => setField('gosiEmployerRate', e.target.value)} />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={!!form.taxApplicable} onChange={(e) => setField('taxApplicable', e.target.checked)}
                    className="rounded border-slate-300 dark:border-surface-700 text-blue-600 focus:ring-blue-500" />
                  {t('Income tax applies')}
                </label>
                {form.taxApplicable && (
                  <Input label={`${t('Rate')} %`} type="number" step="0.5" value={form.taxRate} onChange={(e) => setField('taxRate', e.target.value)} />
                )}
              </div>
            </div>

            <Textarea label={t('Notes')} rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
            <CustomFieldInputs entityId="employee" values={form.customFields} onChange={(id, v) => setForm((f) => ({ ...f, customFields: { ...(f.customFields || {}), [id]: v } }))} />
          </div>

          {/* Analysis — live, so the structure can be fixed before it is signed */}
          <div className="lg:col-span-2 space-y-3">
            <Card className="p-4">
              <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase mb-2">{t('What this contract means')}</p>
              <dl className="text-sm space-y-1.5">
                <Row label={t('Gross monthly')} value={fmtMoney(analysis.gross, sym)} strong />
                <Row label={t('Basic + housing')} value={`${fmtMoney(analysis.contributory, sym)} (${analysis.contributoryPct}%)`} />
                <Row label={t('Employer social insurance')} value={fmtMoney(cost.gosiEmployer, sym)} />
                <Row label={t('Total employer cost')} value={fmtMoney(cost.total, sym)} strong />
                {probationEnd(form) && <Row label={t('Probation ends')} value={fmtDate(probationEnd(form))} />}
              </dl>

              <div className="mt-3 space-y-1.5">
                {analysis.components.filter((c) => c.amount > 0).map((c) => (
                  <div key={c.id}>
                    <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>{t(c.label)}</span><span>{c.pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-surface-750 overflow-hidden">
                      <div className="h-full bg-blue-500 dark:bg-blue-400" style={{ width: `${Math.min(100, c.pct)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {analysis.findings.length > 0 && (
              <Card className="p-4">
                <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase mb-2 flex items-center gap-1.5">
                  <Info size={12} /> {t('Worth knowing')}
                </p>
                <ul className="space-y-2">
                  {analysis.findings.map((f, i) => (
                    <li key={i} className={`text-xs leading-relaxed ${FINDING_CLR[f.level]}`}>{t(f.text)}</li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-gray-100 dark:border-slate-700">
          <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
          <Btn onClick={save}>{editing ? t('Save changes') : t('Create contract')}</Btn>
        </div>
      </Modal>

      {/* ── Post the accrual ── */}
      <Modal open={accrueModal} onClose={() => setAccrueModal(false)} title={t('Post end-of-service accrual')} width="max-w-2xl">
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('This tops the provision up to what would be owed if everyone left today. It posts one entry: debit End-of-Service Benefit, credit End-of-Service Provision.')}
          </p>
          <div className="overflow-x-auto border border-gray-100 dark:border-slate-700 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/60 text-xs uppercase text-gray-500 dark:text-slate-400">
                <tr>
                  <th className="text-start px-3 py-2">{t('Employee')}</th>
                  <th className="text-end px-3 py-2">{t('Already provided')}</th>
                  <th className="text-end px-3 py-2">{t('Owed today')}</th>
                  <th className="text-end px-3 py-2">{t('To post')}</th>
                </tr>
              </thead>
              <tbody>
                {schedule.lines.map((l) => (
                  <tr key={l.employeeId} className="border-t border-gray-50 dark:border-slate-700/50">
                    <td className="px-3 py-1.5 text-slate-800 dark:text-slate-100">{l.employeeName}</td>
                    <td className="px-3 py-1.5 text-end text-slate-500 dark:text-slate-400">{fmtMoney(l.closing - l.movement, sym)}</td>
                    <td className="px-3 py-1.5 text-end text-slate-600 dark:text-slate-300">{fmtMoney(l.closing, sym)}</td>
                    <td className="px-3 py-1.5 text-end font-medium">{fmtMoney(l.movement, sym)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 dark:border-slate-600 font-bold bg-gray-50 dark:bg-slate-800/60">
                  <td className="px-3 py-2" colSpan={3}>{t('Total to post')}</td>
                  <td className="px-3 py-2 text-end">{fmtMoney(schedule.total, sym)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setAccrueModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={doAccrue}>{t('Post accrual')}</Btn>
          </div>
        </div>
      </Modal>

      {/* ── End employment and settle ── */}
      <Modal open={!!leaver} onClose={() => setLeaver(null)} title={t('End employment')}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('Ending employment for')} <span className="font-semibold text-slate-900 dark:text-slate-100">{leaver?.name}</span>.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label={t('Last day')} type="date" value={leaveDate} onChange={(e) => setLeaveDate(e.target.value)} />
            <Select label={t('Reason')} value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)}>
              {LEAVE_REASONS.map((r) => <option key={r.id} value={r.id}>{t(r.label)}</option>)}
            </Select>
          </div>

          {leaverAward ? (
            <Card className="p-4">
              <dl className="text-sm space-y-1.5">
                <Row label={t('Service')} value={`${leaverAward.years} ${t('years')}`} />
                <Row label={t('Wage used')} value={fmtMoney(leaverAward.wage, sym)} />
                <Row label={t('Full award')} value={fmtMoney(leaverAward.gross, sym)} />
                {leaverAward.factor < 1 && <Row label={t('Entitlement')} value={`${Math.round(leaverAward.factor * 100)}%`} />}
                <Row label={t('Payable')} value={fmtMoney(leaverAward.award, sym)} strong />
                <Row label={t('Already provided')} value={fmtMoney(leaverProvided, sym)} />
              </dl>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">{t(explainAward(leaverAward))}</p>
            </Card>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400">{t('No contract covers this date, so there is nothing to settle.')}</p>
          )}

          <p className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded p-2">
            {t('Posts: release the provision, charge or credit the difference, and put what is payable into Salaries Payable. The contract is ended and the employee set inactive.')}
          </p>

          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setLeaver(null)}>{t('Cancel')}</Btn>
            <Btn variant="danger" onClick={doSettle} disabled={!leaverAward}>{t('End and settle')}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Row({ label, value, strong }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={strong ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-200'}>{value}</dd>
    </div>
  )
}
