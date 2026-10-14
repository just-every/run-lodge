# Workable full-export fixture (synthetic, documented shape)

Every name, email, file and value here is invented. The layout follows
Workable's own description of its full data export ZIP (help.workable.com,
"How do I export candidate data", read 2026-10-11): one CSV per area with the
column names that page lists, resumes in folders named by job id with one
sub-folder per candidate, and a Read Me file.

What this fixture does **not** establish: the exact CSV file names, folder
naming of candidate sub-folders, date formats, quoting and encoding of a real
export. No owner-authorised Workable export has been seen. Until one completes a
full move-in and export-back comparison, the kit is "documented shape", not accepted.

Deliberate cases, each asserted by `tests/move-in.test.mjs`:

- Lee Moreno (5003) appears on two rows for two jobs: one person, two applications.
- Robin Hale (5004) has an unreadable email: set aside, not imported.
- The last candidates row is cut short: set aside as malformed, not padded.
- Kai Ito (5005) names `missing.pdf`, which is not in the package: reported missing.
- `7002/9999-unknown/stray.txt` matches no candidate: reported as an orphaned file.
- A comment refers to candidate 7777, who is not in the export: set aside.
- `email_templates.csv` and `Read Me.txt` are listed as not carried over.
- Workable's "Talent Pool" flag is kept as a fact; it never becomes permission to contact.

The test packs this folder into a ZIP at run time (`tests/zip.mjs`); to try the
kit in the app, run `node tests/zip.mjs fixtures/workable-full-export workable-sample.zip`
and upload that file on the Move in page.
