import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const last = () => g().bankAccounts[g().bankAccounts.length - 1]
const glOf = (ba) => g().accounts.find((a) => a.id === ba.accountId)

// FX revaluation finds what to restate by walking the chart for accounts
// tagged with a non-base currency (Revaluation.jsx). A bank account's currency
// therefore has to reach its GL account, or the account looks like a base
// -currency one and is silently left out of every revaluation.

beforeEach(() => useStore.setState({ bankAccounts: [], accounts: g().accounts.filter((a) => !a.id.startsWith('tmp-')) }))

describe('a foreign-currency bank account', () => {
  it('tags its GL account, which is what makes it revaluable', () => {
    g().addBankAccount({ name: 'USD Operating', type: 'bank', bankName: 'SAB', currency: 'USD' })
    const ba = last()
    expect(ba.currency).toBe('USD')
    expect(glOf(ba).currency).toBe('USD')
  })

  it('leaves a base-currency account untagged rather than guessing', () => {
    g().addBankAccount({ name: 'Main', type: 'bank' })
    const ba = last()
    expect(ba.currency).toBe('')
    expect(glOf(ba).currency).toBe('')
  })

  it('still creates the GL account with the right shape', () => {
    g().addBankAccount({ name: 'EUR Savings', type: 'bank', currency: 'EUR' })
    const acc = glOf(last())
    expect(acc.type).toBe('asset')
    expect(acc.subtype).toBe('current')
    expect(acc.code).toBeTruthy()
  })
})

describe('changing the currency later', () => {
  it('moves the GL account with it', () => {
    g().addBankAccount({ name: 'Multi', type: 'bank', currency: 'USD' })
    const ba = last()
    g().updateBankAccount(ba.id, { currency: 'EUR' })

    expect(g().bankAccounts.find((b) => b.id === ba.id).currency).toBe('EUR')
    expect(glOf(ba).currency).toBe('EUR')
  })

  it('clears the GL tag when set back to base', () => {
    g().addBankAccount({ name: 'Was foreign', type: 'bank', currency: 'USD' })
    const ba = last()
    g().updateBankAccount(ba.id, { currency: '' })
    expect(glOf(ba).currency).toBe('')
  })

  it('leaves the GL account alone when the currency is not part of the edit', () => {
    g().addBankAccount({ name: 'USD Operating', type: 'bank', currency: 'USD' })
    const ba = last()
    g().updateBankAccount(ba.id, { name: 'Renamed' })

    expect(g().bankAccounts.find((b) => b.id === ba.id).name).toBe('Renamed')
    expect(glOf(ba).currency).toBe('USD') // untouched
  })

  it('does not disturb any other account', () => {
    g().addBankAccount({ name: 'One', type: 'bank', currency: 'USD' })
    const first = last()
    g().addBankAccount({ name: 'Two', type: 'bank', currency: 'GBP' })
    const second = last()

    g().updateBankAccount(first.id, { currency: 'EUR' })

    expect(glOf(second).currency).toBe('GBP')
  })
})

describe('what revaluation will pick up', () => {
  it('sees the foreign account and skips the base one', () => {
    const base = g().settings.company.currency   // 'USD' by default — so pick another
    const foreign = base === 'GBP' ? 'EUR' : 'GBP'
    g().addBankAccount({ name: 'Local', type: 'bank' })
    g().addBankAccount({ name: 'Foreign', type: 'bank', currency: foreign })

    // Mirrors Revaluation.jsx's own filter.
    const revaluable = g().accounts.filter((a) => a.currency && a.currency !== base)
    expect(revaluable.some((a) => a.name === 'Foreign')).toBe(true)
    expect(revaluable.some((a) => a.name === 'Local')).toBe(false)
  })
})
