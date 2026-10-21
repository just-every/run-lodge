import type { State } from '../core/state'
import { canSeeApplication, isAdmin, managesVacancy, onTeam, TEAM_ROLES } from '../core/access'
import { scope, type Actor, type Data } from '../core/types'
import { describe, reach } from './describe'
import { EVENTS, settingFor, type EventKind } from './events'

/** The reader's own alerts that have come due and still point at something they may see; an agent hears nothing. */
export function alertsView(s: State, a: Actor): Data[] {
  if (a.agent) return []
  const me = scope(a), at = Date.now()
  const due = s.all('alert').filter(x => x.to === me && x.inAppFrom && Date.parse(x.inAppFrom) <= at).sort((p, q) => q.at.localeCompare(p.at))
  const out: Data[] = []
  // Newest first, checking live access only until the list is full.
  for (const x of due) {
    if (out.length >= 200) break
    if (!reach(s, a, x)) continue
    const d = describe(s, x, a)
    out.push({ id: x.id, event: x.event, label: d.label, title: d.title, detail: d.detail, link: d.link, by: x.by, at: x.at, read: !!x.readAt, textOnly: x.textOnly === true, ...(x.textOnly ? {} : { application: x.application, candidate: x.candidate }), vacancy: x.vacancy })
  }
  return out
}

/** The settings screen's data: the reader's effective choices on each job they are on, and for admins the role defaults and mention policy. */
export function notifyView(s: State, a: Actor) {
  if (a.agent) return null
  const me = scope(a), events = Object.keys(EVENTS) as EventKind[]
  const jobs = s.all('vacancy').filter(v => !v.imported && v.status !== 'closed' && (managesVacancy(a, v) || onTeam(me, v) || s.all('application').some(x => x.vacancy === v.id && canSeeApplication(s, a, x)))).map(v => ({
    vacancy: v.id, title: v.title,
    settings: Object.fromEntries(events.map(e => { const r = settingFor(s, me, v, e); return [e, { ...r.setting, own: r.own }] })),
  }))
  const admin = isAdmin(a)
  return { events: EVENTS, roles: TEAM_ROLES, jobs, refuseWithoutAccess: admin ? s.find('mention-policy', 'main')?.refuseWithoutAccess === true : null, defaults: admin ? s.find('notify-default', 'main')?.roles ?? {} : null }
}
