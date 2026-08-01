# Builds the transaction cookbook. Every worked example's journal entry comes
# from the manifest written by seed_tx.mjs, so the figures quoted in the prose
# and the screenshots below them cannot drift apart.
import html, json, os

DIR = os.environ.get('GUIDE_DIR', '.')
MAN = {e['key']: e for e in json.load(open(os.path.join(DIR, 'tx-manifest.json')))}


def esc(s):
    return html.escape(s, quote=False)


class T:
    """One worked transaction."""
    def __init__(self, key, title, scenario, where, why, doc=None, figures=None, show_doc=False):
        self.key, self.title = key, title
        self.scenario, self.where, self.why = scenario, where, why
        self.doc, self.figures = doc, figures or []
        self.show_doc = show_doc


CHAPTERS = []


def chapter(num, title, blurb, txs):
    CHAPTERS.append({'num': num, 'title': title, 'blurb': blurb, 'txs': txs})


# ─────────────────────────────────────────────────────────────────────
chapter(1, 'Putting money in', 'Where the money to trade with comes from.', [
    T('capital', 'The owner puts money into the business',
      'The owner transfers <b>SAR 500,000</b> of their own money into the company bank account to get it trading.',
      ['<b>Journal Entries → Manual Entry</b>.',
       'Debit the bank account 500,000; credit Owner’s Capital 500,000.',
       'Save. The entry will not post unless the two sides agree.'],
      'The business now has cash it did not earn. Cash is an asset, so it is debited. The other side is not income — the owner has not sold anything — it is a claim the owner has on the business, which is equity.',
      figures=['Bank +500,000', 'Owner’s Capital +500,000']),
])

chapter(2, 'Buying', 'Everything from asking for something to paying for it.', [
    T('requisition', 'Someone asks to buy something',
      'The storekeeper asks for <b>100 office chairs</b> at an estimated <b>SAR 300</b> each — SAR 30,000 — needed before the season.',
      ['<b>Requisitions → New Requisition</b>.',
       'Enter who is asking, what for, and by when.',
       'A manager approves it; it can then be turned into a purchase order in one click.'],
      'Nothing has happened yet in accounting terms. An internal request is not a commitment to anyone outside the business, so there is nothing to record.',
      doc='requisitions'),

    T('purchase_quote', 'A supplier quotes you a price',
      'Riyadh Supplies Co quotes <b>SAR 300</b> a chair — SAR 30,000 plus VAT of SAR 4,500, so SAR 34,500 in total.',
      ['<b>Purchase Quotes → New Quote</b>.',
       'Record what each supplier offered, and until when it holds.',
       'Convert the one you accept into a purchase order.'],
      'Still nothing to post. A price you have been offered is not an obligation until you accept it.',
      doc='purchase-quotes'),

    T('purchase_order', 'You commit to buy — the purchase order',
      'You accept the quote and raise <b>PO-0001</b> for 100 chairs at SAR 300, total SAR 34,500 including VAT.',
      ['<b>Purchase Orders → New Purchase Order</b>.',
       'Choose the supplier, add the lines, set the expected date.',
       'Send it. The order tracks how much has been received and how much billed.'],
      'A purchase order is a promise to buy, not a purchase. Nothing has been delivered and nothing is owed yet, so the ledger stays still. This surprises people, but it is right: if you posted every order you raised, your payables would include things that may never arrive.',
      doc='purchase-orders'),

    T('goods_receipt', 'The goods arrive — before the bill does',
      'All <b>100 chairs</b> turn up. The supplier’s invoice is still in the post.',
      ['Open the purchase order and choose <b>Receive goods</b>.',
       'Confirm the quantities that actually arrived — in full or in part.',
       'Stock goes up immediately.'],
      'You are holding SAR 30,000 of stock you have not been billed for. The stock is real, so Inventory is debited. The other side cannot be Accounts Payable, because no invoice exists to pay — it goes to <b>Goods Received Not Invoiced</b>, a liability that says "we owe someone for this, we just do not have the paperwork yet".',
      figures=['Inventory +30,000', 'GRNI +30,000 (a liability)']),

    T('purchase', 'The bill arrives for goods already received',
      'Riyadh Supplies invoices <b>SAR 34,500</b> — SAR 30,000 for the chairs plus SAR 4,500 VAT.',
      ['Open the purchase order and choose <b>Bill received goods</b>.',
       'The quantities already received are proposed for billing.',
       'Save.'],
      'This is the moment the paperwork catches up. The stock is already on the books from the receipt, so Inventory is <b>not</b> touched again — instead the GRNI liability is cleared and replaced by a real debt to the supplier. The VAT you were charged is recoverable, so it is debited to Tax Receivable rather than treated as a cost.',
      figures=['GRNI cleared −30,000', 'Input VAT +4,500', 'Accounts Payable +34,500']),

    T('purchase_payment', 'You pay the supplier',
      'You pay the full <b>SAR 34,500</b> from the main bank account.',
      ['Open the purchase invoice and choose <b>Record payment</b>.',
       'Enter the date, the amount and which account it came out of.',
       'Part payments are fine; the balance stays outstanding.'],
      'Paying does not create a cost — the cost arrived with the bill. This only swaps one balance-sheet item for another: less cash, less debt.',
      figures=['Accounts Payable −34,500', 'Bank −34,500']),

    T('landed_cost', 'Freight is added to what the stock cost you',
      'DHL charges <b>SAR 2,000</b> to bring the chair shipment in. Spread over 100 chairs, that is SAR 20 a chair — so each chair now costs SAR 320, not SAR 300.',
      ['<b>Landed Costs → New Landed Cost</b>.',
       'Enter the amount and choose which shipment or items it belongs to.',
       'Choose how to spread it — by value or by quantity — and post.'],
      'Freight is part of what the goods cost you, not a separate overhead. Capitalising it into Inventory means your gross margin tells the truth when you sell them. Book it as an expense instead and every chair looks SAR 20 more profitable than it is.',
      doc='landed-costs',
      figures=['Inventory +2,000', 'Bank −2,000']),

    T('debit_note', 'You send faulty goods back',
      'Five chairs arrive damaged. You raise a debit note for <b>SAR 1,500</b> plus SAR 225 VAT — SAR 1,725 off what you owe.',
      ['<b>Debit Notes → New Debit Note</b>.',
       'Raise it against the original bill and enter what is going back.',
       'Save.'],
      'You owe the supplier less, so Accounts Payable is reduced. The VAT you reclaimed on those chairs has to go back too — you cannot recover tax on goods you returned.',
      doc='debit-notes',
      figures=['Accounts Payable −1,725', 'Purchase Returns 1,500', 'Input VAT −225']),
])

chapter(3, 'Selling', 'From the first quote to the money in the bank.', [
    T('quotation', 'You quote a customer a price',
      'Al-Noor Trading asks for <b>20 chairs</b>. You quote <b>SAR 500</b> each — SAR 10,000 plus SAR 1,500 VAT, so SAR 11,500.',
      ['<b>Quotations → New Quotation</b>.',
       'Build it exactly as you would an invoice, and set how long it holds.',
       'Send the PDF. If they accept, convert it rather than retyping it.'],
      'A quote is an offer. Nothing is owed and nothing has moved, so nothing posts.',
      doc='quotations'),

    T('sales_order', 'The customer confirms — the sales order',
      'Al-Noor accepts. The quote becomes <b>SO-0001</b> for the same 20 chairs.',
      ['Open the quotation and choose <b>Convert to sales order</b>.',
       'The order tracks what has been delivered and what has been invoiced.'],
      'A confirmed order is still a promise. You have not delivered and you have not billed, so there is nothing to recognise. Revenue belongs to the moment you actually earn it.',
      doc='sales-orders'),

    T('delivery_note', 'The goods go out',
      'The 20 chairs leave the warehouse on a delivery note for the driver and the customer to sign.',
      ['Open the sales order and choose <b>Convert to delivery note</b>.',
       'Confirm the quantities going out. Print it for the driver.'],
      'In this system the cost of the goods is recognised with the invoice, not the delivery note — so the delivery note itself posts nothing. It is proof of despatch.',
      doc='delivery-notes'),

    T('invoice', 'You invoice the customer',
      'You bill the 20 chairs: <b>SAR 10,000</b> plus <b>SAR 1,500</b> VAT — <b>SAR 11,500</b>, due in 30 days. The chairs cost you SAR 320 each, so SAR 6,400 of stock goes with them.',
      ['<b>Sales Invoices → New Invoice</b>, or convert the sales order.',
       'Pick the customer, add the lines, check the due date.',
       'Save, then send or print.'],
      'This is the busiest moment in the system, and it writes <b>two</b> entries. The first records the sale: the customer owes you the full 11,500, of which 10,000 is yours and 1,500 is VAT you are collecting on the government’s behalf — a liability, not income. The second records the cost of what you sold, moving 6,400 out of Inventory into Cost of Goods Sold. Because both post together, your gross profit is correct on any day you look, without a month-end stock calculation.',
      doc='invoice-view', show_doc=True,
      figures=['Receivables +11,500', 'Sales 10,000', 'Output VAT 1,500', 'COGS 6,400', 'Inventory −6,400']),

    T('invoice_payment', 'The customer pays',
      'Al-Noor pays the full <b>SAR 11,500</b> into the bank.',
      ['Open the invoice and choose <b>Record payment</b>.',
       'Enter the date, amount and receiving account.',
       'Partial payments leave the balance outstanding and ageing.'],
      'No revenue here — that was recognised when you invoiced. This only converts a promise into cash.',
      figures=['Bank +11,500', 'Receivables −11,500']),

    T('credit_note', 'The customer returns two chairs',
      'Two chairs come back. You credit <b>SAR 1,000</b> plus SAR 150 VAT — SAR 1,150.',
      ['Open the invoice and choose <b>Return / refund</b>, or raise a standalone credit note.',
       'Enter what is coming back.'],
      'The customer owes you less. Note that the reduction goes to <b>Sales Returns</b> rather than being deducted from Sales — so you can still see what you sold and what came back, instead of one netted-off figure that hides the return rate.',
      doc='credit-notes',
      figures=['Sales Returns 1,000', 'Output VAT −150', 'Receivables −1,150']),

    T('customer_advance', 'A customer pays a deposit up front',
      'Gulf Star pays <b>SAR 20,000</b> up front against a fit-out you have not started.',
      ['<b>Customer Advances → Receive advance</b>.',
       'Record it against the customer.',
       'Apply it to an invoice when you raise one; refund the rest if the job dies.'],
      'You have the cash but you have not earned it. Treating it as revenue would overstate your profit and your VAT. It is held as a liability — you owe them either the work or their money back — until an invoice is raised against it.',
      doc='customer-advances',
      figures=['Bank +20,000', 'Customer Advances +20,000 (a liability)']),
])

chapter(4, 'Cheques', 'A cheque in the drawer is not money in the bank, and the system keeps that distinction.', [
    T('cheque_in', 'A customer pays by post-dated cheque',
      'Al-Noor hands over cheque <b>400218</b> for <b>SAR 8,000</b>, dated a month out.',
      ['<b>Cheque Register → New Cheque</b>, direction <i>received</i>.',
       'Enter the number, bank, amount and due date.'],
      'The customer has settled their debt as far as they are concerned, so receivables come down. But you cannot spend a post-dated cheque — it is not in your bank. It sits in <b>Cheques Under Collection</b>, an asset of its own, shown separately on the balance sheet.',
      doc='cheques',
      figures=['Cheques Under Collection +8,000', 'Receivables −8,000']),

    T('cheque_deposit', 'You deposit it at the bank',
      'On the due date you lodge the cheque.',
      ['Open the cheque and move it to <b>Deposited</b>.'],
      'Nothing posts. The cheque has changed hands but not yet cleared — it is still the same asset, just in a different place. Recording bank credit now would be optimistic; cheques bounce.'),

    T('cheque_cleared', 'The cheque clears',
      'Three days later the funds land. <b>SAR 8,000</b> is now genuinely yours.',
      ['Open the cheque and mark it <b>Cleared</b>.'],
      'Only now does the bank balance move. This is why a cheque register exists: without it, your bank balance in the books runs ahead of the real one for weeks at a time.',
      figures=['Bank +8,000', 'Cheques Under Collection −8,000']),
])

chapter(5, 'Stock and production', 'Goods moving, goods lost, goods made.', [
    T('stock_adjustment', 'Stock is damaged and written off',
      'Three chairs are damaged in handling. At SAR 320 each that is <b>SAR 960</b> of stock gone.',
      ['<b>Stock Adjustments → New Adjustment</b>.',
       'Choose the item, the direction, the quantity and the reason.',
       'It waits for approval — stock cannot be written off unnoticed.'],
      'The chairs no longer exist, so Inventory must come down. The loss has to land somewhere, and it is not cost of sale — you did not sell them. It goes to Inventory Adjustments, where it can be seen and questioned.',
      doc='stock-adjustments',
      figures=['Inventory Adjustments 960', 'Inventory −960']),

    T('stock_transfer', 'Stock moves between your own warehouses',
      'Ten chairs go from the Riyadh store to the Jeddah branch for display.',
      ['<b>Warehouses → Transfer stock</b>.',
       'Choose the item, the two locations and the quantity.'],
      'Nothing posts, and that is the point. Moving your own goods from one shelf to another changes where they are, not what they are worth. Total inventory value is unchanged, so the ledger has nothing to say.',
      doc='warehouses'),

    T('raw_materials', 'You buy raw materials',
      'Jeddah Import House supplies <b>500 steel sheets</b> at SAR 40 — SAR 20,000 plus SAR 3,000 VAT.',
      ['<b>Purchase Invoices → New Purchase</b>.',
       'Point the line at <b>Raw Materials</b> rather than Inventory.'],
      'Raw materials are held separately from goods you bought to resell, because they are on a different journey: they will be consumed into production rather than sold as they are.',
      figures=['Raw Materials +20,000', 'Input VAT +3,000', 'Payables +23,000']),

    T('work_order', 'You make 50 shelving units',
      'Each unit takes <b>4 steel sheets</b> at SAR 40 — SAR 160 a unit, <b>SAR 8,000</b> for the run of 50.',
      ['<b>Manufacturing</b> — define the bill of materials, then raise a work order for a quantity.',
       'Mark it complete when the run is finished.'],
      'Making something is two movements, and the system writes both. First the steel is consumed: it stops being raw material and becomes work in progress. Then the run completes and the whole accumulated cost becomes finished goods, ready to sell at a known cost. Value is never created or destroyed here — it only changes form.',
      doc='manufacturing',
      figures=['Raw Materials −8,000 → WIP', 'WIP −8,000 → Finished Goods']),
])

chapter(6, 'Banking', 'Money moving with no invoice behind it.', [
    T('bank_payment', 'You pay a bill that has no invoice',
      'The electricity bill is <b>SAR 1,800</b>, paid straight from the bank.',
      ['<b>Bank Transactions → Money out</b>.',
       'Choose the bank account, the amount, and the expense it belongs to.'],
      'Not every cost arrives as a supplier invoice. This is the short path for costs you pay as they happen — one step instead of raising a bill and then paying it.',
      doc='banking',
      figures=['Utilities 1,800', 'Bank −1,800']),

    T('bank_transfer', 'You top up the petty cash tin',
      '<b>SAR 5,000</b> moves from the bank to cash on hand.',
      ['<b>Cash Flow → Transfer</b>.',
       'Choose the two accounts, the amount, and any bank fee.'],
      'Moving your own money between your own accounts is not income or expense. Both sides are assets — one goes up, the other goes down, and the business is no richer or poorer. Any bank fee <i>is</i> a real cost and is posted separately.',
      doc='cash-flow',
      figures=['Cash on Hand +5,000', 'Bank −5,000']),
])

chapter(7, 'Costs that belong to more than one month', 'Paying now for something you will use later.', [
    T('prepaid', 'You pay a year of insurance up front',
      '<b>SAR 24,000</b> for twelve months of cover — SAR 2,000 a month.',
      ['<b>Prepaid Expenses → New Prepaid</b>.',
       'Enter the amount, the start date and the number of months.'],
      'The money has gone, but eleven months of cover is still owed to you — that is an asset, not a cost. Expensing all 24,000 now would wreck this month’s profit and flatter the next eleven.',
      doc='prepaid-expenses',
      figures=['Prepaid Expenses +24,000', 'Bank −24,000']),

    T('prepaid_amort', 'One month of that insurance is used up',
      'At month end, <b>SAR 2,000</b> of the cover has been consumed.',
      ['Open the prepaid expense and release the month, or let the month-end routine do it.'],
      'This is the cost finally arriving, in the month it belongs to. Repeat it twelve times and the asset is gone and the full 24,000 has been charged — evenly, where it was earned.',
      figures=['General & Administrative 2,000', 'Prepaid Expenses −2,000']),

    T('lease', 'You register a lease',
      'A one-year lease on the Riyadh showroom at <b>SAR 10,000</b> a month, from Olaya Properties.',
      ['<b>Leases &amp; Rent → New Lease</b>.',
       'Enter the landlord, the term, the monthly rent and which account the rent belongs to.'],
      'Recording the agreement posts nothing — signing a lease is not a transaction. An operating lease is recognised as each month is used, which is the next entry.',
      doc='leases'),

    T('lease_payment', 'You pay a month’s rent',
      'The Riyadh showroom costs <b>SAR 10,000</b> a month.',
      ['<b>Leases & Rent</b> — record the lease once, then record each payment against it.'],
      'Rent is consumed in the month it covers, so unlike the insurance above there is nothing to spread forward.',
      figures=['Rent Expense 10,000', 'Bank −10,000']),

    T('expense_claim', 'An employee claims back what they spent',
      'Yusuf spent <b>SAR 1,200</b> on flights and taxis visiting a client in Jeddah.',
      ['<b>Expense Claims → New Claim</b> — category, amount, receipt.',
       'A manager approves it.',
       'Pay it, and the reimbursement goes out.'],
      'Two entries, deliberately separated. Approving the claim recognises the cost and creates a debt to the employee — the business incurred it whether or not it has paid yet. Paying then settles that debt. Keeping them apart means an approved-but-unpaid claim shows up as money you owe.',
      doc='expense-claims',
      figures=['G&A 1,200 → owed to employee', 'then Bank −1,200']),
])

chapter(8, 'Fixed assets', 'Things you buy to use, not to sell.', [
    T('fixed_asset', 'You buy a delivery van',
      'A Toyota Hiace for <b>SAR 120,000</b>, expected to last <b>8 years</b> and be worth <b>SAR 24,000</b> at the end.',
      ['<b>Fixed Assets → Add Asset</b>.',
       'Enter cost, expected life, salvage value and depreciation method.'],
      'Buying a van is not an expense. You have swapped SAR 120,000 of cash for SAR 120,000 of van — the business is exactly as wealthy as it was. The cost is recognised gradually, over the years the van is actually used.',
      doc='fixed-assets',
      figures=['Fixed Assets – Cost +120,000', 'Bank −120,000']),

    T('depreciation', 'A month of depreciation is charged',
      '(120,000 − 24,000) ÷ 8 years ÷ 12 months = <b>SAR 1,000</b> a month.',
      ['<b>Fixed Assets → Run Depreciation</b>.',
       'Preview first — it shows every asset and what each will post.',
       'Post. All assets are handled in one entry.'],
      'This is the van being used up, a month at a time. The cost is never written off the asset directly: it accumulates in a separate account, so the balance sheet keeps showing what the van cost <i>and</i> how much of it has been consumed.',
      figures=['Depreciation Expense 1,000', 'Accumulated Depreciation 1,000']),

    T('asset_disposal', 'You sell an old printer for more than it is worth on paper',
      'A printer that cost <b>SAR 6,000</b> has <b>SAR 5,500</b> of accumulated depreciation, so its book value is <b>SAR 500</b>. You sell it for <b>SAR 1,000</b>.',
      ['Open the asset and choose <b>Dispose</b>.',
       'Enter the date and the proceeds.'],
      'Four things happen at once: the cost comes off, the accumulated depreciation comes off with it, the cash comes in — and whatever is left over is the gain. Selling for 1,000 something the books valued at 500 is a SAR 500 gain, and the system works it out rather than asking you to.',
      figures=['Cost −6,000', 'Accumulated Depreciation −5,500', 'Bank +1,000', 'Gain on Disposal 500']),
])

chapter(9, 'Payroll', 'Paying people, and getting money back from them.', [
    T('employee_advance', 'You lend an employee money against salary',
      'Yusuf needs <b>SAR 3,000</b> for school fees, to come back at <b>SAR 1,000</b> a month.',
      ['<b>Employee Advances → Issue advance</b>.',
       'Set the amount and how much to deduct each payroll.'],
      'Lending money is not a payroll cost. You expect it back, so it is an asset — a receivable from the employee — exactly like a customer owing you.',
      doc='employee-advances',
      figures=['Employee Advances +3,000', 'Bank −3,000']),

    T('payroll_process', 'You run payroll for the month',
      'Yusuf earns <b>SAR 11,000</b> gross. GOSI takes SAR 975 from him, SAR 1,000 comes off his advance, and <b>SAR 9,025</b> is left to pay. The company also owes SAR 1,175 of employer GOSI on top.',
      ['<b>Payroll → Run Payroll</b>, choose the month.',
       'Check the grid — pay comes from the contract, absence and overtime from attendance, and the advance instalment fills itself in.',
       '<b>Create</b>, then <b>Process</b>.'],
      'One entry does a lot. The full gross of 11,000 is the cost of employing him — deductions do not reduce it, they only decide where the money goes. What is withheld is not yours: GOSI is owed to the authority, and the 1,000 of advance recovery reduces the asset he owed you. Employer GOSI is an extra cost on top of gross, not a deduction from it.',
      doc='payroll',
      figures=['Salaries 11,000 + Employer GOSI 1,175', 'Net owed 9,025', 'GOSI payable 2,150', 'Advance recovered 1,000']),

    T('payroll_paid', 'You pay the staff',
      '<b>SAR 9,025</b> leaves the bank on pay day.',
      ['Open the processed run and choose <b>Pay</b>.'],
      'The cost belonged to the month worked; the cash leaves whenever it leaves. Separating the two is what lets you close a month before the transfer has cleared.',
      figures=['Salaries Payable −9,025', 'Bank −9,025']),

    T('advance_writeoff', 'An advance you will never get back',
      'Another employee left without notice owing <b>SAR 800</b>.',
      ['Open the advance and choose <b>Write off</b>.',
       'Choose which cost account it should hit and give a reason.'],
      'This is the only point at which an advance becomes a cost. Until now it was an asset you expected to recover; admitting it is gone turns it into a staff cost.',
      figures=['Staff Costs 800', 'Employee Advances −800']),
])

chapter(10, 'Period end', 'The entries that belong to the calendar rather than to a customer.', [
    T('manual_journal', 'You accrue a cost whose bill has not arrived',
      'The auditors have done the work but not invoiced. You accrue <b>SAR 4,000</b>.',
      ['<b>Journal Entries → Manual Entry</b>.',
       'Debit the expense, credit Accrued Expenses.',
       'It will not save unless it balances.'],
      'The work was done this year, so the cost belongs to this year — waiting for the invoice would push it into the next one and flatter this one. The credit is a liability: a cost incurred but not yet billed.',
      doc='journals-list',
      figures=['G&A 4,000', 'Accrued Expenses 4,000']),

    T('recurring_journal', 'A journal that posts itself every month',
      'A <b>SAR 1,500</b> management charge, every month, without anyone remembering.',
      ['<b>Recurring Journals → New</b>.',
       'Define the lines once and set the frequency.',
       'It posts when due, or you can post it early.'],
      'Identical to a manual entry in what it posts — the difference is that it happens whether or not anyone is thinking about it. Anything genuinely predictable belongs here rather than in a reminder.',
      doc='recurring-journals',
      figures=['G&A 1,500', 'Accrued Expenses 1,500']),

    T('fx_reval', 'A foreign-currency account is restated',
      'You hold <b>USD 10,000</b>, recorded at 3.75 — SAR 37,500. At month end the rate is <b>3.80</b>, so it is worth SAR 38,000: a gain of <b>SAR 500</b>.',
      ['<b>FX Revaluation</b>, enter the closing rate.',
       'The screen shows the current and revalued base amounts.',
       'Post.'],
      'The dollars did not change; their value in your books did. The gain is <i>unrealised</i> — you have not converted anything — so the system posts it and then <b>automatically reverses it the next day</b>. That is deliberate: the restatement is for the balance sheet on that date only, and leaving it in place would count the same movement twice when the money is eventually converted.',
      doc='revaluation',
      figures=['USD Account +500', 'Unrealised FX Gain 500', 'reversed the next day']),
])


# ── Render ──────────────────────────────────────────────────────────
def money(n):
    return f'{n:,.2f}'


def render_tx(t, num):
    ex = MAN.get(t.key)
    entries = ex['entries'] if ex else []
    posts = len(entries) > 0
    out = [f'<div class="tx">']
    out.append(f'<div class="tx-head"><span class="tx-num">{num}</span>'
               f'<h3>{esc(t.title)}</h3>'
               f'<span class="chip {"posts" if posts else "noposts"}">'
               f'{"posts to the ledger" if posts else "posts nothing"}</span></div>')

    out.append(f'<div class="scenario"><span class="lbl">The example</span><p>{t.scenario}</p></div>')

    if t.where:
        out.append('<div class="two-col"><div>')
        out.append('<h4>How you enter it</h4><ol class="steps">')
        for w in t.where:
            out.append(f'<li>{w}</li>')
        out.append('</ol></div>')
        if t.figures:
            out.append('<div><h4>In one line</h4><ul class="figs">')
            for f in t.figures:
                out.append(f'<li>{esc(f)}</li>')
            out.append('</ul></div>')
        else:
            out.append('<div></div>')
        out.append('</div>')

    if t.doc and (not posts or t.show_doc):
        p = f'img/doc-{t.doc}.jpg'
        if os.path.exists(os.path.join(DIR, 'txweb', p)):
            out.append(f'<figure class="doc"><img src="{p}" alt="{esc(t.title)}">'
                       f'<figcaption>The screen where this is entered</figcaption></figure>')

    if posts:
        out.append('<h4 class="post-h">What it posts</h4>')
        for je in entries:
            p = f'img/je-{je["number"]}.jpg'
            if os.path.exists(os.path.join(DIR, 'txweb', p)):
                out.append(f'<figure class="je"><img src="{p}" alt="{je["number"]}"></figure>')
            else:
                rows = ''.join(
                    f'<tr><td>{esc(l["account"])}</td>'
                    f'<td class="r">{money(l["debit"]) if l["debit"] else "—"}</td>'
                    f'<td class="r">{money(l["credit"]) if l["credit"] else "—"}</td></tr>'
                    for l in je['lines'])
                out.append(f'<table class="je-fallback"><tr><th>Account</th><th class="r">Debit</th>'
                           f'<th class="r">Credit</th></tr>{rows}</table>')
    else:
        out.append('<div class="nopost">This step records a document but writes no journal entry.</div>')

    out.append(f'<div class="why"><span class="lbl">Why</span><p>{t.why}</p></div>')
    out.append('</div>')
    return '\n'.join(out)


def reference_table():
    rows = []
    n = 0
    for ch in CHAPTERS:
        for t in ch['txs']:
            n += 1
            ex = MAN.get(t.key)
            if not ex or not ex['entries']:
                rows.append(f'<tr><td>{n}</td><td>{esc(t.title)}</td>'
                            f'<td colspan="2" class="none">no journal entry</td></tr>')
                continue
            for je in ex['entries']:
                drs = [l for l in je['lines'] if l['debit']]
                crs = [l for l in je['lines'] if l['credit']]
                dr = '<br>'.join(f'{esc(l["account"])} {money(l["debit"])}' for l in drs)
                cr = '<br>'.join(f'{esc(l["account"])} {money(l["credit"])}' for l in crs)
                rows.append(f'<tr><td>{n}</td><td>{esc(t.title)}<br><span class="jenum">{je["number"]}</span></td>'
                            f'<td class="dr">{dr}</td><td class="cr">{cr}</td></tr>')
    return ('<table class="ref"><tr><th>#</th><th>Transaction</th><th>Debit</th><th>Credit</th></tr>'
            + ''.join(rows) + '</table>')


CSS = """
@page { size: A4; margin: 15mm 13mm 17mm 13mm; }
* { box-sizing: border-box; }
p, li { orphans: 2; widows: 2; }
body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-size: 10pt;
  line-height: 1.5; color: #1e293b; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1,h2,h3,h4 { color: #0f172a; line-height: 1.25; }
.pb { page-break-after: always; }

.cover { height: 250mm; display:flex; flex-direction:column; justify-content:center;
  padding: 0 6mm; border-left: 4mm solid #0f766e; }
.cover-mark { font-size: 36pt; color:#0f766e; margin-bottom: 8mm; }
.cover h1 { font-size: 36pt; margin:0 0 2mm; letter-spacing:-1px; font-weight:800; }
.cover-sub { font-size: 16pt; color:#0f766e; margin:0 0 10mm; font-weight:600; }
.cover-desc { font-size: 11.5pt; color:#475569; max-width:130mm; margin:0 0 14mm; }
.cover-meta { display:flex; gap:3mm; flex-wrap:wrap; }
.cover-meta span { font-size:8.4pt; font-weight:600; color:#0f766e; background:#f0fdfa;
  border:1px solid #99f6e4; border-radius:20px; padding:1.5mm 3.5mm; }

h2.chap { page-break-before: always; }
h2 { font-size:18pt; margin:0 0 3mm; padding-bottom:2.5mm; font-weight:800;
  border-bottom:2px solid #0f766e; page-break-after:avoid; }
h2 .secnum { display:inline-block; min-width:10mm; height:10mm; line-height:10mm; text-align:center;
  background:#0f766e; color:#fff; border-radius:2.5mm; font-size:11pt; margin-right:3.5mm; vertical-align:1mm; }
.chapblurb { color:#64748b; font-style:italic; margin:0 0 6mm; page-break-after: avoid; }

.tx { page-break-inside: avoid; margin: 0 0 6mm; padding-bottom: 3mm; border-bottom: 1px solid #e2e8f0; }
.tx-head { display:flex; align-items:baseline; gap:3mm; margin-bottom:2.5mm; }
.tx-num { display:inline-block; min-width:8mm; height:8mm; line-height:8mm; text-align:center;
  background:#0f172a; color:#fff; border-radius:50%; font-size:9pt; font-weight:700; flex:none; }
.tx-head h3 { font-size:12.5pt; margin:0; flex:1; }
.chip { font-size:7.6pt; font-weight:700; padding:1mm 2.5mm; border-radius:12px; white-space:nowrap; }
.chip.posts { background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; }
.chip.noposts { background:#f8fafc; color:#64748b; border:1px solid #e2e8f0; }

.scenario { background:#f0fdfa; border-left:2.5mm solid #0f766e; border-radius:1.5mm;
  padding:3mm 4mm; margin:0 0 3mm; }
.why { background:#fffbeb; border:1px solid #fde68a; border-radius:1.5mm; padding:3mm 4mm; margin:3mm 0 0;
  page-break-inside: avoid; }
.scenario { page-break-inside: avoid; }
.lbl { display:block; font-size:7.6pt; font-weight:800; text-transform:uppercase; letter-spacing:.6px;
  color:#0f766e; margin-bottom:1mm; }
.why .lbl { color:#92400e; }
.scenario p, .why p { margin:0; }

.two-col { display:flex; gap:6mm; margin:0 0 3mm; }
.two-col > div { flex:1; }
h4 { font-size:9.4pt; margin:0 0 1.5mm; color:#334155; text-transform:uppercase; letter-spacing:.4px; }
h4.post-h { margin-top:3mm; page-break-after: avoid; }
ol.steps { margin:0; padding-left:5mm; }
ol.steps li { margin-bottom:1mm; }
ul.figs { margin:0; padding-left:4mm; list-style:none; }
ul.figs li { font-size:9pt; font-family:ui-monospace,Menlo,Consolas,monospace; color:#334155;
  padding:0.7mm 0; border-bottom:1px dotted #e2e8f0; }

figure { margin:0 0 3mm; }
figure { page-break-inside: avoid; }
/* The journal entry is the point of each page, so it gets the room. The screen
   shot is orientation only — at full width it pushed half of these blocks onto
   a second page and left a hole on the first. */
figure.je img { width:74%; display:block; border:1px solid #cbd5e1; border-radius:2mm; }
figure.doc img { width:58%; display:block; border:1px solid #cbd5e1; border-radius:2mm; }
figcaption { font-size:8pt; color:#94a3b8; margin-top:1mm; }
.nopost { font-size:9pt; color:#64748b; background:#f8fafc; border:1px dashed #cbd5e1;
  border-radius:1.5mm; padding:2.5mm 3.5mm; }

table { width:100%; border-collapse:collapse; font-size:9pt; margin:0 0 4mm; page-break-inside:avoid; }
th { text-align:left; background:#0f766e; color:#fff; padding:2mm 3mm; font-size:8.4pt;
  text-transform:uppercase; letter-spacing:.4px; }
td { padding:1.8mm 3mm; border-bottom:1px solid #e2e8f0; vertical-align:top; }
.r { text-align:right; font-family:ui-monospace,Menlo,Consolas,monospace; }
table.ref td.dr { color:#9a3412; }
table.ref td.cr { color:#1e40af; }
table.ref td.none { color:#94a3b8; font-style:italic; }
.jenum { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:7.6pt; color:#94a3b8; }
tr:nth-child(even) td { background:#f8fafc; }

.callout { background:#f8fafc; border:1px solid #e2e8f0; border-left:3mm solid #0f766e;
  border-radius:2mm; padding:4mm 5mm; margin:0 0 5mm; page-break-inside:avoid; }
.callout h4 { margin:0 0 2mm; font-size:10.5pt; text-transform:none; letter-spacing:0; }
.toc { column-count:2; column-gap:8mm; }
.toc-sec { break-inside:avoid; margin:3.5mm 0 1mm; font-weight:700; font-size:10.4pt; }
.toc-sec .n { color:#0f766e; min-width:6mm; display:inline-block; }
.toc-item { font-size:9pt; color:#475569; padding-left:6mm; border-left:1px solid #e2e8f0; margin-left:1mm; }
"""

parts = []
parts.append("""
<div class="cover">
  <div class="cover-mark">⇄</div>
  <h1>Every Transaction</h1>
  <p class="cover-sub">A worked example of everything the system can post</p>
  <p class="cover-desc">Forty transactions, each with real figures, the screen you enter it on,
  and a picture of the journal entry it produces — taken from the system itself.</p>
  <div class="cover-meta"><span>ERP Accounting</span><span>Double-entry</span><span>VAT at 15%</span></div>
</div>
<div class="pb"></div>
""")

parts.append('<h2 class="nonum">How to read this book</h2>')
parts.append("""
<p>Every entry in this book follows the same three steps: <b>the example</b> — a real situation with real
numbers; <b>how you enter it</b> — where to click; and <b>what it posts</b> — a photograph of the actual
journal entry, taken from the system after doing exactly what the example describes.</p>

<div class="callout">
  <h4>The one rule behind all of it</h4>
  <p>Every entry has two sides and they are always equal. A <b>debit</b> increases something you own or
  something it cost you; a <b>credit</b> increases something you owe, something you own of the business,
  or something you earned. If the two sides did not agree the system would refuse to save it.</p>
  <p>So when you look at any entry below, ask two questions: <i>what did the business get?</i> and
  <i>where did it come from?</i> The first is the debit, the second is the credit.</p>
</div>

<div class="callout">
  <h4>Some steps post nothing at all — on purpose</h4>
  <p>Quotations, sales orders, purchase orders, delivery notes and stock transfers are all marked
  <b>posts nothing</b>. That is not an omission. A promise to buy or sell is not a transaction, and moving
  your own goods between your own shelves does not change what they are worth. Recording those in the
  ledger would fill your accounts with things that had not happened yet.</p>
</div>

<p>The company used throughout is <b>Northwind Trading Co.</b>, a Riyadh furniture trader registered for
VAT at 15%. It buys office chairs at SAR 300 and sells them at SAR 500.</p>
""")
parts.append('<div class="pb"></div>')

parts.append('<h2 class="nonum">Contents</h2><div class="toc">')
n = 0
for ch in CHAPTERS:
    parts.append(f'<div class="toc-sec"><span class="n">{ch["num"]}</span>{esc(ch["title"])}</div>')
    for t in ch['txs']:
        n += 1
        parts.append(f'<div class="toc-item">{n}. {esc(t.title)}</div>')
parts.append('<div class="toc-sec"><span class="n">11</span>Every posting on one page</div>')
parts.append('</div>')

n = 0
for ch in CHAPTERS:
    parts.append(f'<h2 class="chap"><span class="secnum">{ch["num"]}</span>{esc(ch["title"])}</h2>')
    parts.append(f'<p class="chapblurb">{esc(ch["blurb"])}</p>')
    for t in ch['txs']:
        n += 1
        parts.append(render_tx(t, n))

parts.append('<h2 class="chap"><span class="secnum">11</span>Every posting on one page</h2>')
parts.append('<p class="chapblurb">The whole book, condensed. Debits on the left, credits on the right.</p>')
parts.append(reference_table())

doc = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>ERP Accounting — Every Transaction</title>
<style>{CSS}</style></head><body>
{''.join(parts)}
</body></html>"""

os.makedirs(os.path.join(DIR, 'txweb'), exist_ok=True)
with open(os.path.join(DIR, 'txweb', 'tx-guide.html'), 'w') as f:
    f.write(doc)
print('written txweb/tx-guide.html', round(len(doc) / 1024, 1), 'KB')
print('transactions:', n, 'in', len(CHAPTERS), 'chapters')
missing = [k for k in MAN if k not in {t.key for ch in CHAPTERS for t in ch['txs']}]
if missing:
    print('NOT DOCUMENTED:', ', '.join(missing))
