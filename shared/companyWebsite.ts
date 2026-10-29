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

/** The one error a website that cannot be used gets. */
export const COMPANY_WEBSITE_INVALID = "Enter a website like hatchbetter.com.";

/**
 * The address to store for what the person typed, or null when it is not a
 * usable website. An empty entry is not a website (the caller treats it as
 * "no website").
 */
export function normalizeCompanyWebsite(raw: string): string | null {
  const typed = raw.trim();
  if (!typed || /\s/.test(typed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname;
  // A website has a name with a dot and a top-level part of letters
  // ("hatchbetter.com"), not a bare word or an address with no name.
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => !label)) return null;
  const top = labels[labels.length - 1]!;
  if (!/^[a-z]{2,63}$/i.test(top) && !/^xn--[a-z0-9-]{1,59}$/i.test(top)) return null;
  url.hash = "";
  let text = url.toString();
  // No trailing slash, at the root or after a path.
  while (text.endsWith("/")) text = text.slice(0, -1);
  if (text.length > COMPANY_WEBSITE_MAX_LENGTH) return null;
  return text;
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
