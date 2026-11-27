import { HttpError } from "@/lib/errors";
import { query } from "@/lib/db";
import { careerYears, shapeAnswers } from "./answer-fields";
import { loadAnswerPrompts } from "./answers-prompt";
import { readProvider, scrub } from "./api-key";
import { byRecency } from "./base-resume";
import { condenseJobText } from "./job-text";
import { generateAnswers, GenerationError } from "./openai";
import { loadSnapshot, type PackageSnapshot } from "./pack";
import { loadProfile } from "./profile";
import { buildTargetJob } from "./target-job";

const MAX_QUESTIONS = 40;

// Writes screening answers for one generated job. The extension sends the questions; everything else
// comes from the saved resume, the member's source resume, and the job description kept at tailoring time.
export async function answerScreeningQuestions(userId: number, jobId: number, questions: unknown, signal?: AbortSignal) {
  const snapshot = await loadSnapshot(jobId, userId);
  if (!snapshot) throw new HttpError(404, "This job has no resume yet");
  const profile = await loadProfile(userId);
  if (!profile?.baseResumeText.trim()) throw new HttpError(409, "Save the profile before answering screening questions");

  const questionsText = questionBlock(questions);
  const posting = await jobPosting(jobId, snapshot);
  const provider = readProvider();
  if (!provider.apiKey) throw new HttpError(503, `Set ${provider.keyName} in the environment before answering questions.`);

  const prompts = await loadAnswerPrompts({
    jobTitle: snapshot.jobTitle,
    jobStack: posting.jobStack,
    companyName: snapshot.company,
    companyUrl: posting.companyUrl,
    jobDescription: posting.jobDescription,
    generatedResumeMarkdown: resumeMarkdown(snapshot),
    generatedCoverLetterMarkdown: snapshot.content.coverLetter.filter(Boolean).join("\n\n"),
    baseResumeText: profile.baseResumeText,
    questions: questionsText,
  });

  try {
    const generated = await generateAnswers({ apiKey: provider.apiKey, system: prompts.system, user: prompts.user, signal });
    const evidence = experienceEvidence(snapshot, profile.baseResumeText);
    const facts = {
      fullName: profile.fullName,
      phone: profile.phone,
      email: profile.email,
      address: profile.address,
      linkedin: profile.linkedin,
      company: byRecency(profile.experiences).find((item) => item.companyName?.trim())?.companyName || "",
      years: careerYears(profile.experiences),
    };
    return { ok: true as const, answers: shapeAnswers(generated.text, questionsText, facts, evidence) };
  } catch (error) {
    if (error instanceof GenerationError) throw new HttpError(502, scrub(error.message));
    throw error;
  }
}

function questionBlock(questions: unknown) {
  if (Array.isArray(questions)) {
    const items = questions.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, MAX_QUESTIONS);
    if (!items.length) throw new HttpError(400, "Send the screening questions");
    if (items.some((item) => item.length > 2000)) throw new HttpError(400, "Each question must be 2000 characters or fewer");
    return items.map((item, index) => `${index + 1}. ${item}`).join("\n\n");
  }
  const text = String(questions ?? "").trim().slice(0, 20000);
  if (text.length < 3) throw new HttpError(400, "Send the screening questions");
  return text;
}

// Jobs tailored before the description was stored are read once from the posting, then saved on the job.
async function jobPosting(jobId: number, snapshot: PackageSnapshot) {
  const saved = snapshot.jobDescription?.trim() || "";
  if (saved) {
    const target = buildTargetJob({
      company: snapshot.company,
      title: snapshot.jobTitle,
      text: saved,
      companyUrl: snapshot.companyUrl,
    });
    return {
      jobDescription: saved,
      jobStack: snapshot.jobStack?.trim() || target.jobStack,
      companyUrl: snapshot.companyUrl?.trim() || target.companyUrl,
    };
  }

  const { fetchJob } = await import("./fetch-job");
  const fetched = await fetchJob(snapshot.jobUrl);
  const text = condenseJobText(fetched.ok ? fetched.text : "");
  if (!fetched.ok || text.split(/\s+/).length < 40) {
    throw new HttpError(409, "The job description was not saved with this resume, and the posting could not be read again.");
  }
  const target = buildTargetJob({
    company: snapshot.company || fetched.company,
    title: snapshot.jobTitle || fetched.title,
    text,
    companyUrl: fetched.companyUrl,
  });
  await query(
    `UPDATE jobs SET tailored = COALESCE(tailored, '{}'::jsonb) || $2::jsonb, updated_at = now() WHERE id = $1`,
    [jobId, JSON.stringify({ jobDescription: target.jobDescription, jobStack: target.jobStack, companyUrl: target.companyUrl })],
  );
  return { jobDescription: target.jobDescription, jobStack: target.jobStack, companyUrl: target.companyUrl };
}

function resumeMarkdown(snapshot: PackageSnapshot) {
  const { profile, content } = snapshot;
  const contact = [profile.email, profile.phone, profile.address].filter(Boolean).join(", ");
  const summary = emphasize(content.summary.join(" "), content.summaryBold);
  const skills = content.skills.map((skill) => `- **${skill.category}**: ${skill.items.join(", ")}`).join("\n");
  const roles = content.roles
    .map((role, index) => {
      const experience = profile.experiences[index];
      const title = experience?.jobTitle || "Role";
      const company = experience?.companyName || "";
      const dates = experience ? `${experience.startDate} – ${experience.endDate}` : "";
      const heading = `### ${title}${company ? ` — ${company}` : ""}${dates ? ` · ${dates}` : ""}`;
      const overview = (role.overview || "").trim();
      const bullets = role.bullets.map((bullet) => `- ${emphasize(bullet.text, bullet.boldPhrases)}`).join("\n");
      return [heading, overview, bullets].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
  const education = profile.education
    .map((item) => `### ${item.degree} — ${item.universityName} · ${item.startDate} – ${item.endDate}`)
    .join("\n");
  return [`# ${profile.fullName}`, contact, "## Summary", summary, "## Skills", skills, "## Experience", roles, "## Education", education]
    .filter((part) => part.trim())
    .join("\n\n");
}

function experienceEvidence(snapshot: PackageSnapshot, baseResumeText: string) {
  const lines = snapshot.content.roles.flatMap((role) => [role.overview || "", ...role.bullets.map((bullet) => bullet.text)]);
  return `${baseResumeText}\n${lines.join("\n")}`;
}

function emphasize(text: string, phrases: string[] | undefined) {
  let result = text;
  for (const phrase of phrases || []) {
    const clean = phrase.trim();
    if (clean.length < 2) continue;
    const pattern = new RegExp(clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    result = result.replace(pattern, (match) => (match.startsWith("**") ? match : `**${match}**`));
  }
  return result;
}
