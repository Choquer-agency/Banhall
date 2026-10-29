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
import type { Readable } from "node:stream";
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

function decoderFor(contentType: string | null): TextDecoder {
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? "")?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8");
  } catch {
    return new TextDecoder("utf-8");
  }
}

function decompressed(response: http.IncomingMessage): Readable {
  const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip") return response.pipe(zlib.createGunzip());
  if (encoding === "deflate") return response.pipe(zlib.createInflate());
  if (encoding === "br") return response.pipe(zlib.createBrotliDecompress());
  return response;
}

/**
 * One GET that never follows a redirect, stops at `maxBytes` of decoded body
 * (marking the page too large), downloads no body for a redirect or for
 * anything that is not text/html, and gives up after `timeoutMs`.
 */
export function createNodeFetch(options: { lookup?: ReturnType<typeof guardedLookup> } = {}): WebsiteDeps["fetchPage"] {
  const lookup = options.lookup ?? guardedLookup();
  return (url, { timeoutMs, maxBytes }) =>
    new Promise<WebsitePage>((resolve, reject) => {
      const transport = url.protocol === "https:" ? https : http;
      let settled = false;
      const done = (error: Error | null, page?: WebsitePage) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(page!);
      };
      const request = transport.request(
        url,
        {
          method: "GET",
          lookup: lookup as unknown as http.RequestOptions["lookup"],
          headers: {
            "user-agent": "BanhallWebsiteReader/1.0 (reads a company's own website for its SR&ED reports)",
            accept: "text/html",
            "accept-encoding": "gzip, deflate, br",
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const location = typeof response.headers.location === "string" ? response.headers.location : null;
          const contentType = typeof response.headers["content-type"] === "string" ? response.headers["content-type"] : null;
          const isHtml = (contentType ?? "").split(";")[0]!.trim().toLowerCase() === "text/html";
          if ((status >= 300 && status < 400) || !isHtml || status < 200 || status >= 300) {
            response.destroy();
            done(null, { status, location, contentType, body: "", tooLarge: false });
            return;
          }
          const body = decompressed(response);
          const chunks: Buffer[] = [];
          let size = 0;
          body.on("data", (chunk: Buffer) => {
            if (settled) return;
            if (size + chunk.length > maxBytes) {
              chunks.push(chunk.subarray(0, maxBytes - size));
              size = maxBytes;
              const text = decoderFor(contentType).decode(Buffer.concat(chunks));
              response.destroy();
              done(null, { status, location, contentType, body: text, tooLarge: true });
              return;
            }
            size += chunk.length;
            chunks.push(chunk);
          });
          body.on("end", () => done(null, { status, location, contentType, body: decoderFor(contentType).decode(Buffer.concat(chunks)), tooLarge: false }));
          body.on("error", (error) => done(error));
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
