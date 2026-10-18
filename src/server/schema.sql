-- StudioMate schema. All timestamps are ISO-8601 UTC strings.
-- Every studio-owned table carries studio_id; services always filter by the
-- studio derived from the authenticated session (SEC-01, DB-01).

CREATE TABLE IF NOT EXISTS studios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
  locale TEXT NOT NULL DEFAULT 'he',
  default_country TEXT NOT NULL DEFAULT 'IL',
  enabled_modules TEXT NOT NULL DEFAULT '["crm","ai","qr"]',
  settings TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_memberships (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner','staff','instructor')),
  scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all','assigned')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (studio_id, user_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  studio_id TEXT NOT NULL REFERENCES studios(id),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  email TEXT NOT NULL COLLATE NOCASE,
  name TEXT,
  role TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all',
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  display_name TEXT NOT NULL,
  phone_e164 TEXT,
  phone_raw TEXT,
  phone_valid INTEGER NOT NULL DEFAULT 0,
  preferred_language TEXT,
  gender_form TEXT, -- optional addressing form chosen manually: 'f' | 'm' | null (neutral)
  pipeline_stage TEXT NOT NULL DEFAULT 'new_lead',
  stage_reason TEXT,
  owner_id TEXT REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  interest TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  needs_review INTEGER NOT NULL DEFAULT 0,
  review_reason TEXT,
  merged_into TEXT REFERENCES contacts(id),
  archived INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_studio ON contacts(studio_id, archived, merged_into);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(studio_id, phone_e164);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_external ON contacts(studio_id, source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS contact_preferences (
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  studio_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  allowed INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  source TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (contact_id, channel)
);

CREATE TABLE IF NOT EXISTS consent_events (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  source TEXT NOT NULL,
  notice_version TEXT,
  reason TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  body TEXT NOT NULL,
  is_private INTEGER NOT NULL DEFAULT 0,
  author_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_contact ON notes(contact_id);

CREATE TABLE IF NOT EXISTS stage_changes (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  reason TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('period','punch','punch_period','trial')),
  sessions_granted INTEGER,
  validity_days INTEGER,
  price TEXT,
  deducts INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  authority TEXT NOT NULL DEFAULT 'local' CHECK (authority IN ('local','external')),
  external_id TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT, -- exclusive boundary (start of the day after the chosen end date, studio tz)
  cancelled_at TEXT,
  cancel_reason TEXT,
  renewed_from TEXT REFERENCES memberships(id),
  reference TEXT,
  source_updated_at TEXT,
  external_balance INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memberships_contact ON memberships(contact_id);

CREATE TABLE IF NOT EXISTS membership_pauses (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  membership_id TEXT NOT NULL REFERENCES memberships(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balance_entries (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  membership_id TEXT NOT NULL REFERENCES memberships(id),
  kind TEXT NOT NULL CHECK (kind IN ('grant','adjustment','deduction','reversal')),
  delta INTEGER NOT NULL,
  attendance_id TEXT,
  reverses_id TEXT REFERENCES balance_entries(id),
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
-- MEM-03 / DB-01: a single deduction per attendance and a single reversal per deduction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_balance_deduction ON balance_entries(attendance_id) WHERE kind = 'deduction';
CREATE UNIQUE INDEX IF NOT EXISTS uq_balance_reversal ON balance_entries(reverses_id) WHERE reverses_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS class_sessions (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  title TEXT NOT NULL,
  trainer_id TEXT REFERENCES users(id),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','open','completed','cancelled')),
  cancel_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_studio ON class_sessions(studio_id, start_at);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  session_id TEXT NOT NULL REFERENCES class_sessions(id),
  membership_id TEXT REFERENCES memberships(id),
  status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present','reversed','pending_reconciliation')),
  channel TEXT NOT NULL CHECK (channel IN ('qr','manual','external','import')),
  checked_in_at TEXT NOT NULL,
  actor_id TEXT,
  note TEXT,
  reversed_at TEXT,
  reversed_by TEXT,
  reversal_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (studio_id, contact_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_contact ON attendance(contact_id, checked_in_at);

CREATE TABLE IF NOT EXISTS qr_challenges (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES class_sessions(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_activations (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_sessions (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone_raw TEXT NOT NULL,
  phone_e164 TEXT,
  language TEXT,
  interest TEXT,
  note TEXT,
  contact_allowed INTEGER NOT NULL DEFAULT 0,
  notice_version TEXT,
  contact_id TEXT REFERENCES contacts(id),
  matched_existing INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','rejected')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (studio_id, request_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  assignee_id TEXT REFERENCES users(id),
  reason_code TEXT NOT NULL,
  title TEXT,
  event_key TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','snoozed','completed','dismissed','superseded')),
  due_at TEXT NOT NULL,
  snoozed_until TEXT,
  snooze_reason TEXT,
  outcome TEXT,
  outcome_note TEXT,
  outcome_channel TEXT,
  dismiss_reason TEXT,
  completed_at TEXT,
  completed_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_studio ON tasks(studio_id, status, due_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_event ON tasks(studio_id, event_key) WHERE event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  rule_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  priority INTEGER NOT NULL,
  facts TEXT NOT NULL,
  facts_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','snoozed','completed','dismissed','superseded')),
  snoozed_until TEXT,
  status_reason TEXT,
  valid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (studio_id, event_key)
);
CREATE INDEX IF NOT EXISTS idx_suggestions_contact ON suggestions(contact_id, status);

CREATE TABLE IF NOT EXISTS message_drafts (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  suggestion_id TEXT REFERENCES suggestions(id),
  task_id TEXT REFERENCES tasks(id),
  reason_code TEXT NOT NULL,
  generated_text TEXT NOT NULL,
  text TEXT NOT NULL,
  language TEXT NOT NULL,
  tone TEXT,
  length TEXT,
  facts TEXT NOT NULL,
  facts_hash TEXT NOT NULL,
  warnings TEXT NOT NULL DEFAULT '[]',
  generator TEXT NOT NULL, -- 'ai' | 'template'
  template_version TEXT,
  model_id TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','edited','wa_opened','marked_sent','outcome_recorded','invalidated')),
  invalid_reason TEXT,
  edited_by TEXT,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interaction_events (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  task_id TEXT,
  draft_id TEXT,
  suggestion_id TEXT,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL, -- wa_opened | marked_sent | outcome_recorded | call | note | stage_change | renewal | registration | attendance
  evidence_type TEXT,
  outcome TEXT,
  note TEXT,
  marketing INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL,
  actor_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_interactions_contact ON interaction_events(contact_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_interactions_studio ON interaction_events(studio_id, occurred_at);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'contacts',
  file_name TEXT,
  file_hash TEXT NOT NULL,
  mapping TEXT NOT NULL,
  preview_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed','committed','rolled_back')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  ok_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  raw TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  committed_at TEXT
);

CREATE TABLE IF NOT EXISTS import_row_results (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(id),
  studio_id TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  status TEXT NOT NULL, -- ok | error | duplicate | needs_review | created | updated | skipped
  message TEXT,
  contact_id TEXT,
  data TEXT NOT NULL,
  UNIQUE (batch_id, row_number)
);

CREATE TABLE IF NOT EXISTS integration_connections (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- 'csv' (manual import) | 'booking_app' | 'monday'
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_connected',
  authority_map TEXT NOT NULL DEFAULT '{}',
  freshness_hours INTEGER NOT NULL DEFAULT 24,
  last_success_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (studio_id, provider)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  studio_id TEXT,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  reason TEXT,
  diff TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_studio ON audit_events(studio_id, created_at);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- ai_draft | ai_fallback
  model TEXT,
  units INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  studio_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response TEXT NOT NULL,
  status INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (studio_id, scope, key)
);
