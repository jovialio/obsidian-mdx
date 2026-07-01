import { defineConfig, devices } from '@playwright/test'

const proc = process as unknown as { env: Record<string, string | undefined> }
const isCI = 'CI' in proc.env

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
