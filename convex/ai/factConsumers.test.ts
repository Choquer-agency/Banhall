/**
 * The other readers of verified facts (phase 3, plan step 8): the Brain
 * query built from facts and the PD review's heading, and report chat,
 * which reads none. Pure.
 */
import { describe, expect, it } from "vitest";
import { EVIDENCE_LABELS, buildChatTurnRequest } from "./chatEvidence";
import { CHAT_EVIDENCE_GUIDANCE } from "./prompts";
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

describe("report chat never reads fact packs (decision 26, review 2026-09-25)", () => {
  it("keeps the evidence head free of facts: chat cannot restore placeholders while it streams", () => {
    const context = {
      reportContent: null,
      agentOutputs: JSON.stringify({ analyzer: { project_goal: "Forecast net load" } }),
      documents: [],
      decisions: [],
    };
    const request = buildChatTurnRequest({ context });
    const head = String(request.messages[0].content);
    expect(head).not.toContain("TRANSCRIPT FACTS");
    expect(head).not.toContain("[F1-");
    expect(CHAT_EVIDENCE_GUIDANCE).not.toContain("TRANSCRIPT FACTS");
    expect(Object.values(EVIDENCE_LABELS)).not.toContain("TRANSCRIPT FACTS");
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
