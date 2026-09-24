// Every relative import in src/ resolves to a real file.
//
// Dynamic imports (`await import('./x')`) only fail when the line runs, and
// the unit suite never runs some of them (cloud sync, reset). Moving code
// between folders broke exactly those once, so this checks them statically.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(js|jsx)$/.test(n) ? [p] : []
  })
}
const exists = (base) => ['', '.js', '.jsx', '/index.js'].some((ext) => existsSync(base + ext))

describe('relative imports', () => {
  it('all resolve', () => {
    const broken = []
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8')
      const specs = [...src.matchAll(/(?:from\s+|import\s*\(\s*)'(\.{1,2}\/[^']+)'/g)].map((m) => m[1])
      for (const spec of specs) {
        if (!exists(resolve(dirname(file), spec))) broken.push(`${file}: ${spec}`)
      }
    }
    expect(broken).toEqual([])
  })
})
