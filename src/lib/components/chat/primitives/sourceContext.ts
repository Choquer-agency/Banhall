import { getContext, setContext } from "svelte";

const SOURCE_CONTEXT = Symbol("prompt-kit-source");

export interface SourceContext {
  href: string;
  domain: string;
  faviconUrl: string;
}

/**
 * The favicon service request for a source link. It carries the hostname
 * only (Phase A, task 3): the full link can hold a path, query or token that
 * says what the writer was reading, and Google needs none of it. A link that
 * does not parse gets no favicon.
 */
export function faviconUrlFor(href: string): string {
  let hostname: string;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    hostname = url.hostname;
  } catch {
    return "";
  }
  return hostname ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}` : "";
}

export function setSourceContext(getHref: () => string): SourceContext {
  function domain(): string {
    const href = getHref();
    try {
      return new URL(href).hostname.replace(/^www\./, "");
    } catch {
      return href.split("/").pop() || href;
    }
  }
  const context: SourceContext = {
    get href() {
      return getHref();
    },
    get domain() {
      return domain();
    },
    get faviconUrl() {
      return faviconUrlFor(getHref());
    },
  };
  setContext(SOURCE_CONTEXT, context);
  return context;
}

export function getSourceContext(): SourceContext {
  const context = getContext<SourceContext | undefined>(SOURCE_CONTEXT);
  if (!context) throw new Error("Source.* must be used inside <Source>");
  return context;
}
