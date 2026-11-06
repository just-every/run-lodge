# Lodge qualification report: sx-lodge-c-f59

Repository: just-every/run-lodge. Product branch: cloud/sx-lodge-c-f59.
Candidate: `0982834f66d9b018af720e12992908160a887e47`.
Starting main: `7091069f6524f1c0d1ecd90b0b54bcae2f01d8f1`.
No pull request is required by the repository's push and dispatch Verify entry points; none was created. No default branch was pushed.

BASE-AGENT-001 remains PARTIAL → PARTIAL. Only acceptance 6's no-effect boundary for the existing authenticated MCP door is qualified. Counts remain 70 DONE, 44 PARTIAL, 31 MISSING, total 145. Every parent Status row is retained. The plan row to update is BASE-AGENT-001: record this bounded proof and preserve every existing hold. No other plan row is changed or retargeted.

## Plan and actual work

The full plan is in PLAN.md. Read the target clause, acceptance points, Status Gap, the inline ct riders and rulings, repository instructions, existing conformance and native fixture helpers. Existing production conformance asserted HTTP 413 but did not compare native state. Its oversized witness arguments were unsuitable as a positive control for a real write. The missing proof was a valid preparation request refused solely for size, with actual native state and inventory comparisons, followed by the same valid arguments and key succeeding within capacity.

Created an external raw HTTP driver and a disposable emitted-Worker fixture helper. The helper follows the existing owner bootstrap, signed Business settings, agent binding, native hiring commands and migrated D1 setup. It serves the unchanged production build and real built assets with Miniflare and workerd. No permanent test, runtime, manifest, copied Base, workflow or approved-screen change was made. Test registrations changed by zero; no assertion was removed, narrowed, skipped or moved behind a condition.

The only product changes are the BASE-AGENT-001 Evidence and Gap cells in CONTRACT.md, the bounded qualification explanation in docs/agent-access.md and the generated source lock. No acceptance sentence changed. Generated ACCEPTANCE.md and docs/CLAIMS.md were checked locally and restored whole from origin/main; neither is committed. Homepage, visual design, logos, identifiers and Base pins are unchanged.

## Actual public-door proof

Command, run on the exact candidate after rebuilding it:

`cloud_run timeout 1200 env QUALIFY_BROWSER=1 node <packet>/oversize-qualification.mjs`

The actual receipt is qualification-receipt.json. It names the full candidate SHA and records four passing cases, exact framing, response bodies, native snapshot hashes and outcome assertions. The one-off source files are oversize-qualification.mjs and production-harness.mjs. Signing material and credentials are not retained in the packet. All test identities and local configuration are synthetic.

Discovery advertised maxBodyBytes = 1,048,576. Each oversized body was 1,048,577 bytes. JSON whitespace made an otherwise valid JSON-RPC proposal preparation exceed capacity without changing its parsed arguments. The explicit-length case transmitted that Content-Length. The streamed case used an actual Node HTTP connection, 65 separately written chunks and chunked transfer encoding with no Content-Length. No buffered fetch or intercepted browser request stood in for the streamed body.

PROBE BASE-AGENT-001 6 autonomous declared: authenticated proposal preparation with explicit oversized Content-Length → HTTP 413, no tool result, identical native values and revisions, inventory and hiring decisions; same arguments and key within capacity → one proposed unsent draft, autonomous decision, no applied vacancy or provider call.

PROBE BASE-AGENT-001 6 autonomous streamed: authenticated chunked proposal preparation without Content-Length → HTTP 413, no tool result, identical native values and revisions, inventory and hiring decisions; same arguments and key within capacity → one proposed unsent draft, autonomous decision, no applied vacancy or provider call.

PROBE BASE-AGENT-001 6 held declared: authenticated proposal preparation with explicit oversized Content-Length → HTTP 413, no tool result, identical native values and revisions, inventory and hiring decisions; same arguments and key within capacity → one proposed unsent draft, current review decision and linked open review, no applied vacancy or provider call.

PROBE BASE-AGENT-001 6 held streamed: authenticated chunked proposal preparation without Content-Length → HTTP 413, no tool result, identical native values and revisions, inventory and hiring decisions; same arguments and key within capacity → one proposed unsent draft, current review decision and linked open review, no applied vacancy or provider call.

Every refusal protects nonempty proposal and debrief inventories. The driver deep-compares every l_records kind, id, revision and serialized value, plus shared calls, reviews, approvals, audit, usage, events and captured mail. It also independently compares the signed-in native projections of proposals, debriefs, vacancies, applications, offers, approvals, scorecards and messages. Only hashes and counts are persisted, not raw record contents. Positive controls retain every non-proposal native value and revision except the expected native audit addition. Each completed call is linked to its current policy decision and shared audit; held calls retain the corresponding open review. Replaying the within-capacity call returns the same draft and changes no proposal inventory. Provider calls and new captured mail are zero.

The driver also exercises discovery, deterministic tool order and private cache fields, both supported protocol versions, unsupported-version refusal, foreign-Origin refusal and method-header mismatch under both policies. These are supplemental observations, not a promotion or waiver of other transport acceptance.

## Frozen bounded rubric

| Item | Outcome and door | Proof | Result |
| --- | --- | --- | --- |
| R1 | Autonomous declared-length overflow is refused without native effects | oversize-qualification.mjs lines 126–148; receipt autonomous declared case | PASS |
| R2 | Autonomous genuine streamed overflow is refused without native effects | same driver, lines 49–80 and 126–148; receipt autonomous streamed framing | PASS |
| R3 | Held declared-length overflow is refused without native effects | same driver, lines 126–148; receipt held declared case | PASS |
| R4 | Held genuine streamed overflow is refused without native effects | same driver, lines 49–80 and 126–148; receipt held streamed framing | PASS |
| R5 | Identical valid arguments and key succeed once within capacity, retain current policy and review linkage and apply no hiring effect | same driver, lines 149–174; all four positive controls | PASS |
| R6 | Existing refusal and native draft end states remain inspectable | same driver browser leg; six screenshots at 1440 and 390 | PASS |

These are one-off runtime comparisons requested by this round. No permanent mutation test was added, and this report makes no claim that the external qualification driver is registered in Verify.

## Browser inspection

Native proposal drafts, a retained draft debrief and the existing Agents policy-refusal page were captured once at each required width on the exact candidate. The browser used Chromium at /usr/bin/chromium with --no-sandbox, a fresh context and the disposable installation's own native session. Built production assets, the production Worker and real D1 served all screens over HTTP. No browser response was mocked or intercepted.

The screenshots show five native proposals still awaiting human decisions, including the four within-capacity positive controls and the retained baseline draft; a separate draft debrief still has its human Keep and Discard controls. The Agents page shows the two open held-policy reviews and a separately exercised policy refusal. That policy refusal is not presented as the transport's 413 UI: the 413 is a JSON-RPC response and creates no tool audit entry. Existing icon tooltips were checked through tests/icon-tooltips.mjs at desktop width; the application-close tooltip is visible in the debrief captures. No screen was changed.

## Validation and mechanics

- Fleet launcher refresh and decrypted-bundle Git helper installed; fleet identity and preserved repository hooks active.
- Setup completed through the authorized cloud runner. Initial and exact-candidate production builds passed.
- `pnpm typecheck`: exit 0.
- Existing journey: `node --test --test-name-pattern='Recruiting coordinator prompt stays static' tests/security.test.mjs`: 1 passed, 0 failed. Its source and all runtime bytes are unchanged between the starting main and candidate.
- Exact-candidate one-off qualification and browser leg: exit 0, four cases and six screenshots.
- `pnpm exec rer check --profile first-party`: exit 0, including evidence-path checks.
- `git diff --check`: exit 0. Added product prose contains no email-shaped strings. New repository links name only the declared repository. Existing source paths are retained as paths.
- Parser-based parent-row preservation: 145 → 145. The initial ad hoc row-count regex rejected its own incomplete kind pattern; the repository parser confirmed every parent clause survived. No acceptance or status row was lost.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock then check exit=0; views=node scripts/contract-docs.mjs write BASE-AGENT-001 then check BASE-AGENT-001 exit=0, generated views restored from origin/main; ledger=none exit=0, no migration changed.

mechanical-receipt.json records the actual commands, exits and output hashes at the candidate. Its final git diff check is clean. Sources were relocked after contract and docs edits and checked again after the no-op rebase; the final mechanical pass leaves no product changes.

One disposable browser setup attempt used the existing dev helper against rer's newer local entry point and failed admission; the final proof instead uses the emitted production Worker directly. One repeat build found this run's stopped dev child as a zombie with parent 1, retaining its local-operation lease. The exact lease was preserved under the ignored local-operation directory after checking its owner PID and zombie state. No runtime guard or data was changed. The subsequent exact-candidate build passed. These were local fixture setup issues, not a product defect or a Verify repair.

## DONE riders and limits

No DONE claim or ct judge request is made. The requested bounded proof passed; the clause remains PARTIAL.

1. Bounded acceptance-6 outcome is reached through raw authenticated HTTP, including native readback. Whole-clause completion is not claimed.
2. Unsafe requests change nothing; supported requests create the expected unsent draft. Nonempty native inventory is protected.
3. The qualification is deliberately one-off, outside Verify, as requested. It supplies bounded evidence, not whole-clause DONE coverage.
4. The actual final receipt and screenshots name the exact candidate SHA; the production build was rerun at that SHA.
5. No receiving clause or inherited duty changed. Existing duties remain open where unproved.
6. Evidence and Gap describe this proof and retain the remainder. Generated views pass before restoration; counts and the source lock are fresh. The legacy global Judged-from line is not rewritten for a partial qualification.
7. No acceptance text or coverage mapping changed. Every parent Status row survives.
8. No new authority is granted. Existing owner sponsorship and native human decisions remain in force; other role and authority qualification is not claimed.
9. No provider, legal, device, live Business admission or retained-data proof is claimed.
10. No new custody, consent, spending or authority policy default is adopted.
11. Product landing, full-history publication scan and resulting main Run site are maintained Mac lander gates, not established by evidence publication.

Resources and subscriptions are undeclared; standalone local token issuance is not adopted. BASE-AGENT-003 work, including two-role qualification, file bytes, Base byte budgets, refresh and broader primary types, remains queued and is not retargeted. Wider unmerged SURFACE tools and embedded automation, access and security families, live Business admission, extra active sponsors and excluded-client fixtures, active cross-sponsor isolation, unpairing and local sign-in fallback, retained-client-data custody and erasure, queued continuation, stranger-specialist completion and every omitted original acceptance obligation remain held or unproved. All existing queue entries, prerequisites and ct, Base, account, device and lifecycle holds remain unchanged. Live BASE-AGENT-012 is excluded. No adjacent held campaign work was started.

## Product custody and CI

The first real commit was pushed through cloud-push.py to cloud/sx-lodge-c-f59 after checking all candidate author and committer identities, messages and trailers, including side parents. There is one candidate commit, with fleet identity and no co-author trailer. Main was fetched and the unpublished branch rebased before the push; the rebase was a no-op. Product checkout was clean after final validation.

The docs-only commit includes [skip ci]. REST discovery found no run, so exactly one Verify dispatch was started on the named branch. No duplicate dispatch or rerun was requested. CI status and run identifiers will be recorded in ci-receipt.json before final evidence publication. A generated-view-only freshness failure, if any, belongs to the documented lander regeneration path. No cloud publication scan or Run site success is claimed.

Evidence publication is report transport only. It grants no product READY, acceptance or landing. The complete explicitly selected packet is published only to refs/heads/evidence/sx-lodge-c-f59.
