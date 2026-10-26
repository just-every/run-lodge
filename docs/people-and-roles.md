# People and roles

Who can do what in Lodge comes from their membership, saved under **People**.

## Roles

| Role | Can |
|---|---|
| Owner | Everything, including business settings, move-in and adding agents. |
| Hiring admin | Manage every vacancy and member except other admins; see restricted records. |
| Hiring manager | Create and run their own vacancies, applications, messages and offers. |
| Interviewer | Read the applications they are assigned to and write scorecards. |
| Approver | Approve vacancy terms and offers assigned to them. |
| Compliance reviewer | Read restricted originals and monitoring answers for explicitly granted jobs, separately from hiring access. |
| Employee referrals | Use their own referral portal and frozen submissions. |

Nobody approves their own request, except the owner.

## Add or change a member

Under **Add or change a member**, enter the **Email** and **Name**, tick their
**Roles** and press **Save member**. Ticking **Deactivate (keeps their history,
removes access)** stops their access at once and keeps everything they did.

**Invite to sign in** (owner only) requests a sign-in link through your configured
mail provider. Local and demo runs accept the invitation without sending mail.
To explore another role locally, use `rer dev --as interviewer` after adding
the matching dev persona as a member.

## What interviewers see

Interviewers see only the applications they are assigned to, without contact
details. Restricted documents and voluntary monitoring answers stay with the
owner, hiring admins and explicitly assigned human compliance reviewers.

## Mentions and notifications

Type **@** in a candidate note to mention a colleague; Lodge suggests active
members and writes their address. A colleague who can see the candidate gets an
in-app item and an email with the note and a link. Someone who cannot gets the
note text with every address and phone number taken out, no link and nothing
else: mentioning never gives access. A hiring admin can instead refuse such
mentions (**Notification settings**, **Defaults by hiring-team role**).

Under **Notification settings** each member chooses, for every job they are on,
how email and in-app notices arrive for a new application, an application
assigned for review, an approval waiting, a scorecard submitted, feedback
released, an interview scheduled or changed, an offer's status and an @mention:
off, immediately or as a daily digest (sent at 8:00 in the business's time zone).
Admins set a default per hiring-team role; a member's own choice wins. Lodge
checks your access when it sends: after you leave a job its notices stop and a
pending digest leaves that job out. Turning a setting off stops future notices
only. Email goes through the installation's own mail provider; with none
configured the in-app items still appear.

## Review bulk invitations

From **People and settings**, open **Invite people in bulk**. Paste a list of
email addresses, or a CSV with an `email` header. Optional columns are `name`,
`roles`, `permission level`, `job`, `job role`, `department`, `office`,
`departments` and `offices`. Separate multiple roles or places with semicolons.
Use job, level and place names or IDs. Preview each row before sending. Invalid
addresses, existing members, unknown jobs and roles you cannot grant are flagged.
The owner sends only the valid rows. Reopening a batch or resubmitting the same
list never automatically sends the invitations again. Failed or interrupted
attempts remain visible for individual review.

## Employer Okta and compliance access

The owner opens **Enterprise identity settings** from the same page. Provisioning
starts disabled. Installation setup supplies `ENTERPRISE_OKTA_ISSUER` (the exact
Okta org issuer), `ENTERPRISE_OKTA_CLIENT_ID`, `ENTERPRISE_OKTA_CLIENT_SECRET`,
`ENTERPRISE_OIDC_SECRET` and `ENTERPRISE_SCIM_TOKEN` as server secrets. Generate
the last two independently, with at least 32 characters each. Register the exact
installation origin followed by `/auth/oidc/lodge-okta/callback` in the employer's
web application. Never paste these secrets into a task, browser form or source.

Explicitly enable the connection, then use `/enterprise/signin`. Provisioned
people must use the bound employer identity. The provisioning endpoint is
`/scim/v2`, authenticated with the installation's SCIM bearer credential. A
stable provider subject is required; matching an existing address never adopts
an existing account. Provisioning grants employee referral access only. A human
administrator grants hiring roles under **People and settings**. Email changes
need owner review. Suspending a provisioned identity revokes native sessions and
credentials, stops pending owned work and reassigns open tasks with their
history. Reactivation never revives old sessions.

Choose compliance reviewers per job under **Enterprise identity settings**.
They open `/enterprise/compliance` to read only the granted restricted originals
and monitoring answers. This grant does not expose the hiring pipeline,
feedback or canonical candidate contact details. Every human keeps access to
their own employee referrals. Fair-chance records, restricted custom fields and
privacy exports remain with their existing administrator audience.

For SAML, configure `ENTERPRISE_SAML_ISSUER`, `ENTERPRISE_SAML_ENTRY_POINT` and
`ENTERPRISE_SAML_CERTIFICATE` instead of the OIDC client secrets. Keep
`ENTERPRISE_OKTA_ISSUER` as the canonical provisioning org. The callback is the
installation origin followed by `/enterprise/saml/callback`; the SP entity is
the origin followed by `/enterprise/saml`. The provider must sign both response
and assertion with the pinned certificate and issue a persistent NameID equal
to the stable provisioned subject. Assertions about an email address never adopt
an account. Unsolicited assertions, replay and mismatched requests are refused.

Real Okta acceptance and provider-originated SCIM delivery still require live
employer proof. Entra, Google Workspace, Google Directory sync and live SAML
remain unproved. A local protocol journey does not establish a provider push.

Okta's private SCIM push integration needs authorized Admin Console preparation
against the installation's public HTTPS base URL, with its dedicated bearer
credential and create, update and deactivate operations enabled. The documented
SSWS token connection API does not configure generic SCIM apps. See the
[private integration setup guide](https://developer.okta.com/docs/guides/scim-provisioning-integration-connect/main/).
The opt-in live journeys are `./tests/enterprise-live.mjs` and
`./tests/enterprise-saml-live.mjs`; they delete their temporary provider resources
and explicitly distinguish harness-originated SCIM from provider push.
