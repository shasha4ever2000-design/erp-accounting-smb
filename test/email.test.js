import { describe, it, expect } from 'vitest'
import { invoiceEmail, mailtoFor } from '../src/utils/email'
import { portalUrl, portalTokenFromLocation } from '../src/utils/portal'

const company = { name: 'Acme' }
const money = (v) => `SAR ${v.toFixed(2)}`
const date = (d) => d

describe('invoice email', () => {
  const invoice = { number: 'INV-7', date: '2026-09-01', dueDate: '2026-10-01', total: 115 }
  it('asks for payment with due date, bank details and a summary', () => {
    const e = invoiceEmail({ invoice, company, customerName: 'Buyer', due: 115, money, date, bankDetails: 'IBAN SA01' })
    expect(e.subject).toBe('Invoice INV-7 from Acme')
    expect(e.message).toContain('Payment is due by 2026-10-01.')
    expect(e.message).toContain('IBAN SA01')
    expect(e.summary.map((r) => r.label)).toEqual(['Invoice', 'Date', 'Due date', 'Total'])
  })
  it('shows the balance when part-paid and thanks when paid', () => {
    expect(invoiceEmail({ invoice, company, due: 50, money, date }).summary.at(-1)).toEqual({ label: 'Balance due', value: 'SAR 50.00' })
    const paid = invoiceEmail({ invoice, company, due: 0, money, date, bankDetails: 'IBAN' })
    expect(paid.message).toContain('fully paid')
    expect(paid.message).not.toContain('IBAN')
  })
  it('puts the whole email into a mailto link', () => {
    const url = mailtoFor({ to: ['a@b.co'], subject: 'Hi', message: 'Body', summary: [{ label: 'Total', value: '5' }] })
    expect(url.startsWith('mailto:a%40b.co?subject=Hi&body=')).toBe(true)
    expect(decodeURIComponent(url)).toContain('Total: 5')
  })
})

describe('portal links', () => {
  it('builds and reads the portal address', () => {
    const token = '0f8fad5b-d9cb-469f-a165-70867728950e'
    const url = portalUrl(token, 'https://x.github.io')
    expect(url).toMatch(/^https:\/\/x\.github\.io\/.*\?portal=0f8fad5b/)
    expect(portalTokenFromLocation(new URL(url).search)).toBe(token)
    expect(portalTokenFromLocation('?portal=../../etc')).toBe('')
  })
})
