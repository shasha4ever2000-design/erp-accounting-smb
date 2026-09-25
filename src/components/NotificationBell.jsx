// The bell in the top bar: what needs attention (utils/notifications.js).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, X, ChevronRight, BellOff } from 'lucide-react'
import { useStore } from '../store'
import { useAuth } from '../auth'
import { useT } from '../i18n'
import { buildNotifications, visibleNotifications } from '../utils/notifications'
import { todayISO } from '../utils/localDate'

const TONE_DOT = {
  danger: 'bg-danger-600',
  warning: 'bg-warning-600',
  info: 'bg-brand-600',
}

// Popped as desktop notifications during this session already.
const popped = new Set()

export default function NotificationBell() {
  const t = useT()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const state = useStore()
  const { notificationState, dismissNotification, markNotificationsSeen, restoreNotifications, setNotificationPrefs } = state
  const user = useAuth((s) => s.users.find((u) => u.id === s.currentUserId) || null)
  const users = useAuth((s) => s.users)
  const overrides = useAuth((s) => s.rolePermissions)
  const today = todayISO()

  const all = useMemo(
    () => buildNotifications(state, { today, user, users, role: user?.role || null, overrides }),
    // Only the data the notifications read; not every keystroke elsewhere in the store.
    [state.invoices, state.purchases, state.creditNotes, state.debitNotes, state.inventoryItems, state.approvalRequests,
      state.cheques, state.employmentContracts, state.journalEntries, state.budgets, state.settings, today, user, users, overrides]
  )
  const { list, unseen } = visibleNotifications(all, notificationState)
  const dismissedCount = all.length - list.length

  const text = (n) => t(n.title).replace('{n}', n.count)

  // Desktop notifications, if the user switched them on: once per new item.
  useEffect(() => {
    if (!notificationState?.desktop || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    list.filter((n) => !notificationState.seen?.[n.id] && !popped.has(n.id)).forEach((n) => {
      popped.add(n.id)
      try {
        const note = new Notification(text(n), { body: n.body ? t(n.body) : '', tag: n.id, icon: `${import.meta.env.BASE_URL}icon-192.png` })
        note.onclick = () => { window.focus(); navigate(n.path) }
      } catch { /* some browsers only allow this from a service worker */ }
    })
  }, [list.map((n) => n.id).join(','), notificationState?.desktop])

  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const k = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) markNotificationsSeen(all.map((n) => n.id))
  }

  const enableDesktop = async (on) => {
    if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const res = await Notification.requestPermission().catch(() => 'denied')
      if (res !== 'granted') return alert(t('Your browser blocked notifications for this site. Allow them in the browser settings, then try again.'))
    }
    setNotificationPrefs({ desktop: on })
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} aria-label={t('Notifications')} aria-expanded={open} title={t('Notifications')}
        className="relative p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-900/[0.05] hover:text-slate-700 dark:hover:bg-white/[0.06] dark:hover:text-slate-200 transition-colors">
        <Bell size={18} />
        {unseen > 0 && (
          <span className="absolute top-1 end-1 min-w-[16px] h-4 px-1 rounded-full bg-danger-600 text-white text-[10px] font-bold flex items-center justify-center">
            {unseen > 9 ? '9+' : unseen}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label={t('Notifications')}
          className="absolute end-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] bg-white dark:bg-surface-850 rounded-xl shadow-modal ring-1 ring-black/5 dark:ring-white/10 z-50 overflow-hidden animate-scale-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-surface-750">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('Notifications')}</p>
            {dismissedCount > 0 && (
              <button onClick={restoreNotifications} className="text-xs font-medium text-brand-700 dark:text-brand-300 hover:underline">
                {t('Show {n} hidden').replace('{n}', dismissedCount)}
              </button>
            )}
          </div>

          {list.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <BellOff size={22} className="mx-auto mb-2 text-slate-400" />
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('Nothing needs your attention right now.')}</p>
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100 dark:divide-surface-750">
              {list.map((n) => (
                <li key={n.id} className="group flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-surface-800/60">
                  <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${TONE_DOT[n.tone] || TONE_DOT.info}`} aria-hidden="true" />
                  <button className="flex-1 min-w-0 text-start" onClick={() => { setOpen(false); navigate(n.path) }}>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{text(n)}</p>
                    {n.body && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{t(n.body)}</p>}
                  </button>
                  <ChevronRight size={14} className="mt-1 text-slate-400 rtl:rotate-180 flex-shrink-0" />
                  <button onClick={() => dismissNotification(n.id)} aria-label={t('Dismiss')} title={t('Dismiss')}
                    className="p-0.5 -me-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {typeof Notification !== 'undefined' && (
            <label className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100 dark:border-surface-750 bg-slate-50/60 dark:bg-surface-900/40 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" className="accent-brand-600" checked={!!notificationState?.desktop} onChange={(e) => enableDesktop(e.target.checked)} />
              {t('Also show new ones as computer notifications')}
            </label>
          )}
        </div>
      )}
    </div>
  )
}
