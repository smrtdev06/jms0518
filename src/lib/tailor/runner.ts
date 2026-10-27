import { scoreAts } from "./ats";
import { readProvider, scrub } from "./api-key";
import { claimForManual, claimNextJob, clearJobs, deleteUnfinishedJobs, failTimedOutJobs, getJob, insertJobs, jobStillRunning, listJobs, recoverInterruptedJobs, updateJob } from "./jobs";
import { claimCompany, duplicateLink } from "./duplicates";
import { fetchJob, isGenericTitle } from "./fetch-job";
import { condenseJobText } from "./job-text";
import { addUsage, generateApplication, GenerationError, type Usage } from "./openai";
import { packageNames, type PackageSnapshot } from "./pack";
import { serverless } from "./hosting";
import { byRecency } from "./base-resume";
import { withBulletCounts } from "./prompt";
import { removeJobFiles } from "./storage";
import { loadTailorPrompts } from "./tailor-prompt";
import { buildTargetJob } from "./target-job";
import type { Experience, GeneratedContent, JobLog, Profile } from "./types";
import { withUserLock } from "./user-lock";

type Run = { controller: AbortController; done: Promise<void> };
type GenerationProfile = Profile;
// True once the job should stop: Clear, a new batch, or (serverless) the job was cleared or timed out elsewhere.
type Stale = () => Promise<boolean>;
type Log = (message: string, level?: JobLog["level"]) => Promise<void>;

// How many links of one user's batch are processed at the same time. LINKS_AT_ONCE overrides it.
const LINKS_AT_ONCE = Math.max(1, Math.min(20, Number(process.env.LINKS_AT_ONCE) || 5));

const globalForRunner = globalThis as unknown as {
  batches?: Map<number, Run>;
  manualRuns?: Map<number, Map<number, Run>>;
  activeJobs?: Set<number>;
  epochs?: Map<number, number>;
};

function batches() {
  if (!globalForRunner.batches) globalForRunner.batches = new Map();
  return globalForRunner.batches;
}

// Cards continued with a pasted description, per user, so Clear and new batches can stop them too.
function manualRuns(userPk: number) {
  if (!globalForRunner.manualRuns) globalForRunner.manualRuns = new Map();
  let runs = globalForRunner.manualRuns.get(userPk);
  if (!runs) {
    runs = new Map();
    globalForRunner.manualRuns.set(userPk, runs);
  }
  return runs;
}

function activeJobs() {
  if (!globalForRunner.activeJobs) globalForRunner.activeJobs = new Set();
  return globalForRunner.activeJobs;
}

function epochs() {
  if (!globalForRunner.epochs) globalForRunner.epochs = new Map();
  return globalForRunner.epochs;
}

// Stops everything running for the user and clears their board. Unfinished cards are deleted; finished
// packages stay in the system (they are "Ready to Apply" jobs) and only leave the board.
async function stopAndClear(userPk: number) {
  epochs().set(userPk, (epochs().get(userPk) || 0) + 1);
  const running = [batches().get(userPk), ...manualRuns(userPk).values()].filter((run): run is Run => Boolean(run));
  for (const run of running) run.controller.abort();
  await Promise.allSettled(running.map((run) => run.done));
  const removed = await clearJobs(userPk);
  await removeJobFiles(removed);
}

// Marks a job as a duplicate. Skipped jobs cost no AI tokens and never reach Applying Management.
async function markSkipped(userPk: number, jobId: number, message: string, log?: Log) {
  if (log) await log(message, "warn").catch(() => undefined);
  await updateJob(userPk, jobId, { status: "skipped", message, error: "" });
}

// On one long-running server, a batch's state lives in memory (epochs, aborts). On a serverless host each request
// may run elsewhere, so the database decides: a job stops as soon as its row is no longer "running".
function staleCheck(userPk: number, jobId: number, signal: AbortSignal, epoch: number): Stale {
  if (serverless) return async () => signal.aborted || !(await jobStillRunning(userPk, jobId));
  return async () => signal.aborted || epochs().get(userPk) !== epoch;
}

// The member left the Resume Tailor before the batch finished: stop it and delete the jobs that were still
// waiting or being generated. Finished, skipped and failed cards stay on the board.
export function abandonGeneration(userPk: number) {
  return withUserLock(userPk, async () => {
    epochs().set(userPk, (epochs().get(userPk) || 0) + 1);
    const running = [batches().get(userPk), ...manualRuns(userPk).values()].filter((run): run is Run => Boolean(run));
    for (const run of running) run.controller.abort();
    await Promise.allSettled(running.map((run) => run.done));
    const removed = await deleteUnfinishedJobs(userPk);
    await removeJobFiles(removed);
    return removed.length;
  });
}

export function clearGeneration(userPk: number) {
  return withUserLock(userPk, () => stopAndClear(userPk));
}

export function startGeneration(userPk: number, profile: GenerationProfile, urls: string[]) {
  return withUserLock(userPk, async () => {
    if (!serverless) await recoverInterruptedJobs();
    await stopAndClear(userPk);
    const epoch = epochs().get(userPk) || 0;
    const controller = new AbortController();
    const inserted = await insertJobs(userPk, urls.map((url, index) => ({ position: index + 1, url })));
    // Links that are already registered are skipped before anything is fetched.
    const created: { id: number; url: string }[] = [];
    for (const job of inserted.sort((a, b) => a.position - b.position)) {
      const duplicate = await duplicateLink(userPk, job.id);
      if (duplicate) await markSkipped(userPk, job.id, duplicate.message);
      else created.push(job);
    }
    if (serverless) return { jobs: await listJobs(userPk), done: pumpQueue(userPk, profile) };
    const done = runBatch(userPk, profile, created, controller.signal, epoch).finally(() => {
      if (batches().get(userPk)?.controller === controller) batches().delete(userPk);
    });
    batches().set(userPk, { controller, done });
    return { jobs: await listJobs(userPk), done };
  });
}

export async function continueWithManual(userPk: number, profile: GenerationProfile, jobId: number, description: string) {
  const job = await getJob(userPk, jobId);
  if (!job) return { error: "That package was not found.", status: 404 };
  if (job.status !== "needs_manual" && job.status !== "failed") {
    return { error: "This package is not waiting for a job description.", status: 409 };
  }
  if (activeJobs().has(jobId)) return { error: "This package is already running.", status: 409 };
  const text = description.trim();
  if (text.length < 80) return { error: "Paste at least a short job description (80 characters or more).", status: 400 };
  // Serverless: the database marks the job taken, so two requests (a double click) cannot both run it.
  if (serverless && !(await claimForManual(userPk, jobId))) return { error: "This package is already running.", status: 409 };
  const epoch = epochs().get(userPk) || 0;
  const controller = new AbortController();
  activeJobs().add(jobId);
  const done = processManual(userPk, profile, job.id, job.url, text, controller.signal, staleCheck(userPk, job.id, controller.signal, epoch)).finally(() => {
    activeJobs().delete(jobId);
    manualRuns(userPk).delete(jobId);
  });
  manualRuns(userPk).set(jobId, { controller, done });
  return { ok: true as const, done };
}

async function runBatch(userPk: number, profile: GenerationProfile, jobs: { id: number; url: string }[], signal: AbortSignal, epoch: number) {
  const queue = [...jobs];
  const workers = Array.from({ length: Math.min(LINKS_AT_ONCE, queue.length) }, async () => {
    while (queue.length && !signal.aborted && epochs().get(userPk) === epoch) {
      const job = queue.shift();
      if (!job) return;
      await processFetched(userPk, profile, job.id, job.url, signal, staleCheck(userPk, job.id, signal, epoch));
    }
  });
  // Every worker is waited for, even if one of them fails, so Clear never deletes files under a running job.
  await Promise.allSettled(workers);
}

// Serverless hosts stop a request after a few minutes (maxDuration in the routes), so a batch is worked through
// in pieces: each request (the Generate click, and every progress check while jobs wait) takes queued jobs from
// the database while fewer than LINKS_AT_ONCE run, and starts new ones only early in its time, leaving room to
// finish them. A job whose request was stopped anyway times out (failTimedOutJobs).
const CLAIM_WINDOW_MS = 100000;

export async function pumpQueue(userPk: number, profile: GenerationProfile) {
  await failTimedOutJobs(userPk);
  const started = Date.now();
  const signal = new AbortController().signal;
  const worker = async () => {
    while (Date.now() - started < CLAIM_WINDOW_MS) {
      const job = await claimNextJob(userPk, LINKS_AT_ONCE);
      if (!job) return;
      await processFetched(userPk, profile, job.id, job.url, signal, staleCheck(userPk, job.id, signal, 0));
    }
  };
  await Promise.allSettled(Array.from({ length: LINKS_AT_ONCE }, worker));
}

async function processFetched(userPk: number, profile: GenerationProfile, jobId: number, url: string, signal: AbortSignal, stale: Stale) {
  const logs: JobLog[] = [];
  const log = queueLog(userPk, jobId, logs);
  try {
    if (await stale()) return;
    activeJobs().add(jobId);
    await updateJob(userPk, jobId, { status: "running", step: "scrape", message: "Opening the job page", error: "" });
    await log(`Opening ${safeHost(url)}`);
    await updateJob(userPk, jobId, { step: "fetch", message: "Fetching the page content" });
    const fetched = await fetchJob(url, (message) => {
      void log(message);
    }, signal);
    if (await stale()) return;
    if (!fetched.ok) {
      await log(fetched.error, "error");
      await updateJob(userPk, jobId, {
        status: "needs_manual",
        step: "fetch",
        message: "Paste the job description to continue",
        error: fetched.error,
      });
      return;
    }
    await updateJob(userPk, jobId, { step: "extract", message: "Extracting the role" });
    const company = cleanLabel(fetched.company) || guess(fetched.text, "Company") || "Company";
    const jobTitle = cleanLabel(fetched.title) || guess(fetched.text, "Title") || "Role";
    await log(`Extracted “${jobTitle}” at ${company}.`);
    await updateJob(userPk, jobId, { company, jobTitle, message: `${jobTitle} at ${company}` });
    await writePackage(userPk, profile, jobId, url, fetched.text, company, jobTitle, fetched.companyUrl || "", logs, log, signal, stale);
  } catch (error) {
    if (await stale()) return;
    await markFailed(userPk, jobId, error, log);
  } finally {
    activeJobs().delete(jobId);
  }
}

async function processManual(userPk: number, profile: GenerationProfile, jobId: number, url: string, description: string, signal: AbortSignal, stale: Stale) {
  const existing = await getJob(userPk, jobId);
  const logs: JobLog[] = [...(existing?.logs || [])];
  const log = queueLog(userPk, jobId, logs);
  try {
    if (await stale()) return;
    await updateJob(userPk, jobId, { status: "running", step: "extract", message: "Using the pasted job description", error: "" });
    await log("Using the pasted job description.");
    const company = cleanLabel(existing?.company || "") || guess(description, "Company") || "Company";
    const jobTitle = cleanLabel(existing?.jobTitle || "") || guess(description, "Title") || "Role";
    const header = [company !== "Company" ? `Company: ${company}` : "", jobTitle !== "Role" ? `Title: ${jobTitle}` : ""].filter(Boolean).join("\n");
    const text = /^company:/im.test(description) || !header ? description : `${header}\n\n${description}`;
    await updateJob(userPk, jobId, { company, jobTitle });
    await writePackage(userPk, profile, jobId, url, text, company, jobTitle, "", logs, log, signal, stale);
  } catch (error) {
    if (await stale()) return;
    await markFailed(userPk, jobId, error, log);
  }
}

// Marks a card as failed. Each step is separate, so a failing log write cannot leave the card "running".
async function markFailed(userPk: number, jobId: number, error: unknown, log: Log) {
  const message = scrub(error instanceof Error ? error.message : "Generation failed.");
  if (error instanceof GenerationError && error.usage) await updateJob(userPk, jobId, { usage: error.usage }).catch(() => undefined);
  await log(message, "error").catch(() => undefined);
  await updateJob(userPk, jobId, { status: "failed", message, error: message }).catch((updateError) => console.error("Could not mark a job as failed", updateError));
}

async function writePackage(
  userPk: number,
  profile: GenerationProfile,
  jobId: number,
  url: string,
  jobText: string,
  company: string,
  jobTitle: string,
  companyUrl: string,
  logs: JobLog[],
  log: Log,
  signal: AbortSignal,
  stale: Stale,
) {
  if (await stale()) return;
  const provider = readProvider();
  const apiKey = provider.apiKey;
  if (!apiKey) throw new Error(`Set ${provider.keyName} in the environment before generating.`);
  await updateJob(userPk, jobId, { step: "generate", message: "Writing the resume and cover letter" });
  const condensed = condenseJobText(jobText);
  if (condensed.length < jobText.trim().length) {
    await log(`Trimmed the job description from ${jobText.trim().length.toLocaleString()} to ${condensed.length.toLocaleString()} characters (benefits, legal, and application boilerplate removed).`);
  }
  if (!profile.baseResumeText.trim()) throw new Error("Save your profile before generating. The base resume text is missing.");
  // Bullet counts (3 to 6) follow the resume order, so they are chosen after sorting by date.
  const experiences = withBulletCounts(byRecency(profile.experiences));
  const target = buildTargetJob({ company, title: jobTitle, text: condensed, companyUrl });
  await log(`Target role: ${target.jobTitle} at ${target.companyName}. Stack: ${target.jobStack}. Company URL: ${target.companyUrl}.`);
  // Same company registered within the cooldown: skipped before any AI tokens are spent.
  const duplicate = await claimCompany(userPk, jobId, target.companyName !== "Company" ? target.companyName : company);
  if (duplicate) {
    await updateJob(userPk, jobId, { logs });
    await markSkipped(userPk, jobId, duplicate.message, log);
    return;
  }
  const prompts = await loadTailorPrompts({ ...profile, experiences }, target);
  await log(`Sending the base resume and this job to ${provider.name}.`);
  let usage: Usage | null = null;
  let generated = await generateApplication({ apiKey, system: prompts.system, user: prompts.user, experiences, fullName: profile.fullName, signal });
  usage = addUsage(usage, generated.usage);
  let missing = missingParts(experiences, generated.content);
  if (missing.length && !(await stale())) {
    await log(`${provider.name}'s reply was missing ${missing.join(" and ")}. Reading the prompts again and asking once more.`, "warn");
    try {
      const again = await loadTailorPrompts({ ...profile, experiences }, target);
      generated = await generateApplication({ apiKey, system: again.system, user: again.user, experiences, fullName: profile.fullName, signal });
    } catch (error) {
      if (error instanceof GenerationError) throw new GenerationError(error.message, addUsage(usage, error.usage));
      throw error;
    }
    usage = addUsage(usage, generated.usage);
    missing = missingParts(experiences, generated.content, 1);
  }
  const content = generated.content;
  // A role never shows more bullets than planned; the first ones are kept.
  content.roles = content.roles.map((role, index) => ({ ...role, bullets: role.bullets.slice(0, experiences[index]?.bulletCount || role.bullets.length) }));
  if (usage) {
    const { total, prompt: sent, completion, cached } = usage;
    const cachedNote = cached ? `, ${cached.toLocaleString()} of the prompt cached` : "";
    await log(`Tailoring usage with ${generated.model}: ${total.toLocaleString()} tokens (${sent.toLocaleString()} prompt, ${completion.toLocaleString()} completion${cachedNote}).`);
    await updateJob(userPk, jobId, { usage });
  }
  if (missing.length) throw new GenerationError(`${provider.name}'s reply was still missing ${missing.join(" and ")}. Try this link again.`, usage);
  if (await stale()) return;
  const finalCompany = target.companyName !== "Company" ? target.companyName : company;
  const finalTitle = target.jobTitle !== "Role" ? target.jobTitle : jobTitle;
  await updateJob(userPk, jobId, { company: finalCompany, jobTitle: finalTitle, step: "validate", message: "Checking format and ATS match" });
  const notes = validateContent(experiences, content);
  for (const note of notes) await log(note, "warn");
  const preview = [
    content.summary.join(" "),
    content.skills.map((skill) => `${skill.category}: ${skill.items.join(", ")}`).join("\n"),
    content.roles.flatMap((role) => role.bullets.map((bullet) => bullet.text)).join("\n"),
  ].join("\n");
  const ats = scoreAts(condensed, preview, [...content.ats.matchedKeywords, ...content.ats.missingKeywords]);
  if (ats.score === null) await log("No technical keywords were found in the job description, so there is no ATS score.");
  else await log(`ATS match ${ats.score}/100 from keywords present in the resume.`);
  if (ats.missing.length) await log(`Keywords not found in the resume: ${ats.missing.slice(0, 8).join(", ")}`, "warn");
  await updateJob(userPk, jobId, { atsScore: ats.score, step: "zip", message: "Saving the resume and cover letter" });
  if (await stale()) return;
  const titles = experiences.map((experience, index) => keepSeniority(experience.jobTitle, generated.titles[index] || ""));
  for (const [index, experience] of experiences.entries()) {
    const tailored = generated.titles[index];
    if (tailored && titles[index] !== tailored) await log(`Kept "${experience.jobTitle}" instead of "${tailored}", which changed the role's seniority.`, "warn");
  }
  const { baseResumeText: _baseResumeText, ...facts } = profile;
  // Only the content is saved; the PDFs and the ZIP are built from it when they are downloaded.
  const snapshot: PackageSnapshot = {
    profile: { ...facts, experiences: experiences.map((experience, index) => ({ ...experience, jobTitle: titles[index] })) },
    content,
    company: finalCompany,
    jobTitle: finalTitle,
    jobUrl: url,
  };
  const names = packageNames(snapshot);
  await log("Saved the resume and cover letter. The PDFs are built when they are downloaded.");
  await updateJob(userPk, jobId, {
    status: "done",
    step: "zip",
    message: "Ready to download",
    company: finalCompany,
    jobTitle: finalTitle,
    error: "",
    atsScore: ats.score,
    logs,
    tailored: snapshot,
    zipName: names.zipName,
    resumeName: names.resumeName,
    coverName: names.coverName,
  });
}

const MIN_BULLETS = 3;

const SENIORITY = ["intern", "junior", "jr", "mid", "senior", "sr", "lead", "staff", "principal", "manager", "director", "head", "chief", "vp"];

// A tailored title may sharpen the role ("Engineer" -> "Backend Engineer") but never change its level, so a title
// that adds or drops a seniority word ("Engineer" -> "Senior Engineer") falls back to the profile's title.
function keepSeniority(source: string, tailored: string) {
  if (!tailored.trim()) return source;
  const levels = (title: string) => SENIORITY.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(title)).sort().join(",");
  return levels(source) === levels(tailored) ? tailored : source;
}

// Parts the resume cannot do without: bullets for every role (3 before the retry asks again, 1 after it), skills, and the cover letter.
function missingParts(experiences: Experience[], content: GeneratedContent, minBullets = MIN_BULLETS) {
  const parts: string[] = [];
  const short = experiences.filter((_, index) => (content.roles[index]?.bullets.length || 0) < minBullets);
  if (short.length) parts.push(`${minBullets > 1 ? `at least ${minBullets} ` : ""}bullets for ${short.map((role) => `${role.jobTitle} at ${role.companyName}`).join(", ")}`);
  if (!content.skills.length) parts.push("the skills section");
  if (!content.coverLetter.length) parts.push("the cover letter");
  return parts;
}

// Activity log writes happen in order. A failed write is skipped instead of breaking every later one.
function queueLog(userPk: number, jobId: number, logs: JobLog[]) {
  let writing: Promise<void> = Promise.resolve();
  return (message: string, level: JobLog["level"] = "info") => {
    logs.push({ at: Date.now(), level, message });
    const snapshot = [...logs];
    writing = writing.then(() => updateJob(userPk, jobId, { logs: snapshot, message })).catch((error) => console.error("Could not save a job log entry", error));
    return writing;
  };
}

function validateContent(experiences: Experience[], content: GeneratedContent) {
  const notes: string[] = [];
  if (!content.summary.length) notes.push("The summary came back empty.");
  if (!content.skills.length) notes.push("The skills section came back empty.");
  experiences.forEach((experience, index) => {
    const count = content.roles[index]?.bullets.length || 0;
    if (count && count < experience.bulletCount) notes.push(`${experience.jobTitle} at ${experience.companyName} has ${count} bullets. The plan asked for ${experience.bulletCount}.`);
  });
  return notes;
}

function guess(text: string, label: string) {
  return cleanLabel(text.match(new RegExp(`^${label}:\\s*(.+)$`, "mi"))?.[1]?.trim() || "");
}

function cleanLabel(value: string) {
  const label = value.replace(/\s+/g, " ").replace(/^company:\s*/i, "").replace(/^title:\s*/i, "").trim();
  return isGenericTitle(label) ? "" : label;
}

function safeHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}
