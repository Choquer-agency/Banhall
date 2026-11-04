/**
 * The website reader's network (owner, 2026-10-29), through a real local
 * HTTP server: one GET that never follows a redirect, stops at the byte
 * cap, downloads no body for anything but text/html, decompresses, gives up
 * at its timeout, and refuses at connect time a host that resolves to a
 * blocked address (DNS stubbed).
 */
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNodeFetch, decodeBody, guardedLookup, WEBSITE_READER_USER_AGENT } from "../convex/companyWebsiteNode";

let server: http.Server;
let port = 0;
let bodyRequested = 0;
let connections = 0;
const userAgents: string[] = [];
const THREE_MB = "x".repeat(3 * 1024 * 1024);
const packed = {
  gzip: zlib.gzipSync(THREE_MB),
  deflate: zlib.deflateSync(THREE_MB),
  br: zlib.brotliCompressSync(THREE_MB),
  // 64 MB of zeros packs into about 64 KB.
  bomb: zlib.gzipSync(Buffer.alloc(64 * 1024 * 1024)),
};

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const path = request.url ?? "/";
    userAgents.push(String(request.headers["user-agent"] ?? ""));
    const encoded = /^\/(gzip|deflate|br)-big$/.exec(path);
    if (encoded) {
      const encoding = encoded[1] as "gzip" | "deflate" | "br";
      response.writeHead(200, { "content-type": "text/html", "content-encoding": encoding });
      response.end(packed[encoding]);
      return;
    }
    if (path === "/bomb") {
      response.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      response.end(packed.bomb);
      return;
    }
    if (path === "/trickle") {
      // Answers at once, then sends one byte every 100ms, forever.
      response.writeHead(200, { "content-type": "text/html" });
      const timer = setInterval(() => response.write("x"), 100);
      response.on("close", () => clearInterval(timer));
      return;
    }
    if (path === "/gzip-cut" || path === "/plain-cut") {
      // Half the body, then the connection drops.
      const gzip = path === "/gzip-cut";
      response.writeHead(200, {
        "content-type": "text/html",
        ...(gzip ? { "content-encoding": "gzip" } : {}),
        "content-length": String(gzip ? packed.gzip.length : 100_000),
      });
      response.write(gzip ? packed.gzip.subarray(0, packed.gzip.length >> 1) : "x".repeat(50_000));
      setTimeout(() => response.socket?.destroy(), 50);
      return;
    }
    if (path === "/latin1-meta") {
      // No charset in the header: the page says it in a <meta>.
      response.writeHead(200, { "content-type": "text/html" });
      response.end(Buffer.from('<html><head><meta charset="iso-8859-1"></head><body><p>Qu\u00e9bec, \u00e9quipe</p></body></html>', "latin1"));
      return;
    }
    if (path === "/page") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<p>Hello, café.</p>");
    } else if (path === "/big") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("x".repeat(3 * 1024 * 1024));
    } else if (path === "/redirect") {
      response.writeHead(302, { location: "http://169.254.169.254/latest" });
      response.end();
    } else if (path === "/pdf") {
      bodyRequested += 1;
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end("%PDF-1.4 ".repeat(100_000));
    } else if (path === "/gzip") {
      response.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      response.end(zlib.gzipSync("<p>Packed text.</p>"));
    } else if (path === "/slow") {
      // Never answers.
    } else {
      response.writeHead(404, { "content-type": "text/html" });
      response.end("Not found");
    }
  });
  server.on("connection", () => (connections += 1));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A resolver that sends every name to `address` (the test server is on loopback). */
function resolveTo(address: string) {
  return ((_hostname: string, _options: unknown, callback: (error: null, addresses: { address: string; family: number }[]) => void) =>
    callback(null, [{ address, family: address.includes(":") ? 6 : 4 }])) as Parameters<typeof guardedLookup>[0];
}

/** The fetch with the connect-time guard swapped for one that allows the loopback test server. */
const allowLoopback = (hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) =>
  options.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4);
const fetchPage = createNodeFetch({ lookup: allowLoopback as unknown as ReturnType<typeof guardedLookup> });
const url = (path: string) => new URL(`http://site.test:${port}${path}`);
const limits = { timeoutMs: 5_000, maxBytes: 2 * 1024 * 1024 };

describe("createNodeFetch", () => {
  it("reads a page and decodes its charset", async () => {
    const page = await fetchPage(url("/page"), limits);
    expect(page).toMatchObject({ status: 200, tooLarge: false, contentType: "text/html; charset=utf-8" });
    expect(page.body).toBe("<p>Hello, café.</p>");
  });

  it("stops at the byte cap and marks the page too large", async () => {
    const page = await fetchPage(url("/big"), limits);
    expect(page.tooLarge).toBe(true);
    expect(page.body.length).toBe(2 * 1024 * 1024);
  });

  it("never follows a redirect: the reader checks where it points", async () => {
    const page = await fetchPage(url("/redirect"), limits);
    expect(page).toMatchObject({ status: 302, location: "http://169.254.169.254/latest", body: "" });
  });

  it("downloads no body for anything but text/html", async () => {
    const page = await fetchPage(url("/pdf"), limits);
    expect(page).toMatchObject({ status: 200, contentType: "application/pdf", body: "", tooLarge: false });
    expect(bodyRequested).toBe(1);
  });

  it("decompresses a gzip page", async () => {
    expect((await fetchPage(url("/gzip"), limits)).body).toBe("<p>Packed text.</p>");
  });

  it.each([["gzip"], ["deflate"], ["br"]])("stops at the byte cap after decompressing %s", async (encoding) => {
    const page = await fetchPage(url(`/${encoding}-big`), limits);
    expect(page.tooLarge).toBe(true);
    expect(page.body.length).toBe(2 * 1024 * 1024);
  });

  it("stops a compression bomb at the cap, quickly", async () => {
    const started = Date.now();
    const page = await fetchPage(url("/bomb"), limits);
    expect(page.tooLarge).toBe(true);
    expect(page.body.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it.each([["/gzip-cut"], ["/plain-cut"]])("fails at once when %s is cut off mid-body, not at the deadline", async (path) => {
    const started = Date.now();
    await expect(fetchPage(url(path), { ...limits, timeoutMs: 8_000 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("gives up on a server that trickles its body, at the timeout", async () => {
    const started = Date.now();
    await expect(fetchPage(url("/trickle"), { ...limits, timeoutMs: 500 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it("opens a new connection for every request, so none skips the guarded lookup", async () => {
    const before = connections;
    await fetchPage(url("/page"), limits);
    await fetchPage(url("/page"), limits);
    expect(connections - before).toBe(2);
  });

  it("names itself neutrally, with no product, client or purpose", async () => {
    await fetchPage(url("/page"), limits);
    expect(userAgents.at(-1)).toBe("Mozilla/5.0 (compatible; WebsiteReader/1.0)");
    expect(WEBSITE_READER_USER_AGENT).not.toMatch(/banhall|sr&ed|report/i);
  });

  it("gives up at its timeout", async () => {
    const started = Date.now();
    await expect(fetchPage(url("/slow"), { ...limits, timeoutMs: 300 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("decodeBody", () => {
  const latin1 = (text: string) => Buffer.from(text, "latin1");
  it("uses the header's charset first, then a <meta charset> in the first 1 KB, then UTF-8", () => {
    expect(decodeBody(latin1("<p>\u00e9</p>"), "text/html; charset=ISO-8859-1")).toBe("<p>é</p>");
    expect(decodeBody(latin1('<meta charset="windows-1252"><p>caf\u00e9 \u0080</p>'), "text/html")).toContain("café");
    expect(
      decodeBody(latin1('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><p>\u00e0 propos</p>'), "text/html")
    ).toContain("à propos");
    expect(decodeBody(Buffer.from("<p>é</p>", "utf8"), "text/html")).toBe("<p>é</p>");
    // A <meta> past the first 1 KB is not looked at; an unknown charset falls back.
    expect(decodeBody(latin1(`${" ".repeat(1100)}<meta charset="iso-8859-1"><p>\u00e9</p>`), null)).toContain("\ufffd");
    expect(decodeBody(Buffer.from("<p>é</p>", "utf8"), "text/html; charset=nonsense-9")).toBe("<p>é</p>");
  });

  it("reads a <meta> naming UTF-16 as UTF-8, and x-user-defined as windows-1252 (the WHATWG pre-scan rule)", () => {
    const ascii = '<meta charset="utf-16"><p>Quillmere Analytics caf\u00c3\u00a9</p>';
    for (const label of ["utf-16", "UTF-16LE", "utf-16be", "ucs-2"]) {
      expect(decodeBody(Buffer.from(ascii.replace("utf-16", label), "latin1"), "text/html")).toBe(
        `<meta charset="${label}"><p>Quillmere Analytics café</p>`
      );
    }
    expect(decodeBody(Buffer.from('<meta charset="x-user-defined"><p>\u0080 caf\u00e9</p>', "latin1"), null)).toContain("\u20ac café");
  });

  it("reads a page whose charset only its <meta> names", async () => {
    expect((await fetchPage(url("/latin1-meta"), limits)).body).toContain("Québec, équipe");
  });
});

describe("guardedLookup", () => {
  it.each([["127.0.0.1"], ["10.0.0.8"], ["169.254.169.254"], ["::1"]])(
    "refuses to connect when the name resolves to %s at connect time",
    async (address) => {
      const guarded = createNodeFetch({ lookup: guardedLookup(resolveTo(address)) });
      await expect(guarded(url("/page"), limits)).rejects.toMatchObject({ code: "EBLOCKEDADDRESS" });
    }
  );

  it("hands back a public address", async () => {
    const lookup = guardedLookup(resolveTo("93.184.216.34"));
    const answer = await new Promise<unknown[]>((resolve) => lookup("quillmere.com", {}, (...args) => resolve(args)));
    expect(answer).toEqual([null, "93.184.216.34", 4]);
  });
});
