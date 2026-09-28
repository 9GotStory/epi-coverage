import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Run tests inside the real Workers runtime (workerd) — native Request/Response/
// ReadableStream/crypto.subtle — never pretending Node is the production runtime.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
