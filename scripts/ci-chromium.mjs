// Hosted Ubuntu runners already carry Chrome's shared libraries. Download the
// checkout's pinned browser, prove it launches, and install OS packages only
// when Playwright reports missing libraries. Every caller still runs its full
// hydration or browser journey afterwards.
import { spawnSync } from 'node:child_process'
import { chromium } from '@playwright/test'

function provision(args) {
  const result = spawnSync('pnpm', ['exec', 'playwright', ...args], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Playwright ${args.join(' ')} failed (${result.status ?? result.signal})`)
}
async function launch() {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  await browser.close()
}
provision(['install', 'chromium'])
try {
  await launch()
} catch (error) {
  if (!/Host system is missing dependencies|error while loading shared libraries/i.test(String(error))) throw error
  console.log('Installing missing Chromium system libraries before verification.')
  provision(['install-deps', 'chromium'])
  await launch()
}
console.log('Pinned Chromium is ready for verification.')
