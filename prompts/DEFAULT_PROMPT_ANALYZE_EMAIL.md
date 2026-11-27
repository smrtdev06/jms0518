You analyze one email from the Gmail inbox of a job seeker. The job seeker applies to many jobs, so the inbox holds
replies from companies, recruiters, applicant-tracking systems (Workday, Greenhouse, Lever, iCIMS, Ashby, ...),
job boards (LinkedIn, Indeed, ...) and unrelated mail. Your most important task is to decide whether this email is an
**interview scheduling email**. You also extract the company and the job it is about.

Reply with ONE JSON object and nothing else (no Markdown, no code fence, no comments).

# What counts as an interview scheduling email

Set `"is_interview_scheduling": true` when a company or recruiter, about a job the candidate applied to or is being
considered for, does one of these:

- asks the candidate to schedule, book or pick a time for an interview, phone screen, recruiter call, technical
  interview, video call, onsite or "chat" (also "share your availability", "when are you free", "let's set up a call");
- sends a scheduling link (Calendly, GoodTime, Google Calendar booking page, ATS self-scheduling, ...) for such a talk;
- proposes specific dates or times for such a talk;
- invites the candidate to, confirms, or reschedules an interview that has a date and time.

Set it to `false` for everything else, even when it is about a job, for example:

- "we received your application" / "thank you for applying" acknowledgements;
- rejections ("we decided to move forward with other candidates"), offers, and status updates without a call to set
  up an interview;
- online assessments, coding tests, questionnaires or video recordings that are NOT a live conversation, unless the
  email also asks to schedule an interview;
- job alerts, "jobs you may like", "similar jobs", "your application was viewed", newsletters, marketing;
- recruiter cold outreach about a new job, unless it asks to schedule a call;
- emails the candidate wrote, verification codes, account notices, receipts, personal mail.

`interview_scheduling_confidence` is 0-100: how sure you are that this email asks for, or sets, an interview time with
a real company. Use 90+ only when the email clearly does so.

# Fields

- `category`: exactly one of `interview_scheduling`, `application_received`, `rejection`, `offer`, `assessment`,
  `job_alert`, `recruiter_outreach`, `application_update`, `other`.
- `company_name`: the hiring company (the employer), NOT the ATS, job board or staffing tool. Example: an email from
  `no-reply@myworkday.com` about "Software Engineer at Acme Corp" → `Acme Corp`. For an agency recruiter writing about
  a client, use the client company when the email names it, otherwise the agency. Empty string when unknown.
- `job_title`: the job title the email is about, as written. Empty string when unknown.
- `job_reference`: a requisition / job ID or job posting link from the email, if any (e.g. `JR101148`). Else "".
- `sender_role`: `recruiter`, `hiring_manager`, `ats_system`, `job_board`, `scheduler`, `candidate`, or `other`.
- `interview_type`: for an interview scheduling email, e.g. `phone screen`, `recruiter call`, `technical interview`,
  `onsite`, `video interview`; else "".
- `proposed_times`: the dates/times offered or set, as written in the email (keep the time zone), else `[]`.
- `scheduling_link`: the link to book the interview, if any, else "".
- `summary`: one short sentence about what the email asks the candidate to do.

# Output shape

{
  "category": "interview_scheduling",
  "is_interview_scheduling": true,
  "interview_scheduling_confidence": 95,
  "company_name": "Acme Corp",
  "job_title": "Senior Software Engineer",
  "job_reference": "JR101148",
  "sender_role": "recruiter",
  "interview_type": "phone screen",
  "proposed_times": ["Tuesday, March 3, 2:00 PM ET"],
  "scheduling_link": "https://calendly.com/acme-recruiting/30min",
  "summary": "The recruiter asks the candidate to book a 30-minute phone screen."
}

Base everything only on the email below. Never invent a company, job title, time or link that is not in the email.

# The candidate

Name: {{candidateName}}
Email: {{candidateEmail}}
Today: {{today}}

# The email

From: {{fromName}} <{{fromEmail}}>
To: {{to}}
Received: {{receivedAt}}
Subject: {{subject}}

{{body}}
