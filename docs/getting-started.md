# Getting started

Run Lodge on your own computer, sign in as the owner and set up your business.

Lodge is free and open source under the MIT licence. It runs on your computer
with the `rer` command, keeps every record in a local database you own, and
needs no account with anyone.

## 1. Install rer

The Run Edit Run command. Once per computer.

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
```

Or install it with npm: `npm install -g @runeditrun/rer`.

## 2. Get Lodge and start it

```sh
git clone https://github.com/just-every/run-lodge.git lodge
cd lodge && rer dev
```

`rer dev` installs everything, makes you the owner and prints a link that opens
Lodge signed in as you. The first start can take a few minutes. Lodge needs
Node 22 or later and pnpm 10.12.4, on macOS, Linux or Windows with WSL2; `rer`
fetches the exact Node version Lodge pins when your computer does not have it.

> Treat the link `rer dev` prints as a password: anyone who opens it is signed
> in as you.

## 3. Finish setup

The link opens **Finish setup**. Check that the name and email are yours, tick
**I confirm this owner account is ready to use.** and press **Finish setup**.

Lodge then opens on **Welcome to Lodge**. Save your business:

- **Business name**, shown at the top of every screen.
- **Accommodation contact**, the email or phone applicants use to ask for
  adjustments.
- **Keep candidate records for (days)**, 365 to begin with. See
  [Retention and deletion](retention.md).
- **Jurisdiction note**, where you hire, for your own legal review.
- **Applicant privacy notice**, the text every applicant reads and agrees to.
  Each change becomes a new version, and every application records the version
  the applicant saw.

Press **Save business settings** and the **Overview** opens with your
**Getting started** steps.

## Stop and start again

`rer dev --stop` stops Lodge. `rer dev` starts it again with everything as you
left it. To sign in again later, open `/signin`, ask for a sign-in link and
read it with `rer outbox`: on your own computer no email leaves the machine.

Next, [create your first vacancy](first-vacancy.md).
