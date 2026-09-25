// Which notifications the user has seen or dismissed. The notifications
// themselves are worked out from the books (utils/notifications.js).
export const createNotificationsSlice = (set) => ({
  notificationState: { dismissed: {}, seen: {}, desktop: false },

  dismissNotification: (id) => set((s) => ({
    notificationState: { ...s.notificationState, dismissed: { ...(s.notificationState?.dismissed || {}), [id]: new Date().toISOString() } },
  })),

  /** Mark these ids seen (opening the bell), and forget ids that no longer exist so the map can't grow forever. */
  markNotificationsSeen: (ids) => set((s) => {
    const keep = new Set(ids)
    const prune = (m) => Object.fromEntries(Object.entries(m || {}).filter(([k]) => keep.has(k)))
    const now = new Date().toISOString()
    return {
      notificationState: {
        ...s.notificationState,
        seen: { ...prune(s.notificationState?.seen), ...Object.fromEntries(ids.map((id) => [id, now])) },
        dismissed: prune(s.notificationState?.dismissed),
      },
    }
  }),

  restoreNotifications: () => set((s) => ({ notificationState: { ...s.notificationState, dismissed: {} } })),

  setNotificationPrefs: (prefs) => set((s) => ({ notificationState: { ...s.notificationState, ...prefs } })),
})
