import { Hono, type Context } from 'hono'
import type { Bindings } from '../../auth.server'
import { candidateActor, ownReceipt } from '../candidate/access'
import { load, readBlob, save, signedIn } from '../core/store'
import { Fault, requireThat, uid, bytesToBase64, base64ToBytes } from '../core/types'
import { times } from '../core/time'
import { esc, page } from '../http/public'
import { currentVersion, submissionId, submitTakeHome } from './records'

export const takeHomePages = new Hono<{ Bindings: Bindings }>()
type C = Context<{ Bindings: Bindings }>
const path = (receipt: string, assignment: string) => `/candidate/receipts/${encodeURIComponent(receipt)}/take-home/${encodeURIComponent(assignment)}`

takeHomePages.use('*', async (c, next) => {
  await next()
  c.header('cache-control', 'no-store'); c.header('referrer-policy', 'no-referrer'); c.header('x-content-type-options', 'nosniff')
})
takeHomePages.onError((error, c) => {
  if (error instanceof Fault) return page('Take-home unavailable', `<h1>Take-home unavailable</h1><p role="alert">${esc(error.message)}</p>${error.status === 401 ? '<p><a href="/signin?returnTo=%2Fcandidate">Sign in to your candidate account</a></p>' : ''}`, error.status)
  return page('Take-home unavailable', '<h1>Nothing was saved</h1><p>Please try again.</p>', 500)
})

async function own(c: C) {
  const session = await signedIn(c.req.raw, c.env), state = await load(c.env.DB), actor = candidateActor(session)
  const { receipt, candidate } = ownReceipt(state, actor.email, c.req.param('receipt') ?? '')
  const app = state.get('application', receipt.application), record = state.find('take-home', c.req.param('assignment'))
  requireThat(record && record.application === app.id && record.candidate === candidate.id, 'This page is not available', 404)
  return { state, actor, receipt, app, record }
}

async function render(c: C) {
  const { state, receipt, app, record } = await own(c), v = currentVersion(record)
  const p = path(receipt.id, record.id), sub = state.find('take-home-submission', submissionId(record.id, v.version))
  const active = app.status === 'active' && app.stage === v.stage && app.rubricVersion === v.rubricVersion && state.get('vacancy', app.vacancy).status !== 'closed'
  const download = (id: string) => { const doc = state.get('document', id); return `<li><a href="${p}/files/${encodeURIComponent(id)}">Download ${esc(doc.name)}</a></li>` }
  const receiptBody = sub ? `<h2>Submission received</h2><p role="status">Received ${esc(times(v.timeZone).stamped(sub.receivedAt))}</p>${sub.files.length ? '<ul>' + sub.files.map(download).join('') + '</ul>' : ''}${sub.link ? `<p>Recorded link: ${esc(sub.link)}</p><p>Lodge has not opened or fetched this link.</p>` : ''}` : !active ? '<p>This assignment is no longer accepting submissions.</p>' : Date.now() > Date.parse(v.dueAt) ? '<p>The deadline has passed. Ask your hiring contact for an extension.</p>' : `<form method="post" enctype="multipart/form-data" action="${p}"><input type="hidden" name="version" value="${v.version}"><input type="hidden" name="submissionId" value="${uid()}"><label>Submission file<input type="file" name="file"></label><label>Submission link<input type="url" name="link" maxlength="2000" placeholder="https://"></label><p>Upload a file, provide a link, or both. Links are stored without being opened. Submit once you are ready; received work cannot be replaced.</p><button type="submit">Submit take-home</button></form>`
  const response = await page('Your take-home', `<h1>Your take-home</h1><p>Assignment version ${v.version}. Instructions not delivered by Lodge.</p><p>Deadline: ${esc(times(v.timeZone).stamped(v.dueAt))} (${esc(v.timeZone)})</p><p class="pre">${esc(v.instructions)}</p>${v.attachment ? '<ul>' + download(v.attachment) + '</ul>' : ''}${v.extensions.length ? '<h2>Recorded extensions</h2><ul>' + v.extensions.map((e: any) => `<li>${esc(times(v.timeZone).stamped(e.from))} → ${esc(times(v.timeZone).stamped(e.to))}: ${esc(e.reason)}</li>`).join('') + '</ul>' : ''}${receiptBody}<p><a href="/candidate/receipts/${encodeURIComponent(receipt.id)}/account">Your application</a></p>`)
  const html = (await response.text()).replace('</head>', '<link rel="stylesheet" href="/lodge-candidate.css"></head>').replace('class="lodge-public"', 'class="lodge-public candidate-area"')
  return new Response(html, { status: response.status, headers: response.headers })
}

takeHomePages.get('/candidate/receipts/:receipt/take-home/:assignment', render)
takeHomePages.post('/candidate/receipts/:receipt/take-home/:assignment', async c => {
  const { state, actor, receipt, app, record } = await own(c)
  requireThat(Number(c.req.header('content-length') ?? 0) <= 7_000_000, 'Submission too large', 413)
  let b
  if (c.req.header('content-type')?.includes('application/json')) {
    const raw = await c.req.text(); requireThat(raw.length <= 7_000_000, 'Submission too large', 413)
    try { b = JSON.parse(raw) } catch { throw new Fault(400, 'Use a valid submission') }
  } else {
    const form = await c.req.formData(), file = form.get('file')
    b = { version: Number(form.get('version')), submissionId: form.get('submissionId'), link: form.get('link'), files: file instanceof File && file.size > 0 ? [{ name: file.name, mediaType: file.type || 'application/octet-stream', base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }] : [] }
  }
  requireThat(b && typeof b === 'object', 'Use a valid submission')
  await submitTakeHome(state, actor, app, record, b)
  await save(c.env.DB, state, actor)
  return c.redirect(path(receipt.id, record.id), 303)
})
takeHomePages.get('/candidate/receipts/:receipt/take-home/:assignment/files/:file', async c => {
  const { state, actor, app, record } = await own(c), v = currentVersion(record)
  const sub = state.find('take-home-submission', submissionId(record.id, v.version)), id = c.req.param('file')
  requireThat(id === v.attachment || sub?.files.includes(id), 'File not found', 404)
  const doc = state.get('document', id), blob = await readBlob(c.env.DB, doc.id)
  requireThat(blob && doc.application === app.id && doc.takeHome === record.id && doc.takeHomeVersion === v.version, 'File not found', 404)
  state.audit(actor, 'take-home-original-downloaded', 'application:' + app.id)
  await save(c.env.DB, state, actor)
  return new Response(base64ToBytes(blob.base64) as BodyInit, { headers: { 'content-type': doc.mediaType, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}` } })
})
