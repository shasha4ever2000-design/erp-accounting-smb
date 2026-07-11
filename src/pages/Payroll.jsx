import { useState } from 'react'
import { useT } from '../i18n'
import { alertIfLocked } from '../utils/periodLock'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import { Plus, Play, DollarSign, Trash2, Users, MinusCircle } from 'lucide-react'

const STATUS_CLR = {
  draft:     'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  processed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
}
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v) => parseFloat(v) || 0

// Build an editable payroll line from an employee's contract/salary structure.
function lineFromEmployee(emp) {
  const basic = num(emp.basicSalary) || num(emp.salary)
  const housing = num(emp.housingAllowance), transport = num(emp.transportAllowance), other = num(emp.otherAllowance)
  const gross = basic + housing + transport + other
  const gosi = emp.gosiApplicable ? round2(gross * num(emp.gosiEmployeeRate) / 100) : 0
  const gosiEmployer = emp.gosiApplicable ? round2(gross * num(emp.gosiEmployerRate) / 100) : 0
  const tax = emp.taxApplicable ? round2(gross * num(emp.taxRate) / 100) : 0
  return { employeeId: emp.id, employeeName: emp.name, basic, housing, transport, other, late: 0, absent: 0, penalty: 0, gosi, gosiEmployer, tax }
}
const grossOf = (l) => num(l.basic) + num(l.housing) + num(l.transport) + num(l.other)
const dedOf = (l) => num(l.late) + num(l.absent) + num(l.penalty) + num(l.gosi) + num(l.tax)
const netOf = (l) => grossOf(l) - dedOf(l)

export default function Payroll() {
  const t = useT()
  const { employees, payrollRuns, bankAccounts, settings,
          addPayrollRun, processPayrollRun, payPayrollRun, deletePayrollRun } = useStore()
  const sym = settings.company.currencySymbol

  const [newModal, setNewModal]     = useState(false)
  const [payModal, setPayModal]     = useState(null)
  const [period, setPeriod]         = useState('')
  const [payDate, setPayDate]       = useState(today())
  const [runLines, setRunLines]     = useState([])
  const [payBankId, setPayBankId]   = useState('')
  const [payPayDate, setPayPayDate] = useState(today())

  const activeEmps = employees.filter((e) => e.status === 'active')

  const openNewRun = () => {
    setRunLines(activeEmps.map(lineFromEmployee))
    setPeriod(''); setPayDate(today()); setNewModal(true)
  }
  const setCell = (i, field, value) => setRunLines((ls) => ls.map((l, idx) => idx === i ? { ...l, [field]: value } : l))

  const totalGross = runLines.reduce((s, l) => s + grossOf(l), 0)
  const totalDed   = runLines.reduce((s, l) => s + dedOf(l), 0)
  const totalNet   = runLines.reduce((s, l) => s + netOf(l), 0)

  const handleCreateRun = () => {
    if (!period.trim()) return alert('Enter the payroll period (e.g. "June 2026").')
    if (runLines.length === 0) return alert('No active employees. Add employees first.')
    // Freeze computed totals onto each line so downstream postings/reports are stable.
    const lines = runLines.map((l) => ({
      ...l, basic: num(l.basic), housing: num(l.housing), transport: num(l.transport), other: num(l.other),
      late: num(l.late), absent: num(l.absent), penalty: num(l.penalty), gosi: num(l.gosi), gosiEmployer: num(l.gosiEmployer), tax: num(l.tax),
      gross: grossOf(l), totalDeductions: dedOf(l), net: netOf(l),
    }))
    addPayrollRun({ period, payDate, lines })
    setNewModal(false)
  }

  const handleProcess = (run) => { if (confirm(`Process payroll run ${run.number}? This posts the journal entry.`)) { try { processPayrollRun(run.id) } catch (e) { if (alertIfLocked(e, t)) return; throw e } } }
  const handlePay = () => { if (!payBankId) return alert('Select a bank account.'); try { payPayrollRun(payModal.id, payBankId, payPayDate) } catch (e) { if (alertIfLocked(e, t)) return; throw e } setPayModal(null) }
  const handleDelete = (run) => { if (confirm(`Delete payroll run ${run.number}?`)) { try { deletePayrollRun(run.id) } catch (e) { if (alertIfLocked(e, t)) return; throw e } } }

  const bankOpts = bankAccounts.map((ba) => ({ id: ba.accountId, name: ba.name }))
  const sorted = [...payrollRuns].sort((a, b) => b.createdAt?.localeCompare(a.createdAt || '') || 0)

  // Live payroll estimate (from active employees' contracts) for the KPI cards.
  const estLines = activeEmps.map(lineFromEmployee)
  const estGross = estLines.reduce((s, l) => s + grossOf(l), 0)
  const estNet   = estLines.reduce((s, l) => s + netOf(l), 0)

  const NumCell = ({ v, onChange, muted }) => (
    <input type="number" step="0.01" value={v} onChange={(e) => onChange(e.target.value)}
      className={`w-20 text-right px-1.5 py-1 text-xs rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 ${muted ? 'text-red-500' : ''}`} />
  )

  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle={`${activeEmps.length} ${t('active employees')} · ${fmtMoney(estGross, sym)} ${t('monthly payroll')}`}
        action={<Btn onClick={openNewRun}><Plus size={15} /> {t('Run Payroll')}</Btn>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active Employees"  value={activeEmps.length} color="blue" icon={<Users size={18} />} />
        <StatCard label="Gross Payroll"     value={fmtMoney(estGross, sym)} color="green" icon={<DollarSign size={18} />} />
        <StatCard label="Deductions"        value={fmtMoney(estGross - estNet, sym)} color="orange" icon={<MinusCircle size={18} />} />
        <StatCard label="Net Pay"           value={fmtMoney(estNet, sym)}   color="purple" icon={<DollarSign size={18} />} />
      </div>

      <Card>
        {payrollRuns.length === 0 ? (
          <EmptyState icon="💰" title="No payroll runs" desc="Run payroll from each employee's contract salary structure. Adjust earnings and deductions per run before posting."
            action={<Btn onClick={openNewRun}><Plus size={14} /> {t('Run Payroll')}</Btn>} />
        ) : (
          <Table headers={['Number', 'Period', 'Pay Date', 'Employees', { label: 'Gross', right: true }, { label: 'Deductions', right: true }, { label: 'Net Pay', right: true }, 'Status', 'Paid', { label: 'Actions', right: true }]}>
            {sorted.map((run) => {
              const g = run.lines?.reduce((s, l) => s + (l.gross ?? grossOf(l)), 0) || 0
              const nnet = run.lines?.reduce((s, l) => s + (l.net ?? netOf(l)), 0) || 0
              return (
              <Tr key={run.id}>
                <Td><span className="font-mono text-sm font-medium text-indigo-600 dark:text-indigo-400">{run.number}</span></Td>
                <Td className="font-medium text-gray-800 dark:text-slate-100">{run.period}</Td>
                <Td className="text-gray-500 dark:text-slate-400 text-sm">{fmtDate(run.payDate)}</Td>
                <Td className="text-gray-600 dark:text-slate-300">{run.lines?.length || 0}</Td>
                <Td right className="font-medium">{fmtMoney(g, sym)}</Td>
                <Td right className="text-red-500 dark:text-red-400">{fmtMoney(g - nnet, sym)}</Td>
                <Td right className="font-semibold text-green-700 dark:text-green-400">{fmtMoney(nnet, sym)}</Td>
                <Td><Badge className={STATUS_CLR[run.status] || 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300'}>{run.status}</Badge></Td>
                <Td>{run.paid ? <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">{t('Paid')} {run.paymentDate ? fmtDate(run.paymentDate) : ''}</Badge> : <span className="text-xs text-gray-400">{t('Unpaid')}</span>}</Td>
                <Td right>
                  <div className="flex justify-end items-center gap-1">
                    <AttachmentButton entityType="payroll" entityId={run.id} />
                    {run.status === 'draft' && <Btn size="sm" variant="secondary" onClick={() => handleProcess(run)}><Play size={12} /> {t('Process')}</Btn>}
                    {run.status === 'processed' && !run.paid && <Btn size="sm" variant="success" onClick={() => { setPayModal(run); setPayBankId(bankOpts[0]?.id || '') }}><DollarSign size={12} /> {t('Pay')}</Btn>}
                    <Btn size="sm" variant="ghost" onClick={() => handleDelete(run)}><Trash2 size={13} className="text-red-400" /></Btn>
                  </div>
                </Td>
              </Tr>
            )})}
          </Table>
        )}
      </Card>

      {/* Run Payroll — editable grid */}
      <Modal open={newModal} onClose={() => setNewModal(false)} title="Run Payroll" width="max-w-6xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <Input label="Pay Period *" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. June 2026" />
            <Input label="Pay Date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </div>

          {runLines.length === 0 ? (
            <div className="text-center py-6 text-gray-400 dark:text-slate-500">{t('No active employees. Add employees in the HR section first.')}</div>
          ) : (
            <>
              <p className="text-xs text-gray-500 dark:text-slate-400">{t('Earnings and deductions are suggested from each employee\'s contract — edit any cell for this run.')}</p>
              <div className="overflow-x-auto border border-gray-100 dark:border-slate-700 rounded-lg">
                <table className="text-xs whitespace-nowrap">
                  <thead className="bg-gray-50 dark:bg-slate-800/60">
                    <tr className="text-[11px] text-gray-500 dark:text-slate-400 uppercase">
                      <th className="text-left px-2 py-2 sticky left-0 bg-gray-50 dark:bg-slate-800/60">{t('Employee')}</th>
                      <th className="px-2 py-2">{t('Basic')}</th>
                      <th className="px-2 py-2">{t('Housing')}</th>
                      <th className="px-2 py-2">{t('Transport')}</th>
                      <th className="px-2 py-2">{t('Other')}</th>
                      <th className="px-2 py-2 text-right bg-green-50/60 dark:bg-green-900/10">{t('Gross')}</th>
                      <th className="px-2 py-2">{t('Late')}</th>
                      <th className="px-2 py-2">{t('Absent')}</th>
                      <th className="px-2 py-2">{t('Penalty')}</th>
                      <th className="px-2 py-2">{t('GOSI')}</th>
                      <th className="px-2 py-2">{t('Tax')}</th>
                      <th className="px-2 py-2 text-right bg-blue-50/60 dark:bg-blue-900/10">{t('Net')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runLines.map((l, i) => (
                      <tr key={l.employeeId} className="border-t border-gray-50 dark:border-slate-700/50">
                        <td className="px-2 py-1.5 font-medium text-gray-800 dark:text-slate-100 sticky left-0 bg-white dark:bg-slate-800">{l.employeeName}</td>
                        <td className="px-2 py-1.5"><NumCell v={l.basic} onChange={(v) => setCell(i, 'basic', v)} /></td>
                        <td className="px-2 py-1.5"><NumCell v={l.housing} onChange={(v) => setCell(i, 'housing', v)} /></td>
                        <td className="px-2 py-1.5"><NumCell v={l.transport} onChange={(v) => setCell(i, 'transport', v)} /></td>
                        <td className="px-2 py-1.5"><NumCell v={l.other} onChange={(v) => setCell(i, 'other', v)} /></td>
                        <td className="px-2 py-1.5 text-right font-semibold text-gray-800 dark:text-slate-100">{fmtMoney(grossOf(l), sym)}</td>
                        <td className="px-2 py-1.5"><NumCell v={l.late} onChange={(v) => setCell(i, 'late', v)} muted /></td>
                        <td className="px-2 py-1.5"><NumCell v={l.absent} onChange={(v) => setCell(i, 'absent', v)} muted /></td>
                        <td className="px-2 py-1.5"><NumCell v={l.penalty} onChange={(v) => setCell(i, 'penalty', v)} muted /></td>
                        <td className="px-2 py-1.5"><NumCell v={l.gosi} onChange={(v) => setCell(i, 'gosi', v)} muted /></td>
                        <td className="px-2 py-1.5"><NumCell v={l.tax} onChange={(v) => setCell(i, 'tax', v)} muted /></td>
                        <td className="px-2 py-1.5 text-right font-bold text-green-700 dark:text-green-400">{fmtMoney(netOf(l), sym)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 dark:border-slate-600 font-bold bg-gray-50 dark:bg-slate-800/60">
                      <td className="px-2 py-2 sticky left-0 bg-gray-50 dark:bg-slate-800/60">{t('Totals')}</td>
                      <td colSpan={4} />
                      <td className="px-2 py-2 text-right">{fmtMoney(totalGross, sym)}</td>
                      <td colSpan={5} className="px-2 py-2 text-right text-red-500 dark:text-red-400">-{fmtMoney(totalDed, sym)}</td>
                      <td className="px-2 py-2 text-right text-green-700 dark:text-green-400">{fmtMoney(totalNet, sym)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded p-2">
                {t('On processing: Dr Salaries')} ({fmtMoney(totalGross - runLines.reduce((s,l)=>s+num(l.late)+num(l.absent)+num(l.penalty),0), sym)}) → {t('Cr Net Pay')} ({fmtMoney(totalNet, sym)}) + {t('Cr Tax & GOSI Payable')}
              </p>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setNewModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={handleCreateRun} disabled={runLines.length === 0}>{t('Create Payroll Run')}</Btn>
          </div>
        </div>
      </Modal>

      {/* Pay Employees Modal */}
      <Modal open={!!payModal} onClose={() => setPayModal(null)} title={`Pay Employees – ${payModal?.number}`}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-slate-300">
            {t('Total net pay')}: <span className="font-semibold text-gray-900 dark:text-slate-100">{fmtMoney(payModal?.lines?.reduce((s, l) => s + (l.net ?? netOf(l)), 0) || 0, sym)}</span>
          </p>
          <Select label="Pay From Bank Account" value={payBankId} onChange={(e) => setPayBankId(e.target.value)}>
            <option value="">— Select account —</option>
            {bankOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Input label="Payment Date" type="date" value={payPayDate} onChange={(e) => setPayPayDate(e.target.value)} />
          <p className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded p-2">{t('Posts: Dr Salaries Payable → Cr Bank Account')}</p>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setPayModal(null)}>{t('Cancel')}</Btn>
            <Btn variant="success" onClick={handlePay}>{t('Confirm Payment')}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
