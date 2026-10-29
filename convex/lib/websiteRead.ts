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
 * (lookups, requests and parsing); at most 2 MB downloaded and parsed per
 * page (a larger page's first 2 MB); text/html only.
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
  /** More than `maxBytes` arrived; the body is its first `maxBytes`, which are read. */
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
    return { url, html: page.body };
  }
}

// ─── Text ───────────────────────────────────────────────────────────────────
//
// One linear pass over the page (review round 1: the regex strippers took
// quadratic time on a page of "<", minutes for 2 MB). Every search jumps
// forward with indexOf and nothing is scanned twice, so the whole of a 2 MB
// page parses in well under a second (round 2: heavy pages carry hundreds
// of KB of inline script before their text, so all of it is parsed).

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
/** Skipped parts that may hold themselves (an svg in an svg): their closing tags are counted. */
const NESTING = new Set(["svg", "math", "object", "template"]);
/** Only foreign content ends with "/>"; `<iframe src=/embed/>` still opens an iframe. */
const SELF_CLOSING = new Set(["svg", "math"]);
/**
 * Navigation, footer and aside boilerplate: their text is left out, but
 * their links are still read (the about page is usually linked from the
 * navigation). A header stays, only the navigation inside it going. One
 * that is never closed is read as text, so it cannot hide the page.
 */
const QUIET = new Set(["nav", "footer", "aside"]);
/** What a head may hold; any other element ends a head that is never closed. */
const HEAD_ONLY = new Set(["meta", "link", "title", "base", "style", "script", "noscript", "template"]);
const BLOCKS = new Set([
  "p", "div", "section", "article", "main", "header", "li", "ul", "ol", "tr", "table", "tbody", "thead",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "dd", "dt", "dl", "figure", "figcaption", "form", "address",
  "hr", "pre",
]);
/** Inline tags that still part words ("<td>Founded</td><td>1999</td>"). */
const SPACERS = new Set(["td", "th", "label", "option", "img", "input", "wbr"]);

/**
 * Named entities: the five of markup, the Latin-1 letters French and
 * Spanish text uses, and common punctuation. Case matters (&Eacute; is É).
 */
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", shy: "",
  rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", sbquo: "\u201a", bdquo: "\u201e",
  laquo: "\u00ab", raquo: "\u00bb", lsaquo: "\u2039", rsaquo: "\u203a",
  ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", bull: "\u2022", middot: "\u00b7",
  copy: "\u00a9", reg: "\u00ae", trade: "\u2122", deg: "\u00b0", sect: "\u00a7", para: "\u00b6",
  euro: "\u20ac", pound: "\u00a3", yen: "\u00a5", cent: "\u00a2", times: "\u00d7", divide: "\u00f7",
  frac12: "\u00bd", frac14: "\u00bc", frac34: "\u00be", sup2: "\u00b2", sup3: "\u00b3", micro: "\u00b5",
  iexcl: "\u00a1", iquest: "\u00bf", szlig: "\u00df",
  AElig: "\u00c6", aelig: "\u00e6", OElig: "\u0152", oelig: "\u0153", Oslash: "\u00d8", oslash: "\u00f8",
  Aring: "\u00c5", aring: "\u00e5", Ntilde: "\u00d1", ntilde: "\u00f1", Ccedil: "\u00c7", ccedil: "\u00e7",
  Yuml: "\u0178", yuml: "\u00ff", Yacute: "\u00dd", yacute: "\u00fd",
};
// The accented vowels: grave, acute, circumflex, tilde and umlaut on A, E, I, O, U.
for (const [letter, codes] of Object.entries({
  A: [0xc0, 0xc1, 0xc2, 0xc3, 0xc4],
  E: [0xc8, 0xc9, 0xca, 0, 0xcb],
  I: [0xcc, 0xcd, 0xce, 0, 0xcf],
  O: [0xd2, 0xd3, 0xd4, 0xd5, 0xd6],
  U: [0xd9, 0xda, 0xdb, 0, 0xdc],
})) {
  ["grave", "acute", "circ", "tilde", "uml"].forEach((mark, index) => {
    const code = codes[index]!;
    if (!code) return;
    ENTITIES[`${letter}${mark}`] = String.fromCodePoint(code);
    ENTITIES[`${letter.toLowerCase()}${mark}`] = String.fromCodePoint(code + 0x20);
  });
}

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,7});/g, (match, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      // A surrogate code alone is no character: the replacement character stands in.
      if (code >= 0xd800 && code <= 0xdfff) return "\ufffd";
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** Lone surrogates replaced, so every string handed on is well formed. */
function wellFormed(text: string): string {
  return text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
}

/** The first `max` code units, never ending in half a character. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isNameChar(code: number): boolean {
  return isLetter(code) || (code >= 48 && code <= 57) || code === 45;
}

/** Spaces trimmed around each block, empty blocks dropped. Line breaks come only from blocks and <br>. */
function tidyLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Where the tag that starts at `from` ends (its ">"), skipping quoted
 * attribute values (`title="x>y"`), or -1 when it never ends. Linear: it
 * only ever moves forward.
 */
function tagEnd(html: string, from: number): number {
  let p = from;
  while (p < html.length) {
    const code = html.charCodeAt(p);
    if (code === 62) return p; // >
    if (code === 61) {
      // =, then an optional space, then maybe a quoted value
      p += 1;
      while (p < html.length && (html.charCodeAt(p) === 32 || html.charCodeAt(p) === 9 || html.charCodeAt(p) === 10 || html.charCodeAt(p) === 13)) p += 1;
      const quote = html.charCodeAt(p);
      if (quote === 34 || quote === 39) {
        const close = html.indexOf(quote === 34 ? '"' : "'", p + 1);
        if (close === -1) return -1;
        p = close + 1;
      }
      continue;
    }
    p += 1;
  }
  return -1;
}

/**
 * Where the skipped part `name` opened before `from` ends, counting nested
 * ones of the same name, or -1 when it never does. The next opening and
 * closing tags are each looked for once and only searched again once
 * passed, so the scan stays linear.
 */
function skippedEnd(lower: string, name: string, from: number): number {
  const opening = `<${name}`;
  const closing = `</${name}`;
  let depth = 1;
  let p = from;
  // Each search starts past the last one found, so the scan stays linear.
  let nextOpen = NESTING.has(name) ? lower.indexOf(opening, p) : -1;
  let nextClose = lower.indexOf(closing, p);
  while (depth > 0) {
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      // "<svgfoo" is not this name.
      if (!isNameChar(lower.charCodeAt(nextOpen + opening.length))) depth += 1;
      p = nextOpen + opening.length;
      nextOpen = lower.indexOf(opening, p);
      continue;
    }
    depth -= 1;
    p = nextClose + closing.length;
    if (depth > 0) nextClose = lower.indexOf(closing, p);
  }
  const gt = lower.indexOf(">", p);
  return gt === -1 ? lower.length : gt + 1;
}

export type ParsedPage = { title: string | null; text: string; links: { href: string; text: string }[] };

/**
 * A page's title, readable text and links, in one pass: the parts in
 * SKIPPED jumped over (nested ones counted), the QUIET parts' text left out
 * (their links kept), the head's text left out but its title kept, blocks
 * and <br> on their own lines, inline separators as spaces, whitespace in
 * text folded to one space, entities decoded, the result well formed.
 */
export function parseHtml(input: string): ParsedPage {
  const html = cutText(input, WEBSITE_MAX_BYTES);
  // ASCII-only lowercase keeps every index the same as `html`.
  const lower = html.replace(/[A-Z]+/g, (run) => run.toLowerCase());
  // A quiet part opened after its name's last closing tag is never closed.
  const lastQuietClose = new Map([...QUIET].map((name) => [name, lower.lastIndexOf(`</${name}`)]));
  const out: string[] = [];
  const titleParts: string[] = [];
  const links: { href: string; text: string }[] = [];
  let link: { href: string; parts: string[] } | null = null;
  let inHead = false;
  let inTitle = false;
  let titleLength = 0;
  let quiet = 0;

  const closeLink = () => {
    if (link && links.length < MAX_LINKS) links.push({ href: link.href, text: tidyLines(link.parts.join("")) });
    link = null;
  };

  const emit = (raw: string) => {
    if (!raw) return;
    const text = decodeEntities(raw).replace(/\s+/g, " ");
    if (inTitle) {
      if (titleLength < MAX_TITLE_CHARS) {
        titleParts.push(text);
        titleLength += text.length;
      }
      return;
    }
    if (inHead) {
      // Text that is not blank ends a head nobody closed.
      if (!text.trim()) return;
      inHead = false;
    }
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
      // "<!-->" and "<!--->" are empty comments.
      if (html.startsWith("<!-->", i)) {
        i += 5;
        continue;
      }
      if (html.startsWith("<!--->", i)) {
        i += 6;
        continue;
      }
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
    const gt = tagEnd(html, k);
    if (gt === -1) break; // An unclosed tag ends the page.
    i = gt + 1;
    const selfClosing = html.charCodeAt(gt - 1) === 47 && SELF_CLOSING.has(name);

    // Any element a head cannot hold ends a head nobody closed.
    if (inHead && !closing && !HEAD_ONLY.has(name) && name !== "head") {
      inHead = false;
      inTitle = false;
    }
    if (!closing && SKIPPED.has(name)) {
      if (selfClosing) continue;
      const end = skippedEnd(lower, name, i);
      if (end === -1) break;
      i = end;
      continue;
    }
    if (QUIET.has(name)) {
      if (closing) quiet = Math.max(0, quiet - 1);
      else if ((lastQuietClose.get(name) ?? -1) > i) quiet += 1;
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
      out.push("\n");
      if (link) link.parts.push(" ");
      continue;
    }
    if (name === "a") {
      // An <a> left open ends where the next one starts.
      closeLink();
      if (!closing) {
        const attributes = html.slice(k, Math.min(gt, k + MAX_TAG_ATTRIBUTE_CHARS));
        const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attributes);
        link = href ? { href: decodeEntities(href[1] ?? href[2] ?? href[3] ?? "").trim(), parts: [] } : null;
      }
      continue;
    }
    if (BLOCKS.has(name)) {
      out.push("\n");
      if (link) link.parts.push(" ");
    } else if (SPACERS.has(name)) {
      out.push(" ");
      if (link) link.parts.push(" ");
    }
  }
  closeLink();

  const title = wellFormed(tidyLines(titleParts.join(" "))).trim();
  return {
    title: title ? cutText(title, MAX_TITLE_CHARS) : null,
    text: wellFormed(tidyLines(out.join(""))),
    links,
  };
}

/** The page's title, or null. */
export function htmlTitle(html: string): string | null {
  return parseHtml(html).title;
}

/** The readable text of a page (`parseHtml`). */
export function htmlToText(html: string): string {
  return parseHtml(html).text;
}

/** Lowercase, accents taken off ("À propos" is "a propos"). */
function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** First path parts that name an about page. */
const ABOUT_PATHS = new Set(["about", "about-us", "aboutus", "a-propos", "apropos", "qui-sommes-nous", "company", "our-story", "who-we-are"]);
/** Link words that name an about page on their own. */
const ABOUT_WORDS = new Set([
  "about",
  "about us",
  "about the company",
  "a propos",
  "a propos de nous",
  "qui sommes-nous",
  "qui sommes nous",
  "our story",
  "our company",
  "who we are",
  "company",
]);

/**
 * How surely a link is the about page: its first path part names one (4
 * alone, 3 with more after it), its words name one on their own (2), or a
 * later path part is "about" as a word (1); 0 is not an about page.
 */
function aboutScore(url: URL, words: string): number {
  const parts = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return fold(decodeURIComponent(part)).replace(/\.(html?|php|aspx?)$/, "");
      } catch {
        return fold(part);
      }
    });
  if (parts.length > 0 && ABOUT_PATHS.has(parts[0]!)) return parts.length === 1 ? 4 : 3;
  const said = fold(words).replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (ABOUT_WORDS.has(said)) return 2;
  if (parts.some((part) => /(^|-)(about|a-propos)(-|$)/.test(part))) return 1;
  return 0;
}

/**
 * The best link to an about page on the same site, or null: the highest
 * `aboutScore`, document order breaking ties.
 */
export function findAboutLink(page: string | ParsedPage, base: URL): URL | null {
  const parsed = typeof page === "string" ? parseHtml(page) : page;
  const sameSite = (url: URL) => url.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
  let best: { url: URL; score: number } | null = null;
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
    const score = aboutScore(url, text);
    if (score > (best?.score ?? 0)) best = { url, score };
  }
  return best?.url ?? null;
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
    const text = cutText(sections.join("\n\n"), WEBSITE_MAX_TEXT_CHARS);
    return { ok: true, text, title: parsed.title, pages };
  } catch (error) {
    if (error instanceof ReadRefused) return { ok: false, reason: error.reason };
    return { ok: false, reason: WEBSITE_READ_REASONS.unreachable };
  }
}
