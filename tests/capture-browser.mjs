import { pathToFileURL } from 'node:url'
import { checkCapture } from './capture-flow.mjs'

export async function capturePage(browser, evidence) {
 const cleanup = []
 try { await checkCapture({ after: fn => cleanup.push(fn) }, { browser, evidence }) }
 finally { for (const close of cleanup.reverse()) await close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const { chromium } = await import(process.env.LODGE_PLAYWRIGHT_MODULE || '@playwright/test')
 const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
 try { await capturePage(browser, process.env.LODGE_EVIDENCE || '.cache/capture-proof') }
 finally { await browser.close() }
 console.log('COM-004 native email, candidate, queue and settings screens passed')
}
