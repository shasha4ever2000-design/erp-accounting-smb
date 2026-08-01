import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
const BASE = 'http://localhost:4180/erp-accounting-smb'
const DIR = process.env.GUIDE_DIR || '.guide-build'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 2 })
page.on('dialog', (d) => d.accept())
const modal = () => page.locator('div.fixed.inset-0.z-50')

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
await page.setInputFiles('input[type="file"][accept*="json"]', `${DIR}/demo-backup.json`)
await page.waitForTimeout(3500)

// Attendance, on an employee and month that actually have a sheet.
{
  const d = new Date(); d.setMonth(d.getMonth() - 1, 1)
  const month = d.toISOString().slice(0, 7)
  await page.goto(BASE + '/attendance', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const empSel = page.locator('select').filter({ hasText: 'Yusuf Haddad' }).first()
  await empSel.selectOption({ label: 'Yusuf Haddad' })
  await page.waitForTimeout(400)
  await page.locator('input[type="month"]').fill(month)
  await page.waitForTimeout(1400)
  await page.screenshot({ path: `${DIR}/shots/s-attendance.png` })
  console.log('attendance month:', month)
}

// Real dark mode, via the titled toggle.
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.locator('button[title="Switch to dark mode"]').click()
await page.waitForTimeout(1200)
console.log('html class:', await page.getAttribute('html', 'class'))
await page.screenshot({ path: `${DIR}/shots/d-dark-mode.png` })

// Dark mode on a data-heavy screen too.
await page.goto(BASE + '/reports', { waitUntil: 'networkidle' })
await page.waitForTimeout(1600)
await page.screenshot({ path: `${DIR}/shots/d-dark-reports.png` })

// Back to light, then the company switcher as its own shot.
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
await page.locator('button[title="Switch to light mode"]').click()
await page.waitForTimeout(900)
await page.locator('header button, nav button').filter({ hasText: /Northwind/ }).first().click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${DIR}/shots/d-company-switcher.png` })
await browser.close()
console.log('done')
