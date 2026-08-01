import { describe, it, expect, beforeEach } from 'vitest'
import { useAuth } from '../src/auth.js'

const reset = () => useAuth.setState({ users: [], currentUserId: null, companies: [], currentCompanyId: null })
const g = () => useAuth.getState()

describe('local auth password hashing', () => {
  beforeEach(reset)

  it('stores a PBKDF2 hash, never the plaintext password', async () => {
    await g().signup({ name: 'A', email: 'a@x.com', password: 'correct horse' })
    const u = g().users[0]
    expect(u.kdf).toBe('pbkdf2')
    expect(u.iter).toBeGreaterThanOrEqual(100000)
    expect(u.hash).not.toContain('correct')
    expect(JSON.stringify(u)).not.toContain('correct horse')
    expect(u.salt).toBeTruthy()
  })

  it('gives two users with the same password different hashes (salted)', async () => {
    await g().signup({ name: 'A', email: 'a@x.com', password: 'samepassword' })
    await g().signup({ name: 'B', email: 'b@x.com', password: 'samepassword' })
    const [a, b] = g().users
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
  })

  it('accepts the right password and rejects a wrong one', async () => {
    await g().signup({ name: 'A', email: 'a@x.com', password: 'rightpassword' })
    g().logout()
    expect(await g().login({ email: 'a@x.com', password: 'wrongpassword' })).toHaveProperty('error')
    expect(g().currentUserId).toBeNull()
    expect(await g().login({ email: 'a@x.com', password: 'rightpassword' })).toEqual({ ok: true })
    expect(g().currentUserId).toBe(g().users[0].id)
  })

  it('enforces a minimum password length', async () => {
    const res = await g().signup({ name: 'A', email: 'a@x.com', password: 'short' })
    expect(res).toHaveProperty('error')
    expect(g().users).toHaveLength(0)
  })

  it('refuses a common password, however long', async () => {
    // The strength rule lives in utils/password.js; this proves signup
    // actually calls it rather than relying on the form to.
    const res = await g().signup({ name: 'A', email: 'a@x.com', password: 'Password1!23' })
    expect(res).toHaveProperty('error')
    expect(g().users).toHaveLength(0)
  })

  it('refuses a password containing the person own email', async () => {
    const res = await g().signup({ name: 'A', email: 'marmalade@x.com', password: 'marmalade jar 9' })
    expect(res).toHaveProperty('error')
    expect(g().users).toHaveLength(0)
  })

  it('rejects a duplicate email', async () => {
    await g().signup({ name: 'A', email: 'a@x.com', password: 'rusty kettle jar' })
    const res = await g().signup({ name: 'B', email: 'A@X.com', password: 'copper lantern bell' })
    expect(res).toHaveProperty('error')
    expect(g().users).toHaveLength(1)
  })

  it('transparently upgrades a legacy SHA-256 account to PBKDF2 on next login', async () => {
    // Recreate a pre-upgrade account exactly as the old code wrote it.
    const salt = 'legacy-salt'
    const password = 'legacypassword'
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + password))
    const legacyHash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
    useAuth.setState({
      users: [{ id: 'u1', name: 'Legacy', email: 'legacy@x.com', salt, hash: legacyHash, role: 'owner', createdAt: '2026-01-01' }],
      currentUserId: null,
    })

    // Wrong password must still fail against the legacy scheme.
    expect(await g().login({ email: 'legacy@x.com', password: 'nope12345' })).toHaveProperty('error')

    // Right password logs in AND rewrites the stored hash to PBKDF2.
    expect(await g().login({ email: 'legacy@x.com', password })).toEqual({ ok: true })
    const u = g().users[0]
    expect(u.kdf).toBe('pbkdf2')
    expect(u.hash).not.toBe(legacyHash)

    // The upgraded record still authenticates correctly afterwards.
    g().logout()
    expect(await g().login({ email: 'legacy@x.com', password })).toEqual({ ok: true })
    expect(await g().login({ email: 'legacy@x.com', password: 'wrongpass1' })).toHaveProperty('error')
  })

  it('never promotes a second self-signup to owner', async () => {
    await g().signup({ name: 'A', email: 'a@x.com', password: 'rusty kettle jar' })
    await g().signup({ name: 'B', email: 'b@x.com', password: 'copper lantern bell' })
    expect(g().users[0].role).toBe('owner')
    expect(g().users[1].role).toBe('viewer')
  })

  it('refuses to demote or remove the last owner', async () => {
    await g().signup({ name: 'A', email: 'a@x.com', password: 'rusty kettle jar' })
    const owner = g().users[0]
    g().setUserRole(owner.id, 'viewer')
    expect(g().users[0].role).toBe('owner')
    g().removeUser(owner.id)
    expect(g().users).toHaveLength(1)
  })
})
