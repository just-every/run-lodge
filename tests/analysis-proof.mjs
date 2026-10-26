import { analysisSchedulePage } from './analysis-schedule-browser.mjs'
import { analysisPage } from './analysis-browser.mjs'
const { chromium } = await import(process.env.LODGE_PLAYWRIGHT_MODULE || '@playwright/test')
const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
try { await analysisPage(browser, process.env.LODGE_EVIDENCE || '.cache/analysis-proof'); await analysisSchedulePage(browser, process.env.LODGE_EVIDENCE || '.cache/analysis-proof') }
finally { await browser.close() }
console.log('Recruiting analysis setup, charts, edited evidence, saved definitions and refusal passed at both widths')
