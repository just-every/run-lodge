import { Hono, type Context } from 'hono'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { fontHead } from '../../base/font-head'
import { themeFrame } from '../../base/theme-frame'
import branding from '../../branding.json'
import { pay as payRange, vacancyFacts } from '../core/labels'
import { load, save } from '../core/store'
import { Fault, bytesToBase64, type Data } from '../core/types'
import { MAX_DOCUMENT_BYTES } from '../records/documents'
import { MONITORING_OPTIONS, interviewByToken, openVacancy, submit } from '../records/intake'
import { candidateAvailability } from '../records/interviews'

// The pages applicants see: open roles, the application form (plain HTML that
// works without JavaScript, every field labelled), the receipt, and the private
// link where a candidate picks interview times. No sign-in is involved.

type C = Context<{ Bindings: Bindings }>
export const publicPages = new Hono<{ Bindings: Bindings }>()
publicPages.onError(async error => error instanceof Fault ? page('Not accepted', `<h1>That did not go through</h1><p role="alert">${esc(error.message)}</p>`, error.status) : page('Error', '<h1>Something went wrong</h1><p>Nothing was saved. Please try again.</p>', 500))

const theme = { href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor }
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
/** "Sun Oct 18, 2026, 2:26 a.m. UTC": a receipt time that reads the same wherever the applicant is. */
const stamp = (iso: string) => {
  const part = (options: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-US', { timeZone: 'UTC', ...options })
  return `${part({ weekday: 'short' })} ${part({ month: 'short', day: 'numeric', year: 'numeric' })}, ${part({ hour: 'numeric', minute: '2-digit' }).replace('AM', 'a.m.').replace('PM', 'p.m.')} UTC`
}

const paragraphs = (v: string) => esc(v).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')

async function page(title: string, body: string, status = 200) {
  const frame = await themeFrame(theme)
  return new Response(`<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(branding.name)}</title>${fontHead}${frame.head}<link rel="stylesheet" href="/lodge-public.css"></head><body><main class="lodge-public">${frame.brand}${body}</main></body></html>`, {
    status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'strict-origin', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; ${frame.policy}` },
  })
}

const notFound = () => page('Not found', '<h1>This page is not available</h1><p>The role may have closed. <a href="/jobs">See open roles</a>.</p>', 404)

async function formBody(c: C) {
  try { return await c.req.formData() } catch { throw new Fault(400, 'Send this form from its page') }
}

function sameOrigin(c: C) {
  const origin = runtimeBindings(c.env).AUTH_ORIGIN
  if (new URL(c.req.url).origin !== origin || c.req.header('origin') !== origin) throw new Fault(403, 'Submit this form from its own page')
}

publicPages.get('/jobs', async c => {
  const s = await load(c.env.DB)
  const business = s.all('business')[0]
  const open = s.all('vacancy').filter(v => v.status === 'open').sort((x, y) => x.title.localeCompare(y.title))
  return page('Open roles', `<h1>Open roles${business ? ' at ' + esc(business.name) : ''}</h1>${open.length ? `<ul class="roles">${open.map(v => `<li><a href="/jobs/${esc(v.slug)}">${esc(v.title)}</a><span>${esc(vacancyFacts(v, false).join(' · '))}</span></li>`).join('')}</ul>` : '<p>There are no open roles right now.</p>'}`)
})

function form(v: Data, business: Data, error = '', values: Data = {}) {
  const notice = business.notices.at(-1)
  const pay = v.compensation ? payRange(v.compensation) : ''
  const field = (name: string, label: string, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(values[name])}" ${extra}></label>`
  return `<h1>${esc(v.title)}</h1><p class="meta">${esc(vacancyFacts(v).join(' · '))}${pay ? `<br>Pay: ${esc(pay)}` : ''}</p>${paragraphs(v.description || '')}
${error ? `<p role="alert" class="error">${esc(error)}</p>` : ''}
<h2>Apply</h2>
<p>Need an adjustment to apply or interview? Contact ${esc(business.accommodationContact)}, or describe it below. Only the hiring administrators see it.</p>
<form method="post" enctype="multipart/form-data" action="/jobs/${esc(v.slug)}">
${field('name', 'Full name', 'text', 'required autocomplete="name" maxlength="160"')}
${field('email', 'Email', 'email', 'required autocomplete="email"')}
${field('phone', 'Phone (optional)', 'tel', 'autocomplete="tel"')}
${field('location', 'Where you are based (optional)', 'text', 'autocomplete="address-level2"')}
<label>Resume (optional, PDF, Word or text, up to 1 MB)<input name="resume" type="file" accept=".pdf,.doc,.docx,.txt,.rtf,.odt"></label>
<label>Cover note (optional)<textarea name="coverNote" rows="5" maxlength="8000">${esc(values.coverNote)}</textarea></label>
<label>Adjustments you need (optional)<textarea name="accommodation" rows="3" maxlength="4000">${esc(values.accommodation)}</textarea></label>
<fieldset><legend>Voluntary equal-opportunity question (optional)</legend><p>How do you describe your gender? Your answer is kept apart from your application and never shown to the people assessing it.</p><label>Answer<select name="monitoring">${MONITORING_OPTIONS.map(o => `<option${values.monitoring === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label></fieldset>
<details><summary>Privacy notice (version ${esc(notice.version)})</summary>${paragraphs(notice.text)}</details>
<input type="hidden" name="noticeVersion" value="${esc(notice.version)}">
<label><input type="checkbox" name="consent" value="yes" required> I have read privacy notice version ${esc(notice.version)}.</label>
<label><input type="checkbox" name="talentPool" value="yes"${values.talentPool === 'yes' ? ' checked' : ''}> You may contact me about other suitable roles while you keep my details.</label>
<button type="submit">Submit application</button>
</form>`
}

publicPages.get('/jobs/:slug', async c => {
  const s = await load(c.env.DB)
  const v = openVacancy(s, c.req.param('slug'))
  if (!v) return notFound()
  return page(v.title, form(v, s.get('business', 'main')))
})

publicPages.post('/jobs/:slug', async c => {
  sameOrigin(c)
  if (Number(c.req.header('content-length') ?? 0) > MAX_DOCUMENT_BYTES * 1.5) return page('Too large', '<h1>That upload is too large</h1><p>Files may be at most 1 MB. Go back and choose a smaller file.</p>', 413)
  const s = await load(c.env.DB)
  const v = openVacancy(s, c.req.param('slug'))
  if (!v) return notFound()
  const data = await formBody(c)
  const values: Data = Object.fromEntries([...data.entries()].filter(([, x]) => typeof x === 'string'))
  const file = data.get('resume')
  try {
    const resume = file && typeof file !== 'string' && file.size > 0 ? { name: file.name, mediaType: file.type, base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) } : null
    const { receipt, accommodationContact } = await submit(s, v, { ...values, noticeVersion: values.noticeVersion, consent: values.consent, resume } as any)
    await save(c.env.DB, s, null)
    return page('Application received', `<h1>Application received</h1><p>Thank you. Keep this receipt for your records.</p><dl><dt>Receipt</dt><dd>${esc(receipt.id)}</dd><dt>Role</dt><dd>${esc(receipt.vacancyTitle)}</dd><dt>Received</dt><dd>${esc(stamp(receipt.submittedAt))}</dd><dt>Privacy notice</dt><dd>Version ${esc(receipt.noticeVersion)}</dd></dl><p>To ask about adjustments or your data, contact ${esc(accommodationContact)} and quote the receipt.</p>`)
  } catch (error) {
    if (!(error instanceof Fault)) throw error
    return page(v.title, form(v, s.get('business', 'main'), error.message, values), error.status)
  }
})

publicPages.get('/availability/:token', async c => {
  const s = await load(c.env.DB)
  let iv: Data
  try { iv = interviewByToken(s, c.req.param('token')) } catch { return notFound() }
  const tz = iv.timezone || 'UTC'
  const when = (iso: string) => { try { return new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(new Date(iso)) + ` (${tz})` } catch { return iso } }
  if (iv.status === 'scheduled') return page('Interview time', `<h1>Your interview is scheduled</h1><p>${esc(iv.title)}</p><p><strong>${esc(when(iv.start))}</strong></p>`)
  const picked: number[] = iv.availability?.candidate ?? []
  return page('Choose interview times', `<h1>Choose times that work for you</h1><p>${esc(iv.title)} · ${esc(iv.durationMinutes)} minutes</p><form method="post" action="/availability/${esc(c.req.param('token'))}"><fieldset><legend>Times you can attend</legend>${iv.slots.map((slot: string, i: number) => `<label><input type="checkbox" name="slot" value="${i}"${picked.includes(i) ? ' checked' : ''}> ${esc(when(slot))}</label>`).join('')}</fieldset><button type="submit">Send my availability</button></form>`)
})

publicPages.post('/availability/:token', async c => {
  sameOrigin(c)
  const s = await load(c.env.DB)
  let iv: Data
  try { iv = interviewByToken(s, c.req.param('token')) } catch { return notFound() }
  const data = await formBody(c)
  try {
    candidateAvailability(s, iv, data.getAll('slot').map(String))
    await save(c.env.DB, s, null)
  } catch (error) {
    if (!(error instanceof Fault)) throw error
    return page('Choose interview times', `<p role="alert" class="error">${esc(error.message)}</p><p><a href="/availability/${esc(c.req.param('token'))}">Back</a></p>`, error.status)
  }
  return page('Availability sent', '<h1>Thank you</h1><p>The hiring team will confirm one of the times you chose.</p>')
})
