// Defining custom fields, in Settings.
//
// Saves through the store as you go rather than waiting for the page's "Save
// settings" button. Field definitions are structural — other forms read them
// immediately — and a half-saved definition that only exists in this
// component's state is a field that appears to exist and does not.

import { useState } from 'react'
import { useStore } from '../store'
import { CF_ENTITIES, CF_TYPES, newField, entityMeta } from '../utils/customFields'
import { Card, Btn, Modal, Input, Select, EmptyState } from './UI'
import { useT } from '../i18n'
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, SlidersHorizontal, Printer } from 'lucide-react'

export default function CustomFieldsManager() {
  const settings = useStore((s) => s.settings)
  const { addCustomField, updateCustomField, deleteCustomField, moveCustomField, customFieldsFor } = useStore()
  const t = useT()

  const [entity, setEntity] = useState('customer')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(newField())
  const [optionText, setOptionText] = useState('')
  const [error, setError] = useState('')

  const meta = entityMeta(entity)
  const fields = customFieldsFor(entity)
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openNew = () => {
    setEditing(null); setForm(newField()); setOptionText(''); setError(''); setModal(true)
  }
  const openEdit = (f) => {
    setEditing(f); setForm({ ...f }); setOptionText((f.options || []).join('\n')); setError(''); setModal(true)
  }

  const save = () => {
    const patch = {
      ...form,
      options: form.type === 'select' ? optionText.split('\n').map((s) => s.trim()).filter(Boolean) : [],
      showOnPrint: meta?.printable ? form.showOnPrint : false,
    }
    try {
      if (editing) updateCustomField(entity, editing.id, patch)
      else addCustomField(entity, patch)
      setModal(false)
    } catch (err) {
      setError(String(err.message || err).replace('CUSTOM_FIELD_INVALID:', '').trim())
    }
  }

  const remove = (f) => {
    // Values already entered stay in the records — see the store action. Say so,
    // because "delete" on a field people have filled in reads as data loss.
    if (confirm(t('Remove the field “{n}”? Values already entered stay in your records and reappear if you add the field back.').replace('{n}', f.name)))
      deleteCustomField(entity, f.id)
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center">
          <SlidersHorizontal size={14} className="text-white" />
        </div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Custom Fields')}</h2>
      </div>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
        {t('Add your own fields to any form — a contract number, a site code, a warranty date. Changes here save straight away.')}
      </p>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {CF_ENTITIES.map((e) => {
          const count = (settings.customFields?.[e.id] || []).length
          const on = e.id === entity
          return (
            <button
              key={e.id}
              onClick={() => setEntity(e.id)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${on
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-600'}`}
            >
              {t(e.label)}{count > 0 && <span className={`ms-1.5 text-xs ${on ? 'text-blue-100' : 'text-gray-400 dark:text-slate-400'}`}>{count}</span>}
            </button>
          )
        })}
      </div>

      {fields.length === 0 ? (
        <EmptyState
          icon={<SlidersHorizontal size={20} />}
          title={t('No custom fields on this form')}
          desc={t('Anything you add here appears on the form straight away.')}
          action={<Btn size="sm" onClick={openNew}><Plus size={14} /> {t('Add field')}</Btn>}
        />
      ) : (
        <>
          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={f.id} className="flex items-center gap-3 border border-slate-200 dark:border-surface-750 rounded-lg px-3 py-2">
                <div className="flex flex-col">
                  <button
                    onClick={() => moveCustomField(entity, f.id, -1)}
                    disabled={i === 0}
                    title={t('Move up')}
                    className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-25"
                  ><ArrowUp size={13} /></button>
                  <button
                    onClick={() => moveCustomField(entity, f.id, 1)}
                    disabled={i === fields.length - 1}
                    title={t('Move down')}
                    className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-25"
                  ><ArrowDown size={13} /></button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                    {f.name}
                    {f.required && <span className="text-red-500 ms-1" title={t('Required')}>*</span>}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                    <span>{t(CF_TYPES.find((tp) => tp.id === f.type)?.label || 'Text')}</span>
                    {f.type === 'select' && <span className="truncate">· {f.options.join(', ')}</span>}
                    {f.showOnPrint && <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Printer size={11} /> {t('On printout')}</span>}
                  </p>
                </div>
                <button onClick={() => openEdit(f)} title={t('Edit')} className="text-slate-400 hover:text-blue-600 p-1"><Pencil size={14} /></button>
                <button onClick={() => remove(f)} title={t('Remove')} className="text-slate-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <Btn size="sm" variant="secondary" className="mt-3" onClick={openNew}><Plus size={14} /> {t('Add field')}</Btn>
        </>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? t('Edit field') : t('New field')}>
        <div className="space-y-4">
          <Input
            label={t('Field name')}
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder={t('e.g. Contract number')}
            autoFocus
          />
          <Select label={t('Type')} value={form.type} onChange={(e) => setField('type', e.target.value)}>
            {CF_TYPES.map((tp) => <option key={tp.id} value={tp.id}>{t(tp.label)}</option>)}
          </Select>

          {form.type === 'select' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('Choices')}</label>
              <textarea
                rows={4}
                value={optionText}
                onChange={(e) => setOptionText(e.target.value)}
                placeholder={t('One per line')}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
              />
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t('One per line. A dropdown needs at least two.')}</p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={!!form.required} onChange={(e) => setField('required', e.target.checked)}
              className="rounded border-slate-300 dark:border-surface-700 text-blue-600 focus:ring-blue-500" />
            {t('Required — the form cannot be saved without it')}
          </label>

          {meta?.printable && (
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={!!form.showOnPrint} onChange={(e) => setField('showOnPrint', e.target.checked)}
                className="rounded border-slate-300 dark:border-surface-700 text-blue-600 focus:ring-blue-500" />
              {t('Show on the printed document')}
            </label>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={save}>{editing ? t('Save') : t('Add field')}</Btn>
          </div>
        </div>
      </Modal>
    </Card>
  )
}
