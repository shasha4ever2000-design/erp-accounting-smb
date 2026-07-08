import { useState, useRef, useEffect } from 'react'
import { useT } from '../i18n'
import { exportCSV, exportExcel, exportPDF } from '../utils/exporters'
import { Download, FileSpreadsheet, FileText, FileDown, ChevronDown } from 'lucide-react'

/**
 * Dropdown that exports the same dataset as CSV, Excel (.xlsx) or PDF.
 * Props: filename, rows, columns [{key,label,map?,right?}], title, subtitle, size.
 */
export default function ExportMenu({ filename, rows, columns, title, subtitle, size = 'md', disabled = false }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pad = size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm'
  const run = (fn) => { setOpen(false); fn() }
  const meta = { title: title || filename, subtitle, dir: document.documentElement.dir }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 font-medium rounded-lg bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed ${pad}`}
      >
        <Download size={15} /> {t('Export')} <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 end-0 right-0 w-44 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-100 dark:border-slate-700 py-1">
          <MenuItem icon={<FileText size={15} className="text-gray-500" />} label={t('CSV (.csv)')} onClick={() => run(() => exportCSV(filename, rows, columns))} />
          <MenuItem icon={<FileSpreadsheet size={15} className="text-green-600" />} label={t('Excel (.xlsx)')} onClick={() => run(() => exportExcel(filename, rows, columns, title))} />
          <MenuItem icon={<FileDown size={15} className="text-red-500" />} label={t('PDF (.pdf)')} onClick={() => run(() => exportPDF(rows, columns, meta))} />
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, label, onClick }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700/60">
      {icon}<span>{label}</span>
    </button>
  )
}
