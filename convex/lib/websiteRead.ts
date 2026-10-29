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
 * redirect (at most 3); one deadline of 10 seconds for the whole read
 * (lookups, requests and parsing); at most 2 MB downloaded and 512 KB of
 * HTML parsed per page; text/html only.
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
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
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
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d),
  // IPv4-translated (::ffff:0:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d): judge
  // the IPv4 address inside.
  const embedded = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
  if (zeroTo(5) && (g5 === 0xffff || g5 === 0)) return blockedIpv4(embedded);
  if (zeroTo(4) && g4 === 0xffff && g5 === 0) return blockedIpv4(embedded);
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return blockedIpv4(embedded);
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return true; // local-use NAT64 (64:ff9b:1::/48)
  if (g0 === 0x2002) return true; // 6to4, which can carry any IPv4 address
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // discard-only (100::/64)
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

/** `promise`, or a timeout refusal once `deadline` passes first. */
async function beforeDeadline<T>(promise: Promise<T>, deps: WebsiteDeps, deadline: number): Promise<T> {
  const left = deadline - deps.now();
  if (left <= 0) throw new ReadRefused(WEBSITE_READ_REASONS.timeout);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ReadRefused(WEBSITE_READ_REASONS.timeout)), left);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Refuses a URL that may not be fetched: its scheme, port, credentials, name or any address it resolves to. */
async function checkAddress(url: URL, deps: WebsiteDeps, deadline: number): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ReadRefused(WEBSITE_READ_REASONS.notAllowed);
  if (url.username || url.password) throw new ReadRefused(WEBSITE_READ_REASONS.notAllowed);
  if (url.port && url.port !== "80" && url.port !== "443") throw new ReadRefused(WEBSITE_READ_REASONS.notAllowed);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (blockedHostName(hostname)) throw new ReadRefused(WEBSITE_READ_REASONS.notAllowed);
  let addresses: string[];
  try {
    addresses = await beforeDeadline(deps.lookup(hostname), deps, deadline);
  } catch (error) {
    if (error instanceof ReadRefused) throw error;
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
    await checkAddress(url, deps, deadline);
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
//
// One linear pass over the page (review round 1: the regex strippers took
// quadratic time on a page of "<", minutes for 2 MB). Every search jumps
// forward with indexOf and nothing is scanned twice, so 2 MB of any input
// parses in well under a second; only the first MAX_HTML_CHARS are parsed.

/** HTML parsed per page: a web page's text sits well within it. */
export const MAX_HTML_CHARS = 512 * 1024;
/** Attribute text read from one tag (for a link's href). */
const MAX_TAG_ATTRIBUTE_CHARS = 2_000;
const MAX_TITLE_CHARS = 300;
const MAX_LINKS = 500;

/**
 * Jumped over with what they hold: scripts and styles, embedded documents
 * and graphics, and form controls. A form itself stays (ASP.NET puts the
 * whole page in one).
 */
const SKIPPED = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "math",
  "iframe",
  "object",
  "canvas",
  "select",
  "textarea",
  "button",
]);
/**
 * Navigation, footer and aside boilerplate: their text is left out, but
 * their links are still read (the about page is usually linked from the
 * navigation). A header stays, only the navigation inside it going.
 */
const QUIET = new Set(["nav", "footer", "aside"]);
const BLOCKS = new Set([
  "p", "div", "section", "article", "main", "header", "li", "ul", "ol", "tr", "table",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "dd", "dt", "dl", "figure", "figcaption", "form", "address",
]);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isNameChar(code: number): boolean {
  return isLetter(code) || (code >= 48 && code <= 57) || code === 45;
}

/** Blank runs collapsed, one block a line. */
function tidyLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v\r ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export type ParsedPage = { title: string | null; text: string; links: { href: string; text: string }[] };

/**
 * A page's title, readable text and links, in one pass: the parts in
 * SKIPPED jumped over, the QUIET parts' text left out (their links kept),
 * the head's text left out but its title kept, blocks on their own lines,
 * entities decoded.
 */
export function parseHtml(input: string): ParsedPage {
  const html = input.length > MAX_HTML_CHARS ? input.slice(0, MAX_HTML_CHARS) : input;
  // ASCII-only lowercase keeps every index the same as `html`.
  const lower = html.replace(/[A-Z]+/g, (run) => run.toLowerCase());
  const out: string[] = [];
  const titleParts: string[] = [];
  const links: { href: string; text: string }[] = [];
  let link: { href: string; parts: string[] } | null = null;
  let inHead = false;
  let inTitle = false;
  let titleLength = 0;
  let quiet = 0;

  const emit = (raw: string) => {
    if (!raw) return;
    const text = decodeEntities(raw);
    if (inTitle) {
      if (titleLength < MAX_TITLE_CHARS) {
        titleParts.push(text);
        titleLength += text.length;
      }
      return;
    }
    if (inHead) return;
    if (link) link.parts.push(text);
    if (quiet === 0) out.push(text);
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      emit(html.slice(i));
      break;
    }
    if (lt > i) emit(html.slice(i, lt));
    i = lt;
    if (html.startsWith("<!--", i)) {
      const close = html.indexOf("-->", i + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    const bang = html.charCodeAt(i + 1);
    if (bang === 33 || bang === 63) {
      // <!doctype ...>, <?xml ...?>
      const gt = html.indexOf(">", i + 2);
      i = gt === -1 ? html.length : gt + 1;
      continue;
    }
    let j = i + 1;
    const closing = html.charCodeAt(j) === 47;
    if (closing) j += 1;
    if (!isLetter(html.charCodeAt(j))) {
      // A "<" that starts no tag is text.
      emit("<");
      i += 1;
      continue;
    }
    let k = j;
    while (k < html.length && isNameChar(html.charCodeAt(k))) k += 1;
    const name = lower.slice(j, k);
    const gt = html.indexOf(">", k);
    if (gt === -1) break; // An unclosed tag ends the page.
    i = gt + 1;

    if (!closing && SKIPPED.has(name)) {
      if (html.charCodeAt(gt - 1) === 47) continue; // <svg ... />
      const close = lower.indexOf(`</${name}`, i);
      if (close === -1) break;
      const closeGt = html.indexOf(">", close);
      i = closeGt === -1 ? html.length : closeGt + 1;
      continue;
    }
    if (QUIET.has(name)) {
      if (closing) quiet = Math.max(0, quiet - 1);
      else if (html.charCodeAt(gt - 1) !== 47) quiet += 1;
      continue;
    }
    if (name === "head") {
      inHead = !closing;
      if (closing) inTitle = false;
      continue;
    }
    if (name === "body") {
      inHead = false;
      inTitle = false;
      continue;
    }
    if (name === "title") {
      inTitle = !closing;
      continue;
    }
    if (name === "br") {
      emit("\n");
      continue;
    }
    if (name === "a") {
      if (closing) {
        if (link && links.length < MAX_LINKS) links.push({ href: link.href, text: tidyLines(link.parts.join("")) });
        link = null;
      } else {
        const attributes = html.slice(k, Math.min(gt, k + MAX_TAG_ATTRIBUTE_CHARS));
        const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attributes);
        link = href ? { href: decodeEntities(href[1] ?? href[2] ?? href[3] ?? "").trim(), parts: [] } : null;
      }
      continue;
    }
    if (BLOCKS.has(name)) out.push("\n");
  }

  const title = tidyLines(titleParts.join(" ")).replace(/\n/g, " ").slice(0, MAX_TITLE_CHARS);
  return { title: title || null, text: tidyLines(out.join("")), links };
}

/** The page's title, or null. */
export function htmlTitle(html: string): string | null {
  return parseHtml(html).title;
}

/** The readable text of a page (`parseHtml`). */
export function htmlToText(html: string): string {
  return parseHtml(html).text;
}

/**
 * The first link to an "about" page on the same site (the address or the
 * link's words say "about"), or null.
 */
export function findAboutLink(page: string | ParsedPage, base: URL): URL | null {
  const parsed = typeof page === "string" ? parseHtml(page) : page;
  const sameSite = (url: URL) => url.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
  for (const { href, text } of parsed.links) {
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
    if (/about/i.test(url.pathname) || /\babout\b/i.test(text)) return url;
  }
  return null;
}

// ─── The read ───────────────────────────────────────────────────────────────

/**
 * Reads a company's website: its home page, and the first about page it
 * links to on the same site when time is left. The text starts with where
 * it came from and is cut at WEBSITE_MAX_TEXT_CHARS. One deadline
 * (`timeoutMs`, 10 seconds) covers every lookup, request and parse; the
 * about page is skipped when less than a second is left.
 */
export async function readWebsite(
  address: string,
  deps: WebsiteDeps,
  options: { timeoutMs?: number } = {}
): Promise<WebsiteReadResult> {
  let start: URL;
  try {
    start = new URL(address);
  } catch {
    return { ok: false, reason: WEBSITE_READ_REASONS.notAllowed };
  }
  const deadline = deps.now() + (options.timeoutMs ?? WEBSITE_READ_TIMEOUT_MS);
  try {
    const home = await fetchHtml(start, deps, deadline);
    const parsed = parseHtml(home.html);
    if (deps.now() > deadline) return { ok: false, reason: WEBSITE_READ_REASONS.timeout };
    if (!parsed.text) return { ok: false, reason: WEBSITE_READ_REASONS.empty };
    const sections = [`# ${parsed.title ?? "Home page"}\n${home.url.toString()}\n\n${parsed.text}`];
    const pages = [home.url.toString()];
    const about = findAboutLink(parsed, home.url);
    if (about && deadline - deps.now() >= ABOUT_MIN_TIME_MS) {
      try {
        const page = await fetchHtml(about, deps, deadline);
        const aboutPage = parseHtml(page.html);
        if (aboutPage.text && deps.now() <= deadline) {
          sections.push(`# ${aboutPage.title ?? "About"}\n${page.url.toString()}\n\n${aboutPage.text}`);
          pages.push(page.url.toString());
        }
      } catch {
        // The about page is a bonus: the home page alone still counts.
      }
    }
    const text = sections.join("\n\n").slice(0, WEBSITE_MAX_TEXT_CHARS);
    return { ok: true, text, title: parsed.title, pages };
  } catch (error) {
    if (error instanceof ReadRefused) return { ok: false, reason: error.reason };
    return { ok: false, reason: WEBSITE_READ_REASONS.unreachable };
  }
}
