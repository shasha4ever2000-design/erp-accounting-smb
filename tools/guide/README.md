# Building the guides

Four PDFs live in `docs/`, all generated:

| | What it is |
| --- | --- |
| `ERP-Accounting-User-Guide.pdf` | Screen by screen — every module, what it is for, how to use it. |
| `ERP-Every-Transaction.pdf` | Forty worked transactions — the figures, the screen, and a picture of the journal entry each one produces. |
| `…-AR.pdf` | Arabic editions of both, right-to-left, with the app itself captured in Arabic. |

## The Arabic editions

`GUIDE_LANG=ar` changes three things:

1. **The seed runs `arabize.mjs`** — the interface translates itself, but the *books* do not.
   Account names, customers, items and staff are data, so an Arabic reader would otherwise get
   Arabic headings over an English chart of accounts. `arabize.mjs` renames all 62 default
   accounts and the master data, then rewrites every denormalised `*Name` field on documents —
   invoices copy the customer name onto themselves at creation, so renaming the customer alone
   never reaches them.
2. **The capture script switches the app to Arabic** before taking any screenshot, and asserts
   `<html dir>` actually became `rtl` rather than trusting the click.
3. **The builders (`*_ar.py`) typeset right-to-left** — mirrored borders, padding and table
   alignment, and Noto Sans Arabic. Install it with
   `apt-get install fonts-noto-core fonts-hosny-amiri`; without an Arabic face the PDF renders
   boxes.

### Known limits of the Arabic editions

Two things stay English in the screenshots, because the application generates them in English:

- **Journal entry descriptions.** `store.js` builds these from templates
  (`Sales Invoice ${number} – ${customerName}`) that are not passed through `i18n`. The
  *accounts* in every entry are Arabic; the description line above them is not.
- **The printed invoice template** — `INVOICE`, `BILL TO`, `Subtotal`, `Total`, and the
  amount-in-words line.

Both are real localisation gaps in the product rather than in the guide. Fixing them means
routing those strings through `i18n.js`; the guides will pick the change up on the next build.

They share this folder. The screen guide uses `seed.mjs` / `capture.mjs` /
`build_guide.py`; the transaction guide uses `seed-transactions.mjs` /
`capture-transactions.mjs` / `build_tx_guide.py` / `to-pdf-transactions.mjs`.

## The transaction guide, specifically

`seed-transactions.mjs` performs one example of every transaction and writes
`tx-manifest.json` recording the journal entries each produced. The build script
reads that manifest, so the figures quoted in the prose and the screenshots
underneath them cannot drift apart. Each example also declares how many entries
it *should* produce; a mismatch is reported rather than silently accepted, which
is how the guide caught three of its own errors:

- a goods receipt followed by a standalone purchase invoice double-counted
  inventory. Billing goods already received is `billReceivedPO`, which clears
  the GRNI liability instead of debiting Inventory a second time.
- `settings.tax.enabled` is **false** until a region is chosen, so anything that
  computes its own tax produced zero VAT while hand-passed figures showed 15%.
- a stock write-off posted a zero-value entry because the seed omitted
  `unitCost`; the form computes `quantity × unitCost` and refuses a zero, so
  only a direct store call can do this.

None of those were application bugs, but all three would have been printed as
fact.

---

`docs/ERP-Accounting-User-Guide.pdf` is generated, not hand-written. Every screenshot in it
comes from the real application driven by a browser, filled with a demo company that was built
by calling the real store actions — so nothing in the guide can drift away from what the app
actually does without the build noticing.

## The pipeline

| Step | Script | What it does |
| --- | --- | --- |
| 1 | `seed.mjs` | Builds a complete demo company (30 modules, all double-entry) and writes `demo-backup.json`. Also writes `seed-report.txt` with the headline balances — check it: profit should be positive and nothing should be negative that shouldn't be. |
| 2 | `capture.mjs` | Signs up, creates a company, restores the backup through **Settings → Restore from File**, then screenshots ~70 screens. |
| 3 | `capture-extras.mjs` | The handful of screens that need driving first: dark mode, attendance on a month with a sheet, the company switcher. |
| 4 | `build_guide.py` | Assembles `web/guide.html` from the screenshots plus the written content. All the prose lives in this file. |
| 5 | `to-pdf.mjs` | Prints the HTML to A4 PDF via headless Chromium. |

## Running it

Everything writes into `$GUIDE_DIR` (default `.guide-build/`, git-ignored).

```bash
# 1. Seed. Runs under vitest so Vite's extensionless imports resolve.
#    Wrap seed.mjs in a test file, run it, then delete the wrapper:
{ echo "import { it } from 'vitest'";
  echo "it('seed', async () => {";
  sed "s#^import \(.*\) from '\(\.\./\)*\(src/[^']*\)'#const \1 = await import('../\3')#" tools/guide/seed.mjs;
  echo "})"; } > test/zz-seed.test.js
npx vitest run test/zz-seed.test.js && rm test/zz-seed.test.js

# 2-3. Capture. Needs the built app being served.
npx vite build && npx vite preview --port 4180 &
BASE=http://localhost:4180/erp-accounting-smb node tools/guide/capture.mjs
BASE=http://localhost:4180/erp-accounting-smb node tools/guide/capture-extras.mjs

# 4-5. Assemble.
python3 -c "from PIL import Image" || pip install Pillow
python3 tools/guide/shrink.py       # PNG → JPEG, 1600px wide
python3 tools/guide/build_guide.py
node tools/guide/to-pdf.mjs
```

Playwright needs a Chromium binary; set `executablePath` in the capture scripts if yours is
not at `/opt/pw-browsers/chromium`.

## Editing the guide

Prose, section order and the "what it posts" tables are all in `build_guide.py`, in the
`SECTIONS` list. Adding a module means adding one `M(...)` entry and a screenshot name — the
image is looked up as `img/<name>.jpg` and quietly skipped if it is missing, so you can write
the copy before capturing the screen.

## Why the demo data is shaped the way it is

The guide is a shop window. An earlier pass shipped screenshots of a company with a negative
bank balance, negative receivables and a net loss, all of which were artefacts of the seed
rather than the software: not enough opening capital for the spending, a customer cheque
larger than the invoice it settled, and raw materials given a quantity without ever being
bought. `seed.mjs` now funds the company properly, buys what it consumes, and prints the
resulting balances so a regression is visible before ninety pages get rendered.
