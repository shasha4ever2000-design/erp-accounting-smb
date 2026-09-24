// Items, stock movements, counts, warehouses and manufacturing.
// One slice of the store — see src/store.js for how the slices combine.
import { v4 as uuid } from 'uuid'
import { allocateLandedCost } from '../utils/landedCost'
import { validateKit } from '../utils/kits'
import { issueFrom, receiveInto, layersFromBalance } from '../utils/fifo'
import { COUNT_STATUS, buildSheet as buildCountSheet, validateCount, postingLines as countPostingLines, stockChanges as countStockChanges, summarise as summariseCount } from '../utils/stockCount'
import { nextBatch as nextCycleBatch } from '../utils/cycleCount'
import { todayISO } from '../utils/localDate'
import { DEFAULT_WAREHOUSES, nextNum, keepEntries } from './shared'

export const createInventorySlice = (set, get) => ({
  // ─── INVENTORY ITEMS ───────────────────────────────────────────
  inventoryItems: [],

  addInventoryItem: (item) => {
    const id = uuid()
    if (item?.isKit) {
      const check = validateKit(id, item.components || [], get().inventoryItems)
      if (!check.ok) throw new Error(`KIT_INVALID:${check.errors.join(' ')}`)
    }
    set((s) => ({ inventoryItems: [...s.inventoryItems, { ...item, id }] }))
    return { id }
  },

  updateInventoryItem: (id, patch) => {
    const before = get().inventoryItems.find((i) => i.id === id)
    // A kit that contains itself would recurse for ever the next time
    // something is sold, so the cycle is refused at save time rather than
    // relied on being caught during a posting.
    const merged = { ...(before || {}), ...patch }
    if (merged.isKit) {
      const check = validateKit(id, merged.components || [], get().inventoryItems)
      if (!check.ok) throw new Error(`KIT_INVALID:${check.errors.join(' ')}`)
    }
    set((s) => ({ inventoryItems: s.inventoryItems.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))
    // Cost/quantity move constantly through normal trading; only log the
    // master-data edits a human actually made.
    get().logChange('Updated item', before, get().inventoryItems.find((i) => i.id === id), { entity: 'item', ignore: ['quantity', 'costPrice'] })
  },

  deleteInventoryItem: (id) => {
    get().recycleRecord('inventoryItems', id)
    const gone = get().inventoryItems.find((i) => i.id === id)
    set((s) => ({ inventoryItems: s.inventoryItems.filter((i) => i.id !== id) }))
    if (gone) get().logActivity('Deleted item', `${gone.code || ''} ${gone.name || ''}`.trim(), { entity: 'item', entityId: id, entityRef: gone.code || gone.name })
  },

  // ─── CYCLE COUNTING ────────────────────────────────────────────
  /** Which items are due a count, and how much they are worth. */
  cycleCountBatch: (opts = {}) => {
    const state = get()
    const cfg = state.settings.cycleCount || {}
    return nextCycleBatch(state.inventoryItems, state.stockCounts || [], {
      policy: cfg.policy, limit: opts.limit ?? cfg.batchSize ?? 20, asAt: opts.asAt,
    })
  },

  /** Start a stock count containing only the items that are due. */
  startCycleCount: ({ date, warehouseId = '', limit } = {}) => {
    const batch = get().cycleCountBatch({ limit, asAt: date })
    if (!batch.itemIds.length) throw new Error('CYCLE_NOTHING_DUE')
    return get().startStockCount({
      date, warehouseId, itemIds: batch.itemIds,
      notes: `Cycle count — ${batch.itemIds.length} item(s) due`,
    })
  },

  // ─── STOCK COUNTS ──────────────────────────────────────────────
  // Making the books agree with the shelves. See utils/stockCount.js —
  // nearly all the care in this feature is about what posting must refuse
  // to touch, above all that an uncounted line is never treated as a zero.
  stockCounts: [],

  startStockCount: ({ date, warehouseId = '', itemIds = null, notes = '' } = {}) => {
    const s = get()
    const { prefix, next } = s.settings.stockCount
    const number = nextNum(prefix, next)
    const lines = buildCountSheet(s.inventoryItems, { warehouseId, itemIds })
    if (!lines.length) throw new Error('COUNT_NO_ITEMS')
    const count = {
      id: uuid(), number,
      date: date || todayISO(),
      warehouseId, notes,
      status: COUNT_STATUS.open,
      lines,
      startedAt: new Date().toISOString(),
      startedBy: get().currentUser?.()?.name || '',
      journalEntryId: null,
    }
    set((st) => ({
      stockCounts: [...st.stockCounts, count],
      settings: { ...st.settings, stockCount: { ...st.settings.stockCount, next: next + 1 } },
    }))
    get().logActivity('Started stock count', `${number} · ${lines.length} line(s)`, { entity: 'stockCount', entityId: count.id, entityRef: number })
    return count
  },

  updateStockCount: (id, patch) =>
    set((s) => ({
      stockCounts: s.stockCounts.map((c) => {
        if (c.id !== id) return c
        // A posted count is history — its lines are what the adjustment was
        // based on, so they must not drift afterwards.
        if (c.status === COUNT_STATUS.posted) return c
        return { ...c, ...patch }
      }),
    })),

  deleteStockCount: (id) => {
    const c = get().stockCounts.find((x) => x.id === id)
    if (c?.status === COUNT_STATUS.posted) throw new Error('COUNT_POSTED')
    get().recycleRecord('stockCounts', id)
    return set((s) => ({ stockCounts: s.stockCounts.filter((x) => x.id !== id) }))
  },

  /**
   * Post the count: adjust stock to what was found, and book the value
   * difference. Only counted lines that actually differ are touched.
   */
  postStockCount: (id) => {
    const st = get()
    const count = st.stockCounts.find((c) => c.id === id)
    const check = validateCount(count, { lockDate: st.settings?.accounting?.lockDate })
    if (!check.ok) throw new Error(`COUNT_INVALID:${check.errors.join(' ')}`)

    const lines = countPostingLines(count, st.inventoryItems)
    const changes = countStockChanges(count)
    const summary = summariseCount(count.lines || [])

    let je = null
    if (lines.length) {
      je = get().addJournalEntry({
        date: count.date,
        description: `Stock count ${count.number}`,
        reference: count.number,
        type: 'stock_count',
        lines,
      })
    }

    const wh = count.warehouseId
    set((s) => ({
      inventoryItems: s.inventoryItems.map((it) => {
        if (!(it.id in changes)) return it
        const target = changes[it.id]
        const patch = { quantity: target }
        if (wh && it.stockByWarehouse) {
          const map = { ...it.stockByWarehouse }
          const before = Number(map[wh]) || 0
          map[wh] = target
          // Counting one warehouse says nothing about the others, so the
          // total moves by this warehouse's delta rather than being
          // replaced by its count.
          patch.quantity = Math.round(((Number(it.quantity) || 0) + (target - before)) * 1e6) / 1e6
          patch.stockByWarehouse = map
        }
        return { ...it, ...patch }
      }),
      stockCounts: s.stockCounts.map((c) => (c.id === id
        ? { ...c, status: COUNT_STATUS.posted, postedAt: new Date().toISOString(), journalEntryId: je?.id || null, summary }
        : c)),
    }))

    get().logActivity(
      'Posted stock count',
      `${count.number} · ${summary.gains} up, ${summary.losses} down`,
      { entity: 'stockCount', entityId: id, entityRef: count.number, severity: summary.netValue === 0 ? 'info' : 'warning' }
    )
    return { journalEntryId: je?.id || null, summary, adjusted: Object.keys(changes).length }
  },

  // ─── STOCK ADJUSTMENTS ─────────────────────────────────────────
  stockAdjustments: [],

  // ─── STOCK MOVEMENT LEDGER ─────────────────────────────────────
  // Append-only audit trail of every on-hand quantity change, powering
  // per-item stock cards. type: 'sale'|'adjustment'|'production'|'consumption'.
  stockMovements: [],
  logStockMovement: (mv) =>
    set((s) => ({ stockMovements: [...s.stockMovements, { id: uuid(), createdAt: new Date().toISOString(), ...mv }] })),

  // ── Landed cost ────────────────────────────────────────────────
  // Capitalise extra acquisition costs (freight, duty, insurance, handling)
  // into inventory value. Additive: bumps each item's weighted-average cost
  // and posts a balanced JE (Dr Inventory / Cr the funding account, e.g. AP).
  landedCosts: [],
  postLandedCost: ({ date, reference, note, method = 'value', amount, creditAccountId = 'acc-ap', lines }) => {
    const total = Math.round((Number(amount) || 0) * 100) / 100
    if (total <= 0) throw new Error('LANDED_NO_AMOUNT')
    const items = get().inventoryItems
    const enriched = (lines || [])
      .filter((l) => l.itemId && (parseFloat(l.qty) || 0) > 0)
      .map((l) => {
        const it = items.find((i) => i.id === l.itemId)
        return { itemId: l.itemId, name: it?.name || '', qty: parseFloat(l.qty) || 0, unitCost: it?.costPrice || 0, weight: parseFloat(l.weight) || 0 }
      })
    if (enriched.length === 0) throw new Error('LANDED_NO_LINES')

    const alloc = allocateLandedCost(total, enriched, method) // [{ itemId, allocated }]
    const allocMap = Object.fromEntries(alloc.map((a) => [a.itemId, a.allocated]))

    // Debit each item's own inventory account for its share.
    const drMap = {}
    enriched.forEach((e) => {
      const it = items.find((i) => i.id === e.itemId)
      const acc = it?.inventoryAccountId || 'acc-inv'
      drMap[acc] = Math.round(((drMap[acc] || 0) + (allocMap[e.itemId] || 0)) * 100) / 100
    })
    const jeLines = [
      ...Object.entries(drMap).map(([accountId, amt]) => ({ accountId, debit: amt, credit: 0, description: 'Landed cost capitalised' })),
      { accountId: creditAccountId, debit: 0, credit: total, description: `Landed cost ${reference || ''}`.trim() },
    ]
    const je = get().addJournalEntry({
      date, description: `Landed cost ${reference || ''}`.trim() || 'Landed cost', reference: reference || '', type: 'landed-cost', lines: jeLines,
    })

    // Bump weighted-average unit cost: spread each item's share over its on-hand
    // quantity, so total inventory value rises by exactly the allocated amount.
    set((st) => ({
      inventoryItems: st.inventoryItems.map((it) => {
        const share = allocMap[it.id]
        if (!share) return it
        const q = it.quantity || 0
        if (q <= 0) return it
        const newCost = Math.round(((it.costPrice || 0) + share / q) * 10000) / 10000
        // The FIFO layers carry the cost too. Under FIFO the carried cost
        // is re-derived from the layers on the next sale, so bumping only
        // costPrice let the landed cost vanish from cost of sales while
        // it stayed in the inventory account.
        const layers = it.costLayers || layersFromBalance(q, it.costPrice)
        const perUnit = share / q
        const costLayers = layers.map((l) => ({ ...l, unitCost: Math.round(((Number(l.unitCost) || 0) + perUnit) * 10000) / 10000 }))
        return { ...it, costPrice: newCost, costLayers }
      }),
    }))

    const rec = {
      id: uuid(), date, reference: reference || '', note: note || '', method, amount: total,
      creditAccountId, journalEntryId: je.id,
      lines: enriched.map((e) => ({ itemId: e.itemId, name: e.name, qty: e.qty, allocated: allocMap[e.itemId] || 0 })),
      createdAt: new Date().toISOString(),
    }
    set((st) => ({ landedCosts: [...st.landedCosts, rec] }))
    enriched.forEach((e) => get().logStockMovement({ itemId: e.itemId, itemName: e.name, date, type: 'landed-cost', qtyChange: 0, ref: reference || 'LC', note: `Landed cost +${allocMap[e.itemId] || 0}` }))
    get().logActivity('Posted landed cost', `${reference || ''} · ${total}`.trim())
    return rec
  },

  // Segregation of duties: an adjustment is created as PENDING — it does not
  // touch the ledger or on-hand quantity until a *different* manager approves it.
  addStockAdjustment: (adj) => {
    const s = get()
    const { prefix, next } = s.settings.stockAdj
    const number = nextNum(prefix, next)
    const rec = {
      ...adj, id: uuid(), number, status: 'pending',
      createdBy: adj.createdBy || null, createdByName: adj.createdByName || '',
      approvedBy: null, approvedByName: '', approvedAt: null, journalEntryId: null,
      createdAt: new Date().toISOString(),
    }
    set((st) => ({
      stockAdjustments: [...st.stockAdjustments, rec],
      settings: { ...st.settings, stockAdj: { ...st.settings.stockAdj, next: next + 1 } },
    }))
    return rec
  },

  approveStockAdjustment: (id, approver) => {
    const adj = get().stockAdjustments.find((a) => a.id === id)
    if (!adj || adj.status === 'approved') return
    const invAccId = adj.inventoryAccountId || 'acc-inv'
    const lines = adj.type === 'increase'
      ? [
          { accountId: invAccId,      debit: adj.totalAmount, credit: 0,              description: adj.reason || 'Stock increase' },
          { accountId: 'acc-invadj',  debit: 0,               credit: adj.totalAmount, description: adj.reason || 'Stock increase' },
        ]
      : [
          { accountId: 'acc-invadj',  debit: adj.totalAmount, credit: 0,              description: adj.reason || 'Stock decrease' },
          { accountId: invAccId,      debit: 0,               credit: adj.totalAmount, description: adj.reason || 'Stock decrease' },
        ]
    const je = get().addJournalEntry({
      date: adj.date,
      description: `Stock Adj ${adj.number} – ${adj.itemName || ''}`,
      reference: adj.number, type: 'stock_adj', lines,
    })
    const qtyChange = adj.type === 'increase' ? adj.quantity : -adj.quantity
    get().logStockMovement({ itemId: adj.itemId, itemName: adj.itemName, date: adj.date, type: 'adjustment', qtyChange, ref: adj.number, note: adj.reason || '' })
    set((st) => ({
      stockAdjustments: st.stockAdjustments.map((a) =>
        a.id === id ? { ...a, status: 'approved', approvedBy: approver?.id || null, approvedByName: approver?.name || '', approvedAt: new Date().toISOString(), journalEntryId: je.id } : a
      ),
      inventoryItems: st.inventoryItems.map((i) =>
        i.id === adj.itemId ? { ...i, quantity: (i.quantity || 0) + qtyChange } : i
      ),
    }))
  },

  rejectStockAdjustment: (id, approver, reason) =>
    set((s) => ({
      stockAdjustments: s.stockAdjustments.map((a) =>
        a.id === id ? { ...a, status: 'rejected', approvedBy: approver?.id || null, approvedByName: approver?.name || '', approvedAt: new Date().toISOString(), rejectionReason: reason || '' } : a
      ),
    })),

  deleteStockAdjustment: (id) =>
    set((s) => {
      const adj = s.stockAdjustments.find((a) => a.id === id)
      get().assertJEsUnlocked(adj?.journalEntryId)
      // Only reverse quantity/JE if the adjustment was actually posted (approved or legacy).
      const wasPosted = adj && (adj.status === 'approved' || adj.status === undefined)
      const qtyChange = wasPosted ? (adj.type === 'increase' ? -adj.quantity : adj.quantity) : 0
      return {
        stockAdjustments: s.stockAdjustments.filter((a) => a.id !== id),
        journalEntries: keepEntries(s.journalEntries, (j) => j.id !== adj?.journalEntryId),
        stockMovements: s.stockMovements.filter((m) => m.ref !== adj?.number),
        inventoryItems: s.inventoryItems.map((i) =>
          i.id === adj?.itemId ? { ...i, quantity: (i.quantity || 0) + qtyChange } : i
        ),
      }
    }),

  // ─── BILLS OF MATERIALS ────────────────────────────────────────
  billsOfMaterials: [],

  addBOM: (bom) =>
    set((s) => ({ billsOfMaterials: [...s.billsOfMaterials, { ...bom, id: uuid(), createdAt: new Date().toISOString() }] })),

  updateBOM: (id, patch) =>
    set((s) => ({ billsOfMaterials: s.billsOfMaterials.map((b) => (b.id === id ? { ...b, ...patch } : b)) })),

  deleteBOM: (id) => {
    get().recycleRecord('billsOfMaterials', id)
    return set((s) => ({ billsOfMaterials: s.billsOfMaterials.filter((b) => b.id !== id) }))
  },

  // ─── WORK ORDERS ───────────────────────────────────────────────
  workOrders: [],

  addWorkOrder: (wo) => {
    const s = get()
    const { prefix, next } = s.settings.workOrder
    const number = nextNum(prefix, next)
    const newWO = { ...wo, id: uuid(), number, status: 'draft', createdAt: new Date().toISOString() }
    set((st) => ({
      workOrders: [...st.workOrders, newWO],
      settings: { ...st.settings, workOrder: { ...st.settings.workOrder, next: next + 1 } },
    }))
    return newWO
  },

  startWorkOrder: (id) =>
    set((s) => ({
      workOrders: s.workOrders.map((w) => w.id === id ? { ...w, status: 'in_progress', startedAt: new Date().toISOString() } : w),
    })),

  /**
   * Build the order: issue the materials, and put the finished goods on the
   * shelf at what they actually cost to make.
   *
   * A work order is an issue plus a receipt, so it goes through the same
   * machinery as a sale and a purchase rather than its own arithmetic. That
   * matters in three ways it used to get wrong:
   *
   *   · A tracked component is relieved at the cost it is actually carried
   *     at (weighted-average or FIFO, per the costing setting), not at the
   *     unit cost typed on the order when it was raised. A standard cost
   *     that has since drifted used to leave the Inventory account and the
   *     stock ledger permanently disagreeing by the difference.
   *   · It relieves the account the stock is carried in — the item's own
   *     inventory account. Crediting a fixed "Raw Materials" account for
   *     stock held in Inventory used to drive Raw Materials negative on the
   *     balance sheet while Inventory kept value for goods long consumed.
   *   · Cost layers move with the quantity, so FIFO stays honest: components
   *     no longer leave phantom layers behind, and a finished good is
   *     received with layers of its own instead of none.
   *
   * Components with no stock item (labour, an untracked consumable) keep
   * their typed cost and their own material account — there is no shelf to
   * price them from, and the credit is the only record of them.
   */
  completeWorkOrder: (id, completionDate) => {
    const wo = get().workOrders.find((w) => w.id === id)
    if (!wo || wo.status === 'completed') return
    const qty = wo.targetQuantity || 1
    const compDate = completionDate || todayISO()
    const method = get().costingMethod()
    const items = get().inventoryItems

    // What the build consumes, per stock item.
    const consume = {}
    ;(wo.components || []).forEach((comp) => {
      if (!comp.itemId) return
      const used = (comp.quantity || 0) * qty
      if (used > 0) consume[comp.itemId] = (consume[comp.itemId] || 0) + used
    })

    // Price the tracked components off the shelf, and the untracked ones at
    // the cost typed on the order.
    const creditByAcc = {}
    const costPatch = {}          // itemId -> { costLayers, costPrice }
    let totalMaterialCost = 0
    Object.entries(consume).forEach(([itemId, used]) => {
      const it = items.find((i) => i.id === itemId)
      if (!it) return
      const priced = issueFrom(
        { ...it, costLayers: it.costLayers || layersFromBalance(it.quantity, it.costPrice) },
        { qty: used, method }
      )
      costPatch[itemId] = priced.patch
      totalMaterialCost += priced.cost
      // 'acc-inv' is where every other path puts stock that carries no
      // account of its own, so it is where this one must take it from.
      const acc = it.inventoryAccountId || 'acc-inv'
      creditByAcc[acc] = (creditByAcc[acc] || 0) + priced.cost
    })
    ;(wo.components || []).forEach((comp) => {
      if (comp.itemId) return
      const lineAmt = (comp.unitCost || 0) * (comp.quantity || 0) * qty
      if (lineAmt <= 0) return
      totalMaterialCost += lineAmt
      const acc = comp.materialAccountId || 'acc-rawmat'
      creditByAcc[acc] = (creditByAcc[acc] || 0) + lineAmt
    })
    totalMaterialCost = Math.round(totalMaterialCost * 100) / 100

    const wipAccId = wo.wipAccountId || 'acc-wip'
    const outItem = items.find((i) => i.id === wo.outputItemId)
    // The finished good lands where its own stock is valued. The order's
    // chosen account only stands in when the output is not a stock item.
    const finGoodsAccId = outItem
      ? (outItem.inventoryAccountId || 'acc-inv')
      : (wo.finGoodsAccountId || 'acc-fingoods')

    const je1 = get().addJournalEntry({
      date: compDate,
      description: `Work Order ${wo.number} – Issue Materials`,
      reference: wo.number, type: 'work_order_issue',
      lines: [
        { accountId: wipAccId, debit: totalMaterialCost, credit: 0, description: `WO ${wo.number} – Materials to WIP` },
        ...Object.entries(creditByAcc).map(([accountId, amt]) =>
          ({ accountId, debit: 0, credit: Math.round(amt * 100) / 100, description: `WO ${wo.number} – Materials issued` })),
      ],
    })
    const je2 = get().addJournalEntry({
      date: compDate,
      description: `Work Order ${wo.number} – Finished Goods`,
      reference: wo.number, type: 'work_order_complete',
      lines: [
        { accountId: finGoodsAccId, debit: totalMaterialCost, credit: 0, description: `Finished: ${wo.outputName}` },
        { accountId: wipAccId, debit: 0, credit: totalMaterialCost, description: `Finished: ${wo.outputName}` },
      ],
    })

    const outputQty = (wo.outputQuantity || 1) * qty
    Object.entries(consume).forEach(([itemId, used]) => {
      const it = items.find((i) => i.id === itemId)
      get().logStockMovement({ itemId, itemName: it?.name || '', date: compDate, type: 'consumption', qtyChange: -used, ref: wo.number, note: 'Work order material' })
    })
    get().logStockMovement({ itemId: wo.outputItemId, itemName: wo.outputName, date: compDate, type: 'production', qtyChange: outputQty, ref: wo.number, note: 'Work order output' })

    set((st) => ({
      workOrders: st.workOrders.map((w) =>
        w.id === id ? { ...w, status: 'completed', completedAt: new Date().toISOString(), actualCost: totalMaterialCost, jeIssueId: je1.id, jeCompleteId: je2.id, completionDate } : w
      ),
      inventoryItems: st.inventoryItems.map((item) => {
        if (!consume[item.id] && item.id !== wo.outputItemId) return item
        let patch = { quantity: item.quantity || 0 }
        if (consume[item.id]) {
          patch.quantity -= consume[item.id]
          patch = { ...patch, ...(costPatch[item.id] || {}) }
        }
        if (item.id === wo.outputItemId) {
          // Received like any other receipt, so the finished good carries
          // layers of its own and a blended cost that reflects what it took
          // to make — which is what its COGS will be when it sells.
          const oldQty = patch.quantity
          const newQty = oldQty + outputQty
          const wacCost = newQty > 0
            ? Math.round(((oldQty * (item.costPrice || 0) + totalMaterialCost) / newQty) * 100) / 100
            : (item.costPrice || 0)
          const seeded = { ...item, ...patch, costLayers: patch.costLayers || item.costLayers || layersFromBalance(oldQty, item.costPrice) }
          patch = {
            ...patch,
            quantity: newQty,
            ...receiveInto(seeded, { qty: outputQty, value: totalMaterialCost, date: compDate, ref: wo.number, method, wacCost }),
          }
        }
        return { ...item, ...patch }
      }),
    }))
  },

  deleteWorkOrder: (id) =>
    set((s) => {
      const wo = s.workOrders.find((w) => w.id === id)
      get().assertJEsUnlocked(wo?.jeIssueId, wo?.jeCompleteId)
      return {
        workOrders: s.workOrders.filter((w) => w.id !== id),
        journalEntries: keepEntries(s.journalEntries, 
          (j) => j.id !== wo?.jeIssueId && j.id !== wo?.jeCompleteId
        ),
      }
    }),

  // ─── WAREHOUSES & STOCK TRANSFERS ──────────────────────────────
  warehouses: DEFAULT_WAREHOUSES,
  stockTransfers: [],

  addWarehouse: (wh) =>
    set((s) => ({ warehouses: [...s.warehouses, { ...wh, id: uuid(), isDefault: false }] })),

  updateWarehouse: (id, patch) =>
    set((s) => ({ warehouses: s.warehouses.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),

  deleteWarehouse: (id) => {
    get().recycleRecord('warehouses', id)
    return set((s) => {
      const wh = s.warehouses.find((w) => w.id === id)
      if (wh?.isDefault) return s
      return { warehouses: s.warehouses.filter((w) => w.id !== id) }
    })
  },

  // returns stock of an item in a warehouse (lazily defaults all stock to the default warehouse)
  getItemStock: (item, warehouseId) => {
    if (!item) return 0
    const defWh = get().warehouses.find((w) => w.isDefault)?.id || 'wh-main'
    const map = item.stockByWarehouse
    if (!map) return warehouseId === defWh ? (item.quantity || 0) : 0
    return map[warehouseId] || 0
  },

  addStockTransfer: ({ itemId, fromWarehouseId, toWarehouseId, quantity, date, notes }) => {
    const qty = Number(quantity) || 0
    if (qty <= 0 || fromWarehouseId === toWarehouseId) return
    set((s) => {
      const defWh = s.warehouses.find((w) => w.isDefault)?.id || 'wh-main'
      return {
        inventoryItems: s.inventoryItems.map((it) => {
          if (it.id !== itemId) return it
          const map = it.stockByWarehouse ? { ...it.stockByWarehouse } : { [defWh]: it.quantity || 0 }
          map[fromWarehouseId] = (map[fromWarehouseId] || 0) - qty
          map[toWarehouseId]   = (map[toWarehouseId]   || 0) + qty
          return { ...it, stockByWarehouse: map }
        }),
        stockTransfers: [...s.stockTransfers, { id: uuid(), itemId, fromWarehouseId, toWarehouseId, quantity: qty, date, notes: notes || '', createdAt: new Date().toISOString() }],
      }
    })
  },

  deleteStockTransfer: (id) =>
    set((s) => {
      const tr = s.stockTransfers.find((t) => t.id === id)
      if (!tr) return s
      return {
        stockTransfers: s.stockTransfers.filter((t) => t.id !== id),
        inventoryItems: s.inventoryItems.map((it) => {
          if (it.id !== tr.itemId || !it.stockByWarehouse) return it
          const map = { ...it.stockByWarehouse }
          map[tr.fromWarehouseId] = (map[tr.fromWarehouseId] || 0) + tr.quantity
          map[tr.toWarehouseId]   = (map[tr.toWarehouseId]   || 0) - tr.quantity
          return { ...it, stockByWarehouse: map }
        }),
      }
    }),
})
