# Agent access

Lodge's recruiting coordinator uses one `/mcp` door, speaking MCP 2026-07-28
and 2025-11-25. Discovery and canonical OAuth metadata describe the installed
registry. `/agents` is the native person's policy, Pause, review and audit page.
Business policy and access use the installation's existing owner-claim key ring.

The supported tool surface follows Lodge's current native agent authority:

| Tool | Native action | Class | Clauses |
| --- | --- | --- | --- |
| `lodge.jobs.list` | Current scoped workspace job projection | standard | LDG-006, OPS-005 |
| `lodge.records.read` | Scoped vacancy, application, candidate, interview, own-note, released scorecard or document metadata | standard | LDG-004, LDG-006, LDG-009, OPS-005 |
| `lodge.proposals.list` | Visible draft handles and native revisions | standard | LDG-013, COORD-006 |
| `lodge.proposals.prepare` | The native `propose` command | standard | LDG-013, COORD-001–COORD-005 |
| `lodge.debriefs.prepare` | The native `debrief` command | standard | COORD-006 |

Preparation saves drafts. A named person still reviews and applies a proposal
through Lodge's existing decision screen. A debrief never submits a scorecard,
ranks a candidate or moves an application. Supported proposal workflows are
vacancy preparation, own-feedback drafts, interview coordination, rediscovery,
feedback cases, delay diagnosis, local handoff exceptions, sourcing packets and
candidate-update drafts. Each keeps its native evidence and lifecycle checks.
Reads and preparation refuse missing grants, stale evidence and unavailable
records. Restricted documents, compliance records and employer-sign-in-only
identities do not acquire agent authority. Imported and applicant text remains
untrusted input.

The owner explicitly creates a native agent member through the existing
`member` command, with `agent: true`, `actsFor` naming the native sponsor and
`businessAgentId` naming the Business agent. Lodge resolves and saves the
sponsor's immutable operator id. Neither a matching email nor a caller's role
field grants sponsorship. The native sponsor, agent membership and current
policy are checked again at the transaction. Native audit entries retain the
agent, sponsor and the label “agent for person”. Deactivating the native agent
or sponsor stops subsequent work.

Signed Business owner ids bind to the native setup owner. Signed team ids bind
through the Business managed ledger to native operators; an existing unrelated
native member is a conflict. Team administrators become native hiring admins;
team members become native interviewers, whose job assignments still determine
what they can inspect. Business policy roles come from the signed ledger:
owner is owner, team administrator is editor, team member has no policy role.
A native administrator promotion alone does not grant Business policy editing.
Removal uses the native account and membership lifecycle, including suspension
of owned work. Native sessions retain their Origin and CSRF checks.

The declared capability families are `tools`, `policy`, `pause`, `audit`,
`idempotency` and `prompts`. Resources, events and subscriptions are undeclared and
return typed refusals. Native human decision screens, installation credentials
and the import door retain their own authority. No spend, provider, mail,
queued continuation, resource-refresh or multi-sponsor conformance claim is
made by this core declaration. Candidate mailbox delivery, outside HR-system
creation, licensed sourcing and provider-kept steps remain subject to their
existing incomplete product clauses.

The single `lodge.recruiting-coordinator` prompt describes the five tools above:
scoped jobs and source reads, visible draft inventory, proposal preparation and
cited debrief preparation. Retrieve it with MCP `prompts / get`; `prompts / list`
and discovery advertise it under the same declared family. It returns static
MCP text messages, accepts no meaningful arguments and reads no hiring records.
String argument values are ignored; malformed arguments and unknown prompt
names receive typed refusals. Retrieval follows current company policy, Pause
and consent revocation. The prompt grants no tool scope or native authority.
The named approver still decides a proposal in the native proposal screen;
the manager still edits and keeps or discards a debrief in its native screen.
Company policy review never replaces those decisions. The prompt supplies no
connected provider capability or specialist-completion claim.

The public MCP journey exercises proposal and debrief preparation under both
autonomous and held company policies. In either case, preparation leaves a
draft until the signed-in native human decides it; a policy review supplies no
human-decision tool. Retrieving the prompt after those decisions or a Worker
restart returns the same static guidance, without reading or changing hiring
records.

The installed request-capacity limit is advertised by MCP `server / discover`
in `com.runeditrun/limits`. It protects the installation and is independent of
company business-volume and provider-spend policy. A one-off native qualification
used the disposable signed Business setup, native agent binding and hiring
fixtures from `tests/agent-prompts-flow.mjs`, `tests/initialize-agent.mjs` and
`tests/agent-phase-fixtures.mjs`, against the real Worker and D1. For each of the
autonomous and held policies, a raw authenticated proposal-preparation call
first created an unsent proposed draft without applying the vacancy. Bounded
raw HTTP catalogue requests then filled that agent's discovered per-minute
capacity. The next otherwise-valid preparation call returned HTTP 429 with
`rate_limited` and a positive `Retry-After`, without a tool result. Native records
and revisions, draft count and the hiring state stayed unchanged; the signed-in
human still opened the same native state. A fresh qualification also sent the
identical refused preparation, with the same idempotency key, after advancing
the fixture clock by the advertised wait. It succeeded once and saved only an
unsent draft, with no applied vacancy. This positive control distinguishes a
capacity refusal from invalid proposal input. Both policy phases used a pinned
clock, real HTTP to the Worker socket and real D1; the refusal comparison covered
every native record value and revision as well as the nonempty human state.
The raw client bypassed the verifier's automatic capacity retries, and derived
its bounded fill count from discovery rather than asserting a fixed threshold.
The [qualification packet](https://github.com/just-every/run-lodge/tree/evidence/sx-lodge-c-f47/files)
retains the one-off driver and actual receipts. The earlier
[qualification packet](https://github.com/just-every/run-lodge/tree/evidence/sx-lodge-c-f46/files)
also retains its pinned-clock recovery driver and receipts. This qualifies BASE-AGENT-011
acceptance 1 for the existing authenticated MCP door only. It does not prove byte or business
budgets, provider spending, outside mail, queued continuations, complete usage
or the remaining Pause and resume duties. The clause remains partial.

A fresh one-off qualification of BASE-AGENT-009 acceptance 3 and the existing
Mark reviewed portion of acceptance 4 reused that disposable signed Business
setup and the existing fixture modules. All five adopted tools performed real
Worker and D1 reads or saved unsent preparations under autonomous and held
policies, with no applied hiring changes. The test-only clock generated 232 audit
rows across three pages: 212 within the fixture period, ten before the week and
ten after the selected as-of time. Independent aggregation of every paginated
row matched every displayed class and decision total on `/agents` at 1440 and
390. Open and flagged review handles matched exactly, including eligible reviews
outside the displayed weekly totals.

At each width the signed-in human used Mark reviewed. Review state retained
that person and the pinned time, audit readback retained the same audit identity
and review person, and the marked handle disappeared from the open feed.
Every native record value and revision, hiring decision, unsent preparation and
draft content stayed unchanged. Signed-out and agent-only marks were refused
without changing review state. The
[qualification packet](https://github.com/just-every/run-lodge/tree/evidence/sx-lodge-c-f51/files)
retains the one-off driver, actual receipt and both-width screens. This is bounded
qualification, with no permanent test, runtime or approved-screen change.
BASE-AGENT-009 remains partial: native Undo, independently named approvers,
broader filtering, export, removal, retained-data lifecycle, undeclared events
and subscriptions, outside providers and multiple active sponsors remain unproved.
All live Business, communications, identity, custody, Base and specialist holds
and the complete original acceptance remain in force.

## Oversized-body no-effect qualification

A one-off BASE-AGENT-001 acceptance-6 qualification uses the emitted production
Worker, migrated local D1, the current owner sponsor and disposable signed
Business settings, credentials and company policies. It reuses the native
fixtures in `tests/agent-prompts-flow.mjs`, `tests/initialize-agent.mjs` and
`tests/agent-phase-fixtures.mjs`. No production signing key or live Business
account is involved.

For each of the autonomous and held policies, the raw HTTP driver derives
`maxBodyBytes` from discovery and pads an otherwise valid
`lodge.proposals.prepare` request with JSON whitespace. Separate requests
exercise an explicit oversized Content-Length and an actual chunked body with
no Content-Length. Each returns HTTP 413 without a tool result. Every native
record value and revision, the nonempty proposal and debrief inventories,
hiring decisions, shared calls, reviews, approvals, audit, usage, events and
captured mail remain identical. No provider call occurs.

The same valid arguments and idempotency key then succeed within capacity,
creating exactly one unsent proposed draft with the current policy revision
and disposition. Held-policy drafts have the corresponding open review linked
to that decision. Native hiring values and revisions stay unchanged; no vacancy
is applied and no provider is called. Replaying the within-capacity request
returns the same draft without adding another. Existing proposal, retained
debrief and native policy-refusal screens are inspected at 1440 and 390.
The policy-refusal screen is separate from the transport's HTTP 413 response;
oversized requests create no tool audit entry.

The [qualification packet](https://github.com/just-every/run-lodge/tree/evidence/sx-lodge-c-f59/files)
retains the one-off raw driver, production fixture helper, actual receipt and
screenshots. The [current-main repeat](https://github.com/just-every/run-lodge/tree/evidence/sx-lodge-c-f60/files)
repeats all four cases with native record and inventory hashes and fresh
screenshots. No permanent test, runtime, manifest, copied Base or production
screen changes accompany this qualification. Other transport, version,
discovery, cache, Origin and header acceptance remains required. Resources and
subscriptions remain undeclared; standalone local token issuance is not
adopted. Wider surface tools and embedded automation, access and security
families, live Business admission, additional sponsor and excluded-client
fixtures, active cross-sponsor isolation, unpairing, local sign-in fallback,
retained-client-data custody and erasure, queued continuation, stranger-specialist
completion and every omitted original obligation remain held or unproved.
BASE-AGENT-003 resource work and live BASE-AGENT-012 qualification are not
retargeted. BASE-AGENT-001 stays partial, with all existing holds unchanged.

## Dropped-response recovery qualification

A one-off acceptance-2 qualification for BASE-AGENT-012 runs the production
build in real workerd with persistent local D1 and actual HTTP. It reuses the
existing owner sponsor, disposable signed Business settings and policy,
`tests/initialize-agent-owner.mjs`, `tests/initialize-agent.mjs` and
`tests/agent-phase-fixtures.mjs`. Signing keys and credentials exist only in the
disposable driver's memory; this supplies no live Business admission proof.

For each of `lodge.proposals.prepare` and `lodge.debriefs.prepare`, under both
autonomous and held company policies, the transport driver consumes the entire
upstream response and confirms its recorded durable outcome before forwarding
only half the bytes and terminating downstream delivery. The caller receives
an incomplete body and fails while reading it. A signed-in state read then
shows one native unsent draft. The driver disposes the Worker and starts a
fresh instance against the same persistent D1, without changing the agent,
sponsor, consent, client, policy or credential. An identical-argument retry
with the same key and a new JSON-RPC id returns the original structured result,
draft identity and content, and original review handle when present. Every
native record value and revision remains equal, the draft count does not
increase, and the shared audit identifies the replay. Fresh RPC and decision
identifiers are excluded from semantic comparison.

The existing proposal and debrief screens are inspected at 1440 and 390; no
production screen or permanent test is changed. The complete one-off driver,
actual response bytes, failure observations, comparisons and screenshots are
in the [qualification packet](https://github.com/just-every/run-lodge/tree/evidence/sx-lodge-c-f56/files).
The sx-lodge-c-f58 [independent repeat](https://github.com/just-every/run-lodge/tree/evidence/sx-lodge-c-f58/files)
qualifies the same four cases on current main. Each caller observes an incomplete
HTTP body and a content-length failure after the driver has captured the complete
upstream bytes and checked the durable outcome. The same-D1 restart and new-id
retry preserve the original structured result, native draft content and review
handle, every native record value and revision, and both draft counts. The
existing proposal and debrief end states are inspected at 1440 and 390. No
permanent test or production code is added.

These independent repeats confirm the predecessor's bounded proof. They do not
qualify an interruption between native mutation and durable outcome, 24-hour
retention, provider uncertainty, queued continuation, retained client-data
custody or erasure, wider revision conflicts, long work or cross-person job
handles. BASE-AGENT-012 stays partial with its complete original acceptance
and all existing holds unchanged.

Run `pnpm exec rer verify` for the production-build conformance journey. It
creates a disposable owner through native setup-token admission, finishes
first-run and business setup, binds a native agent, and uses fresh native
hiring fixtures for each policy phase. The fixture modules never enter the
production dependency graph. The journey includes a real unassessed-feedback
debrief, not invented interview evidence. The source contract keeps broader
shared agent duties partial until their undeclared families are proved.

Conformance also declares one non-owner sponsor solely for the inactive-person
negative probe. The signed Business roster invites and binds that person; the
disposable captured mail edge supplies the real confirmation link. The owner
then suspends the confirmed native operator through `/auth/operator/status`.
Negative preparation returns only the signed subject and canonical address,
leaving credential signing and fresh agent identities to the verifier. The
probe requires a typed refusal, no content and unchanged native state; the
native journey also checks that suspension revokes the confirmed session while
Lodge membership remains active. This proves native suspension admission only,
with no live Business-provider or active cross-sponsor isolation claim. Extra
active sponsors and allow-list exclusion remain undeclared. Standalone local
token issuance is not adopted, and the remaining shared identity obligations
stay open in CONTRACT.md.


## Native classifier injection qualification

The sx-lodge-c-f57 one-off qualification repeats and extends the predecessor
comparison of all five adopted tools through the real MCP door on the built
production Worker and migrated D1 under autonomous
and standard review company policies. Each policy uses isolated clean and
native job and rubric sources containing claims of owner authority, class and
confirmation. For every tool it compares successful baseline calls with caller
class, confirmation, internal and fact claims, individually and together. Every
preparation uses a fresh idempotency key, so a cached draft cannot stand in for a new classification.
The independently expected class is standard; two seeded native jobs establish
the jobs measure of two, while the remaining tools have a measure of one.

All 120 comparisons complete as native reads or unsent proposal and debrief
drafts. The 124 calls, including inventory priming, have corresponding audit
readback with the expected classes, facts, policy revision and current
disposition. Additional caller arguments are filtered and named in the audit;
the review calls have linked review records. Native sources retain their
claims as ordinary data; native readback also checks the saved proposal text
and current application rubric. Hiring records, native grants and policy stay
unchanged, no proposal is applied, no debrief is kept, and neither provider
calls nor new captured mail occur. The existing source and draft screens are
inspected at 1440 and 390 through the same production Worker and native session.

The [qualification packet](https://github.com/just-every/run-lodge/tree/evidence/sx-lodge-c-f57/files)
contains the disposable driver, production fixture helper and actual receipts.
It qualifies only BASE-AGENT-006 acceptance 3 for the five existing standard
class tools and the existing owner sponsor. The shared manifest has no injection
steps, so the shared journey supplies no additional injection comparison. No
permanent test, manifest, copied Base, runtime or screen change is introduced.
Other class and fact duties, tool families, roles, live Business admission and
the complete original acceptance remain open, alongside the existing identity,
custody, lifecycle, continuation and specialist holds. BASE-AGENT-006 remains
partial.
