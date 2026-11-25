import { HttpError } from "@/lib/auth";
import { query } from "@/lib/db";
import { loadAnswerPrompts } from "./answers-prompt";
import { readProvider, scrub } from "./api-key";
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
    return { ok: true as const, answers: shapeAnswers(generated.text, questionsText, profile, evidence) };
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

// The model writes the prose. Choice, file, and profile fields are then forced into a value the form can submit.
function shapeAnswers(modelText: string, questionsText: string, profile: AnswerProfile, evidence: string) {
  const questions = questionsText.split(/\n\s*\n/).map((item) => item.replace(/^\d+\.\s+/, "").trim()).filter(Boolean);
  const written = modelAnswers(modelText);
  return questions
    .map((question, index) => {
      const answer = fieldAnswer(question, written[index] || "", profile, evidence);
      return `# Q${index + 1}\n${question}\n\n# A${index + 1}\n${answer}`;
    })
    .join("\n\n");
}

type AnswerProfile = { fullName: string; phone: string; email: string; address: string; linkedin: string };

function modelAnswers(text: string) {
  const parts = text.split(/^#\s*A\d+\s*$/m).slice(1);
  return parts.map((part) => part.split(/^#\s*Q\d+\s*$/m)[0].trim());
}

function fieldAnswer(question: string, written: string, profile: AnswerProfile, evidence: string) {
  const kind = question.match(/\((file|text|email|textarea|radio|select|checkbox)\)/i)?.[1].toLowerCase() || "";
  if (kind === "file") return "FILE";
  const label = question.split("(")[0].trim();
  if (/^name$/i.test(label)) return profile.fullName;
  if (/^e-?mail$/i.test(label) || kind === "email") return profile.email;
  if (/^phones?$/i.test(label)) return profile.phone;
  if (/^locations?$/i.test(label) || /^city$/i.test(label)) return profile.address;
  if (/^linkedin$/i.test(label)) return profile.linkedin || "N/A";
  if (/^github$/i.test(label)) return firstUrl(evidence, /github\.com/i) || "N/A";

  const options = listedOptions(question);
  if (options.length && kind !== "textarea") {
    const skill = skillChoice(question, evidence);
    if (skill) return optionText(options, skill) || skill;
    const chosen = optionText(options, written);
    if (chosen) return chosen;
  }
  return written.trim();
}

function listedOptions(question: string) {
  const match = question.match(/Options:\s*(.+)$/i);
  if (!match) return [];
  return match[1].split("|").map((item) => item.trim()).filter(Boolean);
}

function optionText(options: string[], answer: string) {
  const wanted = answer.trim().toLowerCase();
  return options.find((option) => option.toLowerCase() === wanted)
    || options.find((option) => new RegExp(`\\b${option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(answer));
}

// "Docker and Linux" is Yes only when every named skill was used in the source resume or a bullet.
function skillChoice(question: string, evidence: string) {
  const ask = question.replace(/\([^)]*\)\.?/g, " ").replace(/\brequired\b\.?/gi, " ").replace(/options:.*$/i, "").replace(/\s+/g, " ").trim();
  const skills = ask.match(/\b(?:working with|experience (?:with|in|using))\s+(.+?)\??$/i)?.[1];
  if (!skills) return "";
  const parts = skills.split(/\s+and\s+/i).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";
  return parts.every((part) => usedSkill(evidence, part)) ? "Yes" : "No";
}

function usedSkill(evidence: string, skill: string) {
  const term = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = /[#.+]/.test(skill) ? new RegExp(term, "i") : new RegExp(`\\b${term}\\b`, "i");
  return pattern.test(evidence);
}

function firstUrl(text: string, host: RegExp) {
  for (const match of text.matchAll(/https?:\/\/[^\s)]+/gi)) {
    const url = match[0].replace(/[.,)]+$/, "");
    if (host.test(url)) return url;
  }
  return "";
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
