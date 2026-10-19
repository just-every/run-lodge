# Your first vacancy

Write the role, agree how you will judge it, get it approved and publish its
application page.

## Add your hiring team first

Under **People**, add the people who will hire with you and give each the roles
they need: **Hiring manager**, **Interviewer**, **Approver** or **Hiring
admin**. See [People and roles](people-and-roles.md).

## Write the terms

Open **Vacancies** and choose **New vacancy**. Fill in **Job title**,
**Location**, **Work mode**, **Employment type**, **Headcount**, the pay range
(**Pay currency**, **Pay period**, **Minimum pay**, **Maximum pay**), the
**Hiring manager** and the **Description applicants will read**, then press
**Create vacancy**.

The vacancy opens below the list. Until you are ready, **Edit terms** changes
any of it.

## Agree how you will judge it

Before anyone is evaluated, the vacancy needs three things:

- **Stages**, one per line, in order: for example *Phone screen*, *Portfolio
  review*, *Panel interview*.
- **Rubric**, one criterion per line as `Name: the job-related evidence it looks
  for`. Each save makes a new rubric version, and every application records the
  version it is judged against.
- **Interview plan**, one interview per line as
  `Name | Stage | minutes | criterion, criterion`.

Lodge lists anything still missing under **Before approval, add:**.

## Get approval and publish

Under **Approval**, choose an **Approver** and press **Request approval**. The
approver sees the exact terms under **Approvals**, picks **Approve these exact
terms** and presses **Record decision**.

Pay range, headcount and hiring manager are approved together. Change one after
approval and the approval no longer applies: request it again.

The approval opens one opening per approved head under **Openings**, each with
its own opening ID (change it to your own under **Change opening**) and target
first day. Close an opening you will not fill with a reason. **Add an opening**
raises the headcount by one; the new opening waits until the approver agrees.

Under **People**, admins keep **Departments and offices**: a department can sit
inside another, renaming keeps the earlier name, and anything still in use cannot be
deleted. Choose a job's **Managed department** and **Office** in its terms; the
careers page at `/jobs` filters by both. A manager can be given departments or
offices whose jobs they also run.

Under **Screening questions**, choose which questions applicants answer on this
job and whether each is required. Admins keep the **Question library**: each
question has an answer type (yes or no, choices, number, date, file or text),
and each edit saves a new version while earlier applications keep the version
they answered. Lodge refuses questions about protected traits and salary
history.

Under **Screening rules**, admins act on objective answers (yes or no, choices,
numbers, dates): move the application to a stage, assign a reviewer, tag it, or
propose rejection into the job's **Rule matches** queue, where a recruiter
confirms each one or the whole queue. An admin can approve a rejection rule to
close later matches automatically. Editing a rule never changes earlier
applications unless you preview it on them and apply it. Lodge sends no
rejection email yet.

Once approved, press **Publish application page**. The vacancy shows its address,
for example `/jobs/product-designer`, and anyone can apply there. Stages, rubric
and plan cannot change while the page is published. **Unpublish** and **Close
vacancy** each ask for a reason.

**Export this vacancy's whole history (JSON)** downloads the terms, approvals,
applications, stage history, interviews, scorecards you may read, messages and
offers in one file.

Next: [Applications](applications.md).
