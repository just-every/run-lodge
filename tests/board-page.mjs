// ATTR-009 and ATTR-008 in a browser. The example careers page
// (docs/careers-page-example.html), served from its own origin the way a Webflow
// site is, lists Lodge's published jobs from the public board with departments,
// offices and pay, and applies through the board's submit endpoint. A host page
// on that origin pastes the embed snippet: the board renders in its frame, is
// applied to by keyboard, and is refused on a site that is not listed.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A third-party site: `/` is the example careers page, `/embed-host` a page with the embed snippet (`?lodge=` names Lodge, `&department=` presets the filter). */
export async function careersSite(root) {
  const html = await readFile(join(root, 'docs/careers-page-example.html'))
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://site'), lodge = url.searchParams.get('lodge') ?? ''
    const attr = key => (url.searchParams.get(key) ?? '').replaceAll('&', '&amp;').replaceAll('\"', '&quot;').replaceAll('<', '&lt;')
    const snippet = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Join us</title></head><body style="margin:0;padding:16px;font-family:sans-serif"><h1>Join us</h1><script src="${lodge}/embed.js" data-department="${attr('department')}" data-legacy-source="${attr('legacy-source')}" data-legacy-parameter="${attr('legacy-parameter')}" async></script><noscript><a href="${lodge}/jobs">See our open roles</a></noscript></body></html>`
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(url.pathname === '/embed-host' ? snippet : html)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) }
}

/** Open the careers page at one width, check the listed job, filter, open it and apply; returns the receipt. */
export async function careersPage(browser, { lodge, site, board, job, width, evidence, email }) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } })
  try {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${site}/?lodge=${encodeURIComponent(lodge)}&board=${board}&utm_source=webflow&utm_campaign=careers-${width}`)
    const card = page.getByRole('list', { name: 'Open roles' }).getByRole('listitem').filter({ has: page.getByRole('heading', { name: job.title }) })
    await card.waitFor()
    const text = await card.textContent()
    for (const part of [job.department, job.office, job.pay]) assert.ok(text.includes(part), `the careers page shows ${part}: ${text}`)
    await page.getByLabel('Department').selectOption({ label: `${job.department} (1)` })
    await page.getByRole('status').filter({ hasText: '1 open role' }).waitFor()
    await page.screenshot({ path: join(evidence, `careers-page-list-${width}.png`), fullPage: true })
    await card.getByRole('button', { name: 'View ' + job.title }).click()
    await page.getByLabel('Full name').fill('Jules Moreno')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Resume', { exact: false }).setInputFiles({ name: 'jules.txt', mimeType: 'text/plain', buffer: Buffer.from('Jules Moreno\nYard lead 2019-2026\n') })
    await page.getByLabel('I have read privacy notice', { exact: false }).check()
    const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
    assert.ok(scroll <= inner + 1, `careers page at ${width}: no sideways scrolling (${scroll} > ${inner})`)
    await page.screenshot({ path: join(evidence, `careers-page-apply-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: 'Submit application' }).click()
    await page.getByRole('heading', { name: 'Application received' }).waitFor()
    const receipt = (await page.getByText(/^Receipt LDG-/).textContent()).replace('Receipt ', '')
    assert.deepEqual(errors, [], 'no page errors')
    return receipt
  } finally {
    await context.close()
  }
}

/** The embed snippet on an allowed host page: the frame fits its content, a department preset filters, an applicant applies by keyboard, and the receipt shows in the frame; returns the receipt. */
export async function embedPage(browser, { lodge, site, job, width, evidence, email }) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } })
  try {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${site}/embed-host?lodge=${encodeURIComponent(lodge)}&department=${job.departmentId}&utm_source=webflow-embed`)
    const frame = page.frameLocator('iframe[title="Open roles"]')
    const link = frame.getByRole('link', { name: job.title })
    await link.waitFor()
    const titles = await frame.getByRole('list').getByRole('link').allTextContents()
    assert.deepEqual(titles, [job.title], 'the snippet’s preset department filters the frame')
    // Sized to its content: the frame's height follows the page inside it.
    await page.waitForFunction(() => { const f = document.querySelector('iframe'); return f && f.style.height })
    await page.screenshot({ path: join(evidence, `embed-list-${width}.png`), fullPage: true })
    await link.focus()
    await page.keyboard.press('Enter')
    const name = frame.getByLabel('Full name')
    await name.waitFor()
    await name.focus()
    await page.keyboard.type('Wren Hale')
    await page.keyboard.press('Tab')
    await page.keyboard.type(email)
    await frame.getByLabel('Resume', { exact: false }).setInputFiles({ name: 'wren.txt', mimeType: 'text/plain', buffer: Buffer.from('Wren Hale\nSupport lead 2020-2026\n') })
    const inner = page.frames().find(f => f.url().startsWith(lodge + '/embed/jobs/'))
    const active = () => inner.evaluate(() => document.activeElement?.getAttribute('name') ?? document.activeElement?.tagName)
    for (let i = 0; i < 30 && await active() !== 'consent'; i++) await page.keyboard.press('Tab')
    await page.keyboard.press('Space')
    // What a screen reader announces: every field by its label, the notice confirmation and the submit button.
    const tree = await frame.locator('form').ariaSnapshot()
    for (const line of ['textbox "Full name"', 'textbox "Email"', 'checkbox "I have read privacy notice version', 'button "Submit application"']) assert.ok(tree.includes(line), `${line} in ${tree}`)
    await page.screenshot({ path: join(evidence, `embed-apply-${width}.png`), fullPage: true })
    for (let i = 0; i < 10 && await active() !== 'BUTTON'; i++) await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await frame.getByRole('heading', { name: 'Application received' }).waitFor()
    const receipt = (await frame.locator('dd').first().textContent()).trim()
    const { scroll, innerWidth } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
    assert.ok(scroll <= innerWidth + 1, `embed host at ${width}: no sideways scrolling`)
    assert.deepEqual(errors, [], 'no page errors')
    return receipt
  } finally {
    await context.close()
  }
}

/** The same snippet on a site that is not listed: the browser refuses to frame Lodge. */
export async function embedRefused(browser, { lodge, site }) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(`${site}/embed-host?lodge=${encodeURIComponent(lodge)}`)
    await page.waitForSelector('iframe')
    await page.waitForTimeout(1500)
    assert.equal(await page.frameLocator('iframe').getByRole('heading', { name: /Open roles/ }).count(), 0, 'framing refused on an unlisted site')
  } finally {
    await context.close()
  }
}

/** Without JavaScript the snippet is a link to the hosted roles, where the applicant applies. */
export async function embedFallback(browser, { lodge, site, job, email }) {
  const context = await browser.newContext({ javaScriptEnabled: false })
  try {
    const page = await context.newPage()
    await page.goto(`${site}/embed-host?lodge=${encodeURIComponent(lodge)}`)
    await page.getByRole('link', { name: 'See our open roles' }).click()
    await page.getByRole('link', { name: job.title }).click()
    await page.getByLabel('Full name').fill('Noor Patel')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('I have read privacy notice', { exact: false }).check()
    await page.getByRole('button', { name: 'Submit application' }).click()
    await page.getByRole('heading', { name: 'Application received' }).waitFor()
  } finally {
    await context.close()
  }
}
