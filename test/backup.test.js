import { describe, it, expect } from 'vitest'
import { encryptBackup, decryptBackup, isEncryptedEnvelope, isPlainBackup, parseBackupText } from '../src/utils/backup.js'

const sample = {
  _app: 'erp-accounting-smb', _version: 19, _exportedAt: '2026-07-11T00:00:00.000Z',
  accounts: [{ id: 'acc-cash', code: '1001', name: 'Cash on Hand' }],
  invoices: [{ id: 'i1', number: 'INV-1', total: 1150.5, items: [{ q: 3, p: 100 }] }],
  settings: { company: { name: 'Demo Co', currency: 'SAR' } },
}

describe('backup encryption', () => {
  it('round-trips an object through encrypt → decrypt', async () => {
    const env = await encryptBackup(sample, 'correct horse battery')
    expect(isEncryptedEnvelope(env)).toBe(true)
    expect(env._enc).toBe('AES-GCM')
    expect(env.ct).not.toContain('Demo Co')            // ciphertext must not leak plaintext
    const back = await decryptBackup(env, 'correct horse battery')
    expect(back).toEqual(sample)
  })

  it('rejects a wrong passphrase', async () => {
    const env = await encryptBackup(sample, 'right-key')
    await expect(decryptBackup(env, 'wrong-key')).rejects.toThrow('WRONG_PASSWORD')
  })

  it('rejects tampered ciphertext', async () => {
    const env = await encryptBackup(sample, 'k')
    // Flip a character in the ciphertext.
    const flipped = { ...env, ct: (env.ct[0] === 'A' ? 'B' : 'A') + env.ct.slice(1) }
    await expect(decryptBackup(flipped, 'k')).rejects.toThrow('WRONG_PASSWORD')
  })

  it('uses a fresh salt + iv each time (no deterministic ciphertext)', async () => {
    const a = await encryptBackup(sample, 'k')
    const b = await encryptBackup(sample, 'k')
    expect(a.ct).not.toBe(b.ct)
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
  })

  it('requires a passphrase', async () => {
    await expect(encryptBackup(sample, '')).rejects.toThrow()
  })
})

describe('backup envelope detection + parsing', () => {
  it('distinguishes plain vs encrypted', async () => {
    expect(isPlainBackup(sample)).toBe(true)
    expect(isEncryptedEnvelope(sample)).toBe(false)
    const env = await encryptBackup(sample, 'k')
    expect(isPlainBackup(env)).toBe(false)
    expect(isEncryptedEnvelope(env)).toBe(true)
  })

  it('parses plain and encrypted files', async () => {
    const plain = parseBackupText(JSON.stringify(sample))
    expect(plain.encrypted).toBe(false)
    expect(plain.data.settings.company.name).toBe('Demo Co')

    const env = await encryptBackup(sample, 'k')
    const enc = parseBackupText(JSON.stringify(env))
    expect(enc.encrypted).toBe(true)
    expect(enc.envelope._enc).toBe('AES-GCM')
  })

  it('rejects non-backup files', () => {
    expect(() => parseBackupText('{"hello":1}')).toThrow()
    expect(() => parseBackupText('not json')).toThrow()
  })
})
