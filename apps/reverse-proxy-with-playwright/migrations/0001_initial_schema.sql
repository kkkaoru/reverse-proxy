-- Initial schema for reverse-proxy-with-playwright
-- Execute with bun: bun run db:migrate:local

CREATE TABLE sign_in_selectors (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  sign_in_url TEXT NOT NULL,
  user_id_selector TEXT NOT NULL,
  password_selector TEXT NOT NULL,
  sign_in_button_selector TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE secret_keys (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  secret_key_base64 TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE signed_in_validation_regex (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  text_selector TEXT NOT NULL,
  is_signed_in_regex_pattern TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sign_in_users (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  user_id TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(domain, user_id)
);

CREATE INDEX idx_sign_in_selectors_domain ON sign_in_selectors(domain);
CREATE INDEX idx_secret_keys_domain ON secret_keys(domain);
CREATE INDEX idx_signed_in_validation_domain ON signed_in_validation_regex(domain);
CREATE INDEX idx_sign_in_users_domain_user ON sign_in_users(domain, user_id);
