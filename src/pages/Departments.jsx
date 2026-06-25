import { useState } from 'react'
import { useStore } from '../store'
import { PageHeader, Card, Btn, Modal, Input, Textarea, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Pencil, Trash2, Building2 } from 'lucide-react'

const emptyForm = { name: '', description: '', costCenter: '' }

export default function Departments() {
  const { departments, employees, addDepartment, updateDepartment, deleteDepartment } = useStore()
  const [modal, setModal]   = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm]     = useState(emptyForm)
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openNew  = () => { setEditing(null); setForm(emptyForm); setModal(true) }
  const openEdit = (d) => { setEditing(d); setForm({ name: d.name, description: d.description || '', costCenter: d.costCenter || '' }); setModal(true) }
  const close    = () => setModal(false)

  const handleSave = () => {
    if (!form.name.trim()) return alert('Department name is required.')
    if (editing) updateDepartment(editing.id, form)
    else addDepartment(form)
    close()
  }

  const handleDelete = (d) => {
    const empCount = employees.filter((e) => e.departmentId === d.id).length
    if (empCount > 0) return alert(`Cannot delete: ${empCount} employee(s) are assigned to this department.`)
    if (confirm(`Delete department "${d.name}"?`)) deleteDepartment(d.id)
  }

  return (
    <div>
      <PageHeader
        title="Departments"
        subtitle={`${departments.length} department${departments.length !== 1 ? 's' : ''}`}
        action={<Btn onClick={openNew}><Plus size={15} /> New Department</Btn>}
      />

      <Card>
        {departments.length === 0 ? (
          <EmptyState icon="🏢" title="No departments" desc="Create departments to organize your employees and track payroll by department."
            action={<Btn onClick={openNew}><Plus size={14} /> Add Department</Btn>} />
        ) : (
          <Table headers={['Department Name', 'Description', 'Cost Center', 'Employees', { label: 'Actions', right: true }]}>
            {departments.map((d) => {
              const empCount = employees.filter((e) => e.departmentId === d.id).length
              return (
                <Tr key={d.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center">
                        <Building2 size={14} className="text-indigo-600" />
                      </div>
                      <span className="font-medium text-gray-800">{d.name}</span>
                    </div>
                  </Td>
                  <Td className="text-gray-500 text-sm">{d.description || '—'}</Td>
                  <Td className="text-gray-500 text-sm font-mono">{d.costCenter || '—'}</Td>
                  <Td>
                    <span className={`text-sm font-medium ${empCount > 0 ? 'text-gray-800' : 'text-gray-400'}`}>
                      {empCount} employee{empCount !== 1 ? 's' : ''}
                    </span>
                  </Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      <Btn size="sm" variant="ghost" onClick={() => openEdit(d)}><Pencil size={13} /></Btn>
                      <Btn size="sm" variant="ghost" onClick={() => handleDelete(d)}><Trash2 size={13} className="text-red-400" /></Btn>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={close} title={editing ? 'Edit Department' : 'New Department'}>
        <div className="space-y-4">
          <Input label="Department Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Sales, Finance, Operations" />
          <Textarea label="Description" value={form.description} onChange={(e) => setField('description', e.target.value)} rows={2} placeholder="Department purpose or scope" />
          <Input label="Cost Center Code" value={form.costCenter} onChange={(e) => setField('costCenter', e.target.value)} placeholder="e.g. CC-001" />
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={close}>Cancel</Btn>
            <Btn onClick={handleSave}>{editing ? 'Save Changes' : 'Add Department'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
