import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { validatePassword } from './utils/password'

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

// Legacy scheme: a single SHA-256 round. Far too fast to stand up to offline
// brute-forcing if anyone gets at the stored hashes, so it is kept only to
// verify (and then transparently upgrade) accounts created before PBKDF2.
async function sha256Hex(str) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)))
}

const PBKDF2_ITERATIONS = 210000

// Current scheme: PBKDF2-SHA256, matching the strength already used for
// encrypted backups (see utils/backup.js).
async function pbkdf2Hex(password, salt, iterations = PBKDF2_ITERATIONS) {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations, hash: 'SHA-256' },
    baseKey,
    256
  )
  return toHex(bits)
}

// Constant-time-ish comparison so a wrong password can't be narrowed down by
// timing. (Both values are same-length hex here, but compare defensively.)
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const newId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now()

// Changing company reloads the page, because the data store is keyed by
// company and rehydrates on boot. Saves are coalesced (see idbKvStorage), so
// the last few hundred milliseconds may still be queued at this point — and
// the pagehide / beforeunload listeners are only best-effort for an async
// IndexedDB write. Flushing here first makes it deterministic: nothing is in
// flight by the time the page goes away.
const reload = async () => {
  try {
    const { flushNow } = await import('./utils/idbKvStorage')
    await flushNow()
  } catch { /* a failed flush must never strand the user on this screen */ }
  if (typeof window !== 'undefined') window.location.reload()
}

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
        // Screened here rather than only in the form, so the rule holds
        // however the account is created. See utils/password.js.
        const pwCheck = validatePassword(password, { name, email })
        if (!pwCheck.ok) return { error: pwCheck.error }
        if (get().users.some((u) => u.email === email)) return { error: 'An account with this email already exists.' }
        const salt = newId()
        const hash = await pbkdf2Hex(password, salt)
        // The very first account is the Owner; later self-signups default to Viewer.
        const role = get().users.length === 0 ? 'owner' : 'viewer'
        const user = { id: newId(), name, email, salt, hash, kdf: 'pbkdf2', iter: PBKDF2_ITERATIONS, role, createdAt: new Date().toISOString() }
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

        if (u.kdf === 'pbkdf2') {
          const hash = await pbkdf2Hex(password, u.salt, u.iter || PBKDF2_ITERATIONS)
          if (!safeEqual(hash, u.hash)) return { error: 'Incorrect password.' }
        } else {
          // Legacy single-round SHA-256 account: verify against the old scheme,
          // then re-hash with PBKDF2 now that we have the plaintext in hand, so
          // every account upgrades itself on next sign-in with no user action.
          const legacy = await sha256Hex(u.salt + ':' + password)
          if (!safeEqual(legacy, u.hash)) return { error: 'Incorrect password.' }
          const upgraded = await pbkdf2Hex(password, u.salt)
          set((s) => ({
            users: s.users.map((x) => (x.id === u.id ? { ...x, hash: upgraded, kdf: 'pbkdf2', iter: PBKDF2_ITERATIONS } : x)),
          }))
        }

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

      // Cloud sync is opt-in per local company. Linking just remembers which
      // Supabase `companies` row this local company syncs with — the local
      // storage key (erp-co-<local id>) never changes, so this is safe to
      // toggle without disturbing anything already on disk.
      linkCompanyCloud: (id, cloudCompanyId) =>
        set((s) => ({ companies: s.companies.map((c) => (c.id === id ? { ...c, cloudCompanyId } : c)) })),

      unlinkCompanyCloud: (id) =>
        set((s) => ({ companies: s.companies.map((c) => (c.id === id ? { ...c, cloudCompanyId: undefined } : c)) })),

      deleteCompany: (id) => {
        // purge the company's persisted data from both localStorage and IndexedDB
        try { localStorage.removeItem(`erp-co-${id}`) } catch { /* ignore */ }
        import('./utils/idbKvStorage').then((m) => m.removeCompanyData(id)).catch(() => {})
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
