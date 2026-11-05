sx-lodge-c-f43: blocking finding B fixed on 9695ac29e7c2e3239849a88f35b66ea5feb7f4b2, branch cloud/sx-lodge-c-f43, repository just-every/run-lodge.

BASE-AGENT-008 remains PARTIAL to PARTIAL. Counts remain 70 DONE, 44 PARTIAL and 31 MISSING, total 145. No acceptance point, Status row or plan row changed in this FIX round. Existing holds and the complete remaining Gap stay in force. No DONE claim or new policy default.

The bounded plan was:
1. Reproduce the manager export after peer-scorecard permission loss, using a retained brief quoting only the manager's own card.
2. Require live access to every scorecard represented by the saved brief, including uncited cached criterion ratings; apply the same boundary to native edit and keep commands.
3. Extend the existing attribution sanity journey, run it with the existing COORD-006 journey and typecheck, regenerate and check the contract views, restore the generated views from main, then regenerate and check the source lock.
4. Preserve the published base, push only the named branch once, and publish this packet separately.

The regression failed against the requested base before the product change: the bulk export still contained both retained briefs and the peer's cached rating and scorecard identity. See reproduction.log. The assertion was “bulk export must not disclose any retained peer rating or identity”, exit 1. This was a local product-defect reproduction, not a repair of a failed candidate Verify.

The fix is src/lodge/agents/debriefs.ts:107, canReadDebriefSources. It validates quoted fields and every cached criterion rating against a currently visible scorecard on the same application. canSeeDebrief at line 118 applies this to workspace projections, which also feed activity and exports. draftBrief at line 136 applies it to native edits and decisions, using tracked source reads. A retained brief grants no replacement source permission.

The existing tests/agent-attribution-flow.mjs journey now invokes checkDebriefExportRevocation at line 187. Lines 112 to 180 create a manager's own submitted card and an uncited peer card, prepare two real MCP debriefs, retain one through the native human door, and inspect actual bulk export contents. Both briefs and both cached ratings are present while authorized. After removing only peer feedback permission, the own card remains accessible; the briefs and their preparation activity disappear, bulk and vacancy exports exclude them, and native edit and keep attempts return 404 without a durable change. An authorized owner's export still contains the intact stored briefs. The application may still name its assigned reviewers: this check closes disclosure of cached scorecard content and its source identity, without claiming that ordinary team membership becomes secret.

PROBE BASE-AGENT-008 B: manager loses peer-scorecard access, bulk export of retained own-citation brief -> own card retained; uncited peer rating and identity omitted; native decisions refused unchanged.

Two touched sanity journeys passed, including a repeat on exact committed head 9695ac29e7c2e3239849a88f35b66ea5feb7f4b2: Native agent preparation retains trusted attribution and separate human decisions across activity, exports, revocation and erasure, and COORD-006 a debrief brief quotes released scorecards only, names disagreements and gaps, and never scores or moves the candidate. The attribution journey also retains its existing autonomous and held policy, spoofed confirmation, deactivation, source revocation, erasure and replay assertions. No existing assertion or registration was removed, narrowed, skipped or moved behind a width condition. No permanent test registration was added. No UI file was edited by the fix; the inherited attribution browser journey remains registered in Verify. No fresh local screen proof or full local verify is claimed.

pnpm typecheck and pnpm exec rer check --profile first-party passed. The supplied cloud toolchain selected Node 24.19.0 and pnpm 10.12.4; typecheck emitted the expected package engine warning for the repository's Node 22.20.0 pin and exited 0.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock, then check exit=0; views=node scripts/contract-docs.mjs write BASE-AGENT-008, then check BASE-AGENT-008 exit=0; ledger=none exit=0.
The generated ACCEPTANCE.md and docs/CLAIMS.md were restored wholesale from origin/main before locking and are absent from the fix commit. The new commit retains all 145 Status rows; parent and candidate each have 169 table lines. CONTRACT.md was unchanged relative to the requested base. The source lock was generated last. No migration was added or edited.

The required fresh main fetch and rebase reported that this branch was already up to date. Main 26f3c06bf9343370e3e9860cd45117288f65ebc4 is an ancestor of the published requested base, so no published commit was rewritten and no other writer's work was dropped. The fix commit changes only the native debrief implementation, its existing attribution journey, and sources.lock.json. The inherited f42 attribution changes remain in the candidate ancestry.

All three candidate commits, including all parents, have fleet author and committer identities and no trailers. The complete identity log was inspected before the guarded push. The product push succeeded on attempt 1 and a subsequent remote-ref read confirmed the exact head. No main push, force push, PR, dispatch or rerun occurred.

Exact-SHA Verify run 42132159094, event push, was in_progress when discovered:
https://github.com/just-every/run-lodge/actions/runs/42132159094
No green CI conclusion is claimed. The first discovery used a mistyped SHA and returned no runs; the corrected discovery returned this exact-SHA run. Two GitHub API calls were used. The cloud FIX brief asks for prompt READY handoff after local checks and the named push; the maintained lander owns completion of Verify, the full-history publication scan and Run site. Publication scan and Run site are pending lander gates, not established receipts.

DONE-RIDERS were read. This is a bounded privacy repair with no DONE flip:
- Row 1: the named finding is reached and asserted through the public MCP and native HTTP doors, tests/agent-attribution-flow.mjs:112. Whole-clause coverage is not re-claimed.
- Row 2: the same journey serves the authorized export and refuses the unsafe disclosure, lines 149 and 161.
- Row 3: exact-SHA Verify 42132159094 is in progress; final CI proof is pending.
- Row 4: the two touched journeys passed on the exact committed SHA, exact-sha-tests.log.
- Row 5: inheritance declarations were not edited; no new inherited-duty claim.
- Row 6: generator write and check passed; partial Gap retained; generated views intentionally restored for the lander.
- Row 7: acceptance text and coverage were unchanged; all parent Status rows retained.
- Row 8: native edit and keep refusals preserve every record and audit row, lines 170 to 176.
- Row 9: no provider, legal, lifecycle or custody hold was released.
- Row 10: no product policy default was introduced.
- Row 11: main equality, scan and Run site remain the guarded lander's responsibilities; the candidate is branch-only.

The publication packet contains actual non-secret test outputs, reproduction, mechanical outputs, product diff and receipt, selected explicitly. No credential, environment dump, setup output, symlink or private gate material is selected. There is no blocker to the bounded FIX handoff. Whole-clause completion remains outside this FIX assignment.

POST lanes/sx/INBOX.md: sx-lodge-c-f43 fixed blocking B; BASE-AGENT-008 PARTIAL to PARTIAL, 70 DONE / 44 PARTIAL / 31 MISSING, 145 rows; head=9695ac29e7c2e3239849a88f35b66ea5feb7f4b2; Verify run=42132159094 in progress; own-citation debrief bulk export cannot reveal retained uncited peer feedback after revocation; local touched journeys, typecheck, first-party check and mechanical checks passed; no plan-row edit.
