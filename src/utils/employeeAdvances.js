// Employee salary advances and staff loans.
//
// The mirror image of a customer advance: there, the business holds money it
// has not yet earned; here it has handed money over that has not yet been
// worked off. So this is an asset — a receivable from the employee — and it
// winds down as payroll deducts instalments.
//
//   issued      Dr Employee Advances   Cr Bank
//   deducted    Dr Salaries Payable    Cr Employee Advances   (each payroll)
//   repaid      Dr Bank                Cr Employee Advances   (cash back)
//   written off Dr Staff Costs         Cr Employee Advances
//
// The deduction is the point. Without it an advance is just a journal entry
// somebody has to remember every month, which is exactly the sort of thing
// that gets remembered for three months and then does not.

export const ADVANCE_ACCOUNT = 'acc-empadv'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

export const repaidTotal = (adv) =>
  r2((adv?.repayments || []).reduce((s, r) => s + (Number(r.amount) || 0), 0))

/** What the employee still owes. */
export const advanceBalance = (adv) => r2((Number(adv?.amount) || 0) - repaidTotal(adv))

export const isSettled = (adv) => adv?.status === 'written_off' || advanceBalance(adv) <= 0.005

/** Every advance one employee is still repaying. */
export const openFor = (advances = [], employeeId) =>
  advances.filter((a) => a.employeeId === employeeId && !isSettled(a))

/** Total outstanding for an employee, across advances. */
export const owedBy = (advances = [], employeeId) =>
  r2(openFor(advances, employeeId).reduce((s, a) => s + advanceBalance(a), 0))

/** Total outstanding across everyone — the balance of the asset account. */
export const totalOutstanding = (advances = []) =>
  r2((advances || []).filter((a) => !isSettled(a)).reduce((s, a) => s + advanceBalance(a), 0))

export function validateAdvance(input = {}) {
  if (!input.employeeId) return { ok: false, error: 'Choose the employee receiving the advance.' }
  if ((Number(input.amount) || 0) <= 0) return { ok: false, error: 'Enter an amount greater than zero.' }
  if (!input.date) return { ok: false, error: 'Enter the date the money was paid out.' }
  if (!input.bankAccountId) return { ok: false, error: 'Choose the account the money was paid from.' }
  const inst = Number(input.instalment) || 0
  if (inst < 0) return { ok: false, error: 'An instalment cannot be negative.' }
  if (inst > (Number(input.amount) || 0))
    return { ok: false, error: 'The instalment is larger than the advance itself. Lower it, or leave it blank to deduct the whole amount at once.' }
  return { ok: true }
}

/**
 * What payroll should deduct from one employee this run.
 *
 * Never more than they still owe — the last instalment is whatever is left,
 * so a 1,000 advance at 300 a month takes 300, 300, 300, 100 rather than
 * overshooting into a credit balance on the fourth run.
 *
 * @returns {{ total:number, parts:Array<{advanceId:string, amount:number}> }}
 */
export function dueFromPayroll(advances = [], employeeId, { cap } = {}) {
  let budget = cap == null ? Infinity : Math.max(0, Number(cap) || 0)
  const parts = []
  let total = 0

  // Oldest first: the advance taken longest ago clears first.
  const open = openFor(advances, employeeId)
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))

  for (const adv of open) {
    if (budget <= 0.005) break
    const owed = advanceBalance(adv)
    const wanted = (Number(adv.instalment) || 0) > 0 ? Number(adv.instalment) : owed
    const take = r2(Math.min(owed, wanted, budget))
    if (take <= 0.005) continue
    parts.push({ advanceId: adv.id, amount: take })
    total = r2(total + take)
    budget = r2(budget - take)
  }
  return { total, parts }
}

/**
 * How many more payroll runs an advance needs, at its current instalment.
 * `null` when there is no instalment — it comes off in one go, or by hand.
 */
export function runsRemaining(adv) {
  const owed = advanceBalance(adv)
  const inst = Number(adv?.instalment) || 0
  if (owed <= 0.005) return 0
  if (inst <= 0) return null
  return Math.ceil(r2(owed) / inst)
}

/** Ledger lines for paying an advance out. */
export const issueLines = (amount, bankAccountId, ref) => {
  const amt = r2(amount)
  if (amt <= 0) return []
  return [
    { accountId: ADVANCE_ACCOUNT, debit: amt, credit: 0, description: ref },
    { accountId: bankAccountId, debit: 0, credit: amt, description: ref },
  ]
}

/** Ledger lines for an employee handing cash back outside payroll. */
export const repayLines = (amount, bankAccountId, ref) => {
  const amt = r2(amount)
  if (amt <= 0) return []
  return [
    { accountId: bankAccountId, debit: amt, credit: 0, description: ref },
    { accountId: ADVANCE_ACCOUNT, debit: 0, credit: amt, description: ref },
  ]
}

/** Ledger lines for giving up on recovering one. */
export const writeOffLines = (amount, expenseAccountId, ref) => {
  const amt = r2(amount)
  if (amt <= 0) return []
  return [
    { accountId: expenseAccountId || 'acc-salary', debit: amt, credit: 0, description: ref },
    { accountId: ADVANCE_ACCOUNT, debit: 0, credit: amt, description: ref },
  ]
}
