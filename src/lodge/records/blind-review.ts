import type { State } from '../core/state'
import { requireApplication, requireCan, requireManages } from '../core/access'
import { blindStage } from '../core/blind'
import { list, now, optionalText, requireThat, text, type Actor, type Data } from '../core/types'

export function blindReview(s: State, a: Actor, b: Data) {
  const v = s.get('vacancy', b.id)
  requireManages(a, v); requireCan(s, a, v, 'settings')
  const stages = [...new Set(list(b.stages ?? [], 'Blind stages', 30, x => text(x, 'Stage', 100)))]
  const revealStage = optionalText(b.revealStage, 'Reveal stage', 100)
  requireThat(stages.every(id => v.stages.some((st: Data) => st.id === id)), 'Choose blind stages of this job')
  requireThat(!b.enabled || (stages.length && v.stages.some((st: Data) => st.id === revealStage) && !stages.includes(revealStage)), 'Choose blind stages and a separate reveal stage')
  const record = s.put('vacancy', v.id, { ...v, blindReview: { enabled: b.enabled === true, stages, revealStage } })
  s.audit(a, 'blind-review-configured', 'vacancy:' + v.id, { ...record.blindReview })
  return record
}

export function blindIdentity(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application), v = s.get('vacancy', app.vacancy)
  requireManages(a, v); requireCan(s, a, v, 'settings')
  const values = (input: unknown, label: string) => list(input ?? [], label, 50, x => text(x, label, 300))
  s.put('blind-identity', app.id, { application: app.id, candidate: app.candidate, schools: values(b.schools, 'School'), years: values(b.years, 'Graduation year') })
  s.audit(a, 'blind-identity-configured', 'application:' + app.id)
  return { application: app.id, saved: true }
}

/** Runs once at the transaction boundary: includes rules, bulk, transfer, hire, spam, close and settings changes. */
export function recordBlindReveals(s: State, a: Actor | null) {
  const pending = s.pending().writes
  if (!pending.some(w => w.kind === 'application' || w.kind === 'vacancy')) return
  const logged = new Set<string>()
  for (const write of pending.filter(w => w.kind === 'stage-event' && w.value)) {
    const event = write.value!, app = s.find('application', event.application)
    if (!app) continue
    const v = s.original('vacancy', app.vacancy) ?? s.find('vacancy', app.vacancy)
    if (v?.blindReview?.enabled && v.blindReview.stages.includes(event.from) && !v.blindReview.stages.includes(event.to)) {
      s.audit(a, 'blind-review-revealed', 'application:' + app.id, { application: app.id, from: event.from, to: event.to, at: now() })
      logged.add(app.id)
    }
  }
  const settingsChanged = pending.some(w => w.kind === 'vacancy' && JSON.stringify(s.original('vacancy', w.id)?.blindReview) !== JSON.stringify(w.value?.blindReview))
  for (const app of settingsChanged ? s.scan('application') : s.all('application')) {
    const before = s.original('application', app.id)
    if (!before || logged.has(app.id)) continue
    const oldJob = s.original('vacancy', before.vacancy), job = s.find('vacancy', app.vacancy)
    if (blindStage(oldJob, before) && (!blindStage(job, app) || app.vacancy !== before.vacancy))
      s.audit(a, 'blind-review-revealed', 'application:' + app.id, { application: app.id, from: before.stage, to: app.status === 'active' ? app.stage : app.status, at: now() })
  }
}
