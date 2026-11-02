import { describe, expect, it } from "vitest";
import { findWebOnlyDetails, WEB_ONLY_DETAIL } from "./qaChecks";
import {
  repairIssues,
  runDeterministicSelfCheck,
  WEB_ONLY_KEY,
} from "../lib/selfCheckRules";
import type { OrderedProfileContext } from "../lib/orderedChain";

/**
 * 2026-11-02 (proposed): a sentence that states as a fact about the work a
 * detail found only in the public background. Fictional project.
 */
const ANSWERS =
  "Log-based change data capture tools such as Debezium read the PostgreSQL write-ahead log. Replication slots retain WAL segments until a consumer confirms them, so a stalled consumer can fill the disk. Typical lag is under 500 ms.";
const EVIDENCE =
  '{"scientific_technical_problem":"The team replicated order tables from PostgreSQL to the analytics store and saw gaps after failover.","work_performed":"They tested a replication slot per region over 14 nights."}';

describe("findWebOnlyDetails", () => {
  it("finds a tool and a figure found only in the background, stated as plain fact", () => {
    const hits = findWebOnlyDetails(
      "The team used Debezium to stream changes from PostgreSQL. Lag stayed under 500 ms in testing.",
      ANSWERS,
      EVIDENCE
    );
    expect(hits.map((hit) => hit.phrase)).toEqual(["Debezium", "500"]);
  });

  it("leaves a sentence marked as general practice, and the text inside markers", () => {
    const text =
      "Log-based tools such as Debezium read the write-ahead log. [INFERRED: general practice, public source W1: confirm the team knew of Debezium] The team ran a replication slot per region over 14 nights. [GAP: what lag the team saw, such as 500 ms]";
    expect(findWebOnlyDetails(text, ANSWERS, EVIDENCE)).toEqual([]);
  });

  it("takes what the evidence states as stated, whatever the background says", () => {
    expect(findWebOnlyDetails("The team replicated order tables from PostgreSQL over 14 nights.", ANSWERS, EVIDENCE)).toEqual([]);
  });

  it("finds a name that opens the sentence and a single digit (review round 1)", () => {
    const answers = `${ANSWERS} A common setup runs 3 replicas behind a load balancer.`;
    expect(findWebOnlyDetails("Debezium was used by our team.", answers, EVIDENCE).map((hit) => hit.phrase)).toEqual(["Debezium"]);
    expect(findWebOnlyDetails("We ran 3 replicas.", answers, EVIDENCE).map((hit) => hit.phrase)).toEqual(["3"]);
    // A number the evidence writes in words counts as stated.
    expect(findWebOnlyDetails("We ran 3 replicas.", answers, `${EVIDENCE} They ran three replicas.`)).toEqual([]);
  });

  it("ignores an ordinary opener, a figure the background lacks, and CRA", () => {
    expect(findWebOnlyDetails("Replication slots were set up. CRA wording aside, 3 regions ran.", ANSWERS, EVIDENCE)).toEqual([]);
  });

  it("finds nothing without background", () => {
    expect(findWebOnlyDetails("The team used Debezium.", "", EVIDENCE)).toEqual([]);
  });
});

describe("the web-only row in the Self-check", () => {
  const profile = {
    profileState: "missing",
    categoryOutcomes: [],
    buildOrder: ["242", "244", "246"],
    selfCheckRules: [],
  } as unknown as OrderedProfileContext;
  const check = (text: string, webOnly?: { answers: string; evidence: string }, webOnlyRow?: boolean) =>
    runDeterministicSelfCheck({
      section: "244",
      text,
      brief: null,
      profile,
      isFirstInOrder: false,
      ...(webOnly ? { webOnly } : {}),
      ...(webOnlyRow ? { webOnlyRow } : {}),
    });

  it("is a Locked row the repair fixes, naming the paragraph and the detail", () => {
    const before = check(
      "The team replicated order tables.\n\nThe team used Debezium to stream changes.",
      { answers: ANSWERS, evidence: EVIDENCE }
    );
    const entry = before.entries.find((candidate) => candidate.key === WEB_ONLY_KEY);
    expect(entry).toMatchObject({
      repairable: true,
      row: { instruction: WEB_ONLY_DETAIL.instruction, outcome: "not_applied", tier: "locked", paragraphIndex: 1 },
    });
    expect(entry!.row.reason).toBe('a detail found only in the public background in paragraph 2 ("Debezium")');
    expect(entry!.guidance).toBe(
      `Paragraph 2 states as a fact about the work a detail found only in the public background ("Debezium"): ${WEB_ONLY_DETAIL.fix}. ${WEB_ONLY_DETAIL.rule}`
    );
    expect(repairIssues(before, [])).toContain(entry!.guidance);
  });

  it("adds no row without background or with a clean Line, and the final check says the repair fixed it", () => {
    const leaky = "The team used Debezium to stream changes.";
    expect(check(leaky).entries.some((entry) => entry.key === WEB_ONLY_KEY)).toBe(false);
    const clean = "The team replicated order tables from PostgreSQL.";
    expect(check(clean, { answers: ANSWERS, evidence: EVIDENCE }).entries.some((entry) => entry.key === WEB_ONLY_KEY)).toBe(false);
    const after = check(clean, { answers: ANSWERS, evidence: EVIDENCE }, true);
    expect(after.entries.find((entry) => entry.key === WEB_ONLY_KEY)?.row).toMatchObject({
      outcome: "applied",
      tier: "locked",
      reason: WEB_ONLY_DETAIL.applied,
    });
  });
});
