import { configureCandidateUpdates } from './agents/candidate-updates'
import { sourcingBrief } from './agents/sourcing'
import { previewDelayTrial, activateDelayTrial, runDelayTrial, compareDelayTrial, rollbackDelayTrial } from './agents/delay-trials'
import { savePool } from './scheduling/pools'
import { planDay, reviewDay } from './scheduling/planner'
import { referenceQuestionnaire, recordReference } from './references/records'
import { payRules } from './records/pay-transparency'
import { vacancyCompliance } from './enterprise/grants'
import { crmPool, crmEnroll, crmEnable, crmApply } from './crm/records'
import { stopEnrollment } from './crm/inbound'
import { configureReminder, cancelReminder } from './reminders/records'
import { configureApplicationEmails, reviewApplicationEmailTemplate } from './communications/templates'
import { configureSurvey, surveyConsent } from './surveys/records'
import { selfScheduling } from './candidate/booking'
import { publishCandidateAccount, reviewVerificationCopy } from './candidate/account'
import { careersBrand } from './careers/brand'
import { connectorRegister, connectorBindingChange } from './connectors/records'
import { referralAlerts, referralSubmit, referralReview, referralProgress, referralBonus } from './referrals/records'
import { isEmployeeOnly } from './core/access'
import { legacyLink } from './move-in/legacy-links'
import { isAgency } from './core/access'
import { agency, agencyJob, agencySubmit, agencyReview, agencyProgress, agencyFee } from './agency/records'
import { fieldSchema, fieldValues, hiringViews } from './fields/commands'
import type { State } from './core/state'
import { Fault, type Actor, type Data } from './core/types'
import { blindIdentity, blindReview } from './records/blind-review'
import { business, member } from './records/people'
import { close, kit, plan, privacy, publish, requestOpening, requestVacancyApproval, rubric, stages, unpublish, vacancy } from './records/vacancies'
import { closeOpening, editOpening } from './records/openings'
import { jobPost, postStatus, postTranslation } from './records/posts'
import { jobQuestions, question } from './records/questions'
import { deleteOrg, department, memberOrg, office } from './records/org'
import { applyRule, approveAutoReject, decideRuleMatches, previewRule, screeningRule } from './records/rules'
import { decide } from './records/approvals'
import { apply, candidate, candidatePrivacy, correctCandidate, reviewDuplicate, transfer } from './records/candidates'
import { uploadResume, parsedResume } from './resumes/intake'
import { discardOrphanedIntakes, intakeSettings } from './resumes/lifecycle'
import { previewResume, commitResume } from './resumes/review'
import { addDocument } from './records/documents'
import { rejectionReasons, rejectionTemplate } from './records/rejections'
import { reviewDecision, reviewRecommendation } from './records/reviews'
import { boardView } from './records/board-views'
import { source, sourceCredit, sourceSettings } from './records/sources'
import { boardKey, jobBoard, revokeBoardKey, rotateBoardKey } from './records/job-board'
import { event, eventApply, eventCapture, eventCost, eventStatus } from './records/events'
import { bulkApply, bulkPreview } from './records/bulk'
import { applyInternal, internalPolicy, reportsTo, vacancyInternal } from './records/internal'
import { fairChancePlaces, fairChanceStep } from './records/fair-chance'
import { assignReviewers, clearSpamFlag, markSpam, move, reopen, unmarkSpam } from './records/pipeline'
import { availability, cancel, interview, reply, schedule } from './records/interviews'
import { correct, note, releaseFeedback, scorecard } from './records/scorecards'
import { message, requestMessageApproval } from './records/messages'
import { messageTemplate } from './records/message-templates'
import { teamNote } from './records/notes'
import { completeTask, task } from './records/tasks'
import { team } from './records/team'
import { cloneVacancy, jobTemplate, vacancyFromTemplate } from './records/templates'
import { kickoff, vacancyFromKickoff } from './records/kickoffs'
import { offerTemplate, jobOfferTemplate } from './records/offer-templates'
import { offer, outcome, requestOfferApproval, signedOutside } from './records/offers'
import { completeRequest, dataRequest, extendRetention, hold, releaseHold } from './records/retention'
import { extendRequest, refuseRequest, saveCpraNotice } from './records/privacy'
import { deletePermissionLevel, jobLevels, permissionLevel } from './records/levels'
import { decideProposal, propose } from './agents/proposals'
import { debrief, decideDebrief, editDebrief } from './agents/debriefs'
import { createSandbox, editSandbox, previewSandbox, deploySandbox, rollbackSandbox } from './operations/sandbox'
import { providerSetup, reviewProviderSetup } from './operations/providers'
import { esignDisclosure, esignSigner } from './esign/disclosure'
import { esignMoveSigner, esignVoid } from './esign/envelope'
import { grantsOf } from './core/store'
import { contactBasis, cutover, cutoverPreview, cutoverUndo } from './move-in/cutover'
import { mentionPolicy } from './notify/mentions'
import { alertRead, notifyDefault, notifyPref } from './notify/prefs'

export type Command = (s: State, a: Actor, b: Data) => Data | Promise<Data>

/**
 * Every change a person or agent can make, by name. The app's forms, the
 * documented agent API and approved proposals all run these same functions,
 * which check the actor's current Lodge role and record scope themselves.
 */
export const commands: Record<string, Command> = {
  'candidate-update-policy': configureCandidateUpdates,
  'sourcing-brief': sourcingBrief,
  'delay-trial-preview': previewDelayTrial, 'delay-trial-activate': activateDelayTrial, 'delay-trial-run': runDelayTrial, 'delay-trial-compare': compareDelayTrial, 'delay-trial-rollback': rollbackDelayTrial,
  'reference-questionnaire': referenceQuestionnaire, 'reference-record': recordReference,
  'crm-pool': crmPool, 'crm-enroll': crmEnroll, 'crm-enable': crmEnable, 'crm-apply': crmApply, 'crm-stop': stopEnrollment,
  'hiring-reminder': configureReminder, 'cancel-hiring-reminder': cancelReminder,
  'application-email-policy': configureApplicationEmails, 'application-email-template': reviewApplicationEmailTemplate,
  'survey-configure': configureSurvey, 'survey-consent': surveyConsent,
  'candidate-progress': publishCandidateAccount, 'candidate-email-copy': reviewVerificationCopy,
  'careers-brand': careersBrand,
  'connector-register': connectorRegister, 'connector-binding-change': connectorBindingChange,
  'referral-alerts': referralAlerts, 'referral-submit': referralSubmit, 'referral-review': referralReview, 'referral-progress': referralProgress, 'referral-bonus': referralBonus,
  'legacy-link': legacyLink, 'cutover-preview': cutoverPreview, cutover, 'cutover-undo': cutoverUndo, 'contact-basis': contactBasis,
  'mention-policy': mentionPolicy, 'notify-pref': notifyPref, 'notify-default': notifyDefault, 'alert-read': alertRead,
  agency, 'agency-job': agencyJob, 'agency-submit': agencySubmit, 'agency-review': agencyReview, 'agency-progress': agencyProgress, 'agency-fee': agencyFee,
  'sandbox-create': createSandbox, 'sandbox-edit': editSandbox, 'sandbox-preview': previewSandbox, 'sandbox-deploy': deploySandbox, 'sandbox-rollback': rollbackSandbox,
  'provider-setup': providerSetup, 'provider-review': reviewProviderSetup,
  'field-schema': fieldSchema, 'field-values': fieldValues, 'hiring-view': hiringViews,
  'blind-review': blindReview, 'blind-identity': blindIdentity,
  'pay-rules': payRules, business, member, 'vacancy-compliance': vacancyCompliance,
  kickoff, 'vacancy-from-kickoff': vacancyFromKickoff, vacancy, 'vacancy-stages': stages, rubric, 'interview-plan': plan, 'interview-kit': kit, 'request-vacancy-approval': requestVacancyApproval, publish, unpublish, 'close-vacancy': close, 'vacancy-privacy': privacy, 'hiring-team': team,
  'job-template': jobTemplate, 'vacancy-from-template': vacancyFromTemplate, 'clone-vacancy': cloneVacancy,
  'job-post': jobPost, 'post-translation': postTranslation, 'post-status': postStatus, 'request-opening': requestOpening, opening: editOpening, 'close-opening': closeOpening, question, 'job-questions': jobQuestions,
  department, office, 'delete-org': deleteOrg, 'member-org': memberOrg,
  'screening-rule': screeningRule, 'approve-auto-reject': approveAutoReject, 'preview-rule': previewRule, 'apply-rule': applyRule, 'decide-rule-matches': decideRuleMatches,
  'decide-approval': decide,
  'bulk-preview': bulkPreview, 'bulk-apply': bulkApply,
  event, 'event-status': eventStatus, 'event-cost': eventCost, 'event-capture': eventCapture, 'event-apply': eventApply,
  'resume-intake-settings': intakeSettings, 'resume-discard-orphaned': discardOrphanedIntakes,
  'resume-upload': uploadResume, 'resume-parsed': parsedResume, 'resume-preview': previewResume, 'resume-commit': commitResume,
  candidate, 'candidate-privacy': candidatePrivacy, 'correct-candidate': correctCandidate, apply, 'review-duplicate': reviewDuplicate, document: addDocument,
  'rejection-reasons': rejectionReasons, 'rejection-template': rejectionTemplate, 'review-decision': reviewDecision, 'review-recommendation': reviewRecommendation,
  'assign-reviewers': assignReviewers, 'board-view': boardView, source, 'source-settings': sourceSettings, 'job-board': jobBoard, 'board-key': boardKey, 'revoke-board-key': revokeBoardKey, 'rotate-board-key': rotateBoardKey, 'vacancy-internal': vacancyInternal, 'internal-policy': internalPolicy, 'reports-to': reportsTo, 'apply-internal': applyInternal, 'source-credit': sourceCredit, 'fair-chance-places': fairChancePlaces, 'fair-chance-step': fairChanceStep, move, reopen, transfer, 'mark-spam': markSpam, 'unmark-spam': unmarkSpam, 'clear-spam-flag': clearSpamFlag,
  'interview-self-scheduling': selfScheduling,
  'interviewer-pool': savePool, 'interview-day': planDay, 'interview-day-review': reviewDay,
  interview, availability, schedule, 'cancel-interview': cancel, 'interview-reply': reply,
  scorecard, 'correct-scorecard': correct, 'release-feedback': releaseFeedback, note, 'team-note': teamNote, task, 'complete-task': completeTask,
  message, 'request-message-approval': requestMessageApproval, 'message-template': messageTemplate,
  'offer-template': offerTemplate, 'job-offer-template': jobOfferTemplate, offer, 'request-offer-approval': requestOfferApproval, 'offer-outcome': outcome, 'offer-signed-outside': signedOutside,
  'esign-disclosure': esignDisclosure, 'esign-signer': esignSigner, 'esign-void': esignVoid, 'esign-move-signer': (s, a, b) => esignMoveSigner(s, a, b, m => grantsOf(s, m)),
  hold, 'release-hold': releaseHold, 'extend-retention': extendRetention, 'data-request': dataRequest, 'complete-data-request': completeRequest, 'extend-data-request': extendRequest, 'refuse-data-request': refuseRequest, 'cpra-notice': saveCpraNotice, 'permission-level': permissionLevel, 'delete-permission-level': deletePermissionLevel, 'job-levels': jobLevels,
  propose, 'decide-proposal': decideProposal, debrief, 'edit-debrief': editDebrief, 'decide-debrief': decideDebrief,
}

/** What an agent member may run: proposals, and debrief briefs, which change no hiring record and wait for the manager. */
const AGENT_COMMANDS = new Set(['propose', 'debrief'])

export async function run(s: State, a: Actor, op: string, body: Data) {
  if (isEmployeeOnly(a) && !['referral-alerts', 'referral-submit', 'apply-internal'].includes(op)) throw new Fault(404, 'Referral not found')
  if (isAgency(a) && op !== 'agency-submit') throw new Fault(404, 'Agency record not found')
  const command = Object.hasOwn(commands, op) ? commands[op] : undefined
  if (!command) throw new Fault(404, 'Unknown action')
  if (a.agent && !AGENT_COMMANDS.has(op)) throw new Fault(403, 'Agent members propose changes; a person approves and applies them')
  return command(s, a, body)
}
