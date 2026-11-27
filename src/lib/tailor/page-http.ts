import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { assertPublic, publicLookup } from "./public-address";

// HTTP for job pages and job-board APIs: every hop is checked to be a public address (public-address.ts),
// redirects are followed by hand, and bodies are size-limited, decompressed and decoded.

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function getJson(url: string, signal?: AbortSignal, extra: { method?: string; body?: string } = {}) {
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
export const MAX_BYTES = 5 * 1024 * 1024;

export async function fetchText(url: string, signal?: AbortSignal, headers: Record<string, string> = {}, extra: { method?: string; body?: string } = {}) {
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
export function request(url: string, method: string, body: string | undefined, headers: Record<string, string>, signal: AbortSignal) {
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
export function readableType(contentType: string) {
  if (!contentType) return true;
  return /text\/|html|xml|json|javascript|application\/pdf/i.test(contentType);
}

export function decodeBody(bytes: Buffer, contentType: string) {
  if (/application\/pdf/i.test(contentType)) return "";
  const declared = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] || /<meta[^>]+charset=["']?([\w-]+)/i.exec(bytes.subarray(0, 4096).toString("latin1"))?.[1] || "utf-8";
  try {
    return new TextDecoder(declared).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function sleep(ms: number, signal?: AbortSignal) {
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
