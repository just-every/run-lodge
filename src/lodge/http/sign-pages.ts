import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { businessZone, times } from '../core/time'
import { load, readBlob, save } from '../core/store'
import { Fault, base64ToBytes, type Data } from '../core/types'
import type { State } from '../core/state'
import { agree, byCopyLink, byLink, copySession, requestCode, requestCopyCode, sign, usable, verifyCode, verifyCopyCode, withdraw } from '../esign/flow'
import { event } from '../esign/envelope'
import { sessionFor } from '../esign/gate'
import { codeMail, deliver, flushNotices, mailReady, record } from '../esign/mail'
import { edgeOf } from './esign'
import { esc, formBody, page, sameOrigin } from './public'

// OFFER-005 candidate doors (no sign-in): the signing page at /sign/<token> and the signed-copy page at /copy/<token>.
// Every page is no-store, no-referrer and never framed; every POST needs the exact Origin; the verified session is an
// HttpOnly, Secure, SameSite=Strict cookie scoped to the envelope's own path.

type C = Context<{ Bindings: Bindings }>
export const signPages = new Hono<{ Bindings: Bindings }>()
signPages.onError(async error => error instanceof Fault ? shell('Not accepted', `<h1>That did not go through</h1><p role="alert">${esc(error.message)}</p>`, error.status) : shell('Error', '<h1>Something went wrong</h1><p>Nothing was saved. Please try again.</p>', 500))

export const isSignPage = (path: string) => path.startsWith('/sign/') || path.startsWith('/copy/')

async function shell(title: string, body: string, status = 200) {
  const response = await page(title, body, status)
  // same-origin sends nothing to other sites; browsers send Origin: null on form posts under no-referrer, which the exact-Origin check would refuse.
  response.headers.set('referrer-policy', 'same-origin')
  return response
}
const unavailable = () => shell('Not available', '<h1>This link is not available</h1><p>The signing request may have ended. Contact the employer who sent it.</p>', 404)
const secret = (c: C) => runtimeBindings(c.env).SESSION_SECRET
const mask = (address: string) => address.replace(/^(.).*(@.*)$/, '$1***$2')
const attachment = (bytes: Uint8Array | string, type: string, name: string, extra: Record<string, string> = {}) => new Response(bytes as BodyInit, { headers: { 'content-type': type, 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', ...extra } })

function session(c: C, name: string, path: string, token: string, until: string) {
  const age = Math.max(0, Math.floor((Date.parse(until) - Date.now()) / 1000))
  c.header('set-cookie', `${name}=${token}; Path=${path}; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`)
}

const form = (path: string, button: string, inner = '') => `<form method="post" action="${esc(path)}">${inner}<button type="submit">${esc(button)}</button></form>`
const note = (error: string, notice: string) => (error ? `<p role="alert" class="error">${esc(error)}</p>` : '') + (notice ? `<p role="status">${esc(notice)}</p>` : '')
const paragraphs = (v: string) => esc(v).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')

function signingView(s: State, e: Data, token: string, signedIn: Data | undefined, error: string, notice: string) {
  const base = `/sign/${token}`, t = times(businessZone(s.find('business', 'main')))
  const head = `<h1>Offer for signature</h1><p class="meta">From ${esc(e.businessName)} · for ${esc(e.recipientName)} · link expires ${esc(t.stamped(e.expiresAt))}</p>${note(error, notice)}`
  const contact = `<p>Questions? Contact ${esc(e.contact.name)} at ${esc(e.contact.email)}.</p>`
  if (e.status === 'completed') return head + (signedIn ? `<p>This offer is signed by everyone.</p><ul class="downloads"><li><a href="${base}/sealed.pdf">Download the signed offer (PDF)</a></li><li><a href="${base}/certificate.pdf">Download the completion certificate (PDF)</a></li></ul>` : `<p>This offer is signed. Use the copy link we emailed you to get your copy.</p>`) + contact
  if (e.status === 'candidate-signed') return head + `<p>You signed this offer. It now waits for ${esc(e.businessName)} to countersign. We will email you a link to your signed copy when it is complete.</p>` + contact
  if (!signedIn) return head + `<h2>Verify your email</h2><p>We send a one-time code to ${esc(mask(e.recipient))}.</p>${form(base + '/code', 'Email me a code')}<h2>Enter your code</h2>${form(base + '/verify', 'Verify', '<label>Six-digit code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>')}` + contact
  const withdrawal = `<h2>Change your mind?</h2>${form(base + '/withdraw', 'Withdraw consent')}<p class="hint">Withdrawing stops electronic signing of this offer. The offer stays open and the employer may continue on paper.</p>`
  if (e.consent?.fingerprint !== e.disclosure.fingerprint) return head + `<h2>Consent to electronic signing</h2><div class="disclosure">${paragraphs(e.disclosure.text)}</div>${form(base + '/agree', 'Agree', `<input type="hidden" name="version" value="${esc(e.disclosure.version)}"><label class="check"><input type="checkbox" name="box" value="yes" required> I have read this and I agree to sign this offer electronically.</label>`)}${withdrawal}`
  const doc = s.get('offer', e.offer).document
  return head + `<h2>Review the offer</h2><p>SHA-256 of this exact document: <code>${esc(doc.sha256)}</code> · <a href="${base}/document">Download it</a></p><pre class="sign-doc" tabindex="0">${esc(doc.text)}</pre><h2>Sign</h2><p>By selecting Sign I sign this offer letter electronically.</p>${form(base + '/sign', 'Sign', `<input type="hidden" name="hash" value="${esc(doc.sha256)}"><label>Type your full name<input name="name" autocomplete="name" maxlength="200" required></label>`)}${withdrawal}` + contact
}

async function render(c: C, s: State, e: Data, token: string, error = '', notice = '', status = 200) {
  const signedIn = await sessionFor(e.gate, getCookie(c, 'lodge_sign'))
  return shell('Offer for signature', signingView(s, e, token, signedIn, error, notice), status)
}

/** Resolve the link and its envelope, run a step, and always save what it recorded (a wrong code count, a lock, an expiry). */
async function step<T extends { ok: boolean; message?: string; status?: number }>(c: C, work: (s: State, e: Data) => Promise<T>) {
  await sameOrigin(c)
  const token = c.req.param('token') ?? ''
  const s = await load(c.env.DB), e = await byLink(s, token)
  if (!e) return { response: await unavailable() }
  const result = await work(s, e)
  await save(c.env.DB, s, null)
  return { s, e, token, result }
}

const finish = async (c: C, then: () => Promise<Response>) => { try { return await then() } finally { await flushNotices(c.env) } }

signPages.get('/sign/:token', async c => {
  const token = c.req.param('token'), s = await load(c.env.DB), e = await byLink(s, token)
  if (!e) return unavailable()
  const live = e.status === 'active' ? usable(s, e, false) : { ok: true as const }
  if (!live.ok) return shell('Offer for signature', `<h1>${esc(live.message)}</h1>`, live.status)
  if (!e.openedAt) { s.put('esign-envelope', e.id, { ...e, openedAt: new Date().toISOString() }); event(s, e, 'esign-opened'); await save(c.env.DB, s, null) }
  return render(c, s, e, token)
})

signPages.post('/sign/:token/code', async c => {
  const out = await step(c, async (s, e) => mailReady(c.env) ? requestCode(s, e, secret(c)) : { ok: false as const, status: 503, message: 'Email is not set up for this installation.' })
  if (out.response) return out.response
  const { s, e, token, result } = out
  if (!result.ok) return render(c, s, e, token, result.message, '', result.status)
  const message = codeMail(e, (result as { code: string }).code, 'sign')
  await record(c.env, e.id, 'code', await deliver(c.env, e.recipient, message.subject, message.text), { purpose: 'sign' })
  return render(c, s, e, token, '', `We emailed a code to ${mask(e.recipient)}. It works for 10 minutes.`)
})

signPages.post('/sign/:token/verify', async c => {
  const data = await formBody(c)
  const out = await step(c, (s, e) => verifyCode(s, e, secret(c), data.get('code')))
  if (out.response) return out.response
  const { s, e, token, result } = out
  if (!result.ok) return render(c, s, e, token, result.message, '', result.status)
  const { token: cookie, expires } = result as { token: string; expires: string }
  session(c, 'lodge_sign', `/sign/${token}`, cookie, expires)
  return c.redirect(`/sign/${token}`, 303)
})

signPages.post('/sign/:token/agree', async c => {
  const data = await formBody(c)
  const out = await step(c, (s, e) => agree(s, e, getCookie(c, 'lodge_sign'), { version: data.get('version'), box: data.get('box') }, edgeOf(c)))
  if (out.response) return out.response
  return out.result.ok ? c.redirect(`/sign/${out.token}`, 303) : render(c, out.s, out.e, out.token, out.result.message, '', out.result.status)
})

signPages.post('/sign/:token/withdraw', c => finish(c, async () => {
  const out = await step(c, (s, e) => withdraw(s, e, getCookie(c, 'lodge_sign')))
  if (out.response) return out.response
  return out.result.ok ? shell('Consent withdrawn', '<h1>You withdrew your consent</h1><p>Electronic signing of this offer has stopped. The offer stays open, and the employer may continue on paper.</p>') : render(c, out.s, out.e, out.token, out.result.message, '', out.result.status)
}))

signPages.post('/sign/:token/sign', c => finish(c, async () => {
  const data = await formBody(c)
  const out = await step(c, (s, e) => sign(s, e, getCookie(c, 'lodge_sign'), { name: data.get('name'), hash: data.get('hash') }, edgeOf(c)))
  if (out.response) return out.response
  return out.result.ok ? c.redirect(`/sign/${out.token}`, 303) : render(c, out.s, out.e, out.token, out.result.message, '', out.result.status)
}))

signPages.get('/sign/:token/document', async c => {
  const s = await load(c.env.DB), e = await byLink(s, c.req.param('token'))
  if (!e) return unavailable()
  if (!(await sessionFor(e.gate, getCookie(c, 'lodge_sign')))) return shell('Verify first', '<h1>Verify your email first</h1>', 403)
  const doc = s.get('offer', e.offer).document
  return attachment(doc.text, 'text/plain; charset=utf-8', 'offer-document.txt', { 'x-document-sha256': doc.sha256 })
})

async function artifact(c: C, which: 'sealed' | 'certificate', copy: boolean) {
  const token = c.req.param('token') ?? '', s = await load(c.env.DB)
  const e = copy ? await byCopyLink(s, token) : await byLink(s, token)
  if (!e || e.status !== 'completed') return unavailable()
  const live = copy ? await copySession(e, getCookie(c, 'lodge_copy')) : await sessionFor(e.gate, getCookie(c, 'lodge_sign'))
  if (!live) return shell('Verify first', '<h1>Verify your email first</h1>', 403)
  const id = which === 'sealed' ? e.sealed.document : e.sealed.certificate
  const blob = await readBlob(c.env.DB, id)
  if (!blob) return unavailable()
  event(s, e, 'esign-artifact-downloaded', { file: which, via: copy ? 'copy-link' : 'signing-session' })
  await save(c.env.DB, s, null)
  return attachment(base64ToBytes(blob.base64), 'application/pdf', which === 'sealed' ? 'signed-offer.pdf' : 'signature-certificate.pdf', { 'x-document-sha256': which === 'sealed' ? e.sealed.sha256 : e.sealed.certificateSha256 })
}
signPages.get('/sign/:token/sealed.pdf', c => artifact(c, 'sealed', false))
signPages.get('/sign/:token/certificate.pdf', c => artifact(c, 'certificate', false))
signPages.get('/copy/:token/sealed.pdf', c => artifact(c, 'sealed', true))
signPages.get('/copy/:token/certificate.pdf', c => artifact(c, 'certificate', true))

// The completed copy: opens only after a fresh emailed code, then stays open 24 hours in that browser.
async function copyView(c: C, s: State, e: Data, token: string, error = '', notice = '', status = 200) {
  const base = `/copy/${token}`, open = await copySession(e, getCookie(c, 'lodge_copy'))
  const body = open
    ? `<h1>Your signed offer</h1>${note(error, notice)}<ul class="downloads"><li><a href="${base}/sealed.pdf">Download the signed offer (PDF)</a></li><li><a href="${base}/certificate.pdf">Download the completion certificate (PDF)</a></li></ul>`
    : `<h1>Your signed offer from ${esc(e.businessName)}</h1>${note(error, notice)}<p>We send a fresh one-time code to ${esc(mask(e.recipient))}.</p>${form(base + '/code', 'Email me a code')}${form(base + '/verify', 'Verify', '<label>Six-digit code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>')}`
  return shell('Your signed offer', body, status)
}

signPages.get('/copy/:token', async c => {
  const token = c.req.param('token'), s = await load(c.env.DB), e = await byCopyLink(s, token)
  return e ? copyView(c, s, e, token) : unavailable()
})

async function copyStep<T extends { ok: boolean; message?: string; status?: number }>(c: C, work: (s: State, e: Data) => Promise<T>) {
  await sameOrigin(c)
  const token = c.req.param('token') ?? '', s = await load(c.env.DB), e = await byCopyLink(s, token)
  if (!e) return { response: await unavailable() }
  const result = await work(s, e)
  await save(c.env.DB, s, null)
  return { s, e, token, result }
}

signPages.post('/copy/:token/code', async c => {
  const out = await copyStep(c, async (s, e) => mailReady(c.env) ? requestCopyCode(s, e, secret(c)) : { ok: false as const, status: 503, message: 'Email is not set up for this installation.' })
  if (out.response) return out.response
  const { s, e, token, result } = out
  if (!result.ok) return copyView(c, s, e, token, result.message, '', result.status)
  const message = codeMail(e, (result as { code: string }).code, 'copy')
  await record(c.env, e.id, 'code', await deliver(c.env, e.recipient, message.subject, message.text), { purpose: 'copy' })
  return copyView(c, s, e, token, '', `We emailed a code to ${mask(e.recipient)}. It works for 10 minutes.`)
})

signPages.post('/copy/:token/verify', async c => {
  const data = await formBody(c)
  const out = await copyStep(c, (s, e) => verifyCopyCode(s, e, secret(c), data.get('code')))
  if (out.response) return out.response
  const { s, e, token, result } = out
  if (!result.ok) return copyView(c, s, e, token, result.message, '', result.status)
  const until = new Date(Date.now() + 86_400_000).toISOString()
  session(c, 'lodge_copy', `/copy/${token}`, (result as { token: string }).token, until)
  return c.redirect(`/copy/${token}`, 303)
})
