import { defineConfig, devices } from '@playwright/test'

const isCI = 'CI' in process.env

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: isCI ? 1 : 0,
  reporter: isCI ? 'github' : 'list',
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
