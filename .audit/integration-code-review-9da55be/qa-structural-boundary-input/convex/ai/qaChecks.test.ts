import { describe, expect, it } from "vitest";
import {
  checkBannedWords,
  checkBecauseClauses,
  checkCRAOpeners,
  checkDashConnectors,
  checkRepetition,
  runDeterministicChecks,
  sectionDeterministicFindings,
} from "./qaChecks";
import { scrubBannedWords } from "../../shared/bannedWords";
import { normalizeStyleOverrides } from "../../shared/styleOverrides";

// ─── Fixtures ───────────────────────────────────────────────────────────────

// 246: P1 summary, P2-P4 advancement paragraphs, P5 wrap-up.
const section246Pass = [
  "The project advanced the field of distributed caching in three ways.",
  "Through systematic investigation, it was determined that write-through caching fails under partition. The finding held across all replicas.",
  "It was determined that consensus latency dominates tail response times. The team measured this across three deployments.",
  "The experimental work demonstrated that batched invalidation preserves consistency. This closed the final open question.",
  "These advancements were documented in the release engineering records.",
].join("\n\n");

const section246Fail = [
  "The project advanced the field of distributed caching.",
  "The team found that write-through caching fails under partition.",
  "Consensus latency was clearly the dominant factor in tail response times.",
  "Batching worked well in the final deployment.",
].join("\n\n");

// 242: exactly five paragraphs; P5 (index 4) carries the uncertainties.
const section242Pass = [
  "The company operates a distributed cache serving production traffic.",
  "Standard tooling could not model partition behaviour at this scale.",
  "The limitations to standard practice were the absence of partition-aware models.",
  "The technological objective was to build a partition-tolerant cache layer.",
  "It was uncertain whether write-through caching could survive partition because no consistency model covered concurrent invalidation. It remained uncertain how batching would behave because the failure modes were undocumented.",
].join("\n\n");

const section242Fail = [
  "The company operates a distributed cache serving production traffic.",
  "Standard tooling could not model partition behaviour at this scale.",
  "The limitations to standard practice were the absence of partition-aware models.",
  "The technological objective was to build a partition-tolerant cache layer.",
  "It was uncertain whether write-through caching could survive partition. Uncertainty existed regarding batching behaviour because the failure modes were undocumented.",
].join("\n\n");

// ─── Check 1: CRA openers (246 P2-P4) ───────────────────────────────────────

describe("checkCRAOpeners", () => {
  it("passes when P2-P4 open with CRA advancement formulations", () => {
    const result = checkCRAOpeners(section246Pass);
    expect(result.count).toBe(3);
    expect(result.total).toBe(3);
    expect(result.results.map((r) => r.paragraph)).toEqual([2, 3, 4]);
    expect(result.results.every((r) => r.passes)).toBe(true);
  });

  it("fails paragraphs without a qualifying opener", () => {
    const result = checkCRAOpeners(section246Fail);
    expect(result.count).toBe(0);
    expect(result.results.every((r) => r.passes)).toBe(false);
  });

  // Positional pin: P2-P4 are paragraph indexes 1-3; P1 and P5 are never
  // scanned even when they carry a qualifying opener.
  it("only scans indexes 1-3 (P1 and P5 excluded)", () => {
    const decoy = [
      "Through systematic investigation, it was determined that P1 is excluded.",
      "The team found something in P2.",
      "The team found something in P3.",
      "The team found something in P4.",
      "Through systematic investigation, it was determined that P5 is excluded.",
    ].join("\n\n");
    const result = checkCRAOpeners(decoy);
    expect(result.total).toBe(3);
    expect(result.count).toBe(0);
    expect(result.results.map((r) => r.paragraph)).toEqual([2, 3, 4]);
  });

  it("handles a short section without throwing", () => {
    const result = checkCRAOpeners("Only one paragraph.");
    expect(result.total).toBe(0);
    expect(result.count).toBe(0);
  });
});

// ─── Check 2: BECAUSE clauses (242 P5) ──────────────────────────────────────

describe("checkBecauseClauses", () => {
  it("counts uncertainty sentences and their BECAUSE clauses", () => {
    const result = checkBecauseClauses(section242Pass);
    expect(result.uncertaintyCount).toBe(2);
    expect(result.withBecause).toBe(2);
  });

  it("flags an uncertainty sentence missing its BECAUSE clause", () => {
    const result = checkBecauseClauses(section242Fail);
    expect(result.uncertaintyCount).toBe(2);
    expect(result.withBecause).toBe(1);
    expect(result.details[0].hasBecause).toBe(false);
    expect(result.details[1].hasBecause).toBe(true);
  });

  // CAP-8: recognized uncertainty statements must be checked at every position.
  it("scans every paragraph regardless of skeleton", () => {
    const decoy = [
      "It was uncertain whether P1 counts.",
      "It was uncertain whether P2 counts.",
      "It was uncertain whether P3 counts.",
      "It was uncertain whether P4 counts.",
      "The final paragraph makes no uncertainty statement.",
    ].join("\n\n");
    expect(checkBecauseClauses(decoy).uncertaintyCount).toBe(4);
  });

  it("checks missing and present because clauses in a single short paragraph", () => {
    expect(checkBecauseClauses("It was uncertain whether this scales.").withBecause).toBe(0);
    expect(checkBecauseClauses("It was uncertain whether this scales.").uncertaintyCount).toBe(1);
    expect(checkBecauseClauses("It was uncertain whether this scales because the response was unknown.").withBecause).toBe(1);
  });

  it("returns zero counts when no recognized uncertainty marker exists", () => {
    const result = checkBecauseClauses("One.\n\nTwo.");
    expect(result.uncertaintyCount).toBe(0);
    expect(result.withBecause).toBe(0);
  });
});

// ─── Check 3: banned-word scan ──────────────────────────────────────────────

describe("checkBannedWords", () => {
  it("finds nothing in clean sections", () => {
    const result = checkBannedWords(section242Pass, "Clean text.", section246Pass);
    expect(result.found).toEqual([]);
  });

  it("attributes findings to the right section with context", () => {
    const result = checkBannedWords(
      "The novel cache was robust.",
      "A seamless rollout.",
      "This was cutting-edge work."
    );
    expect(result.found.map((f) => [f.word, f.section])).toEqual([
      ["novel", "242"],
      ["robust", "242"],
      ["seamless", "244"],
      ["cutting-edge", "246"],
    ]);
    expect(result.found[0].context).toContain("novel cache");
  });

  it("flags terms the old hand-kept list missed (adjectives, phrases)", () => {
    const result = checkBannedWords(
      "A substantial and significant gain that paved the way forward.",
      "",
      ""
    );
    expect(result.found.map((f) => f.word)).toEqual(
      expect.arrayContaining(["substantial", "significant", "paved the way"])
    );
  });

  it("flags scan-only terms the scrubber leaves alone", () => {
    const text = "The goal was to transform ingestion by delving deeper.";
    expect(scrubBannedWords(text)).toBe(text);
    const result = checkBannedWords(text, "", "");
    expect(result.found.map((f) => f.word)).toEqual(
      expect.arrayContaining(["transform", "delving"])
    );
  });

  it("never fires on scrubbed output (scanner and scrubber cannot diverge)", () => {
    const dirty =
      "Fundamentally, the novel system leveraged a robust, seamless, state-of-the-art paradigm. Furthermore, substantial synergy emerged significantly.";
    const result = checkBannedWords(scrubBannedWords(dirty), "", "");
    expect(result.found).toEqual([]);
  });

  it("respects word boundaries", () => {
    const result = checkBannedWords(
      "The novelty of the transformation was uniquely robustness-free.",
      "",
      ""
    );
    expect(result.found).toEqual([]);
  });
});

// ─── Check 4: repetition count ──────────────────────────────────────────────

describe("checkRepetition", () => {
  it("counts across all three sections", () => {
    const result = checkRepetition(
      "Systematic investigation began. The systematic investigation continued.",
      "Systematic experimentation followed.",
      "The technological uncertainty persisted. Technological uncertainties remained."
    );
    expect(result.systematicInvestigation).toBe(3);
    expect(result.technologicalUncertainty).toBe(2);
  });

  it("returns zeros for clean text", () => {
    const result = checkRepetition("A.", "B.", "C.");
    expect(result).toEqual({
      systematicInvestigation: 0,
      technologicalUncertainty: 0,
    });
  });
});

// ─── Iterative-mode wrapper ─────────────────────────────────────────────────

describe("sectionDeterministicFindings", () => {
  it("scopes banned words to the reviewed section and skips cross-section checks", () => {
    const findings = sectionDeterministicFindings("s244", "A novel rollout.");
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("banned_word");
    expect(findings[0].message).toContain('"novel"');
  });

  it("runs the BECAUSE check for 242 and the opener check for 246", () => {
    const because = sectionDeterministicFindings("s242", section242Fail);
    expect(because.some((f) => f.check === "because_clause")).toBe(true);
    const openers = sectionDeterministicFindings("s246", section246Fail);
    expect(openers.filter((f) => f.check === "cra_opener")).toHaveLength(3);
  });
});

// ─── PSOS-49: house-style waivers ───────────────────────────────────────────

describe("style-override waivers", () => {
  const waive = (partial: Record<string, boolean>) =>
    normalizeStyleOverrides(partial);

  it("keeps uncertainty findings outside P5 under all writer waivers", () => {
    const findings = sectionDeterministicFindings("s242",
      "Context.\n\nIt remained uncertain whether the method scales.\n\nOther material.",
      waive({ reportSkeleton: true, openingClauses: true, bannedWords: true, repetitionCaps: true }));
    expect(findings.map(f => f.check)).toEqual(["because_clause"]);
  });

  it("sectionDeterministicFindings skips banned words when waived", () => {
    const findings = sectionDeterministicFindings(
      "s244",
      "A novel rollout.",
      waive({ bannedWords: true })
    );
    expect(findings).toEqual([]);
  });

  it("sectionDeterministicFindings skips openers when waived but keeps BECAUSE", () => {
    const openers = sectionDeterministicFindings(
      "s246",
      section246Fail,
      waive({ openingClauses: true })
    );
    expect(openers.filter((f) => f.check === "cra_opener")).toEqual([]);
    // The because-clause check is CRA methodology — never waivable.
    const because = sectionDeterministicFindings(
      "s242",
      section242Fail,
      waive({ openingClauses: true, bannedWords: true, repetitionCaps: true })
    );
    expect(because.some((f) => f.check === "because_clause")).toBe(true);
  });

  it("sectionDeterministicFindings skips repetition flags when waived", () => {
    const heavy =
      "Systematic investigation one. Systematic investigation two. Systematic investigation three.";
    expect(
      sectionDeterministicFindings("s244", heavy).some(
        (f) => f.check === "repetition"
      )
    ).toBe(true);
    expect(
      sectionDeterministicFindings("s244", heavy, waive({ repetitionCaps: true }))
    ).toEqual([]);
  });

  it("runDeterministicChecks reports WAIVED per category and drops findings", () => {
    const dirty242 = section242Pass.replace(
      "The company operates",
      "The novel company operates"
    );
    const summary = runDeterministicChecks(
      dirty242,
      "Section 244.",
      section246Fail,
      waive({ bannedWords: true, openingClauses: true, repetitionCaps: true })
    );
    expect(summary).toContain("### Banned Word Scan\nWAIVED by writer profile");
    expect(summary).toContain("### CRA Opener Detection (246 P2-P4)\nWAIVED by writer profile");
    expect(summary).toContain("### Repetition Count\nWAIVED by writer profile");
    expect(summary).not.toContain('"novel"');
    // No opener FAIL lines despite section246Fail having no qualifying openers.
    expect(summary).not.toContain("FAIL —");
    // BECAUSE detection still runs (both fixtures' uncertainty sentences pass).
    expect(summary).toContain("### BECAUSE Clause Detection (242, all paragraphs)");
    expect(summary).toContain("Uncertainties with BECAUSE clauses: 2/2");
  });

  // User resolution 2026-09-04: CAP-8 methodology is absolute.
  it("reportSkeleton waives openers but never BECAUSE", () => {
    const skeletonWaived = waive({ reportSkeleton: true });
    expect(
      sectionDeterministicFindings("s242", section242Fail, skeletonWaived).some(
        (f) => f.check === "because_clause"
      )
    ).toBe(true);
    expect(
      sectionDeterministicFindings("s246", section246Fail, skeletonWaived).some(
        (f) => f.check === "cra_opener"
      )
    ).toBe(false);
    // Vocabulary and prose scans are governed by their own toggles.
    expect(
      sectionDeterministicFindings("s244", "A novel rollout -- shipped.", skeletonWaived).map(
        (f) => f.check
      )
    ).toEqual(["banned_word", "dash_connector"]);

    const summary = runDeterministicChecks(
      section242Fail,
      "Section 244.",
      section246Fail,
      skeletonWaived
    );
    expect(summary).toContain("### CRA Opener Detection (246 P2-P4)\nWAIVED by writer profile");
    expect(summary).toContain("Uncertainties with BECAUSE clauses: 1/2");
    expect(summary).toContain("FAIL —");
    expect(summary).toContain("No banned words found.");
  });

  it("runDeterministicChecks default output is unchanged without waivers", () => {
    const summary = runDeterministicChecks(
      section242Pass,
      "Clean.",
      section246Pass
    );
    expect(summary).not.toContain("WAIVED");
    expect(summary).toContain("Qualifying openers found: 3/3");
    expect(summary).toContain("No banned words found.");
    expect(summary).toContain('"systematic investigation/experimentation"');
  });
});

describe("checkDashConnectors", () => {
  it("attributes em-dash hits to the right section and surfaces them in the deterministic summary", () => {
    const s244 = "It was hypothesized that if loading fell — then the mass would stay mobile.";
    const result = checkDashConnectors("Clean 242 text.", s244, "Clean 246 text.");
    expect(result.found).toHaveLength(1);
    expect(result.found[0].section).toBe("244");

    const summary = runDeterministicChecks("Clean 242 text.", s244, "Clean 246 text.");
    expect(summary).toContain("### Dash Connector Scan");
    expect(summary).toContain('"—" in Section 244');
  });

  it("is reported per section regardless of style waivers", () => {
    const waived = normalizeStyleOverrides({
      bannedWords: true,
      sentenceConstruction: true,
      repetitionCaps: true,
      paragraphDensity: true,
      openingClauses: true,
    });
    const findings = sectionDeterministicFindings("s246", "Through investigation -- it was found.", waived);
    expect(findings.some((f) => f.check === "dash_connector")).toBe(true);
  });
});
