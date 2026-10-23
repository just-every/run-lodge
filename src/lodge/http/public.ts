import { recoveryUi } from '../careers/recovery-copy'
import { draftTools } from '../careers/draft'
import { receiptRecoveryCode, recoverReceipt } from '../careers/receipt'
import { employerBrand, brandHtml, brandCss } from '../careers/brand'
import { careersHost } from '../careers/domain'
import { translatedForm, translatedReceipt, uiCopy, SOURCE_UI } from '../languages/forms'
import { legacyListing } from '../move-in/legacy-links'
import { customFieldControls, submittedCustomFields } from '../fields/public'
import { Hono, type Context } from 'hono'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { fontHead } from '../../base/font-head'
import { themeFrame } from '../../base/theme-frame'
import branding from '../../branding.json'
import { pay as payRange, vacancyFacts } from '../core/labels'
import { businessZone, isZone, times } from '../core/time'
import { load, save } from '../core/store'
import type { State } from '../core/state'
import { Fault, bytesToBase64, requireThat, type Data } from '../core/types'
import { MAX_DOCUMENT_BYTES } from '../records/documents'
import { APPLICATIONS_PER_HOUR, APPLICATION_PAGE, MONITORING_OPTIONS, interviewByToken, submit, type Door } from '../records/intake'
import { listingBySlug, listings, shownJob } from '../records/posts'
import { RESUME_TYPES, countAttempt } from '../records/job-board'
import { candidateAvailability } from '../records/interviews'
import { jobForm } from '../records/questions'
import { departmentPath, subtree } from '../records/org'
import { cpraNotice, inCalifornia } from '../records/privacy'
import type { Listing } from '../records/posts'

// The pages applicants see: open roles, the application form (plain HTML that
// works without JavaScript, every field labelled), the receipt, and the private
// link where a candidate picks interview times. No sign-in is involved.

type C = Context<{ Bindings: Bindings }>
export const publicPages = new Hono<{ Bindings: Bindings }>()
publicPages.onError(async error => error instanceof Fault ? page('Not accepted', `<h1>That did not go through</h1><p role="alert">${esc(error.message)}</p>`, error.status) : page('Error', '<h1>Something went wrong</h1><p>Nothing was saved. Please try again.</p>', 500))
export async function careersDocument(c: C, next: () => Promise<void>) {
  await next()
  if (!c.res.headers.get('content-type')?.includes('text/html') || !/^\/(jobs|embed)(\/|$)/.test(new URL(c.req.url).pathname)) return
  const s = await load(c.env.DB), brand = employerBrand(s)
  if (!brand) return
  let html = await c.res.text()
  html = html.replace('class="rer-themed"', 'class="rer-themed employer-careers"').replace('class="lodge-public', 'class="employer-careers lodge-public')
    .replace('</head>', '<link rel="stylesheet" href="/careers/brand.css"></head>').replace(/(<main[^>]*>)/, '$1' + brandHtml(brand, s.find('business', 'main')?.name ?? 'Employer'))
  c.res = new Response(html, { status: c.res.status, headers: c.res.headers })
}
publicPages.use('*', careersDocument)

const theme = { href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor }
export const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const paragraphs = (v: string) => esc(v).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')

/**
 * An applicant page. Hosted pages refuse every frame; an ATTR-008 embedded page
 * may be framed only by the origins the admin listed, and loads the one script
 * that tells the host page its height.
 */
export async function page(title: string, body: string, status = 200, embed?: { ancestors: string[] }, language = 'en') {
  const frame = await themeFrame(theme)
  const ancestors = embed?.ancestors.length ? embed.ancestors.join(' ') : "'none'"
  return new Response(`<!doctype html><html lang="${esc(language)}"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(branding.name)}</title>${fontHead}${frame.head}<link rel="stylesheet" href="/lodge-public.css">${embed ? '<script src="/embed/frame.js" defer></script>' : ''}<script src="/careers-form.js" defer></script></head><body><main class="lodge-public${embed ? ' embedded' : ''}">${embed ? '' : frame.brand}${body}</main></body></html>`, {
    status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'strict-origin', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors ${ancestors}; script-src 'self'; ${frame.policy}` },
  })
}

const notFound = () => page('Not found', '<h1>This page is not available</h1><p>The role may have closed. <a href="/jobs">See open roles</a>.</p>', 404)

export async function formBody(c: C) {
  try { return await c.req.formData() } catch { throw new Fault(400, 'Send this form from its page') }
}

export async function sameOrigin(c: C) {
  const origin = runtimeBindings(c.env).AUTH_ORIGIN
  const url = new URL(c.req.url)
  const allowed = url.origin === origin || url.protocol === 'https:' && careersHost(await load(c.env.DB), url.hostname)
  if (!allowed || c.req.header('origin') !== url.origin) throw new Fault(403, 'Submit this form from its own page')
}

publicPages.get('/jobs/legacy/:source/:id', async c => {
  const s = await load(c.env.DB)
  const l = legacyListing(s, c.req.param('source'), c.req.param('id'), 'careers')
  c.header('cache-control', 'no-store')
  return l ? c.redirect('/jobs/' + l.slug, 302) : notFound()
})

publicPages.get('/jobs', async c => {
  const s = await load(c.env.DB)
  const business = s.all('business')[0]
  // ATTR-012: each live post on the careers page is its own role; a confidential job shows no department.
  const all: Data[] = listings(s, 'careers').map(l => ({ ...shownJob(s, l), slug: l.slug, offices: l.offices, ...(l.v.confidential ? { departmentId: undefined } : {}) }))
  // REQ-004: filter by department (with its sub-departments) and office, among the departments and offices open roles use.
  const offices = (v: Data): string[] => v.offices
  const wantDepartment = s.find('department', c.req.query('department')), wantOffice = s.find('office', c.req.query('office'))
  const within = wantDepartment ? subtree(s, wantDepartment.id) : null
  const search = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 160), location = c.req.query('location') ?? '', remote = c.req.query('remote') === 'true'
  const open = all.filter(v => (!within || within.has(v.departmentId)) && (!wantOffice || offices(v).includes(wantOffice.id)) && (!search || [v.title,v.description,v.department,v.location].join(' ').toLowerCase().includes(search)) && (!location || v.location === location) && (!remote || v.workMode === 'remote'))
  const usedDepartments = new Set<string>()
  for (const v of all) for (let d = s.find('department', v.departmentId); d; d = d.parent ? s.find('department', d.parent) : undefined) { if (usedDepartments.has(d.id)) break; usedDepartments.add(d.id) }
  const usedOffices = new Set(all.flatMap(offices))
  const choose = (name: string, label: string, ids: string[], nameOf: (id: string) => string, picked?: string) => `<label>${label}<select name="${name}"><option value="">All</option>${ids.map(id => [id, nameOf(id)]).sort((x, y) => x[1].localeCompare(y[1])).map(([id, n]) => `<option value="${esc(id)}"${id === picked ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`
  const filters = `<form method="get" action="/jobs" class="filters"><label>Search roles<input name="q" value="${esc(search)}" maxlength="160"></label>${choose('location', 'Location', [...new Set(all.map(v => v.location).filter(Boolean))], x => x, location)}<label>Work mode<select name="remote"><option value="">Any</option><option value="true"${remote ? ' selected' : ''}>Remote only</option></select></label>${usedDepartments.size ? choose('department', 'Department', [...usedDepartments], id => departmentPath(s, id), wantDepartment?.id) : ''}${usedOffices.size ? choose('office', 'Office', [...usedOffices], id => s.find('office', id)?.name ?? '', wantOffice?.id) : ''}<button type="submit">Show roles</button></form>`
  return page('Open roles', `<h1>Open roles${business ? ' at ' + esc(business.name) : ''}</h1>${filters}${open.length ? `<ul class="roles">${open.map(v => `<li><a href="/jobs/${esc(v.slug)}">${esc(v.title)}</a><span>${esc(vacancyFacts(v, false).join(' · '))}</span></li>`).join('')}</ul>` : all.length ? '<p>No open roles match these filters. <a href="/jobs">See all open roles</a>.</p>' : '<p>There are no open roles right now.</p>'}`)
})

/** SCREEN-001: the job's screening questions, each labelled, named q-<question id>. */
export function questionFields(questions: Data[], values: Data, copy: Record<string, string> = SOURCE_UI) {
  return questions.map(q => {
    const name = 'q-' + q.question, label = esc(q.text) + (q.required ? '' : esc(copy.optional)), req = q.required ? ' required' : ''
    const help = q.help ? `<small>${esc(q.help)}</small>` : ''
    const picked = (o: string) => values[name] === o || (Array.isArray(values[name]) && values[name].includes(o))
    switch (q.type) {
      case 'yes-no': return `<fieldset><legend>${label}</legend>${help}${['yes', 'no'].map(o => `<label><input type="radio" name="${name}" value="${o}"${picked(o) ? ' checked' : ''}${req}> ${o === 'yes' ? esc(copy.yes) : esc(copy.no)}</label>`).join('')}</fieldset>`
      case 'single-choice': return `<label>${label}${help}<select name="${name}"${req}><option value="">${esc(copy.choose)}</option>${q.options.map((o: string, i: number) => `<option value="${esc(o)}"${picked(o) ? ' selected' : ''}>${esc(q.optionLabels?.[i] ?? o)}</option>`).join('')}</select></label>`
      case 'multiple-choice': return `<fieldset><legend>${label}</legend>${help}${q.options.map((o: string, i: number) => `<label><input type="checkbox" name="${name}" value="${esc(o)}"${picked(o) ? ' checked' : ''}> ${esc(q.optionLabels?.[i] ?? o)}</label>`).join('')}</fieldset>`
      case 'number': return `<label>${label}${help}<input name="${name}" type="number" step="any" value="${esc(values[name])}"${req}></label>`
      case 'date': return `<label>${label}${help}<input name="${name}" type="date" value="${esc(values[name])}"${req}></label>`
      case 'file': return `<label>${label}${help}<input name="${name}" type="file"${req}></label>`
      case 'long-text': return `<label>${label}${help}<textarea name="${name}" rows="4" maxlength="8000"${req}>${esc(values[name])}</textarea></label>`
      default: return `<label>${label}${help}<input name="${name}" type="text" maxlength="300" value="${esc(values[name])}"${req}></label>`
    }
  }).join('\n')
}

/** PRIV-001: the CPRA notice a California job's form shows, or null. */
export const cpraFor = (s: Parameters<typeof cpraNotice>[0], l: Listing) => inCalifornia(s, l.v, l.post) ? cpraNotice(s) : null

/** The CPRA notice as the applicant reads it: each category with what, why and how long, then the sale and sharing statement. */
export const cpraSection = (n: Data) => `<details><summary>California applicant privacy notice (version ${esc(n.version)})</summary>${n.intro ? paragraphs(n.intro) : ''}<dl>${n.categories.map((c: Data) => `<dt>${esc(c.category)}</dt><dd>${esc(c.collected)} Used for: ${esc(c.purposes)} ${esc(c.retention)}</dd>`).join('')}</dl><p>${esc(n.saleStatement)}</p><p>You may ask to see, correct or delete your information at <a href="/privacy-requests">/privacy-requests</a>.</p></details>
<input type="hidden" name="cpraNoticeVersion" value="${esc(n.version)}">`

export function form(v: Data, business: Data, error = '', values: Data = {}, questions: Data[] = [], action = `/jobs/${v.slug}`, hidden: Record<string, string> = {}, cpra: Data | null = null) {
  if (v.language && v.language !== 'en') return translatedForm(v, business, error, values, questions, action, hidden, cpra, questionFields)
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
${customFieldControls(v, values)}
${questions.length ? `<fieldset><legend>Questions from the employer</legend>${questionFields(questions, values)}</fieldset>` : ''}
<label>Cover note (optional)<textarea name="coverNote" rows="5" maxlength="8000">${esc(values.coverNote)}</textarea></label>
<label>Adjustments you need (optional)<textarea name="accommodation" rows="3" maxlength="4000">${esc(values.accommodation)}</textarea></label>
<fieldset><legend>Voluntary equal-opportunity question (optional)</legend><p>How do you describe your gender? Your answer is kept apart from your application and never shown to the people assessing it.</p><label>Answer<select name="monitoring">${MONITORING_OPTIONS.map(o => `<option${values.monitoring === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label></fieldset>
<details><summary>Privacy notice (version ${esc(notice.version)})</summary>${paragraphs(notice.text)}</details>
<input type="hidden" name="noticeVersion" value="${esc(notice.version)}">
${cpra ? cpraSection(cpra) : ''}
<label><input type="checkbox" name="consent" value="yes" required> I have read privacy notice version ${esc(notice.version)}${cpra ? ` and California notice version ${esc(cpra.version)}` : ''}.</label>
<label><input type="checkbox" name="talentPool" value="yes"${values.talentPool === 'yes' ? ' checked' : ''}> You may contact me about other suitable roles while you keep my details.</label>
<button type="submit">Submit application</button>
</form>${draftTools(SOURCE_UI, questions)}`
}

publicPages.get('/careers/logo', async c => {
  const logo = employerBrand(await load(c.env.DB))?.logo
  return logo ? new Response(Uint8Array.from(atob(logo.base64), x => x.charCodeAt(0)), { headers: { 'content-type': logo.mediaType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }) : new Response('Not found', { status: 404 })
})
publicPages.get('/careers/brand.css', async c => new Response(brandCss(employerBrand(await load(c.env.DB))), { headers: { 'content-type': 'text/css', 'cache-control': 'no-store' } }))

export async function receiptPage(receipt: Data, contact: string, zone: string, copy: Data, embed?: { ancestors: string[] }, code?: string) {
  const body = translatedReceipt(receipt, contact, zone, receipt.language ?? 'en', copy)
  const recoveryPath = (embed ? '/embed/receipt' : '/jobs/receipt') + (receipt.language !== 'en' ? '?' + new URLSearchParams({ language: receipt.language }) : '')
  const recovery = code ? `<section aria-label="${esc(copy.recoverTitle)}"><h2>${esc(copy.recoverTitle)}</h2><p>${esc(copy.recoverHelp)}</p><dl><dt>${esc(copy.recoverCode)}</dt><dd><code data-recovery-code>${esc(code)}</code></dd></dl><p><a href="${esc(recoveryPath)}">${esc(copy.recoveryLink)}</a></p></section>` : ''
  return page(copy.received, body + recovery, 200, embed, receipt.language ?? 'en')
}
export function recoveryForm(copy: Data, action: string, language = 'en') {
  if (language !== 'en') action += '?language=' + encodeURIComponent(language)
  return `<h1>${esc(copy.recoverTitle)}</h1><form method="post" action="${esc(action)}"><label>${esc(copy.recoverCode)}<input name="code" required autocomplete="off" maxlength="64" pattern="[a-f0-9]{64}"></label><button type="submit">${esc(copy.recoverSubmit)}</button></form>`
}
publicPages.get('/jobs/receipt', async c => {
  const s = await load(c.env.DB), selected = recoveryUi(s, c.req.query('language'))
  return page(selected.copy.recoverTitle, recoveryForm(selected.copy, '/jobs/receipt', selected.language), 200, undefined, selected.language)
})
export async function recoverPage(c: C, s: State, embed?: { ancestors: string[] }) {
  await sameOrigin(c)
  const selected = recoveryUi(s, c.req.query('language'))
  try {
    if (Number(c.req.header('content-length') ?? 0) > 4096) throw new Fault(413, 'Receipt not available')
    const r = await recoverReceipt(s, (await formBody(c)).get('code'))
    return receiptPage(r, s.get('business','main').accommodationContact, businessZone(s.find('business','main')), r.recoveryCopy, embed)
  } catch (error) {
    if (!(error instanceof Fault)) throw error
    return page(selected.copy.recoverTitle, `<p role="alert">${esc(selected.copy.recoverUnavailable)}</p>` + recoveryForm(selected.copy, embed ? '/embed/receipt' : '/jobs/receipt', selected.language), error.status, embed, selected.language)
  }
}
publicPages.post('/jobs/receipt', async c => recoverPage(c, await load(c.env.DB)))

publicPages.get('/jobs/:slug', async c => {
  const s = await load(c.env.DB)
  const l = listingBySlug(s, 'careers', c.req.param('slug'))
  if (!l) return notFound()
  const shown = shownJob(s, l)
  const alternatives = listings(s, 'careers').filter(x => x.v.id === l.v.id)
  const languages = alternatives.length > 1 ? `<nav aria-label="${esc(shown.language && shown.language !== 'en' ? uiCopy(l.post!).language : 'Language')}">${alternatives.map(x => `<a href="/jobs/${esc(x.slug)}" lang="${esc(x.post?.language ?? 'en')}">${esc(new Intl.DisplayNames([x.post?.language ?? 'en'], { type: 'language' }).of(x.post?.language ?? 'en'))}</a>`).join(' · ')}</nav>` : ''
  return page(shown.title, languages + form({ ...shown, customSchema: l.v.customSchema, stages: l.v.stages, slug: l.slug }, s.get('business', 'main'), '', {}, jobForm(s, l.v, l.post), undefined, undefined, cpraFor(s, l)), 200, undefined, shown.language ?? 'en')
})

publicPages.post('/jobs/:slug', c => apply(c, APPLICATION_PAGE))

/**
 * Take an application posted from a job's form (hosted, or ATTR-008 embedded with
 * its own door, action and frame), and answer with the receipt or the form again
 * with the refusal.
 */
export async function apply(c: C, door: Door, embed?: { ancestors: string[]; action: string; hidden: Record<string, string> }) {
  await sameOrigin(c)
  if (Number(c.req.header('content-length') ?? 0) > MAX_DOCUMENT_BYTES * 1.5) return page('Too large', '<h1>That upload is too large</h1><p>Files may be at most 1 MB. Go back and choose a smaller file.</p>', 413, embed)
  // The attempt counts before the form is read, and is kept even when the application is refused.
  const counted = await load(c.env.DB)
  const within = await countAttempt(counted, runtimeBindings(c.env).SESSION_SECRET, c.req.header('cf-connecting-ip') ?? '', new Date(), 'application-attempts', APPLICATIONS_PER_HOUR)
  await save(c.env.DB, counted, null)
  if (!within) return page('Too many applications', '<h1>Too many applications from this connection</h1><p>Please try again in an hour.</p>', 429, embed)
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
    // A resume restored from a saved draft is held to the same type and size rules as one chosen just now.
    if (resume) requireThat(RESUME_TYPES[resume.name.split('.').pop()?.toLowerCase() ?? ''] !== undefined, `Resumes may be ${Object.keys(RESUME_TYPES).join(', ')} files`)
    const { receipt, accommodationContact } = await submit(s, v, { ...values, noticeVersion: values.noticeVersion, cpraNoticeVersion: values.cpraNoticeVersion, consent: values.consent, resume, answers: given, customValues: submittedCustomFields(v, values) } as any, door, l.post)
    const copy = receipt.language !== 'en' ? uiCopy(l.post!) : SOURCE_UI
    const code = await receiptRecoveryCode(s, receipt, copy)
    await save(c.env.DB, s, null)
    return receiptPage(receipt, accommodationContact, businessZone(s.find('business', 'main')), copy, embed, code)
  } catch (error) {
    if (!(error instanceof Fault)) throw error
    const shown: Data = { ...shownJob(s, l), customSchema: l.v.customSchema, stages: l.v.stages, slug: l.slug }
    return page(shown.title, form(shown, s.get('business', 'main'), error.message, values, questions, embed?.action, embed?.hidden, cpraFor(s, l)), error.status, embed, shown.language ?? 'en')
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
  await sameOrigin(c)
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
