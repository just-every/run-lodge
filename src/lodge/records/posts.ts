import { payProblems, publicPay } from './pay-transparency'
import { publishRecoveryUi } from '../careers/recovery-copy'
import { requireTranslation, translationReady, translationSource, languageTag } from '../languages/posts'
import { canonical } from '../core/types'
import type { State } from '../core/state'
import { requireCan, requireManages } from '../core/access'
import { list, now, oneOf, optionalText, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { publicPosting } from './intake'
import { attachable } from './questions'

// ATTR-012: one job carries several job posts. Each post has its own title,
// description, locations (drawn from the job's approved offices), extra
// screening questions, language and destinations, and goes live, pauses or
// closes on its own. Posts are not part of the LDG-001 terms, so their wording
// changes without a new approval; their locations can only be offices the job
// was approved for, and pay, headcount, stages, rubric and hiring team stay the
// job's. Once any post has gone live, the job reaches applicants only through
// its live posts; until then it keeps its one application page. Applications
// from a post land on the job with the post recorded. A confidential job
// (OPS-005) keeps its one neutral listing and its posts never list; an
// internal-only job (ATTR-005) lists nowhere.

/** Where a post can appear today. Each board joins this list with its own clause (ATTR-002, ATTR-003, ATTR-006). */
export const DESTINATIONS = ['careers', 'embed', 'api'] as const
export type Destination = typeof DESTINATIONS[number]

/** The offices a job was approved for: its office and the other approved offices in its LDG-001 terms. */
export const approvedOffices = (v: Data): string[] => [...new Set([v.officeId, ...(v.locations ?? [])].filter(Boolean))] as string[]

const slugOf = (title: string) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'role'}-${uid().slice(0, 6)}`

function live(s: State, a: Actor, id: unknown) {
  const v = s.get('vacancy', id)
  requireManages(a, v)
  requireCan(s, a, v, 'settings')
  requireThat(!v.imported, 'Imported vacancies are kept as history', 409)
  requireThat(v.status !== 'closed', 'This vacancy is closed', 409)
  return v
}

function locations(s: State, v: Data, value: unknown) {
  const allowed = approvedOffices(v)
  const ids = [...new Set(list(value, 'Post locations', 20, (x, i) => text(x, `Location ${i + 1}`, 64)))]
  requireThat(ids.length > 0, 'Choose at least one of the job’s approved locations')
  for (const id of ids) {
    const office = s.find('office', id)
    requireThat(allowed.includes(id), `${office?.name ?? 'That location'} is not one of this job’s approved locations; add it to the job’s terms and have them approved again`, 409)
  }
  return ids
}

/** Create a post on a job, or with `post` edit one; title and description change without a new approval. */
export function jobPost(s: State, a: Actor, b: Data) {
  const v = live(s, a, b.vacancy)
  const posts: Data[] = v.posts ?? []
  const current = b.post ? posts.find(p => p.id === b.post) : undefined
  requireThat(!b.post || current, 'Post not found', 404)
  requireThat(!current || current.status !== 'closed', 'This post is closed', 409)
  const fields = {
    title: text(b.title, 'Post title', 160),
    description: optionalText(b.description, 'Post description', 20000),
    locations: locations(s, v, b.locations),
    questions: attachable(s, v, b.questions ?? []).filter(x => !(v.questions ?? []).some((q: Data) => q.question === x.question)),
    language: languageTag(b.language ?? 'en'),
    destinations: [...new Set(list(b.destinations, 'Destinations', DESTINATIONS.length, x => oneOf(x, DESTINATIONS, 'Destination')))],
  }
  requireThat(fields.destinations.length > 0, 'Choose where this post appears')
  const post: Data = current ? { ...current, ...fields, updatedAt: now(), updatedBy: a.email } : { id: uid().slice(0, 8), slug: slugOf(fields.title), ...fields, status: 'draft', history: [], createdBy: a.email, createdAt: now() }
  if (b.translation !== undefined) {
    requireThat(b.translation && typeof b.translation === 'object' && !Array.isArray(b.translation) && canonical(b.translation).length <= 100000, 'Send translation text, at most 100 KB')
    post.translation = { ...b.translation, source: translationSource(s, v, post), reviewedBy: b.translation.reviewed === true ? a.email : null, reviewedAt: now() }
  }
  if (post.status === 'live') requireTranslation(s, v, post)
  if (post.status === 'live' && !v.confidential && !v.internalOnly && post.destinations.some((d: string) => d === 'careers' || d === 'embed')) publishRecoveryUi(s, post)
  const record = s.put('vacancy', v.id, { ...v, posts: current ? posts.map(p => p.id === post.id ? post : p) : [...posts, post] })
  s.audit(a, current ? 'post-edited' : 'post-created', 'vacancy:' + v.id, { post: post.id, title: post.title })
  return record
}

/** A post goes live, pauses or closes on its own; going live needs the job published on its approved terms. */
export function postStatus(s: State, a: Actor, b: Data) {
  const v = live(s, a, b.vacancy)
  const post = (v.posts ?? []).find((p: Data) => p.id === b.post)
  requireThat(post, 'Post not found', 404)
  requireThat(post.status !== 'closed', 'This post is closed', 409)
  const status = oneOf(b.status, ['live', 'paused', 'closed'] as const, 'Post status')
  if (status === 'live') {
    requireThat(v.status === 'open', 'Publish the job first; its posts go live on its approved terms', 409)
    locations(s, v, post.locations)
    requireTranslation(s, v, post)
    if (!v.confidential && !v.internalOnly && post.destinations.some((d: string) => d === 'careers' || d === 'embed')) publishRecoveryUi(s, post)
  }
  requireThat(status !== 'paused' || post.status === 'live', 'Only a live post pauses', 409)
  const record = s.put('vacancy', v.id, { ...v, posts: v.posts.map((p: Data) => p.id === post.id ? { ...p, status, history: [...p.history, { status, by: a.email, at: now() }] } : p) })
  s.audit(a, 'post-' + status, 'vacancy:' + v.id, { post: post.id })
  return record
}

/** Closing the job closes every post with it. */
export const closePosts = (v: Data, by: string) => (v.posts ?? []).map((p: Data) => p.status === 'closed' ? p : { ...p, status: 'closed', history: [...p.history, { status: 'closed', by, at: now(), reason: 'The job closed' }] })

/** One way a job reaches applicants on a destination: a live post, or the job's own page. */
export interface Listing { v: Data; post: Data | null; id: string; slug: string; title: string; description: string; offices: string[] }

const goneLive = (v: Data) => (v.posts ?? []).some((p: Data) => p.status !== 'draft')

/**
 * What a destination lists: published jobs that are not internal-only; the
 * careers page shows a confidential job under its neutral title only, and the
 * embed and board API never show one. A job any of whose posts has gone live
 * lists only its live posts on their chosen destinations.
 */
export function listings(s: State, destination: Destination): Listing[] {
  const out: Listing[] = []
  for (const v of s.all('vacancy')) {
    if (v.status !== 'open' || v.imported || payProblems(s, v).length) continue
    const shown = publicPosting(v)
    if (!shown || (v.confidential && destination !== 'careers')) continue
    const offices = [...approvedOffices(v), ...(v.openings ?? []).filter((o: Data) => o.status === 'open').map((o: Data) => o.officeId)].filter(Boolean) as string[]
    if (v.confidential || !goneLive(v)) { out.push({ v, post: null, id: v.id, slug: v.slug, title: shown.title, description: v.description || '', offices: [...new Set(offices)] }); continue }
    for (const p of v.posts) if (p.status === 'live' && p.destinations.includes(destination) && translationReady(s, v, p)) out.push({ v, post: p, id: p.id, slug: p.slug, title: p.title, description: p.description, offices: p.locations })
  }
  return out.sort((x, y) => x.title.localeCompare(y.title))
}

export const listingBySlug = (s: State, destination: Destination, slug: string) => listings(s, destination).find(l => l.slug === slug) ?? null
export const listingById = (s: State, destination: Destination, id: string) => listings(s, destination).find(l => l.id === id) ?? null

/** The job as one listing shows it: the post's title, description and locations over the job's shared terms. */
export function shownJob(s: State, l: Listing): Data {
  const job = { ...publicPosting(l.v)!, payTransparency: publicPay(s, l.v, l.post).text }
  if (!l.post) return job
  return { ...job, language: l.post.language, translation: l.post.translation, title: l.post.title, description: l.post.description, location: l.offices.map(id => s.find('office', id)?.name).filter(Boolean).join(' · ') }
}

/** Save employer-reviewed text for the source versions visible in this request. */
export function postTranslation(s: State, a: Actor, b: Data) {
  const v = live(s, a, b.vacancy)
  const p = (v.posts ?? []).find((x: Data) => x.id === b.post)
  requireThat(p && p.status !== 'closed' && p.language !== 'en', 'Choose a translated post', 404)
  requireThat(b.translation && typeof b.translation === 'object' && !Array.isArray(b.translation) && canonical(b.translation).length <= 100000, 'Send translation text, at most 100 KB')
  const post = { ...p, translation: { ...b.translation, source: translationSource(s, v, p), reviewedBy: b.translation.reviewed === true ? a.email : null, reviewedAt: now() } }
  if (post.status === 'live') requireTranslation(s, v, post)
  if (post.status === 'live' && !v.confidential && !v.internalOnly && post.destinations.some((d: string) => d === 'careers' || d === 'embed')) publishRecoveryUi(s, post)
  const record = s.put('vacancy', v.id, { ...v, posts: v.posts.map((x: Data) => x.id === post.id ? post : x) })
  s.audit(a, 'post-translation-reviewed', 'vacancy:' + v.id, { post: post.id, language: post.language, reviewed: !!post.translation.reviewedBy })
  return record
}
