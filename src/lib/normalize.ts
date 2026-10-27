const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|ref$|refid$|trk$|source$)/i;

/** Normalizes a job URL so trivially different links (tracking params, trailing slash, case of host) match. */
export function normalizeJobLink(link: string): string {
  const trimmed = link.trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const params = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMS.test(key))
      .sort(([a], [b]) => a.localeCompare(b));
    url.search = new URLSearchParams(params).toString();
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.hostname}${pathname}${url.search}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

const COMPANY_SUFFIXES =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|sa|ag|bv|pty|holdings)\b\.?/g;

/** "Cato Networks, Inc." and "cato networks" both become "cato networks". */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
