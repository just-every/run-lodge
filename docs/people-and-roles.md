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
owner and hiring admins.
