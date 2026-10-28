import { approvalRecipients } from '../records/approval-chains'
import type { State } from '../core/state'
import { TEAM_ROLES, teamOf } from '../core/access'
import { now, uid, type Data } from '../core/types'
import { describe, memberActor, reach } from './describe'
import { nextMorning, settingFor, type EventKind } from './events'

// Raising an alert happens inside the command that caused it, in the same save, so an alert exists exactly when its
// cause does. Who hears is checked against live access right here and again when the alert is shown or sent.

export type Cause = { vacancy: Data | null; application?: Data | null; candidate?: string; approval?: string; item?: string; by: string | null; scope: 'team' | 'addressed'; what?: string; note?: string; textOnly?: boolean; excerpt?: string }

/** Everyone named on a job's team, its own hiring manager first. */
export const teamEmails = (v: Data) => [...new Set([v.manager, ...TEAM_ROLES.flatMap(r => teamOf(v, r))].filter(Boolean))] as string[]
/** Recruiters, coordinators and hiring managers: the people who run the job. */
export const runnerEmails = (v: Data) => [...new Set([v.manager, ...(['recruiters', 'coordinators', 'hiringManagers'] as const).flatMap(r => teamOf(v, r))].filter(Boolean))] as string[]

/** Raise one alert for each person who may hear of it and has not switched it off; never for the person who caused it. */
export function notify(s: State, event: EventKind, to: string[], cause: Cause) {
  const at = Date.now()
  for (const email of new Set(to.map(x => x.toLowerCase()))) {
    if (email === cause.by) continue
    const who = memberActor(s, s.find('member', email))
    if (!who) continue
    const alert: Data = { event, to: email, vacancy: cause.vacancy?.id ?? null, application: cause.application?.id ?? null, candidate: cause.candidate ?? cause.application?.candidate ?? null, approval: cause.approval ?? null, item: cause.item ?? null, by: cause.by, scope: cause.scope, what: cause.what ?? null, note: cause.note ?? null, at: now() }
    if (cause.textOnly) Object.assign(alert, { textOnly: true, excerpt: cause.excerpt })
    else if (!reach(s, who, alert)) continue
    const { setting } = settingFor(s, email, cause.vacancy, event)
    if (setting.email === 'off' && setting.inApp === 'off') continue
    const digestAt = nextMorning(s, at)
    s.put('alert', uid(), {
      ...alert, readAt: null,
      inAppFrom: setting.inApp === 'off' ? null : new Date(setting.inApp === 'immediate' ? at : digestAt).toISOString(),
      email: setting.email, emailState: setting.email === 'off' ? 'off' : setting.email === 'immediate' ? 'queued' : 'digest', digestAt: new Date(digestAt).toISOString(),
    })
  }
}

const appVacancy = (s: State, app: Data) => s.get('vacancy', app.vacancy)

export const notifyApplication = (s: State, vacancy: Data, app: Data, by: string | null) => notify(s, 'application', teamEmails(vacancy), { vacancy, application: app, item: app.id, by, scope: 'team' })
export const notifyAssigned = (s: State, app: Data, reviewers: string[], by: string | null) => notify(s, 'assigned', reviewers, { vacancy: appVacancy(s, app), application: app, item: app.id, by, scope: 'addressed' })
export const notifyScorecard = (s: State, app: Data, card: Data, by: string) => { const vacancy = appVacancy(s, app); notify(s, 'scorecard', runnerEmails(vacancy), { vacancy, application: app, item: card.id, by, scope: 'team' }) }
export function notifyFeedback(s: State, app: Data, by: string) {
  const vacancy = appVacancy(s, app)
  notify(s, 'feedback', runnerEmails(vacancy), { vacancy, application: app, item: app.id, by, scope: 'team' })
  const panel = [...(app.reviewers ?? []), ...s.all('interview').filter(i => i.application === app.id && i.status !== 'cancelled').flatMap(i => i.participants ?? [])]
  notify(s, 'feedback', panel, { vacancy, application: app, item: app.id, by, scope: 'addressed' })
}
export function notifyInterview(s: State, iv: Data, by: string, what: 'scheduled' | 'canceled') {
  const app = s.get('application', iv.application), vacancy = appVacancy(s, app)
  notify(s, 'interview', runnerEmails(vacancy), { vacancy, application: app, item: iv.id, by, scope: 'team', what })
  notify(s, 'interview', iv.participants ?? [], { vacancy, application: app, item: iv.id, by, scope: 'addressed', what })
}
export function notifyOffer(s: State, offer: Data, by: string | null, what: string) {
  const app = s.get('application', offer.application), vacancy = appVacancy(s, app)
  notify(s, 'offer', runnerEmails(vacancy), { vacancy, application: app, item: offer.id, by, scope: 'team', what })
}
export function notifyApproval(s: State, approval: Data, by: string) {
  const subject = s.get(approval.subjectKind, approval.subjectId)
  const app = approval.subjectKind === 'vacancy' ? null : s.get('application', subject.application)
  notify(s, 'approval', approvalRecipients(approval), { vacancy: app ? appVacancy(s, app) : subject, application: app, approval: approval.id, item: approval.id, by, scope: 'addressed' })
}
