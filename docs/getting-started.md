# Getting started

Run Lodge on your own computer, sign in as the owner and set up your business.

Lodge is free and open source under the MIT license. It runs on your computer
with the `rer` command, keeps every record in a local database you own, and
needs no account with anyone.

## 1. Get Lodge and start it

Copy this line into a terminal and press Enter:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-lodge
```

Git is required; rer brings Node and pnpm. Already have Node 22 or later?
`npx -y @runeditrun/rer dev just-every/run-lodge` does the same. Lodge runs on
macOS, Linux or Windows with WSL2.

The line installs `rer`, the Run Edit Run command, for you alone, then clones
Lodge into `run-lodge`, installs everything, makes you the owner and prints a
link that opens Lodge signed in as you. The first start can take a few minutes.
If the installer prints a line that puts `rer` on your PATH, run that line too.
To start Lodge again later, run the same line from the same folder, or
`cd run-lodge && rer dev`.

> Treat the link `rer dev` prints as a password: anyone who opens it is signed
> in as you.

## 2. Finish setup

The link opens **Finish setup**. Check that the name and email are yours, tick
**I confirm this owner account is ready to use.** and press **Finish setup**.

Lodge then opens on **Welcome to Lodge**. Save your business:

- **Business name**, shown at the top of every screen.
- **Accommodation contact**, the email or phone applicants use to ask for
  adjustments.
- **Time zone your business works in**, filled in with your computer's zone.
  Interview times, history and applicant receipts read in this zone wherever
  Lodge is opened, so a Thursday panel is Thursday for everyone.
- **Keep candidate records for (days)**, 365 to begin with. See
  [Retention and deletion](retention.md).
- **Jurisdiction note**, where you hire, for your own legal review.
- **Applicant privacy notice**, the text every applicant reads and agrees to.
  Each change becomes a new version, and every application records the version
  the applicant saw.

Press **Save business settings** and the **Overview** opens with your
**Getting started** steps. Once your jobs have applications, Lodge opens on the
job board instead.

## Stop and start again

`rer dev --stop` stops Lodge. `rer dev` starts it again with everything as you
left it. To sign in again later, open `/signin`, ask for a sign-in link and
read it with `rer outbox`: on your own computer no email leaves the machine.

Next, [create your first vacancy](first-vacancy.md).
