import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'

// Fill public/sw.js's precache list with every file of the build, so the
// installed app works offline on pages that were never opened while online.
function offlinePrecache() {
  let outDir = 'dist'
  return {
    name: 'offline-precache',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir },
    closeBundle() {
      const swPath = join(outDir, 'sw.js')
      if (!existsSync(swPath)) return
      const walk = (dir) => readdirSync(dir).flatMap((f) => {
        const p = join(dir, f)
        return statSync(p).isDirectory() ? walk(p) : [p]
      })
      const files = walk(outDir)
        .map((p) => relative(outDir, p).split('\\').join('/'))
        .filter((f) => f !== 'sw.js' && f !== 'index.html' && !f.endsWith('.map') && !f.startsWith('.'))
        .sort()
      const hash = createHash('sha256')
      files.forEach((f) => hash.update(f).update(readFileSync(join(outDir, f))))
      const version = hash.digest('hex').slice(0, 12)
      const sw = readFileSync(swPath, 'utf8')
        .replace("const VERSION = 'dev'", `const VERSION = '${version}'`)
        .replace('[/*__PRECACHE__*/]', JSON.stringify(files.map((f) => './' + f)))
      writeFileSync(swPath, sw)
    },
  }
}

// When BUILD_TARGET=electron we build a desktop bundle that loads from the
// local filesystem (relative paths, hash routing) instead of GitHub Pages.
const isElectron = process.env.BUILD_TARGET === 'electron'

export default defineConfig({
  plugins: [react(), offlinePrecache()],
  base: isElectron ? './' : '/erp-accounting-smb/',
  build: {
    outDir: isElectron ? 'dist-electron-web' : 'dist',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split heavy vendor libraries into their own cacheable chunks so the
        // entry bundle stays small. recharts (~charts) only downloads on the
        // handful of pages that render charts.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
          'vendor-utils': ['date-fns', 'uuid', 'zustand', 'qrcode'],
        },
      },
    },
  },
})
