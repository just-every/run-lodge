import type { State } from '../core/state'
import { requireAdmin, requireCan, requireManages, requireMember, isAdmin } from '../core/access'
import { canonical, list, oneOf, requireThat, sha256, type Actor, type Data } from '../core/types'
import { PROVIDERS } from './providers'
import { stages, rubric, plan, kit } from '../records/vacancies'
import { jobQuestions } from '../records/questions'
import { screeningRule } from '../records/rules'
import { fieldSchema, hiringViews } from '../fields/commands'

/** Only configuration commands cross from a trial to production. Trial records never do. */
export const CONFIG_COMMANDS: Record<string, (s: State, a: Actor, b: Data) => Data> = {
  'field-schema': fieldSchema, 'hiring-view': hiringViews, 'vacancy-stages': stages, rubric, 'interview-plan': plan, 'interview-kit': kit,
  'job-questions': jobQuestions, 'screening-rule': screeningRule, 'approval-routing': approvalRouting, 'workflow-connectors': workflowConnectors,
}

export function settingsJob(s: State, a: Actor, id: unknown) {
  const v = s.get('vacancy', id)
  requireManages(a, v); requireCan(s, a, v, 'settings')
  requireThat(!v.imported && v.status !== 'closed', 'Choose a current vacancy', 409)
  return v
}

function approvalRouting(s: State, a: Actor, b: Data) {
  const v = settingsJob(s, a, b.id), routing: Data = {}
  for (const kind of ['vacancy', 'offer', 'message']) {
    if (b.routing?.[kind]) routing[kind] = requireMember(s, String(b.routing[kind]).toLowerCase(), kind === 'message' ? 'manager' : 'approver').email
  }
  return s.put('vacancy', v.id, { ...v, approvalRouting: routing })
}

function workflowConnectors(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const v = settingsJob(s, a, b.id)
  const ids = [...new Set(list(b.connectors, 'Workflow connectors', PROVIDERS.length, id => oneOf(id, PROVIDERS.map(p => p.id), 'Connector')))]
  return s.put('vacancy', v.id, { ...v, workflowConnectors: ids })
}

export function configuration(s: State, id: string) {
  const v = s.get('vacancy', id)
  return structuredClone({ stages: v.stages, rubrics: v.rubrics, plan: v.plan, questions: v.questions ?? [], customSchema: v.customSchema ?? [], hiringViews: v.hiringViews ?? [], approvalRouting: v.approvalRouting ?? {}, workflowConnectors: v.workflowConnectors ?? [], rules: s.scan('screening-rule').filter(r => r.vacancy === id) })
}

export function installConfiguration(s: State, id: string, config: Data) {
  const { rules, ...fields } = config
  s.put('vacancy', id, { ...s.get('vacancy', id), ...fields })
  for (const r of s.scan('screening-rule').filter(r => r.vacancy === id)) if (!rules.some((n: Data) => n.id === r.id)) s.remove('screening-rule', r.id)
  for (const r of rules) s.put('screening-rule', r.id, r)
}

export function editConfiguration(s: State, a: Actor, id: string, edits: Data[]) {
  for (const edit of edits) {
    const execute = Object.hasOwn(CONFIG_COMMANDS, edit.op) ? CONFIG_COMMANDS[edit.op] : undefined
    requireThat(execute, 'Choose a supported configuration change')
    const input = { ...edit.input, id, vacancy: id }
    if (edit.op === 'screening-rule') {
      requireAdmin(a)
      input.id = edit.input?.id
      if (input.id) requireThat(s.get('screening-rule', input.id).vacancy === id, 'The rule belongs to another job', 403)
    }
    execute(s, a, input)
  }
}

/** Revalidate the normalized saved result, including edits to rules created within the trial. */
export function validateConfiguration(s: State, a: Actor, id: string, config: Data) {
  const isolated = s.clone(), live = configuration(s, id)
  const changedRules = canonical(config.rules) !== canonical(live.rules)
  if (changedRules) requireAdmin(a)
  // Preserve stable ids in the saved trial while using the ordinary validators.
  installConfiguration(isolated, id, config)
  stages(isolated, a, { id, stages: config.stages })
  const criteria = config.rubrics.at(-1)?.criteria ?? []
  if (criteria.length) rubric(isolated, a, { id, criteria })
  if (config.plan.length) plan(isolated, a, { id, plan: config.plan })
  jobQuestions(isolated, a, { id, questions: config.questions })
  if (!isAdmin(a)) requireThat(canonical((config.customSchema ?? []).filter((f: Data) => f.restricted)) === canonical((live.customSchema ?? []).filter((f: Data) => f.restricted)), 'Only the owner or a hiring admin can change restricted fields', 403)
  fieldSchema(isolated, a, { id, fields: (config.customSchema ?? []).filter((f: Data) => isAdmin(a) || !f.restricted) })
  const hiddenView = (view: Data) => (view.filters ?? []).some((filter: Data) => (config.customSchema ?? []).some((f: Data) => f.id === filter.field && f.restricted))
  if (!isAdmin(a)) requireThat(canonical((config.hiringViews ?? []).filter(hiddenView)) === canonical((live.hiringViews ?? []).filter(hiddenView)), 'Only the owner or a hiring admin can change restricted views', 403)
  hiringViews(isolated, a, { id, views: (config.hiringViews ?? []).filter((view: Data) => isAdmin(a) || !hiddenView(view)) })
  approvalRouting(isolated, a, { id, routing: config.approvalRouting })
  if (canonical(config.workflowConnectors) !== canonical(live.workflowConnectors)) workflowConnectors(isolated, a, { id, connectors: config.workflowConnectors })
  if (changedRules) for (const r of config.rules) {
    const x = r.versions.at(-1)
    screeningRule(isolated, a, { id: r.id, name: r.name, question: x.question, when: x.when, then: x.then, active: r.active })
  }
}

/** Fenced dependencies include absence, permissions, selected history and scheduling facts.
 * Deliberately conservative: another hiring change can require a fresh preview. */
export async function sourceStamp(s: State, content = false) {
  const kinds = ['vacancy', 'screening-rule', 'question', 'member', 'business', 'permission-level', 'application', 'candidate', 'interview', 'rejection-reasons', 'rejection-template', 'fair-chance', 'department', 'office', 'provider-setup', 'document', 'resume-extraction', 'blind-identity']
  const revisions = kinds.flatMap(kind => s.scan(kind).map(r => ({ kind, id: r.id, ...(content ? { value: r } : { revision: s.revisionOf(kind, r.id) }) }))).sort((x, y) => (x.kind + x.id).localeCompare(y.kind + y.id))
  return sha256(canonical(revisions))
}

/** Plain language configuration differences are part of the reviewed token. */
export function configurationImpact(s: State, before: Data, after: Data) {
  const stage = (c: Data, id: string) => c.stages.find((st: Data) => st.id === id)?.name ?? id
  const describe: Record<string, (c: Data) => string> = {
    stages: c => c.stages.map((st: Data) => st.name).join(' → '),
    rubric: c => (c.rubrics.at(-1)?.criteria ?? []).map((k: Data) => k.name + ': ' + k.description).join('; ') || 'No rubric',
    interviews: c => c.plan.map((p: Data) => `${p.name}, ${p.durationMinutes} minutes at ${stage(c, p.stage)}; focus: ${p.criteria.map((id: string) => c.rubrics.at(-1)?.criteria.find((k: Data) => k.id === id)?.name ?? id).join(', ') || 'none'}; purpose: ${p.purpose || 'none'}; kit: ${(p.questions ?? []).map((q: Data) => q.text + ' (' + q.guidance + ')').join('; ') || 'none'}`).join('; ') || 'No interviews',
    fields: c => c.questions.map((q: Data) => `${s.get('question', q.question).versions.at(-1).text}: ${q.required ? 'required' : 'optional'}`).join('; ') || 'No screening fields',
    customFields: c => (c.customSchema ?? []).map((f: Data) => `${f.name}: ${f.record} ${f.type}${f.choices.length ? ' (' + f.choices.join(', ') + ')' : ''}; ${f.restricted ? 'owner/admin only' : 'job-scoped readers'}; required at ${f.requiredStages.map((id: string) => stage(c, id)).join(', ') || 'no stage'}; identity ${f.identity || 'none'}; import column ${f.importColumn || 'none'}`).join('; ') || 'No custom fields',
    savedViews: c => (c.hiringViews ?? []).map((v: Data) => `${v.name}: query ${v.query || 'none'}; filters ${canonical(v.filters)}; tags ${v.tags.join(', ') || 'none'}`).join('; ') || 'No team hiring views',
    approvals: c => Object.entries(c.approvalRouting).map(([kind, who]) => `${kind}: ${who}`).join('; ') || 'Person selected when requesting approval',
    rules: c => c.rules.map((r: Data) => { const x = r.versions.at(-1), action = x.then; return `${r.name} v${x.version} (${r.active ? 'enabled' : 'disabled'}): ${x.questionText}; condition ${canonical(x.when)}; ${action.kind}${action.stage ? ' to ' + stage(c, action.stage) : action.tag ? ': ' + action.tag : action.reviewer ? ': ' + action.reviewer : action.reason ? ': ' + action.reason : ''}` }).join('; ') || 'No rules',
    connectors: c => c.workflowConnectors.map((id: string) => PROVIDERS.find(p => p.id === id)?.name ?? id).join(', ') || 'No connector references',
  }
  return Object.entries(describe).map(([area, describe]) => ({ area, before: describe(before), after: describe(after) })).filter(d => d.before !== d.after)
}
