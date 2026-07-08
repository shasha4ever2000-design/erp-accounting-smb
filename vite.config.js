import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// When BUILD_TARGET=electron we build a desktop bundle that loads from the
// local filesystem (relative paths, hash routing) instead of GitHub Pages.
const isElectron = process.env.BUILD_TARGET === 'electron'

export default defineConfig({
  plugins: [react()],
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
