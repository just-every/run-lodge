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
