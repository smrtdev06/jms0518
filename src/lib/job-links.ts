import { timingSafeEqual } from "node:crypto";
import { query } from "./db";
import { HttpError } from "./errors";
import { isHttpUrl } from "./normalize";

// Job links sent by the job-finding bot (POST /api/job-links), kept in their own table (job_links).

const MAX_LINKS = 5000;
const MAX_LINK_LENGTH = 2000;
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

/** The bot signs in with JOB_LINKS_API_KEY: "Authorization: Bearer <key>" or "X-API-Key: <key>". */
export function assertBotKey(request: Request) {
  const expected = process.env.JOB_LINKS_API_KEY?.trim();
  if (!expected) throw new HttpError(503, "The job links API is not configured (set JOB_LINKS_API_KEY)");
  const header = request.headers.get("authorization") ?? "";
  const given = (header.match(/^Bearer\s+(.+)$/i)?.[1] ?? request.headers.get("x-api-key") ?? "").trim();
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "Invalid API key");
}

/** Every http(s) link in the text, in order, without duplicates. Punctuation that ends a sentence is not part of a link. */
export function extractLinks(text: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const match of text.match(URL_PATTERN) ?? []) {
    const link = trimLink(match);
    if (link.length > MAX_LINK_LENGTH || !isHttpUrl(link) || seen.has(link)) continue;
    seen.add(link);
    links.push(link);
  }
  return links;
}

// "(https://x.com/jobs/1)." -> "https://x.com/jobs/1"; a closing bracket that belongs to the link stays.
function trimLink(raw: string) {
  let link = raw;
  for (;;) {
    const last = link.at(-1);
    if (last && ".,;:!?'\"*".includes(last)) link = link.slice(0, -1);
    else if (last === ")" && count(link, "(") < count(link, ")")) link = link.slice(0, -1);
    else if (last === "]" && count(link, "[") < count(link, "]")) link = link.slice(0, -1);
    else return link;
  }
}

const count = (text: string, char: string) => text.split(char).length - 1;

/** Saves the links (in the order of the text); a link that is already in the table is skipped. Returns the counts. */
export async function saveLinks(links: string[]) {
  if (links.length > MAX_LINKS) throw new HttpError(413, `Send at most ${MAX_LINKS} links at once`);
  if (!links.length) return { saved: 0, skipped: 0 };
  const rows = await query(
    `INSERT INTO job_links (job_link) SELECT link FROM unnest($1::text[]) WITH ORDINALITY AS t(link, n) ORDER BY n
     ON CONFLICT (job_link) DO NOTHING
     RETURNING id`,
    [links],
  );
  return { saved: rows.length, skipped: links.length - rows.length };
}
