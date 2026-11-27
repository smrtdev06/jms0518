// Turns a Gmail API message (format=full) into the plain fields the email analysis needs. No I/O, so it is unit tested.

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailPart;
};

export type EmailFields = {
  id: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  to: string;
  receivedAt: Date;
  body: string;
};

/** The longest email body sent to the AI; long emails are mostly quoted history, footers and legal text. */
const MAX_BODY_CHARS = 6000;

export function readMessage(message: GmailMessage): EmailFields {
  const headers = message.payload?.headers ?? [];
  const header = (name: string) => headers.find((h) => h.name.toLowerCase() === name)?.value?.trim() ?? "";
  const { name: fromName, email: fromEmail } = parseAddress(header("from"));
  const internal = Number(message.internalDate);
  const dated = Date.parse(header("date"));
  const receivedAt = new Date(Number.isFinite(internal) && internal > 0 ? internal : Number.isFinite(dated) ? dated : Date.now());
  const text = bodyText(message.payload) || decodeEntities(message.snippet ?? "");
  return {
    id: message.id,
    subject: header("subject"),
    fromName,
    fromEmail,
    to: header("to"),
    receivedAt,
    body: clip(text, MAX_BODY_CHARS),
  };
}

/** `"Jane Doe" <jane@acme.com>` → { name: "Jane Doe", email: "jane@acme.com" }. */
export function parseAddress(value: string) {
  const angle = /^(.*?)<([^>]+)>\s*$/.exec(value);
  if (angle) return { name: angle[1].trim().replace(/^"|"$/g, "").trim(), email: angle[2].trim().toLowerCase() };
  const email = /[^\s<>"]+@[^\s<>"]+/.exec(value)?.[0]?.toLowerCase() ?? "";
  return { name: "", email };
}

/** The readable text of the message: its text/plain parts, or its HTML parts turned into text. */
export function bodyText(payload: GmailPart | undefined): string {
  if (!payload) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (part: GmailPart) => {
    if (part.filename) return; // attachments
    const type = (part.mimeType ?? "").toLowerCase();
    if (part.body?.data && type === "text/plain") plain.push(decodeBase64Url(part.body.data));
    else if (part.body?.data && type === "text/html") html.push(decodeBase64Url(part.body.data));
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  const text = plain.join("\n\n").trim() || html.map(htmlToText).join("\n\n").trim();
  return tidy(text);
}

function decodeBase64Url(data: string) {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** A rough HTML → text conversion: enough for the AI to read, keeping link targets (scheduling links). */
export function htmlToText(html: string) {
  const text = html
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const inner = label.replace(/<[^>]+>/g, "").trim();
      return /^https?:/i.test(href) && !inner.includes(href) ? `${inner} (${href})` : inner;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text);
}

function decodeEntities(text: string) {
  const named: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "..." };
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function tidy(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‍﻿­͏]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clip(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max)}\n[... the rest of the email is cut]`;
}
