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
This independently confirms the predecessor's bounded proof. It does not
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
