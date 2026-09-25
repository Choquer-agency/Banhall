/**
 * The other readers of verified facts (phase 3, plan step 8): the chat's
 * TRANSCRIPT FACTS block, the Brain query built from facts, and the PD
 * review's heading. Pure.
 */
import { describe, expect, it } from "vitest";
import {
  CHAT_TRANSCRIPT_FACTS_TOKENS,
  EVIDENCE_LABELS,
  buildChatEvidence,
  buildChatTurnRequest,
  chatFactsText,
} from "./chatEvidence";
import { CHARS_PER_TOKEN } from "./trustedContext";
import { retrievalBriefFromFacts } from "./brain/query";
import { PD_REVIEW_FACTS_HEADING, buildPdReviewUserMessage } from "./reviewAgent";
import { buildPlaceholderMap } from "../lib/deidentify";
import { renderFactPack, type PackFact } from "../lib/transcriptFacts";

function pack(position: number, label: string, facts: PackFact[]): string {
  return renderFactPack({ position, label }, facts, { roles: new Map(), turnInfo: new Map() });
}

const fact = (key: string, type: PackFact["type"], claim: string, turn: number): PackFact => ({
  key,
  type,
  claim,
  turnIndexes: [turn],
  quotes: [],
});

const PACK_ONE = pack(1, "Kickoff", [
  fact("F1", "context", "Verdant Grid runs forecasting for three utilities.", 1),
  fact("F2", "uncertainty", "Priya Shah said net load could not be forecast under fast cloud cover.", 2),
  fact("F3", "experiment", "The team trained a ramp model on 2025 feeder data.", 3),
  fact("F4", "advancement", "They learned that satellite cloud motion predicts ramps ten minutes ahead.", 4),
]);
const PACK_TWO = pack(2, "Follow-up", [
  fact("F1", "result", "The ramp model reached 71 percent accuracy on sunny days.", 1),
  fact("F2", "hypothesis", "They proposed that cloud edges drive the largest ramps.", 2),
]);

describe("the chat's TRANSCRIPT FACTS block", () => {
  it("keeps every pack's heading and, over the cap, the highest-ranked facts in pack order", () => {
    const whole = chatFactsText([PACK_ONE, PACK_TWO], 100_000);
    expect(whole).toContain("Transcript 1: Kickoff");
    expect(whole).toContain("[F2-2] (hypothesis)");
    expect(whole).not.toContain("omitted");
    expect(whole).not.toContain("Verified facts. Cite a fact by its id");

    const capped = chatFactsText([PACK_ONE, PACK_TWO], 240);
    expect(capped).toContain("[F1-2] (uncertainty)");
    expect(capped).not.toContain("[F1-1] (context)");
    expect(capped).toMatch(/\[\d more facts omitted to fit\.\]$/);
    expect(capped.length).toBeLessThanOrEqual(240 + 40);
    // Deterministic, so the cached head is byte-stable across turns.
    expect(chatFactsText([PACK_ONE, PACK_TWO], 240)).toBe(capped);
  });

  it("sits in the cached head after the analysis, and leaves the head unchanged without packs", () => {
    const context = {
      reportContent: null,
      agentOutputs: JSON.stringify({ analyzer: { project_goal: "Forecast net load" } }),
      documents: [{ fileName: "plan.txt", content: "Test plan." }],
      decisions: [],
    };
    const without = buildChatTurnRequest({ context });
    const withFacts = buildChatTurnRequest({ context: { ...context, transcriptFacts: [PACK_ONE, PACK_TWO] } });
    const head = String(withFacts.messages[0].content);
    const block = `--- BEGIN [${EVIDENCE_LABELS.transcriptFacts}`;
    expect(head.indexOf(block)).toBeGreaterThan(head.indexOf(EVIDENCE_LABELS.analysis));
    expect(head.indexOf(block)).toBeLessThan(head.indexOf("plan.txt"));
    expect(String(without.messages[0].content)).not.toContain(EVIDENCE_LABELS.transcriptFacts + "]");
    expect(withFacts.messages.slice(1)).toEqual(without.messages.slice(1));
    expect(withFacts.report.sources.find((source) => source.label === EVIDENCE_LABELS.transcriptFacts)).toMatchObject({
      kind: "transcript",
      trust: "client",
      included: true,
    });
    // Byte-stable across turns that only change the report.
    const later = buildChatTurnRequest({
      context: { ...context, reportContent: JSON.stringify({ type: "doc", content: [] }), transcriptFacts: [PACK_ONE, PACK_TWO] },
    });
    expect(later.messages[0].content).toBe(withFacts.messages[0].content);
  });

  it("is capped at its own share of the head", () => {
    const many = pack(
      1,
      "Long call",
      Array.from({ length: 800 }, (_, index) =>
        fact(`F${index + 1}`, "result", `Measurement ${index + 1} of the ramp forecaster held within tolerance.`, index)
      )
    );
    const { report } = buildChatEvidence({
      reportText: "Report.",
      analysisText: "Analysis.",
      transcriptFactsText: chatFactsText([many], CHAT_TRANSCRIPT_FACTS_TOKENS * CHARS_PER_TOKEN),
    });
    const facts = report.sources.find((source) => source.label === EVIDENCE_LABELS.transcriptFacts)!;
    expect(facts.includedLength).toBeLessThanOrEqual(CHAT_TRANSCRIPT_FACTS_TOKENS * CHARS_PER_TOKEN);
  });
});

describe("the Brain query built from facts (no call)", () => {
  const map = buildPlaceholderMap({ clientName: "Verdant Grid", people: ["Priya Shah"] });

  it("maps fact types to the four queries and drops every name", () => {
    const brief = retrievalBriefFromFacts([PACK_ONE, PACK_TWO], map)!;
    expect(brief.uncertainty).toBe("said net load could not be forecast under fast cloud cover.");
    expect(brief.work).toContain("trained a ramp model");
    expect(brief.work).toContain("cloud edges drive the largest ramps");
    expect(brief.advancement).toContain("satellite cloud motion");
    expect(brief.problem).toContain("net load could not be forecast");
    for (const part of Object.values(brief)) {
      expect(part).not.toMatch(/Priya|Shah|Verdant|\[PERSON|\[CLIENT/);
    }
    expect(retrievalBriefFromFacts([PACK_ONE, PACK_TWO], map)).toEqual(brief);
  });

  it("falls back to results for the advancement, and to the call without any uncertainty", () => {
    const noAdvancement = pack(1, "A", [
      fact("F1", "uncertainty", "Ramp timing could not be predicted.", 1),
      fact("F2", "result", "The model reached 71 percent accuracy.", 2),
    ]);
    expect(retrievalBriefFromFacts([noAdvancement])?.advancement).toBe("The model reached 71 percent accuracy.");
    expect(retrievalBriefFromFacts([PACK_TWO])).toBeNull();
  });
});

describe("the PD review reads verified facts when they replace the transcript", () => {
  it("heads the packs as verified facts, and the text as before", () => {
    const base = { title: "Helios", clientName: "Verdant Grid", fileName: "pd.docx", pdContent: "The PD." };
    const facts = buildPdReviewUserMessage({ ...base, transcript: PACK_ONE, transcriptKind: "facts" }, []);
    expect(facts).toContain(`${PD_REVIEW_FACTS_HEADING}\n${PACK_ONE}`);
    const text = buildPdReviewUserMessage({ ...base, transcript: "Interview." }, []);
    expect(text).toContain("## Interview transcript (context)\nInterview.");
    expect(PD_REVIEW_FACTS_HEADING).not.toMatch(/[\u2013\u2014]/);
  });
});
