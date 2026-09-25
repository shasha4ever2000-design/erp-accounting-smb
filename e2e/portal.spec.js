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
