# Job Management System

Next.js 16 + PostgreSQL. Members tailor a resume and cover letter for each job link (Resume Tailor), bidders apply
and upload proof (Applying Management), and the team tracks interviews (Interview Schedule).

## Setup

```bash
npm install
cp .env.example .env        # fill in the DB_* values, SESSION_SECRET, ADMIN_PASSWORD and the AI key
npm run dev                 # checks PostgreSQL, prepares the database, runs the app at http://localhost:3000
```

PostgreSQL must be running (the locally installed service, or a hosted database in `DATABASE_URL`). `npm run dev`
runs `db:init` first: it creates the database and tables when missing, upgrades older versions, and creates the
administrator from `ADMIN_USERNAME` / `ADMIN_PASSWORD` (a changed `ADMIN_PASSWORD` resets its password). Every time the
server starts, it also checks the users table and inserts that administrator again if there is no active administrator.

| Command | What it does |
|---|---|
| `npm run dev` | Database check + `db:init` + app (development) |
| `npm run start:all` | Same, with a production build and server |
| `npm run dev:app` | App only (`next dev`) |
| `npm run db:init` | Create/upgrade the schema, apply new migrations, and the administrator |
| `npm run db:sql` | Write `db/job_management.sql`: the schema, migrations and administrator (from `ADMIN_PASSWORD`) as one plain SQL file for `psql` |
| `npm test` | Unit tests (`tests/`, Node's built-in test runner) |
| `npm run check` | Typecheck + unit tests |

`db/schema.sql` is the only schema: it creates the current tables and is safe to run again. A change to existing data,
or anything that must run only once, goes in `db/migrations/NNN_name.sql`; `db:init` applies each migration once, in
name order, and records it in `schema_migrations`. `db/job_management.sql` is generated (`npm run db:sql`) and is not
committed, since it holds the administrator's password hash.

## Roles

| Role | Sees |
|---|---|
| Administrator | Administrator only: users (members, their bidders and callers, bosses), job links, templates, activity log, settings, backup, the profiles' Gmail |
| Boss | Dashboard only — analytics for every member, bidder and caller, with a filter per profile |
| Member | Resume Tailor (first page after sign-in), Applying Management, Interview Schedule, Dashboard and Team — for their own profile |
| Bidder | Applying Management only, just the jobs their member assigned to them |
| Caller | Interview Schedule only, just the interviews their member assigned to them (can add interview results) |

A **member** owns exactly one profile (their resume tailor profile) and a **team** of bidders and callers. Each bidder
and caller belongs to one member (`users.member_id`) and works only on that member's profile. Members manage their own
team on the **Team** page; administrators manage every member and team in Administrator → Users.

On the Team page the member also **assigns work**: *Ready to Apply* jobs to a bidder, *Scheduled* interviews to a caller
(`jobs.assigned_bidder_id` / `assigned_caller_id`). Bidders and callers see and work on only their assigned jobs. A job
can be reassigned while it is still Ready to Apply / Scheduled, even after someone worked on it; once it is applied
(bidder) or offered / rejected (caller) the assignment is final.

A member with exactly **one active bidder** (or caller) needs no choosing: every Ready to Apply job (or Scheduled
interview) goes to that person automatically — when jobs are generated, retried or scheduled, and when the team changes
(e.g. a bidder is deleted and one remains).

Applying Management and Interview Schedule show a **profile card** instead of a profile filter (each member, bidder and
caller works on exactly one profile): the profile's name, label and headline, its contact details (one click copies each,
for application forms) and how many jobs are at each step. Members can also filter Applying Management by **bidder**
and Interview Schedule by **caller** (or show only the unassigned jobs).

## How a job flows

1. **Resume Tailor** — a member pastes job links. For each link the posting is read (job-board APIs, the page, or
   Chrome/Edge for script-heavy pages), the AI writes the resume and cover letter from the member's profile, and the
   content is saved (PDFs are built in the template's style when downloaded). A page that cannot be read asks for a pasted description.
2. **Duplicates are skipped before any AI tokens are spent**: a link already registered, or a company registered
   within the cooldown (30 days by default). Scope and cooldown: Administrator → Settings.
3. **Applying Management** — every generated package is a *Ready to Apply* job. Bidders download the resume /
   cover letter (built on download), apply, and drop or paste the confirmation screenshot → *Applied*.
4. **Interview Schedule** — members fill in the interview details (→ *Scheduled*). Once the interview has ended it
   shows as *Needs Result* until the caller (or member) adds the result → *Interviewed*; then Offered → Rejected.
   Rescheduling an Interviewed job (new date/time) starts the next round: the finished round's result is kept under
   *Previous rounds* (`interview_rounds`) and the new round needs its own result. Every new result counts as one
   interview held and as work of the user who wrote it; editing a result does not.

**Clear** on the Resume Tailor only empties the board; generated jobs stay in Applying Management.

## Sign-in

Sessions (website cookie) and extension tokens last 7 days. Each one is tied to the password it was created with:
changing a user's password (Team page, Administrator → Users, or `ADMIN_PASSWORD` with `db:init`) signs out all of that
user's sessions and extensions, and deactivating a user takes effect on their next request.

After 8 failed sign-ins for one user ID within 15 minutes, that ID is refused until the window passes. One client
address is also limited to 40 failures, but only where the address can be trusted: on Vercel, or with `TRUST_PROXY=true`
behind a proxy that sets `X-Forwarded-For` itself. Failures are kept in the database, so the limit holds on every
instance.

API errors always have the shape `{ "ok": false, "error": "<message>" }` with a matching HTTP status.

## Data

One database: `users` (accounts + tailor profiles), `jobs` (tailoring, applying and interview data for every link),
`interview_rounds` (earlier interview rounds of a job), `job_links` (links sent by the job-finding bot),
`stored_files` (applied screenshots, uploaded templates), `settings`, `audit_logs`, `login_failures` (failed sign-ins of the
last 15 minutes), `gmail_accounts` (connected profile Gmails), `gmail_messages` (emails already analyzed),
`gmail_check_runs` (each finished Gmail check), `gmail_notices` (who saw the daily check notice) and `schema_migrations`.

Generation saves the AI's resume and cover letter content in `jobs.tailored`, along with the job description, stack, and company URL used to write them.
The resume PDF, cover letter PDF, package ZIP and **Download all** ZIP are built when they are downloaded, with the
templates current at that moment, so a new template also applies to jobs generated earlier.

## Gmail interview requests

Companies answer applications at the profile's Gmail (the email in the member's profile). Once every 24 hours a check
reads each connected profile Gmail and finds the emails that ask to **schedule an interview**:

1. Gmail API: every email received since the last check (the first check: the last `GMAIL_FIRST_SYNC_DAYS`, 14 days by
   default), except sent mail, drafts, chats, spam and trash.
2. Each new email (subject, sender, received time, body) is sent to the AI (`LLM_PROVIDER`, e.g. DeepSeek) with
   `prompts/DEFAULT_PROMPT_ANALYZE_EMAIL.md`, which returns the kind of email, the company, the job title, and whether
   (and how surely) it is an interview scheduling email. Every other kind of email is skipped. Each email is analyzed
   only once (`gmail_messages`).
3. The company and title (and the sender's domain, and a job reference found in a job link) are matched to the profile's
   jobs. The job gets `interview_requested`, the email's link and received time (`jobs.interview_request_*`).
4. In **Interview Schedule** the job shows **Request Schedule** (click it to open the email) while the interview is
   not scheduled yet; those jobs come first, newest email first (also the *Request schedule* view). Scheduling the
   interview fills its Email field with the email's link.
5. **Daily notice**: after the day's check, every user gets a *Daily Gmail check* notice (bottom right) the first time
   they open the site: emails read, interview requests found (with company and job), matches, and each inbox's status
   or error. It stays on every page until closed; a later sign-in that day does not show it again. Administrators and
   bosses see every profile Gmail; members, bidders and callers only their own profile's Gmail. Each check is kept in
   `gmail_check_runs`; who saw the notice in `gmail_notices`.

**Connecting** (Administrator → **Gmail**): the administrator clicks *Connect* for a member, signs in on Google's page to
that profile's Gmail account and allows reading email (`gmail.readonly`, the only permission asked for). The signed-in
account must be the profile's Gmail. When the member changes the profile's email, the tab asks to connect again. The
refresh token is stored encrypted with `SESSION_SECRET` (a new `SESSION_SECRET` means connecting again).
*Check now* runs the check at once. Administrator → Users shows each member's connection status (Connected, Not connected, Reconnect, Error).

**Google Cloud console**: the OAuth client's *Authorized redirect URIs* must list `<site>/api/gmail/callback` for each
address the site runs at (the Gmail tab shows the one for the current address). `GOOGLE_GMAIL_REDIRECT_URI` is that
path (`/api/gmail/callback`, the default); the site's address is taken from each request (`X-Forwarded-Host` /
`X-Forwarded-Proto` behind a proxy such as Vercel), so one setting works locally and on Vercel. While the app's *Audience* is in
*Testing*, every profile Gmail must be added as a test user, and Google ends the access after 7 days (the tab then shows
an error and asks to reconnect); publish the app (*In production*) to keep access.

**When it runs**: on Vercel, Vercel Cron calls `GET /api/cron/sync` once a day (`vercel.json`; set `CRON_SECRET`, which
Vercel sends with the call). A long-running server (`npm run dev`, `npm run start:all`) runs the check itself: a few
minutes after it starts and then hourly, each time only for inboxes not checked in the last 23 hours. A check that runs
out of time continues at the next one.

## Templates and prompts

- `templates/Resume-Template.pdf`, `templates/Coverletter-Template.pdf` — the design of generated documents. Upload a
  new PDF in Administrator → Templates; its style is read from the PDF (no AI) and applies to every download from then on.
- `prompts/DEFAULT_PROMPT_SYSTEM.md`, `prompts/DEFAULT_PROMPT_USER.md` — the tailoring prompts, read for every link
  (placeholders such as `{{baseResumeText}}`, `{{jobDescription}}`, `{{companyName}}`). On hosts without the files,
  set `PROMPT_SYSTEM_TEXT` / `PROMPT_USER_TEXT` instead.
- `prompts/DEFAULT_PROMPT_ANALYZE_EMAIL.md` — the email analysis for Gmail interview requests (placeholders such as
  `{{subject}}`, `{{fromEmail}}`, `{{body}}`). Override with `ANALYZE_EMAIL_PROMPT` or `ANALYZE_EMAIL_PROMPT_TEXT`.
- `prompts/DEFAULT_ANSWERS_PROMPT_SYSTEM.md`, `prompts/DEFAULT_ANSWERS_PROMPT_USER.md` — the screening-question prompts
  for the extension. Override them with `ANSWERS_PROMPT_SYSTEM` / `ANSWERS_PROMPT_USER`, or with the `_TEXT` variants.
- `fonts/` — free fonts with the same letter widths as Calibri, Cambria, Arial, Times New Roman, Courier New and Georgia,
  used where those fonts are not installed (SIL Open Font License).

## Job links API (for the job-finding bot)

`POST /api/job-links` takes a text with job links and saves every link to the `job_links` table (`id`, `job_link`,
`created_at`); a link that is already there is skipped. The bot signs in with `JOB_LINKS_API_KEY` from `.env`.

```bash
curl -X POST https://<your-site>/api/job-links \
  -H "Authorization: Bearer <JOB_LINKS_API_KEY>" -H "Content-Type: text/plain" \
  --data-binary $'Found today:\nhttps://a.com/jobs/1\nhttps://b.com/jobs/2'
```

The body can also be JSON: `{ "text": "..." }` or `{ "links": ["https://...", ...] }` (the key may be sent as
`X-API-Key` instead). Answer (counts only): `{ ok, received, saved, skipped }` —
201 when something new was saved, 200 when everything was a duplicate, 401 for a wrong key.

On the Resume Tailor, **Get from DB** puts these links into the Job URLs box (one per line, added to what is there),
leaving out links already registered — on the member's profile, or for anyone when the duplicate scope is "all
profiles" — so generating does not spend tokens on them. It is disabled while a batch is generating.

Administrator → **Bot links** lists the `job_links` table: search, add links by pasting a text, delete selected links or
all of them; the *Tailored* column shows how many profiles already have a job with that exact link.

## Extension API (auto-apply)

A member signs in with `POST /api/extension/session` (`username` or `userId`, plus `password`) and then sends
`Authorization: Bearer <token>`. Other roles get no token. `GET /api/extension/sync` returns the profile, counts, and
jobs, up to 1000 at a time: when `nextOffset` is not null, ask again with `?offset=<nextOffset>` (`?limit=` 1–1000).
For one job: `GET .../resume`, `GET .../cover-letter`, `POST .../applied-image`, `POST .../failed` with
`{ "reason" }`, and `POST .../answers` with `{ "questions" }`.

## Backup and restore

Administrator → **Backup** downloads the whole database as one `jms-backup-<date>.json.gz` file (every table, including
screenshots and uploaded templates) and restores such a file. Restoring replaces every table in one transaction — an
error leaves the database as it was — and is refused for a file without an active administrator. It works on Vercel
too (no `pg_dump` needed); there a request can carry at most about 4.5 MB, so very large backups restore locally
(`npm run dev` with `DATABASE_URL` pointing at the hosted database).

## Hosting on Vercel

1. Push the project to a GitHub repository (`.env` is never committed) and import it in Vercel (Add New → Project).
2. In the Vercel project: **Storage → Create Database → Neon** and connect it. Vercel sets `DATABASE_URL` (and
   `DATABASE_URL_UNPOOLED`) for you; SSL is turned on automatically by the `sslmode=require` in the URL.
3. **Settings → Environment Variables**: add the rest of `.env` — `SESSION_SECRET` (a new long random string),
   `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `LLM_PROVIDER`, the AI key and model, `PROMPT_SYSTEM`, `PROMPT_USER`,
   `LINKS_AT_ONCE`, `JOB_LINKS_API_KEY`, and for Gmail `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CRON_SECRET`.
   Not needed there: `DB_*`, `DATABASE_SSL`, `CHROME_PATH`.
4. Deploy. Every build runs `npm run vercel-build`: `db:init` (creates or upgrades the schema and the administrator in
   the Neon database), then `next build`. Add demo users if you want them: run `npm run db:demo` locally with
   `DATABASE_URL` set to the Neon URL.

On Vercel a batch runs in pieces while the Resume Tailor page is open (`LINKS_AT_ONCE` at a time); the fonts,
default templates, prompts and the serverless Chromium are bundled with the API (see `next.config.ts`).
