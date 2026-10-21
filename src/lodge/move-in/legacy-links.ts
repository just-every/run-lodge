import type { State } from '../core/state'
import { requireCan, requireManages } from '../core/access'
import { Fault, now, requireThat, text, type Actor, type Data } from '../core/types'
import { listings, type Destination } from '../records/posts'
import type { WorkspaceRecords } from '../views/workspace'

function identity(source: unknown, sourceId: unknown) {
  const name = text(source, 'Source', 32), id = text(sourceId, 'Source job ID', 200)
  requireThat(/^[a-z][a-z0-9-]*$/.test(name), 'Source must be a lowercase name such as greenhouse')
  requireThat(/^[a-zA-Z0-9_-]+$/.test(id), 'Source job ID must contain only letters, digits, underscores or hyphens')
  return { source: name, sourceId: id, id: name + ':' + id }
}

/** A reviewed mapping is job configuration, governed by the existing settings permission. */
export function legacyLink(s: State, a: Actor, b: Data) {
  const key = identity(b.source, b.sourceId), current = s.find('legacy-link', key.id)
  const manage = (id: unknown) => {
    const v = s.get('vacancy', id)
    requireManages(a, v); requireCan(s, a, v, 'settings')
    return v
  }
  // Replacing a mapping must also be authorized on its previous destination.
  if (current) manage(current.vacancy)
  if (b.remove === true) {
    requireThat(current, 'Legacy link not found', 404)
    s.remove('legacy-link', key.id)
    s.audit(a, 'legacy-link-removed', 'vacancy:' + current.vacancy, key)
    return { removed: true }
  }
  const v = manage(b.vacancy), post = b.post ? (v.posts ?? []).find((p: Data) => p.id === b.post) : null
  requireThat(!b.post || post, 'Post not found', 404)
  const sourceUrl = text(b.sourceUrl, 'Old source URL', 2000)
  let url: URL
  try { url = new URL(sourceUrl) } catch { throw new Fault(400, 'Old source URL must be an HTTPS web address') }
  requireThat(url.protocol === 'https:' && !url.username && !url.password, 'Old source URL must be HTTPS without embedded credentials')
  const record = s.put('legacy-link', key.id, { ...key, vacancy: v.id, post: post?.id ?? null, sourceUrl: url.href, updatedBy: a.email, updatedAt: now() })
  s.audit(a, 'legacy-link-mapped', 'vacancy:' + v.id, { source: key.source, sourceId: key.sourceId, post: record.post })
  return record
}

/** Resolve only a presently published destination; neutral confidential listings never qualify. */
export function legacyListing(s: State, source: string, sourceId: string, destination: Destination) {
  const mapped = s.find('legacy-link', source + ':' + sourceId)
  if (!mapped) return null
  return listings(s, destination).find(l => l.v.id === mapped.vacancy && !l.v.confidential && !l.v.internalOnly && (mapped.post ? l.post?.id === mapped.post : !l.post)) ?? null
}

/** Feed/provider observations are unavailable until their adapters exist; never infer a clear cutover. */
export function legacyReport(s: State, w: WorkspaceRecords) {
  const jobs = new Map(w.vacancies.filter(v => v.manages).map(v => [v.id, v]))
  return { mappings: s.all('legacy-link').filter(m => jobs.has(m.vacancy)).map(m => {
    const live = legacyListing(s, m.source, m.sourceId, 'careers')
    return { ...m, title: jobs.get(m.vacancy)!.title, hostedPath: '/jobs/legacy/' + m.source + '/' + m.sourceId, destination: live ? '/jobs/' + live.slug : null }
  }), reconciliation: { status: 'unavailable', reason: 'Board/feed readback and applications still arriving at the source are not connected. This mapping report does not establish that cutover is complete.' } }
}
