# Lodge contract rulings

## HIRE-008 — 27 October 2026

CT APPROVE WITH RIDERS, implementation STAYS PARTIAL. Supplied review pins: main 6d0f523c58861577a011204882027a2bda17c935; candidate b893265cef10ca60bff5d2add47a8a66a1d645cb. The follow-up confirms the approved authority default needs no further review.

Native phone-reference default ADOPTED WITH RIDERS by CT on 27 October 2026. A current human who manages the job and holds both edit-job-settings and contact-details permission may configure the questionnaire and selected reader roles. This includes job-scoped recruiters, coordinators and hiring managers authorized under REQ-003 and OPS-004; configuration is not owner-only. Selecting a reader role grants neither application access nor contact permission. Recording phone-reference evidence requires current human job-management authority, current application access and contact permission. Task assignment alone grants no reference authority. Reading requires a selected reader role, current application access and contact permission together. Agent reads and reads in a blind-review context are refused. These restrictions apply through every door, including state, search, exports, downloads and agent context, and are rechecked against current authority on each request. Phone-reference answers retain the questionnaire version, referee identity, human recorder, recorded consent and call source. Consent and source are manually recorded employer evidence, never verified referee submissions, verified identity or legal approval. Required recorded consent and source must be present before recording; their presence does not establish their truth or legal sufficiency. Corrections preserve earlier versions and provenance. LDG-012 retention, holds and erasure continue to apply. Reference results never move or reject an application. The complete original candidate, referee, COM-001, Crosschq and SkillSurvey journeys remain required.

Approved additional acceptance sentences:

Through the public commands, a job-scoped recruiter and coordinator with current job-management, settings and contact authority can configure phone-reference questions and reader roles; removing either required permission refuses configuration without changing records. Record a task-linked phone reference with referee identity, human recorder, questionnaire version, recorded consent and source; missing required consent or source refuses recording, and a correction preserves the earlier version and provenance. Serve the recorded answers to an explicitly selected human reader with current application and contact authority, while refusing an unselected reader, a selected reader without either underlying authority, an unrelated member, an agent and a blind-review context through every applicable read door. Revoke the reader’s role or underlying authority and assert immediate refusal, then verify authorized export, retention review, hold refusal and erasure under LDG-012 and unchanged application stage history.

Required synchronized Gap:

Native phone-reference recording is an increment only. The complete original HIRE-008 acceptance journey remains unbuilt or unproved: candidate reference requests at a chosen stage; candidate naming of two referees and consent through CAND-001; delivered COM-001 questionnaires and private links with authorized sender grants, reminders, deadlines and expiry; and authorized Crosschq and SkillSurvey orders, provider status reconciliation and report readback. Authorized provider accounts and exact-candidate provider receipts remain required. Manual consent and source records do not prove referee identity, referee submission, legally sufficient consent, lawful recording, provider retention or provider deletion. Employer legal review and applicable consent and recording requirements remain unproved boundaries. Exact-candidate proof of the native CT riders remains required wherever not established, including delegated authority, all-door refusals, immediate revocation, preserved versions, lifecycle behavior and unchanged stages. This policy ruling completes no implementation requirement and removes no scope.

### RL-101 — Enterprise referral sign-in keeps every named provider

**Date:** 2026-10-28 · **Ruled by:** ct · **Clauses governed:** CRM-011.

**Question:** Can Okta-only proof satisfy the employer-SSO obligation for the referral portal?

**Adopted/proposed default:** Keep CRM-011 partial and retain the entire OPS-002 employer-SSO obligation while proving the Okta slice.

**Outcome: adopt with rider.** Retain the complete Okta, Entra and Google Workspace target and immediate provider-deprovisioning loss of portal access; an Okta-only implementation is a labelled slice, not reduced acceptance.

**Why:** Greenhouse supports SAML identity providers including Okta, Google and Entra and documents separate provisioning integrations. The held gap is missing integration/setup and evidence, not a product policy requiring the owner to choose fewer providers.

**Sources:**
- [Greenhouse supports Okta, Google, Entra and other SAML2 identity providers.](https://support.greenhouse.io/hc/en-us/articles/210259723-Single-sign-on-SSO-overview)

**Placement:** Keep CRM-011's single OPS-002 citation and state no provider carve; remove only 'Okta-only acceptance awaits ct' from its Gap, retaining concrete setup/proof work.

**Current-main evidence:** CONTRACT.md:143 (clause), :436 (Status row); `6d0f523c58861577a011204882027a2bda17c935`.

**Engineering/proof boundary:** Engineering-only classification: the 'Okta-only acceptance awaits ct' question asks whether incomplete integration/proof can satisfy unchanged acceptance; it cannot. Admin Console preparation, absent tenant grants and provider-originated SCIM evidence remain. Product permission defaults are ct-owned; acquiring logins/accounts remains owner-reserved when actually needed.

### RL-102 — Source-bound active-application migration authority

**Date:** 2026-10-28 · **Ruled by:** ct · **Clauses governed:** MIG-008.

**Question:** May a reviewed owner-run cutover adopt source approval and contact history without silently creating contact permission?

**Adopted/proposed default:** Owner-only fingerprint-bound cutover; recorded contact basis; source approval may be adopted only where it actually existed.

**Outcome: adopt with rider.** Adopt preview-bound activation and sourced approval adoption only when the currently authorized employer approver affirms the exact live terms; preserve source provenance and require a recorded applicable contact basis before messaging, with no inferred consent from import alone.

**Why:** Greenhouse treats active migration as a deliberate move into jobs/stages by authorized hiring users; Workable distinguishes lawful processing basis from consent. There is no common norm that a migrated approval or email address alone authorizes publishing or contacting. The conservative default is lawful and retains fresh LDG-001 approval when source approval is absent.

**Sources:**
- [Greenhouse documents authorized active-candidate import and stage placement.](https://support.greenhouse.io/hc/en-us/articles/360040034991-Active-candidate-migration)
- [Workable distinguishes lawful processing bases and clear consent where consent applies.](https://www.workable.com/candidate-privacy)

**Placement:** State source-approval/contact-basis conditions once in MIG-008's own point; cite LDG-001 approval and LDG-014 import/undo rules. Owner-only is current implementation authority, not removal of target recruiter workflows.

**Current-main evidence:** CONTRACT.md:289 (clause), :492 (Status row); `6d0f523c58861577a011204882027a2bda17c935`.

**Engineering/proof boundary:** All adapters, user mapping, interviews/scorecards/offers, scheduling, closed-history refusal and conflict reporting remain. This rules product semantics, not a concrete live cutoff; an actual business cutover still needs its owner's sign-off.

### RL-103 — Employer identity enablement and separate compliance scope

**Date:** 2026-10-28 · **Ruled by:** ct · **Clauses governed:** OPS-002.

**Question:** May the employer enable immutable employee provisioning and separate human compliance access under the proposed conservative boundary?

**Adopted/proposed default:** Owner enables identity; employee-only provisioning cannot adopt an existing email; compliance is human and job-scoped; pinned signed SAML keeps canonical issuer/subject.

**Outcome: adopt with rider.** Adopt explicit connection enablement, immutable issuer/subject binding and no email-only account takeover; identity provisioning grants no hiring or compliance permission beyond separately assigned current roles, and deactivation revokes every inherited door.

**Why:** Greenhouse's SSO and SCIM setup has explicit administrative permissions, mapped attributes and deactivation rather than erasure. No common norm requires every product to auto-adopt same-email accounts or assign sensitive compliance roles from identity alone; separating these authorities is the safest default. Workable likewise requires the company's configured SSO context, rather than a free-floating email match.

**Sources:**
- [Greenhouse requires authorized SSO/SCIM setup and maps provider users for provisioning/deactivation.](https://support.greenhouse.io/hc/en-us/articles/9825388563483-Configure-SCIM-for-Okta)
- [Greenhouse documents Entra provisioning and deactivation with explicit configuration permissions.](https://support.greenhouse.io/hc/en-us/articles/35654588835867-Configure-SCIM-for-Microsoft-Entra-ID)
- [Workable employer-enabled SSO uses the company's provider and account context.](https://help.workable.com/hc/en-us/articles/360000066573-How-do-I-sign-in-using-SSO-single-sign-on)

**Placement:** Put identity binding and role separation in OPS-002's own point, with a shared live-revocation door rule cited by CRM-011, INT-001, COLLAB-001 and MOB-001; keep REPORT-002's compliance delta once.

**Current-main evidence:** CONTRACT.md:316 (clause), :497 (Status row); `6d0f523c58861577a011204882027a2bda17c935`.

**Engineering/proof boundary:** No claim that local protocol fixtures are provider execution. Okta admission/push, Entra setup, Google Directory sync and tenant grants remain engineering/proof work; no provider purchase or login is authorized.
