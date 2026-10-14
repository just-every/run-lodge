# Run it locally

Lodge is a hiring workspace for one business: from an approved vacancy to a
recorded offer decision. Its website is at https://run-lodge.com.

From this checkout root:

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

Commands select the exact Node version the project declares (22.20.0), using a
matching installed runtime or a checksum-verified copy under `~/.rer/node`; set
`RER_NODE_AUTO=0` to turn that off. pnpm 10.12.4 runs through Corepack.

After `RER_READY`, `dev` prints `RER_SIGNED_IN EMAIL` and `RER_OPEN URL`. Open
that URL on this computer: Lodge opens signed in as the owner (finish first-run
setup at `/setup`, then `/app`; the Lobby at `/` links to sign-in). Treat the line as a credential. `dev --login`
uses the local outbox instead; no email ever leaves this computer.

Then, in the app: save your business settings and privacy notice, add your
hiring team under **People**, create a vacancy with its pay range and
headcount, agree its stages, rubric and interview plan, get it approved and
publish it. The application page is at `/jobs`.

To try other roles, the owner adds the dev personas as members under People
(`manager@dev.localhost` as hiring manager, `interviewer@dev.localhost` as
interviewer, `approver@dev.localhost` as approver; `agent@dev.localhost` as an
agent acting for someone), then `rer dev --as interviewer`.

```sh
rer verify          # build, typecheck, flow tests, emitted-Worker checks
rer export --output exports/lodge.rer
rer import --input exports/lodge.rer --yes   # into an empty checkout, then rer setup
rer reset --yes     # removes local data; export first
rer deploy --dry-run
rer describe
```

Full flags, local state and deployment inputs: [RUN-LOCALLY.md](RUN-LOCALLY.md).

The owner guides are in [docs/](docs/getting-started.md); `rer dev` also prints
`RER_SITE`, the run site with the landing, `/run` and those guides, and
`rer build --site` writes it to `dist/site`.

## What Lodge does in this release

- **Vacancies**: title, pay range, hiring manager and headcount, approved on
  the exact terms; stages, a versioned job-related rubric and an interview plan
  agreed before anyone is evaluated; a published, accessible application page.
- **Applications**: a privacy-notice version and receipt for every submission;
  staff-added candidates with source, consent basis and retention date; one
  person linked to several applications; possible duplicates shown for a person
  to decide, never merged automatically.
- **Evaluation**: reviewers see only applications assigned to them, without
  contact details or restricted documents; every stage move keeps its reason,
  person and time; interviews collect panel and candidate availability and
  download as calendar files; scorecards stay independent until the manager
  releases feedback.
- **Decisions**: candidate messages approved as exact text and downloaded as
  `.eml` files to send yourself; offers approved on exact terms with an approval
  packet, outcomes recorded and an HR handoff export.
- **Records**: legal holds, retention review, deletion with a receipt,
  candidate access/export requests, and a whole-vacancy history export.
- **Agents**: a coding agent signs in as its own member acting for one person,
  reads exactly what that person can see, and proposes typed changes that the
  person approves. Lodge runs no model and ranks no one. See [API.md](API.md).
- **Move in**: Workable's full export ZIP through Base's import kit: a preview
  that writes nothing, an exact commit, and undo that keeps what people changed.
  See [IMPORTING.md](IMPORTING.md).

Lodge sends no email, syncs no calendar and posts to no job board in this
release; nothing needs a provider account. It makes no hiring decision and does
not claim legal compliance: retention and recording rules need review for the
employer's jurisdiction before real candidate use.

## Status

First-party seed, working name **Lodge** (name clearance is an owner
decision). Source code: [just-every/run-lodge](https://github.com/just-every/run-lodge). Contract: [CONTRACT.md](CONTRACT.md). What is
proven and what is not: [ACCEPTANCE.md](ACCEPTANCE.md). Source origins:
[SOURCE.md](SOURCE.md). MIT licence.
