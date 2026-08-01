# Building the user guide

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
