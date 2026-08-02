// GitHub Pages has no server-side rewrite, so a request for a path that is not
// a real file — /erp-accounting-smb/purchases/<id>, say — is a 404 before the
// app ever loads. Clicking through to a document works, because that is
// client-side routing; refreshing the page you are looking at, or opening a
// link somebody sent you, does not.
//
// Pages serves 404.html for anything it cannot find, so shipping a copy of
// index.html under that name hands those requests to the app instead. The
// router reads the path and shows the right document, and the asset URLs are
// absolute, so they resolve from any depth.
//
// Desktop builds go through `build:electron`, which does not run this — they
// use HashRouter off the filesystem and have no 404 to intercept.
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const dist = resolve(process.cwd(), 'dist')
const index = resolve(dist, 'index.html')

if (!existsSync(index)) {
  console.error('spa-fallback: dist/index.html is missing — did the build run?')
  process.exit(1)
}

copyFileSync(index, resolve(dist, '404.html'))
console.log('spa-fallback: wrote dist/404.html')
