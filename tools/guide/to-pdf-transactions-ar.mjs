import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
const DIR = process.env.GUIDE_DIR || '.'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage()
await page.goto('file://' + process.cwd() + '/txweb-ar/tx-guide-ar.html', { waitUntil: 'networkidle' })
await page.emulateMedia({ media: 'print' })
await page.pdf({
  path: 'ERP-Every-Transaction-AR.pdf', format: 'A4', printBackground: true,
  displayHeaderFooter: true, headerTemplate: '<div></div>',
  footerTemplate: `<div style="width:100%;font-size:8pt;color:#94a3b8;font-family:'Noto Sans Arabic',Arial,sans-serif;padding:0 13mm;display:flex;justify-content:space-between;direction:rtl;">
    <span>نظام المحاسبة — كل معاملة</span><span class="pageNumber"></span></div>`,
  margin: { top: '15mm', bottom: '17mm', left: '13mm', right: '13mm' },
})
await browser.close()
console.log('pdf written')
