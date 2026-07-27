import { describe, it, expect } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()

describe('deleteAccount refuses system accounts', () => {
  it('throws ACCOUNT_IS_SYSTEM for a seeded system account and leaves it in place', () => {
    const before = g().accounts.length
    expect(() => g().deleteAccount('acc-ar')).toThrow(/^ACCOUNT_IS_SYSTEM:/)
    expect(g().accounts.some((a) => a.id === 'acc-ar')).toBe(true)
    expect(g().accounts.length).toBe(before)
  })

  it('still deletes an ordinary, non-system account', () => {
    g().addAccount({ code: '9999', name: 'Throwaway', type: 'asset', subtype: 'current' })
    const acc = g().accounts.find((a) => a.code === '9999')
    expect(acc.isSystem).toBeFalsy()

    g().deleteAccount(acc.id)

    expect(g().accounts.some((a) => a.id === acc.id)).toBe(false)
  })
})
