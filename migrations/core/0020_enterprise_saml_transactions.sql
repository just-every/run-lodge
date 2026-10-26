-- One-use SP requests and assertion replay protection. Only hashes of browser
-- bindings and verified assertion identifiers are retained.
CREATE TABLE l_enterprise_saml_transactions (
 request_id TEXT PRIMARY KEY,
 browser_hash TEXT NOT NULL,
 config_hash TEXT NOT NULL,
 generation INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER,
 assertion_key TEXT UNIQUE,
 response_key TEXT UNIQUE
);
