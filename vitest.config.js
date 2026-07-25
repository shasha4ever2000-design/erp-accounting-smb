import { defineConfig } from 'vitest/config'

// The accounting engine is framework-agnostic (a Zustand store of pure double-
// entry logic), so the suite runs in a plain Node environment with a couple of
// lightweight browser-global shims (see test/setup.js) — no jsdom needed, which
// keeps it fast and deterministic.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
  },
})
