import dns from "node:dns";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import * as cheerio from "cheerio";
import puppeteer, { type Browser } from "puppeteer-core";
import fs from "node:fs";
import { removeBoilerplate } from "./job-text";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const JOB_SIGNAL =
  /(responsibilit|requirement|qualification|what you(?:'|’)?ll|about the role|about the job|we(?:'|’)?re looking|you will|experience with|preferred|your background|the opportunity)/i;

const BLOCKED =
  /captcha|cf-browser-verification|attention required|access denied|just a moment|bot detection|performing security verification|verify (that )?you are (a )?human|human verification|are you a robot/i;

const CLOSED =
  /(page you are looking for (doesn'?t|does not) exist|job (posting )?(is )?no longer (available|active|open|accepting)|(position|job|requisition) (has been|is) (filled|closed|removed)|this job (has )?(expired|closed)|no longer accepting applications|job (posting )?not found|posting (has )?expired)/i;

// How long a browser read keeps checking a slow page for the job text.
const BROWSER_WAIT_MS = 60000;

const BROWSERS = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter((item): item is string => Boolean(item));

type FetchResult = {
  ok: boolean;
  url: string;
  company: string;
  title: string;
  location: string;
  text: string;
  source: string;
  error: string;
  companyUrl?: string;
  // Structured job data (JobPosting, job-board APIs) is complete even when it is short.
  trusted?: boolean;
  // A failure no other read method can fix, such as a link to a whole career site.
  final?: boolean;
};

type Log = (message: string) => void;

let browserPromise: Promise<Browser> | null = null;

export async function fetchJob(rawUrl: string, log: Log = () => {}, signal?: AbortSignal): Promise<FetchResult> {
  const url = String(rawUrl || "").trim();
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return fail(url, "Only public http and https job links are supported.");
    }
    await assertPublic(parsed.toString());
    const target = jobPageUrl(parsed.toString());
    if (target !== parsed.toString()) log("This link opens an application or sign-in page. Reading the job's details page instead.");
    const board = await fromKnownBoards(target, log, signal);
    if (board?.ok || board?.final) return board;
    if (board) log(`${board.error.replace(/ Paste.*$/, "")} Reading the job page instead.`);

    log("Fetching the job page");
    let first: FetchResult;
    try {
      first = await fromHtml(target, log, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : "Could not read that job link.";
      if (/not a public job page|Only public http/.test(message)) return fail(url, message);
      first = fail(url, message);
    }
    if (first.ok && (first.trusted || usable(first.text, false))) {
      log(`Retrieved the job description from ${first.source}.`);
      return first;
    }

    log("The first read did not include the full page. Opening it in a browser and waiting for the job text.");
    const second = await fromBrowser(target, log, signal);
    if (second.ok) {
      log(`Retrieved the job description from ${second.source}.`);
      return second;
    }
    return fail(
      url,
      second.error || first.error || board?.error || "Could not retrieve the full page content. Paste the job description for this link.",
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    return fail(url, error instanceof Error ? error.message : "Could not read that job link.");
  }
}

// Links that open an application or sign-in form are rewritten to the job's details page.
function jobPageUrl(value: string) {
  const url = new URL(value);
  const icims = /\.icims\.com$/i.test(url.hostname) ? url.pathname.match(/^\/jobs\/(\d+)\/([^/]+)/) : null;
  if (icims) return `${url.origin}/jobs/${icims[1]}/${icims[2]}/job`;
  if (/(^|\.)recruiting\.paylocity\.com$/i.test(url.hostname) && /\/jobs\/Apply\//i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/jobs\/Apply\//i, "/jobs/Details/");
    return url.toString();
  }
  return value;
}

// Matches a job board link by its real host and path, so a board URL inside another link's query
// string (for example "?ref=https://jobs.lever.co/...") is not mistaken for that board.
// Returns ["", ...host captures, ...path captures], like String.match, or null.
function onSite(value: string, host: RegExp, path: RegExp) {
  const url = new URL(value);
  const hostMatch = host.exec(url.hostname.toLowerCase());
  const pathMatch = hostMatch ? path.exec(url.pathname) : null;
  return hostMatch && pathMatch ? ["", ...hostMatch.slice(1), ...pathMatch.slice(1)] : null;
}

// Each job board reader runs on its own: a network error or an odd URL in one of them falls back to
// reading the page, instead of failing the whole link.
async function fromKnownBoards(url: string, log: Log, signal?: AbortSignal) {
  const readers = [fromAdpWorkforceNow, fromWorkday, fromGreenhouse, fromLever, fromAshby, fromSmartRecruiters, fromWorkable, fromRecruitee, fromBamboo, fromLinkedIn];
  for (const reader of readers) {
    try {
      const result = await reader(url, log, signal);
      if (result) return result;
    } catch (error) {
      if (signal?.aborted) throw error;
      return fail(url, `The job board did not answer (${error instanceof Error ? error.message : "error"}).`);
    }
  }
  return null;
}

async function fromWorkday(url: string, log: Log, signal?: AbortSignal): Promise<FetchResult | null> {
  const parsed = parseWorkday(url);
  if (!parsed) return null;
  if (!parsed.jobPath) return stop(url, "This is a Workday career site, not a single job. Open the specific role and paste that link.");
  log("Reading the Workday job API");
  const jobPath = parsed.jobPath.split("/").map((part) => encodeURIComponent(part)).join("/");
  const detailUrl = `${parsed.origin}/wday/cxs/${encodeURIComponent(parsed.tenant)}/${encodeURIComponent(parsed.site)}/job/${jobPath}`;
  let detail = await getJson(detailUrl, signal);
  if (detail.status === 404 && parsed.requisition) {
    const search = await getJson(
      `${parsed.origin}/wday/cxs/${encodeURIComponent(parsed.tenant)}/${encodeURIComponent(parsed.site)}/jobs`,
      signal,
      { method: "POST", body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: parsed.requisition }) },
    );
    const hit = (search.data?.jobPostings || []).find((job: { externalPath?: string; bulletFields?: string[] }) =>
      job.externalPath?.endsWith(parsed.requisition) || (job.bulletFields || []).includes(parsed.requisition),
    );
    if (hit?.externalPath) {
      detail = await getJson(
        `${parsed.origin}/wday/cxs/${encodeURIComponent(parsed.tenant)}/${encodeURIComponent(parsed.site)}${hit.externalPath}`,
        signal,
      );
    }
  }
  const info = detail.data?.jobPostingInfo;
  const text = htmlToText(info?.jobDescription || "");
  if (detail.status !== 200 || !usable(text, true)) {
    return fail(url, `Workday did not return a job description (HTTP ${detail.status || "error"}). Paste the description to continue.`);
  }
  const company = workdayCompany(parsed.site, detail.data?.hiringOrganization?.name);
  return ok({
    url,
    company,
    title: info.title || "",
    location: info.location || "",
    text: composeText({ company, title: info.title, location: info.location, extra: info.timeType, text }),
    source: "Workday job API",
  });
}

function parseWorkday(value: string) {
  const url = new URL(value);
  if (!/(^|\.)(myworkdayjobs|myworkdaysite)\.com$/i.test(url.hostname)) return null;
  const tenant = url.hostname.split(".")[0];
  let parts = url.pathname.split("/").filter(Boolean);
  if (/^[a-z]{2}-[a-z]{2}$/i.test(parts[0] || "")) parts = parts.slice(1);
  if (!parts.length || parts[0] === "wday") return null;
  const site = parts[0];
  const jobAt = parts.indexOf("job");
  if (jobAt < 0) return { origin: url.origin, tenant, site, jobPath: "", requisition: "" };
  let rest = parts.slice(jobAt + 1);
  const stop = rest.findIndex((part) => ["apply", "applymanually", "usemylastapplication"].includes(part.toLowerCase()));
  if (stop >= 0) rest = rest.slice(0, stop);
  const last = rest.at(-1) || "";
  const requisition = last.includes("_") ? last.split("_").at(-1) || "" : "";
  const decode = (part: string) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  };
  return { origin: url.origin, tenant, site, jobPath: rest.map(decode).join("/"), requisition };
}

function workdayCompany(site: string, hiringName?: string) {
  const fromSite = site.replace(/[_-]+/g, " ").replace(/\b(careers?|jobs?|external|search)\b/gi, "").replace(/\s+/g, " ").trim();
  const hiring = String(hiringName || "").trim();
  if (hiring && hiring.length <= 48) return hiring;
  return fromSite || hiring || "Company";
}

async function fromGreenhouse(url: string, log: Log, signal?: AbortSignal): Promise<FetchResult | null> {
  const id = greenhouseId(url);
  if (!id) return null;
  const tokens = greenhouseTokens(url);
  if (!tokens.length) return null;
  log(`Reading Greenhouse job ${id}`);
  const found = await greenhouseJob(url, id, tokens, signal);
  if (found) return found;
  if (/greenhouse\.io$/i.test(new URL(url).hostname)) {
    return fail(url, "Greenhouse did not return this posting. Paste the job description if you still have it.");
  }
  return null;
}

async function greenhouseJob(url: string, id: string, tokens: string[], signal?: AbortSignal) {
  for (const token of tokens) {
    const res = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${id}?content=true`, signal);
    const text = htmlToText(res.data?.content || "");
    if (res.status === 200 && res.data?.title && usable(text, true)) {
      const company = res.data.company_name || titleCase(token);
      const location = res.data.location?.name || "";
      return ok({
        url,
        company,
        title: res.data.title,
        location,
        text: composeText({ company, title: res.data.title, location, text }),
        source: "Greenhouse job API",
        trusted: true,
      });
    }
  }
  return null;
}

// Company sites that embed a Greenhouse board name it in the page (often not the domain name).
function greenhouseTokensInPage(html: string) {
  const tokens = [
    ...[...html.matchAll(/greenhouse\.io\/embed\/job_(?:board(?:\/js)?|app)\?(?:[^"'\s<>]*&(?:amp;)?)?for=([A-Za-z0-9_-]+)/g)].map((m) => m[1]),
    ...[...html.matchAll(/(?:job-boards|boards)\.greenhouse\.io\/(?!embed\b)([A-Za-z0-9_-]+)/g)].map((m) => m[1]),
  ];
  return [...new Set(tokens.map((token) => token.toLowerCase()))];
}

// ADP Workforce Now career pages are built by scripts; the same data comes from ADP's public job endpoint.
async function fromAdpWorkforceNow(url: string, log: Log, signal?: AbortSignal): Promise<FetchResult | null> {
  const parsed = new URL(url);
  if (!/(^|\.)workforcenow\.adp\.com$/i.test(parsed.hostname)) return null;
  const cid = parsed.searchParams.get("cid");
  const jobId = parsed.searchParams.get("jobId");
  if (!cid || !jobId) return null;
  const lang = parsed.searchParams.get("lang") || "en_US";
  const ccId = parsed.searchParams.get("ccId");
  log("Reading the ADP Workforce Now job API");
  const api = `${parsed.origin}/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions/${encodeURIComponent(jobId)}?cid=${encodeURIComponent(cid)}&lang=${encodeURIComponent(lang)}&locale=${encodeURIComponent(lang)}${ccId ? `&ccId=${encodeURIComponent(ccId)}` : ""}`;
  const res = await getJson(api, signal);
  const title = String(res.data?.requisitionTitle || "");
  const text = htmlToText(String(res.data?.requisitionDescription || ""));
  if (res.status !== 200 || !title || !usable(text, true)) {
    return fail(url, `ADP did not return this posting (HTTP ${res.status || "error"}). Paste the description to continue.`);
  }
  const place = res.data?.requisitionLocations?.[0];
  const location = [place?.address?.cityName, place?.address?.countrySubdivisionLevel1?.codeValue, place?.nameCode?.shortName]
    .map((part: unknown) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
  return ok({ url, company: "", title, location, text: composeText({ title, location, text }), source: "ADP Workforce Now job API", trusted: true });
}

function greenhouseId(value: string) {
  const url = new URL(value);
  const query = url.searchParams.get("gh_jid") || url.searchParams.get("token");
  if (query && /^\d+$/.test(query)) return query;
  return url.pathname.match(/\/jobs\/(\d+)/)?.[1] || "";
}

function greenhouseTokens(value: string) {
  const url = new URL(value);
  const tokens: string[] = [];
  const board = url.searchParams.get("for");
  if (board) tokens.push(board);
  if (/greenhouse\.io$/i.test(url.hostname)) {
    const first = url.pathname.split("/").filter(Boolean)[0];
    if (first && first !== "embed") tokens.push(first);
  } else if (url.searchParams.get("gh_jid")) {
    const labels = url.hostname.replace(/^www\./, "").split(".");
    tokens.push(labels[0]);
    if (labels.length > 2) tokens.push(labels.at(-2) || "");
  }
  return [...new Set(tokens.map((token) => token.toLowerCase()).filter(Boolean))];
}

async function fromLever(url: string, log: Log, signal?: AbortSignal): Promise<FetchResult | null> {
  const match = onSite(url, /^jobs\.lever\.co$/, /^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (!match) return null;
  const [, company, id] = match;
  log("Reading the Lever job API");
  const res = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}/${id}?mode=json`, signal);
  const data = res.data;
  if (res.status !== 200 || !data?.text) return fail(url, "Lever did not return this posting. Paste the description to continue.");
  const parts = [data.descriptionPlain || data.description, ...(data.lists || []).flatMap((list: { text?: string; content?: string }) => [list.text, list.content]), data.additionalPlain || data.additional];
  const text = parts.map((part: string) => htmlToText(String(part || ""))).filter(Boolean).join("\n\n");
  if (!usable(text, true)) return fail(url, "Lever returned this job without a usable description.");
  const location = data.categories?.location || "";
  return ok({
    url,
    company: titleCase(company),
    title: data.text,
    location,
    text: composeText({ company: titleCase(company), title: data.text, location, extra: data.categories?.commitment, text }),
    source: "Lever job API",
  });
}

async function fromAshby(url: string, log: Log, signal?: AbortSignal): Promise<FetchResult | null> {
  const match = onSite(url, /^jobs\.ashbyhq\.com$/, /^\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  const [, org, jobId] = match;
  log("Reading the Ashby job board");
  const res = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`, signal);
  const job = (res.data?.jobs || []).find((item: { id?: string; jobUrl?: string; applyUrl?: string }) =>
    item.id === jobId || item.jobUrl?.includes(jobId) || item.applyUrl?.includes(jobId),
  );
  if (!job) return fail(url, "Ashby did not list this job. Paste the description to continue.");
  const text = htmlToText(job.descriptionHtml || job.descriptionPlain || "");
  if (!usable(text, true)) return fail(url, "Ashby returned this job without a usable description.");
  return ok({
    url,
    company: titleCase(org),
    title: job.title || "",
    location: job.location || "",
    text: composeText({ company: titleCase(org), title: job.title, location: job.location, text }),
    source: "Ashby job API",
  });
}

async function fromSmartRecruiters(url: string, log: Log, signal?: AbortSignal): Promise<FetchResult | null> {
  const match = onSite(url, /^jobs\.smartrecruiters\.com$/, /^\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  const [, company, id] = match;
  log("Reading the SmartRecruiters job API");
  const res = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(id)}`, signal);
  if (res.status !== 200 || !res.data?.name) return fail(url, "SmartRecruiters did not return this posting. Paste the description to continue.");
  const sections = res.data.jobAd?.sections || {};
  const text = Object.values(sections).map((section) => htmlToText((section as { text?: string })?.text || "")).filter(Boolean).join("\n\n");
  if (!usable(text, true)) return fail(url, "SmartRecruiters returned this job without a usable description.");
  const companyName = res.data.company?.name || titleCase(company);
  const location = res.data.location?.city || res.data.location?.region || "";
  return ok({
    url,
    company: companyName,
    title: res.data.name,
    location,
    text: composeText({ company: companyName, title: res.data.name, location, text }),
    source: "SmartRecruiters job API",
  });
}

async function fromWorkable(url: string, log: Log, signal?: AbortSignal): Promise<FetchResult | null> {
  const match = onSite(url, /^apply\.workable\.com$/, /^\/([^/]+)\/j\/([^/]+)/);
  if (!match) return null;
  const [, account, shortcode] = match;
  log("Reading the Workable job API");
  for (const version of ["v1", "v2", "v3"]) {
    const res = await getJson(`https://apply.workable.com/api/${version}/accounts/${encodeURIComponent(account)}/jobs/${encodeURIComponent(shortcode)}`, signal);
    const data = res.data || {};
    const text = htmlToText([data.description, data.requirements, data.benefits].filter(Boolean).join("\n"));
    if (res.status === 200 && data.title && usable(text, true)) {
      const location = [data.location?.city, data.location?.country].filter(Boolean).join(", ");
      return ok({
        url,
        company: titleCase(account),
        title: data.title,
        location,
        text: composeText({ company: titleCase(account), title: data.title, location, text }),
        source: "Workable job API",
      });
    }
  }
  return fail(url, "Workable did not return this posting. Paste the description to continue.");
}

async function fromRecruitee(url: string, log: Log, signal?: AbortSignal): Promise<FetchResult | null> {
  const match = onSite(url, /^([a-z0-9-]+)\.recruitee\.com$/, /^\/o\/([^/]+)/);
  if (!match) return null;
  const [, company, slug] = match;
  log("Reading the Recruitee job API");
  const res = await getJson(`https://${company}.recruitee.com/api/offers/${encodeURIComponent(slug)}`, signal);
  const offer = res.data?.offer;
  if (!offer?.title) return fail(url, "Recruitee did not return this posting. Paste the description to continue.");
  const text = htmlToText([offer.description, offer.requirements].filter(Boolean).join("\n"));
  if (!usable(text, true)) return fail(url, "Recruitee returned this job without a usable description.");
  const location = offer.location || offer.city || "";
  const companyName = offer.company_name || titleCase(company);
  return ok({
    url,
    company: companyName,
    title: offer.title,
    location,
    text: composeText({ company: companyName, title: offer.title, location, text }),
    source: "Recruitee job API",
  });
}

async function fromBamboo(url: string, log: Log, signal?: AbortSignal): Promise<FetchResult | null> {
  const match = onSite(url, /^([a-z0-9-]+)\.bamboohr\.com$/, /^\/careers\/(\d+)/);
  if (!match) return null;
  const [, company, id] = match;
  log("Reading the BambooHR job API");
  const res = await getJson(`https://${company}.bamboohr.com/careers/${id}/detail`, signal);
  const job = res.data?.result?.jobOpening || res.data?.jobOpening || res.data;
  const title = job?.jobOpeningName || job?.title || "";
  const text = htmlToText(job?.description || "");
  if (!title || !usable(text, true)) return fail(url, "BambooHR did not return a usable description. Paste the job description to continue.");
  const location = job.location?.city || job.locationLabel || "";
  return ok({
    url,
    company: titleCase(company),
    title,
    location,
    text: composeText({ company: titleCase(company), title, location, text }),
    source: "BambooHR job API",
  });
}

async function fromLinkedIn(url: string, log: Log, signal?: AbortSignal): Promise<FetchResult | null> {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (!/linkedin\.com$/i.test(host)) return null;
  const id = url.match(/\/jobs\/view\/(\d+)/)?.[1] || url.match(/currentJobId=(\d+)/)?.[1];
  if (!id) return stop(url, "This LinkedIn link is not a single job. Open the job and paste that URL, or paste the description.");
  log("Reading LinkedIn’s public job view");
  const res = await fetchText(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, signal);
  if (res.status !== 200) return fail(url, "LinkedIn did not share this job without a login. Paste the description to continue.");
  const $ = cheerio.load(res.text);
  const title = $("h2").first().text().trim() || $(".top-card-layout__title").text().trim();
  const company = $(".topcard__org-name-link, .topcard__flavor").first().text().trim();
  const location = $(".topcard__flavor--bullet").first().text().trim();
  const text = htmlToText($(".description__text, .show-more-less-html__markup").html() || "");
  if (!usable(text, true)) return fail(url, "LinkedIn did not include a public description for this job. Paste the description to continue.");
  return ok({
    url,
    company,
    title,
    location,
    text: composeText({ company, title, location, text }),
    source: "LinkedIn public job view",
  });
}

async function fromHtml(url: string, log: Log, signal?: AbortSignal): Promise<FetchResult> {
  const res = await fetchText(url, signal);
  if (lostJobId(url, res.url)) return stop(url, "This link now opens a list of jobs instead of the posting. The posting appears to be closed or removed.");
  if (res.contentType.includes("application/pdf")) return stop(url, "This link is a PDF. Paste the job description text to continue.");
  if (!readableType(res.contentType)) return stop(url, `This link is a file (${res.contentType.split(";")[0]}), not a job page. Paste the job description to continue.`);
  if (res.status >= 400) return fail(url, `The job page returned HTTP ${res.status}. Paste the description to continue.`);
  if (looksBlocked(res.text)) return fail(url, "The site blocked the page read. Paste the job description to continue.");

  // A Greenhouse job embedded on a company site (?gh_jid=…) is read from Greenhouse directly.
  const ghId = new URL(url).searchParams.get("gh_jid");
  if (ghId && /^\d+$/.test(ghId)) {
    const tokens = greenhouseTokensInPage(res.text);
    if (tokens.length) {
      log(`Reading Greenhouse job ${ghId} from the board embedded on this page`);
      const found = await greenhouseJob(url, ghId, tokens, signal);
      if (found) return found;
    }
  }

  const structured = jsonLdJob(res.text);
  if (structured && usable(structured.text, false)) {
    return ok({ url: res.url || url, ...structured, source: "JobPosting data on the page", trusted: true });
  }
  const text = visibleText(res.text);
  const $ = cheerio.load(res.text);
  const title = structured?.title || pickTitle([$("h1").first().text()], [$("meta[property='og:title']").attr("content") || "", $("title").text()]);
  // Pages built by scripts (Phenom, Next.js and similar) often carry the job in their embedded data.
  // That data can also hold other jobs ("similar jobs"), so it is used only when the page shows no job
  // text of its own, or when its text is the one on the page.
  const embedded = embeddedJob(res.text);
  const visibleUsable = usable(text, false);
  if (embedded && (!visibleUsable || sharesText(embedded.text, text))) {
    const embeddedTitle = structured?.title || pickTitle([$("h1").first().text()], [embedded.title, $("meta[property='og:title']").attr("content") || "", $("title").text()]);
    const company = structured?.company || "";
    const location = structured?.location || "";
    return ok({ url: res.url || url, company, title: embeddedTitle, location, text: composeText({ company, title: embeddedTitle, location, text: embedded.text }), source: "job data embedded in the page", trusted: true });
  }
  // A short JobPosting summary loses to the full visible text when the page has it.
  if (visibleUsable) {
    const company = structured?.company || "";
    const location = structured?.location || "";
    return ok({ url: res.url || url, company, title, location, text: composeText({ company, title, location, text }), source: "Visible text on the job page" });
  }
  if (structured && usable(structured.text, true)) {
    return ok({ url: res.url || url, ...structured, source: "JobPosting data on the page", trusted: true });
  }
  if (CLOSED.test(text)) return stop(url, "This job posting appears to be closed or removed.");
  return fail(url, "The first page read did not include a full job description.");
}

// Opens the page in Chrome or Edge and keeps checking it until the job text appears.
async function fromBrowser(url: string, log: Log, signal?: AbortSignal): Promise<FetchResult> {
  const launch = await browserLaunch();
  if (!launch) return fail(url, "Could not open a browser to finish loading the page. Paste the job description to continue.");
  const browser = await withTimeout(getBrowser(launch), 30000);
  // Each read gets its own private browser profile, so users never share cookies or site data.
  const context = await withTimeout(browser.createBrowserContext(), 15000);
  const page = await withTimeout(context.newPage(), 15000).catch(async (error) => {
    await context.close().catch(() => undefined);
    throw error;
  });
  const started = Date.now();
  const stopped = () => {
    if (signal?.aborted) throw new Error("Stopped.");
  };
  try {
    stopped();
    await page.setUserAgent(await browserUserAgent(browser));
    // WebSocket connections bypass the request filter below, so they are not allowed at all.
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.setBlockedURLs", { urls: ["ws://*", "wss://*"] });
    // No extra request headers here: forcing them onto a page's own data requests breaks some sites (ADP).
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await page.setViewport({ width: 1366, height: 900 });
    await guardRequests(page);
    try {
      await abortable(page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }), signal);
    } catch (error) {
      stopped();
      if (!/timeout/i.test(error instanceof Error ? error.message : "")) throw error;
      log("The page is slow to load. Still waiting for the job text.");
    }
    let last: Awaited<ReturnType<typeof readBrowserPage>> | null = null;
    let best: FetchResult | null = null;
    let previousLength = 0;
    let steady = 0;
    let triedLanding = false;
    while (Date.now() - started < BROWSER_WAIT_MS) {
      // A link that redirects by script (tracking links) lands on another site; that page's source often has the job.
      const landing = page.url();
      if (!triedLanding && /^https?:/i.test(landing) && hostOf(landing) !== hostOf(url)) {
        triedLanding = true;
        const direct = await fromHtml(landing, log, signal).catch(() => null);
        if (direct?.ok && (direct.trusted || usable(direct.text, false))) {
          log(`The link redirected to ${hostOf(landing)}.`);
          return { ...direct, url };
        }
      }
      // Reading fails while the page is navigating (redirects, sign-in walls clearing); try again shortly.
      // A page whose scripts are stuck can leave a read hanging, so each read has its own time limit.
      stopped();
      const extracted = await abortable(withTimeout(readBrowserPage(page), 10000), signal).catch(() => {
        stopped();
        return null;
      });
      if (extracted) {
        last = extracted;
        // A posting link that ends up on the same site without its job ID (a general job list) means the
        // posting was removed; that page would otherwise pass as a description full of other jobs.
        if (lostJobId(url, page.url())) return stop(url, "This link now opens a list of jobs instead of the posting. The posting appears to be closed or removed.");
        const result = browserResult(url, extracted);
        if (result?.trusted) return result;
        if (result) {
          // Many pages render in pieces, so the text is used only once it has stopped growing.
          const length = result.text.length;
          steady = Math.abs(length - previousLength) <= previousLength * 0.02 ? steady + 1 : 0;
          previousLength = length;
          if (!best || length > best.text.length) best = result;
          const words = best.text.split(/\s+/).length;
          if ((steady >= 2 && words >= 350) || (steady >= 4 && Date.now() - started > 35000)) return best;
        } else if (Date.now() - started > 6000 && CLOSED.test(extracted.text)) {
          return stop(url, "This job posting appears to be closed or removed.");
        }
      }
      await sleep(1000, signal);
    }
    if (best) return best;
    if (last && looksBlockedText(last.text)) {
      return fail(url, "This site blocks automated page reads (bot protection). Paste the job description to continue.");
    }
    return fail(url, `The page still did not include a full job description after ${Math.round(BROWSER_WAIT_MS / 1000)} seconds.`);
  } catch (error) {
    if (signal?.aborted) throw error;
    return fail(url, error instanceof Error ? error.message : "The job page did not finish loading.");
  } finally {
    await withTimeout(page.close(), 5000).catch(() => undefined);
    await withTimeout(context.close(), 5000).catch(() => undefined);
  }
}

// Rejects as soon as the job is stopped, without waiting for the browser to finish what it is doing.
function abortable<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("Stopped."));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out.")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function browserResult(url: string, extracted: Awaited<ReturnType<typeof readBrowserPage>>): FetchResult | null {
  const structured = extracted.structured;
  const company = structured?.company || extracted.company;
  const title = structured?.title || pickTitle(extracted.titles.slice(0, 1), extracted.titles.slice(1), [company]);
  const location = structured?.location || extracted.location;
  if (structured && usable(structured.text, false)) {
    return ok({ url, ...structured, text: composeText({ company, title, location, text: structured.text }), source: "JobPosting data after the page loaded", trusted: true });
  }
  // The page or one of its frames, whichever holds the most job text.
  const pageText = usable(extracted.text, false) && !looksBlockedText(extracted.text) ? extracted.text : "";
  const frame = extracted.frames.find((text) => usable(text, false)) || "";
  if (pageText || frame) {
    const fromFrame = frame.length > pageText.length;
    const text = fromFrame ? frame : pageText;
    return ok({ url, company, title, location, text: composeText({ company, title, location, text }), source: fromFrame ? "the job frame on the page" : "the job page after it finished loading" });
  }
  if (structured && usable(structured.text, true)) {
    return ok({ url, ...structured, text: composeText({ company, title, location, text: structured.text }), source: "JobPosting data after the page loaded", trusted: true });
  }
  return null;
}

// Block browser requests (including redirects and subresources) that resolve to private addresses.
async function guardRequests(page: import("puppeteer-core").Page) {
  const checked = new Map<string, Promise<boolean>>();
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url());
    } catch {
      void request.abort().catch(() => undefined);
      return;
    }
    if (parsed.protocol === "data:" || parsed.protocol === "blob:") {
      void request.continue().catch(() => undefined);
      return;
    }
    const key = `${parsed.protocol}//${parsed.host}`;
    if (!checked.has(key)) {
      checked.set(key, assertPublic(parsed.toString()).then(() => true, () => false));
    }
    void checked.get(key)!.then((allowed) => (allowed ? request.continue() : request.abort("blockedbyclient"))).catch(() => undefined);
  });
}

async function readBrowserPage(page: import("puppeteer-core").Page) {
  const main = await readBrowserFrame(page);
  // Some sites (iCIMS and other embedded career pages) put the job in a frame.
  const frames: string[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const text = await frame.evaluate(() => (document.body?.innerText || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()).catch(() => "");
    if (text) frames.push(text.slice(0, 20000));
  }
  frames.sort((a, b) => b.length - a.length);
  // The page's main or article area is used only when it holds the job; otherwise the whole page is read.
  const text = usable(main.rootText, false) ? main.rootText : main.bodyText;
  return { ...main, text: text.slice(0, 20000), frames };
}

function readBrowserFrame(page: import("puppeteer-core").Page) {
  return page.evaluate(() => {
    const postings: { company: string; companyUrl: string; title: string; location: string; text: string }[] = [];
    const orgSite = (org: { url?: string; sameAs?: string | string[] } | undefined) => {
      if (!org) return "";
      const same = Array.isArray(org.sameAs) ? org.sameAs.find((item) => /^https?:\/\//i.test(item)) : org.sameAs;
      if (org.url && /^https?:\/\//i.test(org.url)) return org.url;
      return typeof same === "string" ? same : "";
    };
    const visit = (node: unknown) => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      const type = record["@type"];
      const types = (Array.isArray(type) ? type : [type]).map((item) => String(item || "").toLowerCase());
      if (types.some((item) => item.includes("jobposting"))) {
        const org = record.hiringOrganization as { name?: string; url?: string; sameAs?: string | string[] } | string | undefined;
        const company = typeof org === "string" ? org : org?.name || "";
        const companyUrl = typeof org === "string" ? "" : orgSite(org);
        const place = record.jobLocation as { address?: { addressLocality?: string; addressCountry?: string } } | undefined;
        const location = [place?.address?.addressLocality, place?.address?.addressCountry].filter(Boolean).join(", ");
        const description = String(record.description || "");
        const holder = document.createElement("div");
        holder.innerHTML = description;
        postings.push({ company, companyUrl, title: String(record.title || ""), location, text: holder.innerText || description });
      }
      if (record["@graph"]) visit(record["@graph"]);
    };
    document.querySelectorAll("script[type='application/ld+json']").forEach((script) => {
      try {
        visit(JSON.parse(script.textContent || ""));
      } catch {
        /* ignore broken job metadata */
      }
    });
    const clean = (value: string) => value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const root = document.querySelector("main, article, [role='main']") as HTMLElement | null;
    const heading = document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() || "";
    const site = document.querySelector("meta[property='og:site_name']")?.getAttribute("content") || "";
    const ogTitle = document.querySelector("meta[property='og:title']")?.getAttribute("content") || "";
    return {
      rootText: clean(root?.innerText || ""),
      bodyText: clean(document.body?.innerText || ""),
      titles: [heading, ogTitle, document.title || ""],
      company: site,
      location: "",
      structured: postings[0] || null,
    };
  });
}

type Launch = { executablePath: string; args: string[]; headless: true | "shell" };

// Flags in the serverless Chromium's defaults that switch off same-origin and mixed-content checks; job pages
// come from any site, so they are left out.
const UNSAFE_FLAGS = new Set(["--disable-web-security", "--allow-running-insecure-content", "--disable-site-isolation-trials"]);

// The installed Chrome or Edge; on a Linux server without one (Vercel), the Chromium build made for serverless hosts.
async function browserLaunch(): Promise<Launch | null> {
  const installed = BROWSERS.find((item) => fs.existsSync(item));
  if (installed) return { executablePath: installed, args: [], headless: true };
  if (process.platform !== "linux") return null;
  try {
    const chromium = (await import("@sparticuz/chromium")).default;
    // Those machines cannot run Chrome's sandbox, so its flags include --no-sandbox.
    return { executablePath: await chromium.executablePath(), args: chromium.args.filter((flag) => !UNSAFE_FLAGS.has(flag)), headless: "shell" };
  } catch (error) {
    console.warn("The serverless Chromium could not be prepared.", error);
    return null;
  }
}

async function getBrowser(launch: Launch) {
  // A browser that crashed or was closed is replaced instead of failing every later read.
  if (browserPromise) {
    const current = await browserPromise.catch(() => null);
    if (!current || !current.connected) browserPromise = null;
  }
  if (!browserPromise) {
    // Launched like a normal browser: pages behind "Human Verification" walls treat the automation flag as a bot.
    // Chrome's sandbox stays on where the machine allows it, since it opens pages from any site.
    const launching = puppeteer.launch({
      executablePath: launch.executablePath,
      headless: launch.headless,
      args: [
        ...launch.args,
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        // English pages; Chrome sends the matching Accept-Language header itself.
        "--lang=en-US",
        // Several job pages load at once; without these, pages Chrome treats as background tabs run their scripts slowly.
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });
    browserPromise = launching;
    launching.then(
      (browser) => browser.on("disconnected", () => {
        if (browserPromise === launching) browserPromise = null;
      }),
      () => {
        if (browserPromise === launching) browserPromise = null;
      },
    );
  }
  return browserPromise;
}

// The user agent of the installed browser, without the "HeadlessChrome" marker.
async function browserUserAgent(browser: Browser) {
  const agent = await browser.userAgent().catch(() => UA);
  return agent.replace(/HeadlessChrome/g, "Chrome");
}

function jsonLdJob(html: string) {
  const $ = cheerio.load(html);
  const found: Record<string, unknown>[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      collect(JSON.parse($(el).text()), found);
    } catch {
      /* ignore broken json-ld */
    }
  });
  const job = found[0];
  if (!job) return null;
  const org = job.hiringOrganization as { name?: string; url?: string; sameAs?: string | string[] } | string | undefined;
  const company = typeof org === "string" ? org : org?.name || "";
  const companyUrl = organizationUrl(org);
  const place = job.jobLocation as { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } } | undefined;
  const address = place?.address;
  const location = address ? [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(", ") : "";
  const text = htmlToText(String(job.description || ""));
  return { company, companyUrl, title: String(job.title || ""), location, text: composeText({ company, title: String(job.title || ""), location, text }) };
}

function organizationUrl(org: { url?: string; sameAs?: string | string[] } | string | undefined) {
  if (!org || typeof org === "string") return "";
  const same = Array.isArray(org.sameAs) ? org.sameAs.find((item) => /^https?:\/\//i.test(item)) : org.sameAs;
  if (org.url && /^https?:\/\//i.test(org.url)) return org.url;
  return typeof same === "string" ? same : "";
}

// True when a run of words from the candidate text also appears in the page text.
function sharesText(candidate: string, page: string) {
  const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const pageText = ` ${words(page).join(" ")} `;
  const sample = words(candidate);
  for (let start = 0; start + 8 <= sample.length && start < 200; start += 20) {
    if (pageText.includes(` ${sample.slice(start, start + 8).join(" ")} `)) return true;
  }
  return false;
}

// The longest job description found in data embedded in the page's scripts, if it reads as a real one.
function embeddedJob(html: string) {
  let best = "";
  for (const match of html.matchAll(/"(description|jobDescription|descriptionHtml|jobDescriptionHtml|job_description|externalDescription|requisitionDescription)"\s*:\s*"((?:\\.|[^"\\]){200,})"/g)) {
    try {
      const text = htmlToText(JSON.parse(`"${match[2]}"`));
      if (text.length > best.length) best = text;
    } catch {
      /* not a JSON string */
    }
  }
  if (!best || !usable(best, false)) return null;
  const title = html.match(/"(?:jobTitle|title)"\s*:\s*"([^"\\]{3,120})"/)?.[1] || "";
  return { text: best, title };
}

function collect(node: unknown, found: Record<string, unknown>[]) {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((item) => collect(item, found));
    return;
  }
  if (typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const type = record["@type"];
  const types = (Array.isArray(type) ? type : [type]).map((item) => String(item || "").toLowerCase());
  if (types.some((item) => item.includes("jobposting"))) found.push(record);
  if (record["@graph"]) collect(record["@graph"], found);
}

function visibleText(html: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer, iframe").remove();
  const clean = (value: string) => value.replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  // A main or article area is used only when it holds the job; otherwise the whole page is read.
  for (const selector of [".job-description", "#job-description", "main", "article", "[role='main']"]) {
    const text = clean($(selector).first().text());
    if (usable(text, false)) return text;
  }
  return clean($("body").text());
}

function htmlToText(html: string) {
  if (!html) return "";
  if (!/<[a-z][\s\S]*>/i.test(html)) return decode(html).replace(/[ \t]{2,}/g, " ").trim();
  const $ = cheerio.load(`<div id="root">${html}</div>`);
  $("#root br").replaceWith("\n");
  $("#root p, #root li, #root h1, #root h2, #root h3, #root div").each((_, el) => {
    $(el).prepend("\n");
  });
  $("#root li").each((_, el) => {
    $(el).prepend("• ");
  });
  return decode($("#root").text()).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

function decode(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'");
}

// Section headings that pages sometimes put where the job title belongs.
const GENERIC_TITLE =
  /^(about (the )?(job|role|position|opportunity|team|company|us)|(the )?(job|role|position|opportunity)( (description|details|summary|overview|posting))?|overview|careers?|jobs?|job (openings?|board|search)|open (positions|roles)|apply( now)?|home|welcome|untitled|details|description)$/i;

export function isGenericTitle(value: string) {
  return GENERIC_TITLE.test(value.replace(/[\s:|\-–—]+$/g, "").trim());
}

const JOB_WORD =
  /\b(engineer|developer|programmer|architect|analyst|scientist|designer|manager|director|lead|head|specialist|consultant|administrator|admin|associate|intern|coordinator|officer|technician|representative|advocate|strategist|researcher|writer|editor|accountant|recruiter|sales|marketing|support|operations|product|owner|principal|staff|senior|junior|devops|sre|qa|tester|teacher|nurse|assistant|executive|partner|agent|controller|planner|buyer|trainer|instructor)\b/i;

// The best job title among the candidates. Headings are used whole, since titles such as
// "Engineer - Security" contain dashes; page titles like "Role | Company" are split into parts.
// Candidates that read like a job title win over logos and site names.
function pickTitle(headings: string[], pageTitles: string[] = [], exclude: string[] = []) {
  const skip = new Set(exclude.map((item) => item.trim().toLowerCase()).filter(Boolean));
  const options: string[] = [];
  const add = (value: string) => {
    const title = value.replace(/\s+/g, " ").replace(/\s+(in|at)$/i, "").trim();
    if (title && title.length <= 120 && !isGenericTitle(title) && !skip.has(title.toLowerCase())) options.push(title);
  };
  headings.forEach((heading) => add(String(heading || "")));
  pageTitles.forEach((pageTitle) => String(pageTitle || "").split(/\s[|\-–—]\s|\s\|/).forEach(add));
  return options.find((title) => JOB_WORD.test(title)) || options[0] || "";
}

function composeText({ company, title, location, extra, text }: { company?: string; title?: string; location?: string; extra?: string; text?: string }) {
  return [
    company ? `Company: ${company}` : "",
    title && !isGenericTitle(title) ? `Title: ${title}` : "",
    location ? `Location: ${location}` : "",
    extra ? `Type: ${extra}` : "",
    "",
    text || "",
  ].filter((line, index, all) => line || (index > 0 && all[index - 1])).join("\n").trim();
}

function usable(text: string, trusted: boolean) {
  if (trusted) return String(text || "").trim().split(/\s+/).filter(Boolean).length >= 40;
  // Page text is judged without menus, cookie notices, EEO and benefits text, so a page made only of
  // those (an error page, a careers home page) is not mistaken for a job description.
  const core = removeBoilerplate(String(text || ""), false);
  const words = core.split(/\s+/).filter(Boolean).length;
  return (words >= 100 && JOB_SIGNAL.test(core)) || words >= 400;
}

function looksBlocked(html: string) {
  const text = html.replace(/\s+/g, " ").slice(0, 4000);
  return html.length < 20000 && BLOCKED.test(text);
}

// Bot walls are short pages. Full job pages often mention reCAPTCHA in a footer, which is not a block.
function looksBlockedText(text: string) {
  return BLOCKED.test(text.slice(0, 4000)) && text.trim().split(/\s+/).length < 250;
}

function ok(result: Omit<FetchResult, "ok" | "error">): FetchResult {
  return { ok: true, error: "", ...result, text: result.text.slice(0, 20000) };
}

function fail(url: string, error: string): FetchResult {
  return { ok: false, url, company: "", title: "", location: "", text: "", source: "", error };
}

// True when the original link names a job ID (a long number or a UUID) that the final page of the same
// site no longer has in its address.
function lostJobId(original: string, final: string) {
  if (!/^https?:/i.test(final) || hostOf(original) !== hostOf(final)) return false;
  const ids = new URL(original).pathname.match(/\d{6,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
  if (!ids.length) return false;
  const landing = decodeURIComponent(new URL(final).pathname + new URL(final).search).toLowerCase();
  return !ids.some((id) => landing.includes(id.toLowerCase()));
}

function hostOf(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

// A failure that no other read method can fix.
function stop(url: string, error: string): FetchResult {
  return { ...fail(url, error), final: true };
}

function titleCase(value: string) {
  return String(value || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function getJson(url: string, signal?: AbortSignal, extra: { method?: string; body?: string } = {}) {
  const res = await fetchText(url, signal, { Accept: "application/json" }, extra);
  let data: Record<string, any> | null = null;
  try {
    data = JSON.parse(res.text);
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

// Pages larger than this are cut off; job pages are far smaller, and this keeps huge files out of memory.
const MAX_BYTES = 5 * 1024 * 1024;

async function fetchText(url: string, signal?: AbortSignal, headers: Record<string, string> = {}, extra: { method?: string; body?: string } = {}) {
  const timeout = AbortSignal.timeout(25000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let current = url;
  let method = extra.method || "GET";
  let body = extra.body;
  // Follow redirects by hand so every hop is checked before it is requested.
  for (let hop = 0; hop <= 5; hop += 1) {
    await assertPublic(current);
    const response = await request(current, method, body, { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...headers }, combined);
    if (response.status >= 300 && response.status < 400 && response.location) {
      current = new URL(response.location, current).toString();
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    return { status: response.status, url: current, text: response.text, contentType: response.contentType };
  }
  throw new Error("The job link redirected too many times.");
}

// One HTTP request. The address is checked again at the moment of connecting, so a site cannot pass the
// check with a public address and then answer the real connection with a private one (DNS rebinding).
// The body is limited in size, decompressed, and decoded in the page's declared character set.
function request(url: string, method: string, body: string | undefined, headers: Record<string, string>, signal: AbortSignal) {
  return new Promise<{ status: number; location: string; contentType: string; text: string }>((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "https:" ? https : http;
    const req = client.request(target, {
      method,
      headers: { "Accept-Encoding": "gzip, deflate, br", ...headers, ...(body ? { "Content-Length": Buffer.byteLength(body), "Content-Type": "application/json" } : {}) },
      lookup: publicLookup,
      signal,
    });
    req.on("error", (error) => reject(signal.aborted && signal.reason instanceof Error ? signal.reason : error));
    req.on("response", (res) => {
      const status = res.statusCode || 0;
      const contentType = String(res.headers["content-type"] || "");
      const location = String(res.headers.location || "");
      if ((status >= 300 && status < 400) || !readableType(contentType)) {
        res.resume();
        resolve({ status, location, contentType, text: "" });
        return;
      }
      const encoding = String(res.headers["content-encoding"] || "").toLowerCase();
      const stream = encoding.includes("br") ? res.pipe(zlib.createBrotliDecompress()) : encoding.includes("gzip") ? res.pipe(zlib.createGunzip()) : encoding.includes("deflate") ? res.pipe(zlib.createInflate()) : res;
      const chunks: Buffer[] = [];
      let size = 0;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        const bytes = Buffer.concat(chunks);
        resolve({ status, location, contentType, text: decodeBody(bytes, contentType) });
      };
      stream.on("data", (chunk: Buffer) => {
        if (finished) return;
        chunks.push(chunk);
        size += chunk.length;
        if (size > MAX_BYTES) {
          finish();
          res.destroy();
        }
      });
      stream.on("end", finish);
      stream.on("error", (error) => (finished ? undefined : size ? finish() : reject(error)));
    });
    if (body) req.write(body);
    req.end();
  });
}

// Only text-like responses are read; images, videos, archives and other files are skipped.
function readableType(contentType: string) {
  if (!contentType) return true;
  return /text\/|html|xml|json|javascript|application\/pdf/i.test(contentType);
}

function decodeBody(bytes: Buffer, contentType: string) {
  if (/application\/pdf/i.test(contentType)) return "";
  const declared = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] || /<meta[^>]+charset=["']?([\w-]+)/i.exec(bytes.subarray(0, 4096).toString("latin1"))?.[1] || "utf-8";
  try {
    return new TextDecoder(declared).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function publicLookup(hostname: string, options: dns.LookupOptions, callback: (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, "");
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((item) => privateIp(item.address))) {
      return callback(Object.assign(new Error("That address is not a public job page."), { code: "EPRIVATE" }), "");
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

async function assertPublic(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only public http and https job links are supported.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("That address is not a public job page.");
  }
  if (net.isIP(host) && privateIp(host)) throw new Error("That address is not a public job page.");
  if (!net.isIP(host)) {
    const records = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Could not look up that job site's address.")), 8000)),
    ]);
    if (!records.length || records.some((record) => privateIp(record.address))) {
      throw new Error("That address is not a public job page.");
    }
  }
}

// Addresses that are not on the public internet: private networks, this machine, link-local
// (including cloud metadata), carrier NAT, documentation, benchmarking, multicast and reserved ranges.
const BLOCKED_V4 = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED_V4.addSubnet(network, prefix, "ipv4");

const BLOCKED_V6 = new net.BlockList();
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["100::", 64], ["2001::", 32], ["2001:db8::", 32], ["64:ff9b:1::", 48],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) BLOCKED_V6.addSubnet(network, prefix, "ipv6");

function privateIp(ip: string) {
  const value = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (net.isIPv4(value)) return BLOCKED_V4.check(value, "ipv4");
  if (!net.isIPv6(value)) return true;
  // IPv6 forms that carry an IPv4 address are judged by that IPv4 address.
  const embedded = embeddedIPv4(ipv6Bytes(value));
  if (embedded) return BLOCKED_V4.check(embedded, "ipv4");
  return BLOCKED_V6.check(value, "ipv6");
}

function ipv6Bytes(value: string) {
  let text = value;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split(".").map(Number);
    text = text.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  const bytes: number[] = [];
  for (const group of groups) {
    const number = parseInt(group || "0", 16);
    bytes.push((number >> 8) & 255, number & 255);
  }
  return bytes;
}

function embeddedIPv4(bytes: number[]) {
  const zero = (from: number, to: number) => bytes.slice(from, to).every((byte) => byte === 0);
  const v4 = (offset: number) => bytes.slice(offset, offset + 4).join(".");
  if (zero(0, 10) && bytes[10] === 255 && bytes[11] === 255) return v4(12); // ::ffff:a.b.c.d (mapped)
  if (zero(0, 12) && !(zero(12, 15) && bytes[15] <= 1)) return v4(12); // ::a.b.c.d (compatible)
  if (bytes[0] === 0 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zero(4, 12)) return v4(12); // 64:ff9b::/96 (NAT64)
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return v4(2); // 2002::/16 (6to4)
  return "";
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Stopped."));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}
