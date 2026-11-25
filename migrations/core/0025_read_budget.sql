-- D1 read budget. Every scheduled run and routine poll asks small indexed
-- questions of l_records instead of loading the whole store, so a run costs the
-- same rows after a year of history as after a day. Workers Free allows 5,000,000
-- rows read a day for the whole account, shared with every other tool on it.

-- Mail that is waiting to go out. Each index matches the exact expression the
-- flush probes use; it covers one kind only, so other writes pay nothing.
CREATE INDEX IF NOT EXISTS l_application_email_due ON l_records(json_extract(value,'$.status'), json_extract(value,'$.dueAt')) WHERE kind='application-email';
CREATE INDEX IF NOT EXISTS l_alert_email_due ON l_records(json_extract(value,'$.emailState'), json_extract(value,'$.digestAt')) WHERE kind='alert';
CREATE INDEX IF NOT EXISTS l_referral_email_state ON l_records(json_extract(value,'$.emailState')) WHERE kind='referral-email';

-- Work that comes due on a date: nurture sequences, reminders, saved reports and
-- scheduled chart emails.
CREATE INDEX IF NOT EXISTS l_crm_enrollment_due ON l_records(json_extract(value,'$.status'), json_extract(value,'$.nextDueAt')) WHERE kind='crm-enrollment';
CREATE INDEX IF NOT EXISTS l_hiring_reminder_due ON l_records(json_extract(value,'$.status'), json_extract(value,'$.nextDueAt')) WHERE kind='hiring-reminder';
CREATE INDEX IF NOT EXISTS l_weekly_report_enabled ON l_records(json_extract(value,'$.enabled')) WHERE kind='weekly-report';
CREATE INDEX IF NOT EXISTS l_analysis_schedule_status ON l_records(json_extract(value,'$.status')) WHERE kind='analysis-schedule';

-- Uploaded resumes still waiting for review; committed ones are history.
CREATE INDEX IF NOT EXISTS l_resume_intake_open ON l_records(id) WHERE kind='resume-intake' AND json_extract(value,'$.status') <> 'committed';

-- A counter every committed write moves (no row until the first write, and never exported).
-- A reader that has proved what a person may see can tell from this one row that no record has
-- changed since. `swept` is the value it held when the hourly run last looked over the whole
-- store and found it settled.
CREATE TABLE IF NOT EXISTS l_generation (id INTEGER PRIMARY KEY CHECK(id=1), n INTEGER NOT NULL, swept INTEGER);
