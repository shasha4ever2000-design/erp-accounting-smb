import { describe, it, expect } from 'vitest'
import { normalisePhone, dialCodeFor, resolveRegion, buildStatementMessage, mailtoLink, whatsappLink } from '../src/utils/shareStatement.js'

describe('resolveRegion', () => {
  it('prefers the configured tax region', () => {
    expect(resolveRegion('GB', 'SAR')).toBe('GB')
  })
  it('falls back to the currency when no tax region is set', () => {
    expect(resolveRegion('', 'SAR')).toBe('SA')
    expect(resolveRegion(undefined, 'AED')).toBe('AE')
    expect(resolveRegion('XX', 'GBP')).toBe('GB')   // 'XX' = Custom/Other preset
  })
  it('returns empty when neither is usable', () => {
    expect(resolveRegion('', 'XYZ')).toBe('')
    expect(resolveRegion()).toBe('')
  })
})

describe('normalisePhone', () => {
  it('turns a Saudi local number into international form', () => {
    expect(normalisePhone('0501234567', 'SA')).toBe('966501234567')
  })
  it('handles spaces, dashes and parentheses', () => {
    expect(normalisePhone('(050) 123-4567', 'SA')).toBe('966501234567')
  })
  it('leaves an already-international number alone', () => {
    expect(normalisePhone('+966501234567', 'SA')).toBe('966501234567')
    expect(normalisePhone('00966501234567', 'SA')).toBe('966501234567')
  })
  it('does not double the dial code when already present without +', () => {
    expect(normalisePhone('966501234567', 'SA')).toBe('966501234567')
  })
  it('works for other regions', () => {
    expect(normalisePhone('07700900123', 'GB')).toBe('447700900123')
    expect(normalisePhone('0412345678', 'AU')).toBe('61412345678')
  })
  it('falls back to raw digits for an unknown region', () => {
    expect(normalisePhone('0501234567', 'ZZ')).toBe('0501234567')
    expect(normalisePhone('0501234567', undefined)).toBe('0501234567')
  })
  it('returns empty for missing or junk input', () => {
    expect(normalisePhone('', 'SA')).toBe('')
    expect(normalisePhone(null, 'SA')).toBe('')
    expect(normalisePhone('n/a', 'SA')).toBe('')
  })
  it('exposes dial codes', () => {
    expect(dialCodeFor('SA')).toBe('966')
    expect(dialCodeFor('US')).toBe('1')
    expect(dialCodeFor('NOPE')).toBe('')
  })
})

describe('buildStatementMessage', () => {
  const base = {
    entityName: 'Al-Noor Trading', companyName: 'Acme Co',
    startDate: '2026-01-01', endDate: '2026-06-30',
    money: (v) => `SAR ${Number(v).toFixed(2)}`,
    date: (d) => d,
  }

  it('states a balance due when money is owed', () => {
    const m = buildStatementMessage({ ...base, closing: 1500 })
    expect(m).toContain('Al-Noor Trading')
    expect(m).toContain('Balance due: SAR 1500.00')
    expect(m).toContain('Acme Co')
  })

  it('does NOT demand payment when the account is settled', () => {
    const m = buildStatementMessage({ ...base, closing: 0 })
    expect(m).toContain('fully settled')
    expect(m).not.toContain('Balance due')
    expect(m).not.toContain('Payment details')
  })

  it('reports a credit balance rather than a demand', () => {
    const m = buildStatementMessage({ ...base, closing: -250 })
    expect(m).toContain('Credit balance: SAR 250.00')
    expect(m).not.toContain('Balance due')
  })

  it('includes payment details only when something is actually owed', () => {
    const withDue = buildStatementMessage({ ...base, closing: 100, bankDetails: 'IBAN SA123' })
    expect(withDue).toContain('IBAN SA123')
    const settled = buildStatementMessage({ ...base, closing: 0, bankDetails: 'IBAN SA123' })
    expect(settled).not.toContain('IBAN SA123')
  })

  it('uses supplier wording when not a customer', () => {
    const m = buildStatementMessage({ ...base, closing: 500, isCustomer: false })
    expect(m).toContain('Balance payable')
    expect(m).not.toContain('Balance due')
  })
})

describe('link builders', () => {
  const body = 'Balance due: SAR 100 & more'

  it('builds a mailto with encoded subject and body', () => {
    const l = mailtoLink({ email: 'a@b.com', subject: 'Statement — Acme', body })
    expect(l.startsWith('mailto:a%40b.com?')).toBe(true)
    expect(l).toContain('subject=')
    expect(l).toContain(encodeURIComponent(body))
    expect(l).not.toContain(' ')       // fully encoded
  })

  it('builds a wa.me link with the normalised number', () => {
    const l = whatsappLink({ phone: '0501234567', body, countryId: 'SA' })
    expect(l).toBe(`https://wa.me/966501234567?text=${encodeURIComponent(body)}`)
  })

  it('still produces a usable WhatsApp link without a phone number', () => {
    const l = whatsappLink({ phone: '', body, countryId: 'SA' })
    expect(l).toBe(`https://wa.me/?text=${encodeURIComponent(body)}`)
  })

  it('encodes characters that would break a URL', () => {
    const l = whatsappLink({ phone: '0501234567', body: 'a&b=c?d#e', countryId: 'SA' })
    expect(l).toContain('a%26b%3Dc%3Fd%23e')
  })
})
