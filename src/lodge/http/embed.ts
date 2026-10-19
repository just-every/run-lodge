import { Hono, type Context } from 'hono'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { vacancyFacts } from '../core/labels'
import { load } from '../core/store'
import type { State } from '../core/state'
import { Fault, type Data } from '../core/types'
import { MAX_DOCUMENT_BYTES } from '../records/documents'
import { boardSettings } from '../records/job-board'
import { listingBySlug, listings, shownJob, type Listing } from '../records/posts'
import { departmentPath, subtree } from '../records/org'
import { jobForm } from '../records/questions'
import { apply, cpraFor, esc, form, page } from './public'

// ATTR-008: the job board and application form inside the employer's own site.
// The admin's snippet (People → Public job board) loads /embed.js, which frames
// /embed/jobs sized to its content and passes the host page's utm_* parameters
// and any preset department or office. Only the origins on the board's list may
// frame these pages (CSP frame-ancestors); hosted pages still refuse every frame.
// The form is the hosted one, with the same checks, posted inside the frame.

type C = Context<{ Bindings: Bindings }>
export const embedPages = new Hono<{ Bindings: Bindings }>()
embedPages.onError(async error => error instanceof Fault ? page('Not accepted', `<h1>That did not go through</h1><p role="alert">${esc(error.message)}</p>`, error.status) : page('Error', '<h1>Something went wrong</h1><p>Nothing was saved. Please try again.</p>', 500))

export const EMBED_SOURCE = 'Careers page (embedded)'
const CAMPAIGN = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']
const FILTERS = ['department', 'office', 'remote']

export const isEmbedPage = (path: string) => path === '/embed.js' || path.startsWith('/embed/')

/** The host page's campaign fields, carried from link to link and into the application. */
function campaignOf(values: Record<string, unknown>) {
  const out: Record<string, string> = {}
  for (const key of CAMPAIGN) if (typeof values[key] === 'string' && values[key]) out[key] = String(values[key]).slice(0, 200)
  return out
}

const query = (values: Record<string, string>) => { const q = new URLSearchParams(values).toString(); return q ? '?' + q : '' }

function embedding(s: State) {
  const board = boardSettings(s)
  return board ? { ancestors: board.allowedOrigins as string[] } : null
}

const notSetUp = () => page('Not available', '<h1>This job board is not available</h1>', 404)

embedPages.get('/embed.js', c => {
  const origin = runtimeBindings(c.env).AUTH_ORIGIN
  const script = `(() => {
  const me = document.currentScript, origin = ${JSON.stringify(origin)}
  const params = new URLSearchParams()
  for (const [key, value] of new URLSearchParams(location.search)) if (key.startsWith('utm_')) params.set(key, value)
  for (const key of ['department', 'office', 'remote']) if (me.dataset[key]) params.set(key, me.dataset[key])
  const frame = document.createElement('iframe')
  frame.src = origin + '/embed/jobs' + (params.size ? '?' + params : '')
  frame.title = me.dataset.title || 'Open roles'
  frame.style.cssText = 'display:block;width:100%;min-height:420px;border:0'
  me.after(frame)
  addEventListener('message', event => {
    if (event.origin === origin && event.source === frame.contentWindow && event.data && event.data.type === 'lodge-embed-height') frame.style.height = Math.ceil(event.data.height) + 'px'
  })
})()
`
  return new Response(script, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } })
})

embedPages.get('/embed/frame.js', () => new Response(`const lodgeHeight = () => parent.postMessage({ type: 'lodge-embed-height', height: document.documentElement.scrollHeight }, '*')
addEventListener('load', lodgeHeight)
new ResizeObserver(lodgeHeight).observe(document.documentElement)
`, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } }))

embedPages.get('/embed/jobs', async c => {
  const s = await load(c.env.DB)
  const embed = embedding(s)
  if (!embed) return notSetUp()
  const business = s.all('business')[0]
  // ATTR-012: each live post with the embed among its destinations is its own role.
  const all: Data[] = listings(s, 'embed').map((l: Listing) => ({ ...shownJob(s, l), slug: l.slug, offices: l.offices }))
  const values = c.req.query(), campaign = campaignOf(values)
  const offices = (v: Data): string[] => v.offices
  const wantDepartment = s.find('department', values.department), wantOffice = s.find('office', values.office), remoteOnly = values.remote === 'true'
  const within = wantDepartment ? subtree(s, wantDepartment.id) : null
  const open = all.filter(v => (!within || within.has(v.departmentId)) && (!wantOffice || offices(v).includes(wantOffice.id)) && (!remoteOnly || v.workMode === 'remote'))
  const usedDepartments = new Set<string>()
  for (const v of all) for (let d = s.find('department', v.departmentId); d; d = d.parent ? s.find('department', d.parent) : undefined) { if (usedDepartments.has(d.id)) break; usedDepartments.add(d.id) }
  const usedOffices = new Set(all.flatMap(offices))
  const choose = (name: string, label: string, ids: string[], nameOf: (id: string) => string, picked?: string) => `<label>${label}<select name="${name}"><option value="">All</option>${ids.map(id => [id, nameOf(id)]).sort((x, y) => x[1].localeCompare(y[1])).map(([id, n]) => `<option value="${esc(id)}"${id === picked ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`
  const hidden = Object.entries(campaign).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')
  const filters = `<form method="get" action="/embed/jobs" class="filters">${hidden}${usedDepartments.size ? choose('department', 'Department', [...usedDepartments], id => departmentPath(s, id), wantDepartment?.id) : ''}${usedOffices.size ? choose('office', 'Office', [...usedOffices], id => s.find('office', id)?.name ?? '', wantOffice?.id) : ''}<label>Work mode<select name="remote"><option value="">Any</option><option value="true"${remoteOnly ? ' selected' : ''}>Remote only</option></select></label><button type="submit">Show roles</button></form>`
  const carried = query(Object.fromEntries(Object.entries({ ...campaign, department: wantDepartment?.id ?? '', office: wantOffice?.id ?? '', remote: remoteOnly ? 'true' : '' }).filter(([, v]) => v)))
  const list = open.length ? `<ul class="roles">${open.map(v => `<li><a href="/embed/jobs/${esc(v.slug)}${esc(carried)}">${esc(v.title)}</a><span>${esc(vacancyFacts(v, false).join(' · '))}</span></li>`).join('')}</ul>` : all.length ? '<p>No open roles match these filters.</p>' : '<p>There are no open roles right now.</p>'
  return page('Open roles', `<h1>Open roles${business ? ' at ' + esc(business.name) : ''}</h1>${filters}${list}`, 200, embed)
})

embedPages.get('/embed/jobs/:slug', async c => {
  const s = await load(c.env.DB)
  const embed = embedding(s)
  if (!embed) return notSetUp()
  const l = listingBySlug(s, 'embed', c.req.param('slug'))
  if (!l) return page('Not found', '<h1>This role is not available</h1><p><a href="/embed/jobs">See open roles</a></p>', 404, embed)
  const values = c.req.query(), campaign = campaignOf(values)
  const back = query(Object.fromEntries(FILTERS.concat(CAMPAIGN).filter(k => values[k]).map(k => [k, values[k]])))
  const v: Data = { ...shownJob(s, l), slug: l.slug }
  return page(v.title, `<p><a href="/embed/jobs${esc(back)}">← All open roles</a></p>${form(v, s.get('business', 'main'), '', {}, jobForm(s, l.v, l.post), `/embed/jobs/${l.slug}`, campaign, cpraFor(s, l))}`, 200, embed)
})

embedPages.post('/embed/jobs/:slug', async c => {
  const s = await load(c.env.DB)
  const embed = embedding(s)
  if (!embed) return notSetUp()
  if (Number(c.req.header('content-length') ?? 0) > MAX_DOCUMENT_BYTES * 1.5) return page('Too large', '<h1>That upload is too large</h1><p>Files may be at most 1 MB. Go back and choose a smaller file.</p>', 413, embed)
  // The campaign fields ride in the form as hidden inputs; read them without consuming the body apply() reads.
  const values = Object.fromEntries([...(await c.req.raw.clone().formData().catch(() => new FormData())).entries()].filter(([, x]) => typeof x === 'string'))
  const campaign = campaignOf(values)
  return apply(c, { source: EMBED_SOURCE, path: EMBED_SOURCE, entry: EMBED_SOURCE, ...(Object.keys(campaign).length ? { campaign } : {}) }, { ...embed, action: `/embed/jobs/${c.req.param('slug')}`, hidden: campaign })
})
