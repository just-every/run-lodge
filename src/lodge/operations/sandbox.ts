import type { State } from '../core/state'
import { can, managesVacancy, requireAdmin } from '../core/access'
import { canonical, list, now, requireThat, sha256, text, uid, type Actor, type Data } from '../core/types'
import { configuration, configurationImpact, editConfiguration, installConfiguration, settingsJob, sourceStamp, validateConfiguration } from './configuration'
import { selection, trial } from './trial'
import { requireProviderPlan } from './providers'

function open(s: State, a: Actor, id: unknown) {
  const box = s.get('workflow-sandbox', id, 'sandbox')
  settingsJob(s, a, box.vacancy)
  return box
}

export async function createSandbox(s: State, a: Actor, b: Data) {
  const v = settingsJob(s, a, b.vacancy)
  const selected = selection(s, a, v.id, b)
  const record = s.put('workflow-sandbox', uid(), { name: text(b.name, 'Sandbox name', 100), vacancy: v.id, config: configuration(s, v.id), selection: selected, edits: [], status: 'draft', createdBy: a.email, createdAt: now() })
  s.audit(a, 'sandbox-cloned', 'vacancy:' + v.id, { sandbox: record.id, mode: selected.mode, cases: selected.samples.length })
  return record
}

export function editSandbox(s: State, a: Actor, b: Data) {
  const box = open(s, a, b.id)
  requireThat(box.status !== 'deployed', 'Rollback the deployed configuration before changing this sandbox', 409)
  const edits = list(b.edits, 'Configuration changes', 30, raw => { requireThat(raw && typeof raw === 'object', 'Give a configuration change'); return raw as Data })
  const isolated = s.clone()
  installConfiguration(isolated, box.vacancy, box.config)
  // Editing a trial is permitted while the source is published; production keeps LDG-002's publication lock.
  const v = isolated.get('vacancy', box.vacancy)
  isolated.put('vacancy', v.id, { ...v, status: 'draft' })
  editConfiguration(isolated, a, v.id, edits)
  const config = configuration(isolated, v.id)
  const record = s.put('workflow-sandbox', box.id, { ...box, config, edits: [...box.edits, ...edits], status: 'draft', preview: null, updatedAt: now() })
  s.audit(a, 'sandbox-edited', 'vacancy:' + v.id, { sandbox: box.id, changes: edits.map(e => e.op) })
  return record
}

export async function previewSandbox(s: State, a: Actor, b: Data) {
  const box = open(s, a, b.id)
  requireThat(box.status !== 'deployed', 'This version is already deployed', 409)
  // Revalidate edits with today's source definitions and current permissions.
  const isolated = s.clone(), v = isolated.get('vacancy', box.vacancy)
  isolated.put('vacancy', v.id, { ...v, status: 'draft' })
  validateConfiguration(isolated, a, v.id, box.config)
  installConfiguration(isolated, v.id, box.config)
  const impact: Data = await trial(isolated, a, v.id, box.selection)
  impact.changes = configurationImpact(s, configuration(s, v.id), box.config, a)
  const source = await sourceStamp(s), configVersion = await sha256(canonical(box.config))
  const token = await sha256(canonical({ sandbox: box.id, configVersion, source, selection: box.selection, impact }))
  const preview = { token, source, configVersion, impact, at: now() }
  s.put('workflow-sandbox', box.id, { ...box, status: 'review', preview })
  s.audit(a, 'sandbox-previewed', 'vacancy:' + v.id, { sandbox: box.id, token })
  return preview
}

export async function deploySandbox(s: State, a: Actor, b: Data) {
  const box = open(s, a, b.id), v = settingsJob(s, a, box.vacancy)
  requireThat(b.confirmProduction === true, 'Explicitly approve deploying this reviewed configuration to production')
  requireThat(box.status === 'review' && box.preview && b.token === box.preview.token, 'Review this exact sandbox version before deploying', 409)
  requireThat(await sourceStamp(s) === box.preview.source && await sha256(canonical(box.config)) === box.preview.configVersion, 'The source or configuration changed; preview again', 409)
  requireThat(v.status !== 'open', 'Unpublish the vacancy before deploying configuration; then preview again', 409)
  for (const connector of box.config.workflowConnectors ?? []) requireProviderPlan(s, connector)
  // Execute the same validators under current authority, on a disposable copy.
  validateConfiguration(s, a, v.id, box.config)
  const previous = configuration(s, v.id)
  installConfiguration(s, v.id, box.config)
  if (canonical(previous.applicationEmailTiming) !== canonical(box.config.applicationEmailTiming)) {
    const current = s.get('vacancy', v.id)
    s.put('vacancy', v.id, { ...current, applicationEmailTimingBy: a.email })
  }
  const record = s.put('workflow-sandbox', box.id, { ...box, status: 'deployed', previous, deployedBy: a.email, deployedAt: now(), rollbackStamp: await sourceStamp(s, true) })
  s.audit(a, 'sandbox-config-deployed', 'vacancy:' + v.id, { sandbox: box.id, token: b.token })
  return record
}

export async function rollbackSandbox(s: State, a: Actor, b: Data) {
  const box = open(s, a, b.id), v = settingsJob(s, a, box.vacancy)
  requireThat(box.status === 'deployed' && box.previous, 'This sandbox has no deployed configuration to undo', 409)
  requireThat(v.status !== 'open', 'Unpublish the vacancy before rollback', 409)
  requireThat(await sourceStamp(s, true) === box.rollbackStamp, 'Hiring records changed after deployment; review a new sandbox instead of overwriting them', 409)
  // Rule authoring and rollback retain the same admin boundary.
  if (canonical(configuration(s, v.id).applicationEmailTiming) !== canonical(box.previous.applicationEmailTiming)) {
    requireAdmin(a); requireThat(!a.agent, 'A human must review status timing', 403)
    validateConfiguration(s, a, v.id, box.previous)
  }
  if (canonical(configuration(s, v.id).rules) !== canonical(box.previous.rules)) requireAdmin(a)
  if (canonical(v.workflowConnectors ?? []) !== canonical(box.previous.workflowConnectors)) requireAdmin(a)
  for (const connector of box.previous.workflowConnectors ?? []) requireProviderPlan(s, connector)
  const restricted = (config: Data) => (config.customSchema ?? []).filter((f: Data) => f.restricted)
  if (canonical(restricted(configuration(s, v.id))) !== canonical(restricted(box.previous))) requireAdmin(a)
  // The prior configuration was valid when captured; the exact content stamp fences all intervening facts.
  installConfiguration(s, v.id, box.previous)
  const record = s.put('workflow-sandbox', box.id, { ...box, status: 'rolled-back', previous: null, preview: null, rolledBackBy: a.email, rolledBackAt: now() })
  s.audit(a, 'sandbox-config-rolled-back', 'vacancy:' + v.id, { sandbox: box.id })
  return record
}

/** Historical selection is retained only by id; live visibility still controls every read. */
export function sandboxesView(s: State, a: Actor) {
  return s.all('workflow-sandbox').filter(box => {
    const v = s.find('vacancy', box.vacancy)
    return v && managesVacancy(a, v) && can(s, a, v, 'settings') && box.selection.samples.every((sample: Data) => !sample.application || !!s.find('application', sample.application) && (() => { try { selection(s, a, v.id, { mode: 'historical', samples: [sample] }); return true } catch { return false } })())
  })
}
