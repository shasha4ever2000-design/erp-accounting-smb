# Builds the user guide HTML from the captured screenshots.
#
# Run order (see README.md in this folder):
#   1. tools/guide/seed.mjs      — build the demo company backup
#   2. tools/guide/capture.mjs   — screenshot every screen
#   3. tools/guide/capture-extras.mjs
#   4. this script               — assemble the HTML
#   5. tools/guide/to-pdf.mjs    — print it to PDF
import html, os, json

IMG = 'img'

def esc(s):
    return html.escape(s, quote=False)

# ── Content model ───────────────────────────────────────────────────
# Each module: (image, title, purpose, steps, posts, tip)
#   posts = list of (debit, credit) pairs, or [] when the screen posts nothing.

class M:
    def __init__(self, img, title, purpose, steps=None, posts=None, tip=None):
        self.img, self.title, self.purpose = img, title, purpose
        self.steps, self.posts, self.tip = steps or [], posts or [], tip

SECTIONS = []

def section(num, title, blurb, modules):
    SECTIONS.append({'num': num, 'title': title, 'blurb': blurb, 'modules': modules})


# ─────────────────────────────────────────────────────────────────────
section(1, 'Getting started', 'Ten minutes from a blank screen to books you can trust.', [
    M('00-signin', 'Creating your account',
      'Your account is what unlocks the app on this device. Everything you enter afterwards belongs to a company inside it.',
      ['Open the app and choose <b>Create an account</b>.',
       'Enter your name, email and a password. The strength meter must reach a passable score — this password protects your entire ledger.',
       'You are signed in immediately. There is no email to confirm and no internet connection required.'],
      tip='Your data lives on this device, not on somebody else’s server. That is a feature, and it is also a responsibility: read <b>Section 14, Backups</b> before you rely on it.'),

    M('01-signup', 'Choosing a strong password',
      'The password meter is not decoration. Because the books never leave the machine, nobody can reset this for you.',
      ['Prefer a passphrase of several words over a short complicated string — longer beats stranger.',
       'Watch the meter fill as you type; it must clear the minimum before the button will accept it.',
       'Write it somewhere safe outside the app.']),

    M('02-companies', 'Creating a company',
      'One account can keep several companies, and each keeps its own completely separate books — its own chart of accounts, its own numbering, its own settings.',
      ['Type the trading name and press <b>Create</b>.',
       'A full chart of accounts, tax settings and document numbering are generated for you.',
       'Switch between companies at any time from the selector in the top bar.'],
      tip='Companies are isolated. Nothing in one can post to another. Only the <b>Group Consolidation</b> screen reads across them, and only to add figures up.'),

    M('03-empty-dashboard', 'Loading sample data first',
      'A brand-new company offers to fill itself with a realistic four-month trading story: customers, stock, invoices in every payment state, and the postings behind them.',
      ['On the empty dashboard, choose <b>Load sample data</b>.',
       'Explore freely — every screen now has something in it, so you can see what each one is for.',
       'When you are ready for the real thing, erase it from <b>Settings → Danger zone</b> and start clean.'],
      tip='This is the fastest way to learn the system. Break things on purpose; it is only sample data.'),

    M('s-settings', 'Settings — do these five things first',
      'Settings is long, but only a handful of entries matter on day one. The rest have sensible defaults you can revisit later.',
      ['<b>Company details</b> — legal name, address, tax registration number and logo. These print on every document.',
       '<b>Currency</b> — set your base currency before you enter anything. Changing it later does not re-translate history.',
       '<b>Tax</b> — pick your region and rate (VAT, GST or sales tax). Saudi users should also complete the ZATCA section.',
       '<b>Document numbering</b> — set the prefix and next number for invoices, purchases and the rest so they continue your existing sequence.',
       '<b>Inventory costing</b> — weighted average or FIFO. Choose once, at the start.'],
      tip='Set the base currency and the costing method before your first transaction. Both are easy now and painful later.'),
])

section(2, 'Finding your way around', 'The same three habits work on every screen in the system.', [
    M('s-dashboard', 'The dashboard',
      'Your morning screen. A one-line verdict on the period, eight headline figures, and a live balance sheet and profit & loss side by side.',
      ['The banner tells you in plain words whether you made money this period.',
       'The eight cards cover revenue, expenses, profit, cash, receivables, payables, overdue invoices and total assets.',
       'The balance sheet and P&L update as you work — no rebuild, no refresh.',
       'Below them sit cash-flow charts, ageing, and anything needing attention.'],
      tip='If a number here looks wrong, click straight through to the full report. Every figure traces back to the journal entries that made it.'),

    M('d-command-palette', 'Search and the command palette',
      'The fastest way to reach anything. Press <b>Ctrl+K</b> (<b>⌘K</b> on Mac) from any screen.',
      ['Start typing a screen name, a customer, an invoice number or an item.',
       'Results are grouped by kind; arrow keys move, Enter opens.',
       'The same box sits in the top bar if you prefer the mouse.'],
      tip='Learning this one shortcut saves more time than any other habit in the system.'),

    M('d-company-switcher', 'Switching between companies',
      'The selector in the top bar lists every company in your account. Each one is a completely separate set of books.',
      ['Click the company name to see the list.',
       'Pick another to switch instantly — nothing is shared between them.',
       '<b>New company</b> creates another set of books; <b>Manage companies</b> renames or removes one.']),

    M('d-dark-mode', 'Dark mode',
      'Every screen, chart and printable document is designed twice. The toggle sits in the top bar.',
      ['Click the moon or sun icon to switch.',
       'Your choice is remembered per device.']),

    M('d-dark-reports', 'Dark mode everywhere',
      'It is not a filter over a light theme — reports, charts and tables are all styled for it.',
      ['Every screen in this guide looks equally deliberate in either theme.']),

    M('d-arabic-rtl', 'Arabic and right-to-left',
      'The whole interface is bilingual. Switching to Arabic mirrors the entire layout — sidebar, tables, forms and printed documents.',
      ['Click the globe icon in the top bar to switch between English and العربية.',
       'The change is instant and affects printing too.',
       'Company names can carry an Arabic name of their own, used on Arabic documents and on ZATCA invoices.']),
])

section(3, 'The ledger', 'Where every number in the system ultimately lives.', [
    M('s-chart-of-accounts', 'Chart of accounts',
      'The backbone. Every posting in the system lands in one of these accounts, and every report is built by reading them.',
      ['Accounts are grouped into a tree — assets, liabilities, equity, revenue, expenses — and you can nest your own groups inside.',
       'Use <b>New Account</b> for anything specific to your trade.',
       'Accounts the system itself posts to are marked as system accounts and cannot be deleted, only renamed.',
       'Each account shows its live balance.'],
      tip='Resist the urge to invent dozens of accounts on day one. Add them when a report actually fails to answer a question.'),

    M('s-journals', 'Journal entries',
      'Every automatic posting the system makes appears here, alongside anything you enter by hand. This is the audit trail of the business.',
      ['Entries made by documents carry their type — invoice, purchase, payroll, depreciation — and link back to the document.',
       'Use <b>Manual Entry</b> for accruals, corrections and anything with no document behind it.',
       'A manual entry will not save unless debits equal credits. That rule is never relaxed.'],
      posts=[('Whichever accounts you choose', 'Whichever accounts you choose')],
      tip='If you can post it from a document screen instead, do that. Documents keep the sub-ledgers, ageing and stock in step; a manual entry only moves the ledger.'),

    M('s-opening-balances', 'Opening balances',
      'How you move onto the system from a previous one without re-entering years of history.',
      ['Set the changeover date — usually the first day of a month or a financial year.',
       'Enter closing balances per account, unpaid customer invoices, unpaid supplier bills, and stock on hand.',
       'The system tells you whether the balances actually balance; any difference is parked in Opening Balance Equity rather than hidden.',
       'Post once. If you got it wrong you can undo the whole thing and post again.'],
      posts=[('Each asset account', 'Each liability and equity account')],
      tip='Do not chase perfection before going live. Post what you know, then correct with a journal entry when the old system gives up the rest.'),

    M('s-capital-accounts', 'Capital accounts',
      'Tracks what each owner or partner has put in and taken out, separately from the trading result.',
      ['Add a capital account per partner.',
       'Record contributions and drawings as they happen.',
       'Each partner’s running balance is kept apart from retained earnings.']),
])

section(4, 'Cash and banking', 'Where the money actually is, and proof of it.', [
    M('s-bank-accounts', 'Cash and bank accounts',
      'Every account that holds money — bank accounts, cash tills, and foreign-currency accounts.',
      ['Add each account with its name, opening balance and currency.',
       'A foreign-currency account is revalued from the <b>FX Revaluation</b> screen rather than by hand.',
       'The header shows your total cash position across everything.']),

    M('s-banking', 'Bank transactions',
      'Money in and money out that has no invoice or bill behind it — bank charges, interest, a one-off cost.',
      ['Choose money in or money out, the account it hits, the amount and the date.',
       'Pick the category account it belongs to.',
       'The entry posts immediately.'],
      posts=[('Bank (money in) or the expense account (money out)', 'The income account (money in) or Bank (money out)')]),

    M('s-cash-flow', 'Cash flow',
      'Your cash position over time, internal transfers between your own accounts, and scheduled movements.',
      ['Transfer between your own accounts, with a bank fee if there is one.',
       'Schedule a transfer that repeats.',
       'The chart shows the direction of travel, which is usually the more useful question than the balance today.'],
      posts=[('Destination account, and the fee to Bank Charges', 'Source account')]),

    M('s-reconciliation', 'Bank reconciliation',
      'Proves your books agree with the bank. The screen is empty until you start a reconciliation, which is exactly as it should be.',
      ['Enter the closing balance and date from the bank statement.',
       'Tick off everything that appears on both sides.',
       'The difference must reach zero before you can finish. Anything left over is either missing from your books or has not cleared yet.'],
      tip='Reconcile monthly, not annually. Ten minutes a month beats two days in January.'),

    M('s-cheques', 'Cheque register',
      'Post-dated cheques, in both directions. A cheque you are holding is not money in the bank until it clears, and this screen keeps that distinction honest.',
      ['Record the cheque with its number, bank, amount and due date.',
       'Move it through its life: on hand → deposited → cleared. Or bounced, or cancelled.',
       'Only when it clears does your bank balance change.'],
      posts=[('Cheques Under Collection (received) — Bank on clearing', 'Accounts Receivable (received) — Cheques Under Collection on clearing')],
      tip='This is the single most common source of a bank balance that looks wrong. Cheques held are shown separately on the balance sheet, where they belong.'),

    M('s-recurring-journals', 'Recurring journals',
      'A journal entry that repeats on a schedule — accruals, monthly allocations, anything predictable.',
      ['Define the entry once, with its lines and frequency.',
       'It posts automatically when due, or you can post it early by hand.']),
])

section(5, 'Sales', 'From first conversation to cash in the bank.', [
    M('s-pipeline', 'Sales pipeline (CRM)',
      'Opportunities before they become customers. Nothing here touches the ledger.',
      ['Add a lead with its company, contact, expected value and source.',
       'Drag it through the stages as it progresses.',
       'When you win it, convert the lead to a customer in one click and carry the details across.']),

    M('s-customers', 'Customers',
      'Everyone who owes you money or might. Each customer carries their terms, their credit limit and their whole history.',
      ['Add the customer with contact details, payment terms and tax registration number.',
       'Set a credit limit if you want to be warned before over-extending.',
       'Open any customer to see every document and payment, and their current balance.']),

    M('d-customer-form', 'Adding a customer',
      'The form is short on purpose. Only the name is genuinely required.',
      ['Name, and whatever contact details you have.',
       'Payment terms drive the due date on every invoice you raise for them.',
       'The tax number prints on their invoices — required for a valid VAT invoice in most regions.']),

    M('s-quotations', 'Quotations and estimates',
      'A priced offer. It posts nothing, because nothing has happened yet.',
      ['Build the quotation exactly as you would an invoice.',
       'Send it as a PDF.',
       'When accepted, convert it to an invoice or a sales order — in whole or line by line.'],
      tip='Converting is better than retyping: the link between quote and invoice is kept, so you can see what you quoted against what you billed.'),

    M('s-sales-orders', 'Sales orders',
      'A confirmed order you have not yet delivered or invoiced. Still no posting — an order is a promise, not a transaction.',
      ['Raise the order with the agreed lines and expected date.',
       'Convert part or all of it to a delivery note when goods go out.',
       'Convert part or all of it to an invoice when you bill.',
       'The order tracks what is still outstanding.']),

    M('s-invoices', 'Sales invoices',
      'The heart of the sales side. Raising an invoice books the revenue, the tax and the cost of the goods at the same moment.',
      ['<b>New Invoice</b>, choose the customer, add lines.',
       'Stock items reduce stock and post their cost automatically; service lines do not.',
       'Set the due date from the customer’s terms, or override it.',
       'Save, then send or print.'],
      posts=[('Accounts Receivable', 'Sales Revenue and Output Tax'),
             ('Cost of Goods Sold', 'Inventory — posted as a second entry, at cost')],
      tip='The cost of sale is posted at the moment of the invoice, not at month end. Your gross profit is therefore right on any day you look at it.'),

    M('s-invoice-new', 'Building an invoice',
      'One screen: who, what, and on what terms.',
      ['Pick the customer — their terms, currency and tax status come with them.',
       'Add lines from your item list, or type a free-text line.',
       'Per-line discounts, a whole-document discount, and shipping are all handled, and the tax follows correctly.',
       'The totals panel shows subtotal, discount, tax and total as you type.']),

    M('d-invoice-view', 'Sending, printing and getting paid',
      'The document view is what your customer sees, and where you record what happens next.',
      ['<b>Record payment</b> — full or partial, to whichever account received it.',
       '<b>Print or PDF</b> — with your logo and, where enabled, a ZATCA-compliant QR code.',
       '<b>Return or refund</b> — raises a credit note against this invoice, line by line.'],
      posts=[('Bank or Cash', 'Accounts Receivable')]),

    M('s-recurring-invoices', 'Recurring and subscription invoices',
      'For anything billed on a cycle: retainers, maintenance contracts, rent you charge.',
      ['Set up the invoice once and choose the frequency.',
       'The system raises each invoice when it falls due.',
       'Pause or stop it at any time.']),

    M('s-payment-reminders', 'Payment reminders',
      'Chasing overdue money, with the wording already written.',
      ['Filter by how overdue you want to go.',
       'The reminder text is generated per customer with their outstanding invoices listed.',
       'Copy it into your email or messaging app.']),

    M('s-statements', 'Statements of account',
      'Two views of a customer’s account, for two different jobs.',
      ['<b>Full statement</b> — opening balance, every movement, closing balance. The view that reconciles.',
       '<b>Outstanding only</b> — what is still unpaid, with its age. The view for chasing money.',
       'Send as PDF, or copy a message ready to paste.']),

    M('s-delivery-notes', 'Delivery notes',
      'Proof that goods left the building. Raised from a sales order or on its own.',
      ['Create from a sales order, choosing quantities.',
       'Print for the driver and the customer to sign.']),

    M('s-customer-advances', 'Customer advances',
      'Deposits and money on account. Money received before you have earned it is a liability, not revenue, and this screen keeps that right.',
      ['Record the advance against the customer.',
       'Apply it to an invoice when you raise one.',
       'Refund whatever is left if the job does not happen.'],
      posts=[('Bank', 'Customer Advances — a liability until applied')]),

    M('s-credit-notes', 'Credit notes',
      'Returns, refunds and corrections that reduce what a customer owes.',
      ['Raise from the invoice to bring the lines across, or standalone.',
       'A return of stock puts the goods back and reverses their cost.'],
      posts=[('Sales Returns and Output Tax', 'Accounts Receivable')]),

    M('s-pos', 'Point of sale',
      'A touch-friendly till for counter trade, using the same items and posting the same way as an invoice.',
      ['Tap products to build the basket.',
       'Take payment by cash or card.',
       'The sale posts revenue, tax and cost immediately, and reduces stock.'],
      posts=[('Cash or Bank', 'Sales Revenue and Output Tax')]),

    M('s-commissions', 'Sales commissions',
      'Attributes invoices to sales representatives and tracks what they have earned.',
      ['Add each rep with their commission rate.',
       'Attribute invoices to them.',
       'The screen totals earned commission per rep.']),
])

section(6, 'Purchases', 'Everything you buy, and everyone you owe.', [
    M('s-requisitions', 'Purchase requisitions',
      'An internal request to buy something, before it becomes a commitment to a supplier.',
      ['Raise the request with what is needed and by when.',
       'It waits for approval.',
       'Once approved, convert it straight to a purchase order.']),

    M('s-suppliers', 'Suppliers',
      'Everyone you buy from, with their terms and their history.',
      ['Add the supplier with contact details, payment terms and tax number.',
       'Open any supplier to see every bill, payment and their current balance.']),

    M('s-purchase-quotes', 'Purchase quotes',
      'Prices you have been given but not yet accepted. Nothing posts.',
      ['Record what each supplier quoted.',
       'Convert the one you accept into a purchase order.']),

    M('s-purchase-orders', 'Purchase orders',
      'What you have committed to buy. Still no posting until the goods or the bill arrive.',
      ['Raise the order and send it to the supplier.',
       '<b>Receive goods</b> when they arrive — in full or partially. Stock goes up.',
       'Convert to a purchase invoice when the bill comes.',
       'The order shows what is still outstanding.'],
      tip='Receiving and billing are deliberately separate. Goods often arrive before the invoice does, and your stock should not wait for the paperwork.'),

    M('s-purchases', 'Purchase invoices',
      'Supplier bills. This is where a cost enters the books.',
      ['Choose the supplier and add lines.',
       'Point each line at the right account — stock items to inventory, everything else to an expense account.',
       'Record payment when you pay, in full or part.'],
      posts=[('Inventory or the expense account, and Input Tax', 'Accounts Payable'),
             ('Accounts Payable — on payment', 'Bank or Cash')]),

    M('s-debit-notes', 'Debit notes',
      'Returns to a supplier and corrections that reduce what you owe them.',
      ['Raise against the original bill.',
       'Returned stock is removed and its cost reversed.'],
      posts=[('Accounts Payable', 'Inventory or the expense account, and Input Tax')]),

    M('s-landed-costs', 'Landed costs',
      'Freight, duty, clearance and handling belong in the value of the goods, not in an expense account. This screen puts them there.',
      ['Enter the cost and what it should be spread across.',
       'Choose how to apportion it — by value or by quantity.',
       'Post. Each item’s cost price rises accordingly.'],
      posts=[('Inventory — apportioned across the items', 'Bank or Accounts Payable')],
      tip='Without this, your gross margin looks better than it is. Freight on imported stock is part of what the stock cost you.'),

    M('s-recurring-expenses', 'Recurring expenses',
      'Costs that arrive every month: rent, internet, subscriptions.',
      ['Set the amount, the account and the frequency.',
       'It posts when due, automatically.']),
])

section(7, 'Inventory and production', 'What you hold, what it cost, and what you make.', [
    M('s-inventory', 'Inventory items',
      'Your product and service catalogue. Each item carries its cost, its price, and how much you have.',
      ['Add items with a code, cost price, sale price and unit.',
       'Stock items are tracked and valued; service items are not.',
       'Set a reorder level to be warned before you run out.',
       'Barcodes can be scanned wherever items are picked.']),

    M('d-item-form', 'Adding an item',
      'The distinction that matters is at the top: is this something you hold, or something you do?',
      ['<b>Stock</b> — quantity and value are tracked, and selling it posts cost of goods sold.',
       '<b>Service or non-stock</b> — no quantity, no cost posting.',
       'Cost price is maintained by the system as you buy; you set the opening figure.']),

    M('s-inventory-control', 'Inventory control',
      'The analytical view: what your stock is worth, what is not moving, what needs reordering, and every movement behind the numbers.',
      ['Valuation shows what you are holding, at cost.',
       'Reorder planning lists what has fallen below its level.',
       'Movement history traces every in and out for any item.']),

    M('s-warehouses', 'Warehouses and locations',
      'Stock in more than one place, and transfers between them.',
      ['Add each location.',
       'Transfer stock between them; quantities move, total value does not change.']),

    M('s-stock-adjustments', 'Stock adjustments',
      'Writing stock up or down when reality disagrees with the system — breakage, loss, correction.',
      ['Record the item, the direction and the reason.',
       'Adjustments wait for approval before they post, so stock cannot be written off unnoticed.'],
      posts=[('Inventory (increase) or the write-off expense (decrease)', 'The write-off expense (increase) or Inventory (decrease)')]),

    M('s-stock-counts', 'Stock counts',
      'A physical count, done properly: count first, compare afterwards.',
      ['Start a count for a location.',
       'Scan or type each item you find, and the quantity.',
       'The system shows the variance against the book figure.',
       'Post it, and the adjustments are made for you.']),

    M('s-labels', 'Asset and item labels',
      'Printable barcode labels for shelf edges, products and fixed assets.',
      ['Select what to print.',
       'Skip the labels already used on a part-used sheet, so you do not waste the rest of it.']),

    M('s-manufacturing', 'Manufacturing',
      'Turning raw materials into finished goods, with the cost following the material through.',
      ['Define a bill of materials: what goes into one finished unit.',
       'Raise a work order for a quantity.',
       'Completing it consumes the components and creates the finished goods at their true cost.'],
      posts=[('Work in Progress', 'Raw Materials — as components are consumed'),
             ('Finished Goods', 'Work in Progress — on completion')]),
])

section(8, 'Projects, costs and assets', 'Longer-lived things that need spreading over time.', [
    M('s-projects', 'Projects and job costing',
      'Attributes income and cost to a job, so you can tell which work actually made money.',
      ['Create the project with its client and budget.',
       'Tag invoices and costs to it as you go.',
       'Log time against it.',
       'The project shows revenue, cost and margin.']),

    M('s-budgets', 'Budgets versus actuals',
      'What you planned to spend against what you did.',
      ['Set an annual budget per account.',
       'Actuals are read from the ledger automatically.',
       'The variance column is the whole point.']),

    M('s-prepaid-expenses', 'Prepaid expenses',
      'Something paid for up front that belongs to several months — insurance, an annual licence.',
      ['Record the payment, the number of months and the start date.',
       'The system releases a share to expense each month.'],
      posts=[('Prepaid Expenses', 'Bank — when paid'),
             ('The expense account', 'Prepaid Expenses — each month')]),

    M('s-leases', 'Leases and rent',
      'Rental agreements and the payments against them.',
      ['Record the lease with its term, monthly rent and landlord.',
       'Record each payment as it is made.'],
      posts=[('Rent Expense', 'Bank')]),

    M('s-expense-claims', 'Expense claims',
      'What staff spent on the company’s behalf and need back.',
      ['The claim is entered with its category and amount.',
       'It waits for approval.',
       'Once approved, pay it — and the reimbursement posts.'],
      posts=[('The expense account', 'Bank — on payment')]),

    M('s-fixed-assets', 'Fixed assets',
      'Things you own and use rather than sell, written down over their useful life.',
      ['Register the asset with its cost, expected life and salvage value.',
       'Run depreciation monthly — for every asset at once, with a preview before you post.',
       'Dispose of an asset when it goes, and the gain or loss is calculated for you.'],
      posts=[('Depreciation Expense', 'Accumulated Depreciation — monthly')],
      tip='Preview first. The preview and the posting are computed by the same code, so what you see is exactly what will post.'),
])

section(9, 'People and payroll', 'Paying staff correctly, month after month.', [
    M('s-departments', 'Departments',
      'Cost centres. Tag documents to a department and your reports can be read per department.',
      ['Add each department.',
       'Tag invoices, bills and journals as you enter them.']),

    M('s-employees', 'Employees',
      'The staff record: personal details, salary structure, and social insurance and tax status.',
      ['Add the employee with their start date and salary structure.',
       'Set whether social insurance (GOSI) and salary tax apply, and at what rates.',
       'Inactive staff drop out of payroll but keep their history.']),

    M('s-contracts', 'Employment contracts',
      'The salary structure that is actually in force, with dates. One contract per person per day, so a mid-year raise is handled properly.',
      ['Create the contract with basic, housing, transport and other allowances.',
       'Record working days, daily hours, leave entitlement and the overtime multiplier.',
       'End-of-service entitlement accrues from this.'],
      tip='Payroll reads the contract in force for the month being paid, not today’s. Backdated runs therefore come out right.'),

    M('s-attendance', 'Attendance',
      'Presence, absence and leave, month by month — and the numbers payroll needs.',
      ['Mark each day per employee, or fill the month in bulk.',
       'Overtime hours and lateness are recorded here.',
       'Payroll picks up the resulting overtime pay and absence deductions automatically.']),

    M('s-payroll', 'Payroll',
      'The monthly run. Earnings and deductions are proposed from each contract and attendance sheet; you edit any cell before committing.',
      ['<b>Run Payroll</b> and choose the pay month.',
       'Check the grid — basic, allowances, overtime, then lateness, absence, penalties, social insurance, tax and advance recovery.',
       '<b>Create</b> the run, then <b>Process</b> it to post the cost.',
       '<b>Pay</b> it to move the money and clear the liability.'],
      posts=[('Salaries and Wages, and Employer Social Insurance', 'Salaries Payable, Social Insurance Payable, Tax Payable, Employee Advances'),
             ('Salaries Payable — when paid', 'Bank')],
      tip='Processing and paying are separate steps, because the cost belongs to the month worked and the cash leaves whenever it leaves.'),

    M('d-payroll-run-form', 'Inside a payroll run',
      'One row per employee, one column per component. Everything is editable for this run only.',
      ['Figures come from the contract in force and that month’s attendance.',
       'The <b>Advance</b> column is filled from the employee’s loan schedule, capped so net pay can never go negative.',
       'The footer shows gross, total deductions and net, and the posting that will result.']),

    M('s-employee-advances', 'Employee advances and staff loans',
      'Money lent to an employee is an asset, not a cost — and it comes back through payroll a bit at a time, so nobody has to remember the deduction.',
      ['Issue the advance, choosing how much to deduct per payroll.',
       'Each payroll run recovers an instalment automatically.',
       'Record a cash repayment if it comes back outside payroll.',
       'Write it off if it truly is not coming back — that is the point at which it becomes a cost.'],
      posts=[('Employee Advances', 'Bank — when issued'),
             ('Salaries Payable', 'Employee Advances — each payroll'),
             ('Staff Costs', 'Employee Advances — only if written off')]),
])

section(10, 'Reports and analysis', 'Turning the ledger into answers.', [
    M('s-reports', 'Reports',
      'The statutory set, on any date range you choose: profit & loss, balance sheet, trial balance, general ledger, cash flow, ageing, and the tax return.',
      ['Choose the report and the period.',
       'Drill from any figure into the entries behind it.',
       'Export to PDF or Excel.'],
      tip='The trial balance is the health check. If it balances, the double-entry engine has done its job.'),

    M('d-reports-pl', 'Reading a report',
      'Every report is built live from journal entries. There is nothing to rebuild and nothing to post first.',
      ['Change the dates and the report recalculates.',
       'Comparative columns show the prior period alongside.',
       'Figures are clickable: follow one down to the entries that produced it.']),

    M('s-analytics', 'Business analytics',
      'Charts over your trading: revenue trend, top customers, top products, expense mix.',
      ['Choose the period.',
       'Use it to spot a direction, then use Reports to prove it.']),

    M('s-trade-analytics', 'Sales and purchasing analytics',
      'Order-to-cash and procure-to-pay at a glance — how long it takes to get paid, and how quickly you pay.',
      ['Review conversion from quote to order to invoice.',
       'Check average days to collect and to pay.']),

    M('s-financial-health', 'Financial health',
      'Key ratios that turn the ledger into a check-up: liquidity, profitability, efficiency and leverage, with a weighted overall read.',
      ['P&L ratios use the trailing twelve months; balance sheet ratios use current balances.',
       'Each ratio explains itself in plain words.'],
      tip='Useful as a prompt for a conversation with your accountant, not as a substitute for one.'),

    M('s-consolidation', 'Group consolidation',
      'Adds several companies together into one profit & loss and balance sheet.',
      ['Choose which companies to include.',
       'Figures are summed by account.'],
      tip='Companies on different base currencies are added at face value, with no FX translation. The screen says so; take it seriously before publishing group figures.'),

    M('s-audit-log', 'Audit log',
      'Who did what, and when. Written by the system, not by you.',
      ['Every create, edit and delete is recorded.',
       'Filter by date, user or kind of action.']),
])

section(11, 'Tax and multi-currency', 'Getting the compliance side right.', [
    M('s-currencies', 'Currencies and exchange rates',
      'Trade in more than one currency while keeping one set of books in your base currency.',
      ['Add each currency you trade in, with its rate.',
       'Documents can be raised in a foreign currency and are recorded in base at the rate of the day.']),

    M('s-revaluation', 'FX revaluation',
      'Foreign-currency balances drift as rates move. Revaluation brings them back to today’s rate and books the difference.',
      ['Enter the closing rate for each currency.',
       'The screen shows the current base value and the revalued figure.',
       'Post, and the difference lands in FX gain or loss.'],
      posts=[('The foreign-currency account (or FX Loss)', 'FX Gain (or the foreign-currency account)')]),

    M('s-year-end', 'Year-end close',
      'Review the year, lock the books, and roll the profit into equity. There are no closing journal entries to prepare — the system does it.',
      ['Work through the review checklist.',
       'Close the year. The books lock through the closing date.',
       'Profit is rolled into retained earnings.',
       'A year can be reopened if you must.'],
      posts=[('Revenue accounts', 'Retained Earnings — and expenses the other way')]),
])

section(12, 'Keeping your data safe', 'The most important section in this guide.', [
    M('s-import-export', 'Import and export',
      'Getting data in from spreadsheets, and out again.',
      ['Import customers, suppliers, items and more from CSV.',
       'Map your columns to the fields; the preview shows what will happen before anything is written.',
       'Export any list to CSV or Excel.']),

    M('s-recycle-bin', 'Recycle bin',
      'Deleting is not destroying. Almost everything you delete lands here first.',
      ['Restore anything deleted by mistake, together with the entry behind it.',
       'Empty it deliberately when you are certain.']),

    M('s-approvals', 'Approvals',
      'Makes chosen actions require a second pair of eyes before they post.',
      ['Choose in Settings which kinds of document need approval.',
       'Requests queue here for whoever can decide them.',
       'Approving posts immediately; rejecting asks for a reason.']),

    M('s-team', 'Team and roles',
      'More than one person on the same books, with different levels of access.',
      ['Add each user and give them a role.',
       'Only Owners and Admins can manage the team.']),
])


# ── Front matter, workflows and reference ───────────────────────────
INTRO = """
<p class="lead">This guide covers every part of the system, screen by screen, with a picture of each one.
You do not need to read it in order. Section&nbsp;1 gets you running; after that, read the section for
whatever you are trying to do today.</p>

<div class="callout">
  <h4>What this system is</h4>
  <p>A complete double-entry accounting and business system for a small or medium company: sales, purchases,
  inventory, manufacturing, projects, fixed assets, payroll and reporting, with VAT&nbsp;/&nbsp;GST, sales tax
  and Saudi ZATCA e-invoicing built in. It works in English and Arabic, and every screen is designed for both.</p>
  <p><b>Your data stays on your own device.</b> There is no server holding your books, no subscription that can
  expire and lock you out, and nothing to configure before you start. That also means backups are yours to take
  — which is what Section&nbsp;12 is about.</p>
</div>

<h3>The one idea worth understanding first</h3>
<p>Every figure in every report is built from <b>journal entries</b>, and every journal entry balances: the debits
equal the credits, always. You will rarely write one by hand. Instead you raise an invoice, record a payment, run
payroll — and the system writes the entry for you, correctly, every time.</p>
<p>That is why this guide tells you, for each screen, <b>what it posts</b>. Once you can see where a document lands
in the ledger, nothing in the system is mysterious any more.</p>
<table class="posting">
  <tr><th>When you do this</th><th>Debit (what increases)</th><th>Credit (where it came from)</th></tr>
  <tr><td>Raise a sales invoice</td><td>Accounts Receivable</td><td>Sales Revenue + Output Tax</td></tr>
  <tr><td>Customer pays it</td><td>Bank</td><td>Accounts Receivable</td></tr>
  <tr><td>Enter a supplier bill</td><td>Inventory or expense + Input Tax</td><td>Accounts Payable</td></tr>
  <tr><td>Pay the supplier</td><td>Accounts Payable</td><td>Bank</td></tr>
</table>
<p>Nothing else in this guide is harder than that.</p>
"""

WORKFLOWS = """
<h2><span class="secnum">13</span>Everyday workflows</h2>
<p class="sectionblurb">The handful of sequences you will actually repeat. Each one strings together screens
covered earlier.</p>

<div class="workflow">
  <h3>Quote to cash</h3>
  <ol>
    <li><b>Quotations</b> — raise the offer and send it. Nothing posts.</li>
    <li><b>Sales orders</b> — convert the accepted quote. Still nothing posts.</li>
    <li><b>Delivery notes</b> — convert when goods go out, in full or part.</li>
    <li><b>Sales invoices</b> — convert when you bill. <i>Revenue, tax and cost of sale post here.</i></li>
    <li><b>Record payment</b> on the invoice when the money lands.</li>
    <li><b>Statements</b> or <b>Payment reminders</b> if it does not.</li>
  </ol>
</div>

<div class="workflow">
  <h3>Purchase to pay</h3>
  <ol>
    <li><b>Requisitions</b> — someone asks for it; it is approved.</li>
    <li><b>Purchase orders</b> — commit to the supplier.</li>
    <li><b>Receive goods</b> against the order as they arrive. <i>Stock goes up.</i></li>
    <li><b>Purchase invoices</b> — enter the bill. <i>The cost and the input tax post here.</i></li>
    <li><b>Landed costs</b> — add freight and duty into the stock value if there was any.</li>
    <li><b>Record payment</b> when you pay.</li>
  </ol>
</div>

<div class="workflow">
  <h3>The payroll month</h3>
  <ol>
    <li><b>Attendance</b> — complete the month: absence, lateness, overtime.</li>
    <li><b>Payroll → Run Payroll</b> — figures arrive from contracts and attendance. Check the grid.</li>
    <li><b>Create</b>, then <b>Process</b>. <i>The cost posts to the month worked.</i></li>
    <li><b>Pay</b> when the transfer goes out. <i>The liability clears.</i></li>
    <li><b>Employee advances</b> wind down on their own as part of the run.</li>
  </ol>
</div>

<div class="workflow">
  <h3>Month end, in order</h3>
  <ol>
    <li><b>Bank reconciliation</b> — every account, to zero difference.</li>
    <li><b>Cheque register</b> — clear anything that has cleared.</li>
    <li><b>Fixed assets</b> — preview, then run depreciation.</li>
    <li><b>Prepaid expenses</b> — release this month's share.</li>
    <li><b>Recurring journals and expenses</b> — post anything due.</li>
    <li><b>FX revaluation</b> — if you hold foreign currency.</li>
    <li><b>Stock counts</b> — if it is a counting month.</li>
    <li><b>Reports → Trial balance</b> — confirm it balances, then read the P&amp;L and balance sheet.</li>
    <li><b>Settings → Period lock</b> — lock the month so it cannot drift.</li>
  </ol>
</div>

<div class="workflow">
  <h3>The tax return</h3>
  <ol>
    <li><b>Reports → Tax return</b> — choose the period.</li>
    <li>Check output tax against sales and input tax against purchases.</li>
    <li>Drill into any figure that looks wrong; it will lead you to the document.</li>
    <li>Export, file, then record the payment as a bank transaction against the tax account.</li>
  </ol>
</div>

<div class="workflow">
  <h3>Year end</h3>
  <ol>
    <li>Complete a normal month end for the final month.</li>
    <li><b>Year-End Close</b> — work through the review checklist.</li>
    <li>Close the year. The books lock and profit rolls into retained earnings.</li>
    <li>Take a backup and keep it somewhere else. See the next section.</li>
  </ol>
</div>
"""

SAFETY = """
<h2><span class="secnum">14</span>Backups — read this one</h2>
<p class="sectionblurb">Everything else in this guide can be learned by clicking around. This part cannot.</p>

<div class="callout warn">
  <h4>Your books live on this device</h4>
  <p>That is what makes the system fast, private and free of subscriptions. It also means that if the device is
  lost, stolen or wiped, and you have no backup, the books are gone. Nobody can recover them for you — not even
  the developer, because nobody else ever had a copy.</p>
</div>

<h3>The three things to set up today</h3>
<ol class="bigsteps">
  <li><b>Take a backup now.</b> <i>Settings → Download Backup.</i> One file, everything in it. Put it somewhere
  that is not this device — cloud storage, an external drive, an email to yourself.</li>
  <li><b>Encrypt it if it leaves your control.</b> Tick <i>Encrypt</i> and set a passphrase before downloading.
  The file is then useless to anyone without it — including you, so keep the passphrase safe.</li>
  <li><b>Know how to restore.</b> <i>Settings → Restore from File.</i> It replaces everything currently in the
  company, then reloads. Practise it once on a test company so it is not new to you the day you need it.</li>
</ol>

<h3>What else protects you</h3>
<ul class="checks">
  <li><b>Local snapshots</b> — the system keeps rolling restore points automatically, up to eight. Good for
  "I have just done something silly", not a substitute for an off-device backup.</li>
  <li><b>Recycle bin</b> — deleted documents and their entries can be restored.</li>
  <li><b>Audit log</b> — a record of who changed what.</li>
  <li><b>Period lock</b> — closed months cannot be edited by accident.</li>
  <li><b>Approvals</b> — chosen actions need a second person before they post.</li>
</ul>

<div class="callout">
  <h4>A backup routine that works</h4>
  <p>Monthly, after you reconcile: download a backup, name it with the date, and keep the last twelve. Yearly,
  after the year-end close: keep that one forever.</p>
</div>
"""

REFERENCE = """
<h2><span class="secnum">15</span>Quick reference</h2>

<h3>Keyboard</h3>
<table class="ref">
  <tr><th>Shortcut</th><th>Does</th></tr>
  <tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd> / <kbd>⌘</kbd>+<kbd>K</kbd></td><td>Search and command palette — go anywhere</td></tr>
  <tr><td><kbd>Esc</kbd></td><td>Close the dialog you are in</td></tr>
</table>

<h3>Document statuses</h3>
<table class="ref">
  <tr><th>Status</th><th>Means</th></tr>
  <tr><td>Draft</td><td>Entered but not committed. Nothing has posted.</td></tr>
  <tr><td>Open / Unpaid</td><td>Posted and outstanding.</td></tr>
  <tr><td>Partially paid</td><td>Some money received or paid; a balance remains.</td></tr>
  <tr><td>Paid / Settled</td><td>Nothing left outstanding.</td></tr>
  <tr><td>Overdue</td><td>Past its due date and still unpaid.</td></tr>
  <tr><td>Cancelled / Void</td><td>Withdrawn. Any posting has been reversed.</td></tr>
</table>

<h3>Where things land in the ledger</h3>
<table class="posting">
  <tr><th>Action</th><th>Debit</th><th>Credit</th></tr>
  <tr><td>Sales invoice</td><td>Accounts Receivable</td><td>Sales Revenue, Output Tax</td></tr>
  <tr><td>Cost of that sale</td><td>Cost of Goods Sold</td><td>Inventory</td></tr>
  <tr><td>Customer payment</td><td>Bank</td><td>Accounts Receivable</td></tr>
  <tr><td>Customer advance</td><td>Bank</td><td>Customer Advances</td></tr>
  <tr><td>Cheque received</td><td>Cheques Under Collection</td><td>Accounts Receivable</td></tr>
  <tr><td>Cheque cleared</td><td>Bank</td><td>Cheques Under Collection</td></tr>
  <tr><td>Credit note</td><td>Sales Returns, Output Tax</td><td>Accounts Receivable</td></tr>
  <tr><td>Purchase invoice</td><td>Inventory or expense, Input Tax</td><td>Accounts Payable</td></tr>
  <tr><td>Supplier payment</td><td>Accounts Payable</td><td>Bank</td></tr>
  <tr><td>Landed cost</td><td>Inventory</td><td>Bank or Accounts Payable</td></tr>
  <tr><td>Payroll processed</td><td>Salaries, Employer Social Insurance</td><td>Salaries Payable, Social Insurance Payable, Tax Payable</td></tr>
  <tr><td>Payroll paid</td><td>Salaries Payable</td><td>Bank</td></tr>
  <tr><td>Advance to employee</td><td>Employee Advances</td><td>Bank</td></tr>
  <tr><td>Advance recovered</td><td>Salaries Payable</td><td>Employee Advances</td></tr>
  <tr><td>Depreciation</td><td>Depreciation Expense</td><td>Accumulated Depreciation</td></tr>
  <tr><td>Prepaid released</td><td>The expense account</td><td>Prepaid Expenses</td></tr>
  <tr><td>Work order completed</td><td>Finished Goods</td><td>Work in Progress</td></tr>
  <tr><td>Year-end close</td><td>Revenue accounts</td><td>Retained Earnings</td></tr>
</table>

<h3>If something looks wrong</h3>
<table class="ref">
  <tr><th>Symptom</th><th>Look here first</th></tr>
  <tr><td>Bank balance disagrees with the bank</td><td>Cheque register — held cheques are not in the bank yet. Then Bank reconciliation.</td></tr>
  <tr><td>Profit looks too good</td><td>Landed costs not capitalised; depreciation not run; accruals not posted.</td></tr>
  <tr><td>Stock quantity is negative</td><td>Goods sold before the purchase was entered. Enter the bill or receive the order.</td></tr>
  <tr><td>Customer balance is negative</td><td>An advance or a cheque recorded against an invoice that was not there.</td></tr>
  <tr><td>A report will not balance</td><td>Reports → Trial balance, then Journal entries for anything unusual.</td></tr>
  <tr><td>You deleted something by mistake</td><td>Recycle bin.</td></tr>
</table>
"""

# ── Render ──────────────────────────────────────────────────────────
def render_module(m):
    out = ['<div class="module">']
    out.append(f'<h3>{esc(m.title)}</h3>')
    out.append(f'<p class="purpose">{m.purpose}</p>')
    img = f'{IMG}/{m.img}.jpg'
    if os.path.exists(os.path.join('web', img)):
        out.append(f'<figure><img src="{img}" alt="{esc(m.title)}"></figure>')
    if m.steps:
        out.append('<ol class="steps">')
        for s in m.steps:
            out.append(f'<li>{s}</li>')
        out.append('</ol>')
    if m.posts:
        out.append('<table class="posting small"><tr><th>Debit</th><th>Credit</th></tr>')
        for d, c in m.posts:
            out.append(f'<tr><td>{d}</td><td>{c}</td></tr>')
        out.append('</table>')
    if m.tip:
        out.append(f'<p class="tip"><b>Tip.</b> {m.tip}</p>')
    out.append('</div>')
    return '\n'.join(out)


def render():
    parts = []
    # Cover
    parts.append("""
<div class="cover">
  <div class="cover-mark">◩</div>
  <h1>ERP Accounting</h1>
  <p class="cover-sub">Complete user guide</p>
  <p class="cover-desc">Double-entry accounting, sales, purchasing, inventory, manufacturing,
  projects, fixed assets and payroll — for small and medium businesses.</p>
  <div class="cover-meta">
    <span>English &amp; العربية</span>
    <span>VAT / GST / ZATCA</span>
    <span>Works offline</span>
  </div>
</div>
<div class="pb"></div>
""")
    # Contents
    parts.append('<h2 class="nonum">Contents</h2><div class="toc">')
    for s in SECTIONS:
        parts.append(f'<div class="toc-sec"><span class="n">{s["num"]}</span><span class="t">{esc(s["title"])}</span></div>')
        for m in s['modules']:
            parts.append(f'<div class="toc-item">{esc(m.title)}</div>')
    for n, t in [(13, 'Everyday workflows'), (14, 'Backups — read this one'), (15, 'Quick reference')]:
        parts.append(f'<div class="toc-sec"><span class="n">{n}</span><span class="t">{t}</span></div>')
    parts.append('</div><div class="pb"></div>')

    # Intro
    parts.append('<h2 class="nonum">Before you start</h2>')
    parts.append(INTRO)
    parts.append('<div class="pb"></div>')

    for s in SECTIONS:
        parts.append(f'<h2><span class="secnum">{s["num"]}</span>{esc(s["title"])}</h2>')
        parts.append(f'<p class="sectionblurb">{esc(s["blurb"])}</p>')
        for m in s['modules']:
            parts.append(render_module(m))
        parts.append('<div class="pb"></div>')

    parts.append(WORKFLOWS)
    parts.append('<div class="pb"></div>')
    parts.append(SAFETY)
    parts.append('<div class="pb"></div>')
    parts.append(REFERENCE)
    return '\n'.join(parts)


CSS = """
@page { size: A4; margin: 16mm 14mm 18mm 14mm; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 10.2pt; line-height: 1.55; color: #1e293b; margin: 0;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1, h2, h3, h4 { color: #0f172a; line-height: 1.25; }
.pb { page-break-after: always; }

/* Cover */
.cover {
  height: 250mm; display: flex; flex-direction: column; justify-content: center;
  padding: 0 6mm; border-left: 4mm solid #2563eb;
}
.cover-mark { font-size: 40pt; color: #2563eb; line-height: 1; margin-bottom: 10mm; }
.cover h1 { font-size: 40pt; margin: 0 0 2mm; letter-spacing: -1.2px; font-weight: 800; }
.cover-sub { font-size: 17pt; color: #2563eb; margin: 0 0 12mm; font-weight: 600; }
.cover-desc { font-size: 12pt; color: #475569; max-width: 130mm; margin: 0 0 18mm; line-height: 1.6; }
.cover-meta { display: flex; gap: 4mm; flex-wrap: wrap; }
.cover-meta span {
  font-size: 8.6pt; font-weight: 600; color: #1d4ed8; background: #eff6ff;
  border: 1px solid #bfdbfe; border-radius: 20px; padding: 1.6mm 4mm;
}

/* Headings */
h2 {
  font-size: 19pt; margin: 0 0 3mm; padding-bottom: 3mm; font-weight: 800;
  border-bottom: 2px solid #2563eb; letter-spacing: -0.4px;
  page-break-after: avoid;
}
h2 .secnum {
  display: inline-block; min-width: 11mm; height: 11mm; line-height: 11mm; text-align: center;
  background: #2563eb; color: #fff; border-radius: 3mm; font-size: 12pt; margin-right: 4mm;
  vertical-align: 1mm;
}
h2.nonum { }
.sectionblurb { color: #64748b; font-size: 10.6pt; margin: 0 0 7mm; font-style: italic; }
h3 { font-size: 12.4pt; margin: 0 0 1.5mm; font-weight: 700; page-break-after: avoid; }

/* Contents */
.toc { column-count: 2; column-gap: 10mm; }
.toc-sec { break-inside: avoid; margin: 4mm 0 1.5mm; font-weight: 700; color: #0f172a; font-size: 10.6pt; }
.toc-sec .n {
  display: inline-block; min-width: 6mm; color: #2563eb; font-weight: 800;
}
.toc-item {
  font-size: 9.3pt; color: #475569; padding-left: 6mm; break-inside: avoid;
  border-left: 1px solid #e2e8f0; margin-left: 1mm;
}

/* Modules */
.module { page-break-inside: avoid; margin: 0 0 9mm; }
.purpose { margin: 0 0 3mm; color: #334155; }
figure { margin: 0 0 3mm; }
figure img {
  width: 100%; display: block; border: 1px solid #cbd5e1; border-radius: 2mm;
}
ol.steps { margin: 0 0 3mm; padding-left: 5.5mm; }
ol.steps li { margin-bottom: 1.2mm; }
.lead { font-size: 11pt; color: #334155; }

/* Callouts */
.callout {
  background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3mm solid #2563eb;
  border-radius: 2mm; padding: 4mm 5mm; margin: 0 0 5mm; page-break-inside: avoid;
}
.callout h4 { margin: 0 0 2mm; font-size: 11pt; }
.callout p { margin: 0 0 2mm; }
.callout p:last-child { margin-bottom: 0; }
.callout.warn { border-left-color: #dc2626; background: #fef2f2; border-color: #fecaca; }
.tip {
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 2mm;
  padding: 2.6mm 3.5mm; margin: 0; font-size: 9.4pt; color: #78350f;
}

/* Tables */
table { width: 100%; border-collapse: collapse; margin: 0 0 5mm; font-size: 9.4pt; page-break-inside: avoid; }
th {
  text-align: left; background: #1e293b; color: #fff; font-weight: 600;
  padding: 2mm 3mm; font-size: 8.8pt; text-transform: uppercase; letter-spacing: 0.4px;
}
td { padding: 2mm 3mm; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
tr:nth-child(even) td { background: #f8fafc; }
table.posting th { background: #0f766e; }
table.posting.small { margin-bottom: 3mm; font-size: 9pt; }
table.posting td:first-child { color: #9a3412; font-weight: 600; }
table.posting td:last-child { color: #1e40af; font-weight: 600; }
table.ref th { background: #334155; }

/* Workflows */
.workflow {
  border: 1px solid #e2e8f0; border-radius: 2mm; padding: 4mm 5mm; margin: 0 0 5mm;
  page-break-inside: avoid; background: #fff;
}
.workflow h3 { color: #2563eb; margin-bottom: 2mm; }
.workflow ol { margin: 0; padding-left: 5.5mm; }
.workflow li { margin-bottom: 1.4mm; }
ol.bigsteps { padding-left: 5.5mm; }
ol.bigsteps li { margin-bottom: 3mm; }
ul.checks { padding-left: 5mm; }
ul.checks li { margin-bottom: 1.6mm; }
kbd {
  background: #f1f5f9; border: 1px solid #cbd5e1; border-bottom-width: 2px;
  border-radius: 1mm; padding: 0.3mm 1.4mm; font-size: 8.6pt; font-family: inherit;
}
"""

OUT = os.environ.get('GUIDE_DIR', '.guide-build')
os.chdir(OUT)
os.makedirs('web', exist_ok=True)
body = render()
doc = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>ERP Accounting — Complete User Guide</title>
<style>{CSS}</style>
</head><body>
{body}
</body></html>"""
with open('web/guide.html', 'w') as f:
    f.write(doc)
print('written web/guide.html', round(len(doc) / 1024, 1), 'KB')
print('modules:', sum(len(s['modules']) for s in SECTIONS), 'in', len(SECTIONS), 'sections')
