/**
 * Reading a company's website (owner, 2026-10-29) with the network and DNS
 * stubbed: what may be fetched (schemes, ports, names, private, loopback,
 * link-local and metadata addresses, after every redirect), the limits
 * (redirects, size, type, time) and the text (boilerplate taken out, the
 * about page, the cap).
 */
import { describe, expect, it, vi } from "vitest";
import {
  WEBSITE_MAX_BYTES,
  WEBSITE_MAX_TEXT_CHARS,
  WEBSITE_READ_REASONS,
  findAboutLink,
  htmlTitle,
  htmlToText,
  isBlockedAddress,
  parseHtml,
  readWebsite,
  type WebsiteDeps,
  type WebsitePage,
} from "./websiteRead";

const PUBLIC = "93.184.216.34";

function html(body: string, title = "Quillmere Analytics") {
  return `<!doctype html><html><head><title>${title}</title><style>.x{color:red}</style><script>var secret = 1;</script></head><body>${body}</body></html>`;
}

function page(body: string, overrides: Partial<WebsitePage> = {}): WebsitePage {
  return { status: 200, location: null, contentType: "text/html; charset=utf-8", body, tooLarge: false, ...overrides };
}
const page2 = page;

/** A site where each address answers with a fixed page, every name resolving to `addresses`. */
function site(pages: Record<string, WebsitePage>, addresses: Record<string, string[]> = {}) {
  const clock = { now: 1_000 };
  const fetched: string[] = [];
  const looked: string[] = [];
  const deps: WebsiteDeps = {
    lookup: vi.fn(async (hostname: string) => {
      looked.push(hostname);
      return addresses[hostname] ?? [PUBLIC];
    }),
    fetchPage: vi.fn(async (url: URL) => {
      fetched.push(url.toString());
      const found = pages[url.toString()];
      if (!found) throw new Error(`no page at ${url}`);
      return found;
    }),
    now: () => clock.now,
  };
  return { deps, fetched, looked, clock };
}

describe("isBlockedAddress", () => {
  it.each([
    ["127.0.0.1"],
    ["127.255.1.2"],
    ["10.1.2.3"],
    ["172.16.0.1"],
    ["172.31.255.255"],
    ["192.168.1.10"],
    ["169.254.169.254"],
    ["100.64.0.1"],
    ["0.0.0.0"],
    ["224.0.0.1"],
    ["255.255.255.255"],
    ["198.18.0.1"],
    ["::1"],
    ["::"],
    ["fe80::1"],
    ["fc00::1"],
    ["fd00:ec2::254"],
    ["ff02::1"],
    ["::ffff:127.0.0.1"],
    ["::ffff:7f00:1"],
    ["::ffff:192.168.0.1"],
    ["64:ff9b::a9fe:a9fe"],
    ["2001:db8::1"],
    // Review round 1: NAT64 local use, IPv4-translated, 6to4, Teredo,
    // discard-only, and the 6to4 relay anycast.
    ["64:ff9b:1::a00:1"],
    ["::ffff:0:7f00:1"],
    ["::ffff:0:10.0.0.1"],
    ["2002:c0a8:101::1"],
    ["2002:808:808::1"],
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2"],
    ["100::1"],
    ["192.88.99.1"],
    ["not an address"],
  ])("refuses %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([["93.184.216.34"], ["8.8.8.8"], ["172.32.0.1"], ["2606:4700:4700::1111"], ["::ffff:8.8.8.8"]])(
    "allows %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    }
  );
});

describe("what may be fetched", () => {
  it.each([
    ["a name that resolves to a private address", "https://intranet.example.com", { "intranet.example.com": ["10.0.0.5"] }],
    ["a name with one private address among public ones", "https://mixed.example.com", { "mixed.example.com": [PUBLIC, "192.168.1.2"] }],
    ["a name that resolves to loopback", "https://sneaky.example.com", { "sneaky.example.com": ["127.0.0.1"] }],
    ["a name that resolves to the metadata address", "https://meta.example.com", { "meta.example.com": ["169.254.169.254"] }],
    ["a name that resolves to IPv6 loopback", "https://six.example.com", { "six.example.com": ["::1"] }],
    ["a loopback address written out", "http://127.0.0.1", {}],
    ["a loopback address written as a number", "http://2130706433", {}],
    ["the metadata address", "http://169.254.169.254/latest/meta-data", {}],
    ["an IPv6 loopback address", "http://[::1]", {}],
  ])("refuses %s, and fetches nothing", async (_label, address, addresses) => {
    const s = site({}, Object.fromEntries(Object.entries(addresses).map(([k, v]) => [k, v])));
    // An IP literal resolves to itself.
    s.deps.lookup = vi.fn(async (hostname: string) => (addresses as Record<string, string[]>)[hostname] ?? [hostname]);
    expect(await readWebsite(address, s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.notAllowed });
    expect(s.fetched).toEqual([]);
  });

  it.each([["http://localhost"], ["https://printer.local"], ["https://db.internal"], ["https://app.localhost"]])(
    "refuses %s by its name, before any lookup",
    async (address) => {
      const s = site({});
      expect(await readWebsite(address, s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.notAllowed });
      expect(s.looked).toEqual([]);
      expect(s.fetched).toEqual([]);
    }
  );

  it.each([["ftp://quillmere.com"], ["https://quillmere.com:8080"], ["https://user:pw@quillmere.com"]])(
    "refuses %s (scheme, port or credentials)",
    async (address) => {
      const s = site({});
      expect(await readWebsite(address, s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.notAllowed });
      expect(s.fetched).toEqual([]);
    }
  );

  it("checks every redirect: one into the metadata address is refused without fetching it", async () => {
    const s = site(
      {
        "https://quillmere.com/": page("", { status: 302, location: "http://169.254.169.254/latest/meta-data" }),
      },
      {}
    );
    s.deps.lookup = vi.fn(async (hostname: string) => (hostname === "quillmere.com" ? [PUBLIC] : [hostname]));
    expect(await readWebsite("https://quillmere.com", s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.notAllowed });
    expect(s.fetched).toEqual(["https://quillmere.com/"]);
  });

  it("checks a redirect to a name that resolves privately", async () => {
    const s = site(
      { "https://quillmere.com/": page("", { status: 301, location: "https://evil.example.com/" }) },
      { "evil.example.com": ["10.9.8.7"] }
    );
    expect(await readWebsite("https://quillmere.com", s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.notAllowed });
    expect(s.fetched).toEqual(["https://quillmere.com/"]);
  });

  it("follows up to 3 redirects and refuses a fourth", async () => {
    const hops = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `https://quillmere.com/${index === 0 ? "" : `hop${index}`}`,
          page("", { status: 302, location: `/hop${index + 1}` }),
        ])
      );
    const three = site({ ...hops(3), "https://quillmere.com/hop3": page(html("<main><p>Arrived.</p></main>")) });
    const ok = await readWebsite("https://quillmere.com", three.deps);
    expect(ok).toMatchObject({ ok: true, pages: ["https://quillmere.com/hop3"] });

    const four = site({ ...hops(4), "https://quillmere.com/hop4": page(html("<p>Too far.</p>")) });
    expect(await readWebsite("https://quillmere.com", four.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.redirects });
    expect(four.fetched).toHaveLength(4);
  });
});

describe("the limits", () => {
  it("reads the first 2 MB of a page over 2 MB instead of refusing it", async () => {
    const s = site({ "https://quillmere.com/": page(html("<p>Big but readable.</p>"), { tooLarge: true }) });
    const result = await readWebsite("https://quillmere.com", s.deps);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.text).toContain("Big but readable.");
    expect(s.deps.fetchPage).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ maxBytes: 2 * 1024 * 1024 }));
  });

  it.each([["application/pdf"], ["text/plain"], ["application/json"], [null]])("refuses %s (text/html only)", async (type) => {
    const s = site({ "https://quillmere.com/": page("%PDF-1.4", { contentType: type }) });
    expect(await readWebsite("https://quillmere.com", s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.notHtml });
  });

  it("refuses an error answer", async () => {
    const s = site({ "https://quillmere.com/": page("Not found", { status: 404 }) });
    expect(await readWebsite("https://quillmere.com", s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.status });
  });

  it("gives the whole read one 10 second deadline", async () => {
    const s = site({});
    s.deps.fetchPage = vi.fn(async (_url: URL, options: { timeoutMs: number }) => {
      expect(options.timeoutMs).toBe(10_000);
      s.clock.now += 10_001;
      throw new Error("timeout");
    });
    expect(await readWebsite("https://quillmere.com", s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.timeout });
  });

  it("races the first lookup against the time left: a name that never resolves times out", async () => {
    const s = site({});
    s.deps.lookup = vi.fn(() => new Promise<string[]>(() => {}));
    const started = Date.now();
    s.deps.now = () => Date.now();
    expect(await readWebsite("https://quillmere.com", s.deps, { timeoutMs: 150 })).toEqual({
      ok: false,
      reason: WEBSITE_READ_REASONS.timeout,
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(s.fetched).toEqual([]);
  });

  it("says unreachable for a name that does not resolve or a network error", async () => {
    const s = site({});
    s.deps.lookup = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    expect(await readWebsite("https://nowhere.example.com", s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.unreachable });
    const t = site({});
    expect(await readWebsite("https://quillmere.com", t.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.unreachable });
  });
});

describe("the text", () => {
  it("reads the home page and its about page, without scripts, styles or navigation", async () => {
    const s = site({
      "https://quillmere.com/": page(
        html(
          `<header><nav><a href="/pricing">Pricing</a><a href="/about-us">About us</a></nav></header>
           <main><h1>Quillmere Analytics</h1><p>We build incubators for poultry farms &amp; hatcheries.</p></main>
           <footer>© 2026 Quillmere Analytics. <a href="/privacy">Privacy</a></footer>`
        )
      ),
      "https://quillmere.com/about-us": page(html("<main><h1>About</h1><p>Founded in 2019 in Guelph.</p></main>", "About Quillmere Analytics")),
    });
    const result = await readWebsite("https://quillmere.com", s.deps);
    expect(result).toMatchObject({ ok: true, title: "Quillmere Analytics", pages: ["https://quillmere.com/", "https://quillmere.com/about-us"] });
    if (!result.ok) throw new Error("expected a read");
    expect(result.text).toContain("We build incubators for poultry farms & hatcheries.");
    expect(result.text).toContain("Founded in 2019 in Guelph.");
    expect(result.text).toContain("# About Quillmere Analytics");
    expect(result.text).not.toMatch(/secret|color:red|Pricing|Privacy|© 2026/);
    expect(s.fetched).toEqual(["https://quillmere.com/", "https://quillmere.com/about-us"]);
  });

  it("keeps the home page when the about page fails, and reads at most one about page", async () => {
    const s = site({
      "https://quillmere.com/": page(html('<p>Home text.</p><a href="/about">About</a><a href="/about/team">About the team</a>')),
    });
    const result = await readWebsite("https://quillmere.com", s.deps);
    expect(result).toMatchObject({ ok: true, pages: ["https://quillmere.com/"] });
    expect(s.fetched).toEqual(["https://quillmere.com/", "https://quillmere.com/about"]);
  });

  it("ignores an about link on another site", () => {
    const base = new URL("https://quillmere.com/");
    expect(findAboutLink('<a href="https://other.com/about">About</a>', base)).toBeNull();
    expect(findAboutLink('<a href="https://www.quillmere.com/company">About us</a>', base)?.toString()).toBe(
      "https://www.quillmere.com/company"
    );
    expect(findAboutLink('<a href="mailto:about@quillmere.com">About</a>', base)).toBeNull();
  });

  it("cuts the text at about 50,000 characters, and says so when a page has none", async () => {
    const long = site({ "https://quillmere.com/": page(html(`<p>${"word ".repeat(20_000)}</p>`)) });
    const result = await readWebsite("https://quillmere.com", long.deps);
    expect(result.ok && result.text.length).toBe(WEBSITE_MAX_TEXT_CHARS);
    const empty = site({ "https://quillmere.com/": page(html("<script>only()</script>")) });
    expect(await readWebsite("https://quillmere.com", empty.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.empty });
  });

  it("keeps an ASP.NET page that sits in one form, leaving out only its controls", () => {
    const page = html(
      `<form method="post" action="./"><input type="hidden" name="__VIEWSTATE" value="dGhpcyBpcyBzZWNyZXQ=">
       <main><h1>Quillmere Analytics</h1><p>Incubators for poultry farms.</p></main>
       <select><option>English</option><option>Français</option></select><button>Search</button><textarea>notes</textarea></form>`
    );
    const text = htmlToText(page);
    expect(text).toBe("Quillmere Analytics\nIncubators for poultry farms.");
  });

  it("keeps a header's own text and leaves out only the navigation inside it, and still reads links in the navigation", () => {
    const page = parseHtml(
      html(`<header><p>Quillmere Analytics: incubators since 2019</p><nav><a href="/about-us">About us</a><a href="/shop">Shop</a></nav></header><main><p>Body.</p></main>`)
    );
    expect(page.text).toBe("Quillmere Analytics: incubators since 2019\nBody.");
    expect(page.links.map((link) => [link.href, link.text])).toEqual([
      ["/about-us", "About us"],
      ["/shop", "Shop"],
    ]);
  });

  it.each([
    ["2 MB of <", "<".repeat(2 * 1024 * 1024)],
    ["2 MB of <script ", "<script ".repeat(262_144)],
    ["2 MB of <a<b", "<a<b".repeat(524_288)],
    ["2 MB of <!--", "<!--".repeat(524_288)],
    ["2 MB of unclosed <p title=\"", '<p title="'.repeat(209_715)],
    ["2 MB of &amp without a semicolon", "&ampamp".repeat(262_144)],
    ["2 MB of <a href=\"", '<a href="'.repeat(233_016) + ">"],
    // Round 3: within 2 MB, so the closing tag survives the cut and the
    // nesting count is what runs.
    ["2 MB of nested <svg", "<svg>" + "<svg".repeat(524_280) + "</svg>"],
    ["2 MB of <svg> closed once", "<svg>".repeat(419_428) + "</svg>"],
    ["2 MB of nested <svg/>", "<svg>" + "<svg/>".repeat(349_520) + "</svg>"],
    ["2 MB of </scripts", "<script>" + "</scripts".repeat(233_015) + "</script>"],
    ["2 MB of <nav> never closed", "<nav>".repeat(419_430)],
  ])("parses %s in a straight pass, well within the deadline", (_label, input) => {
    expect(input.length).toBeLessThanOrEqual(WEBSITE_MAX_BYTES);
    const started = performance.now();
    const page = parseHtml(input);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(1_500);
    expect(page.text.length).toBeLessThanOrEqual(WEBSITE_MAX_BYTES);
  });

  it("reads a heavy page whole: its text after 600 KB of inline script (Wix, Shopify, Elementor)", () => {
    const heavy = html(`<script>window.__DATA__ = ${JSON.stringify("x".repeat(600 * 1024))};</script><main><p>Quillmere Analytics builds incubators.</p></main>`);
    expect(htmlToText(heavy)).toBe("Quillmere Analytics builds incubators.");
  });

  it("parses at most 2 MB of a page", () => {
    const page = parseHtml(`<p>${"a".repeat(WEBSITE_MAX_BYTES)}</p><p>Past the cap.</p>`);
    expect(page.text).not.toContain("Past the cap.");
  });

  it("a whole read of a 2 MB page of < finishes in time, the lone < kept as text", async () => {
    const s = site({ "https://quillmere.com/": page("<".repeat(2 * 1024 * 1024)) });
    const started = performance.now();
    const result = await readWebsite("https://quillmere.com", s.deps);
    expect(performance.now() - started).toBeLessThan(2_000);
    // Lone "<" characters are text, not tags.
    expect(result.ok).toBe(true);
  });

  it("checks the deadline after parsing", async () => {
    const s = site({ "https://quillmere.com/": page(html("<p>Text.</p>")) });
    const fetchPage = s.deps.fetchPage;
    s.deps.fetchPage = vi.fn(async (url: URL, options: { timeoutMs: number; maxBytes: number }) => {
      const answer = await fetchPage(url, options);
      // The page arrived just as time ran out.
      s.clock.now += 10_001;
      return answer;
    });
    expect(await readWebsite("https://quillmere.com", s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.timeout });
  });

  it("does not end a tag at a > inside a quoted attribute", () => {
    expect(htmlToText(`<p title="x>y" x-show="n > 0">Shown</p><span data-a='b>c'>too</span>`)).toBe("Shown\ntoo");
  });

  it("ends a head nobody closed at the first element a head cannot hold", () => {
    expect(htmlToText(`<html><head><title>Quillmere Analytics</title><meta charset="utf-8"><h1>Incubators</h1><p>Since 2019.</p>`)).toBe(
      "Incubators\nSince 2019."
    );
    expect(htmlTitle(`<head><title>Quillmere Analytics</title><div>Body</div>`)).toBe("Quillmere Analytics");
    // Text alone ends it too.
    expect(htmlToText(`<head><meta charset="utf-8">Plain text page`)).toBe("Plain text page");
  });

  it("keeps words apart across table cells, labels and images", () => {
    expect(htmlToText("<table><tr><td>Founded</td><td>1999</td></tr><tr><th>Staff</th><td>40</td></tr></table>")).toBe(
      "Founded 1999\nStaff 40"
    );
    expect(htmlToText("<p><label>Email</label><input name=e>Call<img src=x.png alt=\"\">us</p>")).toBe("Email Call us");
  });

  it("folds line breaks inside text, breaking lines only at blocks and <br>", () => {
    expect(htmlToText("<p>We build incubators\n   for poultry\r\n farms.</p><p>Second<br>line</p>")).toBe(
      "We build incubators for poultry farms.\nSecond\nline"
    );
  });

  it("decodes the Latin-1 letters and common punctuation of French and English sites", () => {
    expect(htmlToText("<p>&Agrave; propos &mdash; l&rsquo;&eacute;quipe d&rsquo;&Eacute;tienne &copy; 2026 &laquo;&nbsp;Fran&ccedil;ais&nbsp;&raquo; &hellip; &OElig;uvre &uuml;ber</p>")).toBe(
      "À propos \u2014 l\u2019équipe d\u2019Étienne © 2026 « Français » \u2026 Œuvre über"
    );
  });

  it("never hands on half a character", async () => {
    const page = parseHtml("<p>Lone &#xD800; and &#xDFFF; surrogates, a real &#x1F600; one</p>");
    expect(page.text).toBe("Lone \ufffd and \ufffd surrogates, a real \u{1F600} one");
    // A raw lone surrogate in the page is replaced too.
    expect(parseHtml("<p>Raw \ud800 here</p><title>T\udc00</title>").text).toBe("Raw \ufffd here");
    // The 50,000 character cut never splits an emoji.
    const s = site({ "https://quillmere.com/": page2(html(`<p>${"\u{1F600}".repeat(30_000)}</p>`)) });
    const result = await readWebsite("https://quillmere.com", s.deps);
    if (!result.ok) throw new Error("expected a read");
    expect(result.text.length).toBeLessThanOrEqual(WEBSITE_MAX_TEXT_CHARS);
    const last = result.text.charCodeAt(result.text.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });

  it("picks the surest about page, document order only breaking ties", () => {
    const base = new URL("https://quillmere.com/");
    const pick = (links: string) => findAboutLink(`<body>${links}</body>`, base)?.pathname ?? null;
    expect(
      pick(
        `<a href="/blog/about-our-launch">Launch</a><a href="/roundabout-project">Roundabout</a>` +
          `<a href="/services">Learn about our services</a><a href="/about">Company</a>`
      )
    ).toBe("/about");
    expect(pick(`<a href="/blog/about-our-launch">Launch</a><a href="/roundabout-project">Roundabout</a>`)).toBe("/blog/about-our-launch");
    expect(pick(`<a href="/roundabout-project">Roundabout</a><a href="/services">Learn about our services</a>`)).toBeNull();
    expect(pick(`<a href="/fr/equipe">À propos</a><a href="/a-propos">Notre équipe</a>`)).toBe("/a-propos");
    expect(pick(`<a href="/qui-sommes-nous/">Qui sommes-nous</a>`)).toBe("/qui-sommes-nous/");
    expect(pick(`<a href="/our-story">Story</a><a href="/about-us">About us</a>`)).toBe("/our-story");
    expect(pick(`<a href="/team">About</a><a href="/history">About us</a>`)).toBe("/team");
  });

  it("keeps an <a> left open when the next one starts", () => {
    const page = parseHtml(`<p><a href="/about">About us<a href="/shop">Shop</a></p>`);
    expect(page.links).toEqual([
      { href: "/about", text: "About us" },
      { href: "/shop", text: "Shop" },
    ]);
  });

  it("a nav left open does not blank the page, even when a later </nav> exists", () => {
    // A header nav left open, then a footer nav that is closed.
    const page = `<header><nav><a href="/">Home</a></header><main><p>Body text.</p></main><footer><nav><a href="/legal">Legal</a></nav></footer>`;
    expect(htmlToText(page)).toBe("Body text.");
    expect(htmlToText(`<nav><a href="/">Home</a><main><p>Main text.</p></main><footer></nav></footer>`)).toBe("Main text.");
    expect(htmlToText(`<body><nav><a href="/">Home</a></body><p>After the body.</p><nav></nav>`)).toBe("After the body.");
  });

  it("keeps minified words apart, and reads details, captions and dialogs as blocks", () => {
    expect(htmlToText(`<p><a href="/q">Get a quote</a><a href="/c">Call us</a></p>`)).toBe("Get a quote Call us");
    expect(htmlToText("<p><span>Founded</span><span>2019</span></p>")).toBe("Founded 2019");
    expect(htmlToText("<details><summary>Do you ship?</summary>Yes, across Canada.</details>")).toBe("Do you ship?\nYes, across Canada.");
    expect(htmlToText("<table><caption>Prices</caption><tr><td>A</td></tr></table><fieldset><legend>Contact</legend>Form</fieldset>")).toBe(
      "Prices\nA\nContact\nForm"
    );
    expect(htmlToText("<dialog>Signed up.</dialog><p>Page.</p>")).toBe("Signed up.\nPage.");
  });

  it("leaves out video and audio fallback text", () => {
    expect(
      htmlToText(`<video controls><source src="a.mp4">Your browser does not support the video tag.</video><audio>No audio.</audio><p>Text.</p>`)
    ).toBe("Text.");
  });

  it("handles the round 3 edges", () => {
    // An unclosed title ends at the first element a head cannot hold.
    expect(htmlToText("<head><title>T<h1>Body")).toBe("Body");
    expect(htmlTitle("<head><title>T<h1>Body")).toBe("T");
    // "<svgfoo" and "</svgfoo" are not the svg's own tags.
    expect(htmlToText("<svg><svgfoo>a</svgfoo>inside</svg><p>After.</p>")).toBe("After.");
    // A self-closing svg inside an svg opens nothing.
    expect(htmlToText("<svg><svg/><path d='M0'/></svg><p>After.</p>")).toBe("After.");
    expect(htmlToText("<svg><svg width=1 /></svg><p>After.</p>")).toBe("After.");
    // "</scripts" does not close a script.
    expect(htmlToText("<script>var a = '</scripts>';</script><p>After.</p>")).toBe("After.");
  });

  it("handles the small parser edges", () => {
    // "<!-->" and "<!--->" are empty comments, not openings.
    expect(htmlToText("<p>Before<!-->after<!--->end</p>")).toBe("Beforeafterend");
    // A nested svg or object does not close its parent early.
    expect(htmlToText("<svg><svg><text>inner</text></svg><text>outer</text></svg><p>Text.</p>")).toBe("Text.");
    expect(htmlToText("<object><object>a</object>b</object><p>Text.</p>")).toBe("Text.");
    // An iframe ending its address with "/" still opens an iframe.
    expect(htmlToText("<iframe src=/embed/>Fallback words</iframe><p>Text.</p>")).toBe("Text.");
    // A nav nobody closed does not silence the rest of the page.
    expect(htmlToText("<nav><a href=/>Home</a><main><p>All of the page.</p></main>")).toBe("Home\nAll of the page.");
  });

  it("puts blocks on their own lines and decodes entities", () => {
    expect(htmlToText("<p>One&nbsp;two</p><div>Three &#x26; four &#38; five</div><br>Six")).toBe("One two\nThree & four & five\nSix");
  });
});
