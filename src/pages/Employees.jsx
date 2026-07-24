import { useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import { Plus, Pencil, Trash2, Search, User } from 'lucide-react'

const emptyForm = {
  name: '', email: '', phone: '', departmentId: '', position: '',
  employmentType: 'full_time', startDate: '', payFrequency: 'monthly',
  bankAccountNumber: '', taxCode: '', nationalId: '', status: 'active',
  // Salary structure (from contract) — no tax by default
  basicSalary: '', housingAllowance: '', transportAllowance: '', otherAllowance: '',
  gosiApplicable: false, gosiEmployeeRate: 9, gosiEmployerRate: 11,
  taxApplicable: false, taxRate: 0,
  salary: '',
}

const numf = (v) => parseFloat(v) || 0

const EMP_TYPES  = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract' }
const PAY_FREQ   = { monthly: 'Monthly', bi_weekly: 'Bi-weekly', weekly: 'Weekly' }
const STATUS_CLR = { active: 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300', inactive: 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400' }

export default function Employees() {
  const t = useT()
  const { employees, departments, settings, addEmployee, updateEmployee, deleteEmployee } = useStore()
  const sym = settings.company.currencySymbol

  const [modal, setModal]   = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm]     = useState(emptyForm)
  const [search, setSearch] = useState('')
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openNew  = () => { setEditing(null); setForm(emptyForm); setModal(true) }
  const openEdit = (e) => {
    // Back-compat: seed Basic Salary from a legacy single `salary` if no breakdown exists.
    const hasBreakdown = (e.basicSalary || e.housingAllowance || e.transportAllowance || e.otherAllowance)
    setEditing(e)
    setForm({ ...emptyForm, ...e, basicSalary: hasBreakdown ? (e.basicSalary || '') : (e.salary || '') })
    setModal(true)
  }
  const close    = () => setModal(false)

  const gross = numf(form.basicSalary) + numf(form.housingAllowance) + numf(form.transportAllowance) + numf(form.otherAllowance)

  const handleSave = () => {
    if (!form.name.trim())  return alert('Employee name is required.')
    const data = {
      ...form,
      basicSalary: numf(form.basicSalary), housingAllowance: numf(form.housingAllowance),
      transportAllowance: numf(form.transportAllowance), otherAllowance: numf(form.otherAllowance),
      gosiEmployeeRate: numf(form.gosiEmployeeRate), gosiEmployerRate: numf(form.gosiEmployerRate),
      taxRate: numf(form.taxRate),
      salary: gross || (parseFloat(form.salary) || 0), // gross monthly (backward compatible)
    }
    if (editing) updateEmployee(editing.id, data)
    else addEmployee(data)
    close()
  }

  const handleDelete = (emp) => {
    if (confirm(`Delete employee "${emp.name}"?`)) deleteEmployee(emp.id)
  }

  const getDeptName = (id) => departments.find((d) => d.id === id)?.name || '—'

  const filtered = employees.filter((e) =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) ||
    (e.position || '').toLowerCase().includes(search.toLowerCase()) ||
    (e.email || '').toLowerCase().includes(search.toLowerCase())
  )

  const activeCount = employees.filter((e) => e.status === 'active').length
  const totalSalary = employees.filter((e) => e.status === 'active').reduce((s, e) => s + (e.salary || 0), 0)

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={`${activeCount} ${t('active')} · ${t('Monthly payroll:')} ${fmtMoney(totalSalary, sym)}`}
        action={<Btn onClick={openNew}><Plus size={15} /> {t('New Employee')}</Btn>}
      />

      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 pointer-events-none" />
        <input className="w-full ps-9 pe-3 py-2 text-sm bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 shadow-input dark:shadow-none transition-all duration-150 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:focus:ring-brand-400/20"
          placeholder="Search employees..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        {employees.length === 0 ? (
          <EmptyState icon="👥" title="No employees" desc="Add employees to manage payroll, departments, and HR records."
            action={<Btn onClick={openNew}><Plus size={14} /> {t('Add Employee')}</Btn>} />
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-gray-400 dark:text-slate-500 text-sm">{t('No employees match your search')}</div>
        ) : (
          <Table headers={['Employee', 'Department', 'Position', 'Type', 'Pay Frequency', { label: 'Salary', right: true }, 'Status', { label: 'Actions', right: true }]}>
            {filtered.map((emp) => (
              <Tr key={emp.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/50 dark:to-indigo-900/50 rounded-full flex items-center justify-center flex-shrink-0 ring-1 ring-blue-200/60 dark:ring-blue-800/60">
                      <User size={14} className="text-blue-600 dark:text-blue-300" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 dark:text-slate-100 truncate">{emp.name}</p>
                      {emp.email && <p className="text-xs text-gray-400 dark:text-slate-500">{emp.email}</p>}
                    </div>
                  </div>
                </Td>
                <Td className="text-gray-600 dark:text-slate-300 text-sm">{getDeptName(emp.departmentId)}</Td>
                <Td className="text-gray-600 dark:text-slate-300 text-sm">{emp.position || '—'}</Td>
                <Td><span className="text-xs text-gray-600 dark:text-slate-400">{EMP_TYPES[emp.employmentType] || emp.employmentType}</span></Td>
                <Td><span className="text-xs text-gray-600 dark:text-slate-400">{PAY_FREQ[emp.payFrequency] || emp.payFrequency}</span></Td>
                <Td right><span className="font-medium text-gray-900 dark:text-slate-100 tabular-nums">{fmtMoney(emp.salary || 0, sym)}</span></Td>
                <Td><Badge className={STATUS_CLR[emp.status] || 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300'}>{emp.status}</Badge></Td>
                <Td right>
                  <div className="flex justify-end gap-1">
                      <AttachmentButton entityType="employee" entityId={emp.id} />
                    <Btn size="sm" variant="ghost" onClick={() => openEdit(emp)}><Pencil size={13} /></Btn>
                    <Btn size="sm" variant="ghost" onClick={() => handleDelete(emp)}><Trash2 size={13} className="text-red-400" /></Btn>
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={close} title={editing ? 'Edit Employee' : 'New Employee'} width="max-w-2xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Full Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} />
            <Input label="Email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Phone" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
            <Input label="Position / Job Title" value={form.position} onChange={(e) => setField('position', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select label="Department" value={form.departmentId} onChange={(e) => setField('departmentId', e.target.value)}>
              <option value="">— No Department —</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <Select label="Employment Type" value={form.employmentType} onChange={(e) => setField('employmentType', e.target.value)}>
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="contract">Contract</option>
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label="Start Date" type="date" value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} />
            <Select label="Pay Frequency" value={form.payFrequency} onChange={(e) => setField('payFrequency', e.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="bi_weekly">Bi-weekly</option>
              <option value="weekly">Weekly</option>
            </Select>
            <Input label="National ID / Iqama" value={form.nationalId} onChange={(e) => setField('nationalId', e.target.value)} />
          </div>

          {/* Compensation (from contract) */}
          <div className="border border-gray-100 dark:border-slate-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">{t('Salary Structure (from contract)')}</h3>
              {editing && <AttachmentButton entityType="employee-contract" entityId={editing.id} label="Contract" />}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Input label="Basic Salary" type="number" min="0" step="0.01" value={form.basicSalary} onChange={(e) => setField('basicSalary', e.target.value)} />
              <Input label="Housing Allowance" type="number" min="0" step="0.01" value={form.housingAllowance} onChange={(e) => setField('housingAllowance', e.target.value)} />
              <Input label="Transport Allowance" type="number" min="0" step="0.01" value={form.transportAllowance} onChange={(e) => setField('transportAllowance', e.target.value)} />
              <Input label="Other Benefits" type="number" min="0" step="0.01" value={form.otherAllowance} onChange={(e) => setField('otherAllowance', e.target.value)} />
            </div>
            <div className="flex justify-between text-sm bg-gray-50 dark:bg-slate-700/40 rounded-lg px-3 py-2">
              <span className="text-gray-500 dark:text-slate-400">{t('Gross Monthly Salary')}</span>
              <span className="font-bold text-gray-800 dark:text-slate-100 tabular-nums">{fmtMoney(gross, sym)}</span>
            </div>
            {!editing && <p className="text-[11px] text-gray-400 dark:text-slate-500">{t('Save the employee first, then re-open to attach the contract file.')}</p>}
          </div>

          {/* Statutory: GOSI & tax (off by default) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border border-gray-100 dark:border-slate-700 rounded-xl p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-slate-200">
                <input type="checkbox" checked={form.gosiApplicable} onChange={(e) => setField('gosiApplicable', e.target.checked)} className="w-4 h-4 rounded text-blue-600 dark:text-blue-400" />
                {t('GOSI / Social Insurance')}
              </label>
              {form.gosiApplicable && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input label="Employee %" type="number" min="0" step="0.01" value={form.gosiEmployeeRate} onChange={(e) => setField('gosiEmployeeRate', e.target.value)} />
                  <Input label="Employer %" type="number" min="0" step="0.01" value={form.gosiEmployerRate} onChange={(e) => setField('gosiEmployerRate', e.target.value)} />
                </div>
              )}
            </div>
            <div className="border border-gray-100 dark:border-slate-700 rounded-xl p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-slate-200">
                <input type="checkbox" checked={form.taxApplicable} onChange={(e) => setField('taxApplicable', e.target.checked)} className="w-4 h-4 rounded text-blue-600 dark:text-blue-400" />
                {t('Income Tax on salary')}
              </label>
              {form.taxApplicable
                ? <Input label="Tax Rate %" type="number" min="0" step="0.01" value={form.taxRate} onChange={(e) => setField('taxRate', e.target.value)} />
                : <p className="text-[11px] text-gray-400 dark:text-slate-500">{t('No salary tax (default). Enable only where your country taxes salaries.')}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Bank Account Number" value={form.bankAccountNumber} onChange={(e) => setField('bankAccountNumber', e.target.value)} placeholder="For payroll transfer" />
            <Select label="Status" value={form.status} onChange={(e) => setField('status', e.target.value)}>
              <option value="active">{t('Active')}</option>
              <option value="inactive">Inactive / Terminated</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-slate-700">
            <Btn variant="secondary" onClick={close}>{t('Cancel')}</Btn>
            <Btn onClick={handleSave}>{editing ? 'Save Changes' : 'Add Employee'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
