// Rendering custom fields: inputs on a form, values on a page or a printout.
//
// Both halves live here so that adding a field type means touching one file.
// Every form that carries custom fields uses `<CustomFieldInputs>` and gets
// whatever the user has defined, in the order they arranged it.

import { useStore } from '../store'
import { fieldsFor, printableFields, filledValues, coerceValue } from '../utils/customFields'
import { fmtDate } from '../utils/formatters'
import { Input, Select, Textarea } from './UI'
import { useT } from '../i18n'

/** Read the definitions for a form straight from settings. */
export function useCustomFields(entityId) {
  const settings = useStore((s) => s.settings)
  return fieldsFor(settings, entityId)
}

export function useCustomFieldsForPrint(entityId) {
  const settings = useStore((s) => s.settings)
  return printableFields(settings, entityId)
}

/**
 * The inputs, for a form.
 *
 * `values` is the record's `customFields` bag keyed by field id; `onChange`
 * receives `(id, value)` already coerced to the field's type, so a form never
 * has to know that a number field must not hand back a string.
 */
export function CustomFieldInputs({ entityId, values = {}, onChange, columns = 2, className = '' }) {
  const fields = useCustomFields(entityId)
  const t = useT()
  if (!fields.length) return null

  const set = (f) => (e) => {
    const raw = f.type === 'checkbox' ? e.target.checked : e.target.value
    onChange?.(f.id, coerceValue(f, raw))
  }

  return (
    <div className={`grid grid-cols-1 ${columns === 2 ? 'sm:grid-cols-2' : ''} gap-4 ${className}`}>
      {fields.map((f) => {
        const label = `${t(f.name)}${f.required ? ' *' : ''}`
        const value = values?.[f.id]

        if (f.type === 'checkbox') {
          return (
            <label key={f.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 sm:self-end sm:pb-2">
              <input
                type="checkbox"
                checked={value === true}
                onChange={set(f)}
                className="rounded border-slate-300 dark:border-surface-700 text-blue-600 focus:ring-blue-500"
              />
              {label}
            </label>
          )
        }

        if (f.type === 'textarea') {
          return (
            <Textarea
              key={f.id}
              label={label}
              rows={2}
              value={value ?? ''}
              onChange={set(f)}
              className={columns === 2 ? 'sm:col-span-2' : ''}
            />
          )
        }

        if (f.type === 'select') {
          return (
            <Select key={f.id} label={label} value={value ?? ''} onChange={set(f)}>
              <option value="">{t('— Select —')}</option>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          )
        }

        return (
          <Input
            key={f.id}
            label={label}
            type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
            value={value ?? ''}
            onChange={set(f)}
          />
        )
      })}
    </div>
  )
}

/**
 * The values, for a detail page.
 *
 * Renders nothing at all when there is nothing to show — an empty "Additional
 * details" heading on every record is worse than no heading.
 */
export function CustomFieldValues({ entityId, values = {}, title = 'Additional details', className = '' }) {
  const fields = useCustomFields(entityId)
  const t = useT()
  const rows = filledValues(fields, values, { fmtDate })
  if (!rows.length) return null

  return (
    <div className={className}>
      {title && <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{t(title)}</h3>}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {rows.map(({ field, text }) => (
          <div key={field.id} className="flex justify-between gap-3 border-b border-dashed border-slate-200 dark:border-surface-750 py-1">
            <dt className="text-slate-500 dark:text-slate-400">{t(field.name)}</dt>
            <dd className="text-slate-800 dark:text-slate-100 font-medium text-right">{text}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * The values, for a printed document — only the fields marked to show there.
 *
 * Compact by design: a printed invoice has room for a line of extra
 * references, not a second table.
 */
export function CustomFieldPrintLines({ entityId, values = {}, className = '' }) {
  const fields = useCustomFieldsForPrint(entityId)
  const t = useT()
  const rows = filledValues(fields, values, { fmtDate })
  if (!rows.length) return null

  return (
    <div className={`text-xs text-slate-600 dark:text-slate-400 space-y-0.5 ${className}`}>
      {rows.map(({ field, text }) => (
        <div key={field.id}>
          <span className="text-slate-500 dark:text-slate-500">{t(field.name)}: </span>
          <span className="font-medium text-slate-800 dark:text-slate-200">{text}</span>
        </div>
      ))}
    </div>
  )
}
