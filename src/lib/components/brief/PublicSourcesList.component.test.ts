import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import PublicSourcesList, {
  PUBLIC_SOURCES_COPY,
  type WebBackgroundRecord,
} from "./PublicSourcesList.svelte";

const q = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

const USED: WebBackgroundRecord = {
  status: "used",
  queries: [
    { query: "How does log-based change data capture work in PostgreSQL?", kind: "technology", status: "ok" },
    { query: "How does CRA define standard practice?", kind: "cra", status: "ok" },
  ],
  sources: [
    { n: 1, url: "https://www.postgresql.org/docs/current/logical-replication.html", title: "Logical Replication", domain: "postgresql.org" },
    { n: 2, url: "https://www.canada.ca/en/revenue-agency/sred.html", title: "SR&ED guidance", domain: "canada.ca" },
  ],
  droppedQueries: 1,
  cached: false,
};

describe("PublicSourcesList (2026-11-02, proposed)", () => {
  it("lists each source with its W number, a safe link and its host, then the searches as sent", async () => {
    await render(PublicSourcesList, { record: USED });
    const section = q("[data-public-sources]")!;
    expect(text(section)).toContain(PUBLIC_SOURCES_COPY.title);
    expect(text(section)).toContain(PUBLIC_SOURCES_COPY.meta);
    const rows = [...document.querySelectorAll<HTMLElement>("[data-public-source]")];
    expect(rows.map((row) => text(row))).toEqual([
      "W1 Logical Replication postgresql.org",
      "W2 SR&ED guidance canada.ca",
    ]);
    const link = rows[0]!.querySelector<HTMLAnchorElement>("a")!;
    expect(link.href).toBe(USED.sources[0]!.url);
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(text(q("[data-public-sources-queries]"))).toBe(
      "Searched for: How does log-based change data capture work in PostgreSQL?; How does CRA define standard practice?"
    );
    expect(text(section)).not.toMatch(/[\u2010-\u2015\u2212]/u);
  });

  it("says when the writer turned it off, and why nothing was used otherwise", async () => {
    await render(PublicSourcesList, { record: { ...USED, status: "off_for_run", sources: [], queries: [] } });
    expect(text(q("[data-public-sources-note]"))).toBe(PUBLIC_SOURCES_COPY.offForRun);
    document.body.innerHTML = "";
    await render(PublicSourcesList, {
      record: { ...USED, status: "failed", sources: [], reason: "No search returned a usable answer with a source." },
    });
    expect(text(q("[data-public-sources-note]"))).toBe(
      `${PUBLIC_SOURCES_COPY.none} No search returned a usable answer with a source.`
    );
    expect(q("[data-public-source]")).toBeNull();
  });

  it("shows nothing for a deployment that does not look it up", async () => {
    await render(PublicSourcesList, { record: { ...USED, status: "off_for_deployment", sources: [], queries: [] } });
    expect(q("[data-public-sources]")).toBeNull();
  });
});
