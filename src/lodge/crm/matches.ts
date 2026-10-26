import type { State } from '../core/state'
import { canSeeApplication, canSeeContact, canSeeDocument } from '../core/access'
import { requireThat, type Actor, type Data } from '../core/types'

/** Recruiters search only factual profile fields and original resumes they can already read. */
export function scopedMatches(s: State, a: Actor, query: unknown) {
  requireThat(typeof query === 'string' && query.trim().length >= 2 && query.length <= 200, 'Search for at least two characters')
  const words = query.toLowerCase().trim().split(/\s+/)
  return s.all('candidate').filter(c => !c.deleted && !c.mergedInto && c.consent?.talentPool && c.retainUntil >= new Date().toISOString().slice(0, 10) && canSeeContact(s, a, c)).flatMap(c => {
    const originals = s.all('document').filter(d => d.candidate === c.id && d.kind === 'resume' && canSeeDocument(s, a, d))
    const record: Data = { name: c.name, headline: c.headline, skills: c.skills, location: c.location, resumeText: originals.map(d => s.resumeTexts.get(d.id)).filter(Boolean).join(' ') }
    const fields = Object.keys(record).filter(field => typeof record[field] === 'string' && words.some(word => record[field].toLowerCase().includes(word)))
    if (!words.every(word => fields.some(field => record[field].toLowerCase().includes(word)))) return []
    return [{ candidate: c.id, name: c.name, matchedFields: fields, evidence: Object.fromEntries(fields.map(field => [field, record[field]])), permission: { basis: c.consent.basis, talentPool: true, retainUntil: c.retainUntil }, applications: s.all('application').filter(app => app.candidate === c.id && canSeeApplication(s, a, app)).map(app => ({ vacancy: app.vacancy, status: app.status })) }]
  }).sort((x, y) => x.name.localeCompare(y.name))
}
