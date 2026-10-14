# Lodge acceptance record

Status: **all seventeen first-release clauses in [CONTRACT.md](CONTRACT.md) are
LOCAL PROVEN** on the re-platformed release (current Base, published
`@runeditrun/rer`). Each row names the test that proves the clause through a
public door: Lodge's HTTP routes on the real Worker with D1 in workerd, the
installed `rer` verbs, or the built pages clicked in a browser. People sign in
through operator-auth's real invitation and emailed links; no application code,
provider or AI result is faked, and there is no provider in this release to
fake. `rer verify` and the browser journey run again on every push in the
Verify workflow.

| # | What a person can do | Proven by | Status |
|---|---|---|---|
| 1 | Create a vacancy with its pay range, owner and headcount, and publish only after the exact terms are approved by the assigned approver; any change makes the approval stale. | `tests/hiring.test.mjs` › `LDG-001 vacancy terms need a headcount approval that matches them exactly` | LOCAL PROVEN |
| 2 | Agree stages, a versioned job-related rubric and an interview plan before evaluation; they stay fixed while published. | `LDG-002 stages, rubric and plan are agreed before evaluation and stay fixed while published` | LOCAL PROVEN |
| 3 | Publish an accessible application page that works without JavaScript, records the privacy-notice version and returns a receipt; stale notices and cross-site posts are refused. | `LDG-003 the accessible application page records the notice version and returns a receipt` | LOCAL PROVEN |
| 4 | Add candidates with source, consent basis and retention date, and attach files whose download returns the original bytes. | `LDG-004 staff add candidates with source, consent basis, retention and original file bytes` | LOCAL PROVEN |
| 5 | Keep one person across several applications and review possible duplicates by hand; nothing merges automatically and a merge keeps every application's history. | `LDG-005 one person, several applications; duplicates are reviewed, never merged automatically` | LOCAL PROVEN |
| 6 | Assign reviewers who reach only their assigned applications, through the screen, search, downloads, exports and agent reads alike. | `LDG-006 an interviewer reaches only assigned applications, through every door`; `tests/security.test.mjs` › `LDG-006/008/016 current roles and principals govern every private HTTP door without refusal side effects` | LOCAL PROVEN |
| 7 | Move applications through stages with a reason, actor and time in a readable history; concurrent moves cannot both commit. | `LDG-007 stage moves keep reason, actor and time; concurrent moves cannot both win` | LOCAL PROVEN |
| 8 | Plan interviews from the vacancy's plan, collect panel and candidate availability, schedule, and download a calendar file. | `LDG-008 interviews collect panel and candidate availability and download as calendar files` | LOCAL PROVEN |
| 9 | Submit independent scorecards with evidence for every rating; colleagues read them only after the manager releases feedback. | `LDG-009 scorecards are independent until the manager releases feedback` | LOCAL PROVEN |
| 10 | Draft a candidate message, have it approved as exact text, and download it as an unsent `.eml`; editing makes the approval stale. | `LDG-010 messages are approved as exact text and downloaded, never sent` | LOCAL PROVEN |
| 11 | Compile an offer approval packet, record accepted, declined or withdrawn only against a current approval of the exact terms, and export the HR handoff. | `LDG-011 an offer is approved on exact terms, its outcome recorded and handed to HR` | LOCAL PROVEN |
| 12 | Place and release legal holds, review past-retention records, delete a candidate with a receipt that keeps no personal data, complete access/export requests, and export a vacancy's whole history. | `LDG-012 holds block deletion; deletion leaves a receipt; access requests export everything` (with `tests/retention-flow.mjs`); vacancy history in `LDG-006` | LOCAL PROVEN |
| 13 | Let a coding agent, acting for one person, prepare a vacancy, a feedback packet from the interviewer's own notes, coordination reminders or talent-pool matches; the named person approves the exact version, and stale or unsupported proposals fail. | `tests/agents.test.mjs` › `LDG-013 agents propose typed changes from versioned sources; a person approves; stale or unsupported proposals fail`; proposal access in `tests/security.test.mjs` | LOCAL PROVEN |
| 14 | Move in from a Workable full-export ZIP: a dry run that writes nothing and discloses missing resumes and unmatched files, an exact commit through Base import-kit's journal, a repeat that creates nothing, and undo that keeps what people changed. | `tests/move-in.test.mjs` › `LDG-014 Workable package: preview writes nothing, commit is exact and repeatable, undo keeps what people changed`; the Move in page in `tests/browser.mjs` | LOCAL PROVEN |
| 15 | Export the whole installation and restore it into an empty checkout with the same records, document bytes, people and import batches; damaged, non-empty or semantically broken archives are refused before publication. | `tests/portability.test.mjs` › `LDG-015 actual seed restore policy rejects broken records and lineage before publication` (includes real `rer import` in a disposable checkout); the archive round trip in `tests/browser.mjs` | LOCAL PROVEN |
| 16 | Rely on every private door checking the live session, exact origin and saved membership; deactivation removes access at once and refused requests change nothing. | `LDG-016 every private route checks the live session, origin and saved role`; `tests/security.test.mjs` | LOCAL PROVEN |
| 17 | Install, set up, run, build, preview, verify, export, import, reset, dry-run deploy, describe and check Lodge with the published `rer` verbs from a fresh clone, and use every main screen at 1440 and 390 pixels wide without sideways scrolling. | `tests/browser.mjs` (fresh clones of the committed HEAD; owner onboarding, the whole loop clicked by manager, approver, applicant and interviewer at both widths, every workspace screen, Lobby, sign-in and job list); `rer check --profile first-party`; `rer verify` | LOCAL PROVEN |

`rer verify` runs `pnpm run verify:app` (build, typecheck, the five Lodge flow
suites, `tests/runtime.mjs` for health, documents and real 404s on the emitted
Worker, and `tests/email-link.mjs` for the ordinary emailed sign-in through the
key-gated outbox), then Base's hosted-output and hydration checks.

## Boundaries

LOCAL PROVEN means the behaviour was exercised through its named route, command
or page on a local installation. It does not establish hosted deployment,
provider delivery (Lodge sends nothing in this release), legal compliance for
any jurisdiction, or acceptance of the Workable kit against a real authorized
export: the kit is built and proven against documented-shape fixtures in
`fixtures/workable-full-export`, written from Workable's published description
of its full export. The owner's first review is a running workflow and a
migration receipt, not this table.
