# Lodge verification

`pnpm test:lodge` runs all eight HTTP/D1 suites. The four `hiring-*.test.mjs`
entrypoints cover candidates, offers, security and reports; the agents,
move-in, security and portability suites retain their own entrypoints.
`tests/run-lodge.mjs` maps these files to CI's four `LODGE_TEST_AREA` values.
An unknown value fails; no value runs the complete set.

Each domain's `*-driver.mjs` keeps its HTTP and browser journeys together.
`harness.mjs` shares only the compiled Worker bundle. Every fixture still owns
its own Worker, migrated D1, native sessions and cleanup. `businessHarness`
applies the common business settings through the real command route.

`pnpm test:browser` drives every browser journey at 1440 and 390 pixels.
CI uses `LODGE_BROWSER_WIDTH` to select one width per job, with separate proof
artifacts. Omitting it preserves both widths for local and narrow journeys
(`node tests/clause-browser.mjs CAND-001`, for example).

The core Verify job runs `rer verify` with `LODGE_VERIFY_CORE=1` to check the
build, site navigation, types, emitted runtime, hosted output and hydration
once. Four lightweight matrix jobs run every HTTP/D1 area in parallel. The
workflow succeeds only when the core, all four areas and both browser widths
succeed. An ordinary local `rer verify` retains the complete suite.
Evidence paths in CONTRACT.md and ACCEPTANCE.md name the entrypoint and driver
that own each public-door assertion. Keep tests within the default 200
registrations; selectors and setup helpers do not register extra tests.
