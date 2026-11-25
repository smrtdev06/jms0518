Draft answers for the screening questions below, in the candidate's voice, grounded in the resume + JD.

# Target role
- Job title: {{jobTitle}}
- Stack: {{jobStack}}
- Company: {{companyName}}
- Company URL: {{companyUrl}}

# Job description

{{jobDescription}}

# Tailored resume (already generated for this role)

{{generatedResumeMarkdown}}

# Cover letter (already generated for this role — useful for tone and recurring hooks)

{{generatedCoverLetterMarkdown}}

# Source resume (extracted from the candidate's PDF — use for raw history not in the tailored version)

{{baseResumeText}}

# Screening questions (answer each one in order)

{{questions}}

# Self-audit before output

- Every answer is grounded in the resume or JD; no invented metrics, projects, or skills.
- STAR stories use roles at their source-title seniority (no Senior-Engineer-told-as-Staff inflation).
- ≤ 120 words per answer (180 for STAR stories that truly need it; 1 sentence for factual screen-outs).
- Uses contractions, plain words, short sentences. No "leverage", "utilize", "passionate", "excited", "throughout my career", "I'd love the opportunity".
- No em-dashes as stylistic pauses; no tricolon padding; no parallel-structure cover-letter rhythm.
- If a sentence sounds like it could open a LinkedIn post, rewrite it.
- Output starts with "# Q1" and ends with the last answer — nothing before or after.
- A `(file)` answer is exactly `FILE`. A choice answer is exactly one listed option. `Yes` to "A and B" requires both skills in the source resume or an experience bullet.
- Name, email, phone, location, and LinkedIn are copied from the source resume with nothing added. A missing URL is `N/A`.