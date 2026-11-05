# sx-lodge-c-f42-fix1

Product branch: cloud/sx-lodge-c-f42-fix1
Product head: c8f495e95c2ceec1db47511ed8daaf30695eef72
Repository: just-every/run-lodge
Frozen failed source: 1e122ebf2a966d5a4d328f4a7c45d20d0ca1d0eb
Integrated main: 26f3c06bf9343370e3e9860cd45117288f65ebc4

## Scope and result

Fixed original gate sx-lodge-c-f42-gate-1 blocking B1 only. BASE-AGENT-008 stays PARTIAL. Counts remain 70 DONE, 44 PARTIAL, 31 MISSING, 145 total. No acceptance point closed or added, no lifecycle or hold altered, no new clause claim, no plan remainder taken. The original qualified attribution increment and all current-main assertions remain. Original R1–R6 and frozen lifetime remain unchanged; FIX1of2 is the existing original lifetime. Original and fix SOURCE and exactLAND holds remain ACTIVE. Return this head to the ORIGINAL frozen affected re-gate; no successor watcher.

A manager with both own and peer submitted feedback created and kept a debrief citing only their own card. The retained criterion also held the uncited peer rating. After removing peer-scorecard permission while retaining job management, export and contact permissions, native workspace hid the peer scorecard but the old source exported the retained peer rating, author and scorecard identifier through native bulk preview and bulk apply.

The fix checks retained criterion ratings as sources in addition to statement citations. Every source card must remain in the currently authorized projection of the same application before the retained debrief is served. Native retained-draft authority also checks these rating sources. It hides the complete unauthorized narrative rather than relabeling or destroying stored evidence. Authorized exports before revocation and after restoring real authority remain intact.

## Actual probe and verification

PROBE B1: real native Worker with persistent D1, two submitted scorecards, released feedback, retained debrief citing only the manager's own card; revoke peer-scorecard permission, restart, bulk-preview then bulk-apply -> own card visible, peer card absent. Before fix: one retained debrief exported with uncited peer rating 4 and peer identity and card ID; probe exit 1. After fix, including exact pushed HEAD: zero debriefs and no retained ratings; probe exit 0. Restoring actual permission restores the original debrief and criteria unchanged.

The full actual output is in B1-before.log, B1-after.log and B1-exact-head.log. FIX.patch contains only the source and journey delta against the frozen failed source. No application mock, fallback or case-specific exception was introduced. The test uses the existing real Worker and D1 harness with only its existing mail provider edge.

Targeted existing public-door journeys passed, 3 tests, 0 failures:
- Native agent preparation retains trusted attribution and separate human decisions across activity, exports, revocation and erasure (tests/security.test.mjs), extended in tests/agent-attribution-flow.mjs with checkRetainedDebriefAuthority. All prior lines retained, including autonomous and held policy attribution, duplicates, human decisions, deactivation, revocation, erasure and replay.
- LDG-006/008/016 current roles and principals govern every private HTTP door without refusal side effects (tests/security.test.mjs).
- COORD-006 a debrief brief quotes released scorecards only, names disagreements and gaps, and never scores or moves the candidate (tests/agents.test.mjs).

Command: node --test --test-concurrency=1 --test-name-pattern='Native agent preparation|LDG-006/008/016|COORD-006' tests/security.test.mjs tests/agents.test.mjs

pnpm typecheck: exit 0. pnpm exec rer check --profile first-party: exit 0 (no output). Test runtime was Node 22.20.0 matching CI. An initial invocation using --input-type=module stalled Miniflare's synchronous child worker; invoking the same probe via an ordinary .mjs entry point resolved startup. No production or harness change was used to resolve this. No full or baseline suite ran. Existing test registrations were extended; FIX adds zero registrations, removes or weakens zero assertions. The pre-existing workspace tierD is outside this fix.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock then check exit=0; views=node scripts/contract-docs.mjs write BASE-AGENT-008 then check BASE-AGENT-008 exit=0; ledger=none exit=0 (no migration changed).

The generator reported unchanged counts. Both generated view files were restored wholesale from origin/main before regenerating the source lock last; neither generated view is committed. All 169 parent table lines are retained, with Status identities checked against both merge parents. Source lock check also passed on the exact pushed HEAD. The product worktree is clean. The final commit preserves both the fresh main and frozen failed source as merge parents, with no rewrite or force push. All candidate authors and committers were checked as the fleet identity, and full candidate messages had no coauthor trailers. Product push succeeded on the first guard attempt.

No UI change relative to the frozen source; no new browser proof or provider action was needed for this authorization repair. No homepage, workflow, Base pin, generated view, migration or scope expansion. No DONE claim: DONE-RIDERS promotion and whole-clause awards are outside this B1-only fix. Revocation, erasure and replay in the original attribution journey passed. No approval, review mark or human action is inferred from an agent token.

## Custody and limits

Product push was to the named cloud branch only. No PR created (Verify has a push entry point), no default branch changed. Verify discovery returned push run 42127842946 on the exact head, initially queued. CI.json records the observed exact-SHA status. Publication scan and resulting main Run site remain guarded Mac lander checks; this cloud does not claim their success, landing, source acceptance or hold release. The report packet is separate from the product tree and is published only through evidence/sx-lodge-c-f42-fix1. Plan rows changed: none; relay BASE-AGENT-008 PARTIAL to PARTIAL with B1 repaired for the original frozen affected re-gate.
