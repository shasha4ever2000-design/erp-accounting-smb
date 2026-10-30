// Service worker for the installable / offline web edition.
//
// At build time (see offlinePrecache in vite.config.js) the list below is
// filled with every file of the build — every page's code, the fonts, the
// Arabic dictionary, the icons — and VERSION with a hash of that list. Install
// downloads them all, so the whole app works offline from the first visit,
// not only the pages that happened to be opened while online.
//
// A new version installs in the background and then waits. The page shows
// "A new version is ready" and sends SKIP_WAITING when the user says so;
// swapping files under a page that is still running the old ones would break
// the next screen it lazily loads.
const VERSION = 'f1fe9d822c6e'
const PRECACHE = ["./apple-touch-icon.png","./assets/Advances-DyOLuKUg.js","./assets/Analytics-Bi1BwKo9.js","./assets/Approvals-B1wekWYw.js","./assets/Attachments-gHR_lyy1.js","./assets/Attendance-B0IJ2Zu4.js","./assets/AuditLog-CVO-0eb0.js","./assets/BankAccounts-zm5IGRzC.js","./assets/Banking-2GEX2kxK.js","./assets/Budgets-rnWtPOsc.js","./assets/CapitalAccounts-DNiJuzcl.js","./assets/CashFlow-BhzFHhX2.js","./assets/CashForecast-BmDJ6wD3.js","./assets/ChartOfAccounts-kpAOJ_ub.js","./assets/Cheques-BvxRcC-R.js","./assets/Commissions-7IjiaNVO.js","./assets/Consolidation-Ck8GofD0.js","./assets/Contracts-C79zr_q3.js","./assets/ConvertModal-Dp_YJpYY.js","./assets/CreditNotes-2F9PJIku.js","./assets/Currencies-BxqtoKBK.js","./assets/CustomFields-CcZNkSi6.js","./assets/Customers-CmoGY4DP.js","./assets/DataImport-Ckby4xRH.js","./assets/DebitNotes-D83oY5Eo.js","./assets/DeliveryNotes-e9Z7K5Vt.js","./assets/Departments-BUSiNmZ9.js","./assets/DocumentBrand-nBRxvm-p.js","./assets/EmailDialog-XFKhiAkZ.js","./assets/EmployeeAdvances-DFvbxoo1.js","./assets/Employees-BXdfRkjw.js","./assets/ExpenseClaims-ag3pgbYz.js","./assets/FinancialHealth-DjYFRAyD.js","./assets/FixedAssetForm-CZ5dIZXj.js","./assets/FixedAssets-Cv6sDet9.js","./assets/Inventory-B8H8kPVG.js","./assets/InventoryControl-ByRQzXOc.js","./assets/InvoiceForm-B5LEVMIp.js","./assets/InvoiceView-qek3GWPV.js","./assets/Invoices-AMXqxXLd.js","./assets/JournalEntries-BNC_fz1y.js","./assets/Labels-D4FF5UCe.js","./assets/LandedCosts-B1_pUFJ1.js","./assets/Leases-BX-pECV2.js","./assets/Manufacturing-z7YF3_SK.js","./assets/OpeningBalances-RyWWPO5w.js","./assets/POS-CSOCuLrC.js","./assets/PaymentReminders-C88vDyTe.js","./assets/Payroll-Bt2prolq.js","./assets/PeriodClose-BuNqxEQW.js","./assets/Pipeline-DjUGy-Pr.js","./assets/Portal-Ccm7v57t.js","./assets/PrepaidExpenses-BjlvTot3.js","./assets/Projects-B2FlvgKY.js","./assets/PurchaseForm-2rDoRr1S.js","./assets/PurchaseOrderForm-CwDbIcIV.js","./assets/PurchaseOrders-CglDxdFF.js","./assets/PurchaseQuotes-Bg3rOLoS.js","./assets/PurchaseView-BD1PwRDt.js","./assets/Purchases-CLZQBzu9.js","./assets/QuotationForm-DDw3R0ak.js","./assets/Quotations-BTBDRzZo.js","./assets/Reconciliation-DNiI77Qx.js","./assets/RecurringExpenses-DFfa0GPX.js","./assets/RecurringInvoices-iNS105be.js","./assets/RecurringJournals-mlNzfplM.js","./assets/RecycleBin-DsK15WsC.js","./assets/Reports-BUCZY7TY.js","./assets/Requisitions-C5WTiWmM.js","./assets/Revaluation-aWSv_lwv.js","./assets/SalesOrders-Bfng2Kor.js","./assets/Settings-GCpslv95.js","./assets/Statements-DW3jbstU.js","./assets/StockAdjustments-BLX92YqP.js","./assets/StockCounts-Bj3rk5Nu.js","./assets/Suppliers-Bxggi18W.js","./assets/Team-C6tpxGTo.js","./assets/TradeAnalytics-g2Nq-Ss8.js","./assets/TrendChart-Cjc9cJLF.js","./assets/Warehouses-B2VFWsel.js","./assets/YearEndClose-B7SRbWJA.js","./assets/ar-CYo68RyQ.js","./assets/arrow-up-right-C4kx5FTz.js","./assets/ban-BbA4yJ9m.js","./assets/brandAssets-Bc5l7xnW.js","./assets/chevron-left-CC84WILD.js","./assets/circle-Cl7Y2Eo3.js","./assets/circle-check-big-D7sZ1XrA.js","./assets/circle-minus-Bfm-yArB.js","./assets/circle-x-X1BUHLHG.js","./assets/cloudAuth-friEgm0E.js","./assets/cloudSync-Cmo8Pem1.js","./assets/copy-CI16JxxL.js","./assets/credit-card-DBql-phv.js","./assets/crown-B9yp0CuJ.js","./assets/eye-6lOJwV-5.js","./assets/image-plus-DyYVKM93.js","./assets/index-DfIeHr3J.css","./assets/index-DnGTeTBX.js","./assets/index-x4Dvbyx5.js","./assets/info-C9_Pn6u8.js","./assets/integrityCheck-DWcBMOdV.js","./assets/itemImages-OESyxBRe.js","./assets/labels-C65KB4b5.js","./assets/link-2-B18ukdL9.js","./assets/list-ordered-Cd1rPwWN.js","./assets/lock-open-II5w0OrM.js","./assets/node.browser-DzfA4V-Y.js","./assets/node.browser-Sk_hcYdb.js","./assets/package-check-VGKy7kXY.js","./assets/pause-ByTxAj0U.js","./assets/pen-line-DISMjHKd.js","./assets/periodLock-Cw1W1b4J.js","./assets/play-UXnsXJZK.js","./assets/printer-B4IsolWe.js","./assets/rotate-ccw-DewCkxvZ.js","./assets/save-D1sV3Lo-.js","./assets/scale-Ddx6dUn7.js","./assets/scan-line-BnLzpEMf.js","./assets/supabase-B5bbNdca.js","./assets/undo-2-3O5MOzj9.js","./assets/upload-B92Arffz.js","./assets/vat-CgYEi_to.js","./assets/vendor-charts-B3pk74kr.js","./assets/vendor-react-BYP1vJ79.js","./assets/vendor-utils-CZfQX67X.js","./fonts/fonts.css","./fonts/ibm-plex-sans-arabic-400-arabic.woff2","./fonts/ibm-plex-sans-arabic-400-latin.woff2","./fonts/ibm-plex-sans-arabic-500-arabic.woff2","./fonts/ibm-plex-sans-arabic-500-latin.woff2","./fonts/ibm-plex-sans-arabic-600-arabic.woff2","./fonts/ibm-plex-sans-arabic-600-latin.woff2","./fonts/ibm-plex-sans-arabic-700-arabic.woff2","./fonts/ibm-plex-sans-arabic-700-latin.woff2","./fonts/inter-latin.woff2","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./manifest.webmanifest"]
const CACHE = `erp-cache-${VERSION}`
const BASE = new URL('./', self.location).pathname

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    // One file failing (a flaky connection) must not throw away the rest;
    // anything missed is cached on first use instead.
    await Promise.all(PRECACHE.map((path) => cache.add(new URL(path, self.location).href).catch(() => {})))
    await cache.add(BASE).catch(() => {})
  })())
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k.startsWith('erp-cache') && k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Pages: network first so an update is picked up, the saved app offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      try {
        const fresh = await fetch(req)
        if (fresh.ok) cache.put(BASE, fresh.clone())
        return fresh
      } catch {
        return (await cache.match(BASE)) || (await cache.match(req)) || Response.error()
      }
    })())
    return
  }

  // Build files have a hash in their name, so a saved copy is never stale.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const cached = await cache.match(req, { ignoreSearch: true })
    if (cached) return cached
    try {
      const fresh = await fetch(req)
      if (fresh && fresh.status === 200 && fresh.type === 'basic') cache.put(req, fresh.clone())
      return fresh
    } catch {
      return Response.error()
    }
  })())
})
