import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import { Plus, Play, DollarSign, Trash2, Users } from 'lucide-react'

const STATUS_CLR = {
  draft:     'bg-yellow-100 text-yellow-700',
  processed: 'bg-blue-100 text-blue-700',
}

export default function Payroll() {
  const { employees, payrollRuns, bankAccounts, accounts, settings,
          addPayrollRun, processPayrollRun, payPayrollRun, deletePayrollRun } = useStore()
  const sym = settings.company.currencySymbol
  const taxRate = settings.tax.rate

  const [newModal, setNewModal]     = useState(false)
  const [payModal, setPayModal]     = useState(null)  // payroll run to pay
  const [period, setPeriod]         = useState('')
  const [payDate, setPayDate]       = useState(today())
  const [payBankId, setPayBankId]   = useState('')
  const [payPayDate, setPayPayDate] = useState(today())

  const activeEmps = employees.filter((e) => e.status === 'active')

  // Build payroll lines from active employees
  const buildLines = () =>
    activeEmps.map((emp) => {
      const gross = emp.salary || 0
      const tax   = parseFloat(((gross * taxRate) / 100).toFixed(2))
      const ss    = parseFloat(((gross * 0.05) / 1).toFixed(2))  // 5% social security example
      const net   = gross - tax - ss
      return { employeeId: emp.id, employeeName: emp.name, gross, tax, socialSecurity: ss, net }
    })

  const lines = buildLines()
  const totalGross = lines.reduce((s, l) => s + l.gross, 0)
  const totalTax   = lines.reduce((s, l) => s + l.tax, 0)
  const totalSS    = lines.reduce((s, l) => s + l.socialSecurity, 0)
  const totalNet   = lines.reduce((s, l) => s + l.net, 0)

  const handleCreateRun = () => {
    if (!period.trim()) return alert('Enter the payroll period (e.g. "June 2026").')
    if (activeEmps.length === 0) return alert('No active employees. Add employees first.')
    addPayrollRun({ period, payDate, lines })
    setNewModal(false)
    setPeriod('')
    setPayDate(today())
  }

  const handleProcess = (run) => {
    if (!confirm(`Process payroll run ${run.number}?\nThis will post the journal entry.`)) return
    processPayrollRun(run.id)
  }

  const handlePay = () => {
    if (!payBankId) return alert('Select a bank account.')
    payPayrollRun(payModal.id, payBankId, payPayDate)
    setPayModal(null)
  }

  const handleDelete = (run) => {
    if (confirm(`Delete payroll run ${run.number}?`)) deletePayrollRun(run.id)
  }

  const bankOpts = bankAccounts.map((ba) => ({
    id: ba.accountId,
    name: ba.name,
  }))

  const sorted = [...payrollRuns].sort((a, b) => b.createdAt?.localeCompare(a.createdAt || '') || 0)

  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle={`${activeEmps.length} active employees · ${fmtMoney(totalGross, sym)} monthly payroll`}
        action={<Btn onClick={() => setNewModal(true)}><Plus size={15} /> Run Payroll</Btn>}
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Active Employees"  value={activeEmps.length} color="blue" icon={<Users size={18} />} />
        <StatCard label="Gross Payroll"     value={fmtMoney(totalGross, sym)} color="green" icon={<DollarSign size={18} />} />
        <StatCard label="Tax Deductions"    value={fmtMoney(totalTax, sym)}   color="orange" icon={<DollarSign size={18} />} />
        <StatCard label="Net Pay"           value={fmtMoney(totalNet, sym)}   color="purple" icon={<DollarSign size={18} />} />
      </div>

      <Card>
        {payrollRuns.length === 0 ? (
          <EmptyState icon="💰" title="No payroll runs" desc="Run payroll to automatically generate journal entries for salary, tax, and social security."
            action={<Btn onClick={() => setNewModal(true)}><Plus size={14} /> Run Payroll</Btn>} />
        ) : (
          <Table headers={['Number', 'Period', 'Pay Date', 'Employees', { label: 'Gross', right: true }, { label: 'Net Pay', right: true }, 'Status', 'Paid', { label: 'Actions', right: true }]}>
            {sorted.map((run) => (
              <Tr key={run.id}>
                <Td><span className="font-mono text-sm font-medium text-indigo-600">{run.number}</span></Td>
                <Td className="font-medium text-gray-800">{run.period}</Td>
                <Td className="text-gray-500 text-sm">{fmtDate(run.payDate)}</Td>
                <Td className="text-gray-600">{run.lines?.length || 0}</Td>
                <Td right><span className="font-medium">{fmtMoney(run.lines?.reduce((s,l)=>s+l.gross,0)||0, sym)}</span></Td>
                <Td right><span className="font-semibold text-green-700">{fmtMoney(run.lines?.reduce((s,l)=>s+l.net,0)||0, sym)}</span></Td>
                <Td><Badge className={STATUS_CLR[run.status] || 'bg-gray-100 text-gray-600'}>{run.status}</Badge></Td>
                <Td>
                  {run.paid
                    ? <Badge className="bg-green-100 text-green-700">Paid {run.paymentDate ? fmtDate(run.paymentDate) : ''}</Badge>
                    : <span className="text-xs text-gray-400">Unpaid</span>
                  }
                </Td>
                <Td right>
                  <div className="flex justify-end gap-1">
                    {run.status === 'draft' && (
                      <Btn size="sm" variant="secondary" onClick={() => handleProcess(run)}>
                        <Play size={12} /> Process
                      </Btn>
                    )}
                    {run.status === 'processed' && !run.paid && (
                      <Btn size="sm" variant="success" onClick={() => { setPayModal(run); setPayBankId(bankOpts[0]?.id || '') }}>
                        <DollarSign size={12} /> Pay
                      </Btn>
                    )}
                    <Btn size="sm" variant="ghost" onClick={() => handleDelete(run)}>
                      <Trash2 size={13} className="text-red-400" />
                    </Btn>
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {/* New Payroll Modal */}
      <Modal open={newModal} onClose={() => setNewModal(false)} title="Run Payroll" width="max-w-2xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Pay Period *" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. June 2026" />
            <Input label="Pay Date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </div>

          {activeEmps.length === 0 ? (
            <div className="text-center py-6 text-gray-400">No active employees. Add employees in the HR section first.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase">
                      <th className="text-left py-2 px-2">Employee</th>
                      <th className="text-right py-2 px-2">Gross</th>
                      <th className="text-right py-2 px-2">Tax ({taxRate}%)</th>
                      <th className="text-right py-2 px-2">SS (5%)</th>
                      <th className="text-right py-2 px-2">Net Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.employeeId} className="border-b border-gray-50">
                        <td className="py-2 px-2 font-medium text-gray-800">{l.employeeName}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{fmtMoney(l.gross, sym)}</td>
                        <td className="py-2 px-2 text-right text-red-500">-{fmtMoney(l.tax, sym)}</td>
                        <td className="py-2 px-2 text-right text-red-500">-{fmtMoney(l.socialSecurity, sym)}</td>
                        <td className="py-2 px-2 text-right font-semibold text-green-700">{fmtMoney(l.net, sym)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 font-bold">
                      <td className="py-2 px-2">Totals</td>
                      <td className="py-2 px-2 text-right">{fmtMoney(totalGross, sym)}</td>
                      <td className="py-2 px-2 text-right text-red-500">-{fmtMoney(totalTax, sym)}</td>
                      <td className="py-2 px-2 text-right text-red-500">-{fmtMoney(totalSS, sym)}</td>
                      <td className="py-2 px-2 text-right text-green-700">{fmtMoney(totalNet, sym)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-blue-600 bg-blue-50 rounded p-2">
                Posting: Dr Salaries & Wages ({fmtMoney(totalGross, sym)}) → Cr Salaries Payable ({fmtMoney(totalNet, sym)}) + Cr PAYE ({fmtMoney(totalTax, sym)}) + Cr SS ({fmtMoney(totalSS, sym)})
              </p>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setNewModal(false)}>Cancel</Btn>
            <Btn onClick={handleCreateRun} disabled={activeEmps.length === 0}>Create Payroll Run</Btn>
          </div>
        </div>
      </Modal>

      {/* Pay Employees Modal */}
      <Modal open={!!payModal} onClose={() => setPayModal(null)} title={`Pay Employees – ${payModal?.number}`}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Total net pay: <span className="font-semibold text-gray-900">{fmtMoney(payModal?.lines?.reduce((s,l)=>s+l.net,0)||0, sym)}</span>
          </p>
          <Select label="Pay From Bank Account" value={payBankId} onChange={(e) => setPayBankId(e.target.value)}>
            <option value="">— Select account —</option>
            {bankOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Input label="Payment Date" type="date" value={payPayDate} onChange={(e) => setPayPayDate(e.target.value)} />
          <p className="text-xs text-blue-600 bg-blue-50 rounded p-2">
            Posts: Dr Salaries Payable → Cr Bank Account
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setPayModal(null)}>Cancel</Btn>
            <Btn variant="success" onClick={handlePay}>Confirm Payment</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
