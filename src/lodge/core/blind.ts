import type { State } from './state'
import { scope, type Actor, type Data } from './types'

/** REVIEW-002: an application, never the shared person, defines the blind context. */
export function blindStage(v: Data | undefined, app: Data) {
  return !!v?.blindReview?.enabled && app.status === 'active' && v.blindReview.stages.includes(app.stage)
}
export function blindFor(s: State, a: Actor, app: Data) {
  const v = s.find('vacancy', app.vacancy)
  return blindStage(v, app) && !a.owner && !a.roles.includes('admin') && !(v?.team?.recruiters ?? []).includes(scope(a))
}
export const blindId = (app: Data) => 'blind:' + app.id
export const blindCode = (app: Data) => 'Application ' + app.id

/** Literal recorded values only; no model or trait/identity inference. */
export function redactor(s: State, app: Data) {
  const c = s.get('candidate', app.candidate), identity = s.find('blind-identity', app.id)
  const extractions = s.all('resume-extraction').filter(r => r.candidate === c.id && (!r.application || r.application === app.id))
  const values = [c.name, ...(c.name ?? '').split(/\s+/).filter((x: string) => x.length > 1), c.email, c.phone, c.location, ...(identity?.schools ?? []), ...(identity?.years ?? []), ...extractions.flatMap(r => ['name', 'email', 'phone', 'location'].flatMap(k => [r.corrections?.[k], r.extraction?.[k]?.value]))]
    .filter((x): x is string => typeof x === 'string' && !!x.trim()).sort((a, b) => b.length - a.length)
  const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [...new Set(values)].map(value => new RegExp(escape(value).replace(/\s+/g, '\\s+'), 'giu'))
  const digits = (c.phone ?? '').replace(/\D/g, '')
  if (digits.length >= 7) patterns.push(new RegExp(digits.split('').join('[\\s().+\\-]*'), 'g'))
  return (value: string) => patterns.reduce((out, pattern) => out.replace(pattern, '[redacted]'), value)
}

/** Commands also return read material (notably bulk previews); they obey the current context. */
export function blindResult(s: State, a: Actor, value: any, context?: Data): any {
  if (Array.isArray(value)) return value.map(x => blindResult(s, a, x, context))
  if (value && typeof value === 'object') {
    const subject = s.find('application', typeof value.application === 'string' ? value.application : value.id)
    const app = subject && blindFor(s, a, subject) ? subject : context
    const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ['id', 'application', 'vacancy'].includes(k) && typeof v === 'string' ? v : blindResult(s, a, v, app)]))
    if (app && value.candidateName) out.candidateName = blindCode(app)
    return out
  }
  if (context && typeof value === 'string') return value === context.candidate ? blindId(context) : redactor(s, context)(value)
  return value
}
