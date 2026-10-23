import { bookableSlots, candidateBook, ownInterview } from '../candidate/booking'
import { times } from '../core/time'
import { answerRequest, preferences, PROGRESS, publishCandidateAccount, withdraw } from '../candidate/account'
import { beginEmail, confirmEmail } from '../candidate/email'
import { actorFor } from '../core/store'
import { requireAdmin, requireApplication } from '../core/access'
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
// This private area exposes only receipts and PRIV-001 requests, only deliberately published progress; never internal hiring records or submitted evidence.
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
  return signedPage('Your application receipts', `<h1>Your application receipts</h1><p>Signed in as ${esc(actor.email)}. Open your application to see updates the employer has shared. Internal employer records stay private.</p>${receipts.length ? `<ul>${receipts.map(r => `<li><a href="${base(r.id)}">${esc(r.vacancyTitle)} · ${esc(r.id)}</a></li>`).join('')}</ul>` : '<p>No application receipts are available for this email.</p>'}<p>You can also <a href="/jobs/receipt">recover a receipt with its private recovery code</a>.</p>`)
})

candidatePages.get('/candidate/receipts/:receipt', async c => {
  const { state, actor } = await context(c)
  const { receipt } = ownReceipt(state, actor.email, (c.req.param('receipt') ?? ''))
  const business = state.get('business', 'main')
  return signedPage('Your application receipt', translatedReceipt(receipt, business.accommodationContact, businessZone(business), receipt.language ?? 'en', receipt.recoveryCopy ?? recoveryUi(state, receipt.language).copy) + `<p><a href="${base(receipt.id)}/account">Your application</a></p><p><a href="${base(receipt.id)}/requests">Your privacy requests</a></p><p><a href="/candidate">All your receipts</a></p>`, receipt.language ?? 'en')
})

candidatePages.get('/candidate/receipts/:receipt/requests', async c => {
  const { state, actor } = await context(c)
  const { receipt, candidate } = ownReceipt(state, actor.email, (c.req.param('receipt') ?? ''))
  const path = base(receipt.id) + '/requests'
  const requests = state.all('data-request').filter(r => r.candidate === candidate.id && r.identity?.receipt === receipt.id)
  return signedPage('Your privacy requests', privacyRequestForm('', { name: candidate.name, email: actor.email, receipt: receipt.id }, path, true) + (requests.length ? `<h2>Requests for this receipt</h2><ul>${requests.map(r => `<li><a href="${path}/${encodeURIComponent(r.id)}">${esc(r.code)}</a></li>`).join('')}</ul>` : ''))
})

candidatePages.post('/candidate/receipts/:receipt/requests', async c => {
  const { state, actor } = await context(c)
  const { receipt, candidate } = ownReceipt(state, actor.email, (c.req.param('receipt') ?? ''))
  const data = await formBody(c)
  requireThat(!String(data.get('website') ?? '').trim(), 'This field must stay empty')
  // The form cannot nominate another person, receipt or identity. Only a request is recorded; fulfillment stays PRIV-001.
  const { record } = await submitPrivacyRequest(state, { type: data.get('type'), details: data.get('details'), name: candidate.name, email: actor.email, receipt: receipt.id })
  await save(c.env.DB, state, actor)
  return c.redirect(base(receipt.id) + '/requests/' + encodeURIComponent(record.id), 303)
})

candidatePages.get('/candidate/receipts/:receipt/requests/:request', async c => {
  const { state, actor } = await context(c)
  const { receipt, candidate } = ownReceipt(state, actor.email, (c.req.param('receipt') ?? ''))
  const request = state.find('data-request', c.req.param('request'))
  requireThat(request && request.candidate === candidate.id && request.identity?.receipt === receipt.id, 'This page is not available', 404)
  return signedPage('Your privacy request', privacyRequestStatus(request) + `<p><a href="${base(receipt.id)}/account">Your application</a></p><p><a href="${base(receipt.id)}/requests">Your privacy requests</a></p>`)
})


const accountPath = (receipt: string) => base(receipt) + '/account'
function ownApplication(state: Awaited<ReturnType<typeof load>>, actor: ReturnType<typeof candidateActor>, id: string) {
  const own = ownReceipt(state, actor.email, id)
  return { ...own, app: state.get('application', own.receipt.application) }
}

candidatePages.get('/candidate/receipts/:receipt/account', async c => {
  const { state, actor } = await context(c)
  const { receipt, candidate, app } = ownApplication(state, actor, (c.req.param('receipt') ?? ''))
  const path = accountPath(receipt.id), account = app.candidateAccount
  const interviews = state.all('interview').filter(iv => iv.application === app.id && iv.selfScheduling).map(iv => `<li><a href="${base(receipt.id)}/interviews/${encodeURIComponent(iv.id)}">${esc(iv.title)}</a></li>`).join('')
  const progress = app.candidateWithdrawnAt ? 'Withdrawn' : account?.progress ?? 'No progress update shared yet'
  const questions = (account?.requests ?? []).map((r: Record<string, any>) => `<section><h3>${esc(r.question)}</h3>${r.answeredAt ? `<p>Your answer: ${esc(r.answer)}</p><p>Received ${esc(r.answeredAt)}</p>` : app.status === 'active' ? `<form method="post" action="${path}/answer"><input type="hidden" name="request" value="${esc(r.id)}"><label>Your answer<textarea name="answer" required maxlength="5000"></textarea></label><button type="submit">Send answer</button></form>` : '<p>This request is closed.</p>'}</section>`).join('')
  return signedPage('Your application', `<h1>Your application</h1><p>${esc(receipt.vacancyTitle)}</p><h2>Progress</h2><p role="status">${esc(progress)}</p>${account?.message ? `<p>${esc(account.message)}</p>` : ''}<h2>Interviews</h2>${interviews ? `<ul>${interviews}</ul>` : '<p>No interview booking offered right now.</p>'}<h2>Requested information</h2><p>Answers are additional information. Your submitted application stays unchanged. Do not include medical, monitoring or other sensitive information here.</p>${questions || '<p>Nothing requested right now.</p>'}<h2>Contact preferences</h2><form method="post" action="${path}/preferences"><label for="candidate-contact">Preferred contact</label><select id="candidate-contact" name="preference">${[['email','Email'],['phone','Phone'],['none','No optional contact']].map(([value,label]) => `<option value="${value}"${(candidate.contactPreference?.preference ?? 'email') === value ? ' selected' : ''}>${label}</option>`).join('')}</select><label><input type="checkbox" name="talentPool" value="yes"${candidate.consent?.talentPool ? ' checked' : ''}> You may contact me about other suitable roles.</label><button type="submit">Save contact preferences</button></form><h2>Email address</h2><p>${esc(candidate.email)}</p>${app.status === 'active' ? `<p>Changing your email needs a recent sign-in and confirmation sent to the new address. Other sessions and old sign-in links will end.</p><form method="post" action="${path}/email"><label>New email<input name="email" type="email" required maxlength="254" autocomplete="email"></label><button type="submit">Verify new email</button></form><h2>Withdraw application</h2><p>This closes this application and stops its pending contact. It does not delete your records or release legal holds.</p><form method="post" action="${path}/withdraw"><label><input type="checkbox" name="confirm" value="yes" required> I want to withdraw this application.</label><button type="submit">Withdraw application</button></form>` : '<p>This application is closed.</p>'}<p><a href="${base(receipt.id)}">Your original receipt</a></p>`)
})

for (const action of ['answer', 'preferences', 'withdraw', 'email'] as const) candidatePages.post('/candidate/receipts/:receipt/account/' + action, async c => {
  const { state, actor } = await context(c)
  const { receipt, candidate, app } = ownApplication(state, actor, (c.req.param('receipt') ?? ''))
  const data = await formBody(c)
  if (action === 'email') {
    const outcome = await beginEmail(c.env, state, actor, candidate, { ...app, receiptForChange: receipt.id }, data.get('email'))
    return signedPage('Check your new email', `<h1>Check your new email</h1><p>${outcome === 'handed' ? 'Confirmation was handed to the mail provider. Open it while signed in to this candidate account.' : 'The mail attempt failed. No email change was made; wait one minute before trying again.'}</p><p><a href="${accountPath(receipt.id)}">Your application</a></p>`)
  }
  if (action === 'answer') answerRequest(state, actor, app, { request: data.get('request'), answer: data.get('answer') })
  if (action === 'preferences') preferences(state, actor, candidate, { preference: data.get('preference'), talentPool: data.get('talentPool') })
  if (action === 'withdraw') withdraw(state, actor, app, data.get('confirm'))
  await save(c.env.DB, state, actor)
  return c.redirect(accountPath(receipt.id), 303)
})

candidatePages.get('/candidate/receipts/:receipt/email/confirm', async c => {
  const { state, actor } = await context(c)
  ownReceipt(state, actor.email, (c.req.param('receipt') ?? ''))
  return signedPage('Confirm your new email', `<h1>Confirm your new email</h1><p>Confirm only if you requested this change and opened the message at your new address.</p><form method="post"><input type="hidden" name="token" value="${esc(c.req.query('token'))}"><button type="submit">Confirm email change</button></form>`)
})
candidatePages.post('/candidate/receipts/:receipt/email/confirm', async c => {
  const { state, actor } = await context(c)
  const { receipt, candidate } = ownReceipt(state, actor.email, (c.req.param('receipt') ?? ''))
  await confirmEmail(c.env, state, actor, candidate, (await formBody(c)).get('token'))
  return c.redirect(accountPath(receipt.id), 303)
})

async function employerContext(c: C) {
  const session = await signedIn(c.req.raw, c.env), state = await load(c.env.DB)
  const actor = actorFor(session, state)
  requireThat(!actor.agent, 'Only a person can publish candidate updates', 403)
  requireAdmin(actor)
  const app = requireApplication(state, actor, c.req.param('application') ?? '')
  return { state, actor, app }
}
candidatePages.get('/candidate/employer/:application', async c => {
  const { app } = await employerContext(c)
  const account = app.candidateAccount
  return signedPage('Candidate updates', `<h1>Candidate updates</h1><p>Only this published update and the questions below reach the candidate. Internal stages and notes stay private.</p>${app.status === 'active' ? `<form method="post"><label for="candidate-progress">Published progress</label><select id="candidate-progress" name="progress">${PROGRESS.map(p => `<option${account?.progress === p ? ' selected' : ''}>${p}</option>`).join('')}</select><label>Message to candidate<textarea name="message" maxlength="2000">${esc(account?.message)}</textarea></label><label>Request additional information (optional)<textarea name="request" maxlength="1000"></textarea></label><p>Request only ordinary application or scheduling information. Use the existing restricted channels for sensitive information.</p><button type="submit">Publish candidate update</button></form>` : '<p>This application is closed.</p>'}<h2>Requested information</h2>${(account?.requests ?? []).map((r: Record<string, any>) => `<h3>${esc(r.question)}</h3><p>${r.answeredAt ? esc(r.answer) : 'Awaiting answer'}</p>`).join('') || '<p>No requests yet.</p>'}<p><a href="/app">Back to Lodge</a></p>`)
})
candidatePages.post('/candidate/employer/:application', async c => {
  const { state, actor, app } = await employerContext(c), data = await formBody(c)
  publishCandidateAccount(state, actor, { application: app.id, progress: data.get('progress'), message: data.get('message'), request: data.get('request') })
  await save(c.env.DB, state, actor)
  return c.redirect('/candidate/employer/' + encodeURIComponent(app.id), 303)
})


candidatePages.get('/candidate/receipts/:receipt/interviews/:interview', async c => {
  const { state, actor } = await context(c)
  const { receipt, app } = ownApplication(state, actor, c.req.param('receipt'))
  const iv = ownInterview(state, app, c.req.param('interview'))
  const choices = bookableSlots(state, app, iv), clock = times(iv.timezone)
  const current = iv.status === 'scheduled' ? `<p role="status">Booked: ${esc(clock.stamped(iv.start))}</p>` : `<p role="status">${iv.status === 'cancelled' ? 'Canceled' : 'Choose an interview time'}</p>`
  const form = choices.length ? `<form method="post"><input type="hidden" name="previousStart" value="${esc(iv.start)}"><label for="candidate-interview-time">Interview time</label><select id="candidate-interview-time" name="start" required>${choices.map((x: Record<string, any>) => `<option value="${esc(x.start)}">${esc(clock.stamped(x.start))}</option>`).join('')}</select><button type="submit">${iv.status === 'scheduled' ? 'Reschedule interview' : 'Book interview'}</button></form>` : '<p>No available times right now. Please contact the employer.</p>'
  return signedPage('Your interview', `<h1>Your interview</h1><p>${esc(iv.title)}</p><p>${iv.durationMinutes} minutes · ${esc(iv.timezone)}</p><p>${esc(iv.location || 'Location to be confirmed')}</p>${current}${form}<p>Times are the employer’s proposed times with panel availability recorded in Lodge. This does not check connected calendars or send a calendar invitation.</p><p><a href="${accountPath(receipt.id)}">Your application</a></p>`)
})
candidatePages.post('/candidate/receipts/:receipt/interviews/:interview', async c => {
  const { state, actor } = await context(c)
  const { receipt, app } = ownApplication(state, actor, c.req.param('receipt'))
  const iv = ownInterview(state, app, c.req.param('interview')), data = await formBody(c)
  candidateBook(state, actor, app, iv, { start: data.get('start'), previousStart: data.get('previousStart') })
  await save(c.env.DB, state, actor)
  return c.redirect(base(receipt.id) + '/interviews/' + encodeURIComponent(iv.id), 303)
})
