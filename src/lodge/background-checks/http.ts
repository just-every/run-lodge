import { Hono, type Context } from 'hono'
import type { Bindings } from '../../auth.server'
import { candidateActor, ownReceipt } from '../candidate/access'
import { load, save, signedIn } from '../core/store'
import { Fault, requireThat, uid, type Data } from '../core/types'
import { esc, page } from '../http/public'
import { authorizationState, currentAuthorization, requireAuthorizationSequence, respondAuthorization } from './authorization'

export const backgroundAuthorizationPages = new Hono<{ Bindings: Bindings }>()
type C = Context<{ Bindings: Bindings }>
const path = (receipt: string) => '/candidate/receipts/' + encodeURIComponent(receipt) + '/background-authorization'
const boundary = 'Local evidence only. Not submitted to or approved by Checkr. This does not establish legal sufficiency or authorize a provider order. Lodge collects no SSN or date of birth and makes no hiring decision.'

backgroundAuthorizationPages.use('*', async (c, next) => {
  await next()
  c.header('cache-control', 'no-store'); c.header('referrer-policy', 'strict-origin'); c.header('x-content-type-options', 'nosniff')
})
backgroundAuthorizationPages.onError(error => page('Request unavailable', '<h1>Request unavailable</h1><p role="alert">' + esc(error instanceof Fault ? error.message : 'Nothing was saved. Please try again.') + '</p>', error instanceof Fault ? error.status : 500))

async function own(c: C) {
  const session = await signedIn(c.req.raw, c.env), state = await load(c.env.DB), actor = candidateActor(session)
  const { receipt, candidate } = ownReceipt(state, actor.email, c.req.param('receipt') ?? '')
  const app = state.get('application', receipt.application), record = state.find('background-authorization', app.id)
  requireThat(record && record.application === app.id, 'This page is not available', 404)
  return { state, actor, receipt, candidate, app, record }
}

backgroundAuthorizationPages.get('/candidate/receipts/:receipt/background-authorization', async c => {
  const { state: records, receipt, app, candidate, record } = await own(c), v = currentAuthorization(record)
  requireThat(record.historical || v.language === (app.language ?? 'en'), 'Wording has not been reviewed in the current application language', 409)
  const state = authorizationState(record, v.version)
  const current = !record.historical && app.status === 'active' && !app.imported && v.language === (app.language ?? 'en') && v.candidateIdentity.candidate === candidate.id && v.candidateIdentity.email === candidate.email && v.candidateIdentity.name === candidate.name
  if (current && state === 'unanswered') await requireAuthorizationSequence(records, app)
  const fields = (version: Data) => `<h3>Disclosure · version ${version.disclosureVersion}</h3><p class="pre">${esc(version.disclosure)}</p><h3>Authorization · version ${version.authorizationVersion}</h3><p class="pre">${esc(version.authorization)}</p>`
  const hidden = (version: number) => `<input type="hidden" name="version" value="${version}"><input type="hidden" name="responseId" value="${uid()}">`
  const withdraw = (version: number) => `<form method="post" action="${path(receipt.id)}">${hidden(version)}<button name="action" value="withdrawn" type="submit">Withdraw agreement to version ${version}</button></form>`
  const history = record.versions.map((version: Data) => `<section><h3>Version ${version.version} · ${esc(authorizationState(record, version.version))}</h3>${version.version !== v.version ? fields(version) : ''}<ul>${record.history.filter((e: Data) => e.version === version.version).map((e: Data) => `<li>${esc(e.action)} · ${esc(e.at)}</li>`).join('')}</ul>${authorizationState(record, version.version) === 'agreed' ? withdraw(version.version) : ''}</section>`).join('')
  const form = current && state === 'unanswered' ? `<form method="post" action="${path(receipt.id)}">${hidden(v.version)}<label><input type="checkbox" name="agreement" value="yes"> I affirmatively agree to the exact authorization above.</label><button name="action" value="agreed" type="submit">Record agreement</button><button name="action" value="refused" type="submit">Decline authorization</button></form>` : `<p>${record.historical ? 'Historical restored evidence. Fresh employer review is required.' : current ? 'Your choice is recorded. Fresh agreement requires a new employer-reviewed version.' : 'This request is no longer current. Ask the employer for fresh review.'}</p>`
  const response = await page('Background-check authorization', `<h1>Background-check authorization</h1><p>${boundary}</p><p>Optional request for ${esc(receipt.vacancyTitle)}. You may decline or leave it unanswered.</p><p>Reviewed language: ${esc(v.language)}</p><h2>Purpose</h2><p>${esc(v.purpose)}</p><h2>Intended check scope</h2><p>${esc(v.checkScope)}</p><h2>Employer retention review</h2><p>${esc(v.retentionReview)}</p>${fields(v)}<p role="status">Current response: ${esc(state)}</p>${form}<h2>Your version and choice history</h2>${history}<p><a href="/candidate/receipts/${encodeURIComponent(receipt.id)}/account">Your application</a></p>`, 200, undefined, v.language)
  const html = (await response.text()).replace('</head>', '<link rel="stylesheet" href="/lodge-candidate.css"></head>').replace('class="lodge-public"', 'class="lodge-public candidate-area"')
  return new Response(html, { status: response.status, headers: response.headers })
})

backgroundAuthorizationPages.post('/candidate/receipts/:receipt/background-authorization', async c => {
  const { state, actor, receipt, app, record } = await own(c)
  let b: Data
  if (c.req.header('content-type')?.includes('application/json')) b = await c.req.json()
  else {
    const form = await c.req.formData()
    b = { version: Number(form.get('version')), responseId: form.get('responseId'), action: form.get('action'), agreement: form.get('agreement') === 'yes' }
  }
  requireThat(b && typeof b === 'object' && !Array.isArray(b), 'Use a valid response')
  requireThat(Object.keys(b).every(k => ['version', 'responseId', 'action', 'agreement'].includes(k)), 'Only an authorization choice is accepted; no identity details or provider operation')
  await respondAuthorization(state, actor, app, record, b)
  await save(c.env.DB, state, actor)
  return c.redirect(path(receipt.id), 303)
})
