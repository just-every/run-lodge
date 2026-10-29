import type { State } from '../core/state'
import { assignedTo, can, canSeeApplication, managesVacancy, requireApplication, requireCan, requireManages } from '../core/access'
import { blindFor } from '../core/blind'
import { isZone } from '../core/time'
import { canonical, instant, list, now, oneOf, optionalText, requireThat, scope, sha256, text, type Actor, type Data } from '../core/types'
import { memberActor } from '../notify/describe'
import { storeDocument } from '../records/documents'
import { rate, RECOMMENDATIONS } from '../records/scorecards'

export const submissionId = (id: string, version: number) => `${id}:v${version}`
export const currentVersion = (record: Data): Data => record.versions.at(-1)

/** Designation never supplies application access, a Lodge role or a permission level. */
export function assessmentReader(s: State, a: Actor, record: Data, version = currentVersion(record)) {
  const app = s.find('application', record.application), job = app && s.find('vacancy', app.vacancy)
  return !a.agent && !!app && !!job && canSeeApplication(s, a, app) && can(s, a, job, 'scorecards')
    && (managesVacancy(a, job) || version.graders.includes(scope(a)))
}

function eligibleGrader(s: State, address: string, app: Data, job: Data) {
  const who = memberActor(s, s.find('member', address))
  return !!who && canSeeApplication(s, who, app) && can(s, who, job, 'scorecards') && (assignedTo(s, who, app) || managesVacancy(who, job))
}

function manager(s: State, a: Actor, id: string) {
  const app = requireApplication(s, a, id), job = s.get('vacancy', app.vacancy)
  requireThat(!a.agent, 'Only a person can manage take-home assignments', 403)
  requireManages(a, job); requireCan(s, a, job, 'settings'); requireCan(s, a, job, 'scorecards')
  requireThat(app.status === 'active' && !app.imported && job.status !== 'closed', 'Use an active native application', 409)
  return { app, job }
}

function deadline(value: unknown, zone: unknown) {
  requireThat(isZone(zone), 'Choose a valid candidate time zone')
  requireThat(typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value), 'Deadline must include an explicit UTC offset')
  return { dueAt: instant(value, 'Deadline'), timeZone: zone as string }
}

export async function assignTakeHome(s: State, a: Actor, b: Data) {
  const { app, job } = manager(s, a, b.application)
  const record = s.find('take-home', app.id), previous = record ? currentVersion(record) : null
  requireThat(b.version === (previous?.version ?? 0), 'The assignment changed; reload before saving', 409)
  const graders = list(b.graders, 'Graders', 2, x => text(x, 'Grader').toLowerCase())
  requireThat(graders.length === 2 && new Set(graders).size === 2, 'Choose two different human graders')
  for (const address of graders) {
    requireThat(eligibleGrader(s, address, app, job), 'Each grader needs existing application and scorecard authority', 403)
  }
  const timing = deadline(b.deadline, b.timeZone)
  requireThat(Date.parse(timing.dueAt) > Date.now(), 'Choose a future deadline')
  const version = (previous?.version ?? 0) + 1
  let attachment: string | null = null
  if (b.attachment) attachment = (await assessmentDocument(s, app, app.id, version, b.attachment, 'instructions', a.email)).id
  const next = { version, instructions: text(b.instructions, 'Take-home instructions', 16000), attachment, graders,
    rubricVersion: app.rubricVersion, stage: app.stage, ...timing, extensions: [], delivery: 'not-delivered', by: a.email, at: now(), released: false }
  s.put('take-home', app.id, { application: app.id, candidate: app.candidate, versions: [...(record?.versions ?? []), next] })
  s.audit(a, 'take-home-assigned', 'application:' + app.id, { version })
  return { application: app.id, version }
}

export function extendTakeHome(s: State, a: Actor, b: Data) {
  const { app } = manager(s, a, b.application), record = s.get('take-home', app.id), version = currentVersion(record)
  requireThat(b.version === version.version && b.previousDeadline === version.dueAt, 'The assignment or deadline changed; reload', 409)
  const timing = deadline(b.deadline, version.timeZone)
  requireThat(Date.parse(timing.dueAt) > Date.parse(version.dueAt) && Date.parse(timing.dueAt) > Date.now(), 'An extension must move the deadline later')
  const extension = { from: version.dueAt, to: timing.dueAt, reason: text(b.reason, 'Extension reason', 2000), by: a.email, at: now() }
  s.put('take-home', record.id, { ...record, versions: record.versions.map((v: Data) => v.version === version.version ? { ...v, dueAt: timing.dueAt, extensions: [...v.extensions, extension] } : v) })
  s.audit(a, 'take-home-extended', 'application:' + app.id, { version: version.version })
  return { application: app.id, version: version.version }
}

async function assessmentDocument(s: State, app: Data, assessment: string, version: number, input: Data, purpose: string, source: string) {
  const doc = await storeDocument(s, { ...input, candidate: app.candidate, application: app.id, kind: 'work-sample', source } as any)
  return s.put('document', doc.id, { ...doc, takeHome: assessment, takeHomeVersion: version, takeHomePurpose: purpose })
}

/** The caller has already proved native candidate identity and the exact receipt relationship. */
export async function submitTakeHome(s: State, a: Actor, app: Data, record: Data, b: Data) {
  const v = currentVersion(record)
  requireThat(app.status === 'active' && app.stage === v.stage && app.rubricVersion === v.rubricVersion && s.get('vacancy', app.vacancy).status !== 'closed', 'This assignment is no longer accepting submissions', 409)
  requireThat(b.version === v.version, 'The assignment changed; review the current instructions', 409)
  const key = text(b.submissionId, 'Submission id', 80)
  requireThat(/^[a-zA-Z0-9-]{16,80}$/.test(key), 'Use a durable submission id')
  const files = list(b.files ?? [], 'Submission files', 5, (x: any) => x as Data)
  const link = optionalText(b.link, 'Submission link', 2000)
  if (link) {
    let url: URL | undefined
    try { url = new URL(link) } catch { /* Invalid links are refused without fetching them. */ }
    requireThat(url && url.protocol === 'https:' && !url.username && !url.password, 'Use an HTTPS link without embedded credentials')
  }
  requireThat(files.length > 0 || link, 'Upload a file or provide a link')
  const fingerprint = await sha256(canonical({ key, files, link, version: v.version }))
  const id = submissionId(record.id, v.version), existing = s.find('take-home-submission', id)
  if (existing) {
    requireThat(existing.fingerprint === fingerprint, 'This assignment already has a submission', 409)
    return { id, receivedAt: existing.receivedAt }
  }
  requireThat(Date.now() <= Date.parse(v.dueAt), 'The submission deadline has passed; request an extension', 409)
  const documents = []
  for (const file of files) documents.push((await assessmentDocument(s, app, record.id, v.version, file, 'submission', 'candidate submission')).id)
  const receivedAt = now()
  s.put('take-home-submission', id, { application: app.id, candidate: app.candidate, assessment: record.id, version: v.version, files: documents, link, fingerprint, receivedAt })
  s.audit(a, 'take-home-submitted', 'application:' + app.id, { version: v.version })
  return { id, receivedAt }
}

export function gradeTakeHome(s: State, a: Actor, b: Data) {
  const record = s.get('take-home', b.application), v = currentVersion(record), app = requireApplication(s, a, record.application)
  requireThat(assessmentReader(s, a, record) && v.graders.includes(a.email), 'Only a currently authorized designated grader may grade', 403)
  requireThat(app.status === 'active' && app.rubricVersion === v.rubricVersion && app.stage === v.stage, 'This assignment changed or closed', 409)
  requireThat(b.version === v.version && b.rubricVersion === v.rubricVersion, 'Review the current assignment and rubric', 409)
  const submission = s.get('take-home-submission', submissionId(record.id, v.version))
  const id = submission.id + ':' + a.email
  requireThat(!s.find('take-home-grade', id), 'You already submitted this take-home scorecard', 409)
  const rubric = s.get('vacancy', app.vacancy).rubrics.find((r: Data) => r.version === v.rubricVersion)
  const { ratings, evidence } = rate(rubric, b)
  s.put('take-home-grade', id, { assessment: record.id, application: app.id, candidate: app.candidate, version: v.version, submission: submission.id,
    author: a.email, rubricVersion: v.rubricVersion, ratings, evidence, recommendation: oneOf(b.recommendation, RECOMMENDATIONS, 'Recommendation'), takeaways: text(b.takeaways, 'Key take-aways', 4000), submittedAt: now() })
  s.audit(a, 'take-home-graded', 'application:' + app.id, { version: v.version })
  // Return only the author's receipt; no colleague feedback is in command responses.
  return { application: app.id, version: v.version, submitted: true }
}

export function releaseTakeHome(s: State, a: Actor, b: Data) {
  const app = requireApplication(s, a, b.application), job = s.get('vacancy', app.vacancy)
  requireThat(!a.agent, 'Only a person may release feedback', 403)
  requireManages(a, job); requireCan(s, a, job, 'scorecards')
  const record = s.get('take-home', app.id), v = currentVersion(record)
  requireThat(b.version === v.version && !v.released, 'The assignment changed or feedback was released', 409)
  const waiting = v.graders.filter((email: string) => !s.find('take-home-grade', submissionId(record.id, v.version) + ':' + email))
  const reason = waiting.length ? text(b.reason, 'Reason for early release', 1000) : optionalText(b.reason, 'Reason', 1000)
  s.put('take-home', record.id, { ...record, versions: record.versions.map((old: Data) => old.version === v.version ? { ...old, released: true, releasedAt: now(), releasedBy: a.email, releaseReason: reason } : old) })
  s.audit(a, 'take-home-feedback-released', 'application:' + app.id, { version: v.version, waiting, reason })
  return { application: app.id, version: v.version }
}

export function assessmentView(s: State, a: Actor) {
  const assignments: Data[] = [], submissions: Data[] = [], grades: Data[] = [], editable: string[] = []
  const graderOptions: Record<string, string[]> = {}
  for (const app of s.all('application')) {
    const job = s.find('vacancy', app.vacancy)
    if (!a.agent && job && !app.imported && canSeeApplication(s, a, app) && managesVacancy(a, job) && can(s, a, job, 'settings') && can(s, a, job, 'scorecards')) {
      editable.push(app.id)
      graderOptions[app.id] = s.all('member').filter(m => eligibleGrader(s, m.email, app, job)).map(m => m.email)
    }
  }
  for (const row of s.all('take-home')) {
    const record = s.get('take-home', row.id), versions = record.versions.filter((v: Data) => assessmentReader(s, a, record, v))
    if (!versions.length) continue
    const app = s.get('application', record.application), blind = blindFor(s, a, app)
    assignments.push({ ...record, versions, receipt: blind ? null : s.all('receipt').find(r => r.application === app.id)?.id ?? null })
    for (const v of versions) {
      const sub = s.find('take-home-submission', submissionId(record.id, v.version))
      if (sub) submissions.push({ id: sub.id, assessment: record.id, application: app.id, version: v.version, files: blind ? [] : sub.files, link: blind ? '' : sub.link, receivedAt: sub.receivedAt, originalsWithheld: blind })
      for (const card of s.all('take-home-grade').filter(g => g.assessment === record.id && g.version === v.version)) if (card.author === scope(a) || v.released) grades.push(card)
    }
  }
  return { assignments, submissions, grades, editable, graderOptions }
}
