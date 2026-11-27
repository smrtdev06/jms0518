import dns from "node:dns";
import { lookup } from "node:dns/promises";
import net from "node:net";

// Job links are fetched on the server, so every address they point to is checked first: a link (or one of its
// redirects, or a browser subresource) must not reach this machine, the local network or cloud metadata.

export function publicLookup(hostname: string, options: dns.LookupOptions, callback: (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) {
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

export async function assertPublic(value: string) {
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

export function privateIp(ip: string) {
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

