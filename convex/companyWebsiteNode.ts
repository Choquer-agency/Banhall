"use node";

/**
 * Fetches a company's website on the server (owner, 2026-10-29) and hands
 * the text to `companyWebsite.finishWebsiteRead`. The rules (what may be
 * fetched, redirects, limits, the text) are `lib/websiteRead.ts`; this file
 * supplies the network. Every connection resolves its host through
 * `guardedLookup`, which refuses a blocked address at the moment of
 * connecting, so a name that resolves to a public address when checked and
 * to a private one when connecting is still refused. Only the company's own
 * address is fetched: no AI call and no web search.
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { pipeline, type Readable } from "node:stream";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { isBlockedAddress, readWebsite, type WebsiteDeps, type WebsitePage } from "./lib/websiteRead";

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void;
type Resolver = (hostname: string, options: dns.LookupAllOptions, callback: (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void) => void;

/** A `lookup` for http(s).request that refuses any blocked address at connect time. */
export function guardedLookup(resolve: Resolver = dns.lookup as unknown as Resolver) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    resolve(hostname, { family: options.family as 0 | 4 | 6 | undefined, all: true, verbatim: true }, (error, addresses) => {
      if (error) return callback(error, []);
      if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) {
        const blocked: NodeJS.ErrnoException = new Error(`Refused to connect to ${hostname}: blocked address`);
        blocked.code = "EBLOCKEDADDRESS";
        return callback(blocked, []);
      }
      if (options.all) return callback(null, addresses);
      return callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

/**
 * The body as text: in the Content-Type's charset, or else the one a
 * `<meta charset>` (or `http-equiv` Content-Type) names in its first 1 KB,
 * or else UTF-8. As the WHATWG pre-scan rule says, a meta tag naming UTF-16
 * means UTF-8 (a page that can say so in ASCII is not UTF-16), and one
 * naming x-user-defined means windows-1252.
 */
export function decodeBody(bytes: Buffer, contentType: string | null): string {
  const fromHeader = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? "")?.[1];
  const head = fromHeader ? "" : bytes.subarray(0, 1024).toString("latin1");
  const named = fromHeader ? undefined : /<meta\b[^>]{0,300}?charset\s*=\s*["']?\s*([a-zA-Z0-9_:.-]+)/i.exec(head)?.[1];
  const fromMeta = !named
    ? undefined
    : /^(utf-?16|utf-?16le|utf-?16be|ucs-?2|csunicode|iso-10646-ucs-2|unicode|unicodefeff|unicodefffe)$/i.test(named)
      ? "utf-8"
      : /^x-user-defined$/i.test(named)
        ? "windows-1252"
        : named;
  for (const label of [fromHeader, fromMeta, "utf-8"]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // An unknown charset: try the next.
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * The body, decompressed. zlib's streams take no output limit (its
 * `maxOutputLength` applies only to the one-call buffer helpers), so the
 * byte cap is kept by the data handler below, which destroys the stream as
 * soon as `maxBytes` is passed. `pipeline` (not `pipe`) passes a response
 * cut off mid-body on to the decompressor as an error, so the read fails at
 * once instead of waiting out its deadline.
 */
function decompressed(response: http.IncomingMessage): Readable {
  const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
  const decoder =
    encoding === "gzip" || encoding === "x-gzip"
      ? zlib.createGunzip()
      : encoding === "deflate"
        ? zlib.createInflate()
        : encoding === "br"
          ? zlib.createBrotliDecompress()
          : null;
  if (!decoder) return response;
  // Errors reach the decompressor (pipeline destroys it with them) and its
  // own "error" handler; nothing more to do here.
  return pipeline(response, decoder, () => {});
}

/** A neutral, honest name for the reader: no product, client or purpose in it. */
export const WEBSITE_READER_USER_AGENT = "Mozilla/5.0 (compatible; WebsiteReader/1.0)";

/**
 * One GET that never follows a redirect, stops at `maxBytes` of decompressed
 * body (keeping those bytes and marking the page too large, so its first
 * 2 MB are read), downloads no body for a redirect or for
 * anything that is not text/html, and gives up after `timeoutMs`. Every
 * request opens its own connection (`agent: false`), so no kept-alive
 * connection skips the guarded lookup, and no proxy from the environment is
 * used.
 */
export function createNodeFetch(options: { lookup?: ReturnType<typeof guardedLookup> } = {}): WebsiteDeps["fetchPage"] {
  const lookup = options.lookup ?? guardedLookup();
  return (url, { timeoutMs, maxBytes }) =>
    new Promise<WebsitePage>((resolve, reject) => {
      const transport = url.protocol === "https:" ? https : http;
      let settled = false;
      let body: Readable | null = null;
      let response: http.IncomingMessage | null = null;
      const done = (error: Error | null, page?: WebsitePage) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Stop reading and decompressing at once.
        if (body && body !== response) body.destroy();
        response?.destroy();
        if (error) reject(error);
        else resolve(page!);
      };
      const request = transport.request(
        url,
        {
          method: "GET",
          agent: false,
          lookup: lookup as unknown as http.RequestOptions["lookup"],
          headers: {
            "user-agent": WEBSITE_READER_USER_AGENT,
            accept: "text/html",
            "accept-encoding": "gzip, deflate, br",
          },
        },
        (incoming) => {
          response = incoming;
          // A response cut off before its end fails the read at once.
          incoming.on("aborted", () => done(new Error("The website closed the connection mid-page")));
          incoming.on("error", (error) => done(error));
          incoming.on("close", () => {
            if (!incoming.complete) done(new Error("The website closed the connection mid-page"));
          });
          const status = response.statusCode ?? 0;
          const location = typeof response.headers.location === "string" ? response.headers.location : null;
          const contentType = typeof response.headers["content-type"] === "string" ? response.headers["content-type"] : null;
          const isHtml = (contentType ?? "").split(";")[0]!.trim().toLowerCase() === "text/html";
          if ((status >= 300 && status < 400) || !isHtml || status < 200 || status >= 300) {
            done(null, { status, location, contentType, body: "", tooLarge: false });
            return;
          }
          const stream = decompressed(incoming);
          body = stream;
          const chunks: Buffer[] = [];
          let size = 0;
          const tooLarge = () => {
            done(null, { status, location, contentType, body: decodeBody(Buffer.concat(chunks), contentType), tooLarge: true });
          };
          stream.on("data", (chunk: Buffer) => {
            if (settled) return;
            if (size + chunk.length > maxBytes) {
              chunks.push(chunk.subarray(0, maxBytes - size));
              size = maxBytes;
              tooLarge();
              return;
            }
            size += chunk.length;
            chunks.push(chunk);
          });
          stream.on("end", () =>
            done(null, { status, location, contentType, body: decodeBody(Buffer.concat(chunks), contentType), tooLarge: false })
          );
          stream.on("error", (error) => done(error));
        }
      );
      const timer = setTimeout(() => {
        request.destroy(new Error("The website did not answer in time"));
        done(new Error("timeout"));
      }, timeoutMs);
      request.on("error", (error) => done(error));
      request.end();
    });
}

/** The real network and DNS, the address checked before and while connecting. */
export function nodeWebsiteDeps(): WebsiteDeps {
  return {
    lookup: async (hostname) =>
      (await dns.promises.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address),
    fetchPage: createNodeFetch(),
    now: () => Date.now(),
  };
}

export const readCompanyWebsite = internalAction({
  args: {
    clientId: v.id("clients"),
    url: v.string(),
    requestedAt: v.number(),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = await readWebsite(args.url, nodeWebsiteDeps());
    await ctx.runMutation(internal.companyWebsite.finishWebsiteRead, { ...args, result });
    return null;
  },
});
