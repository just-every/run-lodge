import type { State } from './core/state'
import { Fault, type Actor, type Data } from './core/types'
import { business, member } from './records/people'
import { close, kit, plan, privacy, publish, requestOpening, requestVacancyApproval, rubric, stages, unpublish, vacancy } from './records/vacancies'
import { closeOpening, editOpening } from './records/openings'
import { jobPost, postStatus } from './records/posts'
import { jobQuestions, question } from './records/questions'
import { deleteOrg, department, memberOrg, office } from './records/org'
import { applyRule, approveAutoReject, decideRuleMatches, previewRule, screeningRule } from './records/rules'
import { decide } from './records/approvals'
import { apply, candidate, candidatePrivacy, correctCandidate, reviewDuplicate, transfer } from './records/candidates'
import { addDocument } from './records/documents'
import { rejectionReasons, rejectionTemplate } from './records/rejections'
import { reviewDecision, reviewRecommendation } from './records/reviews'
import { boardView } from './records/board-views'
import { source, sourceCredit, sourceSettings } from './records/sources'
import { boardKey, jobBoard, revokeBoardKey, rotateBoardKey } from './records/job-board'
import { event, eventApply, eventCapture, eventCost, eventStatus } from './records/events'
import { applyInternal, internalPolicy, reportsTo, vacancyInternal } from './records/internal'
import { fairChancePlaces, fairChanceStep } from './records/fair-chance'
import { assignReviewers, clearSpamFlag, markSpam, move, reopen, unmarkSpam } from './records/pipeline'
import { availability, cancel, interview, reply, schedule } from './records/interviews'
import { correct, note, releaseFeedback, scorecard } from './records/scorecards'
import { message, requestMessageApproval } from './records/messages'
import { teamNote } from './records/notes'
import { completeTask, task } from './records/tasks'
import { team } from './records/team'
import { cloneVacancy, jobTemplate, vacancyFromTemplate } from './records/templates'
import { kickoff, vacancyFromKickoff } from './records/kickoffs'
import { offer, outcome, requestOfferApproval, signedOutside } from './records/offers'
import { completeRequest, dataRequest, extendRetention, hold, releaseHold } from './records/retention'
import { decideProposal, propose } from './agents/proposals'
import { debrief, decideDebrief, editDebrief } from './agents/debriefs'

export type Command = (s: State, a: Actor, b: Data) => Data | Promise<Data>

/**
 * Every change a person or agent can make, by name. The app's forms, the
 * documented agent API and approved proposals all run these same functions,
 * which check the actor's current Lodge role and record scope themselves.
 */
export const commands: Record<string, Command> = {
  business, member,
  kickoff, 'vacancy-from-kickoff': vacancyFromKickoff, vacancy, 'vacancy-stages': stages, rubric, 'interview-plan': plan, 'interview-kit': kit, 'request-vacancy-approval': requestVacancyApproval, publish, unpublish, 'close-vacancy': close, 'vacancy-privacy': privacy, 'hiring-team': team,
  'job-template': jobTemplate, 'vacancy-from-template': vacancyFromTemplate, 'clone-vacancy': cloneVacancy,
  'job-post': jobPost, 'post-status': postStatus, 'request-opening': requestOpening, opening: editOpening, 'close-opening': closeOpening, question, 'job-questions': jobQuestions,
  department, office, 'delete-org': deleteOrg, 'member-org': memberOrg,
  'screening-rule': screeningRule, 'approve-auto-reject': approveAutoReject, 'preview-rule': previewRule, 'apply-rule': applyRule, 'decide-rule-matches': decideRuleMatches,
  'decide-approval': decide,
  event, 'event-status': eventStatus, 'event-cost': eventCost, 'event-capture': eventCapture, 'event-apply': eventApply,
  candidate, 'candidate-privacy': candidatePrivacy, 'correct-candidate': correctCandidate, apply, 'review-duplicate': reviewDuplicate, document: addDocument,
  'rejection-reasons': rejectionReasons, 'rejection-template': rejectionTemplate, 'review-decision': reviewDecision, 'review-recommendation': reviewRecommendation,
  'assign-reviewers': assignReviewers, 'board-view': boardView, source, 'source-settings': sourceSettings, 'job-board': jobBoard, 'board-key': boardKey, 'revoke-board-key': revokeBoardKey, 'rotate-board-key': rotateBoardKey, 'vacancy-internal': vacancyInternal, 'internal-policy': internalPolicy, 'reports-to': reportsTo, 'apply-internal': applyInternal, 'source-credit': sourceCredit, 'fair-chance-places': fairChancePlaces, 'fair-chance-step': fairChanceStep, move, reopen, transfer, 'mark-spam': markSpam, 'unmark-spam': unmarkSpam, 'clear-spam-flag': clearSpamFlag,
  interview, availability, schedule, 'cancel-interview': cancel, 'interview-reply': reply,
  scorecard, 'correct-scorecard': correct, 'release-feedback': releaseFeedback, note, 'team-note': teamNote, task, 'complete-task': completeTask,
  message, 'request-message-approval': requestMessageApproval,
  offer, 'request-offer-approval': requestOfferApproval, 'offer-outcome': outcome, 'offer-signed-outside': signedOutside,
  hold, 'release-hold': releaseHold, 'extend-retention': extendRetention, 'data-request': dataRequest, 'complete-data-request': completeRequest,
  propose, 'decide-proposal': decideProposal, debrief, 'edit-debrief': editDebrief, 'decide-debrief': decideDebrief,
}

/** What an agent member may run: proposals, and debrief briefs, which change no hiring record and wait for the manager. */
const AGENT_COMMANDS = new Set(['propose', 'debrief'])

export async function run(s: State, a: Actor, op: string, body: Data) {
  const command = Object.hasOwn(commands, op) ? commands[op] : undefined
  if (!command) throw new Fault(404, 'Unknown action')
  if (a.agent && !AGENT_COMMANDS.has(op)) throw new Fault(403, 'Agent members propose changes; a person approves and applies them')
  return command(s, a, body)
}
