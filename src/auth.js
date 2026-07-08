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
      currentRole: () => get().users.find((u) => u.id === get().currentUserId)?.role || 'viewer',
      isManager: () => ['owner', 'admin'].includes(get().users.find((u) => u.id === get().currentUserId)?.role),

      signup: async ({ name, email, password }) => {
        name = (name || '').trim()
        email = (email || '').trim().toLowerCase()
        if (!name) return { error: 'Please enter your name.' }
        if (!email || !email.includes('@')) return { error: 'Please enter a valid email.' }
        if ((password || '').length < 4) return { error: 'Password must be at least 4 characters.' }
        if (get().users.some((u) => u.email === email)) return { error: 'An account with this email already exists.' }
        const salt = newId()
        const hash = await sha256Hex(salt + ':' + password)
        // The very first account is the Owner; later self-signups default to Viewer.
        const role = get().users.length === 0 ? 'owner' : 'viewer'
        const user = { id: newId(), name, email, salt, hash, role, createdAt: new Date().toISOString() }
        set((s) => ({ users: [...s.users, user], currentUserId: user.id }))
        return { ok: true }
      },

      setUserRole: (id, role) =>
        set((s) => {
          // never remove the last owner
          const owners = s.users.filter((u) => u.role === 'owner')
          const target = s.users.find((u) => u.id === id)
          if (target?.role === 'owner' && role !== 'owner' && owners.length <= 1) return s
          return { users: s.users.map((u) => (u.id === id ? { ...u, role } : u)) }
        }),

      removeUser: (id) =>
        set((s) => {
          if (id === s.currentUserId) return s
          const target = s.users.find((u) => u.id === id)
          if (target?.role === 'owner' && s.users.filter((u) => u.role === 'owner').length <= 1) return s
          return { users: s.users.filter((u) => u.id !== id) }
        }),

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
    {
      name: 'erp-auth',
      version: 2,
      migrate: (persisted, version) => {
        if (version < 2 && persisted?.users) {
          persisted.users = persisted.users.map((u, i) => ({ ...u, role: u.role || (i === 0 ? 'owner' : 'viewer') }))
        }
        return persisted
      },
    }
  )
)
