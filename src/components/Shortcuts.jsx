// Keyboard shortcuts for the actions people repeat all day.
//
// Alt + a letter, matched on the physical key (`e.code`), so the same keys
// work on an Arabic keyboard layout. Nothing fires while typing in a field.
// `?` shows the list; buttons that start these actions name their shortcut in
// their tooltip (see shortcutHint).
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { create } from 'zustand'
import { useT } from '../i18n'
import { Modal } from './UI'

export const SHORTCUTS = [
  { code: 'KeyI', keys: 'Alt+I', label: 'New invoice', to: '/invoices/new' },
  { code: 'KeyB', keys: 'Alt+B', label: 'New purchase bill', to: '/purchases/new' },
  { code: 'KeyQ', keys: 'Alt+Q', label: 'New quotation', to: '/quotations/new' },
  { code: 'KeyJ', keys: 'Alt+J', label: 'Journal entries', to: '/journals' },
  { code: 'KeyC', keys: 'Alt+C', label: 'Customers', to: '/customers' },
  { code: 'KeyR', keys: 'Alt+R', label: 'Reports', to: '/reports' },
  { code: 'KeyD', keys: 'Alt+D', label: 'Dashboard', to: '/' },
]

const EXTRA = [
  { keys: 'Ctrl+K / ⌘K', label: 'Search and go anywhere' },
  { keys: '?', label: 'Show keyboard shortcuts' },
]

/** " (Alt+I)" for the action that goes to `to`, or '' when none does. */
export function shortcutHint(to) {
  const s = SHORTCUTS.find((x) => x.to === to)
  return s ? ` (${s.keys})` : ''
}

const useHelp = create((set) => ({ open: false, setOpen: (open) => set({ open }) }))

const typing = (el) => !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

export function useShortcuts() {
  const navigate = useNavigate()
  useEffect(() => {
    const onKey = (e) => {
      if (typing(e.target)) return
      if (e.key === '?' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        useHelp.getState().setOpen(true)
        return
      }
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const hit = SHORTCUTS.find((s) => s.code === e.code)
      if (!hit) return
      e.preventDefault()
      navigate(hit.to)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])
}

export function ShortcutsHelp() {
  const t = useT()
  const open = useHelp((s) => s.open)
  const setOpen = useHelp((s) => s.setOpen)
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" width="max-w-md">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100 dark:divide-surface-800">
          {[...SHORTCUTS, ...EXTRA].map((s) => (
            <tr key={s.keys}>
              <td className="py-2 text-slate-700 dark:text-slate-200">{t(s.label)}</td>
              <td className="py-2 text-end">
                <kbd className="text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-surface-800 border border-slate-200 dark:border-surface-600 rounded-md px-1.5 py-0.5">{s.keys}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}
