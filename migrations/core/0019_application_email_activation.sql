-- Installation-local approval prerequisite; never restored from an archive.
-- Only an explicit current human admin approval creates or replaces its epoch.
CREATE TABLE l_application_email_activation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  epoch TEXT NOT NULL
);
