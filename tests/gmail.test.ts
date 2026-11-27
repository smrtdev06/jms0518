import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bodyText, htmlToText, parseAddress, readMessage, type GmailMessage } from "../src/lib/gmail/message.ts";
import { isInterviewRequest, parseAnalysis } from "../src/lib/gmail/analysis.ts";
import { fillPrompt } from "../src/lib/tailor/prompt-source.ts";
import { linkLabels, matchJob, senderLabels, type CandidateJob } from "../src/lib/gmail/match.ts";
import { gmailLink, sameMailbox } from "../src/lib/gmail/mailbox.ts";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

describe("readMessage", () => {
  it("reads the headers, received time and the plain text part", () => {
    const message: GmailMessage = {
      id: "18c1",
      internalDate: "1764201600000",
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "From", value: '"Jane Recruiter" <Jane@Acme.com>' },
          { name: "Subject", value: "Interview availability" },
          { name: "To", value: "cody@gmail.com" },
        ],
        parts: [
          { mimeType: "text/plain", body: { data: b64("Hi Cody,\r\n\r\nCan you share your availability?") } },
          { mimeType: "text/html", body: { data: b64("<p>ignored</p>") } },
        ],
      },
    };
    const email = readMessage(message);
    assert.equal(email.fromName, "Jane Recruiter");
    assert.equal(email.fromEmail, "jane@acme.com");
    assert.equal(email.subject, "Interview availability");
    assert.equal(email.receivedAt.toISOString(), "2025-11-27T00:00:00.000Z");
    assert.equal(email.body, "Hi Cody,\n\nCan you share your availability?");
  });

  it("falls back to the HTML part, keeping link targets, and skips attachments", () => {
    const text = bodyText({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/html", body: { data: b64('<style>p{}</style><p>Book a time&nbsp;<a href="https://calendly.com/acme/30">here</a></p><br>Thanks') } },
        { mimeType: "text/plain", filename: "resume.txt", body: { data: b64("attachment text") } },
      ],
    });
    assert.equal(text, "Book a time here (https://calendly.com/acme/30)\n\nThanks");
  });

  it("cuts very long bodies", () => {
    const email = readMessage({ id: "x", payload: { mimeType: "text/plain", body: { data: b64("a".repeat(10_000)) } } });
    assert.ok(email.body.length < 6100);
    assert.match(email.body, /cut\]$/);
  });

  it("parses addresses with and without a name", () => {
    assert.deepEqual(parseAddress("no-reply@myworkday.com"), { name: "", email: "no-reply@myworkday.com" });
    assert.deepEqual(parseAddress("Acme Talent <talent@acme.com>"), { name: "Acme Talent", email: "talent@acme.com" });
  });

  it("decodes entities in HTML", () => {
    assert.equal(htmlToText("Tom &amp; Jerry&#39;s &rsquo;").trim(), "Tom & Jerry's '");
  });

  it("links to the message in the right Gmail account", () => {
    assert.equal(gmailLink("a.b@gmail.com", "18c1"), "https://mail.google.com/mail/?authuser=a.b%40gmail.com#all/18c1");
  });
});

describe("parseAnalysis", () => {
  it("reads a JSON reply, even inside a code fence", () => {
    const a = parseAnalysis('```json\n{"category":"interview_scheduling","is_interview_scheduling":true,"interview_scheduling_confidence":92,"company_name":"Acme","job_title":"SWE","proposed_times":["Mon 2pm"]}\n```');
    assert.ok(a);
    assert.equal(a.company_name, "Acme");
    assert.deepEqual(a.proposed_times, ["Mon 2pm"]);
    assert.equal(isInterviewRequest(a), true);
  });

  it("rejects text that is not JSON and repairs unknown categories", () => {
    assert.equal(parseAnalysis("not json"), null);
    const a = parseAnalysis('{"category":"spam","is_interview_scheduling":false}');
    assert.equal(a?.category, "other");
    assert.equal(a && isInterviewRequest(a), false);
  });

  it("does not count unsure interview flags", () => {
    const a = parseAnalysis('{"category":"interview_scheduling","is_interview_scheduling":true,"interview_scheduling_confidence":40}');
    assert.equal(a && isInterviewRequest(a), false);
  });

  it("fills the prompt in one pass, leaving placeholders inside the email alone", () => {
    assert.equal(fillPrompt("To {{name}}: {{body}}", { name: "Cody", body: "see {{name}}" }), "To Cody: see {{name}}");
    assert.equal(fillPrompt("{{constructor}} {{toString}}", {}), "{{constructor}} {{toString}}");
  });
});

const job = (id: number, company: string, title: string, link: string, apply = "applied", applied = "2026-11-01"): CandidateJob => ({
  id,
  company_name: company,
  job_title: title,
  job_link: link,
  apply_status: apply,
  applied_at: applied,
});

const JOBS = [
  job(1, "Re:Car, Inc", "Frontend SDE II", "https://recar.wd108.myworkdayjobs.com/SLATEcareers/job/Remote/Frontend-SDE-II_JR101148"),
  job(2, "UHC E&I SOFTWARE DEVELOPMENT", "Software Engineer", "https://careers.unitedhealthgroup.com/job/34088/103572556288"),
  job(3, "Fair Isaac Corporation", "Senior Java Engineer", "https://fico.wd1.myworkdayjobs.com/External/job/Senior-Engineer_32206"),
  job(4, "Fair Isaac Corporation", "Data Engineer", "https://fico.wd1.myworkdayjobs.com/External/job/Data-Engineer_1"),
  job(5, "Company", "Staff Forward Deployed Engineer, Platform", "https://recruiting.paylocity.com/Recruiting/Jobs/Details/4615988"),
  job(6, "Acme", "Backend Engineer", "https://boards.greenhouse.io/acme/jobs/1", "ready"),
];

describe("matchJob", () => {
  it("matches the company name regardless of suffixes and punctuation", () => {
    const m = matchJob(JOBS, { companyName: "Re:Car", jobTitle: "Frontend Software Development Engineer II", fromEmail: "no-reply@myworkday.com" });
    assert.equal(m?.job.id, 1);
  });

  it("uses the job title to choose between jobs at the same company", () => {
    const m = matchJob(JOBS, { companyName: "FICO (Fair Isaac Corporation)", jobTitle: "Sr. Java Engineer", fromEmail: "talent@fico.com" });
    assert.equal(m?.job.id, 3);
  });

  it("uses the sender's domain when the AI's company name differs", () => {
    const m = matchJob(JOBS, { companyName: "FICO", jobTitle: "Data Engineer", fromEmail: "recruiting@fico.com" });
    assert.equal(m?.job.id, 4);
  });

  it("finds a short company name in the job link (FICO for Fair Isaac) when the sender is an ATS", () => {
    const m = matchJob(JOBS, { companyName: "FICO", jobTitle: "Sr. Java Engineer", fromEmail: "no-reply@us.greenhouse-mail.io" });
    assert.equal(m?.job.id, 3);
  });

  it("uses a job reference found in the link", () => {
    const m = matchJob(JOBS, { companyName: "Unknown Staffing", jobTitle: "", jobReference: "JR101148", fromEmail: "x@staffing.io" });
    assert.equal(m?.job.id, 1);
  });

  it("matches jobs that were not marked applied too, but prefers applied ones", () => {
    assert.equal(matchJob(JOBS, { companyName: "Acme Inc.", jobTitle: "Backend Engineer", fromEmail: "jane@gmail.com" })?.job.id, 6);
  });

  it("finds nothing for an unknown company or a placeholder name", () => {
    assert.equal(matchJob(JOBS, { companyName: "Globex", jobTitle: "Software Engineer", fromEmail: "hr@globex.com" }), null);
    assert.equal(matchJob(JOBS, { companyName: "Company", jobTitle: "Staff Forward Deployed Engineer", fromEmail: "no-reply@paylocity.com" }), null);
  });

  it("ignores shared sender domains and reads the employer from job links", () => {
    assert.deepEqual(senderLabels("no-reply@us.greenhouse-mail.io"), []);
    assert.deepEqual(senderLabels("jane@talent.acme-corp.com"), ["acmecorp"]);
    assert.deepEqual(linkLabels("https://recar.wd108.myworkdayjobs.com/x"), ["recar"]);
    assert.deepEqual(linkLabels("https://jobs.lever.co/acme/123"), ["acme"]);
  });
});

describe("sameMailbox", () => {
  it("ignores dots, +tags and case in gmail.com addresses only", () => {
    assert.equal(sameMailbox("F.Cody+jobs@gmail.com", "fcody@googlemail.com"), true);
    assert.equal(sameMailbox("f.cody@acme.com", "fcody@acme.com"), false);
  });
});

describe("site address", () => {
  it("builds the redirect URI from a path and the address the site is visited at", async () => {
    const { siteOrigin, siteUrl } = await import("../src/lib/site-url.ts");
    const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
    assert.equal(siteOrigin(h({ host: "localhost:3000" })), "http://localhost:3000");
    assert.equal(siteOrigin(h({ host: "internal:8080", "x-forwarded-host": "jms0518.vercel.app", "x-forwarded-proto": "https" })), "https://jms0518.vercel.app");
    assert.equal(siteOrigin(h({ host: "jms0518.vercel.app" })), "https://jms0518.vercel.app");
    assert.equal(siteUrl("/api/gmail/callback", "http://localhost:3000"), "http://localhost:3000/api/gmail/callback");
    assert.equal(siteUrl("/api/gmail/callback", "https://jms0518.vercel.app"), "https://jms0518.vercel.app/api/gmail/callback");
  });
});

describe("daily notice", () => {
  it("adds up the day's checks per inbox, keeps the last status, and limits to the user's profiles", async () => {
    const { mergeDay } = await import("../src/lib/gmail/notice-data.ts");
    const rep = (memberId: number, status: "done" | "partial" | "error", checked: number, requests: number, error?: string) => ({
      memberId, email: `m${memberId}@gmail.com`, status, checked, requests, matched: requests, unmatched: 0, left: 0, failed: 0, error, at: "",
    });
    const runs = [
      { finished_at: "2026-11-26T12:00:00Z", reports: [rep(1, "done", 50, 3)] },
      { finished_at: "2026-11-27T12:00:00Z", reports: [rep(1, "partial", 10, 1), rep(2, "error", 0, 0, "Reconnect it.")] },
      { finished_at: "2026-11-27T12:01:30Z", reports: [rep(1, "done", 5, 1)] },
    ];
    const all = mergeDay(runs, null)!;
    assert.equal(all.day, "2026-11-27");
    assert.deepEqual(all.totals, { inboxes: 2, checked: 15, requests: 2, matched: 2, unmatched: 0, problems: 1 });
    assert.equal(all.accounts.find((a) => a.memberId === 1)?.status, "done");
    const own = mergeDay(runs, [2])!;
    assert.equal(own.accounts.length, 1);
    assert.equal(own.accounts[0].error, "Reconnect it.");
    // A profile not checked on the latest day gets its own latest day.
    assert.equal(mergeDay([runs[0], { finished_at: "2026-11-27T12:00:00Z", reports: [rep(2, "done", 1, 0)] }], [1])?.day, "2026-11-26");
    assert.equal(mergeDay(runs, [9]), null);
  });
});
