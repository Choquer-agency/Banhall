import { describe, expect, test } from "vitest";
import { matchProposalTurn, turnHolds } from "./chatProposalTurns";

const turn = (promptMessageId: string, startedAt?: number, endedAt?: number) => ({
  promptMessageId,
  ...(startedAt !== undefined ? { startedAt } : {}),
  ...(endedAt !== undefined ? { endedAt } : {}),
});

describe("turnHolds", () => {
  test("holds its start and its end, inclusive", () => {
    expect(turnHolds(turn("p", 10, 20), 10)).toBe(true);
    expect(turnHolds(turn("p", 10, 20), 20)).toBe(true);
    expect(turnHolds(turn("p", 10, 20), 9)).toBe(false);
    expect(turnHolds(turn("p", 10, 20), 21)).toBe(false);
  });

  test("a turn without both ends holds nothing", () => {
    expect(turnHolds(turn("p"), 15)).toBe(false);
    expect(turnHolds(turn("p", 10), 15)).toBe(false);
  });
});

describe("matchProposalTurn", () => {
  test("the one turn that holds the time", () => {
    const result = matchProposalTurn(15, [turn("a", 0, 9), turn("b", 10, 20), turn("c", 21, 30)]);
    expect(result).toEqual({ kind: "match", turn: turn("b", 10, 20) });
  });

  test("none when no turn holds it", () => {
    expect(matchProposalTurn(15, [turn("a", 0, 9), turn("c", 21, 30)])).toEqual({ kind: "none" });
    expect(matchProposalTurn(15, [])).toEqual({ kind: "none" });
  });

  test("ambiguous when two turns hold it", () => {
    expect(matchProposalTurn(15, [turn("a", 0, 20), turn("b", 10, 30)])).toEqual({ kind: "ambiguous" });
  });

  test("two rows of one prompt are one answer", () => {
    expect(matchProposalTurn(15, [turn("a", 0, 20), turn("a", 10, 30)])).toMatchObject({ kind: "match" });
  });
});
