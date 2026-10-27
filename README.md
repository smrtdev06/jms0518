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
| `npm run db:init` | Create/upgrade the schema and the administrator |

Plain SQL alternative: `db/job_management.sql` (schema + administrator).

## Roles

| Role | Sees |
|---|---|
| Administrator | Administrator only: users (members, their bidders and callers, bosses), job links, templates, activity log, settings |
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
4. **Interview Schedule** — members fill in the interview details (→ *Scheduled*), then Offered → Rejected.
   Callers see the schedule and details.

**Clear** on the Resume Tailor only empties the board; generated jobs stay in Applying Management.

## Data

One database: `users` (accounts + tailor profiles), `jobs` (tailoring, applying and interview data for every link),
`stored_files` (applied screenshots, uploaded templates), `settings`, `audit_logs`.

Generation saves only the AI's resume and cover letter content (`jobs.tailored`, plus the raw reply in `jobs.ai_reply`).
The resume PDF, cover letter PDF, package ZIP and **Download all** ZIP are built when they are downloaded, with the
templates current at that moment, so a new template also applies to jobs generated earlier.

## Templates and prompts

- `templates/Resume-Template.pdf`, `templates/Coverletter-Template.pdf` — the design of generated documents. Upload a
  new PDF in Administrator → Templates; its style is read from the PDF (no AI) and applies to every download from then on.
- `prompts/DEFAULT_PROMPT_SYSTEM.md`, `prompts/DEFAULT_PROMPT_USER.md` — the tailoring prompts, read for every link
  (placeholders such as `{{baseResumeText}}`, `{{jobDescription}}`, `{{companyName}}`). On hosts without the files,
  set `PROMPT_SYSTEM_TEXT` / `PROMPT_USER_TEXT` instead.
- `fonts/` — free fonts with the same letter widths as Calibri, Cambria, Arial, Times New Roman, Courier New and Georgia,
  used where those fonts are not installed (SIL Open Font License).

## Hosting on Vercel

1. Push the project to a GitHub repository (`.env` is never committed) and import it in Vercel (Add New → Project).
2. In the Vercel project: **Storage → Create Database → Neon** and connect it. Vercel sets `DATABASE_URL` (and
   `DATABASE_URL_UNPOOLED`) for you; SSL is turned on automatically by the `sslmode=require` in the URL.
3. **Settings → Environment Variables**: add the rest of `.env` — `SESSION_SECRET` (a new long random string),
   `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `LLM_PROVIDER`, the AI key and model, `PROMPT_SYSTEM`, `PROMPT_USER`,
   `LINKS_AT_ONCE`. Not needed there: `DB_*`, `DATABASE_SSL`, `CHROME_PATH`.
4. Deploy. Every build runs `npm run vercel-build`: `db:init` (creates or upgrades the schema and the administrator in
   the Neon database), then `next build`. Add demo users if you want them: run `npm run db:demo` locally with
   `DATABASE_URL` set to the Neon URL.

On Vercel a batch runs in pieces while the Resume Tailor page is open (`LINKS_AT_ONCE` at a time); the fonts,
default templates, prompts and the serverless Chromium are bundled with the API (see `next.config.ts`).
