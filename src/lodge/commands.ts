import type { State } from './core/state'
import { Fault, type Actor, type Data } from './core/types'
import { business, member } from './records/people'
import { close, plan, privacy, publish, requestVacancyApproval, rubric, stages, unpublish, vacancy } from './records/vacancies'
import { decide } from './records/approvals'
import { apply, candidate, candidatePrivacy, correctCandidate, reviewDuplicate, transfer } from './records/candidates'
import { addDocument } from './records/documents'
import { assignReviewers, clearSpamFlag, markSpam, move, reopen, unmarkSpam } from './records/pipeline'
import { availability, cancel, interview, reply, schedule } from './records/interviews'
import { correct, note, releaseFeedback, scorecard } from './records/scorecards'
import { message, requestMessageApproval } from './records/messages'
import { teamNote } from './records/notes'
import { completeTask, task } from './records/tasks'
import { kickoff, vacancyFromKickoff } from './records/kickoffs'
import { offer, outcome, requestOfferApproval } from './records/offers'
import { completeRequest, dataRequest, extendRetention, hold, releaseHold } from './records/retention'
import { decideProposal, propose } from './agents/proposals'

export type Command = (s: State, a: Actor, b: Data) => Data | Promise<Data>

/**
 * Every change a person or agent can make, by name. The app's forms, the
 * documented agent API and approved proposals all run these same functions,
 * which check the actor's current Lodge role and record scope themselves.
 */
export const commands: Record<string, Command> = {
  business, member,
  kickoff, 'vacancy-from-kickoff': vacancyFromKickoff, vacancy, 'vacancy-stages': stages, rubric, 'interview-plan': plan, 'request-vacancy-approval': requestVacancyApproval, publish, unpublish, 'close-vacancy': close, 'vacancy-privacy': privacy,
  'decide-approval': decide,
  candidate, 'candidate-privacy': candidatePrivacy, 'correct-candidate': correctCandidate, apply, 'review-duplicate': reviewDuplicate, document: addDocument,
  'assign-reviewers': assignReviewers, move, reopen, transfer, 'mark-spam': markSpam, 'unmark-spam': unmarkSpam, 'clear-spam-flag': clearSpamFlag,
  interview, availability, schedule, 'cancel-interview': cancel, 'interview-reply': reply,
  scorecard, 'correct-scorecard': correct, 'release-feedback': releaseFeedback, note, 'team-note': teamNote, task, 'complete-task': completeTask,
  message, 'request-message-approval': requestMessageApproval,
  offer, 'request-offer-approval': requestOfferApproval, 'offer-outcome': outcome,
  hold, 'release-hold': releaseHold, 'extend-retention': extendRetention, 'data-request': dataRequest, 'complete-data-request': completeRequest,
  propose, 'decide-proposal': decideProposal,
}

export async function run(s: State, a: Actor, op: string, body: Data) {
  const command = Object.hasOwn(commands, op) ? commands[op] : undefined
  if (!command) throw new Fault(404, 'Unknown action')
  if (a.agent && op !== 'propose') throw new Fault(403, 'Agent members propose changes; a person approves and applies them')
  return command(s, a, body)
}
