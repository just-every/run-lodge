// CRM-009 in a browser: on a 390-pixel phone a recruiter creates a campus fair
// linked to a job, captures one person online with a resume photo the browser
// downsizes to 1 MB (the stored file is the one shown), one offline (the
// unsynced count shows, sign-out warns and offers sync, and the capture syncs
// once back online), deletes an offline capture only after the warning, and an
// attendee registers from the event's QR link. The pool then holds them at 1440.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { current, session } from './browser-journey.mjs'

/** A 24-bit BMP of noise, far over 1 MB, as a phone camera photo stands in for. */
function bigPhoto(width = 1400, height = 1000) {
  const row = Math.ceil(width * 3 / 4) * 4, size = 54 + row * height
  const b = Buffer.alloc(size)
  b.write('BM'); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14)
  b.writeInt32LE(width, 18); b.writeInt32LE(height, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * height, 34)
  randomBytes(row * height).copy(b, 54)
  return b
}

const tab = (page, name) => page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name, exact: true }).click()
const noSideways = async (page, what) => {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
  assert.ok(scroll <= inner + 1, `${what}: no sideways scrolling (${scroll} > ${inner})`)
}
const pending = page => page.evaluate(() => new Promise((resolve, reject) => {
  const r = indexedDB.open('lodge-event-captures', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('captures', { keyPath: 'captureId' })
  r.onsuccess = () => { const q = r.result.transaction('captures').objectStore('captures').count(); q.onsuccess = () => { r.result.close(); resolve(q.result) } }
  r.onerror = () => reject(r.error)
}))

export async function eventsPage(browser, { root, origin, job, evidence, name = 'Campus career fair' }) {
  const phone = await session(browser, root, origin, 'owner', 390)
  const page = phone.page, event = () => page.getByRole('article', { name })
  try {
    await tab(page, 'Events')
    await page.getByText('Create an event', { exact: true }).click()
    await page.getByLabel('Event name').fill(name)
    await page.getByLabel('Event type').selectOption('campus')
    await page.getByLabel('Event date').fill('2026-11-04')
    await page.getByLabel('Where it is').fill('State U student center')
    await page.getByLabel('Budget in USD').fill('3000')
    await page.getByLabel(job.title, { exact: true }).check()
    await page.getByRole('button', { name: 'Create event' }).click()
    await event().waitFor()
    const unsynced = n => event().getByText(`${n} captured on this device, not synced yet`).waitFor()
    await unsynced(0)

    // Online, with a photo over 1 MB: the browser shows the downsized JPEG it will store.
    const capture = async (who, contact) => {
      await event().getByLabel('Their name').fill(who)
      await event().getByLabel(contact.includes('@') ? 'Their email' : 'Their phone').fill(contact)
      await event().getByLabel(/They were shown privacy notice version/).check()
    }
    await capture('Ada Brooks', 'ada.brooks@example.test')
    await event().getByLabel('Resume file or a photo of it').setInputFiles({ name: 'ada-resume.bmp', mimeType: 'image/bmp', buffer: bigPhoto() })
    await event().getByText(/Will be stored as ada-resume\.jpg/).waitFor()
    const shown = await page.evaluate(async () => {
      const bytes = await (await fetch(document.querySelector('.capture-photo img').src)).arrayBuffer()
      return { size: bytes.byteLength, sha: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('') }
    })
    assert.ok(shown.size <= 1_000_000, `the photo is downsized to the 1 MB limit (${shown.size})`)
    await event().getByLabel('They agree to be contacted about suitable roles').check()
    await event().getByRole('button', { name: 'Save capture' }).click()
    await event().getByText('Ada Brooks', { exact: true }).waitFor()
    await unsynced(0)
    const w = await current(phone.context, origin)
    const ada = w.events.find(e => e.name === name).pool.find(p => p.name === 'Ada Brooks')
    assert.deepEqual([ada.source, ada.consent.toContact, ada.consent.noticeVersion], ['Event: ' + name, true, w.business.notices.at(-1).version])
    const doc = w.documents.find(d => d.candidate === ada.candidate)
    const stored = await phone.context.request.get(`${origin}/api/lodge/download/document/${doc.id}`)
    const bytes = await stored.body()
    assert.deepEqual([doc.name, doc.mediaType, createHash('sha256').update(bytes).digest('hex')], ['ada-resume.jpg', 'image/jpeg', shown.sha], 'the stored file is the one the recruiter saw')

    // Offline: the capture stays on the phone, the count shows it, sign-out warns with the count and offers sync.
    await phone.context.setOffline(true)
    await capture('Ben Okafor', '+1 555 0177')
    await event().getByRole('button', { name: 'Save capture' }).click()
    await unsynced(1)
    await page.screenshot({ path: join(evidence, 'event-capture-offline-390.png'), fullPage: true })
    await page.getByRole('button', { name: 'Sign out' }).click()
    const warning = page.getByRole('alertdialog', { name: 'Unsynced captures' })
    await warning.getByText('1 person captured on this device is not synced yet.').waitFor()
    assert.equal(await warning.getByRole('button', { name: 'Sync now, then sign out' }).count(), 1)
    await warning.getByRole('button', { name: 'Cancel' }).click()
    // Back online, it syncs once.
    await phone.context.setOffline(false)
    await unsynced(0)
    const pool = async () => (await current(phone.context, origin)).events.find(e => e.name === name).pool
    assert.deepEqual((await pool()).filter(p => p.name === 'Ben Okafor').map(p => [p.source, p.phone]), [['Event: ' + name, '+1 555 0177']])

    // A capture deleted at sign-out goes only after the warning, and never reaches Lodge.
    await phone.context.setOffline(true)
    await capture('Cleo Park', 'cleo.park@example.test')
    await event().getByRole('button', { name: 'Save capture' }).click()
    await unsynced(1)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await warning.getByRole('button', { name: 'Delete them and sign out' }).click()
    await page.getByRole('alert').filter({ hasText: 'could not be reached to sign out' }).waitFor()
    assert.equal(await pending(page), 0, 'the warned-about capture is deleted from the phone')
    await phone.context.setOffline(false)
    assert.ok(!(await pool()).some(p => p.name === 'Cleo Park'))

    // The QR code links the self-registration page.
    const qr = await event().getByRole('img', { name: /^QR code for / }).getAttribute('aria-label')
    const link = qr.replace('QR code for ', '')
    assert.match(link, new RegExp(`^${origin.replace(/[.]/g, '\\.')}/events/[a-f0-9]{48}$`))
    await noSideways(page, 'events at 390')
    await page.screenshot({ path: join(evidence, 'events-390.png'), fullPage: true })
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.waitForURL(/\/signin/)
    assert.equal(await pending(page), 0)

    // An attendee scans the code on their own phone and registers.
    const attendee = await browser.newContext({ viewport: { width: 390, height: 900 } })
    try {
      const p = await attendee.newPage()
      await p.goto(link)
      await p.getByLabel('Full name').fill('Dev Raman')
      await p.getByLabel('Email').fill('dev.raman@example.test')
      await p.getByLabel(/I have read privacy notice version/).check()
      assert.equal(await p.getByLabel(/You may contact me/).isChecked(), false, 'contact consent starts unchecked')
      await noSideways(p, 'event registration at 390')
      await p.getByRole('button', { name: 'Register' }).click()
      await p.getByRole('heading', { name: 'Thank you, you are registered' }).waitFor()
      await p.screenshot({ path: join(evidence, 'event-registered-390.png'), fullPage: true })
    } finally { await attendee.close() }
  } finally { await phone.context.close() }

  // At 1440 the event pool holds the three people with their source and consent, none with an application.
  const desk = await session(browser, root, origin, 'owner', 1440)
  try {
    await tab(desk.page, 'Events')
    await desk.page.getByRole('article', { name }).getByText('Dev Raman', { exact: true }).waitFor()
    const e = (await current(desk.context, origin)).events.find(x => x.name === name)
    assert.deepEqual(e.pool.map(p => [p.name, p.by === 'attendee', p.applications.length]).sort(), [['Ada Brooks', false, 0], ['Ben Okafor', false, 0], ['Dev Raman', true, 0]])
    assert.equal(e.report.attendees, 3)
    await noSideways(desk.page, 'events at 1440')
    await desk.page.screenshot({ path: join(evidence, 'events-1440.png'), fullPage: true })
  } finally { await desk.context.close() }
}
