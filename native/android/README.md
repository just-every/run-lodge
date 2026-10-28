# Lodge Android debug client

This initial native client opens assigned interview kits and keeps private feedback drafts on the device. It uses the installation's real authenticated API. It is not a production mobile release.

Build with JDK 17 or later and an Android SDK containing platform 35 and build tools 35.0.0:

```sh
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Open Settings, enter your installation's HTTPS address, and sign in. Request your sign-in email in the app, then paste its confirmation link in Settings to finish signing in within this app's separate cookie jar. The installation address is saved without the confirmation token. Only a debug build accepts unencrypted loopback HTTP for a local Worker.

Open an assigned kit while connected. Its questions and focus attributes are cached, with private edits encrypted using an Android Keystore key and an atomic file in device-local storage excluded from backup. No colleagues' feedback, contact details or original documents are cached. Screenshots are blocked in the product. The cache is limited to eight hours and to the original installation and session. Sign-out, observed access refusal, changed sign-in and cache expiry erase the local kit and draft.

Reopening first checks current access. A network failure leaves the cached kit visibly labelled and the feedback unsubmitted. Edits survive process termination. Connecting does not send feedback. Use **Submit feedback explicitly** to send. The server checks the captured application, interview, job, rubric, saved membership, session and scorecard revisions. A changed assignment or revision refuses rather than silently adopting new terms. Opening another kit requires explicit confirmation to discard the old private draft.

An attempted request is frozen durably before transport. A missing confirmation leaves a pending state; **Retry confirmation explicitly** reconciles the identical request. Only a matching server confirmation marks the scorecard submitted. Signing out tries to revoke the server session and always clears local data; an offline sign-out reports that server revocation could not be confirmed.

The app cannot learn a remote revocation while disconnected. Offline copies remain device-local until the next access check or local expiry. Enterprise identity-provider redirects, iOS, push reminders, native home, search, tasks, approvals, applicant work, production signing and complete mobile-device acceptance remain outside this debug increment.

## Installed-emulator journey

Start an Android emulator, set ANDROID_HOME, build both APKs, then run from the repository root:

```sh
timeout 1200 node tests/mobile-native-journey.mjs
```

The journey installs the actual APKs, creates synthetic members through native auth against the real Worker and D1, disconnects the network edge, edits feedback, force-stops the app and reopens it. It checks stale-rubric refusal, role and session revocation, a lost response after a real commit, and identical-request reconciliation after both app and Worker restart.

Set LODGE_EVIDENCE to an external directory to capture the changed native states at widths 1440 and 390. Assertions run at width 390. Only the synthetic instrumentation session temporarily permits screenshots; the product retains its screenshot protection. The server reconnect guard is also exercised by the MOB-001 test in `tests/hiring-security.test.mjs`, which push Verify loads. The installed-emulator journey currently runs separately from push Verify.
