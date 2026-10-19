// ATTR-009 in a browser: the example careers page (docs/careers-page-example.html),
// served from its own origin the way a Webflow site is, lists Lodge's published
// jobs from the public board with departments, offices and pay, and applies
// through the board's submit endpoint from that allowed origin.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function careersSite(root) {
  const html = await readFile(join(root, 'docs/careers-page-example.html'))
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html) })
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
