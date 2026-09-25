import { test, expect } from '@playwright/test'

async function signUp(page, { name = 'Sara Test', email = 'sara@example.com' } = {}) {
  if (!(await page.getByLabel('Full name').count())) await page.getByText('Create an account').click()
  await page.getByLabel('Full name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('violet river lantern 42')
  await page.getByRole('button', { name: 'Create account' }).click()
}

async function freshCompany(page) {
  await page.goto('./')
  await signUp(page)
  await page.getByLabel('Company name').fill('Acme Trading')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByText("I'll set this up later").click()
  await page.getByRole('button', { name: /sample data/i }).first().click()
  await expect(page.getByText('Acme Trading').first()).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e })
  await freshCompany(page)
})

test('works offline, even on a page never opened before', async ({ page, context }) => {
  // Wait until the service worker has saved the whole app.
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.ready
    const keys = await caches.keys()
    const cache = await caches.open(keys.find((k) => k.startsWith('erp-cache-')))
    return !!reg.active && (await cache.keys()).length > 100
  }, null, { timeout: 30_000 })
  await context.setOffline(true)
  await expect(page.getByText(/You're offline/)).toBeVisible()
  await page.goto('payroll')
  await expect(page.getByRole('heading', { name: 'Payroll', level: 1 })).toBeVisible()
  await page.goto('reports')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await context.setOffline(false)
})

test('the notifications bell lists what needs attention', async ({ page }) => {
  await page.getByRole('button', { name: 'Notifications' }).click()
  const panel = page.getByRole('dialog', { name: 'Notifications' })
  await expect(panel).toBeVisible()
  const items = panel.locator('li')
  const count = await items.count()
  if (count > 0) {
    await items.first().getByRole('button', { name: 'Dismiss' }).click()
    await expect(items).toHaveCount(count - 1)
    await panel.getByText(/Show 1 hidden/).click()
    await expect(items).toHaveCount(count)
  } else {
    await expect(panel.getByText('Nothing needs your attention right now.')).toBeVisible()
  }
})

test('a bank statement file pays the invoice it mentions', async ({ page }) => {
  await page.goto('invoices/new')
  await page.getByLabel('Customer *').selectOption({ index: 1 })
  await page.getByPlaceholder('Item or service description').first().fill('Consulting')
  await page.getByLabel('Qty').first().fill('1')
  await page.getByLabel('Unit Price').first().fill('321.5')
  await page.getByRole('button', { name: 'Save invoice' }).click()
  const dlg = page.getByRole('alertdialog')
  if (await dlg.count()) await dlg.getByRole('button').last().click()
  await expect(page).toHaveURL(/invoices$/)
  const row = page.getByRole('row').filter({ hasText: '321.50' }).first()
  const number = (await row.innerText()).match(/INV-\d+/)[0]
  const total = (await row.innerText()).match(/[\d,]+\.\d\d/g).map((x) => Number(x.replace(/,/g, ''))).find((n) => n >= 321.5)

  const ofx = `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD<BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260920<TRNAMT>${total.toFixed(2)}<FITID>F1<NAME>TRANSFER ${number}
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260921<TRNAMT>-12.34<FITID>F2<NAME>BANK FEE
</BANKTRANLIST><LEDGERBAL><BALAMT>999.99</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
  await page.goto('reconciliation')
  await page.locator('input[type=file]').setInputFiles({ name: 'statement.ofx', mimeType: 'application/x-ofx', buffer: Buffer.from(ofx) })
  const modal = page.getByRole('dialog')
  await expect(modal.getByText(`Looks like payment for invoice ${number}`)).toBeVisible()
  await expect(page.getByLabel('Statement Ending Balance')).toHaveValue('999.99')
  await modal.getByRole('button', { name: 'Record payment' }).click()
  await expect(modal.getByText(number)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'Sales invoices' }).click()
  await expect(page.getByRole('row').filter({ hasText: number }).getByText(/paid/i).first()).toBeVisible()
})

test('a viewer cannot open payroll or create invoices', async ({ page }) => {
  // The first account is the owner; a second sign-up on the device is a viewer.
  await page.getByRole('button', { name: /Acme Trading/ }).first().click()
  await page.getByText('Manage companies…').click()
  await page.getByRole('button', { name: 'Log out' }).click()
  await signUp(page, { name: 'Omar View', email: 'omar@example.com' })
  await page.getByRole('button', { name: 'Open' }).first().click()
  await expect(page.getByRole('link', { name: 'Sales invoices' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Payroll' })).toHaveCount(0)
  await page.goto('payroll')
  await expect(page.getByText(/does not have access to HR & payroll/)).toBeVisible()
  await page.goto('invoices/new')
  await expect(page.getByText(/does not have access to Sales & customers/)).toBeVisible()
})
