import { create } from 'zustand'
import { persist } from 'zustand/middleware'

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const newId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now()

const reload = () => { if (typeof window !== 'undefined') window.location.reload() }

export const useAuth = create(
  persist(
    (set, get) => ({
      users: [],
      currentUserId: null,
      companies: [],
      currentCompanyId: null,

      currentUser: () => get().users.find((u) => u.id === get().currentUserId) || null,

      signup: async ({ name, email, password }) => {
        name = (name || '').trim()
        email = (email || '').trim().toLowerCase()
        if (!name) return { error: 'Please enter your name.' }
        if (!email || !email.includes('@')) return { error: 'Please enter a valid email.' }
        if ((password || '').length < 4) return { error: 'Password must be at least 4 characters.' }
        if (get().users.some((u) => u.email === email)) return { error: 'An account with this email already exists.' }
        const salt = newId()
        const hash = await sha256Hex(salt + ':' + password)
        const user = { id: newId(), name, email, salt, hash, createdAt: new Date().toISOString() }
        set((s) => ({ users: [...s.users, user], currentUserId: user.id }))
        return { ok: true }
      },

      login: async ({ email, password }) => {
        email = (email || '').trim().toLowerCase()
        const u = get().users.find((x) => x.email === email)
        if (!u) return { error: 'No account found with this email.' }
        const hash = await sha256Hex(u.salt + ':' + password)
        if (hash !== u.hash) return { error: 'Incorrect password.' }
        set({ currentUserId: u.id })
        return { ok: true }
      },

      logout: () => set({ currentUserId: null }),

      createCompany: (name) => {
        const id = newId()
        const company = { id, name: (name || '').trim() || 'New Company', createdAt: new Date().toISOString() }
        set((s) => ({ companies: [...s.companies, company], currentCompanyId: id }))
        reload()
      },

      switchCompany: (id) => { set({ currentCompanyId: id }); reload() },

      exitToCompanies: () => { set({ currentCompanyId: null }); reload() },

      renameCompany: (id, name) =>
        set((s) => ({ companies: s.companies.map((c) => (c.id === id ? { ...c, name: (name || '').trim() || c.name } : c)) })),

      deleteCompany: (id) => {
        try { localStorage.removeItem(`erp-co-${id}`) } catch { /* ignore */ }
        set((s) => ({
          companies: s.companies.filter((c) => c.id !== id),
          currentCompanyId: s.currentCompanyId === id ? null : s.currentCompanyId,
        }))
      },
    }),
    { name: 'erp-auth', version: 1 }
  )
)
