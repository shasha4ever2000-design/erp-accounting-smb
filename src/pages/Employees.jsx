import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Pencil, Trash2, Search, User } from 'lucide-react'

const emptyForm = {
  name: '', email: '', phone: '', departmentId: '', position: '',
  employmentType: 'full_time', startDate: '', salary: '', payFrequency: 'monthly',
  bankAccountNumber: '', taxCode: '', status: 'active',
}

const EMP_TYPES  = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract' }
const PAY_FREQ   = { monthly: 'Monthly', bi_weekly: 'Bi-weekly', weekly: 'Weekly' }
const STATUS_CLR = { active: 'bg-green-100 text-green-700', inactive: 'bg-gray-100 text-gray-500' }

export default function Employees() {
  const { employees, departments, settings, addEmployee, updateEmployee, deleteEmployee } = useStore()
  const sym = settings.company.currencySymbol

  const [modal, setModal]   = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm]     = useState(emptyForm)
  const [search, setSearch] = useState('')
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openNew  = () => { setEditing(null); setForm(emptyForm); setModal(true) }
  const openEdit = (e) => { setEditing(e); setForm({ ...emptyForm, ...e }); setModal(true) }
  const close    = () => setModal(false)

  const handleSave = () => {
    if (!form.name.trim())  return alert('Employee name is required.')
    const data = { ...form, salary: parseFloat(form.salary) || 0 }
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
        subtitle={`${activeCount} active · Monthly payroll: ${fmtMoney(totalSalary, sym)}`}
        action={<Btn onClick={openNew}><Plus size={15} /> New Employee</Btn>}
      />

      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
        <input className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search employees..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        {employees.length === 0 ? (
          <EmptyState icon="👥" title="No employees" desc="Add employees to manage payroll, departments, and HR records."
            action={<Btn onClick={openNew}><Plus size={14} /> Add Employee</Btn>} />
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No employees match your search</div>
        ) : (
          <Table headers={['Employee', 'Department', 'Position', 'Type', 'Pay Frequency', { label: 'Salary', right: true }, 'Status', { label: 'Actions', right: true }]}>
            {filtered.map((emp) => (
              <Tr key={emp.id}>
                <Td>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-50 rounded-full flex items-center justify-center flex-shrink-0">
                      <User size={14} className="text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-800">{emp.name}</p>
                      {emp.email && <p className="text-xs text-gray-400">{emp.email}</p>}
                    </div>
                  </div>
                </Td>
                <Td className="text-gray-600 text-sm">{getDeptName(emp.departmentId)}</Td>
                <Td className="text-gray-600 text-sm">{emp.position || '—'}</Td>
                <Td><span className="text-xs text-gray-600">{EMP_TYPES[emp.employmentType] || emp.employmentType}</span></Td>
                <Td><span className="text-xs text-gray-600">{PAY_FREQ[emp.payFrequency] || emp.payFrequency}</span></Td>
                <Td right><span className="font-medium text-gray-800">{fmtMoney(emp.salary || 0, sym)}</span></Td>
                <Td><Badge className={STATUS_CLR[emp.status] || 'bg-gray-100 text-gray-600'}>{emp.status}</Badge></Td>
                <Td right>
                  <div className="flex justify-end gap-1">
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
          <div className="grid grid-cols-2 gap-3">
            <Input label="Full Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} />
            <Input label="Email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Phone" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
            <Input label="Position / Job Title" value={form.position} onChange={(e) => setField('position', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
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
          <div className="grid grid-cols-3 gap-3">
            <Input label="Start Date" type="date" value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} />
            <Input label="Gross Salary" type="number" min="0" step="0.01" value={form.salary} onChange={(e) => setField('salary', e.target.value)} />
            <Select label="Pay Frequency" value={form.payFrequency} onChange={(e) => setField('payFrequency', e.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="bi_weekly">Bi-weekly</option>
              <option value="weekly">Weekly</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Bank Account Number" value={form.bankAccountNumber} onChange={(e) => setField('bankAccountNumber', e.target.value)} placeholder="For payroll transfer" />
            <Input label="Tax Code" value={form.taxCode} onChange={(e) => setField('taxCode', e.target.value)} placeholder="e.g. 1257L" />
          </div>
          <Select label="Status" value={form.status} onChange={(e) => setField('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive / Terminated</option>
          </Select>
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={close}>Cancel</Btn>
            <Btn onClick={handleSave}>{editing ? 'Save Changes' : 'Add Employee'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
