import { Hono } from 'hono'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { load, save } from '../core/store'
import { Fault, type Data } from '../core/types'
import { countAttempt } from '../records/job-board'
import { DUE_DAYS, PUBLIC_TYPES, REQUESTS_PER_HOUR, VERIFICATION, requestByToken, submitPrivacyRequest } from '../records/privacy'
import { esc, formBody, page, sameOrigin } from './public'

// PRIV-001: where an applicant asks to see, correct or delete their information.
// Plain HTML that works without JavaScript, every field labelled, a honeypot and
// at most REQUESTS_PER_HOUR attempts per client IP per hour (HMAC digests only).
// The request's own page, at an unguessable link shown once, acknowledges it,
// says how it is processed and which identity check was used, and shows its
// deadline, any extension with its reason, and the outcome.

export const privacyPages = new Hono<{ Bindings: Bindings }>()
privacyPages.onError(async error => error instanceof Fault ? page('Not accepted', `<h1>That did not go through</h1><p role="alert">${esc(error.message)}</p>`, error.status) : page('Error', '<h1>Something went wrong</h1><p>Nothing was saved. Please try again.</p>', 500))

const LABEL: Data = { access: 'See a copy of my information', deletion: 'Delete my information', correction: 'Correct my information' }
const PROCESS: Data = {
  access: 'The hiring administrators export the records the business holds about you, with your original files, and give you a copy.',
  deletion: 'The hiring administrators delete your records, unless a legal hold or a record the law requires the business to keep applies; then they tell you which and why.',
  correction: 'The hiring administrators correct the records you name and record what was changed.',
}
const STATUS: Data = { open: 'Being processed', unverified: 'Identity not verified: nothing will be released or changed', complete: 'Completed', refused: 'Refused' }

export function privacyRequestForm(error = '', values: Data = {}, action = '/privacy-requests', signedIdentity = false) {
  const field = (name: string, label: string, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(values[name])}" ${extra}></label>`
  return `<h1>Your privacy requests</h1>
<p>Ask to see, correct or delete the information this business holds about you as an applicant. We confirm who you are with the receipt code from your application and the email you applied with. We acknowledge your request at once and answer within ${DUE_DAYS} days.</p>
${error ? `<p role="alert" class="error">${esc(error)}</p>` : ''}
<form method="post" action="${esc(action)}">
<fieldset><legend>What would you like?</legend>${PUBLIC_TYPES.map(t => `<label><input type="radio" name="type" value="${t}" required${values.type === t ? ' checked' : ''}> ${LABEL[t]}</label>`).join('')}</fieldset>
${signedIdentity ? `<p>Requesting for ${esc(values.email)}, application ${esc(values.receipt)}. Your signed-in identity is used for this request.</p>` : `${field('name', 'Full name', 'text', 'required autocomplete="name" maxlength="160"')}
${field('email', 'Email you applied with', 'email', 'required autocomplete="email"')}
${field('receipt', 'Application receipt code (for example LDG-1A2B3C4D)', 'text', 'maxlength="40"')}`}
<label>Details (required for a correction: what should change)<textarea name="details" rows="4" maxlength="4000">${esc(values.details)}</textarea></label>
<label class="trap" aria-hidden="true">Leave this empty<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
<button type="submit">Send request</button>
</form>`
}

/** The request as its requester sees it: never another person's data, only the request itself. */
export function privacyRequestStatus(r: Data, link = '') {
  const verified = r.identity ? (r.identity.verified ? `Verified by ${VERIFICATION}.` : `Not verified: the receipt code and email did not match a record. Nothing will be released or changed; send a new request with the receipt code from your application.`) : ''
  return `<h1>Your privacy request</h1>${link}
<dl><dt>Request</dt><dd>${esc(r.code)} · ${esc(LABEL[r.type] ?? r.type)}</dd><dt>Received</dt><dd>${esc(r.receivedAt)}</dd>
${r.acknowledgedAt ? `<dt>Acknowledged</dt><dd>${esc(r.acknowledgedAt.slice(0, 10))}, when it was received</dd>` : ''}
${verified ? `<dt>Identity check</dt><dd>${esc(verified)}</dd>` : ''}
${PROCESS[r.type] && r.status !== 'complete' ? `<dt>How it will be processed</dt><dd>${esc(PROCESS[r.type])}</dd>` : ''}
${r.status === 'unverified' ? '' : `<dt>Answer due by</dt><dd>${esc(r.dueOn)}</dd>`}
${r.extension ? `<dt>Extended by ${esc(r.extension.days)} days</dt><dd>${esc(r.extension.reason)}</dd>` : ''}
<dt>Status</dt><dd>${esc(STATUS[r.status] ?? r.status)}</dd>
${r.refusal ? `<dt>Why</dt><dd>${esc(r.refusal.reason)}</dd>` : r.status === 'complete' && r.outcome ? `<dt>Outcome</dt><dd>${esc(r.outcome)}</dd>` : ''}</dl>
<p>Lodge sends no email about this request; check this page for its status.</p>`
}

privacyPages.get('/privacy-requests', () => page('Privacy requests', privacyRequestForm()))

privacyPages.post('/privacy-requests', async c => {
  await sameOrigin(c)
  // The attempt counts before anything else is read, and is kept even when the request is refused.
  const counted = await load(c.env.DB)
  const within = await countAttempt(counted, runtimeBindings(c.env).SESSION_SECRET, c.req.header('cf-connecting-ip') ?? '', new Date(), 'privacy-request-attempts', REQUESTS_PER_HOUR)
  await save(c.env.DB, counted, null)
  if (!within) return page('Too many requests', '<h1>Too many requests from this connection</h1><p>Please try again in an hour.</p>', 429)
  const data = await formBody(c)
  const values: Data = Object.fromEntries([...data.entries()].filter(([, x]) => typeof x === 'string'))
  if (typeof values.website === 'string' && values.website.trim()) return page('Not accepted', '<h1>That did not go through</h1><p role="alert">This field must stay empty.</p>', 400)
  const s = await load(c.env.DB)
  try {
    const { record, token } = await submitPrivacyRequest(s, values)
    await save(c.env.DB, s, null)
    const link = `<p>Keep this private link to check your request: <a href="/privacy-requests/${token}">/privacy-requests/${token}</a>. It is shown only once.</p>`
    return page('Request received', privacyRequestStatus(record, link))
  } catch (error) {
    if (!(error instanceof Fault)) throw error
    return page('Privacy requests', privacyRequestForm(error.message, values), error.status)
  }
})

privacyPages.get('/privacy-requests/:token', async c => {
  const r = await requestByToken(await load(c.env.DB), c.req.param('token'))
  if (!r) return page('Not found', '<h1>This page is not available</h1>', 404)
  return page('Your privacy request', privacyRequestStatus(r))
})
