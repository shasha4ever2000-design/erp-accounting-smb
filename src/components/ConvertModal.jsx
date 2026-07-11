import { useState, useEffect } from 'react'
import { useT } from '../i18n'
import { Modal, Btn } from './UI'
import { fmtMoney } from '../utils/formatters'
import { lineDone, lineRemaining, buildConversion } from '../utils/fulfillment'

// A quantity picker for partially converting a source document (quotation → invoice,
// purchase order → bill). Lines already fully fulfilled are shown but locked; every
// other line defaults to its full remaining quantity and can be dialled down.
export default function ConvertModal({ open, onClose, doc, docKey, sym, title, confirmLabel, onConfirm, taxEnabled = true }) {
  const t = useT()
  const items = doc?.items || []
  const [qty, setQty] = useState({})

  // Seed the inputs with each line's remaining quantity whenever a new doc opens.
  useEffect(() => {
    if (!doc) return
    const seed = {}
    ;(doc.items || []).forEach((l) => { seed[l.id] = lineRemaining(l, docKey) })
    setQty(seed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id])

  const setLineQty = (id, remaining, v) => {
    const n = Math.max(0, Math.min(remaining, parseFloat(v) || 0))
    setQty((s) => ({ ...s, [id]: n }))
  }

  const preview = buildConversion(items, qty, { key: docKey, taxEnabled })
  const nothing = preview.items.length === 0

  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-2xl">
      {doc && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {t('Choose how much of each line to convert now. Anything left stays open on {n} as a backorder.').replace('{n}', doc.number || '')}
          </p>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="text-xs text-gray-400 dark:text-slate-500 uppercase border-b border-gray-100 dark:border-surface-700">
                  <th className="text-start py-2 font-medium">{t('Description')}</th>
                  <th className="text-end py-2 font-medium px-2">{t('Ordered')}</th>
                  <th className="text-end py-2 font-medium px-2">{t('Done')}</th>
                  <th className="text-end py-2 font-medium px-2">{t('Remaining')}</th>
                  <th className="text-end py-2 font-medium ps-2 w-28">{t('Convert now')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((l) => {
                  const remaining = lineRemaining(l, docKey)
                  const done = lineDone(l, docKey)
                  return (
                    <tr key={l.id} className="border-b border-gray-50 dark:border-surface-700/50">
                      <td className="py-2 text-gray-700 dark:text-slate-200">{l.description || '—'}</td>
                      <td className="py-2 text-end px-2 text-gray-500 dark:text-slate-400 tabular-nums">{l.quantity}</td>
                      <td className="py-2 text-end px-2 text-gray-400 dark:text-slate-500 tabular-nums">{done || '—'}</td>
                      <td className="py-2 text-end px-2 font-medium text-gray-700 dark:text-slate-200 tabular-nums">{remaining}</td>
                      <td className="py-2 ps-2">
                        {remaining > 0 ? (
                          <input type="number" min="0" max={remaining} step="any" value={qty[l.id] ?? ''}
                            onChange={(e) => setLineQty(l.id, remaining, e.target.value)}
                            className="w-24 text-end border border-gray-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-gray-900 dark:text-slate-100 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15" />
                        ) : (
                          <span className="block text-end text-xs text-success-600 dark:text-success-400 pe-1">{t('Fully done')}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-surface-700">
            <span className="text-sm text-gray-500 dark:text-slate-400">{t('This conversion')}</span>
            <span className="text-lg font-bold text-gray-900 dark:text-slate-100 tabular-nums">{fmtMoney(preview.total, sym)}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={onClose}>{t('Cancel')}</Btn>
            <Btn disabled={nothing} onClick={() => onConfirm(qty)}>{confirmLabel}</Btn>
          </div>
        </div>
      )}
    </Modal>
  )
}
