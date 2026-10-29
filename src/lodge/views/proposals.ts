import { canSeeHandoffProposal } from '../agents/handoff-exceptions'
import { canSeeCandidateUpdate } from '../agents/candidate-updates'
import { canSeeSourcing } from '../agents/sourcing'
import { canSeeDelay } from './delay-analysis'
import { blindSourceStamp } from '../core/blind'
import type { State } from '../core/state'
import { assignedTo, canSeeContact, isAdmin, managesVacancy } from '../core/access'
import { now, scope, type Actor, type Data } from '../core/types'
import type { WorkspaceRecords } from './workspace'

/** Proposal sources use the very same record and field projection as screens. */
export function sourceRecord(view: WorkspaceRecords, kind: string, id: unknown): Data | undefined {
  const records: Record<string, Data[]> = { vacancy: view.vacancies, application: view.applications, candidate: view.candidates, interview: view.interviews, 'interview-note': view.notes, scorecard: view.scorecards, document: view.documents }
  return records[kind]?.find(row => row.id === id)
}

export const sourceFields = (record: Data) => Object.keys(record).filter(key => record[key] !== undefined)

/**
 * A proposal contains prose and historical evidence as well as typed inputs.
 * Hide the whole packet if any of its source fields or change grants are lost;
 * redacting only a source id would leave its quotations and old terms behind.
 * The saved field list is a restriction, never a grant: every field must still
 * exist in today's screen projection. Old packets without that evidence need
 * to be prepared again.
 */
export function canSeeProposal(s: State, a: Actor, p: Data, view: WorkspaceRecords) {
  if (p.workflow === 'handoff-exception') return canSeeHandoffProposal(s, a, p)
  if (p.workflow === 'candidate-update') return canSeeCandidateUpdate(s, a, p)
  if (p.workflow === 'sourcing-research') return canSeeSourcing(s, a, p)
  if (p.workflow === 'delay-diagnosis') return canSeeDelay(s, a, p)
  if (p.workflow === 'feedback-packet' ? p.approver !== scope(a) : !isAdmin(a) && p.proposedFor !== scope(a) && p.proposedBy !== scope(a) && p.approver !== scope(a)) return false
  if (!(p.sources ?? []).every((source: Data) => {
    const record = sourceRecord(view, source.kind, source.viewId ?? source.id)
    if (!record || !Array.isArray(source.fields) || !source.fields.every((field: string) => record[field] !== undefined)) return false
    const original = s.get(source.kind, source.id)
    // Old full-record packets cannot survive reblinding; new packets record the blind context.
    const blindApp = record.blind ? (source.kind === 'candidate' ? record.id.slice('blind:'.length) : record.id) : view.applications.find(app => app.blind && app.id === original.application)?.id
    if (blindApp && (source.blindApplication !== blindApp || source.blindStamp !== blindSourceStamp(s, blindApp))) return false
    return true
  })) return false
  // Citations are source evidence too, including when supplied outside feedback.
  if (!(p.citations ?? []).every((citation: Data) => !!sourceRecord(view, 'interview-note', citation.note))) return false

  const results: { kind: string; record: Data }[] = []
  const target = (kind: string, id: unknown): Data | undefined => {
    if (id && typeof id === 'object') {
      const reference = id as Data
      if (Object.keys(reference).length !== 1 || !Number.isInteger(reference.$result)) return undefined
      const result = results[reference.$result]
      return result?.kind === kind ? result.record : undefined
    }
    const record = sourceRecord(view, kind, id)
    if (record) s.get(kind, record.id)
    return record
  }
  const managedApplication = (id: unknown) => target('application', id)?.manages === true
  for (const [index, change] of (p.changes ?? []).entries()) {
    const input = change.input ?? {}
    let kind: string, record: Data | undefined
    switch (change.op) {
      case 'vacancy':
      case 'vacancy-stages':
      case 'rubric':
      case 'interview-plan': {
        kind = 'vacancy'
        record = input.id ? target(kind, input.id) : undefined
        if (input.id ? !record?.manages : change.op !== 'vacancy' || !managesVacancy(a, { manager: input.manager ?? p.approver })) return false
        if (change.op === 'vacancy' && !managesVacancy(a, { manager: input.manager ?? p.approver })) return false
        // A not-yet-created vacancy grants only the later changes in this packet.
        record ??= { manages: true }
        break
      }
      case 'scorecard': {
        kind = 'scorecard'
        const app = target('application', input.application)
        if (!app || p.approver !== scope(a) || !(app.manages || assignedTo(s, a, app))) return false
        if (input.interview && target('interview', input.interview)?.application !== app.id) return false
        record = { application: app.id }
        break
      }
      case 'message':
      case 'interview': {
        kind = change.op
        if (!managedApplication(input.application)) return false
        if (change.op === 'message' && input.id) {
          const message = view.messages.find(m => m.id === input.id)
          if (!message || message.application !== input.application) return false
          s.get('message', message.id)
        }
        record = { application: input.application }
        break
      }
      case 'schedule':
      case 'cancel-interview': {
        kind = 'interview'
        record = target(kind, input.interview)
        if (!record || !managedApplication(record.application)) return false
        break
      }
      case 'apply': {
        kind = 'application'
        const candidate = target('candidate', input.candidate)
        if (!target('vacancy', input.vacancy)?.manages || !candidate || !canSeeContact(s, a, candidate)) return false
        const person = s.get('candidate', candidate.id)
        if (!person.consent?.talentPool || person.deleted || person.mergedInto || person.retainUntil < now().slice(0, 10)) return false
        record = { candidate: candidate.id, vacancy: input.vacancy, manages: true }
        break
      }
      default: return false
    }
    // Applied packets follow the live result's scope as well as their old inputs.
    if (p.results?.[index]) {
      record = kind === 'message' ? view.messages.find(m => m.id === p.results[index]) : target(kind, p.results[index])
      if (!record || (kind === 'vacancy' && !record.manages)) return false
    }
    results.push({ kind, record })
  }
  return results.length > 0
}
