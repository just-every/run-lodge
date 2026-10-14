# Lodge first-release contract

Lodge helps one employer take an approved vacancy to a documented hiring
decision: applications, interviews, evidence against an agreed rubric, an
approved offer and the disposal of candidate data under its own policy. The
first release needs no provider account. Lodge makes no hiring decision, ranks
no one, runs no model, sends no message and executes no employment paperwork;
an offer record is not a signed contract.

**First-release outcome.** A hiring manager moves one approved vacancy through
applications, interviews, independent human scorecards and an offer decision,
while every decision keeps its reason and the evidence stays access-controlled.

Each numbered clause below says what a person can do and the guarantee that
holds while they do it. [ACCEPTANCE.md](ACCEPTANCE.md) names the test that
proves each one and its current result. The clause IDs (`LDG-0NN`) are the
names the tests use.

## The hiring loop: twelve flows

1. **Create a vacancy with its pay range, owner and headcount approval** (LDG-001). A vacancy keeps title, location, pay range, hiring manager and headcount. Publishing needs an approval of those exact terms by the assigned, currently active member with the approver role (or the owner); any later change to them makes the approval stale and publishing is refused until it is approved again. Approvers cannot approve their own requests (the owner excepted).
2. **Agree stages, an interview plan and a job-related rubric before evaluating anyone** (LDG-002). Stages, a versioned job-related rubric (every criterion says what evidence it looks for) and an interview plan exist before approval and publication, and cannot change while the vacancy is published. Each application records the rubric version it is evaluated against.
3. **Publish an accessible application page that records the privacy notice and returns a receipt** (LDG-003). The public application page works without JavaScript, labels every field, shows the accommodation contact and the current privacy notice, and refuses a submission made against an older notice version, without confirmation, or from another site. Each submission stores the notice version and returns a receipt. Accommodation and voluntary monitoring answers are stored as restricted records.
4. **Add candidates and their files with source, consent and retention** (LDG-004). Staff can add candidates with their source, consent basis, consent note and retention date, link them to a vacancy and attach files; downloads return the original bytes. Files over the stated limit are refused.
5. **Keep one person across several applications and review possible duplicates by hand** (LDG-005). One candidate can hold applications for several vacancies (never two active ones for the same vacancy). Possible duplicates (same email, phone or name) are listed with their reasons; nothing is merged until a person decides "different people" or "merge", with a reason. Merging refuses until every overlapping active vacancy is resolved explicitly; a successful merge preserves every application and its full history, including closed applications.
6. **Assign reviewers who see only what they are allowed to** (LDG-006). Current interviewers, managers, hiring admins and the owner may review; removing that capability removes old reviewer and panel grants immediately. Interviewers reach only applications they are assigned to (as reviewer or interview panellist), without contact details, restricted documents or restricted answers, and identically through the app's state, search, document downloads, exports and agent proposals. Messages and contact details require current vacancy management. Linking an existing candidate requires pre-existing contact access, so a reviewer cannot widen their grant. Managers' exports and HR handoffs leave restricted metadata and bytes out; owner and hiring-admin exports include them.
7. **Move applications through stages with a reason and a readable history** (LDG-007). Moving an application to a stage, or closing it as not progressing or withdrawn, needs a reason and keeps who and when in a readable history. Concurrent moves never both commit from the same state: the history is an unbroken chain.
8. **Plan interviews, collect availability and download calendar invitations** (LDG-008). Interviews come from the vacancy's plan with proposed times; panellists record their own availability and the candidate answers through a private link; the hiring team schedules one time and anyone on that specific panel or currently managing that vacancy downloads a standard calendar file. Vacancy management includes the owner and hiring admins; ordinary non-panel reviewers and unrelated managers cannot download it.
9. **Submit independent scorecards and control when colleagues see them** (LDG-009). Each panellist writes their own scorecard against the application's rubric version; every rating carries the interviewer's evidence and unrated criteria stay unanswered; a submitted scorecard is final. Colleagues, including the manager, cannot read a scorecard until the manager releases feedback; releasing before the whole panel submits needs a reason.
10. **Prepare and approve candidate messages, then download them** (LDG-010). Candidate messages are drafted, approved as exact text by a hiring manager, and only then downloaded by a current vacancy manager as an `.eml` file marked unsent. The assigned approver must still have the manager role when deciding (the owner excepted). Editing the text makes the approval stale. Each download is recorded.
11. **Approve an offer packet, record the outcome and export the HR handoff** (LDG-011). An offer records title, pay and start date; its approval packet shows the rubric, stage history, released scorecards, approvals and a plain warning when pay falls outside the approved range. Recording an accepted or declined outcome needs a current approval of the exact terms. Acceptance records the hire and enables an HR handoff export.
12. **Review retention, holds, deletion and candidate access requests; export the whole vacancy history** (LDG-012). Legal holds (on a candidate or vacancy) block deletion. Deletion needs the candidate's name typed exactly and closed applications; it removes their records, document bytes, the complete merged-duplicate lineage and all related proposal packets (including proposed, rejected and applied packets, their sources, citations, inputs and results) in the same transaction, and removes candidate-linked requests, released candidate holds and audit copies, including export digests and unknown request payloads. The same fenced transaction invalidates all local archive transfers, dropping completed and building export snapshots, import staging, stored archive parts and jobs; refused or stale erasure preserves those transfers. It advances the source erasure epoch so an export prepared against older state cannot publish a late snapshot; future archives keep the safe candidate tombstone. Released holds for their vacancies keep only shared lifecycle metadata; unrelated vacancy history remains. The deletion receipt keeps counts and no free-text deletion reason or personal data, and an old request cannot be completed after erasure. Candidate access/export requests export the requesting admin's authorized records with original document bytes and complete the request with its digest. The primary candidate and merged records remain distinct; nested merged duplicates remain included; independent feedback and private interview notes obey LDG-009 and LDG-013 in exports too. Past-retention records are listed for review. A vacancy's whole history (its terms, approvals, applications, stage history, interviews, the scorecards the requester may read, messages and offers) downloads as one file, scoped to the requester exactly as clause 6 describes.

## Agents prepare, people approve

13. **Let a coding agent prepare work that a named person approves** (LDG-013). A coding agent works as an agent member acting for one person: it reads exactly that person's view and can only propose. A proposal names the source records and revisions it read, typed changes from its workflow (prepare a vacancy, feedback draft, coordination, talent-pool rediscovery) and the approving person; it is checked against both the proposer's and that person's current source-field and change permissions, hides the whole packet if those grants are lost, flags missing information instead of inventing it, and applies only when that person approves and every source is unchanged. A feedback draft's ratings must cite the interviewer's own notes exactly. Notes and feedback proposal payloads remain private to that interviewer and their agent, even after submitted scorecards are released; a proposal never releases a draft or its source notes. Source reads obey the same scorecard and document rules as screens. Rediscovery needs current permission to contact and shows factual matches without a score.

## Move-in

14. **Move in from a Workable full export with a dry run, journal and undo** (LDG-014). The Workable full-export kit previews a ZIP with counts per area, rows set aside and why, files that match no candidate, resumes named but missing and areas not carried over, writing nothing. A commit must match the reviewed fingerprint and runs through Base import-kit's D1 journal; the same package again creates nothing new; original files are kept unchanged; undo removes only unchanged imported records and retains, with the reason, what people edited or still rely on. Imported people, jobs and history grant no access and no permission to contact.

## Records, access and running it

15. **Back up the whole installation and restore it elsewhere** (LDG-015). A whole-installation archive (`rer export`) restores into an empty checkout (`rer import`) with the same hiring records, document bytes and import custody; a non-empty destination or a damaged archive is refused before publication, including recomputed envelopes with missing or malformed blobs, conflicting media types, sizes or digests, or missing candidate/vacancy references on applications and candidate/application references on documents. Dependent interview, feedback, stage, message, offer, receipt and monitoring records must reference an existing application. Candidate merge links must name existing live candidates and form an acyclic lineage; malformed links, self-merges and cycles are refused before publication. Nested native merges and deleted tombstones remain restorable. The archive carries Base's operator identities (never sessions, tokens or dependency keys), so restored members are the same people, the restored owner signs in with an ordinary emailed link, and import batches stay with the owner who ran them.
16. **Rely on every private door checking the live person and their saved role** (LDG-016). Every private route checks the current native session, exact origin and the active saved Lodge membership and, for an agent, its active saved principal at the time of the request; deactivating a member removes their access at once; forged actor, author or role fields change nothing; refused requests leave hiring records and audits unchanged. Mutations fence the native session and saved authorization revisions in the transaction, including imports and invitations. Before the first business settings are saved, only the native owner can initialize their membership.
17. **Run, check and verify Lodge with the published rer verbs** (LDG-017). MIT source runs through the maintained `rer` install, setup, dev, build, preview, verify, reset, export, import, deploy --dry-run, describe and check, on TanStack Start, Hono and Cloudflare Workers with D1, its own fonts and theme (`public/rer-theme.css`) and declared dev personas.

## Decided defaults

These defaults are decided; they are recorded here as settled, not open
questions.

- **Name.** Lodge, owner-adopted on 10 October 2026. The bounded desk search is
  not legal clearance; complete clearance before public branding.
- **Scope.** One employer's occasional hiring with structured human decisions.
  No AI interviewer and no suitability score.
- **Jurisdiction.** A US employer first. Each job location is declared on the
  vacancy and reviewed by the approver as part of the exact terms before the
  application page opens (clauses 1 and 3), and the business records its
  jurisdiction and legal-review status in its settings. Lodge claims no US-wide
  legal compliance; retention and recording rules need the employer's own legal
  review before real candidate intake.
- **Move-in order.** Workable full ZIP first (clause 14), then Greenhouse
  Harvest v3 snapshots, Lever, then Ashby. Only Workable is built in this
  release, against documented-shape fixtures; the kit is not "accepted" until a
  real authorized export completes a full move-in and export-back comparison.
- **Start order.** The complete human hiring loop comes before embedded AI,
  provider sending or external sourcing. Candidate communications, calendar,
  sourcing and model accounts stay off until each is separately accepted.
- **Agents.** The owner's own coding agent uses the documented API in
  [API.md](API.md); no model runs inside Lodge and no AI result is simulated.

## Out of the first release

Sending email, syncing calendars or posting to job boards; model execution
inside Lodge; external sourcing, contact databases and recruiter marketplaces;
background or identity checks; e-signature execution; payroll and employee HR
records; automated rejection, ranking or suitability scoring; recorded or
AI-run interviews; hosted deployment and real provider calls. Phase 2 adds
owner-supplied email and calendar connections and optional model credentials,
each recording pending, acknowledged, failed and uncertain outcomes, so a
timeout never becomes a delivered-message claim.
