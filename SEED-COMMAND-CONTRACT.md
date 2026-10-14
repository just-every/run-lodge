# Lodge command contract

Lodge uses package mode: the exact `@runeditrun/rer` version pinned in package.json and pnpm-lock.yaml, public aliases `rer VERB`, and the edition adapter in `scripts/installer/local.mjs`. There is no vendored dispatcher or CLI tree. Runtime pins are Node 22.20.0 and pnpm 10.12.4. OPERATIONS.json is the machine-readable command/effect descriptor; `rer describe` lists current flags.

| Command | Effect |
|---|---|
| `rer install` | Frozen dependency installation; no setup or deployment. |
| `rer setup` | Validate manifest answers, build, apply local D1 migrations, claim or preserve the native owner, check local outbox sign-in and stop temporary serving. |
| `rer dev` | Managed loopback development with real native dev identity; `--as` selects a declared persona (manager, interviewer, approver, agent, admin), `--stop` stops it. |
| `rer preview` | Managed production output on loopback with durable state and normal native sign-in; `--stop` stops it. |
| `rer build` | Real Worker and assets production build with private local configuration excluded and dev-identity output refused. |
| `rer verify` | The declared app wall (`pnpm run verify:app`: build, typecheck, the Lodge flow suites, emitted-Worker runtime and email-link checks), then Base's hosted-output and hydration checks. No deployment. |
| `rer reset --yes` | Confirmed removal of inventoried local state and private settings; no remote effect. |
| `rer export --output FILE` | Whole local installation archive with private file permissions, integrity checks and Base's credential exclusions (sessions, tokens, dependency keys). |
| `rer import --input FILE --yes` | Validated atomic restore into an empty local destination; Lodge's staged validation refuses broken records, blobs and candidate lineage before anything is published. |
| `rer deploy` | Owner-account Cloudflare deployment through Base deploy-kit; needs the owner's credentials. `--dry-run` makes no provider request. |
| `rer outbox` | The local development outbox address for ordinary sign-in links. Token-bearing links are credentials. |
| `rer doctor` | Read-only tool and configuration diagnostics. |
| `rer describe` | Read-only implemented commands, pins and effects. |
| `rer check` | Read-only first-party command, operations and source-copy validation. |
| `rer release` | Local verified release artifact preparation; does not push or deploy. |

Commands accept `--help`, `--cwd PATH`, `--non-interactive` and `--json` where the shared descriptor declares them. Setup accepts a private `--answers FILE`, the owner email and a free loopback port. Secret values are never command-line flags. `RER_READY` marks real health readiness; `RER_OPEN` is private credential-bearing output, so keep it out of logs and screenshots.

The adapter owns the D1 database `lodge`, the restore policy, native sessions and dev identity. The Base application copies are pinned independently of the CLI version (`base-copies.json`). Local evidence does not establish hosted mail, hosted operation or legal acceptance; the product floor is CONTRACT.md and ACCEPTANCE.md.
