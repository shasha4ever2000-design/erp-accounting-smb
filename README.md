# ERP Accounting for small and medium businesses

A double-entry accounting and ERP app for small and medium businesses — service,
retail, trading and light manufacturing. It runs in the browser, installs as an
app, works offline, and speaks English and Arabic (right-to-left). Inspired by
[Manager.io](https://www.manager.io).

## What it covers

| Area | Highlights |
|------|------------|
| **Ledger** | Chart of accounts with groups, journal entries, recurring journals, period lock, year-end close, month-end close checklist, tamper-evident hash chain on every entry |
| **Sales** | Quotations → sales orders → invoices, receipts, early-settlement discounts, returns (credit notes), customer advances, recurring invoices, payment reminders, POS, CRM pipeline |
| **Purchases** | Requisitions, purchase quotes and orders, goods receipts with 3-way match, bills, payments with withholding tax, returns (debit notes), recurring bills, landed costs |
| **Inventory** | Products and services, kits, weighted-average or FIFO costing, multiple warehouses, stock counts and cycle counts, manufacturing (BOMs and work orders) |
| **Banking** | Bank and cash accounts, cheques, transfers, bank-feed rules, reconciliation, foreign currencies and FX revaluation |
| **HR & payroll** | Employees, contracts, attendance, payroll with GOSI, end-of-service benefits, salary advances, expense claims |
| **Assets** | Fixed assets with depreciation and disposal, prepaid expenses, IFRS 16 leases |
| **Reporting** | P&L, balance sheet, cash flow, trial balance, general ledger, AR/AP ageing, VAT return (ZATCA layout), IFRS 9 expected credit losses, IAS 12 deferred tax, notes to the accounts, budgets, margins, custom reports |
| **Compliance** | ZATCA QR codes (Saudi Arabia), ETA e-invoice export (Egypt), sales-tax returns for other regions |

## Tech stack

React 18 · Vite 5 · Tailwind CSS 3 · Zustand · React Router 6 · Recharts ·
Lucide icons · date-fns · optional Supabase for cloud sync · Electron for the
desktop build.

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173/erp-accounting-smb/
```

| Command | What it does |
|---|---|
| `npm test` | Unit tests for the accounting engine (Vitest, ~2,100 tests) |
| `npm run lint` | ESLint — catches missing imports, undefined names and hook mistakes |
| `npm run e2e` | Builds, then runs the end-to-end tests in Chromium (Playwright) |
| `npm run build` | Production build into `dist/` |
| `npm run dist` | Desktop installers (Electron) |

CI runs lint, the unit tests, the build and the end-to-end tests on every push.

## How the code is organised

- `src/store.js` — the single Zustand store every screen uses, plus the data
  migrations between versions. The store itself is built from slices in
  `src/store/` (`ledger`, `sales`, `purchases`, `inventory`, `banking`, `hr`,
  `assets`, `reporting`, `settings`, `parties`, `data`) with shared helpers in
  `src/store/shared.js`.
- `src/utils/` — pure accounting logic (costing, VAT, IFRS calculations,
  ageing, the ledger hash chain...). Most of the tests live here.
- `src/pages/`, `src/components/` — the screens. Shared UI pieces (buttons,
  tables, the `Money` component, in-app dialogs) are in `components/UI.jsx`
  and `components/Dialogs.jsx`.
- `src/locales/ar.js` — the Arabic dictionary, loaded only when Arabic is used.
- `supabase/` — the database schema for optional cloud sync, and the `ai-chat`
  Edge Function for the AI assistant.

## Accounting principles

Everything is double-entry. Every document posts balanced journal entries (to
the cent), and every report is built from those entries:

- **Sales invoice** → Dr Accounts Receivable / Cr Revenue + Output VAT; stocked items also Dr Cost of Sales / Cr Inventory
- **Receipt** → Dr Bank / Cr Accounts Receivable (plus any realised FX difference)
- **Purchase bill** → Dr Expense or Inventory + Input VAT / Cr Accounts Payable
- **Payment** → Dr Accounts Payable / Cr Bank (plus withholding tax and FX)

Posted documents are corrected by editing (while nothing depends on them) or by
voiding, which posts reversing entries and keeps the original for the audit
trail. Voiding also voids any returns raised against the document.

## Your data

Books are stored on your own device in IndexedDB, per company. Nothing leaves
the device unless you:

- **download a backup** (Settings → Backup; optionally encrypted), or
- **link the company to the cloud** (Supabase, with row-level security so only
  that company's members can read it).

Backups and cloud sync never include your AI API key. For shared companies, the
AI assistant can instead run through the `ai-chat` Edge Function, which keeps
the key on the server:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy ai-chat
```

then tick **Use the company's cloud assistant** in Settings → AI Assistant.

## Keyboard shortcuts

`Ctrl/⌘ K` search · `Alt I` new invoice · `Alt B` new bill · `Alt Q` new
quotation · `Alt J` journals · `Alt C` customers · `Alt R` reports · `Alt D`
dashboard · `?` show all.

## License

MIT
