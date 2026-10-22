import type { State } from '../core/state'
import { requireAdmin } from '../core/access'
import { pay } from '../core/labels'
import { Fault, about, bytesToBase64, list, now, optionalText, requireThat, sha256, text, uid, type Actor, type Data } from '../core/types'
import { MAX_DOCUMENT_BYTES } from './documents'
import { MONITORING_OPTIONS } from './intake'
import { listings, type Listing } from './posts'
import { jobForm } from './questions'
import { departmentPath } from './org'
import { cpraNotice, inCalifornia } from './privacy'

// ATTR-009: the employer's public job board for their own careers page. An admin
// names the board's token, lists the browser origins that may submit, and keeps
// submit-only board keys (shown once, stored as SHA-256 only, rotated or revoked
// at once). The board lists only published jobs that are not confidential, with
// public fields only, never an internal-only one (ATTR-005). A job whose
// ATTR-012 posts have gone live lists each live post on the API as its own
// entry (its id is the post's, `jobId` the job's). Per-location pay (ATTR-004)
// joins it when that clause ships.

export const BOARD_SOURCE = 'Careers page (API)'
export const SUBMITS_PER_HOUR = 10
const IDEMPOTENCY_HOURS = 24
const RESUME_TYPES: Record<string, string> = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', rtf: 'application/rtf', odt: 'application/vnd.oasis.opendocument.text' }

export const boardSettings = (s: State): Data | undefined => s.find('job-board', 'main')

function origin(value: unknown, i: number) {
  const raw = text(value, `Allowed origin ${i + 1}`, 200)
  let url: URL
  try { url = new URL(raw) } catch { throw new Fault(400, `Allowed origin ${i + 1} must be a web address such as https://careers.example.com`) }
  requireThat(['https:', 'http:'].includes(url.protocol) && url.origin === raw.replace(/\/$/, ''), `Allowed origin ${i + 1} must be a scheme and host only, such as https://careers.example.com`)
  return url.origin
}

/** Admins name the board's token and the browser origins that may submit applications. */
export function jobBoard(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const current = boardSettings(s)
  const token = text(b.token, 'Board token', 40).toLowerCase()
  requireThat(/^[a-z0-9][a-z0-9-]{2,39}$/.test(token), 'Board token: 3 to 40 lowercase letters, digits or hyphens')
  const allowedOrigins = [...new Set(list(b.allowedOrigins ?? [], 'Allowed origins', 20, origin))]
  const record = s.put('job-board', 'main', { ...(current ?? { keys: [], createdAt: now() }), token, allowedOrigins, updatedBy: a.email, updatedAt: now() })
  s.audit(a, 'job-board-settings', 'job-board:main', { token, allowedOrigins })
  return publicSettings(record)
}

async function newKey(s: State, a: Actor, label: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const key = 'lbk_' + [...bytes].map(x => x.toString(16).padStart(2, '0')).join('')
  return { key, entry: { id: uid(), label, hash: await sha256(key), last4: key.slice(-4), createdBy: a.email, createdAt: now() } }
}

/** A new submit-only key; its value is in this answer only. */
export async function boardKey(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const board = boardSettings(s)
  requireThat(board, 'Name the job board first', 409)
  const { key, entry } = await newKey(s, a, text(b.label, 'Key label', 80))
  const record = s.put('job-board', 'main', { ...board, keys: [...board.keys, entry] })
  s.audit(a, 'board-key-created', 'job-board:main', { key: entry.id, label: entry.label })
  return { ...publicSettings(record), key }
}

function liveKey(board: Data, id: unknown) {
  const entry = board.keys.find((k: Data) => k.id === id)
  requireThat(entry && !entry.revokedAt, 'Choose a key that is still active', 404)
  return entry
}

export function revokeBoardKey(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const board = boardSettings(s)
  requireThat(board, 'Name the job board first', 409)
  const entry = liveKey(board, b.id)
  const record = s.put('job-board', 'main', { ...board, keys: board.keys.map((k: Data) => k.id === entry.id ? { ...k, revokedAt: now(), revokedBy: a.email } : k) })
  s.audit(a, 'board-key-revoked', 'job-board:main', { key: entry.id })
  return publicSettings(record)
}

/** Rotation revokes the old key at once and returns its replacement, once. */
export async function rotateBoardKey(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const board = boardSettings(s)
  requireThat(board, 'Name the job board first', 409)
  const old = liveKey(board, b.id)
  const { key, entry } = await newKey(s, a, old.label)
  const record = s.put('job-board', 'main', { ...board, keys: [...board.keys.map((k: Data) => k.id === old.id ? { ...k, revokedAt: now(), revokedBy: a.email, rotatedTo: entry.id } : k), { ...entry, rotatedFrom: old.id }] })
  s.audit(a, 'board-key-rotated', 'job-board:main', { from: old.id, to: entry.id })
  return { ...publicSettings(record), key }
}

/** What admins see of the board: never a key's hash. */
export function publicSettings(board: Data): Data
export function publicSettings(board: Data | undefined): Data | null
export function publicSettings(board: Data | undefined): Data | null {
  if (!board) return null
  return { token: board.token, allowedOrigins: board.allowedOrigins, keys: board.keys.map(({ hash: _, ...k }: Data) => k) }
}

/** The key entry a bearer value belongs to: active, revoked, or none. */
export async function keyFor(board: Data, bearer: string) {
  const hash = await sha256(bearer)
  return board.keys.find((k: Data) => k.hash === hash) as Data | undefined
}

/** What the board shows: published jobs and live posts on the API, confidential ones never, even under a neutral title. */
export const listed = (s: State) => listings(s, 'api')

function departmentChain(s: State, id: unknown) {
  const chain: Data[] = []
  for (let d = s.find('department', id), hops = 0; d && hops < 8; d = d.parent ? s.find('department', d.parent) : undefined, hops++) chain.unshift({ id: d.id, name: d.name, parentId: d.parent ?? null })
  return chain
}

/** One job or post as the board shows it; `content` adds the description, `detail` the application form. */
export function boardJob(s: State, l: Listing, origin: string, token: string, content: boolean, detail = false): Data {
  const v = l.v, spanish = l.post?.language === 'es', tr = l.post?.translation
  const offices = l.offices.map(id => s.find('office', id)).filter(Boolean).map(o => ({ id: o!.id, name: o!.name }))
  const c = v.compensation
  // Today a job has one approved range for all its locations; ATTR-004 adds a range per location.
  const where = (l.post ? '' : v.location) || offices.map(o => o.name).join(', ')
  const job: Data = {
    language: l.post?.language ?? 'en', id: l.id, jobId: v.id, postId: l.post?.id ?? null, title: l.title, departments: departmentChain(s, v.departmentId), department: v.departmentId ? departmentPath(s, v.departmentId) : v.department || null,
    offices, location: (l.post ? where : v.location) || null, employmentType: v.employmentType, workMode: v.workMode, remote: v.workMode === 'remote',
    pay: c ? [{ location: where || null, currency: c.currency, min: c.min, max: c.max, period: c.period, minorUnits: 2 }] : [],
    payTransparency: c ? `Pay${where ? ' for ' + where : ''}: ${pay(c).replace(/ /g, ' ')}` : null,
    publishedAt: v.publishedAt, updatedAt: v.updatedAt && v.updatedAt > v.publishedAt ? v.updatedAt : v.publishedAt,
    url: `${origin}/jobs/${l.slug}`,
  }
  if (content || detail) job.content = l.description
  if (!detail) return job
  const business = s.get('business', 'main'), notice = business.notices.at(-1)
  return {
    ...job,
    applyUrl: `${origin}/api/board/v1/${token}/jobs/${l.id}/applications`,
    fields: [
      { name: 'name', label: 'Full name', type: 'short-text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'phone', label: 'Phone', type: 'short-text', required: false },
      { name: 'location', label: 'Where you are based', type: 'short-text', required: false },
      { name: 'resume', label: 'Resume', type: 'file', required: false, maxBytes: MAX_DOCUMENT_BYTES, fileTypes: Object.keys(RESUME_TYPES) },
      { name: 'coverNote', label: 'Cover note', type: 'long-text', required: false },
      { name: 'accommodation', label: 'Adjustments you need', type: 'long-text', required: false },
      { name: 'talentPool', label: 'You may contact me about other suitable roles while you keep my details', type: 'yes-no', required: false },
    ].map(f => ({ ...f, label: spanish ? ({ name: 'Nombre completo', email: 'Correo electrónico', phone: 'Teléfono', location: 'Lugar de residencia', resume: 'Currículum', coverNote: 'Carta de presentación', accommodation: 'Adaptaciones que necesita', talentPool: 'Pueden contactarme sobre otros puestos adecuados mientras conserven mis datos' } as Data)[f.name] : f.label })),
    questions: jobForm(s, v, l.post).map((q: Data) => ({ id: q.question, text: q.text, type: q.type, required: !!q.required, options: q.options ?? [], ...(q.optionLabels ? { optionLabels: q.optionLabels } : {}), help: q.help || null, ...(q.type === 'file' ? { maxBytes: MAX_DOCUMENT_BYTES } : {}) })),
    voluntaryQuestions: [{ id: 'monitoring', text: spanish ? tr.monitoring : 'How do you describe your gender?', options: MONITORING_OPTIONS, ...(spanish ? { optionLabels: tr.monitoringOptions } : {}), required: false, note: spanish ? 'Se guarda por separado y nunca se muestra a quienes evalúan su solicitud.' : 'Kept apart from the application and never shown to the people assessing it.' }],
    privacyNotice: { version: notice.version, text: spanish ? tr.notice : notice.text },
    // PRIV-001: a California job carries the CPRA notice; submit its version as cpraNoticeVersion.
    californiaNotice: inCalifornia(s, v, l.post) ? { ...cpraNotice(s), ...(spanish ? tr.cpra : {}) } : null,
    accommodationContact: business.accommodationContact, ...(spanish ? { accommodationText: tr.accommodation } : {}),
  }
}

/** Departments the listed jobs use, with their parents; `jobs` counts listed jobs in a department and every department below it. */
export function boardDepartments(s: State) {
  const jobs = listed(s), counts = new Map<string, number>()
  for (const { v } of jobs) for (const d of departmentChain(s, v.departmentId)) counts.set(d.id, (counts.get(d.id) ?? 0) + 1)
  return [...counts].map(([id, n]) => { const d = s.get('department', id); return { id, name: d.name, parentId: d.parent ?? null, path: departmentPath(s, id), jobs: n } }).sort((x, y) => x.path.localeCompare(y.path))
}

/** Offices the listed jobs or their open openings are in, with how many listed jobs each has. */
export function boardOffices(s: State) {
  const counts = new Map<string, number>()
  for (const l of listed(s)) for (const id of l.offices) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts].flatMap(([id, n]) => { const o = s.find('office', id); return o ? [{ id, name: o.name, jobs: n }] : [] }).sort((x, y) => x.name.localeCompare(y.name))
}

/** The résumé an API caller sends: base64 bytes of an allowed type, at most 1 MB. */
export function resumeFile(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  return about('resume', () => {
    const r = value as Data
    requireThat(r && typeof r === 'object' && typeof r.base64 === 'string' && r.base64.length > 0, 'Send the resume as { name, mediaType, base64 }')
    const name = text(r.name, 'Resume file name', 200)
    const extension = name.toLowerCase().split('.').pop() ?? ''
    requireThat(RESUME_TYPES[extension], `Resumes may be ${Object.keys(RESUME_TYPES).join(', ')} files`)
    requireThat(r.base64.length <= Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 4, 'Files may be at most 1 MB in this release', 413)
    return { name, mediaType: typeof r.mediaType === 'string' && r.mediaType ? r.mediaType : RESUME_TYPES[extension], base64: r.base64 as string }
  })
}

/** Campaign fields a careers page passes on (utm_* from its own URL). */
export function campaign(value: unknown) {
  if (value === undefined || value === null) return undefined
  return about('campaign', () => {
    requireThat(typeof value === 'object' && !Array.isArray(value), 'Campaign must be an object of utm fields')
    const out: Data = {}
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
      const v = optionalText((value as Data)[key], key, 200)
      if (v) out[key] = v
    }
    return Object.keys(out).length ? out : undefined
  })
}

/**
 * Spam controls before anything is read: at most SUBMITS_PER_HOUR attempts per
 * client IP per clock hour (UTC). The IP is kept only as an HMAC digest under the
 * installation secret, and digests from earlier hours are deleted on the next attempt.
 */
export async function countAttempt(s: State, secret: string, ip: string, at = new Date(), kind = 'board-attempts', limit = SUBMITS_PER_HOUR) {
  const hour = at.toISOString().slice(0, 13)
  for (const row of s.all(kind)) if (row.hour !== hour) s.drop(kind, row.id)
  const keyBytes = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', keyBytes, new TextEncoder().encode(hour + '\u0000' + ip)))).replace(/[^A-Za-z0-9]/g, '').slice(0, 32)
  const row = s.find(kind, digest)
  const count = (row?.count ?? 0) + 1
  s.put(kind, digest, { hour, count })
  return count <= limit
}

/** A submission repeated with the same idempotency key from the same caller within 24 hours gets the same receipt. */
export async function idempotencyId(caller: string, key: string | undefined) {
  if (!key) return null
  requireThat(key.length <= 200, 'Idempotency-Key must be at most 200 characters')
  return sha256(caller + '\u0000' + key)
}

export function earlierReceipt(s: State, id: string | null) {
  if (!id) return null
  const cutoff = new Date(Date.now() - IDEMPOTENCY_HOURS * 3600_000).toISOString()
  for (const row of s.all('board-idempotency')) if (row.at < cutoff) s.drop('board-idempotency', row.id)
  const row = s.find('board-idempotency', id)
  return row && row.at >= cutoff ? s.find('receipt', row.receipt) ?? null : null
}

export function rememberReceipt(s: State, id: string | null, receipt: string) {
  if (id) s.put('board-idempotency', id, { receipt, at: now() })
}
