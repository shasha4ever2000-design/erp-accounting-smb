# ERP Accounting System for SMBs

A clean, easy-to-use accounting ERP for small and medium businesses — service and retail.  
Inspired by [Manager.io](https://www.manager.io). All data is stored locally in the browser (no backend required).

## Features

| Module | Description |
|--------|-------------|
| **Dashboard** | KPI cards, revenue vs expenses chart, quick actions |
| **Chart of Accounts** | 26 pre-loaded accounts (Asset, Liability, Equity, Revenue, Expense) |
| **Customers** | Contact management with accounts receivable balance |
| **Suppliers** | Contact management with accounts payable balance |
| **Sales Invoices** | Create, send, record payments, print — with multi-line items & tax |
| **Purchase Invoices** | Record bills from suppliers, track payments |
| **Bank & Cash** | Direct money-in / money-out transactions |
| **Inventory** | Products & services with cost/sale price, stock levels, low-stock alerts |
| **Journal Entries** | Manual double-entry; auto-generated from every transaction |
| **Reports** | Income Statement, Balance Sheet, Trial Balance, General Ledger, AR & AP Aging |
| **Settings** | Company info, 11 currencies (USD/EUR/GBP/AED/SAR/EGP…), VAT/GST, invoice numbering |

## Tech Stack

- **React 18** + **Vite 5**
- **Tailwind CSS 3**
- **Zustand** (state management with localStorage persistence)
- **React Router v6**
- **Recharts** (dashboard charts)
- **Lucide React** (icons)
- **date-fns** (date utilities)

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Accounting Principles

This system uses **double-entry bookkeeping**. Every transaction automatically creates balanced journal entries:

- **Sales Invoice** → Dr: Accounts Receivable / Cr: Revenue + Tax Payable
- **Receipt from Customer** → Dr: Bank/Cash / Cr: Accounts Receivable
- **Purchase Invoice** → Dr: Expense/Inventory + Input Tax / Cr: Accounts Payable
- **Payment to Supplier** → Dr: Accounts Payable / Cr: Bank/Cash

All financial reports (P&L, Balance Sheet, Trial Balance) are derived from these journal entries.

## Data Storage

All data is saved in your browser's `localStorage`. No account, no server, no internet required.  
To back up your data: **Settings → Export** (coming soon) or use your browser's developer tools.

## License

MIT
