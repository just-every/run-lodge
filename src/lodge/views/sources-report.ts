import type { State } from '../core/state'
import { has, isAdmin } from '../core/access'
import type { Actor, Data } from '../core/types'
import { mergeRule, sourceOf } from '../records/sources'
import type { WorkspaceRecords } from './workspace'

/**
 * CRM-008 in REPORT-001's first slice: over the jobs the reader runs, applications
 * and hires by source list entry (unmapped texts as themselves), and hires by who
 * is credited (sourcer, recruiter, referring employee or agency). A hire is
 * attributed by the admin's merge rule: its own application's source and credit,
 * or under "first touch" those of the person's earliest application (merged
 * records included). Spam is not counted.
 */
export function sourcesReport(s: State, a: Actor, w: WorkspaceRecords) {
  if (!isAdmin(a) && !has(a, 'manager')) return null
  const rule = mergeRule(s)
  const apps = w.applications.filter(x => x.manages && x.status !== 'spam')
  const label = (app: Data) => { const entry = sourceOf(s, app.source); return entry ? { source: entry.id, name: entry.name, type: entry.type } : { source: null, name: app.source || 'Not recorded', type: null } }
  const firstTouch = (app: Data) => s.all('application').filter(x => x.candidate === app.candidate && x.status !== 'spam').sort((x, y) => x.submittedAt.localeCompare(y.submittedAt))[0] ?? app
  const hires = apps.filter(x => x.status === 'hired').map(app => {
    const from = rule === 'first-touch' ? firstTouch(app) : app
    return { application: app.id, candidateName: app.candidateName, vacancy: app.vacancy, attributedTo: from.id, ...label(from), credit: from.credit ? { kind: from.credit.kind, who: from.credit.who } : null }
  })
  const bySource = new Map<string, Data>()
  for (const app of apps) {
    const l = label(app), k = l.source ?? 'text:' + l.name
    bySource.set(k, { ...l, applications: (bySource.get(k)?.applications ?? 0) + 1, hires: 0 })
  }
  for (const h of hires) {
    const k = h.source ?? 'text:' + h.name
    bySource.set(k, { ...(bySource.get(k) ?? { source: h.source, name: h.name, type: h.type, applications: 0 }), hires: (bySource.get(k)?.hires ?? 0) + 1 })
  }
  const byCredit = new Map<string, Data>()
  for (const h of hires.filter(x => x.credit)) {
    const k = h.credit!.kind + ':' + h.credit!.who
    byCredit.set(k, { kind: h.credit!.kind, who: h.credit!.who, hires: (byCredit.get(k)?.hires ?? 0) + 1 })
  }
  // ATTR-012: source and conversion by post. An application converts when it reached a later stage than the job's first, or was hired.
  const byPost = new Map<string, Data>()
  for (const app of apps.filter(x => x.post)) {
    const v = s.find('vacancy', app.vacancy), post = (v?.posts ?? []).find((p: Data) => p.id === app.post)
    const row = byPost.get(app.post) ?? { vacancy: app.vacancy, post: app.post, title: post?.title ?? app.postTitle, applications: 0, advanced: 0, hires: 0, sources: {} }
    row.applications++
    if (app.status === 'hired' || (v && app.stage !== v.stages[0]?.id)) row.advanced++
    if (app.status === 'hired') row.hires++
    const name = label(app).name
    row.sources[name] = (row.sources[name] ?? 0) + 1
    byPost.set(app.post, row)
  }
  return {
    rule,
    byPost: [...byPost.values()].map((r): Data => ({ ...r, conversion: r.applications ? Math.round(r.advanced / r.applications * 100) : 0, sources: Object.entries(r.sources).map(([name, applications]) => ({ name, applications })).sort((x, y) => (y.applications as number) - (x.applications as number) || x.name.localeCompare(y.name)) })).sort((x, y) => x.title.localeCompare(y.title)),
    bySource: [...bySource.values()].sort((x, y) => y.hires - x.hires || y.applications - x.applications || x.name.localeCompare(y.name)),
    byCredit: [...byCredit.values()].sort((x, y) => y.hires - x.hires || x.kind.localeCompare(y.kind) || x.who.localeCompare(y.who)),
    hires,
  }
}
