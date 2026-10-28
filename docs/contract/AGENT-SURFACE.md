# Lodge Agent surface (draft)

Draft Agent surface for Lodge, written by ct on 28 October 2026 to the contract standard's section 13. It maps every Core clause of `CONTRACT.md` at main `41857fb0f6aa2c24e17cffe7c95629cd757ea83c` (131 Core clauses). It is not part of CONTRACT.md yet: the seed's contract cleanup folds the `### Agent surface` area below into CONTRACT.md as the last area under Target clauses, and the rows under "Status rows" into its Status table. Old clauses whose text fixes what happens to an agent's step: LDG-013, ATTR-005, ATTR-009, CRM-003, CRM-004, CAND-002, COM-004, COM-005, TEAM-002, OFFER-005, HIRE-007, HIRE-008, REPORT-002, REPORT-003, OPS-002, OPS-004, COORD-001, COORD-002, COORD-003, COORD-004, COORD-005; the cleanup rewords them as the class the step carries.

### Agent surface

**Specialist: Recruiting coordinator.** It keeps openings, candidate communication, interview evidence, signed offers and verified HR handoffs moving for the employer.

Inherits BASE-AGENT-001 to BASE-AGENT-013. The company's policy decides every call.

**How Lodge computes each class.** Lodge's server derives classes and facts from typed arguments, saved grants, current records and provider responses; caller flags, confirmation booleans and imported or candidate text cannot lower them.

- **standard:** internal reads and reversible drafts, stage moves, tags, tasks and configuration preparation; facts are the affected item count.
- **external:** publishing a listing or link, sending a message, exposing agency progress, fetching a licensed prospect or transferring data to a provider; facts are recipient count and counterparty: known for a candidate, agency, employer provider or trusted domain already on record, new otherwise, public for an open listing or link. An internal message is standard; an outside recipient makes it external. A provider is a recipient even when its API returns data.
- **money:** actually starting or changing paid distribution, purchasing a check or assessment, or invoking metered services; facts are the USD amount or tariff-bound maximum and payee. Entered costs, pay ranges, bonus/fee milestones, estimates and reports alone do not move money.
- **commitment:** issuing an offer, recording a binding exact-terms sign-off, adopting an outside-signature attestation, countersigning or certifying a hire for HR; facts are the terms/document revision, counterparty and stated value, including USD compensation and period where relevant.
- **accounts:** creating an employee identity in an outside HR system or a collaboration channel/paid resource; facts identify provider and resource. Writing a local prospect or recording an existing provider ID does not create an outside identity.
- **gated:** an outside provider responds that its consent, hosted card-entry, identity/business verification or person-named terms step is kept for a person; facts identify provider and step. The same provider operation without that response carries no gated class.
- **access:** changing members, job teams, reviewer assignments, department/office grants, permission levels, compliance scope, agency invitations, signer designation or app/agent grants; facts identify affected people and whether saved authority widens or narrows, including indirect effects through a level definition.
- **security:** changing enterprise sign-in protection, API/capture credentials or connector credential bindings; facts identify the protective setting or credential reference, excluding secret values.
- **destructive:** candidate erasure, irreversible duplicate consolidation, permanent disposal of pending originals or deletion of a record with no product Undo; facts count affected records and bytes. Retained-version edits and reversible spam marks are standard.
- **sensitive:** reading, storing or sending actual health/accommodation, government-ID, bank, card or payroll-number content, including original files and answers; facts count affected records and name each data kind. Ordinary contact details, compensation figures and private notes alone do not qualify; masked fields that reveal none of these values carry no sensitive class.
- **live:** activating or rolling back stage automation, sender/report/scheduling behavior, board service configuration or careers routing for current users; facts identify the running Lodge service and configuration revision. Preparing an isolated sandbox changes no live service.

Lodge uses all eleven fleet classes. In the table, a dot joins classes always carried together, "or" selects per call, and "(+ class)" adds that class when its computation above applies. Today names the native action or route, not an existing MCP implementation; a qualified entry names only the implemented slice. Native role, evidence and lifecycle checks remain part of the job.

| Tool | Does | Core clauses | Risk class | Today |
| --- | --- | --- | --- | --- |
| `lodge.jobs.list` | List scoped requisitions and their current terms | LDG-006, OPS-005 | standard | GET /api/lodge/state |
| `lodge.jobs.create` | Draft a requisition with proposed terms | LDG-001 | standard | command vacancy |
| `lodge.jobs.edit` | Revise a requisition's terms | LDG-001, ATTR-004 | standard | command vacancy |
| `lodge.jobs.publish` | Publish the current job to the hosted careers site | LDG-001, ATTR-004 | external | command publish |
| `lodge.jobs.unpublish` | Withdraw the hosted job listing | LDG-001 | external | command unpublish |
| `lodge.jobs.close` | Close a job and its listings | LDG-001, ATTR-012 | external | command close-vacancy; remote destinations none |
| `lodge.plans.edit` | Save stages, rubric and interview plan with kits | LDG-002, KIT-001 | standard | commands vacancy-stages, rubric, interview-plan, interview-kit |
| `lodge.openings.list` | Read openings, status and time-to-fill | REQ-001 | standard | GET /api/lodge/reports/openings |
| `lodge.openings.request` | Request another headcount opening | REQ-001 | standard | command request-opening |
| `lodge.openings.edit` | Set opening ID, office and target date | REQ-001 | standard | command opening |
| `lodge.openings.close` | Close an unfilled opening with its reason | REQ-001 | standard | command close-opening |
| `lodge.templates.list` | Read versioned job setup templates | REQ-002 | standard | GET /api/lodge/state |
| `lodge.templates.save` | Save a job template without changing existing jobs | REQ-002 | standard (+ access) | command job-template |
| `lodge.jobs.clone` | Clone setup into a draft without applications | REQ-002 | standard (+ access) | command clone-vacancy |
| `lodge.jobs.from_template` | Start a draft from a template version | REQ-002 | standard (+ access) | command vacancy-from-template |
| `lodge.kickoffs.save` | Record job purpose, criteria and requested terms | REQ-005 | standard | command kickoff |
| `lodge.jobs.from_kickoff` | Turn a kickoff into a linked job draft | REQ-005 | standard | command vacancy-from-kickoff |
| `lodge.teams.set` | Change named job roles and reassign outstanding work | REQ-003 | access | command hiring-team |
| `lodge.departments.save` | Save a department's name and parent | REQ-004 | standard (+ access) | command department |
| `lodge.offices.save` | Save an office's name and location | REQ-004 | standard | command office |
| `lodge.organisation.delete` | Delete an unused department or office | REQ-004 | destructive | command delete-org |
| `lodge.organisation.assign` | Set member location and scoped department/office grants | REQ-004 | access | command member-org |
| `lodge.branding.save` | Set careers logo, colors and introductory copy | ATTR-001 | live | command careers-brand |
| `lodge.domains.challenge` | Prepare careers hostname ownership instructions | ATTR-001, ATTR-013 | standard | command careers-domain-challenge; configured zone only |
| `lodge.domains.verify` | Check hostname DNS and certificate prerequisites | ATTR-001, ATTR-013 | external | command careers-domain-verify; configured zone only |
| `lodge.domains.connect` | Attach the verified careers hostname | ATTR-001, ATTR-013 | external · live (+ money) (+ gated) | command careers-domain-connect; outside-zone support none |
| `lodge.domains.disconnect` | Remove careers hostname routing | ATTR-001, ATTR-013 | external · live | command careers-domain-disconnect; configured zone only |
| `lodge.distribution.publish` | Publish a post to a named board or free feed | ATTR-002, ATTR-003, ATTR-006 | external (+ money) (+ gated) | none |
| `lodge.distribution.update` | Update a remote post or paid campaign's terms | ATTR-002, ATTR-003, ATTR-006 | external (+ money) (+ gated) | none |
| `lodge.distribution.close` | Close a remote listing and stop its campaign | ATTR-002, ATTR-003, ATTR-006 | external (+ money) | none |
| `lodge.distribution.reconcile` | Read listing state, campaign spend and source arrivals | ATTR-002, ATTR-003, ATTR-006, MIG-009 | external | none |
| `lodge.pay_rules.save` | Record reviewed pay-transparency requirements | ATTR-004 | live | command pay-rules |
| `lodge.internal.list` | Read jobs available to the sponsor as an employee | ATTR-005 | standard | GET /api/lodge/state |
| `lodge.internal.apply` | Submit an internal application for the employee sponsor | ATTR-005 | standard (+ sensitive) | command apply-internal |
| `lodge.internal.configure` | Set internal-only visibility and manager notices | ATTR-005 | live | commands vacancy-internal, internal-policy |
| `lodge.translations.save` | Save a post's language and exact versioned vocabulary | ATTR-007 | standard | command post-translation |
| `lodge.posts.save` | Draft or revise a location/language-specific job post | ATTR-012 | standard | command job-post |
| `lodge.posts.publish` | Make a post live on its hosted destinations | ATTR-007, ATTR-012 | external | command post-status |
| `lodge.posts.pause` | Pause a post's hosted publication | ATTR-012 | external | command post-status |
| `lodge.posts.close` | End a post's publication | ATTR-012 | external | command post-status |
| `lodge.board.configure` | Set public board token and embedding origins | ATTR-009 | security · live | command job-board |
| `lodge.board_keys.create` | Create a submit-only board credential | ATTR-009 | access · security | command board-key |
| `lodge.board_keys.rotate` | Replace a board credential and invalidate its predecessor | ATTR-009 | access · security | command rotate-board-key |
| `lodge.board_keys.revoke` | Remove a board credential's authority | ATTR-009 | access · security | command revoke-board-key |
| `lodge.apply_sync.reconcile` | Reconcile provider applications, question mappings and dispositions | ATTR-010, ATTR-011 | external (+ sensitive) (+ gated) | none |
| `lodge.questions.save` | Save a typed screening-question version | SCREEN-001 | standard | command question |
| `lodge.questions.attach` | Attach question versions and required flags to a job | SCREEN-001 | standard | command job-questions |
| `lodge.rules.save` | Draft objective-answer routing or rejection conditions | SCREEN-002 | standard | command screening-rule |
| `lodge.rules.preview` | Preview a rule against selected earlier answers | SCREEN-002 | standard | command preview-rule |
| `lodge.rules.activate` | Activate an exact rule version for new intake | SCREEN-002 | live | command approve-auto-reject; automatic rejection slice |
| `lodge.rules.apply` | Queue selected historical rule matches from a preview | SCREEN-002 | standard | command apply-rule |
| `lodge.rule_matches.decide` | Record a reasoned decision on selected rule matches | SCREEN-002 | standard | command decide-rule-matches |
| `lodge.fields.configure` | Save typed schema and required-stage fields | DATA-001 | standard (+ access) | command field-schema; sandbox deployment available |
| `lodge.fields.write` | Set typed record values without changing hidden fields | DATA-001 | standard (+ sensitive) | command field-values |
| `lodge.views.save` | Save scoped profile filters and team views | DATA-001 | standard | command hiring-view |
| `lodge.search.query` | Search visible profile, job and resume fields | DATA-001, LDG-006 | standard (+ sensitive) | GET /api/lodge/search |
| `lodge.candidates.get` | Read the candidate's permitted application-specific view | LDG-004, LDG-006, OPS-005 | standard (+ sensitive) | GET /api/lodge/state |
| `lodge.candidates.create` | Add a sourced person with contact basis and retention | LDG-004 | standard (+ sensitive) | command candidate |
| `lodge.candidates.correct` | Correct recorded identity fields with history | LDG-004, PRIV-001 | standard (+ sensitive) | command correct-candidate |
| `lodge.applications.add` | Link an existing person to another job | LDG-005, DATA-005 | standard | command apply |
| `lodge.applications.transfer` | Close the source application and create a linked target | DATA-005 | standard | command transfer |
| `lodge.duplicates.list` | Read possible identity matches and reasons | LDG-005 | standard | GET /api/lodge/state |
| `lodge.duplicates.distinguish` | Record why two candidates are different people | LDG-005 | standard | command review-duplicate |
| `lodge.duplicates.merge` | Consolidate identities with explicit overlap resolutions | LDG-005 | destructive (+ sensitive) | command review-duplicate |
| `lodge.documents.add` | Attach original bytes with their native classification | LDG-004 | standard (+ sensitive) | command document |
| `lodge.documents.read` | Read original bytes or sanitized blind text | LDG-004, DATA-006, REVIEW-002 | standard (+ sensitive) | GET /api/lodge/download/document/:id; GET /api/lodge/view/document/:id |
| `lodge.resumes.upload` | Store an original for extraction and correction | DATA-002 | standard (+ sensitive) | command resume-upload |
| `lodge.resumes.extract` | Save source-bound decoded facts and uncertainty | DATA-002 | standard (+ sensitive) | command resume-parsed; PDF/DOCX decoding in client |
| `lodge.resumes.preview` | Preview corrected facts and duplicate choices | DATA-002 | standard (+ sensitive) | command resume-preview |
| `lodge.resumes.commit` | Create or link the previewed person and application once | DATA-002 | standard (+ sensitive) | command resume-commit |
| `lodge.resumes.discard` | Permanently dispose of orphaned pending originals | DATA-002 | destructive (+ sensitive) | command resume-discard-orphaned |
| `lodge.resumes.retention` | Set retention for new pending originals | DATA-002 | standard | command resume-intake-settings |
| `lodge.bulk.preview` | Preview a typed batch with item-level reasons and recipients | DATA-003 | standard (+ sensitive) | command bulk-preview |
| `lodge.bulk.move` | Move each selected application from its previewed revision | DATA-003 | standard | bulk-apply move branch |
| `lodge.bulk.tag` | Apply tags to selected applications | DATA-003 | standard | bulk-apply tag branch |
| `lodge.bulk.assign` | Change reviewers for selected applications | DATA-003 | access | bulk-apply reviewers branch |
| `lodge.bulk.archive` | Close selected applications without sending mail | DATA-003 | standard | bulk-apply archive branch |
| `lodge.bulk.reject` | Close selected applications with reasons and email choices | DATA-003 | standard (+ external) | bulk-apply reject branch; email dispatch none |
| `lodge.bulk.export` | Return a scoped selection as one file | DATA-003 | standard (+ sensitive) | bulk-apply export branch |
| `lodge.bulk.draft` | Prepare exact personalized message drafts | DATA-003, COM-002 | standard | bulk-apply message branch |
| `lodge.spam.mark` | Remove junk from active counts with a reason | DATA-004 | standard | command mark-spam |
| `lodge.spam.unmark` | Restore the prior stage with history | DATA-004 | standard | command unmark-spam |
| `lodge.reviews.list` | Read the sponsor's application review queue | REVIEW-001 | standard (+ sensitive) | GET /api/lodge/state |
| `lodge.reviews.recommend` | Record a scoped yes/no/maybe recommendation | REVIEW-001 | standard | command review-recommendation |
| `lodge.reviews.decide` | Advance, skip or close an application with its reason | REVIEW-001 | standard (+ external) | command review-decision; email dispatch none |
| `lodge.blinding.configure` | Set job-specific blind and reveal stages | REVIEW-002 | access | command blind-review |
| `lodge.blinding.redact` | Set application-specific identity redaction values | REVIEW-002 | standard | command blind-identity |
| `lodge.pipeline.get` | Read scoped columns, age and outstanding decisions | PIPE-001 | standard | GET /api/lodge/board/:vacancy |
| `lodge.pipeline.move` | Move a stage with reason and unbroken history | LDG-007, PIPE-001 | standard | command move |
| `lodge.pipeline.reopen` | Reopen a closed application with a reason | DISP-002 | standard | command reopen |
| `lodge.pipeline.reject` | Close an application with disposition and email choice | DISP-001 | standard (+ external) | command move; due email not sent |
| `lodge.reviewers.assign` | Change application review assignments | LDG-006 | access | command assign-reviewers |
| `lodge.rejections.configure` | Save reason groups and message templates | DISP-001 | standard | commands rejection-reasons, rejection-template |
| `lodge.pools.search` | Find consented retained people with literal match evidence | CRM-001 | standard | GET /api/lodge/talent |
| `lodge.pools.save` | Save a factual prior-applicant pool | CRM-004 | standard | command crm-pool |
| `lodge.prospects.fetch` | Fetch licensed source facts and preserve provenance | CRM-002, CRM-006, COORD-004 | external (+ money) (+ sensitive) (+ gated) | none |
| `lodge.nurture.preview` | Prepare recipient, language and sequence steps | CRM-004, COM-002 | standard | crmView and command crm-enroll; native nurture only |
| `lodge.nurture.enroll` | Create a native consent-bound nurture enrollment | CRM-004 | standard | command crm-enroll |
| `lodge.nurture.enable` | Activate future sends for the exact enrollment | CRM-004 | external · live | command crm-enable |
| `lodge.nurture.stop` | Stop further outreach on an enrollment | CRM-004 | standard | command crm-stop |
| `lodge.nurture.apply` | Create an application from a factual rediscovery match | CRM-004 | standard | command crm-apply |
| `lodge.referrals.submit` | Record the employee sponsor's own frozen referral | CRM-003 | standard (+ sensitive) | command referral-submit |
| `lodge.referrals.reconcile` | Resolve identity, ownership and source credit | CRM-003 | standard | command referral-review |
| `lodge.referrals.publish` | Share coarse progress with the referring employee | CRM-003, CRM-010 | standard or external | command referral-progress; installation-mail updates |
| `lodge.referrals.bonus` | Record an employer bonus milestone without payment | CRM-003 | standard | command referral-bonus |
| `lodge.referrals.subscribe` | Change the sponsor's own job-alert preference | CRM-010 | standard | command referral-alerts |
| `lodge.agencies.invite` | Grant an agency named requisition access | CRM-005 | access · external | commands agency, agency-job; local invitation records |
| `lodge.agencies.revoke` | Revoke an agency or its job invitation | CRM-005 | access · external | commands agency, agency-job |
| `lodge.agencies.submit` | Store an agency sponsor's frozen candidate submission | CRM-005 | standard (+ sensitive) | command agency-submit |
| `lodge.agencies.reconcile` | Decide duplicate ownership and hiring credit | CRM-005 | standard | command agency-review |
| `lodge.agencies.publish` | Share permitted progress or staff-written feedback | CRM-005 | external | command agency-progress |
| `lodge.agencies.fee` | Record a credited-hire fee milestone without payment | CRM-005 | standard | command agency-fee |
| `lodge.sources.save` | Save source types and legacy-text mappings | CRM-008 | standard | command source |
| `lodge.sources.credit` | Record reasoned source-of-hire attribution | CRM-008 | standard | command source-credit |
| `lodge.events.list` | Read the typed recruiting change feed with a cursor | INT-001, OPS-001 | standard (+ sensitive) | auditQuery and notification events only; replay feed none |
| `lodge.fairs.save` | Create or edit an event with linked jobs | CRM-009 | standard | command event |
| `lodge.fairs.publish` | Open or close the QR self-registration page | CRM-009 | external | command event-status |
| `lodge.fairs.capture` | Sync one consented event capture with its stable ID | CRM-009 | standard (+ sensitive) | command event-capture |
| `lodge.fairs.apply` | Link an event attendee to a selected job | CRM-009 | standard | command event-apply |
| `lodge.fairs.cost` | Record event costs without paying a provider | CRM-009 | standard | command event-cost |
| `lodge.receipts.get` | Read the sponsor candidate's receipt and request links | CAND-001 | standard | /candidate and native candidate receipt pages |
| `lodge.progress.publish` | Share a coarse update or ordinary-information request | CAND-002 | external | command candidate-progress |
| `lodge.candidate_requests.answer` | Append the candidate sponsor's requested answer | CAND-002 | standard (+ sensitive) | native candidate account action |
| `lodge.preferences.save` | Set the candidate sponsor's contact choices | CAND-002 | standard | native candidate account preference action |
| `lodge.applications.withdraw` | Withdraw the candidate sponsor's application | CAND-002 | standard | native candidate account withdrawal action |
| `lodge.booking.enable` | Expose approved future local interview slots | CAND-003 | external | command interview-self-scheduling |
| `lodge.booking.list` | Read slots in the candidate sponsor's booking scope | CAND-003 | standard | native candidate booking page |
| `lodge.booking.reserve` | Book or reschedule the same interview slot | CAND-003 | standard (+ external) | native candidate booking action; provider events none |
| `lodge.messages.list` | Read current-scope threads, drafts and outcomes | COM-001, LDG-010 | standard (+ sensitive) | GET /api/lodge/state; connected threads none |
| `lodge.messages.draft` | Prepare exact subject, body and attachments | LDG-010, COM-002, COORD-005 | standard (+ sensitive) | command message |
| `lodge.messages.download` | Download an EML that remains unsent | LDG-010 | standard (+ sensitive) | GET /api/lodge/download/message/:id |
| `lodge.messages.send` | Dispatch one versioned message to its current recipients | COM-001, COM-002, COM-003, COM-005, COORD-005 | standard or external (+ money) (+ sensitive) (+ gated) | installation COM-005 queue only; connected mail/SMS/WhatsApp none |
| `lodge.messages.reconcile` | Read provider send/delivery/reply state without blind replay | COM-001, COM-003, COM-005 | external (+ sensitive) | signed installation-mail events only; connected mailbox reconciliation none |
| `lodge.capture.list` | Read the sponsor's filed and unmatched captured mail | COM-004 | standard (+ sensitive) | GET /api/lodge/capture |
| `lodge.capture.file` | File a captured message under current contact access | COM-004 | standard (+ sensitive) | POST /api/lodge/capture/:id/resolve |
| `lodge.capture.rotate` | Replace the sponsor's private capture capability | COM-004 | security | POST /api/lodge/capture/address |
| `lodge.mail_templates.save` | Save exact language-specific application-mail content | COM-005 | standard | command application-email-template |
| `lodge.mail_automation.activate` | Set exact acknowledgment and stage-mail behavior | COM-005 | live | command application-email-policy |
| `lodge.interviews.list` | Read interviews and candidate/panel availability | LDG-008, CAL-001, CAL-002 | standard | GET /api/lodge/state |
| `lodge.interviews.propose` | Create a plan-bound panel and proposed times | LDG-008, CAL-002 | standard (+ access) | command interview; complex day solver none |
| `lodge.availability.record` | Record the sponsor panellist's availability | LDG-008 | standard | command availability |
| `lodge.availability.fetch` | Read provider free/busy within calendar grants | CAL-001, CAL-005 | external (+ gated) | none |
| `lodge.interviews.schedule` | Book or reschedule a conflict-checked interview | LDG-008, CAL-001, CAL-002 | standard (+ external) | command schedule; provider calendar writes none |
| `lodge.interviews.cancel` | Cancel the same interview and its provider events | CAL-001 | standard (+ external) | command cancel-interview; provider writes none |
| `lodge.interviews.calendar` | Download the scoped ICS without sending it | LDG-008 | standard | GET /api/lodge/download/calendar/:id |
| `lodge.interviews.reply` | Record absence or substitute availability without changing the panel | LDG-008 | standard | command interview-reply |
| `lodge.meetings.create` | Create video join details on the organizer's provider | CAL-003 | external (+ accounts) (+ money) (+ gated) | none |
| `lodge.meetings.reconcile` | Read back the video meeting's current state | CAL-003 | external | none |
| `lodge.meetings.cancel` | Cancel a provider meeting | CAL-003 | external | none |
| `lodge.itineraries.send` | Deliver a localized confirmation, change or cancellation | CAL-004 | external (+ money) (+ sensitive) | none; local ICS and private availability links only |
| `lodge.kits.get` | Read the assigned plan version, questions and permitted evidence | KIT-001 | standard (+ sensitive) | GET /api/lodge/kit/:id |
| `lodge.notes.save` | Save the sponsor's source-bound private interview notes | LDG-013, NOTE-001 | standard (+ sensitive) | command note; capture/transcript connection none |
| `lodge.scorecards.draft` | Prepare evidence ratings citing the sponsor's own notes | LDG-013, SCORE-001 | standard (+ sensitive) | command propose feedback workflow |
| `lodge.scorecards.submit` | Submit a rubric-version scorecard and recommendation | LDG-009, SCORE-001 | commitment (+ sensitive) | command scorecard |
| `lodge.scorecards.correct` | Append a reasoned correction linked to the prior version | SCORE-002 | commitment (+ sensitive) | command correct-scorecard |
| `lodge.feedback.release` | Release submitted feedback within the sponsor's scope | LDG-009 | standard (+ sensitive) | command release-feedback |
| `lodge.assessments.assign` | Send a native take-home or provider test with a deadline | ASSESS-001, ASSESS-002 | external (+ money) (+ gated) | none |
| `lodge.assessments.reconcile` | Read submissions and provider assessment results | ASSESS-001, ASSESS-002 | standard or external (+ sensitive) | none |
| `lodge.assessments.extend` | Record and send a revised submission deadline | ASSESS-001 | external | none |
| `lodge.activity.list` | Read scope-filtered application history | TEAM-001 | standard (+ sensitive) | candidateActivity; GET /api/lodge/state |
| `lodge.team_notes.save` | Add or version a shared or manager-private note with mentions | TEAM-001, TEAM-002 | standard (+ sensitive) | command team-note |
| `lodge.notifications.configure` | Set own job/channel subscriptions and role defaults | TEAM-003 | standard | commands notify-pref, notify-default |
| `lodge.notifications.read` | Mark an existing mention or notification read | TEAM-002, TEAM-003 | standard | command alert-read |
| `lodge.home.get` | Read current interviews, queues and owned actions | HOME-001 | standard | GET /api/lodge/home |
| `lodge.tasks.save` | Assign a candidate follow-up with due date and owner | TASK-001, AUTO-002, COORD-001 | standard | command task |
| `lodge.tasks.complete` | Record completion of owned work with its outcome | TASK-001, COORD-001 | standard | command complete-task |
| `lodge.reminders.configure` | Set candidate/panel cadence, owner and escalation | AUTO-002 | live | command hiring-reminder |
| `lodge.reminders.cancel` | Stop an obsolete reminder schedule | AUTO-002 | standard | command cancel-hiring-reminder |
| `lodge.workflows.draft` | Prepare versioned triggers, chains and delegation | AUTO-001 | standard (+ access) | single-approver request actions only; general chains none |
| `lodge.workflows.activate` | Activate exact stage actions and routing | AUTO-001 | live (+ access) | sandbox-deploy for current single-approver configuration only |
| `lodge.offer_templates.save` | Save a versioned compensation document template | OFFER-001 | standard (+ access) | command offer-template |
| `lodge.offers.prepare` | Merge current terms into an immutable offer document | LDG-011, OFFER-001 | standard | command offer |
| `lodge.offers.packet` | Read the offer's document, evidence and current terms hash | LDG-011, OFFER-001 | standard (+ sensitive) | GET /api/lodge/download/packet/:id; prepared-offer/:id |
| `lodge.decisions.request` | Request a named decision on exact job, message or offer terms | LDG-001, LDG-010, LDG-011 | standard | request-vacancy-approval, request-message-approval, request-offer-approval |
| `lodge.decisions.certify` | Record an exact-terms business sign-off for the sponsor | LDG-001, LDG-010, LDG-011, AUTO-001 | commitment | command decide-approval |
| `lodge.offers.send` | Issue the exact document through the selected signature path | OFFER-002, OFFER-003, OFFER-004, OFFER-005 | external · commitment (+ money) (+ sensitive) (+ gated) | POST /api/lodge/esign/send for native path; provider paths none |
| `lodge.offers.reconcile` | Reconcile an envelope and signed originals | OFFER-002, OFFER-003, OFFER-004, OFFER-005 | standard or external (+ sensitive) | native esign records only; provider readback none |
| `lodge.offers.countersign` | Apply a designated employer sponsor's signature | OFFER-005 | commitment | POST /api/lodge/esign/countersign |
| `lodge.offers.void` | Void the exact active envelope with a reason | OFFER-002, OFFER-003, OFFER-004, OFFER-005 | standard or external | command esign-void; provider paths none |
| `lodge.offers.attest` | Store an outside signed original with truthful provenance | OFFER-006 | commitment (+ sensitive) | command offer-signed-outside |
| `lodge.offers.outcome` | Record a non-signature offer outcome without inventing a signature | LDG-011 | commitment | command offer-outcome |
| `lodge.signers.designate` | Change who may countersign employer offers | OFFER-005 | access | command esign-signer |
| `lodge.handoffs.preview` | Preview mapped hire fields and signature custody | HIRE-001, HIRE-003, HIRE-004, HIRE-005 | standard (+ sensitive) | handoff view/export only; connected previews none |
| `lodge.handoffs.create` | Certify and create one destination employee identity | HIRE-001, HIRE-003, HIRE-004, HIRE-005, COORD-003 | external · accounts · commitment (+ money) (+ sensitive) (+ gated) | none |
| `lodge.handoffs.reconcile` | Read destination identity, terms and documents by stable key | HIRE-001, HIRE-003, HIRE-004, HIRE-005, COORD-003 | external (+ sensitive) | none |
| `lodge.handoffs.export` | Download mapped HR fields without claiming employee creation | HIRE-001, HIRE-005 | standard (+ sensitive) | GET /api/lodge/download/handoff/:id |
| `lodge.handoffs.confirm` | Record a destination ID supplied by the sponsor with provenance | HIRE-005 | commitment | none |
| `lodge.checks.order` | Purchase a consented background package after required sequencing | HIRE-002, HIRE-006 | external · money (+ sensitive) (+ gated) | none |
| `lodge.checks.reconcile` | Read scoped background status and permitted report fields | HIRE-002, HIRE-006 | external (+ sensitive) | none |
| `lodge.fair_chance.configure` | Set counsel-reviewed locations and waiting periods | HIRE-007 | live | command fair-chance-places |
| `lodge.fair_chance.record` | Record the sponsor's assessment, notice or adverse-action decision | HIRE-007 | commitment (+ sensitive) | command fair-chance-step |
| `lodge.references.configure` | Set versioned job-related questionnaire and reader roles | HIRE-008 | standard (+ access) | command reference-questionnaire |
| `lodge.references.request` | Request named referees or order a provider reference check | HIRE-008 | external (+ money) (+ gated) | none |
| `lodge.references.record` | Record consented task-linked call evidence with source | HIRE-008 | standard (+ sensitive) | command reference-record |
| `lodge.references.read` | Read the currently permitted questionnaire version and answers | HIRE-008 | standard (+ sensitive) | referenceExport; GET /api/lodge/download/references/:id |
| `lodge.references.reconcile` | Read Crosschq or SkillSurvey status and reports | HIRE-008 | external (+ sensitive) | none |
| `lodge.reports.calculate` | Compute defined hiring, source, cost and interviewer metrics | REPORT-001, REPORT-006, CRM-008, CRM-009 | standard | GET /api/lodge/reports/openings, cohort, sources, rejections, events, interviewers; full dashboards none |
| `lodge.reports.export` | Export authorized cohort rows and definitions | REPORT-001 | standard (+ sensitive) | GET /api/lodge/download/cohort |
| `lodge.compliance.export` | Export EEO/OFCCP forms and applicant-flow records | REPORT-002 | standard (+ sensitive) | restricted monitoring exports only; US reporting none |
| `lodge.compliance.invite` | Send one voluntary self-identification invitation | REPORT-002 | external | none |
| `lodge.report_schedules.preview` | Preview per-recipient metrics and cadence | REPORT-003 | standard | POST /api/lodge/reports/weekly/preview |
| `lodge.report_schedules.activate` | Activate the exact email or Slack report schedule | REPORT-003 | live | POST /api/lodge/reports/weekly; Slack none |
| `lodge.report_schedules.cancel` | Stop future scheduled report periods | REPORT-003 | standard | POST /api/lodge/reports/weekly/:id/cancel |
| `lodge.reports.send` | Deliver a recomputed recipient-scoped report period | REPORT-003 | standard or external (+ sensitive) | scheduled weekly email dispatcher; Slack none |
| `lodge.surveys.configure` | Set versioned opt-in candidate survey content | REPORT-004 | standard | command survey-configure |
| `lodge.surveys.invite` | Send a consent-bound private survey invitation | REPORT-004 | external | survey invitation action in src/lodge/surveys/http.ts |
| `lodge.surveys.results` | Read permitted aggregate or identified feedback | REPORT-004 | standard (+ sensitive) | GET /api/lodge/reports/surveys |
| `lodge.chat.post` | Send a scoped notification or current packet link | COLLAB-001 | external (+ sensitive) (+ gated) | none |
| `lodge.chat.create` | Create a scoped interview channel | COLLAB-001 | external · accounts · access (+ gated) | none |
| `lodge.chat.archive` | Archive the owned channel and remove its grants | COLLAB-001 | external · access | none |
| `lodge.integrations.grant` | Create or narrow a recruiting app/agent grant | INT-001, OPS-002 | access · security | none; native session API only |
| `lodge.connectors.register` | Record named provider scope, sender and mapping metadata | INT-002 | standard | command connector-register; metadata only |
| `lodge.connectors.authorize` | Attach or revoke a provider grant using a credential reference | INT-002, CAL-005 | access · security (+ external) (+ gated) | connector-binding-change metadata only; calendar grant none |
| `lodge.connectors.rotate` | Replace a connector credential binding | INT-002 | security | command connector-binding-change; metadata only |
| `lodge.connectors.health` | Read provider authorization and execution health | INT-002 | standard or external | connector registry view only; actual access probes none |
| `lodge.legacy_links.save` | Map an old job address to its Lodge post | MIG-009 | live | command legacy-link |
| `lodge.legacy_links.report` | Read remaining source links and cutover conflicts | MIG-009 | standard | GET /api/lodge/reports/cutover; provider arrivals none |
| `lodge.capture_interviews.start` | Start consented provider recording/transcription | NOTE-001 | external (+ money) (+ sensitive) (+ gated) | none |
| `lodge.capture_interviews.stop` | End the consented provider capture | NOTE-001 | external | none |
| `lodge.capture_interviews.read` | Fetch authorized source passages and timestamps | NOTE-001 | external (+ sensitive) | none |
| `lodge.capture_interviews.delete` | Permanently remove the provider's recording copy | NOTE-001 | external · destructive | none |
| `lodge.analysis.interpret` | Ask the configured metered model for a grounded query plan | REPORT-005, COORD-002 | external · money | POST /api/lodge/analysis/interpret |
| `lodge.analysis.calculate` | Run an editable query over scoped event evidence | REPORT-005, COORD-002 | standard | POST /api/lodge/analysis/preview |
| `lodge.analysis.save` | Save an immutable query and its filters | REPORT-005 | standard | POST /api/lodge/analysis/save |
| `lodge.audit.list` | Read the complete period-scoped recruiting audit | OPS-001 | standard (+ sensitive) | GET /api/lodge/audit |
| `lodge.audit.export` | Export complete permitted audit events | OPS-001 | standard (+ sensitive) | GET /api/lodge/download/audit |
| `lodge.members.invite` | Send a scoped staff invitation with native role grants | OPS-002 | access (+ external) | POST /api/lodge/invite; bulk-invitations/send |
| `lodge.members.update` | Change saved staff status, roles and work ownership | OPS-002 | access | command member |
| `lodge.identity.configure` | Change enterprise sign-in and provisioner protections | OPS-002, CRM-011 | access · security · live (+ external) (+ gated) | src/lodge/enterprise/config.ts and http.ts; Okta protocol slice |
| `lodge.permissions.save` | Change a named level's granular authority | OPS-004 | access | command permission-level |
| `lodge.permissions.assign` | Set job, department or office permission levels | OPS-004 | access | command job-levels; department/office assignment via member-org |
| `lodge.compliance.grant` | Set a member's separate job-scoped compliance rights | OPS-002, REPORT-002 | access | command vacancy-compliance |
| `lodge.privacy.restrict` | Set confidential-job or private-candidate visibility | OPS-005 | access | commands vacancy-privacy, candidate-privacy |
| `lodge.sandboxes.create` | Copy selected configuration into an isolated sandbox | OPS-003 | standard | command sandbox-create |
| `lodge.sandboxes.edit` | Edit isolated fields, stages, routing or sender timing | OPS-003 | standard | command sandbox-edit; currently supported configurations only |
| `lodge.sandboxes.preview` | Show effects on selected historical or synthetic cases | OPS-003 | standard (+ sensitive) | command sandbox-preview |
| `lodge.sandboxes.deploy` | Install the preview's exact configuration revision | OPS-003, AUTO-001 | live (+ access) (+ security) | command sandbox-deploy; current configuration families only |
| `lodge.sandboxes.rollback` | Restore the prior configuration as a new revision | OPS-003 | live (+ access) (+ security) | command sandbox-rollback |
| `lodge.provider_plans.record` | Record employer plan/legal setup and USD estimates | OPS-003 | standard | commands provider-setup, provider-review; no purchase |
| `lodge.privacy_notices.save` | Save the employer's versioned California notice | PRIV-001 | standard | command cpra-notice |
| `lodge.privacy_requests.create` | Record a verified or unverified applicant request | PRIV-001, CAND-001 | standard (+ sensitive) | command data-request; candidate request action |
| `lodge.privacy_requests.extend` | Record a reasoned statutory deadline extension | PRIV-001 | commitment | command extend-data-request |
| `lodge.privacy_requests.complete` | Record exact export, correction or erasure fulfillment | PRIV-001, LDG-012 | commitment | command complete-data-request |
| `lodge.retention.list` | Read expired candidates and active holds in scope | LDG-012 | standard | GET /api/lodge/state |
| `lodge.retention.extend` | Change a candidate's retained-until date | LDG-012 | standard | command extend-retention |
| `lodge.holds.place` | Record a candidate or job preservation hold | LDG-012 | commitment | command hold |
| `lodge.holds.release` | Record release of a named preservation instruction | LDG-012 | commitment | command release-hold |
| `lodge.candidates.export` | Export the sponsor's permitted candidate history and originals | LDG-012, LDG-006 | standard (+ sensitive) | GET /api/lodge/download/candidate/:id |
| `lodge.jobs.export` | Export authorized job history with independent evidence scope | LDG-012 | standard (+ sensitive) | GET /api/lodge/download/vacancy/:id |
| `lodge.candidates.erase` | Permanently erase the closed unheld candidate lineage | LDG-012, PRIV-001 | destructive (+ sensitive) | POST /api/lodge/delete-candidate |
| `lodge.proposals.prepare` | Save typed source-bound changes and exact own-note citations | LDG-013 | standard (+ sensitive) | command propose |
| `lodge.coordination.inspect` | Join stalls to scoped threads, times and outstanding work | COORD-001, COORD-005 | standard (+ sensitive) | src/lodge/agents/coordination.ts; full silence monitoring none |
| `lodge.coordination.own` | Record durable next action, deadline and completion evidence | COORD-001, COORD-003 | standard | tasks and proposal packets only; readback ownership loop none |
| `lodge.debriefs.prepare` | Build cited agreement, disagreement and gap statements | COORD-006 | standard (+ sensitive) | command debrief |
| `lodge.debriefs.edit` | Revise source-checked debrief statements | COORD-006 | standard (+ sensitive) | command edit-debrief |
| `lodge.debriefs.discard` | Permanently delete a debrief brief | COORD-006 | destructive (+ sensitive) | command decide-debrief |

**Resources.** `lodge://job/{id}`, `lodge://opening/{id}`, `lodge://job_template/{id}`, `lodge://offer_template/{id}`, `lodge://approval/{id}`, `lodge://workflow/{id}`, `lodge://kickoff/{id}`, `lodge://department/{id}`, `lodge://office/{id}`, `lodge://post/{id}`, `lodge://question/{id}`, `lodge://screening_rule/{id}`, `lodge://candidate/{id}`, `lodge://application/{id}`, `lodge://document/{id}`, `lodge://resume_intake/{id}`, `lodge://pool/{id}`, `lodge://referral/{id}`, `lodge://agency/{id}`, `lodge://agency_submission/{id}`, `lodge://event/{id}`, `lodge://capture/{id}`, `lodge://message/{id}`, `lodge://interview/{id}`, `lodge://kit/{id}`, `lodge://scorecard/{id}`, `lodge://note/{id}`, `lodge://task/{id}`, `lodge://reminder/{id}`, `lodge://offer/{id}`, `lodge://envelope/{id}`, `lodge://handoff/{id}`, `lodge://check/{id}`, `lodge://reference/{id}`, `lodge://assessment/{id}`, `lodge://report/{id}`, `lodge://report_schedule/{id}`, `lodge://survey/{id}`, `lodge://chart/{id}`, `lodge://member/{id}`, `lodge://permission_level/{id}`, `lodge://connector/{id}`, `lodge://grant/{id}`, `lodge://board/{id}`, `lodge://board_key/{id}`, `lodge://domain/{id}`, `lodge://source/{id}`, `lodge://legacy_link/{id}`, `lodge://sandbox/{id}`, `lodge://privacy_request/{id}`, `lodge://hold/{id}`, `lodge://proposal/{id}`, `lodge://debrief/{id}`, `lodge://audit_event/{id}`. Each uses the native sponsor's visibility; candidate resources are application-specific in a blind context. External, candidate, import and log text is untrusted, including quoted source passages.

**Events.** `job.changed`, `opening.changed`, `post.published`, `application.received`, `application.stage_changed`, `application.closed`, `candidate.preference_changed`, `candidate.erased`, `interview.changed`, `scorecard.submitted`, `feedback.released`, `message.outcome_changed`, `reminder.due`, `offer.changed`, `envelope.completed`, `handoff.reconciled`, `check.changed`, `reference.changed`, `report.due`, `connector.changed`, `member.changed`, `coordination.exception`. These are registry requirements; existing notification/audit facts supply only part of this feed.

**Prompts.** Prepare a hiring week (REQ-001, REQ-005, HOME-001, COORD-001); coordinate panels and missing evidence (LDG-008, KIT-001, AUTO-002, COORD-001); research and nurture factual prospects (CRM-001, CRM-002, CRM-004, CRM-006, COORD-004); keep applicants informed (COM-001, COM-005, COORD-005); prepare a cited debrief (COORD-006); reconcile signed hires (OFFER-001, OFFER-005, HIRE-001, HIRE-003, HIRE-004, HIRE-005, COORD-003); diagnose process delays (REPORT-001, REPORT-004, REPORT-005, COORD-002).

**Not tools, and why.**
- A person's interactive screen: LDG-003 is the accessible applicant form, notice presentation and receipt; ATTR-008 is its embedded careers-page presentation. Staff-side job setup and board configuration have tools above.
- Device-only: ATTR-014 is the applicant's local resumable form and attachments; CRM-007 is the extension/inbox add-on's selected on-screen capture; MOB-001 is native/mobile presentation, push navigation and disconnected cache. Their server-side record jobs use the tools above.
- The import door: LDG-014, MIG-001, MIG-002, MIG-003, MIG-004, MIG-005, MIG-006, MIG-007 and MIG-008 retain Base import tasks, source acquisition, fingerprinted preview, cutover and change-aware undo, including any role changes carried by cutover.
- Operation or installation fact: LDG-015 is whole-installation archive/restore through the published portability commands; LDG-017 is the licensed runtime, command contract and responsive installation.
- Served by the surface itself: LDG-016's live session and saved authorization are exercised by SURFACE-001 and SURFACE-010.

Candidate sign-in, email verification, electronic-record consent and personal signature pages, provider consent screens, hosted card entry, passwords, second factors and CAPTCHA interaction remain a person's interactive screen, with no credential-entry tool. This is a boundary of those screens, not a reason to omit an employer-side job.

**Limits.** Native capacity limits include the 1 MB original-file limit, 20 attached screening questions per job and bounded request bodies; paginated record/event reads name their page-size and transport limits in `/docs/agents`. Oversized input reports the limit without partial record creation. Business limits and spend caps are the company's policy; provider tariffs and actual attempts remain visible facts.

**Handoffs.** Listen for provider reply/delivery, free/busy/RSVP, assessment completion, signature completion, reference/background status and destination employee readback, preserving source identity and uncertain outcomes. Emit `envelope.completed` and `handoff.reconciled` with offer/document and destination references for the Business layer and HR specialist; an illustrative Willow `employee.created` is evidence only after exact destination readback. A file download emits no completed-handoff event. Identity revocation updates coordination ownership and stops obsolete contact through the same native actions; sibling event names remain illustrative until their own registries define them.

#### SURFACE-001 — The Agent surface is Lodge's action registry

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-013

**Requirement.** Lodge's registry connects this table to its native recruiting actions and describes the seed fixtures used by the Base harness. Missing provider work remains an explicit implementation gap rather than a substitute local success.

**Acceptance.**
1. `tools/list` returns exactly the table's tool names, clause IDs and possible classes; resource templates, events and prompts match the lists above.
2. The tool metadata and stated non-tool reasons partition all 131 Core clause IDs from the cited main, with no unknown IDs.
3. The Base harness passes on Lodge's fixtures under the all-autonomous company policy and the held company policy defined in SURFACE-013.
4. A native stage move, note, offer preparation and task action through MCP produce the same record revisions and native event types as the corresponding browser actions.
5. Local EML, ICS and HR downloads remain labeled unsent or unconfirmed; no provider receipt or completed hire is fabricated.
6. Revoking the saved person or agent principal between request and commit prevents the write and produces no hiring-record mutation.

#### SURFACE-002 — Read recruiting evidence in the sponsor's exact scope

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-003, BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-010

**Requirement.** Lodge's read tools preserve job assignments, independent scorecards, confidential jobs, private candidates and application-specific blinding. Sensitive classification follows the actual content returned.

**Acceptance.**
1. On one application fixture, reading ordinary resume contact facts declares standard; returning its authorized accommodation attachment adds sensitive with one health record. A masked projection without those values adds no sensitive class.
2. An interviewer sees their assigned kit and released feedback but no contact fields, other interviewers' unreleased cards or private source notes.
3. The same person's other application cannot reveal identity into a blind context; original bytes refuse while sanitized text retains its application code.
4. A compliance-scoped sponsor reads only the permitted restricted fields and jobs, and loses those fields on the next read after revocation.
5. Document resources return the original digest and bytes where native downloads permit them; foreign and nonexistent IDs are indistinguishable.
6. Event replay matches native event IDs and drops events the sponsor can no longer see; candidate, provider and log passages carry untrusted markers.

#### SURFACE-003 — Prepare jobs and route live configuration changes

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-012

**Requirement.** The coordinator drafts jobs, openings, templates, questions, objective rules and isolated trials, retaining versioned evidence and exact configuration hashes. Activations carry live and any authority or protective-setting changes they actually cause.

**Acceptance.**
1. Drafting a kickoff, job and two openings declares standard; publication declares external with public counterparty, preserving location pay and current notice requirements.
2. On one job-template fixture, saving rubric-only setup declares standard; adding a colleague's hiring-team assignment adds access with that person and direction widens.
3. On one department fixture, renaming declares standard; reparenting it so inherited job grants change adds access with the affected people and computed direction.
4. On one sandbox fixture, stage-timing deployment declares live; deploying a role-routing change adds access; deploying a sender-protection change adds security naming that setting. Rollback recomputes each from the current target.
5. On one field-schema fixture, changing a label stays standard; changing who can read the field adds access with the affected scope and direction.
6. Under every policy, template, clone, field, department, workflow or sandbox changes that widen the sponsor's or agent's own authority are refused.
7. Question edits preserve earlier answers and rule versions; isolated previews contact no production recipient and stale activation revisions refuse.
8. Deleting an unused office declares destructive and an item count; an office still referenced by a job refuses as in the native action.

#### SURFACE-004 — Maintain identities and reasoned application history

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-012

**Requirement.** Candidate intake retains originals, provenance and duplicate decisions. Bulk operations preserve each item's class and native revision checks rather than treating a batch as one low-class action.

**Acceptance.**
1. Resume upload, extraction and corrected preview preserve exact source passages and uncertain fields; a repeated successful commit creates one identity and application.
2. Merging the same-email fixture declares destructive with affected identity count, retains nested lineage and refuses unresolved overlapping active jobs.
3. A reasoned move, spam mark/unmark, cross-job transfer and reopen preserve independent histories and do not expose source feedback to a newly assigned target reviewer.
4. A mixed bulk fixture reports each move, reviewer assignment and returned regulated document with its own standard, access or sensitive facts and item-level result.
5. Reviewer assignment and blind-stage changes declare access with direction; every attempt to widen the sponsor's or agent's own authority refuses under every policy.
6. Erasure declares destructive with lineage, original-byte and staged-transfer counts; an active hold refuses it and a completed erasure leaves only the native safe receipt.
7. Permanent orphan-original disposal and debrief discard declare destructive; retained-version corrections remain distinct from disposal.

#### SURFACE-005 — Source prospects and communicate with actual recipients

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-008, BASE-AGENT-012

**Requirement.** Outreach preserves source licenses, contact basis, recorded language, opt-outs and exact recipient/content revisions. Recruiting data does not confer sender or agency authority.

**Acceptance.**
1. On one message fixture, the same non-metered send to a colleague declares standard; to a candidate already on record it declares external, known, one recipient; to a new outside address external, new; public listing publication declares external, public.
2. On that message fixture, a plain attachment adds no sensitive class; replacing it with an authorized ID document adds sensitive with one ID record. Caller confirmation and attachment prose do not alter either result.
3. On one channel fixture, installation-mail dispatch adds no money; the same recipient/content through metered Twilio adds money with USD tariff facts and payee.
4. A reply, opt-out, withdrawal or lost sender grant stops obsolete nurture; uncertain sends remain uncertain until provider reconciliation supplies evidence.
5. Agency invitations and revocations declare access and external with direction and agency counterparty; self-widening agency grants refuse under every policy.
6. On one referral fixture, progress shared only in an internal employee portal is standard; adding an outside forwarding destination makes the same publication external with recipient facts.
7. Capture-capability rotation declares security naming the capability; self-widening capability or connector changes refuse under every policy.
8. Referral bonuses, agency fees and entered event costs declare standard and record no payment.

#### SURFACE-006 — Coordinate calendars and collect independent evidence

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-012

**Requirement.** Interview tools coordinate plan-bound panels, native slots, free/busy and notices without inventing provider bookings. Evidence retains the agreed rubric, source author and release boundary.

**Acceptance.**
1. On one interview fixture, proposing times for the existing panel stays standard; adding an interviewer adds access, direction widens. Self-widening panel access refuses under every policy.
2. On that fixture, local scheduling with no notice or provider mutation stays standard; connected scheduling adds external with affected calendar recipients. Candidate booking, cancellation, review decisions and rejection batches apply the same effect rule.
3. On one assessment fixture, reading a native take-home response is standard; reading the same kind of response from CoderPad is external, known; regulated content adds sensitive in either path.
4. On one meeting fixture, attaching an existing meeting creates no accounts class; creating a new paid meeting resource adds accounts naming the provider/resource and money when the tariff incurs a charge.
5. Submitting a scorecard declares commitment; exact own-note citations, rubric versions, immutable originals and linked corrections remain intact.
6. Released feedback cannot expose private source notes; a candidate decline of recording creates no capture attempt.
7. Consent-bound capture/transcription, assessment invitations and itineraries preserve language and deadline facts; provider acknowledgment does not establish delivery or a completed assessment.

#### SURFACE-007 — Issue exact offers and reconcile signed-hire custody

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-006, BASE-AGENT-008, BASE-AGENT-012

**Requirement.** Offers bind document hash and complete terms. Employer-side sign-offs record the actual actor; candidate signing remains in its native screen.

**Acceptance.**
1. Preparing compensation terms declares standard; certifying those terms, issuing the offer and recording an outside-signature attestation declare commitment with document hash, candidate and stated compensation value.
2. On one envelope fixture, reading native custody is standard and voiding it locally is standard; selecting DocuSign makes each corresponding read/void external with the provider and recipient facts.
3. On that envelope fixture, an authorized signed original containing an ID number adds sensitive; the otherwise identical ordinary offer does not. Paid provider issuance adds money, while the native unmetered path does not.
4. Employer countersignature declares commitment and truthful agent-for-sponsor attribution; a signature performed by a person records that person as signer and the agent only as preparer.
5. Signer designation declares access with direction; self-widening signer or app grants refuse under every policy.
6. A hire handoff declares external, accounts and commitment with provider, counterparty and terms facts; file export creates none of those effects.
7. On one mapped-hire fixture, ordinary identity and pay fields add no sensitive class; including an authorized bank or payroll number adds sensitive with kind and record count.
8. Lost-response reconciliation compares destination ID, approved pay, start date and signed-document hash; retries create no second employee and a mismatch remains an owned exception.

#### SURFACE-008 — Classify provider spending and provider-kept steps

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-006, BASE-AGENT-009, BASE-AGENT-012

**Requirement.** Provider facts distinguish purchases and outside steps from planning. Conditional-offer sequencing remains intact without invented consent or verification.

**Acceptance.**
1. On one distribution fixture, free-feed publication is external with no money; starting its paid campaign adds money with the actual USD amount or tariff-bound maximum and payee.
2. Background-package purchase declares external and money; metered recruiting-model interpretation does too. Recording the same provider's estimated monthly cost is standard with no money class.
3. On one provider-operation fixture, normal API completion has no gated class; the same operation returning hosted-consent-required adds gated naming provider and consent step. No password, CAPTCHA or personal second-factor input is attempted.
4. On one consented-check fixture, ordinary package status adds no sensitive class; returning authorized government-ID or health content adds sensitive with record count and kind.
5. Fair-chance records preserve configured waiting periods and conditional-offer evidence; reference records preserve questionnaire versions, recorder, consent and source without claiming verified referee identity.
6. On one reference-questionnaire fixture, a wording-only version is standard; adding a reader role adds access with affected people and direction. Self-widening reference scope refuses under every policy.
7. Provider prospect fetch, assessment order and careers-host connection add money only when their tariff changes a charge, and gated only when the provider returns the kept step.
8. Provider failures, uncertain execution and revoked grants remain distinct from completed bookings, signatures, checks or HR creation.

#### SURFACE-009 — Explain reports and preserve small-cohort privacy

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-003, BASE-AGENT-006, BASE-AGENT-010

**Requirement.** Reports, surveys, debriefs and process diagnoses expose definitions and authorized evidence rather than suitability scores. Configuration and dispatch are separate jobs with separate effects.

**Acceptance.**
1. Source conversion, opening time-to-fill, offer acceptance and USD cost-per-hire reconcile to scoped event rows, denominators, business-zone periods and labeled cost origins.
2. A local query calculation is standard; a metered model query is external and money, with a provider receipt and no protected material hidden in the prompt.
3. On one report-period fixture, sending only to native internal recipients is standard; routing that same report to an outside Slack destination makes it external with counterparty and recipient count.
4. On one report fixture, suppressed aggregates add no sensitive class; an authorized compliance export containing health/ID answers adds sensitive with records and kinds, while revoked compliance rights return no fields.
5. Report schedule activation declares live naming the service and revision; dispatch recomputes both author and recipient scope, and repeated period claims produce one attempt.
6. Survey aggregates retain the native below-five suppression and retention deadlines; opt-out removes identified answers without deanonymizing anonymous cohorts.
7. A debrief cites only current released evidence, names gaps and disagreements and gains a stale marker after a cited correction; it creates no overall suitability score.
8. Delay diagnoses cite sample limits and cohort definitions and produce isolated configuration proposals; historical candidate decisions remain unchanged.

#### SURFACE-010 — Administer grants and protective settings within saved authority

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-008

**Requirement.** Lodge's administration delta includes granular job, department, compliance, agency and signing scopes and the enterprise/connector settings that protect them.

**Acceptance.**
1. Member, team, permission-level, compliance, privacy and app-grant changes declare access with affected people and native widening/narrowing direction; board-key changes also declare security.
2. Under every policy, member/team/org, permission-level, compliance/privacy, reviewer/blinding, signer/agency and app-grant calls that widen the sponsor's or agent's own authority refuse.
3. Under every policy, board/capture key, connector-binding and enterprise-protection calls that widen the sponsor's or agent's own authority refuse, including indirect changes through a group, scope or credential target.
4. On one invitation fixture, a staff invitation to an internal domain declares access only; the same invitation to a new outside address adds external with one recipient and direction widens.
5. On one connector fixture, changing an installation-local binding declares security and access without external; making the same change through provider authorization adds external, and a provider consent response adds gated.
6. Enterprise identity configuration declares access, security and live; an installation-local setting adds no external, while a provider-side directory setting adds external with its provider.
7. A revocation preserves frozen referral and agency attribution while the next resource, download and event read loses the removed authority.
8. No credential value appears in a resource, model prompt, event or audit receipt; only the setting or binding reference is exposed.

#### SURFACE-011 — Keep integration and chat effects typed

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-010, BASE-AGENT-012

**Requirement.** Chat and integration jobs use current recruiting packets and stable provider operation IDs. External events are evidence to reconcile, not instructions or authority grants.

**Acceptance.**
1. Creating an interview channel declares external, accounts and access with provider, members and direction; archiving it declares external and access, direction narrows.
2. A changed offer packet or revoked chat sponsor refuses the stale action without a duplicate downstream mutation.
3. A webhook replay and the same MCP idempotency key resolve to the original native result; restoring inert imports produces no fresh outreach or provider creation.
4. Channel membership and connector grants cannot widen the sponsor's or agent's own authority under any policy.
5. Provider-kept consent adds gated on the same chat operation, while an existing valid installation grant adds none.
6. The typed recruiting feed links to the relevant application, offer or handoff resources; untrusted provider messages cannot set classes, mark signatures or confirm destination creation.

#### SURFACE-012 — Preserve capacity and recruiting lifecycle boundaries

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-011, BASE-AGENT-012

**Requirement.** Lodge exposes its native capacity failures and candidate lifecycle results through the coordinator's jobs. Existing preservation and portability obligations also cover linked provider artifacts and prepared coordination packets.

**Acceptance.**
1. A document over 1 MB and a twenty-first job question return their named capacity limit without a partial candidate or attachment.
2. A held candidate cannot be erased or reopened contrary to the native hold; releasing the hold records commitment before an otherwise valid destructive erasure.
3. Privacy-request deadline extension and fulfillment declare commitment with the requesting party and exact receipt revision; ordinary request intake declares standard.
4. On one request-answer fixture, ordinary job-history information stays standard; adding an authorized health answer adds sensitive with one health record.
5. Erasure removes linked notes, captures, transcripts, proposals and local signature artifacts and invalidates staged archives; the receipt does not claim third-party copies were erased.
6. Business limits and spend caps remain company policy facts; capacity failures do not invent a daily business allowance.

#### SURFACE-013 — The recruiting coordinator's seeded week under two company policies

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-007, BASE-AGENT-009, BASE-AGENT-013

**Requirement.** A stranger agent runs a seeded recruiting week through MCP. The all-autonomous company policy sets every class autonomous; the held company policy sets standard to review and every other class to approval. Both are company-supplied journey policies.

**Acceptance.**
1. Given only the URL and named sponsor grant, discover jobs, resources and outstanding work without prior installation knowledge.
2. Draft two openings, publish free/paid listings, reconcile licensed prospects, send nurture, book a panel and collect cited feedback and a debrief.
3. Issue an exact offer, certify terms, reconcile a seeded candidate signature, purchase a consented check and verify one HR handoff.
4. Include non-self grants, key rotation, live reminders, sensitive reads and erasure. A gated provider continuation carries its seeded completed personal-step receipt; all eleven classes occur.
5. Under the all-autonomous company policy the week completes with no person involved, pending decisions or review items, with agent-for-sponsor attribution.
6. Under the held company policy standard calls execute into review; other classes await approval by the designated person, then execute once with truthful attribution.
7. Under the held company policy refusing a paid listing causes no charge; changed source revisions invalidate pending approvals. Replays under both policies create no duplicates.
8. Both named company policies produce one completed hire, no stale follow-up, explicit provider exceptions and zero audit decisions inconsistent with the recorded policy revision.

## Status rows

| Clause | Title | Kind | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| `SURFACE-001` | The Agent surface is Lodge's action registry | target | missing | | The Lodge MCP registry and seed-specific Base harness evidence are not built. |
| `SURFACE-002` | Read recruiting evidence in the sponsor's exact scope | target | missing | | MCP reads, resource redaction and sensitive-content classification are not built. |
| `SURFACE-003` | Prepare jobs and route live configuration changes | target | missing | | Classified job preparation and live configuration tools are not built. |
| `SURFACE-004` | Maintain identities and reasoned application history | target | missing | | Classified candidate lifecycle and item-level batch tools are not built. |
| `SURFACE-005` | Source prospects and communicate with actual recipients | target | missing | | Recipient-classified sourcing and communication tools are not built. |
| `SURFACE-006` | Coordinate calendars and collect independent evidence | target | missing | | Classified scheduling and independent-evidence tools are not built. |
| `SURFACE-007` | Issue exact offers and reconcile signed-hire custody | target | missing | | Classified offer issuance and verified hire-handoff tools are not built. |
| `SURFACE-008` | Classify provider spending and provider-kept steps | target | missing | | Provider spending and gated-step classification are not built. |
| `SURFACE-009` | Explain reports and preserve small-cohort privacy | target | missing | | Classified report, survey and cited-diagnosis tools are not built. |
| `SURFACE-010` | Administer grants and protective settings within saved authority | target | missing | | Policy-routed administration with self-escalation refusals is not built. |
| `SURFACE-011` | Keep integration and chat effects typed | target | missing | | Typed chat and integration effects through MCP are not built. |
| `SURFACE-012` | Preserve capacity and recruiting lifecycle boundaries | target | missing | | MCP capacity and lifecycle conformance are not built. |
| `SURFACE-013` | The recruiting coordinator's seeded week under two company policies | target | missing | | The seeded recruiting week through MCP under both company policies is not built. |
