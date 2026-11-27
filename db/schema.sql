-- Job Management System schema (with the Resume Tailor). Safe to run repeatedly (idempotent).
-- It describes the current tables for a new database. Changes to existing data (or anything that must run only
-- once) go in db/migrations/NNN_name.sql instead; npm run db:init applies each migration once, in name order.
-- One users table (accounts + their resume tailor profile) and one jobs table
-- (tailoring progress, tailored content, applying and interview steps).

CREATE TABLE IF NOT EXISTS users (
  id                   SERIAL PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  display_name         TEXT NOT NULL DEFAULT '',
  role                 TEXT NOT NULL CHECK (role IN ('admin', 'boss', 'member', 'bidder', 'caller')),
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  -- Bidders and callers belong to one member (their client) and work only on that member's profile.
  member_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Resume tailor profile (members). NULL full_name = no profile saved yet.
  profile_label        TEXT NOT NULL DEFAULT '',
  full_name            TEXT,
  phone                TEXT NOT NULL DEFAULT '',
  email                TEXT NOT NULL DEFAULT '',
  address              TEXT NOT NULL DEFAULT '',
  linkedin             TEXT NOT NULL DEFAULT '',
  experiences          JSONB NOT NULL DEFAULT '[]'::jsonb,
  education            JSONB NOT NULL DEFAULT '[]'::jsonb,
  base_resume_text     TEXT NOT NULL DEFAULT '',

  last_login_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS users_member_idx ON users (member_id);

CREATE TABLE IF NOT EXISTS jobs (
  id                   SERIAL PRIMARY KEY,
  -- The profile (user) the resume and cover letter were tailored for.
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_link             TEXT NOT NULL,
  job_link_normalized  TEXT NOT NULL,
  company_name         TEXT NOT NULL DEFAULT '',
  company_normalized   TEXT NOT NULL DEFAULT '',
  job_title            TEXT NOT NULL DEFAULT '',

  -- Resume tailor: queued -> running -> done, or needs_manual / failed / skipped (duplicate).
  gen_status           TEXT NOT NULL DEFAULT 'queued'
                       CHECK (gen_status IN ('queued', 'running', 'needs_manual', 'done', 'failed', 'skipped')),
  gen_step             TEXT,
  gen_message          TEXT NOT NULL DEFAULT '',
  gen_error            TEXT NOT NULL DEFAULT '',
  gen_logs             JSONB NOT NULL DEFAULT '[]'::jsonb,
  ats_score            INTEGER,
  prompt_tokens        INTEGER,
  completion_tokens    INTEGER,
  total_tokens         INTEGER,
  cached_tokens        INTEGER,
  -- The AI's resume and cover letter content plus the profile it was written for. PDFs and ZIPs are
  -- built from this when they are downloaded (nothing is rendered or stored at generation time).
  tailored             JSONB,
  resume_name          TEXT NOT NULL DEFAULT '',
  cover_name           TEXT NOT NULL DEFAULT '',
  zip_name             TEXT NOT NULL DEFAULT '',
  -- Shown on the user's Resume Tailor board (Clear hides cards; finished jobs stay in the system).
  on_board             BOOLEAN NOT NULL DEFAULT TRUE,
  board_position       INTEGER NOT NULL DEFAULT 0,
  claimed_at           TIMESTAMPTZ,
  generated_at         TIMESTAMPTZ,

  -- Assignments made by the member on the Team page: the bidder applies, the caller attends the interview.
  -- A bidder sees only jobs assigned to them, a caller only interviews assigned to them.
  assigned_bidder_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_bidder_at   TIMESTAMPTZ,
  assigned_caller_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_caller_at   TIMESTAMPTZ,

  -- Applying (only for generated jobs): ready -> applied (screenshot) or failed (with the reason)
  apply_status         TEXT NOT NULL DEFAULT 'ready' CHECK (apply_status IN ('ready', 'applied', 'failed')),
  applied_at           TIMESTAMPTZ,
  applied_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  apply_fail_reason    TEXT NOT NULL DEFAULT '',
  apply_failed_at      TIMESTAMPTZ,
  apply_failed_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Interview: unscheduled -> scheduled (details) -> interviewed (result note) -> offered -> rejected
  interview_status     TEXT NOT NULL DEFAULT 'unscheduled'
                       CHECK (interview_status IN ('unscheduled', 'scheduled', 'interviewed', 'offered', 'rejected')),
  interview_email      TEXT NOT NULL DEFAULT '',
  interview_note       TEXT NOT NULL DEFAULT '',
  interview_date       DATE,
  interview_start      TIME,
  interview_end        TIME,
  interview_timezone   TEXT NOT NULL DEFAULT 'America/New_York',
  interview_start_at   TIMESTAMPTZ,
  -- Who did each step (with when), so every user's work can be counted.
  scheduled_at         TIMESTAMPTZ,
  interview_scheduled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  offered_at           TIMESTAMPTZ,
  offered_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rejected_at          TIMESTAMPTZ,
  rejected_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Result note left after the interview (by the caller or a member)
  interview_result_outcome TEXT NOT NULL DEFAULT '' CHECK (interview_result_outcome IN ('', 'positive', 'neutral', 'negative')),
  interview_result_note    TEXT NOT NULL DEFAULT '',
  interview_result_at      TIMESTAMPTZ,
  interview_result_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Interview request: the profile's Gmail received an email asking to schedule an interview for this job (found by
  -- the daily Gmail check, src/lib/gmail). The newest such email is kept; "Request Schedule" shows while unscheduled.
  interview_requested       BOOLEAN NOT NULL DEFAULT FALSE,
  interview_request_at      TIMESTAMPTZ,
  interview_request_url     TEXT NOT NULL DEFAULT '',
  interview_request_subject TEXT NOT NULL DEFAULT '',
  interview_request_from    TEXT NOT NULL DEFAULT '',

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_board_idx ON jobs (user_id, on_board, board_position);
CREATE INDEX IF NOT EXISTS jobs_apply_idx ON jobs (user_id, gen_status, apply_status, generated_at DESC);
CREATE INDEX IF NOT EXISTS jobs_link_idx ON jobs (job_link_normalized);
CREATE INDEX IF NOT EXISTS jobs_company_idx ON jobs (company_normalized, generated_at DESC);
CREATE INDEX IF NOT EXISTS jobs_interview_idx ON jobs (interview_status, interview_start_at);
CREATE INDEX IF NOT EXISTS jobs_applied_at_idx ON jobs (applied_at);
CREATE INDEX IF NOT EXISTS jobs_assigned_bidder_idx ON jobs (assigned_bidder_id);
CREATE INDEX IF NOT EXISTS jobs_assigned_caller_idx ON jobs (assigned_caller_id);

-- Earlier interview rounds of a job. When an Interviewed job is rescheduled (the next round), its result moves here
-- with that round's schedule, and the job starts the new round without a result. Every result — current or here —
-- counts as one interview held, and as work of the user who wrote it.
CREATE TABLE IF NOT EXISTS interview_rounds (
  id                 SERIAL PRIMARY KEY,
  job_id             INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  round              INTEGER NOT NULL,
  interview_date     DATE,
  interview_start    TIME,
  interview_end      TIME,
  interview_timezone TEXT NOT NULL DEFAULT 'America/New_York',
  outcome            TEXT NOT NULL DEFAULT '' CHECK (outcome IN ('', 'positive', 'neutral', 'negative')),
  note               TEXT NOT NULL DEFAULT '',
  result_at          TIMESTAMPTZ,
  result_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  archived_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interview_rounds_job_idx ON interview_rounds (job_id);
CREATE INDEX IF NOT EXISTS interview_rounds_result_at_idx ON interview_rounds (result_at);

-- Job links sent by the job-finding bot (POST /api/job-links). Separate from jobs: one row per link, a link that is
-- already here is skipped.
CREATE TABLE IF NOT EXISTS job_links (
  id         SERIAL PRIMARY KEY,
  job_link   TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_links_created_at_idx ON job_links (created_at);

-- Files: applied screenshots (applied/<job>) and uploaded templates (templates/<file>).
CREATE TABLE IF NOT EXISTS stored_files (
  key          TEXT PRIMARY KEY,
  data         BYTEA NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);

INSERT INTO settings (key, value) VALUES
  ('company_cooldown_days', '30'::jsonb),
  ('duplicate_scope', '"profile"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Failed sign-ins of the last 15 minutes, per user ID and per client address (src/lib/login-limit.ts).
CREATE TABLE IF NOT EXISTS login_failures (
  key       TEXT NOT NULL,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_failures_key_idx ON login_failures (key, failed_at);

-- Gmail inboxes of the members' profiles, connected by the administrator (Administrator -> Gmail). The refresh token
-- is encrypted with SESSION_SECRET. Every email received before synced_through has been checked.
CREATE TABLE IF NOT EXISTS gmail_accounts (
  member_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  refresh_token   TEXT NOT NULL,
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  connected_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  synced_through  TIMESTAMPTZ,
  last_sync_at    TIMESTAMPTZ,
  last_result     JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error      TEXT NOT NULL DEFAULT '',
  -- Set while a check runs, so two checks never read the same inbox at once.
  sync_started_at TIMESTAMPTZ
);

-- Every email the Gmail check has analyzed (so none goes to the AI twice), with what the AI found.
CREATE TABLE IF NOT EXISTS gmail_messages (
  member_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id        TEXT NOT NULL,
  received_at       TIMESTAMPTZ,
  sender            TEXT NOT NULL DEFAULT '',
  subject           TEXT NOT NULL DEFAULT '',
  category          TEXT NOT NULL DEFAULT '',
  interview_request BOOLEAN NOT NULL DEFAULT FALSE,
  company_name      TEXT NOT NULL DEFAULT '',
  job_title         TEXT NOT NULL DEFAULT '',
  job_id            INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  analysis          JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, message_id)
);
CREATE INDEX IF NOT EXISTS gmail_messages_request_idx ON gmail_messages (interview_request, received_at DESC);

-- Every finished Gmail check (the daily cron job, the server's own scheduler, or Check now): what it found per inbox
-- (src/lib/gmail/sync.ts AccountReport). The daily "Gmail check" notice is built from the checks of one day.
CREATE TABLE IF NOT EXISTS gmail_check_runs (
  id          SERIAL PRIMARY KEY,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger     TEXT NOT NULL DEFAULT '',
  done        BOOLEAN NOT NULL DEFAULT TRUE,
  reports     JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS gmail_check_runs_finished_idx ON gmail_check_runs (finished_at DESC);

-- The daily Gmail check notice of each user: shown in the first session after that day's check (session = the sign-in
-- it was shown in), until the user closes it; a later sign-in that day does not show it again.
CREATE TABLE IF NOT EXISTS gmail_notices (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day       DATE NOT NULL,
  session   TEXT NOT NULL DEFAULT '',
  shown_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, day)
);

-- The migrations in db/migrations that have been applied to this database (npm run db:init).
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
