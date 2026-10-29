/**
 * A company's website (owner, 2026-10-29: "We can include the company
 * website field"). Shared by New company and Edit company in the browser and
 * by the server, so both store and show the same address.
 *
 * Stored as a normalized absolute http(s) address: https:// added when no
 * scheme is given, the host lowercased (the URL parser does it), no user or
 * password, no fragment, and no trailing slash. Shown as its host only, a
 * leading "www." dropped ("hatchbetter.com").
 */

/** Longest address accepted, after normalizing. */
export const COMPANY_WEBSITE_MAX_LENGTH = 500;

/** The error a website that cannot be used gets. */
export const COMPANY_WEBSITE_INVALID = "Enter a website like hatchbetter.com.";
/** A website with a port the reader does not use (only the usual http and https ports). */
export const COMPANY_WEBSITE_PORT = "Enter the website without a port number, like hatchbetter.com.";

/**
 * The address to store for what the person typed, or null when it is not a
 * usable website. An empty entry is not a website (the caller treats it as
 * "no website").
 */
export function normalizeCompanyWebsite(raw: string): string | null {
  return checkCompanyWebsite(raw).url;
}

/**
 * What is wrong with a typed website, or null when it is usable (or empty,
 * which means no website): "Enter a website like hatchbetter.com.", or the
 * port message for an address with a port other than the usual one.
 */
export function companyWebsiteProblem(raw: string): string | null {
  if (!raw.trim()) return null;
  return checkCompanyWebsite(raw).problem;
}

function checkCompanyWebsite(raw: string): { url: string; problem: null } | { url: null; problem: string } {
  const refused = { url: null, problem: COMPANY_WEBSITE_INVALID } as const;
  const typed = raw.trim();
  if (!typed || /\s/.test(typed)) return refused;
  // "hatchbetter.com:8080" names no scheme; "https://" goes first.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) || /^(mailto|javascript|data|tel|file):/i.test(typed) ? typed : `https://${typed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return refused;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return refused;
  if (url.username || url.password) return refused;
  // The URL parser drops a port that is the scheme's own (":443" on https).
  if (url.port) return { url: null, problem: COMPANY_WEBSITE_PORT };
  const host = url.hostname;
  // A website has a name with a dot and a top-level part of letters
  // ("hatchbetter.com"), not a bare word or an address with no name.
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => !label)) return refused;
  const top = labels[labels.length - 1]!;
  if (!/^[a-z]{2,63}$/i.test(top) && !/^xn--[a-z0-9-]{1,59}$/i.test(top)) return refused;
  url.hash = "";
  let text = url.toString();
  // No trailing slash, at the root or after a path.
  while (text.endsWith("/")) text = text.slice(0, -1);
  if (text.length > COMPANY_WEBSITE_MAX_LENGTH) return refused;
  return { url: text, problem: null };
}

/** The host to show for a stored address ("hatchbetter.com"), or the address itself if it does not parse. */
export function companyWebsiteHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The company file a website's text is saved as ("Website: hatchbetter.com"). */
export function companyWebsiteFileName(url: string): string {
  return `Website: ${companyWebsiteHost(url)}`;
}
