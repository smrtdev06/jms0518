import * as cheerio from "cheerio";
import { assertPublic } from "./public-address";
import { CLOSED, type FetchResult, type Log, composeText, fail, looksBlocked, lostJobId, ok, pickTitle, stop, titleCase, usable } from "./job-page";
import { fromBrowser } from "./browser-read";
import { fetchText, getJson, readableType } from "./page-http";

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
    const second = await fromBrowser(target, log, signal, fromHtml);
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
