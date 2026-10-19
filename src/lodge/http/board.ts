import { Hono, type Context } from 'hono'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { load, save } from '../core/store'
import type { State } from '../core/state'
import { Fault, requireThat, sha256, type Data } from '../core/types'
import { MAX_DOCUMENT_BYTES } from '../records/documents'
import { submit } from '../records/intake'
import { BOARD_SOURCE, boardDepartments, boardJob, boardOffices, boardSettings, campaign, countAttempt, earlierReceipt, idempotencyId, keyFor, listed, rememberReceipt, resumeFile } from '../records/job-board'

// ATTR-009: the public job-board API (API.md, "Public job board"). Reads are
// unauthenticated, any origin, cached briefly with ETags. Submitting needs a
// board key (server to server) or a browser Origin on the admin's list. Errors
// are JSON naming the field. Nothing here reads a session, and the private
// /api/lodge routes never accept a board key.

type C = Context<{ Bindings: Bindings }>
export const boardApi = new Hono<{ Bindings: Bindings }>()

boardApi.onError((error, c) => {
  if (error instanceof Fault) return c.json({ error: error.message, ...(error.field ? { field: error.field } : {}) }, error.status as 400, cors(c))
  console.error('board request failed', (error as Error)?.name)
  return c.json({ error: 'Something went wrong; nothing was saved' }, 500, cors(c))
})

/** Reads answer every origin; a submit answers only an origin the admin listed. */
function cors(c: C, allowed?: string[]): Record<string, string> {
  if (!allowed) return { 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' }
  const origin = c.req.header('origin') ?? ''
  return allowed.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin', 'x-content-type-options': 'nosniff' } : { vary: 'Origin', 'x-content-type-options': 'nosniff' }
}

async function board(c: C) {
  const s = await load(c.env.DB)
  const settings = boardSettings(s)
  if (!settings || settings.token !== c.req.param('token')) throw new Fault(404, 'No job board with that token')
  return { s, settings, origin: runtimeBindings(c.env).AUTH_ORIGIN }
}

async function cached(c: C, value: unknown) {
  const body = JSON.stringify(value)
  const etag = `"${(await sha256(body)).slice(0, 32)}"`
  const headers = { ...cors(c), 'cache-control': 'public, max-age=60', etag, 'content-type': 'application/json; charset=utf-8' }
  if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers })
  return new Response(body, { headers })
}

const publicJob = (s: State, id: string) => listed(s).find(l => l.id === id)

boardApi.get('/v1/:token/jobs', async c => {
  const { s, settings, origin } = await board(c)
  const content = c.req.query('content') === 'true'
  const jobs = listed(s).map(l => boardJob(s, l, origin, settings.token, content))
  return cached(c, { jobs, meta: { total: jobs.length } })
})

boardApi.get('/v1/:token/jobs/:id', async c => {
  const { s, settings, origin } = await board(c)
  const l = publicJob(s, c.req.param('id'))
  if (!l) throw new Fault(404, 'No published job with that id')
  return cached(c, boardJob(s, l, origin, settings.token, true, true))
})

boardApi.get('/v1/:token/departments', async c => {
  const { s } = await board(c)
  return cached(c, { departments: boardDepartments(s) })
})

boardApi.get('/v1/:token/offices', async c => {
  const { s } = await board(c)
  return cached(c, { offices: boardOffices(s) })
})

boardApi.options('/v1/:token/jobs/:id/applications', async c => {
  const { settings } = await board(c)
  const headers = cors(c, settings.allowedOrigins)
  if (!headers['access-control-allow-origin']) return new Response(null, { status: 403, headers })
  return new Response(null, { status: 204, headers: { ...headers, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type, idempotency-key', 'access-control-max-age': '600' } })
})

/** Who is submitting: a live board key, or a browser on an allowed origin. Each refusal names the authorization field. */
async function caller(c: C, settings: Data) {
  const bearer = c.req.header('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (bearer) {
    const key = await keyFor(settings, bearer)
    if (!key) throw Object.assign(new Fault(401, 'This board key is not recognized'), { field: 'authorization' })
    if (key.revokedAt) throw Object.assign(new Fault(401, 'This board key was revoked'), { field: 'authorization' })
    return 'key:' + key.id
  }
  const origin = c.req.header('origin') ?? ''
  if (origin && settings.allowedOrigins.includes(origin)) return 'origin:' + origin
  throw Object.assign(new Fault(origin ? 403 : 401, origin ? 'This website is not on the board’s allowed origins' : 'Send a board key, or submit from an allowed website'), { field: 'authorization' })
}

async function json(c: C): Promise<Data> {
  const limit = Math.ceil(MAX_DOCUMENT_BYTES * 1.4) + 200_000
  if (Number(c.req.header('content-length') ?? 0) > limit) throw Object.assign(new Fault(413, 'Files may be at most 1 MB in this release'), { field: 'resume' })
  const text = await c.req.text()
  if (text.length > limit) throw Object.assign(new Fault(413, 'Files may be at most 1 MB in this release'), { field: 'resume' })
  try { const value = JSON.parse(text); requireThat(value && typeof value === 'object' && !Array.isArray(value), 'Send a JSON object'); return value } catch (e) { if (e instanceof Fault) throw e; throw new Fault(400, 'Send a JSON object') }
}

boardApi.post('/v1/:token/jobs/:id/applications', async c => {
  const { s, settings } = await board(c)
  const headers = cors(c, settings.allowedOrigins)
  const who = await caller(c, settings)
  // The attempt counts before anything else is read, and is kept even when the submission is refused.
  const secret = runtimeBindings(c.env).SESSION_SECRET
  const ip = c.req.header('cf-connecting-ip') ?? ''
  const counted = await load(c.env.DB)
  const within = await countAttempt(counted, secret, ip)
  await save(c.env.DB, counted, null)
  if (!within) throw Object.assign(new Fault(429, 'Too many applications from this connection; try again in an hour'), { field: 'rate' })
  const fresh = await load(c.env.DB)
  const l = publicJob(fresh, c.req.param('id'))
  if (!l) throw new Fault(404, 'No published job with that id')
  const v = fresh.get('vacancy', l.v.id)
  const b = await json(c)
  if (typeof b.website === 'string' && b.website.trim()) throw Object.assign(new Fault(400, 'This field must stay empty'), { field: 'website' })
  const once = await idempotencyId(who, c.req.header('idempotency-key'))
  const before = earlierReceipt(fresh, once)
  if (before) { await save(c.env.DB, fresh, null); return c.json({ receipt: before.id, submittedAt: before.submittedAt, replayed: true }, 200, headers) }
  const answers: Data = b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers) ? b.answers : {}
  const source = typeof b.source === 'string' && b.source.trim() ? b.source.trim().slice(0, 120) : BOARD_SOURCE
  const { receipt, accommodationContact } = await submit(fresh, v, {
    name: b.name, email: b.email, phone: b.phone, location: b.location, coverNote: b.coverNote, noticeVersion: b.noticeVersion, cpraNoticeVersion: b.cpraNoticeVersion,
    consent: b.consent === true || b.consent === 'yes' ? 'yes' : 'no', talentPool: b.talentPool === true || b.talentPool === 'yes' ? 'yes' : 'no',
    accommodation: b.accommodation, monitoring: b.monitoring, resume: resumeFile(b.resume), answers,
  }, { source, path: BOARD_SOURCE, entry: BOARD_SOURCE, campaign: campaign(b.campaign), oncePerJob: true }, l.post)
  rememberReceipt(fresh, once, receipt.id)
  await save(c.env.DB, fresh, null)
  return c.json({ receipt: receipt.id, submittedAt: receipt.submittedAt, noticeVersion: receipt.noticeVersion, cpraNoticeVersion: receipt.cpraNoticeVersion ?? null, accommodationContact }, 201, headers)
})
