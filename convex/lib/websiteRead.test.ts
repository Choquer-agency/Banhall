/**
 * Reading a company's website (owner, 2026-10-29) with the network and DNS
 * stubbed: what may be fetched (schemes, ports, names, private, loopback,
 * link-local and metadata addresses, after every redirect), the limits
 * (redirects, size, type, time) and the text (boilerplate taken out, the
 * about page, the cap).
 */
import { describe, expect, it, vi } from "vitest";
import {
  MAX_HTML_CHARS,
  WEBSITE_MAX_TEXT_CHARS,
  WEBSITE_READ_REASONS,
  findAboutLink,
  htmlToText,
  isBlockedAddress,
  parseHtml,
  readWebsite,
  type WebsiteDeps,
  type WebsitePage,
} from "./websiteRead";

const PUBLIC = "93.184.216.34";

function html(body: string, title = "Hatch Better") {
  return `<!doctype html><html><head><title>${title}</title><style>.x{color:red}</style><script>var secret = 1;</script></head><body>${body}</body></html>`;
}

function page(body: string, overrides: Partial<WebsitePage> = {}): WebsitePage {
  return { status: 200, location: null, contentType: "text/html; charset=utf-8", body, tooLarge: false, ...overrides };
}

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

  it.each([["ftp://hatchbetter.com"], ["https://hatchbetter.com:8080"], ["https://user:pw@hatchbetter.com"]])(
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
        "https://hatchbetter.com/": page("", { status: 302, location: "http://169.254.169.254/latest/meta-data" }),
      },
      {}
    );
    s.deps.lookup = vi.fn(async (hostname: string) => (hostname === "hatchbetter.com" ? [PUBLIC] : [hostname]));
    expect(await readWebsite("https://hatchbetter.com", s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.notAllowed });
    expect(s.fetched).toEqual(["https://hatchbetter.com/"]);
  });

  it("checks a redirect to a name that resolves privately", async () => {
    const s = site(
      { "https://hatchbetter.com/": page("", { status: 301, location: "https://evil.example.com/" }) },
      { "evil.example.com": ["10.9.8.7"] }
    );
    expect(await readWebsite("https://hatchbetter.com", s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.notAllowed });
    expect(s.fetched).toEqual(["https://hatchbetter.com/"]);
  });

  it("follows up to 3 redirects and refuses a fourth", async () => {
    const hops = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `https://hatchbetter.com/${index === 0 ? "" : `hop${index}`}`,
          page("", { status: 302, location: `/hop${index + 1}` }),
        ])
      );
    const three = site({ ...hops(3), "https://hatchbetter.com/hop3": page(html("<main><p>Arrived.</p></main>")) });
    const ok = await readWebsite("https://hatchbetter.com", three.deps);
    expect(ok).toMatchObject({ ok: true, pages: ["https://hatchbetter.com/hop3"] });

    const four = site({ ...hops(4), "https://hatchbetter.com/hop4": page(html("<p>Too far.</p>")) });
    expect(await readWebsite("https://hatchbetter.com", four.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.redirects });
    expect(four.fetched).toHaveLength(4);
  });
});

describe("the limits", () => {
  it("refuses a page over 2 MB", async () => {
    const s = site({ "https://hatchbetter.com/": page(html("<p>Big</p>"), { tooLarge: true }) });
    expect(await readWebsite("https://hatchbetter.com", s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.tooLarge });
    expect(s.deps.fetchPage).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ maxBytes: 2 * 1024 * 1024 }));
  });

  it.each([["application/pdf"], ["text/plain"], ["application/json"], [null]])("refuses %s (text/html only)", async (type) => {
    const s = site({ "https://hatchbetter.com/": page("%PDF-1.4", { contentType: type }) });
    expect(await readWebsite("https://hatchbetter.com", s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.notHtml });
  });

  it("refuses an error answer", async () => {
    const s = site({ "https://hatchbetter.com/": page("Not found", { status: 404 }) });
    expect(await readWebsite("https://hatchbetter.com", s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.status });
  });

  it("gives the whole read one 10 second deadline", async () => {
    const s = site({});
    s.deps.fetchPage = vi.fn(async (_url: URL, options: { timeoutMs: number }) => {
      expect(options.timeoutMs).toBe(10_000);
      s.clock.now += 10_001;
      throw new Error("timeout");
    });
    expect(await readWebsite("https://hatchbetter.com", s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.timeout });
  });

  it("races the first lookup against the time left: a name that never resolves times out", async () => {
    const s = site({});
    s.deps.lookup = vi.fn(() => new Promise<string[]>(() => {}));
    const started = Date.now();
    s.deps.now = () => Date.now();
    expect(await readWebsite("https://hatchbetter.com", s.deps, { timeoutMs: 150 })).toEqual({
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
    expect(await readWebsite("https://hatchbetter.com", t.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.unreachable });
  });
});

describe("the text", () => {
  it("reads the home page and its about page, without scripts, styles or navigation", async () => {
    const s = site({
      "https://hatchbetter.com/": page(
        html(
          `<header><nav><a href="/pricing">Pricing</a><a href="/about-us">About us</a></nav></header>
           <main><h1>Hatch Better</h1><p>We build incubators for poultry farms &amp; hatcheries.</p></main>
           <footer>© 2026 Hatch Better. <a href="/privacy">Privacy</a></footer>`
        )
      ),
      "https://hatchbetter.com/about-us": page(html("<main><h1>About</h1><p>Founded in 2019 in Guelph.</p></main>", "About Hatch Better")),
    });
    const result = await readWebsite("https://hatchbetter.com", s.deps);
    expect(result).toMatchObject({ ok: true, title: "Hatch Better", pages: ["https://hatchbetter.com/", "https://hatchbetter.com/about-us"] });
    if (!result.ok) throw new Error("expected a read");
    expect(result.text).toContain("We build incubators for poultry farms & hatcheries.");
    expect(result.text).toContain("Founded in 2019 in Guelph.");
    expect(result.text).toContain("# About Hatch Better");
    expect(result.text).not.toMatch(/secret|color:red|Pricing|Privacy|© 2026/);
    expect(s.fetched).toEqual(["https://hatchbetter.com/", "https://hatchbetter.com/about-us"]);
  });

  it("keeps the home page when the about page fails, and reads at most one about page", async () => {
    const s = site({
      "https://hatchbetter.com/": page(html('<p>Home text.</p><a href="/about">About</a><a href="/about/team">About the team</a>')),
    });
    const result = await readWebsite("https://hatchbetter.com", s.deps);
    expect(result).toMatchObject({ ok: true, pages: ["https://hatchbetter.com/"] });
    expect(s.fetched).toEqual(["https://hatchbetter.com/", "https://hatchbetter.com/about"]);
  });

  it("ignores an about link on another site", () => {
    const base = new URL("https://hatchbetter.com/");
    expect(findAboutLink('<a href="https://other.com/about">About</a>', base)).toBeNull();
    expect(findAboutLink('<a href="https://www.hatchbetter.com/company">About us</a>', base)?.toString()).toBe(
      "https://www.hatchbetter.com/company"
    );
    expect(findAboutLink('<a href="mailto:about@hatchbetter.com">About</a>', base)).toBeNull();
  });

  it("cuts the text at about 50,000 characters, and says so when a page has none", async () => {
    const long = site({ "https://hatchbetter.com/": page(html(`<p>${"word ".repeat(20_000)}</p>`)) });
    const result = await readWebsite("https://hatchbetter.com", long.deps);
    expect(result.ok && result.text.length).toBe(WEBSITE_MAX_TEXT_CHARS);
    const empty = site({ "https://hatchbetter.com/": page(html("<script>only()</script>")) });
    expect(await readWebsite("https://hatchbetter.com", empty.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.empty });
  });

  it("keeps an ASP.NET page that sits in one form, leaving out only its controls", () => {
    const page = html(
      `<form method="post" action="./"><input type="hidden" name="__VIEWSTATE" value="dGhpcyBpcyBzZWNyZXQ=">
       <main><h1>Hatch Better</h1><p>Incubators for poultry farms.</p></main>
       <select><option>English</option><option>Français</option></select><button>Search</button><textarea>notes</textarea></form>`
    );
    const text = htmlToText(page);
    expect(text).toBe("Hatch Better\nIncubators for poultry farms.");
  });

  it("keeps a header's own text and leaves out only the navigation inside it, and still reads links in the navigation", () => {
    const page = parseHtml(
      html(`<header><p>Hatch Better: incubators since 2019</p><nav><a href="/about-us">About us</a><a href="/shop">Shop</a></nav></header><main><p>Body.</p></main>`)
    );
    expect(page.text).toBe("Hatch Better: incubators since 2019\nBody.");
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
  ])("parses %s in a straight pass, well within the deadline", (_label, input) => {
    const started = performance.now();
    const page = parseHtml(input);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(1_500);
    expect(page.text.length).toBeLessThanOrEqual(MAX_HTML_CHARS);
  });

  it("parses only the first 512 KB of a page", () => {
    const page = parseHtml(`<p>${"a".repeat(MAX_HTML_CHARS)}</p><p>Past the cap.</p>`);
    expect(page.text).not.toContain("Past the cap.");
  });

  it("a whole read of a 2 MB page of < finishes in time, the lone < kept as text", async () => {
    const s = site({ "https://hatchbetter.com/": page("<".repeat(2 * 1024 * 1024)) });
    const started = performance.now();
    const result = await readWebsite("https://hatchbetter.com", s.deps);
    expect(performance.now() - started).toBeLessThan(2_000);
    // Lone "<" characters are text, not tags.
    expect(result.ok).toBe(true);
  });

  it("checks the deadline after parsing", async () => {
    const s = site({ "https://hatchbetter.com/": page(html("<p>Text.</p>")) });
    const fetchPage = s.deps.fetchPage;
    s.deps.fetchPage = vi.fn(async (url: URL, options: { timeoutMs: number; maxBytes: number }) => {
      const answer = await fetchPage(url, options);
      // The page arrived just as time ran out.
      s.clock.now += 10_001;
      return answer;
    });
    expect(await readWebsite("https://hatchbetter.com", s.deps)).toEqual({ ok: false, reason: WEBSITE_READ_REASONS.timeout });
  });

  it("puts blocks on their own lines and decodes entities", () => {
    expect(htmlToText("<p>One&nbsp;two</p><div>Three &#x26; four &#38; five</div><br>Six")).toBe("One two\nThree & four & five\nSix");
  });
});
