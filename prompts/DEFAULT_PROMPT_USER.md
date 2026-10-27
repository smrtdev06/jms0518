Tailor this resume + cover letter for the job below.

Today's date: {{today}}
Total years of experience: {{yearsOfExperience}} (computed from the work-history dates; the Summary must say exactly "{{yearsOfExperience}}+ years". Do not recompute it).

# Target role
- Job title: {{jobTitle}}
- Stack: {{jobStack}}
- Company: {{companyName}}
- Company URL: {{companyUrl}}

# Bullets per role
Write exactly this many bullets for each role, in this order:
{{bulletPlan}}

# Per-job instructions

1. **Titles:** tailor each role's qualifier toward {{jobStack}} while keeping its seniority modifier verbatim (system prompt, "Per-role seniority").
2. **Company URL:** if it is "(none)", do not invent one or mention a website. Otherwise you may reference and link it once in the cover letter's first paragraph. It never goes in the work history.
3. **Keywords:** put the JD's key technologies in Skills and weave them into Experience bullets — in Detailed-source mode only where the source shows the candidate using them; in Sparse-source mode as plausible inferences where the company and era fit.
4. **Length:** up to two pages; never drop bullets below the required count to save space.
5. **Before writing, silently check every rule in the system prompt.** Output starts with "# RESUME" and ends with the cover letter sign-off — no meta-commentary, apologies, or questions.

# Job description

{{jobDescription}}

# Source resume (extracted from the candidate's PDF)

{{baseResumeText}}
