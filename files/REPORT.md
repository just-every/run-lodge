# sx-lodge-c-f65 results

Repository: just-every/run-lodge
Branch: cloud/sx-lodge-c-f65
Candidate: af2219aacebf412b59f404845537c3a932359321
Required starting head: 9adfcaf0b397617842e6b3b50e4bc0c4fa2dcb7a
New commit: af2219aacebf412b59f404845537c3a932359321, Prove refusal parity survives restart and revoked credentials.
PR: none; the branch push has a Verify entry point.

CLAIM BASE-AGENT-002 PARTIAL points=none tests=tests/security.test.mjs#Native proposal and debrief refusals keep stable MCP codes, authority and unsent drafts

The bounded acceptance-4 increment is proven for the two adopted preparation commands. No original acceptance sentence is closed in its entirety: read-tool refusal parity and the broader obligations remain open. BASE-AGENT-002 remains PARTIAL. Counts before and after: 70 DONE, 44 PARTIAL, 31 MISSING, total 145; no status transitions and no acceptance text changes. No plan file was rewritten. Plan-row return: BASE-AGENT-002 PARTIAL to PARTIAL, add the refusal parity proof for the two adopted preparation commands and retain every existing hold.

## Plan and implementation

PLAN.md contains the full executed plan. The required starting head already held the shared mapping, native routes, MCP reuse and two registered journeys. Its Verify 42245103538 was successful, but that run is not used as candidate proof. The continuation retained those product changes and extended the existing Worker and D1 journey, without adding a test registration.

The carried product implementation uses src/lodge/core/refusals.ts:6, returning record_unavailable for 404, native_conflict for 409 and native_refused for other native Faults. It uses only the status, so source existence and diagnostic text cannot affect the public code. src/lodge/http/api.ts:197 applies it only after context admission and JSON parsing for propose and debrief. src/lodge/agent-door/context.ts:32 translates the same native Fault into ToolRefusal with its original HTTP status. The native human message and status remain intact. No copied Base module, approved screen, tool declaration, capability or workflow was changed.

New proof extends tests/agent-refusal-flow.mjs:133: each policy phase restarts the real Worker and D1 after all business refusals, then retries the original native requests and MCP idempotency keys. The unchanged code and original HTTP status, every native value and revision, and the nonempty proposal and debrief inventory are asserted after restart. Valid subsequent MCP preparations remain unsent proposed or draft records and change no hiring records. Lines 179 to 194 revoke the same bound agent's native session and its signed consent, then assert both adopted command doors refuse admission without exposing a business result or changing records. This adds no sponsor fixture and grants no new authority.

## Acceptance register

The public-door test is registered at tests/security.test.mjs:22. Its helper checkAgentRefusals uses tests/harness.mjs, tests/initialize-agent.mjs and tests/agent-phase-fixtures.mjs with a disposable signed Business binding. It runs under both autonomous and held-review policies. No production key or standalone token issuer is used.

| Item | Result and proof |
| --- | --- |
| Acceptance 1, complete Core coverage and not-a-tool reasons | UNPROVED, unchanged held remainder; this round adds no tool coverage. |
| Acceptance 2, every fixture validates against its output schema | UNPROVED as a whole-clause qualification; no broad qualification claim from these two commands. |
| Acceptance 3, truthful annotations for every tool | INSPECTED unchanged within this increment; complete qualification remains unproved. |
| Acceptance 4, refusal code parity | PASS for the two adopted preparation commands only, tests/agent-refusal-flow.mjs:77 to 144. Seven schema-valid failure cases per policy cover proposal validation, hidden source, missing source, consent precondition, debrief validation, missing application and unreleased feedback. Native 400, 404 and 409 retain their messages; MCP returns isError and equal stable codes and status metadata. Hidden and missing sources have identical native and MCP content. Read-tool parity and every other original obligation remain open. |
| Acceptance 5, successful state and audit parity | Valid unsent preparation recovery and native audit action types PASS for this scoped journey, lines 147 to 158. Whole-clause successful UI and tool state-and-audit qualification is not claimed. Browser proof checks existing proposal and debrief end states. |
| Acceptance 6, embedded agents share registry audit | UNPROVED, unchanged hold; no embedded automation was adopted. |
| Inherited LDG-013 human approval boundary | PASS for this increment, native records and revisions unchanged on every refused request; valid proposals remain proposed and briefs draft; all other hiring records stay unchanged. No human-decision tool was added. |
| Authority and disclosure preservation | PASS for this increment, lines 91 to 132 and 161 to 195. Anonymous and revoked credentials receive 401 with no native business code; malformed JSON and an unrelated agent command retain their earlier errors. Hidden and absent sources disclose equal refusals. |
| Shared refusal audit | PASS, lines 104 to 127: refused outcome, same native code, same bound agent and sponsor, current policy revision, no approval or review assertion and no policy discrepancy. Native refusal changes no native audit or record. |
| Replay and restart | PASS, lines 117 to 144: repeated failures remain errors and leave every native record and draft inventory unchanged before and after Worker restart. |
| Zero provider effect | PASS, line 195: outboundService records zero provider attempts across refused and successful preparation. Provider network edge is denied; no live-provider claim. |

## Runtime probes

PROBE BASE-AGENT-002 4: native propose and debrief plus their MCP prepare tools, equivalent bound-agent and sponsor authority under autonomous and held-review policies -> native validation returns 400 native_refused, missing or hidden source returns 404 record_unavailable, unmet native precondition returns 409 native_conflict; MCP isError preserves the same code and status. Every value and revision and nonempty draft inventory stays unchanged; shared audits record refused; zero provider attempts.

PROBE BASE-AGENT-002 restart: original native requests and MCP keys after a real Worker restart -> the same business refusals, unchanged records and inventory, followed by valid unsent proposed and draft preparations.

PROBE BASE-AGENT-002 admission: revoke the existing bound native session and signed consent -> both preparation doors return HTTP 401; no native draft mutation or business result.

## Local checks and browser evidence

All commands below exited 0. RECEIPT.json records their actual logs and hashes. The touched registered test was rerun after committing the exact candidate. Typecheck, first-party check and build ran on the same relevant source and dependencies before the commit; the commit added no further source or dependency edit.

- node --test --test-name-pattern='Native proposal and debrief refusals' tests/security.test.mjs: one selected test, one pass, zero fail, about seven seconds.
- pnpm typecheck.
- pnpm exec rer check --profile first-party.
- npx -y @runeditrun/rer build, through cloud_run.
- timeout 1200 node tests/agent-refusal-browser.mjs, through cloud_run, on the committed candidate, Chromium /usr/bin/chromium with --no-sandbox.

The existing browser journey asserts at 1440 and records each screen once at 1440 and 390. Six actual images are selected explicitly in the evidence packet: unsent-proposal, debrief-draft and debrief-refused-edit at both widths. All were visually inspected. The proposal remains awaiting human decision; the debrief remains draft; the attempted combined recommendation shows the existing refusal and preserves the stored original statement. The icon-only close control shows its tooltip; the existing helper checks focus and delayed hover. No UI code changed and no new design was introduced.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock then node scripts/edition-authoring/cli.mjs check exit=0; views=node scripts/contract-docs.mjs write BASE-AGENT-002 then node scripts/contract-docs.mjs check BASE-AGENT-002 exit=0; ledger=none exit=0

Generated views were restored whole from origin/main before the commit. CONTRACT.md, ACCEPTANCE.md and docs/CLAIMS.md have an empty candidate diff. sources.lock.json was regenerated last and its exact-candidate check passed. No migration was added or edited. No existing assertion was removed, narrowed, skipped or moved behind a condition; there is no added test registration in this continuation.

## DONE rider register

This is an honest PARTIAL claim, not a DONE gate submission. All rows are recorded for the exact candidate.

| Rider | Result | Evidence or remaining boundary |
| --- | --- | --- |
| 1 | FAIL for full clause; scoped point PASS locally | Only two preparations are covered by the scoped refusal journey. Whole-Core, wider tools and other original acceptance outcomes remain unproved. |
| 2 | PASS for scoped increment | Real seeded nonempty inventory, unsafe native and MCP failures, unchanged durable records and successful unsent recovery, flow lines 74 to 158. |
| 3 | PASS for registered scoped proof | The journey is in the security Verify shard through tests/security.test.mjs:22; the browser journey is in tests/browser.mjs:107. Candidate push Verify 42250407201 completed successfully on af2219aacebf412b59f404845537c3a932359321. |
| 4 | PASS locally | Touched registered test and six browser screens ran after candidate commit; relevant source and dependency bytes did not change after the other local checks. |
| 5 | INSPECTED, no new inheritance claim | Existing clause text and LDG-013 preparation boundary remain unchanged; no duty was moved or declared complete. |
| 6 | PASS scoped mechanical checks | Selected contract generator write and check pass; all generated views restored from main, all status cells and counts unchanged. Wider proof gaps stay in this report. |
| 7 | PASS | CONTRACT.md has no diff; no acceptance point, CT rider or coverage map changed. |
| 8 | PASS for scoped increment | Real refused requests preserve records, hidden-source equality, anonymous and revoked credential denial. No authority change. Wider sponsor qualification remains held. |
| 9 | PASS boundary retained | No live Business admission or provider receipt is claimed; zero provider attempts proved. |
| 10 | PASS, not applicable | No new custody, consent, spending or authority default was adopted. Existing rulings and conservative boundaries unchanged. |
| 11 | PENDING fleet landing | Branch-only push. Main equality, complete full-history publication scan and exact-main Run site remain fleet duties. No landing claim. |

## Pre-ready self-check

1. Scoped refusal behavior and recovery have assertions through real public doors; broader full-clause outcomes remain unproved. Candidate CI is reported honestly below.
2. Existing assertions remain intact. The only continuation changes are additional assertions and regenerated source lock.
3. Revoked native session and consent cannot reuse preparation authority; refusal replay cannot create records. General erased-person, retained-client-data and wider lifecycle duties remain held, not silently certified.
4. The existing screens were inspected at both widths with visible controls and tooltip proof; no UI source was edited. Existing typography and placement were retained.
5. Source lock is fresh. Publication scan, resulting main equality and Run site are unestablished until the independent lander runs them. No scan success is fabricated and no email-shaped fixture value was added in this continuation.

SCAN commit=af2219aacebf412b59f404845537c3a932359321 complete=not-run historyScanned=not-established findings=not-established

## Held remainder and custody

GAP BASE-AGENT-002: Native agent mutations remain proposal and debrief preparation under LDG-013. Wider specialist tools from the unmerged SURFACE draft and embedded automation are not adopted. Whole-Core coverage, schema and annotation qualification, read-tool refusal parity, successful UI and tool state-and-audit parity, embedded-agent registry parity and every other original acceptance obligation remain required. Resources, events and subscriptions, access and security and other undeclared families, live Business admission, extra active-sponsor and allow-list-excluded fixtures, active cross-sponsor isolation, unpairing and local-sign-in fallback, retained-client-data custody and erasure, queued continuation and stranger-specialist completion remain held or unproved. Standalone local token issuance is not adopted. All existing queue entries and prerequisites and CT, Base, account, device and lifecycle holds remain unchanged.

No new policy default, blocker, permission, provider action or scope request. No unrelated plan clause was taken. The selected bounded increment is complete; whole-clause completion is expressly held by the brief. The product push succeeded on the first attempt through cloud-push.py; every candidate author and committer uses fleet identity, every trailer is absent, and no published history was rewritten. The branch retains all four starting commits. Main is an ancestor of the candidate; it was not pushed or fast-forwarded. No PR was needed. Report files are published only on evidence/sx-lodge-c-f65.

Verify run: 42250407201, push event, exact head af2219aacebf412b59f404845537c3a932359321.
Initial observation: queued, conclusion null. Final observation will be appended below and saved as ci-run.json; this initial observation never stands for a green run.
Run site: no candidate main run, because landing has not occurred.
GitHub calls used initially: two, one for the required starting SHA's existing run and one discovery for this candidate. One watcher respects at least 300 seconds between calls for a run; no workflow dispatch, rerun or PR was performed.

Observation at 2026-11-06T16:20:53Z: Verify 42250407201 is in_progress, conclusion null, on the exact candidate. Three GitHub API calls used. One more status observation is scheduled at least 300 seconds later.

Final CI observation at 2026-11-06T16:26:42.396362+00:00: Verify 42250407201 completed with success on af2219aacebf412b59f404845537c3a932359321. Four total GitHub API calls; one discovery and two status observations for the candidate, each status observation more than 300 seconds apart. No dispatch or rerun. All local checks and exact-SHA branch Verify are green. Rider 3 passes for the scoped registered proof; rider 1 still prevents whole-clause completion and rider 11 awaits fleet landing, main equality, publication scan and Run site. No product blocker is known.

Evidence return was independently fetched from the first report-only head 9ac791603ae8d4806680dd33ca3558d905022ee2 and verified all 19 selected file lengths, blobs and hashes. This final revision replaces the initial CI observation with the completed exact-SHA result. Product checkout, index and branch head remain unchanged. The product clone and its dependencies will be deleted after the final evidence publication; the actual packet remains under the fleet work directory.
