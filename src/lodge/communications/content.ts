import type { State } from '../core/state'
import type { Data } from '../core/types'
import { fillApplicationEmail } from './templates'

export function applicationEmailContent(s: State, app: Data, template: Data, receipt: string, footer: string) {
  const person = s.get('candidate', app.candidate), job = s.get('vacancy', app.vacancy)
  const values: Record<string, string> = { candidateName: person.name, jobTitle: app.postTitle || (job.confidential ? job.publicTitle : job.title) || '', businessName: s.get('business', 'main').name, receiptCode: receipt, publicStatus: template.publicStatus ?? '' }
  const missing = [...new Set([...String(template.subject + template.body).matchAll(/{{(\w+)}}/g)].filter(match => !values[match[1]]?.trim()).map(match => match[1]))]
  if (!person.email?.trim()) missing.push('recipient')
  return { to: person.email, subject: fillApplicationEmail(template.subject, values), text: fillApplicationEmail(template.body, values) + '\n\n' + footer, missing }
}
