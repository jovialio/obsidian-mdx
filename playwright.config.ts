import { defineConfig, devices } from '@playwright/test'

const ci = (process.env as Record<string, string | undefined>)['CI']

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: ci !== undefined ? 1 : 0,
  reporter: ci !== undefined ? 'github' : 'list',
  use: {
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
