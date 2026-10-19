import { Hono, type Context } from 'hono'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { fontHead } from '../../base/font-head'
import { themeFrame } from '../../base/theme-frame'
import branding from '../../branding.json'
import { pay as payRange, vacancyFacts } from '../core/labels'
import { businessZone, isZone, times } from '../core/time'
import { load, save } from '../core/store'
import { Fault, bytesToBase64, type Data } from '../core/types'
import { MAX_DOCUMENT_BYTES } from '../records/documents'
import { APPLICATION_PAGE, MONITORING_OPTIONS, interviewByToken, submit, type Door } from '../records/intake'
import { listingBySlug, listings, shownJob } from '../records/posts'
import { candidateAvailability } from '../records/interviews'
import { jobForm } from '../records/questions'
import { departmentPath, subtree } from '../records/org'

// The pages applicants see: open roles, the application form (plain HTML that
// works without JavaScript, every field labelled), the receipt, and the private
// link where a candidate picks interview times. No sign-in is involved.

type C = Context<{ Bindings: Bindings }>
export const publicPages = new Hono<{ Bindings: Bindings }>()
publicPages.onError(async error => error instanceof Fault ? page('Not accepted', `<h1>That did not go through</h1><p role="alert">${esc(error.message)}</p>`, error.status) : page('Error', '<h1>Something went wrong</h1><p>Nothing was saved. Please try again.</p>', 500))

const theme = { href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor }
export const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const paragraphs = (v: string) => esc(v).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')

/**
 * An applicant page. Hosted pages refuse every frame; an ATTR-008 embedded page
 * may be framed only by the origins the admin listed, and loads the one script
 * that tells the host page its height.
 */
export async function page(title: string, body: string, status = 200, embed?: { ancestors: string[] }) {
  const frame = await themeFrame(theme)
  const ancestors = embed?.ancestors.length ? embed.ancestors.join(' ') : "'none'"
  return new Response(`<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(branding.name)}</title>${fontHead}${frame.head}<link rel="stylesheet" href="/lodge-public.css">${embed ? '<script src="/embed/frame.js" defer></script>' : ''}</head><body><main class="lodge-public${embed ? ' embedded' : ''}">${embed ? '' : frame.brand}${body}</main></body></html>`, {
    status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'strict-origin', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors ${ancestors}; ${embed ? "script-src 'self'; " : ''}${frame.policy}` },
  })
}

const notFound = () => page('Not found', '<h1>This page is not available</h1><p>The role may have closed. <a href="/jobs">See open roles</a>.</p>', 404)

export async function formBody(c: C) {
  try { return await c.req.formData() } catch { throw new Fault(400, 'Send this form from its page') }
}

export function sameOrigin(c: C) {
  const origin = runtimeBindings(c.env).AUTH_ORIGIN
  if (new URL(c.req.url).origin !== origin || c.req.header('origin') !== origin) throw new Fault(403, 'Submit this form from its own page')
}

publicPages.get('/jobs', async c => {
  const s = await load(c.env.DB)
  const business = s.all('business')[0]
  // ATTR-012: each live post on the careers page is its own role; a confidential job shows no department.
  const all: Data[] = listings(s, 'careers').map(l => ({ ...shownJob(s, l), slug: l.slug, offices: l.offices, ...(l.v.confidential ? { departmentId: undefined } : {}) }))
  // REQ-004: filter by department (with its sub-departments) and office, among the departments and offices open roles use.
  const offices = (v: Data): string[] => v.offices
  const wantDepartment = s.find('department', c.req.query('department')), wantOffice = s.find('office', c.req.query('office'))
  const within = wantDepartment ? subtree(s, wantDepartment.id) : null
  const open = all.filter(v => (!within || within.has(v.departmentId)) && (!wantOffice || offices(v).includes(wantOffice.id)))
  const usedDepartments = new Set<string>()
  for (const v of all) for (let d = s.find('department', v.departmentId); d; d = d.parent ? s.find('department', d.parent) : undefined) { if (usedDepartments.has(d.id)) break; usedDepartments.add(d.id) }
  const usedOffices = new Set(all.flatMap(offices))
  const choose = (name: string, label: string, ids: string[], nameOf: (id: string) => string, picked?: string) => `<label>${label}<select name="${name}"><option value="">All</option>${ids.map(id => [id, nameOf(id)]).sort((x, y) => x[1].localeCompare(y[1])).map(([id, n]) => `<option value="${esc(id)}"${id === picked ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`
  const filters = usedDepartments.size || usedOffices.size ? `<form method="get" action="/jobs" class="filters">${usedDepartments.size ? choose('department', 'Department', [...usedDepartments], id => departmentPath(s, id), wantDepartment?.id) : ''}${usedOffices.size ? choose('office', 'Office', [...usedOffices], id => s.find('office', id)?.name ?? '', wantOffice?.id) : ''}<button type="submit">Show roles</button></form>` : ''
  return page('Open roles', `<h1>Open roles${business ? ' at ' + esc(business.name) : ''}</h1>${filters}${open.length ? `<ul class="roles">${open.map(v => `<li><a href="/jobs/${esc(v.slug)}">${esc(v.title)}</a><span>${esc(vacancyFacts(v, false).join(' · '))}</span></li>`).join('')}</ul>` : all.length ? '<p>No open roles match these filters. <a href="/jobs">See all open roles</a>.</p>' : '<p>There are no open roles right now.</p>'}`)
})

/** SCREEN-001: the job's screening questions, each labelled, named q-<question id>. */
function questionFields(questions: Data[], values: Data) {
  return questions.map(q => {
    const name = 'q-' + q.question, label = esc(q.text) + (q.required ? '' : ' (optional)'), req = q.required ? ' required' : ''
    const help = q.help ? `<small>${esc(q.help)}</small>` : ''
    const picked = (o: string) => values[name] === o || (Array.isArray(values[name]) && values[name].includes(o))
    switch (q.type) {
      case 'yes-no': return `<fieldset><legend>${label}</legend>${help}${['yes', 'no'].map(o => `<label><input type="radio" name="${name}" value="${o}"${picked(o) ? ' checked' : ''}${req}> ${o === 'yes' ? 'Yes' : 'No'}</label>`).join('')}</fieldset>`
      case 'single-choice': return `<label>${label}${help}<select name="${name}"${req}><option value="">Choose…</option>${q.options.map((o: string) => `<option${picked(o) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`
      case 'multiple-choice': return `<fieldset><legend>${label}</legend>${help}${q.options.map((o: string) => `<label><input type="checkbox" name="${name}" value="${esc(o)}"${picked(o) ? ' checked' : ''}> ${esc(o)}</label>`).join('')}</fieldset>`
      case 'number': return `<label>${label}${help}<input name="${name}" type="number" step="any" value="${esc(values[name])}"${req}></label>`
      case 'date': return `<label>${label}${help}<input name="${name}" type="date" value="${esc(values[name])}"${req}></label>`
      case 'file': return `<label>${label}${help}<input name="${name}" type="file"${req}></label>`
      case 'long-text': return `<label>${label}${help}<textarea name="${name}" rows="4" maxlength="8000"${req}>${esc(values[name])}</textarea></label>`
      default: return `<label>${label}${help}<input name="${name}" type="text" maxlength="300" value="${esc(values[name])}"${req}></label>`
    }
  }).join('\n')
}

export function form(v: Data, business: Data, error = '', values: Data = {}, questions: Data[] = [], action = `/jobs/${v.slug}`, hidden: Record<string, string> = {}) {
  const notice = business.notices.at(-1)
  const pay = v.compensation ? payRange(v.compensation) : ''
  const field = (name: string, label: string, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(values[name])}" ${extra}></label>`
  return `<h1>${esc(v.title)}</h1><p class="meta">${esc(vacancyFacts(v).join(' · '))}${pay ? `<br>Pay: ${esc(pay)}` : ''}</p>${paragraphs(v.description || '')}
${error ? `<p role="alert" class="error">${esc(error)}</p>` : ''}
<h2>Apply</h2>
<p>Need an adjustment to apply or interview? Contact ${esc(business.accommodationContact)}, or describe it below. Only the hiring administrators see it.</p>
<form method="post" enctype="multipart/form-data" action="${esc(action)}">
${Object.entries(hidden).map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`).join('')}
${field('name', 'Full name', 'text', 'required autocomplete="name" maxlength="160"')}
${field('email', 'Email', 'email', 'required autocomplete="email"')}
${field('phone', 'Phone (optional)', 'tel', 'autocomplete="tel"')}
${field('location', 'Where you are based (optional)', 'text', 'autocomplete="address-level2"')}
<label>Resume (optional, PDF, Word or text, up to 1 MB)<input name="resume" type="file" accept=".pdf,.doc,.docx,.txt,.rtf,.odt"></label>
${questions.length ? `<fieldset><legend>Questions from the employer</legend>${questionFields(questions, values)}</fieldset>` : ''}
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
  const l = listingBySlug(s, 'careers', c.req.param('slug'))
  if (!l) return notFound()
  const shown = shownJob(s, l)
  return page(shown.title, form({ ...shown, slug: l.slug }, s.get('business', 'main'), '', {}, jobForm(s, l.v, l.post)))
})

publicPages.post('/jobs/:slug', c => apply(c, APPLICATION_PAGE))

/**
 * Take an application posted from a job's form (hosted, or ATTR-008 embedded with
 * its own door, action and frame), and answer with the receipt or the form again
 * with the refusal.
 */
export async function apply(c: C, door: Door, embed?: { ancestors: string[]; action: string; hidden: Record<string, string> }) {
  sameOrigin(c)
  if (Number(c.req.header('content-length') ?? 0) > MAX_DOCUMENT_BYTES * 1.5) return page('Too large', '<h1>That upload is too large</h1><p>Files may be at most 1 MB. Go back and choose a smaller file.</p>', 413, embed)
  const s = await load(c.env.DB)
  // ATTR-012: the slug names the job's own page or one of its live posts on this destination.
  const l = listingBySlug(s, embed ? 'embed' : 'careers', c.req.param('slug') ?? '')
  if (!l) return embed ? page('Not found', '<h1>This role is not available</h1>', 404, embed) : notFound()
  const v = s.get('vacancy', l.v.id)
  const data = await formBody(c)
  const values: Data = Object.fromEntries([...data.entries()].filter(([, x]) => typeof x === 'string'))
  const upload = async (file: FormDataEntryValue | null) => file && typeof file !== 'string' && file.size > 0 ? { name: file.name, mediaType: file.type, base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) } : null
  const questions = jobForm(s, v, l.post), given: Data = {}
  for (const q of questions) {
    const name = 'q-' + q.question
    given[q.question] = q.type === 'file' ? await upload(data.get(name)) : q.type === 'multiple-choice' ? data.getAll(name).map(String) : values[name]
    if (q.type === 'multiple-choice') values[name] = given[q.question]
  }
  try {
    const resume = await upload(data.get('resume'))
    const { receipt, accommodationContact } = await submit(s, v, { ...values, noticeVersion: values.noticeVersion, consent: values.consent, resume, answers: given } as any, door, l.post)
    await save(c.env.DB, s, null)
    return page('Application received', `<h1>Application received</h1><p>Thank you. Keep this receipt for your records.</p><dl><dt>Receipt</dt><dd>${esc(receipt.id)}</dd><dt>Role</dt><dd>${esc(receipt.vacancyTitle)}</dd><dt>Received</dt><dd><time datetime="${esc(receipt.submittedAt)}">${esc(times(businessZone(s.find('business', 'main'))).stamped(receipt.submittedAt))}</time></dd><dt>Privacy notice</dt><dd>Version ${esc(receipt.noticeVersion)}</dd></dl><p>To ask about adjustments or your data, contact ${esc(accommodationContact)} and quote the receipt.</p>`, 200, embed)
  } catch (error) {
    if (!(error instanceof Fault)) throw error
    const shown: Data = { ...shownJob(s, l), slug: l.slug }
    return page(shown.title, form(shown, s.get('business', 'main'), error.message, values, questions, embed?.action, embed?.hidden), error.status, embed)
  }
}

publicPages.get('/availability/:token', async c => {
  const s = await load(c.env.DB)
  let iv: Data
  try { iv = interviewByToken(s, c.req.param('token')) } catch { return notFound() }
  const when = times(isZone(iv.timezone) ? iv.timezone : businessZone(s.find('business', 'main'))).stamped
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
