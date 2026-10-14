-- Lodge hiring records. Every vacancy, candidate, application, decision and
-- receipt is one typed JSON record with its own revision; document bytes are
-- 'blob' records read only through scoped downloads. l_guard stays empty: a
-- write batch inserts 0 into it to abort when a fenced revision or the actor's
-- session changed after the request read them.
CREATE TABLE l_records (
 kind TEXT NOT NULL,
 id TEXT NOT NULL,
 revision TEXT NOT NULL,
 value TEXT NOT NULL CHECK (json_valid(value)),
 PRIMARY KEY (kind, id)
);
CREATE TABLE l_guard (ok INTEGER NOT NULL CHECK (ok = 1));
