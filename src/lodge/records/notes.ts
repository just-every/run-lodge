import type { State } from '../core/state'
import { canReview, canSeeCandidate, canSeeTeamNote, requireApplication } from '../core/access'
import { now, requireThat, text, uid, type Actor, type Data } from '../core/types'

// Shared candidate notes: the hiring team's written conversation about a
// person, visible to everyone who can see the candidate, or private to admins
// and the job's hiring managers. Interviewers' own interview notes stay apart.

/** Write a note on a candidate (optionally on one application, which a private note needs); its author edits it with history kept. */
export function teamNote(s: State, a: Actor, b: Data) {
  requireThat(canReview(a), 'Only the hiring team writes candidate notes', 403)
  const body = text(b.text, 'Note', 8000)
  if (b.id) {
    const note = s.find('team-note', b.id)
    requireThat(note && canSeeTeamNote(s, a, note), 'Note not found', 404)
    requireThat(note.author === a.email, 'Only its author can edit a note', 403)
    requireThat(note.text !== body, 'The note already says this', 409)
    const record = s.put('team-note', note.id, { ...note, text: body, editedAt: now(), edits: [...(note.edits ?? []), { text: note.text, at: note.editedAt ?? note.at }] })
    s.audit(a, 'team-note-edited', 'candidate:' + note.candidate, { note: note.id })
    return record
  }
  const app = b.application ? requireApplication(s, a, b.application) : null
  const candidate = s.find('candidate', app?.candidate ?? b.candidate)
  requireThat(candidate && !candidate.deleted && !candidate.mergedInto && canSeeCandidate(s, a, candidate), 'Candidate not found', 404)
  const record = s.put('team-note', uid(), { candidate: candidate.id, application: app?.id ?? null, author: a.email, text: body, private: b.private === true, at: now(), edits: [] })
  s.audit(a, 'team-note', 'candidate:' + candidate.id, { note: record.id, private: record.private })
  return record
}
