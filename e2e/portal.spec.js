import { test, expect } from '@playwright/test'

const TOKEN = '0f8fad5b-d9cb-469f-a165-70867728950e'
const reply = {
  company: { name: 'Acme Trading', address: 'Riyadh', phone: '', email: 'billing@acme.test', taxId: '300000000000003', currency: 'SAR', currencySymbol: 'SAR', logo: '', bankDetails: 'IBAN SA00 0000' },
  customer: { name: 'Al Noor' },
  balance: 80,
  invoices: [
    { id: 'i1', number: 'INV-0001', date: '2026-08-01', dueDate: '2026-08-31', status: 'overdue', currency: 'SAR', subtotal: 100, taxAmount: 15, total: 115, paid: 15, credited: 20, due: 80, notes: '',
      items: [{ description: 'Widget', quantity: 1, unitPrice: 100, taxRate: 15, amount: 100 }], payments: [{ date: '2026-08-05', amount: 15, number: 'RCT-1' }] },
  ],
  creditNotes: [{ number: 'CN-1', date: '2026-08-10', total: 20, invoiceNumber: 'INV-0001' }],
}

test('a customer opens their portal link without signing in', async ({ page }) => {
  page.on('pageerror', (e) => { throw e })
  let asked = null
  await page.route('**/functions/v1/portal', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
    asked = route.request().postDataJSON()
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(reply) })
  })
  await page.goto(`./?portal=${TOKEN}`)
  await expect(page.getByRole('heading', { name: 'Acme Trading' })).toBeVisible()
  expect(asked).toEqual({ token: TOKEN })
  await expect(page.getByText('Al Noor')).toBeVisible()
  await expect(page.getByText('IBAN SA00 0000')).toBeVisible()
  await expect(page.getByText('Create an account')).toHaveCount(0)
  await page.getByRole('button', { name: /INV-0001/ }).click()
  await expect(page.getByText('Widget')).toBeVisible()
  await expect(page.getByText(/Payments received/)).toBeVisible()
})

test('a cancelled link says so plainly', async ({ page }) => {
  await page.route('**/functions/v1/portal', (route) => route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
    : route.fulfill({ status: 404, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'This link is not valid any more. Ask the company for a new one.' }) }))
  await page.goto(`./?portal=${TOKEN}`)
  await expect(page.getByText('This link is not valid any more. Ask the company for a new one.')).toBeVisible()
})

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
const routePortal = (page, body) => page.route('**/functions/v1/portal', (route) => route.request().method() === 'OPTIONS'
  ? route.fulfill({ status: 200, headers: cors })
  : route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) }))

test('a customer pays an invoice online from the link in its email', async ({ page }) => {
  page.on('pageerror', (e) => { throw e })
  await routePortal(page, { ...reply, canPayOnline: true })
  let asked = null
  await page.route('**/functions/v1/pay', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors })
    asked = route.request().postDataJSON()
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ url: 'https://checkout.example.test/pay/1', paymentId: 'p1' }) })
  })
  await page.route('https://checkout.example.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Provider checkout</h1>' }))

  // The email links straight to the invoice, which opens with its Pay button.
  await page.goto(`./?portal=${TOKEN}&invoice=i1`)
  await expect(page.getByText('Widget')).toBeVisible()
  await page.getByRole('button', { name: /Pay SAR\s?80\.00 now/ }).click()
  await expect(page.getByRole('heading', { name: 'Provider checkout' })).toBeVisible()
  expect(asked).toMatchObject({ action: 'checkout', token: TOKEN, invoiceId: 'i1' })
  expect(asked.returnUrl).toMatch(/^http/)
})

test('no Pay button when the company has not set up online payments', async ({ page }) => {
  await routePortal(page, reply)
  await page.goto(`./?portal=${TOKEN}&invoice=i1`)
  await expect(page.getByText('Widget')).toBeVisible()
  await expect(page.getByRole('button', { name: /Pay .* now/ })).toHaveCount(0)
})

test('back from paying, the customer is told it went through', async ({ page }) => {
  await routePortal(page, { ...reply, canPayOnline: true })
  await page.route('**/functions/v1/pay', (route) => route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 200, headers: cors })
    : route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ status: 'paid', amount: 80, currency: 'SAR', invoiceNumber: 'INV-0001' }) }))
  await page.goto(`./?portal=${TOKEN}&paid=5a1a6bb3-168e-41ef-9829-22280bff72e4`)
  await expect(page.getByText(/your payment of SAR\s?80\.00 for INV-0001 was received/)).toBeVisible()
})
