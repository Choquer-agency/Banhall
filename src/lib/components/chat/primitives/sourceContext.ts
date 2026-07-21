import { getContext, setContext } from "svelte";

const SOURCE_CONTEXT = Symbol("prompt-kit-source");

export interface SourceContext {
  href: string;
  domain: string;
  faviconUrl: string;
}

export function setSourceContext(getHref: () => string): SourceContext {
  function domain(): string {
    const href = getHref();
    try {
      return new URL(href).hostname;
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
      return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(getHref())}`;
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
