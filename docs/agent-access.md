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
retains the one-off driver and actual receipts. This qualifies BASE-AGENT-011
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
