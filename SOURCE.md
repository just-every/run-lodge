# Lodge source origins

Lodge was composed on 11 October 2026 from the Base foundation at runeditrun/base
`87835b4b9b1edc40da4410159dc66ee1bf0e98b5` and re-platformed on 14 October 2026
onto Base `79f61faef682f9d6cdb64e843cfbd3cf02887982` and the published
`@runeditrun/rer` package (pinned exactly in `package.json`). This checkout is
authoritative and is never regenerated from author source.

**Package mode.** Base's `scripts/export-cli.mjs --to-package` replaced the
vendored CLI (`scripts/rer.mjs`, `scripts/base-cli`, `scripts/base-onboarding`)
with the pinned package; it found no local edits in the vendored copy. Every
verb runs as `rer VERB`. The executable portability policy that Lodge once
carried as a CLI customization is now Base's supported `policyModule`
(`scripts/installer/portability-policy.mjs`, default export).

**Byte copies of Base 79f61fa**, each recorded file by file in
`base-copies.json` (`rer check` names any operator-auth drift; Base's
`edition-authoring/cli.mjs verify-base --base <checkout>` checks them all):
`src/base` (from `foundation/runtime`), `src/modules/operator-auth`,
`src/modules/mail`, `src/modules/import-kit` (its tests and proofs stay in
Base), `src/modules/ai`, `src/modules/dependencies` and
`src/modules/owner-claim`. `src/client.tsx`, `src/server.dev.ts`,
`src/mail.server.mjs` and `scripts/operations-config.mjs` are the foundation
template's files; `src/identity.ts`, `src/server.ts`, `src/auth.server.ts`,
`src/routes/__root.tsx` and `vite.config.ts` are the template's with Lodge's
routes added. The Figtree, Inter, JetBrains Mono and Outfit fonts are SIL Open Font License
(each `LICENSE.txt` under `public/fonts/`).

**Migrations.** 0001–0005 are the original foundation's and 0006 is Base
import-kit's D1 schema at 87835b4; 0007 is Lodge's. None was edited. 0008–0015
add the current foundation's provider-control, dependency, owner-claim,
identity-provider, provider-pin, dependency-setup, erasure and
dependency-approval schemas (the same SQL a fresh foundation ships). 0016 adds
the import-kit objects introduced since 87835b4 and replaces the stream-revision
guard that retirement extends; applying 0006 then 0016 yields exactly the
schema a fresh current import-kit installation creates.

Lodge owns `src/lodge`, `src/ui`, `src/routes/app.tsx`, `migrations/core/0007_lodge.sql`,
`public/lodge*.css`, `public/rer-theme.css`, `public/brand/mark.svg`, the
installer adapter and policy under `scripts/installer`, the fixtures and tests
and these documents. Operator-auth stays byte-identical: Lodge adds
membership guards around its invitation batch in
`src/lodge/core/invitation.ts`. Base and Lodge are MIT; see LICENSE.

**Demo adoption (15 October 2026).** `src/modules/demo`, operator-auth and mail
are refreshed from Base's v2 demo runtime. `base-copies.json` records their exact
revision and hashes, together with the adoption guide, workflow and additive
owner-signin migration. Lodge owns `src/demo.ts` and `src/demo-data.ts`; they
insert real hiring records with fixed IDs and finish the sample owner's first run.
The existing owner-claim route accepts Base's signed per-visitor claim.

**Native hosted demo (16 October 2026).** Lodge pins rer 0.2.30, whose hosted
demo runs each visitor in a native Worker Loader isolate. Every recorded copy,
the workflow and the adoption guide were refreshed together from Base tag
rer-v0.2.30. `src/modules/dependencies/logout.mjs` is left out of the record:
Lodge keeps its exact-match fence check (same behaviour as Base's
`includes`, written so code scanning reads it as exact).

`edition.json` retains the existing `hiring/lodge` identity and names Lodge's
locally owned product source. Refresh `sources.lock.json` with Base's supported
`edition-authoring/cli.mjs lock` at the revision recorded in `base-copies.json`,
after staging intentional edits. It inventories all tracked edition files;
Base's byte copies remain recorded separately in `base-copies.json`.

**Agent-door runtime source (28 October 2026).** `src/modules/agent-door`,
`src/modules/business-settings` and their theme-frame/icon-head dependencies
are byte copies at Base `d555e789cffb744a9f83d76ebe42a2e3bdd7a055`.
Their schemas are additive migrations 0021–0023; all earlier migrations retain
their original bytes. These source copies do not yet mount the shared door or
replace Lodge's current source-bound proposal authority. Runtime integration
and its complete specialist conformance remain required before adoption can
be claimed. The CLI dependency remains the exact package pin in package.json.

**Core agent door (29 October 2026).** The production Worker now mounts the
shared door before native authentication redirects. Agent-door, Business
settings, operator-auth and their theme/icon dependencies are recorded at Base
`2135c394939f4a737adabdc8003b0e667b31ac5a` (rer-v0.2.91). The separate CLI
pin is `@runeditrun/rer@0.2.91`. Applied schemas retain their original bytes.
Lodge's adapters keep native membership, source visibility and human-only
hiring decisions authoritative; the declared capability families are tools,
policy, pause, audit and idempotency. See [Agent access](docs/agent-access.md).
