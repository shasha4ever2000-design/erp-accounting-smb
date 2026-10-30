import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { applyOnlinePayments, invoicePayUrl } from '../src/utils/onlinePayments.js'
import {
  minorDigits, toMinor, fromMinor, checkKey, keyHint, createRequest, fetchRequest, readCheckout, callbackRefs,
} from '../supabase/functions/pay/providers.ts'

// ─── The providers, without the network ───────────────────────────────

describe('amounts in the smallest unit', () => {
  it('knows the currencies that are not two decimals', () => {
    expect(minorDigits('SAR')).toBe(2)
    expect(minorDigits('kwd')).toBe(3)
    expect(minorDigits('JPY')).toBe(0)
    expect(toMinor(115.5, 'SAR')).toBe(11550)
    expect(toMinor(1.234, 'KWD')).toBe(1234)
    expect(fromMinor(11550, 'SAR')).toBe(115.5)
    expect(toMinor(0.1 + 0.2, 'SAR')).toBe(30)
  })
})

describe('secret keys', () => {
  it('catches a publishable key or a typo before it is saved', () => {
    expect(checkKey('moyasar', 'pk_live_abcdefghijkl')).toMatch(/sk_live_/)
    expect(checkKey('stripe', '')).toMatch(/Enter/)
    expect(checkKey('moyasar', 'sk_test_abcdefghijkl')).toBe('')
    expect(checkKey('stripe', 'sk_live_51Habcdefghijkl')).toBe('')
  })

  it('only ever shows the end of a key', () => {
    expect(keyHint('sk_live_abcdefghij9f3a')).toBe('sk_live_…9f3a')
  })
})

const req = {
  amount: 1150.75, currency: 'SAR', description: 'Acme — Invoice INV-0007',
  successUrl: 'https://app.example/?portal=t&paid=p', cancelUrl: 'https://app.example/?portal=t&invoice=i',
  callbackUrl: 'https://x.supabase.co/functions/v1/pay?callback=moyasar', reference: 'p',
}

describe('creating a checkout', () => {
  it('Moyasar: a JSON invoice in halalas, with basic auth on the secret key', () => {
    const r = createRequest('moyasar', 'sk_test_abcdefghijkl', req)
    expect(r.url).toBe('https://api.moyasar.com/v1/invoices')
    expect(r.init.headers.Authorization).toBe(`Basic ${btoa('sk_test_abcdefghijkl:')}`)
    const body = JSON.parse(r.init.body)
    expect(body).toMatchObject({ amount: 115075, currency: 'SAR', callback_url: req.callbackUrl, success_url: req.successUrl, back_url: req.cancelUrl })
  })

  it('Stripe: a form-encoded checkout session carrying our reference', () => {
    const r = createRequest('stripe', 'sk_test_abcdefghijkl', { ...req, currency: 'KWD', amount: 12.345 })
    const form = new URLSearchParams(r.init.body)
    expect(r.init.headers.Authorization).toBe('Bearer sk_test_abcdefghijkl')
    expect(form.get('mode')).toBe('payment')
    expect(form.get('line_items[0][price_data][currency]')).toBe('kwd')
    // Stripe wants three-decimal amounts to end in zero.
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('12350')
    expect(form.get('client_reference_id')).toBe('p')
  })

  it('looks a checkout up by its own id', () => {
    expect(fetchRequest('moyasar', 'k', 'abc').url).toBe('https://api.moyasar.com/v1/invoices/abc')
    expect(fetchRequest('stripe', 'k', 'cs_1').url).toBe('https://api.stripe.com/v1/checkout/sessions/cs_1')
  })
})

describe('reading what the provider says', () => {
  it('Moyasar: paid, with the fee from the paid payment', () => {
    const c = readCheckout('moyasar', {
      id: 'inv1', status: 'paid', amount: 115075, currency: 'SAR', url: 'https://checkout.moyasar.com/invoices/inv1',
      payments: [{ status: 'failed', fee: 0 }, { status: 'paid', fee: 2300, updated_at: '2026-10-30T10:00:00Z' }],
    })
    expect(c).toMatchObject({ ref: 'inv1', status: 'paid', paidAmount: 1150.75, fee: 23, paidAt: '2026-10-30T10:00:00Z' })
  })

  it('Moyasar: everything that is not paid', () => {
    expect(readCheckout('moyasar', { status: 'initiated' }).status).toBe('pending')
    expect(readCheckout('moyasar', { status: 'expired' }).status).toBe('expired')
    expect(readCheckout('moyasar', { status: 'canceled' }).status).toBe('failed')
    expect(readCheckout('moyasar', { status: 'initiated', amount: 100 }).paidAmount).toBe(0)
  })

  it('Stripe: paid only when payment_status says so', () => {
    expect(readCheckout('stripe', { id: 'cs_1', payment_status: 'paid', amount_total: 5000, currency: 'usd' })).toMatchObject({ status: 'paid', paidAmount: 50 })
    expect(readCheckout('stripe', { payment_status: 'unpaid', status: 'open' }).status).toBe('pending')
    expect(readCheckout('stripe', { payment_status: 'unpaid', status: 'expired' }).status).toBe('expired')
  })

  it('finds the checkout id in either provider\'s notification', () => {
    expect(callbackRefs({ id: 'moyasar-invoice-1', status: 'paid' })).toContain('moyasar-invoice-1')
    expect(callbackRefs({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_123' } } })).toContain('cs_test_123')
    expect(callbackRefs(null)).toEqual([])
  })
})

// ─── Recording paid payments in the books ─────────────────────────────

// A pretend online_payments table that honours the filters the app uses.
function fakeServer(rows) {
  const table = rows.map((r) => ({ applied_at: null, applied_by: null, applied_ref: null, ...r }))
  const client = {
    table,
    from: () => {
      const filters = []
      let patch = null
      let selecting = false
      const b = {
        select: () => { selecting = true; return b },
        update: (p) => { patch = p; return b },
        eq: (col, v) => { filters.push((r) => r[col] === v); return b },
        is: (col, v) => { filters.push((r) => r[col] === v); return b },
        order: () => b,
        limit: () => b,
        then: (resolve) => {
          const hit = table.filter((r) => filters.every((f) => f(r)))
          if (patch) hit.forEach((r) => Object.assign(r, patch))
          resolve({ data: selecting || !patch ? hit.map((r) => ({ ...r })) : null, error: null })
        },
      }
      return b
    },
  }
  return client
}

const g = () => useStore.getState()
let invoice
beforeEach(() => {
  useStore.setState({ customerAdvances: [], invoices: [], journalEntries: [], auditLog: [], recycleBin: [] })
  const customerId = g().addCustomer({ name: 'Gulf Star LLC' }).id
  invoice = g().addInvoice({
    customerId, customerName: 'Gulf Star LLC', date: '2026-10-01',
    items: [{ id: 'l1', description: 'Work', quantity: 1, unitPrice: 1000, discount: 0, taxRate: 0, subtotal: 1000 }],
    subtotal: 1000, taxAmount: 0, total: 1000,
  })
  g().updateOnlinePayments({ enabled: true, provider: 'moyasar', depositAccountId: 'acc-bank1' })
})

const paidRow = (over = {}) => ({
  id: 'op-1', company_id: 'co', invoice_id: invoice.id, invoice_number: invoice.number, provider: 'moyasar',
  provider_ref: 'mo-inv-1', amount: 1000, currency: 'SAR', status: 'paid', paid_amount: 1000, paid_at: '2026-10-30T09:00:00Z', ...over,
})

const run = (client) => applyOnlinePayments({ client, companyId: 'co', get: g, userId: 'u1', now: () => '2026-10-30T10:00:00Z' })

describe('recording online payments', () => {
  it('records a paid checkout as a receipt against its invoice, once', async () => {
    const client = fakeServer([paidRow()])
    const res = await run(client)
    expect(res.applied).toBe(1)
    const inv = g().invoices.find((i) => i.id === invoice.id)
    expect(inv.status).toBe('paid')
    expect(inv.payments).toHaveLength(1)
    expect(inv.payments[0]).toMatchObject({ amount: 1000, date: '2026-10-30', bankAccountId: 'acc-bank1', onlinePaymentId: 'op-1', method: 'online' })
    expect(client.table[0].applied_at).toBe('2026-10-30T10:00:00Z')
    expect(client.table[0].applied_ref).toBe(inv.payments[0].number)

    // The next sync finds nothing left to do.
    expect((await run(client)).applied).toBe(0)
    expect(g().invoices.find((i) => i.id === invoice.id).payments).toHaveLength(1)
  })

  it('leaves a row another device already claimed', async () => {
    const client = fakeServer([paidRow({ applied_at: '2026-10-30T09:59:00Z', applied_by: 'u2' })])
    expect((await run(client)).applied).toBe(0)
    expect(g().invoices.find((i) => i.id === invoice.id).payments || []).toHaveLength(0)
  })

  it('waits, without recording anything, until a deposit account is chosen', async () => {
    g().updateOnlinePayments({ depositAccountId: '' })
    const client = fakeServer([paidRow()])
    expect(await run(client)).toMatchObject({ applied: 0, waiting: 1, reason: 'no-account' })
    expect(client.table[0].applied_at).toBeNull()
  })

  it('waits for an invoice this device has not synced yet', async () => {
    const client = fakeServer([paidRow({ invoice_id: 'not-here-yet' })])
    expect((await run(client)).applied).toBe(0)
    expect(client.table[0].applied_at).toBeNull()
  })

  it('keeps money beyond what is owed as a customer advance', async () => {
    g().recordInvoicePayment(invoice.id, { date: '2026-10-20', amount: 400, bankAccountId: 'acc-bank1' })
    const client = fakeServer([paidRow()]) // customer still paid the full 1,000 online
    await run(client)
    const inv = g().invoices.find((i) => i.id === invoice.id)
    expect(inv.status).toBe('paid')
    expect(inv.payments.at(-1).amount).toBe(600)
    expect(g().customerAdvances).toHaveLength(1)
    expect(g().customerAdvances[0].amount).toBe(400)
  })

  it('hands the row back when recording fails, so the next sync retries', async () => {
    g().setPeriodLock({ lockDate: '2026-10-31' })
    const client = fakeServer([paidRow()])
    const res = await run(client)
    g().setPeriodLock({ lockDate: '' })
    expect(res.applied).toBe(0)
    expect(client.table[0].applied_at).toBeNull()
    expect(client.table[0].applied_ref).toBeTruthy()
    expect(g().invoices.find((i) => i.id === invoice.id).payments || []).toHaveLength(0)
  })

  it('skips pending and failed checkouts', async () => {
    const client = fakeServer([paidRow({ id: 'a', status: 'pending' }), paidRow({ id: 'b', status: 'failed' })])
    expect((await run(client)).applied).toBe(0)
  })
})

describe('the pay link in the invoice email', () => {
  it('opens that invoice in the portal', () => {
    expect(invoicePayUrl('https://app.example/?portal=tok', 'inv 1')).toBe('https://app.example/?portal=tok&invoice=inv%201')
  })
})
