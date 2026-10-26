import type { Bindings } from '../../auth.server'
import { load, save } from '../core/store'
import type { State } from '../core/state'
import { now, type Data } from '../core/types'
import { businessDue } from '../reminders/timing'
import { nurtureEligibility, nurtureMessage, sameNurtureMessage } from './eligibility'

export async function prepareNurture(s: State, mail: Data) {
  const r = s.find('crm-enrollment', mail.enrollment)
  if (!r || !['active', 'completed'].includes(r.status)) return { status: 'canceled', reason: 'Nurture sequence is no longer active' }
  const eligible = await nurtureEligibility(s, r)
  if (!eligible.transport) return { status: eligible.status === 'stopped' ? 'canceled' : eligible.status, reason: eligible.reason }
  if (eligible.transport.replyTo !== r.replyAddress) return { status: 'withheld', reason: 'Monitored reply address changed after review' }
  const step = r.steps[mail.step]
  if (!step || mail.application !== r.sourceApplication || mail.candidate !== r.candidate || mail.vacancy !== eligible.app.vacancy || mail.language !== r.language || !sameNurtureMessage(r, step, mail.content)) return { status: 'withheld', reason: 'Outgoing event does not match the exact reviewed sequence' }
  const previous = s.scan('application-email').filter(m => m.enrollment === r.id && m.id !== mail.id && m.step < mail.step)
  if (previous.some(m => !['handed', 'delivered'].includes(m.status))) return { status: 'canceled', reason: 'A prior nurture attempt did not confirm provider handoff' }
  const due = businessDue(s, r, Date.now())
  if (Date.parse(due) > Date.now()) return { defer: due }
  return { transport: eligible.transport, message: mail.content }
}

function stop(s: State, r: Data, status: string, reason: string) {
  s.put('crm-enrollment', r.id, { ...r, status, reason, stoppedAt: now() })
  for (const mail of s.scan('application-email').filter(m => m.enrollment === r.id && m.status === 'pending'))
    s.put('application-email', mail.id, { ...mail, status: 'canceled', reason, finishedAt: now() })
  s.audit(null, 'crm-sequence-stopped', 'application:' + r.sourceApplication, { enrollment: r.id, reason })
}

/** Queue one step per tick; provider outcomes and current eligibility gate every next contact. */
export async function runNurture(env: Bindings, at: number) {
  const s = await load(env.DB)
  for (const listed of s.scan('crm-enrollment')) {
    if (!['active', 'completed'].includes(listed.status)) continue
    const r = s.get('crm-enrollment', listed.id), eligible = await nurtureEligibility(s, r, at)
    if (!eligible.transport) { stop(s, r, eligible.status, eligible.reason); continue }
    const previous = s.scan('application-email').filter(m => m.enrollment === r.id)
    if (previous.some(m => m.status === 'pending')) continue
    if (previous.some(m => !['handed', 'delivered'].includes(m.status))) {
      stop(s, r, 'held', 'A prior contact has no confirmed provider handoff; automatic contacts are stopped'); continue
    }
    if (r.status === 'completed' || Date.parse(r.nextDueAt) > at) continue
    const due = businessDue(s, r, at)
    if (Date.parse(due) > at) { s.put('crm-enrollment', r.id, { ...r, nextDueAt: due }); continue }
    const last = previous.sort((a, b) => (a.finishedAt ?? a.at).localeCompare(b.finishedAt ?? b.at)).at(-1)
    const earliest = last && Date.parse(last.finishedAt ?? last.at) + r.cadenceHours * 3600000
    if (earliest && earliest > at) { s.put('crm-enrollment', r.id, { ...r, nextDueAt: businessDue(s, r, earliest) }); continue }
    const step = r.steps[r.step], id = 'nurture-' + r.id + '-' + r.step
    if (!step || s.find('application-email', id)) continue
    s.put('application-email', id, { kind: 'nurture', enrollment: r.id, step: r.step, application: r.sourceApplication, candidate: r.candidate, vacancy: eligible.app.vacancy, targetVacancy: r.targetVacancy, status: 'pending', content: nurtureMessage(r, step), language: r.language, reviewedBy: r.by, templateVersion: 1, transportEpoch: r.transportEpoch, at: now(), dueAt: due, attempts: 0 })
    const completed = r.step + 1 >= r.steps.length
    s.put('crm-enrollment', r.id, { ...r, step: r.step + 1, status: completed ? 'completed' : 'active', nextDueAt: completed ? null : businessDue(s, r, at + r.cadenceHours * 3600000) })
    s.audit(null, 'crm-nurture-queued', 'application:' + r.sourceApplication, { enrollment: r.id, emailId: id, step: r.step, targetVacancy: r.targetVacancy })
  }
  await save(env.DB, s, null)
}
