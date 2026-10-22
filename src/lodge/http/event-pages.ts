import { Hono } from 'hono'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { load, save } from '../core/store'
import { Fault, bytesToBase64, type Data } from '../core/types'
import { MAX_DOCUMENT_BYTES } from '../records/documents'
import { REGISTRATIONS_PER_HOUR, eventByToken, selfRegister } from '../records/events'
import { countAttempt } from '../records/job-board'
import { cpraNotice, inCalifornia } from '../records/privacy'
import { cpraSection, esc, formBody, page, sameOrigin } from './public'

// CRM-009: the page an attendee opens from the event's QR code. Plain HTML that
// works without JavaScript, every field labelled, the current privacy notice and
// its version, contact consent unchecked until they tick it, a honeypot, and at
// most REGISTRATIONS_PER_HOUR attempts per client IP per hour (HMAC digests only).
// It is open only while the event's owner keeps registration open.

export const eventPages = new Hono<{ Bindings: Bindings }>()
eventPages.onError(async error => error instanceof Fault ? page('Not accepted', `<h1>That did not go through</h1><p role="alert">${esc(error.message)}</p>`, error.status) : page('Error', '<h1>Something went wrong</h1><p>Nothing was saved. Please try again.</p>', 500))

const KIND: Data = { 'career-fair': 'Career fair', campus: 'Campus visit', meetup: 'Meetup', virtual: 'Virtual event' }
const closed = () => page('Registration closed', '<h1>Registration for this event is closed</h1><p>Thank you for your interest. <a href="/jobs">See open roles</a>.</p>', 410)
const notFound = () => page('Not found', '<h1>This page is not available</h1>', 404)

function form(e: Data, business: Data, error = '', values: Data = {}, cpra: Data | null = null) {
  const notice = business.notices.at(-1)
  const field = (name: string, label: string, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(values[name])}" ${extra}></label>`
  return `<h1>${esc(e.name)}</h1><p class="meta">${esc([KIND[e.kind], e.date, e.location].join(' · '))}</p>
<p>Leave your details with ${esc(business.name)}. A recruiter will look at them; registering is not an application for a job.</p>
${error ? `<p role="alert" class="error">${esc(error)}</p>` : ''}
<form method="post" enctype="multipart/form-data" action="/events/${esc(e.token)}">
${field('name', 'Full name', 'text', 'required autocomplete="name" maxlength="160"')}
${field('email', 'Email', 'email', 'required autocomplete="email"')}
${field('phone', 'Phone (optional)', 'tel', 'autocomplete="tel"')}
<label>What work interests you (optional)<textarea name="interests" rows="3" maxlength="1000">${esc(values.interests)}</textarea></label>
<label>Resume or a photo of it (optional, up to 1 MB)<input name="resume" type="file" accept=".pdf,.doc,.docx,.txt,.rtf,.odt,image/*"></label>
<label class="trap" aria-hidden="true">Leave this empty<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
<details><summary>Privacy notice (version ${esc(notice.version)})</summary>${esc(notice.text).split(/\n{2,}/).map(p => `<p>${p}</p>`).join('')}</details>
<input type="hidden" name="noticeVersion" value="${esc(notice.version)}">
${cpra ? cpraSection(cpra) : ''}
<label><input type="checkbox" name="noticeShown" value="yes" required> I have read privacy notice version ${esc(notice.version)}${cpra ? ` and California notice version ${esc(cpra.version)}` : ''}.</label>
<label><input type="checkbox" name="consentToContact" value="yes"${values.consentToContact === 'yes' ? ' checked' : ''}> You may contact me about suitable roles while you keep my details.</label>
<button type="submit">Register</button>
</form>`
}

eventPages.get('/events/:token', async c => {
  const s = await load(c.env.DB)
  let e: Data
  try { e = eventByToken(s, c.req.param('token')) } catch { return notFound() }
  if (e.status !== 'open') return closed()
  return page(e.name, form(e, s.get('business', 'main'), '', {}, inCalifornia(s, e) ? cpraNotice(s) : null))
})

eventPages.post('/events/:token', async c => {
  await sameOrigin(c)
  if (Number(c.req.header('content-length') ?? 0) > MAX_DOCUMENT_BYTES * 1.5) return page('Too large', '<h1>That upload is too large</h1><p>Files may be at most 1 MB. Go back and choose a smaller file.</p>', 413)
  // The attempt counts before anything else is read, and is kept even when the registration is refused.
  const counted = await load(c.env.DB)
  const within = await countAttempt(counted, runtimeBindings(c.env).SESSION_SECRET, c.req.header('cf-connecting-ip') ?? '', new Date(), 'event-attempts', REGISTRATIONS_PER_HOUR)
  await save(c.env.DB, counted, null)
  if (!within) return page('Too many registrations', '<h1>Too many registrations from this connection</h1><p>Please try again in an hour, or ask the team at the event to add you.</p>', 429)
  const s = await load(c.env.DB)
  let e: Data
  try { e = eventByToken(s, c.req.param('token')) } catch { return notFound() }
  if (e.status !== 'open') return closed()
  const data = await formBody(c)
  const values: Data = Object.fromEntries([...data.entries()].filter(([, x]) => typeof x === 'string'))
  if (typeof values.website === 'string' && values.website.trim()) return page('Not accepted', '<h1>That did not go through</h1><p role="alert">This field must stay empty.</p>', 400)
  const file = data.get('resume')
  try {
    const resume = file && typeof file !== 'string' && file.size > 0 ? { name: file.name, mediaType: file.type, base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) } : null
    const { noticeVersion } = await selfRegister(s, c.req.param('token'), { name: values.name, email: values.email, phone: values.phone, interests: values.interests, noticeVersion: values.noticeVersion, cpraNoticeVersion: values.cpraNoticeVersion, noticeShown: values.noticeShown, consentToContact: values.consentToContact, resume })
    await save(c.env.DB, s, null)
    return page('Registered', `<h1>Thank you, you are registered</h1><p>${esc(e.name)} · ${esc(e.date)}</p><p>Your details are kept under privacy notice version ${esc(noticeVersion)}. A recruiter will be in touch if a role fits.</p>`)
  } catch (error) {
    if (!(error instanceof Fault)) throw error
    return page(e.name, form(e, s.get('business', 'main'), error.message, values, inCalifornia(s, e) ? cpraNotice(s) : null), error.status)
  }
})
