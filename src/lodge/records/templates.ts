import { chainSteps } from './approval-chains'
import type { State } from '../core/state'
import { requireAdmin, requireManages, requireRole } from '../core/access'
import { now, requireThat, text, uid, type Actor, type Data } from '../core/types'
import { criteriaList, stageList, vacancy } from './vacancies'
import { templateVersion } from './offer-templates'
import { validTeam } from './team'

// REQ-002: job templates and cloning. A template holds a job's setup: stages,
// interview plan with its kits, rubric, screening questions, application rules
// and hiring-team roles. A new job copies the template as it reads that moment,
// so later template edits never reach it; a clone copies another job's terms
// and setup but never its candidates, approvals, openings or kickoff. Either
// way the new job is a draft that needs its own LDG-001 approval.

/** What a job's setup carries: everything but its terms, its people's records and its approvals. */
function setupOf(s: State, v: Data) {
  return {
    stages: v.stages, criteria: (v.rubrics ?? []).at(-1)?.criteria ?? [], plan: v.plan ?? [], questions: v.questions ?? [], team: v.team ?? {}, offerTemplate: v.offerTemplate ?? null, approvalChain: v.approvalChain ?? null, approvalRouting: v.approvalRouting ?? {},
    rules: s.all('screening-rule').filter(r => r.vacancy === v.id && r.active).map(r => {
      const x = r.versions.at(-1)
      return { name: r.name, question: x.question, questionText: x.questionText, when: x.when, then: x.then, by: x.by }
    }),
  }
}

/** Keep a template's or job's own plan and rules consistent with its stages, rubric and questions. */
function consistent(setup: Data) {
  const stageIds = new Set(setup.stages.map((st: Data) => st.id)), criteria = new Set(setup.criteria.map((c: Data) => c.id)), questions = new Set(setup.questions.map((q: Data) => q.question))
  return {
    ...setup,
    plan: setup.plan.filter((p: Data) => stageIds.has(p.stage)).map((p: Data) => ({ ...p, criteria: p.criteria.filter((c: string) => criteria.has(c)) })),
    rules: setup.rules.filter((r: Data) => questions.has(r.question) && (r.then.kind !== 'route' || stageIds.has(r.then.stage))),
  }
}

/**
 * The owner or a hiring admin creates a template, from a job's setup or from
 * stages and criteria, or with `id` edits one. A rubric change is the
 * template's next rubric version; the template keeps every version.
 */
export function jobTemplate(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const current = b.id ? s.get('job-template', b.id, 'template') : null
  const name = text(b.name ?? current?.name, 'Template name', 120)
  requireThat(!s.scan('job-template').some(t => t.id !== current?.id && t.name.toLowerCase() === name.toLowerCase()), `A template named “${name}” already exists`, 409)
  let setup: Data = current ? { stages: current.stages, criteria: current.rubrics.at(-1)?.criteria ?? [], plan: current.plan, questions: current.questions, team: current.team, rules: current.rules, offerTemplate: current.offerTemplate ?? null, approvalChain: current.approvalChain ?? null, approvalRouting: current.approvalRouting ?? {} } : { stages: [], criteria: [], plan: [], questions: [], team: {}, rules: [] }
  if (b.fromVacancy) { const v = s.get('vacancy', b.fromVacancy); requireManages(a, v); setup = setupOf(s, v) }
  if (b.offerTemplate !== undefined) { const chosen = b.offerTemplate ? templateVersion(s, b.offerTemplate) : null; setup.offerTemplate = chosen ? { id: chosen.templateId, version: chosen.version } : null }
  if (b.stages) setup.stages = stageList(b.stages)
  if (b.criteria) setup.criteria = criteriaList(b.criteria)
  if (b.team) setup.team = validTeam(s, b.team, '')
  requireThat(setup.stages.length >= 2 && setup.criteria.length, 'A template needs its stages and a job-related rubric', 400)
  setup = consistent(setup)
  const last = current?.rubrics.at(-1)
  const changed = !last || JSON.stringify(last.criteria) !== JSON.stringify(setup.criteria)
  const rubrics = [...(current?.rubrics ?? []), ...(changed ? [{ version: (last?.version ?? 0) + 1, criteria: setup.criteria, by: a.email, at: now() }] : [])]
  const record = s.put('job-template', current?.id ?? uid(), { ...(current ?? { createdBy: a.email, createdAt: now() }), name, stages: setup.stages, rubrics, plan: setup.plan, questions: setup.questions, team: setup.team, rules: setup.rules, offerTemplate: setup.offerTemplate ?? null, approvalChain: setup.approvalChain ?? null, approvalRouting: setup.approvalRouting ?? {}, updatedBy: a.email, updatedAt: now() })
  s.audit(a, current ? 'template-updated' : 'template-created', 'job-template:' + record.id, { name, rubricVersion: rubrics.at(-1).version })
  return record
}

/** Give a new draft job a setup: its rubric starts at version 1, its rules at version 1 with no automatic-rejection approval. */
function adopt(s: State, a: Actor, job: Data, setup: Data, from: Data) {
  if (setup.approvalChain) chainSteps(s, setup.approvalChain.steps, job)
  const team = validTeam(s, setup.team ?? {}, job.manager)
  const record = s.put('vacancy', job.id, { ...job, stages: setup.stages, rubrics: [{ version: 1, criteria: setup.criteria, by: a.email, at: now() }], plan: setup.plan, questions: setup.questions.filter((q: Data) => s.find('question', q.question)), team, offerTemplate: setup.offerTemplate ?? null, approvalChain: setup.approvalChain ?? null, approvalRouting: setup.approvalRouting ?? {}, ...from })
  for (const r of setup.rules) s.put('screening-rule', uid(), { vacancy: job.id, createdAt: now(), auto: null, name: r.name, active: true, versions: [{ version: 1, question: r.question, questionText: r.questionText, when: r.when, then: r.then, by: r.by, at: now(), copiedBy: a.email }] })
  return record
}

/** A new draft job from a template's current version; the job's own terms come with the request. */
export function vacancyFromTemplate(s: State, a: Actor, b: Data) {
  requireRole(a, 'admin', 'manager')
  const t = s.get('job-template', b.template, 'template')
  const job = vacancy(s, a, { ...b, id: undefined })
  const record = adopt(s, a, job, consistent({ stages: t.stages, criteria: t.rubrics.at(-1).criteria, plan: t.plan, questions: t.questions, team: t.team, rules: t.rules, offerTemplate: t.offerTemplate ?? null, approvalChain: t.approvalChain ?? null, approvalRouting: t.approvalRouting ?? {} }), { fromTemplate: { id: t.id, name: t.name, rubricVersion: t.rubrics.at(-1).version } })
  s.audit(a, 'vacancy-from-template', 'vacancy:' + record.id, { template: t.id, rubricVersion: t.rubrics.at(-1).version })
  return record
}

/** Clone a job: its terms (with any changes sent) and setup, never its candidates, approvals, openings or kickoff. A confidential job's clone stays confidential to the same people. */
export function cloneVacancy(s: State, a: Actor, b: Data) {
  const source = s.get('vacancy', b.id)
  requireManages(a, source)
  requireThat(!source.imported, 'Imported vacancies are history; start a new vacancy instead', 409)
  // A new office or department sent with the clone fills its location or department text afresh.
  const job = vacancy(s, a, {
    title: b.title ?? source.title, departmentId: b.departmentId ?? source.departmentId, officeId: b.officeId ?? source.officeId, locations: b.officeId ? undefined : source.locations,
    department: b.departmentId ? undefined : source.department, location: b.location ?? (b.officeId ? '' : source.location),
    workMode: source.workMode, employmentType: source.employmentType, description: source.description, compensation: source.compensation, headcount: source.headcount, manager: source.manager,
  })
  const record = adopt(s, a, job, consistent(setupOf(s, source)), { clonedFrom: source.id, confidential: source.confidential === true, namedPeople: source.confidential ? source.namedPeople ?? [] : [], publicTitle: source.confidential ? source.publicTitle ?? '' : '' })
  s.audit(a, 'vacancy-cloned', 'vacancy:' + record.id, { from: source.id })
  return record
}
