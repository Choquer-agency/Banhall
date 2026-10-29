/**
 * Reading a company's website into text (owner, 2026-10-29). Only the
 * company's own address is fetched: its home page and at most one "about"
 * page it links to. No AI call and no web search.
 *
 * Pure: the network and DNS come in as `deps`, so every rule here is tested
 * with both stubbed (`websiteRead.test.ts`). The Node action
 * (`convex/companyWebsiteNode.ts`) supplies the real ones, and checks the
 * address again as it connects.
 *
 * Safety: http and https on their usual ports only; a host that is or
 * resolves to a loopback, private, link-local, shared, multicast, reserved or
 * cloud metadata address is refused, before every request and after every
 * redirect (at most 3); one deadline of 10 seconds for the whole read; at
 * most 2 MB downloaded per page; text/html only.
 */

export const WEBSITE_READ_TIMEOUT_MS = 10_000;
export const WEBSITE_MAX_BYTES = 2 * 1024 * 1024;
export const WEBSITE_MAX_REDIRECTS = 3;
export const WEBSITE_MAX_TEXT_CHARS = 50_000;
/** Below this much time left, the about page is not fetched. */
const ABOUT_MIN_TIME_MS = 1_000;

export type WebsitePage = {
  status: number;
  /** The Location header of a redirect, if any. */
  location: string | null;
  contentType: string | null;
  /** The decoded body, up to the byte cap. */
  body: string;
  /** More than `maxBytes` arrived; the body is cut. */
  tooLarge: boolean;
};

export type WebsiteDeps = {
  /** Every address a host name resolves to (an IP literal resolves to itself). */
  lookup: (hostname: string) => Promise<string[]>;
  /** One request, never following redirects. Throws on a network error or when `timeoutMs` runs out. */
  fetchPage: (url: URL, options: { timeoutMs: number; maxBytes: number }) => Promise<WebsitePage>;
  now: () => number;
};

export type WebsiteReadResult =
  | { ok: true; text: string; title: string | null; pages: string[] }
  | { ok: false; reason: string };

/** Why a read failed, in words the company page shows after "The website could not be read: ". */
export const WEBSITE_READ_REASONS = {
  notAllowed: "its address points inside a private network, which is not allowed.",
  unreachable: "it could not be reached.",
  timeout: "it did not answer within 10 seconds.",
  tooLarge: "its page is larger than 2 MB.",
  notHtml: "it did not send a web page.",
  redirects: "it sent more than 3 redirects.",
  status: "it answered with an error.",
  empty: "its page has no text to read.",
} as const;

class ReadRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

// ─── Addresses ──────────────────────────────────────────────────────────────

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? numbers : null;
}

function blockedIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // shared (carrier NAT)
    (a === 169 && b === 254) || // link-local, cloud metadata (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // protocol assignments, documentation
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) || // documentation
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Expands an IPv6 address to its eight 16-bit groups, or null. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  // A dotted IPv4 tail ("::ffff:127.0.0.1") becomes two groups.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = ipv4Parts(tail);
    if (!v4) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":") : []);
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

function blockedIpv6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];
  const zeroTo = (n: number) => groups.slice(0, n).every((g) => g === 0);
  if (zeroTo(8)) return true; // unspecified
  if (zeroTo(7) && g7 === 1) return true; // loopback
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64
  // (64:ff9b::a.b.c.d): judge the IPv4 address inside.
  const embedded = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
  if (zeroTo(5) && (g5 === 0xffff || g5 === 0)) return blockedIpv4(embedded);
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return blockedIpv4(embedded);
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local (fc00::/7), including fd00:ec2::254
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  return false;
}

/** Whether a resolved address may not be fetched. Anything that does not parse is refused. */
export function isBlockedAddress(address: string): boolean {
  const v4 = ipv4Parts(address);
  if (v4) return blockedIpv4(v4);
  const v6 = ipv6Groups(address);
  return v6 ? blockedIpv6(v6) : true;
}

/** Host names that name the machine or a private network, refused before any lookup. */
function blockedHostName(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata" ||
    host === "metadata.google.internal"
  );
}

/** Refuses a URL that may not be fetched: its scheme, port, credentials, name or any address it resolves to. */
async function checkAddress(url: URL, deps: WebsiteDeps): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ReadRefused(WEBSITE_READ_REASONS.notAllowed);
  if (url.username || url.password) throw new ReadRefused(WEBSITE_READ_REASONS.notAllowed);
  if (url.port && url.port !== "80" && url.port !== "443") throw new ReadRefused(WEBSITE_READ_REASONS.notAllowed);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (blockedHostName(hostname)) throw new ReadRefused(WEBSITE_READ_REASONS.notAllowed);
  let addresses: string[];
  try {
    addresses = await deps.lookup(hostname);
  } catch {
    throw new ReadRefused(WEBSITE_READ_REASONS.unreachable);
  }
  if (addresses.length === 0) throw new ReadRefused(WEBSITE_READ_REASONS.unreachable);
  if (addresses.some(isBlockedAddress)) throw new ReadRefused(WEBSITE_READ_REASONS.notAllowed);
}

// ─── Fetching ───────────────────────────────────────────────────────────────

/** Fetches one page, checking the address before each request and following at most 3 redirects. */
async function fetchHtml(start: URL, deps: WebsiteDeps, deadline: number): Promise<{ url: URL; html: string }> {
  let url = start;
  for (let hop = 0; ; hop++) {
    await checkAddress(url, deps);
    const left = deadline - deps.now();
    if (left <= 0) throw new ReadRefused(WEBSITE_READ_REASONS.timeout);
    let page: WebsitePage;
    try {
      page = await deps.fetchPage(url, { timeoutMs: left, maxBytes: WEBSITE_MAX_BYTES });
    } catch (error) {
      if (error instanceof ReadRefused) throw error;
      throw new ReadRefused(deps.now() >= deadline ? WEBSITE_READ_REASONS.timeout : WEBSITE_READ_REASONS.unreachable);
    }
    if (page.status >= 300 && page.status < 400 && page.location) {
      if (hop >= WEBSITE_MAX_REDIRECTS) throw new ReadRefused(WEBSITE_READ_REASONS.redirects);
      try {
        url = new URL(page.location, url);
      } catch {
        throw new ReadRefused(WEBSITE_READ_REASONS.unreachable);
      }
      continue;
    }
    if (page.status < 200 || page.status >= 300) throw new ReadRefused(WEBSITE_READ_REASONS.status);
    const type = (page.contentType ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "text/html") throw new ReadRefused(WEBSITE_READ_REASONS.notHtml);
    if (page.tooLarge) throw new ReadRefused(WEBSITE_READ_REASONS.tooLarge);
    return { url, html: page.body };
  }
}

// ─── Text ───────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** The page's title, or null. */
export function htmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match ? decodeEntities(match[1]!).replace(/\s+/g, " ").trim() : "";
  return title || null;
}

/**
 * The readable text of a page: scripts, styles, forms and the navigation,
 * header and footer boilerplate taken out, blocks on their own lines,
 * entities decoded, blank runs collapsed.
 */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|form|nav|header|footer|aside)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|main|li|ul|ol|tr|table|h[1-6]|blockquote|dd|dt|figure|figcaption)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * The first link to an "about" page on the same site (the address or the
 * link's words say "about"), or null.
 */
export function findAboutLink(html: string, base: URL): URL | null {
  const sameSite = (url: URL) => url.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
  const links = html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of links) {
    const href = decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim();
    const words = htmlToText(match[4] ?? "").toLowerCase();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    if (!sameSite(url)) continue;
    url.hash = "";
    if (url.toString() === base.toString()) continue;
    if (/about/i.test(url.pathname) || /\babout\b/.test(words)) return url;
  }
  return null;
}

// ─── The read ───────────────────────────────────────────────────────────────

/**
 * Reads a company's website: its home page, and the first about page it
 * links to on the same site when time is left. The text starts with where
 * it came from and is cut at WEBSITE_MAX_TEXT_CHARS.
 */
export async function readWebsite(address: string, deps: WebsiteDeps): Promise<WebsiteReadResult> {
  let start: URL;
  try {
    start = new URL(address);
  } catch {
    return { ok: false, reason: WEBSITE_READ_REASONS.notAllowed };
  }
  const deadline = deps.now() + WEBSITE_READ_TIMEOUT_MS;
  try {
    const home = await fetchHtml(start, deps, deadline);
    const homeText = htmlToText(home.html);
    if (!homeText) return { ok: false, reason: WEBSITE_READ_REASONS.empty };
    const title = htmlTitle(home.html);
    const sections = [`# ${title ?? "Home page"}\n${home.url.toString()}\n\n${homeText}`];
    const pages = [home.url.toString()];
    const about = findAboutLink(home.html, home.url);
    if (about && deadline - deps.now() >= ABOUT_MIN_TIME_MS) {
      try {
        const page = await fetchHtml(about, deps, deadline);
        const aboutText = htmlToText(page.html);
        if (aboutText) {
          sections.push(`# ${htmlTitle(page.html) ?? "About"}\n${page.url.toString()}\n\n${aboutText}`);
          pages.push(page.url.toString());
        }
      } catch {
        // The about page is a bonus: the home page alone still counts.
      }
    }
    const text = sections.join("\n\n").slice(0, WEBSITE_MAX_TEXT_CHARS);
    return { ok: true, text, title, pages };
  } catch (error) {
    if (error instanceof ReadRefused) return { ok: false, reason: error.reason };
    return { ok: false, reason: WEBSITE_READ_REASONS.unreachable };
  }
}
