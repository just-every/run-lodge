import { Hono, type Context } from 'hono'
import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { candidateActor, ownReceipt, ownReceipts } from '../candidate/access'
import { recoveryUi } from '../careers/recovery-copy'
import { load, save, signedIn } from '../core/store'
import { businessZone } from '../core/time'
import { Fault, requireThat } from '../core/types'
import { translatedReceipt } from '../languages/forms'
import { submitPrivacyRequest } from '../records/privacy'
import { esc, formBody, page } from './public'
import { privacyRequestForm, privacyRequestStatus } from './privacy-pages'

// Native email invitations/sign-in verify identity; candidates gain no Lodge membership.
// Receipt possession recovery remains public and receipt-only under ATTR-001.
// This private area exposes only receipts and PRIV-001 requests, never hiring progress or submitted evidence.
export const candidatePages = new Hono<{ Bindings: Bindings }>()
type C = Context<{ Bindings: Bindings }>
const base = (receipt: string) => '/candidate/receipts/' + encodeURIComponent(receipt)

candidatePages.onError(async error => {
  if (error instanceof Fault) {
    if (error.status === 401) return page('Sign in required', '<h1>Sign in required</h1><p>Your session has ended or you have not signed in.</p><p><a href="/signin?returnTo=%2Fcandidate">Sign in to your receipts</a></p>', 401)
    if (error.status === 404) return page('Not available', '<h1>This page is not available</h1>', 404)
    return page('Not accepted', `<h1>That did not go through</h1><p role="alert">${esc(error.message)}</p>`, error.status)
  }
  return page('Error', '<h1>Something went wrong</h1><p>Nothing was saved. Please try again.</p>', 500)
})

async function context(c: C) {
  const session = await signedIn(c.req.raw, c.env)
  return { state: await load(c.env.DB), actor: candidateActor(session) }
}

async function signedPage(title: string, body: string, language = 'en') {
  const response = await page(title, body + '<form class="candidate-signout" method="post" action="/candidate/signout"><button type="submit">Sign out</button></form>', 200, undefined, language)
  const html = (await response.text()).replace('</head>', '<link rel="stylesheet" href="/lodge-candidate.css"></head>').replace('class="lodge-public"', 'class="lodge-public candidate-area"')
  return new Response(html, { status: response.status, headers: response.headers })
}

candidatePages.post('/candidate/signout', async c => {
  await signedIn(c.req.raw, c.env)
  const result = await operatorAuth(runtimeBindings(c.env)).signOut(c.req.raw)
  c.header('set-cookie', result.cookie)
  return c.redirect('/candidate', 303)
})

candidatePages.get('/candidate', async c => {
  const { state, actor } = await context(c)
  const receipts = ownReceipts(state, actor.email)
  return signedPage('Your application receipts', `<h1>Your application receipts</h1><p>Signed in as ${esc(actor.email)}. These receipts do not show hiring progress or give access to the employer’s records.</p>${receipts.length ? `<ul>${receipts.map(r => `<li><a href="${base(r.id)}">${esc(r.vacancyTitle)} · ${esc(r.id)}</a></li>`).join('')}</ul>` : '<p>No application receipts are available for this email.</p>'}<p>You can also <a href="/jobs/receipt">recover a receipt with its private recovery code</a>.</p>`)
})

candidatePages.get('/candidate/receipts/:receipt', async c => {
  const { state, actor } = await context(c)
  const { receipt } = ownReceipt(state, actor.email, c.req.param('receipt'))
  const business = state.get('business', 'main')
  return signedPage('Your application receipt', translatedReceipt(receipt, business.accommodationContact, businessZone(business), receipt.language ?? 'en', receipt.recoveryCopy ?? recoveryUi(state, receipt.language).copy) + `<p><a href="${base(receipt.id)}/requests">Your privacy requests</a></p><p><a href="/candidate">All your receipts</a></p>`, receipt.language ?? 'en')
})

candidatePages.get('/candidate/receipts/:receipt/requests', async c => {
  const { state, actor } = await context(c)
  const { receipt, candidate } = ownReceipt(state, actor.email, c.req.param('receipt'))
  const path = base(receipt.id) + '/requests'
  const requests = state.all('data-request').filter(r => r.candidate === candidate.id && r.identity?.receipt === receipt.id)
  return signedPage('Your privacy requests', privacyRequestForm('', { name: candidate.name, email: actor.email, receipt: receipt.id }, path, true) + (requests.length ? `<h2>Requests for this receipt</h2><ul>${requests.map(r => `<li><a href="${path}/${encodeURIComponent(r.id)}">${esc(r.code)}</a></li>`).join('')}</ul>` : ''))
})

candidatePages.post('/candidate/receipts/:receipt/requests', async c => {
  const { state, actor } = await context(c)
  const { receipt, candidate } = ownReceipt(state, actor.email, c.req.param('receipt'))
  const data = await formBody(c)
  requireThat(!String(data.get('website') ?? '').trim(), 'This field must stay empty')
  // The form cannot nominate another person, receipt or identity. Only a request is recorded; fulfillment stays PRIV-001.
  const { record } = await submitPrivacyRequest(state, { type: data.get('type'), details: data.get('details'), name: candidate.name, email: actor.email, receipt: receipt.id })
  await save(c.env.DB, state, actor)
  return c.redirect(base(receipt.id) + '/requests/' + encodeURIComponent(record.id), 303)
})

candidatePages.get('/candidate/receipts/:receipt/requests/:request', async c => {
  const { state, actor } = await context(c)
  const { receipt, candidate } = ownReceipt(state, actor.email, c.req.param('receipt'))
  const request = state.find('data-request', c.req.param('request'))
  requireThat(request && request.candidate === candidate.id && request.identity?.receipt === receipt.id, 'This page is not available', 404)
  return signedPage('Your privacy request', privacyRequestStatus(request) + `<p><a href="${base(receipt.id)}/requests">Your privacy requests</a></p>`)
})
