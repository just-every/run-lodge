import type { State } from '../core/state'
import { isAdmin, managesVacancy, requireAdmin, requireCan, requireManages, requireMember } from '../core/access'
import { date, now, oneOf, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { closeApplication, closeChoice } from './rejections'
import { jobForm } from './questions'
import { notifyAssigned } from '../notify/emit'

// SCREEN-002: rules on a job's objective screening answers (SCREEN-001). A rule
// matches an exact value or numeric/date bounds and then routes the application
// to a stage or reviewer, tags it, or proposes its rejection into the job's
// "rule matches" queue for a recruiter to confirm. An admin may approve a rule
// version for automatic rejection; it applies only to answers given after that
// approval. Editing a rule saves a new version and never re-evaluates earlier
// applications except through an explicit preview and apply. Rules read only
// objective answers: never free text, files, resumes, monitoring or accommodation.

export const RULE_ACTIONS = ['route', 'assign', 'tag', 'propose-reject'] as const

function condition(q: Data, m: Data) {
  switch (q.type) {
    case 'yes-no': return { equals: [oneOf(Array.isArray(m?.equals) ? m.equals[0] : m?.equals, ['yes', 'no'] as const, 'Answer to match')] }
    case 'single-choice':
    case 'multiple-choice': {
      const equals = (Array.isArray(m?.equals) ? m.equals : [m?.equals]).filter((x: unknown) => typeof x === 'string')
      requireThat(equals.length && equals.every((x: string) => q.options.includes(x)), 'Match one or more of the question’s choices')
      return { equals }
    }
    case 'number': {
      const bound = (x: unknown, label: string) => x === undefined || x === null || x === '' ? undefined : (requireThat(Number.isFinite(Number(x)), `${label} must be a number`), Number(x))
      const min = bound(m?.min, 'At least'), below = bound(m?.below, 'Below')
      requireThat(min !== undefined || below !== undefined, 'Give “at least”, “below” or both')
      return { min, below }
    }
    case 'date': {
      const onOrAfter = m?.onOrAfter ? date(m.onOrAfter, 'On or after') : undefined, onOrBefore = m?.onOrBefore ? date(m.onOrBefore, 'On or before') : undefined
      requireThat(onOrAfter || onOrBefore, 'Give a first or last date')
      return { onOrAfter, onOrBefore }
    }
  }
  throw new Error('unreachable')
}

/** Whether a stored answer satisfies a rule condition: choices by exact value, numbers by [min, below), dates inclusive. */
export function matches(when: Data, answer: Data | undefined) {
  if (!answer) return false
  const v = answer.value
  if (when.equals) return (Array.isArray(v) ? v : [v]).some((x: unknown) => when.equals.includes(x))
  if (typeof v === 'number') return (when.min === undefined || v >= when.min) && (when.below === undefined || v < when.below)
  if (typeof v === 'string' && (when.onOrAfter || when.onOrBefore)) return (!when.onOrAfter || v >= when.onOrAfter) && (!when.onOrBefore || v <= when.onOrBefore)
  return false
}

function action(s: State, v: Data, b: Data) {
  const kind = oneOf(b?.kind, RULE_ACTIONS, 'Rule action')
  if (kind === 'route') { requireThat(v.stages.some((st: Data) => st.id === b.stage), 'Choose a stage of this job'); return { kind, stage: b.stage as string } }
  if (kind === 'assign') return { kind, reviewer: requireMember(s, text(b.reviewer, 'Reviewer').toLowerCase(), 'interviewer').email }
  if (kind === 'tag') return { kind, tag: text(b.tag, 'Tag', 60) }
  // DISP-001: the proposed rejection carries one of the employer's “we rejected them” reasons and its email choice
  // (no email, now, or a template after business days), checked exactly as a person's rejection is.
  const choice = closeChoice(s, 'rejected', { closeReason: b.closeReason, send: b.send, template: b.template, businessDays: b.businessDays })
  const email = choice.email ? { send: choice.email.send, template: choice.email.template.id, templateName: choice.email.template.name, businessDays: choice.email.businessDays } : { send: 'none' }
  return { kind, reason: text(b.reason, 'Rejection reason', 500), closeReason: choice.reason.id, ...email }
}

/** Author a rule on a job, or with `id` save its next version (which needs a fresh automatic-rejection approval). */
export function screeningRule(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const current = b.id ? s.get('screening-rule', b.id) : null
  const v = s.get('vacancy', current?.vacancy ?? b.vacancy)
  requireManages(a, v)
  requireThat(v.status !== 'closed' && !v.imported, 'Rules go on a live job only', 409)
  const q = jobForm(s, v).find((x: Data) => x.question === b.question)
  requireThat(q, 'Choose one of this job’s screening questions', 409)
  requireThat(q.objective, 'Rules read objective answers only (yes/no, choice, number, date), never free text or files', 409)
  const version = { version: (current?.versions.length ?? 0) + 1, question: q.question, questionText: q.text, when: condition(q, b.when), then: action(s, v, b.then), by: a.email, at: now() }
  const record = s.put('screening-rule', current?.id ?? uid(), { ...(current ?? { vacancy: v.id, createdAt: now(), auto: null }), name: text(b.name ?? current?.name, 'Rule name', 120), active: b.active !== false, versions: [...(current?.versions ?? []), version] })
  s.audit(a, current ? 'rule-version' : 'rule-created', 'vacancy:' + v.id, { rule: record.id, version: version.version })
  return record
}

/** An employer admin approves the current version for automatic rejection; it covers only answers given from now on. */
export function approveAutoReject(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const rule = s.get('screening-rule', b.id)
  requireManages(a, s.get('vacancy', rule.vacancy))
  const latest = rule.versions.at(-1)
  requireThat(latest.then.kind === 'propose-reject', 'Only a rejection rule can reject automatically', 409)
  const record = s.put('screening-rule', rule.id, { ...rule, auto: { version: latest.version, approvedBy: a.email, approvedAt: now() } })
  s.audit(a, 'rule-auto-approved', 'vacancy:' + rule.vacancy, { rule: rule.id, version: latest.version })
  return record
}

const autoFor = (rule: Data, version: Data, at: string) => rule.auto && rule.auto.version === version.version && at >= rule.auto.approvedAt ? rule.auto : null

/** Close as rejected with the rule's listed reason and email choice; the rule's own wording and how it was decided go in the note. */
function reject(s: State, app: Data, then: Data, note: string, actor: string) {
  return closeApplication(s, app, closeChoice(s, 'rejected', { closeReason: then.closeReason, send: then.send, template: then.template, businessDays: then.businessDays, reason: note }), actor)
}

/** Run one rule version on one application's answers; `live` is false for an explicit apply after a preview, which never rejects on its own. */
function act(s: State, rule: Data, version: Data, app: Data, path: string, live: boolean) {
  const answer = (app.answers ?? []).find((x: Data) => x.question === version.question)
  if (app.status !== 'active' || !matches(version.when, answer)) return app
  const by = `rule “${rule.name}” v${version.version}`
  const then = version.then
  if (then.kind === 'route' && then.stage !== app.stage) {
    s.put('stage-event', uid(), { application: app.id, from: app.stage, to: then.stage, reason: `Routed by ${by}`, actor: by, at: now() })
    return s.put('application', app.id, { ...app, stage: then.stage })
  }
  if (then.kind === 'assign') {
    const next = s.put('application', app.id, { ...app, reviewers: [...new Set([...(app.reviewers ?? []), then.reviewer])] })
    if (live && !(app.reviewers ?? []).includes(then.reviewer)) notifyAssigned(s, next, [then.reviewer], null)
    return next
  }
  if (then.kind === 'tag') return s.put('application', app.id, { ...app, tags: [...new Set([...(app.tags ?? []), then.tag])] })
  if (then.kind !== 'propose-reject') return app
  const auto = live ? autoFor(rule, version, app.submittedAt) : null
  const match = { application: app.id, vacancy: app.vacancy, rule: rule.id, ruleName: rule.name, version: version.version, question: version.questionText, questionVersion: answer.version, answer: answer.value, intakePath: path, reason: then.reason, templateName: then.templateName ?? null, at: now() }
  if (auto) {
    s.put('rule-match', uid(), { ...match, status: 'auto-rejected', approvedBy: auto.approvedBy, decidedAt: now() })
    return reject(s, app, then, `${then.reason} (automatic: ${by}, approved by ${auto.approvedBy})`, by)
  }
  if (!s.all('rule-match').some(m => m.application === app.id && m.rule === rule.id && m.version === version.version)) s.put('rule-match', uid(), { ...match, status: 'queued' })
  return app
}

/** Every active rule of the job, in its current version, on a new application. Intake paths call this the same way. */
export function evaluate(s: State, application: Data, path: string) {
  let app = application
  for (const rule of s.all('screening-rule').filter(r => r.vacancy === app.vacancy && r.active)) app = act(s, rule, rule.versions.at(-1), app, path, true)
  return app
}

/** Earlier active applications the current version would match; nothing changes. */
export function previewRule(s: State, a: Actor, b: Data) {
  const rule = s.get('screening-rule', b.id)
  requireManages(a, s.get('vacancy', rule.vacancy))
  const version = rule.versions.at(-1)
  const done = new Set(s.all('rule-match').filter(m => m.rule === rule.id && m.version === version.version).map(m => m.application))
  const hits = s.all('application').filter(app => app.vacancy === rule.vacancy && app.status === 'active' && !done.has(app.id) && matches(version.when, (app.answers ?? []).find((x: Data) => x.question === version.question)))
  return { rule: rule.id, version: version.version, applications: hits.map(app => ({ application: app.id, answer: app.answers.find((x: Data) => x.question === version.question).value })) }
}

/** Apply the current version to the previewed applications only: rejections are queued for a recruiter, never automatic. */
export function applyRule(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const preview = previewRule(s, a, b)
  const chosen = new Set(Array.isArray(b.applications) ? b.applications : [])
  const rule = s.get('screening-rule', b.id), version = rule.versions.at(-1)
  const applied = preview.applications.filter(x => chosen.has(x.application))
  for (const x of applied) act(s, rule, version, s.get('application', x.application), 'Earlier application (preview and apply)', false)
  s.audit(a, 'rule-applied', 'vacancy:' + rule.vacancy, { rule: rule.id, version: version.version, applications: applied.length })
  return { applied: applied.map(x => x.application) }
}

/** A recruiter confirms queued rejections one by one or the whole queue, and is recorded as the decider; or dismisses one with a reason. */
export function decideRuleMatches(s: State, a: Actor, b: Data) {
  const decision = oneOf(b.decision, ['confirm', 'dismiss'] as const, 'Decision')
  // Check the job is the caller's before saying anything about its queue.
  if (b.all === true) requireManages(a, s.get('vacancy', b.vacancy))
  const queue = b.all === true ? s.scan('rule-match').filter(m => m.vacancy === b.vacancy && m.status === 'queued') : [s.get('rule-match', b.id)]
  requireThat(queue.length, 'Nothing is waiting in this queue', 409)
  const note = decision === 'dismiss' ? text(b.reason, 'Why the rule does not apply', 500) : ''
  for (const m of queue) {
    const v = s.get('vacancy', m.vacancy)
    requireManages(a, v)
    if (decision === 'confirm') requireCan(s, a, v, 'reject')
    requireThat(m.status === 'queued', 'This match was already decided', 409)
    const app = s.get('application', m.application)
    if (decision === 'confirm' && app.status === 'active') reject(s, app, s.get('screening-rule', m.rule).versions.find((x: Data) => x.version === m.version).then, `${m.reason} (rule “${m.ruleName}” v${m.version}, confirmed)`, a.email)
    s.put('rule-match', m.id, { ...m, status: decision === 'confirm' ? (app.status === 'active' ? 'confirmed' : 'closed-already') : 'dismissed', decidedBy: a.email, decidedAt: now(), ...(note ? { note } : {}) })
  }
  s.audit(a, 'rule-matches-' + decision, 'vacancy:' + queue[0].vacancy, { count: queue.length })
  return { decided: queue.length }
}

/** Rules and their queue for the people who run the job. */
export function rulesView(s: State, a: Actor, visibleApps: Set<string>) {
  const runs = (id: string) => { const v = s.find('vacancy', id); return !!v && managesVacancy(a, v) }
  return {
    screeningRules: s.all('screening-rule').filter(r => runs(r.vacancy)),
    ruleMatches: s.all('rule-match').filter(m => visibleApps.has(m.application) && runs(m.vacancy)).sort((x, y) => x.at.localeCompare(y.at)),
    canAuthorRules: isAdmin(a),
  }
}
