import type { State } from '../core/state'
import { can, canSeeApplication, canSeeContact, isAdmin, managesVacancy, requireCan, requireManages } from '../core/access'
import { now, oneOf, requireThat, text, type Actor, type Data } from '../core/types'
import { activeApplicationTransport } from './transport'

const fields = new Set(['candidateName', 'jobTitle', 'businessName', 'receiptCode', 'publicStatus'])
export const templateId = (vacancy: string, kind: string, language: string, stage = '') => [vacancy, kind, language, stage].join(':')

function administer(s: State, a: Actor, id: unknown) {
  requireThat(isAdmin(a) && !a.agent, 'Only a human owner or hiring admin can approve application emails', 403)
  const v = s.get('vacancy', id)
  requireManages(a, v); requireCan(s, a, v, 'settings'); requireCan(s, a, v, 'contact')
  requireThat(!v.imported, 'Imported history cannot send application emails', 409)
  return v
}

export function applicationEmailSettings(s: State, a: Actor) {
  requireThat(isAdmin(a) && !a.agent, 'Only a human owner or hiring admin can approve application emails', 403)
  const transport = s.find('application-email-transport', 'main'), active = activeApplicationTransport(s)
  return { transport, active: !!active, jobs: s.all('vacancy').filter(v => !v.imported && managesVacancy(a, v) && can(s, a, v, 'settings') && can(s, a, v, 'contact')).map((v): Data => {
    const policy = s.find('application-email-policy', v.id), current = active && policy?.transportEpoch === active.epoch
    return { ...v, policy: current ? policy! : { acknowledgment: false, stages: [] }, templates: s.all('application-email-template').filter(t => t.vacancy === v.id), outcomes: s.all('application-email').filter(m => m.vacancy === v.id && canSeeApplication(s, a, s.get('application', m.application)) && canSeeContact(s, a, s.get('candidate', m.candidate))) }
  }) }
}

export function configureApplicationEmails(s: State, a: Actor, b: Data) {
  const v = administer(s, a, b.vacancy)
  const transport = activeApplicationTransport(s)
  requireThat(!(b.acknowledgment || b.stages?.length) || transport, 'Review and enable the installation sender before enabling a job', 409)
  requireThat(typeof b.acknowledgment === 'boolean' && Array.isArray(b.stages) && b.stages.every((id: unknown) => v.stages.some((st: Data) => st.id === id)), 'Choose valid job stages and an acknowledgment setting')
  const previous = s.find('application-email-policy', v.id)
  const record = s.put('application-email-policy', v.id, { vacancy: v.id, acknowledgment: b.acknowledgment, stages: [...new Set(b.stages)], transportEpoch: transport?.epoch ?? '', version: (previous?.version ?? 0) + 1, by: a.email, at: now() })
  s.audit(a, 'application-email-policy-changed', 'vacancy:' + v.id, { acknowledgment: record.acknowledgment, stages: record.stages })
  return record
}

export function reviewApplicationEmailTemplate(s: State, a: Actor, b: Data) {
  const v = administer(s, a, b.vacancy), kind = oneOf(b.kind, ['acknowledgment', 'status'], 'Email kind')
  const language = text(b.language, 'Application language', 35).toLowerCase()
  requireThat(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(language), 'Use an application language code')
  const stage = kind === 'status' ? text(b.stage, 'Stage', 100) : ''
  const transport = activeApplicationTransport(s)
  requireThat(transport, 'Review and enable the installation sender before approving email text', 409)
  requireThat(!stage || v.stages.some((st: Data) => st.id === stage), 'Choose a job stage')
  text(b.subject, 'Subject', 200); text(b.body, 'Email body', 20000)
  requireThat(typeof b.subject === 'string' && b.subject.length <= 200 && typeof b.body === 'string' && b.body.length <= 20000, 'Use a subject and email body within their length limits')
  const subject = b.subject, body = b.body
  requireThat(!/[\r\n]/.test(subject), 'Use a single-line subject')
  for (const match of (subject + body).matchAll(/{{(.*?)}}/g)) requireThat(fields.has(match[1]) && (kind === 'acknowledgment' ? match[1] !== 'publicStatus' : match[1] !== 'receiptCode'), 'Unknown template field for this purpose: ' + match[1])
  requireThat(!/\{\{|\}\}/.test((subject + body).replace(/{{(candidateName|jobTitle|businessName|receiptCode|publicStatus)}}/g, '')), 'Use complete template fields')
  requireThat(kind !== 'acknowledgment' || body.includes('{{receiptCode}}'), 'Acknowledgments must include {{receiptCode}}')
  requireThat(b.reviewed === true, 'Review this exact text in the application language before approving it')
  const id = templateId(v.id, kind, language, stage), previous = s.find('application-email-template', id)
  const footer = text(b.footer ?? (language === 'en' ? transport.footer : undefined), 'Reviewed footer in the application language', 4000)
  requireThat(!/\{\{|\}\}/.test(footer), 'Use complete reviewed footer text')
  const publicStatus = kind === 'status' && (subject + body).includes('{{publicStatus}}') ? text(b.publicStatus, 'Reviewed public status label', 200) : ''
  const record = s.put('application-email-template', id, { vacancy: v.id, kind, stage, language, subject, body, footer, publicStatus, transportEpoch: transport.epoch, version: (previous?.version ?? 0) + 1, reviewedBy: a.email, reviewedAt: now() })
  s.audit(a, 'application-email-template-reviewed', 'vacancy:' + v.id, { template: id, version: record.version, language, kind, stage })
  return record
}

export const fillApplicationEmail = (value: string, fields: Record<string, string>) => value.replace(/{{(\w+)}}/g, (_, key) => fields[key] ?? '')
