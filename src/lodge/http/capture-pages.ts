import { Hono, type Context } from 'hono'
import type { Bindings } from '../../auth.server'
import { actorFor, load, save, signedIn } from '../core/store'
import { canSeeContact } from '../core/access'
import { Fault, requireThat, type Data } from '../core/types'
import { captureAddress, captureList, captureSettings, resolveCapture } from '../records/capture'
import { esc, formBody, page } from './public'

/** Private staff pages use the same frame, fields and download doors as existing Lodge pages. */
export const capturePages = new Hono<{ Bindings: Bindings }>()
capturePages.use('*', async (c, next) => { await next(); c.header('referrer-policy', 'same-origin'); c.header('cache-control', 'no-store') })
capturePages.onError(e => page('Capture unavailable', `<h1>Capture unavailable</h1><p role="alert">${esc(e instanceof Fault ? e.message : 'Please try again later.')}</p><p><a href="/app">Back to workspace</a></p>`, e instanceof Fault ? e.status : 500))
const staff = async (c: Context<{ Bindings: Bindings }>) => {
  const session = await signedIn(c.req.raw, c.env), s = await load(c.env.DB), a = actorFor(session, s)
  captureSettings(s, a)
  return { s, a }
}
const nav = '<p><a href="/app">Workspace</a> · <a href="/capture">Your capture queue</a> · <a href="/capture/settings">Capture settings</a></p>'
const card = (mail: Data) => `<article><h2>${esc(mail.subject || 'Email without a subject')}</h2><p>Captured ${esc(new Date(mail.receivedAt).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }))} UTC · ${esc(mail.attachments.length)} ${mail.attachments.length === 1 ? 'attachment' : 'attachments'}</p><div class="sign-doc">${esc(mail.body || 'This email has no plain-text body. HTML is kept inert.')}</div><ul>${mail.attachments.map((f: Data) => `<li><a href="/api/lodge/capture/${esc(mail.id)}/file/${esc(f.id)}">Download ${esc(f.name)}</a> · ${esc(f.size)} bytes</li>`).join('')}</ul></article>`

capturePages.get('/capture/settings', async c => {
  const { s, a } = await staff(c), address = captureSettings(s, a)
  return page('Capture settings', `<h1>Capture settings</h1>${nav}<p>BCC or forward outside email from your saved member address. Keep your capture address private. Capture never sends a message.</p>${address ? `<p>Your private capture address: <code>${esc(address)}</code></p>` : '<p>You have no capture address yet.</p>'}${c.env.CAPTURE_DOMAIN ? `<form action="/capture/settings" method="post"><label><input type="checkbox" name="confirm" value="yes" required> Keep this address in my own mail client; rotation stops my previous address.</label><button>${address ? 'Rotate capture address' : 'Create capture address'}</button></form>` : '<p role="status">The owner has not configured an inbound email routing domain.</p>'}`)
})
capturePages.post('/capture/settings', async c => {
  const { s, a } = await staff(c), input = await formBody(c)
  requireThat(input.get('confirm') === 'yes', 'Confirm private address custody first')
  captureAddress(s, a, c.env.CAPTURE_DOMAIN)
  await save(c.env.DB, s, a)
  return c.redirect('/capture/settings', 303)
})
capturePages.get('/capture', async c => {
  const { s, a } = await staff(c), mails = captureList(s, a)
  const options = s.all('candidate').filter(person => !person.deleted && !person.mergedInto && canSeeContact(s, a, person))
  return page('Your capture queue', `<h1>Your capture queue</h1>${nav}<p>Unmatched email stays here until you choose a candidate. Only you can read this queue; current contact access is checked again when you file it.</p>${mails.length ? mails.map(mail => `${card(mail)}<form method="post" action="/capture/${esc(mail.id)}/resolve"><label>File ${esc(mail.subject || 'email without a subject')} on candidate<select name="candidate" required><option value="">Choose a candidate</option>${options.map(person => `<option value="${esc(person.id)}">${esc(person.name)}</option>`).join('')}</select></label><button>File captured email</button></form>`).join('') : '<p>No unmatched email is waiting.</p>'}`)
})
capturePages.post('/capture/:id/resolve', async c => {
  const { s, a } = await staff(c), input = await formBody(c)
  const result = resolveCapture(s, a, { id: c.req.param('id'), candidate: input.get('candidate') })
  await save(c.env.DB, s, a)
  return c.redirect('/capture/candidate/' + encodeURIComponent(result.candidate), 303)
})
capturePages.get('/capture/candidate/:id', async c => {
  const { s, a } = await staff(c), id = c.req.param('id'), mails = captureList(s, a, id), person = s.get('candidate', id)
  return page('Captured candidate email', `<h1>Captured email for ${esc(person.name)}</h1>${nav}<p>Original outside email, available only with current contact access. Lodge did not send it.</p>${mails.length ? mails.map(card).join('') : '<p>No outside email has been filed on this candidate.</p>'}`)
})
