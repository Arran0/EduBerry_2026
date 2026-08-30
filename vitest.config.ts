import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// The payroll engine is pure TypeScript with no DOM and no Supabase import, so
// the test environment is plain node. `@/` has to be re-declared here because
// vitest does not read tsconfig paths on its own.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
