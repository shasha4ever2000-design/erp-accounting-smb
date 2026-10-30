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
const VERSION = '2611550a3526'
const PRECACHE = ["./apple-touch-icon.png","./assets/Advances-ycGF4C1N.js","./assets/Analytics-BShf6SWA.js","./assets/Approvals-BGWn2YYc.js","./assets/Attachments-gC9azYlE.js","./assets/Attendance-DvD-cDT0.js","./assets/AuditLog-Db0Ukz-1.js","./assets/BankAccounts-COG4tOrn.js","./assets/Banking-CIYq2yWf.js","./assets/Budgets-iHbzGktt.js","./assets/CapitalAccounts-DPEe2dwi.js","./assets/CashFlow-Bg9pKWxv.js","./assets/CashForecast-C1Gnupix.js","./assets/ChartOfAccounts-DGqtXnes.js","./assets/Cheques-DtUaepGa.js","./assets/Commissions-CNAXu112.js","./assets/Consolidation-l_m8WI0P.js","./assets/Contracts-Dnw05n3d.js","./assets/ConvertModal-DbqwFLla.js","./assets/CreditNotes-dZA759xf.js","./assets/Currencies-BDW6aGQW.js","./assets/CustomFields-VsaygkGk.js","./assets/Customers-C_c2TvtS.js","./assets/DataImport-PvJdIHTI.js","./assets/DebitNotes-DxTfOIdy.js","./assets/DeliveryNotes-BrH1A954.js","./assets/Departments-CXC-93aj.js","./assets/DocumentBrand-BbUwOwHj.js","./assets/EmailDialog-BV9hsELt.js","./assets/EmployeeAdvances-Boa2edhl.js","./assets/Employees-C04XfpyG.js","./assets/ExpenseClaims-6i1IdPly.js","./assets/FinancialHealth-DJsZGmo5.js","./assets/FixedAssetForm-Dun3IrEf.js","./assets/FixedAssets-DBncXRza.js","./assets/GosiFields-DvAeR_rw.js","./assets/Inventory-C42KQoCD.js","./assets/InventoryControl-B9_cTa_l.js","./assets/InvoiceForm-CDddNiMw.js","./assets/InvoiceView-LiTxPdFO.js","./assets/Invoices-C07EwH0x.js","./assets/JournalEntries-DQeTkXLc.js","./assets/Labels-C-iy9UQT.js","./assets/LandedCosts-Dq8vNUDD.js","./assets/Leases-jKB5NsaJ.js","./assets/Manufacturing-BBjysKrB.js","./assets/OpeningBalances-AWNwxmyc.js","./assets/POS-CAwFWO3s.js","./assets/PaymentReminders-eVV1g_jA.js","./assets/Payroll-iYzPm663.js","./assets/PeriodClose-BTt0aQa0.js","./assets/Pipeline-C5N1ZbFc.js","./assets/Portal-CLI_TJ4u.js","./assets/PrepaidExpenses-CEURqLIX.js","./assets/Projects-B2hPK_9g.js","./assets/PurchaseForm-dDsyUrkb.js","./assets/PurchaseOrderForm-DLlJ2pjc.js","./assets/PurchaseOrders-B6fNbYJF.js","./assets/PurchaseQuotes-DoEosWDa.js","./assets/PurchaseView-Ddn2UTI_.js","./assets/Purchases-83AYISFq.js","./assets/QuotationForm-Ciw9fS1B.js","./assets/Quotations-BFORsiRn.js","./assets/Reconciliation-CDEBml0y.js","./assets/RecurringExpenses-AFQGTMYA.js","./assets/RecurringInvoices-VUUi_U29.js","./assets/RecurringJournals-BuIoaraa.js","./assets/RecycleBin-BzP8lFaA.js","./assets/Reports-B2FFYSuf.js","./assets/Requisitions-ZkmRXm2-.js","./assets/Revaluation-xu8fWHfs.js","./assets/SalesOrders-BKsE4FgW.js","./assets/Settings-CymdHP_I.js","./assets/Statements-C3da8myx.js","./assets/StockAdjustments-BtnRGSu2.js","./assets/StockCounts-D261clqI.js","./assets/Suppliers-D8EZXxeC.js","./assets/Team-2nA-ArPL.js","./assets/TradeAnalytics-CNEW_-Bq.js","./assets/TrendChart-C0g_ZbKZ.js","./assets/Warehouses-F0t2sr8e.js","./assets/YearEndClose-DMblB-ZQ.js","./assets/ar-DOysIPdI.js","./assets/arrow-up-right-BCz1iSFe.js","./assets/ban-C8VSxcxF.js","./assets/brandAssets-CR8hWsup.js","./assets/chevron-left-ByiC9hxo.js","./assets/circle-B-Mg1EcY.js","./assets/circle-check-big-DvefBfGv.js","./assets/circle-minus-IPB_HBgU.js","./assets/circle-x-BnDdJvTT.js","./assets/cloudAuth-BPJd_Doe.js","./assets/cloudSync-Cmo8Pem1.js","./assets/copy-S4GsRMWa.js","./assets/credit-card-D6L0xgzn.js","./assets/crown-RaFP31qy.js","./assets/eye-C5OH_wpJ.js","./assets/image-plus-BoKwCHKw.js","./assets/index-B9GuVGMJ.css","./assets/index-DIKNnnIA.js","./assets/index-DPUNTCd1.js","./assets/info-CTX5ZZeu.js","./assets/integrityCheck-C5NdvJnA.js","./assets/itemImages-krm9Xsja.js","./assets/labels-C65KB4b5.js","./assets/link-2-mJZLRC2E.js","./assets/list-ordered-BsIMUVk5.js","./assets/lock-open-BsWVkrF6.js","./assets/node.browser-B3qX7Kx8.js","./assets/node.browser-CqK4LwVH.js","./assets/onlinePayments-BzjJ4Rzo.js","./assets/package-check-28Z24YrW.js","./assets/pause-CPr4cmfg.js","./assets/pen-line-BMtQbVM8.js","./assets/periodLock-Cw1W1b4J.js","./assets/play-DhhjCcrc.js","./assets/printer-D1jApCGp.js","./assets/rotate-ccw-DQMZxrS2.js","./assets/save-vZN6r616.js","./assets/scale-CdjXp4Fw.js","./assets/scan-line-B_3H6VhK.js","./assets/supabase-B5bbNdca.js","./assets/undo-2-Dfpd78gH.js","./assets/upload--XclOBfB.js","./assets/vat-CgYEi_to.js","./assets/vendor-charts-B3pk74kr.js","./assets/vendor-react-BYP1vJ79.js","./assets/vendor-utils-CZfQX67X.js","./fonts/fonts.css","./fonts/ibm-plex-sans-arabic-400-arabic.woff2","./fonts/ibm-plex-sans-arabic-400-latin.woff2","./fonts/ibm-plex-sans-arabic-500-arabic.woff2","./fonts/ibm-plex-sans-arabic-500-latin.woff2","./fonts/ibm-plex-sans-arabic-600-arabic.woff2","./fonts/ibm-plex-sans-arabic-600-latin.woff2","./fonts/ibm-plex-sans-arabic-700-arabic.woff2","./fonts/ibm-plex-sans-arabic-700-latin.woff2","./fonts/inter-latin.woff2","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./manifest.webmanifest"]
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
