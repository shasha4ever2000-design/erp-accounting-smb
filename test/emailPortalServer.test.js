import { describe, it, expect } from 'vitest'
import { validateEmail, renderHtml, renderText, fromHeader } from '../supabase/functions/send-email/render.ts'
import { shapePortal } from '../supabase/functions/portal/shape.ts'

const ok = { to: 'Buyer@Example.com', subject: 'Invoice INV-1', message: 'Dear Buyer,\n\nPlease find it.' }

describe('send-email checks', () => {
  it('accepts a normal email and lower-cases addresses', () => {
    const { email } = validateEmail(ok)
    expect(email.to).toEqual(['buyer@example.com'])
  })

  it('refuses bad or too many addresses, empty subject or message', () => {
    expect(validateEmail({ ...ok, to: 'nope' }).error).toMatch(/not a valid email/)
    expect(validateEmail({ ...ok, to: ['a@b.co', 'c@d.co', 'e@f.co'], cc: ['g@h.co', 'i@j.co', 'k@l.co'] }).error).toMatch(/at most 5/)
    expect(validateEmail({ ...ok, subject: ' ' }).error).toMatch(/subject/)
    expect(validateEmail({ ...ok, message: '' }).error).toMatch(/message/)
    expect(validateEmail({ ...ok, to: 'a@b.co\r\nBcc: x@y.co' }).error).toBeTruthy()
  })

  it('keeps header injection out of the subject', () => {
    expect(validateEmail({ ...ok, subject: 'Hi\r\nBcc: evil@x.co' }).email.subject).toBe('Hi Bcc: evil@x.co')
  })

  it('only allows https links, and only to the app when APP_URL is set', () => {
    expect(validateEmail({ ...ok, link: { url: 'javascript:alert(1)', label: 'x' } }).error).toBeTruthy()
    expect(validateEmail({ ...ok, link: { url: 'http://x.co', label: 'x' } }).error).toMatch(/https/)
    expect(validateEmail({ ...ok, link: { url: 'https://evil.co/p', label: 'x' } }, { allowedLinkOrigin: 'https://app.co/' }).error).toMatch(/point to the app/)
    expect(validateEmail({ ...ok, link: { url: 'https://app.co/?portal=1', label: 'View' } }, { allowedLinkOrigin: 'https://app.co/' }).email.link.url).toBe('https://app.co/?portal=1')
  })

  it('escapes everything the app sends into the HTML', () => {
    const { email } = validateEmail({ ...ok, message: '<script>x</script>', summary: [{ label: '<b>', value: '"1"' }], link: { url: 'https://a.co/"x', label: '<i>' } })
    const html = renderHtml(email)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('https://a.co/%22x')
    expect(renderText(email)).toContain('<b>: "1"')
  })

  it('shows the company name as the sender', () => {
    expect(fromHeader('Billing <bill@acme.co>', 'Acme Trading')).toBe('"Acme Trading" <bill@acme.co>')
    expect(fromHeader('bill@acme.co', '')).toBe('bill@acme.co')
  })

  it('lays Arabic emails out right to left', () => {
    expect(renderHtml(validateEmail({ ...ok, lang: 'ar' }).email)).toContain('dir="rtl"')
  })
})

describe('portal data', () => {
  const settings = { company: { name: 'Acme', currency: 'SAR', currencySymbol: 'SAR', logo: 'data:image/png;base64,AA' }, invoice: { bankDetails: 'IBAN SA00' } }
  const customer = { id: 'c1', name: 'Buyer', creditLimit: 5000, notes: 'difficult' }
  const invoices = [
    { id: 'i1', number: 'INV-1', customerId: 'c1', status: 'sent', date: '2026-08-01', dueDate: '2026-08-31', total: 115, subtotal: 100, taxAmount: 15, amountPaid: 15,
      items: [{ description: 'Widget', quantity: 1, unitPrice: 100, taxRate: 15, subtotal: 100, costPrice: 40, accountId: 'acc-sales' }],
      journalEntryId: 'je1', internalNote: 'x', payments: [{ date: '2026-08-05', amount: 15, number: 'RCT-1', journalEntryId: 'je2' }] },
    { id: 'i2', number: 'INV-2', customerId: 'c1', status: 'draft', total: 50 },
    { id: 'i3', number: 'INV-3', customerId: 'c1', status: 'void', total: 50 },
    { id: 'i4', number: 'INV-4', customerId: 'c2', status: 'sent', total: 999 },
    { id: 'i5', number: 'INV-5', customerId: 'c1', status: 'sent', date: '2026-09-01', dueDate: '2026-10-01', total: 100, amountPaid: 0, currency: 'USD', exchangeRate: 3.75 },
  ]
  const creditNotes = [
    { id: 'n1', number: 'CN-1', customerId: 'c1', invoiceId: 'i1', invoiceNumber: 'INV-1', total: 20, status: 'issued' },
    { id: 'n2', number: 'CN-2', customerId: 'c1', total: 10, status: 'issued' },
  ]
  const out = shapePortal({ settings, customer, invoices, creditNotes, today: '2026-09-25' })

  it("shows only this customer's live invoices", () => {
    expect(out.invoices.map((i) => i.number)).toEqual(['INV-5', 'INV-1'])
  })

  it('works out what is due after payments and returns, and the balance in base currency', () => {
    const i1 = out.invoices.find((i) => i.number === 'INV-1')
    expect(i1).toMatchObject({ due: 80, credited: 20, paid: 15, status: 'overdue' })
    expect(out.balance).toBe(80 + 375 - 10)
  })

  it('never lets internal fields out', () => {
    const text = JSON.stringify(out)
    for (const secret of ['costPrice', 'accountId', 'journalEntryId', 'internalNote', 'creditLimit', 'difficult', 'INV-4', '999']) {
      expect(text).not.toContain(secret)
    }
    expect(out.company.bankDetails).toBe('IBAN SA00')
  })
})
