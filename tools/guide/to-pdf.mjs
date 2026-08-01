import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
const DIR = process.env.GUIDE_DIR || '.guide-build'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage()
await page.goto('file://' + DIR + '/web/guide.html', { waitUntil: 'networkidle' })
await page.emulateMedia({ media: 'print' })
await page.pdf({
  path: DIR + '/ERP-Accounting-User-Guide.pdf',
  format: 'A4', printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="width:100%;font-size:7.5pt;color:#94a3b8;font-family:-apple-system,Segoe UI,Arial,sans-serif;padding:0 14mm;display:flex;justify-content:space-between;">
    <span>ERP Accounting — User Guide</span><span class="pageNumber"></span></div>`,
  margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
})
await browser.close()
console.log('pdf written')
