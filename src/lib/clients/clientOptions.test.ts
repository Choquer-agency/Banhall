import { describe, expect, it } from "vitest";
import {
  CLIENT_OPTION_LIMIT,
  listedClientFor,
  matchingClients,
  mergeClientOptions,
  type ClientOption,
} from "./clientOptions";

const option = (name: string, extra: Partial<ClientOption> = {}): ClientOption => ({
  key: name.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en-CA"),
  clientId: null,
  name,
  projectCount: 1,
  ...extra,
});

const OPTIONS = [option("Cedarline Systems"), option("Cedar Ridge Analytics"), option("Mercedes Tooling"), option("Éclair Foods")];

describe("matchingClients", () => {
  it("matches a substring, ignoring case and accents", () => {
    expect(matchingClients(OPTIONS, "ced").map((o) => o.name)).toEqual([
      "Cedarline Systems",
      "Cedar Ridge Analytics",
      "Mercedes Tooling",
    ]);
    expect(matchingClients(OPTIONS, "eclair").map((o) => o.name)).toEqual(["Éclair Foods"]);
  });

  it("lists everything for empty text and leaves out the name already typed", () => {
    expect(matchingClients(OPTIONS, "  ")).toHaveLength(4);
    expect(matchingClients(OPTIONS, "cedarline systems").map((o) => o.name)).toEqual([]);
  });

  it("shows at most the option limit", () => {
    const many = Array.from({ length: 20 }, (_, index) => option(`Client ${index}`));
    expect(matchingClients(many, "client")).toHaveLength(CLIENT_OPTION_LIMIT);
  });
});

describe("listedClientFor", () => {
  it("finds the option with the same key", () => {
    expect(listedClientFor(OPTIONS, "  CEDARLINE   systems ")?.name).toBe("Cedarline Systems");
    expect(listedClientFor(OPTIONS, "eclair foods")?.name).toBe("Éclair Foods");
  });

  it("returns null for a partial name or empty text", () => {
    expect(listedClientFor(OPTIONS, "Cedarline")).toBeNull();
    expect(listedClientFor(OPTIONS, "   ")).toBeNull();
  });
});

describe("mergeClientOptions", () => {
  it("keeps the first option for a key", () => {
    const listed = option("Acme", { fiscalYearEndMonth: 6, fiscalYearEndDay: 30 });
    const added = option("ACME", { projectCount: 0 });
    expect(mergeClientOptions([listed], [added, option("Borealis")])).toEqual([listed, option("Borealis")]);
  });
});
