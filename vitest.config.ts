import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    passWithNoTests: true,
    // unit tests run in plain node; *.nuxt.test.ts opt into a full Nuxt environment
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
})
