// The address this site is being visited at (e.g. http://localhost:3000 or https://jms0518.vercel.app), from the
// request headers. Behind a proxy (Vercel and most hosts) the original host and scheme are in X-Forwarded-Host /
// X-Forwarded-Proto; otherwise the Host header is used.

type HeaderSource = { get(name: string): string | null };

export function siteOrigin(headers: HeaderSource, fallbackUrl?: string) {
  const first = (value: string | null) => value?.split(",")[0]?.trim() || "";
  const host = first(headers.get("x-forwarded-host")) || first(headers.get("host"));
  if (!host) return fallbackUrl ? new URL(fallbackUrl).origin : "http://localhost:3000";
  const local = /^(localhost|127\.|\[::1\])/.test(host);
  const proto = first(headers.get("x-forwarded-proto")) || (local ? "http" : "https");
  return `${proto === "http" ? "http" : "https"}://${host}`;
}

/** A path ("/api/gmail/callback") or a full URL, made absolute against this site's address. */
export function siteUrl(pathOrUrl: string, origin: string) {
  return new URL(pathOrUrl, `${origin}/`).toString();
}
