// Signs up, creates a company, restores the seeded backup, then captures a
// screenshot of every screen the guide documents.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE || 'http://localhost:4179/erp-accounting-smb'
const DIR = '/tmp/claude-0/-home-user-worldcup2026/bb36a4c6-a632-58d3-bd87-76cdfe045204/scratchpad'
const AR = process.env.GUIDE_LANG === 'ar'
const OUT = `${DIR}/${AR ? 'shots-ar' : 'shots'}`
mkdirSync(OUT, { recursive: true })

const errors = []
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('dialog', (d) => d.accept())
const modal = () => page.locator('div.fixed.inset-0.z-50')

// ── Onboarding ─────────────────────────────────────────────────────
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.screenshot({ path: `${OUT}/00-signin.png` })
await page.getByRole('button', { name: 'Create an account' }).click()
await page.waitForTimeout(300)
await page.getByLabel('Full name').fill('Layla Mansour')
await page.getByLabel('Email').fill('layla@northwind.example')
await page.getByLabel('Password').fill('Northwind!Books2026')
await page.screenshot({ path: `${OUT}/01-signup.png` })
await page.getByRole('button', { name: 'Create account' }).click()
await page.waitForTimeout(2500)
await page.screenshot({ path: `${OUT}/02-companies.png` })
await page.getByPlaceholder('Al-Noor Trading Est.').fill('Northwind Trading Co.')
await page.getByRole('button', { name: 'Create' }).click()
await page.waitForTimeout(3000)
await page.screenshot({ path: `${OUT}/03-empty-dashboard.png` })

// ── Restore the seeded books ───────────────────────────────────────
await page.goto(BASE + '/settings', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.setInputFiles('input[type="file"][accept*="json"]', `${DIR}/demo-backup${AR ? '-ar' : ''}.json`)
await page.waitForTimeout(3500)
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
await page.goto(BASE + '/customers', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const check = (await page.textContent('body')) || ''
// The customer is renamed in the Arabic build, so match either spelling.
const restored = /Al-Noor Trading Est\.|مؤسسة النور/.test(check) && !/No customers yet|لا يوجد عملاء/.test(check)
console.log('restore worked:', restored)

// Switch the whole interface to Arabic before capturing anything, so the guide
// shows the app the way an Arabic reader will actually see it — mirrored
// layout, Arabic labels, Arabic numerals formatting and all.
if (AR) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.locator('button:has-text("ع")').first().click()
  await page.waitForTimeout(1500)
  const dir = await page.getAttribute('html', 'dir')
  if (dir !== 'rtl') { await browser.close(); throw new Error('language did not switch to Arabic') }
  console.log('switched to Arabic')
}
if (!restored) { await browser.close(); throw new Error('restore failed — aborting capture') }

// ── Every screen ───────────────────────────────────────────────────
const SCREENS = [
  ['dashboard', '/'],
  ['chart-of-accounts', '/accounts'],
  ['capital-accounts', '/capital-accounts'],
  ['bank-accounts', '/bank-accounts'],
  ['cash-flow', '/cash-flow'],
  ['banking', '/banking'],
  ['reconciliation', '/reconciliation'],
  ['cheques', '/cheques'],
  ['journals', '/journals'],
  ['recurring-journals', '/recurring-journals'],
  ['pipeline', '/pipeline'],
  ['pos', '/pos'],
  ['customers', '/customers'],
  ['quotations', '/quotations'],
  ['sales-orders', '/sales-orders'],
  ['invoices', '/invoices'],
  ['invoice-new', '/invoices/new'],
  ['recurring-invoices', '/recurring-invoices'],
  ['payment-reminders', '/payment-reminders'],
  ['commissions', '/commissions'],
  ['delivery-notes', '/delivery-notes'],
  ['customer-advances', '/advances'],
  ['credit-notes', '/credit-notes'],
  ['requisitions', '/requisitions'],
  ['suppliers', '/suppliers'],
  ['purchase-quotes', '/purchase-quotes'],
  ['purchase-orders', '/purchase-orders'],
  ['purchases', '/purchases'],
  ['debit-notes', '/debit-notes'],
  ['landed-costs', '/landed-costs'],
  ['recurring-expenses', '/recurring-expenses'],
  ['inventory', '/inventory'],
  ['inventory-control', '/inventory-control'],
  ['warehouses', '/warehouses'],
  ['stock-adjustments', '/stock-adjustments'],
  ['stock-counts', '/stock-counts'],
  ['labels', '/labels'],
  ['manufacturing', '/manufacturing'],
  ['projects', '/projects'],
  ['budgets', '/budgets'],
  ['prepaid-expenses', '/prepaid-expenses'],
  ['leases', '/leases'],
  ['expense-claims', '/expense-claims'],
  ['fixed-assets', '/fixed-assets'],
  ['departments', '/departments'],
  ['employees', '/employees'],
  ['contracts', '/contracts'],
  ['attendance', '/attendance'],
  ['payroll', '/payroll'],
  ['employee-advances', '/employee-advances'],
  ['analytics', '/analytics'],
  ['trade-analytics', '/trade-analytics'],
  ['financial-health', '/financial-health'],
  ['consolidation', '/consolidation'],
  ['currencies', '/currencies'],
  ['revaluation', '/revaluation'],
  ['statements', '/statements'],
  ['reports', '/reports'],
  ['opening-balances', '/opening-balances'],
  ['import-export', '/import-export'],
  ['year-end', '/year-end'],
  ['approvals', '/approvals'],
  ['recycle-bin', '/recycle-bin'],
  ['audit-log', '/audit-log'],
  ['team', '/team'],
  ['settings', '/settings'],
]

const empty = []
for (const [name, path] of SCREENS) {
  try {
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1100)
    await page.screenshot({ path: `${OUT}/s-${name}.png` })
    const txt = ((await page.textContent('main')) || (await page.textContent('body')) || '')
    if (/No .{0,40} yet|Nothing here|is empty/i.test(txt)) empty.push(name)
  } catch (e) { errors.push(`${name}: ${e.message}`) }
}

// ── A few detail / form screens worth showing ──────────────────────
const detail = async (name, fn) => {
  try { await fn(); await page.waitForTimeout(900); await page.screenshot({ path: `${OUT}/d-${name}.png` }) }
  catch (e) { errors.push(`detail ${name}: ${e.message}`) }
}

await detail('invoice-view', async () => {
  await page.goto(BASE + '/invoices', { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.locator('table tbody tr, tbody tr').first().click()
})

await detail('reports-pl', async () => {
  await page.goto(BASE + '/reports', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
})

await detail('payroll-run-form', async () => {
  await page.goto(BASE + '/payroll', { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: /Run Payroll|تشغيل الرواتب/i }).first().click()
})

await detail('customer-form', async () => {
  await page.goto(BASE + '/customers', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /New Customer|Add Customer|عميل جديد/i }).first().click()
})

await detail('item-form', async () => {
  await page.goto(BASE + '/inventory', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /New Item|Add Item|صنف جديد/i }).first().click()
})

await detail('command-palette', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.keyboard.press('Meta+k')
})

await detail('dark-mode', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await page.locator('button[aria-label*="theme" i], button[title*="theme" i]').first().click().catch(async () => {
    await page.locator('header button, nav button').filter({ has: page.locator('svg') }).nth(2).click()
  })
})

if (!AR) await detail('arabic-rtl', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await page.locator('button:has-text("ع")').first().click()
})

writeFileSync(`${DIR}/capture-report.txt`,
  `empty screens: ${empty.join(', ') || 'none'}\nerrors:\n${errors.join('\n') || 'none'}\n`)
await browser.close()
console.log('empty screens:', empty.join(', ') || 'none')
console.log('errors:', errors.length ? '\n' + errors.join('\n') : 'none')
