import type { State } from '../core/state'
import { canSeeCandidate, requireAdmin } from '../core/access'
import { requireThat, type Actor, type Data } from '../core/types'
import type { Workspace } from './workspace'

const terms = (q: unknown) => {
  requireThat(typeof q === 'string' && q.trim().length >= 2 && q.length <= 200, 'Search for at least two characters')
  return q.toLowerCase().split(/\s+/).filter(Boolean)
}

function matches(record: Data, fields: string[], words: string[]) {
  const found = fields.filter(f => typeof record[f] === 'string' && words.some(w => record[f].toLowerCase().includes(w)))
  return words.every(w => fields.some(f => typeof record[f] === 'string' && record[f].toLowerCase().includes(w))) ? found : null
}

/** Search only what the actor's workspace already shows them. */
export function search(w: Workspace, q: unknown) {
  const words = terms(q)
  const results: Data[] = []
  for (const c of w.candidates) { const f = matches({ ...c, customFieldText: [...Object.values(c.customValues ?? {}), ...w.applications.filter(app => app.candidate === c.id).flatMap(app => Object.values(app.customValues ?? {}))].join(' ') }, ['name', 'email', 'headline', 'skills', 'location', 'resumeText', 'customFieldText'], words); if (f) results.push({ kind: 'candidate', id: c.id, label: c.name, fields: f }) }
  for (const v of w.vacancies) { const f = matches({ ...v, customFieldText: Object.values(v.customValues ?? {}).join(' ') }, ['title', 'department', 'location', 'customFieldText'], words); if (f) results.push({ kind: 'vacancy', id: v.id, label: v.title, fields: f }) }
  for (const d of w.documents) { const f = matches(d, ['name'], words); if (f) results.push({ kind: 'document', id: d.id, label: d.name, fields: f }) }
  return results.slice(0, 100)
}

/**
 * Talent-pool rediscovery: prior candidates with current permission to be
 * contacted about other roles whose own words match. Factual matches with the
 * matching fields shown; no ranking score. The person chooses whom to approach.
 */
export function talentPool(s: State, a: Actor, q: unknown) {
  requireAdmin(a)
  const words = terms(q), today = new Date().toISOString().slice(0, 10)
  return s.all('candidate')
    .filter(c => !c.deleted && !c.mergedInto && c.consent?.talentPool === true && c.retainUntil >= today && canSeeCandidate(s, a, c))
    .map(c => { const record = { ...c, customFields: Object.values(c.customValues ?? {}).join(' '), resumeText: s.all('resume-extraction').filter(r => r.candidate === c.id).map(r => r.sourceText).concat(s.all('document').filter(d => d.candidate === c.id && d.kind === 'resume').map(d => s.resumeTexts.get(d.id))).filter(Boolean).join(' ') }; return { c, record, f: matches(record, ['headline', 'skills', 'location', 'name', 'customFields', 'resumeText'], words) } })
    .filter(x => x.f)
    .map(({ c, record, f }) => ({ candidate: c.id, name: c.name, matchedFields: f, evidence: Object.fromEntries(f!.map(k => [k, record[k]])), permission: { basis: c.consent.basis, talentPool: true, retainUntil: c.retainUntil }, applications: s.all('application').filter(x => x.candidate === c.id).map(x => ({ vacancy: x.vacancy, status: x.status })) }))
    .sort((x, y) => x.name.localeCompare(y.name))
}
