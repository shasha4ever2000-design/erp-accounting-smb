// In-app replacements for the browser's alert() and confirm().
//
// The native dialogs can't be styled, ignore dark mode and right-to-left
// layout, and on some browsers print the site's address above the message.
// These look like the rest of the app and read the same in Arabic.
//
// `notify(message)` shows a message; it replaces window.alert once the host is
// mounted, so every existing alert() call becomes one of these without being
// touched. `ask(message)` returns a Promise<boolean> — confirm() is
// synchronous and cannot be replaced in place, so callers `await ask(...)`.
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { tr, useT } from '../i18n'
import { Btn } from './UI'

const useDialogs = create((set) => ({ queue: [], push: (d) => set((s) => ({ queue: [...s.queue, d] })), shift: () => set((s) => ({ queue: s.queue.slice(1) })) }))

let mounted = false

// A destructive question gets the danger button; everything else the primary.
const DANGER = /^(delete|remove|void|permanently|abandon|terminate|reset|erase|stop syncing|undo|clear|restoring)/i

const VERBS = ['Delete', 'Remove', 'Void', 'Approve', 'Restore', 'Import', 'Post', 'Process', 'Terminate', 'Withdraw', 'Reopen', 'Lock', 'Unlock', 'Convert', 'Abandon', 'Book', 'Undo']
function verbOf(message) {
  const first = message.trim().split(/\s+/)[0]?.replace(/[^A-Za-z]/g, '')
  return VERBS.find((v) => v.toLowerCase() === (first || '').toLowerCase()) || ''
}

/** Ask a yes/no question. Resolves true for the confirming button. */
export function ask(message, { danger, confirmLabel } = {}) {
  const text = tr(String(message ?? ''))
  // Without a host (tests, or before the app has mounted) fall back to the
  // browser's own dialog so the question is never silently skipped.
  if (!mounted) return Promise.resolve(typeof window !== 'undefined' && window.confirm ? window.confirm(text) : false)
  return new Promise((resolve) => useDialogs.getState().push({
    kind: 'ask', text, resolve,
    danger: danger ?? DANGER.test(String(message ?? '').trim()),
    // "Delete customer X?" is answered with a Delete button, not a vague Confirm.
    confirmLabel: confirmLabel || verbOf(String(message ?? '')),
  }))
}

/**
 * Ask for a line of text (a reason, a note). Resolves the text — possibly
 * empty — or null when cancelled, exactly like window.prompt did.
 */
export function askText(message, { defaultValue = '', danger, confirmLabel } = {}) {
  const text = tr(String(message ?? ''))
  if (!mounted) return Promise.resolve(typeof window !== 'undefined' && window.prompt ? window.prompt(text, defaultValue) : null)
  return new Promise((resolve) => useDialogs.getState().push({
    kind: 'text', text, resolve, defaultValue,
    danger: danger ?? (DANGER.test(String(message ?? '').trim()) || /^reason for voiding/i.test(String(message ?? '').trim())),
    confirmLabel: confirmLabel || (/^reason for voiding/i.test(String(message ?? '')) ? 'Void' : 'OK'),
  }))
}

/** Show a message. Returns a Promise that resolves when it is dismissed. */
export function notify(message) {
  const text = tr(String(message ?? ''))
  if (!mounted) { nativeAlert(text); return Promise.resolve() }
  return new Promise((resolve) => useDialogs.getState().push({ kind: 'notify', text, resolve }))
}

let nativeAlert = (m) => { if (typeof window !== 'undefined' && window.__nativeAlert) window.__nativeAlert(m) }

/** Mount once near the root. Takes over window.alert while mounted. */
export function DialogHost() {
  const t = useT()
  const current = useDialogs((s) => s.queue[0])
  const okRef = useRef(null)
  const inputRef = useRef(null)
  const [value, setValue] = useState('')
  useEffect(() => { if (current?.kind === 'text') setValue(current.defaultValue || '') }, [current])

  useEffect(() => {
    mounted = true
    const prev = window.alert
    window.__nativeAlert = window.__nativeAlert || prev
    window.alert = (msg) => { notify(msg) }
    return () => { mounted = false; window.alert = prev }
  }, [])

  // Focus the confirming button so Enter answers and Escape cancels.
  useEffect(() => {
    if (!current) return
    if (current.kind === 'text') inputRef.current?.focus()
    else okRef.current?.querySelector('button:last-of-type')?.focus()
  }, [current])

  if (!current) return null
  const close = (result) => { useDialogs.getState().shift(); current.resolve(result) }
  const cancelValue = current.kind === 'ask' ? false : current.kind === 'text' ? null : undefined
  const confirmValue = current.kind === 'ask' ? true : current.kind === 'text' ? value : undefined
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(cancelValue) } }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onKeyDown={onKey}>
      <div className="absolute inset-0 bg-surface-950/55 backdrop-blur-[3px] animate-fade-in"
        onClick={() => close(cancelValue)} />
      <div role={current.kind === 'notify' ? 'dialog' : 'alertdialog'} aria-modal="true" aria-describedby="erp-dialog-text"
        className="relative bg-white dark:bg-surface-850 rounded-2xl shadow-modal ring-1 ring-black/5 dark:ring-white/10 w-full max-w-md animate-scale-in overflow-hidden">
        <p id="erp-dialog-text" className="px-6 pt-6 pb-5 text-sm leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-line">{current.text}</p>
        {current.kind === 'text' && (
          <div className="px-6 pb-5 -mt-2">
            <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} aria-labelledby="erp-dialog-text"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); close(value) } }}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300 dark:border-surface-600 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15" />
          </div>
        )}
        <div ref={okRef} className="flex justify-end gap-2 px-6 py-4 bg-slate-50 dark:bg-surface-900/40 border-t border-slate-100 dark:border-surface-750">
          {current.kind !== 'notify' && <Btn variant="secondary" onClick={() => close(cancelValue)}>{t('Cancel')}</Btn>}
          <Btn variant={current.kind !== 'notify' && current.danger ? 'danger' : 'primary'}
            onClick={() => close(confirmValue)}>
            {current.kind === 'notify' ? t('OK') : t(current.confirmLabel || 'Confirm')}
          </Btn>
        </div>
      </div>
    </div>
  )
}
