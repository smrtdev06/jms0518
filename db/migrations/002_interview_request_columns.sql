-- Interview requests found in the profiles' Gmail (see the jobs table in db/schema.sql). New databases already get
-- these columns from schema.sql; this adds them to databases created before.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS interview_requested BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS interview_request_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS interview_request_url TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS interview_request_subject TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS interview_request_from TEXT NOT NULL DEFAULT '';
