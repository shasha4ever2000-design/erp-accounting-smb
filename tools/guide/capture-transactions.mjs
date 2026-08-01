// Restores the transaction company, then screenshots the journal entry behind
// every worked example — plus the documents that produced them.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'

const BASE = process.env.BASE || 'http://localhost:4180/erp-accounting-smb'
const DIR = process.env.GUIDE_DIR || '.guide-build'
const AR = process.env.GUIDE_LANG === 'ar'
const OUT = `${DIR}/${AR ? 'tx-shots-ar' : 'tx-shots'}`
mkdirSync(OUT, { recursive: true })

const manifest = JSON.parse(readFileSync(`${DIR}/tx-manifest.json`, 'utf8'))
const errors = []
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('dialog', (d) => d.accept())
const panel = () => page.locator('div.fixed.inset-0.z-50 > div.relative')

// ── Onboarding + restore ───────────────────────────────────────────
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Create an account' }).click()
await page.getByLabel('Full name').fill('Layla Mansour')
await page.getByLabel('Email').fill('layla@northwind.example')
await page.getByLabel('Password').fill('Northwind!Books2026')
await page.getByRole('button', { name: 'Create account' }).click()
await page.waitForTimeout(2500)
await page.getByPlaceholder('Al-Noor Trading Est.').fill('Northwind Trading Co.')
await page.getByRole('button', { name: 'Create' }).click()
await page.waitForTimeout(3000)
await page.goto(BASE + '/settings', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.setInputFiles('input[type="file"][accept*="json"]', `${DIR}/tx-backup${AR ? '-ar' : ''}.json`)
await page.waitForTimeout(3500)

await page.goto(BASE + '/journals', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const check = (await page.textContent('body')) || ''
if (!/JE-00/.test(check)) { await browser.close(); throw new Error('restore failed — no journal entries') }
console.log('restore ok')

if (AR) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.locator('button:has-text("ع")').first().click()
  await page.waitForTimeout(1500)
  const dir = await page.getAttribute('html', 'dir')
  if (dir !== 'rtl') { await browser.close(); throw new Error('language did not switch to Arabic') }
  console.log('switched to Arabic')
}

// From here on, refuse every dialog rather than accept it. The only confirms
// left on these screens are destructive ones (Void an entry), and a mis-aimed
// click must not be allowed to rewrite the books being documented.
page.removeAllListeners('dialog')
page.on('dialog', (d) => d.dismiss())

// ── The journal entry behind every example ─────────────────────────
let shot = 0
for (const ex of manifest) {
  for (const je of ex.entries) {
    try {
      await page.goto(BASE + '/journals', { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      await page.locator('input[placeholder*="Search entries"], input[placeholder*="بحث"]').first().fill(je.number)
      await page.waitForTimeout(500)
      // One row survives the filter. In the actions cell the buttons are
      // [attachment, view, (void)] — a manual entry has the third one, so
      // `last()` would be Void. The view button is always the second.
      const rows = page.locator('tbody tr')
      if (await rows.count() !== 1) { errors.push(`${je.number}: ${await rows.count()} rows after filtering`); continue }
      await rows.first().locator('td').last().locator('button').nth(1).click()
      await page.waitForTimeout(600)
      await panel().screenshot({ path: `${OUT}/je-${je.number}.png` })
      shot++
      await page.keyboard.press('Escape')
    } catch (e) { errors.push(`${je.number}: ${e.message}`) }
  }
}
console.log('journal entry shots:', shot)

// ── The documents that produced them ───────────────────────────────
const DOCS = [
  ['journals-list', '/journals'],
  ['invoices', '/invoices'],
  ['purchases', '/purchases'],
  ['quotations', '/quotations'],
  ['sales-orders', '/sales-orders'],
  ['delivery-notes', '/delivery-notes'],
  ['purchase-orders', '/purchase-orders'],
  ['purchase-quotes', '/purchase-quotes'],
  ['requisitions', '/requisitions'],
  ['credit-notes', '/credit-notes'],
  ['debit-notes', '/debit-notes'],
  ['landed-costs', '/landed-costs'],
  ['cheques', '/cheques'],
  ['customer-advances', '/advances'],
  ['employee-advances', '/employee-advances'],
  ['stock-adjustments', '/stock-adjustments'],
  ['warehouses', '/warehouses'],
  ['manufacturing', '/manufacturing'],
  ['banking', '/banking'],
  ['cash-flow', '/cash-flow'],
  ['prepaid-expenses', '/prepaid-expenses'],
  ['leases', '/leases'],
  ['expense-claims', '/expense-claims'],
  ['fixed-assets', '/fixed-assets'],
  ['payroll', '/payroll'],
  ['revaluation', '/revaluation'],
  ['recurring-journals', '/recurring-journals'],
  ['inventory', '/inventory'],
  ['reports', '/reports'],
  ['dashboard', '/'],
]
for (const [name, path] of DOCS) {
  try {
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1100)
    await page.screenshot({ path: `${OUT}/doc-${name}.png` })
  } catch (e) { errors.push(`doc ${name}: ${e.message}`) }
}

// ── A filled-in form, so the guide can show data going in ──────────
try {
  await page.goto(BASE + '/invoices/new', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1400)
  await page.screenshot({ path: `${OUT}/doc-invoice-form.png` })
} catch (e) { errors.push('invoice form: ' + e.message) }

try {
  await page.goto(BASE + '/invoices', { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.locator('tbody tr').first().click()
  await page.waitForTimeout(1300)
  await page.screenshot({ path: `${OUT}/doc-invoice-view.png` })
} catch (e) { errors.push('invoice view: ' + e.message) }

writeFileSync(`${DIR}/tx-capture-report.txt`, errors.join('\n') || 'no errors')
await browser.close()
console.log('errors:', errors.length ? '\n' + errors.join('\n') : 'none')
