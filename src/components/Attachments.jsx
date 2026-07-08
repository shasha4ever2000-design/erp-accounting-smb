import { useState, useEffect, useRef, useCallback } from 'react'
import { useT } from '../i18n'
import { Modal, Btn } from './UI'
import { addAttachment, listAttachments, countAttachments, deleteAttachment, downloadAttachment, formatBytes } from '../utils/attachments'
import { Paperclip, Upload, Trash2, Download, FileText, Loader2 } from 'lucide-react'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB per file

/**
 * Paperclip button (with a live count badge) that manages supporting documents
 * for a host record. Usage: <AttachmentButton entityType="invoice" entityId={inv.id} />
 */
export default function AttachmentButton({ entityType, entityId, size = 'sm', label }) {
  const t = useT()
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const refreshCount = useCallback(() => {
    if (!entityId) return
    countAttachments(entityType, entityId).then(setCount).catch(() => {})
  }, [entityType, entityId])

  useEffect(() => { refreshCount() }, [refreshCount])

  const load = () => {
    setBusy(true)
    listAttachments(entityType, entityId).then((x) => { setItems(x); setBusy(false) }).catch(() => setBusy(false))
  }

  const openModal = () => { setOpen(true); load() }

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    for (const f of files) {
      if (f.size > MAX_BYTES) { alert(`${f.name}: ${t('File is too large (max 10 MB).')}`); continue }
      try { await addAttachment(entityType, entityId, f) } catch (err) { alert(t('Could not save the file.') + ' ' + err.message) }
    }
    load(); refreshCount()
  }

  const remove = async (att) => {
    if (!confirm(t('Remove this attachment?'))) return
    await deleteAttachment(att.id)
    load(); refreshCount()
  }

  const pad = size === 'sm' ? 'px-2 py-1.5' : 'px-3 py-2'

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title={t('Supporting documents')}
        className={`relative inline-flex items-center gap-1.5 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 ${pad}`}
      >
        <Paperclip size={15} />
        {label && <span className="text-sm">{t(label)}</span>}
        {count > 0 && (
          <span className="min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full bg-blue-600 text-white text-[10px] font-bold">{count}</span>
        )}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('Supporting Documents')}>
        <div className="space-y-4">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={onFiles} />
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-gray-200 dark:border-slate-600 rounded-xl py-6 flex flex-col items-center justify-center text-gray-400 dark:text-slate-500 hover:border-blue-300 hover:text-blue-500 transition-colors"
          >
            <Upload size={22} className="mb-1.5" />
            <span className="text-sm font-medium">{t('Click to upload files')}</span>
            <span className="text-xs">{t('Receipts, contracts, scans — up to 10 MB each')}</span>
          </button>

          {busy && <div className="flex items-center justify-center py-3 text-gray-400"><Loader2 size={18} className="animate-spin" /></div>}

          {!busy && items.length === 0 && (
            <p className="text-center text-sm text-gray-400 dark:text-slate-500 py-2">{t('No documents attached yet.')}</p>
          )}

          <div className="space-y-2 max-h-72 overflow-y-auto">
            {items.map((att) => (
              <div key={att.id} className="flex items-center gap-3 border border-gray-100 dark:border-slate-700 rounded-lg p-2">
                {att.mime?.startsWith('image/')
                  ? <img src={att.dataUrl} alt={att.name} className="w-10 h-10 rounded object-cover flex-shrink-0" />
                  : <div className="w-10 h-10 rounded bg-gray-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0"><FileText size={18} className="text-gray-400" /></div>}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 dark:text-slate-100 truncate">{att.name}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{formatBytes(att.size)}</p>
                </div>
                <button onClick={() => downloadAttachment(att)} title={t('Download')} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"><Download size={15} /></button>
                <button onClick={() => remove(att)} title={t('Remove')} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-1">
            <Btn variant="secondary" onClick={() => setOpen(false)}>{t('Done')}</Btn>
          </div>
        </div>
      </Modal>
    </>
  )
}
