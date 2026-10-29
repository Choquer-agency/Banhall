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
import { createNodeFetch, guardedLookup } from "../convex/companyWebsiteNode";

let server: http.Server;
let port = 0;
let bodyRequested = 0;

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const path = request.url ?? "/";
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

  it("gives up at its timeout", async () => {
    const started = Date.now();
    await expect(fetchPage(url("/slow"), { ...limits, timeoutMs: 300 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3_000);
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
    const answer = await new Promise<unknown[]>((resolve) => lookup("hatchbetter.com", {}, (...args) => resolve(args)));
    expect(answer).toEqual([null, "93.184.216.34", 4]);
  });
});
