# Moving in from Workable

The first move-in kit reads Workable's **full data export**: the ZIP Workable
support provides on request. The candidate CSV report is not enough: it leaves
out resumes and files. Ask for the export once your jobs are archived, and ask
for signed offers to be included if you need them (they are optional in the export).

## What the kit reads

One CSV per area (jobs, candidates, members, comments, ratings, events, inbound
and outbound messages) and the resume folders: one folder per job id, one
sub-folder per candidate. The shapes follow Workable's own documentation;
[fixtures/workable-full-export](fixtures/workable-full-export) is a synthetic
package in that shape. **No real Workable export has been checked yet**: file
names, candidate folder names, quoting and dates of a real export may differ,
and the kit stays "documented shape" until an owner-authorised export completes
a full move-in and export-back comparison.

| Workable | Lodge |
|---|---|
| Job | Vacancy marked imported (history; it cannot be reopened). Salary columns are kept as source values; no pay range or period is invented. |
| Candidate row | Candidate (once per Workable candidate id) and one application per job, with the source stage, disqualification and cover letter. |
| Files in the candidate's folder | Documents with their original bytes; the file named in `download` is the resume. |
| Comments, ratings, events, messages | Imported history on the application. Messages were not sent or received by Lodge. |
| Members | Kept as source names and roles only. They get no Lodge access. |
| "Talent Pool" | Kept as a fact. It is **not** permission to contact; ask the person. |
| Email, e-signature, interview and video templates; Read Me | Listed as not carried over. |

## Preview, commit, undo

Preview writes nothing. It shows counts per area; rows set aside and why
(short or malformed rows, unreadable emails, references to people or jobs not in
the package); files that match no candidate; resumes named but missing; and
areas not carried over. Commit runs only the exact previewed package and
mapping (its fingerprint), in batches through Base import-kit's D1 journal,
which keeps every original file unchanged. Committing the same package again
returns the same batch and creates nothing. A batch that stops part way can be
resumed from the Move in page.

Undo removes imported records nobody changed. A record a person edited, or one
that another record still relies on (for example a candidate you linked to a
new vacancy), is kept, and the batch details say which and why. Undo never
deletes silently.

## Limits in this release

Packages up to 20 MB (60 MB unpacked, 5,000 files); files up to 1 MB each;
ZIP64 and encrypted ZIPs are refused. Deleting an imported candidate for a
retention or erasure request is refused for now: their original files stay in
the import batch's custody, and Base import-kit cannot yet erase attachments.
Undo the batch (if nothing changed), or keep the candidate until phase 2 adds
per-person erasure of imported records.

After a whole-installation restore (`rer export` / `rer import`), import
batches and their retained originals come across, but each batch stays bound to
the operator who ran it and sign-in identities are not archived, so the restored
owner can read a batch but not resume or undo it. Undo before moving if you may
need to. A reviewed custody hand-over is phase 2.

Greenhouse (Harvest V3 JSON), Lever and Ashby kits are later, in that order.
