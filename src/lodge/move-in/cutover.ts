import { canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index'
import type { State } from '../core/state'
import { requireAdmin } from '../core/access'
import { requireThat, text, uid, now, type Actor, type Data } from '../core/types'
import { requireStageFields } from '../fields/values'
import { decide, requestApproval } from '../records/approvals'
import { missingTerms } from '../records/vacancies'
import { legacyLink } from './legacy-links'

// MIG-008, first slice: moving an imported source job's still-open applications into a live Lodge job (the cutover),
// separate from closed history. Exact semantics (conservative defaults pending ct):
// - the owner prepares the live job with the ordinary vacancy commands (stages, rubric, plan, terms), then maps the
//   imported job onto it: each source stage the open applications sit in to one of its stages, and a rubric version;
//   a preview writes nothing and the activation must carry that preview's fingerprint;
// - open-in-source applications become new native active applications (history keeps the source stage and the move);
//   the imported rows are never edited, closed (disqualified) applications stay history, nobody is notified and
//   nothing is sent;
// - the job's approval: "adopt" has the owner approve the live job's exact terms now, reason naming the source's own
//   approved status, and only if the source approved it; otherwise the live job needs ordinary LDG-001 approval before it
//   publishes while its applicants still move;
// - contact: people moved in are not contactable until the employer records a basis ("application": they applied at the
//   source and the employer confirms continuing is permitted, with a note); until then messages to them are refused;
// - undo removes only activated applications that nobody has touched since; a moved, noted or scored one stays live,
//   marked with why; the approval adoption and any legacy link kept for a retained application stay.

const SOURCE = 'workable'
const TOUCHED = ['interview-day', 'interview', 'scorecard', 'interview-note', 'team-note', 'task', 'message', 'offer', 'review', 'rule-match', 'rejection-email', 'debrief', 'document', 'receipt', 'esign-envelope']

const activatedFor = (s: State, importedId: string) => s.all('application').find(x => x.activated?.from === importedId && !x.activated.undone)
const live = (s: State, id: string) => s.get('application', id)

/** Everything a cutover would do, worked out from the saved records, without writing. */
function plan(s: State, a: Actor, b: Data) {
  requireThat(a.owner, 'Only the owner moves data in', 403)
  const source = s.get('vacancy', b.importedJob, 'imported job')
  requireThat(source.imported && source.status === 'imported', 'Choose an imported job', 409)
  const target = s.get('vacancy', b.target, 'live job')
  requireThat(!target.imported && ['draft', 'open'].includes(target.status), 'Choose a draft or published Lodge job to move the applications into', 409)
  const rubric = b.rubricVersion === undefined ? target.rubrics.at(-1) : target.rubrics.find((r: Data) => r.version === Number(b.rubricVersion))
  requireThat(rubric?.criteria?.length, 'The live job needs the rubric version its applicants will be evaluated against', 409)
  const stageMap: Record<string, string> = b.stages && typeof b.stages === 'object' ? b.stages : {}
  const open = s.all('application').filter(x => x.vacancy === source.id && x.status === 'imported').sort((x, y) => x.id.localeCompare(y.id))
  const sourceStages = [...new Set(open.filter(x => x.outcome === 'open-in-source').map(x => x.sourceStage as string))]
  for (const name of sourceStages) if (stageMap[name]) requireThat(target.stages.some((st: Data) => st.id === stageMap[name]), `Stage “${stageMap[name]}” is not a stage of the live job`, 400)
  const unmapped = sourceStages.filter(name => !stageMap[name])
  const moving: Data[] = [], setAside: Data[] = [], history = open.filter(x => x.outcome !== 'open-in-source').length
  for (const imported of open.filter(x => x.outcome === 'open-in-source')) {
    const candidate = s.find('candidate', imported.candidate), stage = stageMap[imported.sourceStage]
    const reason = activatedFor(s, imported.id) ? 'Already moved into a live job'
      : !candidate || candidate.deleted || candidate.mergedInto ? 'The candidate record is gone or merged'
      : s.all('application').some(x => x.candidate === imported.candidate && x.vacancy === target.id && x.status === 'active') ? 'Already has an active application for the live job'
      : null
    if (reason) { setAside.push({ from: imported.id, name: candidate?.name ?? '', sourceStage: imported.sourceStage, reason }); continue }
    if (!stage) continue
    try { requireStageFields(s, target, { ...imported, customValues: {} }, stage) } catch (e) { setAside.push({ from: imported.id, name: candidate!.name, sourceStage: imported.sourceStage, reason: (e as Error).message }); continue }
    moving.push({ from: imported.id, name: candidate!.name, sourceStage: imported.sourceStage, stage })
  }
  const adoption = b.approval === 'adopt'
  requireThat(!adoption || String(source.sourceApproval).toLowerCase() === 'approved', 'The source did not approve this job; leave its approval for a fresh LDG-001 approval', 409)
  requireThat(!adoption || !missingTerms(target).length, `Complete the live job's terms before adopting an approval: ${missingTerms(target).join(', ')}`, 409)
  const contact = b.contactBasis === 'application' ? 'application' : 'none'
  const result = {
    importedJob: { id: source.id, title: source.title, sourceId: source.imported.sourceId, sourceApproval: source.sourceApproval },
    target: { id: target.id, title: target.title, status: target.status, approvedNow: false, rubricVersion: rubric.version },
    stages: Object.fromEntries(sourceStages.map(n => [n, stageMap[n] ?? null])), unmapped,
    counts: { moving: moving.length, setAside: setAside.length, closedHistory: history, nothingSent: true },
    moving, setAside,
    approval: adoption ? 'adopt' : 'fresh', contactBasis: contact,
    legacyLink: b.sourceUrl ? { source: SOURCE, sourceId: source.imported.sourceId, sourceUrl: b.sourceUrl } : null,
  }
  const revisions = [['vacancy', source.id], ['vacancy', target.id], ...open.flatMap(x => [['application', x.id], ['candidate', x.candidate]])].map(([kind, id]) => s.revisionOf(kind, id))
  const fingerprint = sha256(canonicalJson({ ...result, revisions }))
  return { ...result, fingerprint, source, targetRecord: target, rubric, open: moving }
}

/** The preview: counts, the stage map, what would be set aside and why. Writes nothing. */
export function cutoverPreview(s: State, a: Actor, b: Data) {
  const { source, targetRecord, rubric, open, ...shown } = plan(s, a, b)
  return shown
}

/** Approved activation: the reviewed preview's exact fingerprint moves the open applications into the live job. */
export async function cutover(s: State, a: Actor, b: Data) {
  const { source, targetRecord, rubric, open, ...shown } = plan(s, a, b)
  requireThat(!shown.unmapped.length, `Map every source stage first: ${shown.unmapped.join(', ')}`)
  requireThat(shown.counts.moving > 0, 'Nothing is left to move into a live job', 409)
  requireThat(b.fingerprint === shown.fingerprint, 'The records or mapping changed since your preview; preview it again', 409)
  if (shown.contactBasis === 'application') {
    requireThat(b.attest === true, 'Confirm that continuing these applications is permitted before recording a contact basis')
    text(b.contactNote, 'How the people applied and why contacting them is permitted', 2000)
  }
  const id = uid(), at = now()
  const basis = shown.contactBasis === 'application' ? { basis: 'application', note: text(b.contactNote, 'Contact note', 2000), by: a.email, at } : null
  const moved = open.map(m => {
    const imported = s.get('application', m.from), native = `cutover:${imported.id}`
    const app = s.put('application', native, {
      candidate: imported.candidate, vacancy: targetRecord.id, stage: m.stage, status: 'active', source: imported.source || 'Workable', rubricVersion: rubric.version, reviewers: [], feedbackReleased: false,
      submittedAt: imported.submittedAt || at, coverNote: imported.coverNote ?? '', answers: imported.answers ?? '', customValues: {},
      activated: { from: imported.id, cutover: id, sourceStage: imported.sourceStage, stage: m.stage, at, by: a.email }, ...(basis ? { contactBasis: basis } : {}),
    })
    const event = s.put('stage-event', `cutover:${imported.id}`, { application: native, from: null, to: m.stage, reason: `Moved live from ${source.imported.source === 'workable' ? 'Workable' : 'the source'} at “${imported.sourceStage}” (cutover)`, actor: a.email, at })
    return { from: imported.id, application: app.id, event: event.id, stage: m.stage, sig: sha256(canonicalJson(s.get('application', native))) }
  })
  if (shown.approval === 'adopt' && targetRecord.status === 'draft') {
    const asked = await requestApproval(s, a, 'vacancy', targetRecord, a.email)
    await decide(s, a, { id: asked.id, decision: 'approved', reason: `Adopted the source system's approval (${source.sourceApproval}) for these exact terms`, version: asked.version })
    s.audit(a, 'approval-adopted', 'vacancy:' + targetRecord.id, { source: SOURCE, sourceApproval: source.sourceApproval, importedJob: source.id })
  }
  const link = shown.legacyLink ? legacyLink(s, a, { ...shown.legacyLink, vacancy: targetRecord.id }) : null
  const record = s.put('cutover', id, { source: SOURCE, importedJob: source.id, target: targetRecord.id, stages: shown.stages, rubricVersion: rubric.version, approval: shown.approval, contactBasis: shown.contactBasis, fingerprint: shown.fingerprint, moved, setAside: shown.setAside, legacyLink: link?.id ?? null, status: 'active', by: a.email, at })
  s.audit(a, 'cutover', 'vacancy:' + targetRecord.id, { cutover: id, importedJob: source.id, moved: moved.length, setAside: shown.setAside.length, approval: shown.approval, contactBasis: shown.contactBasis })
  return record
}

/** Undo removes only what nobody has touched since; anything moved, scored, noted or contacted stays live and is marked. */
export function cutoverUndo(s: State, a: Actor, b: Data) {
  requireThat(a.owner, 'Only the owner moves data in', 403)
  const c = s.get('cutover', b.id)
  requireThat(c.status === 'active', 'This cutover was already undone', 409)
  const reasons: Data[] = [], removed: string[] = [], kept: string[] = []
  for (const m of c.moved as Data[]) {
    const app = s.find('application', m.application)
    if (!app) continue
    const touched = s.all('stage-event').filter(e => e.application === app.id && e.id !== m.event).length
      || TOUCHED.some(kind => s.all(kind).some(r => r.application === app.id))
    const edited = sha256(canonicalJson({ ...app, activated: { ...app.activated } })) !== m.sig
    if (touched || edited || app.status !== 'active' || app.stage !== m.stage) {
      s.put('application', app.id, { ...app, activated: { ...app.activated, retained: { reason: touched ? 'Changed after the cutover: it was moved, noted, scored or otherwise worked on' : 'Changed after the cutover', at: now(), by: a.email } } })
      kept.push(app.id); reasons.push({ application: app.id, reason: 'Worked on since the cutover' })
    } else { s.remove('application', app.id); s.remove('stage-event', m.event); removed.push(app.id) }
  }
  if (c.legacyLink && !kept.length && s.find('legacy-link', c.legacyLink)) s.remove('legacy-link', c.legacyLink)
  const record = s.put('cutover', c.id, { ...c, status: 'undone', undone: { by: a.email, at: now(), removed, kept, reasons } })
  s.audit(a, 'cutover-undone', 'vacancy:' + c.target, { cutover: c.id, removed: removed.length, kept: kept.length })
  return record
}

/** A later, explicit decision about contacting people moved in from a source: audited, per application. */
export function contactBasis(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const app = live(s, b.application)
  requireThat(app.activated && app.status === 'active', 'Only a live application moved in from a source takes this', 409)
  requireThat(b.attest === true, 'Confirm that continuing this application is permitted')
  const record = s.put('application', app.id, { ...app, contactBasis: { basis: 'application', note: text(b.note, 'How the person applied and why contacting them is permitted', 2000), by: a.email, at: now() } })
  s.audit(a, 'contact-basis', 'application:' + app.id)
  return record
}
