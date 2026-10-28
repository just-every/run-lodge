# Run it locally

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

Open the `RER_OPEN` URL that `dev` prints (it signs you in as the owner; treat
it as a credential). `rer verify` is the full local wall;
`pnpm test:lodge` runs the flow tests and `pnpm typecheck` the typecheck.
[RUN-LOCALLY.md](RUN-LOCALLY.md) has every flag; [SEED-COMMAND-CONTRACT.md](SEED-COMMAND-CONTRACT.md)
the shared command contract.

# Working on Lodge

Lodge is a hiring and applicant-tracking edition: one business, occasional
hiring, structured human decisions. Read [CONTRACT.md](CONTRACT.md) for what
must keep working and [ACCEPTANCE.md](ACCEPTANCE.md) for what is proven.

## Where things live

- `src/lodge/core`: record store (`store.ts`, `state.ts`), access rules
  (`access.ts`) and validation (`types.ts`).
- `src/lodge/records`: one module per responsibility: people, vacancies,
  approvals, candidates, intake (the public application), documents, pipeline,
  interviews, scorecards, messages, offers, retention.
- `src/lodge/agents`: proposals (agent-native workflows) and coordination facts.
- `src/lodge/views`: the scoped workspace projection, search and exports.
- `src/lodge/move-in`: the Workable kit (ZIP, CSV, mapping) and the Base
  import-kit D1 target.
- `src/lodge/http`: private JSON API (`api.ts`) and applicant pages (`public.ts`).
- `src/ui`: the `/app` workspace (TanStack Start route `src/routes/app.tsx`).
- `src/site` and `docs/`: the run site (run-lodge.com) that `rer build --site`
  writes to `dist/site`: the landing (`src/site/landing`, its exact copy in
  `copy.ts`), Base's Run page at `/run`, and the guides rendered from
  `docs/*.md` in the order `docs/site.json` gives. A broken link between guides
  fails the build. `rer dev` serves it as `RER_SITE`. The installed `/` stays the
  Lobby.
- `public/rer-theme.css`: the `--rer-*` theme tokens and the faces, the only things
  Base's theme grammar allows there (the installer reads it); `public/fonts/fonts.css`:
  every other colour, radius and shadow, and the rules that dress Base's pages. Each is
  defined once; `public/lodge.css` (the app) and the site read those tokens.
- `migrations/core`: Base auth, outbox and portability (0001–0005), Base import-kit
  (0006, 0016), Lodge records (0007), current Base auth, dependency, owner-claim
  and erasure schemas (0008–0015), owner sign-in and sealed dependency keys
  (0017–0018), application-mail activation and enterprise SAML transactions
  (0019–0020). Business settings, stable Business people and the shared agent
  door add schemas 0021–0023. Never edit an applied migration; add the next one.
- `src/modules/*`, `src/base`: byte copies of Base at the revision in
  `base-copies.json` (see SOURCE.md). Refresh them with Base's `refresh-base`;
  do not edit them in place. The agent-door and Business-settings prerequisites
  at Base `d555e789cffb744a9f83d76ebe42a2e3bdd7a055` are recorded independently
  of the CLI package pin. Their source and schemas alone do not enable a door;
  a native integration and complete specialist conformance are still required.

## Rules that keep Lodge correct

- Every record is a typed JSON row with its own revision. A command reads what
  it depends on through `State.get` or `State.find`; `save` fences each of those revisions
  and the actor's live session in the same D1 batch. Reading a dependency with
  `all()` does not fence it: use `get` for anything a decision relies on.
- Capabilities come from the saved member record and the native session, never
  from a request body. Add a new view through `views/workspace.ts` so search,
  exports and agent reads inherit the same scope.
- Restricted material (right-to-work papers, accommodation and voluntary
  monitoring answers) is visible to the owner and hiring admins only.
- Approvals bind to a hash of the exact terms (`records/approvals.ts`). Any
  change to those terms makes the approval stale.
- No simulated AI, no pretend delivery: messages download as `.eml`, calendar
  invitations as `.ics`; agents propose, people approve.
- Imported data is inert history. It never grants access, sends anything or
  becomes an open vacancy.

## Tests

`tests/hiring-{candidates,offers,security,reports}.test.mjs`, `tests/agents.test.mjs` and `tests/move-in.test.mjs`
drive the real Worker and D1 (Miniflare) through HTTP, one subtest per contract
clause. `tests/browser.mjs` runs the fresh-clone journeys at 1440 and 390 wide
through `rer`. Keep one test per clause; no pin tests.

## Owner decisions still open

Name clearance and public release; first jurisdiction (default: a US employer,
with legal review before live intake); provider adapters for phase 2 (email,
calendar, optional models). Do not deploy, publish or call providers without
the owner.

## Lander-Regenerate

After changing a selected legacy status row in CONTRACT.md, run
`node scripts/contract-docs.mjs write COM-005` and
`node scripts/contract-docs.mjs check COM-005` (substitute the touched clause ids).
This incrementally generates those rows in ACCEPTANCE.md and docs/CLAIMS.md,
preserving unrelated legacy records and existing policy quotations. Stage the
intentional edits, then regenerate the edition source lock last with
`node scripts/edition-authoring/cli.mjs lock` and run its `check` command.
