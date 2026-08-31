import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// The payroll engine is pure TypeScript with no DOM and no Supabase import, so
// the test environment is plain node. `@/` has to be re-declared here because
// vitest does not read tsconfig paths on its own.
//
// The pay-cycle math in src/lib/payroll.ts does reach the Supabase module for
// its calibration fetchers, and that module reads its URL at import time. The
// placeholders below only have to exist for the client to construct — nothing
// under test makes a request.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
