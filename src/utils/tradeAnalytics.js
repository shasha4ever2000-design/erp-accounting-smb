// Order-to-cash and procure-to-pay analytics, derived from the sales/purchase
// documents built across Phases 1–4. Pure functions over plain arrays, so the
// whole thing is unit-testable and never touches the store.
import { poMatch } from './fulfillment'
import { totalReceivable, totalPayable } from './partyBalance'

const sum = (arr, fn) => Math.round(arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0) * 100) / 100
const active = (docs) => (docs || []).filter((d) => d.status !== 'void' && d.status !== 'cancelled')
const lineGross = (l) => (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)
const monthKey = (d) => (d || '').slice(0, 7)

export function salesAnalytics(invoices = [], creditNotes = []) {
  const inv = active(invoices)
  const grossSales = sum(inv, (i) => i.total)
  const returns = sum(active(creditNotes), (c) => c.total)
  const netSales = Math.round((grossSales - returns) * 100) / 100
  let lineDiscount = 0, docDiscount = 0, shipping = 0
  inv.forEach((i) => {
    ;(i.items || []).forEach((l) => { lineDiscount += Math.max(0, lineGross(l) - (Number(l.subtotal) || 0)) })
    docDiscount += Number(i.docDiscountAmount) || 0
    shipping += Number(i.shipping) || 0
  })
  const count = inv.length
  // Net of credit notes, so this agrees with Accounts Receivable and with
  // every other screen that answers "what is owed?" — see utils/partyBalance.
  const outstanding = totalReceivable({ invoices: inv, creditNotes: active(creditNotes) })

  const byCust = {}
  inv.forEach((i) => { const k = i.customerName || '—'; byCust[k] = (byCust[k] || 0) + (Number(i.total) || 0) })
  const topCustomers = Object.entries(byCust).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value).slice(0, 6)

  const byItem = {}
  inv.forEach((i) => (i.items || []).forEach((l) => {
    const k = l.description || l.itemId; if (!k) return
    byItem[k] = byItem[k] || { name: k, qty: 0, revenue: 0 }
    byItem[k].qty += Number(l.quantity) || 0
    byItem[k].revenue += Number(l.subtotal) || 0
  }))
  const topProducts = Object.values(byItem).map((p) => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 })).sort((a, b) => b.revenue - a.revenue).slice(0, 6)

  return {
    grossSales, returns, netSales,
    lineDiscount: Math.round(lineDiscount * 100) / 100,
    docDiscount: Math.round(docDiscount * 100) / 100,
    totalDiscount: Math.round((lineDiscount + docDiscount) * 100) / 100,
    shipping: Math.round(shipping * 100) / 100,
    count, avgInvoice: count ? Math.round((grossSales / count) * 100) / 100 : 0,
    outstanding, topCustomers, topProducts,
  }
}

export function quotationStats(quotations = []) {
  const total = quotations.length
  const won = quotations.filter((q) => q.status === 'invoiced' || q.status === 'partial')
  const openQ = quotations.filter((q) => q.status === 'sent' || q.status === 'accepted')
  return {
    total, converted: won.length,
    conversionRate: total ? Math.round((won.length / total) * 1000) / 10 : 0,
    quotedValue: sum(quotations, (q) => q.total),
    openValue: sum(openQ, (q) => q.total),
  }
}

export function purchaseAnalytics(purchases = [], debitNotes = []) {
  const pur = active(purchases)
  const grossPurchases = sum(pur, (p) => p.total)
  const returns = sum(active(debitNotes), (d) => d.total)
  let discount = 0, freight = 0
  pur.forEach((p) => {
    ;(p.items || []).forEach((l) => { discount += Math.max(0, lineGross(l) - (Number(l.subtotal) || 0)) })
    discount += Number(p.docDiscountAmount) || 0
    freight += Number(p.shipping) || 0
  })
  // Net of debit notes, to agree with Accounts Payable.
  const payable = totalPayable({ purchases: pur, debitNotes: active(debitNotes) })
  const bySupp = {}
  pur.forEach((p) => { const k = p.supplierName || '—'; bySupp[k] = (bySupp[k] || 0) + (Number(p.total) || 0) })
  const topSuppliers = Object.entries(bySupp).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value).slice(0, 6)
  return {
    grossPurchases, returns, netPurchases: Math.round((grossPurchases - returns) * 100) / 100,
    discount: Math.round(discount * 100) / 100, freight: Math.round(freight * 100) / 100,
    payable, topSuppliers,
  }
}

export function poStats(purchaseOrders = []) {
  const open = purchaseOrders.filter((p) => p.status !== 'invoiced' && p.status !== 'cancelled' && p.status !== 'void')
  let variance = 0, awaitingReceipt = 0, awaitingBill = 0
  purchaseOrders.forEach((p) => {
    const m = poMatch(p)
    if (m.variance) variance += 1
    m.lines.forEach((l) => { awaitingReceipt += l.awaitingReceipt; awaitingBill += l.awaitingBill })
  })
  return { openCount: open.length, openValue: sum(open, (p) => p.total), variance, awaitingReceipt: Math.round(awaitingReceipt * 100) / 100, awaitingBill: Math.round(awaitingBill * 100) / 100 }
}

// Monthly sales vs purchases for the last `months` calendar months (oldest→newest).
export function monthlyTrend(invoices = [], purchases = [], months = 12) {
  const now = new Date()
  const keys = []
  for (let i = months - 1; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); keys.push(d.toISOString().slice(0, 7)) }
  const salesBy = {}, purBy = {}
  active(invoices).forEach((i) => { const k = monthKey(i.date); salesBy[k] = (salesBy[k] || 0) + (Number(i.total) || 0) })
  active(purchases).forEach((p) => { const k = monthKey(p.date); purBy[k] = (purBy[k] || 0) + (Number(p.total) || 0) })
  return keys.map((k) => ({ month: k, sales: Math.round((salesBy[k] || 0) * 100) / 100, purchases: Math.round((purBy[k] || 0) * 100) / 100 }))
}
