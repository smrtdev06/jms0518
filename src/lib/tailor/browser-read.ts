import puppeteer, { type Browser } from "puppeteer-core";
import fs from "node:fs";
import { assertPublic } from "./public-address";
import { UA, sleep } from "./page-http";
import { CLOSED, type FetchResult, type Log, type ReadHtml, composeText, fail, hostOf, looksBlockedText, lostJobId, ok, pickTitle, stop, usable } from "./job-page";

// Reads script-heavy job pages in Chrome / Edge (or the serverless Chromium on Vercel), with every request of
// the page checked to be a public address.

// How long a browser read keeps checking a slow page for the job text.
export const BROWSER_WAIT_MS = 60000;

export const BROWSERS = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter((item): item is string => Boolean(item));

export let browserPromise: Promise<Browser> | null = null;

// Opens the page in Chrome or Edge and keeps checking it until the job text appears. `readHtml` reads a page
// without the browser; it is tried once on the page a script redirect lands on.
export async function fromBrowser(url: string, log: Log, signal: AbortSignal | undefined, readHtml: ReadHtml): Promise<FetchResult> {
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
        const direct = await readHtml(landing, log, signal).catch(() => null);
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
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal) {
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

export function withTimeout<T>(promise: Promise<T>, ms: number) {
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

export function browserResult(url: string, extracted: Awaited<ReturnType<typeof readBrowserPage>>): FetchResult | null {
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
export async function guardRequests(page: import("puppeteer-core").Page) {
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

export async function readBrowserPage(page: import("puppeteer-core").Page) {
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

export function readBrowserFrame(page: import("puppeteer-core").Page) {
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

export type Launch = { executablePath: string; args: string[]; headless: true | "shell" };

// Flags in the serverless Chromium's defaults that switch off same-origin and mixed-content checks; job pages
// come from any site, so they are left out.
export const UNSAFE_FLAGS = new Set(["--disable-web-security", "--allow-running-insecure-content", "--disable-site-isolation-trials"]);

// The installed Chrome or Edge; on a Linux server without one (Vercel), the Chromium build made for serverless hosts.
export async function browserLaunch(): Promise<Launch | null> {
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

export async function getBrowser(launch: Launch) {
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
export async function browserUserAgent(browser: Browser) {
  const agent = await browser.userAgent().catch(() => UA);
  return agent.replace(/HeadlessChrome/g, "Chrome");
}
