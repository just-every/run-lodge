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

The declared capability families are `tools`, `resources`, `policy`, `pause`,
`audit` and `idempotency`. Prompts, events and subscriptions are undeclared and
return typed refusals. Native human decision screens, installation credentials
and the import door retain their own authority. No spend, provider, mail,
queued continuation, resource-refresh or multi-sponsor conformance claim is
made by this core declaration. Candidate mailbox delivery, outside HR-system
creation, licensed sourcing and provider-kept steps remain subject to their
existing incomplete product clauses.

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

The resource family exposes current metadata and drafts through these explicit
URI templates. Every reader requires `lodge:read` and uses the `standard` policy
class, with the same native sponsor, bound agent and live policy checks as tools.

| URI template | Current native projection |
| --- | --- |
| `lodge://vacancy/{id}` | Scoped role, stages, rubric and permitted job fields |
| `lodge://application/{id}` | Scoped application and visible history |
| `lodge://candidate/{id}` | Current candidate fields permitted to the native agent |
| `lodge://interview/{id}` | Current visible interview metadata |
| `lodge://interview-note/{id}` | The sponsoring person's own interview notes |
| `lodge://scorecard/{id}` | Own or currently released feedback |
| `lodge://document/{id}` | Authorized original-document metadata only |
| `lodge://proposal/{id}` | The whole currently visible, projected proposal |
| `lodge://debrief/{id}` | The currently visible debrief with its current stale flag |

Ids in a URI are percent encoded. A hidden or missing record returns the same
`resource_unavailable` refusal without content. Each read rebuilds the current
native agent projection; a retained URI grants no access after source erasure,
loss of source permission or native-agent revocation. Proposal visibility still
requires every source and change grant, so a hidden packet cannot disclose its
historical quotations through a resource. No restricted compliance material or
file bytes are exposed, including when the sponsor is the owner.

Source reads, job and draft inventories, and successful proposal and debrief
preparations return `resource_link` content for actual visible or saved records.
Following a link uses the same policy admission as any other resource read.
Every resource content item carries `_meta["com.runeditrun/untrusted"] = true`:
customer, imported and externally authored draft text is data, never authority.
Normal production-build `rer verify` checks template discovery and linked-record
readback under autonomous and review policies. The native resource journey in
`tests/agent-resource-flow.mjs`, loaded by `tests/security.test.mjs`, additionally
compares populated projections, refuses restricted originals, revokes the bound
native agent and replays erased-source reads without changing hiring state.

This is the current native metadata and draft surface. Two-role resource
qualification, file-byte access and byte budgets, refresh, and primary types
beyond the seven source kinds plus proposals and debriefs remain unproved or
omitted. No active cross-sponsor isolation or local token-issuance claim is added.
