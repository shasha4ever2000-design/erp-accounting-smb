// Account groups — a real chart-of-accounts tree.
//
// Until now the chart was flat: every account sat directly under its type, and
// the balance sheet listed thirty-odd lines with a single total at the bottom.
// That is readable for a very small company and useless for anyone else. Every
// serious accounting system groups accounts and subtotals the groups, so a
// reader sees "Current Assets 412,000" before deciding whether to care about
// the eleven accounts inside it.
//
// Two rules carry most of the correctness here, and both exist to stop an
// account silently vanishing from a report:
//
//   1. A group belongs to exactly one account type. A revenue account can
//      never sit in an asset group, because the split between the balance
//      sheet and the P&L is made on type — a mixed group would put the same
//      figure in both statements or in neither.
//
//   2. Anything the tree cannot place still gets shown. An account with no
//      group, a group whose parent was deleted, an account pointing at a group
//      of the wrong type — all of it surfaces under its own type rather than
//      being filtered away. A missing row on a balance sheet is a far worse
//      failure than an untidy one.

export const TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'expense']

/** Marks the group whose total is subtracted from revenue to give gross profit. */
export const COST_OF_SALES = 'cost_of_sales'

/**
 * The structure a new company starts with, and the one existing flat charts
 * are migrated into. Codes are display/sort only — they carry no meaning to
 * the engine.
 */
export const DEFAULT_GROUPS = [
  // Assets
  { id: 'grp-ca',     code: '1000', name: 'Current Assets',           type: 'asset',     parentId: null, sort: 10 },
  { id: 'grp-cash',   code: '1001', name: 'Cash & Cash Equivalents',  type: 'asset',     parentId: 'grp-ca', sort: 10 },
  { id: 'grp-recv',   code: '1100', name: 'Receivables',              type: 'asset',     parentId: 'grp-ca', sort: 20 },
  { id: 'grp-stock',  code: '1400', name: 'Inventory',                type: 'asset',     parentId: 'grp-ca', sort: 30 },
  { id: 'grp-othca',  code: '1500', name: 'Other Current Assets',     type: 'asset',     parentId: 'grp-ca', sort: 40 },
  { id: 'grp-nca',    code: '1600', name: 'Non-Current Assets',       type: 'asset',     parentId: null, sort: 20 },
  { id: 'grp-ppe',    code: '1610', name: 'Property, Plant & Equipment', type: 'asset',  parentId: 'grp-nca', sort: 10 },

  // Liabilities
  { id: 'grp-cl',     code: '2000', name: 'Current Liabilities',      type: 'liability', parentId: null, sort: 10 },
  { id: 'grp-pay',    code: '2001', name: 'Payables',                 type: 'liability', parentId: 'grp-cl', sort: 10 },
  { id: 'grp-taxli',  code: '2100', name: 'Tax & Payroll Liabilities', type: 'liability', parentId: 'grp-cl', sort: 20 },
  { id: 'grp-othcl',  code: '2300', name: 'Other Current Liabilities', type: 'liability', parentId: 'grp-cl', sort: 30 },
  { id: 'grp-ncl',    code: '2400', name: 'Non-Current Liabilities',  type: 'liability', parentId: null, sort: 20 },

  // Equity
  { id: 'grp-eq',     code: '3000', name: 'Equity',                   type: 'equity',    parentId: null, sort: 10 },

  // Revenue
  { id: 'grp-rev',    code: '4000', name: 'Operating Revenue',        type: 'revenue',   parentId: null, sort: 10 },
  { id: 'grp-oi',     code: '4090', name: 'Other Income',             type: 'revenue',   parentId: null, sort: 20 },

  // Expense
  { id: 'grp-cos',    code: '5000', name: 'Cost of Sales',            type: 'expense',   parentId: null, sort: 10, role: COST_OF_SALES },
  { id: 'grp-opex',   code: '5100', name: 'Operating Expenses',       type: 'expense',   parentId: null, sort: 20 },
  { id: 'grp-admin',  code: '5110', name: 'Administrative Expenses',  type: 'expense',   parentId: 'grp-opex', sort: 10 },
  { id: 'grp-people', code: '5120', name: 'Staff Costs',              type: 'expense',   parentId: 'grp-opex', sort: 20 },
  { id: 'grp-fin',    code: '5200', name: 'Finance Costs',            type: 'expense',   parentId: null, sort: 30 },
  { id: 'grp-othexp', code: '5300', name: 'Other Expenses',           type: 'expense',   parentId: null, sort: 40 },
]

/**
 * Where each stock account lands when a flat chart is migrated. Anything not
 * listed falls back to the type/subtype heuristic in `defaultGroupFor`.
 */
export const SEED_ASSIGNMENT = {
  'acc-cash': 'grp-cash', 'acc-bank1': 'grp-cash', 'acc-creditcard': 'grp-othcl',
  'acc-ar': 'grp-recv', 'acc-vatin': 'grp-othca',
  'acc-inv': 'grp-stock', 'acc-rawmat': 'grp-stock', 'acc-wip': 'grp-stock', 'acc-fingoods': 'grp-stock',
  'acc-prepaid': 'grp-othca',
  'acc-fixed': 'grp-ppe', 'acc-depr': 'grp-ppe', 'acc-rou': 'grp-ppe',

  'acc-ap': 'grp-pay', 'acc-grni': 'grp-pay',
  'acc-vatout': 'grp-taxli', 'acc-wht': 'grp-taxli', 'acc-salpay': 'grp-taxli',
  'acc-paye': 'grp-taxli', 'acc-sspay': 'grp-taxli',
  'acc-expclaim': 'grp-othcl', 'acc-accrued': 'grp-othcl',
  'acc-loan': 'grp-ncl', 'acc-leasepay': 'grp-ncl',

  'acc-capital': 'grp-eq', 'acc-retained': 'grp-eq', 'acc-drawings': 'grp-eq', 'acc-obe': 'grp-eq',

  'acc-sales': 'grp-rev', 'acc-svc': 'grp-rev', 'acc-shipinc': 'grp-rev',
  'acc-salesret': 'grp-rev', 'acc-salesdisc': 'grp-rev',
  'acc-otherinc': 'grp-oi', 'acc-gainloss': 'grp-oi', 'acc-fxgl': 'grp-oi', 'acc-fxreal': 'grp-oi',

  'acc-cogs': 'grp-cos', 'acc-freightin': 'grp-cos', 'acc-purchdisc': 'grp-cos',
  'acc-purret': 'grp-cos', 'acc-mfgcost': 'grp-cos', 'acc-invadj': 'grp-cos',
  'acc-salary': 'grp-people', 'acc-gosiemp': 'grp-people',
  'acc-rent': 'grp-admin', 'acc-util': 'grp-admin', 'acc-admin': 'grp-admin',
  'acc-mkt': 'grp-admin', 'acc-bankchg': 'grp-admin', 'acc-misc': 'grp-admin',
  'acc-depexp': 'grp-opex',
  'acc-interest': 'grp-fin',
  'acc-lossdis': 'grp-othexp',
}

/** Fallback landing group for an account the seed map does not name. */
export function defaultGroupFor(account) {
  if (!account) return ''
  const nonCurrent = account.subtype === 'non_current'
  switch (account.type) {
    case 'asset':     return nonCurrent ? 'grp-nca' : 'grp-othca'
    case 'liability': return nonCurrent ? 'grp-ncl' : 'grp-othcl'
    case 'equity':    return 'grp-eq'
    case 'revenue':   return 'grp-rev'
    case 'expense':   return 'grp-opex'
    default:          return ''
  }
}

/** Assign every account a group, leaving any existing assignment alone. */
export function assignDefaultGroups(accounts = []) {
  return accounts.map((a) =>
    a.groupId ? a : { ...a, groupId: SEED_ASSIGNMENT[a.id] || defaultGroupFor(a) }
  )
}

const byOrder = (a, b) =>
  (a.sort ?? 999) - (b.sort ?? 999) ||
  String(a.code || '').localeCompare(String(b.code || '')) ||
  String(a.name || '').localeCompare(String(b.name || ''))

const byCode = (a, b) =>
  String(a.code || '').localeCompare(String(b.code || '')) ||
  String(a.name || '').localeCompare(String(b.name || ''))

export function groupById(groups = []) {
  return Object.fromEntries(groups.map((g) => [g.id, g]))
}

/**
 * True when `candidateId` sits somewhere below `ofId`. Used to refuse a move
 * that would make a group its own ancestor — the tree walk would never
 * terminate.
 */
export function isDescendant(groups, candidateId, ofId) {
  if (!candidateId || !ofId) return false
  const by = groupById(groups)
  const seen = new Set()
  let cur = by[candidateId]
  while (cur && cur.parentId) {
    if (seen.has(cur.id)) return false     // already-broken data: stop, don't hang
    seen.add(cur.id)
    if (cur.parentId === ofId) return true
    cur = by[cur.parentId]
  }
  return false
}

/** 'Current Assets › Cash & Cash Equivalents' for a group, for pickers. */
export function groupPath(groups, id, sep = ' › ') {
  const by = groupById(groups)
  const parts = []
  const seen = new Set()
  let cur = by[id]
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    parts.unshift(cur.name)
    cur = by[cur.parentId]
  }
  return parts.join(sep)
}

/**
 * Groups of one type, flattened depth-first with a depth marker. Feeds the
 * parent picker and the chart page. Orphans (parent missing or of another
 * type) are treated as roots so they stay reachable.
 */
export function flattenGroups(groups = [], type) {
  const ofType = groups.filter((g) => !type || g.type === type)
  const ids = new Set(ofType.map((g) => g.id))
  const out = []
  const walk = (parentId, depth, seen) => {
    ofType
      .filter((g) => (parentId === null ? !g.parentId || !ids.has(g.parentId) : g.parentId === parentId))
      .sort(byOrder)
      .forEach((g) => {
        if (seen.has(g.id)) return
        out.push({ ...g, depth })
        walk(g.id, depth + 1, new Set([...seen, g.id]))
      })
  }
  walk(null, 0, new Set())
  return out
}

/**
 * Build the tree for one account type.
 *
 * Every account of the type comes out exactly once — inside its group when the
 * group exists and matches the type, and in a trailing `ungrouped` list when
 * it does not.
 */
export function buildTree(groups = [], accounts = [], type) {
  const ofType = groups.filter((g) => g.type === type)
  const ids = new Set(ofType.map((g) => g.id))
  const accs = accounts.filter((a) => a.type === type)

  const placed = new Set()
  const accountsIn = (gid) => {
    const rows = accs.filter((a) => a.groupId === gid)
    rows.forEach((a) => placed.add(a.id))
    return rows.slice().sort(byCode)
  }

  const node = (g, seen) => ({
    id: g.id,
    name: g.name,
    code: g.code || '',
    role: g.role || '',
    type: g.type,
    accounts: accountsIn(g.id),
    groups: ofType
      .filter((c) => c.parentId === g.id && !seen.has(c.id))
      .sort(byOrder)
      .map((c) => node(c, new Set([...seen, c.id]))),
  })

  const roots = ofType
    .filter((g) => !g.parentId || !ids.has(g.parentId))
    .sort(byOrder)
    .map((g) => node(g, new Set([g.id])))

  // Whatever the walk did not reach: no group, a deleted group, a group of the
  // wrong type, or a group orphaned by a cycle. All of it still gets shown.
  const ungrouped = accs.filter((a) => !placed.has(a.id)).sort(byCode)

  return { type, groups: roots, ungrouped }
}

/**
 * Decorate a tree with per-account values and rolled-up group totals.
 *
 * `valuesOf(account)` returns an object of numeric keys — `{ balance }`, or
 * `{ balance, prior }` when a comparative column is on. Every key is summed
 * independently, so one walk serves both.
 */
export function withTotals(tree, valuesOf, keys = ['balance']) {
  const sumKeys = (accounts, groups) => {
    const totals = {}
    keys.forEach((k) => {
      totals[k] =
        accounts.reduce((s, a) => s + (Number(a[k]) || 0), 0) +
        groups.reduce((s, g) => s + (Number(g.totals?.[k]) || 0), 0)
    })
    return totals
  }

  const walk = (n) => {
    const accounts = n.accounts.map((a) => ({ ...a, ...valuesOf(a) }))
    const groups = n.groups.map(walk)
    return { ...n, accounts, groups, totals: sumKeys(accounts, groups) }
  }

  const groups = tree.groups.map(walk)
  const ungrouped = tree.ungrouped.map((a) => ({ ...a, ...valuesOf(a) }))
  return { ...tree, groups, ungrouped, totals: sumKeys(ungrouped, groups) }
}

const allZero = (row, keys) => keys.every((k) => !Number(row[k]))

/**
 * Drop accounts and groups that are zero on every key. A group that has run to
 * zero this period but carried a balance last period survives, because that is
 * exactly the movement a comparative exists to show.
 */
export function pruneEmpty(tree, keys = ['balance']) {
  const walk = (n) => {
    const accounts = n.accounts.filter((a) => !allZero(a, keys))
    const groups = n.groups.map(walk).filter((g) => g.accounts.length || g.groups.length || !allZero(g.totals, keys))
    return { ...n, accounts, groups }
  }
  return {
    ...tree,
    groups: tree.groups.map(walk).filter((g) => g.accounts.length || g.groups.length || !allZero(g.totals, keys)),
    ungrouped: tree.ungrouped.filter((a) => !allZero(a, keys)),
  }
}

/**
 * Flatten a decorated tree into render rows.
 *
 * Rendering nested JSX for an arbitrarily deep tree means recursive components
 * and fragile indentation; a flat row list with a `depth` number keeps the
 * report markup simple and the alignment exact.
 *
 * Row kinds: 'group' (header), 'account', 'subtotal' (the group's total),
 * 'ungrouped' (header for the trailing bucket).
 */
export function flattenRows(tree, { showEmptyGroupTotals = false } = {}) {
  const rows = []
  const walk = (n, depth) => {
    const hasContent = n.accounts.length > 0 || n.groups.length > 0
    if (!hasContent && !showEmptyGroupTotals) return
    rows.push({ kind: 'group', id: n.id, name: n.name, code: n.code, role: n.role, depth, totals: n.totals })
    n.accounts.forEach((a) => rows.push({ kind: 'account', id: a.id, account: a, depth: depth + 1 }))
    n.groups.forEach((g) => walk(g, depth + 1))
    // A subtotal under a single flat list of accounts repeats the header value
    // for no gain; it earns its place once the group nests.
    if (n.groups.length > 0 || depth > 0 || n.accounts.length > 1) {
      rows.push({ kind: 'subtotal', id: `${n.id}:total`, name: n.name, depth, totals: n.totals })
    }
  }
  tree.groups.forEach((g) => walk(g, 0))
  if (tree.ungrouped.length) {
    rows.push({ kind: 'ungrouped', id: '__ungrouped', name: 'Ungrouped', depth: 0 })
    tree.ungrouped.forEach((a) => rows.push({ kind: 'account', id: a.id, account: a, depth: 1 }))
  }
  return rows
}

/** Find the node carrying a role (e.g. cost of sales), searching depth-first. */
export function findByRole(tree, role) {
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.role === role) return n
      const hit = walk(n.groups || [])
      if (hit) return hit
    }
    return null
  }
  return walk(tree.groups || [])
}

/** The tree minus one node, by id. Used to split cost of sales out of expenses. */
export function withoutNode(tree, id) {
  const walk = (nodes) => nodes.filter((n) => n.id !== id).map((n) => ({ ...n, groups: walk(n.groups || []) }))
  const removed = findNode(tree, id)
  const groups = walk(tree.groups || [])
  const totals = {}
  Object.keys(tree.totals || {}).forEach((k) => {
    totals[k] = (tree.totals[k] || 0) - (removed?.totals?.[k] || 0)
  })
  return { ...tree, groups, totals }
}

export function findNode(tree, id) {
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.id === id) return n
      const hit = walk(n.groups || [])
      if (hit) return hit
    }
    return null
  }
  return walk(tree.groups || [])
}

/**
 * Check a group before it is saved.
 * @returns { ok: true } | { ok: false, errors: [string] }
 */
export function validateGroup(patch, groups = [], { id = null } = {}) {
  const errors = []
  const name = String(patch?.name || '').trim()
  if (!name) errors.push('Give the group a name.')
  if (!TYPE_ORDER.includes(patch?.type)) errors.push('Choose an account type.')

  const parentId = patch?.parentId || null
  if (parentId) {
    const parent = groups.find((g) => g.id === parentId)
    if (!parent) errors.push('That parent group no longer exists.')
    else if (parent.type !== patch.type)
      errors.push('A group must sit under a parent of the same type — a revenue group cannot live under assets.')
    if (id && parentId === id) errors.push('A group cannot be its own parent.')
    if (id && isDescendant(groups, parentId, id))
      errors.push('That would put the group inside one of its own subgroups.')
  }

  const clash = groups.find(
    (g) => g.id !== id && g.type === patch.type && String(g.name || '').trim().toLowerCase() === name.toLowerCase()
  )
  if (clash) errors.push('Another group of this type already has that name.')

  return errors.length ? { ok: false, errors } : { ok: true }
}

/**
 * What deleting a group implies for everything pointing at it.
 *
 * Children and accounts move up to the deleted group's parent rather than
 * being cut loose — the alternative is a report that quietly loses a whole
 * branch because someone tidied up a header.
 */
export function deleteGroupPlan(groups = [], accounts = [], id) {
  const target = groups.find((g) => g.id === id)
  if (!target) return { groupUpdates: [], accountUpdates: [], movedTo: null }
  const to = target.parentId || null
  return {
    groupUpdates: groups.filter((g) => g.parentId === id).map((g) => ({ id: g.id, parentId: to })),
    accountUpdates: accounts.filter((a) => a.groupId === id).map((a) => ({ id: a.id, groupId: to || '' })),
    movedTo: to,
  }
}

/** Counts for the delete confirmation, so the user knows what they are moving. */
export function groupUsage(groups = [], accounts = [], id) {
  const direct = accounts.filter((a) => a.groupId === id).length
  const subgroups = groups.filter((g) => g.parentId === id).length
  const descendantIds = groups.filter((g) => isDescendant(groups, g.id, id)).map((g) => g.id)
  const nested = accounts.filter((a) => descendantIds.includes(a.groupId)).length
  return { direct, subgroups, nested, total: direct + nested }
}
