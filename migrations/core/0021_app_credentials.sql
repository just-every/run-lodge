-- Installation-local capabilities never travel with recruiting archives.
CREATE TABLE l_app_credentials (
 id TEXT PRIMARY KEY,
 revision TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 author_session TEXT NOT NULL,
 author_id TEXT NOT NULL,
 name TEXT NOT NULL,
 jobs TEXT NOT NULL,
 fields TEXT NOT NULL,
 created_at TEXT NOT NULL,
 revoked_at TEXT
);

-- Restoring membership never resurrects a capability issued before suspension.
CREATE TRIGGER l_app_credentials_member_suspended AFTER UPDATE ON l_records
 WHEN NEW.kind='member' AND (json_extract(NEW.value,'$.active') IS NOT 1 OR json_extract(NEW.value,'$.agent')=1)
 BEGIN
  UPDATE l_app_credentials SET revoked_at=COALESCE(revoked_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
   revision=lower(hex(randomblob(16)))
   WHERE author_id IN (SELECT id FROM oa_operators WHERE email=NEW.id);
 END;
CREATE TRIGGER l_app_credentials_member_removed AFTER DELETE ON l_records
 WHEN OLD.kind='member'
 BEGIN
  UPDATE l_app_credentials SET revoked_at=COALESCE(revoked_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
   revision=lower(hex(randomblob(16)))
   WHERE author_id IN (SELECT id FROM oa_operators WHERE email=OLD.id);
 END;
