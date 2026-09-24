import { test, expect } from '@playwright/test'

// Every test starts from an empty browser: sign up, make a company, skip the
// setup questions and load the sample books.
async function freshCompany(page) {
  await page.goto('./')
  if (!(await page.getByLabel('Full name').count())) await page.getByText('Create an account').click()
  await page.getByLabel('Full name').fill('Sara Test')
  await page.getByLabel('Email').fill('sara@example.com')
  await page.getByLabel('Password').fill('violet river lantern 42')
  await page.getByRole('button', { name: 'Create account' }).click()
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

test('the trial balance balances', async ({ page }) => {
  await page.goto('reports')
  await page.locator('select').first().selectOption({ label: 'Trial Balance' })
  await expect(page.getByText('Trial balance is balanced')).toBeVisible()
})

test('the balance sheet balances', async ({ page }) => {
  await page.goto('reports')
  await page.locator('select').first().selectOption({ label: 'Balance Sheet' })
  await expect(page.getByText('Total Assets').first()).toBeVisible()
  await expect(page.getByText(/out of balance/i)).toHaveCount(0)
})

test('create, pay and void an invoice', async ({ page }) => {
  await page.goto('invoices/new')
  await page.getByLabel('Customer *').selectOption({ index: 1 })
  await page.getByPlaceholder('Item or service description').first().fill('Consulting')
  await page.getByLabel('Qty').first().fill('2')
  await page.getByLabel('Unit Price').first().fill('150')
  await page.getByRole('button', { name: 'Save Invoice' }).click()
  // stock/credit warnings, if any, are answered in the in-app dialog
  const dlg = page.getByRole('alertdialog')
  if (await dlg.count()) await dlg.getByRole('button').last().click()

  await expect(page).toHaveURL(/invoices$/)
  await page.getByText('INV-0006').click()
  await expect(page).toHaveURL(/invoices\/[^/]+$/)
  await page.getByRole('button', { name: 'Record Payment' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Record Payment' }).click()
  // Fully paid: the payment button goes and the amount paid shows.
  await expect(page.getByRole('button', { name: 'Record Payment' })).toHaveCount(0)
  await expect(page.getByText('Amount Paid')).toBeVisible()

  page.once('dialog', (d) => d.accept('Entered twice'))
  await page.getByRole('button', { name: 'Void' }).click()
  // Voided: it can't be voided (or returned) again.
  await expect(page.getByRole('button', { name: 'Void' })).toHaveCount(0)

  // The ledger is still sound afterwards.
  await page.goto('reports')
  await page.locator('select').first().selectOption({ label: 'Trial Balance' })
  await expect(page.getByText('Trial balance is balanced')).toBeVisible()
})

test('deleting asks in an in-app dialog, and Cancel keeps the record', async ({ page }) => {
  await page.goto('customers')
  const rows = page.locator('tbody tr')
  await expect(rows.first()).toBeVisible()
  const before = await rows.count()
  await page.locator('button:has(svg.lucide-trash2)').first().click()
  const dlg = page.getByRole('alertdialog')
  await expect(dlg).toContainText('Delete customer')
  await expect(dlg.getByRole('button', { name: 'Delete' })).toBeVisible()
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  await expect(rows).toHaveCount(before)
})

test('keyboard shortcuts', async ({ page }) => {
  await page.keyboard.press('Alt+KeyI')
  await expect(page).toHaveURL(/invoices\/new$/)
  await page.keyboard.press('Shift+Slash')
  await expect(page.getByRole('dialog')).toContainText('Keyboard shortcuts')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('dark mode and compact rows stick', async ({ page }) => {
  await page.getByTitle('Switch to dark mode').click()
  await page.getByTitle('Compact rows').click()
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveClass(/density-compact/)
})

test('Arabic switches the layout to right-to-left and translates', async ({ page }) => {
  await page.getByTitle('العربية').click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  // The dictionary loads on demand; the navigation reads in Arabic once it lands.
  await expect(page.getByText('لوحة التحكم').first()).toBeVisible()
  // ...and on a fresh load it is there before the first paint.
  await page.reload()
  await expect(page.getByText('لوحة التحكم').first()).toBeVisible()
})
