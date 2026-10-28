import type { State } from '../core/state'
import { can, managesVacancy, requireApplication, requireCan, requireManages } from '../core/access'
import { blindFor } from '../core/blind'
import { canonical, now, oneOf, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { languageTag } from '../languages/posts'
import { MERGE_FIELDS } from './rejections'
import { PURPOSES } from './messages'

export const DRAFT_MERGE_FIELDS = [...MERGE_FIELDS, 'candidate_phone'] as const

/** Templates execute only named values, never expressions, restricted answers or nested fields. */
function templateText(value: unknown, label: string, max: number) {
  const result = text(value, label, max)
  const remainder = result.replace(/\{([^{}]*)\}/g, (_match, field: string) => {
    requireThat((DRAFT_MERGE_FIELDS as readonly string[]).includes(field), `Unknown merge field: ${field}`)
    return ''
  })
  requireThat(!/[{}]/.test(remainder), 'Complete every merge field with one pair of braces')
  return result
}

/** A saved review appends one immutable language version to this job's template. */
export function messageTemplate(s: State, a: Actor, b: Data) {
  const job = s.get('vacancy', b.vacancy)
  requireManages(a, job); requireCan(s, a, job, 'settings'); requireCan(s, a, job, 'contact')
  requireThat(!a.agent && !job.imported && job.status !== 'closed', 'A current human must review a template for an active native job', 403)
  const current = b.id ? s.get('message-template', b.id) : null
  requireThat(!current || current.vacancy === job.id, 'This template belongs to another job', 409)
  requireThat(!current || b.version === current.versions.at(-1).version, 'This template changed; open its current version before reviewing', 409)
  requireThat(b.reviewed === true, 'Review this exact subject and message in the stated application language')
  const version = {
    version: (current?.versions.at(-1)?.version ?? 0) + 1,
    name: text(b.name, 'Template name', 120), language: languageTag(b.language),
    purpose: oneOf(b.purpose ?? 'other', PURPOSES, 'Purpose'),
    subject: templateText(b.subject, 'Subject', 200), body: templateText(b.body, 'Message', 20000),
    reviewedBy: a.email, reviewedAt: now(),
  }
  const record = s.put('message-template', current?.id ?? uid(), {
    vacancy: job.id, name: version.name, versions: [...(current?.versions ?? []), version],
  })
  s.audit(a, 'message-template-reviewed', 'vacancy:' + job.id, { template: record.id, version: version.version, language: version.language })
  return record
}

export function messageTemplatesView(s: State, a: Actor) {
  if (a.agent) return []
  return s.all('message-template').filter(t => {
    const job = s.find('vacancy', t.vacancy)
    return job && managesVacancy(a, job) && can(s, a, job, 'contact')
  }).map(t => ({ ...t, revision: s.revisionOf('message-template', t.id) }))
}

/** Resolve the latest reviewed text in exactly the application's recorded language. */
export function templateMessage(s: State, a: Actor, reference: Data, application: string) {
  const app = requireApplication(s, a, application), job = s.get('vacancy', app.vacancy)
  requireManages(a, job); requireCan(s, a, job, 'contact')
  requireThat(!blindFor(s, a, app), 'Reveal this application before reviewing a contact draft', 409)
  const template = s.get('message-template', reference.id)
  requireThat(template.vacancy === job.id, 'This template belongs to another job', 409)
  requireThat(reference.revision === s.revisionOf('message-template', template.id), 'This template changed; select and preview its current version', 409)
  const language = app.language ?? 'en'
  const version = template.versions.filter((v: Data) => v.language === language).at(-1)
  requireThat(version?.reviewedBy, `No reviewed template in application language ${language}`, 409)
  const candidate = s.get('candidate', app.candidate), business = s.get('business', 'main')
  const values: Data = { candidate_name: candidate.name, candidate_phone: candidate.phone ?? '', job_title: job.title, business_name: business.name }
  const fill = (value: string) => value.replace(/\{([^{}]*)\}/g, (_match, field: string) => {
    requireThat(typeof values[field] === 'string' && values[field].trim(), `Missing merge value: ${field}`, 409)
    return values[field]
  })
  return {
    purpose: version.purpose, to: candidate.email, subject: fill(version.subject), body: fill(version.body),
    templateDraft: {
      template: template.id, version: version.version, language, name: version.name,
      reviewedBy: version.reviewedBy, reviewedAt: version.reviewedAt,
      subject: version.subject, body: version.body,
      recipient: { candidate: candidate.id, revision: s.revisionOf('candidate', candidate.id), language },
      values,
    },
  }
}

/** Earlier drafts retain their frozen template; changed recipient facts require a new preview. */
export function requireCurrentTemplateRecipient(s: State, m: Data, app: Data) {
  if (!m.templateDraft) return
  const { recipient, values } = m.templateDraft
  const candidate = s.get('candidate', app.candidate), job = s.get('vacancy', app.vacancy), business = s.get('business', 'main')
  requireThat(candidate.id === recipient.candidate && s.revisionOf('candidate', candidate.id) === recipient.revision
    && (app.language ?? 'en') === recipient.language && candidate.email === m.to
    && canonical(values) === canonical({ candidate_name: candidate.name, candidate_phone: candidate.phone ?? '', job_title: job.title, business_name: business.name }),
  'Recipient or merge data changed; create a fresh reviewed draft', 409)
}
