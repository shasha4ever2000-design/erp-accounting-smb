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
const VERSION = '1966c2b0172e'
const PRECACHE = ["./apple-touch-icon.png","./assets/Advances-D-jYXE1D.js","./assets/Analytics-j9Wmn0Z0.js","./assets/Approvals-PzuroOep.js","./assets/Attachments-BDFA5aaa.js","./assets/Attendance-Do_M7lBI.js","./assets/AuditLog-G33PpoZh.js","./assets/BankAccounts-IeDQ9_Ed.js","./assets/Banking-CmTYkhbN.js","./assets/Budgets-BEuWTBs2.js","./assets/CapitalAccounts-Djk568Tc.js","./assets/CashFlow-D_THz0HG.js","./assets/CashForecast-D9efHEy5.js","./assets/ChartOfAccounts-Bp3akrzv.js","./assets/Cheques-Cw54qfaz.js","./assets/Commissions-CcUaIj5d.js","./assets/Consolidation-BL8e_hyx.js","./assets/Contracts-Cn6FUDEn.js","./assets/ConvertModal-C7EfJj3E.js","./assets/CreditNotes-BKQGwxT5.js","./assets/Currencies-Dnr0ZLwt.js","./assets/CustomFields-Bf3AlKRR.js","./assets/Customers-DIMU2H7f.js","./assets/DataImport-EV2jKelF.js","./assets/DebitNotes-CKTNhBmm.js","./assets/DeliveryNotes-C_oMOlZ1.js","./assets/Departments-DW4eFuSo.js","./assets/DocumentBrand-rs1GQW_2.js","./assets/EmailDialog-DJh-JETN.js","./assets/EmployeeAdvances-DsZn-NwA.js","./assets/Employees--HBI3jA-.js","./assets/ExpenseClaims-BiSbkLFX.js","./assets/FinancialHealth-DSHzNF2v.js","./assets/FixedAssetForm-DQAVDDqu.js","./assets/FixedAssets-DzPi7mTy.js","./assets/Inventory-DbGoHkBu.js","./assets/InventoryControl-kvdAZmzc.js","./assets/InvoiceForm-Cd-uvgHm.js","./assets/InvoiceView-ypK0SHa9.js","./assets/Invoices-B05z1lTz.js","./assets/JournalEntries-yKFLPVqR.js","./assets/Labels-DKPwNewC.js","./assets/LandedCosts-C9rm1CaM.js","./assets/Leases-DJD9A5-k.js","./assets/Manufacturing-DO0hTTpD.js","./assets/OpeningBalances-Bti8UcGX.js","./assets/POS-GU4BtcM0.js","./assets/PaymentReminders-DWLx64Mr.js","./assets/Payroll-C2uxh6ID.js","./assets/PeriodClose-g-FyUJF2.js","./assets/Pipeline-D7SSRZ4h.js","./assets/Portal-QyphLXtB.js","./assets/PrepaidExpenses-CtWggiFL.js","./assets/Projects-DuY4K4zo.js","./assets/PurchaseForm-DFOGf-5p.js","./assets/PurchaseOrderForm-DjiBm4Nb.js","./assets/PurchaseOrders-BWdAxDIU.js","./assets/PurchaseQuotes-2PO9e6MW.js","./assets/PurchaseView-CU9XKRG1.js","./assets/Purchases-CgOHaqYL.js","./assets/QuotationForm-DPMDmsh-.js","./assets/Quotations-rMjloVfz.js","./assets/Reconciliation-D3fVpcd3.js","./assets/RecurringExpenses-Ret-Oy8x.js","./assets/RecurringInvoices-Cf28Ga4P.js","./assets/RecurringJournals-jCwpwxuo.js","./assets/RecycleBin-D2leG4gD.js","./assets/Reports-CpuTdktV.js","./assets/Requisitions-CWoSiqup.js","./assets/Revaluation-PqyUBCmW.js","./assets/SalesOrders-BX5Tzu5W.js","./assets/Settings-C8vRVjXf.js","./assets/Statements-D0lyGHI4.js","./assets/StockAdjustments-CIWuipt2.js","./assets/StockCounts-Pi28cyL8.js","./assets/Suppliers-B_3HsIb2.js","./assets/Team-B3XUXghe.js","./assets/TradeAnalytics-DGunPJyL.js","./assets/TrendChart-DnJnY-Ws.js","./assets/Warehouses-BAQOnUIx.js","./assets/YearEndClose-JbzMu61U.js","./assets/ar-BPjGqa9N.js","./assets/arrow-up-right-B3Yb70lT.js","./assets/ban-Cnad5Nfv.js","./assets/brandAssets-CMCd5bvo.js","./assets/chevron-left-BWexd-SN.js","./assets/circle-B0p29qKP.js","./assets/circle-check-big-CJ_aRplh.js","./assets/circle-minus-DnlHUyOI.js","./assets/circle-x-B4kqVd5q.js","./assets/cloudAuth-CPneZs74.js","./assets/cloudSync-DQdKIHru.js","./assets/copy-iiHzmc2y.js","./assets/credit-card-Be-7eyVI.js","./assets/crown-B_XhK5D1.js","./assets/eye-BmxMczY5.js","./assets/image-plus-xaPpRibo.js","./assets/index-B1voJwoI.js","./assets/index-DIFXpKG4.js","./assets/index-DfIeHr3J.css","./assets/info-C20KLEQP.js","./assets/integrityCheck-xvfEKSOu.js","./assets/itemImages-DJ1Bwg-h.js","./assets/labels-C65KB4b5.js","./assets/link-2-yVgTi3J3.js","./assets/list-ordered-RU60tuXT.js","./assets/lock-open-C5-sK07c.js","./assets/node.browser-DzRJdstJ.js","./assets/node.browser-zZgx3J07.js","./assets/package-check-Dzm3T13x.js","./assets/pause-vVV8cpxC.js","./assets/pen-line-Dgr2krio.js","./assets/periodLock-Cw1W1b4J.js","./assets/play-Ce8E-utx.js","./assets/printer-D02hHekY.js","./assets/rotate-ccw-e6CQ6fn7.js","./assets/save-DaicH8Gw.js","./assets/scale-BFz4INef.js","./assets/scan-line-CSRx2Cp6.js","./assets/supabase-B5bbNdca.js","./assets/undo-2-De0VTbYP.js","./assets/upload-Dm-OmSKb.js","./assets/vat-CgYEi_to.js","./assets/vendor-charts-B3pk74kr.js","./assets/vendor-react-BYP1vJ79.js","./assets/vendor-utils-CZfQX67X.js","./fonts/fonts.css","./fonts/ibm-plex-sans-arabic-400-arabic.woff2","./fonts/ibm-plex-sans-arabic-400-latin.woff2","./fonts/ibm-plex-sans-arabic-500-arabic.woff2","./fonts/ibm-plex-sans-arabic-500-latin.woff2","./fonts/ibm-plex-sans-arabic-600-arabic.woff2","./fonts/ibm-plex-sans-arabic-600-latin.woff2","./fonts/ibm-plex-sans-arabic-700-arabic.woff2","./fonts/ibm-plex-sans-arabic-700-latin.woff2","./fonts/inter-latin.woff2","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./manifest.webmanifest"]
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
