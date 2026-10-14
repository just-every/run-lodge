import { canonicalJson, sha256, type ImportMapping, type SourceBundle, type SourceRecord, type TargetEffect } from '../../modules/import-kit/src/d1/index'
import { bytesToBase64, requireThat, type Data } from '../core/types'
import { parseCsv } from './csv'
import { readZip, type ZipEntry } from './zip'

// The first move-in kit: Workable's full data export, the ZIP its support team
// provides (one CSV per area plus resume folders named by job id, one
// sub-folder per candidate). Shapes follow Workable's own export documentation
// (help.workable.com, "How do I export candidate data", read 2026-10-11); no
// owner-authorised export has been checked yet, so this kit stays "documented
// shape" until one completes a full move-in and export-back comparison.
//
// Each CSV row and each attachment becomes one source record with exactly one
// effect, so a person's imported data can later be erased record by record.
// Imported records are history: they never grant access, send anything or
// become open vacancies, and Workable's talent-pool flag is kept as a fact,
// not as permission to contact.

export const MAPPING_VERSION = 'workable-full-export-1'
export const NAMESPACE = 'workable'

const AREAS: Record<string, string> = {
  jobs: 'job', candidates: 'candidate', members: 'member', comments: 'comment', ratings: 'rating', events: 'event',
  inbound_messages: 'inbound-message', outbound_messages: 'outbound-message',
}
const OMITTED: Record<string, string> = {
  email_templates: 'Email templates are not carried over; recreate wording as Lodge message drafts',
  e_signature_templates: 'E-signature templates are out of scope (no e-signature execution)',
  interview_templates: 'Interview templates do not map to a Lodge rubric automatically; define the rubric for new vacancies',
  workable_video_interview_templates: 'Video interview templates are out of scope (no recorded interviews)',
  video_interview_templates: 'Video interview templates are out of scope (no recorded interviews)',
}

const areaOf = (name: string) => name.split('/').pop()!.replace(/\.csv$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
const slug = (v: string) => (v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const ids = { job: (id: string) => `workable:job:${id}`, candidate: (id: string) => `workable:candidate:${id}`, application: (c: string, j: string) => `workable:application:${c}:${j}`, member: (id: string) => `workable:member:${id}` }
const MEDIA: Record<string, string> = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', rtf: 'application/rtf', odt: 'application/vnd.oasis.opendocument.text', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }
const mediaType = (name: string) => MEDIA[name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream'
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/

export interface Quarantined { file: string; line?: number; reason: string }
export interface Report {
  package: { name: string; files: number; bytes: number }
  areas: Record<string, number>
  quarantined: Quarantined[]
  omitted: { file: string; reason: string }[]
  orphanedAttachments: string[]
  missingAttachments: { candidate: string; name: string; file: string }[]
  notes: string[]
}

interface Built { source: SourceBundle; mapping: ImportMapping; report: Report }

// Mapping is deterministic for the same bytes on the same day, so a commit can be bound to its preview.
export async function buildWorkable(filename: string, zipBytes: Uint8Array, retainUntil: string, importedOn: string): Promise<Built> {
  requireThat(zipBytes.length <= 20_000_000, 'Packages may be at most 20 MB in this release; ask Workable to split the export', 413)
  const entries = await readZip(zipBytes)
  const report: Report = { package: { name: filename, files: entries.length, bytes: zipBytes.length }, areas: {}, quarantined: [], omitted: [], orphanedAttachments: [], missingAttachments: [], notes: [] }
  const artifacts = new Map<string, { name: string; sha256: string; size: number; original: { status: 'available'; base64: string } }>()
  const artifact = (entry: ZipEntry) => {
    if (!artifacts.has(entry.name)) artifacts.set(entry.name, { name: entry.name, sha256: sha256(entry.bytes), size: entry.bytes.length, original: { status: 'available', base64: bytesToBase64(entry.bytes) } })
    return artifacts.get(entry.name)!
  }

  const tables: Record<string, { file: ZipEntry; rows: { line: number; values: Record<string, string> }[] }> = {}
  const files: ZipEntry[] = []
  for (const entry of entries) {
    const depth = entry.name.split('/').length
    if (/\.csv$/i.test(entry.name) && depth <= 2) {
      const area = areaOf(entry.name)
      if (OMITTED[area]) { report.omitted.push({ file: entry.name, reason: OMITTED[area] }); continue }
      if (!AREAS[area]) { report.omitted.push({ file: entry.name, reason: 'Not a recognised Workable export area' }); continue }
      const parsed = parseCsv(new TextDecoder().decode(entry.bytes))
      if (parsed.error) { report.quarantined.push({ file: entry.name, reason: parsed.error + '; the whole file was set aside' }); continue }
      for (const m of parsed.malformed) report.quarantined.push({ file: entry.name, line: m.line, reason: 'Row ' + m.reason })
      tables[AREAS[area]] = { file: entry, rows: parsed.rows }
    } else if (depth >= 3) files.push(entry)
    else report.omitted.push({ file: entry.name, reason: /read ?me/i.test(entry.name) ? 'Export guide, kept only in the package' : 'Not a recognised Workable export file' })
  }
  requireThat(tables.candidate || tables.job, 'No jobs or candidates CSV was found in this package')

  const records: SourceRecord[] = []
  const effects = new Map<string, TargetEffect | { rejection: string }>()
  const add = (kind: string, sourceId: string, payload: Data, entry: ZipEntry, line: number | undefined, effect: TargetEffect | { rejection: string }) => {
    const a = artifact(entry)
    // Native records carry their own id, exactly as Lodge's commands store them.
    if ('value' in effect) effect.value = { ...(effect.value as Data), id: effect.targetId }
    records.push({ namespace: NAMESPACE, kind, sourceId, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash: a.sha256, location: { artifact: entry.name, ...(line ? { row: line } : {}) } })
    effects.set(kind + '\u0000' + sourceId, effect)
    report.areas[kind] = (report.areas[kind] ?? 0) + 1
  }
  const meta = (file: string, sourceId: string, line?: number) => ({ source: 'workable', sourceId, file, ...(line ? { row: line } : {}), mappingVersion: MAPPING_VERSION })
  const reject = (kind: string, sourceId: string, v: Data, file: ZipEntry, line: number, reason: string) => { report.quarantined.push({ file: file.name, line, reason }); add(kind, sourceId || `line-${line}`, v, file, line, { rejection: reason }) }

  const jobRows = tables.job?.rows ?? [], candidateRows = tables.candidate?.rows ?? []
  const jobIds = new Set(jobRows.map(r => r.values.id).filter(Boolean))
  // Stage names in the order applicants reached them; Workable's pipeline order is not in the export.
  const stagesByJob = new Map<string, string[]>()
  for (const r of candidateRows) { const list = stagesByJob.get(r.values.job_id) ?? []; if (r.values.stage && !list.includes(r.values.stage)) list.push(r.values.stage); stagesByJob.set(r.values.job_id, list) }

  for (const { values: v, line } of jobRows) {
    if (!v.id) { reject('job', '', v, tables.job.file, line, 'Job row has no id'); continue }
    const stageNames = stagesByJob.get(v.id) ?? []
    add('job', v.id, v, tables.job.file, line, { targetKind: 'vacancy', targetId: ids.job(v.id), value: {
      imported: meta(tables.job.file.name, v.id, line), title: v.title || '(untitled job)', department: v.department ?? '', location: [v.city, v.state_code, v.country_code].filter(Boolean).join(', '),
      workMode: v.telecommuting === 'true' ? 'remote' : 'onsite', employmentType: ({ full_time: 'full-time', part_time: 'part-time', contract: 'contract', temporary: 'temporary' } as Data)[(v.employment_type ?? '').toLowerCase().replace(/[- ]/g, '_')] ?? 'full-time',
      description: [v.description, v.requirement_summary, v.benefit_summary].filter(Boolean).join('\n\n'), sourceSalary: { from: v.salary_from ?? '', to: v.salary_to ?? '', currency: v.salary_currency ?? '' },
      compensation: null, headcount: null, manager: '', status: 'imported', sourceState: v.state ?? '', sourceApproval: v.approval_status ?? '', createdAt: v.created_at ?? '',
      stages: stageNames.map((name, i) => ({ id: 'w' + i, name })), rubrics: [], plan: [], hires: 0,
    } })
  }

  for (const { values: v, line } of tables.member?.rows ?? []) {
    if (!v.id) { reject('member', '', v, tables.member.file, line, 'Member row has no id'); continue }
    add('member', v.id, v, tables.member.file, line, { targetKind: 'source-member', targetId: ids.member(v.id), value: { imported: meta(tables.member.file.name, v.id, line), name: v.name ?? '', sourceRole: v.role ?? '', sourceActive: v.active === 'true', note: 'Workable team member, kept for history; grants no Lodge access' } })
  }

  const people = new Map<string, Data>(), applicationsOf = new Map<string, string[]>()
  for (const { values: v, line } of candidateRows) {
    const key = `${v.id}:${v.job_id}`
    if (!v.id) { reject('candidate-row', '', v, tables.candidate.file, line, 'Candidate row has no id'); continue }
    if (v.email && !EMAIL.test(v.email.trim())) { reject('candidate-row', key, v, tables.candidate.file, line, `Candidate ${v.id} has an email Lodge cannot read: set aside for correction`); continue }
    if (v.job_id && !jobIds.has(v.job_id)) { reject('candidate-row', key, v, tables.candidate.file, line, `Candidate ${v.id} refers to job ${v.job_id}, which is not in this package`); continue }
    if (!people.has(v.id)) {
      people.set(v.id, v)
      add('candidate', v.id, { id: v.id, name: v.name, email: v.email, phone: v.phone, address: v.address, headline: v.headline, summary: v.summary, skills: v.skills, education: v.education, experience: v.experience, social_profiles: v.social_profiles, tags: v.tags, source: v.source, talent_pool: v['Talent Pool'] ?? v.talent_pool ?? '' }, tables.candidate.file, line, { targetKind: 'candidate', targetId: ids.candidate(v.id), value: {
        imported: meta(tables.candidate.file.name, v.id, line), name: v.name || '(no name)', email: (v.email ?? '').trim().toLowerCase(), phone: v.phone ?? '', location: v.address ?? '', headline: v.headline ?? '',
        skills: [v.summary, v.skills, v.experience, v.education].filter(Boolean).join('\n'), source: `Workable import${v.source ? ' (' + v.source + ')' : ''}`, createdAt: v.created_at ?? '',
        consent: { basis: 'imported', talentPool: false, sourceTalentPool: (v['Talent Pool'] ?? v.talent_pool) === 'true', at: v.created_at || importedOn, recordedBy: 'import' }, retainUntil,
        tags: v.tags ?? '', socialProfiles: v.social_profiles ?? '',
      } })
    } else if (people.get(v.id)!.email !== v.email || people.get(v.id)!.name !== v.name) report.notes.push(`Candidate ${v.id} appears more than once with different details; the first row's details were kept`)
    if (!v.job_id) continue
    applicationsOf.set(v.id, [...(applicationsOf.get(v.id) ?? []), ids.application(v.id, v.job_id)])
    const stageNames = stagesByJob.get(v.job_id) ?? []
    add('application', key, { id: v.id, job_id: v.job_id, stage: v.stage, disqualified: v.disqualified, disqualified_at: v.disqualified_at, disqualification_reason: v.disqualification_reason, created_at: v.created_at, cover_letter: v.cover_letter, answers: v.answers, source: v.source, keyword_matches: v.keyword_matches }, tables.candidate.file, line, { targetKind: 'application', targetId: ids.application(v.id, v.job_id), value: {
      imported: meta(tables.candidate.file.name, key, line), candidate: ids.candidate(v.id), vacancy: ids.job(v.job_id), stage: 'w' + Math.max(0, stageNames.indexOf(v.stage)), sourceStage: v.stage ?? '',
      status: 'imported', outcome: v.disqualified === 'true' ? 'disqualified' : 'open-in-source', disqualificationReason: v.disqualification_reason ?? '', disqualifiedAt: v.disqualified_at ?? '',
      submittedAt: v.created_at ?? '', source: v.source ?? 'Workable', coverNote: v.cover_letter ?? '', answers: v.answers ?? '', rubricVersion: null, reviewers: [], feedbackReleased: false,
    } })
  }
  const firstApplication = (candidateId: string) => applicationsOf.get(candidateId)?.[0] ?? null

  // Attachments: <job id>/<candidate folder>/<file>, possibly under one wrapper folder.
  const claimed = new Set<string>()
  for (const file of files) {
    const parts = file.name.split('/'), [jobFolder, candidateFolder, name] = parts.slice(-3)
    const match = candidateRows.find(r => r.values.job_id === jobFolder && people.has(r.values.id) && (candidateFolder === r.values.id || candidateFolder.includes(r.values.id) || (slug(r.values.name) && slug(candidateFolder) === slug(r.values.name))))
    if (!match) { report.orphanedAttachments.push(file.name); continue }
    const a = artifact(file), candidateId = match.values.id
    const kind = name === match.values.download ? 'resume' : 'other'
    if (kind === 'resume') claimed.add(`${candidateId}:${jobFolder}`)
    add('file', file.name, { path: file.name, size: file.bytes.length, sha256: a.sha256, candidate: candidateId, job: jobFolder }, file, undefined, {
      targetKind: 'document', targetId: `workable:file:${a.sha256.slice(0, 16)}:${slug(file.name).slice(-80)}`,
      value: { imported: meta(file.name, file.name), candidate: ids.candidate(candidateId), application: ids.application(candidateId, jobFolder), name, mediaType: mediaType(name), size: file.bytes.length, sha256: a.sha256, kind, restricted: false, source: 'Workable import', addedAt: importedOn },
      attachment: { base64: a.original.base64, sha256: a.sha256, mediaType: mediaType(name) },
    })
  }
  for (const { values: v } of candidateRows) if (v.download && people.has(v.id) && v.job_id && jobIds.has(v.job_id) && !claimed.has(`${v.id}:${v.job_id}`)) report.missingAttachments.push({ candidate: v.id, name: v.name, file: v.download })

  const historyRow = (kind: string, table: string, target: string, build: (v: Record<string, string>, candidate: string) => Data, candidateField = 'candidate_id') => {
    for (const { values: v, line } of tables[table]?.rows ?? []) {
      const sourceId = v.id || `line-${line}`, candidate = v[candidateField]
      if (!people.has(candidate)) { reject(kind, sourceId, v, tables[table].file, line, `${kind} refers to candidate ${candidate || '(none)'}, which is not in this package`); continue }
      add(kind, sourceId, v, tables[table].file, line, { targetKind: target, targetId: `workable:${kind}:${sourceId}`, value: { imported: meta(tables[table].file.name, sourceId, line), candidate: ids.candidate(candidate), application: firstApplication(candidate), ...build(v, candidate) } })
    }
  }
  historyRow('comment', 'comment', 'imported-note', v => ({ body: v.body ?? '', createdAt: v.created_at ?? '', sourceMember: v.member_id ?? '', attachmentName: v.attachment_name ?? '' }))
  historyRow('rating', 'rating', 'imported-rating', v => ({ stage: v.stage ?? '', verdict: v.case ?? '', scoreCard: v.score_card ?? '', sourceMember: v.member_id ?? '', createdAt: v.created_at ?? '' }))
  historyRow('event', 'event', 'imported-message', v => ({ direction: 'event', subject: v.title ?? v.type ?? 'Event', body: [v.type, v.starts_at && `${v.starts_at} – ${v.ends_at} ${v.time_zone ?? ''}`, v.location, v.cancelled === 'true' ? 'cancelled' : ''].filter(Boolean).join(' · '), createdAt: v.created_at ?? '', sourceMember: v.member_id ?? '', stage: v.stage ?? '' }))
  for (const [kind, table, field] of [['inbound-message', 'inbound-message', 'sender_id'], ['outbound-message', 'outbound-message', 'recipient_id']] as const)
    historyRow(kind, table, 'imported-message', v => ({ direction: kind === 'inbound-message' ? 'from candidate' : 'to candidate', subject: v.subject ?? '', body: (v.body_html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), createdAt: v.created_at ?? '', note: 'Imported history; Lodge did not send or receive this' }), field)

  // Jobs first, then people, then what refers to them, so a resumed batch never publishes a dangling reference.
  const order = ['job', 'member', 'candidate', 'candidate-row', 'application', 'file', 'comment', 'rating', 'event', 'inbound-message', 'outbound-message']
  records.sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind))
  const source: SourceBundle = { records, artifacts: [...artifacts.values()], diagnostics: report.quarantined.filter(q => q.line === undefined || !records.some(r => r.location.artifact === q.file && r.location.row === q.line)).map(q => ({ severity: 'warning' as const, code: 'QUARANTINED', message: `${q.file}${q.line ? ' line ' + q.line : ''}: ${q.reason}` })) }
  const mapping: ImportMapping = {
    version: MAPPING_VERSION,
    map: record => {
      const effect = effects.get(record.kind + '\u0000' + record.sourceId)!
      return 'rejection' in effect ? { effects: [], rejection: effect.rejection } : { effects: [effect] }
    },
  }
  return { source, mapping, report }
}
